// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Phase-scoped VM engineering adapter. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const foundation = require("../phase16a2b1/runRealVmE2E");
const { dispatcherExitStatus, dispatcherFailureCode } = require("./bootstrapProbeDiagnostics");

const DISPATCHER = "/usr/local/sbin/amniora-phase16b-product-e2e";
const VERBS = new Set([
  "preflight", "install", "initial-runner", "bootstrap-status", "replay-enrollment", "service-start", "service-stop",
  "managed-counts", "inspect-runtime", "check-outbound", "cleanup", "revoke",
]);

class Phase16bDispatcherError extends Error {
  constructor(verb, code, detail = {}) {
    super(code);
    this.name = "Phase16bDispatcherError";
    this.verb = verb;
    this.code = code;
    this.detail = detail;
  }
}

function parseLaunchObservation(output) {
  if (typeof output !== "string" || !output.trim()) return {};
  let detail;
  try { detail = JSON.parse(output); } catch { return {}; }
  const keys = ["childObserved", "pid", "ppid", "uid", "processState", "executableIdentity"];
  if (!detail || typeof detail !== "object" || Array.isArray(detail) ||
      Object.keys(detail).sort().join("|") !== [...keys].sort().join("|") ||
      typeof detail.childObserved !== "boolean" || !Number.isSafeInteger(detail.pid) || detail.pid < 0 ||
      !Number.isSafeInteger(detail.ppid) || detail.ppid < 0 || !Number.isSafeInteger(detail.uid) || detail.uid < 0 ||
      !/^(R|S|D|I|T|t|W|EXITED|UNKNOWN)$/.test(detail.processState) ||
      !/^(MATCH|UNAVAILABLE)$/.test(detail.executableIdentity) ||
      (detail.childObserved ? detail.pid < 1 || detail.ppid < 1 || detail.executableIdentity !== "MATCH" :
        detail.pid !== 0 || detail.ppid !== 0 || detail.uid !== 0 || detail.processState !== "UNKNOWN" ||
          detail.executableIdentity !== "UNAVAILABLE")) return {};
  return {
    ...(detail.childObserved ? { pid: detail.pid, ppid: detail.ppid, foundUid: detail.uid } : {}),
    processState: detail.processState,
    executableIdentity: detail.executableIdentity,
  };
}

async function invoke(verb, options = {}) {
  if (!VERBS.has(verb)) throw new Error("phase16b_dispatcher_verb_not_allowed");
  try {
    return await foundation.sshCommand(`sudo -n ${DISPATCHER} ${verb}`, options);
  } catch (error) {
    const exitStatus = dispatcherExitStatus(error?.stderr);
    throw new Phase16bDispatcherError(
      verb,
      dispatcherFailureCode(error?.stderr),
      {
        ...parseLaunchObservation(error?.stdout),
        ...(exitStatus !== undefined ? { exitStatus } : {}),
      },
    );
  }
}

function parseInventory(output) {
  return Object.fromEntries(output.trim().split("\n").map(line => line.split(/=(.*)/s).slice(0, 2)));
}

async function preflight() {
  const preflight = await invoke("preflight", { timeoutMs: 20_000 });
  const inventory = parseInventory(preflight.stdout);
  if (inventory.managed_containers !== "0" || inventory.managed_networks !== "0" ||
      inventory.test_image_present !== "no" || inventory.engineering_user_docker !== "no") {
    throw new Phase16bDispatcherError("preflight", "PREFLIGHT_FAILED");
  }
  return inventory;
}

async function installPreparedRunnerArtifacts(temporary, runnerArchive, nodeRelease, tlsFixture, verificationConfig) {
  const keysPath = path.join(temporary, "verification-keys.json");
  fs.writeFileSync(keysPath, JSON.stringify(verificationConfig), { mode: 0o600 });
  await foundation.ssh(`set -eu\nmkdir -p "${foundation.GUEST_STAGE}"\n`, { timeoutMs: 10_000 });
  await Promise.all([
    foundation.scp(runnerArchive, `${foundation.GUEST_STAGE}/runner.tar.gz`),
    foundation.scp(nodeRelease.archive, `${foundation.GUEST_STAGE}/${nodeRelease.filename}`),
    foundation.scp(tlsFixture.certPath, `${foundation.GUEST_STAGE}/broker-cert.pem`),
    foundation.scp(keysPath, `${foundation.GUEST_STAGE}/verification-keys.json`),
  ]);
  await invoke("install", { timeoutMs: 60_000 });
}

async function installRunnerArtifacts(temporary, runnerArchive, nodeRelease, tlsFixture, verificationConfig) {
  const inventory = await preflight();
  await installPreparedRunnerArtifacts(temporary, runnerArchive, nodeRelease, tlsFixture, verificationConfig);
  return inventory;
}

