// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
"use strict";

const PROBE_STAGES = Object.freeze([
  "local_prepare",
  "broker_listen",
  "preflight",
  "artifact_install",
  "runner_launch",
  "bootstrap_ack_wait",
  "process_identity",
  "runner_started",
  "transport_connecting",
  "broker_connected",
  "heartbeat",
  "runner_stop",
  "cycle_cleanup",
  "final_revoke",
  "local_cleanup",
]);

const PROBE_CODES = Object.freeze([
  "SSH_KEY_UNAVAILABLE",
  "BROKER_PORT_UNAVAILABLE",
  "TLS_FIXTURE_FAILED",
  "RUNNER_BUILD_FAILED",
  "NODE_DOWNLOAD_FAILED",
  "BROKER_LISTEN_FAILED",
  "PREFLIGHT_FAILED",
  "INSTALL_FAILED",
  "INVENTORY_INVALID",
  "ENROLLMENT_ISSUE_FAILED",
  "INITIAL_RUNNER_LAUNCH_FAILED",
  "BOOTSTRAP_ACK_TIMEOUT",
  "BOOTSTRAP_STATE_UNAVAILABLE",
  "BOOTSTRAP_STATE_INVALID",
  "RUNNER_PROCESS_EXITED",
  "RUNNER_NODE_NOT_OBSERVED",
  "RUNNER_LAUNCHER_EXITED_CHILD_ALIVE",
  "BOOTSTRAP_WRITE_TIMEOUT",
  "INVALID_PID_IDENTITY",
  "RUNNER_UID_MISMATCH",
  "RUNNER_EXECUTABLE_MISMATCH",
  "RUNNER_PROCESS_STAT_INVALID",
  "RUNNER_REPORTED_PPID_CHANGED",
  "PROCESS_TREE_MISMATCH",
  "BOOTSTRAP_PID_CHANGED",
  "RUNNER_STARTED_TIMEOUT",
  "TRANSPORT_CONNECTION_FAILED",
  "AUTHENTICATED_CONNECTION_TIMEOUT",
  "HEARTBEAT_TIMEOUT",
  "BROKER_STATUS_INVALID",
  "MANAGED_RESOURCE_RESIDUE",
  "RUNNER_STOP_FAILED",
  "DISCONNECT_TIMEOUT",
  "CYCLE_CLEANUP_FAILED",
  "FINAL_REVOKE_FAILED",
  "BROKER_CLOSE_FAILED",
  "LOCAL_CLEANUP_FAILED",
  "DISPATCHER_OPERATION_FAILED",
  "PROBE_INTERNAL_ERROR",
]);

