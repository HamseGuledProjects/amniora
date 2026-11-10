#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Disposable ARM64 installer lifecycle rehearsal. */
"use strict";

const assert = require("node:assert/strict");
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

const ROOT = path.resolve(__dirname, "../../..");
const byo = require("../phase16a2a/loadByoRunner");
const { MyVmProductService } = require("../../../lib/web-lab/byo-runner/product-service.ts");
const { createMyVmUpdateCommand, validateMyVmInstallerRelease } = require("../../../lib/web-lab/byo-runner/installer-release.ts");

const exec = promisify(execFile);
const OWNER = "11111111-1111-4111-8111-111111111111";
const SAVED_LAB = "33333333-3333-4333-8333-333333333333";
const RUNNER_KEY = "phase18a-live-runner";
const ARTIFACT_PORT = 43129;
const BROKER_PORT = 43130;
const CONTROL_PORT = 43131;
const DISTRIBUTION_ORIGIN = `https://runner.portfolio.example.test:${ARTIFACT_PORT}`;
const BROKER_ENDPOINT = `https://broker.runner.portfolio.example.test:${BROKER_PORT}/connect`;
const PUBLIC_CA_PATH = "/tmp/amniora-phase18a-live-ca.pem";

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function json(response, status = 200) {
  return { status, headers: { "cache-control": "no-store", "content-type": "application/json" }, body: Buffer.from(`${JSON.stringify(response)}\n`) };
}
function compareVersion(left, right) {
  const a = left.split(".").map(Number); const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) { if (a[index] !== b[index]) return a[index] - b[index]; }
  return 0;
}
async function run(program, args) {
  try { return await exec(program, args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) { throw new Error(`phase18a_live_command_failed:${path.basename(program)}:${error.code ?? "unknown"}`); }
}
async function listen(server, port) {
  await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", resolve).once("error", reject));
}
async function close(server) {
  if (!server.listening) return;
  await new Promise(resolve => server.close(() => resolve()));
}
function releaseFor(base, version) {
  return { ...structuredClone(base), runnerVersion: version, installerPath: `/runner/installers/${version}/install.sh` };
}
async function certificateFixture(directory) {
  const caKeyPath = path.join(directory, "local-ca-key.pem");
  const caPath = path.join(directory, "local-ca.pem");
  const serverKeyPath = path.join(directory, "local-server-key.pem");
  const requestPath = path.join(directory, "local-server.csr");
  const serverPath = path.join(directory, "local-server.pem");
  const extensionsPath = path.join(directory, "local-server.ext");
  await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
    "-subj", "/CN=Amniora Phase 18A Local Test CA",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    "-keyout", caKeyPath, "-out", caPath]);
  await run("openssl", ["req", "-newkey", "rsa:2048", "-sha256", "-nodes",
    "-subj", "/CN=runner.portfolio.example.test", "-keyout", serverKeyPath, "-out", requestPath]);
  fs.writeFileSync(extensionsPath, [
    "basicConstraints=critical,CA:FALSE",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    "subjectAltName=DNS:runner.portfolio.example.test,DNS:broker.runner.portfolio.example.test,IP:10.0.2.2,IP:127.0.0.1",
    "",
  ].join("\n"), { mode: 0o600 });
  await run("openssl", ["x509", "-req", "-in", requestPath, "-CA", caPath, "-CAkey", caKeyPath,
    "-CAcreateserial", "-days", "1", "-sha256", "-extfile", extensionsPath, "-out", serverPath]);
  fs.copyFileSync(caPath, PUBLIC_CA_PATH);
  fs.chmodSync(PUBLIC_CA_PATH, 0o644);
  return { caPath, key: fs.readFileSync(serverKeyPath), cert: fs.readFileSync(serverPath) };
}

