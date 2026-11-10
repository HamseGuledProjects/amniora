#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node release rehearsal. */
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../../..");

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase18a-release-"));
  try {
    const manifestAuthority = crypto.generateKeyPairSync("ed25519");
    const packageAuthority = crypto.generateKeyPairSync("ed25519");
    const manifestPrivate = path.join(temporary, "manifest-private.pem");
    const manifestPublic = path.join(temporary, "manifest-public.pem");
    fs.writeFileSync(manifestPrivate, manifestAuthority.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    fs.writeFileSync(manifestPublic, manifestAuthority.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    const brokerKey = path.join(temporary, "broker-key.pem");
    const brokerCa = path.join(temporary, "broker-ca.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
      "-subj", "/CN=phase18a-build.invalid", "-keyout", brokerKey, "-out", brokerCa], { stdio: "ignore" });
    const packageKeys = path.join(temporary, "package-verification-keys.json");
    fs.writeFileSync(packageKeys, `${JSON.stringify({ schemaVersion: 1, keys: [{ keyId: "phase18a-rehearsal",
      publicKey: packageAuthority.publicKey.export({ type: "spki", format: "pem" }).toString() }] })}\n`, { mode: 0o600 });
    const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const { buildRunnerDistribution } = await import(path.join(ROOT, "scripts/runner-distribution/build.mjs"));
    const { renderInstaller } = await import(path.join(ROOT, "scripts/runner-distribution/render-installer.mjs"));
    const evidence = { sourceCommit, artifacts: {}, installer: null, productionSigningKey: false };
    for (const architecture of ["amd64", "arm64"]) {
      const outputDirectory = path.join(temporary, "output", architecture);
      const result = await buildRunnerDistribution({ architecture, outputDirectory, signingKeyPath: manifestPrivate,
        brokerCaPath: brokerCa, packageVerificationKeysPath: packageKeys, sourceCommit, downloadNode: true });
      const manifest = fs.readFileSync(result.manifestPath);
      const signature = fs.readFileSync(result.signaturePath);
      assert.equal(crypto.verify(null, manifest, manifestAuthority.publicKey, signature), true);
      assert.equal(crypto.createHash("sha256").update(fs.readFileSync(result.artifactPath)).digest("hex"), result.artifactSha256);
      evidence.artifacts[architecture] = { name: path.basename(result.artifactPath), sha256: result.artifactSha256,
        bytes: fs.statSync(result.artifactPath).size, signatureVerified: true };
    }
    const installerPath = path.join(temporary, "output/installers/1.0.0/install.sh");
    const installer = await renderInstaller({ outputPath: installerPath, manifestPublicKeyPath: manifestPublic });
    execFileSync("bash", ["-n", installerPath]);
    evidence.installer = { name: "install.sh", sha256: installer.sha256, signatureTrustEmbedded: true };
    process.stdout.write(`${JSON.stringify({ phase: "18A release build rehearsal", result: "PASS", ...evidence }, null, 2)}\n`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error?.message || error); process.exitCode = 1; });