function parseBootstrapState(output) {
  let state;
  try { state = JSON.parse(output); } catch { throw new Phase16bDispatcherError("bootstrap-status", "BOOTSTRAP_STATE_INVALID"); }
  const keys = ["stage", "pid", "ppid", "uid", "launcherPid", "childPidObserved", "elapsedMs", "exitClassification",
    "exitStatus", "processExists", "executableMatches", "executableBasename", "executablePath", "processState", "startTicks"];
  if (!state || typeof state !== "object" || Array.isArray(state) ||
      Object.keys(state).sort().join("|") !== [...keys].sort().join("|") ||
      !/^(PROCESS_ALIVE|RUNNER_STARTED|TRANSPORT_CONNECTING|CONNECTED|FAILED)$/.test(state.stage) ||
      !Number.isSafeInteger(state.pid) || state.pid < 1 || !Number.isSafeInteger(state.ppid) || state.ppid < 1 ||
      !Number.isSafeInteger(state.uid) || state.uid < 0 || !Number.isSafeInteger(state.launcherPid) || state.launcherPid < 0 ||
      state.childPidObserved !== true || !Number.isSafeInteger(state.elapsedMs) || state.elapsedMs < 0 ||
      !/^(NONE|STARTUP_ERROR|TRANSPORT_ERROR|RUNTIME_ERROR|ENROLLMENT_INVALID|ENROLLMENT_EXPIRED|ENROLLMENT_REPLAYED)$/.test(state.exitClassification) ||
      !Number.isSafeInteger(state.exitStatus) || state.exitStatus < 0 || typeof state.processExists !== "boolean" ||
      typeof state.executableMatches !== "boolean" || typeof state.executableBasename !== "string" ||
      typeof state.executablePath !== "string" || !/^(R|S|D|I|T|t|W|EXITED)$/.test(state.processState) ||
      !Number.isSafeInteger(state.startTicks) || state.startTicks < 0) {
    throw new Phase16bDispatcherError("bootstrap-status", "BOOTSTRAP_STATE_INVALID");
  }
  return state;
}

async function initialRunner(enrollmentToken) {
  assert.match(enrollmentToken, /^[A-Za-z0-9_-]{43}$/);
  const result = await invoke("initial-runner", { input: enrollmentToken, timeoutMs: 15_000 });
  const state = parseBootstrapState(result.stdout);
  if (!state.processExists) throw new Phase16bDispatcherError("initial-runner", "RUNNER_PROCESS_EXITED");
  if (!state.executableMatches || state.executableBasename !== "node" ||
      state.executablePath !== `${foundation.INSTALL_ROOT}/node/bin/node`) {
    throw new Phase16bDispatcherError("initial-runner", "INVALID_PID_IDENTITY");
  }
  if (state.stage === "FAILED") throw new Phase16bDispatcherError("initial-runner", "INITIAL_RUNNER_LAUNCH_FAILED");
  return state;
}

async function bootstrapStatus() {
  const result = await invoke("bootstrap-status", { timeoutMs: 10_000 });
  return parseBootstrapState(result.stdout);
}

async function replayEnrollment(enrollmentToken) {
  assert.match(enrollmentToken, /^[A-Za-z0-9_-]{43}$/);
  const result = await invoke("replay-enrollment", { input: enrollmentToken, timeoutMs: 30_000 });
  assert.equal(result.stdout.trim(), "denied");
}

async function managedCounts(options) {
  const result = await invoke("managed-counts", options);
  return JSON.parse(result.stdout);
}

async function inspectRuntime() {
  const result = await invoke("inspect-runtime", { timeoutMs: 30_000 });
  return JSON.parse(result.stdout);
}

async function checkOutbound() {
  const result = await invoke("check-outbound", { timeoutMs: 10_000 });
  assert.equal(result.stdout.trim(), "blocked");
}

async function cleanup(options) {
  const result = await invoke("cleanup", options);
  const status = JSON.parse(result.stdout);
  assert.deepEqual(status, {
    service: "absent",
    phasePaths: "absent",
    managedContainers: 0,
    managedNetworks: 0,
    testImage: "absent",
    runnerDockerMembership: "absent",
    engineeringUserDocker: "absent",
  });
  return { ...status, code: result.code };
}

async function assertNoLanExposure(inspection) {
  assert.equal(inspection.lanReachable, false);
  const port = Number(new URL(inspection.endpoint).port);
  const vmInfo = await foundation.run("VBoxManage", ["showvminfo", foundation.VM, "--machinereadable"]);
  const forwardingRules = vmInfo.stdout.split("\n").filter(line => /^Forwarding\(/.test(line));
  assert.equal(forwardingRules.some(line => new RegExp(`[,\"]${port}(?:,|\")`).test(line)), false);
}

module.exports = {
  DISPATCHER,
  VERBS,
  Phase16bDispatcherError,
  parseLaunchObservation,
  invoke,
  preflight,
  installPreparedRunnerArtifacts,
  installRunnerArtifacts,
  initialRunner,
  bootstrapStatus,
  replayEnrollment,
  serviceStart: options => invoke("service-start", options),
  serviceStop: options => invoke("service-stop", options),
  managedCounts,
  inspectRuntime,
  checkOutbound,
  assertNoLanExposure,
  cleanup,
  revoke: options => invoke("revoke", options),
};