const CLEANUP_CODES = new Set([
  "NONE",
  "CYCLE_CLEANUP_FAILED",
  "FINAL_REVOKE_FAILED",
  "BROKER_CLOSE_FAILED",
  "LOCAL_CLEANUP_FAILED",
]);
const stageSet = new Set(PROBE_STAGES);
const codeSet = new Set(PROBE_CODES);
const processStates = new Set(["RUNNING", "SLEEPING", "DISK_SLEEP", "IDLE", "STOPPED", "TRACING_STOP", "WAKING", "EXITED", "UNKNOWN"]);
const fallbackByStage = Object.freeze({
  local_prepare: "PROBE_INTERNAL_ERROR",
  broker_listen: "BROKER_LISTEN_FAILED",
  preflight: "PREFLIGHT_FAILED",
  artifact_install: "INSTALL_FAILED",
  runner_launch: "INITIAL_RUNNER_LAUNCH_FAILED",
  bootstrap_ack_wait: "BOOTSTRAP_ACK_TIMEOUT",
  process_identity: "INVALID_PID_IDENTITY",
  runner_started: "RUNNER_STARTED_TIMEOUT",
  transport_connecting: "TRANSPORT_CONNECTION_FAILED",
  broker_connected: "AUTHENTICATED_CONNECTION_TIMEOUT",
  heartbeat: "HEARTBEAT_TIMEOUT",
  runner_stop: "RUNNER_STOP_FAILED",
  cycle_cleanup: "CYCLE_CLEANUP_FAILED",
  final_revoke: "FINAL_REVOKE_FAILED",
  local_cleanup: "LOCAL_CLEANUP_FAILED",
});
const stageByCode = Object.freeze({
  BOOTSTRAP_ACK_TIMEOUT: "bootstrap_ack_wait",
  BOOTSTRAP_STATE_UNAVAILABLE: "bootstrap_ack_wait",
  BOOTSTRAP_STATE_INVALID: "bootstrap_ack_wait",
  RUNNER_PROCESS_EXITED: "runner_launch",
  RUNNER_NODE_NOT_OBSERVED: "runner_launch",
  RUNNER_LAUNCHER_EXITED_CHILD_ALIVE: "process_identity",
  BOOTSTRAP_WRITE_TIMEOUT: "bootstrap_ack_wait",
  INVALID_PID_IDENTITY: "process_identity",
  RUNNER_UID_MISMATCH: "process_identity",
  RUNNER_EXECUTABLE_MISMATCH: "process_identity",
  RUNNER_PROCESS_STAT_INVALID: "process_identity",
  RUNNER_REPORTED_PPID_CHANGED: "process_identity",
  PROCESS_TREE_MISMATCH: "process_identity",
  BOOTSTRAP_PID_CHANGED: "process_identity",
  RUNNER_STARTED_TIMEOUT: "runner_started",
  TRANSPORT_CONNECTION_FAILED: "transport_connecting",
  AUTHENTICATED_CONNECTION_TIMEOUT: "broker_connected",
  HEARTBEAT_TIMEOUT: "heartbeat",
  RUNNER_STOP_FAILED: "runner_stop",
  DISCONNECT_TIMEOUT: "runner_stop",
  CYCLE_CLEANUP_FAILED: "cycle_cleanup",
  FINAL_REVOKE_FAILED: "final_revoke",
  BROKER_CLOSE_FAILED: "local_cleanup",
  LOCAL_CLEANUP_FAILED: "local_cleanup",
});

function boundedElapsed(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(600_000, Math.floor(value)));
}

function normalizeProcessState(value) {
  const mapped = {
    R: "RUNNING",
    S: "SLEEPING",
    D: "DISK_SLEEP",
    I: "IDLE",
    T: "STOPPED",
    t: "TRACING_STOP",
    W: "WAKING",
    EXITED: "EXITED",
  }[value];
  return mapped || (processStates.has(value) ? value : "UNKNOWN");
}

class BootstrapProbeFailure extends Error {
  constructor({ cycle, stage, code, elapsedMs = 0, pid, ppid, processState, expectedUid, foundUid, executableIdentity, exitStatus }) {
    if (!Number.isSafeInteger(cycle) || cycle < 1 || !stageSet.has(stage) || !codeSet.has(code)) {
      throw new Error("invalid_bootstrap_probe_failure");
    }
    super(code);
    this.name = "BootstrapProbeFailure";
    this.cycle = cycle;
    this.stage = stage;
    this.code = code;
    this.elapsedMs = boundedElapsed(elapsedMs);
    if (Number.isSafeInteger(pid) && pid > 0) this.pid = pid;
    if (Number.isSafeInteger(ppid) && ppid > 0) this.ppid = ppid;
    if (processState !== undefined) this.processState = normalizeProcessState(processState);
    if (Number.isSafeInteger(expectedUid) && expectedUid >= 0) this.expectedUid = expectedUid;
    if (Number.isSafeInteger(foundUid) && foundUid >= 0) this.foundUid = foundUid;
    if (executableIdentity === "MATCH" || executableIdentity === "MISMATCH" || executableIdentity === "UNAVAILABLE") {
      this.executableIdentity = executableIdentity;
    }
    if (Number.isSafeInteger(exitStatus) && exitStatus >= 0 && exitStatus <= 255) this.exitStatus = exitStatus;
  }

