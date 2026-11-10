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
  const build = path.join(os.tmpdir(), `cyberlab-linux-cron-semantics-${Date.now()}`);
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
          seed: `cron-semantics:${family}:${difficulty}:${attempt}`,
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

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing ${filePath}`);
  return found;
}

function cronDefinitionAssetPath(definition) {
  return definition.source === "root_crontab"
    ? "assets/scheduled/root_crontab.txt"
    : `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`;
}

function evidencePath(candidate, assetId) {
  const assetInfo = candidate.simulation.evidenceRegistry.find((item) => item.id === assetId);
  if (!assetInfo) throw new Error(`missing registry asset ${assetId}`);
  return assetInfo.path;
}

function pathsForTask(candidate, task) {
  return task.selectedEvidenceAssetIds.map((id) => evidencePath(candidate, id));
}

function taskClosureText(task) {
  return ["cron_analysis", "containment_recommendation"].includes(task.intent)
    ? "Cron schedule does not prove malicious intent; preserve cron task evidence before disabling."
    : "";
}

function replaceAsset(assets, filePath, content) {
  return assets.map((item) => item.file_path === filePath ? { ...item, content } : item);
}

function removeAsset(assets, filePath) {
  return assets.filter((item) => item.file_path !== filePath);
}

function removeCronDefinitionLine(candidate, definition) {
  const filePath = cronDefinitionAssetPath(definition);
  const content = asset(candidate, filePath).content
    .split(/\r?\n/)
    .filter((line) => !line.includes(definition.id))
    .join("\n");
  return replaceAsset(candidate.assets, filePath, `${content}\n`);
}

function mutateCronDefinitionLine(candidate, definition, mutator) {
  const filePath = cronDefinitionAssetPath(definition);
  const content = asset(candidate, filePath).content
    .split(/\r?\n/)
    .map((line) => line.includes(definition.id) ? mutator(line) : line)
    .join("\n");
  return replaceAsset(candidate.assets, filePath, content);
}

function withTemporaryPatch(target, patch, fn) {
  const previous = {};
  for (const key of Object.keys(patch)) previous[key] = target[key];
  Object.assign(target, patch);
  try {
    return fn();
  } finally {
    Object.assign(target, previous);
  }
}

function expectPass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

function expectFail(name, fn, pattern) {
  try {
    const result = fn();
    const text = result && Array.isArray(result.issues)
      ? result.issues.map((issue) => `${issue.category || ""}:${issue.message || issue.description || ""}`).join("; ")
      : "";
    if (text && !result.passed && new RegExp(pattern, "i").test(text)) {
      console.log(`PASS ${name}`);
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (new RegExp(pattern, "i").test(message)) {
      console.log(`PASS ${name}`);
      return;
    }
    throw new Error(`${name}: expected ${pattern}, got ${message}`);
  }
  throw new Error(`${name}: expected failure matching ${pattern}`);
}

function qualityResult(checkLinuxInvestigationQuality, candidate, assets = candidate.assets, lab) {
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

function qualityFail(checkLinuxInvestigationQuality, candidate, assets, pattern, lab) {
  const result = qualityResult(checkLinuxInvestigationQuality, candidate, assets, lab);
  const text = result.issues.map((issue) => `${issue.category}:${issue.description}:${issue.evidence || ""}`).join(" | ");
  if (result.passed || !new RegExp(pattern, "i").test(text)) {
    throw new Error(`expected ${pattern}, got ${text || "pass"}`);
  }
}

function assertCronChain(candidate, scheduleMatchesTimestamp) {
  for (const definition of candidate.simulation.cronDefinitions) {
    const command = candidate.simulation.commands.find((item) => item.id === definition.commandId);
    const runAs = candidate.simulation.identities.find((item) => item.id === definition.runAsIdentityId);
    const source = asset(candidate, cronDefinitionAssetPath(definition)).content;
    if (definition.enabled && definition.persistenceState === "present") {
      for (const value of [definition.id, definition.schedule, definition.sourcePath, command.renderedCommand]) {
        if (!source.includes(value)) throw new Error(`${definition.id}: source missing ${value}`);
      }
      if (definition.source === "cron_d" && !source.includes(runAs.username)) {
        throw new Error(`${definition.id}: cron.d source missing run-as ${runAs.username}`);
      }
    }
  }
  for (const execution of candidate.simulation.scheduledExecutions) {
    const definition = candidate.simulation.cronDefinitions.find((item) => item.id === execution.definitionId);
    const command = candidate.simulation.commands.find((item) => item.id === execution.commandId);
    const process = candidate.simulation.processes.find((item) => item.id === execution.processId);
    const runAs = candidate.simulation.identities.find((item) => item.id === definition.runAsIdentityId);
    if (!scheduleMatchesTimestamp(definition.schedule, execution.occurredAt)) {
      throw new Error(`${execution.id}: ${execution.occurredAt} does not match ${definition.schedule}`);
    }
    if (execution.commandId !== definition.commandId || command.runAsIdentityId !== definition.runAsIdentityId || process.identityId !== definition.runAsIdentityId) {
      throw new Error(`${execution.id}: command/process run-as disagrees with ${definition.id}`);
    }
    const label = candidate.simulation.scheduledExecutions.find((item) => item.id === execution.id).id;
    const cronLog = asset(candidate, "assets/logs/cron.log").content;
    const timeline = asset(candidate, "assets/evidence/timeline.csv").content;
    const audit = asset(candidate, "assets/logs/audit.log").content;
    const syslog = asset(candidate, "assets/logs/syslog").content;
    for (const value of [definition.id, definition.sourcePath, runAs.username, command.renderedCommand]) {
      if (!cronLog.includes(value)) throw new Error(`${execution.id}: cron.log missing ${value}`);
    }
    for (const content of [timeline, audit, syslog]) {
      if (!content.includes(definition.id)) throw new Error(`${execution.id}: rendered evidence missing ${definition.id}`);
    }
    if (!label) throw new Error("unreachable label guard");
  }
}

function labFromCanonical(candidate, overrideIndex, overrideTask) {
  const canonicalTasks = candidate.simulation.canonicalTasks
    .slice()
    .sort((left, right) => left.order - right.order);
  const tasks = canonicalTasks
    .map((task) => {
      const closure = taskClosureText(task);
      const deliverableType = task.expectedDeliverableType.replace(/_/g, " ");
      return {
        phase: task.stepLabel || task.intent.replace(/_/g, " "),
        title: `${task.suggestedVerb || "Document"} ${task.stepLabel || task.intent.replace(/_/g, " ")}.`,
        description: `${task.suggestedVerb || "Document"} ${task.stepLabel || task.intent.replace(/_/g, " ")} using the listed offline evidence.${closure ? ` ${closure}` : ""}`,
        evidence: pathsForTask(candidate, task).slice(0, 3),
        deliverable: `Prepare ${deliverableType.endsWith("notes") ? deliverableType : `${deliverableType} notes`} with cited evidence.${closure ? ` ${closure}` : ""}`,
      };
    });
  if (overrideTask) {
    tasks[overrideIndex] = { ...tasks[overrideIndex], ...overrideTask };
    const closure = taskClosureText(canonicalTasks[overrideIndex]);
    if (closure) {
      if (!String(tasks[overrideIndex].description || "").includes(closure)) {
        tasks[overrideIndex].description = `${tasks[overrideIndex].description} ${closure}`;
      }
      if (!String(tasks[overrideIndex].deliverable || "").includes(closure)) {
        tasks[overrideIndex].deliverable = `${tasks[overrideIndex].deliverable} ${closure}`;
      }
    }
  }
  return {
    title: "Linux cron evidence review",
    objective: `Review scheduled persistence evidence on ${candidate.investigation.hostname}, a ${candidate.investigation.hostRole}, for ${candidate.investigation.changeId} and ${candidate.investigation.ticketId} during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone}.`,
    scenario: `${candidate.investigation.company} SOC is reviewing ${candidate.investigation.incidentId} on ${candidate.investigation.hostname}, a ${candidate.investigation.hostRole}, during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone}. The review references ${candidate.investigation.changeId}, ${candidate.investigation.ticketId}, and cron.service while analysts separate current cron definitions from historical execution.`,
    tasks,
    hints: ["Separate current definitions from execution history.", "Use timestamps and source references.", "Keep conclusions evidence-backed."],
    outcomes: ["Correlate cron definition and execution evidence.", "Separate historical execution from current persistence.", "Document evidence gaps."],
    duration: "30 mins",
    category: "Linux",
    difficulty: "Advanced",
  };
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    scheduleMatchesTimestamp,
    simulationRootCrontab,
    simulationCronDAssets,
    validateLinuxSimulationEvidence,
  } = require(path.join(out, "linux", "simulation.js"));
  const { checkLinuxInvestigationQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const { validateLinuxSemanticClosure } = require(path.join(out, "linux", "semanticClosure.js"));

  const cron = buildCandidate(buildLinuxAssetCandidate, "cron_persistence");
  const definition = cron.simulation.cronDefinitions[0];
  const execution = cron.simulation.scheduledExecutions.find((item) => item.definitionId === definition.id);
  if (!definition || !execution) throw new Error("cron candidate lacks canonical cron definition and execution");

  expectPass("current cron exists and validates", () => validateLinuxSimulationEvidence(cron.simulation, cron.assets));
  expectPass("historical cron execution validates against definition", () => assertCronChain(cron, scheduleMatchesTimestamp));

  expectFail("definition removal is rejected", () => {
    validateLinuxSimulationEvidence(cron.simulation, removeCronDefinitionLine(cron, definition));
  }, "cron source|missing|required|definition");

  expectPass("definition removal is rejected by quality checker", () => {
    qualityFail(checkLinuxInvestigationQuality, cron, removeCronDefinitionLine(cron, definition), "cron definition.*missing|current cron definition");
  });

  expectFail("schedule mutation is rejected", () => {
    const assets = mutateCronDefinitionLine(cron, definition, (line) => line.replace(/^\S+/, "59"));
    const result = validateLinuxSemanticClosure({ simulation: cron.simulation, finalAssets: assets });
    if (result.passed) throw new Error("schedule mutation unexpectedly passed semantic closure");
    throw new Error(result.issues.map((issue) => `${issue.category}:${issue.message}`).join("; "));
  }, "schedule|does not match|cron source.*missing|definition evidence does not render schedule and command");

  expectPass("schedule mutation is rejected by quality checker", () => {
    const assets = mutateCronDefinitionLine(cron, definition, (line) => line.replace(/^\S+/, "59"));
    qualityFail(checkLinuxInvestigationQuality, cron, assets, "schedule|execution time");
  });

  expectFail("execution without definition is rejected", () => {
    withTemporaryPatch(execution, { definitionId: "cron:missing" }, () => validateLinuxSimulationEvidence(cron.simulation, cron.assets));
  }, "no canonical definition|missing|object grounding");

  expectFail("owner mismatch is rejected", () => {
    const process = cron.simulation.processes.find((item) => item.id === execution.processId);
    const otherIdentity = cron.simulation.identities.find((item) => item.id !== definition.runAsIdentityId);
    withTemporaryPatch(process, { identityId: otherIdentity.id }, () => validateLinuxSimulationEvidence(cron.simulation, cron.assets));
  }, "run-as disagrees|identity|actor UID");

  expectPass("rendered run-as mutation is rejected by quality checker", () => {
    const assets = mutateCronDefinitionLine(cron, definition, (line) =>
      definition.source === "cron_d"
        ? line.replace(/\s[a-z0-9._-]+\s+\/usr/i, " ghostuser /usr")
        : line
    );
    if (definition.source === "root_crontab") {
      const cronLog = asset(cron, "assets/logs/cron.log").content.replace(/\([^)]+\)\s+CMD/, "(ghostuser) CMD");
      qualityFail(checkLinuxInvestigationQuality, cron, replaceAsset(cron.assets, "assets/logs/cron.log", cronLog), "run-as|disagrees");
    } else {
      qualityFail(checkLinuxInvestigationQuality, cron, assets, "run-as|does not exist|disagrees");
    }
  });

  expectPass("command mutation is rejected by quality checker", () => {
    const assets = mutateCronDefinitionLine(cron, definition, (line) => {
      const match = line.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+?)\s+#\s*(cron:[a-z0-9:_-]+.*)$/i);
      if (!match) return line;
      const cronD = match[2].match(/^([a-z0-9._-]+)\s+(.+)$/i);
      const command = cronD ? `${cronD[1]} /usr/local/sbin/other-job.sh` : "/usr/local/sbin/other-job.sh";
      return `${match[1]} ${command} # ${match[3]}`;
    });
    qualityFail(checkLinuxInvestigationQuality, cron, assets, "command.*disagrees");
  });

  expectPass("removed cron is not current persistence", () => {
    const removedAt = cron.simulation.collection.windowEnd;
    withTemporaryPatch(definition, { persistenceState: "removed", enabled: false, removedAt }, () => {
      const assets = removeAsset(
        replaceAsset(cron.assets, "assets/scheduled/root_crontab.txt", simulationRootCrontab(cron.simulation)),
        cronDefinitionAssetPath(definition)
      );
      const withoutCronD = simulationCronDAssets(cron.simulation).reduce((current, cronAsset) =>
        replaceAsset(current, cronAsset.filePath, cronAsset.content), assets);
      const sourceText = withoutCronD.map((item) => item.file_path.startsWith("assets/scheduled/") ? item.content : "").join("\n");
      if (sourceText.includes(definition.id)) throw new Error("removed cron definition still appears in current scheduled evidence");
    });
  });

  const cronTaskIndex = cron.simulation.canonicalTasks.findIndex((task) => task.intent === "cron_analysis");
  const currentLab = labFromCanonical(cron, cronTaskIndex, {
    title: "Determine whether the current cron persistence mechanism remains present.",
    description: "Determine whether the current cron persistence mechanism remains present from the selected evidence.",
    evidence: ["assets/logs/cron.log", "assets/logs/audit.log"],
  });
  expectPass("current persistence task rejects historical logs only", () => {
    qualityFail(checkLinuxInvestigationQuality, cron, cron.assets, "current-state|current persistence|current-state evidence", currentLab);
  });

  expectPass("current persistence task rejects removed cron definition", () => {
    const removedAt = cron.simulation.collection.windowEnd;
    withTemporaryPatch(definition, { persistenceState: "removed", enabled: false, removedAt }, () => {
      const assets = replaceAsset(cron.assets, "assets/scheduled/root_crontab.txt", simulationRootCrontab(cron.simulation));
      qualityFail(checkLinuxInvestigationQuality, cron, assets, "current-state|entity absent|missing|current persistence", currentLab);
    });
  });

  const finalCron = cron;
  const finalCronTaskIndex = finalCron.simulation.canonicalTasks.findIndex((task) => task.intent === "cron_analysis");
  const currentEvidenceLab = labFromCanonical(finalCron, finalCronTaskIndex, {
    title: "Determine whether the current cron definition for the persistence mechanism remains present.",
    description: "Determine whether the current cron definition for the persistence mechanism remains present from scheduled definition evidence.",
    evidence: pathsForTask(finalCron, finalCron.simulation.canonicalTasks[finalCronTaskIndex]),
  });
  expectPass("current persistence task accepts current definition", () => {
    const result = qualityResult(checkLinuxInvestigationQuality, finalCron, finalCron.assets, currentEvidenceLab);
    if (!result.passed) throw new Error(result.issues.map((issue) => issue.description).join(" | "));
  });

  const historicalLab = labFromCanonical(finalCron, finalCronTaskIndex, {
    title: "Reconstruct the historical cron definition and execution.",
    description: "Reconstruct the historical cron definition and execution using the selected logs and timeline.",
    evidence: pathsForTask(finalCron, finalCron.simulation.canonicalTasks[finalCronTaskIndex]),
  });
  expectPass("historical-only cron task accepted", () => {
    const result = qualityResult(checkLinuxInvestigationQuality, finalCron, finalCron.assets, historicalLab);
    if (!result.passed) throw new Error(result.issues.map((issue) => issue.description).join(" | "));
  });

  let first;
  let second;
  for (let attempt = 0; attempt < 30 && !first; attempt += 1) {
    const seed = `cron-semantics:deterministic:${attempt}`;
    try {
      const directBuild = () => buildLinuxAssetCandidate({
          seed: seed,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty: "Advanced",
          duration: "60 mins",
          title: "CyberLab Asset Pack",
        }, { incidentFamily: "cron_persistence" });
      first = directBuild();
      second = directBuild();
    } catch {
      first = undefined;
      second = undefined;
    }
  }
  if (!first || !second) throw new Error("could not build deterministic cron pair");
  expectPass("deterministic cron construction invariants", () => {
    assertCronChain(first, scheduleMatchesTimestamp);
    assertCronChain(second, scheduleMatchesTimestamp);
    if (first.simulation.cronDefinitions.length !== first.simulation.scheduledExecutions.length) throw new Error("first candidate cron cardinality drift");
    if (second.simulation.cronDefinitions.length !== second.simulation.scheduledExecutions.length) throw new Error("second candidate cron cardinality drift");
  });

  const candidates = FAMILIES.map((family) => buildCandidate(buildLinuxAssetCandidate, family));
  const matrix = {
    families: candidates.length,
    definitions: 0,
    executions: 0,
    runAs: {},
    schedules: {},
    present: 0,
    removed: 0,
  };
  for (const candidate of candidates) {
    expectPass(`${candidate.investigation.incidentFamily} cron chain`, () => {
      validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
      assertCronChain(candidate, scheduleMatchesTimestamp);
    });
    for (const cronDefinition of candidate.simulation.cronDefinitions) {
      matrix.definitions += 1;
      matrix.schedules[cronDefinition.schedule] = (matrix.schedules[cronDefinition.schedule] || 0) + 1;
      if (cronDefinition.persistenceState === "present") matrix.present += 1;
      if (cronDefinition.persistenceState === "removed") matrix.removed += 1;
      const runAs = candidate.simulation.identities.find((item) => item.id === cronDefinition.runAsIdentityId)?.username || "missing";
      matrix.runAs[runAs] = (matrix.runAs[runAs] || 0) + 1;
    }
    matrix.executions += candidate.simulation.scheduledExecutions.length;
  }

  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, "cron_persistence", difficulty);
    expectPass(`${difficulty} cron compatibility`, () => {
      const result = qualityResult(checkLinuxInvestigationQuality, candidate);
      if (!result.passed) throw new Error(result.issues.map((issue) => issue.description).join(" | "));
      if (difficulty === "Advanced") validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
    });
  }

  console.log(`CRON_MATRIX ${JSON.stringify(matrix)}`);
}

main();
