/** Production bootstrap for shared Phase 9 controls. Product gates remain independently OFF. */
import "server-only";
import postgres from "postgres";
import { PostgresExecutableWebSaveStore } from "./generated-executable-postgres";
import { registerExecutableWebGenerationProductionControls } from "./generated-executable-product";
import { registerLocalRunnerProductionSecurityControls } from "./local-runner-product-composition";
import { registerMyVmProductionSecurityControls } from "./byo-runner/product-composition";
import { SentryWebLabAlertSink } from "./production-alerts";
import {
  DistributedWebLabRatePolicy,
  EARLY_ACCESS_PRODUCTION_RATE_RULES,
  PostgresDistributedAbusePolicy,
  PostgresProfileEntitlementPolicy,
  type WebLabAlertSink,
} from "./production-security-controls";

type Sql = ReturnType<typeof postgres>;

export type Phase9SharedProductionAdapters = Readonly<{
  abusePolicy: PostgresDistributedAbusePolicy;
  ratePolicy: DistributedWebLabRatePolicy;
  entitlement: PostgresProfileEntitlementPolicy;
  executableStore: PostgresExecutableWebSaveStore;
  alerts: WebLabAlertSink;
}>;

export function createPhase9SharedProductionAdapters(
  db: Sql,
  alerts: WebLabAlertSink,
): Phase9SharedProductionAdapters {
  if (!db || alerts.production !== true) {
    throw new Error("web_lab_shared_production_adapters_invalid");
  }
  const abusePolicy = new PostgresDistributedAbusePolicy(
    db,
    EARLY_ACCESS_PRODUCTION_RATE_RULES,
  );
  return {
    abusePolicy,
    ratePolicy: new DistributedWebLabRatePolicy(abusePolicy),
    entitlement: new PostgresProfileEntitlementPolicy(db),
    executableStore: new PostgresExecutableWebSaveStore(db),
    alerts,
  };
}

let configured = false;

/**
 * Registers only dependencies that are complete today. Missing provider
 * configuration leaves the affected runtime products unavailable and never
 * prevents the normal site from starting.
 */
export function configureAvailablePhase9ProductionAdapters(): boolean {
  if (configured) return true;
  if (process.env.NODE_ENV !== "production") return false;
  const connection = process.env.WEB_LAB_CONTROL_DATABASE_URL;
  if (!connection || !process.env.NEXT_PUBLIC_SENTRY_DSN) return false;
  try {
    const db = postgres(connection, {
      // One application connection per warm serverless instance. Supavisor
      // transaction mode provides the shared production pool.
      max: 1,
      prepare: false,
      connect_timeout: 5,
      idle_timeout: 20,
      connection: { statement_timeout: 5_000 },
    });
    const adapters = createPhase9SharedProductionAdapters(
      db,
      new SentryWebLabAlertSink(),
    );
    registerExecutableWebGenerationProductionControls({
      store: adapters.executableStore,
      alerts: adapters.alerts,
    });
    registerLocalRunnerProductionSecurityControls({
      abusePolicy: adapters.abusePolicy,
      alerts: adapters.alerts,
    });
    registerMyVmProductionSecurityControls({
      abusePolicy: adapters.abusePolicy,
      alerts: adapters.alerts,
    });
    configured = true;
    return true;
  } catch {
    return false;
  }
}
