/** Same-origin product API only. This never proxies the loopback Runner or enables hosted APIs. */
import "server-only";
import type { AuthenticatedWebLabActor } from "./production-control-service";
import {
  LocalRunnerProductError, LOCAL_RUNNER_PRODUCT_ID,
  type LocalRunnerProductErrorCode, type LocalRunnerProductService,
} from "./local-runner-product-service";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const STATUS: Record<LocalRunnerProductErrorCode, number> = {
  UNAUTHENTICATED: 401, LAB_NOT_FOUND: 404, LAB_INCOMPATIBLE: 409, LOCAL_RUNNER_UNAVAILABLE: 503,
  RATE_LIMITED: 429, INVALID_REQUEST: 400, CSRF_REJECTED: 403, REQUEST_TOO_LARGE: 413, INTERNAL_ERROR: 500,
};

export function localRunnerProductFailure(error: unknown): Response {
  const code = error instanceof LocalRunnerProductError ? error.code : "INTERNAL_ERROR";
  return Response.json({ data: null, error: { code } }, { status: STATUS[code], headers: HEADERS });
}

function success(data: unknown): Response {
  return Response.json({ data, error: null }, { headers: HEADERS });
}

function origin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return value === url.origin && !url.username && !url.password && url.pathname === "/" &&
      !url.search && !url.hash && (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ? value : null;
  } catch { return null; }
}

async function packageJson(request: Request): Promise<{ idempotencyKey?: string }> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new LocalRunnerProductError("INVALID_REQUEST");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > 512) {
    throw new LocalRunnerProductError("REQUEST_TOO_LARGE");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new LocalRunnerProductError("INVALID_REQUEST");
  let total = 0;
  let raw = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 512) {
        await reader.cancel();
        throw new LocalRunnerProductError("REQUEST_TOO_LARGE");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new LocalRunnerProductError("INVALID_REQUEST"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).some(key => key !== "idempotencyKey") ||
      ("idempotencyKey" in parsed && typeof parsed.idempotencyKey !== "string")) {
    throw new LocalRunnerProductError("INVALID_REQUEST");
  }
  return parsed as { idempotencyKey?: string };
}

export function createLocalRunnerProductApi(options: {
  enabled?: boolean;
  trustedOrigin?: string;
  resolveActor: (request: Request) => Promise<AuthenticatedWebLabActor | null>;
  service: () => LocalRunnerProductService;
}) {
  return async (operation: "eligibility" | "package", request: Request, savedLabId: string): Promise<Response> => {
    try {
      if (options.enabled !== true) {
        if (operation === "eligibility" && request.method === "GET") {
          return success({ enabled: false, eligible: false, build: null });
        }
        throw new LocalRunnerProductError("LAB_NOT_FOUND");
      }
      const expectedMethod = operation === "eligibility" ? "GET" : "POST";
      const url = new URL(request.url);
      const path = `/api/web-labs/local-runner/${savedLabId}${operation === "package" ? "/package" : ""}`;
      if (request.method !== expectedMethod || !LOCAL_RUNNER_PRODUCT_ID.test(savedLabId) ||
          url.pathname !== path || url.search || url.hash) throw new LocalRunnerProductError("INVALID_REQUEST");
      const actor = await options.resolveActor(request);
      if (!actor) throw new LocalRunnerProductError("UNAUTHENTICATED");
      if (operation === "package") {
        const expected = origin(options.trustedOrigin);
        if (!expected || origin(request.headers.get("origin")) !== expected || url.origin !== expected ||
            request.headers.get("sec-fetch-site") === "cross-site") {
          throw new LocalRunnerProductError("CSRF_REJECTED");
        }
        const input = await packageJson(request);
        return success({ package: await options.service().issuePackage(actor, savedLabId, input.idempotencyKey) });
      }
      if (request.headers.get("sec-fetch-site") === "cross-site") throw new LocalRunnerProductError("CSRF_REJECTED");
      return success(await options.service().eligibility(actor, savedLabId));
    } catch (error) { return localRunnerProductFailure(error); }
  };
}
