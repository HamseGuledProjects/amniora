#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const BUILD = path.join(os.tmpdir(), `amniora-linux-telemetry-provenance-${process.pid}`);
if (!process.env.OUT) {
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--outDir", BUILD,
    "--noEmit", "false", "--incremental", "false", "--module", "commonjs",
    "--moduleResolution", "node", "--target", "es2020", "--jsx", "react-jsx"],
  { cwd: ROOT, stdio: "inherit" });
}
const OUT = process.env.OUT || path.join(BUILD, "lib", "lab-assets");
const load = (name) => require(path.join(OUT, name));
const { buildLinuxGenerationContext } = load("linux/generationContext.js");
const { buildInvestigationWorld } = load("world.js");
const { buildLinuxIncident } = load("linux/incidents.js");
const { buildLinuxInvestigationContext } = load("linux/investigation.js");
const sim = load("linux/simulation.js");
const { buildBaseAssets } = load("base.js");
const { buildAuthLog } = load("linux/authLog.js");
const { buildSyslog } = load("linux/syslog.js");
const { buildSudoLog } = load("linux/sudoLog.js");
const { buildConfigs } = load("linux/configs.js");
const { buildUserAssets } = load("linux/users.js");
const { buildReportAssets } = load("linux/reports.js");
const { buildEvidenceAssets } = load("linux/evidence.js");
const { buildAdvancedLinuxArtifacts, fileAccessOperation } = load("linux/advancedArtifacts.js");
const { prepareLinuxPatchAEvidence } = load("linux/learnerQa.js");
const { linuxLoggingQualityClaim, evidenceCsvRows } = load("linux/evidenceAuthority.js");
const { validateLinuxFinalLearnerPackage, assertRenderedTelemetryAndProvenance } = load("linux/claimAuthority.js");
const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = load("linux/narrativeAssembly.js");

const input = { category: "Linux", difficulty: "Advanced", duration: "30 mins",
  title: "Telemetry provenance cleanup", seed: "advanced-ssh-key-rebalance:7",
  generationTime: "2026-07-29T09:00:00.000Z", assetAttempt: 1 };
const context = buildLinuxGenerationContext(input, { assetAttempt: 7 });
const world = buildInvestigationWorld(context);
const incident = buildLinuxIncident(world, context);
const investigation = buildLinuxInvestigationContext(world, incident, input.difficulty);
const simulation = sim.buildLinuxSimulationWorld({ world, incident, investigation,
  difficulty: input.difficulty, seed: context.random("simulation").seed,
  requestedDurationMinutes: context.provenance.durationMinutes });
const args = { input, world, incident, investigation, simulation, intermediate: false, advanced: true };
const assets = [
  ...buildBaseAssets({ ...input, generatedAt: `${simulation.collection.collectedAt.replace(" ", "T")}Z` }),
  buildAuthLog(args), buildSyslog(args), buildSudoLog(args), buildConfigs(args),
  ...buildUserAssets(args), ...buildReportAssets(args), ...buildEvidenceAssets(args),
  ...buildAdvancedLinuxArtifacts(args),
];
prepareLinuxPatchAEvidence(simulation, assets);
const contract = JSON.parse(sim.buildLinuxCanonicalNarrativeBrief(simulation));
const lab = finalLinuxNarrativeFromAssembled({ lab: buildLinuxAssembledNarrative({
  contract, context: investigation, difficulty: input.difficulty, duration: input.duration,
  tasks: contract.taskContracts.map((task) => ({ task_id: task.taskId, task_intent: task.intent,
    evidence: task.selectedEvidence.map((item) => item.path) })),
}) });
const asset = (list, name) => {
  const result = list.find((item) => item.file_path === name);
  assert.ok(result, `missing ${name}`);
  return result;
};
const clone = (value) => structuredClone(value);
const validate = (list, model = simulation) => validateLinuxFinalLearnerPackage({ simulation: model, assets: list, lab });

assert.doesNotThrow(() => validate(assets), "baseline final learner package");
const syslog = asset(assets, "assets/logs/syslog").content;
const brief = asset(assets, "assets/evidence/incident_brief.md").content;
assert.doesNotMatch(brief, /- Logging quality: complete but noisy/);
const partial = clone(assets);
asset(partial, "assets/logs/syslog").content += "\n# telemetry_completeness=partial source=assets/logs/syslog reason=observed_log_loss\n";
asset(partial, "assets/evidence/incident_brief.md").content = brief.replace(/^- Logging quality: .*$/m,
  `- Logging quality: ${linuxLoggingQualityClaim(partial, false)}`);
assert.doesNotThrow(() => validate(partial), "source-scoped partial brief");
const falseComplete = clone(partial);
asset(falseComplete, "assets/evidence/incident_brief.md").content = asset(falseComplete, "assets/evidence/incident_brief.md").content
  .replace(/^- Logging quality: .*$/m, "- Logging quality: complete but noisy telemetry");
assert.throws(() => validate(falseComplete), /logging quality conflicts/);

