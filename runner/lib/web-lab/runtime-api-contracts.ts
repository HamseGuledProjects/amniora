/** Server-only request/response boundary shared by the registered runtime routes. */
import "server-only";
import {
  WebLabControlError, type AuthenticatedWebLabActor,
  type WebLabControlErrorCode, type WebLabControlPlaneService,
} from "./production-control-service";
import type { RuntimeMode } from "./postgres-control-repository";

export const WEB_LAB_RUNTIME_API_PATHS = Object.freeze({
  launch: "/api/web-labs/runtime/launch",
  status: "/api/web-labs/runtime/:id",
  reset: "/api/web-labs/runtime/:id/reset",
  destroy: "/api/web-labs/runtime/:id",
  grade: "/api/web-labs/runtime/:id/grade",
  exchange: "/api/web-labs/runtime/launch/exchange",
});

type ActorResolver = (request: Request) => Promise<AuthenticatedWebLabActor | null>;
type JsonObject = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY = /^[A-Za-z0-9_-]{1,160}$/;
const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

const STATUS: Record<WebLabControlErrorCode, number> = {
  UNAUTHENTICATED: 401, INVALID_REQUEST: 400, LAB_NOT_FOUND: 404, LAB_INCOMPATIBLE: 409,
  HOSTED_PLAN_REQUIRED: 403, HOSTED_CAPACITY_FULL: 409, HOSTED_DISABLED: 503,
  HOSTED_BUDGET_RESTRICTED: 503, HOSTED_BUDGET_EXCEEDED: 503,
  HOSTED_QUOTA_EXCEEDED: 429, RUNTIME_ALREADY_ACTIVE: 409,
  RUNTIME_PROVISIONING_FAILED: 503, RUNTIME_EXPIRED: 410, RUNTIME_NOT_FOUND: 404,
  RUNTIME_NOT_READY: 409, RESET_LIMIT_EXCEEDED: 429, GRADE_RATE_LIMITED: 429,
  GRADE_IN_PROGRESS: 409, GRADE_UNAVAILABLE: 503,
  INVALID_LAUNCH_GRANT: 401, LAUNCH_GRANT_EXPIRED: 410, LAUNCH_GRANT_REPLAYED: 409,
  RUNNER_UNAVAILABLE: 503, STALE_RUNTIME_VERSION: 409, IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429, INTERNAL_ERROR: 500,
  CSRF_REJECTED: 403,
};

function trustedOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash || url.origin !== value ||
        (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

function assertSameOriginMutation(request: Request, configuredOrigin: string | undefined): void {
  const expected = trustedOrigin(configuredOrigin);
  const supplied = request.headers.get("origin");
  if (!expected || !supplied || trustedOrigin(supplied) !== expected) {
    throw new WebLabControlError("CSRF_REJECTED");
  }
  try {
    if (new URL(request.url).origin !== expected) throw new WebLabControlError("CSRF_REJECTED");
  } catch { throw new WebLabControlError("CSRF_REJECTED"); }
  // Host and X-Forwarded-Host are deliberately not accepted as origin authority.
}

function response(data: unknown, status = 200): Response {
  return Response.json({ data, error: null }, { status, headers: HEADERS });
}

function failure(error: unknown): Response {
  const safe = error instanceof WebLabControlError ? error : new WebLabControlError("INTERNAL_ERROR");
  return Response.json({ data: null, error: { code: safe.code,
    ...(safe.compatibility ? { compatibility: safe.compatibility } : {}) } },
  { status: STATUS[safe.code], headers: HEADERS });
}

async function body(request: Request, allowedKeys: readonly string[]): Promise<JsonObject> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new WebLabControlError("INVALID_REQUEST");
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > 2048) throw new WebLabControlError("INVALID_REQUEST");
  const raw = await request.text();
  if (raw.length > 2048) throw new WebLabControlError("INVALID_REQUEST");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new WebLabControlError("INVALID_REQUEST"); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new WebLabControlError("INVALID_REQUEST");
  }
  const object = parsed as JsonObject;
  if (Object.keys(object).some(key => !allowedKeys.includes(key))) {
    throw new WebLabControlError("INVALID_REQUEST");
  }
  return object;
}

