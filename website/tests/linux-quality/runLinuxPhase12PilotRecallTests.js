#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const {
  answerFor,
  authoritativeSubmissionHash,
  buildPilotGateReport,
  compareSurfaceCounts,
  compileForLiveHarness,
  countSurfaceOracle,
  fullCorpusRegistry,
  loadCompiledLinux,
  metricForResult,
} = require("./runLinuxPhase12LiveGradingTests.js");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function valueKey(value) {
  return JSON.stringify(value);
}

function candidateExtraction(schema, freeForm, contract, learnerAnswer, selections = undefined) {
  const registry = freeForm.buildLinuxLearnerCandidateRegistry(contract, learnerAnswer);
  const modelFacingClauses = registry.candidates.filter((candidate) => candidate.type === "clause" && candidate.disposition === "model_ambiguous");
  const candidateSelections = selections || modelFacingClauses.map((clause) => ({
    clauseId: clause.id,
    role: clause.allowedRoles?.includes("non_assessment") ? "non_assessment" : clause.allowedRoles?.[0] || "non_assessment",
    primaryEntityCandidateId: null,
    secondaryEntityCandidateId: null,
    subjectCandidateId: null,
    predicateLabel: null,
    objectCandidateId: null,
    valueCandidateId: null,
    timestampCandidateId: null,
    stateCandidateId: null,
    evidenceReferenceIds: [],
    reasoningClauseIds: [],
    uncertaintyCandidateIds: [],
    remediationCandidateIds: [],
    conclusionCandidateIds: [],
    confidence: null,
    extractionConfidence: "high",
  }));
  return {
    version: schema.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION,
    taskId: contract.taskId,
    candidateRegistryHash: registry.registryHash,
    candidateSelections,
    atomicClaims: null,
    claims: null,
    uncertaintyAssertions: null,
    remediationActions: null,
    unparsedStatements: null,
  };
}

async function grade({ schema, freeForm, item, learnerAnswer }) {
  const result = await freeForm.gradeLinuxFreeFormAssessment({
    contract: item.contract,
    learnerAnswer,
    studentTask: item.studentTask,
    renderedEvidencePaths: item.renderedEvidencePaths,
    rawExtractionObject: candidateExtraction(schema, freeForm, item.contract, learnerAnswer),
    createdAt: "2026-08-09T00:00:00.000Z",
  });
  assert("offline grading returns a graded result", result.status === "graded", JSON.stringify(result.diagnostics || []));
  return result;
}

function factualFindingKeys(item) {
  return new Set(item.contract.requiredFindings.slice(0, 2).map((finding) => valueKey(finding.expectedValue)));
}

function claimKinds(result) {
  return (result.normalizedSubmission?.claims || []).map((claim) => claim.value.kind).sort();
}

function pilotRow(item, result) {
  const metrics = metricForResult(item.contract, result, item);
  return {
    id: `${item.id}-synthetic`,
    category: item.category,
    difficulty: item.difficulty,
    family: item.family,
    status: result.status,
    attempts: [{ ok: true }],
    diagnostics: result.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity })),
    score: result.scoreReport.score,
    maximumPoints: result.scoreReport.maximumPoints,
    metrics,
    normalizedSubmissionHash: authoritativeSubmissionHash(result.normalizedSubmission),
  };
}

