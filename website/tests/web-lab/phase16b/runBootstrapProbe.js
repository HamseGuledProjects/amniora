#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Focused VM Runner bootstrap/connect probe. */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const byo = require("../phase16a2a/loadByoRunner");
const foundation = require("../phase16a2b1/runRealVmE2E");
const engineering = require("./vmEngineeringDispatcher");
const {
  BootstrapProbeFailure,
  BootstrapProbeTracker,
  createEventWait,
  failureReport,
  firstCleanupCode,
  normalizeProcessState,
} = require("./bootstrapProbeDiagnostics");

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const SSH_AUTHORIZATION_MARKER = "amniora-phase16b-product-e2e";
const ALLOWED_CYCLE_COUNTS = new Set([1, 3, 10]);
const BOOTSTRAP_STAGE_ORDER = new Map([
  ["PROCESS_ALIVE", 0],
  ["RUNNER_STARTED", 1],
  ["TRANSPORT_CONNECTING", 2],
  ["CONNECTED", 3],
]);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function requestedCycles(argv) {
  if (argv.length === 0) return 1;
  if (argv.length !== 1 || !/^--cycles=(?:1|3|10)$/.test(argv[0])) {
    throw new BootstrapProbeFailure({ cycle: 1, stage: "local_prepare", code: "PROBE_INTERNAL_ERROR" });
  }
  const cycles = Number(argv[0].slice("--cycles=".length));
  if (!ALLOWED_CYCLE_COUNTS.has(cycles)) {
    throw new BootstrapProbeFailure({ cycle: 1, stage: "local_prepare", code: "PROBE_INTERNAL_ERROR" });
  }
  return cycles;
}

function verificationConfig() {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    schemaVersion: 1,
    keys: [{
      keyId: "phase16b_bootstrap_probe_key",
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    }],
  };
}

function processDetail(state) {
  if (!state || typeof state !== "object") return {};
  return {
    ...(Number.isSafeInteger(state.pid) ? { pid: state.pid } : {}),
    ...(Number.isSafeInteger(state.ppid) ? { ppid: state.ppid } : {}),
    ...(state.processState !== undefined ? { processState: state.processState } : {}),
    executableIdentity: state.executableMatches === true ? "MATCH" :
      state.processExists === false ? "UNAVAILABLE" : "MISMATCH",
  };
}

function assertInventory(inventory, tracker) {
  if (inventory.architecture !== "aarch64" || inventory.docker_service !== "active" ||
      inventory.managed_containers !== "0" || inventory.managed_networks !== "0" ||
      inventory.test_image_present !== "no" || inventory.engineering_user_docker !== "no") {
    throw tracker.failure("INVENTORY_INVALID");
  }
}

function assertProcessIdentity(state, expected, tracker) {
  if (!state.processExists) throw tracker.failure("RUNNER_PROCESS_EXITED", processDetail(state));
  if (!state.executableMatches || state.executableBasename !== "node" ||
      state.executablePath !== `${foundation.INSTALL_ROOT}/node/bin/node`) {
    throw tracker.failure("INVALID_PID_IDENTITY", processDetail(state));
  }
  if (state.pid !== expected.pid || state.startTicks !== expected.startTicks) {
    throw tracker.failure("BOOTSTRAP_PID_CHANGED", processDetail(state));
  }
  if (state.uid !== expected.uid) {
    throw tracker.failure("INVALID_PID_IDENTITY", {
      ...processDetail(state),
      expectedUid: expected.uid,
      foundUid: state.uid,
    });
  }
  if (state.ppid !== expected.ppid || state.launcherPid !== expected.launcherPid ||
      (state.launcherPid > 0 && state.ppid !== state.launcherPid)) {
    throw tracker.failure("PROCESS_TREE_MISMATCH", processDetail(state));
  }
}

