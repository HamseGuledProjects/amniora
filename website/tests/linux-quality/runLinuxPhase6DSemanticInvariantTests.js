#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase6d-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing ${filePath}`);
  return found;
}

function mutateAsset(candidate, filePath, replacer) {
  const found = asset(candidate, filePath);
  found.content = replacer(found.content);
}

function expectPass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

function expectFail(name, expectedCode, fn) {
  try {
    fn();
    throw new Error("__NO_FAILURE__");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message === "__NO_FAILURE__") throw new Error(`${name}: expected ${expectedCode}`);
    if (!message.includes(expectedCode)) throw new Error(`${name}: expected ${expectedCode}, got ${message}`);
    console.log(`PASS ${name}: ${expectedCode}`);
  }
}

function reportOrThrow(report) {
  if (report.status !== "valid") {
    throw new Error(report.issues.map((issue) => `${issue.code}:${issue.message}`).join("; "));
  }
}

function validate(buildReport, candidate) {
  reportOrThrow(buildReport({ simulation: candidate.simulation, finalAssets: candidate.assets }));
}

function buildCandidate(buildLinuxAssetCandidate, family, difficulty = "Advanced") {
  let lastError;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `phase6d:${difficulty}:${family}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
          title: "Amniora Linux Asset Pack",
        }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${difficulty} ${family}`);
}

function firstRenderedListener(candidate) {
  const match = asset(candidate, "assets/network/listening_ports.txt").content.match(/\n(\S+)\s+LISTEN\s+(\S+):(\d+)\s+.+?\s+pid=(\d+)/i);
  if (!match) throw new Error("missing rendered listener row");
  return {
    raw: match[0].trim(),
    port: Number(match[3]),
    pid: Number(match[4]),
  };
}

function firstLiveProcess(candidate) {
  const process = candidate.simulation.processes.find((item) => !item.endedAt || item.endedAt > candidate.simulation.collection.windowEnd);
  if (!process) throw new Error("missing live process");
  return process;
}

