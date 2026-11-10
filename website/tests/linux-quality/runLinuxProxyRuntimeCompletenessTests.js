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
const { prepareLinuxPatchAEvidence, labelLinuxEvidenceTimeAuthority } = load("linux/learnerQa.js");
const { buildLinuxNetworkContainerLogSemanticReport } = load("linux/networkContainerLogSemantics.js");

function fixture(input, attempt, expectedFamily, expectedRole, controlledRole = false) {
  const generationContext = buildLinuxGenerationContext(input, { assetAttempt: attempt });
  const world = buildInvestigationWorld(generationContext);
  const incident = buildLinuxIncident(world, generationContext);
  assert.equal(incident.id, expectedFamily, `fixed fixture attempt ${attempt} changed family`);
  if (controlledRole) {
    world.serverRole = expectedRole;
    world.host = "proxy-lnx-01";
  }
  assert.equal(world.serverRole, expectedRole, `fixed fixture attempt ${attempt} changed role`);
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
  return { simulation, assets, investigation };
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  assert.ok(found, `missing ${filePath}`);
  return found;
}

function assertProxyRuntime(candidate) {
  const { simulation } = candidate;
  const service = simulation.services.find((item) => item.unitName === "squid.service");
  assert.ok(service, "egress-proxy service absent");
  assert.equal(service.role, "secondary");
  assert.equal(service.unitType, "simple");
  assert.equal(service.activeState, "active");
  assert.equal(service.subState, "running");
  const process = simulation.processes.find((item) => item.id === service.mainProcessId);
  assert.ok(process, "Squid MainPID process absent");
  assert.equal(process.executable, "/usr/sbin/squid");
  assert.equal(process.ppid, 1);
  assert.ok(!process.endedAt || process.endedAt > simulation.collection.windowEnd);
  const identity = simulation.identities.find((item) => item.id === process.identityId);
  assert.equal(identity?.username, "proxy");
  assert.equal(process.effectiveUid, identity.uid);
  assert.equal(process.effectiveGid, identity.gid);
  assert.equal(service.execStart, process.argv.join(" "));
  const listener = simulation.openFileDescriptors.find((item) =>
    item.relatedServiceId === service.id && item.descriptorType === "listening_socket");
  assert.ok(listener, "Squid canonical listener absent");
  assert.equal(listener.processId, process.id);
  assert.equal(listener.pid, process.pid);
  assert.equal(listener.username, identity.username);
  assert.equal(listener.localAddress, "0.0.0.0");
  assert.equal(listener.localPort, 3128);
  assert.equal(listener.protocol, "tcp");
  const rendered = asset(candidate, "assets/network/listening_ports.txt").content;
  assert.match(rendered, new RegExp(`tcp\\s+LISTEN\\s+0\\.0\\.0\\.0:3128\\s+squid pid=${process.pid}\\b`));
  const serviceRow = asset(candidate, "assets/reports/service_inventory.txt").content.split("\n")
    .find((line) => line.startsWith("squid.service,"));
  assert.ok(serviceRow, "rendered Squid service row absent");
  assert.ok(serviceRow.includes(`,${process.pid},/lib/systemd/system/squid.service,`),
    "rendered MainPID or unit path disagrees with canonical state");
  assert.match(asset(candidate, "assets/runtime/open_files.txt").content, /0\.0\.0\.0:3128/);
  simulationModule.validateCanonicalOpenFileDescriptors(simulation);
  simulationModule.validateLinuxSimulationEvidence(simulation, candidate.assets);
  const report = buildLinuxNetworkContainerLogSemanticReport({ simulation, finalAssets: candidate.assets });
  assert.ok(!report.issues.some((issue) => issue.code === "LINUX_ROLE_NETWORK_REALISM_MISMATCH"), JSON.stringify(report.issues));

  const missingListener = { ...candidate, assets: candidate.assets.map((item) => ({ ...item })) };
  asset(missingListener, "assets/network/listening_ports.txt").content = rendered.split("\n")
    .filter((line) => !line.includes(":3128")).join("\n");
  const missingReport = buildLinuxNetworkContainerLogSemanticReport({ simulation, finalAssets: missingListener.assets });
  assert.ok(missingReport.issues.some((issue) => issue.code === "LINUX_ROLE_NETWORK_REALISM_MISMATCH"));

  const wrongPid = structuredClone(simulation);
  wrongPid.openFileDescriptors.find((item) => item.id === listener.id).pid += 1;
  assert.throws(() => simulationModule.validateCanonicalOpenFileDescriptors(wrongPid), /PID mismatch/);
  const wrongOwner = structuredClone(simulation);
  wrongOwner.openFileDescriptors.find((item) => item.id === listener.id).userIdentityId = "identity:root";
  assert.throws(() => simulationModule.validateCanonicalOpenFileDescriptors(wrongOwner), /user identity mismatch/);
}

const seed7 = { category: "Linux", difficulty: "Advanced", duration: "30 mins",
  title: "Advanced SSH key task rebalance", seed: "advanced-ssh-key-rebalance:7",
  generationTime: "2026-07-29T09:00:00.000Z", assetAttempt: 1 };
const proxyKey = fixture(seed7, 7, "ssh_key_compromise", "egress proxy");
assertProxyRuntime(proxyKey);
console.log(`PASS SSH-key fixed proxy fixture ${proxyKey.investigation.incidentId}`);

const otherFamily = fixture({ category: "Linux", difficulty: "Advanced", duration: "60 mins",
  title: "CyberLab Asset Pack",
  seed: "phase2-final-hardening-advanced:Advanced:24",
  generationTime: "2026-07-06T08:00:00.000Z", assetAttempt: 1 },
1, "log_tampering", "egress proxy", true);
assertProxyRuntime(otherFamily);
console.log(`PASS log-tampering fixed fixture with controlled proxy role ${otherFamily.investigation.incidentId}`);

const database = fixture(seed7, 8, "ssh_key_compromise", "database host");
assert.ok(!database.simulation.services.some((item) => item.unitName === "squid.service"));
assert.ok(!database.simulation.openFileDescriptors.some((item) => item.relatedServiceId === "service:squid.service"));
assert.ok(!asset(database, "assets/network/listening_ports.txt").content.includes(":3128"));
simulationModule.validateCanonicalOpenFileDescriptors(database.simulation);
console.log(`PASS non-proxy fixed fixture ${database.investigation.incidentId}`);
