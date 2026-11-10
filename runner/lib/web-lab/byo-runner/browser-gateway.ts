import { createHash, randomBytes } from "node:crypto";
import {
  ByoVmBrowserRelay,
  ByoBrowserRelayError,
  type ByoBrowserRelaySession,
} from "./browser-relay";
import {
  BYO_RELAY_MAX_REQUEST_BODY_BYTES,
  hasExactKeys,
  isPlainObject,
  validOwnerId,
  validRuntimeId,
} from "./protocol";

export const BYO_BROWSER_GATEWAY_LAUNCH_PATH = "/__amniora/byo/launch";
export const BYO_BROWSER_GATEWAY_SESSION_COOKIE = "amniora_byo_lab_session";
export const BYO_BROWSER_GATEWAY_LAUNCH_TTL_MS = 15_000;

type GatewayErrorCode =
  | "GATEWAY_REQUEST_INVALID"
  | "GATEWAY_HOST_REJECTED"
  | "GATEWAY_ORIGIN_REJECTED"
  | "GATEWAY_GRANT_INVALID"
  | "GATEWAY_GRANT_EXPIRED"
  | "GATEWAY_SESSION_INVALID"
  | "GATEWAY_SESSION_EXPIRED"
  | "GATEWAY_METHOD_NOT_ALLOWED"
  | "GATEWAY_REQUEST_TOO_LARGE"
  | "GATEWAY_UNAVAILABLE";

const GATEWAY_STATUS: Readonly<Record<GatewayErrorCode, number>> = {
  GATEWAY_REQUEST_INVALID: 400,
  GATEWAY_HOST_REJECTED: 421,
  GATEWAY_ORIGIN_REJECTED: 403,
  GATEWAY_GRANT_INVALID: 401,
  GATEWAY_GRANT_EXPIRED: 401,
  GATEWAY_SESSION_INVALID: 401,
  GATEWAY_SESSION_EXPIRED: 401,
  GATEWAY_METHOD_NOT_ALLOWED: 405,
  GATEWAY_REQUEST_TOO_LARGE: 413,
  GATEWAY_UNAVAILABLE: 502,
};

class ByoBrowserGatewayError extends Error {
  readonly status: number;

  constructor(readonly code: GatewayErrorCode) {
    super(code);
    this.name = "ByoBrowserGatewayError";
    this.status = GATEWAY_STATUS[code];
  }
}

type LaunchGrant = Readonly<{
  ownerId: string;
  runtimeId: string;
  expiresAt: number;
}>;

type BrowserSession = Readonly<{
  ownerId: string;
  runtimeId: string;
  relayToken: string;
  expiresAt: number;
}>;

export type ByoBrowserLaunch = Readonly<{
  action: string;
  grant: string;
  expiresAt: number;
}>;

export type ByoTrustedBrowserSession = Readonly<{
  cookieHeader: string;
  expiresAt: number;
}>;

export type ByoVmBrowserGatewayOptions = Readonly<{
  relay: Pick<ByoVmBrowserRelay, "createSession" | "relay">;
  gatewayOrigin: string;
  trustedAppOrigin: string;
  now?: () => number;
  launchTtlMs?: number;
}>;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function exactOrigin(value: string, label: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error(`invalid_${label}_origin`); }
  const localHttp = url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname.endsWith(".localhost"));
  if (value !== url.origin || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !localHttp)) throw new Error(`invalid_${label}_origin`);
  return url;
}

function safeHeaders(contentType = "application/json; charset=utf-8"): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function gatewayFailure(error: unknown, clearCookie?: string): Response {
  const known = error instanceof ByoBrowserGatewayError || error instanceof ByoBrowserRelayError;
  const status = known ? error.status : 502;
  const code = known ? error.code : "GATEWAY_UNAVAILABLE";
  const headers = new Headers(safeHeaders());
  if (clearCookie) headers.set("Set-Cookie", clearCookie);
  return Response.json({ data: null, error: { code } }, { status, headers });
}

async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    throw new ByoBrowserGatewayError("GATEWAY_REQUEST_TOO_LARGE");
  }
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ByoBrowserGatewayError("GATEWAY_REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map(value => Buffer.from(value)), total);
}

