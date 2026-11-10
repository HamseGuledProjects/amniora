// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const AUDIT_DIR = path.join(ROOT, ".tmp", "linux-phase9-audit");
const AUDIT_FILE = path.join(AUDIT_DIR, "phase9-workload-audit.json");
const GENERATION_TIME = "2026-07-29T09:00:00.000Z";
const VERSION = "phase9c-workload-audit-v1";

const MATRIX = [
  ["Beginner", "misconfigured_sudoers", "phase8-matrix:Beginner:misconfigured_sudoers:0"],
  ["Beginner", "ssh_bruteforce", "phase8-matrix:Beginner:ssh_bruteforce:0"],
  ["Beginner", "service_account_misuse", "phase8-matrix:Beginner:service_account_misuse:2"],
  ["Beginner", "ssh_key_compromise", "phase8-matrix:Beginner:ssh_key_compromise:0"],
  ["Beginner", "cron_persistence", "phase8-matrix:Beginner:cron_persistence:0"],
  ["Beginner", "systemd_persistence", "phase8-matrix:Beginner:systemd_persistence:0"],
  ["Beginner", "unauthorized_package_install", "phase8-matrix:Beginner:unauthorized_package_install:0"],
  ["Beginner", "data_staging", "phase8-matrix:Beginner:data_staging:16"],
  ["Beginner", "log_tampering", "phase8-matrix:Beginner:log_tampering:2"],
  ["Beginner", "reverse_shell", "phase8-matrix:Beginner:reverse_shell:3"],
  ["Beginner", "docker_compromise", "phase8-matrix:Beginner:docker_compromise:12"],
  ["Intermediate", "misconfigured_sudoers", "phase8-matrix:Intermediate:misconfigured_sudoers:3"],
  ["Intermediate", "ssh_bruteforce", "phase8-matrix:Intermediate:ssh_bruteforce:0"],
  ["Intermediate", "service_account_misuse", "phase8-matrix:Intermediate:service_account_misuse:1"],
  ["Intermediate", "ssh_key_compromise", "phase8-matrix:Intermediate:ssh_key_compromise:0"],
  ["Intermediate", "cron_persistence", "phase8-matrix:Intermediate:cron_persistence:0"],
  ["Intermediate", "systemd_persistence", "phase8-matrix:Intermediate:systemd_persistence:3"],
  ["Intermediate", "unauthorized_package_install", "phase8-matrix:Intermediate:unauthorized_package_install:0"],
  ["Intermediate", "data_staging", "phase8-matrix:Intermediate:data_staging:1"],
  ["Intermediate", "log_tampering", "phase8-matrix:Intermediate:log_tampering:5"],
  ["Intermediate", "reverse_shell", "phase8-matrix:Intermediate:reverse_shell:0"],
  ["Intermediate", "docker_compromise", "phase8-matrix:Intermediate:docker_compromise:8"],
  ["Advanced", "misconfigured_sudoers", "phase8-matrix:Advanced:misconfigured_sudoers:0"],
  ["Advanced", "ssh_bruteforce", "phase8-matrix:Advanced:ssh_bruteforce:0"],
  ["Advanced", "service_account_misuse", "phase8-matrix:Advanced:service_account_misuse:0"],
  ["Advanced", "ssh_key_compromise", "phase8-matrix:Advanced:ssh_key_compromise:2"],
  ["Advanced", "cron_persistence", "phase8-matrix:Advanced:cron_persistence:0"],
  ["Advanced", "systemd_persistence", "phase8-matrix:Advanced:systemd_persistence:2"],
  ["Advanced", "unauthorized_package_install", "phase8-matrix:Advanced:unauthorized_package_install:1"],
  ["Advanced", "data_staging", "phase8-matrix:Advanced:data_staging:23"],
  ["Advanced", "log_tampering", "phase8-matrix:Advanced:log_tampering:1"],
  ["Advanced", "reverse_shell", "phase8-matrix:Advanced:reverse_shell:10"],
  ["Advanced", "docker_compromise", "phase8-matrix:Advanced:docker_compromise:13"],
];

const MULTI_SEED_GROUPS = [
  ["Beginner", "ssh_bruteforce", 30],
  ["Beginner", "cron_persistence", 30],
  ["Intermediate", "data_staging", 30],
  ["Intermediate", "unauthorized_package_install", 30],
  ["Advanced", "reverse_shell", 60],
  ["Advanced", "cron_persistence", 60],
  ["Advanced", "docker_compromise", 60],
];

