#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated privileged-helper contracts. */
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { FakeDocker } = require("./fakeDocker");
const { IMAGE_DIGEST, packageFixture, phase3 } = require("./fixtures");

function helperRequest(operation, input, overrides = {}) {
  return { type: "HELPER_REQUEST", protocolVersion: "1.0",
    requestId: `hrq_${crypto.randomBytes(32).toString("base64url")}`, operation, input, ...overrides };
}
async function expectCode(action, code) {
  await assert.rejects(Promise.resolve().then(action), error => error?.code === code, code);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase3-helper-"));
  try {
    const data = packageFixture();
    const docker = new FakeDocker(IMAGE_DIGEST);
    docker.addUnrelated();
    docker.addFakeManaged();
    const manager = new phase3.PrivilegedDockerRuntimeManager(data.keys, root, "arm64",
      docker.execute.bind(docker), async () => true);
    const runtime = phase3.helperIdentityForPackage("1".repeat(32), 1, data.pkg);

    const unauthorized = await phase3.dispatchRuntimeHelperRequest(manager,
      helperRequest("RUNTIME_STATUS", { runtime: null }), false);
    assert.equal(unauthorized.errorCode, "HELPER_UNAUTHORIZED");
    await expectCode(() => phase3.dispatchRuntimeHelperRequest(manager,
      helperRequest("RUNTIME_STATUS", { runtime: null }, { protocolVersion: "0.9" }), true), "HELPER_PROTOCOL_UNSUPPORTED");
    await expectCode(() => phase3.dispatchRuntimeHelperRequest(manager,
      helperRequest("EXEC", { command: "docker run --privileged" }), true), "HELPER_OPERATION_UNSUPPORTED");
    await expectCode(() => phase3.dispatchRuntimeHelperRequest(manager,
      helperRequest("LAUNCH_RUNTIME", { runtime, package: data.pkg, dockerArgs: ["--privileged"] }), true), "HELPER_MESSAGE_INVALID");

    const previousUmask = process.umask(0o077);
    let launched;
    try {
      assert.equal((await manager.prepare(data.pkg, runtime)).state, "prepared");
      launched = await manager.launch(data.pkg, runtime);
    } finally { process.umask(previousUmask); }
    assert.equal(launched.ready, true);
    assert.equal(launched.resources.length, 4);
    assert.equal((await manager.launch(data.pkg, runtime)).ready, true, "duplicate helper launch is idempotent");

    const createCommands = docker.commands.filter(args => args[0] === "create");
    assert.equal(createCommands.length, 3);
    const serialized = JSON.stringify(createCommands);
    for (const forbidden of ["--privileged", "/var/run/docker.sock", "--network=host", "--cap-add", "--pid=host", "--ipc=host", "type=bind"])
      assert.equal(serialized.includes(forbidden), false, forbidden);
    assert.ok(createCommands.every(command => command.includes("--read-only") && command.includes("--cap-drop") &&
      command.includes("ALL") && command.includes("no-new-privileges:true") && command.includes("--pids-limit") &&
      command.includes("--memory") && command.includes("--cpus")));
    assert.ok(docker.commands.some(args => args[0] === "network" && args[1] === "create" && args.includes("--internal")));
    assert.ok(docker.commands.some(args => args[0] === "cp"), "bundle is copied into the stopped container instead of host-mounted");
    assert.ok(docker.copiedBundleModes.length > 0 && docker.copiedBundleModes.every(mode => mode === 0o444),
      "bundle remains readable by the unprivileged container under the helper's strict umask");
    assert.ok(docker.commands.some(args => args[0] === "volume" && args[1] === "create"),
      "Docker-managed bundle volume avoids a host filesystem mount");

    const crossRuntime = { ...runtime, runtimeId: "2".repeat(32) };
    await expectCode(() => manager.stop(crossRuntime), "HELPER_RUNTIME_NOT_FOUND");
    assert.equal((await manager.stop(runtime)).state, "stopped");
    assert.equal((await manager.stop(runtime)).state, "stopped");
    assert.equal(docker.containers.has("unrelated"), true, "unrelated container untouched");
    assert.equal(docker.networks.has("unrelated-network"), true, "unrelated network untouched");
    assert.equal(docker.volumes.has("unrelated-volume"), true, "unrelated volume untouched");
    assert.equal(docker.containers.has("fake-managed"), true, "fake ownership label without authoritative record untouched");

    const failRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase3-helper-fail-"));
    const failingDocker = new FakeDocker(IMAGE_DIGEST);
    failingDocker.fail = { args: ["create"], once: true };
    const failing = new phase3.PrivilegedDockerRuntimeManager(data.keys, failRoot, "arm64",
      failingDocker.execute.bind(failingDocker), async () => true);
    const failedRuntime = phase3.helperIdentityForPackage("3".repeat(32), 1, data.pkg);
    await failing.prepare(data.pkg, failedRuntime);
    await expectCode(() => failing.launch(data.pkg, failedRuntime), "HELPER_LAUNCH_FAILED");
    assert.equal(failingDocker.containers.size, 0);
    assert.equal(failingDocker.networks.size, 0, "partial network removed after container-create failure");
    assert.equal(failingDocker.volumes.size, 0, "partial volume removed after container-create failure");
    fs.rmSync(failRoot, { recursive: true, force: true });

    process.stdout.write("Local-first Phase 3 privileged helper: PASS (exact operations, unauthorized/downgrade rejection, containment, labels, scoped cleanup, partial failure)\n");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
