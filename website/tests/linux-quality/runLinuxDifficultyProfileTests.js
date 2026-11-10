#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-difficulty-profile-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function buildCandidate(buildLinuxAssetCandidate, family, difficulty) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `difficulty-profile:${family}:${difficulty}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
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

function normalized(pathName) {
  return String(pathName).replace(/\\/g, "/").toLowerCase();
}

function paths(registry) {
  return new Set(registry.map((asset) => normalized(asset.path)));
}

function taskPaths(candidate, task) {
  const registryById = new Map(candidate.simulation.evidenceRegistry.map((asset) => [asset.id, asset]));
  return task.selectedEvidenceAssetIds.map((id) => registryById.get(id)?.path || id);
}

function expectPath(set, pathName) {
  assert(`includes ${pathName}`, set.has(normalized(pathName)), Array.from(set).sort().join(", "));
}

function rejectPath(set, pathName) {
  assert(`excludes ${pathName}`, !set.has(normalized(pathName)), Array.from(set).sort().join(", "));
}

function hasCode(candidate, code) {
  return candidate.simulation.difficultyDiagnostics.issues.some((issue) => issue.code === code);
}

function hasTaskCode(candidate, intent, code) {
  return candidate.simulation.difficultyDiagnostics.issues.some((issue) => issue.intent === intent && issue.code === code);
}

function hasPlannerCode(candidate, intent, code) {
  return candidate.simulation.taskPlannerDiagnostics.some((issue) => issue.intent === intent && issue.code === code);
}

