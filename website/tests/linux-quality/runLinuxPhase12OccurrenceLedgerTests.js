#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const {
  compileForLiveHarness,
  loadCompiledLinux,
  fullCorpusRegistry,
  buildFullGateReport,
  buildEvidenceOccurrenceLedger,
  evidenceStatusTable,
  metricForResult,
  evidenceExtractionPopulation,
} = require("./runLinuxPhase12LiveGradingTests.js");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function syntheticResult(paths, overrides = {}) {
  return {
    status: "graded",
    diagnostics: overrides.diagnostics || [],
    normalizedSubmission: {
      taskId: "task:test",
      claims: paths === null ? [] : [{
        value: { kind: "identity", identityId: "identity:test" },
        evidence: paths.map((path) => ({ path, anchors: [] })),
      }],
    },
    extraction: overrides.extraction,
    scoreReport: { evidencePoints: overrides.evidencePoints ?? 0 },
    candidateSelectionStages: {},
  };
}

function rowFromCase(item, overrides = {}) {
  const learnerPaths = evidenceStatusTable(item.contract, item, item.learnerAnswer).map((status) => status.raw);
  const result = overrides.result || syntheticResult(
    overrides.paths === undefined
      ? learnerPaths
      : overrides.paths,
    overrides
  );
  return {
    id: item.id,
    category: item.category,
    difficulty: item.difficulty,
    family: item.family,
    status: "graded",
    attempts: overrides.attempts || [],
    diagnostics: overrides.diagnostics || result.diagnostics || [],
    score: overrides.score ?? 18,
    maximumPoints: 20,
    scoreComponents: overrides.scoreComponents || { evidencePoints: overrides.evidencePoints ?? 0, penalties: 0 },
    metrics: metricForResult(item.contract, result, item),
  };
}