async function waitForBootstrapStage(expected, target, tracker, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let state = expected;
  const targetRank = BOOTSTRAP_STAGE_ORDER.get(target);
  while (Date.now() < deadline) {
    if (state.stage === "FAILED") {
      const code = state.exitClassification === "TRANSPORT_ERROR"
        ? "TRANSPORT_CONNECTION_FAILED"
        : "RUNNER_PROCESS_EXITED";
      throw tracker.failure(code, processDetail(state));
    }
    assertProcessIdentity(state, expected, tracker);
    const rank = BOOTSTRAP_STAGE_ORDER.get(state.stage);
    if (rank !== undefined && rank >= targetRank) return state;
    await wait(100);
    state = await engineering.bootstrapStatus();
  }
  const code = target === "RUNNER_STARTED" ? "RUNNER_STARTED_TIMEOUT" :
    target === "TRANSPORT_CONNECTING" ? "TRANSPORT_CONNECTION_FAILED" :
      "AUTHENTICATED_CONNECTION_TIMEOUT";
  throw tracker.failure(code, processDetail(state));
}

async function removeEngineeringAuthorization({ allowFailure = false } = {}) {
  const revoke = await engineering.revoke({ allowFailure: true, timeoutMs: 15_000 }).catch(() => ({ code: 1 }));
  const cleanup = await foundation.ssh(`set -eu
authorization="$HOME/.ssh/authorized_keys"
temporary="$HOME/.ssh/authorized_keys.phase16b-bootstrap-probe"
if [ -f "$authorization" ]; then
  grep -v '${SSH_AUTHORIZATION_MARKER}$' "$authorization" >"$temporary" || true
  chmod 600 "$temporary"
  mv "$temporary" "$authorization"
  if grep -q '${SSH_AUTHORIZATION_MARKER}$' "$authorization"; then exit 45; fi
fi
`, { allowFailure, timeoutMs: 15_000 });
  if (cleanup.code !== 0) {
    if (allowFailure) return false;
    throw new BootstrapProbeFailure({ cycle: 1, stage: "final_revoke", code: "FINAL_REVOKE_FAILED" });
  }
  const keyPath = process.env.AMNIORA_VM_SSH_KEY;
  const denied = await foundation.run("ssh", [
    "-i", keyPath, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=yes", "-p", "2222", "amniora@127.0.0.1", "true",
  ], { allowFailure: true, timeoutMs: 15_000 });
  if (denied.code === 0 || revoke.code !== 0) {
    if (allowFailure) return false;
    throw new BootstrapProbeFailure({ cycle: 1, stage: "final_revoke", code: "FINAL_REVOKE_FAILED" });
  }
  return true;
}

