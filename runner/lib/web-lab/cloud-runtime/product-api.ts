import "server-only";
import {
  WebLabControlError, type AuthenticatedWebLabActor, type WebLabControlErrorCode,
} from "../production-control-service";
import type { CloudProductService } from "./product-service";

type Resolver = (request: Request) => Promise<AuthenticatedWebLabActor | null>;
const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
const STATUS: Record<WebLabControlErrorCode, number> = {
  UNAUTHENTICATED: 401, INVALID_REQUEST: 400, LAB_NOT_FOUND: 404, LAB_INCOMPATIBLE: 409,
  HOSTED_PLAN_REQUIRED: 403, HOSTED_CAPACITY_FULL: 409, HOSTED_DISABLED: 503,
  HOSTED_BUDGET_RESTRICTED: 503, HOSTED_BUDGET_EXCEEDED: 503, HOSTED_QUOTA_EXCEEDED: 429,
  RUNTIME_ALREADY_ACTIVE: 409, RUNTIME_PROVISIONING_FAILED: 503, RUNTIME_EXPIRED: 410,
  RUNTIME_NOT_FOUND: 404, RUNTIME_NOT_READY: 409, RESET_LIMIT_EXCEEDED: 429,
  GRADE_RATE_LIMITED: 429, GRADE_IN_PROGRESS: 409, GRADE_UNAVAILABLE: 503,
  INVALID_LAUNCH_GRANT: 401, LAUNCH_GRANT_EXPIRED: 410,
  LAUNCH_GRANT_REPLAYED: 409, RUNNER_UNAVAILABLE: 503, STALE_RUNTIME_VERSION: 409,
  IDEMPOTENCY_CONFLICT: 409, RATE_LIMITED: 429, INTERNAL_ERROR: 500, CSRF_REJECTED: 403,
};

function fail(error: unknown, status?: number): Response {
  const safe = error instanceof WebLabControlError ? error : new WebLabControlError("INTERNAL_ERROR");
  return Response.json({ data: null, error: { code: safe.code } },
    { status: status ?? STATUS[safe.code], headers: HEADERS });
}
function ok(data: unknown, status = 200): Response {
  return Response.json({ data, error: null }, { status, headers: HEADERS });
}
function sameOrigin(request: Request, origin: string): void {
  let expected: URL; let actual: URL;
  try { expected = new URL(origin); actual = new URL(request.url); } catch { throw new WebLabControlError("CSRF_REJECTED"); }
  const local = expected.protocol === "http:" && ["localhost", "127.0.0.1"].includes(expected.hostname);
  if ((!local && expected.protocol !== "https:") || expected.username || expected.password ||
      expected.origin !== origin || expected.pathname !== "/" || expected.search || expected.hash ||
      request.headers.get("origin") !== origin || actual.origin !== origin) {
    throw new WebLabControlError("CSRF_REJECTED");
  }
}
async function json(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new WebLabControlError("INVALID_REQUEST");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 1024)) {
    throw new WebLabControlError("INVALID_REQUEST");
  }
  const raw = await request.text();
  if (raw.length > 1024) throw new WebLabControlError("INVALID_REQUEST");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new WebLabControlError("INVALID_REQUEST"); }
  if (!value || Array.isArray(value) || typeof value !== "object") throw new WebLabControlError("INVALID_REQUEST");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some(key => !["action", "idempotencyKey"].includes(key))) {
    throw new WebLabControlError("INVALID_REQUEST");
  }
  return object;
}

export function createCloudProductApi(options: {
  enabled?: boolean;
  origin: string;
  resolveActor: Resolver;
  service: CloudProductService;
}) {
  return async (request: Request, savedLabId: string): Promise<Response> => {
    if (options.enabled !== true) return fail(new WebLabControlError("LAB_NOT_FOUND"));
    try {
      const actor = await options.resolveActor(request);
      if (!actor) return fail(new WebLabControlError("UNAUTHENTICATED"));
      const url = new URL(request.url);
      if (request.method === "GET") {
        if (url.search || url.pathname.split("/").at(-1) !== savedLabId) {
          throw new WebLabControlError("INVALID_REQUEST");
        }
        return ok(await options.service.snapshot(actor, savedLabId));
      }
      if (request.method !== "POST") throw new WebLabControlError("INVALID_REQUEST");
      sameOrigin(request, options.origin);
      const input = await json(request);
      if (typeof input.action !== "string" || !["launch", "reset", "stop", "open"].includes(input.action)) {
        throw new WebLabControlError("INVALID_REQUEST");
      }
      if (input.action === "open") {
        if (input.idempotencyKey !== undefined) throw new WebLabControlError("INVALID_REQUEST");
        return ok(await options.service.open(actor, savedLabId));
      }
      if (typeof input.idempotencyKey !== "string") throw new WebLabControlError("INVALID_REQUEST");
      const action = input.action as "launch" | "reset" | "stop";
      return ok(await options.service[action](actor, savedLabId, input.idempotencyKey), 202);
    } catch (error) { return fail(error); }
  };
}
