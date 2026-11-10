#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node contract harness. */
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../../..");
const SOURCE_COMMIT = "1".repeat(40);

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function manifestValue(source, name) {
  const values = source.split("\n").filter(line => line.startsWith(`${name}=`));
  assert.equal(values.length, 1, `${name} must occur once`);
  return values[0].slice(name.length + 1);
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase18a-distribution-"));
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const signingKey = path.join(temporary, "manifest-private.pem");
    const manifestPublicKey = path.join(temporary, "manifest-public.pem");
    const packagePublicKey = publicKey.export({ type: "spki", format: "pem" }).toString();
    fs.writeFileSync(signingKey, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    fs.writeFileSync(manifestPublicKey, packagePublicKey, { mode: 0o600 });
    const brokerKey = path.join(temporary, "broker-key.pem");
    const brokerCa = path.join(temporary, "broker-ca.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
      "-subj", "/CN=phase18a.invalid", "-keyout", brokerKey, "-out", brokerCa], { stdio: "ignore" });
    const verificationKeys = path.join(temporary, "verification-keys.json");
    fs.writeFileSync(verificationKeys, `${JSON.stringify({ schemaVersion: 1, keys: [{ keyId: "phase18a-test", publicKey: packagePublicKey }] })}\n`);
    const fakeNode = path.join(temporary, "node");
    fs.writeFileSync(fakeNode, Buffer.from("phase18a deterministic Linux runtime fixture\n"), { mode: 0o750 });
    const { buildRunnerDistribution } = await import(path.join(ROOT, "scripts/runner-distribution/build.mjs"));

    const builds = {};
    for (const architecture of ["amd64", "arm64"]) {
      const firstOutput = path.join(temporary, `${architecture}-first`);
      const secondOutput = path.join(temporary, `${architecture}-second`);
      const options = { architecture, sourceCommit: SOURCE_COMMIT, signingKeyPath: signingKey,
        brokerCaPath: brokerCa, packageVerificationKeysPath: verificationKeys, nodeBinaryPath: fakeNode };
      const first = await buildRunnerDistribution({ ...options, outputDirectory: firstOutput });
      const second = await buildRunnerDistribution({ ...options, outputDirectory: secondOutput });
      const artifact = fs.readFileSync(first.artifactPath);
      const repeated = fs.readFileSync(second.artifactPath);
      const manifest = fs.readFileSync(first.manifestPath);
      const signature = fs.readFileSync(first.signaturePath);
      assert.deepEqual(artifact, repeated, `${architecture} artifact is reproducible`);
      assert.deepEqual(manifest, fs.readFileSync(second.manifestPath), `${architecture} manifest is reproducible`);
      assert.deepEqual(signature, fs.readFileSync(second.signaturePath), `${architecture} signature is reproducible`);
      assert.equal(crypto.verify(null, manifest, publicKey, signature), true, `${architecture} manifest signature`);
      const source = manifest.toString("utf8");
      assert.equal(manifestValue(source, "architecture"), architecture);
      assert.equal(manifestValue(source, "runnerVersion"), "1.0.0");
      assert.equal(manifestValue(source, "protocolVersion"), "1.0");
      assert.equal(manifestValue(source, "minimumCompatibleVersion"), "1.0.0");
      assert.equal(manifestValue(source, "sourceCommit"), SOURCE_COMMIT);
      assert.equal(manifestValue(source, "artifactSha256"), sha256(artifact));
      assert.match(source, /^file=[0-9a-f]{64} 0750 [0-9]+ bin\/node$/m);
      assert.match(source, /^file=[0-9a-f]{64} 0640 [0-9]+ release\.json$/m);
      const listed = execFileSync("tar", ["-tzf", first.artifactPath], { encoding: "utf8" }).trim().split("\n");
      assert.ok(listed.includes("bin/node"));
      assert.ok(listed.includes("lib/byo-runner/runtime-cli.js"));
      assert.ok(listed.includes("share/systemd/amniora-runner.service"));
      const tamperedArtifact = Buffer.from(artifact); tamperedArtifact[16] ^= 1;
      assert.notEqual(sha256(tamperedArtifact), manifestValue(source, "artifactSha256"), "tampering changes checksum");
      const tamperedManifest = Buffer.from(manifest); tamperedManifest[tamperedManifest.length - 2] ^= 1;
      assert.equal(crypto.verify(null, tamperedManifest, publicKey, signature), false, "tampering invalidates signature");
      builds[architecture] = { artifact: path.basename(first.artifactPath), checksum: sha256(artifact) };
    }

    const release = JSON.parse(fs.readFileSync(path.join(ROOT, "runner-distribution/release.json"), "utf8"));
    assert.deepEqual(Object.keys(release.architectures).sort(), ["amd64", "arm64"]);
    assert.equal(JSON.stringify(release).includes("latest"), false);
    assert.match(release.architectures.amd64.nodeArchiveSha256, /^[0-9a-f]{64}$/);
    assert.match(release.architectures.arm64.nodeArchiveSha256, /^[0-9a-f]{64}$/);
    process.stdout.write(`Phase 18A distribution contracts PASS ${JSON.stringify(builds)}\n`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
