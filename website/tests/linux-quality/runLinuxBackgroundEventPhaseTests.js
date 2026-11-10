#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = process.env.OUT;
if (!OUT) throw new Error("Set OUT to the freshly compiled lib/lab-assets directory.");
const load = (name) => require(path.join(OUT, name));
const { buildLinuxGenerationContext } = load("linux/generationContext.js");
const { buildInvestigationWorld } = load("world.js");
const { buildLinuxIncident } = load("linux/incidents.js");
const { buildLinuxInvestigationContext } = load("linux/investigation.js");
const simulationModule = load("linux/simulation.js");
const { buildAdvancedLinuxArtifacts } = load("linux/advancedArtifacts.js");
const { buildAuthLog } = load("linux/authLog.js");
const { buildSyslog } = load("linux/syslog.js");
const { buildSudoLog } = load("linux/sudoLog.js");
const { buildConfigs } = load("linux/configs.js");
const { buildUserAssets } = load("linux/users.js");
const { buildReportAssets } = load("linux/reports.js");
const { buildEvidenceAssets } = load("linux/evidence.js");
const { buildBaseAssets } = load("base.js");
const { renderBackgroundSyslogLines } = load("linux/backgroundActivity.js");
const { prepareLinuxPatchAEvidence, labelLinuxEvidenceTimeAuthority, validateLinuxPatchAIntegrity } = load("linux/learnerQa.js");
const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = load("linux/narrativeAssembly.js");
const { checkLinuxFinalProductionQuality } = load("linux/qualityChecker.js");

function fixture(input, attempt, family) {
  const generationContext = buildLinuxGenerationContext(input, { assetAttempt: attempt });
  const world = buildInvestigationWorld(generationContext);
  const incident = buildLinuxIncident(world, generationContext);
  assert.equal(incident.id, family);
  const investigation = buildLinuxInvestigationContext(world, incident, input.difficulty);
  const simulation = simulationModule.buildLinuxSimulationWorld({
    world, incident, investigation, difficulty: input.difficulty,
    seed: generationContext.random("simulation").seed,
    requestedDurationMinutes: generationContext.provenance.durationMinutes,
  });
  const context = { input, world, incident, investigation, simulation,
    intermediate: input.difficulty === "Intermediate", advanced: input.difficulty === "Advanced" };
  const assets = [
    ...buildBaseAssets({ ...input, generatedAt: `${simulation.collection.collectedAt.replace(" ", "T")}Z` }),
    buildAuthLog(context), buildSyslog(context), buildSudoLog(context), buildConfigs(context),
    ...buildUserAssets(context), ...buildReportAssets(context), ...buildEvidenceAssets(context),
    ...buildAdvancedLinuxArtifacts(context),
  ];
  prepareLinuxPatchAEvidence(simulation, assets);
  labelLinuxEvidenceTimeAuthority(assets, simulation);
  return { simulation, assets, investigation, input };
}

const asset = (assets, filePath) => {
  const found = assets.find(item => item.file_path === filePath);
  assert.ok(found, `missing ${filePath}`);
  return found;
};
const changed = (original, filePath, edit) => {
  const assets = structuredClone(original);
  const target = asset(assets, filePath);
  target.content = edit(target.content);
  return assets;
};
const rejected = (simulation, assets) => assert.throws(
  () => validateLinuxPatchAIntegrity(simulation, assets), /scheduled phase\/timestamp mismatch/);

const first = fixture({ category: "Linux", difficulty: "Advanced", duration: "30 mins",
  title: "Advanced SSH key task rebalance", seed: "advanced-ssh-key-rebalance:7",
  generationTime: "2026-07-29T09:00:00.000Z", assetAttempt: 1 }, 7, "ssh_key_compromise");
const second = fixture({ category: "Linux", difficulty: "Advanced", duration: "60 mins",
  title: "CyberLab Asset Pack", seed: "phase2-final-hardening-advanced:Advanced:24",
  generationTime: "2026-07-06T08:00:00.000Z", assetAttempt: 1 }, 1, "log_tampering");

for (const sample of [first, second]) {
  validateLinuxPatchAIntegrity(sample.simulation, sample.assets);
  const scheduled = sample.simulation.scheduledExecutions[0];
  const phase = simulationModule.scheduledExecutionRenderedPhase(sample.simulation, scheduled);
  assert.equal(phase.phase, "completed");
  assert.notEqual(phase.timestamp, scheduled.occurredAt);
  const ref = simulationModule.linuxLearnerSubjectLabel(sample.simulation, scheduled.id);
  const syslog = asset(sample.assets, "assets/logs/syslog").content;
  const timeline = asset(sample.assets, "assets/evidence/timeline.csv").content;
  assert.ok(syslog.split("\n").some(line => line.startsWith(phase.timestamp) && line.includes(`job_ref="${ref}"`)));
  assert.ok(timeline.split("\n").some(line => line.startsWith(phase.timestamp) && line.includes(ref) && line.includes("completed")));
  assert.ok(asset(sample.assets, "assets/logs/cron.log").content.includes(scheduled.occurredAt));
  assert.ok(asset(sample.assets, "assets/logs/audit.log").content.includes(`audit(${scheduled.occurredAt})`));
}

