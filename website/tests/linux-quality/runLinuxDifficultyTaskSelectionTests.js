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
  const build = path.join(os.tmpdir(), `cyberlab-linux-difficulty-task-selection-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function buildCandidate(buildLinuxAssetCandidate, family, difficulty, seed = "phase2") {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `${seed}:${family}:${difficulty}:${attempt}`,
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

function evidencePaths(candidate, task) {
  const byId = new Map(candidate.simulation.evidenceRegistry.map((asset) => [asset.id, asset]));
  return task.selectedEvidenceAssetIds.map((id) => byId.get(id)?.path || id);
}

function selectedPaths(candidate) {
  return candidate.simulation.canonicalTasks.flatMap((task) => evidencePaths(candidate, task));
}

function renderedPathSet(candidate) {
  return new Set(candidate.assets.map((asset) => asset.file_path));
}

function hasDuplicate(values) {
  return new Set(values).size !== values.length;
}

function unsupportedCapabilities(task, profile) {
  const allowed = new Set([...profile.capabilities.guaranteed, ...profile.capabilities.conditional]);
  return task.requiredCapabilities.filter((capability) => !allowed.has(capability));
}

function supportedTaskIntents(profile) {
  return new Set([...profile.taskIntents.allowed, ...profile.taskIntents.conditional]);
}

function resolverHasIntent(resolveEligibleLinuxTaskSpecs, simulation, registry, difficulty, intent, options) {
  try {
    return resolveEligibleLinuxTaskSpecs(simulation, registry, difficulty, options).specs.some((spec) => spec.intent === intent);
  } catch {
    return false;
  }
}

function removeAssets(registry, predicate) {
  return registry.filter((asset) => !predicate(asset));
}

function assertGeneratedLowerTierCandidate(candidate, difficulty, profile) {
  const tasks = candidate.simulation.canonicalTasks;
  const intents = tasks.map((task) => task.intent);
  if (difficulty === "Beginner") {
    assert(`${candidate.investigation.incidentFamily} Beginner has ${profile.expectedTaskCount.min}-${profile.expectedTaskCount.max} tasks`, tasks.length >= profile.expectedTaskCount.min && tasks.length <= profile.expectedTaskCount.max, intents.join(", "));
    const supported = supportedTaskIntents(profile);
    assert(`${candidate.investigation.incidentFamily} Beginner intents are supported by profile`, intents.every((intent) => supported.has(intent)), intents.join(", "));
  } else {
    assert(`${candidate.investigation.incidentFamily} Intermediate has ${profile.expectedTaskCount.min}-${profile.expectedTaskCount.max} tasks`, tasks.length >= profile.expectedTaskCount.min && tasks.length <= profile.expectedTaskCount.max, intents.join(", "));
    const supported = supportedTaskIntents(profile);
    assert(`${candidate.investigation.incidentFamily} Intermediate intents are allowed or satisfied conditional`, intents.every((intent) => supported.has(intent)), intents.join(", "));
  }
  assert(`${candidate.investigation.incidentFamily} ${difficulty} has no duplicate intents`, !hasDuplicate(intents), intents.join(", "));
  for (const task of tasks) {
    const unsupported = unsupportedCapabilities(task, profile);
    assert(`${candidate.investigation.incidentFamily} ${difficulty} task ${task.intent} has supported capabilities`, unsupported.length === 0, unsupported.join(", "));
  }
  const rendered = renderedPathSet(candidate);
  const paths = selectedPaths(candidate);
  assert(`${candidate.investigation.incidentFamily} ${difficulty} selected evidence is rendered`, paths.every((filePath) => rendered.has(filePath)), paths.filter((filePath) => !rendered.has(filePath)).join(", "));
  const prohibitedEvidence = new Set(profile.evidencePaths.prohibited);
  assert(`${candidate.investigation.incidentFamily} ${difficulty} selects no prohibited evidence`, !paths.some((filePath) => prohibitedEvidence.has(filePath)), paths.filter((filePath) => prohibitedEvidence.has(filePath)).join(", "));
  assert(`${candidate.investigation.incidentFamily} ${difficulty} has no difficulty diagnostics`, candidate.simulation.difficultyDiagnostics.issues.length === 0, JSON.stringify(candidate.simulation.difficultyDiagnostics.issues, null, 2));
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { LINUX_DIFFICULTY_PROFILES } = require(path.join(out, "linux", "difficultyProfile.js"));
  const { resolveEligibleLinuxTaskSpecs } = require(path.join(out, "linux", "simulation.js"));

  const beginnerSignatures = new Map();
  const intermediateSignatures = new Map();
  for (const family of FAMILIES) {
    const beginner = buildCandidate(buildLinuxAssetCandidate, family, "Beginner");
    assertGeneratedLowerTierCandidate(beginner, "Beginner", LINUX_DIFFICULTY_PROFILES.Beginner);
    beginnerSignatures.set(family, beginner.simulation.canonicalTasks.map((task) => `${task.order}:${task.intent}:${evidencePaths(beginner, task).join("|")}`).join(";"));

    const beginnerRepeat = buildCandidate(buildLinuxAssetCandidate, family, "Beginner");
    const beginnerRepeatSignature = beginnerRepeat.simulation.canonicalTasks.map((task) => `${task.order}:${task.intent}:${evidencePaths(beginnerRepeat, task).join("|")}`).join(";");
    assert(`${family} Beginner task selection is deterministic`, beginnerSignatures.get(family) === beginnerRepeatSignature);

    const intermediate = buildCandidate(buildLinuxAssetCandidate, family, "Intermediate");
    assertGeneratedLowerTierCandidate(intermediate, "Intermediate", LINUX_DIFFICULTY_PROFILES.Intermediate);
    intermediateSignatures.set(family, intermediate.simulation.canonicalTasks.map((task) => `${task.order}:${task.intent}:${evidencePaths(intermediate, task).join("|")}`).join(";"));
  }

  const positiveFixtures = [
    ["misconfigured_sudoers", "sudo_policy"],
    ["service_account_misuse", "command_process"],
    ["cron_persistence", "change_control"],
    ["unauthorized_package_install", "package_transaction"],
    ["reverse_shell", "network_source"],
  ];
  for (const [family, intent] of positiveFixtures) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, family, "Advanced", "phase2-positive");
    assert(`synthetic Intermediate full registry enables ${intent}`, resolverHasIntent(
      resolveEligibleLinuxTaskSpecs,
      candidate.simulation,
      candidate.simulation.evidenceRegistry,
      "Intermediate",
      intent,
      { requireRenderedLowerTierEvidence: false }
    ));
  }

  const negativeFixtures = [
    ["misconfigured_sudoers", "sudo_policy", (asset) => asset.capabilities.includes("sudo_authorisation")],
    ["service_account_misuse", "command_process", (asset) => asset.path === "assets/runtime/file_access_history.csv" || asset.capabilities.includes("open_file_correlation")],
    ["cron_persistence", "cron_analysis", (asset) => asset.capabilities.includes("cron_definition") || asset.capabilities.includes("cron_execution")],
    ["unauthorized_package_install", "package_transaction", (asset) => asset.capabilities.includes("package_transaction")],
    ["reverse_shell", "network_source", (asset) => asset.assetType === "network_state"],
    ["ssh_bruteforce", "change_control", (asset) => asset.capabilities.includes("change_control") || asset.capabilities.includes("maintenance_scope")],
    ["systemd_persistence", "risk_assessment", (asset) => asset.capabilities.includes("risk_context")],
  ];
  for (const [family, intent, remover] of negativeFixtures) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, family, "Advanced", "phase2-negative");
    const stripped = removeAssets(candidate.simulation.evidenceRegistry, remover);
    assert(`stripped registry disables ${intent}`, !resolverHasIntent(
      resolveEligibleLinuxTaskSpecs,
      candidate.simulation,
      stripped,
      "Intermediate",
      intent,
      { requireRenderedLowerTierEvidence: false }
    ));
  }

  const sudoLogOnly = buildCandidate(buildLinuxAssetCandidate, "misconfigured_sudoers", "Advanced", "phase2-sudo-log-only");
  assert("sudo.log alone cannot enable sudo_policy", !resolverHasIntent(
    resolveEligibleLinuxTaskSpecs,
    sudoLogOnly.simulation,
    sudoLogOnly.simulation.evidenceRegistry.filter((asset) => asset.path === "assets/logs/sudo.log"),
    "Intermediate",
    "sudo_policy",
    { requireRenderedLowerTierEvidence: false }
  ));

  const authOnlyNetwork = buildCandidate(buildLinuxAssetCandidate, "reverse_shell", "Advanced", "phase2-auth-network");
  assert("auth.log source IP cannot enable network_source", !resolverHasIntent(
    resolveEligibleLinuxTaskSpecs,
    authOnlyNetwork.simulation,
    authOnlyNetwork.simulation.evidenceRegistry.filter((asset) => asset.path === "assets/logs/auth.log"),
    "Intermediate",
    "network_source",
    { requireRenderedLowerTierEvidence: false }
  ));

  const cronFullRegistry = buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Advanced", "phase3-cron-full-registry");
  assert("Intermediate cron_analysis is enabled by conditional cron evidence", resolverHasIntent(
    resolveEligibleLinuxTaskSpecs,
    cronFullRegistry.simulation,
    cronFullRegistry.simulation.evidenceRegistry,
    "Intermediate",
    "cron_analysis",
    { requireRenderedLowerTierEvidence: false }
  ));

  const advancedBefore = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", "Advanced", "phase2-advanced-regression");
  const advancedResolved = resolveEligibleLinuxTaskSpecs(
    advancedBefore.simulation,
    advancedBefore.simulation.evidenceRegistry,
    "Advanced"
  );
  const advancedIntents = advancedBefore.simulation.canonicalTasks.map((task) => task.intent);
  assert("Advanced resolver preserves selected intent set", JSON.stringify(advancedResolved.specs.map((spec) => spec.intent).sort()) === JSON.stringify(advancedIntents.slice().sort()), `${advancedResolved.specs.map((spec) => spec.intent).join(", ")} <> ${advancedIntents.join(", ")}`);
  assert("Advanced still has deep asset pack", advancedBefore.assets.length >= 48, String(advancedBefore.assets.length));
  assert("Advanced selected evidence remains full-registry backed", advancedBefore.simulation.planningEvidenceRegistry.length === advancedBefore.simulation.evidenceRegistry.length);

  console.log(JSON.stringify({
    passed: true,
    families: FAMILIES.length,
    beginnerPlans: beginnerSignatures.size,
    intermediatePlans: intermediateSignatures.size,
    syntheticPositiveFixtures: positiveFixtures.length,
    syntheticNegativeFixtures: negativeFixtures.length,
  }, null, 2));
}

main();
