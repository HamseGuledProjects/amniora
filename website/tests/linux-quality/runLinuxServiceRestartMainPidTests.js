#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const path = require("node:path");

const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the current compiled output root.");
const { buildLinuxAssetCandidate } = require(path.join(out, "lib/lab-assets/linux/index.js"));
const {
  canonicalProcessRuntimeEndAt,
  validateCanonicalServiceRestartLifecycle,
  validateLinuxSimulationEvidence,
} = require(path.join(out, "lib/lab-assets/linux/simulation.js"));

function candidate(operation, unit = "ssh.service") {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
        seed: `service-mainpid:${unit}:${operation}:${attempt}`,
        generationTime: "2026-07-29T08:00:00.000Z",
        category: "Linux",
        difficulty: "Advanced",
        duration: "30 mins",
        title: "CyberLab Asset Pack",
      }, {
        incidentFamily: "systemd_persistence",
        testOverrides: { command: `systemctl ${operation} ${unit}` },
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`No accepted ${unit} ${operation} candidate`);
}

function asset(result, name) {
  return result.assets.find((item) => item.file_path === name)?.content || "";
}

function rejection(name, expected, action) {
  assert.throws(action, expected, name);
  console.log(`PASS ${name}`);
}

const restarted = candidate("restart");
const simulation = restarted.simulation;
const transition = simulation.serviceTransitions.find((item) =>
  item.operation === "restart" && simulation.services.find((service) => service.id === item.serviceId)?.unitName === "ssh.service"
);
assert(transition, "SSH restart transition missing");
const before = simulation.processes.find((item) => item.id === transition.previousState.mainProcessId);
const after = simulation.processes.find((item) => item.id === transition.resultingState.mainProcessId);
const service = simulation.services.find((item) => item.id === transition.serviceId);
const command = simulation.commands.find((item) => item.id === transition.cause.commandId);
assert(before && after && service && command);
assert.notEqual(before.pid, after.pid);
assert.equal(canonicalProcessRuntimeEndAt(before), transition.occurredAt);
assert(after.startedAt >= command.timestamp && after.startedAt <= transition.occurredAt);
assert.equal(service.mainProcessId, after.id);
validateCanonicalServiceRestartLifecycle(simulation);
validateLinuxSimulationEvidence(simulation, restarted.assets);
console.log(`PASS successful restart: ${service.unitName} ${before.pid}@${before.startedAt} -> ${after.pid}@${after.startedAt}, command ${command.timestamp}, complete ${transition.occurredAt}`);

const inventory = asset(restarted, "assets/reports/service_inventory.txt");
const snapshot = asset(restarted, "assets/runtime/process_snapshot.txt");
const history = asset(restarted, "assets/runtime/process_execution_history.txt");
const openFiles = asset(restarted, "assets/runtime/open_files.txt");
const listeners = asset(restarted, "assets/network/listening_ports.txt");
const journal = asset(restarted, "assets/journal/journal_systemd.txt");
const timeline = asset(restarted, "assets/evidence/timeline.csv");
assert.match(inventory, new RegExp(`^ssh\\.service,.*?,${after.pid},`, "m"));
assert.match(snapshot, new RegExp(`^root\\s+${after.pid}\\s+1\\s+/usr/sbin/sshd`, "m"));
assert.doesNotMatch(snapshot, new RegExp(`^root\\s+${before.pid}\\s+1\\s+/usr/sbin/sshd`, "m"));
assert(history.includes(`${before.startedAt},${transition.occurredAt},completed,${before.pid},`));
assert(history.includes(`${after.startedAt},,running,${after.pid},`));
assert(openFiles.includes(`sshd`) && openFiles.includes(`${after.pid}`) && openFiles.includes("tcp 0.0.0.0:22"));
assert(listeners.includes(`sshd pid=${after.pid}`));
assert(journal.includes(`main_pid=${after.pid}`));
assert(timeline.includes(`ssh.service restart at ${transition.occurredAt}`));
console.log("PASS inventory, current snapshot, history, open files, listener, journal and timeline share the new runtime");

