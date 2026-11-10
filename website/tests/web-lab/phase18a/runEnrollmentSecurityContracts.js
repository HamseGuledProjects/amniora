#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated TypeScript contract harness. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

const ROOT = path.resolve(__dirname, "../../..");
const WEB_LAB_ROOT = path.join(ROOT, "lib/web-lab");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(WEB_LAB_ROOT + path.sep)) throw new Error("Only Web Lab sources may be transpiled");
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};

const { ByoRunnerEnrollmentStore } = require(path.join(WEB_LAB_ROOT, "byo-runner/enrollment.ts"));
const { MyVmProductService } = require(path.join(WEB_LAB_ROOT, "byo-runner/product-service.ts"));
const { createMyVmProductApi } = require(path.join(WEB_LAB_ROOT, "byo-runner/product-api.ts"));
const { validateMyVmInstallerRelease } = require(path.join(WEB_LAB_ROOT, "byo-runner/installer-release.ts"));

const ORIGIN = "http://localhost:3000";
const LAB = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const RELEASE = { runnerVersion: "1.0.0", minimumCompatibleVersion: "1.0.0", protocolVersion: "1.0",
  installerUrl: "https://runner.portfolio.example.test/runner/installers/1.0.0/install.sh", installerSha256: "f".repeat(64),
  brokerEndpoint: "https://broker.amniora.example/connect" };

function code(error, expected) { return error?.code === expected; }
function request(body, actor = OWNER) {
  return new Request(`${ORIGIN}/api/web-labs/my-vm/${LAB}`, { method: "POST", headers: {
    "content-type": "application/json", origin: ORIGIN, authorization: actor,
  }, body: JSON.stringify(body) });
}