function sessionCookie(header: string | null): string | null {
  if (!header || Buffer.byteLength(header) > 4_096) return null;
  const values: string[] = [];
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1 || part.slice(0, index).trim() !== BYO_BROWSER_GATEWAY_SESSION_COOKIE) continue;
    values.push(part.slice(index + 1).trim());
  }
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : null;
}

/**
 * Dedicated-origin HTTP boundary for browser access to a BYO VM runtime.
 * The authenticated application issues a one-use grant; challenge traffic never receives app or gateway cookies.
 */
export class ByoVmBrowserGateway {
  private readonly now: () => number;
  private readonly launchTtlMs: number;
  private readonly gateway: URL;
  private readonly app: URL;
  private readonly grants = new Map<string, LaunchGrant>();
  private readonly sessions = new Map<string, BrowserSession>();

  constructor(private readonly options: ByoVmBrowserGatewayOptions) {
    this.now = options.now ?? (() => Date.now());
    this.launchTtlMs = options.launchTtlMs ?? BYO_BROWSER_GATEWAY_LAUNCH_TTL_MS;
    this.gateway = exactOrigin(options.gatewayOrigin, "gateway");
    this.app = exactOrigin(options.trustedAppOrigin, "trusted_app");
    if (!Number.isSafeInteger(this.launchTtlMs) || this.launchTtlMs < 1_000 || this.launchTtlMs > 60_000) {
      throw new Error("invalid_byo_browser_launch_ttl");
    }
  }

  issueLaunch(input: Readonly<{ ownerId: string; runtimeId: string }>): ByoBrowserLaunch {
    if (!isPlainObject(input) || !hasExactKeys(input, ["ownerId", "runtimeId"]) ||
        !validOwnerId(input.ownerId) || !validRuntimeId(input.runtimeId)) {
      throw new ByoBrowserGatewayError("GATEWAY_REQUEST_INVALID");
    }
    const grant = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + this.launchTtlMs;
    this.grants.set(digest(grant), { ownerId: input.ownerId, runtimeId: input.runtimeId, expiresAt });
    return { action: `${this.gateway.origin}${BYO_BROWSER_GATEWAY_LAUNCH_PATH}`, grant, expiresAt };
  }

  async createTrustedSession(input: Readonly<{ ownerId: string; runtimeId: string }>): Promise<ByoTrustedBrowserSession> {
    const session = await this.establish(input);
    return { cookieHeader: `${BYO_BROWSER_GATEWAY_SESSION_COOKIE}=${session.token}`, expiresAt: session.expiresAt };
  }

  async handle(request: Request): Promise<Response> {
    let url: URL;
    try { url = new URL(request.url); }
    catch { return gatewayFailure(new ByoBrowserGatewayError("GATEWAY_REQUEST_INVALID")); }
    if (url.origin !== this.gateway.origin || request.headers.get("host") !== this.gateway.host || url.hash) {
      return gatewayFailure(new ByoBrowserGatewayError("GATEWAY_HOST_REJECTED"));
    }
    if (url.pathname === BYO_BROWSER_GATEWAY_LAUNCH_PATH) return this.launch(request, url);
    if (url.pathname.startsWith("/__amniora/")) {
      return gatewayFailure(new ByoBrowserGatewayError("GATEWAY_REQUEST_INVALID"));
    }
    return this.proxy(request, url);
  }

  clear(): void {
    this.grants.clear();
    this.sessions.clear();
  }