function assertClassifiedExactlyOnce(label, universe, profile, groups) {
  const seen = new Map();
  for (const groupName of groups) {
    for (const item of profile[groupName] || []) {
      if (seen.has(item)) throw new Error(`${label}: ${item} appears in ${seen.get(item)} and ${groupName}`);
      seen.set(item, groupName);
    }
  }
  for (const item of universe) {
    if (!seen.has(item)) throw new Error(`${label}: ${item} is unclassified`);
  }
  for (const item of seen.keys()) {
    if (!universe.includes(item)) throw new Error(`${label}: ${item} is not canonical`);
  }
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { LINUX_TASK_CONTRACTS } = require(path.join(out, "linux", "taskContracts.js"));
  const {
    ALL_LINUX_EVIDENCE_CAPABILITIES,
    ALL_LINUX_TASK_INTENTS,
    LINUX_DIFFICULTY_PROFILES,
    filterEvidenceRegistryForDifficulty,
    validateLinuxTaskPlanAgainstDifficultyProfile,
  } = require(path.join(out, "linux", "difficultyProfile.js"));

  const contractIntents = Object.keys(LINUX_TASK_CONTRACTS).sort();
  assert("exported task intent universe matches contracts", JSON.stringify([...ALL_LINUX_TASK_INTENTS].sort()) === JSON.stringify(contractIntents));

  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const profile = LINUX_DIFFICULTY_PROFILES[difficulty];
    assertClassifiedExactlyOnce(`${difficulty} intents`, [...ALL_LINUX_TASK_INTENTS], profile.taskIntents, ["allowed", "conditional", "prohibited"]);
    assertClassifiedExactlyOnce(`${difficulty} capabilities`, [...ALL_LINUX_EVIDENCE_CAPABILITIES], profile.capabilities, ["guaranteed", "conditional", "prohibited"]);
    assert("no duplicate guaranteed evidence paths", new Set(profile.evidencePaths.guaranteed).size === profile.evidencePaths.guaranteed.length, difficulty);
    assert("no duplicate conditional evidence paths", new Set(profile.evidencePaths.conditional).size === profile.evidencePaths.conditional.length, difficulty);
    assert("no duplicate prohibited evidence paths", new Set(profile.evidencePaths.prohibited).size === profile.evidencePaths.prohibited.length, difficulty);
  }

  const beginner = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse", "Beginner");
  const beginnerPlanningPaths = paths(beginner.simulation.planningEvidenceRegistry);
  [
    "assets/logs/auth.log",
    "assets/logs/sudo.log",
    "assets/logs/syslog",
    "assets/configs/linux_config_pack.txt",
    "assets/csv/users.csv",
    "assets/csv/groups.csv",
    "assets/reports/permissions_report.txt",
    "assets/reports/service_inventory.txt",
    "assets/evidence/timeline.csv",
    "assets/evidence/incident_brief.md",
  ].forEach((pathName) => expectPath(beginnerPlanningPaths, pathName));
  [
    "assets/runtime/process_execution_history.txt",
    "assets/runtime/file_access_history.csv",
    "assets/configs/sudoers.d/platform",
    "assets/logs/apt_history.log",
    "assets/inventory/package_inventory.txt",
    "assets/scheduled/root_crontab.txt",
    "assets/network/listening_ports.txt",
    "assets/network/ufw_status.txt",
    "assets/docs/maintenance_ticket.md",
    "assets/docs/change_request.md",
    "assets/runtime/open_files.txt",
    "assets/runtime/process_snapshot.txt",
  ].forEach((pathName) => rejectPath(beginnerPlanningPaths, pathName));

  for (const task of beginner.simulation.canonicalTasks) {
    const selectedPaths = taskPaths(beginner, task).map(normalized);
    assert("Beginner planner does not select process history", !selectedPaths.includes("assets/runtime/process_execution_history.txt"), task.id);
    assert("Beginner planner does not select sudoers platform", !selectedPaths.includes("assets/configs/sudoers.d/platform"), task.id);
    assert("Beginner planner does not select maintenance ticket", !selectedPaths.includes("assets/docs/maintenance_ticket.md"), task.id);
    assert("Beginner planner selections are in planning registry", selectedPaths.every((pathName) => beginnerPlanningPaths.has(pathName)), `${task.id}: ${selectedPaths.join(", ")}`);
  }
  assert("Beginner excludes command_process before task planning", !beginner.simulation.canonicalTasks.some((task) => task.intent === "command_process"));
  assert("Beginner command_process planner diagnostic reports prohibited intent", hasPlannerCode(beginner, "command_process", "LINUX_TASK_INTENT_PROHIBITED_FOR_DIFFICULTY"));

  const beginnerSudo = buildCandidate(buildLinuxAssetCandidate, "misconfigured_sudoers", "Beginner");
  assert("Beginner misconfigured_sudoers reserves sudo_policy for incident coverage", beginnerSudo.simulation.canonicalTasks.some((task) => task.intent === "sudo_policy"));
  const beginnerSudoPolicy = beginnerSudo.simulation.canonicalTasks.find((task) => task.intent === "sudo_policy");
  assert("Beginner sudo_policy uses rendered compact evidence", taskPaths(beginnerSudo, beginnerSudoPolicy).map(normalized).every((pathName) => beginnerPlanningPaths.has(pathName)), taskPaths(beginnerSudo, beginnerSudoPolicy).join(", "));

  const beginnerCron = buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Beginner");
  assert("Beginner excludes cron_analysis before task planning", !beginnerCron.simulation.canonicalTasks.some((task) => task.intent === "cron_analysis"));

  const beginnerPackage = buildCandidate(buildLinuxAssetCandidate, "unauthorized_package_install", "Beginner");
  assert("Beginner excludes package_transaction before task planning", !beginnerPackage.simulation.canonicalTasks.some((task) => task.intent === "package_transaction"));

  const beginnerNetwork = buildCandidate(buildLinuxAssetCandidate, "reverse_shell", "Beginner");
  assert("Beginner excludes network_source before task planning", !beginnerNetwork.simulation.canonicalTasks.some((task) => task.intent === "network_source"));

  const synthetic = validateLinuxTaskPlanAgainstDifficultyProfile({
    difficulty: "Beginner",
    tasks: [{
      id: "task:synthetic",
      intent: "synthetic_intent",
      requiredCapabilities: ["synthetic_capability"],
      currentStateRequirements: [],
      selectedEvidenceAssetIds: [],
    }],
    fullEvidenceRegistry: beginner.simulation.evidenceRegistry,
    planningEvidenceRegistry: beginner.simulation.planningEvidenceRegistry,
  });
  assert("synthetic intent diagnostic is unclassified", synthetic.issues.some((issue) => issue.code === "LINUX_DIFFICULTY_UNCLASSIFIED_INTENT"));
  assert("synthetic capability diagnostic is unclassified", synthetic.issues.some((issue) => issue.code === "LINUX_DIFFICULTY_UNCLASSIFIED_CAPABILITY"));

  const injectedLeak = validateLinuxTaskPlanAgainstDifficultyProfile({
    difficulty: "Beginner",
    tasks: [{
      ...beginner.simulation.canonicalTasks[0],
      selectedEvidenceAssetIds: ["evidence:runtime-process-execution-history-txt"],
    }],
    fullEvidenceRegistry: beginner.simulation.evidenceRegistry,
    planningEvidenceRegistry: beginner.simulation.planningEvidenceRegistry,
  });
  assert("Beginner selected Advanced-only evidence is diagnosed", injectedLeak.issues.some((issue) =>
    issue.code === "LINUX_DIFFICULTY_PROHIBITED_EVIDENCE" || issue.code === "LINUX_DIFFICULTY_ADVANCED_ASSET_LEAK"
  ));

  const intermediate = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", "Intermediate");
  const intermediatePlanningPaths = paths(intermediate.simulation.planningEvidenceRegistry);
  [
    "assets/configs/sudoers.d/platform",
    "assets/runtime/process_execution_history.txt",
    "assets/runtime/file_access_history.csv",
    "assets/docs/maintenance_ticket.md",
  ].forEach((pathName) => expectPath(intermediatePlanningPaths, pathName));
  rejectPath(intermediatePlanningPaths, "assets/logs/apt_history.log");
  rejectPath(intermediatePlanningPaths, "assets/inventory/package_inventory.txt");
  rejectPath(intermediatePlanningPaths, "assets/network/listening_ports.txt");
  rejectPath(intermediatePlanningPaths, "assets/scheduled/root_crontab.txt");

  const intermediateCron = buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Intermediate");
  assert("Intermediate cron conditional evidence appears when relevant", Array.from(paths(intermediateCron.simulation.planningEvidenceRegistry)).some((pathName) =>
    pathName === "assets/scheduled/root_crontab.txt" || pathName.startsWith("assets/scheduled/cron.d/")
  ));

  const intermediatePackage = buildCandidate(buildLinuxAssetCandidate, "unauthorized_package_install", "Intermediate");
  expectPath(paths(intermediatePackage.simulation.planningEvidenceRegistry), "assets/logs/apt_history.log");
  expectPath(paths(intermediatePackage.simulation.planningEvidenceRegistry), "assets/inventory/package_inventory.txt");

  const intermediateNetwork = buildCandidate(buildLinuxAssetCandidate, "reverse_shell", "Intermediate");
  expectPath(paths(intermediateNetwork.simulation.planningEvidenceRegistry), "assets/network/listening_ports.txt");
  expectPath(paths(intermediateNetwork.simulation.planningEvidenceRegistry), "assets/network/ufw_status.txt");

  const advanced = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", "Advanced");
  const advancedFull = advanced.simulation.evidenceRegistry.map((asset) => asset.id).sort();
  const advancedPlanning = advanced.simulation.planningEvidenceRegistry.map((asset) => asset.id).sort();
  assert("Advanced planning registry preserves full registry", JSON.stringify(advancedFull) === JSON.stringify(advancedPlanning));
  assert("Advanced diagnostics are clean", !hasCode(advanced, "LINUX_DIFFICULTY_UNSUPPORTED_INTENT") && !hasCode(advanced, "LINUX_DIFFICULTY_UNSUPPORTED_CAPABILITY"));

  const refiltered = filterEvidenceRegistryForDifficulty(beginner.simulation.evidenceRegistry, "Beginner", beginner.simulation);
  assert("Beginner registry filtering is deterministic", JSON.stringify(refiltered.map((asset) => asset.path)) === JSON.stringify(beginner.simulation.planningEvidenceRegistry.map((asset) => asset.path)));

  console.log(JSON.stringify({
    passed: true,
    profiles: Object.keys(LINUX_DIFFICULTY_PROFILES).length,
    beginnerPlanningAssets: beginner.simulation.planningEvidenceRegistry.length,
    intermediatePlanningAssets: intermediate.simulation.planningEvidenceRegistry.length,
    advancedPlanningAssets: advanced.simulation.planningEvidenceRegistry.length,
    beginnerDiagnosticIssues: beginner.simulation.difficultyDiagnostics.issues.length,
  }, null, 2));
}

main();
