#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Full in-process Phase 3 lifecycle contracts. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FakeDocker } = require("./fakeDocker");
const { IMAGE_DIGEST, packageFixture, phase3 } = require("./fixtures");

async function expectGuestCode(action, code) {
  await assert.rejects(Promise.resolve().then(action), error => error?.code === code, code);
}
function mutationInput(status, key) {
  return { runtimeId: status.runtimeId, buildFingerprint: status.buildFingerprint,
    generation: status.generation, idempotencyKey: key };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase3-lifecycle-"));
  const helperState = path.join(root, "helper");
  const agentState = path.join(root, "agent");
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\amniora-phase3-${process.pid}-${path.basename(root)}`
    : path.join(root, "run", "helper.sock");
  const data = packageFixture("arm64");
  const amd = packageFixture("amd64", { pair: data.pair, keyId: data.pkg.keyId });
  const docker = new FakeDocker(IMAGE_DIGEST);
  let manager = new phase3.PrivilegedDockerRuntimeManager(data.keys, helperState, "arm64",
    docker.execute.bind(docker), async () => true);
  let server = await phase3.startRuntimeHelperServer({ manager, socketPath });
  let client = new phase3.RuntimeHelperClient(socketPath);
  let controller = await phase3.createGuestLabRuntimeController({ verificationKeys: data.keys,
    stateDirectory: agentState, helperClient: client, architecture: "arm64" });
  try {
    assert.equal((await controller.initialize()).state, "idle");
    const missingHelperCalls = [];
    const missingHelper = new phase3.PrivilegedHelperBackend({ request: async operation => {
      missingHelperCalls.push(operation);
      return { state: "idle", runtime: null, endpoint: null, ready: false, architecture: "arm64",
        resources: [], errorCode: null };
    } });
    await missingHelper.stop({ sessionId: "0".repeat(32), buildFingerprint: "0".repeat(64), generation: 1 });
    assert.deepEqual(missingHelperCalls, ["RUNTIME_STATUS"], "missing helper runtime is already stopped");
    const staleRuntime = phase3.helperIdentityForPackage("1".repeat(32), 1, data.pkg);
    const terminalHelper = new phase3.PrivilegedHelperBackend({ request: async () => ({ state: "stopped",
      runtime: staleRuntime, endpoint: null, ready: false, architecture: "arm64", resources: [], errorCode: null }) });
    await terminalHelper.stop({ sessionId: "0".repeat(32), buildFingerprint: "0".repeat(64), generation: 1 });
    const activeHelper = new phase3.PrivilegedHelperBackend({ request: async () => ({ state: "ready",
      runtime: staleRuntime, endpoint: "http://192.168.63.2:49152", ready: true, architecture: "arm64",
      resources: [{ kind: "container", role: "challenge" }], errorCode: null }) });
    await assert.rejects(activeHelper.stop({ sessionId: "0".repeat(32), buildFingerprint: "0".repeat(64), generation: 1 }),
      error => error?.code === "LOCAL_RUNTIME_NOT_FOUND", "active cross-runtime stop remains denied");
    const beforeMismatch = docker.commands.length;
    await expectGuestCode(() => controller.launch({ package: amd.pkg, idempotencyKey: "launch-amd64-only-0001" }),
      "PACKAGE_PLATFORM_UNSUPPORTED");
    assert.equal(docker.commands.length, beforeMismatch, "architecture mismatch fails before Docker");

    const [first, duplicate] = await Promise.all([
      controller.launch({ package: data.pkg, idempotencyKey: "launch-idempotency-0001" }),
      controller.launch({ package: data.pkg, idempotencyKey: "launch-idempotency-0001" }),
    ]);
    assert.equal(first.ready, true);
    assert.deepEqual(duplicate, first, "duplicate launch race converges on one runtime");
    assert.equal((await controller.status()).runtimeId, first.runtimeId);

    controller = await phase3.createGuestLabRuntimeController({ verificationKeys: data.keys,
      stateDirectory: agentState, helperClient: client, architecture: "arm64" });
    const desktopRestart = await controller.initialize();
    assert.equal(desktopRestart.ready, true, "desktop/agent process restart recovers active runtime");

    const reset = await controller.reset(mutationInput(first, "reset-idempotency-0001"));
    assert.equal(reset.ready, true);
    assert.equal(reset.generation, 2);
    await expectGuestCode(() => controller.reset(mutationInput(first, "reset-stale-generation-1")), "RUNTIME_NOT_FOUND");
    await expectGuestCode(() => controller.stop(mutationInput(first, "stop-stale-generation-01")), "RUNTIME_NOT_FOUND");

    await server.close();
    manager = new phase3.PrivilegedDockerRuntimeManager(data.keys, helperState, "arm64",
      docker.execute.bind(docker), async () => true);
    server = await phase3.startRuntimeHelperServer({ manager, socketPath });
    client = new phase3.RuntimeHelperClient(socketPath);
    controller = await phase3.createGuestLabRuntimeController({ verificationKeys: data.keys,
      stateDirectory: agentState, helperClient: client, architecture: "arm64" });
    assert.equal((await controller.initialize()).ready, true, "privileged-helper restart reconciles active runtime");

    docker.stopAllForReboot();
    await server.close();
    manager = new phase3.PrivilegedDockerRuntimeManager(data.keys, helperState, "arm64",
      docker.execute.bind(docker), async () => true);
    server = await phase3.startRuntimeHelperServer({ manager, socketPath });
    client = new phase3.RuntimeHelperClient(socketPath);
    controller = await phase3.createGuestLabRuntimeController({ verificationKeys: data.keys,
      stateDirectory: agentState, helperClient: client, architecture: "arm64" });
    const rebooted = await controller.initialize();
    assert.equal(rebooted.state, "failed");
    assert.equal(rebooted.errorCode, "LOCAL_RUNTIME_INCONSISTENT");
    assert.equal(docker.containers.size, 0);
    assert.equal(docker.networks.size, 0, "V1 reboot policy is stopped plus explicit recovery required");
    assert.equal(docker.volumes.size, 0);

    const relaunched = await controller.launch({ package: data.pkg, idempotencyKey: "launch-after-reboot-01" });
    assert.equal(relaunched.ready, true);
    const stopped = await controller.stop(mutationInput(relaunched, "stop-idempotency-0001"));
    assert.equal(stopped.state, "idle");
    assert.equal(stopped.runtimeId, relaunched.runtimeId,
      "idle status retains stopped runtime identity for idempotent Stop replay");
    assert.equal((await controller.stop(mutationInput(relaunched, "stop-idempotency-0002"))).state, "idle",
      "second stop is safe and idempotent");
    assert.equal(docker.containers.size, 0);
    assert.equal(docker.networks.size, 0);
    assert.equal(docker.volumes.size, 0);

    const second = await controller.launch({ package: data.pkg, idempotencyKey: "launch-reuse-cycle-001" });
    assert.equal(second.ready, true);
    await controller.stop(mutationInput(second, "stop-reuse-cycle-0001"));
    assert.equal(docker.containers.size, 0);
    assert.equal(docker.networks.size, 0, "second launch/stop proves deterministic reuse cleanup");
    assert.equal(docker.volumes.size, 0);
    process.stdout.write("Local-first Phase 3 lifecycle: PASS (launch/status/reset/stop, races, generation fencing, restarts, reboot fail-closed, reuse)\n");
  } finally {
    await server.close().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
