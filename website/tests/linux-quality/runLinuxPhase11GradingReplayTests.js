#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const {
  buildCandidate,
  compileIfNeeded,
  fullExtraction,
  loadPhase11,
} = require("./linuxPhase11GradingTestUtils");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

async function main() {
  const out = compileIfNeeded("phase11-replay");
  const { linux, assessment, schema, freeForm, provenance } = loadPhase11(out);
  const candidate = buildCandidate(linux.buildLinuxAssetCandidate, "Intermediate", "systemd_persistence");
  const pkg = assessment.buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = pkg.contracts.find((item) => item.requiredFindings.length > 0) || pkg.contracts[0];
  const extraction = fullExtraction(schema, contract);

  const graded = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: "The answer cites the selected evidence and stays within the task.",
    rawExtractionObject: extraction,
    modelConfigurationId: "offline-test-model",
    createdAt: "2026-07-29T10:00:00.000Z",
  });
  assert("baseline grading succeeded", graded.status === "graded", JSON.stringify(graded));

  const exact = provenance.replayLinuxAssessmentScoring({
    provenance: graded.provenance,
    contract,
    typedSubmission: graded.normalizedSubmission,
    scoreReport: graded.scoreReport,
    rawExtractionResponse: graded.extraction,
  });
  assert("exact scoring replay matches", exact.status === "exact_match", JSON.stringify(exact));

  const extractionOnlyChanged = provenance.replayLinuxAssessmentScoring({
    provenance: graded.provenance,
    contract,
    typedSubmission: graded.normalizedSubmission,
    scoreReport: graded.scoreReport,
    rawExtractionResponse: { ...graded.extraction, unparsedStatements: ["different raw extraction"] },
  });
  assert("changed extraction with same typed score is distinguished", extractionOnlyChanged.status === "extraction_differs_score_unchanged", JSON.stringify(extractionOnlyChanged));

  const typedChanged = provenance.replayLinuxAssessmentScoring({
    provenance: graded.provenance,
    contract,
    typedSubmission: { ...graded.normalizedSubmission, claims: [] },
    scoreReport: graded.scoreReport,
    rawExtractionResponse: graded.extraction,
  });
  assert("typed submission mismatch is detected", typedChanged.status === "typed_submission_differs" && typedChanged.mismatchedLayers.includes("normalizedTypedSubmissionHash"), JSON.stringify(typedChanged));

  const contractChanged = provenance.replayLinuxAssessmentScoring({
    provenance: { ...graded.provenance, assessmentContractHash: "tampered" },
    contract,
    typedSubmission: graded.normalizedSubmission,
    scoreReport: graded.scoreReport,
    rawExtractionResponse: graded.extraction,
  });
  assert("assessment contract mismatch is detected", contractChanged.status === "assessment_contract_differs", JSON.stringify(contractChanged));

  const scoreChanged = provenance.replayLinuxAssessmentScoring({
    provenance: graded.provenance,
    contract,
    typedSubmission: graded.normalizedSubmission,
    scoreReport: { ...graded.scoreReport, score: Math.max(0, graded.scoreReport.score - 1) },
    rawExtractionResponse: graded.extraction,
  });
  assert("score report mismatch is detected", scoreChanged.status === "score_report_differs", JSON.stringify(scoreChanged));

  const incomplete = provenance.replayLinuxAssessmentScoring({
    provenance: { ...graded.provenance, normalizedTypedSubmissionHash: undefined, deterministicScoreReportHash: undefined },
    contract,
    typedSubmission: graded.normalizedSubmission,
    scoreReport: graded.scoreReport,
  });
  assert("incomplete historical provenance is detected", incomplete.status === "historical_provenance_incomplete", JSON.stringify(incomplete));

  assert("provenance excludes hidden prompt bodies and secrets", !/api_key|bearer|expectedValue|requiredFindings|The answer cites the selected evidence/i.test(JSON.stringify(graded.provenance)), JSON.stringify(graded.provenance));
  assert("provenance records schema and model identifiers", graded.provenance.extractorSchemaVersion === schema.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION && graded.provenance.modelConfigurationId === "offline-test-model");

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
