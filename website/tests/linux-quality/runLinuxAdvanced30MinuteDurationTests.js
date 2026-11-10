#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const {
  MATRIX,
  buildCandidate,
  compileIfNeeded,
  loadModules,
} = require("./linuxPhase9AuditUtils");

let assertions = 0;

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function buildAcceptedCandidate(modules, difficulty, family, seed) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildCandidate(modules, difficulty, family, `${seed}:advanced-30:${attempt}`, { duration: 30 });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to build ${family} Advanced 30-minute candidate`);
}

function main() {
  const out = compileIfNeeded("advanced-30-minute");
  const modules = loadModules(out);
  const advancedRows = MATRIX.filter(([difficulty]) => difficulty === "Advanced");
  const familyResults = [];

  for (const [difficulty, family, seed] of advancedRows) {
    const candidate = buildAcceptedCandidate(modules, difficulty, family, seed);
    const report = candidate.assetQuality.workloadReport;
    const taskCount = candidate.simulation.canonicalTasks.length;
    const issueCodes = report.issues.map((issue) => issue.code);

    assert(`${family} Advanced 30-minute candidate passes quality`, candidate.assetQuality.passed, candidate.assetQuality.summary);
    assert(`${family} Advanced 30-minute records requested duration`, report.requestedDurationMinutes === 30, `duration=${report.requestedDurationMinutes}`);
    assert(`${family} Advanced 30-minute keeps focused task count`, taskCount === 4 && report.metrics.taskCount === 4, `tasks=${taskCount}/${report.metrics.taskCount}`);
    assert(
      `${family} Advanced 30-minute stays in calibrated duration range`,
      report.estimatedDurationMinutes >= report.acceptableDurationRange.minimumMinutes &&
        report.estimatedDurationMinutes <= report.acceptableDurationRange.maximumMinutes,
      `${report.estimatedDurationMinutes} not in ${JSON.stringify(report.acceptableDurationRange)}`
    );
    assert(`${family} Advanced 30-minute keeps every task multi-source`, report.metrics.crossFileCorrelationCount >= taskCount, `correlations=${report.metrics.crossFileCorrelationCount} tasks=${taskCount}`);
    assert(
      `${family} Advanced 30-minute has task-local evidence depth`,
      candidate.simulation.canonicalTasks.every((task) => task.selectedEvidenceAssetIds.length >= 2),
      candidate.simulation.canonicalTasks.map((task) => `${task.id}:${task.selectedEvidenceAssetIds.length}`).join(", ")
    );
    assert(`${family} Advanced 30-minute has no workload validation issues`, issueCodes.length === 0, issueCodes.join(", "));

    familyResults.push({
      family,
      tasks: taskCount,
      estimate: report.estimatedDurationMinutes,
      range: report.acceptableDurationRange,
      correlations: report.metrics.crossFileCorrelationCount,
      evidence: report.metrics.uniqueEvidencePathCount,
      score: candidate.assetQuality.score,
    });
  }

  console.log(JSON.stringify({ advancedThirtyMinuteFamilies: familyResults }, null, 2));
  console.log(`Linux Advanced 30-minute duration tests passed (${assertions} assertions).`);
}

main();
