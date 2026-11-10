#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase6b-${Date.now()}`);
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

function addSeconds(timestamp, seconds) {
  return new Date(Date.parse(`${timestamp.replace(" ", "T")}Z`) + seconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
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

function buildCandidate(buildLinuxAssetCandidate, family = "systemd_persistence") {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `phase6b:${family}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty: "Advanced",
          duration: "60 mins",
          title: "Amniora Linux Asset Pack",
        }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family}`);
}

function validate(buildReport, candidate) {
  reportOrThrow(buildReport({ simulation: candidate.simulation, finalAssets: candidate.assets }));
}

function firstChildProcess(simulation) {
  const child = simulation.processes.find((process) => process.ppid !== 0 && process.ppid !== 1 && simulation.processes.some((parent) => parent.pid === process.ppid));
  if (!child) throw new Error("missing child process");
  return child;
}

function firstAuditedCommand(candidate) {
  const audit = asset(candidate, "assets/logs/audit.log").content;
  const command = candidate.simulation.commands.find((item) => audit.includes(`event="audit:${item.id}"`) && item.affectedFileIds.length > 0);
  if (!command) throw new Error("missing audited command with file access");
  return command;
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxProcessAuditFileSemanticReport } = require(path.join(out, "linux", "processAuditFileSemantics.js"));

  const base = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence");
  const ssh = buildCandidate(buildLinuxAssetCandidate, "ssh_key_compromise");

  expectPass("valid generated process/audit/file semantic report", () => {
    validate(buildLinuxProcessAuditFileSemanticReport, base);
    validate(buildLinuxProcessAuditFileSemanticReport, ssh);
  });

  expectFail("overlapping PID lifetimes are rejected", "LINUX_PROCESS_PID_COLLISION", () => {
    const candidate = clone(base);
    const live = candidate.simulation.processes.find((process) => !process.endedAt);
    candidate.simulation.processes.push({ ...live, id: `${live.id}:collision`, startedAt: addSeconds(live.startedAt, 1) });
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("missing process parent is rejected", "LINUX_PROCESS_PARENT_MISSING", () => {
    const candidate = clone(base);
    firstChildProcess(candidate.simulation).ppid = 999999;
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("child process before parent is rejected", "LINUX_PROCESS_ANCESTRY_INVALID", () => {
    const candidate = clone(base);
    const child = firstChildProcess(candidate.simulation);
    const parent = candidate.simulation.processes.find((process) => process.pid === child.ppid);
    child.startedAt = addSeconds(parent.startedAt, -60);
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("process end before start is rejected", "LINUX_PROCESS_CHRONOLOGY_INVALID", () => {
    const candidate = clone(base);
    const process = candidate.simulation.processes.find((item) => item.endedAt);
    process.endedAt = addSeconds(process.startedAt, -30);
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("command outside process lifetime is rejected", "LINUX_EXECUTION_OUTSIDE_PROCESS_LIFETIME", () => {
    const candidate = clone(base);
    const command = candidate.simulation.commands[0];
    const process = candidate.simulation.processes.find((item) => item.pid === command.processId);
    process.endedAt = addSeconds(command.timestamp, -1);
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("audit serial spanning multiple event IDs is rejected", "LINUX_AUDIT_SERIAL_MISMATCH", () => {
    const candidate = clone(base);
    const command = firstAuditedCommand(candidate);
    mutateAsset(candidate, "assets/logs/audit.log", (content) =>
      content.replace(new RegExp(`(type=PATH[^\\n]*event=")audit:${command.id}(")`), "$1audit:mutated:event$2")
    );
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("audit PATH after process end is rejected", "LINUX_AUDIT_PATH_AFTER_PROCESS_END", () => {
    const candidate = clone(base);
    const command = firstAuditedCommand(candidate);
    const process = candidate.simulation.processes.find((item) => item.pid === command.processId);
    const late = addSeconds(process.endedAt || command.timestamp, 60);
    mutateAsset(candidate, "assets/logs/audit.log", (content) =>
      content.replace(new RegExp(`(type=PATH msg=audit\\()${command.timestamp}(\\):[^\\n]*event="audit:${command.id}")`), `$1${late}$2`)
    );
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("audit PATH unrelated to canonical file access is rejected", "LINUX_AUDIT_PATH_UNRELATED", () => {
    const candidate = clone(base);
    const command = firstAuditedCommand(candidate);
    mutateAsset(candidate, "assets/logs/audit.log", (content) =>
      content.replace(new RegExp(`(type=PATH[^\\n]*event="audit:${command.id}"[^\\n]*name=")[^"]+(")`), "$1/tmp/not-canonical-phase6b$2")
    );
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("journalctl cannot be tied to authorized_keys as a direct file access", "LINUX_FILE_ACCESS_PATH_MISMATCH", () => {
    const candidate = clone(ssh);
    const command = candidate.simulation.commands.find((item) => /journalctl/i.test(item.renderedCommand)) || candidate.simulation.commands[0];
    const file = candidate.simulation.files.find((item) => /authorized_keys$/.test(item.path));
    if (!file) throw new Error("missing authorized_keys file");
    command.renderedCommand = "journalctl -u ssh.service";
    command.argv = ["journalctl", "-u", "ssh.service"];
    command.affectedFileIds = [file.id];
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("dead process in live process snapshot is rejected", "LINUX_PROCESS_SNAPSHOT_INVALID", () => {
    const candidate = clone(base);
    const process = candidate.simulation.processes.find((item) => item.endedAt && item.endedAt <= candidate.simulation.collection.windowEnd);
    const identity = candidate.simulation.identities.find((item) => item.id === process.identityId);
    const username = identity?.username || "root";
    mutateAsset(candidate, "assets/runtime/process_snapshot.txt", (content) =>
      `${content.trim()}\n${username.padEnd(9)} ${String(process.pid).padStart(5)} ${String(process.ppid).padStart(5)}  ${process.argv.join(" ")} ${process.startedAt} completed command\n`
    );
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("dead process in open-file snapshot is rejected", "LINUX_OPEN_FILE_PROCESS_NOT_LIVE", () => {
    const candidate = clone(base);
    const process = candidate.simulation.processes.find((item) => item.endedAt && item.endedAt <= candidate.simulation.collection.windowEnd);
    mutateAsset(candidate, "assets/runtime/open_files.txt", (content) => {
      const lines = content.split(/\r?\n/);
      const row = lines.find((line) => line.trim() && !line.startsWith("#") && !/^COMMAND\s+PID\s+/i.test(line));
      if (!row) throw new Error("missing open-file row");
      return content.replace(row, row.replace(/\s\d+\s+/, ` ${process.pid} `));
    });
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });

  expectFail("historical process history cannot claim current state", "LINUX_EVIDENCE_STATE_TYPE_CONTRADICTION", () => {
    const candidate = clone(base);
    mutateAsset(candidate, "assets/runtime/process_execution_history.txt", (content) =>
      content.replace(/historical_reconstruction/g, "current")
    );
    validate(buildLinuxProcessAuditFileSemanticReport, candidate);
  });
}

main();
