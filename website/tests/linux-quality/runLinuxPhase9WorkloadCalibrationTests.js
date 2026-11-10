#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const GENERATION_TIME = "2026-07-29T09:00:00.000Z";
const OUTPUT_DIR = path.join(ROOT, ".tmp", "linux-phase9-workload");

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
  ["Intermediate", "misconfigured_sudoers", "phase8-matrix:Intermediate:misconfigured_sudoers:0"],
  ["Intermediate", "ssh_bruteforce", "phase8-matrix:Intermediate:ssh_bruteforce:0"],
  ["Intermediate", "service_account_misuse", "phase8-matrix:Intermediate:service_account_misuse:1"],
  ["Intermediate", "ssh_key_compromise", "phase8-matrix:Intermediate:ssh_key_compromise:0"],
  ["Intermediate", "cron_persistence", "phase8-matrix:Intermediate:cron_persistence:0"],
  ["Intermediate", "systemd_persistence", "phase8-matrix:Intermediate:systemd_persistence:0"],
  ["Intermediate", "unauthorized_package_install", "phase8-matrix:Intermediate:unauthorized_package_install:0"],
  ["Intermediate", "data_staging", "phase8-matrix:Intermediate:data_staging:1"],
  ["Intermediate", "log_tampering", "phase8-matrix:Intermediate:log_tampering:5"],
  ["Intermediate", "reverse_shell", "phase8-matrix:Intermediate:reverse_shell:0"],
  ["Intermediate", "docker_compromise", "phase8-matrix:Intermediate:docker_compromise:8"],
  ["Advanced", "misconfigured_sudoers", "phase8-matrix:Advanced:misconfigured_sudoers:0"],
  ["Advanced", "ssh_bruteforce", "phase8-matrix:Advanced:ssh_bruteforce:0"],
  ["Advanced", "service_account_misuse", "phase8-matrix:Advanced:service_account_misuse:0"],
  ["Advanced", "ssh_key_compromise", "phase8-matrix:Advanced:ssh_key_compromise:1"],
  ["Advanced", "cron_persistence", "phase8-matrix:Advanced:cron_persistence:0"],
  ["Advanced", "systemd_persistence", "phase8-matrix:Advanced:systemd_persistence:0"],
  ["Advanced", "unauthorized_package_install", "phase8-matrix:Advanced:unauthorized_package_install:1"],
  ["Advanced", "data_staging", "phase8-matrix:Advanced:data_staging:23"],
  ["Advanced", "log_tampering", "phase8-matrix:Advanced:log_tampering:0"],
  ["Advanced", "reverse_shell", "phase8-matrix:Advanced:reverse_shell:10"],
  ["Advanced", "docker_compromise", "phase8-matrix:Advanced:docker_compromise:1"],
];

const MULTI_SEED = [
  ["Beginner", "ssh_key_compromise", "phase8-matrix:Beginner:ssh_key_compromise:0"],
  ["Beginner", "cron_persistence", "phase8-matrix:Beginner:cron_persistence:0"],
  ["Intermediate", "service_account_misuse", "phase8-matrix:Intermediate:service_account_misuse:1"],
  ["Intermediate", "data_staging", "phase8-matrix:Intermediate:data_staging:1"],
  ["Advanced", "docker_compromise", "phase8-matrix:Advanced:docker_compromise:1"],
  ["Advanced", "cron_persistence", "phase8-matrix:Advanced:cron_persistence:0"],
  ["Advanced", "reverse_shell", "phase8-matrix:Advanced:reverse_shell:10"],
  ["Advanced", "data_staging", "phase8-matrix:Advanced:data_staging:23"],
];

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase9-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}${details ? `: ${details}` : ""}`);
  console.log(`PASS ${name}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requestedDuration(difficulty) {
  return difficulty === "Advanced" ? 60 : 30;
}

function build(modules, difficulty, family, seed, assetAttempt = 1) {
  const attempts = [];
  const candidate = modules.linux.buildLinuxAssetCandidate(
    {
      category: "Linux",
      difficulty,
      duration: `${requestedDuration(difficulty)} mins`,
      title: "Phase 9 workload calibration",
      seed,
      generationTime: GENERATION_TIME,
      assetAttempt,
    },
    {
      incidentFamily: family,
      onAttempt(event) {
        attempts.push({
          attempt: event.attempt,
          accepted: event.accepted,
          reason: event.reason || "",
          estimatedDuration: event.workloadReport?.estimatedDurationMinutes,
          issues: event.issueCodes || event.workloadReport?.issues?.map((issue) => issue.code) || [],
        });
      },
    }
  );
  candidate.phase9AttemptTrace = attempts;
  return candidate;
}

