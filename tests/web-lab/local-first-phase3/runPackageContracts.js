#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Phase 3 package contracts. */
"use strict";
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { NOW, packageFixture, phase3 } = require("./fixtures");

function expectCode(action, code) {
  assert.throws(action, error => error?.code === code, code);
}

function resign(value, privateKey) {
  const unsigned = { ...value };
  delete unsigned.signature;
  return { ...unsigned, signature: sign(null, Buffer.from(phase3.canonicalJson(unsigned)), privateKey).toString("base64url") };
}

function main() {
  const arm = packageFixture("arm64");
  const amd = packageFixture("amd64");
  assert.equal(phase3.verifyLocalRunnerPackage(arm.pkg, arm.keys, { now: () => NOW }), arm.pkg);
  assert.equal(phase3.packageSupportsPlatform(arm.pkg, "linux", "arm64"), true);
  assert.equal(phase3.packageSupportsPlatform(arm.pkg, "linux", "amd64"), false);
  assert.equal(phase3.packageSupportsPlatform(amd.pkg, "linux", "amd64"), true);
  assert.equal(phase3.packageSupportsPlatform(amd.pkg, "linux", "arm64"), false);
  assert.deepEqual(Object.keys(arm.pkg.image).sort(), ["applicationPort", "digest", "identity"]);
  assert.deepEqual(Object.keys(arm.pkg.healthCheck).sort(), ["expectedStatus", "kind", "path", "timeoutMs"]);
  assert.deepEqual(Object.keys(arm.pkg.resourcePolicy).sort(), ["dropCapabilities", "memoryBytes", "nanoCpus",
    "networkPolicy", "noNewPrivileges", "pidsLimit", "readOnlyRootFilesystem"]);
  assert.equal(arm.pkg.image.applicationPort, 8080);
  assert.equal(arm.pkg.resourcePolicy.networkPolicy, "challenge-no-egress");

  const unsigned = structuredClone(arm.pkg);
  delete unsigned.signature;
  expectCode(() => phase3.verifyLocalRunnerPackage(unsigned, arm.keys, { now: () => NOW }), "PACKAGE_INVALID");
  const modified = structuredClone(arm.pkg);
  modified.bundle[0].content += "modified";
  expectCode(() => phase3.verifyLocalRunnerPackage(modified, arm.keys, { now: () => NOW }), "PACKAGE_SIGNATURE_INVALID");
  const wrongKey = generateKeyPairSync("ed25519");
  expectCode(() => phase3.verifyLocalRunnerPackage(arm.pkg, new Map([[arm.pkg.keyId, wrongKey.publicKey]]), { now: () => NOW }),
    "PACKAGE_SIGNATURE_INVALID");
  expectCode(() => phase3.verifyLocalRunnerPackage(arm.pkg, arm.keys, { now: () => NOW, expectedBuildId: "wrong-build-id" }),
    "BUILD_FINGERPRINT_MISMATCH");
  expectCode(() => phase3.verifyLocalRunnerPackage({ ...arm.pkg, protocolVersion: "0.9" }, arm.keys, { now: () => NOW }),
    "PROTOCOL_VERSION_UNSUPPORTED");
  const wrongHash = resign({ ...arm.pkg, packageHash: "0".repeat(64) }, arm.pair.privateKey);
  expectCode(() => phase3.verifyLocalRunnerPackage(wrongHash, arm.keys, { now: () => NOW }), "PACKAGE_HASH_MISMATCH");

  const forbiddenMutations = [
    { shell: "/bin/sh" }, { dockerArgs: ["--privileged"] }, { privileged: true },
    { mounts: ["/var/run/docker.sock:/var/run/docker.sock"] }, { hostMounts: ["/:/host"] },
    { networkMode: "host" }, { hostPort: 22 }, { capAdd: ["SYS_ADMIN"] },
    { environment: { MALICIOUS: "1" } }, { pidMode: "host" }, { ipcMode: "host" },
  ];
  for (const mutation of forbiddenMutations) {
    expectCode(() => phase3.verifyLocalRunnerPackage({ ...arm.pkg, ...mutation }, arm.keys, { now: () => NOW }), "PACKAGE_INVALID");
  }
  const traversal = structuredClone(arm.pkg);
  traversal.bundle[0].path = "../../escape";
  expectCode(() => phase3.verifyLocalRunnerPackage(traversal, arm.keys, { now: () => NOW }), "PACKAGE_INVALID");
  const symlink = { ...arm.pkg, bundle: [...arm.pkg.bundle, { path: "link", content: "target", sha256: "0".repeat(64), type: "symlink" }] };
  expectCode(() => phase3.verifyLocalRunnerPackage(symlink, arm.keys, { now: () => NOW }), "PACKAGE_INVALID");
  const oversized = { ...arm.pkg, extra: "x".repeat(520 * 1024) };
  expectCode(() => phase3.verifyLocalRunnerPackage(oversized, arm.keys, { now: () => NOW }), "PACKAGE_INVALID");
  process.stdout.write("Local-first Phase 3 package authority: PASS (Ed25519, hash/build/platform/image authority, exact schemas, archive/path bounds)\n");
}

main();
