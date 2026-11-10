#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const {
  buildFullGateReport,
  evidenceExtractionPopulation,
  metricForResult,
} = require("./runLinuxPhase12LiveGradingTests.js");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

const contract = {
  taskId: "task:test",
  requiredFindings: [{ id: "finding:test", expectedValue: { kind: "identity", identityId: "identity:test" } }],
  evidenceRequirements: [{
    findingId: "finding:test",
    evidencePaths: ["assets/logs/auth.log"],
    requiredAnchors: [],
  }],
  remediationRequirements: [],
  uncertaintyRequirements: [],
  scoring: { maximumPoints: 10 },
};

function resultWithEvidence(paths) {
  return {
    status: "graded",
    diagnostics: [],
    normalizedSubmission: {
      taskId: "task:test",
      claims: paths === null ? [] : [{
        value: { kind: "identity", identityId: "identity:test" },
        evidence: paths.map((path) => ({ path, anchors: [] })),
      }],
    },
    scoreReport: { evidencePoints: paths?.includes("assets/logs/auth.log") ? 1 : 0 },
    candidateSelectionStages: {},
  };
}

function item(learnerAnswer, renderedEvidencePaths = ["assets/logs/auth.log"]) {
  return { contract, category: "fully_correct", learnerAnswer, renderedEvidencePaths };
}

function main() {
  const noPopulation = metricForResult(contract, resultWithEvidence(null), item("No evidence is cited here."));
  assert("no expected and no extracted references are not applicable", noPopulation.learnerStatedEvidenceReferences === 0 && noPopulation.extractedEvidenceReferences === 0 && noPopulation.evidenceReferenceExtractionPrecision === null && noPopulation.evidenceReferenceExtractionRecall === null, JSON.stringify(noPopulation));

  const missed = metricForResult(contract, resultWithEvidence(null), item("I cite assets/logs/auth.log."));
  assert("expected references but none extracted has recall zero and precision null", missed.learnerStatedEvidenceReferences === 1 && missed.extractedEvidenceReferences === 0 && missed.matchedEvidenceReferences === 0 && missed.evidenceReferenceExtractionPrecision === null && missed.evidenceReferenceExtractionRecall === 0, JSON.stringify(missed));

  const invented = metricForResult(contract, resultWithEvidence(["assets/logs/auth.log", "assets/logs/extra.log"]), item("I cite assets/logs/auth.log."));
  assert("unexpected extracted reference decreases precision", invented.extractedEvidenceReferences === 2 && invented.matchedEvidenceReferences === 1 && invented.evidenceReferenceExtractionPrecision === 0.5, JSON.stringify(invented));

  const hallucinatedPreserved = metricForResult(contract, resultWithEvidence(["assets/logs/not-real.log"]), item("I cite assets/logs/not-real.log."));
  assert("preserved hallucinated reference counts as successful extraction", hallucinatedPreserved.authoritativeEvidenceStatusCounts.nonexistent_hallucinated === 1 && hallucinatedPreserved.matchedEvidenceReferences === 1 && hallucinatedPreserved.evidenceReferenceExtractionPrecision === 1 && hallucinatedPreserved.evidenceReferenceExtractionRecall === 1 && hallucinatedPreserved.evidenceCreditCorrectness === 1, JSON.stringify(hallucinatedPreserved));

  const rows = [
    { id: "a", category: "fully_correct", status: "graded", diagnostics: [], attempts: [], scoreComponents: {}, metrics: noPopulation },
    { id: "b", category: "partial", status: "graded", diagnostics: [], attempts: [], scoreComponents: {}, metrics: invented },
    { id: "c", category: "hallucinated_evidence", status: "graded", diagnostics: [{ code: "LINUX_GRADING_EVIDENCE_HALLUCINATION" }], attempts: [], scoreComponents: { evidencePoints: 0 }, metrics: hallucinatedPreserved },
  ];
  const population = evidenceExtractionPopulation(rows);
  assert("micro aggregation excludes zero-denominator cases", population.precision.numerator === 2 && population.precision.denominator === 3 && population.recall.numerator === 2 && population.recall.denominator === 2, JSON.stringify(population));

  const report = buildFullGateReport({
    results: rows,
    corpusRegistry: { version: "test", expectedIds: rows.map((row) => row.id), expectedIdHash: "hash", requiredCategories: rows.map((row) => row.category) },
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
    semanticCandidateSmoke: { ok: true },
    stabilityCases: [{ variance: 0 }],
    utf8Ok: true,
  });
  assert("aggregate numerator and denominator reconcile from raw counts", report.evidenceExtractionPopulation.matchedSurfaceReferences === population.matchedSurfaceReferences && report.evidenceExtractionPopulation.extractedSurfaceReferences === population.extractedSurfaceReferences && report.evidenceExtractionPopulation.expectedSurfaceReferences === population.expectedSurfaceReferences, JSON.stringify(report.evidenceExtractionPopulation));
  assert("zero denominators remain null in self-validation", !report.selfValidation.issues.some((issue) => issue.code === "ZERO_EVIDENCE_DENOMINATOR_NOT_NULL"), JSON.stringify(report.selfValidation));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
