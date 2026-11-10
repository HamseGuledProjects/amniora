import "server-only";
import { resolveSupabaseWebLabActor } from "../supabase-runtime-actor";
import { createMyVmProductApi } from "./product-api";
import { MyVmProductError, MyVmProductService, type MyVmProductBackend } from "./product-service";
import type { MyVmInstallerRelease } from "./installer-release";
import type { DistributedAbusePolicy, WebLabAlertSink } from "../production-security-controls";

let backend: MyVmProductBackend | null = null;
let installerRelease: MyVmInstallerRelease | null = null;
let security: Readonly<{ abusePolicy: DistributedAbusePolicy; alerts: WebLabAlertSink }> | null = null;
/** Broker bootstrap registers the proven Phase 16A adapter here; React never receives it. */
export function registerMyVmProductBackend(value: MyVmProductBackend): void {
  if (value.production !== true ||
      !["eligibility", "list", "issueEnrollment", "launch", "reset", "stop", "disconnect", "open"]
        .every(method => typeof (value as unknown as Record<string, unknown>)[method] === "function")) {
    throw new Error("my_vm_production_backend_invalid");
  }
  backend = value;
}
/** Release bootstrap registers one reviewed immutable installer; browser input can never select its host or path. */
export function registerMyVmInstallerRelease(value: MyVmInstallerRelease): void { installerRelease = value; }
/** Provider-backed controls are mandatory before the product flag can serve enrollment. */
export function registerMyVmProductionSecurityControls(value: Readonly<{
  abusePolicy: DistributedAbusePolicy; alerts: WebLabAlertSink;
}>): void {
  if (value.abusePolicy.production !== true || value.alerts.production !== true) {
    throw new Error("my_vm_production_security_invalid");
  }
  security = value;
}

export async function dispatchMyVmProductRoute(request: Request, savedLabId: string): Promise<Response> {
  const origin = process.env.WEB_LAB_APP_ORIGIN;
  const endpoint = process.env.WEB_LAB_BYO_RUNNER_ENDPOINT;
  const gatewayOrigin = process.env.WEB_LAB_BYO_GATEWAY_ORIGIN;
  if (process.env.WEB_LAB_MY_VM_ENABLED !== "true") {
    return Response.json({ data: null, error: { code: "LAB_NOT_FOUND" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (!backend || !installerRelease || !security || !origin || !endpoint || !gatewayOrigin) {
    return Response.json({ data: null, error: { code: "UNAVAILABLE" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return createMyVmProductApi({ enabled: true, origin, resolveActor: resolveSupabaseWebLabActor,
      service: new MyVmProductService(backend, endpoint, gatewayOrigin, installerRelease, security) })(request, savedLabId);
  } catch {
    return Response.json({ data: null, error: { code: new MyVmProductError("UNAVAILABLE").code } },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
