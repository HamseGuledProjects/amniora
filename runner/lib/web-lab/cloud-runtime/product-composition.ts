import "server-only";
import { resolveSupabaseWebLabActor } from "../supabase-runtime-actor";
import { createWebLabControlPlane } from "../runtime-route-composition";
import { createCloudProductApi } from "./product-api";
import { CloudProductService } from "./product-service";

const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export async function dispatchCloudProductRoute(request: Request, savedLabId: string): Promise<Response> {
  if (process.env.WEB_LAB_CLOUD_PRODUCT_ENABLED !== "true" ||
      process.env.WEB_LAB_RUNTIME_API_ENABLED !== "true") {
    return Response.json({ data: null, error: { code: "LAB_NOT_FOUND" } },
      { status: 404, headers: HEADERS });
  }
  const origin = process.env.WEB_LAB_APP_ORIGIN;
  const gatewayOrigin = process.env.WEB_LAB_HOSTED_GATEWAY_ORIGIN;
  if (!origin || !gatewayOrigin) {
    return Response.json({ data: null, error: { code: "INTERNAL_ERROR" } },
      { status: 503, headers: HEADERS });
  }
  try {
    const api = createCloudProductApi({ enabled: true, origin,
      resolveActor: resolveSupabaseWebLabActor,
      service: new CloudProductService(createWebLabControlPlane(), gatewayOrigin) });
    return api(request, savedLabId);
  } catch {
    return Response.json({ data: null, error: { code: "INTERNAL_ERROR" } },
      { status: 503, headers: HEADERS });
  }
}
