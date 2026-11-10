#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-blueprints-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function buildFamily(buildLinuxAssetCandidate, family) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
        category: "Linux",
        difficulty: "Advanced",
        duration: "60 mins",
        title: "CyberLab Asset Pack",
      }, family ? { incidentFamily: family } : {});
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not generate ${family || "Advanced"}`);
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { LINUX_INVESTIGATION_BLUEPRINTS, linuxInvestigationBlueprintForFamily } = require(path.join(out, "linux", "taskContracts.js"));

  const families = [
    "ssh_bruteforce",
    "ssh_key_compromise",
    "misconfigured_sudoers",
    "service_account_misuse",
    "reverse_shell",
    "data_staging",
    "docker_compromise",
    "unauthorized_package_install",
    "cron_persistence",
    "systemd_persistence",
    "log_tampering",
  ];

  const candidates = [];
  for (const family of families) candidates.push(buildFamily(buildLinuxAssetCandidate, family));
  while (candidates.length < 30) candidates.push(buildFamily(buildLinuxAssetCandidate));

  const stats = {
    total: candidates.length,
    blueprintUsage: {},
    taskCountDistribution: {},
    verbDistribution: {},
    deliverableDistribution: {},
    evidenceBundleDistribution: {},
    familyBlueprints: {},
  };

  for (const candidate of candidates) {
    const tasks = candidate.simulation.canonicalTasks.slice().sort((left, right) => left.order - right.order);
    const family = candidate.investigation.incidentFamily;
    const expectedBlueprint = linuxInvestigationBlueprintForFamily(family);
    const blueprintIds = Array.from(new Set(tasks.map((task) => task.blueprintId)));
    if (blueprintIds.length !== 1 || blueprintIds[0] !== expectedBlueprint.id) {
      throw new Error(`${family} selected ${blueprintIds.join(",")} instead of ${expectedBlueprint.id}`);
    }
    if (tasks.length < 5 || tasks.length > 8) throw new Error(`${family} produced ${tasks.length} tasks`);
    increment(stats.blueprintUsage, blueprintIds[0]);
    increment(stats.taskCountDistribution, String(tasks.length));
    stats.familyBlueprints[family] = blueprintIds[0];
    for (const task of tasks) {
      increment(stats.verbDistribution, task.suggestedVerb || "missing");
      increment(stats.deliverableDistribution, task.expectedDeliverableType);
      increment(stats.evidenceBundleDistribution, task.selectedEvidenceAssetIds.slice().sort().join("|"));
      if (!task.selectedEvidenceAssetIds.length) throw new Error(`${task.id} has no selected evidence`);
    }
  }

  const expectedBlueprintIds = LINUX_INVESTIGATION_BLUEPRINTS.map((blueprint) => blueprint.id);
  const missingBlueprints = expectedBlueprintIds.filter((id) => !stats.blueprintUsage[id]);
  if (missingBlueprints.length > 0) throw new Error(`missing blueprint usage: ${missingBlueprints.join(", ")}`);
  if (Object.keys(stats.taskCountDistribution).length < 2) throw new Error("task count distribution did not vary");
  if (Object.keys(stats.verbDistribution).length < 8) throw new Error("verb distribution did not vary enough");
  if (Object.keys(stats.deliverableDistribution).length < 5) throw new Error("deliverable distribution did not vary enough");
  if (Object.keys(stats.evidenceBundleDistribution).length < 10) throw new Error("evidence bundle distribution did not vary enough");

  console.log(JSON.stringify(stats, null, 2));
}

main();
