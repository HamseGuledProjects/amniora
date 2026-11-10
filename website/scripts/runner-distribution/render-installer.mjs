#!/usr/bin/env node
import { createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const placeholders = new Set([
  "RUNNER_VERSION", "PROTOCOL_VERSION", "MINIMUM_COMPATIBLE_VERSION", "MINIMUM_DOCKER_VERSION",
  "DISTRIBUTION_ORIGIN", "BROKER_HOST", "BROKER_PORT", "BROKER_SERVER_NAME", "MANIFEST_PUBLIC_KEY_B64",
]);

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function parseDistributionOrigin(value) {
  const origin = new URL(value);
  const port = origin.port ? Number(origin.port) : 443;
  if (origin.protocol !== "https:" || origin.hostname !== "runner.portfolio.example.test" ||
      !Number.isSafeInteger(port) || (port !== 443 && port < 1_024) || port > 65_535 || origin.pathname !== "/" ||
      origin.username || origin.password || origin.search || origin.hash) {
    throw new Error("invalid_runner_distribution_origin");
  }
  return origin.origin;
}

function parseEndpoint(value) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:" || endpoint.hostname !== "broker.runner.portfolio.example.test" ||
      endpoint.pathname !== "/connect" || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash) throw new Error("invalid_runner_broker_endpoint");
  return { host: endpoint.hostname, port: endpoint.port || "443", serverName: endpoint.hostname };
}

export async function renderInstaller({
  outputPath,
  manifestPublicKeyPath,
  releaseMetadata,
  distributionOrigin,
  brokerEndpoint,
}) {
  if (!path.isAbsolute(outputPath) || !path.isAbsolute(manifestPublicKeyPath)) throw new Error("installer_paths_must_be_absolute");
  const release = releaseMetadata
    ? structuredClone(releaseMetadata)
    : JSON.parse(await readFile(path.join(repositoryRoot, "runner-distribution/release.json"), "utf8"));
  if (!release || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(release.runnerVersion) ||
      release.protocolVersion !== "1.0" || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(release.minimumCompatibleVersion) ||
      !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(release.minimumDockerVersion)) {
    throw new Error("invalid_runner_release_metadata");
  }
  const template = await readFile(path.join(repositoryRoot, "runner-distribution/linux/install.sh"), "utf8");
  const publicKeyBytes = await readFile(manifestPublicKeyPath);
  const publicKey = createPublicKey(publicKeyBytes);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("manifest_public_key_must_be_ed25519");
  const endpoint = parseEndpoint(brokerEndpoint ?? release.brokerEndpoint);
  const values = {
    RUNNER_VERSION: release.runnerVersion,
    PROTOCOL_VERSION: release.protocolVersion,
    MINIMUM_COMPATIBLE_VERSION: release.minimumCompatibleVersion,
    MINIMUM_DOCKER_VERSION: release.minimumDockerVersion,
    DISTRIBUTION_ORIGIN: parseDistributionOrigin(distributionOrigin ?? release.distributionOrigin),
    BROKER_HOST: endpoint.host,
    BROKER_PORT: endpoint.port,
    BROKER_SERVER_NAME: endpoint.serverName,
    MANIFEST_PUBLIC_KEY_B64: publicKeyBytes.toString("base64"),
  };
  let rendered = template;
  for (const placeholder of placeholders) rendered = rendered.replaceAll(`@@${placeholder}@@`, values[placeholder]);
  if (/@@[A-Z0-9_]+@@/.test(rendered)) throw new Error("unresolved_installer_placeholder");
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o750 });
  await writeFile(outputPath, rendered, { mode: 0o755 });
  return { outputPath, sha256: sha256(rendered), version: release.runnerVersion };
}

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]; const value = values[index + 1];
    if (!key || value === undefined) throw new Error("invalid_render_installer_arguments");
    if (key === "--output") options.outputPath = path.resolve(value);
    else if (key === "--manifest-public-key") options.manifestPublicKeyPath = path.resolve(value);
    else throw new Error("invalid_render_installer_arguments");
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  renderInstaller(parseArguments(process.argv.slice(2))).then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => { process.stderr.write(`${error?.message || "render_installer_failed"}\n`); process.exitCode = 1; });
}