  private async launch(request: Request, url: URL): Promise<Response> {
    try {
      if (request.method !== "POST") throw new ByoBrowserGatewayError("GATEWAY_METHOD_NOT_ALLOWED");
      if (url.search || request.headers.get("origin") !== this.app.origin ||
          request.headers.get("sec-fetch-site") === "cross-site") {
        throw new ByoBrowserGatewayError("GATEWAY_ORIGIN_REJECTED");
      }
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/x-www-form-urlencoded") {
        throw new ByoBrowserGatewayError("GATEWAY_REQUEST_INVALID");
      }
      const body = await boundedBody(request, 512);
      const parameters = [...new URLSearchParams(body.toString("utf8"))];
      if (parameters.length !== 1 || parameters[0][0] !== "grant" || !/^[A-Za-z0-9_-]{43}$/.test(parameters[0][1])) {
        throw new ByoBrowserGatewayError("GATEWAY_GRANT_INVALID");
      }
      const grantDigest = digest(parameters[0][1]);
      const grant = this.grants.get(grantDigest);
      if (!grant) throw new ByoBrowserGatewayError("GATEWAY_GRANT_INVALID");
      this.grants.delete(grantDigest);
      if (this.now() >= grant.expiresAt) throw new ByoBrowserGatewayError("GATEWAY_GRANT_EXPIRED");
      const session = await this.establish({ ownerId: grant.ownerId, runtimeId: grant.runtimeId });
      const headers = new Headers(safeHeaders());
      headers.set("Location", "/");
      headers.set("Set-Cookie", this.setCookie(session.token, session.expiresAt));
      return new Response(null, { status: 303, headers });
    } catch (error) { return gatewayFailure(error); }
  }

  private async proxy(request: Request, url: URL): Promise<Response> {
    const token = sessionCookie(request.headers.get("cookie"));
    const stored = token ? this.sessions.get(digest(token)) : null;
    const clearCookie = this.clearCookie();
    try {
      if (!stored) throw new ByoBrowserGatewayError("GATEWAY_SESSION_INVALID");
      if (this.now() >= stored.expiresAt) {
        this.sessions.delete(digest(token!));
        throw new ByoBrowserGatewayError("GATEWAY_SESSION_EXPIRED");
      }
      if (!["GET", "HEAD", "POST", "PUT"].includes(request.method)) {
        throw new ByoBrowserGatewayError("GATEWAY_METHOD_NOT_ALLOWED");
      }
      const requestOrigin = request.headers.get("origin");
      if (request.headers.get("sec-fetch-site") === "cross-site" ||
          ((request.method === "POST" || request.method === "PUT") && requestOrigin !== this.gateway.origin) ||
          (requestOrigin !== null && requestOrigin !== this.gateway.origin)) {
        throw new ByoBrowserGatewayError("GATEWAY_ORIGIN_REJECTED");
      }
      const body = await boundedBody(request, BYO_RELAY_MAX_REQUEST_BODY_BYTES);
      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => { headers[name] = value; });
      const response = await this.options.relay.relay({
        sessionToken: stored.relayToken,
        ownerId: stored.ownerId,
        runtimeId: stored.runtimeId,
        request: { method: request.method, pathQuery: url.pathname + url.search, headers, body },
      });
      const responseHeaders = new Headers(safeHeaders(response.headers["content-type"] ?? "application/octet-stream"));
      for (const [name, value] of Object.entries(response.headers)) responseHeaders.set(name, value);
      responseHeaders.set("Content-Security-Policy", "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      responseHeaders.set("Content-Length", String(request.method === "HEAD" ? 0 : response.body.length));
      return new Response(request.method === "HEAD" ? null : new Uint8Array(response.body), {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (error) {
      if (error instanceof ByoBrowserRelayError && [401, 403, 409, 410].includes(error.status) && token) {
        this.sessions.delete(digest(token));
      }
      return gatewayFailure(error, error instanceof ByoBrowserGatewayError || error instanceof ByoBrowserRelayError
        ? clearCookie : undefined);
    }
  }

  private async establish(input: Readonly<{ ownerId: string; runtimeId: string }>): Promise<{
    token: string;
    expiresAt: number;
  }> {
    if (!isPlainObject(input) || !hasExactKeys(input, ["ownerId", "runtimeId"]) ||
        !validOwnerId(input.ownerId) || !validRuntimeId(input.runtimeId)) {
      throw new ByoBrowserGatewayError("GATEWAY_REQUEST_INVALID");
    }
    const relay: ByoBrowserRelaySession = await this.options.relay.createSession(input);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(digest(token), {
      ownerId: input.ownerId,
      runtimeId: input.runtimeId,
      relayToken: relay.sessionToken,
      expiresAt: relay.expiresAt,
    });
    return { token, expiresAt: relay.expiresAt };
  }

  private setCookie(token: string, expiresAt: number): string {
    const maxAge = Math.max(1, Math.floor((expiresAt - this.now()) / 1_000));
    const secure = this.gateway.protocol === "https:" ? "; Secure" : "";
    return `${BYO_BROWSER_GATEWAY_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
  }

  private clearCookie(): string {
    const secure = this.gateway.protocol === "https:" ? "; Secure" : "";
    return `${BYO_BROWSER_GATEWAY_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
  }
}
