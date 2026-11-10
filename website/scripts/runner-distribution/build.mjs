#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, sign, X509Certificate } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, chmod, copyFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const releasePath = path.join(repositoryRoot, "runner-distribution/release.json");
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const COMMIT = /^[0-9a-f]{40}$/;
const ARCHITECTURES = new Set(["amd64", "arm64"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertRelease(release) {
  if (!release || release.schemaVersion !== 1 || !VERSION.test(release.runnerVersion) ||
      release.protocolVersion !== "1.0" || !VERSION.test(release.minimumCompatibleVersion) ||
      release.supportedOs !== "ubuntu-24.04" || !VERSION.test(release.minimumDockerVersion) ||
      !VERSION.test(release.nodeVersion) || !Number.isSafeInteger(release.sourceDateEpoch) ||
      release.sourceDateEpoch < 1_700_000_000 || release.distributionOrigin !== "https://runner.portfolio.example.test" ||
      release.installerPath !== `/runner/installers/${release.runnerVersion}/install.sh` ||
      !release.brokerEndpoint.startsWith("https://broker.runner.portfolio.example.test:") ||
      !release.architectures || Object.keys(release.architectures).sort().join(",") !== "amd64,arm64") {
    throw new Error("invalid_runner_release_metadata");
  }
  for (const architecture of ARCHITECTURES) {
    const source = release.architectures[architecture];
    const expectedNodeArchitecture = architecture === "amd64" ? "x64" : "arm64";
    if (!source || source.nodeArchitecture !== expectedNodeArchitecture ||
        source.nodeArchive !== `node-v${release.nodeVersion}-linux-${expectedNodeArchitecture}.tar.xz` ||
        !/^[0-9a-f]{64}$/.test(source.nodeArchiveSha256)) {
      throw new Error("invalid_runner_runtime_source");
    }
  }
  if (JSON.stringify(release).includes("latest")) throw new Error("mutable_runner_release_reference");
  return release;
}

async function readRelease() {
  return assertRelease(JSON.parse(await readFile(releasePath, "utf8")));
}

async function run(command, args, options = {}) {
  try {
    return await exec(command, args, { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024, ...options });
  } catch (error) {
    throw new Error(`runner_distribution_command_failed:${path.basename(command)}:${error.code ?? "unknown"}`);
  }
}

async function downloadPinnedNode(release, architecture, directory) {
  const source = release.architectures[architecture];
  const url = `https://nodejs.org/dist/v${release.nodeVersion}/${source.nodeArchive}`;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || response.url !== url) throw new Error("node_runtime_download_failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== source.nodeArchiveSha256) throw new Error("node_runtime_checksum_mismatch");
  const target = path.join(directory, source.nodeArchive);
  await writeFile(target, bytes, { mode: 0o600, flag: "wx" });
  return target;
}

async function extractPinnedNode(release, architecture, archive, target) {
  const source = release.architectures[architecture];
  const bytes = await readFile(archive);
  if (sha256(bytes) !== source.nodeArchiveSha256) throw new Error("node_runtime_checksum_mismatch");
  const member = `node-v${release.nodeVersion}-linux-${source.nodeArchitecture}/bin/node`;
  const listing = (await run("tar", ["-tJf", archive])).stdout.split("\n").filter(Boolean);
  if (!listing.includes(member) || listing.some(value => value.startsWith("/") || value.split("/").includes(".."))) {
    throw new Error("unsafe_node_runtime_archive");
  }
  await mkdir(path.dirname(target), { recursive: true, mode: 0o750 });
  const extracted = (await run("tar", ["-xJOf", archive, member], { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 })).stdout;
  await writeFile(target, extracted, { mode: 0o750, flag: "wx" });
}

async function compileRunner(target) {
  const output = path.join(target, "lib");
  await mkdir(output, { recursive: true, mode: 0o750 });
  await run(path.join(repositoryRoot, "node_modules/.bin/tsc"), [
    path.join(repositoryRoot, "lib/web-lab/byo-runner/runtime-cli.ts"),
    "--outDir", output,
    "--rootDir", path.join(repositoryRoot, "lib/web-lab"),
    "--module", "commonjs",
    "--target", "ES2022",
    "--moduleResolution", "node",
    "--esModuleInterop",
    "--skipLibCheck",
  ]);
  await writeFile(path.join(output, "entry.cjs"), [
    "#!/usr/bin/env node",
    '"use strict";',
    'require("./byo-runner/runtime-cli.js").runByoRuntimeCli().catch(() => {',
    '  process.stderr.write("RUNNER_START_FAILED\\n");',
    "  process.exitCode = 1;",
    "});",
    "",
  ].join("\n"), { mode: 0o640 });
}

async function copyRuntimeAssets(target, release, architecture, options) {
  const containerTarget = path.join(target, "share/container");
  const trustTarget = path.join(target, "share/trust");
  const systemdTarget = path.join(target, "share/systemd");
  const binTarget = path.join(target, "bin");
  await Promise.all([containerTarget, trustTarget, systemdTarget, binTarget].map(directory => mkdir(directory, { recursive: true, mode: 0o750 })));
  for (const filename of ["Dockerfile", "challenge-server.cjs", "ingress-proxy.cjs"]) {
    await copyFile(path.join(repositoryRoot, "lib/web-lab/local-runner/container", filename), path.join(containerTarget, filename));
  }
  const brokerCa = await readFile(options.brokerCaPath);
  try { new X509Certificate(brokerCa); } catch { throw new Error("invalid_runner_broker_ca"); }
  let verificationKeys;
  try { verificationKeys = JSON.parse(await readFile(options.packageVerificationKeysPath, "utf8")); }
  catch { throw new Error("invalid_runner_package_verification_keys"); }
  if (!verificationKeys || verificationKeys.schemaVersion !== 1 || !Array.isArray(verificationKeys.keys) ||
      verificationKeys.keys.length < 1 || verificationKeys.keys.length > 8) {
    throw new Error("invalid_runner_package_verification_keys");
  }
  for (const key of verificationKeys.keys) {
    if (!key || typeof key.keyId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(key.keyId) ||
        typeof key.publicKey !== "string" || createPublicKey(key.publicKey).asymmetricKeyType !== "ed25519") {
      throw new Error("invalid_runner_package_verification_keys");
    }
  }
  await writeFile(path.join(trustTarget, "broker-ca.pem"), brokerCa, { mode: 0o640 });
  await writeFile(path.join(trustTarget, "package-verification-keys.json"), `${JSON.stringify(verificationKeys)}\n`, { mode: 0o640 });
  await copyFile(path.join(repositoryRoot, "runner-distribution/linux/amniora-runner-launch"), path.join(binTarget, "amniora-runner-launch"));
  await copyFile(path.join(repositoryRoot, "runner-distribution/linux/amniora-runner-uninstall"), path.join(binTarget, "amniora-runner-uninstall"));
  await copyFile(path.join(repositoryRoot, "runner-distribution/linux/amniora-runner.service"), path.join(systemdTarget, "amniora-runner.service"));
  await writeFile(path.join(target, "release.json"), `${JSON.stringify({
    schemaVersion: 1,
    runnerVersion: release.runnerVersion,
    protocolVersion: release.protocolVersion,
    minimumCompatibleVersion: release.minimumCompatibleVersion,
    supportedOs: release.supportedOs,
    architecture,
    nodeVersion: release.nodeVersion,
    sourceCommit: options.sourceCommit,
  }, null, 2)}\n`, { mode: 0o640 });
}

async function filesBelow(directory, prefix = "") {
  const values = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error("runner_artifact_symlink_forbidden");
    if (entry.isDirectory()) values.push(...await filesBelow(directory, relative));
    else if (entry.isFile()) values.push(relative);
    else throw new Error("runner_artifact_special_file_forbidden");
  }
  return values.sort();
}

function writeString(header, offset, length, value) {
  const bytes = Buffer.from(value);
  if (bytes.length > length) throw new Error("runner_artifact_path_too_long");
  bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  if (encoded.length >= length) throw new Error("runner_artifact_value_too_large");
  writeString(header, offset, length, `${encoded}\0`);
}

function tarHeader(name, mode, size, mtime) {
  const header = Buffer.alloc(512);
  let filename = name;
  let prefix = "";
  if (Buffer.byteLength(filename) > 100) {
    const split = filename.lastIndexOf("/", 99);
    if (split < 1) throw new Error("runner_artifact_path_too_long");
    prefix = filename.slice(0, split);
    filename = filename.slice(split + 1);
    if (Buffer.byteLength(prefix) > 155) throw new Error("runner_artifact_path_too_long");
  }
  writeString(header, 0, 100, filename);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtime);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "root");
  writeString(header, 297, 32, "root");
  writeString(header, 345, 155, prefix);
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

