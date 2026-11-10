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

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-open-fd-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return build;
}

const OUT = compileIfNeeded();
const { buildLinuxAssetCandidate } = require(`${OUT}/lib/lab-assets/linux/index.js`);
const { validateLinuxSimulationEvidence } = require(`${OUT}/lib/lab-assets/linux/simulation.js`);
const { checkLinuxInvestigationQuality } = require(`${OUT}/lib/lab-assets/linux/qualityChecker.js`);

console.info = () => {};
console.warn = () => {};


function buildCandidate(family, difficulty = "Advanced", baseSeed = "open-fd", duration = "60 mins") {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `${baseSeed}:${family}:${difficulty}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration,
          title: "CyberLab Asset Pack",
        }, family ? { incidentFamily: family } : {});
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family}`);
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing asset ${filePath}`);
  return found;
}

function replaceAsset(candidate, filePath, transform) {
  const target = asset(candidate, filePath);
  const next = transform(target.content);
  if (next === target.content) throw new Error(`mutation did not change ${filePath}`);
  target.content = next;
}

function validate(candidate) {
  validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
}

function expectThrows(name, fn, pattern) {
  try {
    fn();
  } catch (error) {
    if (!pattern.test(String(error.message || error))) {
      throw new Error(`${name}: wrong failure: ${error.message || error}`);
    }
    return;
  }
  throw new Error(`${name}: expected validation failure`);
}

function currentDescriptors(candidate) {
  return (candidate.simulation.openFileDescriptors || []).filter((descriptor) => descriptor.state === "current");
}

function descriptorTarget(descriptor) {
  return descriptor.targetKind === "socket"
    ? `${descriptor.protocol || "socket"} ${descriptor.localAddress || "local"}:${descriptor.localPort || ""}`
    : descriptor.targetPath || descriptor.targetId;
}

function findDescriptor(candidate, predicate, label) {
  const descriptor = currentDescriptors(candidate).find(predicate);
  if (!descriptor) throw new Error(`missing descriptor: ${label}`);
  return descriptor;
}

function processFor(candidate, descriptor) {
  const process = candidate.simulation.processes.find((item) => item.id === descriptor.processId);
  if (!process) throw new Error(`missing process ${descriptor.processId}`);
  return process;
}

function openFiles(candidate) {
  return asset(candidate, "assets/runtime/open_files.txt").content;
}

function permissions(candidate) {
  return asset(candidate, "assets/reports/permissions_report.txt").content;
}

function mutateDescriptor(candidate, descriptorId, transform) {
  const descriptor = candidate.simulation.openFileDescriptors.find((item) => item.id === descriptorId);
  if (!descriptor) throw new Error(`missing descriptor ${descriptorId}`);
  transform(descriptor);
}

function moveBefore(timestamp, seconds = 60) {
  const date = new Date(`${timestamp.replace(" ", "T")}Z`);
  date.setUTCSeconds(date.getUTCSeconds() - seconds);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function validLab(candidate, evidence) {
  const context = candidate.investigation;
  return {
    title: `Linux evidence review for ${context.hostname}`,
    subtitle: "Linux descriptor and process evidence review",
    objective: `Review current host state for ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}.`,
    scenario: `${context.company} SOC is reviewing case ${context.incidentId} for ${context.hostname}.`,
    tasks: [{
      phase: "Runtime",
      title: "Identify which process currently holds an open file descriptor",
      evidence,
      deliverable: "Document the PID, user, descriptor, and target from current runtime evidence.",
    }],
  };
}

function currentStateIssues(candidate, evidence) {
  return checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets: candidate.assets,
    simulation: candidate.simulation,
    lab: validLab(candidate, evidence),
  }).issues.filter((issue) => /current-state|current state|current_file_state|current_open_file_state|historical evidence/i.test(`${issue.description} ${issue.details || ""}`));
}

const candidates = new Map();
for (const family of FAMILIES) candidates.set(family, buildCandidate(family));
const serviceAccount = candidates.get("service_account_misuse");
const logTampering = candidates.get("log_tampering");
const cron = candidates.get("cron_persistence");

const matrix = {
  families: {},
  descriptorTypes: {},
  deletedDescriptors: 0,
  socketDescriptors: 0,
  historicalOnlyRows: 0,
  mutationRejections: 0,
};

function record(candidate) {
  const descriptors = currentDescriptors(candidate);
  matrix.families[candidate.investigation.incidentFamily] = descriptors.length;
  for (const descriptor of descriptors) {
    matrix.descriptorTypes[descriptor.descriptorType] = (matrix.descriptorTypes[descriptor.descriptorType] || 0) + 1;
    if (descriptor.deleted) matrix.deletedDescriptors += 1;
    if (descriptor.targetKind === "socket") matrix.socketDescriptors += 1;
  }
}

function pass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

pass("all incident families generate valid descriptor-backed evidence", () => {
  for (const candidate of candidates.values()) {
    validate(candidate);
    record(candidate);
  }
});

pass("advanced packs include current descriptors for live processes", () => {
  const descriptors = currentDescriptors(serviceAccount);
  if (descriptors.length < 4) throw new Error(`too few descriptors: ${descriptors.length}`);
  for (const descriptor of descriptors) {
    const process = processFor(serviceAccount, descriptor);
    if (process.endedAt && process.endedAt <= serviceAccount.simulation.collection.windowEnd) {
      throw new Error(`descriptor ${descriptor.id} points at an exited process`);
    }
  }
});

pass("rendered open_files rows come from canonical descriptors", () => {
  for (const descriptor of currentDescriptors(serviceAccount)) {
    const target = descriptorTarget(descriptor);
    if (!openFiles(serviceAccount).includes(String(descriptor.pid)) || !openFiles(serviceAccount).includes(target)) {
      throw new Error(`rendered open_files missing ${descriptor.id}`);
    }
  }
});

pass("configuration descriptors remain current file state", () => {
  const owner = Array.from(candidates.values()).find((candidate) =>
    currentDescriptors(candidate).some((item) => /\/etc\//.test(item.targetPath || "")));
  if (!owner) throw new Error("no generated candidate included a current /etc descriptor");
  const descriptor = findDescriptor(owner, (item) => /\/etc\//.test(item.targetPath || ""), "config path");
  if (!openFiles(owner).includes(descriptor.targetPath)) throw new Error("config descriptor target missing from open_files");
});

pass("log descriptors remain current file state", () => {
  const owner = Array.from(candidates.values()).find((candidate) =>
    currentDescriptors(candidate).some((item) => /\/var\/log\//.test(item.targetPath || "")));
  if (!owner) throw new Error("no generated candidate included a current /var/log descriptor");
  const descriptor = findDescriptor(owner, (item) => /\/var\/log\//.test(item.targetPath || ""), "log path");
  if (!openFiles(owner).includes(descriptor.targetPath)) throw new Error("log descriptor target missing from open_files");
});

pass("deleted-but-open files are descriptors, not current filesystem metadata", () => {
  const descriptor = findDescriptor(logTampering, (item) => item.deleted, "deleted file");
  if (!openFiles(logTampering).includes(`${descriptor.targetPath} (deleted)`)) throw new Error("deleted marker missing");
  if (permissions(logTampering).includes(`${descriptor.targetPath} `)) throw new Error("deleted file appears in current permissions report");
});

pass("historical file access is not promoted into open_files", () => {
  const history = asset(serviceAccount, "assets/runtime/file_access_history.csv").content;
  const row = history.split(/\r?\n/).find((line) => /historical_file_access/.test(line) && !currentDescriptors(serviceAccount).some((descriptor) => line.includes(String(descriptor.pid)) && line.includes(descriptor.targetPath || "")));
  if (!row) throw new Error("missing historical-only file access row");
  matrix.historicalOnlyRows += 1;
});

pass("socket descriptors align with listening port evidence", () => {
  const descriptor = findDescriptor(serviceAccount, (item) => item.targetKind === "socket" && item.localPort === 22, "ssh socket");
  const listening = asset(serviceAccount, "assets/network/listening_ports.txt").content;
  if (!listening.includes(String(descriptor.pid)) || !listening.includes(":22")) throw new Error("listening port evidence missing socket PID/port");
});

pass("process snapshot contains descriptor PID and user", () => {
  const snapshot = asset(serviceAccount, "assets/runtime/process_snapshot.txt").content;
  for (const descriptor of currentDescriptors(serviceAccount)) {
    if (!snapshot.includes(String(descriptor.pid)) || !snapshot.includes(descriptor.username)) {
      throw new Error(`process snapshot missing descriptor context ${descriptor.id}`);
    }
  }
});

pass("learner-facing open_files does not reveal canonical descriptor IDs", () => {
  if (/descriptor:[a-z0-9:_-]+/i.test(openFiles(serviceAccount))) throw new Error("canonical descriptor id leaked");
});

pass("deterministic seeds construct stable descriptor IDs", () => {
  const first = buildCandidate("service_account_misuse", "Advanced", "open-fd:deterministic");
  const second = buildCandidate("service_account_misuse", "Advanced", "open-fd:deterministic");
  const left = currentDescriptors(first).map((item) => `${item.id}:${item.pid}:${item.fd}:${descriptorTarget(item)}`).join("|");
  const right = currentDescriptors(second).map((item) => `${item.id}:${item.pid}:${item.fd}:${descriptorTarget(item)}`).join("|");
  if (left !== right) throw new Error("descriptor construction changed for identical seed");
});

pass("missing rendered current descriptor row is rejected", () => {
  const candidate = buildCandidate("service_account_misuse");
  const descriptor = findDescriptor(candidate, (item) => item.targetKind === "file", "file descriptor");
  replaceAsset(candidate, "assets/runtime/open_files.txt", (content) =>
    content.split(/\r?\n/).filter((line) => !line.includes(String(descriptor.pid)) || !line.includes(descriptor.targetPath)).join("\n"));
  expectThrows("missing rendered row", () => validate(candidate), /open_files descriptor .* missing/i);
  matrix.mutationRejections += 1;
});

pass("orphan rendered descriptor row is rejected", () => {
  const candidate = buildCandidate("service_account_misuse");
  const ssh = candidate.simulation.services.find((service) => service.unitName === "ssh.service");
  const main = candidate.simulation.processes.find((process) => process.id === ssh?.mainProcessId);
  if (!main) throw new Error("orphan row fixture requires a live SSH MainPID");
  replaceAsset(candidate, "assets/runtime/open_files.txt", (content) => `${content.trim()}\nsshd       ${main.pid} root             99r  regular    read ${main.startedAt} /tmp/orphan\n`);
  expectThrows("orphan row", () => validate(candidate), /no current canonical descriptor/i);
  matrix.mutationRejections += 1;
});

pass("descriptor PID mismatch is rejected", () => {
  const candidate = buildCandidate("service_account_misuse");
  const descriptor = currentDescriptors(candidate)[0];
  mutateDescriptor(candidate, descriptor.id, (item) => { item.pid += 1000; });
  expectThrows("pid mismatch", () => validate(candidate), /PID mismatch/i);
  matrix.mutationRejections += 1;
});

pass("descriptor user mismatch is rejected", () => {
  const candidate = buildCandidate("service_account_misuse");
  const descriptor = currentDescriptors(candidate)[0];
  mutateDescriptor(candidate, descriptor.id, (item) => { item.username = "nobody"; });
  expectThrows("user mismatch", () => validate(candidate), /username mismatch/i);
  matrix.mutationRejections += 1;
});

pass("descriptor opened before process start is rejected", () => {
  const candidate = buildCandidate("service_account_misuse");
  const descriptor = currentDescriptors(candidate)[0];
  const process = processFor(candidate, descriptor);
  mutateDescriptor(candidate, descriptor.id, (item) => { item.openedAt = moveBefore(process.startedAt); });
  expectThrows("opened before process", () => validate(candidate), /opened before process/i);
  matrix.mutationRejections += 1;
});

pass("descriptor close before open is rejected", () => {
  const candidate = buildCandidate("service_account_misuse");
  const descriptor = currentDescriptors(candidate)[0];
  mutateDescriptor(candidate, descriptor.id, (item) => { item.closedAt = moveBefore(item.openedAt); });
  expectThrows("close before open", () => validate(candidate), /closes before it opens/i);
  matrix.mutationRejections += 1;
});

pass("current descriptor for exited process is rejected", () => {
  const candidate = buildCandidate("service_account_misuse");
  const descriptor = currentDescriptors(candidate)[0];
  const exited = candidate.simulation.processes.find((process) => process.endedAt && process.endedAt <= candidate.simulation.collection.windowEnd);
  if (!exited) throw new Error("missing exited process for descriptor mutation");
  const identity = candidate.simulation.identities.find((item) => item.id === (exited.effectiveUid === 0 ? "identity:root" : exited.identityId));
  mutateDescriptor(candidate, descriptor.id, (item) => {
    item.processId = exited.id;
    item.pid = exited.pid;
    item.processStartedAt = exited.startedAt;
    item.userIdentityId = identity.id;
    item.username = identity.username;
  });
  expectThrows("current after process exit", () => validate(candidate), /current after process exit|no live process/i);
  matrix.mutationRejections += 1;
});

pass("duplicate rendered FD for one process is rejected", () => {
  const candidate = buildCandidate("service_account_misuse");
  const descriptor = currentDescriptors(candidate)[0];
  const duplicate = openFiles(candidate).split(/\r?\n/).find((line) => line.includes(String(descriptor.pid)) && line.includes(descriptor.fd));
  replaceAsset(candidate, "assets/runtime/open_files.txt", (content) => `${content.trim()}\n${duplicate}\n`);
  expectThrows("duplicate rendered fd", () => validate(candidate), /duplicate rendered descriptor FD/i);
  matrix.mutationRejections += 1;
});

pass("socket listener mismatch is rejected", () => {
  const candidate = buildCandidate("service_account_misuse");
  replaceAsset(candidate, "assets/network/listening_ports.txt", (content) => content.replace(/:22\b/, ":2222"));
  expectThrows("socket listener", () => validate(candidate), /listener descriptor/i);
  matrix.mutationRejections += 1;
});

pass("deleted descriptor path in current permissions is rejected", () => {
  const candidate = buildCandidate("log_tampering");
  const descriptor = findDescriptor(candidate, (item) => item.deleted, "deleted file");
  replaceAsset(candidate, "assets/reports/permissions_report.txt", (content) => `${content.trim()}\n${descriptor.targetPath} -rw-r----- root adm\n`);
  expectThrows("deleted permissions", () => validate(candidate), /current filesystem metadata/i);
  matrix.mutationRejections += 1;
});

pass("current open-file task accepts current runtime evidence", () => {
  const issues = currentStateIssues(logTampering, [
    "assets/runtime/open_files.txt",
    "assets/runtime/process_snapshot.txt",
    "assets/csv/users.csv",
    "assets/csv/groups.csv",
    "assets/accounts/passwd.sample",
  ]);
  if (issues.length > 0) throw new Error(`unexpected current-state issues: ${JSON.stringify(issues, null, 2)}`);
});

pass("current open-file task rejects historical-only evidence", () => {
  const issues = currentStateIssues(logTampering, ["assets/runtime/file_access_history.csv"]);
  if (!issues.some((issue) => /current-state|current state|historical evidence|current_open_file_state/i.test(`${issue.description} ${issue.details || ""}`))) {
    throw new Error(`missing current-state evidence issue: ${JSON.stringify(issues, null, 2)}`);
  }
});

pass("beginner generation remains compatible", () => {
  const candidate = buildCandidate(undefined, "Beginner", "open-fd-beginner", "30 mins");
  if (!candidate.assetQuality?.passed) throw new Error("beginner candidate failed quality checks");
});

pass("intermediate generation remains compatible", () => {
  const candidate = buildCandidate(undefined, "Intermediate", "open-fd-intermediate", "30 mins");
  if (!candidate.assetQuality?.passed) throw new Error("intermediate candidate failed quality checks");
});

console.log(`OPEN_DESCRIPTOR_MATRIX ${JSON.stringify(matrix, null, 2)}`);
console.log(JSON.stringify({ passed: true, tests: 24, families: FAMILIES.length }, null, 2));
