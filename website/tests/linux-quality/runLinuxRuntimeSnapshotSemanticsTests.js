// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output root.");

const { buildLinuxAssetCandidate } = require(`${out}/lib/lab-assets/linux/index.js`);
const { validateLinuxSimulationEvidence } = require(`${out}/lib/lab-assets/linux/simulation.js`);


function buildFamily(family) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `runtime-snapshot:${family}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
        difficulty: "Advanced",
        duration: "60 mins",
        title: "CyberLab Asset Pack",
      }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Could not build ${family}`);
}

function asset(candidate, path) {
  const found = candidate.assets.find((item) => item.file_path === path);
  if (!found) throw new Error(`missing asset ${path}`);
  return found.content;
}

function liveRows(candidate) {
  return asset(candidate, "assets/runtime/process_snapshot.txt")
    .split(/\r?\n/)
    .filter((line) => /^\S+\s+\d+\s+\d+\s+/.test(line));
}

function openRows(candidate) {
  return asset(candidate, "assets/runtime/open_files.txt")
    .split(/\r?\n/)
    .filter((line) => /^\S+\s+\d+\s+\S+\s+/.test(line));
}

function history(candidate) {
  return `${asset(candidate, "assets/runtime/process_execution_history.txt")}\n${asset(candidate, "assets/runtime/file_access_history.csv")}`;
}

function commandProcess(candidate, pattern) {
  const command = candidate.simulation.commands.find((item) => pattern.test(item.renderedCommand));
  if (!command) throw new Error(`missing command ${pattern}`);
  const process = candidate.simulation.processes.find((item) => item.pid === command.processId);
  if (!process) throw new Error(`missing process for ${command.renderedCommand}`);
  return { command, process };
}

function assertCompletedAbsentFromLive(candidate, pattern, label) {
  const { command, process } = commandProcess(candidate, pattern);
  if (!process.endedAt) throw new Error(`${label} process has no deterministic end time`);
  if (process.endedAt > candidate.simulation.collection.windowEnd) throw new Error(`${label} did not complete before capture`);
  const pidText = new RegExp(`\\s${process.pid}\\s`);
  if (liveRows(candidate).some((line) => pidText.test(line))) throw new Error(`${label} appears in live process snapshot`);
  if (openRows(candidate).some((line) => pidText.test(line))) throw new Error(`${label} appears in live open files`);
  const combinedHistory = history(candidate);
  if (!combinedHistory.includes(command.renderedCommand)) throw new Error(`${label} missing from historical process/file evidence`);
}

function assertLiveProcess(candidate, id, label) {
  const process = candidate.simulation.processes.find((item) => item.id === id);
  if (!process) throw new Error(`${label} missing from simulation`);
  const pidText = new RegExp(`\\s${process.pid}\\s`);
  if (!liveRows(candidate).some((line) => pidText.test(line))) throw new Error(`${label} missing from live process snapshot`);
}

function assertFileHistoryForCommand(candidate, pattern, expected, forbidden, label) {
  const { command } = commandProcess(candidate, pattern);
  const rows = asset(candidate, "assets/runtime/file_access_history.csv")
    .split(/\r?\n/)
    .filter((line) => line.includes(command.renderedCommand));
  for (const path of expected) {
    if (!rows.some((line) => line.includes(path))) throw new Error(`${label} missing ${path}`);
  }
  for (const path of forbidden) {
    if (rows.some((line) => line.includes(path))) throw new Error(`${label} incorrectly includes ${path}`);
  }
}

function pass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

const logIntegrity = buildFamily("log_tampering");
const container = buildFamily("docker_compromise");
const serviceAccount = buildFamily("service_account_misuse");

for (const candidate of [logIntegrity, container, serviceAccount]) {
  validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
}

pass("live snapshot declares live process semantics", () => {
  if (!asset(logIntegrity, "assets/runtime/process_snapshot.txt").includes("evidence_type=live_process_snapshot")) throw new Error("live process header missing");
  if (!asset(logIntegrity, "assets/runtime/open_files.txt").includes("evidence_type=live_open_file_snapshot")) throw new Error("live open-file header missing");
});

pass("historical artifacts declare historical semantics", () => {
  const processHistory = asset(logIntegrity, "assets/runtime/process_execution_history.txt");
  if (!processHistory.startsWith("evidence_type,state_type,")) throw new Error("process history CSV header missing");
  if (!processHistory.includes("historical_process_correlation")) throw new Error("process history semantics missing");
  if (!asset(logIntegrity, "assets/runtime/file_access_history.csv").includes("historical_file_access")) throw new Error("file history metadata missing");
});

pass("log-integrity short-lived commands are historical only", () => {
  assertCompletedAbsentFromLive(logIntegrity, /\btruncate\b/i, "truncate");
  assertCompletedAbsentFromLive(logIntegrity, /\blogrotate\b/i, "logrotate");
  assertCompletedAbsentFromLive(logIntegrity, /\bjournalctl\b/i, "journalctl");
});

pass("container CLI commands are historical only", () => {
  assertCompletedAbsentFromLive(container, /\bdocker\s+run\b/i, "docker run");
  assertCompletedAbsentFromLive(container, /\bdocker\s+inspect\b/i, "docker inspect");
  assertCompletedAbsentFromLive(container, /\bcat\s+\/etc\/group\b/i, "cat /etc/group");
});

pass("service-account commands are historical only after completion", () => {
  assertCompletedAbsentFromLive(serviceAccount, /\btar\b/i, "tar");
  assertCompletedAbsentFromLive(serviceAccount, /\brsync\b/i, "rsync");
  assertCompletedAbsentFromLive(serviceAccount, /\bsystemctl\s+restart\s+ssh\b/i, "systemctl restart ssh");
});

pass("shell and daemon processes remain live", () => {
  assertLiveProcess(serviceAccount, "process:sshd:monitor", "sshd daemon");
  assertLiveProcess(serviceAccount, "process:incident:shell", "interactive shell");
});

pass("tar and rsync file histories stay command-specific", () => {
  assertFileHistoryForCommand(serviceAccount, /\btar\b/i, ["/tmp/home-backup.tar.gz", "/home"], ["/tmp/export"], "tar history");
  assertFileHistoryForCommand(serviceAccount, /\brsync\b/i, ["/srv/shared", "/tmp/export"], ["/tmp/home-backup.tar.gz"], "rsync history");
});

console.log(JSON.stringify({
  passed: true,
  families: [logIntegrity, container, serviceAccount].map((candidate) => candidate.investigation.incidentFamily),
}, null, 2));
