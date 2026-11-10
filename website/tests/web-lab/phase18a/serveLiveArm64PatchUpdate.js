#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Signed live update server retained only for the Phase 18A rehearsal. */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const originalLoad = Module._load;
Module._load = function phase18aServerOnly(specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return originalLoad.call(this, specifier, parent, isMain);
};

require("../phase16a2a/loadByoRunner");
const { createMyVmUpdateCommand, validateMyVmInstallerRelease } = require("../../../lib/web-lab/byo-runner/installer-release.ts");
const ROOT = path.resolve(__dirname, "../../..");
const exec = promisify(execFile);
const ARTIFACT_PORT = 43132;
const CONTROL_PORT = 43133;
const BROKER_ENDPOINT = "https://broker.runner.portfolio.example.test:43130/connect";
const DISTRIBUTION_ORIGIN = `https://runner.portfolio.example.test:${ARTIFACT_PORT}`;
const BROKER_CA_INPUT = "/tmp/amniora-phase18a-current-broker-ca.pem";
const PACKAGE_KEYS_INPUT = "/tmp/amniora-phase18a-current-package-keys.json";
const PUBLIC_CA_PATH = "/tmp/amniora-phase18a-update-ca.pem";
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
async function run(program, args) {
  try { return await exec(program, args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) { throw new Error(`phase18a_patch_command_failed:${path.basename(program)}:${error.code ?? "unknown"}`); }
}
async function listen(server, port) { await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", resolve).once("error", reject)); }
async function close(server) { if (server?.listening) await new Promise(resolve => server.close(() => resolve())); }

async function main() {
  if (!fs.existsSync(BROKER_CA_INPUT) || !fs.existsSync(PACKAGE_KEYS_INPUT)) throw new Error("phase18a_patch_public_inputs_missing");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase18a-patch-"));
  let artifactServer; let controlServer; let stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    await Promise.all([close(artifactServer), close(controlServer)]);
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    for (const target of [PUBLIC_CA_PATH, BROKER_CA_INPUT, PACKAGE_KEYS_INPUT]) fs.rmSync(target, { force: true });
  };
  try {
    const base = JSON.parse(fs.readFileSync(path.join(ROOT, "runner-distribution/release.json"), "utf8"));
    const release = { ...structuredClone(base), runnerVersion: "1.0.1", installerPath: "/runner/installers/1.0.1/install.sh" };
    const sourceCommit = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
    const caKey = path.join(temporary, "https-ca-key.pem"); const ca = path.join(temporary, "https-ca.pem");
    const serverKey = path.join(temporary, "https-server-key.pem"); const csr = path.join(temporary, "https-server.csr");
    const cert = path.join(temporary, "https-server.pem"); const extensions = path.join(temporary, "https-server.ext");
    await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
      "-subj", "/CN=Amniora Phase 18A Update CA", "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-keyout", caKey, "-out", ca]);
    await run("openssl", ["req", "-newkey", "rsa:2048", "-sha256", "-nodes", "-subj", "/CN=runner.portfolio.example.test",
      "-keyout", serverKey, "-out", csr]);
    fs.writeFileSync(extensions, "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:runner.portfolio.example.test,IP:10.0.2.2,IP:127.0.0.1\n", { mode: 0o600 });
    await run("openssl", ["x509", "-req", "-in", csr, "-CA", ca, "-CAkey", caKey, "-CAcreateserial", "-days", "1",
      "-sha256", "-extfile", extensions, "-out", cert]);
    fs.copyFileSync(ca, PUBLIC_CA_PATH); fs.chmodSync(PUBLIC_CA_PATH, 0o644);
    const manifestKeys = crypto.generateKeyPairSync("ed25519");
    const manifestPrivate = path.join(temporary, "manifest-private.pem"); const manifestPublic = path.join(temporary, "manifest-public.pem");
    fs.writeFileSync(manifestPrivate, manifestKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    fs.writeFileSync(manifestPublic, manifestKeys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    const source = base.architectures.arm64;
    const nodeArchive = path.join(temporary, source.nodeArchive);
    const nodeUrl = `https://nodejs.org/dist/v${base.nodeVersion}/${source.nodeArchive}`;
    const response = await fetch(nodeUrl, { redirect: "error", signal: AbortSignal.timeout(120_000) });
    if (!response.ok || response.url !== nodeUrl) throw new Error("phase18a_patch_node_download_failed");
    const nodeBytes = Buffer.from(await response.arrayBuffer());
    if (sha256(nodeBytes) !== source.nodeArchiveSha256) throw new Error("phase18a_patch_node_checksum_mismatch");
    fs.writeFileSync(nodeArchive, nodeBytes, { mode: 0o600, flag: "wx" });
    const { buildRunnerDistribution } = await import(path.join(ROOT, "scripts/runner-distribution/build.mjs"));
    const { renderInstaller } = await import(path.join(ROOT, "scripts/runner-distribution/render-installer.mjs"));
    const outputDirectory = path.join(temporary, "release");
    const built = await buildRunnerDistribution({ architecture: "arm64", outputDirectory, signingKeyPath: manifestPrivate,
      brokerCaPath: BROKER_CA_INPUT, packageVerificationKeysPath: PACKAGE_KEYS_INPUT, sourceCommit,
      nodeArchivePath: nodeArchive, releaseMetadata: release });
    const installerPath = path.join(outputDirectory, "install.sh");
    const installer = await renderInstaller({ outputPath: installerPath, manifestPublicKeyPath: manifestPublic,
      releaseMetadata: release, distributionOrigin: DISTRIBUTION_ORIGIN, brokerEndpoint: BROKER_ENDPOINT });
    const productRelease = validateMyVmInstallerRelease({ runnerVersion: "1.0.1", minimumCompatibleVersion: "1.0.0",
      protocolVersion: "1.0", installerUrl: `${DISTRIBUTION_ORIGIN}/runner/installers/1.0.1/install.sh`,
      installerSha256: installer.sha256, brokerEndpoint: BROKER_ENDPOINT });
    const updateCommand = createMyVmUpdateCommand(productRelease);
    const artifactName = path.basename(built.artifactPath);
    const files = new Map([
      ["/runner/installers/1.0.1/install.sh", fs.readFileSync(installerPath)],
      [`/runner/releases/1.0.1/${artifactName}`, fs.readFileSync(built.artifactPath)],
      [`/runner/releases/1.0.1/${artifactName}.manifest`, fs.readFileSync(built.manifestPath)],
      [`/runner/releases/1.0.1/${artifactName}.manifest.sig`, fs.readFileSync(built.signaturePath)],
    ]);
    artifactServer = https.createServer({ key: fs.readFileSync(serverKey), cert: fs.readFileSync(cert), minVersion: "TLSv1.2" }, (request, response) => {
      const url = new URL(request.url || "/", DISTRIBUTION_ORIGIN);
      const host = String(request.headers.host || "").split(":")[0];
      if (request.method !== "GET" || host !== "runner.portfolio.example.test") { response.writeHead(421); response.end(); return; }
      if (url.pathname === "/__phase18a/command/update-1.0.1") {
        response.writeHead(200, { "cache-control": "no-store", "content-type": "text/x-shellscript; charset=utf-8" });
        response.end(`${updateCommand}\n`); return;
      }
      const body = files.get(url.pathname);
      if (!body) { response.writeHead(404, { "cache-control": "no-store" }); response.end(); return; }
      response.writeHead(200, { "cache-control": "no-store", "content-type": "application/octet-stream", "content-length": body.length });
      response.end(body);
    });
    await listen(artifactServer, ARTIFACT_PORT);
    controlServer = http.createServer((request, response) => {
      if (request.method === "POST" && request.url === "/shutdown") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); response.end("{\"stopping\":true}\n");
        setImmediate(() => void stop().finally(() => process.exit(0))); return;
      }
      response.writeHead(404, { "cache-control": "no-store" }); response.end();
    });
    await listen(controlServer, CONTROL_PORT);
    process.stdout.write(`${JSON.stringify({ phase: "18A signed patch update", result: "READY", version: "1.0.1",
      artifactSha256: built.artifactSha256, installerSha256: installer.sha256, publicCaPath: PUBLIC_CA_PATH })}\n`);
    process.on("SIGINT", () => void stop().finally(() => process.exit(130)));
    process.on("SIGTERM", () => void stop().finally(() => process.exit(143)));
    await new Promise(() => undefined);
  } catch (error) { await stop(); throw error; }
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