function summarizeMatrixRow(candidate) {
  const report = candidate.assetQuality.workloadReport;
  return {
    difficulty: report.requestedDifficulty,
    family: candidate.investigation.incidentFamily,
    role: candidate.investigation.hostRole,
    requestedDuration: report.requestedDurationMinutes,
    estimatedDuration: report.estimatedDurationMinutes,
    minimum: report.acceptableDurationRange.minimumMinutes,
    maximum: report.acceptableDurationRange.maximumMinutes,
    taskCount: report.metrics.taskCount,
    learnerActionCount: report.metrics.learnerActionCount,
    remediationActionCount: report.metrics.remediationActionCount,
    taskLocalSubjectCount: report.metrics.taskLocalSubjectCount,
    taskLocalRelationshipCount: report.metrics.taskLocalRelationshipCount,
    noiseOnlySubjectCount: report.metrics.noiseOnlySubjectCount,
    evidencePathCount: report.metrics.uniqueEvidencePathCount,
    relevantEvidenceLineCount: report.metrics.relevantEvidenceLineCount,
    distractorEvidenceLineCount: report.metrics.distractorEvidenceLineCount,
    correlationCount: report.metrics.crossFileCorrelationCount,
    workloadDimensions: report.dimensions,
    workloadEstimateHash: candidate.deterministicHashes.workloadEstimateHash,
    workloadReportHash: candidate.deterministicHashes.workloadReportHash,
    finalDeterministicHash: candidate.deterministicHashes.finalDeterministicHash,
    distanceFromMinimum: Number((report.estimatedDurationMinutes - report.acceptableDurationRange.minimumMinutes).toFixed(2)),
    distanceFromMaximum: Number((report.acceptableDurationRange.maximumMinutes - report.estimatedDurationMinutes).toFixed(2)),
    rawFirstCandidate: candidate.phase9AttemptTrace?.[0] || null,
    rawFirstWorkloadCandidate: candidate.phase9AttemptTrace?.find((attempt) => Number.isFinite(attempt.estimatedDuration)) || null,
    retryDistribution: candidate.phase9AttemptTrace || [],
    issues: report.issues.map((issue) => issue.code),
  };
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregates(rows) {
  const result = {};
  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const subset = rows.filter((row) => row.difficulty === difficulty);
    result[difficulty] = {
      minimumEstimatedTime: Math.min(...subset.map((row) => row.estimatedDuration)),
      maximumEstimatedTime: Math.max(...subset.map((row) => row.estimatedDuration)),
      meanEstimatedTime: Number(mean(subset.map((row) => row.estimatedDuration)).toFixed(2)),
      medianEstimatedTime: median(subset.map((row) => row.estimatedDuration)),
      meanTaskCount: Number(mean(subset.map((row) => row.taskCount)).toFixed(2)),
      meanLearnerActionCount: Number(mean(subset.map((row) => row.learnerActionCount)).toFixed(2)),
      meanRemediationActionCount: Number(mean(subset.map((row) => row.remediationActionCount)).toFixed(2)),
      meanTaskLocalSubjectCount: Number(mean(subset.map((row) => row.taskLocalSubjectCount)).toFixed(2)),
      meanTaskLocalRelationshipCount: Number(mean(subset.map((row) => row.taskLocalRelationshipCount)).toFixed(2)),
      meanEvidencePathCount: Number(mean(subset.map((row) => row.evidencePathCount)).toFixed(2)),
      meanRelevantEvidenceVolume: Number(mean(subset.map((row) => row.relevantEvidenceLineCount)).toFixed(2)),
      meanDistractorVolume: Number(mean(subset.map((row) => row.distractorEvidenceLineCount)).toFixed(2)),
      meanCorrelationCount: Number(mean(subset.map((row) => row.correlationCount)).toFixed(2)),
      rejectionReasonCounts: subset.flatMap((row) => row.issues).reduce((acc, code) => {
        acc[code] = (acc[code] || 0) + 1;
        return acc;
      }, {}),
      firstAttemptAcceptanceRate: Number((subset.filter((row) => row.rawFirstCandidate?.accepted).length / Math.max(1, subset.length)).toFixed(3)),
      nearLowerBoundaryCount: subset.filter((row) => row.distanceFromMinimum <= 2).length,
      nearUpperBoundaryCount: subset.filter((row) => row.distanceFromMaximum <= 2).length,
    };
  }
  return result;
}