async function main() {
  compileForLiveHarness();
  const { linux, assessment, schema, freeForm } = loadCompiledLinux();
  const registry = fullCorpusRegistry(linux, assessment);
  const item = registry.cases.find((candidate) => candidate.id === "full-02-correct_paraphrase");
  assert("actual pilot failing fixture exists", item && item.category === "correct_paraphrase" && item.difficulty === "Beginner" && item.family === "cron_persistence");

  const expected = countSurfaceOracle(item);
  assert("correct paraphrase oracle still expects two factual findings", expected.factual === 2, JSON.stringify(expected));
  assert("actual fixture answer has exactly the two task evidence references", expected.evidence_reference === 2, JSON.stringify(expected));

  const result = await grade({ schema, freeForm, item, learnerAnswer: item.learnerAnswer });
  const metrics = metricForResult(item.contract, result, item);
  const keys = factualFindingKeys(item);
  const claimKeys = new Set((result.normalizedSubmission?.claims || []).map((claim) => valueKey(claim.value)));
  assert("actual correct-paraphrase fixture yields both distinct factual findings", keys.size === 2 && Array.from(keys).every((key) => claimKeys.has(key)), claimKinds(result).join(","));
  assert("both findings survive candidate routing and normalization", metrics.surfaceFidelity.perType.factual.expected === 2 && metrics.surfaceFidelity.perType.factual.extracted === 2 && metrics.surfaceFidelity.perType.factual.matched === 2, JSON.stringify(metrics.surfaceFidelity.perType.factual));
  assert("equivalent command and network claims are not collapsed as duplicates", (result.normalizedSubmission?.claims || []).length === 2 && new Set((result.normalizedSubmission?.claims || []).map((claim) => valueKey(claim.value))).size === 2);

  const equivalentAnswer = item.learnerAnswer.replace("the observed process executed the task command", "the process ran the task command");
  const equivalentResult = await grade({ schema, freeForm, item, learnerAnswer: equivalentAnswer });
  const equivalentMetrics = metricForResult(item.contract, equivalentResult, item);
  assert("equivalent paraphrases resolve deterministically", equivalentMetrics.surfaceFidelity.perType.factual.matched === 2 && authoritativeSubmissionHash(equivalentResult.normalizedSubmission) === authoritativeSubmissionHash(result.normalizedSubmission));

  const omittedAnswer = item.learnerAnswer.replace(/;\s*the observed process executed the task command [^.]+/, "");
  const omittedResult = await grade({ schema, freeForm, item, learnerAnswer: omittedAnswer });
  const omittedMetrics = metricForResult(item.contract, omittedResult, { ...item, learnerAnswer: omittedAnswer });
  assert("omission of the command finding lowers recall", omittedMetrics.surfaceFidelity.perType.factual.matched === 1 && omittedMetrics.surfaceFidelity.perType.factual.falseNegative === 1, JSON.stringify(omittedMetrics.surfaceFidelity.perType.factual));
  assert("omission lowers deterministic score", omittedResult.scoreReport.score < result.scoreReport.score, `${omittedResult.scoreReport.score} >= ${result.scoreReport.score}`);

  const wrongAnswer = item.learnerAnswer.replace(/the observed process executed the task command [^.;]+/, "the observed process executed the task command /usr/bin/false");
  const wrongResult = await grade({ schema, freeForm, item, learnerAnswer: wrongAnswer });
  const wrongMetrics = metricForResult(item.contract, wrongResult, { ...item, learnerAnswer: wrongAnswer });
  assert("wrong command paraphrase is preserved but receives no canonical command credit", wrongMetrics.matchedClaims === 1 && wrongResult.scoreReport.score < result.scoreReport.score, JSON.stringify({ matched: wrongMetrics.matchedClaims, score: wrongResult.scoreReport.score }));

  const nonFactualAnswer = `${item.learnerAnswer} The task command execution is supported by the cited evidence.`;
  const nonFactualResult = await grade({ schema, freeForm, item, learnerAnswer: nonFactualAnswer });
  const nonFactualMetrics = metricForResult(item.contract, nonFactualResult, { ...item, learnerAnswer: nonFactualAnswer });
  assert("non-factual nearby prose remains excluded", nonFactualMetrics.surfaceFidelity.perType.factual.extracted === 2 && nonFactualMetrics.surfaceFidelity.perType.factual.matched === 2, JSON.stringify(nonFactualMetrics.surfaceFidelity.perType.factual));

  const noisyAnswer = `${item.learnerAnswer} Maybe this matters. Another maybe matters.`;
  const noisyRegistry = freeForm.buildLinuxLearnerCandidateRegistry(item.contract, noisyAnswer);
  const ambiguousClauses = noisyRegistry.candidates.filter((candidate) => candidate.type === "clause" && candidate.disposition === "model_ambiguous");
  const orderedSelections = ambiguousClauses.map((clause) => ({
    clauseId: clause.id,
    role: "non_assessment",
    primaryEntityCandidateId: null,
    secondaryEntityCandidateId: null,
    subjectCandidateId: null,
    predicateLabel: null,
    objectCandidateId: null,
    valueCandidateId: null,
    timestampCandidateId: null,
    stateCandidateId: null,
    evidenceReferenceIds: [],
    reasoningClauseIds: [],
    uncertaintyCandidateIds: [],
    remediationCandidateIds: [],
    conclusionCandidateIds: [],
    confidence: null,
    extractionConfidence: "high",
  }));
  const orderedExtraction = candidateExtraction(schema, freeForm, item.contract, noisyAnswer, orderedSelections);
  const reversedExtraction = { ...orderedExtraction, candidateSelections: [...orderedSelections].reverse() };
  const orderedResult = await freeForm.gradeLinuxFreeFormAssessment({ contract: item.contract, learnerAnswer: noisyAnswer, renderedEvidencePaths: item.renderedEvidencePaths, rawExtractionObject: orderedExtraction, createdAt: "2026-08-09T00:00:00.000Z" });
  const reversedResult = await freeForm.gradeLinuxFreeFormAssessment({ contract: item.contract, learnerAnswer: noisyAnswer, renderedEvidencePaths: item.renderedEvidencePaths, rawExtractionObject: reversedExtraction, createdAt: "2026-08-09T00:00:00.000Z" });
  assert("normalized hashes are stable across model-selection ordering", orderedResult.status === "graded" && reversedResult.status === "graded" && authoritativeSubmissionHash(orderedResult.normalizedSubmission) === authoritativeSubmissionHash(reversedResult.normalizedSubmission));

  const row = pilotRow(item, result);
  assert("pilot recall arithmetic reconciles numerator denominator and false negatives", row.metrics.surfaceFidelity.matchedSurfaceClaimCount + row.metrics.surfaceFidelity.falseNegativeSurfaceClaimCount === row.metrics.surfaceFidelity.expectedSurfaceClaimCount && row.metrics.surfaceFidelity.matchedSurfaceClaimCount + row.metrics.surfaceFidelity.falsePositiveSurfaceClaimCount === row.metrics.surfaceFidelity.extractedSurfaceClaimCount, JSON.stringify(row.metrics.surfaceFidelity));
  const inflated = compareSurfaceCounts({ factual: 1 }, { factual: 3 });
  assert("surface arithmetic never matches more claims than either population", inflated.matchedSurfaceClaimCount <= inflated.expectedSurfaceClaimCount && inflated.matchedSurfaceClaimCount <= inflated.extractedSurfaceClaimCount, JSON.stringify(inflated));

  const pilotReport = buildPilotGateReport({
    results: [row, row, row, row, row, row, row, row, row, row, row, row, row, row, row],
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
    utf8Ok: true,
  });
  assert("pilot report gates do not contain numerator-over-denominator ratios", pilotReport.gates.every((gate) => typeof gate.numerator !== "number" || typeof gate.denominator !== "number" || gate.denominator === 0 || gate.numerator <= gate.denominator || gate.invalidRatio === true));

  console.log(JSON.stringify({
    passed: true,
    assertions,
    correctedClaimKinds: claimKinds(result),
    score: result.scoreReport.score,
    maximumPoints: result.scoreReport.maximumPoints,
    surfaceFidelity: metrics.surfaceFidelity,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
