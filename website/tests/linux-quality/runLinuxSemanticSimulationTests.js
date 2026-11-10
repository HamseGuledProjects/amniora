#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const FAMILIES = [
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
const FAMILY_SEEDS = {
  misconfigured_sudoers: "phase8-matrix:Advanced:misconfigured_sudoers:0",
  ssh_bruteforce: "phase8-matrix:Advanced:ssh_bruteforce:0",
  service_account_misuse: "phase8-matrix:Advanced:service_account_misuse:0",
  ssh_key_compromise: "phase8-matrix:Advanced:ssh_key_compromise:1",
  cron_persistence: "phase8-matrix:Advanced:cron_persistence:0",
  systemd_persistence: "phase8-matrix:Advanced:systemd_persistence:0",
  unauthorized_package_install: "phase8-matrix:Advanced:unauthorized_package_install:1",
  data_staging: "phase8-matrix:Advanced:data_staging:23",
  log_tampering: "phase8-matrix:Advanced:log_tampering:0",
  reverse_shell: "phase8-matrix:Advanced:reverse_shell:10",
  docker_compromise: "phase8-matrix:Advanced:docker_compromise:1",
};

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-semantic-${Date.now()}`);
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
  if (!found) throw new Error(`${filePath} missing`);
  return found;
}

function replaceAsset(candidate, filePath, replacer) {
  const found = asset(candidate, filePath);
  found.content = replacer(found.content);
}

function expectPass(name, result) {
  if (!result.passed) {
    throw new Error(`${name}: expected pass, got ${result.issues.map((item) => item.message).join("; ")}`);
  }
  console.log(`PASS ${name}`);
}

function expectFail(name, result, pattern) {
  const text = result.issues.map((item) => `${item.category}:${item.message}`).join("; ");
  if (result.passed || !new RegExp(pattern, "i").test(text)) {
    throw new Error(`${name}: expected ${pattern}, got ${text || "pass"}`);
  }
  console.log(`PASS ${name}`);
}

function expectThrow(name, fn, pattern) {
  try {
    fn();
  } catch (error) {
    const text = String(error && error.message ? error.message : error);
    if (!new RegExp(pattern, "i").test(text)) {
      throw new Error(`${name}: expected ${pattern}, got ${text}`);
    }
    console.log(`PASS ${name}`);
    return;
  }
  throw new Error(`${name}: expected throw ${pattern}, got pass`);
}

function buildFamily(buildLinuxAssetCandidate, family) {
  const seeds = [
    ...(family && FAMILY_SEEDS[family] ? [FAMILY_SEEDS[family]] : []),
    ...Array.from({ length: 80 }, (_, attempt) => `semantic-simulation:${family || "advanced"}:${attempt}`),
  ];
  for (const seed of seeds) {
    try {
      const candidate = buildLinuxAssetCandidate({
        seed,
        generationTime: "2026-07-29T08:00:00.000Z",
        category: "Linux",
        difficulty: "Advanced",
        duration: "60 mins",
        title: "CyberLab Asset Pack",
      }, family ? { incidentFamily: family } : {});
      if (!family || candidate.investigation.incidentFamily === family) return candidate;
    } catch {
      // Keep searching; the generator can reject intentionally broken attempts.
    }
  }
  throw new Error(`could not generate ${family || "Advanced"} candidate`);
}

function validate(validateLinuxSemanticClosure, candidate) {
  return validateLinuxSemanticClosure({ simulation: candidate.simulation, finalAssets: candidate.assets });
}

function mutate(candidate, fn) {
  const copy = clone(candidate);
  fn(copy);
  return copy;
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    validateLinuxSemanticClosure,
    parseLinuxCommand,
  } = require(path.join(out, "linux", "semanticClosure.js"));
  const {
    validateLinuxSimulationEvidence,
  } = require(path.join(out, "linux", "simulation.js"));
  const {
    semanticCommandEquivalent,
    serializeLinuxCommand,
    parseDockerMount,
  } = require(path.join(out, "linux", "commandSemantics.js"));

  const base = buildFamily(buildLinuxAssetCandidate);
  const docker = buildFamily(buildLinuxAssetCandidate, "docker_compromise");
  const service = buildFamily(buildLinuxAssetCandidate, "systemd_persistence");

  expectPass("corrected generated semantic closure", validate(validateLinuxSemanticClosure, base));
  expectPass("corrected docker semantic closure", validate(validateLinuxSemanticClosure, docker));
  expectPass("corrected service semantic closure", validate(validateLinuxSemanticClosure, service));

  const dockerSock = docker.simulation.files.find((item) => item.path === "/var/run/docker.sock");
  if (!dockerSock) throw new Error("docker candidate missing canonical docker.sock");
  const dockerSockGroup = docker.simulation.groups.find((item) => item.id === dockerSock.groupId);
  if (dockerSock.fileType !== "socket" || dockerSock.mode !== 0o660 || dockerSock.ownerUid !== 0 || dockerSockGroup?.name !== "docker") {
    throw new Error(`docker.sock metadata regression ${JSON.stringify({ type: dockerSock.fileType, mode: dockerSock.mode, ownerUid: dockerSock.ownerUid, group: dockerSockGroup?.name })}`);
  }
  const dockerRuntimeDir = docker.simulation.files.find((item) => item.path === "/var/lib/docker");
  if (!dockerRuntimeDir || dockerRuntimeDir.fileType !== "directory") {
    throw new Error("docker runtime directory boundary regression");
  }
  if (!/^\/var\/run\/docker\.sock\s+srw-rw----\s+root\s+docker$/m.test(asset(docker, "assets/reports/permissions_report.txt").content)) {
    throw new Error("permissions_report does not render docker.sock as a socket");
  }
  if (!/^docker,/m.test(asset(docker, "assets/csv/groups.csv").content) || !/^docker:x:998:/m.test(asset(docker, "assets/accounts/group.sample").content)) {
    throw new Error("docker group inventory regression");
  }
  const renderedText = [base, docker, service].map((candidate) => [
    ...candidate.assets.map((item) => item.content),
    ...candidate.simulation.commands.map((item) => item.renderedCommand),
  ].join("\n")).join("\n");
  if (/ops-maintenance-chek/i.test(renderedText)) {
    throw new Error("legacy maintenance-check typo leaked into generated Linux artifacts");
  }
  console.log("PASS docker socket metadata and maintenance-check typo guard");

  expectThrow("socket rendered as regular file fails validation", () => {
    const broken = buildFamily(buildLinuxAssetCandidate, "docker_compromise");
    const file = broken.simulation.files.find((item) => item.path === "/var/run/docker.sock");
    file.fileType = "regular";
    replaceAsset(broken, "assets/reports/permissions_report.txt", (content) =>
      content.replace(/^\/var\/run\/docker\.sock\s+srw-rw----/m, "/var/run/docker.sock -rw-rw----")
    );
    validateLinuxSimulationEvidence(broken.simulation, broken.assets);
  }, "docker\\.sock|socket|regular");

  const roundTripCommands = [
    "cat /etc/group",
    "systemctl status ssh.service",
    "journalctl -u ssh",
    "cp /etc/hosts /tmp/hosts.copy",
    "chmod 0640 /tmp/hosts.copy",
    "apt install ncat",
    "docker run --name portal-worker -d -v /srv/shared:/mnt/shared:ro registry.local/platform/portal-worker:2026.07",
    "docker inspect portal-worker",
  ];
  for (const command of roundTripCommands) {
    const parsed = parseLinuxCommand(command);
    const reparsed = parseLinuxCommand(serializeLinuxCommand(parsed));
    if (!semanticCommandEquivalent(parsed, reparsed) || parsed.issues.length > 0) {
      throw new Error(`round-trip failed for ${command}`);
    }
  }
  console.log("PASS typed command round-trip");

  const validMount = parseDockerMount("/srv/shared:/mnt/shared:ro");
  if (!validMount || validMount.sourcePath !== "/srv/shared" || validMount.destinationPath !== "/mnt/shared" || !validMount.readOnly) {
    throw new Error("valid bind mount did not parse");
  }
  console.log("PASS typed bind mount parse");

  const cases = [
    ["docker run without image fails", docker, (c) => {
      const command = c.simulation.commands.find((item) => item.renderedCommand.includes("docker run"));
      command.renderedCommand = "docker run -v /srv/shared:/mnt/shared";
      command.argv = command.renderedCommand.split(/\s+/);
    }, "missing image"],
    ["docker inspect nonexistent container fails", docker, (c) => {
      const command = c.simulation.commands.find((item) => item.renderedCommand.includes("docker inspect"));
      command.renderedCommand = "docker inspect ghost-worker";
      command.argv = command.renderedCommand.split(/\s+/);
    }, "nonexistent container"],
    ["cat without target fails", base, (c) => {
      const command = c.simulation.commands.find((item) => item.renderedCommand.startsWith("cat "));
      if (!command) c.simulation.commands[0].renderedCommand = "cat";
      else command.renderedCommand = "cat";
      (command || c.simulation.commands[0]).argv = ["cat"];
    }, "cat requires"],
    ["systemctl without unit fails", base, (c) => {
      c.simulation.commands[0].renderedCommand = "systemctl restart";
      c.simulation.commands[0].argv = ["systemctl", "restart"];
    }, "systemctl action requires unit"],
    ["malformed mount argument fails", docker, (c) => {
      const command = c.simulation.commands.find((item) => item.renderedCommand.includes("docker run"));
      command.renderedCommand = command.renderedCommand.replace("/srv/shared:/mnt/shared:ro", "/srv/shared");
      command.argv = command.renderedCommand.split(/\s+/);
    }, "malformed docker mount"],
    ["mount expression as file fails", docker, (c) => {
      c.simulation.files.push({ ...c.simulation.files[0], id: "file:bad-mount", path: "/srv/shared:/mnt/shared" });
    }, "mount specification"],
    ["completed process in snapshot fails", base, (c) => {
      const command = c.simulation.commands.find((item) => item.kind === "primary_incident") || c.simulation.commands.find((item) => item.id.startsWith("command:incident:"));
      const process = c.simulation.processes.find((item) => item.commandId === command.id);
      process.endedAt = c.simulation.collection.windowStart;
      replaceAsset(c, "assets/runtime/process_snapshot.txt", (content) =>
        `${content.trim()}\n${"root".padEnd(9)} ${String(process.pid).padStart(5)} ${String(process.ppid).padStart(5)}  ${process.argv.join(" ")}\n`
      );
    }, "appears in snapshot after exit"],
    ["child retains dead parent fails", base, (c) => {
      const command = c.simulation.commands.find((item) => item.kind === "primary_incident") || c.simulation.commands.find((item) => item.id.startsWith("command:incident:"));
      const child = c.simulation.processes.find((item) => item.commandId === command.id);
      const parent = c.simulation.processes.find((item) => item.pid === child.ppid);
      parent.endedAt = c.simulation.collection.windowStart;
    }, "parent exited"],
    ["cron execution mismatch fails", base, (c) => {
      const execution = c.simulation.scheduledExecutions[0];
      execution.occurredAt = execution.occurredAt.replace(/:\d\d:10$/, ":59:10");
    }, "does not match"],
    ["blocked SSH source fails", base, (c) => {
      replaceAsset(c, "assets/network/ufw_status.txt", (content) => content.split(/\r?\n/).filter((line) => !/22\/tcp\s+ALLOW/i.test(line)).join("\n"));
    }, "firewall"],
    ["missing listener fails", base, (c) => {
      replaceAsset(c, "assets/network/listening_ports.txt", (content) => content.replace(/^.*:22.*sshd.*\n?/gim, ""));
    }, "listener"],
    ["bare sudo command fails", base, (c) => {
      replaceAsset(c, "assets/configs/sudoers.d/platform", (content) => content.replace(/\/usr\/bin\/([a-z0-9.-]+)/i, "$1"));
    }, "not absolute"],
    ["successful sudo no matching rule fails", base, (c) => {
      replaceAsset(c, "assets/configs/sudoers.d/platform", () => "root ALL=(ALL:ALL) ALL\n");
      replaceAsset(c, "assets/configs/linux_config_pack.txt", (content) => content.replace(/^.*NOPASSWD:.*$/gm, ""));
    }, "without matching"],
    ["config summary contradiction fails", base, (c) => {
      replaceAsset(c, "assets/configs/linux_config_pack.txt", (content) => content.replace(/PasswordAuthentication\s+\S+/, "PasswordAuthentication maybe"));
    }, "contradicts"],
    ["last_login before auth fails", base, (c) => {
      const user = c.simulation.sshSessions[0].username;
      replaceAsset(c, "assets/csv/users.csv", (content) => content.split(/\r?\n/).map((line, index) => {
        if (index === 0 || !line.startsWith(`${user},`)) return line;
        const cells = line.split(",");
        cells[3] = "2020-01-01 00:00";
        return cells.join(",");
      }).join("\n"));
    }, "last_login"],
    ["placeholder known host fails", base, (c) => {
      replaceAsset(c, `assets/ssh/${c.investigation.primaryUser}/known_hosts`, () => "web,10.0.0.10 ssh-ed25519 AAAAC3NzaKnownHostWeb\n");
    }, "placeholder"],
    ["risk row without evidence fails", base, (c) => {
      replaceAsset(c, "assets/evidence/risk_register.csv", (content) => {
        const lines = content.trim().split(/\r?\n/);
        const header = lines[0].split(",");
        const evidenceIndex = header.indexOf("evidence");
        if (evidenceIndex < 0 || lines.length < 2) return content;
        const cells = lines[1].split(",");
        cells[evidenceIndex] = "";
        lines[1] = cells.join(",");
        return `${lines.join("\n")}\n`;
      });
    }, "evidence"],
    ["sensitive path without classification fails", base, (c) => {
      replaceAsset(c, "assets/evidence/risk_register.csv", (content) => `${content.trim()}\nR-extra,sensitive path exposure,high,open,,restricted host path mounted,${c.simulation.commands[0].id}\n`);
    }, "sensitivity"],
    ["service task missing journal evidence fails", service, (c) => {
      const task = c.simulation.canonicalTasks.find((item) => item.intent === "service_state");
      if (!task) throw new Error("service-state task missing from service blueprint");
      task.selectedEvidenceAssetIds = [];
    }, "service-state"],
  ];

  for (const [name, source, apply, pattern] of cases) {
    expectFail(name, validate(validateLinuxSemanticClosure, mutate(source, apply)), pattern);
  }

  const families = new Set();
  for (const family of FAMILIES) {
    try {
      const candidate = buildFamily(buildLinuxAssetCandidate, family);
      families.add(candidate.investigation.incidentFamily);
    } catch (error) {
      throw new Error(`family ${family} failed deterministic fixture generation: ${error.message || error}`);
    }
  }
  if (families.size !== 11) throw new Error(`family coverage incomplete: ${Array.from(families).join(",")}`);
  console.log(`PASS semantic family coverage ${families.size}/11`);

  console.log(JSON.stringify({ passed: true, broken: cases.length, roundTrips: roundTripCommands.length, families: families.size }, null, 2));
}

main();