const telemetryOnly = { ...clone(simulation), scheduledExecutions: [] };
const completeAssets = [
  { file_path: "assets/evidence/incident_brief.md", content: "" },
  { file_path: "assets/journal/journal_ssh.txt", content: "2026-07-29 09:00:00 host sshd[42]: event\n# telemetry_completeness=complete scope=declared-window\n" },
];
completeAssets[0].content = `- Logging quality: ${linuxLoggingQualityClaim(completeAssets, false)}\n`;
assert.doesNotThrow(() => assertRenderedTelemetryAndProvenance(telemetryOnly, completeAssets), "authoritative complete source");
const mixed = clone(completeAssets);
mixed.push({ file_path: "assets/logs/syslog", content: "rsyslogd: imuxsock lost 2 messages due to rate-limiting\n" });
mixed[0].content = `- Logging quality: ${linuxLoggingQualityClaim(mixed, false)}\n`;
assert.match(mixed[0].content, /partial coverage in assets\/logs\/syslog/);
assert.match(mixed[0].content, /complete coverage is declared separately for assets\/journal\/journal_ssh/);
assert.doesNotThrow(() => assertRenderedTelemetryAndProvenance(telemetryOnly, mixed), "partial and complete remain scoped");

const execution = simulation.scheduledExecutions[0];
const scheduledProcess = simulation.processes.find((item) => item.id === execution.processId);
assert.ok(scheduledProcess);
const reference = sim.linuxLearnerSubjectLabel(simulation, execution.id);
const backgroundRow = syslog.split(/\r?\n/).find((line) => line.includes(`job_ref="${reference}"`));
assert.ok(backgroundRow);
assert.match(backgroundRow, new RegExp(`${scheduledProcess.executable.split("/").pop()}\\[${scheduledProcess.pid}\\]:`));
const renderedScript = sim.simulationScriptAssets(simulation).find((item) =>
  backgroundRow.includes(`logger_tag="${item.content.match(/\blogger\s+-t\s+([^\s'";]+)/)?.[1]}"`));
assert.ok(renderedScript, "logger tag is separate and backed by exported script");
const falseProcess = clone(assets);
asset(falseProcess, "assets/logs/syslog").content = syslog.replace(backgroundRow,
  backgroundRow.replace(`${scheduledProcess.executable.split("/").pop()}[${scheduledProcess.pid}]`, `containerd[${scheduledProcess.pid}]`));
assert.throws(() => validate(falseProcess), /background process provenance mismatch/);
const realService = clone(simulation);
const realProcess = realService.processes.find((item) => item.id === execution.processId);
realProcess.executable = "/usr/sbin/certbot";
const realCommand = realService.commands.find((item) => item.id === execution.commandId);
realCommand.affectedFileIds = realCommand.affectedFileIds.filter((id) =>
  realService.files.find((file) => file.id === id)?.contentRole !== "script");
const serviceAssets = clone(assets);
const serviceRow = sim.simulationBackgroundSyslogLines(realService, realService.investigation.hostname)
  .split("\n").find((line) => line.includes(`job_ref="${reference}"`));
assert.match(serviceRow, new RegExp(`certbot\\[${scheduledProcess.pid}\\]:`));
assert.doesNotMatch(serviceRow, /logger_tag=/);
asset(serviceAssets, "assets/logs/syslog").content = syslog.replace(backgroundRow, serviceRow);
assert.doesNotThrow(() => assertRenderedTelemetryAndProvenance(realService, serviceAssets), "actual service process");

assert.equal(fileAccessOperation("/usr/bin/tar -czf /tmp/export.tgz /srv/source", "/usr/bin/tar", "/usr/bin/tar"), "execution_load");
assert.equal(fileAccessOperation("/usr/bin/tar -czf /tmp/export.tgz /srv/source", "/tmp/export.tgz", "/usr/bin/tar"), "archive_write");
assert.equal(fileAccessOperation("/usr/bin/rsync -a /srv/source/ /tmp/export/", "/usr/bin/rsync", "/usr/bin/rsync"), "execution_load");
assert.equal(fileAccessOperation("/usr/bin/rsync -a /srv/source/ /tmp/export/", "/srv/source/", "/usr/bin/rsync"), "read/sync_source");
assert.equal(fileAccessOperation("/usr/bin/rsync -a /srv/source/ /tmp/export/", "/tmp/export/", "/usr/bin/rsync"), "write/sync_target");
const history = asset(assets, "assets/runtime/file_access_history.csv");
const header = history.content.split(/\r?\n/)[0];
const columns = header.split(",");
const values = { evidence_type: "historical_file_access", pid: String(scheduledProcess.pid), path: scheduledProcess.executable,
  operation: "archive_write", command: "/usr/bin/tar -czf /tmp/export.tgz /srv/source" };
const injected = columns.map((name) => values[name] || "").join(",");
const wrongAccess = clone(assets);
asset(wrongAccess, "assets/runtime/file_access_history.csv").content += `${injected}\n`;
assert.throws(() => validate(wrongAccess), /executable path was assigned a data-object/);
const correctAccess = clone(wrongAccess);
asset(correctAccess, "assets/runtime/file_access_history.csv").content = asset(correctAccess, "assets/runtime/file_access_history.csv").content
  .replace(injected, injected.replace(",archive_write,", ",execution_load,"));
assert.ok(evidenceCsvRows(asset(correctAccess, "assets/runtime/file_access_history.csv").content)
  .some((row) => row.path === scheduledProcess.executable && row.operation === "execution_load"));
assert.doesNotThrow(() => validate(correctAccess));
console.log("PASS final Linux telemetry/provenance cleanup: source scope, process/logger identity, executable/data operations");