function main() {
  compileForLiveHarness();
  const { linux, assessment } = loadCompiledLinux();
  const registry = fullCorpusRegistry(linux, assessment);
  const byCategory = new Map(registry.cases.map((item) => [item.category, item]));

  const full09 = byCategory.get("ambiguous_non_factual");
  const full15 = byCategory.get("internal_id_attack");
  const full13 = byCategory.get("hallucinated_evidence");
  const ledger09 = buildEvidenceOccurrenceLedger(full09.contract, syntheticResult(null), full09);
  const ledger15 = buildEvidenceOccurrenceLedger(full15.contract, syntheticResult(null, { diagnostics: [{ code: "LINUX_GRADING_INTERNAL_ID_ATTEMPT" }] }), full15);
  assert("full-09 intended surface references match without evidence-credit leakage", ledger09.expectedCount === 2 && ledger09.extractedCount === 2 && ledger09.matchedCount === 2 && ledger09.expectedOccurrences.every((row) => row.receivesCredit), JSON.stringify(ledger09));
  assert("full-15 intended surface references match while internal-ID security remains separate", ledger15.expectedCount === 2 && ledger15.extractedCount === 2 && ledger15.matchedCount === 2 && ledger15.expectedOccurrences.every((row) => row.receivesCredit), JSON.stringify(ledger15));

  const repeated = {
    ...full09,
    learnerAnswer: "I cite assets/logs/auth.log and later assets/logs/auth.log.",
  };
  const repeatedResult = syntheticResult(null);
  const repeatedLedger = buildEvidenceOccurrenceLedger(repeated.contract, repeatedResult, repeated);
  assert("repeated references with different offsets reconcile once each", repeatedLedger.expectedCount === 2 && repeatedLedger.extractedCount === 2 && repeatedLedger.matchedCount === 2, JSON.stringify(repeatedLedger));

  const duplicateResult = syntheticResult(["assets/logs/auth.log", "assets/logs/auth.log"]);
  const singleExpected = { ...full09, learnerAnswer: "I cite assets/logs/auth.log." };
  const duplicateLedger = buildEvidenceOccurrenceLedger(singleExpected.contract, duplicateResult, singleExpected);
  assert("duplicate normalized citation fanout is counted as one learner-visible occurrence", duplicateLedger.expectedCount === 1 && duplicateLedger.extractedCount === 1 && duplicateLedger.matchedCount === 1 && duplicateLedger.falsePositiveCount === 0, JSON.stringify(duplicateLedger));

  const ambiguousContract = {
    ...full09.contract,
    evidenceRequirements: [{ ...full09.contract.evidenceRequirements[0], evidencePaths: ["assets/logs/shared.log", "assets/reports/shared.log"], requiredAnchors: [] }],
  };
  const ambiguousLedger = buildEvidenceOccurrenceLedger(ambiguousContract, syntheticResult(["shared.log"]), { ...full09, contract: ambiguousContract, learnerAnswer: "I cite shared.log.", renderedEvidencePaths: ["assets/logs/shared.log", "assets/reports/shared.log"] });
  assert("same basename with different task paths remains ambiguous", ambiguousLedger.expectedOccurrences[0].authoritativeEvidenceStatus === "ambiguous_alias" && ambiguousLedger.matchedCount === 1, JSON.stringify(ambiguousLedger));

  const rows = registry.cases.map((item) => {
    if (item.category === "hallucinated_evidence") return rowFromCase(item, { paths: null, diagnostics: [{ code: "LINUX_GRADING_EVIDENCE_HALLUCINATION" }], evidencePoints: 0 });
    if (item.category === "internal_id_attack") return rowFromCase(item, { paths: null, diagnostics: [{ code: "LINUX_GRADING_INTERNAL_ID_ATTEMPT" }], evidencePoints: 0 });
    return rowFromCase(item, { evidencePoints: 0 });
  });
  const expectedSurfaceReferences = rows.reduce((sum, row) => sum + row.metrics.evidenceOccurrenceLedger.expectedCount, 0);
  const population = evidenceExtractionPopulation(rows, registry);
  assert("full 15-case occurrence ledger reconciles exactly", population.expectedSurfaceReferences === expectedSurfaceReferences && population.extractedSurfaceReferences === expectedSurfaceReferences && population.matchedSurfaceReferences === expectedSurfaceReferences, JSON.stringify(population));
  assert("matched never exceeds expected or extracted per case", rows.every((row) => row.metrics.matchedEvidenceReferences <= row.metrics.learnerStatedEvidenceReferences && row.metrics.matchedEvidenceReferences <= row.metrics.extractedEvidenceReferences), JSON.stringify(rows.map((row) => ({ id: row.id, metrics: row.metrics.evidenceOccurrenceLedger }))));

  const withProbe = [...rows, { ...rows[0], id: "schema-probe", category: "probe" }];
  const report = buildFullGateReport({ results: rows, corpusRegistry: registry, connectivity: { ok: true }, productionSchemaSmoke: { ok: true }, semanticCandidateSmoke: { ok: true }, stabilityCases: [{ variance: 0 }], utf8Ok: true });
  const probeReport = buildFullGateReport({ results: withProbe, corpusRegistry: registry, connectivity: { ok: true }, productionSchemaSmoke: { ok: true }, semanticCandidateSmoke: { ok: true }, stabilityCases: [{ variance: 0 }], utf8Ok: true });
  assert("infrastructure probes cannot enter full-corpus evidence totals", report.evidenceExtractionPopulation.expectedSurfaceReferences === expectedSurfaceReferences && probeReport.corpusCompletion.unexpectedIds.includes("schema-probe"), JSON.stringify(probeReport.corpusCompletion));
  assert("category summaries are not resummed as raw occurrence totals", report.evidenceExtractionPopulation.expectedSurfaceReferences === rows.reduce((sum, row) => sum + row.metrics.evidenceOccurrenceLedger.expectedCount, 0), JSON.stringify(report.evidenceExtractionPopulation));

  const passingGate = report.gates.find((gate) => gate.name === "evidence_extraction_precision");
  assert("passing gate never appears in blocking reasons", passingGate.passed && !report.blockingReasons.some((reason) => reason.gate === passingGate.name), JSON.stringify(report.blockingReasons));
  const failedRows = rows.map((row, index) => index === 0 ? { ...row, metrics: { ...row.metrics, surfaceFidelity: { ...row.metrics.surfaceFidelity, matchedSurfaceClaimCount: 0 } } } : row);
  const failedReport = buildFullGateReport({ results: failedRows, corpusRegistry: registry, connectivity: { ok: true }, productionSchemaSmoke: { ok: true }, semanticCandidateSmoke: { ok: true }, stabilityCases: [{ variance: 0 }], utf8Ok: true });
  const failedNames = failedReport.gates.filter((gate) => !gate.passed).map((gate) => gate.name);
  assert("failed gate appears exactly once", failedNames.every((name) => failedReport.blockingReasons.filter((reason) => reason.gate === name).length === 1), JSON.stringify(failedReport.blockingReasons));

  const invalidRows = rows.map((row, index) => index === 0 ? { ...row, metrics: { ...row.metrics, matchedEvidenceReferences: 3, extractedEvidenceReferences: 2, evidenceOccurrenceLedger: { ...row.metrics.evidenceOccurrenceLedger, matchedCount: 3, extractedCount: 2 } } } : row);
  const invalidReport = buildFullGateReport({ results: invalidRows, corpusRegistry: registry, connectivity: { ok: true }, productionSchemaSmoke: { ok: true }, semanticCandidateSmoke: { ok: true }, stabilityCases: [{ variance: 0 }], utf8Ok: true });
  assert("numerator greater than denominator makes report invalid", !invalidReport.passed && invalidReport.selfValidation.issues.some((issue) => issue.code.includes("EXCEEDS")), JSON.stringify(invalidReport.selfValidation));
  assert("ratios greater than one are never accepted or clamped", invalidReport.gates.find((gate) => gate.name === "evidence_extraction_precision").passed === false && invalidReport.gates.find((gate) => gate.name === "evidence_extraction_precision").observedValue === null, JSON.stringify(invalidReport.gates.find((gate) => gate.name === "evidence_extraction_precision")));

  const sanitized = JSON.stringify(report.evidenceExtractionPopulation) + JSON.stringify(rows.map((row) => row.metrics.evidenceOccurrenceLedger));
  assert("sanitized occurrence telemetry excludes raw answers and secrets", registry.cases.every((item) => !sanitized.includes(item.learnerAnswer)) && !sanitized.includes("OPENAI_API_KEY") && !sanitized.includes("requiredFindings"), sanitized);

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
