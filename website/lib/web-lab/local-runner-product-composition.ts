import "server-only";
import { createPrivateKey } from "node:crypto";
import postgres from "postgres";
import { PostgresWebLabControlRepository } from "./postgres-control-repository";
import { resolveSupabaseWebLabActor } from "./supabase-runtime-actor";
import { createLocalRunnerProductApi } from "./local-runner-product-api";
import { LocalRunnerProductError, LocalRunnerProductService } from "./local-runner-product-service";
import { validOpaqueId } from "./local-runner/protocol";
import type { DistributedAbusePolicy, WebLabAlertSink } from "./production-security-controls";

let service: LocalRunnerProductService | null = null;
let security: Readonly<{ abusePolicy: DistributedAbusePolicy; alerts: WebLabAlertSink }> | null = null;

/** Register reviewed provider-backed controls before enabling the product flag. */
export function registerLocalRunnerProductionSecurityControls(value: Readonly<{
  abusePolicy: DistributedAbusePolicy; alerts: WebLabAlertSink;
}>): void {
  if (value.abusePolicy.production !== true || value.alerts.production !== true) {
    throw new Error("local_runner_production_security_invalid");
  }
  security = value;
  service = null;
}

function productService(): LocalRunnerProductService {
  if (service) return service;
  if (!security) throw new LocalRunnerProductError("LOCAL_RUNNER_UNAVAILABLE");
  const connection = process.env.WEB_LAB_CONTROL_DATABASE_URL;
  if (!connection) throw new LocalRunnerProductError("LOCAL_RUNNER_UNAVAILABLE");
  // Existing private build repository only; no hosted backend, provisioning, or schema mutation.
  const db = postgres(connection, { max: 3, prepare: false, connect_timeout: 5, idle_timeout: 20,
    connection: { statement_timeout: 5000 } });
  service = new LocalRunnerProductService({
    repository: new PostgresWebLabControlRepository(db),
    abusePolicy: security.abusePolicy,
    alerts: security.alerts,
    signingAuthority() {
      const keyId = process.env.WEB_LAB_LOCAL_RUNNER_SIGNING_KEY_ID;
      const value = process.env.WEB_LAB_LOCAL_RUNNER_SIGNING_PRIVATE_KEY;
      if (!validOpaqueId(keyId, 64) || !value) throw new LocalRunnerProductError("LOCAL_RUNNER_UNAVAILABLE");
      try {
        const privateKey = createPrivateKey(value);
        if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("unsupported_signing_key");
        return { keyId, privateKey };
      } catch { throw new LocalRunnerProductError("LOCAL_RUNNER_UNAVAILABLE"); }
    },
  });
  return service;
}

export async function dispatchLocalRunnerProductRoute(
  operation: "eligibility" | "package", request: Request, savedLabId: string,
): Promise<Response> {
  return createLocalRunnerProductApi({
    enabled: process.env.WEB_LAB_LOCAL_RUNNER_ENABLED === "true",
    trustedOrigin: process.env.WEB_LAB_APP_ORIGIN,
    resolveActor: resolveSupabaseWebLabActor,
    service: productService,
  })(operation, request, savedLabId);
}
