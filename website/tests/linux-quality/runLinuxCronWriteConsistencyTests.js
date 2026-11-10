#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = process.env.OUT;
if (!OUT) throw new Error("Set OUT to freshly compiled lib/lab-assets output.");
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
const { prepareLinuxPatchAEvidence, labelLinuxEvidenceTimeAuthority } = load("linux/learnerQa.js");

const input = { category: "Linux", difficulty: "Advanced", duration: "30 mins",
  title: "Advanced SSH key task rebalance", seed: "advanced-ssh-key-rebalance:7",
  generationTime: "2026-07-29T09:00:00.000Z", assetAttempt: 1 };
const generationContext = buildLinuxGenerationContext(input, { assetAttempt: 8 });
const world = buildInvestigationWorld(generationContext);
assert.equal(world.serverRole, "database host");
const incident = buildLinuxIncident(world, generationContext);
const investigation = buildLinuxInvestigationContext(world, incident, input.difficulty);
const simulation = simulationModule.buildLinuxSimulationWorld({ world, incident, investigation,
  difficulty: input.difficulty, seed: generationContext.random("simulation").seed,
  requestedDurationMinutes: generationContext.provenance.durationMinutes });
const context = { input, world, incident, investigation, simulation, intermediate: false, advanced: true };
const assets = [
  ...buildBaseAssets({ ...input, generatedAt: `${simulation.collection.collectedAt.replace(" ", "T")}Z` }),
  buildAuthLog(context), buildSyslog(context), buildSudoLog(context), buildConfigs(context),
  ...buildUserAssets(context), ...buildReportAssets(context), ...buildEvidenceAssets(context),
  ...buildAdvancedLinuxArtifacts(context),
];
prepareLinuxPatchAEvidence(simulation, assets);
labelLinuxEvidenceTimeAuthority(assets, simulation);
const canWrite = simulationModule.canEffectiveIdentityWriteFile;
const serviceUid = 1577;
const protectedLog = { ownerUid: 0, groupGid: 4, mode: 0o640 };
const ownLog = { ownerUid: serviceUid, groupGid: 4, mode: 0o640 };
const groupWritableLog = { ownerUid: 0, groupGid: 4, mode: 0o660 };

if (process.argv.includes("--permissions")) {
  assert.equal(canWrite(serviceUid, [1577], protectedLog), false);
  assert.equal(canWrite(serviceUid, [1577, 4], protectedLog), false);
  assert.equal(canWrite(serviceUid, [1577], ownLog), true);
  assert.equal(canWrite(serviceUid, [1577, 4], groupWritableLog), true);
  assert.equal(canWrite(0, [0], protectedLog), true);
  assert.equal(canWrite(serviceUid, [], protectedLog), false, "no hidden ACL or capability");
  const scheduled = simulation.scheduledExecutions.filter((item) => {
    const command = simulation.commands.find((candidate) => candidate.id === item.commandId);
    return command?.affectedFileIds.some((id) => simulation.files.find((file) => file.id === id)?.path.startsWith("/var/log/postgresql/"));
  });
  assert.equal(scheduled.length, 2, "both database scripts must be covered");
  for (const execution of scheduled) {
    const process = simulation.processes.find((item) => item.id === execution.processId);
    const command = simulation.commands.find((item) => item.id === execution.commandId);
    const log = command.affectedFileIds.map((id) => simulation.files.find((file) => file.id === id))
      .find((file) => file?.path.startsWith("/var/log/postgresql/"));
    const identity = simulation.identities.find((item) => item.id === process.identityId);
    assert.ok(identity && log);
    assert.equal(log.ownerIdentityId, identity.id);
    assert.equal(log.ownerUid, process.effectiveUid);
    assert.equal(log.mode, 0o640);
    assert.equal(simulation.groups.find((item) => item.id === log.groupId)?.name, "adm");
    assert.equal(canWrite(process.effectiveUid, [process.effectiveGid], log), true);
  }
  simulationModule.validateScheduledScriptWriteFeasibility(simulation, assets);
  simulationModule.validateLinuxSimulationEvidence(simulation, assets);
  console.log("PASS cron write permissions: six POSIX cases, both service-run database scripts, rendered metadata and identity registry");
} else if (process.argv.includes("--phase")) {
  const scripts = simulationModule.simulationScriptAssets(simulation)
    .filter((item) => /(?:pgbackrest|replication-lag)-.*\.sh$/.test(item.sourcePath));
  assert.equal(scripts.length, 2);
  for (const script of scripts) {
    assert.match(script.content, /set -euo pipefail/);
    assert.ok(script.content.indexOf(" >> ") < script.content.indexOf("logger -t "));
  }
  simulationModule.validateLinuxSimulationEvidence(simulation, assets);
  for (const script of scripts) {
    const altered = structuredClone(simulation);
    const target = altered.files.find((file) => script.content.includes(`>> '${file.path}'`));
    assert.ok(target);
    const root = altered.identities.find((identity) => identity.username === "root");
    target.ownerIdentityId = root.id;
    target.ownerUid = root.uid;
    const changedAssets = structuredClone(assets);
    const permissions = changedAssets.find((item) => item.file_path === "assets/reports/permissions_report.txt");
    permissions.content = permissions.content.split("\n").map((line) =>
      line.startsWith(`${target.path} `) ? line.replace(/\s\S+\s+adm\b/, " root adm") : line).join("\n");
    assert.throws(() => simulationModule.validateScheduledScriptWriteFeasibility(altered, changedAssets),
      /cannot append .* under set -e before logger\/completion/);
    const scheduled = altered.scheduledExecutions.find((item) => {
      const command = altered.commands.find((candidate) => candidate.id === item.commandId);
      return command?.affectedFileIds.includes(target.id);
    });
    scheduled.outcome = "failure";
    scheduled.exitCode = 1;
    const execution = altered.executions.find((item) => item.id === scheduled.executionId);
    execution.outcome = "failure";
    execution.exitCode = 1;
    const failedSyslog = simulationModule.simulationBackgroundSyslogLines(altered, world.host);
    const failedLine = failedSyslog.split("\n").find((line) => line.includes(`def="${scheduled.definitionId}"`));
    assert.ok(failedLine?.includes("failed"));
    assert.ok(!failedLine.includes("logger_tag="), "static logger line must not imply execution");
    changedAssets.find((item) => item.file_path === "assets/logs/syslog").content = failedSyslog;
    simulationModule.validateScheduledScriptWriteFeasibility(altered, changedAssets);
  }
  for (const execution of simulation.scheduledExecutions) {
    assert.equal(simulationModule.scheduledExecutionRenderedPhase(simulation, execution).phase, "completed");
  }
  console.log("PASS cron set-e phases: both failed-append mutations rejected before logger/completion; valid executions complete");
} else {
  throw new Error("Choose --permissions or --phase.");
}
