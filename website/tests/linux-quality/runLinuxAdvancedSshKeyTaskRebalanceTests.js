#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const path = require("path");
const { compileIfNeeded, loadModules } = require("./linuxPhase9AuditUtils");

const out = compileIfNeeded("advanced-ssh-key-task-rebalance");
const modules = loadModules(out);
const { assertAdvancedSshKeyTaskCorrelation } = require(path.join(out, "linux", "sshKeyTaskCorrelation.js"));
const { validateLinuxFinalLearnerPackage } = require(path.join(out, "linux", "claimAuthority.js"));
let assertions = 0;

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function finalLab(candidate) {
  const contract = JSON.parse(modules.simulation.buildLinuxCanonicalNarrativeBrief(candidate.simulation));
  const assembled = modules.assembly.buildLinuxAssembledNarrative({
    contract,
    context: candidate.investigation,
    difficulty: "Advanced",
    duration: "30 mins",
    tasks: contract.taskContracts.map((task) => ({
      task_id: task.taskId,
      task_intent: task.intent,
      evidence: task.selectedEvidence.map((item) => item.path),
    })),
  });
  return JSON.parse(JSON.stringify(modules.assembly.finalLinuxNarrativeFromAssembled({ lab: assembled })));
}

function task(candidate, lab, intent) {
  const index = candidate.simulation.canonicalTasks.findIndex((item) => item.intent === intent);
  if (index < 0) throw new Error(`missing ${intent}`);
  return lab.tasks[index];
}

function check(candidate, lab = finalLab(candidate), assets = candidate.assets) {
  assertAdvancedSshKeyTaskCorrelation({ simulation: candidate.simulation, assets, tasks: lab.tasks });
  validateLinuxFinalLearnerPackage({ simulation: candidate.simulation, assets, lab });
}

function reject(name, candidate, mutate, expected) {
  const lab = clone(finalLab(candidate));
  const assets = clone(candidate.assets);
  mutate(lab, assets);
  let error;
  try { check(candidate, lab, assets); } catch (caught) { error = caught; }
  assert(name, error && expected.test(String(error.message || error)), String(error?.message || "accepted"));
}