  toJSON() {
    return {
      cycle: this.cycle,
      stage: this.stage,
      code: this.code,
      elapsedMs: this.elapsedMs,
      ...(this.pid ? { pid: this.pid } : {}),
      ...(this.ppid ? { ppid: this.ppid } : {}),
      ...(this.processState ? { processState: this.processState } : {}),
      ...(this.expectedUid !== undefined ? { expectedUid: this.expectedUid } : {}),
      ...(this.foundUid !== undefined ? { foundUid: this.foundUid } : {}),
      ...(this.executableIdentity ? { executableIdentity: this.executableIdentity } : {}),
      ...(this.exitStatus !== undefined ? { exitStatus: this.exitStatus } : {}),
    };
  }
}

class BootstrapProbeTracker {
  constructor(privateNow = Date.now) {
    this.now = privateNow;
    this.cycle = 1;
    this.stage = "local_prepare";
    this.startedAt = this.now();
  }

  enter(stage, cycle = this.cycle) {
    if (!stageSet.has(stage) || !Number.isSafeInteger(cycle) || cycle < 1) throw new Error("invalid_bootstrap_probe_stage");
    this.cycle = cycle;
    this.stage = stage;
    this.startedAt = this.now();
  }

  failure(code = fallbackByStage[this.stage], detail = {}) {
    return new BootstrapProbeFailure({
      cycle: this.cycle,
      stage: stageByCode[code] || this.stage,
      code: codeSet.has(code) ? code : fallbackByStage[this.stage],
      elapsedMs: this.now() - this.startedAt,
      ...detail,
    });
  }

  capture(error) {
    if (error instanceof BootstrapProbeFailure) return error;
    const code = typeof error === "object" && error !== null && codeSet.has(error.code) ? error.code : fallbackByStage[this.stage];
    const detail = typeof error === "object" && error !== null && error.detail && typeof error.detail === "object"
      ? error.detail
      : {};
    return this.failure(code, detail);
  }
}

function dispatcherFailureCode(stderr) {
  if (typeof stderr !== "string") return "DISPATCHER_OPERATION_FAILED";
  const lines = stderr.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) return "DISPATCHER_OPERATION_FAILED";
  const match = /^phase16b_dispatcher_error:([A-Za-z0-9_]+)$/.exec(lines[0]);
  if (!match) return "DISPATCHER_OPERATION_FAILED";
  const value = match[1];
  if (value === "initial_runner_ack_timeout") return "BOOTSTRAP_ACK_TIMEOUT";
  if (value === "initial_runner_ack_timeout_after_node_observed") return "BOOTSTRAP_WRITE_TIMEOUT";
  if (value === "initial_runner_ack_timeout_before_node_observed") return "BOOTSTRAP_ACK_TIMEOUT";
  if (/^initial_runner_launcher_exited_status_[0-9]+_child_alive$/.test(value)) {
    return "RUNNER_LAUNCHER_EXITED_CHILD_ALIVE";
  }
  if (/^initial_runner_launcher_exited_status_[0-9]+_after_node_observed$/.test(value)) {
    return "RUNNER_PROCESS_EXITED";
  }
  if (/^initial_runner_launcher_exited_status_[0-9]+_before_node_observed$/.test(value)) {
    return "RUNNER_NODE_NOT_OBSERVED";
  }
  if (/^initial_runner_exited_(?:status_[0-9]+|after_(?:PROCESS_ALIVE|RUNNER_STARTED|TRANSPORT_CONNECTING|CONNECTED))$/.test(value)) {
    return "RUNNER_PROCESS_EXITED";
  }
  if (value === "initial_runner_identity_invalid" || value === "initial_runner_identity_mismatch" ||
      value === "bootstrap_identity_mismatch" ||
      /^bootstrap_identity_invalid_(?:UID|EXECUTABLE|STAT)$/.test(value) || value === "bootstrap_identity_changed" ||
      value === "invalid_launcher_pid") return "INVALID_PID_IDENTITY";
  if (value === "initial_runner_identity_invalid_UID" || value === "initial_runner_reported_uid_mismatch") {
    return "RUNNER_UID_MISMATCH";
  }
  if (value === "initial_runner_identity_invalid_EXECUTABLE") return "RUNNER_EXECUTABLE_MISMATCH";
  if (value === "initial_runner_identity_invalid_STAT") return "RUNNER_PROCESS_STAT_INVALID";
  if (value === "initial_runner_reported_ppid_changed") return "RUNNER_REPORTED_PPID_CHANGED";
  if (value === "initial_runner_process_tree_mismatch") return "PROCESS_TREE_MISMATCH";
  if (value === "bootstrap_state_unavailable") return "BOOTSTRAP_STATE_UNAVAILABLE";
  if (/^invalid_bootstrap_(?:state|state_path|state_owner|state_mode|state_key|stage|state_value|exit_classification|failure|success)$/.test(value)) {
    return "BOOTSTRAP_STATE_INVALID";
  }
  if (value === "initial_runner_failed_TRANSPORT_ERROR") return "TRANSPORT_CONNECTION_FAILED";
  if (/^initial_runner_failed_/.test(value)) return "INITIAL_RUNNER_LAUNCH_FAILED";
  if (value === "runner_node_execution_failed" || value === "runner_module_load_failed") return "INSTALL_FAILED";
  return "DISPATCHER_OPERATION_FAILED";
}