function compileIfNeeded(label = "audit") {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase9c-${label}-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function loadModules(out) {
  return {
    linux: require(path.join(out, "linux", "index.js")),
    workload: require(path.join(out, "linux", "workloadCalibration.js")),
    replay: require(path.join(out, "linux", "replay.js")),
    quality: require(path.join(out, "linux", "qualityChecker.js")),
    simulation: require(path.join(out, "linux", "simulation.js")),
    assembly: require(path.join(out, "linux", "narrativeAssembly.js")),
    boundary: require(path.join(out, "linux", "preSaveWorkloadBoundary.js")),
    incidentCoverage: require(path.join(out, "linux", "incidentCoverage.js")),
  };
}

function requestedDuration(difficulty) {
  return difficulty === "Advanced" ? 60 : 30;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function issueCodes(result) {
  return (result.issues || []).map((issue) => issue.code || issue.description?.match(/LINUX_[A-Z0-9_]+/)?.[0]).filter(Boolean);
}

function buildCandidate(modules, difficulty, family, seed, options = {}) {
  const attempts = [];
  const candidate = modules.linux.buildLinuxAssetCandidate(
    {
      category: "Linux",
      difficulty,
      duration: `${options.duration || requestedDuration(difficulty)} mins`,
      title: options.title || "Phase 9C workload audit",
      seed,
      generationTime: options.generationTime || GENERATION_TIME,
      assetAttempt: options.assetAttempt || 1,
    },
    {
      incidentFamily: family,
      onAttempt(event) {
        attempts.push({
          attempt: event.attempt,
          accepted: Boolean(event.accepted),
          reason: event.reason || "",
          incidentFamily: event.incidentFamily || "",
          hostRole: event.hostRole || "",
          score: event.score,
          estimatedDuration: event.workloadReport?.estimatedDurationMinutes ?? null,
          issueCodes: event.issueCodes || event.workloadReport?.issues?.map((issue) => issue.code) || [],
          workloadEstimateHash: event.workloadEstimateHash || "",
          workloadReportHash: event.workloadReportHash || "",
        });
      },
    }
  );
  candidate.phase9AttemptTrace = attempts;
  return candidate;
}

function countSharedActions(report) {
  const all = report.taskEstimates.flatMap((task) => task.sharedActionKeys || []);
  return all.length - new Set(all).size;
}

function countDeliverableActions(report) {
  return report.taskEstimates.reduce((total, task) => total + (task.expectedActions || []).filter((action) => /write the task deliverable/i.test(action)).length, 0);
}

function registrySubjectCount(simulation) {
  return new Set((simulation.evidenceRegistry || []).flatMap((asset) => asset.canonicalObjectIds || [])).size;
}

function remediationTasks(simulation, report) {
  return simulation.canonicalTasks
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((task, index) => ({ task, estimate: report.taskEstimates[index] }))
    .filter(({ task, estimate }) =>
      task.intent === "containment_recommendation" ||
      task.inquiryTypes?.includes("remediation_or_containment") ||
      task.inquiryTypes?.includes("risk_assessment") ||
      task.expectedDeliverableType === "containment_plan" ||
      task.expectedDeliverableType === "risk_summary" ||
      /remediation|containment|risk/i.test(`${estimate?.intent || ""} ${estimate?.investigationStage || ""}`)
    )
    .map(({ task, estimate }) => ({
      taskId: task.id,
      intent: task.intent,
      deliverableType: task.expectedDeliverableType,
      inquiryTypes: task.inquiryTypes || [],
      actionTypes: (estimate?.expectedActions || []).filter((action) => /remediation|follow-up|deliverable|uncertainty|impact/i.test(action)),
      estimatedMinutes: estimate?.estimatedMinutes ?? 0,
    }));
}

function requiredRemediationConcepts(modules, simulation) {
  const difficulty = simulation.canonicalTasks?.[0]?.difficulty || "Advanced";
  return modules.incidentCoverage
    .linuxIncidentDifficultyCoverage(simulation.investigation?.incidentFamily, difficulty)
    ?.requiredRemediationConcepts || [];
}

function remediationCoverage(modules, candidate) {
  const coverage = modules.incidentCoverage.validateLinuxIncidentCoverage({
    simulation: candidate.simulation,
    finalAssets: candidate.assets,
    lab: finalNarrative(modules, candidate),
  });
  return coverage.remediationConcepts.map((item) => ({
    concept: item.id.replace(/^remediation:/, ""),
    covered: item.covered,
    taskIds: item.coveredByTaskIds,
    missing: item.missing || [],
  }));
}

function concreteRemediationActions(report) {
  return report.taskEstimates.flatMap((task) => task.remediationActions || []).map((action) => ({
    concept: action.concept,
    action: action.action,
    costMinutes: action.costMinutes,
    taskId: action.taskId,
    taskIndex: action.taskIndex,
    carrier: action.carrier,
    carrierDeliverableType: action.carrierDeliverableType,
    dedupeKey: action.dedupeKey,
  }));
}

function timelineTasks(simulation, report) {
  return simulation.canonicalTasks
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((task, index) => ({ task, estimate: report.taskEstimates[index] }))
    .filter(({ task, estimate }) => task.requiredCapabilities?.includes("timeline_exact") || (estimate?.expectedActions || []).some((action) => /chronology|timeline|sequence/i.test(action)))
    .map(({ task, estimate }) => ({
      taskId: task.id,
      intent: task.intent,
      requiredCapabilities: task.requiredCapabilities || [],
      relevantEvidencePaths: estimate?.relevantEvidencePaths || [],
      actions: (estimate?.expectedActions || []).filter((action) => /chronology|timeline|sequence/i.test(action)),
    }));
}

function intermediateSixTaskJustification(simulation, report, difficulty) {
  if (difficulty !== "Intermediate" || report.metrics.taskCount !== 6) return null;
  const tasks = simulation.canonicalTasks.slice().sort((left, right) => left.order - right.order);
  const signatures = tasks.map((task, index) => {
    const estimate = report.taskEstimates[index] || {};
    return {
      taskId: task.id,
      intent: task.intent,
      deliverableType: task.expectedDeliverableType,
      evidencePaths: estimate.relevantEvidencePaths || [],
      requiredCapabilities: task.requiredCapabilities || [],
      primarySubjectIds: task.primarySubjectIds || [],
    };
  });
  const distinctSignatures = new Set(signatures.map((item) => JSON.stringify({
    intent: item.intent,
    deliverableType: item.deliverableType,
    evidencePaths: item.evidencePaths,
    requiredCapabilities: item.requiredCapabilities,
    primarySubjectIds: item.primarySubjectIds,
  }))).size;
  return {
    required: true,
    distinctTaskSignatures: distinctSignatures,
    taskCount: tasks.length,
    nonDuplicative: distinctSignatures === tasks.length && report.dimensions.duplicatedWork === 0,
    withinDeliverableLimit: report.metrics.learnerActionCount <= 48 && report.metrics.uniqueEvidencePathCount <= 24,
    withinDurationRange: report.estimatedDurationMinutes >= report.acceptableDurationRange.minimumMinutes && report.estimatedDurationMinutes <= report.acceptableDurationRange.maximumMinutes,
    taskSignatures: signatures,
  };
}

function matrixRow(modules, candidate, difficulty, family, seed) {
  const report = candidate.assetQuality.workloadReport;
  const subjectsInRegistry = registrySubjectCount(candidate.simulation);
  const acceptedAttempt = (candidate.phase9AttemptTrace || []).find((attempt) => attempt.accepted);
  const requiredConcepts = requiredRemediationConcepts(modules, candidate.simulation);
  const conceptCoverage = remediationCoverage(modules, candidate);
  const recognizedRemediationTasks = remediationTasks(candidate.simulation, report);
  const remediationActions = concreteRemediationActions(report);
  const row = {
    incidentFamily: family,
    difficulty,
    rootSeed: seed,
    requestedDuration: report.requestedDurationMinutes,
    estimatedDuration: report.estimatedDurationMinutes,
    acceptedRange: report.acceptableDurationRange,
    distanceFromLowerBoundary: Number((report.estimatedDurationMinutes - report.acceptableDurationRange.minimumMinutes).toFixed(2)),
    distanceFromUpperBoundary: Number((report.acceptableDurationRange.maximumMinutes - report.estimatedDurationMinutes).toFixed(2)),
    finalResult: candidate.assetQuality.passed && report.issues.length === 0 ? "pass" : "fail",
    acceptedAttempt: acceptedAttempt?.attempt ?? null,
    precedingAttemptOutcomes: (candidate.phase9AttemptTrace || []).filter((attempt) => !acceptedAttempt || attempt.attempt < acceptedAttempt.attempt),
    taskCount: report.metrics.taskCount,
    learnerActionCount: report.metrics.learnerActionCount,
    sharedActionCount: countSharedActions(report),
    uniqueEvidencePaths: report.metrics.uniqueEvidencePathCount,
    relevantLines: report.metrics.relevantEvidenceLineCount,
    distractorLines: report.metrics.distractorEvidenceLineCount,
    relevantToNoiseRatio: report.metrics.relevantToNoiseRatio,
    relevantSubjectCount: report.metrics.taskLocalSubjectCount,
    contextualSubjectCount: Math.max(0, subjectsInRegistry - report.metrics.taskLocalSubjectCount - report.metrics.noiseOnlySubjectCount),
    noiseOnlySubjectCount: report.metrics.noiseOnlySubjectCount,
    relevantRelationshipCount: report.metrics.taskLocalRelationshipCount,
    timelineActionCount: report.metrics.timelineEventCount,
    remediationActionCount: report.metrics.remediationActionCount,
    deliverableActionCount: countDeliverableActions(report),
    workloadDimensions: report.dimensions,
    independentEstimateHash: candidate.deterministicHashes.workloadEstimateHash,
    contractAwareReportHash: candidate.deterministicHashes.workloadReportHash,
    workloadIssueCodes: report.issues.map((issue) => issue.code),
    requiresRemediation: requiredConcepts.length > 0,
    requiredRemediationConcepts: requiredConcepts,
    remediationConceptCoverage: conceptCoverage,
    concreteRemediationActions: remediationActions,
    tokenCostRemediationActions: remediationActions.filter((action) => action.costMinutes > 0 && action.costMinutes < modules.workload.LINUX_MIN_REMEDIATION_ACTION_COST_MINUTES),
    requiredRemediationConceptsCounted: conceptCoverage.every((item) => item.covered) && requiredConcepts.every((concept) => remediationActions.some((action) => action.concept === concept)) && (requiredConcepts.length === 0 || report.dimensions.remediationReasoning > 0),
    remediationTasks: recognizedRemediationTasks,
    remediationDimension: report.dimensions.remediationReasoning,
    learnerTimelineActions: timelineTasks(candidate.simulation, report),
    timelineDimension: report.dimensions.timelineReasoning,
    intermediateSixTaskJustification: intermediateSixTaskJustification(candidate.simulation, report, difficulty),
    rawAttempts: candidate.phase9AttemptTrace || [],
  };
  return row;
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
}

function distribution(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function aggregateRows(rows) {
  const byDifficulty = {};
  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const subset = rows.filter((row) => row.difficulty === difficulty);
    byDifficulty[difficulty] = {
      taskCountDistribution: distribution(subset.map((row) => row.taskCount)),
      learnerActionDistribution: distribution(subset.map((row) => row.learnerActionCount)),
      timelineActionDistribution: distribution(subset.map((row) => row.timelineActionCount)),
      meanDistanceFromLowerBoundary: Number(mean(subset.map((row) => row.distanceFromLowerBoundary)).toFixed(2)),
      medianDistanceFromLowerBoundary: median(subset.map((row) => row.distanceFromLowerBoundary)),
      meanDistanceFromUpperBoundary: Number(mean(subset.map((row) => row.distanceFromUpperBoundary)).toFixed(2)),
      medianDistanceFromUpperBoundary: median(subset.map((row) => row.distanceFromUpperBoundary)),
      withinOneMinuteOfMinimum: subset.filter((row) => row.distanceFromLowerBoundary <= 1).length,
      withinTwoMinutesOfMinimum: subset.filter((row) => row.distanceFromLowerBoundary <= 2).length,
      withinOneMinuteOfMaximum: subset.filter((row) => row.distanceFromUpperBoundary <= 1).length,
      withinTwoMinutesOfMaximum: subset.filter((row) => row.distanceFromUpperBoundary <= 2).length,
      boundaryClusteringWarning: subset.filter((row) => row.distanceFromLowerBoundary <= 2 || row.distanceFromUpperBoundary <= 2).length > Math.ceil(subset.length / 2),
    };
  }
  return {
    byDifficulty,
    remediationRequiredLabs: rows.filter((row) => row.requiresRemediation).length,
    remediationRequiredWithZeroEffort: rows.filter((row) => row.requiresRemediation && row.remediationDimension <= 0).length,
    tokenCostRemediationCases: rows.filter((row) => row.tokenCostRemediationActions.length > 0).length,
    rawUnderloadedCandidates: rows.flatMap((row) => row.rawAttempts).filter((attempt) => attempt.issueCodes.includes("LINUX_WORKLOAD_DURATION_UNDER_TARGET")).length,
    rawOverloadedCandidates: rows.flatMap((row) => row.rawAttempts).filter((attempt) => attempt.issueCodes.includes("LINUX_WORKLOAD_DURATION_OVER_TARGET")).length,
    acceptedAfterWorkloadRetry: rows.filter((row) => row.acceptedAttempt && row.acceptedAttempt > 1 && row.precedingAttemptOutcomes.some((attempt) => attempt.issueCodes.some((code) => /^LINUX_WORKLOAD_/.test(code)))).length,
    failedAfterMaximumRetries: rows.filter((row) => row.finalResult !== "pass").length,
  };
}

function estimate(modules, simulation, assets) {
  return modules.workload.estimateLinuxLearnerWorkload({ simulation, assets });
}

function check(modules, simulation, assets, difficulty = "Advanced", duration = 60) {
  return modules.workload.checkLinuxLabWorkload({ simulation, assets, requestedDifficulty: difficulty, requestedDurationMinutes: duration });
}

function dimensionDelta(before, after) {
  const delta = {};
  for (const key of Object.keys(before.dimensions)) delta[key] = Number((after.dimensions[key] - before.dimensions[key]).toFixed(2));
  return delta;
}

function mutationRecord(name, baseline, mutated, validation, expectedDirection) {
  const delta = Number((mutated.estimatedDurationMinutes - baseline.estimatedDurationMinutes).toFixed(2));
  const direction =
    delta > 0 ? "increase" :
    delta < 0 ? "decrease" :
    "flat";
  return {
    mutation: name,
    baselineEstimate: baseline.estimatedDurationMinutes,
    mutatedEstimate: mutated.estimatedDurationMinutes,
    delta,
    baselineDimensions: baseline.dimensions,
    mutatedDimensions: mutated.dimensions,
    changedDimensions: dimensionDelta(baseline, mutated),
    workloadIssueCodes: issueCodes(validation),
    finalQualityResult: validation.passed ? "accepted" : "rejected",
    expectedDirection,
    actualDirection: direction,
    directionAssertionPassed:
      expectedDirection === "no_duplicate" ? validation.passed && !issueCodes(validation).includes("LINUX_WORKLOAD_REMEDIATION_DOUBLE_COUNTED") :
      expectedDirection === "blocked" ? !validation.passed :
      expectedDirection === direction,
  };
}

function forgedRemediationValidationRecord(modules, name, candidate, mutateEstimate) {
  const baseline = estimate(modules, candidate.simulation, candidate.assets);
  const forgedEstimate = mutateEstimate(clone(baseline));
  const report = modules.workload.evaluateLinuxWorkloadContract({
    estimate: forgedEstimate,
    simulation: candidate.simulation,
    assets: candidate.assets,
    requestedDifficulty: "Advanced",
    requestedDurationMinutes: 60,
  });
  return {
    mutation: name,
    baselineEstimate: baseline.estimatedDurationMinutes,
    mutatedEstimate: report.estimatedDurationMinutes,
    delta: Number((report.estimatedDurationMinutes - baseline.estimatedDurationMinutes).toFixed(2)),
    baselineDimensions: baseline.dimensions,
    mutatedDimensions: report.dimensions,
    changedDimensions: dimensionDelta(baseline, report),
    requiresRemediation: requiredRemediationConcepts(modules, candidate.simulation).length > 0,
    requiredRemediationConcepts: requiredRemediationConcepts(modules, candidate.simulation),
    remediationDimension: report.dimensions.remediationReasoning,
    remediationActionCount: report.metrics.remediationActionCount,
    concreteRemediationActions: concreteRemediationActions(report),
    workloadIssueCodes: report.issues.map((issue) => issue.code),
    finalQualityResult: report.issues.length > 0 ? "rejected" : "accepted",
    expectedDirection: "blocked",
    actualDirection: "forged",
    directionAssertionPassed: report.issues.length > 0,
  };
}

function addDistinctTask(simulation) {
  const mutated = clone(simulation);
  const source = clone(mutated.canonicalTasks[0]);
  source.id = `${source.id}:phase9-extra`;
  source.order = Math.max(...mutated.canonicalTasks.map((task) => task.order)) + 1;
  source.intent = "impact_assessment";
  source.inquiryTypes = ["risk_assessment"];
  source.primarySubjectIds = [`phase9:subject:${source.order}`];
  source.supportingSubjectIds = [];
  source.canonicalObjectIds = [`phase9:object:${source.order}`];
  source.requirements = [{ id: `${source.id}:req`, capability: "risk_context", subjectIds: source.primarySubjectIds, relation: "phase9_risk_context", stateType: "static" }];
  source.requiredCapabilities = ["risk_context"];
  source.expectedDeliverableType = "risk_summary";
  mutated.canonicalTasks.push(source);
  return { simulation: mutated };
}

function removeDistinctTask(simulation) {
  const mutated = clone(simulation);
  mutated.canonicalTasks = mutated.canonicalTasks.slice(0, -1);
  return { simulation: mutated };
}

function addCorrelation(simulation) {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks[0];
  const extra = mutated.planningEvidenceRegistry.find((asset) => !task.selectedEvidenceAssetIds.includes(asset.id));
  if (extra) task.selectedEvidenceAssetIds.push(extra.id);
  task.requirements.push({ id: `${task.id}:phase9-corr`, capability: task.requiredCapabilities[0] || "timeline_context", subjectIds: task.primarySubjectIds.slice(0, 1), relation: "phase9_cross_source_confirmation", stateType: "historical_reconstruction" });
  return { simulation: mutated };
}

function removeCorrelation(simulation) {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks.find((item) => item.selectedEvidenceAssetIds.length > 1) || mutated.canonicalTasks[0];
  task.selectedEvidenceAssetIds = task.selectedEvidenceAssetIds.slice(0, 1);
  task.requirements = task.requirements.filter((requirement) => !requirement.relation);
  return { simulation: mutated };
}

function fragmentEvidence(simulation, assets) {
  const mutated = clone(simulation);
  const mutatedAssets = clone(assets);
  const task = mutated.canonicalTasks[0];
  const source = mutated.planningEvidenceRegistry.find((asset) => task.selectedEvidenceAssetIds.includes(asset.id));
  const rendered = mutatedAssets.find((asset) => asset.file_path === source?.path) || mutatedAssets[0];
  for (let index = 0; index < 3; index += 1) {
    const id = `${source.id}:fragment:${index}`;
    const filePath = `${source.path}.fragment${index}.txt`;
    mutated.planningEvidenceRegistry.push({ ...clone(source), id, path: filePath });
    mutated.evidenceRegistry.push({ ...clone(source), id, path: filePath });
    mutatedAssets.push({ ...clone(rendered), file_path: filePath, file_name: path.basename(filePath) });
    task.selectedEvidenceAssetIds.push(id);
  }
  return { simulation: mutated, assets: mutatedAssets };
}

function consolidateEvidence(simulation) {
  const mutated = clone(simulation);
  for (const task of mutated.canonicalTasks) task.selectedEvidenceAssetIds = task.selectedEvidenceAssetIds.slice(0, 1);
  return { simulation: mutated };
}

function addNoise(assets, count, token = "routine non-incident line") {
  const mutated = clone(assets);
  mutated[0].content += "\n" + Array.from({ length: count }, (_, index) => `2026-07-06 00:01:${String(index % 60).padStart(2, "0")} ${token} ${index}`).join("\n");
  return mutated;
}

function addNoiseOnlySubject(simulation) {
  const mutated = clone(simulation);
  mutated.evidenceRegistry.push({
    ...(mutated.evidenceRegistry[0] || {}),
    id: "phase9:noise-only:evidence",
    path: "assets/logs/phase9_noise_only.log",
    canonicalObjectIds: ["identity:phase9-noise-only"],
    capabilities: ["timeline_context"],
    support: "context",
  });
  return { simulation: mutated };
}

function addRelevantSubjectRelationship(simulation) {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks[0];
  const subject = "identity:phase9-extra-subject";
  task.primarySubjectIds.push(subject);
  task.requirements.push({ id: `${task.id}:phase9-subject`, capability: task.requiredCapabilities[0] || "actor_attribution", subjectIds: [subject], relation: "phase9_subject_relationship", stateType: "static_document" });
  return { simulation: mutated };
}

function addTimeline(simulation) {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks[0];
  task.requiredCapabilities = Array.from(new Set([...task.requiredCapabilities, "timeline_exact"]));
  return { simulation: mutated };
}

function removeTimeline(simulation) {
  const mutated = clone(simulation);
  for (const task of mutated.canonicalTasks) task.requiredCapabilities = task.requiredCapabilities.filter((capability) => capability !== "timeline_exact");
  return { simulation: mutated };
}

function addUncertainty(simulation) {
  const mutated = clone(simulation);
  mutated.canonicalTasks[0].intent = "impact_assessment";
  mutated.canonicalTasks[0].inquiryTypes = Array.from(new Set([...(mutated.canonicalTasks[0].inquiryTypes || []), "risk_assessment"]));
  return { simulation: mutated };
}

function removeUncertainty(simulation) {
  const mutated = clone(simulation);
  for (const task of mutated.canonicalTasks) task.inquiryTypes = (task.inquiryTypes || []).filter((type) => type !== "risk_assessment");
  return { simulation: mutated };
}

function addRemediation(simulation, type = "containment_plan") {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks[0];
  task.intent = "containment_recommendation";
  task.inquiryTypes = Array.from(new Set([...(task.inquiryTypes || []), "remediation_or_containment"]));
  task.expectedDeliverableType = type;
  return { simulation: mutated };
}

function removeRemediation(simulation) {
  const mutated = clone(simulation);
  for (const task of mutated.canonicalTasks) {
    task.inquiryTypes = (task.inquiryTypes || []).filter((type) => type !== "remediation_or_containment" && type !== "risk_assessment");
    if (task.expectedDeliverableType === "containment_plan" || task.expectedDeliverableType === "risk_summary") task.expectedDeliverableType = "evidence_notes";
    if (task.intent === "containment_recommendation" || task.intent === "risk_assessment" || task.intent === "impact_assessment") task.intent = "command_process";
  }
  return { simulation: mutated };
}

function increaseDeliverable(simulation) {
  const mutated = clone(simulation);
  mutated.canonicalTasks[0].expectedDeliverableType = "containment_plan";
  return { simulation: mutated };
}

function duplicateTask(simulation) {
  const mutated = clone(simulation);
  const copy = clone(mutated.canonicalTasks[0]);
  copy.id = `${copy.id}:duplicate`;
  copy.order = Math.max(...mutated.canonicalTasks.map((task) => task.order)) + 1;
  mutated.canonicalTasks.push(copy);
  return { simulation: mutated };
}

function directLine(simulation) {
  const mutated = clone(simulation);
  for (const task of mutated.canonicalTasks) {
    task.selectedEvidenceAssetIds = task.selectedEvidenceAssetIds.slice(0, 1);
    task.requirements = task.requirements.slice(0, 1);
    task.requiredCapabilities = task.requiredCapabilities.slice(0, 1);
  }
  return { simulation: mutated };
}

function missingEvidence(simulation) {
  const mutated = clone(simulation);
  mutated.canonicalTasks[0].selectedEvidenceAssetIds = [];
  return { simulation: mutated };
}

function mutationCases(modules, candidate) {
  const base = estimate(modules, candidate.simulation, candidate.assets);
  const specs = [
    ["add_distinct_task", addDistinctTask, "increase"],
    ["remove_distinct_task", removeDistinctTask, "decrease"],
    ["add_correlation", addCorrelation, "increase"],
    ["remove_correlation", removeCorrelation, "decrease"],
    ["fragment_evidence", (sim, assets) => fragmentEvidence(sim, assets), "increase"],
    ["consolidate_evidence", consolidateEvidence, "decrease"],
    ["add_bounded_noise", (sim, assets) => ({ assets: addNoise(assets, 120) }), "increase"],
    ["add_massive_repetitive_noise", (sim, assets) => ({ assets: addNoise(assets, 3000) }), "increase"],
    ["add_unrelated_noise_only_subject", addNoiseOnlySubject, "flat"],
    ["add_relevant_subject_and_relationship", addRelevantSubjectRelationship, "increase"],
    ["add_timeline_reconstruction", addTimeline, "increase"],
    ["remove_timeline_reconstruction", removeTimeline, "decrease"],
    ["add_uncertainty", addUncertainty, "increase"],
    ["remove_uncertainty", removeUncertainty, "decrease"],
    ["add_remediation", addRemediation, "no_duplicate"],
    ["remove_remediation", removeRemediation, "decrease"],
    ["increase_deliverable_complexity", increaseDeliverable, "increase"],
    ["add_duplicate_task", duplicateTask, "blocked"],
    ["introduce_shared_work", duplicateTask, "blocked"],
    ["replace_multi_source_proof_with_one_direct_line", directLine, "decrease"],
    ["remove_task_local_evidence", missingEvidence, "blocked"],
  ];
  const records = specs.map(([name, mutate, expectedDirection]) => {
    let baselineEstimate = base;
    let startingSimulation = candidate.simulation;
    if (name === "remove_timeline_reconstruction") {
      startingSimulation = addTimeline(candidate.simulation).simulation;
      baselineEstimate = estimate(modules, startingSimulation, candidate.assets);
    }
    if (name === "remove_uncertainty") {
      startingSimulation = addUncertainty(candidate.simulation).simulation;
      baselineEstimate = estimate(modules, startingSimulation, candidate.assets);
    }
    if (name === "remove_remediation") {
      startingSimulation = addRemediation(candidate.simulation).simulation;
      baselineEstimate = estimate(modules, startingSimulation, candidate.assets);
    }
    const mutation = mutate(startingSimulation, candidate.assets);
    const simulation = mutation.simulation || candidate.simulation;
    const assets = mutation.assets || candidate.assets;
    let mutated = null;
    try {
      mutated = estimate(modules, simulation, assets);
    } catch (_) {
      mutated = baselineEstimate;
    }
    const validation = check(modules, simulation, assets, "Advanced", 60);
    return mutationRecord(name, baselineEstimate, mutated, validation, expectedDirection);
  });
  const hidden = removeRemediation(candidate.simulation).simulation;
  const hiddenEstimate = estimate(modules, hidden, candidate.assets);
  const required = requiredRemediationConcepts(modules, hidden);
  const forgedReport = modules.workload.evaluateLinuxWorkloadContract({
    estimate: {
      ...hiddenEstimate,
      dimensions: { ...hiddenEstimate.dimensions, remediationReasoning: 0 },
      metrics: { ...hiddenEstimate.metrics, remediationActionCount: 0 },
    },
    simulation: hidden,
    assets: candidate.assets,
    requestedDifficulty: "Advanced",
    requestedDurationMinutes: 60,
  });
  records.push({
    mutation: "hide_remediation_recognition_while_contract_requires_it",
    baselineEstimate: base.estimatedDurationMinutes,
    mutatedEstimate: forgedReport.estimatedDurationMinutes,
    delta: Number((forgedReport.estimatedDurationMinutes - base.estimatedDurationMinutes).toFixed(2)),
    baselineDimensions: base.dimensions,
    mutatedDimensions: forgedReport.dimensions,
    changedDimensions: dimensionDelta(base, forgedReport),
    requiresRemediation: required.length > 0,
    requiredRemediationConcepts: required,
    remediationDimension: forgedReport.dimensions.remediationReasoning,
    remediationActionCount: forgedReport.metrics.remediationActionCount,
    workloadIssueCodes: forgedReport.issues.map((issue) => issue.code),
    finalQualityResult: forgedReport.issues.some((issue) => issue.code === "LINUX_WORKLOAD_REMEDIATION_UNCOUNTED") ? "rejected" : "accepted",
    expectedDirection: "blocked",
    actualDirection: "decrease",
    directionAssertionPassed: required.length > 0 && forgedReport.dimensions.remediationReasoning === 0 && forgedReport.issues.some((issue) => issue.code === "LINUX_WORKLOAD_REMEDIATION_UNCOUNTED"),
  });
  records.push(forgedRemediationValidationRecord(modules, "required_concept_zero_effort", candidate, (draft) => {
    draft.dimensions.remediationReasoning = 0;
    draft.metrics.remediationActionCount = 0;
    for (const task of draft.taskEstimates) task.remediationActions = [];
    return draft;
  }));
  records.push(forgedRemediationValidationRecord(modules, "required_concept_token_cost_001", candidate, (draft) => {
    const action = draft.taskEstimates.flatMap((task) => task.remediationActions || [])[0];
    if (action) action.costMinutes = 0.01;
    draft.dimensions.remediationReasoning = 0.01;
    return draft;
  }));
  records.push(forgedRemediationValidationRecord(modules, "required_concept_token_cost_005", candidate, (draft) => {
    const action = draft.taskEstimates.flatMap((task) => task.remediationActions || [])[0];
    if (action) action.costMinutes = 0.05;
    draft.dimensions.remediationReasoning = 0.05;
    return draft;
  }));
  records.push(forgedRemediationValidationRecord(modules, "required_concept_without_learner_action", candidate, (draft) => {
    for (const task of draft.taskEstimates) task.remediationActions = [];
    draft.metrics.remediationActionCount = 0;
    return draft;
  }));
  records.push(forgedRemediationValidationRecord(modules, "learner_action_absent_from_deliverable", candidate, (draft) => {
    const task = draft.taskEstimates.find((item) => (item.remediationActions || []).length > 0);
    if (task) task.expectedActions = task.expectedActions.filter((action) => !(task.remediationActions || []).some((remediation) => remediation.action === action));
    return draft;
  }));
  records.push(forgedRemediationValidationRecord(modules, "duplicate_metadata_paths_double_charge_same_action", candidate, (draft) => {
    const task = draft.taskEstimates.find((item) => (item.remediationActions || []).length > 0);
    if (task) {
      const duplicate = clone(task.remediationActions[0]);
      task.remediationActions.push(duplicate);
      draft.metrics.remediationActionCount += 1;
      draft.dimensions.remediationReasoning = Number((draft.dimensions.remediationReasoning + duplicate.costMinutes).toFixed(2));
      draft.estimatedDurationMinutes = Number((draft.estimatedDurationMinutes + duplicate.costMinutes).toFixed(2));
      draft.totalEffortPoints = Number((draft.totalEffortPoints + duplicate.costMinutes).toFixed(2));
    }
    return draft;
  }));
  records.push(forgedRemediationValidationRecord(modules, "forged_remediation_dimension", candidate, (draft) => {
    draft.dimensions.remediationReasoning = 0.4;
    draft.estimatedDurationMinutes = Number((draft.estimatedDurationMinutes - 0.9).toFixed(2));
    return draft;
  }));
  return records;
}

function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Number(mean(values).toFixed(2)),
    median: median(values),
    range: Number((sorted[sorted.length - 1] - sorted[0]).toFixed(2)),
  };
}

