#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const BUILD = path.join(os.tmpdir(), `amniora-linux-logger-provenance-${process.pid}`);
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
const simulationModule = load("linux/simulation.js");
const { buildBaseAssets } = load("base.js");
const { buildAuthLog } = load("linux/authLog.js");
const { buildSyslog } = load("linux/syslog.js");
const { buildSudoLog } = load("linux/sudoLog.js");
const { buildConfigs } = load("linux/configs.js");
const { buildUserAssets } = load("linux/users.js");
const { buildReportAssets } = load("linux/reports.js");
const { buildEvidenceAssets } = load("linux/evidence.js");
const { buildAdvancedLinuxArtifacts } = load("linux/advancedArtifacts.js");
const { prepareLinuxPatchAEvidence } = load("linux/learnerQa.js");
const { validateLinuxFinalLearnerPackage } = load("linux/claimAuthority.js");

const input = { category: "Linux", difficulty: "Beginner", duration: "30 mins",
  title: "Logger provenance integration", seed: "logger-provenance:fixed:0",
  generationTime: "2026-07-29T09:00:00.000Z", assetAttempt: 1 };
const context = buildLinuxGenerationContext(input, { assetAttempt: 1 });
const world = buildInvestigationWorld(context);
const incident = buildLinuxIncident(world, context);
const investigation = buildLinuxInvestigationContext(world, incident, input.difficulty);
const simulation = simulationModule.buildLinuxSimulationWorld({ world, incident, investigation,
  difficulty: input.difficulty, seed: context.random("simulation").seed,
  requestedDurationMinutes: context.provenance.durationMinutes });
const args = { input, world, incident, investigation, simulation, intermediate: false, advanced: false };
const assets = [
  ...buildBaseAssets({ ...input, generatedAt: `${simulation.collection.collectedAt.replace(" ", "T")}Z` }),
  buildAuthLog(args), buildSyslog(args), buildSudoLog(args), buildConfigs(args),
  ...buildUserAssets(args), ...buildReportAssets(args), ...buildEvidenceAssets(args),
  ...buildAdvancedLinuxArtifacts(args),
];
prepareLinuxPatchAEvidence(simulation, assets);
const clone = (value) => structuredClone(value);
const find = (list, filePath) => {
  const asset = list.find((item) => item.file_path === filePath);
  assert.ok(asset, `missing ${filePath}`);
  return asset;
};
const validate = (list) => validateLinuxFinalLearnerPackage({ simulation, assets: list });
const scripts = simulationModule.simulationScriptAssets(simulation);
const script = scripts.find((item) => !assets.some((asset) => asset.file_path === item.filePath));
assert.ok(script, "fixture must contain a canonical but unexported background script");
const execution = simulation.scheduledExecutions.find((item) => {
  const command = simulation.commands.find((candidate) => candidate.id === item.commandId);
  return command?.affectedFileIds.some((id) => simulation.files.find((file) => file.id === id)?.path === script.sourcePath);
});
assert.ok(execution);
const processRecord = simulation.processes.find((item) => item.id === execution.processId);
assert.ok(processRecord);
const reference = simulationModule.linuxLearnerSubjectLabel(simulation, execution.id);
const syslog = find(assets, "assets/logs/syslog");
const row = syslog.content.split(/\r?\n/).find((line) => line.includes(`job_ref="${reference}"`));
assert.ok(row);
const processTag = processRecord.executable.split("/").pop();
const loggerTag = script.content.match(/\blogger\s+-t\s+([^\s'";]+)/)?.[1];
assert.ok(loggerTag);
assert.ok(row.includes(`${processTag}[${processRecord.pid}]:`));
assert.ok(row.includes(`logger_tag="${loggerTag}"`));
assert.doesNotThrow(() => validate(assets), "unexported script with no learner promise is valid");

const wrongProcess = clone(assets);
find(wrongProcess, "assets/logs/syslog").content = syslog.content.replace(row,
  row.replace(`${processTag}[${processRecord.pid}]`, `containerd[${processRecord.pid}]`));
assert.throws(() => validate(wrongProcess), /background process provenance mismatch/);

const wrongLogger = clone(assets);
find(wrongLogger, "assets/logs/syslog").content = syslog.content.replace(row,
  row.replace(`logger_tag="${loggerTag}"`, 'logger_tag="unrelated-daemon"'));
assert.throws(() => validate(wrongLogger), /background logger tag conflicts with canonical event provenance/);

const promised = clone(assets);
find(promised, "assets/evidence/incident_brief.md").content +=
  `\nSee ${script.fileName} in the evidence set.\n`;
assert.throws(() => validate(promised), /promises non-exported script evidence/);

const promisedPath = clone(assets);
find(promisedPath, "assets/evidence/incident_brief.md").content +=
  `\nThe supplied source is ${script.filePath}.\n`;
assert.throws(() => validate(promisedPath), /names non-exported script evidence/);

const exported = clone(assets);
exported.push({ file_name: script.fileName, file_type: "shell", file_path: script.filePath, content: script.content });
find(exported, "assets/evidence/incident_brief.md").content +=
  `\nSee ${script.fileName} in the evidence set.\n`;
assert.doesNotThrow(() => validate(exported), "exported script can be explicitly named as evidence");

console.log("PASS logger/provenance integration: unexported tag, process/logger mismatches, evidence promises, exported script");
