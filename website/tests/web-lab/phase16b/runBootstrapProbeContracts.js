#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated bootstrap-probe diagnostic contracts. */
"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const {
  PROBE_STAGES,
  BootstrapProbeFailure,
  BootstrapProbeTracker,
  createEventWait,
  dispatcherExitStatus,
  dispatcherFailureCode,
  failureReport,
  firstCleanupCode,
} = require("./bootstrapProbeDiagnostics");
const { parseLaunchObservation } = require("./vmEngineeringDispatcher");

const PROBE = path.join(__dirname, "runBootstrapProbe.js");
let contractStage = "stage_inventory";

async function main() {
  const requiredStages = [
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
  ];
  assert.deepEqual(PROBE_STAGES.filter(stage => requiredStages.includes(stage)), requiredStages);

  contractStage = "failure_retention";
  let now = 100;
  const tracker = new BootstrapProbeTracker(() => now);
  tracker.enter("bootstrap_ack_wait", 1);
  now = 235;
  const primary = tracker.failure("BOOTSTRAP_ACK_TIMEOUT");
  assert.deepEqual(primary.toJSON(), {
    cycle: 1,
    stage: "bootstrap_ack_wait",
    code: "BOOTSTRAP_ACK_TIMEOUT",
    elapsedMs: 135,
  });
  const cleanupCode = firstCleanupCode("NONE", "CYCLE_CLEANUP_FAILED");
  assert.equal(firstCleanupCode(cleanupCode, "FINAL_REVOKE_FAILED"), "CYCLE_CLEANUP_FAILED");
  const report = failureReport(primary, {
    code: cleanupCode,
    engineeringAccessRemoved: true,
    localTemporaryRemoved: true,
  });
  assert.deepEqual(report.primaryFailure, primary.toJSON(), "cleanup must not replace the first failure");
  assert.deepEqual(report.cleanup, {
    verified: false,
    code: "CYCLE_CLEANUP_FAILED",
    engineeringAccessRemoved: true,
    localTemporaryRemoved: true,
  });

  contractStage = "dispatcher_mapping";
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_ack_timeout\n"), "BOOTSTRAP_ACK_TIMEOUT");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_identity_invalid\n"), "INVALID_PID_IDENTITY");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_identity_invalid_UID\n"), "RUNNER_UID_MISMATCH");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_identity_invalid_EXECUTABLE\n"), "RUNNER_EXECUTABLE_MISMATCH");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_identity_invalid_STAT\n"), "RUNNER_PROCESS_STAT_INVALID");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_reported_ppid_changed\n"), "RUNNER_REPORTED_PPID_CHANGED");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_process_tree_mismatch\n"), "PROCESS_TREE_MISMATCH");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_exited_status_1\n"), "RUNNER_PROCESS_EXITED");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_launcher_exited_status_1_before_node_observed\n"), "RUNNER_NODE_NOT_OBSERVED");
  assert.equal(dispatcherExitStatus("phase16b_dispatcher_error:initial_runner_launcher_exited_status_1_before_node_observed\n"), 1);
  assert.equal(dispatcherExitStatus("phase16b_dispatcher_error:initial_runner_ack_timeout\n"), undefined);
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_launcher_exited_status_1_after_node_observed\n"), "RUNNER_PROCESS_EXITED");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_launcher_exited_status_0_child_alive\n"), "RUNNER_LAUNCHER_EXITED_CHILD_ALIVE");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_ack_timeout_after_node_observed\n"), "BOOTSTRAP_WRITE_TIMEOUT");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:initial_runner_failed_TRANSPORT_ERROR\n"), "TRANSPORT_CONNECTION_FAILED");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:runner_node_execution_failed\n"), "INSTALL_FAILED");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:runner_module_load_failed\n"), "INSTALL_FAILED");
  assert.equal(dispatcherFailureCode("phase16b_dispatcher_error:invalid_bootstrap_state_mode\n"), "BOOTSTRAP_STATE_INVALID");
  assert.equal(dispatcherFailureCode("arbitrary failure text\n"), "DISPATCHER_OPERATION_FAILED");
  assert.equal(dispatcherFailureCode("prefix\nphase16b_dispatcher_error:initial_runner_ack_timeout\n"), "DISPATCHER_OPERATION_FAILED");
  assert.deepEqual(parseLaunchObservation('{"childObserved":true,"pid":42,"ppid":41,"uid":997,"processState":"S","executableIdentity":"MATCH"}\n'), {
    pid: 42,
    ppid: 41,
    foundUid: 997,
    processState: "S",
    executableIdentity: "MATCH",
  });
  assert.deepEqual(parseLaunchObservation('{"childObserved":false,"pid":0,"ppid":0,"uid":0,"processState":"UNKNOWN","executableIdentity":"UNAVAILABLE"}\n'), {
    processState: "UNKNOWN",
    executableIdentity: "UNAVAILABLE",
  });
  assert.deepEqual(parseLaunchObservation('{"childObserved":true,"pid":42,"token":"forbidden"}'), {});

  contractStage = "wait_timeout";
  const emitter = new EventEmitter();
  const timed = createEventWait(
    emitter,
    "connected",
    () => true,
    { cycle: 2, stage: "broker_connected", code: "AUTHENTICATED_CONNECTION_TIMEOUT", timeoutMs: 5 },
  );
  await assert.rejects(timed.promise, error =>
    error instanceof BootstrapProbeFailure &&
    error.cycle === 2 &&
    error.stage === "broker_connected" &&
    error.code === "AUTHENTICATED_CONNECTION_TIMEOUT");
  assert.equal(emitter.listenerCount("connected"), 0);

  contractStage = "wait_cancellation";
  const cancelled = createEventWait(
    emitter,
    "heartbeat",
    () => true,
    { cycle: 2, stage: "heartbeat", code: "HEARTBEAT_TIMEOUT", timeoutMs: 10_000 },
  );
  cancelled.cancel();
  assert.equal(await cancelled.promise, undefined);
  assert.equal(emitter.listenerCount("heartbeat"), 0);

  contractStage = "safe_capture";
  tracker.enter("heartbeat", 3);
  const arbitrary = tracker.capture(new Error("credential=value connection-string=forbidden"));
  assert.deepEqual(arbitrary.toJSON(), {
    cycle: 3,
    stage: "heartbeat",
    code: "HEARTBEAT_TIMEOUT",
    elapsedMs: 0,
  });
  assert.doesNotMatch(JSON.stringify(failureReport(arbitrary, {
    code: "NONE",
    engineeringAccessRemoved: true,
    localTemporaryRemoved: true,
  })), /credential|connection-string|forbidden|value/);

  contractStage = "static_probe";
  const probe = fs.readFileSync(PROBE, "utf8");
  assert.ok(probe.indexOf("await broker.listen()") < probe.indexOf("for (let cycle = 1; cycle <= requested"));
  assert.match(probe, /if \(argv\.length === 0\) return 1/);
  assert.match(probe, /new Set\(\[1, 3, 10\]\)/);
  assert.match(probe, /for \(const eventWait of waiters\) eventWait\.cancel\(\)/);
  assert.doesNotMatch(probe, /console\.(?:log|error)\([^)]*(?:token|process\.env)|stderr\.write\([^)]*error/);

  console.log("Phase 16B bootstrap probe contracts: PASS (fixed stages, first-failure retention, cancellable waits, secret-safe reports)");
}

main().catch(() => {
  process.stderr.write(`PHASE16B_BOOTSTRAP_PROBE_CONTRACTS_FAILED_${contractStage}\n`);
  process.exitCode = 1;
});