function multiSeedRuns(modules) {
  return MULTI_SEED_GROUPS.map(([difficulty, family, duration]) => {
    const rootBases = Array.from({ length: 10 }, (_, index) => `phase9c-multiseed:${difficulty}:${family}:${index}`);
    const runs = rootBases.map((rootBase) => {
      let candidate = null;
      let selectedSeed = "";
      let forcedFamilySelectionAttempts = 0;
      let lastError = "";
      for (let search = 0; search < 50; search += 1) {
        const seed = `${rootBase}:candidate:${search}`;
        try {
          candidate = buildCandidate(modules, difficulty, family, seed, { duration });
          selectedSeed = seed;
          forcedFamilySelectionAttempts = search;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (!candidate) {
        return {
          rootSeed: rootBase,
          selectedSeed: "",
          firstRawEstimate: null,
          firstRawIssueCodes: [],
          attempts: [],
          acceptedAttempt: null,
          acceptedEstimate: null,
          noCandidateAccepted: true,
          forcedFamilySelectionAttempts: 50,
          workloadRejectedAttempts: 0,
          fixtureSelectionFailure: lastError,
        };
      }
      const attempts = candidate.phase9AttemptTrace || [];
      const accepted = attempts.find((attempt) => attempt.accepted);
      return {
        rootSeed: rootBase,
        selectedSeed,
        firstRawEstimate: attempts.find((attempt) => Number.isFinite(attempt.estimatedDuration))?.estimatedDuration ?? null,
        firstRawIssueCodes: attempts.find((attempt) => Number.isFinite(attempt.estimatedDuration))?.issueCodes || [],
        attempts,
        acceptedAttempt: accepted?.attempt ?? null,
        acceptedEstimate: accepted?.estimatedDuration ?? null,
        noCandidateAccepted: !accepted,
        forcedFamilySelectionAttempts,
        workloadRejectedAttempts: attempts.filter((attempt) => !attempt.accepted && attempt.issueCodes.some((code) => /^LINUX_WORKLOAD_/.test(code))).length,
      };
    });
    return {
      difficulty,
      family,
      duration,
      rootSeeds: runs.map((run) => run.selectedSeed || run.rootSeed),
      runs,
      rawFirstCandidateAcceptanceRate: Number((runs.filter((run) => run.attempts[0]?.accepted).length / runs.length).toFixed(3)),
      finalAcceptanceRate: Number((runs.filter((run) => !run.noCandidateAccepted).length / runs.length).toFixed(3)),
      underloadedRawCandidates: runs.filter((run) => run.firstRawIssueCodes.includes("LINUX_WORKLOAD_DURATION_UNDER_TARGET")).length,
      overloadedRawCandidates: runs.filter((run) => run.firstRawIssueCodes.includes("LINUX_WORKLOAD_DURATION_OVER_TARGET")).length,
      otherQualityRejectedCandidates: runs.flatMap((run) => run.attempts).filter((attempt) => !attempt.accepted && !attempt.issueCodes.some((code) => /^LINUX_WORKLOAD_/.test(code))).length,
      acceptedAfterWorkloadRetry: runs.filter((run) => run.acceptedAttempt && run.workloadRejectedAttempts > 0).length,
      failedAfterMaximumRetries: runs.filter((run) => run.noCandidateAccepted).length,
      estimateStats: stats(runs.map((run) => run.acceptedEstimate).filter(Number.isFinite)),
    };
  });
}

function finalNarrative(modules, candidate) {
  const contract = modules.simulation.buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
  const registryById = new Map(candidate.simulation.planningEvidenceRegistry.map((asset) => [asset.id, asset]));
  const uncertaintyText = {
    account_use_not_human_operator: "Account use does not identify the human operator and requires owner validation.",
    excessive_sudo_not_malicious_intent: "Sudo authorization does not prove malicious intent or attacker identity.",
    exact_ssh_key_may_be_unavailable: "Key fingerprint evidence may be unavailable; document the key provenance gap.",
    local_staging_not_exfiltration: "Local staging does not prove exfiltration or that data left the host.",
    current_state_not_historical_transition: "Current state does not prove a historical transition or restart.",
    scheduled_execution_not_malicious_intent: "Cron scheduled execution does not prove malicious intent.",
    package_install_not_repository_compromise: "Package install does not prove repository compromise without provenance.",
    log_gap_limits_confidence: "Log gap limits confidence and requires secondary source validation.",
    outbound_session_not_attacker_identity: "Outbound connection does not identify an attacker or human operator.",
    container_mount_not_full_host_compromise: "Docker container mount does not prove full host compromise or scope.",
  };
  const remediationText = {
    narrow_sudo_rule: "Recommend least-privilege action to narrow the sudo rule after evidence review.",
    rotate_or_restrict_ssh_key: "Recommend rotating or restricting the SSH key and source restrictions.",
    validate_account_purpose: "Recommend validating account purpose, shell, credential owner, and access need.",
    disable_scheduled_task_after_capture: "Preserve evidence, then disable the scheduled cron task if unsupported.",
    preserve_and_disable_unit: "Preserve the systemd unit and disable the service after capture if unsupported.",
    verify_package_provenance_or_rollback: "Verify package provenance and prepare package rollback if not approved.",
    quarantine_staged_data_and_validate_transfer: "Quarantine staged archive data and validate transfer telemetry.",
    restore_logging_and_preserve_secondary_sources: "Restore logging and preserve journal or audit secondary sources.",
    contain_process_and_review_egress: "Contain the process and review egress network exposure.",
    harden_container_runtime_boundary: "Harden the Docker container runtime boundary, mounts, and group access.",
  };
  const coverage = modules.incidentCoverage.LINUX_INCIDENT_INVESTIGATION_CONTRACTS[candidate.investigation.incidentFamily]
    ?.difficultyRequirements?.[candidate.simulation.canonicalTasks[0].difficulty.toLowerCase()];
  const coverageText = [
    ...(coverage?.requiredUncertaintyBoundaries || []).map((item) => uncertaintyText[item]).filter(Boolean),
    ...(coverage?.requiredRemediationConcepts || []).map((item) => remediationText[item]).filter(Boolean),
  ].join(" ");
  const descriptions = [
    "Correlate account activity evidence without naming an attacker or root cause.",
    "Review network exposure evidence and keep source attribution bounded to rendered records.",
    "Correlate command and process evidence across the selected package, process, and timestamped records.",
    "Compare file ownership, mode, mount, and access evidence without expanding scope beyond the host evidence.",
    "Review configuration baseline evidence for Docker boundary context and documented change scope.",
    coverageText || "Document bounded risk, uncertainty, and next validation actions from task-local evidence.",
    coverageText || "Prepare supported containment notes and preserve evidence before any change.",
  ];
  const deliverables = [
    `Account activity correlation table with cited evidence. ${coverageText}`,
    `Network exposure summary with bounded source statements. ${coverageText}`,
    `Command and process lineage notes with evidence references. ${coverageText}`,
    `File and mount boundary comparison with uncertainty. ${coverageText}`,
    `Configuration baseline mapping against supplied records. ${coverageText}`,
    `Risk summary including required uncertainty boundaries. ${coverageText}`,
    `Containment recommendation covering Docker runtime boundary hardening. ${coverageText}`,
  ];
  const tasks = candidate.simulation.canonicalTasks.slice().sort((left, right) => left.order - right.order).map((task) => ({
    task_id: task.id,
    task_intent: task.intent,
    phase: task.stepLabel || task.intent.replace(/_/g, " "),
    title: `${task.stepLabel || task.intent.replace(/_/g, " ")} evidence review`,
    evidence: task.selectedEvidenceAssetIds.map((id) => registryById.get(id)?.path).filter(Boolean),
    description: descriptions[Math.max(0, task.order - 1)] || descriptions[0],
    deliverable: deliverables[Math.max(0, task.order - 1)] || `Write a bounded finding for ${task.intent.replace(/_/g, " ")} using only the listed evidence.`,
    claims: [],
  }));
  return modules.assembly.finalLinuxNarrativeFromAssembled({
    lab: modules.assembly.buildLinuxAssembledNarrative({
      contract,
      context: candidate.investigation,
      difficulty: "Advanced",
      duration: "60 mins",
      tasks,
    }),
  });
}

async function routeBoundaryCases(modules) {
  const candidate = buildCandidate(modules, "Advanced", "cron_persistence", "phase8-matrix:Advanced:cron_persistence:0", {
    title: "Phase 9C route boundary",
    generationTime: "2026-07-29T11:30:00.000Z",
  });
  const lab = finalNarrative(modules, candidate);
  const base = {
    context: candidate.investigation,
    assets: candidate.assets,
    simulation: candidate.simulation,
    lab,
    provenance: candidate.provenance,
    deterministicHashes: candidate.deterministicHashes,
  };
  const tokenCostEstimate = modules.workload.estimateLinuxLearnerWorkload({
    simulation: base.simulation,
    assets: base.assets,
  });
  const tokenAction = tokenCostEstimate.taskEstimates.flatMap((task) => task.remediationActions || [])[0];
  if (tokenAction) tokenAction.costMinutes = 0.05;
  const originalTokenRemediation = tokenCostEstimate.dimensions.remediationReasoning;
  tokenCostEstimate.dimensions.remediationReasoning = 0.05;
  tokenCostEstimate.metrics.remediationActionCount = tokenAction ? 1 : 0;
  tokenCostEstimate.estimatedDurationMinutes = Number((tokenCostEstimate.estimatedDurationMinutes - originalTokenRemediation + 0.05).toFixed(2));
  tokenCostEstimate.totalEffortPoints = Number((tokenCostEstimate.totalEffortPoints - originalTokenRemediation + 0.05).toFixed(2));
  const tokenCostReport = modules.workload.evaluateLinuxWorkloadContract({
    estimate: tokenCostEstimate,
    simulation: base.simulation,
    assets: base.assets,
    requestedDifficulty: base.provenance.difficulty,
    requestedDurationMinutes: base.provenance.durationMinutes,
  });
  const tokenCostHashes = {
    ...base.deterministicHashes,
    workloadEstimateHash: modules.workload.linuxWorkloadEstimateHash(tokenCostEstimate),
    workloadReportHash: modules.workload.linuxWorkloadReportHash(tokenCostReport),
  };
  const cases = [
    ["valid_final_lab", 1, () => base],
    ["underloaded_lab", 0, () => ({ ...base, simulation: { ...clone(base.simulation), canonicalTasks: clone(base.simulation.canonicalTasks).slice(0, 1) } })],
    ["overloaded_lab", 0, () => {
      const simulation = clone(base.simulation);
      simulation.canonicalTasks = simulation.canonicalTasks.concat(clone(simulation.canonicalTasks).map((task, index) => ({ ...task, id: `${task.id}:over:${index}`, order: task.order + 20 })));
      return { ...base, simulation };
    }],
    ["forged_passing_report", 0, () => ({ ...base, deterministicHashes: { ...base.deterministicHashes, workloadReportHash: "f".repeat(64) } })],
    ["tasks_mutated_after_validation", 0, () => ({ ...base, simulation: { ...clone(base.simulation), canonicalTasks: clone(base.simulation.canonicalTasks).slice(0, -1) } })],
    ["evidence_mutated_after_validation", 0, () => ({ ...base, assets: clone(base.assets).slice(0, -1) })],
    ["deliverable_mutated_after_validation", 0, () => ({ ...base, lab: { ...clone(base.lab), tasks: clone(base.lab.tasks).map((task, index) => index === 0 ? { ...task, deliverable: "Prove the attacker and root cause without additional validation." } : task) } })],
    ["remediation_requirement_mutated", 0, () => {
      const simulation = clone(base.simulation);
      simulation.canonicalTasks = simulation.canonicalTasks.map((task) => ({ ...task, inquiryTypes: (task.inquiryTypes || []).filter((type) => type !== "remediation_or_containment" && type !== "risk_assessment"), expectedDeliverableType: "evidence_notes" }));
      return { ...base, simulation };
    }],
    ["missing_remediation_workload", 0, () => {
      const simulation = clone(base.simulation);
      simulation.canonicalTasks = [];
      return { ...base, simulation };
    }],
    ["token_remediation_cost_route_attempt", 0, () => ({ ...base, deterministicHashes: tokenCostHashes })],
    ["estimate_hash_tampered", 0, () => ({ ...base, deterministicHashes: { ...base.deterministicHashes, workloadEstimateHash: "e".repeat(64) } })],
    ["report_hash_tampered", 0, () => ({ ...base, deterministicHashes: { ...base.deterministicHashes, workloadReportHash: "r".repeat(64) } })],
    ["requested_duration_tampered", 0, () => ({ ...base, provenance: { ...base.provenance, durationMinutes: 30 } })],
    ["requested_difficulty_tampered", 0, () => ({ ...base, provenance: { ...base.provenance, difficulty: "Beginner" } })],
  ];
  const rows = [];
  for (const [name, expectedInsertCalls, makeInput] of cases) {
    const input = makeInput();
    let insertCalls = 0;
    let errorMessage = "";
    let saved = null;
    try {
      const result = await modules.boundary.persistAfterLinuxPreSaveWorkloadBoundary({
        ...input,
        persist: () => {
          insertCalls += 1;
          return {
            id: `saved-${name}`,
            workloadEstimateHash: input.deterministicHashes.workloadEstimateHash,
            workloadReportHash: input.deterministicHashes.workloadReportHash,
          };
        },
      });
      saved = result.saved;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    const recalculated = modules.workload.checkLinuxLabWorkload({
      simulation: input.simulation,
      assets: input.assets,
      requestedDifficulty: input.provenance?.difficulty,
      requestedDurationMinutes: input.provenance?.durationMinutes,
      expectedWorkloadEstimateHash: input.deterministicHashes?.workloadEstimateHash,
      expectedWorkloadReportHash: input.deterministicHashes?.workloadReportHash,
    });
    rows.push({
      case: name,
      expectedInsertCalls,
      persistenceCallCount: insertCalls,
      passed: insertCalls === expectedInsertCalls,
      workloadValidationCodes: recalculated.issues.map((issue) => issue.code),
      otherValidationCodes: errorMessage ? errorMessage.match(/LINUX_[A-Z0-9_]+/g) || [] : [],
      recalculatedEstimateHash: recalculated.workloadEstimateHash,
      recalculatedReportHash: recalculated.workloadReportHash,
      storedHashes: saved ? { workloadEstimateHash: saved.workloadEstimateHash, workloadReportHash: saved.workloadReportHash } : null,
      savedHashEquality:
        saved ? saved.workloadEstimateHash === recalculated.workloadEstimateHash && saved.workloadReportHash === recalculated.workloadReportHash : null,
      errorMessage,
    });
  }
  return rows;
}

function scanEncoding() {
  const roots = [
    path.join(ROOT, "lib", "lab-assets", "linux", "workloadCalibration.ts"),
    path.join(ROOT, "lib", "lab-assets", "linux", "preSaveWorkloadBoundary.ts"),
    path.join(ROOT, "tests", "linux-quality", "linuxPhase9AuditUtils.js"),
    path.join(ROOT, "tests", "linux-quality", "runLinuxPhase9WorkloadAudit.js"),
    path.join(ROOT, "tests", "linux-quality", "runLinuxPhase9WorkloadBehaviorTests.js"),
    path.join(ROOT, "tests", "linux-quality", "runLinuxPhase9WorkloadCalibrationTests.js"),
    path.join(ROOT, "tests", "linux-quality", "runLinuxPhase9WorkloadIndependenceTests.js"),
    path.join(ROOT, "tests", "linux-quality", "runLinuxPhase9WorkloadRouteBoundaryTests.js"),
    path.join(ROOT, "tests", "linux-quality", "runLinuxPhase9WorkloadSensitivityTests.js"),
  ];
  const files = [];
  const walk = (target) => {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      if (/\.(ts|tsx|js|mjs|cjs)$/.test(target)) files.push(target);
      return;
    }
    for (const entry of fs.readdirSync(target)) walk(path.join(target, entry));
  };
  roots.forEach(walk);
  const patterns = [
    String.fromCodePoint(0x00c3, 0x00a2, 0x00e2, 0x201a, 0x00ac, 0x00e2, 0x20ac, 0x0153),
    String.fromCodePoint(0x00c3, 0x00a2, 0x00e2, 0x201a, 0x00ac, 0x00e2, 0x20ac),
    String.fromCodePoint(0x00c3, 0x00a2, 0x00e2, 0x201a, 0x00ac, 0x00e2, 0x20ac, 0x017e, 0x00a2),
    String.fromCodePoint(0x00c3, 0x00af, 0x00c2, 0x00bf, 0x00c2, 0x00bd),
    String.fromCodePoint(0x00ef, 0x00bf, 0x00bd),
    String.fromCodePoint(0xfffd),
  ];
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      if (patterns.some((pattern) => line.includes(pattern))) {
        hits.push({ file: path.relative(ROOT, file), line: index + 1, text: line });
      }
    });
  }
  return hits;
}

function assertionCounter() {
  const summary = {
    suitesExecuted: [],
    testCasesExecuted: 0,
    assertionsExecuted: 0,
    casesPassed: 0,
    casesFailed: 0,
    casesSkipped: 0,
    skipReasons: [],
    compiledOutRequired: true,
    outPath: "",
  };
  return {
    summary,
    assert(name, condition, details = "") {
      summary.assertionsExecuted += 1;
      summary.testCasesExecuted += 1;
      if (!condition) {
        summary.casesFailed += 1;
        throw new Error(`${name}${details ? `: ${details}` : ""}`);
      }
      summary.casesPassed += 1;
      console.log(`PASS ${name}`);
    },
  };
}

function writeAuditArtifact(artifact) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  fs.writeFileSync(AUDIT_FILE, `${JSON.stringify(artifact, null, 2)}\n`);
}

module.exports = {
  ROOT,
  AUDIT_FILE,
  VERSION,
  MATRIX,
  MULTI_SEED_GROUPS,
  compileIfNeeded,
  loadModules,
  buildCandidate,
  matrixRow,
  aggregateRows,
  multiSeedRuns,
  mutationCases,
  routeBoundaryCases,
  scanEncoding,
  assertionCounter,
  writeAuditArtifact,
};