const stale = structuredClone(simulation);
const staleTransition = stale.serviceTransitions.find((item) => item.id === transition.id);
staleTransition.resultingState.mainProcessId = before.id;
rejection("old MainPID rejected", /retained the old MainPID/, () => validateCanonicalServiceRestartLifecycle(stale));

const late = structuredClone(simulation);
late.processes.find((item) => item.id === after.id).startedAt = "2026-07-29 23:59:59";
rejection("process start after restart completion rejected", /outside the restart interval/, () => validateCanonicalServiceRestartLifecycle(late));

const collision = structuredClone(simulation);
collision.processes.find((item) => item.id === after.id).pid = simulation.sshSessions[0].sessionPid;
rejection("live PID collision rejected", /collides with another live process/, () => validateCanonicalServiceRestartLifecycle(collision));

const wrongSnapshot = restarted.assets.map((item) => ({ ...item }));
const snapshotAsset = wrongSnapshot.find((item) => item.file_path === "assets/runtime/process_snapshot.txt");
snapshotAsset.content = snapshotAsset.content.replace(
  new RegExp(`(^root\\s+)${after.pid}(\\s+1\\s+/usr/sbin/sshd)`, "m"),
  `$1${before.pid}$2`
);
assert.notEqual(snapshotAsset.content, snapshot);
rejection("inventory new MainPID but snapshot old MainPID rejected", /main PID .* missing from process_snapshot|process_snapshot/, () =>
  validateLinuxSimulationEvidence(simulation, wrongSnapshot)
);

const reloaded = candidate("reload");
const reloadTransition = reloaded.simulation.serviceTransitions.find((item) => item.operation === "reload" &&
  reloaded.simulation.services.find((service) => service.id === item.serviceId)?.unitName === "ssh.service");
assert(reloadTransition, "SSH reload transition missing");
assert.equal(reloadTransition.previousState.mainProcessId, reloadTransition.resultingState.mainProcessId);
const reloadMain = reloaded.simulation.processes.find((item) => item.id === reloadTransition.resultingState.mainProcessId);
assert(reloadMain && reloadMain.startedAt < reloadTransition.occurredAt);
assert.equal(reloadMain.serviceRetiredAt, undefined);
validateCanonicalServiceRestartLifecycle(reloaded.simulation);
validateLinuxSimulationEvidence(reloaded.simulation, reloaded.assets);
console.log(`PASS reload retains ${reloadMain.pid}@${reloadMain.startedAt}`);

const dockerRestart = candidate("restart", "docker.service");
const dockerTransition = dockerRestart.simulation.serviceTransitions.find((item) => item.operation === "restart" &&
  dockerRestart.simulation.services.find((service) => service.id === item.serviceId)?.unitName === "docker.service");
assert(dockerTransition, "Docker restart transition missing");
const dockerBefore = dockerRestart.simulation.processes.find((item) => item.id === dockerTransition.previousState.mainProcessId);
const dockerAfter = dockerRestart.simulation.processes.find((item) => item.id === dockerTransition.resultingState.mainProcessId);
assert(dockerBefore && dockerAfter && dockerBefore.pid !== dockerAfter.pid);
assert.equal(canonicalProcessRuntimeEndAt(dockerBefore), dockerTransition.occurredAt);
assert(asset(dockerRestart, "assets/network/listening_ports.txt").includes(`dockerd pid=${dockerAfter.pid}`));
assert(asset(dockerRestart, "assets/reports/service_inventory.txt").includes(`docker.service,running,enabled,`));
validateCanonicalServiceRestartLifecycle(dockerRestart.simulation);
validateLinuxSimulationEvidence(dockerRestart.simulation, dockerRestart.assets);
console.log(`PASS docker.service shared restart: ${dockerBefore.pid}@${dockerBefore.startedAt} -> ${dockerAfter.pid}@${dockerAfter.startedAt}`);