async function main() {
  let now = 1_800_000_000_000;
  const enrollmentStore = new ByoRunnerEnrollmentStore(() => now, 2_000);
  const first = enrollmentStore.issue(OWNER);
  assert.throws(() => enrollmentStore.consume(first.token, OWNER, "wrong-audience"), error => code(error, "AUDIENCE_MISMATCH"));
  assert.throws(() => enrollmentStore.consume(first.token, OTHER, first.audience), error => code(error, "OWNER_MISMATCH"));
  enrollmentStore.consume(first.token, OWNER, first.audience);
  assert.throws(() => enrollmentStore.consume(first.token, OWNER, first.audience), error => code(error, "ENROLLMENT_REPLAYED"));
  const expired = enrollmentStore.issue(OWNER); now += 2_001;
  assert.throws(() => enrollmentStore.consume(expired.token, OWNER, expired.audience), error => code(error, "ENROLLMENT_EXPIRED"));

  const productStore = new ByoRunnerEnrollmentStore(() => now, 60_000);
  const operations = [];
  let issuedCapability = null;
  const maliciousDisplayName = "VM'; touch /tmp/not-allowed; #";
  const runner = ownerId => ({ ownerId, runnerKey: "runner-key", displayName: maliciousDisplayName, platform: "Linux",
    architecture: "arm64", version: "0.9.0", state: "incompatible", lastSeenAt: new Date(now).toISOString(),
    dockerAvailable: true, labState: "idle", generation: null, runnerId: "must-not-leak", privateKey: "must-not-leak" });
  const backend = {
    async eligibility(_ownerId, savedLabId) { return savedLabId === LAB; },
    async list(ownerId) { return [runner(ownerId), { ...runner(OTHER), runnerKey: "foreign" }]; },
    async issueEnrollment(ownerId) { issuedCapability = productStore.issue(ownerId); return issuedCapability; },
    async launch(input) { operations.push({ action: "launch", ...input }); },
    async reset(input) { operations.push({ action: "reset", ...input }); },
    async stop(input) { operations.push({ action: "stop", ...input }); },
    async disconnect(input) { operations.push({ action: "disconnect", ...input }); },
    async open() { throw new Error("not_ready"); },
  };
  const service = new MyVmProductService(backend, "https://broker.amniora.example/connect", "https://lab.amniora.example", RELEASE);
  const actor = { userId: OWNER, sessionId: "session" };
  const enrollment = await service.enroll(actor);
  assert.match(enrollment.command, /^\( umask 077/);
  assert.match(enrollment.command, /curl --proto '=https' --tlsv1\.2/);
  assert.match(enrollment.command, /sha256sum --check --status/);
  assert.match(enrollment.command, /sudo \/bin\/bash "\$amniora_install" --enrollment-stdin --replace-identity/);
  assert.ok(issuedCapability);
  assert.equal(enrollment.command.split(issuedCapability.token).length, 2, "one intended capability is present");
  assert.equal(enrollment.command.includes(maliciousDisplayName), false, "display name never enters shell command");
  assert.equal((enrollment.command.match(/runner\.amniora\.com/g) || []).length, 1, "one fixed download host");
  assert.doesNotMatch(enrollment.command, /curl[^&;]*\|\s*sudo|(?:--base-url|--download-url|--install-root)/);

  const snapshot = await service.snapshot(actor, LAB);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("must-not-leak"), false);
  assert.equal(serialized.includes(OTHER), false);
  assert.equal(snapshot.distribution.currentVersion, "1.0.0");
  assert.equal(snapshot.distribution.minimumCompatibleVersion, "1.0.0");
  assert.equal(snapshot.distribution.protocolVersion, "1.0");
  assert.equal(snapshot.distribution.updateCommand.includes(issuedCapability.token), false);
  assert.equal(snapshot.distribution.uninstallCommand, "sudo /usr/local/sbin/amniora-runner-uninstall");

  const api = createMyVmProductApi({ enabled: true, origin: ORIGIN,
    resolveActor: async input => ({ userId: input.headers.get("authorization"), sessionId: "session" }), service });
  const disconnected = await api(request({ action: "disconnect", runnerKey: "runner-key", idempotencyKey: "disconnect-1" }), LAB);
  assert.equal(disconnected.status, 202);
  assert.equal(operations.at(-1).ownerId, OWNER);
  assert.equal(operations.at(-1).action, "disconnect");
  for (const input of [
    { action: "enroll", url: "https://evil.invalid/install" },
    { action: "enroll", path: "/tmp/evil" },
    { action: "enroll", runnerName: "x; touch /tmp/not-allowed" },
    { action: "disconnect", runnerKey: "foreign", idempotencyKey: "foreign" },
  ]) {
    const response = await api(request(input), LAB);
    assert.ok([400, 404].includes(response.status));
  }
  assert.throws(() => validateMyVmInstallerRelease({ ...RELEASE, installerUrl: "https://evil.invalid/install.sh" }),
    /invalid_runner_installer_release/);
  assert.throws(() => validateMyVmInstallerRelease({ ...RELEASE, installerUrl: `${RELEASE.installerUrl}?url=https://evil.invalid` }),
    /invalid_runner_installer_release/);
  assert.throws(() => validateMyVmInstallerRelease({ ...RELEASE,
    installerUrl: "https://runner.portfolio.example.test/runner/installers/1.0.0/../../evil.sh" }),
  /invalid_runner_installer_release/);
  assert.throws(() => new MyVmProductService(backend, "https://other-broker.amniora.example/connect",
    "https://lab.amniora.example", RELEASE), /runner_installer_endpoint_mismatch/);
  await assert.rejects(service.enroll({ userId: "x; touch /tmp/not-allowed", sessionId: "session" }),
    error => code(error, "INVALID_REQUEST"));

  const browserSources = [
    "app/dashboard/saved/[id]/SavedLabMyVm.tsx",
    "lib/web-lab/byo-runner/browser-client.ts",
    "lib/web-lab/byo-runner/product-contract.ts",
  ].map(relative => fs.readFileSync(path.join(ROOT, relative), "utf8")).join("\n");
  assert.doesNotMatch(browserSources, /console\.(?:log|info|debug)|localStorage|sessionStorage|analytics\./);
  assert.doesNotMatch(browserSources, /privateKey|runner-identity\.json|brokerCredential|docker\.sock/);
  for (const copy of ["Connect your VM", "Copy install command", "Waiting for your VM", "Runner online",
    "Update required", "Connection lost", "Reconnect", "Disconnect VM", "Remove Runner",
    "Copy uninstall command"]) assert.equal(browserSources.includes(copy), true, `missing product copy: ${copy}`);
  assert.match(browserSources, /Docker \{runner\.dockerAvailable \? "ready"/);
  const installer = fs.readFileSync(path.join(ROOT, "runner-distribution/linux/install.sh"), "utf8");
  assert.doesNotMatch(installer, /set -x|journalctl|cat .*enrollment|printf .*enrollment/i);
  process.stdout.write("Phase 18A enrollment/security contracts PASS (expiry, replay, owner binding, fixed host/path, shell safety, disconnect, browser/log secrecy)\n");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