async function deterministicArchive(directory, files, modes, mtime) {
  const blocks = [];
  for (const relative of files) {
    const bytes = await readFile(path.join(directory, relative));
    blocks.push(tarHeader(relative, modes.get(relative), bytes.length, mtime), bytes);
    const remainder = bytes.length % 512;
    if (remainder) blocks.push(Buffer.alloc(512 - remainder));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
}

function modeFor(relative) {
  return relative === "bin/node" || relative === "bin/amniora-runner-launch" || relative === "bin/amniora-runner-uninstall"
    ? 0o750 : 0o640;
}

function manifestFor(release, architecture, sourceCommit, artifactName, artifactBytes, fileDetails) {
  const lines = [
    "AMNIORA-RUNNER-MANIFEST 1",
    `runnerVersion=${release.runnerVersion}`,
    `protocolVersion=${release.protocolVersion}`,
    `minimumCompatibleVersion=${release.minimumCompatibleVersion}`,
    "os=linux",
    `distribution=${release.supportedOs}`,
    `architecture=${architecture}`,
    `nodeVersion=${release.nodeVersion}`,
    `sourceCommit=${sourceCommit}`,
    `sourceDateEpoch=${release.sourceDateEpoch}`,
    `artifact=${artifactName}`,
    `artifactSha256=${sha256(artifactBytes)}`,
    ...fileDetails.map(value => `file=${value.sha256} ${value.mode.toString(8).padStart(4, "0")} ${value.size} ${value.path}`),
    "",
  ];
  return Buffer.from(lines.join("\n"));
}

export async function buildRunnerDistribution(options) {
  const release = options.releaseMetadata ? assertRelease(structuredClone(options.releaseMetadata)) : await readRelease();
  const architecture = options.architecture;
  if (!ARCHITECTURES.has(architecture) || !COMMIT.test(options.sourceCommit || "")) throw new Error("invalid_runner_build_input");
  for (const key of ["outputDirectory", "signingKeyPath", "brokerCaPath", "packageVerificationKeysPath"]) {
    if (!path.isAbsolute(options[key] || "")) throw new Error("runner_build_paths_must_be_absolute");
  }
  if (!options.nodeArchivePath && !options.nodeBinaryPath && !options.downloadNode) throw new Error("node_runtime_required");
  if (options.nodeBinaryPath && options.nodeArchivePath) throw new Error("ambiguous_node_runtime");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "amniora-runner-build-"));
  try {
    const stage = path.join(temporary, "stage");
    await mkdir(stage, { recursive: true, mode: 0o750 });
    await compileRunner(stage);
    await copyRuntimeAssets(stage, release, architecture, options);
    if (options.nodeBinaryPath) {
      await copyFile(options.nodeBinaryPath, path.join(stage, "bin/node"));
      await chmod(path.join(stage, "bin/node"), 0o750);
    } else {
      const archive = options.nodeArchivePath || await downloadPinnedNode(release, architecture, temporary);
      await extractPinnedNode(release, architecture, archive, path.join(stage, "bin/node"));
    }
    const files = await filesBelow(stage);
    const modes = new Map(files.map(relative => [relative, modeFor(relative)]));
    await Promise.all(files.map(relative => chmod(path.join(stage, relative), modes.get(relative))));
    const fileDetails = await Promise.all(files.map(async relative => {
      const bytes = await readFile(path.join(stage, relative));
      return { path: relative, mode: modes.get(relative), size: bytes.length, sha256: sha256(bytes) };
    }));
    const artifactName = `amniora-runner-${release.runnerVersion}-linux-${architecture}.tar.gz`;
    const artifact = await deterministicArchive(stage, files, modes, release.sourceDateEpoch);
    const manifest = manifestFor(release, architecture, options.sourceCommit, artifactName, artifact, fileDetails);
    const signingKey = createPrivateKey(await readFile(options.signingKeyPath));
    if (signingKey.asymmetricKeyType !== "ed25519") throw new Error("runner_manifest_signing_key_must_be_ed25519");
    const signature = sign(null, manifest, signingKey);
    await mkdir(options.outputDirectory, { recursive: true, mode: 0o750 });
    const base = path.join(options.outputDirectory, artifactName);
    await Promise.all([
      writeFile(base, artifact, { mode: 0o640 }),
      writeFile(`${base}.manifest`, manifest, { mode: 0o640 }),
      writeFile(`${base}.manifest.sig`, signature, { mode: 0o640 }),
    ]);
    return { artifactPath: base, manifestPath: `${base}.manifest`, signaturePath: `${base}.manifest.sig`, artifactSha256: sha256(artifact) };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("invalid_runner_build_arguments");
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!["architecture", "outputDirectory", "signingKeyPath", "brokerCaPath", "packageVerificationKeysPath", "sourceCommit", "nodeArchivePath"].includes(name)) {
      throw new Error("invalid_runner_build_arguments");
    }
    options[name] = name.endsWith("Path") || name === "outputDirectory" ? path.resolve(value) : value;
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildRunnerDistribution(parseArguments(process.argv.slice(2))).then(result => {
    process.stdout.write(`${JSON.stringify({ ...result, signed: true, privateKeyPrinted: false })}\n`);
  }).catch(error => {
    process.stderr.write(`${error?.message || "runner_distribution_build_failed"}\n`);
    process.exitCode = 1;
  });
}