function expectWorkloadIssue(name, result, code) {
  const codes = result.issues.map((issue) => issue.code);
  assert(name, codes.includes(code), codes.join("|"));
}

function syntheticLab(candidate) {
  return {
    title: `Phase 9 ${candidate.investigation.hostname}`,
    subtitle: `Linux ${candidate.investigation.hostRole} workload calibration`,
    objective: `Review ${candidate.investigation.incidentId} on ${candidate.investigation.hostname}.`,
    scenario: `${candidate.investigation.company} is reviewing ${candidate.investigation.incidentId} for ${candidate.investigation.hostname}, a ${candidate.investigation.hostRole}, during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone}. Reference ${candidate.investigation.ticketId}, ${candidate.investigation.changeId}, and ${candidate.investigation.affectedService}.`,
    difficulty: candidate.simulation.canonicalTasks[0].difficulty,
    duration: `${requestedDuration(candidate.simulation.canonicalTasks[0].difficulty)} mins`,
    tasks: candidate.simulation.canonicalTasks.map((task) => ({
      title: `${task.stepLabel || task.intent} evidence review`,
      description: `Use the selected evidence to complete ${task.intent} for ${candidate.investigation.hostname}.`,
      evidence: task.selectedEvidenceAssetIds.map((id) => candidate.simulation.planningEvidenceRegistry.find((asset) => asset.id === id)?.path).filter(Boolean),
      deliverable: `Provide a bounded finding for ${task.intent}.`,
    })),
    hints: ["Use task-local evidence only."],
    outcomes: ["Produce bounded evidence-backed findings."],
  };
}

