import "server-only";
import { createWebLabRuntimeApiContracts } from "./runtime-api-contracts";
import { createWebLabControlPlane } from "./runtime-route-composition";
import { resolveSupabaseWebLabActor } from "./supabase-runtime-actor";

type Operation = "launch" | "status" | "reset" | "destroy" | "grade" | "exchange";
const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export async function dispatchWebLabRuntimeRoute(
  operation: Operation, request: Request, id?: string,
): Promise<Response> {
  if (process.env.WEB_LAB_RUNTIME_API_ENABLED !== "true") {
    return Response.json({ data: null, error: { code: "LAB_NOT_FOUND" } },
      { status: 404, headers: HEADERS });
  }
  if (operation === "grade" && process.env.WEB_LAB_TRUSTED_GRADING_ENABLED !== "true") {
    return Response.json({ data: null, error: { code: "LAB_NOT_FOUND" } },
      { status: 404, headers: HEADERS });
  }
  try {
    const api = createWebLabRuntimeApiContracts({
      service: createWebLabControlPlane(),
      resolveActor: resolveSupabaseWebLabActor,
      enabled: true,
      gradingEnabled: operation === "grade",
      trustedOrigin: process.env.WEB_LAB_APP_ORIGIN,
    });
    if (operation === "launch" || operation === "exchange") return api[operation](request);
    if (!id) return Response.json({ data: null, error: { code: "RUNTIME_NOT_FOUND" } },
      { status: 404, headers: HEADERS });
    return api[operation](request, id);
  } catch {
    return Response.json({ data: null, error: { code: "INTERNAL_ERROR" } },
      { status: 503, headers: HEADERS });
  }
}