async function runCycle({ cycle, tracker, broker, temporary, runnerArchive, nodeRelease, tlsFixture, waiters }) {
  tracker.enter("preflight", cycle);
  const inventory = await engineering.preflight();
  assertInventory(inventory, tracker);

  tracker.enter("artifact_install", cycle);
  await engineering.installPreparedRunnerArtifacts(
    temporary, runnerArchive, nodeRelease, tlsFixture, verificationConfig());

  tracker.enter("runner_launch", cycle);
  let enrollment;
  try {
    enrollment = broker.issueEnrollment(OWNER_ID);
  } catch {
    throw tracker.failure("ENROLLMENT_ISSUE_FAILED");
  }
  const connectedWait = createEventWait(
    broker,
    "connected",
    value => value?.ownerId === OWNER_ID,
    { cycle, stage: "broker_connected", code: "AUTHENTICATED_CONNECTION_TIMEOUT", timeoutMs: 30_000 },
  );
  waiters.add(connectedWait);

  tracker.enter("bootstrap_ack_wait", cycle);
  const initial = await engineering.initialRunner(enrollment.token);

  tracker.enter("process_identity", cycle);
  assertProcessIdentity(initial, initial, tracker);

  tracker.enter("runner_started", cycle);
  let state = await waitForBootstrapStage(initial, "RUNNER_STARTED", tracker);

  tracker.enter("transport_connecting", cycle);
  state = await waitForBootstrapStage(state, "TRANSPORT_CONNECTING", tracker);

  tracker.enter("broker_connected", cycle);
  const connection = await connectedWait.promise;
  connectedWait.cancel();
  waiters.delete(connectedWait);
  if (!connection || connection.ownerId !== OWNER_ID) {
    throw tracker.failure("AUTHENTICATED_CONNECTION_TIMEOUT", processDetail(state));
  }
  state = await waitForBootstrapStage(state, "CONNECTED", tracker);
  if (broker.status(connection.runnerId).connected !== true) {
    throw tracker.failure("BROKER_STATUS_INVALID", processDetail(state));
  }

  tracker.enter("heartbeat", cycle);
  const heartbeatWait = createEventWait(
    broker,
    "heartbeat",
    value => value?.runnerId === connection.runnerId,
    { cycle, stage: "heartbeat", code: "HEARTBEAT_TIMEOUT", timeoutMs: 10_000 },
  );
  waiters.add(heartbeatWait);
  const heartbeat = await heartbeatWait.promise;
  heartbeatWait.cancel();
  waiters.delete(heartbeatWait);
  if (!heartbeat) throw tracker.failure("HEARTBEAT_TIMEOUT", processDetail(state));

  const counts = await engineering.managedCounts();
  if (counts.containers !== 0 || counts.networks !== 0) {
    throw tracker.failure("MANAGED_RESOURCE_RESIDUE", processDetail(state));
  }

  tracker.enter("runner_stop", cycle);
  const disconnectedWait = createEventWait(
    broker,
    "disconnected",
    value => value?.runnerId === connection.runnerId,
    { cycle, stage: "runner_stop", code: "DISCONNECT_TIMEOUT", timeoutMs: 15_000 },
  );
  waiters.add(disconnectedWait);
  await engineering.serviceStop({ timeoutMs: 15_000 });
  const disconnected = await disconnectedWait.promise;
  disconnectedWait.cancel();
  waiters.delete(disconnectedWait);
  if (!disconnected) throw tracker.failure("DISCONNECT_TIMEOUT", processDetail(state));

  tracker.enter("cycle_cleanup", cycle);
  const cleanup = await engineering.cleanup({ timeoutMs: 60_000 });
  return {
    cycle,
    pid: state.pid,
    ppid: state.ppid,
    processState: normalizeProcessState(state.processState),
    bootstrapStage: state.stage,
    authenticatedConnection: true,
    heartbeat: true,
    stopped: true,
    cleanup: cleanup.code === 0 ? "verified" : "failed",
  };
}