const scheduled = first.simulation.scheduledExecutions[0];
const phase = simulationModule.scheduledExecutionRenderedPhase(first.simulation, scheduled);
const ref = simulationModule.linuxLearnerSubjectLabel(first.simulation, scheduled.id);
const wrongSyslog = changed(first.assets, "assets/logs/syslog", content => content.split("\n").map(line =>
  line.includes(`job_ref="${ref}"`) || line.includes(`activity_ref="background:${scheduled.id}"`)
    ? line.replace(phase.timestamp, scheduled.occurredAt) : line).join("\n"));
const wrongTimeline = changed(first.assets, "assets/evidence/timeline.csv", content => content.split("\n").map(line =>
  line.includes(ref) && line.includes("scheduled execution") ? line.replace(phase.timestamp, scheduled.occurredAt) : line).join("\n"));
rejected(first.simulation, wrongSyslog); // Syslog-only corruption.
rejected(first.simulation, wrongTimeline); // Timeline-only corruption.
const contract = JSON.parse(simulationModule.buildLinuxCanonicalNarrativeBrief(first.simulation));
const assembled = buildLinuxAssembledNarrative({ contract, context: first.investigation,
  difficulty: first.input.difficulty, duration: first.input.duration,
  tasks: contract.taskContracts.map(task => ({ task_id: task.taskId, task_intent: task.intent,
    evidence: task.selectedEvidence.map(item => item.path) })) });
const lab = JSON.parse(JSON.stringify(finalLinuxNarrativeFromAssembled({ lab: assembled })));
const finalCheck = checkLinuxFinalProductionQuality({ context: first.investigation,
  simulation: first.simulation, assets: wrongSyslog, lab });
assert.equal(finalCheck.passed, false);
assert.ok(finalCheck.issues.some(item => item.description.includes("scheduled phase/timestamp mismatch")),
  "final-production check must surface the rendered-package phase failure");
const bothWrong = structuredClone(wrongSyslog);
asset(bothWrong, "assets/evidence/timeline.csv").content = asset(wrongTimeline, "assets/evidence/timeline.csv").content;
rejected(first.simulation, bothWrong); // Two agreeing rendered errors cannot override canonical end time.

const unknown = structuredClone(first.simulation);
unknown.scheduledExecutions[0].outcome = "partial";
unknown.scheduledExecutions[0].exitCode = undefined;
unknown.executions.find(item => item.id === scheduled.executionId).outcome = "unknown";
unknown.executions.find(item => item.id === scheduled.executionId).exitCode = undefined;
assert.equal(simulationModule.scheduledExecutionRenderedPhase(unknown, unknown.scheduledExecutions[0]).phase, "ended_unconfirmed");
assert.doesNotMatch(simulationModule.simulationBackgroundSyslogLines(unknown, unknown.investigation.hostname)
  .split("\n").find(line => line.includes(`job_ref="${ref}"`)), /completed/i);
rejected(unknown, first.assets); // Old success claim is not allowed for an unknown outcome.

const stillRunning = structuredClone(first.simulation);
stillRunning.processes.find(item => item.id === scheduled.processId).endedAt = undefined;
stillRunning.executions.find(item => item.id === scheduled.executionId).endTime = undefined;
assert.equal(simulationModule.scheduledExecutionRenderedPhase(stillRunning, stillRunning.scheduledExecutions[0]).phase, "started");
assert.match(simulationModule.simulationBackgroundSyslogLines(stillRunning, stillRunning.investigation.hostname)
  .split("\n").find(line => line.includes(`job_ref="${ref}"`)), /scheduled job started/);
assert.match(renderBackgroundSyslogLines(stillRunning, stillRunning.investigation.hostname)
  .split("\n").find(line => line.includes(`activity_ref="background:${scheduled.id}"`)), /started scheduled execution/);
assert.ok(simulationModule.simulationTimelineCsv(stillRunning, { advanced: true }).split("\n")
  .some(line => line.startsWith(scheduled.occurredAt) && line.includes(ref) && line.includes("started")));

const distinct = structuredClone(first.simulation);
const extra = { ...distinct.scheduledExecutions[0], id: `${scheduled.id}:second`,
  occurredAt: scheduled.occurredAt.replace(/\d\d$/, "11") };
assert.notEqual(extra.occurredAt, scheduled.occurredAt);
distinct.scheduledExecutions.push(extra); // Same process/PID and command, different occurrence identity.
assert.throws(() => validateLinuxPatchAIntegrity(distinct, first.assets), /scheduled phase\/timestamp mismatch/);

console.log("PASS scheduled-event phase/timestamp: two fixed fixtures, start/end authority, four corruption cases, unknown outcome, distinct occurrence");
