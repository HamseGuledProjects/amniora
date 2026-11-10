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
  const build = path.join(os.tmpdir(), `cyberlab-linux-task-evidence-closure-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function buildCandidate(buildLinuxAssetCandidate, family, difficulty, seed = "phase3", duration = "30 mins") {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `${seed}:${family}:${difficulty}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration,
          title: "CyberLab Asset Pack",
        }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function closureForTask(proveLinuxTaskEvidenceClosure, candidate, task, registry, options = {}) {
  return proveLinuxTaskEvidenceClosure({
    simulation: candidate.simulation,
    intent: task.intent,
    difficulty: task.difficulty,
    registry,
    requirements: task.requirements,
    requiredCapabilities: task.requiredCapabilities,
    currentStateRequirements: task.currentStateRequirements,
    renderedPaths: options.renderedPaths,
    limit: options.limit || 3,
    minimumEvidenceCount: options.minimumEvidenceCount || (task.difficulty === "Advanced" ? 2 : 1),
  });
}

function task(candidate, intent) {
  const found = candidate.simulation.canonicalTasks.find((item) => item.intent === intent);
  if (!found) throw new Error(`missing task ${intent}`);
  return found;
}

function assetByPath(candidate, wanted) {
  const found = candidate.simulation.evidenceRegistry.find((asset) => asset.path === wanted);
  if (!found) throw new Error(`missing asset ${wanted}`);
  return found;
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    assertLinuxTaskEvidenceClosureInvariant,
    proveLinuxTaskEvidenceClosure,
  } = require(path.join(out, "linux", "simulation.js"));

  for (const family of FAMILIES) {
    const beginner = buildCandidate(buildLinuxAssetCandidate, family, "Beginner");
    assertLinuxTaskEvidenceClosureInvariant(beginner.simulation, beginner.assets.map((asset) => asset.file_path));
    assert(`${family} Beginner evidence closure invariant`, true);

    const intermediate = buildCandidate(buildLinuxAssetCandidate, family, "Intermediate");
    assertLinuxTaskEvidenceClosureInvariant(intermediate.simulation, intermediate.assets.map((asset) => asset.file_path));
    assert(`${family} Intermediate evidence closure invariant`, true);
  }

  const sudo = buildCandidate(buildLinuxAssetCandidate, "misconfigured_sudoers", "Advanced", "phase3-sudo", "60 mins");
  const sudoTask = task(sudo, "sudo_policy");
  const sudoLogOnly = closureForTask(
    proveLinuxTaskEvidenceClosure,
    sudo,
    sudoTask,
    [assetByPath(sudo, "assets/logs/sudo.log")]
  );
  assert("sudo.log alone fails current policy closure", !sudoLogOnly.satisfied && sudoLogOnly.missingCurrentStateCapabilities.includes("current_policy_state"));

  const command = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse", "Advanced", "phase3-command", "60 mins");
  const commandTask = task(command, "command_process");
  const commandWithoutOpenFile = closureForTask(
    proveLinuxTaskEvidenceClosure,
    command,
    commandTask,
    command.simulation.evidenceRegistry.filter((asset) => !asset.capabilities.includes("open_file_correlation"))
  );
  assert("command_process fails without open-file correlation", !commandWithoutOpenFile.satisfied && commandWithoutOpenFile.missingCapabilities.includes("open_file_correlation"));

  const cron = buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Advanced", "phase3-cron", "60 mins");
  const cronTask = task(cron, "cron_analysis");
  const cronLogsOnly = closureForTask(
    proveLinuxTaskEvidenceClosure,
    cron,
    cronTask,
    cron.simulation.evidenceRegistry.filter((asset) => asset.path === "assets/logs/cron.log")
  );
  assert("cron logs alone fail definition closure", !cronLogsOnly.satisfied && cronLogsOnly.missingCapabilities.includes("cron_definition"));

  const packageCandidate = buildCandidate(buildLinuxAssetCandidate, "unauthorized_package_install", "Advanced", "phase3-package", "60 mins");
  const packageTask = task(packageCandidate, "package_transaction");
  const inventoryOnly = closureForTask(
    proveLinuxTaskEvidenceClosure,
    packageCandidate,
    packageTask,
    packageCandidate.simulation.evidenceRegistry.filter((asset) => asset.path === "assets/inventory/package_inventory.txt")
  );
  assert("package inventory alone fails transaction closure", !inventoryOnly.satisfied && inventoryOnly.missingCanonicalSubjects.length > 0);

  const change = buildCandidate(buildLinuxAssetCandidate, "ssh_bruteforce", "Advanced", "phase3-change", "60 mins");
  const changeTask = task(change, "change_control");
  const changeWithoutRelation = change.simulation.evidenceRegistry
    .filter((asset) => asset.capabilities.includes("change_control") || asset.capabilities.includes("maintenance_scope"))
    .map((asset) => ({ ...asset, relations: [] }));
  const missingChangeRelation = closureForTask(proveLinuxTaskEvidenceClosure, change, changeTask, changeWithoutRelation);
  assert("change_control fails without required relationship", !missingChangeRelation.satisfied && missingChangeRelation.missingRelationships.length > 0);

  const network = buildCandidate(buildLinuxAssetCandidate, "reverse_shell", "Advanced", "phase3-network", "60 mins");
  const networkTask = task(network, "network_source");
  const authOnlyNetwork = closureForTask(
    proveLinuxTaskEvidenceClosure,
    network,
    networkTask,
    network.simulation.evidenceRegistry.filter((asset) => asset.path === "assets/logs/auth.log")
  );
  assert("auth.log source IP alone fails network_source closure", !authOnlyNetwork.satisfied && authOnlyNetwork.missingCapabilities.includes("network_source"));

  const selectedCommandIds = new Set(commandTask.selectedEvidenceAssetIds);
  const wrongSubject = clone(command.simulation.evidenceRegistry.filter((asset) => selectedCommandIds.has(asset.id)));
  for (const asset of wrongSubject) {
    asset.canonicalObjectIds = asset.canonicalObjectIds.filter((id) => !commandTask.primarySubjectIds.includes(id));
    asset.relations = [];
  }
  const wrongSubjectResult = closureForTask(proveLinuxTaskEvidenceClosure, command, commandTask, wrongSubject);
  assert("wrong-subject evidence fails subject closure", !wrongSubjectResult.satisfied && wrongSubjectResult.missingCanonicalSubjects.length > 0);

  const rendered = new Set(command.assets.map((asset) => asset.file_path));
  const firstSelected = commandTask.selectedEvidenceAssetIds[0];
  const firstSelectedPath = command.simulation.evidenceRegistry.find((asset) => asset.id === firstSelected)?.path;
  if (firstSelectedPath) rendered.delete(firstSelectedPath);
  assert("selected path absent from rendered pack fails path closure", (() => {
    try {
      assertLinuxTaskEvidenceClosureInvariant(command.simulation, Array.from(rendered));
      return false;
    } catch {
      return true;
    }
  })());

  const beginner = buildCandidate(buildLinuxAssetCandidate, "misconfigured_sudoers", "Beginner", "phase3-beginner-leak");
  const beginnerClone = clone(beginner.simulation);
  const auditAsset = beginner.simulation.evidenceRegistry.find((asset) => asset.path === "assets/logs/audit.log");
  if (auditAsset) beginnerClone.canonicalTasks[0].selectedEvidenceAssetIds = [auditAsset.id];
  assert("Advanced-only evidence injected into Beginner fails invariant", (() => {
    try {
      assertLinuxTaskEvidenceClosureInvariant(beginnerClone, beginner.assets.map((asset) => asset.file_path));
      return false;
    } catch {
      return true;
    }
  })());

  const first = closureForTask(proveLinuxTaskEvidenceClosure, command, commandTask, command.simulation.evidenceRegistry);
  const second = closureForTask(proveLinuxTaskEvidenceClosure, command, commandTask, command.simulation.evidenceRegistry);
  assert("closure selected evidence is deterministic", JSON.stringify(first.selectedEvidence.map((asset) => asset.path)) === JSON.stringify(second.selectedEvidence.map((asset) => asset.path)));

  const limitExceeded = closureForTask(proveLinuxTaskEvidenceClosure, command, commandTask, command.simulation.evidenceRegistry, { limit: 1, minimumEvidenceCount: 1 });
  assert("evidence limit overflow is explicit", !limitExceeded.satisfied && limitExceeded.selectionDiagnostics.some((item) => item.code === "LINUX_TASK_EVIDENCE_LIMIT_EXCEEDED"));

  console.log(JSON.stringify({ passed: true, families: FAMILIES.length }, null, 2));
}

main();