function asset(assets, filePath) {
  const found = assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing fixture asset ${filePath}`);
  return found;
}

function buildTopologies() {
  const found = new Map();
  let capturedMulti;
  for (let seed = 0; seed < 18 && found.size < 2; seed += 1) {
    let candidate;
    try {
      candidate = modules.linux.buildLinuxAssetCandidate({
        category: "Linux", difficulty: "Advanced", duration: "30 mins",
        title: "Advanced SSH key task rebalance", seed: `advanced-ssh-key-rebalance:${seed}`,
        generationTime: "2026-07-29T09:00:00.000Z",
      }, {
        incidentFamily: "ssh_key_compromise",
        boundaryAssertionTransform({ assets, investigation, simulation }) {
          if (!capturedMulti && simulation.sshSessions.filter((session) => session.purpose === "incident").length > 1) {
            capturedMulti = { assets, investigation, simulation, accepted: false };
          }
        },
      });
    } catch (_error) { continue; }
    const count = candidate.simulation.sshSessions.filter((session) => session.purpose === "incident").length;
    const kind = count === 1 ? "one session" : "multiple sessions";
    if (!found.has(kind)) found.set(kind, { ...candidate, accepted: true });
  }
  if (!found.has("multiple sessions") && capturedMulti) found.set("multiple sessions", capturedMulti);
  assert("bounded seeds cover one-session topology", found.has("one session"));
  assert("bounded seeds cover multi-session topology", found.has("multiple sessions"));
  return found;
}

const topologies = buildTopologies();
for (const [kind, candidate] of topologies) {
  const lab = finalLab(candidate);
  check(candidate, lab);
  const narrativeContract = JSON.parse(modules.simulation.buildLinuxCanonicalNarrativeBrief(candidate.simulation));
  const sessionContract = narrativeContract.taskContracts.find((item) => item.intent === "ssh_authentication");
  assert(`${kind} shared contract requires process reasoning`, /process branches/i.test(sessionContract.objective) &&
    sessionContract.requiredCapabilities.includes("process_ancestry"));
  const intents = candidate.simulation.canonicalTasks.map((item) => item.intent);
  assert(`${kind} keeps four ordered distinct objectives`, JSON.stringify(intents) === JSON.stringify([
    "change_control", "key_provenance", "ssh_authentication", "impact_assessment",
  ]));
  assert(`${kind} keeps bounded Task 3 evidence`, task(candidate, lab, "ssh_authentication").evidence.length === 3);
  assert(`${kind} keeps key lifecycle uncertainty`, /lifecycle/i.test(task(candidate, lab, "key_provenance").deliverable) &&
    /fingerprint.to.file mapping/i.test(task(candidate, lab, "key_provenance").deliverable) &&
    /conditional steps/i.test(task(candidate, lab, "key_provenance").deliverable));
  assert(`${kind} separates correlation from risk`, /process PPID chain/i.test(task(candidate, lab, "ssh_authentication").deliverable) &&
    /unverified risk-register/i.test(task(candidate, lab, "impact_assessment").deliverable));
  if (candidate.accepted) {
    const final = modules.quality.checkLinuxFinalProductionQuality({ context: candidate.investigation, simulation: candidate.simulation, assets: candidate.assets, lab });
    assert(`${kind} serialized final package passes`, final.passed, final.issues.map((item) => item.description).join(" | "));
  } else {
    console.log("MULTI_SESSION_TOPOLOGY_ONLY", "Candidate was rejected by an existing asset/workload gate; its learner-package relation is tested, not counted as an accepted generation.");
  }
  console.log("REBALANCED_LEARNER_TASKS", kind, JSON.stringify(lab.tasks.map((item) => ({ title: item.title, evidence: item.evidence, deliverable: item.deliverable }))));
  if (candidate.accepted) {
    const session = candidate.simulation.sshSessions.find((item) => item.purpose === "incident");
    const command = candidate.simulation.commands.find((item) => item.sessionId === session.id && item.id.startsWith("command:incident:"));
    const history = asset(candidate.assets, "assets/runtime/process_execution_history.txt").content;
    const lineagePids = [session.sessionPid, session.shellPid, command.sudoProcessId, command.processId].filter(Boolean);
    const processRows = history.split(/\r?\n/).filter((line) =>
      lineagePids.some((pid) => new RegExp(`,${pid},\\d+,`).test(line)));
    console.log("REBALANCED_LEARNER_RECORDS", JSON.stringify({
      caseId: candidate.investigation.incidentId,
      host: candidate.investigation.hostname,
      journal: asset(candidate.assets, "assets/journal/journal_ssh.txt").content.split(/\r?\n/).filter((line) => /Session opened/.test(line)),
      capturedAccount: asset(candidate.assets, "assets/accounts/passwd.sample").content.split(/\r?\n/).filter((line) => line.startsWith("# capture_at=") || line.startsWith(`${session.username}:`)),
      processRows,
      riskRegister: asset(candidate.assets, "assets/evidence/advanced_risk_register.csv").content.split(/\r?\n/).slice(0, 4),
    }));
  }
}

const multi = topologies.get("multiple sessions");
const first = multi.simulation.sshSessions.find((session) => session.purpose === "incident");
const second = multi.simulation.sshSessions.find((session) => session.purpose === "incident" && session.id !== first.id);
const command = multi.simulation.commands.find((item) => item.sessionId === second.id && item.id.startsWith("command:incident:"));
const historyPath = "assets/runtime/process_execution_history.txt";
const journalPath = "assets/journal/journal_ssh.txt";
reject("missing task-local process history", multi, (lab) => {
  task(multi, lab, "ssh_authentication").evidence = [journalPath, "assets/accounts/passwd.sample"];
}, /task-local evidence/);
reject("missing required session opening", multi, (_lab, assets) => {
  const item = asset(assets, journalPath);
  item.content = item.content.split(/\r?\n/).filter((line) => !line.includes(`sshd[${second.sessionPid}]: Session opened`)).join("\n");
}, /distinct same-host journal opening/);
reject("wrong journal host", multi, (_lab, assets) => {
  asset(assets, journalPath).content = asset(assets, journalPath).content.replaceAll(multi.simulation.investigation.hostname, "wrong-host");
}, /distinct same-host journal opening/);
reject("wrong journal account", multi, (_lab, assets) => {
  asset(assets, journalPath).content = asset(assets, journalPath).content.replace(`Session opened for ${first.username}`, "Session opened for wrong-account");
}, /distinct same-host journal opening/);
reject("wrong journal PID", multi, (_lab, assets) => {
  asset(assets, journalPath).content = asset(assets, journalPath).content.replace(`sshd[${first.sessionPid}]`, "sshd[99999]");
}, /distinct same-host journal opening/);
reject("wrong journal time", multi, (_lab, assets) => {
  asset(assets, journalPath).content = asset(assets, journalPath).content.replace(first.openedAt, "2025-01-01 00:00:00");
}, /distinct same-host journal opening/);
reject("missing parent shell", multi, (_lab, assets) => {
  const item = asset(assets, historyPath);
  item.content = item.content.split(/\r?\n/).filter((line) => !new RegExp(`,${second.shellPid},${second.sessionPid},`).test(line)).join("\n");
}, /supported child shell/);
reject("wrong process account context", multi, (_lab, assets) => {
  const item = asset(assets, historyPath);
  item.content = item.content.replace(new RegExp(`,${command.processId},(\\d+),root,`), `,${command.processId},$1,wrong-account,`);
}, /time-matched historical process/);
reject("same-account command assigned to wrong branch", multi, (_lab, assets) => {
  const item = asset(assets, historyPath);
  item.content = item.content.replace(new RegExp(`,${command.processId},(\\d+),`), `,${command.processId},${first.shellPid},`);
}, /wrong-session ancestry|missing or later parent process/);
reject("duplicate journal opening is not a second session", multi, (_lab, assets) => {
  const item = asset(assets, journalPath);
  item.content += item.content.split(/\r?\n/).find((line) => line.includes(`sshd[${first.sessionPid}]: Session opened`)) + "\n";
}, /distinct same-host journal opening|separate session/);
reject("later partial identity snapshot cannot become incident-time identity authority", multi, (_lab, assets) => {
  asset(assets, "assets/accounts/passwd.sample").content = asset(assets, "assets/accounts/passwd.sample").content.replace(/capture_at=\S+ \S+/, "capture_at=2025-01-01 00:00:00");
}, /partial-snapshot authority/);
reject("late narrative cannot drop process relation", multi, (lab) => {
  task(multi, lab, "ssh_authentication").deliverable = "Identify the account and cite the key source.";
}, /session-to-activity reasoning/);
reject("late narrative cannot promote later identity snapshot to incident-time proof", multi, (lab) => {
  task(multi, lab, "ssh_authentication").deliverable += " passwd.sample proves the historical identity state at incident time.";
}, /historical certainty/);
reject("key task cannot drop lifecycle boundary", multi, (lab) => {
  task(multi, lab, "key_provenance").deliverable = "Identify the key fingerprint.";
}, /provenance task lost/);
reject("risk task cannot repeat ancestry instead of synthesising risk", multi, (lab) => {
  task(multi, lab, "impact_assessment").deliverable = task(multi, lab, "ssh_authentication").deliverable;
}, /distinct bounded synthesis/);
reject("risk register hypotheses cannot become observed impact", multi, (lab) => {
  task(multi, lab, "impact_assessment").deliverable += " The risk-register entries prove observed business impact.";
}, /independent observations/);
console.log(`Linux Advanced SSH-key task rebalance passed (${assertions} assertions).`);