async function main(argv = process.argv.slice(2)) {
  const tracker = new BootstrapProbeTracker();
  const waiters = new Set();
  const cycleResults = [];
  const cleanup = {
    code: "NONE",
    engineeringAccessRemoved: false,
    localTemporaryRemoved: false,
  };
  let requested = 1;
  let primaryFailure = null;
  let temporary = null;
  let broker = null;
  let cycleCleanupComplete = true;
  try {
    requested = requestedCycles(argv);
    const sshKey = process.env.AMNIORA_VM_SSH_KEY;
    if (!sshKey || !path.isAbsolute(sshKey) || !fs.existsSync(sshKey)) {
      throw tracker.failure("SSH_KEY_UNAVAILABLE");
    }
    try {
      await foundation.freePortAvailable(foundation.BROKER_PORT);
    } catch {
      throw tracker.failure("BROKER_PORT_UNAVAILABLE");
    }
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase16b-bootstrap-"));
    let tlsFixture;
    let runnerArchive;
    let nodeRelease;
    try { tlsFixture = await foundation.generateCertificate(temporary); }
    catch { throw tracker.failure("TLS_FIXTURE_FAILED"); }
    try { runnerArchive = await foundation.buildRunner(temporary); }
    catch { throw tracker.failure("RUNNER_BUILD_FAILED"); }
    try { nodeRelease = await foundation.downloadNode(temporary); }
    catch { throw tracker.failure("NODE_DOWNLOAD_FAILED"); }

    broker = new byo.ByoRunnerBroker({
      tls: tlsFixture,
      identityStore: new byo.ByoBrokerIdentityStore(path.join(temporary, "broker-state")),
      host: "127.0.0.1",
      port: foundation.BROKER_PORT,
      heartbeatIntervalMs: 250,
      livenessTimeoutMs: 2_000,
      handshakeTimeoutMs: 5_000,
      commandTimeoutMs: 30_000,
    });
    tracker.enter("broker_listen", 1);
    const address = await broker.listen();
    if (address.host !== "127.0.0.1" || address.port !== foundation.BROKER_PORT) {
      throw tracker.failure("BROKER_LISTEN_FAILED");
    }

    for (let cycle = 1; cycle <= requested; cycle += 1) {
      cycleCleanupComplete = false;
      const result = await runCycle({
        cycle, tracker, broker, temporary, runnerArchive, nodeRelease, tlsFixture, waiters,
      });
      cycleResults.push(result);
      cycleCleanupComplete = true;
    }
  } catch (error) {
    primaryFailure = tracker.capture(error);
  } finally {
    for (const eventWait of waiters) eventWait.cancel();
    waiters.clear();
    if (broker) {
      try { await broker.close(); }
      catch {
        cleanup.code = firstCleanupCode(cleanup.code, "BROKER_CLOSE_FAILED");
        primaryFailure ||= tracker.failure("BROKER_CLOSE_FAILED");
      }
    }
    if (!cycleCleanupComplete) {
      tracker.enter("cycle_cleanup", Math.max(1, cycleResults.length + 1));
      try {
        await engineering.cleanup({ timeoutMs: 60_000 });
        cycleCleanupComplete = true;
      } catch {
        cleanup.code = firstCleanupCode(cleanup.code, "CYCLE_CLEANUP_FAILED");
        primaryFailure ||= tracker.failure("CYCLE_CLEANUP_FAILED");
      }
    }
    tracker.enter("final_revoke", Math.max(1, cycleResults.length || 1));
    try {
      cleanup.engineeringAccessRemoved = await removeEngineeringAuthorization();
      if (!cleanup.engineeringAccessRemoved) throw tracker.failure("FINAL_REVOKE_FAILED");
    } catch {
      cleanup.code = firstCleanupCode(cleanup.code, "FINAL_REVOKE_FAILED");
      primaryFailure ||= tracker.failure("FINAL_REVOKE_FAILED");
    }
    tracker.enter("local_cleanup", Math.max(1, cycleResults.length || 1));
    try {
      if (temporary) fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      cleanup.localTemporaryRemoved = !temporary || !fs.existsSync(temporary);
      if (!cleanup.localTemporaryRemoved) throw tracker.failure("LOCAL_CLEANUP_FAILED");
    } catch {
      cleanup.code = firstCleanupCode(cleanup.code, "LOCAL_CLEANUP_FAILED");
      primaryFailure ||= tracker.failure("LOCAL_CLEANUP_FAILED");
    }
  }

  if (primaryFailure) {
    process.stderr.write(`${JSON.stringify(failureReport(primaryFailure, cleanup), null, 2)}\n`);
    process.stderr.write("PHASE16B_BOOTSTRAP_PROBE_FAILED\n");
    return false;
  }
  process.stdout.write(`${JSON.stringify({
    phase: "16B Runner bootstrap probe",
    result: "PASS",
    requestedCycles: requested,
    consecutiveCycles: cycleResults.length,
    cycles: cycleResults,
    cleanup: {
      verified: cleanup.code === "NONE" && cleanup.engineeringAccessRemoved && cleanup.localTemporaryRemoved,
      code: cleanup.code,
      engineeringAccessRemoved: cleanup.engineeringAccessRemoved,
      localTemporaryRemoved: cleanup.localTemporaryRemoved,
    },
    productCampaignStarted: false,
    browserStarted: false,
    challengeRuntimeStarted: false,
  }, null, 2)}\n`);
  return true;
}

if (require.main === module) {
  main().then(success => { if (!success) process.exitCode = 1; }).catch(() => {
    process.stderr.write("PHASE16B_BOOTSTRAP_PROBE_INTERNAL_FAILURE\n");
    process.exitCode = 1;
  });
}

module.exports = {
  requestedCycles,
  assertProcessIdentity,
  waitForBootstrapStage,
  main,
};
