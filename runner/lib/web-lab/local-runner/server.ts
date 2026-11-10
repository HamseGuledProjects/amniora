import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { LocalRunnerCore } from "./core";
import {
  hasExactKeys,
  isPlainObject,
  LOCAL_RUNNER_CONTROL_HOST,
  LOCAL_RUNNER_CONTROL_PORT,
  LOCAL_RUNNER_MAX_BODY_BYTES,
  LocalRunnerError,
  type RunnerCapabilityScope,
} from "./protocol";

const ROUTES = new Set(["/v1/capabilities", "/v1/authorize", "/v1/launch", "/v1/status", "/v1/reset", "/v1/stop"]);

export type LocalRunnerServerOptions = Readonly<{
  core: LocalRunnerCore;
  allowedOrigins: readonly string[];
  host?: typeof LOCAL_RUNNER_CONTROL_HOST;
  port?: number;
  bodyLimit?: number;
  expiryPollMs?: number;
}>;

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" ||
        parsed.search || parsed.hash || parsed.origin !== value) return null;
    return parsed.origin;
  } catch { return null; }
}

function json(response: ServerResponse, status: number, value: unknown, origin?: string): void {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cross-Origin-Resource-Policy", "same-site");
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.end(JSON.stringify(value));
}

function parseCapabilityScope(input: unknown): RunnerCapabilityScope {
  if (!isPlainObject(input) || typeof input.operation !== "string") throw new LocalRunnerError("MALFORMED_REQUEST");
  if (input.operation === "launch") {
    if (!hasExactKeys(input, ["operation", "buildId", "buildFingerprint", "idempotencyKey"]) ||
        typeof input.buildId !== "string" || typeof input.buildFingerprint !== "string" || typeof input.idempotencyKey !== "string") {
      throw new LocalRunnerError("MALFORMED_REQUEST");
    }
    return { operation: "launch", buildId: input.buildId, buildFingerprint: input.buildFingerprint, idempotencyKey: input.idempotencyKey };
  }
  if (input.operation === "reset" || input.operation === "stop") {
    if (!hasExactKeys(input, ["operation", "sessionId", "buildFingerprint", "generation", "idempotencyKey"]) ||
        typeof input.sessionId !== "string" || typeof input.buildFingerprint !== "string" ||
        !Number.isSafeInteger(input.generation) || typeof input.idempotencyKey !== "string") {
      throw new LocalRunnerError("MALFORMED_REQUEST");
    }
    return {
      operation: input.operation,
      sessionId: input.sessionId,
      buildFingerprint: input.buildFingerprint,
      generation: Number(input.generation),
      idempotencyKey: input.idempotencyKey,
    };
  }
  throw new LocalRunnerError("MALFORMED_REQUEST");
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
    throw new LocalRunnerError("UNSUPPORTED_CONTENT_TYPE");
  }
  const declared = request.headers["content-length"];
  const declaredTooLarge = Boolean(declared && (!/^\d+$/.test(declared) || Number(declared) > limit));
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size <= limit && !declaredTooLarge) chunks.push(bytes);
  }
  if (declaredTooLarge || size > limit) throw new LocalRunnerError("REQUEST_TOO_LARGE");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new LocalRunnerError("MALFORMED_REQUEST"); }
}

export class LocalRunnerControlServer {
  private readonly host: typeof LOCAL_RUNNER_CONTROL_HOST;
  private readonly requestedPort: number;
  private readonly bodyLimit: number;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly server: Server;
  private pollTimer: NodeJS.Timeout | null = null;
  private boundPort: number | null = null;

  constructor(private readonly options: LocalRunnerServerOptions) {
    this.host = options.host ?? LOCAL_RUNNER_CONTROL_HOST;
    this.requestedPort = options.port ?? LOCAL_RUNNER_CONTROL_PORT;
    this.bodyLimit = options.bodyLimit ?? LOCAL_RUNNER_MAX_BODY_BYTES;
    const normalized = options.allowedOrigins.map(normalizeOrigin);
    if (!normalized.length || normalized.some(origin => origin === null)) throw new Error("invalid_runner_allowed_origins");
    this.allowedOrigins = new Set(normalized as string[]);
    this.server = createServer({ maxHeaderSize: 8_192, requestTimeout: 10_000 }, (request, response) => {
      void this.handle(request, response).catch(error => this.sendError(response, error));
    });
  }