function dispatcherExitStatus(stderr) {
  if (typeof stderr !== "string") return undefined;
  const lines = stderr.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) return undefined;
  const match = /^phase16b_dispatcher_error:initial_runner_launcher_exited_status_([0-9]+)_(?:child_alive|after_node_observed|before_node_observed)$/.exec(lines[0]);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 && value <= 255 ? value : undefined;
}

function createEventWait(emitter, event, predicate = () => true, { cycle, stage, code, timeoutMs, now = Date.now } = {}) {
  const startedAt = now();
  let settled = false;
  let receive;
  let resolveWait;
  let timer;
  const promise = new Promise((resolve, reject) => {
    resolveWait = resolve;
    receive = value => {
      if (settled || !predicate(value)) return;
      settled = true;
      clearTimeout(timer);
      emitter.off(event, receive);
      resolve(value);
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      emitter.off(event, receive);
      reject(new BootstrapProbeFailure({ cycle, stage, code, elapsedMs: now() - startedAt }));
    }, timeoutMs);
    emitter.on(event, receive);
  });
  void promise.catch(() => undefined);
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      emitter.off(event, receive);
      resolveWait(undefined);
    },
  };
}

function firstCleanupCode(current, candidate) {
  if (!CLEANUP_CODES.has(candidate) || candidate === "NONE") throw new Error("invalid_bootstrap_cleanup_code");
  return current === "NONE" ? candidate : current;
}

function failureReport(primaryFailure, cleanup) {
  if (!(primaryFailure instanceof BootstrapProbeFailure)) throw new Error("invalid_bootstrap_primary_failure");
  if (!CLEANUP_CODES.has(cleanup.code)) throw new Error("invalid_bootstrap_cleanup_report");
  return {
    phase: "16B Runner bootstrap probe",
    result: "FAIL",
    primaryFailure: primaryFailure.toJSON(),
    cleanup: {
      verified: cleanup.code === "NONE" && cleanup.engineeringAccessRemoved && cleanup.localTemporaryRemoved,
      code: cleanup.code,
      engineeringAccessRemoved: Boolean(cleanup.engineeringAccessRemoved),
      localTemporaryRemoved: Boolean(cleanup.localTemporaryRemoved),
    },
  };
}

module.exports = {
  PROBE_STAGES,
  PROBE_CODES,
  BootstrapProbeFailure,
  BootstrapProbeTracker,
  dispatcherFailureCode,
  dispatcherExitStatus,
  createEventWait,
  firstCleanupCode,
  failureReport,
  normalizeProcessState,
};
