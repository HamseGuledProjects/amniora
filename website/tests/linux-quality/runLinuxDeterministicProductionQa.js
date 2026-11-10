#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { performance } = require("perf_hooks");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, "test-output", "linux-deterministic-qa-phase-5-1");
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];
const FAMILIES = [
  "ssh_bruteforce",
  "ssh_key_compromise",
  "misconfigured_sudoers",
  "service_account_misuse",
  "cron_persistence",
  "systemd_persistence",
  "unauthorized_package_install",
  "data_staging",
  "log_tampering",
  "reverse_shell",
  "docker_compromise",
];
const DURATIONS = ["15 mins", "30 mins", "60 mins"];
const TASK_TITLES = {
  ssh_authentication: "Trace SSH authentication evidence",
  scope_timeline: "Reconstruct the evidence timeline",
  actor_attribution: "Correlate account and authentication evidence",
  key_provenance: "Map SSH key evidence to account ownership",
  command_process: "Correlate command, process, and file activity",
  service_state: "Compare service state and journal evidence",
  package_transaction: "Reconcile package activity with logged evidence",
  cron_analysis: "Map scheduled execution evidence",
  change_control: "Reconcile change and maintenance records",
  impact_assessment: "Document risk and evidence limits",
  evidence_integrity: "Identify evidence quality gaps",
  sudo_policy: "Compare sudo policy with observed commands",
  configuration_review: "Inspect configuration baseline evidence",
  file_permissions: "Evaluate file permission evidence",
  network_source: "Correlate source address evidence",
  service_exposure: "Compare service exposure evidence",
};
const TOPICS = {
  ssh_bruteforce: "Linux DFIR: SSH Authentication Review",
  ssh_key_compromise: "Linux DFIR: SSH Key Provenance",
  misconfigured_sudoers: "Linux DFIR: Sudo Policy Review",
  service_account_misuse: "Linux DFIR: Service Account Misuse",
  cron_persistence: "Linux DFIR: Cron Execution Review",
  systemd_persistence: "Linux DFIR: Systemd Persistence",
  unauthorized_package_install: "Linux DFIR: Package Installation Review",
  data_staging: "Linux DFIR: Data Staging Review",
  log_tampering: "Linux DFIR: Log Integrity Investigation",
  reverse_shell: "Linux DFIR: Process and Egress Correlation",
  docker_compromise: "Linux DFIR: Container Runtime Review",
};

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`);
}

function hash(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}


function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-deterministic-qa-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quoted) throw new Error("unterminated quoted CSV field");
  values.push(current);
  return values;
}

function timestampValue(line) {
  const iso = line.match(/(20\d{2}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (iso) return Date.parse(`${iso[1]}T${iso[2]}Z`);
  const syslog = line.match(/^[A-Z][a-z]{2}\s+\d{1,2}\s+(\d{2}):(\d{2}):(\d{2})/);
  if (syslog) return Number(syslog[1]) * 3600 + Number(syslog[2]) * 60 + Number(syslog[3]);
  return null;
}

function normalizeEvidencePath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^assets\//, "assets/");
}

function resolveAsset(paths, source) {
  const normalized = normalizeEvidencePath(source);
  const withoutAssets = normalized.replace(/^assets\//, "");
  return paths.has(normalized) || paths.has(`assets/${withoutAssets}`) || [...paths].some((candidate) => candidate.endsWith(`/${withoutAssets}`));
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function stageFailure(stage, error, extra = {}) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    stage,
    message,
    stack: error instanceof Error ? error.stack : undefined,
    ...extra,
  };
}

function buildSeed(baseSeed, difficulty, index, family, duration) {
  return `${baseSeed}:${difficulty}:${index}:${family}:${duration}`;
}

function buildCandidateForRequestedFamily(modules, planItem) {
  let lastFamilyMiss = null;
  for (let draw = 0; draw < 80; draw += 1) {
    const generationSeed = `${planItem.seed}:draw:${draw}`;
    const attempts = [];
    try {
      const candidate = modules.buildLinuxAssetCandidate({
            seed: generationSeed,
            generationTime: "2026-07-29T08:00:00.000Z",
            category: "Linux",
          difficulty: planItem.difficulty,
          duration: planItem.duration,
          title: "CyberLab Asset Pack",
        }, {
          incidentFamily: planItem.family,
          onAttempt: (event) => attempts.push(event),
        });
      return { candidate, generationSeed, attempts };
    } catch (error) {
      const allFamilyMisses = attempts.length > 0 && attempts.every((event) => !event.accepted && String(event.reason || "").startsWith("skipped incident family "));
      if (allFamilyMisses) {
        lastFamilyMiss = { error, generationSeed, attempts };
        continue;
      }
      error.qaAttempts = attempts;
      error.qaGenerationSeed = generationSeed;
      throw error;
    }
  }
  const error = lastFamilyMiss?.error || new Error(`could not draw requested family ${planItem.family}`);
  error.qaAttempts = lastFamilyMiss?.attempts || [];
  error.qaGenerationSeed = lastFamilyMiss?.generationSeed;
  throw error;
}

function generationPlan(config) {
  const familyFilter = config.familyFilter ? new Set(config.familyFilter.split(",").map((item) => item.trim()).filter(Boolean)) : null;
  const durationFilter = config.durationFilter ? new Set(config.durationFilter.split(",").map((item) => item.trim()).filter(Boolean)) : null;
  const families = familyFilter ? FAMILIES.filter((family) => familyFilter.has(family)) : FAMILIES;
  const durations = durationFilter ? DURATIONS.filter((duration) => durationFilter.has(duration)) : DURATIONS;
  if (families.length === 0) throw new Error("LINUX_QA_FAMILY_FILTER removed every incident family.");
  if (durations.length === 0) throw new Error("LINUX_QA_DURATION_FILTER removed every duration.");

  return DIFFICULTIES.flatMap((difficulty) => {
    const count = config.counts[difficulty];
    return Array.from({ length: count }, (_, index) => {
      const family = families[index % families.length];
      const duration = durations[Math.floor(index / families.length) % durations.length];
      return {
        difficulty,
        index,
        family,
        duration,
        seed: buildSeed(config.baseSeed, difficulty, index, family, duration),
      };
    });
  });
}

function titleForIntent(intent) {
  return TASK_TITLES[intent] || `Review ${String(intent).replace(/_/g, " ")} evidence`;
}

function evidenceNoun(paths) {
  const joined = paths.join(" ");
  if (/auth\.log|journal_ssh|passwd|users\.csv/.test(joined)) return "account evidence";
  if (/sudo\.log|sudoers/.test(joined)) return "sudo evidence";
  if (/audit\.log|process_execution|process_snapshot/.test(joined)) return "command evidence";
  if (/service_inventory|journal_systemd|syslog/.test(joined)) return "service evidence";
  if (/apt_history|package_inventory/.test(joined)) return "package evidence";
  if (/cron\.log|crontab|cron/.test(joined)) return "scheduled-execution evidence";
  if (/change_request|maintenance_ticket/.test(joined)) return "change evidence";
  if (/permissions_report|file_access|open_files/.test(joined)) return "file evidence";
  if (/timeline\.csv/.test(joined)) return "timeline evidence";
  if (/risk_register|incident_brief|audit_notes/.test(joined)) return "case documentation";
  return "selected evidence";
}

function actionForIntent(intent) {
  return {
    ssh_authentication: "Trace",
    actor_attribution: "Correlate",
    scope_timeline: "Reconstruct",
    configuration_review: "Review",
    file_permissions: "Evaluate",
    service_state: "Compare",
    sudo_policy: "Compare",
    command_process: "Correlate",
    package_transaction: "Reconcile",
    cron_analysis: "Map",
    change_control: "Reconcile",
    impact_assessment: "Document",
    evidence_integrity: "Assess",
    key_provenance: "Map",
    network_source: "Correlate",
    service_exposure: "Compare",
  }[intent] || "Review";
}

function evidenceForTask(simulation, task) {
  const byId = new Map(simulation.evidenceRegistry.map((asset) => [asset.id, asset]));
  return task.selectedEvidenceAssetIds.map((id) => byId.get(id)?.path || id);
}

function buildFinalLab(candidate, difficulty, duration, contract) {
  const context = candidate.investigation;
  const primaryService = contract?.scenarioFraming?.primaryService || context.affectedService;
  const deliverableVerbs = ["Prepare", "Write", "Summarize", "Draft", "Produce", "Record", "Build"];
  const fallbackActions = ["Trace", "Correlate", "Reconstruct", "Review", "Evaluate", "Compare", "Reconcile", "Map", "Document", "Assess"];
  const usedActions = new Set();
  const tasks = candidate.simulation.canonicalTasks
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((task, index) => {
      const evidence = evidenceForTask(candidate.simulation, task);
      const noun = evidenceNoun(evidence);
      const label = task.stepLabel || titleForIntent(task.intent).replace(/^(?:Trace|Correlate|Reconstruct|Review|Evaluate|Compare|Reconcile|Map|Document|Assess)\s+/i, "");
      const preferredAction = actionForIntent(task.intent);
      const action = usedActions.has(preferredAction)
        ? fallbackActions.find((candidateAction) => !usedActions.has(candidateAction)) || fallbackActions[index % fallbackActions.length]
        : preferredAction;
      usedActions.add(action);
      const title = `${action} ${label}`;
      return {
        phase: `Task ${task.order}`,
        title,
        description: `Review the listed ${noun} and cite only facts shown in those artifacts.`,
        evidence,
        deliverable: `${deliverableVerbs[index % deliverableVerbs.length]} ${task.expectedDeliverableType.replace(/_/g, " ")} notes with cited evidence and uncertainty boundaries.`,
      };
    });

  return {
    title: `Linux ${primaryService} evidence review for ${context.hostname}`,
    subtitle: "Linux investigation using canonical evidence",
    topic: TOPICS[context.incidentFamily] || "Linux DFIR: Host Investigation",
    difficulty,
    estimated_time: duration,
    duration,
    category: "Linux",
    objective: `Review ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} using account, service, timeline, and documentation evidence for ${primaryService}.`,
    scenario: `${context.company} SOC is reviewing case ${context.incidentId} for ${context.hostname}, a ${context.hostRole} in ${context.officeLocation}. The ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} window, ${context.ticketId}, ${context.changeId}, ${primaryService}, and ${context.modifiedFiles[0]} require evidence-scoped validation.`,
    tasks,
    hints: [
      "Start with timestamps and exact evidence paths.",
      "Separate configuration snapshots from historical logs.",
      "Document uncertainty where selected evidence does not prove a conclusion.",
    ],
    outcomes: [
      "Reconstruct Linux investigation timelines from rendered evidence.",
      "Correlate identity, process, service, and documentation records.",
      "Produce evidence-bounded findings without overclaiming.",
    ],
  };
}

function buildContractNarrative(contract) {
  return {
    title: `${contract.scenarioFraming.hostname} evidence review`,
    objective: `Use the supplied evidence for ${contract.caseId} during ${contract.scenarioFraming.incidentWindow} ${contract.scenarioFraming.timezone}.`,
    scenario: `SOC analysts are reviewing ${contract.scenarioFraming.hostname}, a ${contract.scenarioFraming.hostRole}, using the rendered evidence pack for ticket ${contract.scenarioFraming.ticketId} and change ${contract.scenarioFraming.changeId}.`,
    tasks: contract.taskContracts.map((task) => {
      const evidence = task.selectedEvidence.slice(0, 3).map((asset) => asset.path);
      const firstSubject = task.groundedSubjects[0]?.id;
      const relation = task.groundedRelationships[0];
      const allowsCurrent = task.requiredCapabilities.some((capability) => capability.startsWith("current_"));
      return {
        task_id: task.taskId,
        task_intent: task.intent,
        phase: `Task ${task.order}`,
        title: `${task.objective} using selected evidence`,
        evidence,
        deliverable: `Prepare a ${task.deliverableType.replace(/_/g, " ")} with evidence references and uncertainty notes.`,
        claims: [
          {
            claim_class: allowsCurrent ? "current_state" : "observed",
            text: allowsCurrent
              ? `Current-state wording is limited to the selected evidence for ${task.objective}.`
              : `Observed evidence supports ${task.objective}.`,
            supporting_evidence: evidence.slice(0, 1),
            subjects: firstSubject ? [firstSubject] : [],
            relationships: relation ? [{ relation: relation.relation, subject_ids: relation.subjectIds }] : [],
            timestamps: task.allowedTimestamps.slice(0, 1),
          },
          {
            claim_class: "bounded_inference",
            text: "Any conclusion is a bounded inference that requires validation against the selected artifacts.",
            supporting_evidence: evidence.slice(0, 1),
            subjects: firstSubject ? [firstSubject] : [],
            relationships: [],
            timestamps: [],
          },
        ],
      };
    }),
    hints: ["Use the selected evidence for each task.", "Keep configuration snapshots separate from historical logs.", "Use uncertainty when artifacts do not prove a conclusion."],
    outcomes: ["Practice evidence-scoped Linux triage.", "Correlate canonical task evidence.", "Separate observation from inference."],
  };
}

function assertStructuralCandidate(candidate, renderedPaths, difficulty) {
  const context = candidate.investigation;
  if (!context?.hostname || !context?.incidentId || !context?.ticketId || !context?.changeId) {
    throw new Error("world/investigation is missing required canonical identifiers");
  }
  if (!candidate.simulation?.canonicalTasks?.length) throw new Error("simulation has no canonical tasks");
  if (!candidate.simulation?.evidenceRegistry?.length) throw new Error("simulation has no evidence registry");
  if (!candidate.simulation?.planningEvidenceRegistry?.length) throw new Error("simulation has no planning evidence registry");
  if (!candidate.assets?.length) throw new Error("rendered evidence pack is empty");
  if (candidate.assets.length < 48 && difficulty === "Advanced") {
    throw new Error("advanced evidence pack rendered fewer than 48 assets");
  }

  for (const task of candidate.simulation.canonicalTasks) {
    if (!task.id || !task.intent || !task.selectedEvidenceAssetIds?.length) {
      throw new Error(`task ${task.id || "unknown"} is missing intent or selected evidence`);
    }
  }

  const assetPathCounts = new Map();
  for (const asset of candidate.assets) {
    const normalized = normalizeEvidencePath(asset.file_path);
    assetPathCounts.set(normalized, (assetPathCounts.get(normalized) || 0) + 1);
    if (asset.file_path.endsWith(".csv")) {
      const rows = asset.content.trim().split(/\r?\n/).filter(Boolean);
      if (rows.length > 0) {
        const width = parseCsvLine(rows[0]).length;
        rows.slice(1).forEach((row, index) => {
          const actual = parseCsvLine(row).length;
          if (actual !== width) throw new Error(`${asset.file_path}:${index + 2} CSV width ${actual} != ${width}`);
        });
      }
    }
    if (/assets\/(?:logs|journal)\//.test(asset.file_path)) {
      const stamps = asset.content.split(/\r?\n/).map(timestampValue).filter((value) => value !== null);
      for (let index = 1; index < stamps.length; index += 1) {
        if (stamps[index] < stamps[index - 1]) throw new Error(`${asset.file_path} timestamp order regression`);
      }
    }
  }
  const duplicatePath = [...assetPathCounts.entries()].find(([, count]) => count > 1);
  if (duplicatePath) throw new Error(`duplicate rendered evidence path ${duplicatePath[0]}`);

  const registryPathCounts = new Map();
  for (const asset of candidate.simulation.evidenceRegistry) {
    if (!asset.id || !asset.path || !asset.capabilities?.length) throw new Error(`registry asset is missing id/path/capabilities`);
    const normalized = normalizeEvidencePath(asset.path);
    registryPathCounts.set(normalized, (registryPathCounts.get(normalized) || 0) + 1);
  }
  const duplicateRegistryPath = [...registryPathCounts.entries()].find(([, count]) => count > 1);
  if (duplicateRegistryPath) throw new Error(`duplicate evidence registry path ${duplicateRegistryPath[0]}`);

  const timeline = candidate.assets.find((asset) => asset.file_path === "assets/evidence/timeline.csv");
  if (timeline) {
    const rows = timeline.content.trim().split(/\r?\n/).filter(Boolean);
    const header = parseCsvLine(rows[0]);
    const timestampIndex = header.indexOf("timestamp");
    const sourceIndex = header.indexOf("exact_sources");
    if (timestampIndex === -1) throw new Error("timeline.csv missing timestamp header");
    let previous = "";
    for (const [offset, rowText] of rows.slice(1).entries()) {
      const row = parseCsvLine(rowText);
      const timestamp = row[timestampIndex];
      if (previous && timestamp < previous) throw new Error(`timeline.csv row ${offset + 2} is not chronological`);
      previous = timestamp;
      if (sourceIndex !== -1) {
        for (const source of String(row[sourceIndex] || "").split(/[;|]/).map((item) => item.trim()).filter(Boolean)) {
          if (!resolveAsset(renderedPaths, source)) throw new Error(`timeline.csv row ${offset + 2} references missing evidence ${source}`);
        }
      }
    }
  }
}

function validateDifficultySurface(candidate, difficulty) {
  if (difficulty !== "Advanced") {
    const renderedPaths = new Set(candidate.assets.map((asset) => normalizeEvidencePath(asset.file_path)));
    for (const task of candidate.simulation.canonicalTasks) {
      for (const selectedId of task.selectedEvidenceAssetIds) {
        const selected = candidate.simulation.planningEvidenceRegistry.find((asset) => asset.id === selectedId);
        if (selected && !renderedPaths.has(normalizeEvidencePath(selected.path))) {
          throw new Error(`${difficulty} task ${task.id} selected unrendered evidence ${selected.path}`);
        }
      }
    }
  }
}

function stableCandidateSummary(candidate, contract) {
  return {
    investigation: candidate.investigation,
    assets: candidate.assets.map((asset) => ({ path: asset.file_path, contentHash: hash(asset.content) })),
    tasks: candidate.simulation.canonicalTasks.map((task) => ({
      id: task.id,
      order: task.order,
      intent: task.intent,
      difficulty: task.difficulty,
      requiredCapabilities: task.requiredCapabilities,
      currentStateRequirements: task.currentStateRequirements,
      selectedEvidenceAssetIds: task.selectedEvidenceAssetIds,
    })),
    registry: candidate.simulation.evidenceRegistry.map((asset) => ({
      id: asset.id,
      path: asset.path,
      capabilities: asset.capabilities,
      stateType: asset.stateType,
      support: asset.support,
    })),
    planningRegistry: candidate.simulation.planningEvidenceRegistry.map((asset) => ({
      id: asset.id,
      path: asset.path,
      capabilities: asset.capabilities,
      stateType: asset.stateType,
      support: asset.support,
    })),
    contract,
  };
}

function compactCandidateSummary(candidate, contract, finalQuality) {
  return {
    caseId: candidate.investigation.incidentId,
    family: candidate.investigation.incidentFamily,
    difficulty: contract.difficulty,
    hostRole: candidate.investigation.hostRole,
    hostname: candidate.investigation.hostname,
    timezone: candidate.investigation.timezone,
    duration: candidate.inputDuration,
    taskCount: candidate.simulation.canonicalTasks.length,
    assetCount: candidate.assets.length,
    assetQualityScore: candidate.assetQuality?.score,
    finalProductionScore: finalQuality.finalProductionScore,
    finalScoreCaps: finalQuality.scoreCaps || [],
    finalScoreDeductions: (finalQuality.deductions || []).slice(0, 10),
    taskIntents: candidate.simulation.canonicalTasks.map((task) => task.intent),
    selectedEvidence: contract.taskContracts.map((task) => ({
      taskId: task.taskId,
      intent: task.intent,
      evidence: task.selectedEvidence.map((asset) => asset.path),
    })),
  };
}

function runGeneration(modules, planItem, config, outputDir) {
  const started = performance.now();
  const attempts = [];
  const result = {
    ...planItem,
    accepted: false,
    stage: "not-started",
    elapsedMs: 0,
    failure: null,
    fingerprints: {},
  };
  let candidate;
  let contract;
  let narrative;
  let finalLab;
  let finalQuality;

  try {
    result.stage = "world";
    const built = buildCandidateForRequestedFamily(modules, planItem);
    candidate = built.candidate;
    attempts.push(...built.attempts);
    result.generationSeed = built.generationSeed;
    candidate.inputDuration = planItem.duration;
    result.caseId = candidate.investigation.incidentId;
    result.hostname = candidate.investigation.hostname;
    result.hostRole = candidate.investigation.hostRole;

    const renderedPaths = new Set(candidate.assets.map((asset) => normalizeEvidencePath(asset.file_path)));
    result.stage = "incident";
    assertStructuralCandidate(candidate, renderedPaths, planItem.difficulty);

    result.stage = "evidence_registry";
    validateDifficultySurface(candidate, planItem.difficulty);

    result.stage = "difficulty_planning_registry";
    if (candidate.simulation.difficultyDiagnostics?.passed === false) {
      throw new Error(`difficulty diagnostics failed: ${JSON.stringify(candidate.simulation.difficultyDiagnostics.issues || [])}`);
    }

    result.stage = "task_selection";
    if (planItem.difficulty === "Advanced" && candidate.simulation.canonicalTasks.length < 5) {
      throw new Error("advanced task selection rendered fewer than 5 canonical tasks");
    }
    if (planItem.difficulty !== "Advanced" && candidate.simulation.canonicalTasks.length < 3) {
      throw new Error(`${planItem.difficulty} task selection rendered fewer than 3 canonical tasks`);
    }

    result.stage = "task_evidence_closure";
    modules.assertLinuxTaskEvidenceClosureInvariant(candidate.simulation, candidate.assets.map((asset) => asset.file_path));

    result.stage = "rendered_evidence_pack";
    if (candidate.assetQuality && !candidate.assetQuality.passed) throw new Error(candidate.assetQuality.summary);

    result.stage = "narrative_contract";
    contract = modules.buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    if (contract.canonicalTaskCount !== candidate.simulation.canonicalTasks.length) {
      throw new Error("narrative contract task count disagrees with canonical task count");
    }

    result.stage = "synthetic_valid_narrative";
    narrative = buildContractNarrative(contract);
    const contractValidation = modules.validateLinuxGeneratedNarrativeAgainstContract(contract, narrative);
    if (!contractValidation.passed) {
      throw new Error(`synthetic narrative failed contract: ${contractValidation.issues.map((issue) => issue.code).join(", ")}`);
    }

    result.stage = "final_production_validation";
    finalLab = buildFinalLab(candidate, planItem.difficulty, planItem.duration, contract);
    finalQuality = modules.checkLinuxFinalProductionQuality({
      context: candidate.investigation,
      assets: candidate.assets,
      simulation: candidate.simulation,
      lab: finalLab,
    });
    if (!finalQuality.passed || finalQuality.issues.length > 0) {
      const issueText = finalQuality.issues.map((issue) => `${issue.category}:${issue.description}`).join(" | ");
      const deductionText = (finalQuality.deductions || [])
        .map((item) => `${item.category}:${item.pointsLost}:${item.reason}`)
        .slice(0, 8)
        .join(" | ");
      throw new Error(`final production validation failed: score=${finalQuality.finalProductionScore} interim=${finalQuality.interimAssetScore} finalNarrative=${finalQuality.coverage.finalNarrativeEvaluated} issues=${issueText || "none"} deductions=${deductionText || "none"}`);
    }

    result.accepted = true;
    result.stage = "accepted";
    result.summary = compactCandidateSummary(candidate, contract, finalQuality);
    result.fingerprints = {
      exact: hash(stableCandidateSummary(candidate, contract)),
      scenario: hash({
        family: candidate.investigation.incidentFamily,
        hostRole: candidate.investigation.hostRole,
        primaryService: contract.scenarioFraming.primaryService,
        taskIntents: result.summary.taskIntents,
        selectedEvidence: result.summary.selectedEvidence.map((item) => item.evidence),
      }),
      content: hash(candidate.assets.map((asset) => `${asset.file_path}:${hash(asset.content)}`).join("\n")),
    };
  } catch (error) {
    result.failure = stageFailure(result.stage, error, {
      attempts: error.qaAttempts || attempts,
      generationSeed: error.qaGenerationSeed || result.generationSeed,
    });
    if (config.retainFailures) {
      const failureDir = path.join(outputDir, "failures", planItem.difficulty, `${planItem.index}-${planItem.family}-${planItem.duration.replace(/\s+/g, "-")}`);
      writeJson(path.join(failureDir, "failure.json"), result.failure);
      if (candidate) writeJson(path.join(failureDir, "candidate-summary.json"), compactCandidateSummary(candidate, contract || { difficulty: planItem.difficulty, taskContracts: [], canonicalTaskCount: 0 }, finalQuality || { finalProductionScore: null }));
      if (candidate) writeJson(path.join(failureDir, "assets.json"), candidate.assets.map((asset) => ({ file_path: asset.file_path, content: asset.content })));
      if (contract) writeJson(path.join(failureDir, "contract.json"), contract);
      if (narrative) writeJson(path.join(failureDir, "synthetic-narrative.json"), narrative);
      if (finalLab) writeJson(path.join(failureDir, "final-lab.json"), finalLab);
    }
    if (config.failFast) throw Object.assign(error, { qaResult: result });
  } finally {
    result.elapsedMs = Math.round(performance.now() - started);
  }

  if (result.accepted && config.retainSuccesses) {
    const successDir = path.join(outputDir, "successes", planItem.difficulty, `${planItem.index}-${planItem.family}-${planItem.duration.replace(/\s+/g, "-")}`);
    writeJson(path.join(successDir, "summary.json"), result.summary);
    writeJson(path.join(successDir, "contract.json"), contract);
    writeJson(path.join(successDir, "synthetic-narrative.json"), narrative);
    writeJson(path.join(successDir, "final-lab.json"), finalLab);
  }
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function issueDetected(contractValidation, expectedCode) {
  return !contractValidation.passed && (!expectedCode || contractValidation.issues.some((issue) => issue.code === expectedCode));
}

function mutationCases(modules, candidate, contract, narrative) {
  const cases = [];
  const firstTaskEvidence = new Set(contract.taskContracts[0]?.selectedEvidence.map((item) => item.path) || []);
  const otherTaskEvidence = contract.taskContracts
    .flatMap((task) => task.selectedEvidence)
    .find((asset) => !firstTaskEvidence.has(asset.path));
  const noCurrentIndex = contract.taskContracts.findIndex((task) => !task.requiredCapabilities.some((capability) => capability.startsWith("current_")));

  cases.push(["drop_task", "LINUX_NARRATIVE_TASK_COUNT_MISMATCH", () => {
    const mutated = clone(narrative);
    mutated.tasks.pop();
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  cases.push(["duplicate_task", "LINUX_NARRATIVE_TASK_DUPLICATE", () => {
    const mutated = clone(narrative);
    if (mutated.tasks[1]) mutated.tasks[1].task_id = mutated.tasks[0].task_id;
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  cases.push(["reorder_tasks", "LINUX_NARRATIVE_TASK_ORDER_MISMATCH", () => {
    const mutated = clone(narrative);
    mutated.tasks.reverse();
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  cases.push(["alter_intent", "LINUX_NARRATIVE_INTENT_MISMATCH", () => {
    const mutated = clone(narrative);
    mutated.tasks[0].task_intent = "risk_assessment";
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  cases.push(["invent_evidence", "LINUX_NARRATIVE_UNRENDERED_EVIDENCE", () => {
    const mutated = clone(narrative);
    mutated.tasks[0].evidence[0] = "assets/logs/not_real.log";
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  if (otherTaskEvidence) {
    cases.push(["cross_task_evidence", "LINUX_NARRATIVE_EVIDENCE_OUTSIDE_CONTRACT", () => {
      const mutated = clone(narrative);
      mutated.tasks[0].evidence[0] = otherTaskEvidence.path;
      return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
    }]);
  }
  cases.push(["invent_subject", "LINUX_NARRATIVE_UNKNOWN_SUBJECT", () => {
    const mutated = clone(narrative);
    mutated.tasks[0].claims[0].subjects = ["identity:not-a-real-user"];
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  cases.push(["invent_relationship", "LINUX_NARRATIVE_UNSUPPORTED_RELATIONSHIP", () => {
    const mutated = clone(narrative);
    mutated.tasks[0].claims[0].relationships = [{ relation: "opened_file", subject_ids: ["identity:not-real", "file:not-real"] }];
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  cases.push(["invent_timestamp", "LINUX_NARRATIVE_INVENTED_TIMESTAMP", () => {
    const mutated = clone(narrative);
    mutated.tasks[0].claims[0].text += " It happened at 2099-01-01 00:00:00.";
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  if (noCurrentIndex >= 0) {
    cases.push(["unsupported_current_state", "LINUX_NARRATIVE_UNSUPPORTED_CURRENT_STATE", () => {
      const mutated = clone(narrative);
      mutated.tasks[noCurrentIndex].claims[0].claim_class = "current_state";
      mutated.tasks[noCurrentIndex].claims[0].text = "The process is currently running.";
      return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
    }]);
  }
  cases.push(["unbounded_inference", "LINUX_NARRATIVE_UNBOUNDED_INFERENCE", () => {
    const mutated = clone(narrative);
    mutated.tasks[0].claims[1].text = "The root cause is confirmed compromise by malware.";
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  cases.push(["unsupported_recommendation", "LINUX_NARRATIVE_UNSUPPORTED_RECOMMENDATION", () => {
    const mutated = clone(narrative);
    mutated.tasks[0].claims.push({
      claim_class: "recommendation",
      text: "Declare confirmed compromise and state that the attacker is known.",
      supporting_evidence: mutated.tasks[0].evidence.slice(0, 1),
      subjects: [],
      relationships: [],
      timestamps: [],
    });
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  cases.push(["internal_detail_leak", "LINUX_NARRATIVE_INTERNAL_DETAIL_LEAK", () => {
    const mutated = clone(narrative);
    mutated.scenario += " Internal relation executed_by should be exposed.";
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  cases.push(["local_path_leak", "LINUX_NARRATIVE_LOCAL_PATH_LEAK", () => {
    const mutated = clone(narrative);
    mutated.scenario += " See C:\\Users\\example\\Desktop\\cyberlab\\lib\\lab-assets\\linux\\simulation.ts.";
    return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
  }]);
  if (contract.difficulty !== "Advanced") {
    cases.push(["lower_tier_advanced_leak", "LINUX_NARRATIVE_ADVANCED_LEAK", () => {
      const mutated = clone(narrative);
      mutated.scenario += " Analysts should use assets/runtime/open_files.txt as proof.";
      return modules.validateLinuxGeneratedNarrativeAgainstContract(contract, mutated);
    }]);
  }
  cases.push(["remove_selected_evidence", "closure_exception", () => {
    const selected = contract.taskContracts[0].selectedEvidence[0]?.path;
    const rendered = candidate.assets.map((asset) => asset.file_path).filter((assetPath) => normalizeEvidencePath(assetPath) !== normalizeEvidencePath(selected));
    try {
      modules.assertLinuxTaskEvidenceClosureInvariant(candidate.simulation, rendered);
      return { passed: true, issues: [] };
    } catch (error) {
      return { passed: false, issues: [{ code: "closure_exception", message: error.message }] };
    }
  }]);

  return cases;
}

function runDeterminism(modules, accepted, config) {
  const report = { checked: 0, failures: [] };
  for (const difficulty of DIFFICULTIES) {
    const sample = accepted.filter((item) => item.difficulty === difficulty).slice(0, Math.min(20, config.counts[difficulty]));
    for (const item of sample) {
      const fingerprints = [];
      for (let repeat = 0; repeat < 3; repeat += 1) {
        try {
          const candidate = modules.buildLinuxAssetCandidate({
            seed: item.generationSeed || item.seed,
            generationTime: "2026-07-29T08:00:00.000Z",
            category: "Linux",
              difficulty: item.difficulty,
              duration: item.duration,
              title: "CyberLab Asset Pack",
            }, { incidentFamily: item.family });
          const contract = modules.buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
          fingerprints.push(hash(stableCandidateSummary(candidate, contract)));
        } catch (error) {
          fingerprints.push(`ERROR:${error instanceof Error ? error.message : String(error)}`);
        }
      }
      report.checked += 1;
      if (new Set(fingerprints).size !== 1) {
        report.failures.push({ seed: item.seed, generationSeed: item.generationSeed, difficulty, family: item.family, duration: item.duration, fingerprints });
      }
    }
  }
  report.passed = report.failures.length === 0;
  return report;
}

function runMutationCampaign(modules, accepted, config) {
  const report = { sampledGenerations: 0, casesRun: 0, detected: 0, failures: [], byCase: {} };
  for (const difficulty of DIFFICULTIES) {
    const sample = accepted.filter((item) => item.difficulty === difficulty).slice(0, Math.min(20, config.counts[difficulty]));
    for (const item of sample) {
      report.sampledGenerations += 1;
      let candidate;
      try {
        candidate = buildCandidateForRequestedFamily(modules, item).candidate;
      } catch (error) {
        report.failures.push({
          seed: item.seed,
          generationSeed: item.generationSeed,
          difficulty,
          family: item.family,
          duration: item.duration,
          mutation: "mutation_fixture_generation",
          expectedCode: "generation_success",
          actualCodes: [error instanceof Error ? error.message : String(error)],
        });
        continue;
      }
      const contract = modules.buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
      const narrative = buildContractNarrative(contract);
      for (const [name, expectedCode, execute] of mutationCases(modules, candidate, contract, narrative)) {
        report.casesRun += 1;
        const result = execute();
        const detected = issueDetected(result, expectedCode);
        if (detected) {
          report.detected += 1;
          report.byCase[name] = report.byCase[name] || { run: 0, detected: 0 };
          report.byCase[name].run += 1;
          report.byCase[name].detected += 1;
        } else {
          report.byCase[name] = report.byCase[name] || { run: 0, detected: 0 };
          report.byCase[name].run += 1;
          report.failures.push({
            seed: item.seed,
            generationSeed: item.generationSeed,
            difficulty,
            family: item.family,
            duration: item.duration,
            mutation: name,
            expectedCode,
            actualCodes: result.issues?.map((issue) => issue.code) || [],
          });
        }
      }
    }
  }
  report.detectionRate = report.casesRun === 0 ? 1 : report.detected / report.casesRun;
  report.passed = report.failures.length === 0;
  return report;
}

function buildSummary(config, results, determinism, mutation) {
  const summary = {
    runId: config.runId,
    baseSeed: config.baseSeed,
    outputDir: config.outputDir,
    requested: config.counts,
    totalRequested: Object.values(config.counts).reduce((sum, value) => sum + value, 0),
    totalAccepted: results.filter((item) => item.accepted).length,
    totalRejected: results.filter((item) => !item.accepted).length,
    byDifficulty: {},
    byFamily: {},
    byDuration: {},
    byTaskCount: {},
    byStage: {},
    failures: results.filter((item) => !item.accepted).map((item) => ({
      seed: item.seed,
      difficulty: item.difficulty,
      family: item.family,
      duration: item.duration,
      stage: item.failure?.stage || item.stage,
      message: item.failure?.message,
    })),
    diversity: {
      exactFingerprintDuplicates: [],
      scenarioFingerprintCounts: {},
      contentFingerprintCounts: {},
    },
    determinism,
    mutation,
  };

  const exactSeen = new Map();
  for (const result of results) {
    increment(summary.byDifficulty, result.difficulty);
    increment(summary.byFamily, result.family);
    increment(summary.byDuration, result.duration);
    increment(summary.byStage, result.failure?.stage || result.stage);
    if (result.accepted) {
      increment(summary.byTaskCount, String(result.summary.taskCount));
      increment(summary.diversity.scenarioFingerprintCounts, result.fingerprints.scenario);
      increment(summary.diversity.contentFingerprintCounts, result.fingerprints.content);
      const previous = exactSeen.get(result.fingerprints.exact);
      if (previous) {
        summary.diversity.exactFingerprintDuplicates.push({ fingerprint: result.fingerprints.exact, firstSeed: previous.seed, secondSeed: result.seed });
      } else {
        exactSeen.set(result.fingerprints.exact, result);
      }
    }
  }

  summary.acceptanceRate = summary.totalRequested === 0 ? 1 : summary.totalAccepted / summary.totalRequested;
  summary.passed = summary.totalRejected === 0 && determinism.passed && mutation.passed && summary.diversity.exactFingerprintDuplicates.length === 0;
  return summary;
}

function markdownSummary(summary) {
  const recommendation = summary.passed ? "READY_FOR_LIVE_API_QA" : "NOT_READY_DETERMINISTIC_DEFECTS_REMAIN";
  return `# Linux Deterministic Production QA