function run() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxNetworkContainerLogSemanticReport } = require(path.join(out, "linux", "networkContainerLogSemantics.js"));

  const families = [
    "misconfigured_sudoers",
    "ssh_bruteforce",
    "service_account_misuse",
    "ssh_key_compromise",
    "cron_persistence",
    "systemd_persistence",
    "unauthorized_package_install",
    "data_staging",
    "log_tampering",
    "reverse_shell",
    "docker_compromise",
  ];
  const difficulties = ["Beginner", "Intermediate", "Advanced"];

  for (const difficulty of difficulties) {
    for (const family of families) {
      expectPass(`${difficulty} ${family} phase 6D semantic report`, () =>
        validate(buildLinuxNetworkContainerLogSemanticReport, buildCandidate(buildLinuxAssetCandidate, family, difficulty))
      );
    }
  }

  const ssh = buildCandidate(buildLinuxAssetCandidate, "ssh_key_compromise");
  const reverse = buildCandidate(buildLinuxAssetCandidate, "reverse_shell");
  const docker = buildCandidate(buildLinuxAssetCandidate, "docker_compromise");
  const logTampering = buildCandidate(buildLinuxAssetCandidate, "log_tampering");
  const database = buildCandidate(buildLinuxAssetCandidate, "data_staging");
  const systemd = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence");

  expectFail("route source mismatch is rejected", "LINUX_NETWORK_ROUTE_INVALID", () => {
    const candidate = clone(ssh);
    mutateAsset(candidate, "assets/network/routing_table.txt", (content) =>
      content.replace(`src ${candidate.simulation.investigation.hostIp}`, "src 203.0.113.200")
    );
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectFail("listener PID mismatch is rejected", "LINUX_NETWORK_LISTENER_STATE_MISMATCH", () => {
    const candidate = clone(ssh);
    const listener = firstRenderedListener(candidate);
    mutateAsset(candidate, "assets/network/listening_ports.txt", (content) =>
      content.replace(`pid=${listener.pid}`, `pid=${listener.pid + 90000}`)
    );
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectFail("invalid rendered endpoint is rejected", "LINUX_NETWORK_ENDPOINT_INVALID", () => {
    const candidate = clone(ssh);
    const listener = firstRenderedListener(candidate);
    mutateAsset(candidate, "assets/network/listening_ports.txt", (content) =>
      content.replace(`:${listener.port}`, ":70000")
    );
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectFail("firewall denial of successful SSH is rejected", "LINUX_FIREWALL_DECISION_MISMATCH", () => {
    const candidate = clone(ssh);
    mutateAsset(candidate, "assets/network/ufw_status.txt", (content) => content.replace(/\bALLOW\b/g, "DENY"));
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectFail("reverse shell missing established connection is rejected", "LINUX_REVERSE_SHELL_CONNECTION_MISSING", () => {
    const candidate = clone(reverse);
    const remote = candidate.simulation.investigation.externalIps[0];
    mutateAsset(candidate, "assets/network/listening_ports.txt", (content) =>
      content.split(/\r?\n/).filter((line) => !line.includes(`${remote}:4444`)).join("\n")
    );
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectFail("Docker socket access without file lifecycle support is rejected", "LINUX_DOCKER_SOCKET_ACCESS_INVALID", () => {
    const candidate = clone(docker);
    mutateAsset(candidate, "assets/runtime/file_access_history.csv", (content) =>
      content.split(/\r?\n/).filter((line) => !line.includes("/var/run/docker.sock")).join("\n")
    );
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectFail("Docker bind mount outside canonical host files is rejected", "LINUX_DOCKER_MOUNT_INVALID", () => {
    const candidate = clone(docker);
    const command = candidate.simulation.commands.find((item) => /\bdocker\s+run\b/i.test(item.renderedCommand));
    if (!command) throw new Error("missing docker run command");
    command.renderedCommand = command.renderedCommand.replace(/-v\s+([^:\s]+):/, "-v /srv/not-canonical:");
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectFail("log truncation without file lifecycle support is rejected", "LINUX_LOG_TRUNCATION_UNSUPPORTED", () => {
    const candidate = clone(logTampering);
    mutateAsset(candidate, "assets/runtime/file_access_history.csv", (content) =>
      content.split(/\r?\n/).filter((line) => !line.includes("/var/log/auth.log")).join("\n")
    );
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectFail("unsupported AppArmor profile is rejected", "LINUX_SECURITY_CONTROL_EVENT_MISMATCH", () => {
    const candidate = clone(systemd);
    mutateAsset(candidate, "assets/logs/kern.log", (content) =>
      `${content.trim()}\n${candidate.simulation.collection.windowEnd} ${candidate.simulation.investigation.hostname} kernel: audit: apparmor="STATUS" operation="profile_replace" profile="unknown.phase6d"\n`
    );
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectFail("database host external postgres listener is rejected", "LINUX_ROLE_NETWORK_REALISM_MISMATCH", () => {
    const candidate = clone(database);
    candidate.simulation.investigation.hostRole = "database host";
    const process = firstLiveProcess(candidate);
    mutateAsset(candidate, "assets/network/listening_ports.txt", (content) =>
      `${content.trim()}\ntcp   LISTEN 0.0.0.0:5432          postgres pid=${process.pid}\n`
    );
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectFail("active service without canonical listener relationship is rejected", "LINUX_CROSS_DOMAIN_RELATIONSHIP_INVALID", () => {
    const candidate = clone(systemd);
    const descriptor = candidate.simulation.openFileDescriptors.find((item) =>
      item.descriptorType === "listening_socket" &&
      item.relatedServiceId
    );
    if (!descriptor) throw new Error("missing service listener descriptor");
    candidate.simulation.serviceTransitions.push({
      id: "transition:phase6d:listener-relationship",
      serviceId: descriptor.relatedServiceId,
      operation: "restart",
      cause: { type: "command", commandId: candidate.simulation.commands[0]?.id },
      occurredAt: candidate.simulation.collection.windowStart,
      processId: String(descriptor.pid),
      outcome: "success",
      resultingState: {
        loadState: "loaded",
        unitFileState: "enabled",
        activeState: "active",
        subState: "running",
        result: "success",
      },
      expectedRenderTargets: ["service_inventory"],
    });
    candidate.simulation.openFileDescriptors = candidate.simulation.openFileDescriptors.filter((item) => item.id !== descriptor.id);
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });

  expectPass("rendered listener rows expose live canonical processes", () => {
    const candidate = clone(ssh);
    const process = firstLiveProcess(candidate);
    if (!asset(candidate, "assets/runtime/process_snapshot.txt").content.includes(String(process.pid))) {
      throw new Error("live process missing from process snapshot");
    }
    validate(buildLinuxNetworkContainerLogSemanticReport, candidate);
  });
}

run();