async function pinnedNodeArchive(base, directory) {
  const source = base.architectures.arm64;
  const target = path.join(directory, source.nodeArchive);
  const url = `https://nodejs.org/dist/v${base.nodeVersion}/${source.nodeArchive}`;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || response.url !== url) throw new Error("phase18a_node_download_failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== source.nodeArchiveSha256) throw new Error("phase18a_node_checksum_mismatch");
  fs.writeFileSync(target, bytes, { mode: 0o600, flag: "wx" });
  return target;
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase18a-live-"));
  let artifactServer;
  let controlServer;
  let broker;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await Promise.all([close(artifactServer), close(controlServer), broker?.close().catch(() => undefined)]);
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(PUBLIC_CA_PATH, { force: true });
  };
  try {
    const baseRelease = JSON.parse(fs.readFileSync(path.join(ROOT, "runner-distribution/release.json"), "utf8"));
    const sourceCommit = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
    const tls = await certificateFixture(temporary);
    const manifestKeys = crypto.generateKeyPairSync("ed25519");
    const manifestPrivatePath = path.join(temporary, "manifest-private.pem");
    const manifestPublicPath = path.join(temporary, "manifest-public.pem");
    fs.writeFileSync(manifestPrivatePath, manifestKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    fs.writeFileSync(manifestPublicPath, manifestKeys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    const packageKeys = crypto.generateKeyPairSync("ed25519");
    const verificationKeysPath = path.join(temporary, "package-verification-keys.json");
    fs.writeFileSync(verificationKeysPath, `${JSON.stringify({ schemaVersion: 1, keys: [{
      keyId: "phase18a-live-test", publicKey: packageKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    }] })}\n`, { mode: 0o600 });
    const nodeArchivePath = await pinnedNodeArchive(baseRelease, temporary);
    const { buildRunnerDistribution } = await import(path.join(ROOT, "scripts/runner-distribution/build.mjs"));
    const { renderInstaller } = await import(path.join(ROOT, "scripts/runner-distribution/render-installer.mjs"));
    const releases = new Map();
    const artifacts = new Map();
    async function build(version, architecture = "arm64", nodePath = nodeArchivePath) {
      const release = releaseFor(baseRelease, version);
      const outputDirectory = path.join(temporary, `release-${version}-${architecture}`);
      const result = await buildRunnerDistribution({ architecture, outputDirectory, signingKeyPath: manifestPrivatePath,
        brokerCaPath: tls.caPath, packageVerificationKeysPath: verificationKeysPath, sourceCommit,
        ...(architecture === "arm64" ? { nodeArchivePath: nodePath } : { nodeBinaryPath: nodePath }),
        releaseMetadata: release });
      const installerPath = path.join(outputDirectory, "install.sh");
      const installer = await renderInstaller({ outputPath: installerPath, manifestPublicKeyPath: manifestPublicPath,
        releaseMetadata: release, distributionOrigin: DISTRIBUTION_ORIGIN, brokerEndpoint: BROKER_ENDPOINT });
      return { release, result, installerPath, installerSha256: installer.sha256 };
    }
    const v100 = await build("1.0.0");
    const v100Repeat = await build("1.0.0");
    assert.deepEqual(fs.readFileSync(v100.result.artifactPath), fs.readFileSync(v100Repeat.result.artifactPath));
    assert.deepEqual(fs.readFileSync(v100.result.manifestPath), fs.readFileSync(v100Repeat.result.manifestPath));
    assert.deepEqual(fs.readFileSync(v100.result.signaturePath), fs.readFileSync(v100Repeat.result.signaturePath));
    const v101 = await build("1.0.1");
    const fakeNode = path.join(temporary, "negative-node-fixture");
    fs.writeFileSync(fakeNode, "bounded negative architecture fixture\n", { mode: 0o750 });
    const v102TamperedArtifact = await build("1.0.2", "arm64", nodeArchivePath);
    const v103TamperedManifest = await build("1.0.3", "arm64", nodeArchivePath);
    const v104WrongArchitecture = await build("1.0.4", "amd64", fakeNode);
    for (const built of [v100, v101, v102TamperedArtifact, v103TamperedManifest]) {
      releases.set(built.release.runnerVersion, built);
      const artifactName = path.basename(built.result.artifactPath);
      const prefix = `/runner/releases/${built.release.runnerVersion}/`;
      artifacts.set(prefix + artifactName, fs.readFileSync(built.result.artifactPath));
      artifacts.set(prefix + `${artifactName}.manifest`, fs.readFileSync(built.result.manifestPath));
      artifacts.set(prefix + `${artifactName}.manifest.sig`, fs.readFileSync(built.result.signaturePath));
      artifacts.set(`/runner/installers/${built.release.runnerVersion}/install.sh`, fs.readFileSync(built.installerPath));
    }
    const tamperedArtifactPath = `/runner/releases/1.0.2/${path.basename(v102TamperedArtifact.result.artifactPath)}`;
    const tamperedArtifact = Buffer.from(artifacts.get(tamperedArtifactPath)); tamperedArtifact[32] ^= 1;
    artifacts.set(tamperedArtifactPath, tamperedArtifact);
    const tamperedManifestPath = `/runner/releases/1.0.3/${path.basename(v103TamperedManifest.result.manifestPath)}`;
    const tamperedManifest = Buffer.from(artifacts.get(tamperedManifestPath)); tamperedManifest[tamperedManifest.length - 2] ^= 1;
    artifacts.set(tamperedManifestPath, tamperedManifest);
    const wrongArtifactName = `amniora-runner-1.0.4-linux-arm64.tar.gz`;
    artifacts.set(`/runner/releases/1.0.4/${wrongArtifactName}`, fs.readFileSync(v104WrongArchitecture.result.artifactPath));
    artifacts.set(`/runner/releases/1.0.4/${wrongArtifactName}.manifest`, fs.readFileSync(v104WrongArchitecture.result.manifestPath));
    artifacts.set(`/runner/releases/1.0.4/${wrongArtifactName}.manifest.sig`, fs.readFileSync(v104WrongArchitecture.result.signaturePath));
    artifacts.set("/runner/installers/1.0.4/install.sh", fs.readFileSync(v104WrongArchitecture.installerPath));

    broker = new byo.ByoRunnerBroker({ tls, identityStore: new byo.ByoBrokerIdentityStore(path.join(temporary, "broker-state")),
      host: "127.0.0.1", port: BROKER_PORT, heartbeatIntervalMs: 500, livenessTimeoutMs: 3_000,
      handshakeTimeoutMs: 5_000, commandTimeoutMs: 30_000 });
    let latestRunnerId = null;
    let firstRunnerId = null;
    let priorRunnerId = null;
    let presentedVersion = "1.0.0";
    let expectedVersion = "1.0.0";
    let connectionPresentation = "offline";
    const rejected = [];
    broker.on("connected", status => {
      priorRunnerId = latestRunnerId;
      latestRunnerId = status.runnerId;
      firstRunnerId ??= status.runnerId;
      connectionPresentation = "connected";
    });
    broker.on("disconnected", status => { if (status.runnerId === latestRunnerId) connectionPresentation = "offline"; });
    broker.on("rejected", value => rejected.push(value.code));
    await broker.listen();
    const backend = {
      async eligibility(ownerId, savedLabId) { return ownerId === OWNER && savedLabId === SAVED_LAB; },
      async list(ownerId, savedLabId) {
        if (ownerId !== OWNER || savedLabId !== SAVED_LAB || !latestRunnerId) return [];
        const status = broker.status(latestRunnerId);
        if (!status) return [];
        const connected = status.connected;
        return [{ ownerId: OWNER, runnerKey: RUNNER_KEY, displayName: "Amniora-BYO-Test", platform: "Linux",
          architecture: "arm64", version: presentedVersion,
          state: compareVersion(presentedVersion, expectedVersion) < 0 ? "incompatible" : connected ? "connected" : connectionPresentation,
          lastSeenAt: new Date(status.lastHeartbeatAt || status.lastConnectedAt || Date.now()).toISOString(),
          dockerAvailable: true, labState: "idle", generation: null }];
      },
      async issueEnrollment(ownerId) { if (ownerId !== OWNER) throw new Error("owner_mismatch"); return broker.issueEnrollment(ownerId); },
      async launch() { throw new Error("not_used"); }, async reset() { throw new Error("not_used"); },
      async stop() { throw new Error("not_used"); }, async disconnect() { connectionPresentation = "offline"; },
      async open() { throw new Error("not_used"); },
    };
    const releaseObject = built => validateMyVmInstallerRelease({ runnerVersion: built.release.runnerVersion,
      minimumCompatibleVersion: built.release.minimumCompatibleVersion, protocolVersion: "1.0",
      installerUrl: `${DISTRIBUTION_ORIGIN}/runner/installers/${built.release.runnerVersion}/install.sh`,
      installerSha256: built.installerSha256, brokerEndpoint: BROKER_ENDPOINT });
    const productReleases = new Map([["1.0.0", releaseObject(v100)], ["1.0.1", releaseObject(v101)],
      ["1.0.2", releaseObject(v102TamperedArtifact)], ["1.0.3", releaseObject(v103TamperedManifest)],
      ["1.0.4", releaseObject(v104WrongArchitecture)]]);
    const actor = { userId: OWNER, sessionId: "phase18a-live-product" };
    const serviceFor = version => new MyVmProductService(backend, BROKER_ENDPOINT, "https://lab.amniora.example", productReleases.get(version));
    let initialEnrollment = null;
    let freshEnrollment = null;

    async function shellCommand(name) {
      if (name === "initial") {
        initialEnrollment ??= await serviceFor("1.0.0").enroll(actor);
        return initialEnrollment.command;
      }
      if (name === "replay") {
        if (!initialEnrollment) throw new Error("initial_enrollment_not_issued");
        return initialEnrollment.command;
      }
      if (name === "fresh") {
        freshEnrollment ??= await serviceFor("1.0.1").enroll(actor);
        return freshEnrollment.command;
      }
      if (name === "uninstall") return "sudo /usr/local/sbin/amniora-runner-uninstall";
      if (name === "purge") return "sudo /usr/local/sbin/amniora-runner-uninstall --purge-identity";
      const update = /^update-(1\.0\.[0-4])$/.exec(name);
      if (update) return createMyVmUpdateCommand(productReleases.get(update[1]));
      throw new Error("unknown_phase18a_shell_command");
    }

    artifactServer = https.createServer({ key: tls.key, cert: tls.cert, minVersion: "TLSv1.2" }, async (request, response) => {
      try {
        const url = new URL(request.url || "/", DISTRIBUTION_ORIGIN);
        const host = String(request.headers.host || "").split(":")[0];
        if (request.method !== "GET" || host !== "runner.portfolio.example.test") { response.writeHead(421); response.end(); return; }
        const command = /^\/__phase18a\/command\/(initial|replay|fresh|uninstall|purge|update-1\.0\.[0-4])$/.exec(url.pathname);
        if (command) {
          const source = await shellCommand(command[1]);
          response.writeHead(200, { "cache-control": "no-store", "content-type": "text/x-shellscript; charset=utf-8",
            "content-security-policy": "default-src 'none'", "referrer-policy": "no-referrer" });
          response.end(`${source}\n`); return;
        }
        const body = artifacts.get(url.pathname);
        if (!body) { response.writeHead(404, { "cache-control": "no-store" }); response.end(); return; }
        response.writeHead(200, { "cache-control": "no-store", "content-type": "application/octet-stream", "content-length": body.length });
        response.end(body);
      } catch { response.writeHead(500, { "cache-control": "no-store" }); response.end(); }
    });
    await listen(artifactServer, ARTIFACT_PORT);

    controlServer = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url || "/", `http://127.0.0.1:${CONTROL_PORT}`);
        let result;
        if (request.method === "GET" && url.pathname === "/status") {
          const service = serviceFor(expectedVersion === "1.0.1" ? "1.0.1" : "1.0.0");
          const snapshot = await service.snapshot(actor, SAVED_LAB);
          const runner = snapshot.runners[0] || null;
          result = json({ phase: "18A live ARM64", runner: runner ? {
            platform: runner.platform, architecture: runner.architecture, version: runner.version, state: runner.state,
            dockerAvailable: runner.dockerAvailable, labState: runner.labState,
          } : null, expectedVersion, connectionCount: latestRunnerId ? broker.status(latestRunnerId)?.connectionCount ?? 0 : 0,
          enrollment: { initialIssued: Boolean(initialEnrollment), freshIssued: Boolean(freshEnrollment),
            fiveMinuteTtl: initialEnrollment ? new Date(initialEnrollment.expiresAt).getTime() - Date.now() <= 300_000 : null },
          security: { rejected: [...rejected], identityChangedAfterPurge: Boolean(firstRunnerId && latestRunnerId && firstRunnerId !== latestRunnerId),
            previousConnectionSuperseded: Boolean(priorRunnerId && priorRunnerId !== latestRunnerId) } });
        } else if (request.method === "POST" && url.pathname === "/presentation") {
          const version = url.searchParams.get("version"); const expected = url.searchParams.get("expected");
          if (version && !/^1\.0\.[01]$/.test(version)) throw new Error("invalid_presented_version");
          if (expected && !/^1\.0\.[01]$/.test(expected)) throw new Error("invalid_expected_version");
          if (version) presentedVersion = version; if (expected) expectedVersion = expected;
          result = json({ updated: true, presentedVersion, expectedVersion });
        } else if (request.method === "POST" && url.pathname === "/shutdown") {
          result = json({ stopping: true }); setImmediate(() => void stop().finally(() => process.exit(0)));
        } else result = json({ error: "not_found" }, 404);
        response.writeHead(result.status, result.headers); response.end(result.body);
      } catch { const result = json({ error: "request_failed" }, 400); response.writeHead(result.status, result.headers); response.end(result.body); }
    });
    await listen(controlServer, CONTROL_PORT);
    const summary = {
      phase: "18A live ARM64 server", result: "READY", artifactOrigin: DISTRIBUTION_ORIGIN,
      brokerEndpoint: BROKER_ENDPOINT, controlOrigin: `http://127.0.0.1:${CONTROL_PORT}`, publicCaPath: PUBLIC_CA_PATH,
      artifact: { version: "1.0.0", runtime: `Node ${baseRelease.nodeVersion}`, protocol: baseRelease.protocolVersion,
        sha256: v100.result.artifactSha256, installerSha256: v100.installerSha256,
        manifestSignature: "Ed25519 verified by installer", reproducible: true },
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.on("SIGINT", () => void stop().finally(() => process.exit(130)));
    process.on("SIGTERM", () => void stop().finally(() => process.exit(143)));
    await new Promise(() => undefined);
  } catch (error) {
    await stop();
    throw error;
  }
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
