import "server-only";
import { MyVmProductError, MyVmProductService, type MyVmActor } from "./product-service";

type Resolver = (request: Request) => Promise<MyVmActor | null>;
const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
const STATUS = { INVALID_REQUEST: 400, LAB_NOT_FOUND: 404, RUNNER_NOT_FOUND: 404, RUNNER_OFFLINE: 503,
  RUNNER_INCOMPATIBLE: 409, RUNTIME_NOT_READY: 409, UNAVAILABLE: 503 } as const;

function fail(error: unknown, status?: number): Response {
  const code = error instanceof MyVmProductError ? error.code : "UNAVAILABLE";
  return Response.json({ data: null, error: { code } }, { status: status ?? STATUS[code], headers: HEADERS });
}
function ok(data: unknown, status = 200): Response {
  return Response.json({ data, error: null }, { status, headers: HEADERS });
}
async function json(request: Request, keys: readonly string[]): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") throw new MyVmProductError("INVALID_REQUEST");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 1024)) throw new MyVmProductError("INVALID_REQUEST");
  const raw = await request.text();
  if (raw.length > 1024) throw new MyVmProductError("INVALID_REQUEST");
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new MyVmProductError("INVALID_REQUEST"); }
  if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).some(key => !keys.includes(key))) {
    throw new MyVmProductError("INVALID_REQUEST");
  }
  return value as Record<string, unknown>;
}
function sameOrigin(request: Request, origin: string): void {
  if (request.headers.get("origin") !== origin || new URL(request.url).origin !== origin) throw new MyVmProductError("INVALID_REQUEST");
}

export function createMyVmProductApi(options: { enabled?: boolean; origin: string; resolveActor: Resolver; service: MyVmProductService }) {
  return async (request: Request, savedLabId: string): Promise<Response> => {
    if (options.enabled !== true) return fail(new MyVmProductError("LAB_NOT_FOUND"));
    try {
      const actor = await options.resolveActor(request);
      if (!actor) return fail(new MyVmProductError("INVALID_REQUEST"), 401);
      const url = new URL(request.url);
      if (request.method === "GET") {
        if (url.search || url.pathname.split("/").at(-1) !== savedLabId) throw new MyVmProductError("INVALID_REQUEST");
        return ok(await options.service.snapshot(actor, savedLabId));
      }
      if (request.method !== "POST") throw new MyVmProductError("INVALID_REQUEST");
      sameOrigin(request, options.origin);
      const input = await json(request, ["action", "runnerKey", "idempotencyKey"]);
      if (typeof input.action !== "string" || !["enroll", "launch", "reset", "stop", "disconnect", "open"].includes(input.action)) {
        throw new MyVmProductError("INVALID_REQUEST");
      }
      if (input.action === "enroll") {
        if (input.runnerKey !== undefined ||
            (input.idempotencyKey !== undefined && typeof input.idempotencyKey !== "string")) {
          throw new MyVmProductError("INVALID_REQUEST");
        }
        return ok(await options.service.enroll(actor,
          typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined), 201);
      }
      if (typeof input.runnerKey !== "string") throw new MyVmProductError("INVALID_REQUEST");
      if (input.action === "open") {
        if (input.idempotencyKey !== undefined) throw new MyVmProductError("INVALID_REQUEST");
        return ok(await options.service.open(actor, { savedLabId, runnerKey: input.runnerKey }));
      }
      if (typeof input.idempotencyKey !== "string") throw new MyVmProductError("INVALID_REQUEST");
      await options.service.mutate(actor, input.action as "launch" | "reset" | "stop" | "disconnect",
        { savedLabId, runnerKey: input.runnerKey, idempotencyKey: input.idempotencyKey });
      return ok({ accepted: true }, 202);
    } catch (error) { return fail(error); }
  };
}
