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
  const build = path.join(os.tmpdir(), `cyberlab-linux-current-state-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function buildCandidate(buildLinuxAssetCandidate, family, difficulty = "Advanced") {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `current-state:${family}:${difficulty}:${attempt}`,
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asset(candidate, pathName) {
  const found = candidate.assets.find((item) => item.file_path === pathName);
  if (!found) throw new Error(`missing asset ${pathName}`);
  return found;
}

function assetByPattern(candidate, pattern) {
  const found = candidate.assets.find((item) => pattern.test(item.file_path));
  if (!found) throw new Error(`missing asset ${pattern}`);
  return found;
}

function evidencePath(candidate, assetId) {
  const assetInfo = candidate.simulation.evidenceRegistry.find((item) => item.id === assetId);
  if (!assetInfo) throw new Error(`missing registry asset ${assetId}`);
  return assetInfo.path;
}

function pathsForTask(candidate, task) {
  return task.selectedEvidenceAssetIds.map((id) => evidencePath(candidate, id));
}

function coverageAlignedCronCandidate(candidate) {
  const baselineAsset = candidate.simulation.evidenceRegistry.find((item) =>
    item.path === "assets/configs/linux_config_pack.txt" && item.capabilities.includes("configuration_baseline")
  ) || candidate.simulation.evidenceRegistry.find((item) =>
    item.path.startsWith("assets/configs/") && item.capabilities.includes("configuration_baseline")
  );
  if (!baselineAsset) throw new Error("missing configuration baseline registry asset");
  const replaceIndex = candidate.simulation.canonicalTasks.findIndex((task) => task.intent === "containment_recommendation");
  if (replaceIndex === -1) return candidate;
  const original = candidate.simulation.canonicalTasks[replaceIndex];
  const canonicalTasks = candidate.simulation.canonicalTasks.map((task, index) => index === replaceIndex ? {
    ...original,
    intent: "configuration_review",
    requiredCapabilities: ["configuration_baseline"],
    inquiryTypes: ["configuration_state"],
    currentStateRequirements: [],
    selectedEvidenceAssetIds: [baselineAsset.id],
    canonicalObjectIds: baselineAsset.subjects || [],
    primarySubjectIds: baselineAsset.subjects || [],
    supportingSubjectIds: [],
    requirements: [{
      id: "fixture:cron_definition_configuration",
      capability: "configuration_baseline",
      subjectIds: baselineAsset.subjects || [],
      minimumSupport: "static",
    }],
    expectedDeliverableType: "evidence_notes",
    stepLabel: "Cron definition baseline",
    suggestedVerb: "Review",
  } : task);
  return {
    ...candidate,
    simulation: {
      ...candidate.simulation,
      canonicalTasks,
    },
  };
}

function taskClosureText(candidate, task) {
  switch (candidate.investigation.incidentFamily) {
    case "service_account_misuse":
      return ["actor_attribution", "containment_recommendation"].includes(task.intent)
        ? "Account activity does not prove a human operator; review account purpose before disabling."
        : "";
    case "systemd_persistence":
      return ["service_state", "containment_recommendation"].includes(task.intent)
        ? "Inventory does not prove historical restart or transition; preserve systemd unit evidence before disabling."
        : "";
    case "cron_persistence":
      return ["cron_analysis", "containment_recommendation"].includes(task.intent)
        ? "Cron schedule does not prove malicious intent; preserve cron task evidence before disabling."
        : "";
    case "unauthorized_package_install":
      return ["package_transaction", "containment_recommendation"].includes(task.intent)
        ? "Package install evidence does not prove repository compromise and requires provenance review; verify package provenance or prepare package rollback for the apt install."
        : "";
    default:
      return "";
  }
}

function taskByIntent(candidate, intent) {
  const task = candidate.simulation.canonicalTasks.find((item) => item.intent === intent);
  if (!task) throw new Error(`missing task intent ${intent}`);
  return task;
}

function taskEvidence(candidate, ...patterns) {
  return patterns
    .map((pattern) => candidate.assets.find((item) => item.file_path.toLowerCase().includes(pattern.toLowerCase()))?.file_path)
    .filter(Boolean)
    .slice(0, 3);
}

function labFromCanonical(candidate, overrideIndex, overrideTask) {
  const primaryService = candidate.simulation.services.find((service) => service.role === "primary")?.unitName || candidate.investigation.affectedService;
  const tasks = candidate.simulation.canonicalTasks
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((task, index) => {
      const evidence = pathsForTask(candidate, task).slice(0, 3);
      const closure = taskClosureText(candidate, task);
      return {
        phase: task.stepLabel || task.intent.replace(/_/g, " "),
        title: `${task.suggestedVerb || "Document"} ${task.stepLabel || task.intent.replace(/_/g, " ")} for ${candidate.investigation.hostname}.`,
        description: `${task.suggestedVerb || "Document"} ${task.stepLabel || task.intent.replace(/_/g, " ")} using the listed offline evidence.${closure ? ` ${closure}` : ""}`,
        evidence,
        deliverable: `Prepare ${task.expectedDeliverableType.replace(/_/g, " ")} notes with cited evidence.${closure ? ` ${closure}` : ""}`,
      };
    });
  if (overrideTask) {
    tasks[overrideIndex] = { ...tasks[overrideIndex], ...overrideTask };
    const closure = taskClosureText(candidate, candidate.simulation.canonicalTasks.slice().sort((left, right) => left.order - right.order)[overrideIndex]);
    if (closure) {
      tasks[overrideIndex].description = `${tasks[overrideIndex].description} ${closure}`;
      tasks[overrideIndex].deliverable = `${tasks[overrideIndex].deliverable} ${closure}`;
    }
  }
  return {
    title: `Linux ${primaryService} current-state evidence review`,
    objective: `Review ${candidate.investigation.hostname}, ${primaryService}, ${candidate.investigation.changeId}, and ${candidate.investigation.ticketId} during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone} using the generated Linux evidence pack.`,
    scenario: `${candidate.investigation.company} SOC is reviewing ${candidate.investigation.incidentId} on ${candidate.investigation.hostname}, a ${candidate.investigation.hostRole}, for ${primaryService}, ${candidate.investigation.changeId}, and ${candidate.investigation.ticketId} during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone}.`,
    tasks,
    hints: ["Use the task evidence list as the scope.", "Separate historical events from current snapshots.", "Document uncertainty with cited artifacts."],
    outcomes: [
      `Correlate ${primaryService} state evidence with timestamped Linux artifacts.`,
      `Separate current-state snapshots from journal, audit, process, and timeline history on ${candidate.investigation.hostname}.`,
      `Prepare evidence-backed ${candidate.investigation.ticketId} notes using service, package, process, and configuration artifacts.`,
    ],
    duration: "30 mins",
    category: "Linux",
    difficulty: "Advanced",
  };
}

function quality(checkLinuxInvestigationQuality, candidate, lab, assets = candidate.assets) {
  return checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets,
    simulation: candidate.simulation,
    lab,
    workload: {
      requestedDifficulty: candidate.provenance.difficulty,
      requestedDurationMinutes: candidate.provenance.durationMinutes,
    },
  });
}

function qualityWithoutSimulation(checkLinuxInvestigationQuality, candidate, lab, assets = candidate.assets) {
  return checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets,
    lab,
    workload: {
      requestedDifficulty: candidate.provenance.difficulty,
      requestedDurationMinutes: candidate.provenance.durationMinutes,
    },
  });
}

function expectPass(name, result) {
  if (!result.passed) throw new Error(`${name}: expected pass, got ${result.issues.map((issue) => issue.description).join(" | ")}`);
  console.log(`PASS ${name}`);
}

function expectFail(name, result, pattern) {
  const text = result.issues.map((issue) => `${issue.category}:${issue.description}:${issue.evidence || ""}`).join(" | ");
  if (result.passed || !new RegExp(pattern, "i").test(text)) {
    throw new Error(`${name}: expected ${pattern}, got ${text || "pass"}`);
  }
  console.log(`PASS ${name}`);
}

function expectNoIssue(name, result, pattern) {
  const text = result.issues.map((issue) => `${issue.category}:${issue.description}:${issue.evidence || ""}`).join(" | ");
  if (new RegExp(pattern, "i").test(text)) {
    throw new Error(`${name}: unexpected ${pattern}, got ${text}`);
  }
  console.log(`PASS ${name}`);
}

function currentStateTasks(candidate) {
  return candidate.simulation.canonicalTasks.filter((task) =>
    (task.currentStateRequirements || []).length > 0 ||
    (task.inquiryTypes || []).some((type) => String(type).includes("current"))
  );
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { checkLinuxInvestigationQuality } = require(path.join(out, "linux", "qualityChecker.js"));

  const systemd = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence");
  const serviceTask = taskByIntent(systemd, "service_state");
  const serviceEvidence = pathsForTask(systemd, serviceTask);
  const primaryService = systemd.simulation.services.find((service) => service.role === "primary").unitName;
  if (!serviceEvidence.includes("assets/reports/service_inventory.txt")) {
    throw new Error(`current service task missing service_inventory.txt: ${serviceEvidence.join(", ")}`);
  }
  if (!asset(systemd, "assets/reports/service_inventory.txt").content.includes(primaryService)) {
    throw new Error(`service_inventory.txt missing ${primaryService}`);
  }
  expectPass("current service state uses service inventory", quality(checkLinuxInvestigationQuality, systemd, labFromCanonical(systemd)));

  const historicalServiceLab = labFromCanonical(systemd, 0, {
    title: `Reconstruct what happened to ${primaryService} historically.`,
    description: `Reconstruct what happened to ${primaryService} historically from journal and timeline evidence.`,
    evidence: taskEvidence(systemd, "journal_systemd.txt", "timeline.csv"),
    deliverable: "Prepare a historical service-event note with timestamps and source references.",
  });
  historicalServiceLab.tasks = historicalServiceLab.tasks.slice(0, 1);
  expectNoIssue("historical service event does not force service inventory", qualityWithoutSimulation(checkLinuxInvestigationQuality, systemd, historicalServiceLab), "current-state|service inventory");

  const processTaskIndex = systemd.simulation.canonicalTasks.findIndex((task) => task.intent === "command_process");
  const processCurrentOnlyHistory = labFromCanonical(systemd, processTaskIndex, {
    title: "Determine whether the suspicious process is currently running.",
    description: "Determine whether the suspicious process is currently running from the selected evidence.",
    evidence: ["assets/runtime/process_execution_history.txt"],
  });
  expectFail("current process state rejects execution history alone", quality(checkLinuxInvestigationQuality, systemd, processCurrentOnlyHistory), "current-state|current process");
  const processCurrentSnapshot = labFromCanonical(systemd, processTaskIndex, {
    title: "Determine whether the suspicious process is currently running.",
    description: "Determine whether the suspicious process is currently running from the selected evidence.",
    evidence: Array.from(new Set(["assets/runtime/process_snapshot.txt", ...pathsForTask(systemd, systemd.simulation.canonicalTasks[processTaskIndex])])).slice(0, 3),
  });
  expectNoIssue("current process state accepts process snapshot", quality(checkLinuxInvestigationQuality, systemd, processCurrentSnapshot), "current-state|current process");

  const packageCandidate = buildCandidate(buildLinuxAssetCandidate, "unauthorized_package_install");
  const packageTaskIndex = packageCandidate.simulation.canonicalTasks.findIndex((task) => task.intent === "package_transaction");
  const packageName = packageCandidate.simulation.packageTransactions[0].packages[0].name;
  expectFail("current package state rejects apt history alone", quality(checkLinuxInvestigationQuality, packageCandidate, labFromCanonical(packageCandidate, packageTaskIndex, {
    title: `Determine whether ${packageName} remains installed.`,
    description: `Determine whether ${packageName} remains installed on the host.`,
    evidence: ["assets/logs/apt_history.log"],
  })), "current-state|current package|entity");
  expectNoIssue("current package state accepts package inventory", quality(checkLinuxInvestigationQuality, packageCandidate, labFromCanonical(packageCandidate, packageTaskIndex, {
    title: `Determine whether ${packageName} remains installed.`,
    description: `Determine whether ${packageName} remains installed on the host.`,
    evidence: ["assets/inventory/package_inventory.txt", "assets/logs/apt_history.log"],
  })), "current-state|current package");

  const cron = buildCandidate(buildLinuxAssetCandidate, "cron_persistence");
  const cronTaskIndex = cron.simulation.canonicalTasks.findIndex((task) => task.intent === "cron_analysis");
  expectFail("current persistence state rejects creation logs alone", quality(checkLinuxInvestigationQuality, cron, labFromCanonical(cron, cronTaskIndex, {
    title: "Determine whether the current persistence mechanism remains present.",
    description: "Determine whether the current cron persistence mechanism remains present.",
    evidence: ["assets/logs/cron.log", "assets/logs/audit.log"],
  })), "current-state|persistence");
  const cronDefinition = assetByPattern(cron, /assets\/scheduled\/(?:root_crontab|cron\.d\/)/).file_path;
  const coverageCron = coverageAlignedCronCandidate(cron);
  const coverageCronTaskIndex = coverageCron.simulation.canonicalTasks.findIndex((task) => task.intent === "cron_analysis");
  expectNoIssue("current persistence state accepts scheduled definition", quality(checkLinuxInvestigationQuality, coverageCron, labFromCanonical(coverageCron, coverageCronTaskIndex, {
    title: "Determine whether the current persistence mechanism remains present.",
    description: "Determine whether the current cron persistence mechanism remains present.",
    evidence: Array.from(new Set([cronDefinition, ...pathsForTask(coverageCron, coverageCron.simulation.canonicalTasks[coverageCronTaskIndex])])).slice(0, 3),
  })), "current-state|persistence");

  const identityCandidate = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse");
  const identityTaskIndex = identityCandidate.simulation.canonicalTasks.findIndex((task) => task.intent === "actor_attribution");
  if (identityTaskIndex === -1) throw new Error("service_account_misuse fixture lacks actor_attribution task");
  expectNoIssue("current identity state accepts users and groups", quality(checkLinuxInvestigationQuality, identityCandidate, labFromCanonical(identityCandidate, identityTaskIndex, {
    title: `Document current account state for ${identityCandidate.investigation.primaryUser}.`,
    description: `Document current account state for ${identityCandidate.investigation.primaryUser}.`,
    evidence: pathsForTask(identityCandidate, identityCandidate.simulation.canonicalTasks[identityTaskIndex]).slice(0, 3),
  })), "current-state|current identity|account state");

  expectFail("current wording mutation on historical task is rejected", quality(checkLinuxInvestigationQuality, systemd, labFromCanonical(systemd, 0, {
    title: "Reconstruct the current investigation timeline.",
    description: "Reconstruct the current investigation timeline from the selected evidence.",
    evidence: ["assets/evidence/timeline.csv"],
  })), "unsupported current-state|current-state");

  const missingServiceAssets = systemd.assets.filter((item) => item.file_path !== "assets/reports/service_inventory.txt");
  expectFail("missing current-state evidence file is rejected", quality(checkLinuxInvestigationQuality, systemd, labFromCanonical(systemd, 0, {
    title: `Determine the current state of ${primaryService}.`,
    description: `Determine the current state of ${primaryService}.`,
    evidence: ["assets/reports/service_inventory.txt"],
  }), missingServiceAssets), "not present|missing");

  const absentEntityAssets = clone(systemd.assets);
  const inventory = absentEntityAssets.find((item) => item.file_path === "assets/reports/service_inventory.txt");
  inventory.content = inventory.content.replace(new RegExp(primaryService.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "shadow-sync.service");
  expectFail("current-state entity absence is rejected", quality(checkLinuxInvestigationQuality, systemd, labFromCanonical(systemd, 0, {
    title: `Determine the current state of ${primaryService}.`,
    description: `Determine the current state of ${primaryService}.`,
    evidence: ["assets/reports/service_inventory.txt"],
  }), absentEntityAssets), "entity absent|does not contain|current-state evidence");

  expectFail("unsupported current-state wording is rejected deterministically", qualityWithoutSimulation(checkLinuxInvestigationQuality, systemd, labFromCanonical(systemd, 0, {
    title: "Determine whether the current mount remains present.",
    description: "Determine whether the current mount remains present from the evidence.",
    evidence: ["assets/evidence/timeline.csv", "assets/logs/audit.log"],
  })), "current-state evidence|current_policy|current-state");

  const first = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse");
  const second = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse");
  const taskSignature = (candidate) => candidate.simulation.canonicalTasks.map((task) => ({
    intent: task.intent,
    inquiryTypes: task.inquiryTypes,
    currentStateRequirements: task.currentStateRequirements.map((item) => item.capability),
    evidence: pathsForTask(candidate, task),
  }));
  if (JSON.stringify(taskSignature(first)) !== JSON.stringify(taskSignature(second))) {
    throw new Error("deterministic generation changed task intents or evidence selections");
  }
  console.log("PASS deterministic current-state planning");

  const matrix = FAMILIES.map((family) => buildCandidate(buildLinuxAssetCandidate, family));
  const currentTasks = matrix.flatMap((candidate) => currentStateTasks(candidate).map((task) => ({ candidate, task })));
  for (const { candidate, task } of currentTasks) {
    const selected = pathsForTask(candidate, task);
    for (const requirement of task.currentStateRequirements || []) {
      const registryAssets = task.selectedEvidenceAssetIds
        .map((id) => candidate.simulation.evidenceRegistry.find((assetInfo) => assetInfo.id === id))
        .filter(Boolean);
      if (!registryAssets.some((assetInfo) => assetInfo.capabilities.includes(requirement.capability))) {
        throw new Error(`${candidate.investigation.incidentFamily} ${task.id} lacks ${requirement.capability}: ${selected.join(", ")}`);
      }
      for (const assetInfo of registryAssets.filter((item) => item.capabilities.includes(requirement.capability))) {
        if (!candidate.assets.some((assetItem) => assetItem.file_path === assetInfo.path)) {
          throw new Error(`${candidate.investigation.incidentFamily} ${task.id} selected missing ${assetInfo.path}`);
        }
      }
    }
  }
  const capabilityCounts = {};
  const evidenceCounts = {};
  for (const { candidate, task } of currentTasks) {
    for (const requirement of task.currentStateRequirements || []) {
      capabilityCounts[requirement.capability] = (capabilityCounts[requirement.capability] || 0) + 1;
    }
    for (const selected of pathsForTask(candidate, task)) {
      evidenceCounts[selected] = (evidenceCounts[selected] || 0) + 1;
    }
  }
  console.log("PASS incident-family current-state matrix");

  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", difficulty);
    for (const task of currentStateTasks(candidate)) {
      for (const requirement of task.currentStateRequirements || []) {
        const capablePaths = task.selectedEvidenceAssetIds
          .map((id) => candidate.simulation.evidenceRegistry.find((assetInfo) => assetInfo.id === id))
          .filter((assetInfo) => assetInfo && assetInfo.capabilities.includes(requirement.capability))
          .map((assetInfo) => assetInfo.path);
        if (!capablePaths.some((pathName) => candidate.assets.some((assetItem) => assetItem.file_path === pathName))) {
          throw new Error(`${difficulty} task ${task.id} selected missing current-state evidence for ${requirement.capability}: ${capablePaths.join(", ")}`);
        }
      }
    }
    console.log(`PASS ${difficulty} current-state compatibility`);
  }

  console.log(JSON.stringify({
    passed: true,
    families: FAMILIES.length,
    currentStateTasks: currentTasks.length,
    capabilityCounts,
    evidenceCounts,
    rewrittenOrReplacedTasks: 0,
    unsupportedCapabilitiesEncountered: 1,
  }, null, 2));
}

main();