function key(request: Request): string {
  const value = request.headers.get("idempotency-key") ?? "";
  if (!IDEMPOTENCY.test(value)) throw new WebLabControlError("INVALID_REQUEST");
  return value;
}

function instanceId(value: string): string {
  if (!UUID.test(value)) throw new WebLabControlError("RUNTIME_NOT_FOUND");
  return value;
}

/** Default-disabled factory; future route registration must opt in after deployment review. */
export function createWebLabRuntimeApiContracts(options: {
  service: WebLabControlPlaneService;
  resolveActor: ActorResolver;
  enabled?: boolean;
  gradingEnabled?: boolean;
  trustedOrigin?: string;
}) {
  const run = async (request: Request, action: (actor: AuthenticatedWebLabActor) => Promise<unknown>,
    successStatus = 200): Promise<Response> => {
    if (options.enabled !== true) return failure(new WebLabControlError("LAB_NOT_FOUND"));
    try {
      const actor = await options.resolveActor(request);
      if (!actor) throw new WebLabControlError("UNAUTHENTICATED");
      if (request.method !== "GET" && request.method !== "HEAD") {
        assertSameOriginMutation(request, options.trustedOrigin);
      }
      return response(await action(actor), successStatus);
    } catch (error) { return failure(error); }
  };
  return {
    launch: (request: Request) => run(request, async actor => {
      if (request.method !== "POST") throw new WebLabControlError("INVALID_REQUEST");
      const input = await body(request, ["savedLabId", "mode"]);
      if (typeof input.savedLabId !== "string" || !UUID.test(input.savedLabId) ||
          !["local_runner", "byo_runtime", "amniora_hosted"].includes(String(input.mode))) {
        throw new WebLabControlError("INVALID_REQUEST");
      }
      return options.service.launch(actor, { savedLabId: input.savedLabId,
        mode: input.mode as RuntimeMode, idempotencyKey: key(request) });
    }, 202),
    status: (request: Request, id: string) => run(request, async actor => {
      if (request.method !== "GET") throw new WebLabControlError("INVALID_REQUEST");
      return options.service.getRuntimeStatus(actor, instanceId(id));
    }),
    reset: (request: Request, id: string) => run(request, async actor => {
      if (request.method !== "POST") throw new WebLabControlError("INVALID_REQUEST");
      await body(request, []);
      return options.service.reset(actor, { instanceId: instanceId(id), idempotencyKey: key(request) });
    }, 202),
    destroy: (request: Request, id: string) => run(request, async actor => {
      if (request.method !== "DELETE") throw new WebLabControlError("INVALID_REQUEST");
      await body(request, []);
      return options.service.destroy(actor, { instanceId: instanceId(id), idempotencyKey: key(request) });
    }, 202),
    grade: (request: Request, id: string) => {
      if (options.gradingEnabled !== true) return Promise.resolve(
        failure(new WebLabControlError("LAB_NOT_FOUND")),
      );
      return run(request, async actor => {
        if (request.method !== "POST") throw new WebLabControlError("INVALID_REQUEST");
        await body(request, []); // A browser-supplied completed/pass field is not accepted.
        const runtimeSession = request.headers.get("x-web-lab-runtime-session") ?? "";
        if (!runtimeSession || runtimeSession.length > 2048) throw new WebLabControlError("INVALID_REQUEST");
        return options.service.grade(actor, instanceId(id), key(request), runtimeSession);
      });
    },
    exchange: (request: Request) => run(request, async actor => {
      if (request.method !== "POST") throw new WebLabControlError("INVALID_REQUEST");
      const input = await body(request, ["grant"]);
      if (typeof input.grant !== "string") throw new WebLabControlError("INVALID_REQUEST");
      return options.service.exchangeLaunchGrant(actor, input.grant);
    }),
  };
}