- run id: ${summary.runId}
- base seed: ${summary.baseSeed}
- requested: ${summary.totalRequested}
- accepted: ${summary.totalAccepted}
- rejected: ${summary.totalRejected}
- acceptance rate: ${(summary.acceptanceRate * 100).toFixed(2)}%
- determinism: ${summary.determinism.passed ? "pass" : "fail"} (${summary.determinism.checked} seeds checked)
- mutation detection: ${summary.mutation.passed ? "pass" : "fail"} (${summary.mutation.detected}/${summary.mutation.casesRun})
- exact fingerprint duplicates: ${summary.diversity.exactFingerprintDuplicates.length}
- recommendation: ${recommendation}

## Difficulty

${Object.entries(summary.byDifficulty).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Families

${Object.entries(summary.byFamily).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Durations

${Object.entries(summary.byDuration).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Task Counts

${Object.entries(summary.byTaskCount).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Stages

${Object.entries(summary.byStage).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Failures

${summary.failures.length === 0 ? "- none" : summary.failures.map((item) => `- ${item.seed}: ${item.stage}: ${item.message}`).join("\n")}
`;
}

function main() {
  const config = {
    counts: {
      Beginner: envInt("LINUX_QA_BEGINNER_COUNT", 200),
      Intermediate: envInt("LINUX_QA_INTERMEDIATE_COUNT", 200),
      Advanced: envInt("LINUX_QA_ADVANCED_COUNT", 200),
    },
    baseSeed: process.env.LINUX_QA_BASE_SEED || "phase5-linux-deterministic-production-qa",
    outputRoot: path.resolve(process.env.LINUX_QA_OUTPUT_DIR || DEFAULT_OUTPUT_ROOT),
    retainSuccesses: envBool("LINUX_QA_RETAIN_SUCCESSES", false),
    retainFailures: envBool("LINUX_QA_RETAIN_FAILURES", true),
    failFast: envBool("LINUX_QA_FAIL_FAST", false),
    familyFilter: process.env.LINUX_QA_FAMILY_FILTER || "",
    durationFilter: process.env.LINUX_QA_DURATION_FILTER || "",
    verbose: envBool("LINUX_QA_VERBOSE", false),
  };
  if (!config.verbose) {
    console.info = () => {};
    console.warn = () => {};
  }
  config.runId = new Date().toISOString().replace(/[:.]/g, "-");
  config.outputDir = path.join(config.outputRoot, config.runId);
  ensureDir(config.outputDir);

  const out = compileIfNeeded();
  const modules = {
    buildLinuxAssetCandidate: require(path.join(out, "linux", "index.js")).buildLinuxAssetCandidate,
    checkLinuxFinalProductionQuality: require(path.join(out, "linux", "qualityChecker.js")).checkLinuxFinalProductionQuality,
    buildLinuxNarrativeContract: require(path.join(out, "linux", "simulation.js")).buildLinuxNarrativeContract,
    assertLinuxTaskEvidenceClosureInvariant: require(path.join(out, "linux", "simulation.js")).assertLinuxTaskEvidenceClosureInvariant,
    validateLinuxGeneratedNarrativeAgainstContract: require(path.join(out, "linux", "narrativeContract.js")).validateLinuxGeneratedNarrativeAgainstContract,
  };

  const plan = generationPlan(config);
  const results = [];
  for (const item of plan) {
    const result = runGeneration(modules, item, config, config.outputDir);
    results.push(result);
    const status = result.accepted ? "PASS" : "FAIL";
    console.log(`${status} ${item.difficulty} #${item.index + 1} ${item.family} ${item.duration} seed=${item.seed} stage=${result.stage} elapsedMs=${result.elapsedMs}`);
  }

  const accepted = results.filter((item) => item.accepted);
  const determinism = runDeterminism(modules, accepted, config);
  const mutation = runMutationCampaign(modules, accepted, config);
  const summary = buildSummary(config, results, determinism, mutation);

  writeJson(path.join(config.outputDir, "summary.json"), summary);
  writeJson(path.join(config.outputDir, "failing-seeds.json"), summary.failures);
  writeJson(path.join(config.outputDir, "diversity-fingerprint-summary.json"), summary.diversity);
  writeJson(path.join(config.outputDir, "mutation-detection-summary.json"), mutation);
  writeText(path.join(config.outputDir, "summary.md"), markdownSummary(summary));
  console.log(JSON.stringify({
    outputDir: config.outputDir,
    requested: summary.totalRequested,
    accepted: summary.totalAccepted,
    rejected: summary.totalRejected,
    determinism: determinism.passed,
    mutation: mutation.passed,
    passed: summary.passed,
  }, null, 2));

  if (!summary.passed) process.exitCode = 1;
}

main();