function main() {
  const out = compileIfNeeded();
  const modules = {
    linux: require(path.join(out, "linux")),
    workload: require(path.join(out, "linux", "workloadCalibration")),
    replay: require(path.join(out, "linux", "replay")),
    quality: require(path.join(out, "linux", "qualityChecker")),
  };

  const rows = [];
  for (const [difficulty, family, seed] of MATRIX) {
    const candidate = build(modules, difficulty, family, seed);
    const row = summarizeMatrixRow(candidate);
    rows.push(row);
    assert(`${difficulty} ${family} workload accepted`, candidate.assetQuality.passed && row.issues.length === 0, JSON.stringify(row));
    assert(`${difficulty} ${family} expected family`, row.family === family, row.family);
    assert(`${difficulty} ${family} estimated inside band`, row.estimatedDuration >= row.minimum && row.estimatedDuration <= row.maximum, JSON.stringify(row));
    assert(`${difficulty} ${family} workload hash persisted`, Boolean(row.workloadReportHash), JSON.stringify(row));
    assert(`${difficulty} ${family} independent workload hash persisted`, Boolean(row.workloadEstimateHash), JSON.stringify(row));
    assert(`${difficulty} ${family} raw first workload candidate recorded`, row.rawFirstWorkloadCandidate && Number.isFinite(row.rawFirstWorkloadCandidate.estimatedDuration), JSON.stringify(row.retryDistribution));
    assert(`${difficulty} ${family} accepted attempt recorded`, row.retryDistribution.some((attempt) => attempt.accepted), JSON.stringify(row.retryDistribution));
    assert(`${difficulty} ${family} learner actions exceed task count`, row.learnerActionCount > row.taskCount, JSON.stringify(row));
    console.log(`MATRIX ${difficulty}/${family} requested=${row.requestedDuration} estimated=${row.estimatedDuration} range=${row.minimum}-${row.maximum} tasks=${row.taskCount} actions=${row.learnerActionCount} remediation=${row.remediationActionCount} evidence=${row.evidencePathCount} relevant=${row.relevantEvidenceLineCount} distractor=${row.distractorEvidenceLineCount} correlations=${row.correlationCount}`);
  }
  assert("full workload matrix is 33/33", rows.length === 33);

  let multiExact = 0;
  for (const [difficulty, family, seed] of MULTI_SEED) {
    const first = build(modules, difficulty, family, seed);
    const second = build(modules, difficulty, family, seed);
    assert(`${difficulty} ${family} same-seed workload report stable`, JSON.stringify(first.assetQuality.workloadReport) === JSON.stringify(second.assetQuality.workloadReport));
    assert(`${difficulty} ${family} same-seed workload estimate hash stable`, first.deterministicHashes.workloadEstimateHash === second.deterministicHashes.workloadEstimateHash);
    assert(`${difficulty} ${family} same-seed workload hash stable`, first.deterministicHashes.workloadReportHash === second.deterministicHashes.workloadReportHash);
    multiExact += 1;
  }
  assert("multiple-seed workload replay exact rate is 8/8", multiExact === 8);

  const baseline = build(modules, "Advanced", "docker_compromise", "phase8-matrix:Advanced:docker_compromise:1");
  const replayExact = modules.replay.replayLinuxGeneration({
    provenance: baseline.provenance,
    expectedHashes: baseline.deterministicHashes,
    title: "Phase 9 workload calibration",
  });
  assert("replay includes workload exact match", replayExact.status === "exact_match", replayExact.status);
  const legacyHashes = { ...baseline.deterministicHashes };
  delete legacyHashes.workloadReportHash;
  const legacyReplay = modules.replay.replayLinuxGeneration({
    provenance: baseline.provenance,
    expectedHashes: legacyHashes,
    title: "Phase 9 workload calibration",
  });
  assert("legacy hashes without workload are explicit", legacyReplay.status === "legacy_without_workload_hash", legacyReplay.status);
  const tamperedWorkloadHash = modules.replay.replayLinuxGeneration({
    provenance: baseline.provenance,
    expectedHashes: { ...baseline.deterministicHashes, workloadReportHash: "0".repeat(64) },
    title: "Phase 9 workload calibration",
  });
  assert("tampered workload hash mismatches workload layer", tamperedWorkloadHash.status === "mismatch" && tamperedWorkloadHash.mismatchedLayers.includes("workloadReportHash"), JSON.stringify(tamperedWorkloadHash));

  const wallClockA = modules.workload.checkLinuxLabWorkload({ simulation: baseline.simulation, assets: baseline.assets, requestedDifficulty: "Advanced", requestedDurationMinutes: 60 });
  const wallClockB = modules.workload.checkLinuxLabWorkload({ simulation: baseline.simulation, assets: baseline.assets, requestedDifficulty: "Advanced", requestedDurationMinutes: 60 });
  assert("wall-clock independent workload hash", wallClockA.workloadReportHash === wallClockB.workloadReportHash);
  const changedDuration = modules.workload.checkLinuxLabWorkload({ simulation: baseline.simulation, assets: baseline.assets, requestedDifficulty: "Advanced", requestedDurationMinutes: 30 });
  assert("changed duration preserves independent workload hash", changedDuration.workloadEstimateHash === wallClockA.workloadEstimateHash);
  assert("changed duration changes workload hash", changedDuration.workloadReportHash !== wallClockA.workloadReportHash);
  const changedDifficulty = modules.workload.checkLinuxLabWorkload({ simulation: baseline.simulation, assets: baseline.assets, requestedDifficulty: "Beginner", requestedDurationMinutes: 30 });
  assert("changed difficulty preserves independent workload hash", changedDifficulty.workloadEstimateHash === wallClockA.workloadEstimateHash);
  assert("changed difficulty changes workload hash", changedDifficulty.workloadReportHash !== wallClockA.workloadReportHash);

  const difficultyMismatch = clone(baseline.simulation);
  difficultyMismatch.canonicalTasks = difficultyMismatch.canonicalTasks.map((task) => ({ ...task, difficulty: "Beginner" }));
  expectWorkloadIssue("difficulty mismatch detected", modules.workload.checkLinuxLabWorkload({ simulation: difficultyMismatch, assets: baseline.assets, requestedDifficulty: "Advanced", requestedDurationMinutes: 60 }), "LINUX_WORKLOAD_DIFFICULTY_MISMATCH");

  const simTaskOverload = clone(baseline.simulation);
  simTaskOverload.canonicalTasks = [...simTaskOverload.canonicalTasks, ...simTaskOverload.canonicalTasks.slice(0, 2).map((task, index) => ({ ...clone(task), id: `${task.id}:dup:${index}`, order: 20 + index }))];
  expectWorkloadIssue("excessive task count detected", modules.workload.checkLinuxLabWorkload({ simulation: simTaskOverload, assets: baseline.assets, requestedDifficulty: "Beginner", requestedDurationMinutes: 30 }), "LINUX_WORKLOAD_TASK_OVERLOAD");

  const simInsufficient = clone(baseline.simulation);
  simInsufficient.canonicalTasks = simInsufficient.canonicalTasks.slice(0, 1);
  expectWorkloadIssue("insufficient Advanced depth detected", modules.workload.checkLinuxLabWorkload({ simulation: simInsufficient, assets: baseline.assets, requestedDifficulty: "Advanced", requestedDurationMinutes: 60 }), "LINUX_WORKLOAD_INSUFFICIENT_DEPTH");

  const noisyAssets = baseline.assets.concat({ file_path: "assets/logs/noise_padding.log", file_name: "noise_padding.log", file_type: "log", content: Array.from({ length: 2000 }, (_, index) => `2026-07-06 00:00:${String(index % 60).padStart(2, "0")} benign repetitive row ${index}`).join("\n") });
  expectWorkloadIssue("noise padding detected", modules.workload.checkLinuxLabWorkload({ simulation: baseline.simulation, assets: noisyAssets, requestedDifficulty: "Advanced", requestedDurationMinutes: 60 }), "LINUX_WORKLOAD_NOISE_PADDING");

  const relevantAssets = clone(baseline.assets);
  const selectedPath = baseline.assetQuality.workloadReport.taskEstimates[0].relevantEvidencePaths[0];
  const target = relevantAssets.find((asset) => asset.file_path === selectedPath);
  target.content += "\n" + Array.from({ length: 700 }, (_, index) => `${baseline.simulation.canonicalTasks[0].primarySubjectIds[0]} repeated relevant row ${index}`).join("\n");
  expectWorkloadIssue("excessive relevant evidence volume detected", modules.workload.checkLinuxLabWorkload({ simulation: baseline.simulation, assets: relevantAssets, requestedDifficulty: "Beginner", requestedDurationMinutes: 30 }), "LINUX_WORKLOAD_EVIDENCE_OVERLOAD");

  const singleLineAdvanced = clone(baseline.simulation);
  singleLineAdvanced.canonicalTasks = singleLineAdvanced.canonicalTasks.slice(0, 5).map((task) => ({ ...task, selectedEvidenceAssetIds: [task.selectedEvidenceAssetIds[0]].filter(Boolean), requirements: task.requirements.slice(0, 1), requiredCapabilities: task.requiredCapabilities.slice(0, 1) }));
  expectWorkloadIssue("single-line Advanced answer detected", modules.workload.checkLinuxLabWorkload({ simulation: singleLineAdvanced, assets: baseline.assets, requestedDifficulty: "Advanced", requestedDurationMinutes: 60 }), "LINUX_WORKLOAD_INSUFFICIENT_DEPTH");

  const noFollowThrough = clone(baseline.simulation);
  noFollowThrough.canonicalTasks = noFollowThrough.canonicalTasks.slice(0, 5).map((task) => ({
    ...task,
    intent: "command_process",
    inquiryTypes: task.inquiryTypes.filter((type) => type !== "risk_assessment" && type !== "remediation_or_containment"),
  }));
  expectWorkloadIssue("missing Advanced remediation or risk follow-through detected", modules.workload.checkLinuxLabWorkload({ simulation: noFollowThrough, assets: baseline.assets, requestedDifficulty: "Advanced", requestedDurationMinutes: 60 }), "LINUX_WORKLOAD_INSUFFICIENT_DEPTH");

  const beginnerOverload = clone(baseline.simulation);
  beginnerOverload.canonicalTasks = beginnerOverload.canonicalTasks.slice(0, 5).map((task) => ({ ...task, difficulty: "Beginner", selectedEvidenceAssetIds: baseline.simulation.planningEvidenceRegistry.slice(0, 8).map((asset) => asset.id) }));
  expectWorkloadIssue("Beginner cross-domain overload detected", modules.workload.checkLinuxLabWorkload({ simulation: beginnerOverload, assets: baseline.assets, requestedDifficulty: "Beginner", requestedDurationMinutes: 30 }), "LINUX_WORKLOAD_CORRELATION_OVERLOAD");

  const duplicateTasks = clone(baseline.simulation);
  duplicateTasks.canonicalTasks[1] = { ...clone(duplicateTasks.canonicalTasks[0]), id: `${duplicateTasks.canonicalTasks[0].id}:copy`, order: 2 };
  expectWorkloadIssue("duplicated task effort detected", modules.workload.checkLinuxLabWorkload({ simulation: duplicateTasks, assets: baseline.assets, requestedDifficulty: "Advanced", requestedDurationMinutes: 60 }), "LINUX_WORKLOAD_DUPLICATED_EFFORT");

  const missingEvidence = clone(baseline.simulation);
  missingEvidence.canonicalTasks[0].selectedEvidenceAssetIds = [];
  expectWorkloadIssue("missing task-local evidence detected", modules.workload.checkLinuxLabWorkload({ simulation: missingEvidence, assets: baseline.assets, requestedDifficulty: "Advanced", requestedDurationMinutes: 60 }), "LINUX_WORKLOAD_REPORT_INVALID");

  const fragmented = clone(baseline.simulation);
  fragmented.canonicalTasks = fragmented.canonicalTasks.map((task) => ({ ...task, selectedEvidenceAssetIds: baseline.simulation.planningEvidenceRegistry.slice(0, 12).map((asset) => asset.id) }));
  expectWorkloadIssue("navigation fragmentation overload detected", modules.workload.checkLinuxLabWorkload({ simulation: fragmented, assets: baseline.assets, requestedDifficulty: "Beginner", requestedDurationMinutes: 30 }), "LINUX_WORKLOAD_NAVIGATION_OVERLOAD");

  const underReport = clone(wallClockA.report);
  underReport.estimatedDurationMinutes = underReport.acceptableDurationRange.minimumMinutes - 1;
  expectWorkloadIssue("duration under target detected", { issues: modules.workload.validateLinuxLabWorkloadReport(underReport, { simulation: baseline.simulation, assets: baseline.assets }) }, "LINUX_WORKLOAD_DURATION_UNDER_TARGET");
  const overReport = clone(wallClockA.report);
  overReport.estimatedDurationMinutes = overReport.acceptableDurationRange.maximumMinutes + 1;
  expectWorkloadIssue("duration over target detected", { issues: modules.workload.validateLinuxLabWorkloadReport(overReport, { simulation: baseline.simulation, assets: baseline.assets }) }, "LINUX_WORKLOAD_DURATION_OVER_TARGET");
  const ambiguousReport = clone(wallClockA.report);
  ambiguousReport.taskEstimates[0].reasons.push("unbounded ambiguity remains");
  expectWorkloadIssue("unbounded ambiguity detected", { issues: modules.workload.validateLinuxLabWorkloadReport(ambiguousReport, { simulation: baseline.simulation, assets: baseline.assets }) }, "LINUX_WORKLOAD_UNBOUNDED_AMBIGUITY");
  const tamperedReport = clone(wallClockA.report);
  tamperedReport.metrics.taskCount += 1;
  expectWorkloadIssue("tampered workload report detected", { issues: modules.workload.validateLinuxLabWorkloadReport(tamperedReport, { simulation: baseline.simulation, assets: baseline.assets }) }, "LINUX_WORKLOAD_REPORT_INVALID");

  const finalBlockedSim = clone(baseline.simulation);
  finalBlockedSim.canonicalTasks = finalBlockedSim.canonicalTasks.slice(0, 1);
  const finalBlocked = modules.quality.checkLinuxFinalProductionQuality({
    context: baseline.investigation,
    assets: baseline.assets,
    simulation: finalBlockedSim,
    lab: syntheticLab(baseline),
    workload: { requestedDifficulty: "Advanced", requestedDurationMinutes: 60 },
  });
  assert("final quality blocks workload failure", !finalBlocked.passed && finalBlocked.issues.some((issue) => issue.description.includes("LINUX_WORKLOAD_INSUFFICIENT_DEPTH")));

  const summary = {
    matrix: rows,
    aggregates: aggregates(rows),
    multipleSeedExact: `${multiExact}/8`,
    negativeMutations: 16,
  };
  writeJson(path.join(OUTPUT_DIR, "summary.json"), summary);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "summary.md"),
    [
      "# Linux Phase 9 Workload Calibration",
      "",
      `Matrix: ${rows.length}/33 accepted.`,
      `Multiple seed replay: ${multiExact}/8.`,
      "",
      "## Aggregates",
      "```json",
      JSON.stringify(summary.aggregates, null, 2),
      "```",
      "",
    ].join("\n")
  );
  console.log(JSON.stringify({ passed: true, matrix: rows.length, multipleSeedExact: multiExact, aggregates: summary.aggregates }, null, 2));
}

main();
