/** Fail-closed server composition for the production runtime control API. */
import "server-only";
import postgres from "postgres";
import { PostgresWebLabControlRepository } from "./postgres-control-repository";
import {
  WebLabControlPlaneService,
  type RuntimeBackendRegistration,
  type WebLabCompatibilityPolicy,
  type WebLabEntitlementPolicy,
  type WebLabRatePolicy,
  type WebLabTrustedGrader,
} from "./production-control-service";
import { WebLabReconciliationAdapter, type WebLabAlertSink,
  type WebLabReconciliationScheduler } from "./production-security-controls";

export type WebLabProductionAdapters = Readonly<{
  entitlement: WebLabEntitlementPolicy;
  ratePolicy: WebLabRatePolicy;
  compatibility: WebLabCompatibilityPolicy;
  grader: WebLabTrustedGrader;
  backends: readonly RuntimeBackendRegistration[];
  alerts: WebLabAlertSink;
  reconciliation: WebLabReconciliationScheduler;
}>;

let adapters: WebLabProductionAdapters | null = null;
let service: WebLabControlPlaneService | null = null;

/** Provider bootstrap must register every reviewed production dependency. */
export function registerWebLabProductionAdapters(value: WebLabProductionAdapters): void {
  const hosted = Array.isArray(value?.backends)
    ? value.backends.filter(item => item.mode === "amniora_hosted") : [];
  if (value?.entitlement?.production !== true || value?.ratePolicy?.production !== true ||
      value?.grader?.production !== true || value?.alerts?.production !== true ||
      typeof value.entitlement.planFor !== "function" || typeof value.ratePolicy.assertAllowed !== "function" ||
      typeof value.grader.grade !== "function" || typeof value.alerts.notify !== "function" ||
      value?.reconciliation?.production !== true || typeof value.reconciliation.register !== "function" ||
      typeof value.compatibility?.verdict !== "function" || hosted.length !== 1 ||
      hosted[0].production !== true ||
      !["create", "status", "reset", "destroy", "inspect", "listManaged", "destroyManaged"]
        .every(method => typeof (hosted[0].backend as unknown as Record<string, unknown>)[method] === "function")) {
    throw new Error("web_lab_production_adapters_invalid");
  }
  adapters = value;
  service = null;
}

export function createWebLabControlPlane(): WebLabControlPlaneService {
  if (service) return service;
  if (!adapters) throw new Error("web_lab_control_unconfigured");
  const connection = process.env.WEB_LAB_CONTROL_DATABASE_URL;
  const signingKey = process.env.WEB_LAB_LAUNCH_SIGNING_KEY;
  if (!connection || !signingKey || Buffer.byteLength(signingKey) < 32 ||
      !process.env.WEB_LAB_APP_ORIGIN) throw new Error("web_lab_control_unconfigured");
  const db = postgres(connection, { max: 10, prepare: false, connect_timeout: 5, idle_timeout: 20,
    connection: { statement_timeout: 5000 } });
  service = new WebLabControlPlaneService({
    repository: new PostgresWebLabControlRepository(db),
    entitlement: adapters.entitlement,
    ratePolicy: adapters.ratePolicy,
    compatibility: adapters.compatibility,
    grader: adapters.grader,
    backends: adapters.backends,
    alerts: adapters.alerts,
    signingKey: Buffer.from(signingKey),
  });
  return service;
}

/** Trusted scheduler entrypoint; provider scheduling must invoke it explicitly. */
export function createWebLabReconciliationAdapter(): WebLabReconciliationAdapter {
  if (!adapters || adapters.alerts.production !== true) throw new Error("web_lab_reconciliation_unconfigured");
  return new WebLabReconciliationAdapter(createWebLabControlPlane(), adapters.alerts);
}

/** Bootstrap calls this only after its provider scheduler has been configured. */
export function registerWebLabReconciliationSchedule(): void {
  if (!adapters || adapters.reconciliation.production !== true) {
    throw new Error("web_lab_reconciliation_unconfigured");
  }
  const reconciler = createWebLabReconciliationAdapter();
  adapters.reconciliation.register(olderThan => reconciler.run(olderThan));
}