  get origin(): string {
    if (this.boundPort === null) throw new LocalRunnerError("RUNNER_NOT_READY");
    return `http://${this.host}:${this.boundPort}`;
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        this.server.off("listening", onListening);
        reject(error.code === "EADDRINUSE" ? new LocalRunnerError("RUNNER_ALREADY_RUNNING") : error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.requestedPort, this.host);
    });
    const address = this.server.address() as AddressInfo | null;
    if (!address || address.address !== this.host) {
      await this.close();
      throw new LocalRunnerError("RUNNER_NOT_READY", 500);
    }
    this.boundPort = address.port;
    this.pollTimer = setInterval(() => { void this.options.core.status().catch(() => undefined); }, this.options.expiryPollMs ?? 30_000);
    this.pollTimer.unref();
    return this.origin;
  }

  async close(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.boundPort = null;
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
  }

  private sendError(response: ServerResponse, error: unknown, origin?: string): void {
    if (response.headersSent || response.destroyed) return;
    const safe = error instanceof LocalRunnerError ? error : new LocalRunnerError("INTERNAL_ERROR", 500);
    json(response, safe.status, { data: null, error: { code: safe.code } }, origin);
  }

  private requestOrigin(request: IncomingMessage): string {
    const raw = request.headers.origin;
    if (typeof raw !== "string") throw new LocalRunnerError("ORIGIN_DENIED");
    const normalized = normalizeOrigin(raw);
    if (!normalized || !this.allowedOrigins.has(normalized)) throw new LocalRunnerError("ORIGIN_DENIED");
    return normalized;
  }

  private validateHost(request: IncomingMessage): void {
    if (this.boundPort === null || request.headers.host !== `${this.host}:${this.boundPort}`) throw new LocalRunnerError("HOST_DENIED");
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.validateHost(request);
    const origin = this.requestOrigin(request);
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (typeof request.url !== "string" || !request.url.startsWith("/") || request.url.startsWith("//")) {
      throw new LocalRunnerError("NOT_FOUND");
    }
    const url = new URL(request.url, "http://runner.invalid");
    if (!ROUTES.has(url.pathname)) throw new LocalRunnerError("NOT_FOUND");
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Methods", url.pathname === "/v1/capabilities" || url.pathname === "/v1/status" ? "GET" : "POST");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Access-Control-Max-Age", "300");
      response.setHeader("Vary", "Origin");
      response.end();
      return;
    }
    let data: unknown;
    if (url.pathname === "/v1/capabilities") {
      if (request.method !== "GET") throw new LocalRunnerError("METHOD_NOT_ALLOWED");
      if ([...url.searchParams.keys()].some(key => key !== "protocolVersion")) throw new LocalRunnerError("MALFORMED_REQUEST");
      data = await this.options.core.capabilities(url.searchParams.get("protocolVersion") ?? undefined);
    } else if (url.pathname === "/v1/status") {
      if (request.method !== "GET" || url.search) throw new LocalRunnerError(request.method === "GET" ? "MALFORMED_REQUEST" : "METHOD_NOT_ALLOWED");
      data = await this.options.core.status();
    } else {
      if (request.method !== "POST" || url.search) throw new LocalRunnerError(request.method === "POST" ? "MALFORMED_REQUEST" : "METHOD_NOT_ALLOWED");
      const input = await readJson(request, this.bodyLimit);
      if (url.pathname === "/v1/authorize") {
        data = this.options.core.authorize(parseCapabilityScope(input));
      } else if (url.pathname === "/v1/launch") {
        if (!isPlainObject(input) || !hasExactKeys(input, ["capability", "package"])) throw new LocalRunnerError("MALFORMED_REQUEST");
        data = await this.options.core.launch(input.capability, input.package);
      } else if (url.pathname === "/v1/reset" || url.pathname === "/v1/stop") {
        if (!isPlainObject(input) || !hasExactKeys(input, ["capability"])) throw new LocalRunnerError("MALFORMED_REQUEST");
        data = url.pathname === "/v1/reset"
          ? await this.options.core.reset(input.capability)
          : await this.options.core.stop(input.capability);
      }
    }
    json(response, 200, { data, error: null }, origin);
  }
}

export const LOCAL_RUNNER_PRODUCT_ORIGINS = ["https://portfolio.example.test"] as const;
