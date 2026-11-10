#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const out = process.env.OUT ? path.resolve(process.env.OUT) : path.join(os.tmpdir(), `amniora-ssh-alignment-${Date.now()}`);
if (!process.env.OUT) execSync(`npx tsc --outDir "${out}" --noEmit false --incremental false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, { cwd: ROOT, stdio: "inherit" });
const root = path.join(out, "lib", "lab-assets", "linux");
const { buildLinuxAssetCandidate } = require(path.join(root, "index.js"));
const { buildLinuxCanonicalNarrativeBrief } = require(path.join(root, "simulation.js"));
const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(root, "narrativeAssembly.js"));
const { checkLinuxFinalProductionQuality } = require(path.join(root, "qualityChecker.js"));
const { validateLinuxFinalLearnerPackage } = require(path.join(root, "claimAuthority.js"));

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function build(difficulty = "Advanced", duration = "30 mins") {
  let last;
  let lastReason = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({ category: "Linux", title: "Amniora SSH alignment", difficulty, duration, generationTime: "2026-07-29T08:00:00.000Z", seed: `advanced-ssh-alignment:${difficulty}:${attempt}` }, { incidentFamily: "ssh_bruteforce", onAttempt: event => { if (!event.accepted) lastReason = event.reason || ""; } });
    } catch (error) { last = error; }
  }
  throw new Error(`${last?.message || "candidate failed"}: ${lastReason}`);
}

const candidate = build();
const contract = JSON.parse(buildLinuxCanonicalNarrativeBrief(candidate.simulation));
const lab = finalLinuxNarrativeFromAssembled({ lab: buildLinuxAssembledNarrative({
  contract, context: candidate.investigation, difficulty: "Advanced", duration: "30 mins",
  tasks: contract.taskContracts.map(task => ({ task_id: task.taskId, task_intent: task.intent, evidence: task.selectedEvidence.map(item => item.path) })),
}) });
const chronology = lab.tasks.find(task => /Order the failed SSH attempts, accepted method, and session opening/.test(task.deliverable));
assert("SSH sequence task exists", Boolean(chronology));
assert("SSH sequence has task-local auth events", chronology.evidence.includes("assets/logs/auth.log"), chronology.evidence.join(", "));
assert("SSH sequence keeps a bounded source set", chronology.evidence.length <= 3, chronology.evidence.join(", "));
assert("SSH sequence explicitly bounds attribution and linkage", /operator/.test(chronology.deliverable) && /session linkage or compromise/.test(chronology.deliverable));
assert("old Task 3 overpromising title is absent", lab.tasks.every(task => task.title !== "Trace the authentication sequence"));
assert("account identification belongs to attribution, not the control-gap task",
  lab.tasks.filter(task => /Identify the SSH account from authentication evidence/.test(task.deliverable)).length === 1 &&
  lab.tasks.some(task => /ownership context|account activity/i.test(task.title) && /Identify the SSH account from authentication evidence/.test(task.deliverable)));
validateLinuxFinalLearnerPackage({ simulation: candidate.simulation, assets: candidate.assets, lab });
assert("baseline final package authority", true);

function expectReject(name, mutate, pattern) {
  const assets = JSON.parse(JSON.stringify(candidate.assets));
  const alteredLab = JSON.parse(JSON.stringify(lab));
  mutate(assets, alteredLab);
  let error;
  try { validateLinuxFinalLearnerPackage({ simulation: candidate.simulation, assets, lab: alteredLab }); }
  catch (caught) { error = caught; }
  assert(name, error && pattern.test(String(error.message || error)), String(error?.message || "did not reject"));
}
function editAsset(assets, filePath, change) {
  const item = assets.find(asset => asset.file_path === filePath);
  if (!item) throw new Error(`missing ${filePath}`);
  item.content = change(item.content);
}
expectReject("chronology without task-local auth source", (_assets, alteredLab) => {
  alteredLab.tasks.find(task => /Order the failed SSH attempts/.test(task.deliverable)).evidence = ["assets/journal/journal_ssh.txt", "assets/logs/audit.log"];
}, /chronology lacks task-local auth/);
expectReject("chronology with no failed attempts", assets => editAsset(assets, "assets/logs/auth.log", content => content.split("\n").filter(line => !line.includes("Failed password")).join("\n")), /distinct matched failures/);
expectReject("chronology with wrong-host accepted event", assets => editAsset(assets, "assets/logs/auth.log", content => content.replace(/^(\S+ \S+) (\S+) (sshd\[\d+\]: Accepted )/gm, "$1 wrong-host $3")), /distinct matched failures|observed network source/);
expectReject("chronology with wrong-account accepted event", assets => editAsset(assets, "assets/logs/auth.log", content => content.replace(/(Accepted \S+ for )\S+/g, "$1wrong-account")), /distinct matched failures/);
expectReject("chronology with wrong-source failures", assets => editAsset(assets, "assets/logs/auth.log", content => content.split("\n").map(line => line.includes("Failed password") ? line.replace(/ from \S+ port /, " from 203.0.113.200 port ") : line).join("\n")), /distinct matched failures/);
expectReject("chronology with out-of-window failures", assets => editAsset(assets, "assets/logs/auth.log", content => content.split("\n").map(line => line.includes("Failed password") ? line.replace(/^\d{4}-\d\d-\d\d/, "2099-01-01") : line).join("\n")), /distinct matched failures/);
expectReject("duplicate of one failure is one observation", assets => editAsset(assets, "assets/logs/auth.log", content => {
  const lines = content.split("\n");
  const failure = lines.find(line => line.includes("Failed password"));
  return lines.filter(line => !line.includes("Failed password")).concat(failure, failure).join("\n");
}), /distinct matched failures/);
expectReject("post-assembly unsupported observed IP", assets => editAsset(assets, "assets/evidence/incident_brief.md", content => content.replace(/(Network sources observed in SSH session records: .*)/i, "$1, 192.168.56.56")), /observed network source/);
expectReject("configuration cannot claim observed effectiveness", assets => editAsset(assets, "assets/configs/linux_config_pack.txt", content => content.replace(/^# Supplied SSH configuration sample:.*/m, "# Observed configuration: effective at incident time")), /configuration label/);
expectReject("different titles cannot hide identical task outcomes", (_assets, alteredLab) => {
  alteredLab.tasks[1].title = "Completely different title";
  alteredLab.tasks[1].deliverable = alteredLab.tasks[0].deliverable;
  alteredLab.tasks[1].evidence = alteredLab.tasks[0].evidence;
}, /semantically redundant tasks/);
const bounded = JSON.parse(JSON.stringify(lab));
const boundedTask = bounded.tasks.find(task => /Order the failed SSH attempts/.test(task.deliverable));
boundedTask.deliverable = "Document the one recorded SSH session and state the limits of the available evidence.";
boundedTask.evidence = ["assets/journal/journal_ssh.txt", "assets/logs/audit.log"];
validateLinuxFinalLearnerPackage({ simulation: candidate.simulation, assets: candidate.assets, lab: bounded });
assert("single-event bounded task and Task 3 remain acceptable", true);
const failedProbe = candidate.simulation.commands.find(command => candidate.simulation.executions.some(execution => execution.id === command.executionId && execution.processPolicy === "no_child_process" && execution.exitCode === 127));
const syslog = candidate.assets.find(asset => asset.file_path === "assets/logs/syslog")?.content || "";
assert("command-not-found preserves failure, actor, time, and no-child semantics", failedProbe && syslog.includes(`${failedProbe.renderedCommand}: command not found (exit 127); attempted by`) && syslog.includes("no child process was created"));
for (const filePath of ["README.md", "DISCLAIMER.txt", "setup.sh"]) {
  const content = candidate.assets.find(asset => asset.file_path === filePath)?.content || "";
  assert(`${filePath} uses Amniora learner branding`, content.includes("Amniora") && !/Open CyberLab|CyberLab does not|CyberLab Asset Pack/.test(content));
}
const final = checkLinuxFinalProductionQuality({ context: candidate.investigation, simulation: candidate.simulation, assets: candidate.assets, lab });
assert("rendered SSH package passes final validation", final.passed, final.issues.map(item => item.description).join(" | "));
const lateClaimAssets = JSON.parse(JSON.stringify(candidate.assets));
editAsset(lateClaimAssets, "assets/evidence/incident_brief.md", content => content.replace(/(Network sources observed in SSH session records: .*)/i, "$1, 192.168.56.56"));
const lateClaimCheck = checkLinuxFinalProductionQuality({ context: candidate.investigation, simulation: candidate.simulation, assets: lateClaimAssets, lab });
assert("post-assembly unsupported IP blocks final production gate", !lateClaimCheck.passed && lateClaimCheck.issues.some(issue => /observed network source/.test(issue.description)));
console.log("ADVANCED_SSH_RENDERED_TASKS", JSON.stringify(lab.tasks.map(task => ({ title: task.title, deliverable: task.deliverable, evidence: task.evidence }))));
for (const [difficulty, duration] of [["Beginner", "15 mins"], ["Intermediate", "30 mins"]]) {
  const lower = build(difficulty, duration);
  const lowerContract = JSON.parse(buildLinuxCanonicalNarrativeBrief(lower.simulation));
  const lowerLab = finalLinuxNarrativeFromAssembled({ lab: buildLinuxAssembledNarrative({
    contract: lowerContract, context: lower.investigation, difficulty, duration,
    tasks: lowerContract.taskContracts.map(task => ({ task_id: task.taskId, task_intent: task.intent, evidence: task.selectedEvidence.map(item => item.path) })),
  }) });
  validateLinuxFinalLearnerPackage({ simulation: lower.simulation, assets: lower.assets, lab: lowerLab });
  assert(`${difficulty} ${duration} retains bounded SSH authority`, true);
}
