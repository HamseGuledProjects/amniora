import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const BYO_BOOTSTRAP_STATE_FILENAME = "bootstrap-state.v1";

export const BYO_BOOTSTRAP_STAGES = [
  "PROCESS_ALIVE",
  "RUNNER_STARTED",
  "TRANSPORT_CONNECTING",
  "CONNECTED",
] as const;

export type ByoBootstrapStage = (typeof BYO_BOOTSTRAP_STAGES)[number] | "FAILED";
export type ByoBootstrapExitClassification =
  | "NONE"
  | "STARTUP_ERROR"
  | "TRANSPORT_ERROR"
  | "RUNTIME_ERROR"
  | "ENROLLMENT_INVALID"
  | "ENROLLMENT_EXPIRED"
  | "ENROLLMENT_REPLAYED";

export interface ByoBootstrapState {
  schema: 1;
  stage: ByoBootstrapStage;
  pid: number;
  ppid: number;
  uid: number;
  elapsedMs: number;
  exitClassification: ByoBootstrapExitClassification;
  exitStatus: number;
}

const stageOrder = new Map<string, number>(BYO_BOOTSTRAP_STAGES.map((stage, index) => [stage, index]));
const classifications = new Set<ByoBootstrapExitClassification>([
  "NONE",
  "STARTUP_ERROR",
  "TRANSPORT_ERROR",
  "RUNTIME_ERROR",
  "ENROLLMENT_INVALID",
  "ENROLLMENT_EXPIRED",
  "ENROLLMENT_REPLAYED",
]);

function safeInteger(value: string, minimum: number): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error("invalid_bootstrap_state");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error("invalid_bootstrap_state");
  return parsed;
}

export function parseByoBootstrapState(source: string): ByoBootstrapState {
  const entries = source.trimEnd().split("\n").map(line => {
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("invalid_bootstrap_state");
    return [line.slice(0, separator), line.slice(separator + 1)] as const;
  });
  const expected = ["schema", "stage", "pid", "ppid", "uid", "elapsed_ms", "exit_classification", "exit_status"];
  if (entries.length !== expected.length || entries.some(([key], index) => key !== expected[index])) {
    throw new Error("invalid_bootstrap_state");
  }
  const values = Object.fromEntries(entries);
  const stage = values.stage as ByoBootstrapStage;
  const exitClassification = values.exit_classification as ByoBootstrapExitClassification;
  if (values.schema !== "1" || (stage !== "FAILED" && !stageOrder.has(stage)) || !classifications.has(exitClassification)) {
    throw new Error("invalid_bootstrap_state");
  }
  if ((stage === "FAILED") !== (exitClassification !== "NONE")) throw new Error("invalid_bootstrap_state");
  const exitStatus = safeInteger(values.exit_status, 0);
  if ((stage === "FAILED") !== (exitStatus !== 0)) throw new Error("invalid_bootstrap_state");
  return {
    schema: 1,
    stage,
    pid: safeInteger(values.pid, 1),
    ppid: safeInteger(values.ppid, 1),
    uid: safeInteger(values.uid, 0),
    elapsedMs: safeInteger(values.elapsed_ms, 0),
    exitClassification,
    exitStatus,
  };
}

function serialize(state: ByoBootstrapState): string {
  return [
    "schema=1",
    `stage=${state.stage}`,
    `pid=${state.pid}`,
    `ppid=${state.ppid}`,
    `uid=${state.uid}`,
    `elapsed_ms=${state.elapsedMs}`,
    `exit_classification=${state.exitClassification}`,
    `exit_status=${state.exitStatus}`,
    "",
  ].join("\n");
}

export class ByoBootstrapReporter {
  readonly #enabled: boolean;
  readonly #statePath: string;
  readonly #temporaryPath: string;
  readonly #startedAt: number;
  #stage: ByoBootstrapStage | null = null;

  constructor(stateDirectory: string, enabled: boolean, private readonly now = Date.now) {
    if (enabled && !path.isAbsolute(stateDirectory)) throw new Error("invalid_bootstrap_state_directory");
    this.#enabled = enabled;
    this.#statePath = path.join(stateDirectory, BYO_BOOTSTRAP_STATE_FILENAME);
    this.#temporaryPath = path.join(stateDirectory, `.${BYO_BOOTSTRAP_STATE_FILENAME}.${process.pid}.tmp`);
    this.#startedAt = this.now();
  }

  get stage(): ByoBootstrapStage | null { return this.#stage; }

  async report(stage: Exclude<ByoBootstrapStage, "FAILED">): Promise<void> {
    if (!this.#enabled) return;
    const previous = this.#stage === null ? -1 : stageOrder.get(this.#stage);
    const next = stageOrder.get(stage);
    if (next === undefined || previous === undefined || next !== previous + 1) {
      throw new Error("invalid_bootstrap_stage_transition");
    }
    this.#stage = stage;
    await this.#write(stage, "NONE", 0);
  }

  async fail(classification: Exclude<ByoBootstrapExitClassification, "NONE">): Promise<void> {
    if (!this.#enabled || this.#stage === "FAILED") return;
    this.#stage = "FAILED";
    await this.#write("FAILED", classification, 1);
  }

  failureClassification(error: unknown): Exclude<ByoBootstrapExitClassification, "NONE"> {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "ENROLLMENT_INVALID" || code === "ENROLLMENT_EXPIRED" || code === "ENROLLMENT_REPLAYED") return code;
    if (this.#stage === "TRANSPORT_CONNECTING") return "TRANSPORT_ERROR";
    if (this.#stage === "CONNECTED") return "RUNTIME_ERROR";
    return "STARTUP_ERROR";
  }

  async #write(
    stage: ByoBootstrapStage,
    exitClassification: ByoBootstrapExitClassification,
    exitStatus: number,
  ): Promise<void> {
    const uid = process.getuid?.();
    if (!Number.isSafeInteger(uid) || uid === undefined || uid < 0) throw new Error("bootstrap_uid_unavailable");
    const state: ByoBootstrapState = {
      schema: 1,
      stage,
      pid: process.pid,
      ppid: process.ppid,
      uid,
      elapsedMs: Math.max(0, this.now() - this.#startedAt),
      exitClassification,
      exitStatus,
    };
    await writeFile(this.#temporaryPath, serialize(state), { encoding: "utf8", mode: 0o600 });
    await rename(this.#temporaryPath, this.#statePath);
  }
}
