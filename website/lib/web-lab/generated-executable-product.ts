import "server-only";
import {
  saveExecutableWebGeneration,
  type ExecutableGenerationStageReporter,
} from "./generated-executable-lab";
import { PostgresExecutableWebSaveStore } from "./generated-executable-postgres";
import type { WebLabAlertSink } from "./production-security-controls";

let store: PostgresExecutableWebSaveStore | null = null;
let alerts: WebLabAlertSink | null = null;

/** Bootstrap registers a reviewed least-privileged store and production alert path. */
export function registerExecutableWebGenerationProductionControls(value: Readonly<{
  store: PostgresExecutableWebSaveStore; alerts: WebLabAlertSink;
}>): void {
  if (value.store.production !== true || value.alerts.production !== true) {
    throw new Error("executable_web_generation_controls_invalid");
  }
  store = value.store;
  alerts = value.alerts;
}

/** Default off; the control-plane migration and public.labs shape need a rollout rehearsal. */
export function executableWebGenerationEnabled(): boolean {
  return process.env.WEB_LAB_DETERMINISTIC_GENERATION_ENABLED === "true" &&
    store !== null && alerts !== null;
}

export async function saveGeneratedExecutableWebLab(
  jobId: string,
  ownerId: string,
  advanceStage?: ExecutableGenerationStageReporter,
) {
  if (!executableWebGenerationEnabled()) throw new Error("EXECUTABLE_WEB_GENERATION_DISABLED");
  if (!store || !alerts) throw new Error("EXECUTABLE_WEB_GENERATION_DISABLED");
  try {
    return await saveExecutableWebGeneration(store, jobId, ownerId, advanceStage);
  } catch (error) {
    try { await alerts.notify({ code: "GENERATION_FAILED", stage: "generation" }); }
    catch { /* The generation operation remains failed. */ }
    throw error;
  }
}
