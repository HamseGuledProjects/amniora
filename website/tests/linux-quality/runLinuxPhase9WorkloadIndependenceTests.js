#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(ROOT, ".tmp", "linux-phase9-workload-independence");
const GENERATION_TIME = "2026-07-29T09:30:00.000Z";

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase9-independence-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}${details ? `: ${details}` : ""}`);
  console.log(`PASS ${name}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function build(modules, difficulty, family, seed, duration = difficulty === "Advanced" ? 60 : 30) {
  return modules.linux.buildLinuxAssetCandidate(
    { category: "Linux", difficulty, duration: `${duration} mins`, title: "Phase 9 independence", seed, generationTime: GENERATION_TIME },
    { incidentFamily: family }
  );
}

function buildForFamily(modules, difficulty, family, seed, duration = difficulty === "Advanced" ? 60 : 30) {
  let lastError;
  for (let search = 0; search < 50; search += 1) {
    const actualSeed = `${seed}:candidate:${search}`;
    try {
      return { candidate: build(modules, difficulty, family, actualSeed, duration), seed: actualSeed };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? new Error(`Unable to build ${difficulty}/${family} after deterministic seed search: ${lastError.message}`)
    : new Error(`Unable to build ${difficulty}/${family} after deterministic seed search.`);
}

function estimate(modules, simulation, assets) {
  return modules.workload.estimateLinuxLearnerWorkload({ simulation, assets });
}

function check(modules, simulation, assets, difficulty = "Advanced", duration = 60) {
  return modules.workload.checkLinuxLabWorkload({ simulation, assets, requestedDifficulty: difficulty, requestedDurationMinutes: duration });
}

function issueCodes(result) {
  return result.issues.map((issue) => issue.code);
}

function selectedTask(simulation, intent) {
  return simulation.canonicalTasks.find((task) => task.intent === intent) || simulation.canonicalTasks[0];
}

function firstUnselectedEvidenceId(simulation, task) {
  return simulation.planningEvidenceRegistry.find((asset) => !task.selectedEvidenceAssetIds.includes(asset.id))?.id;
}

function addDistinctTask(simulation) {
  const mutated = clone(simulation);
  const source = clone(mutated.canonicalTasks[0]);
  source.id = `${source.id}:distinct-extra`;
  source.order = Math.max(...mutated.canonicalTasks.map((task) => task.order)) + 1;
  source.intent = "impact_assessment";
  source.inquiryTypes = Array.from(new Set([...(source.inquiryTypes || []), "risk_assessment"]));
  source.primarySubjectIds = [`phase9:subject:${source.order}`];
  source.supportingSubjectIds = [];
  source.canonicalObjectIds = [`phase9:object:${source.order}`];
  source.requirements = [
    {
      id: `phase9:requirement:${source.order}`,
      capability: "risk_context",
      subjectIds: source.primarySubjectIds,
      relation: "bounded_risk_context",
      stateType: "static",
    },
  ];
  source.requiredCapabilities = ["risk_context"];
  source.expectedDeliverableType = "risk_summary";
  mutated.canonicalTasks.push(source);
  return mutated;
}

function removeDistinctTask(simulation) {
  const mutated = clone(simulation);
  mutated.canonicalTasks = mutated.canonicalTasks.slice(0, -1);
  return mutated;
}

function addCorrelation(simulation) {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks[0];
  const extra = firstUnselectedEvidenceId(mutated, task);
  if (extra) task.selectedEvidenceAssetIds.push(extra);
  task.requirements.push({
    id: `${task.id}:phase9-correlation`,
    capability: task.requiredCapabilities[0] || "timeline_context",
    subjectIds: task.primarySubjectIds.slice(0, 1),
    relation: "phase9_cross_source_confirmation",
    stateType: "historical_reconstruction",
  });
  return mutated;
}

function removeCorrelation(simulation) {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks.find((item) => item.selectedEvidenceAssetIds.length > 1) || mutated.canonicalTasks[0];
  task.selectedEvidenceAssetIds = task.selectedEvidenceAssetIds.slice(0, 1);
  task.requirements = task.requirements.filter((requirement) => !requirement.relation);
  return mutated;
}

function fragmentEvidence(simulation, assets) {
  const mutated = clone(simulation);
  const mutatedAssets = clone(assets);
  const task = mutated.canonicalTasks[0];
  const sourceAsset = mutated.planningEvidenceRegistry.find((asset) => task.selectedEvidenceAssetIds.includes(asset.id));
  const rendered = mutatedAssets.find((asset) => asset.file_path === sourceAsset?.path);
  for (let index = 0; index < 3; index += 1) {
    const id = `${sourceAsset.id}:fragment:${index}`;
    const filePath = `${sourceAsset.path}.fragment${index}.txt`;
    mutated.planningEvidenceRegistry.push({ ...clone(sourceAsset), id, path: filePath });
    mutated.evidenceRegistry.push({ ...clone(sourceAsset), id, path: filePath });
    mutatedAssets.push({ ...clone(rendered), file_path: filePath, file_name: path.basename(filePath), content: rendered.content });
    task.selectedEvidenceAssetIds.push(id);
  }
  return { simulation: mutated, assets: mutatedAssets };
}

function consolidateEvidence(simulation) {
  const mutated = clone(simulation);
  for (const task of mutated.canonicalTasks) task.selectedEvidenceAssetIds = task.selectedEvidenceAssetIds.slice(0, 1);
  return mutated;
}

function withExtraLines(assets, count, token = "bounded unrelated enterprise row") {
  const mutated = clone(assets);
  mutated[0].content += "\n" + Array.from({ length: count }, (_, index) => `2026-07-06 00:00:${String(index % 60).padStart(2, "0")} ${token} ${index}`).join("\n");
  return mutated;
}

function duplicateHighVolumeAsset(assets) {
  const source = assets.find((asset) => asset.content.split(/\r?\n/).length > 20) || assets[0];
  return clone(assets).concat({ ...clone(source), file_path: `${source.file_path}.duplicate`, file_name: `${source.file_name || "duplicate"}.duplicate` });
}

function addSubjectRelationship(simulation) {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks[0];
  const subject = "identity:phase9-extra-subject";
  task.primarySubjectIds.push(subject);
  task.requirements.push({
    id: `${task.id}:phase9-subject-relation`,
    capability: task.requiredCapabilities[0] || "actor_attribution",
    subjectIds: [subject],
    relation: "phase9_subject_relationship",
    stateType: "static_document",
  });
  return mutated;
}

function addTimeline(simulation) {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks[0];
  task.requiredCapabilities = Array.from(new Set([...task.requiredCapabilities, "timeline_exact"]));
  mutated.events.push({ ...clone(mutated.events[0]), id: "phase9:timeline:event", timestamp: "2026-07-06T00:00:00.000Z" });
  return mutated;
}

function addUncertainty(simulation) {
  const mutated = clone(simulation);
  mutated.canonicalTasks[0].inquiryTypes = Array.from(new Set([...(mutated.canonicalTasks[0].inquiryTypes || []), "risk_assessment"]));
  mutated.canonicalTasks[0].intent = "impact_assessment";
  return mutated;
}

function addRemediation(simulation) {
  const mutated = clone(simulation);
  mutated.canonicalTasks[0].inquiryTypes = Array.from(new Set([...(mutated.canonicalTasks[0].inquiryTypes || []), "remediation_or_containment"]));
  mutated.canonicalTasks[0].intent = "containment_recommendation";
  return mutated;
}

function addComplexDeliverable(simulation) {
  const mutated = clone(simulation);
  mutated.canonicalTasks[0].expectedDeliverableType = "containment_plan";
  return mutated;
}

function duplicateTask(simulation) {
  const mutated = clone(simulation);
  const copy = clone(mutated.canonicalTasks[0]);
  copy.id = `${copy.id}:duplicate`;
  copy.order = Math.max(...mutated.canonicalTasks.map((task) => task.order)) + 1;
  mutated.canonicalTasks.push(copy);
  return mutated;
}

function directLineReplacement(simulation) {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks.find((item) => item.selectedEvidenceAssetIds.length > 1) || mutated.canonicalTasks[0];
  task.selectedEvidenceAssetIds = task.selectedEvidenceAssetIds.slice(0, 1);
  task.requirements = task.requirements.slice(0, 1);
  task.requiredCapabilities = task.requiredCapabilities.slice(0, 1);
  return mutated;
}

function missingTaskEvidence(simulation) {
  const mutated = clone(simulation);
  mutated.canonicalTasks[0].selectedEvidenceAssetIds = [];
  return mutated;
}

function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const median = sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const variance = values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / values.length;
  return { min: sorted[0], max: sorted.at(-1), mean: Number(mean.toFixed(2)), median, stdev: Number(Math.sqrt(variance).toFixed(2)), range: Number((sorted.at(-1) - sorted[0]).toFixed(2)) };
}

function dimensionDelta(before, after) {
  const delta = {};
  for (const key of Object.keys(before.dimensions)) {
    delta[key] = Number((after.dimensions[key] - before.dimensions[key]).toFixed(2));
  }
  return delta;
}

function monotonicRecord(label, before, after, validation) {
  return {
    label,
    before: before.estimatedDurationMinutes,
    after: after.estimatedDurationMinutes,
    delta: Number((after.estimatedDurationMinutes - before.estimatedDurationMinutes).toFixed(2)),
    dimensionsBefore: before.dimensions,
    dimensionsAfter: after.dimensions,
    dimensionDelta: dimensionDelta(before, after),
    codes: validation ? issueCodes(validation) : [],
    finalQualityOutcome: validation ? (validation.passed ? "accepted" : "rejected") : "estimate_only",
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
  const baseline = build(modules, "Advanced", "docker_compromise", "phase8-matrix:Advanced:docker_compromise:1", 60);
  const estimateA = estimate(modules, baseline.simulation, baseline.assets);
  const contracts = [
    check(modules, baseline.simulation, baseline.assets, "Beginner", 30),
    check(modules, baseline.simulation, baseline.assets, "Intermediate", 30),
    check(modules, baseline.simulation, baseline.assets, "Intermediate", 45),
    check(modules, baseline.simulation, baseline.assets, "Advanced", 60),
  ];
  assert("duration-label invariant estimate minutes", contracts.every((item) => item.report.independentEstimate.estimatedDurationMinutes === estimateA.estimatedDurationMinutes));
  assert("duration-label invariant dimensions", contracts.every((item) => JSON.stringify(item.report.independentEstimate.dimensions) === JSON.stringify(estimateA.dimensions)));
  assert("duration-label invariant estimate hash", new Set(contracts.map((item) => item.workloadEstimateHash)).size === 1);
  assert("duration-label report hash changes with contract", new Set(contracts.map((item) => item.workloadReportHash)).size > 1);

  const monotonic = [];
  const baseMinutes = estimateA.estimatedDurationMinutes;
  const plusTask = estimate(modules, addDistinctTask(baseline.simulation), baseline.assets);
  assert("add distinct solvable task increases estimate", plusTask.estimatedDurationMinutes > baseMinutes);
  monotonic.push(monotonicRecord("add_task", estimateA, plusTask, check(modules, addDistinctTask(baseline.simulation), baseline.assets, "Advanced", 60)));
  const minusTask = estimate(modules, removeDistinctTask(baseline.simulation), baseline.assets);
  assert("remove distinct task decreases estimate", minusTask.estimatedDurationMinutes < baseMinutes);
  monotonic.push(monotonicRecord("remove_task", estimateA, minusTask, check(modules, removeDistinctTask(baseline.simulation), baseline.assets, "Advanced", 60)));
  const plusCorrelation = estimate(modules, addCorrelation(baseline.simulation), baseline.assets);
  assert("add cross-file correlation increases estimate", plusCorrelation.estimatedDurationMinutes > baseMinutes);
  monotonic.push(monotonicRecord("add_correlation", estimateA, plusCorrelation, check(modules, addCorrelation(baseline.simulation), baseline.assets, "Advanced", 60)));
  const minusCorrelation = estimate(modules, removeCorrelation(baseline.simulation), baseline.assets);
  assert("remove cross-file correlation decreases estimate", minusCorrelation.estimatedDurationMinutes < baseMinutes);
  monotonic.push(monotonicRecord("remove_correlation", estimateA, minusCorrelation, check(modules, removeCorrelation(baseline.simulation), baseline.assets, "Advanced", 60)));
  const fragmented = fragmentEvidence(baseline.simulation, baseline.assets);
  assert("fragment evidence increases navigation", estimate(modules, fragmented.simulation, fragmented.assets).dimensions.evidenceNavigation > estimateA.dimensions.evidenceNavigation);
  const consolidated = estimate(modules, consolidateEvidence(baseline.simulation), baseline.assets);
  assert("consolidate evidence decreases navigation", consolidated.dimensions.evidenceNavigation < estimateA.dimensions.evidenceNavigation);
  const boundedNoise = estimate(modules, baseline.simulation, withExtraLines(baseline.assets, 80));
  assert("bounded irrelevant lines increase distractor cost within cap", boundedNoise.dimensions.evidenceReading >= estimateA.dimensions.evidenceReading && boundedNoise.dimensions.evidenceReading - estimateA.dimensions.evidenceReading < 1);
  const largeNoise = check(modules, removeDistinctTask(removeDistinctTask(removeDistinctTask(baseline.simulation))), withExtraLines(baseline.assets, 3000), "Advanced", 60);
  assert("large log padding cannot manufacture Advanced validity", !largeNoise.passed && issueCodes(largeNoise).some((code) => code === "LINUX_WORKLOAD_NOISE_PADDING" || code === "LINUX_WORKLOAD_INSUFFICIENT_DEPTH" || code === "LINUX_WORKLOAD_DURATION_UNDER_TARGET"));
  const plusSubject = estimate(modules, addSubjectRelationship(baseline.simulation), baseline.assets);
  assert("add subject and relationship increases semantic effort", plusSubject.dimensions.crossSourceCorrelation > estimateA.dimensions.crossSourceCorrelation);
  const plusTimeline = estimate(modules, addTimeline(baseline.simulation), baseline.assets);
  assert("add timeline reconstruction increases timeline effort", plusTimeline.dimensions.timelineReasoning > estimateA.dimensions.timelineReasoning);
  const plusUncertainty = estimate(modules, addUncertainty(baseline.simulation), baseline.assets);
  assert("add uncertainty analysis increases ambiguity effort", plusUncertainty.dimensions.ambiguityResolution > estimateA.dimensions.ambiguityResolution);
  const plusRemediation = estimate(modules, addRemediation(baseline.simulation), baseline.assets);
  assert("add remediation metadata does not double count existing required remediation", plusRemediation.dimensions.remediationReasoning === estimateA.dimensions.remediationReasoning);
  assert("required remediation has concrete actions", estimateA.taskEstimates.some((task) => (task.remediationActions || []).length > 0));
  const plusDeliverable = estimate(modules, addComplexDeliverable(baseline.simulation), baseline.assets);
  assert("add complex deliverable increases deliverable effort", plusDeliverable.dimensions.deliverableConstruction > estimateA.dimensions.deliverableConstruction);
  const duplicate = check(modules, duplicateTask(baseline.simulation), baseline.assets, "Advanced", 60);
  assert("duplicate task triggers duplicate/shared effort issue", issueCodes(duplicate).includes("LINUX_WORKLOAD_DUPLICATED_EFFORT") && issueCodes(duplicate).includes("LINUX_WORKLOAD_SHARED_EFFORT_DOUBLE_COUNTED"));
  const direct = estimate(modules, directLineReplacement(baseline.simulation), baseline.assets);
  assert("replace multi-source proof with direct line decreases estimate", direct.estimatedDurationMinutes < baseMinutes);
  monotonic.push(monotonicRecord("direct_line_replacement", estimateA, direct, check(modules, directLineReplacement(baseline.simulation), baseline.assets, "Advanced", 60)));
  const missing = check(modules, missingTaskEvidence(baseline.simulation), baseline.assets, "Advanced", 60);
  assert("remove task-local evidence fails rather than silent reduction", !missing.passed && issueCodes(missing).includes("LINUX_WORKLOAD_REPORT_INVALID"));
  const duplicateVolume = check(modules, baseline.simulation, duplicateHighVolumeAsset(baseline.assets), "Advanced", 60);
  assert("duplicate evidence file is volume gaming", !duplicateVolume.passed && issueCodes(duplicateVolume).includes("LINUX_WORKLOAD_VOLUME_GAMING"));

  const multiSeedScenarios = [
    ["Beginner", "ssh_bruteforce", 30],
    ["Beginner", "cron_persistence", 30],
    ["Intermediate", "data_staging", 30],
    ["Intermediate", "unauthorized_package_install", 30],
    ["Advanced", "reverse_shell", 60],
    ["Advanced", "cron_persistence", 60],
    ["Advanced", "docker_compromise", 60],
  ];
  const multipleSeed = [];
  for (const [difficulty, family, duration] of multiSeedScenarios) {
    const rows = [];
    for (let index = 0; index < 5; index += 1) {
      const built = buildForFamily(modules, difficulty, family, `phase9-independence:${difficulty}:${family}:${index}`, duration);
      const candidate = built.candidate;
      const result = check(modules, candidate.simulation, candidate.assets, difficulty, duration);
      rows.push({
        seed: built.seed,
        estimate: result.report.estimatedDurationMinutes,
        dimensions: result.report.dimensions,
        accepted: result.passed,
        reasons: issueCodes(result),
      });
    }
    multipleSeed.push({ difficulty, family, duration, stats: stats(rows.map((row) => row.estimate)), acceptanceCount: rows.filter((row) => row.accepted).length, rejectionCount: rows.filter((row) => !row.accepted).length, rows });
  }

  const tampered = clone(contracts[3].report);
  tampered.estimatedDurationMinutes += 5;
  const tamperedIssues = modules.workload.validateLinuxLabWorkloadReport(tampered, { simulation: baseline.simulation, assets: baseline.assets });
  assert("tampered estimate is rejected", tamperedIssues.some((issue) => issue.code === "LINUX_WORKLOAD_DURATION_ANCHORED_ESTIMATE"));
  const replayTamperedEstimate = modules.replay.replayLinuxGeneration({
    provenance: baseline.provenance,
    expectedHashes: { ...baseline.deterministicHashes, workloadEstimateHash: "1".repeat(64) },
    title: "Phase 9 independence",
  });
  assert("replay detects tampered independent estimate hash", replayTamperedEstimate.status === "mismatch" && replayTamperedEstimate.mismatchedLayers.includes("workloadEstimateHash"));

  const summary = { baseline: { estimate: estimateA, report: contracts[3].report }, monotonic, multipleSeed };
  writeJson(path.join(OUTPUT_DIR, "summary.json"), summary);
  console.log(JSON.stringify({ passed: true, multipleSeed: multipleSeed.map((row) => ({ difficulty: row.difficulty, family: row.family, ...row.stats, acceptanceCount: row.acceptanceCount, rejectionCount: row.rejectionCount })) }, null, 2));
}

main();
