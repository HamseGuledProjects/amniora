#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  LIVE_FAILED,
  LIVE_PENDING,
  GATE_POLICY_VERSION,
  QUALITY_SMOKE_CASE_SET_VERSION,
  PILOT_CASE_SET_VERSION,
  FULL_CASE_SET_VERSION,
  buildQualitySmokeGateReport,
  buildPilotGateReport,
  buildBehaviorSmokeGateReport,
  buildFullGateReport,
  validatePilotGateReport,
  validateBehaviorSmokeGateReport,
  validateBehaviorSmokeArtifactForFullMode,
  validateQualitySmokeArtifactForPilotMode,
  validatePilotArtifactForFullMode,
} = require("./runLinuxPhase12LiveGradingTests.js");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function result(category, repeat, overrides = {}) {
  const maximumPoints = overrides.maximumPoints || 20;
  const score = overrides.score ?? Math.ceil(maximumPoints * 0.9);
  const matchedClaims = overrides.matchedClaims ?? 2;
  const extractedClaims = overrides.extractedClaims ?? 2;
  const expectedClaims = overrides.expectedClaims ?? 2;
  const authoritativeResolutionNumerator = overrides.authoritativeResolutionNumerator ?? matchedClaims;
  const authoritativeResolutionDenominator = overrides.authoritativeResolutionDenominator ?? extractedClaims;
  const rawFactualCandidateSelections = overrides.rawFactualCandidateSelections ?? extractedClaims;
  const rawFactualSurfaceMatchedSelections = overrides.rawFactualSurfaceMatchedSelections ?? matchedClaims;
  const rawFactualDuplicateSelections = overrides.rawFactualDuplicateSelections ?? 0;
  const rawFactualStructurallyInvalidSelections = overrides.rawFactualStructurallyInvalidSelections ?? 0;
  const rawFactualUnmatchedSelections = overrides.rawFactualUnmatchedSelections ?? Math.max(0, rawFactualCandidateSelections - rawFactualSurfaceMatchedSelections - rawFactualDuplicateSelections - rawFactualStructurallyInvalidSelections);
  const rawFactualSurfaceMatchedTotal = rawFactualSurfaceMatchedSelections + rawFactualDuplicateSelections;
  const modelMatchedFactualSelections = overrides.modelMatchedFactualSelections ?? matchedClaims;
  const rawFactualSelectionReconciliation = overrides.rawFactualSelectionReconciliation || {
    matchedUniqueFactualSelections: rawFactualSurfaceMatchedSelections,
    duplicateEquivalentFactualSelections: rawFactualDuplicateSelections,
    unmatchedFactualSelections: rawFactualUnmatchedSelections,
    structurallyInvalidFactualSelections: rawFactualStructurallyInvalidSelections,
  };
  const modelAmbiguousClauses = overrides.modelAmbiguousClauses ?? 0;
  const rejectedIncompleteClauses = overrides.rejectedIncompleteClauses ?? 0;
  const deterministicFindingClauses = overrides.deterministicFindingClauses ?? 1;
  const totalLearnerClauses = overrides.totalLearnerClauses ?? Math.max(2, deterministicFindingClauses + modelAmbiguousClauses + rejectedIncompleteClauses + 1);
  const deterministicReasoningClauses = Math.max(0, totalLearnerClauses - deterministicFindingClauses - modelAmbiguousClauses - rejectedIncompleteClauses);
  const candidateDispositionSummary = overrides.candidateDispositionSummary || {
    totalLearnerClauses,
    deterministicRoutedClauses: deterministicFindingClauses + deterministicReasoningClauses,
    deterministicFindingClauses,
    modelAmbiguousClauses,
    rejectedIncompleteClauses,
    modelFacingCandidates: overrides.modelFacingCandidates ?? modelAmbiguousClauses,
    modelFacingCandidateRatio: totalLearnerClauses ? modelAmbiguousClauses / totalLearnerClauses : null,
    duplicateModelFacingCandidates: overrides.duplicateModelFacingCandidates ?? 0,
    dispositionCounts: overrides.dispositionCounts || {
      deterministic_finding: deterministicFindingClauses,
      deterministic_reasoning: deterministicReasoningClauses,
      deterministic_uncertainty: 0,
      deterministic_remediation: 0,
      deterministic_conclusion: 0,
      deterministic_non_assessment: 0,
      model_ambiguous: modelAmbiguousClauses,
      rejected_incomplete: rejectedIncompleteClauses,
    },
    partitionValid: overrides.partitionValid ?? true,
  };
  const ambiguityCoverage = overrides.ambiguityCoverage || {
    modelFacingCandidateCount: overrides.modelFacingCandidateCount ?? modelAmbiguousClauses,
    returnedSelectionCount: overrides.returnedSelectionCount ?? modelAmbiguousClauses,
    uniqueRecognizedSelectionCount: overrides.uniqueRecognizedSelectionCount ?? modelAmbiguousClauses,
    missingCandidateCount: overrides.missingCandidateCount ?? 0,
    duplicateCandidateCount: overrides.duplicateCandidateCount ?? 0,
    unknownCandidateCount: overrides.unknownCandidateCount ?? 0,
    roleCompatibleSelectionCount: overrides.roleCompatibleSelectionCount ?? modelAmbiguousClauses,
    roleIncompatibleSelectionCount: overrides.roleIncompatibleSelectionCount ?? 0,
    reconstructedSelectionCount: overrides.reconstructedSelectionCount ?? modelAmbiguousClauses,
    validatedSelectionCount: overrides.validatedSelectionCount ?? (overrides.validatedRoleClassifications ?? modelAmbiguousClauses),
    rejectedSelectionCount: overrides.rejectedSelectionCount ?? 0,
    terminalDispositionCounts: overrides.terminalDispositionCounts || {},
    arithmeticValid: overrides.coverageArithmeticValid ?? true,
  };
  const resolutionUnitBreakdown = overrides.resolutionUnitBreakdown || {
    population: category === "fully_correct" ? "fully_correct_factual_authoritative_claims" : "category_factual_authoritative_claims",
    exact: authoritativeResolutionNumerator,
    equivalent_format: 0,
    contradictory: 0,
    ambiguous: 0,
    unresolved: Math.max(0, authoritativeResolutionDenominator - authoritativeResolutionNumerator),
    inapplicable: 0,
    byKind: {
      identity: {
        exact: authoritativeResolutionNumerator,
        unresolved: Math.max(0, authoritativeResolutionDenominator - authoritativeResolutionNumerator),
      },
    },
  };
  return {
    id: `${category}-${repeat}`,
    category,
    repeat,
    status: overrides.status || "graded",
    score,
    maximumPoints,
    diagnostics: overrides.diagnostics || (category === "prompt_injection" ? [{ code: "LINUX_GRADING_INTERNAL_ID_ATTEMPT", severity: "high" }] : []),
    metrics: {
      schemaValid: overrides.schemaValid ?? true,
      surfaceClaimExtractionPrecision: overrides.surfaceClaimExtractionPrecision ?? 1,
      surfaceClaimExtractionRecall: overrides.surfaceClaimExtractionRecall ?? 1,
      surfaceFidelity: overrides.surfaceFidelity || {
        expectedSurfaceClaimCount: extractedClaims,
        extractedSurfaceClaimCount: extractedClaims,
        matchedSurfaceClaimCount: extractedClaims,
        falsePositiveSurfaceClaimCount: 0,
        falseNegativeSurfaceClaimCount: 0,
        precision: 1,
        recall: 1,
        perType: {},
      },
      claimPrecision: overrides.claimPrecision ?? (extractedClaims ? matchedClaims / extractedClaims : 1),
      claimRecall: overrides.claimRecall ?? (expectedClaims ? matchedClaims / expectedClaims : 1),
      evidencePathPrecision: overrides.evidencePathPrecision ?? 1,
      learnerStatedEvidenceReferences: overrides.learnerStatedEvidenceReferences ?? 2,
      extractedEvidenceReferences: overrides.extractedEvidenceReferences ?? 2,
      matchedEvidenceReferences: overrides.matchedEvidenceReferences ?? 2,
      evidenceReferenceExtractionPrecision: overrides.evidenceReferenceExtractionPrecision ?? 1,
      evidenceReferenceExtractionRecall: overrides.evidenceReferenceExtractionRecall ?? 1,
      validReferenceClassificationAccuracy: overrides.validReferenceClassificationAccuracy ?? 1,
      hallucinatedReferenceClassificationAccuracy: overrides.hallucinatedReferenceClassificationAccuracy ?? null,
      ambiguousReferenceClassificationAccuracy: overrides.ambiguousReferenceClassificationAccuracy ?? null,
      evidenceCreditCorrectness: overrides.evidenceCreditCorrectness ?? 1,
      anchorPrecision: overrides.anchorPrecision ?? 1,
      deterministicScoreAgreement: overrides.deterministicScoreAgreement ?? true,
      candidateDispositionSummary,
      ambiguityCoverage,
      validatedRoleClassifications: overrides.validatedRoleClassifications ?? ambiguityCoverage.validatedSelectionCount,
      validatedFactualSelections: overrides.validatedFactualSelections ?? rawFactualSurfaceMatchedSelections,
      validatedNonFactualSelections: overrides.validatedNonFactualSelections ?? overrides.validatedNonFindingSelections ?? 1,
      authoritativeFactualContributions: overrides.authoritativeFactualContributions ?? rawFactualSurfaceMatchedSelections,
      authoritativeNonFactualContributions: overrides.authoritativeNonFactualContributions ?? 0,
      extractedClaims,
      authoritativeClaims: extractedClaims,
      matchedClaims,
      expectedClaims,
      rawCandidateSelections: overrides.rawCandidateSelections ?? extractedClaims,
      rawFactualCandidateSelections,
      validatedCandidateSelections: overrides.validatedCandidateSelections ?? extractedClaims,
      validatedNonFindingSelections: overrides.validatedNonFindingSelections ?? 1,
      rejectedCandidateSelections: overrides.rejectedCandidateSelections ?? 0,
      rawMatchedClaims: overrides.rawMatchedClaims ?? rawFactualSurfaceMatchedTotal,
      modelMatchedCandidateSelections: overrides.modelMatchedCandidateSelections ?? matchedClaims,
      modelMatchedFactualSelections,
      rawFactualSurfaceMatchedSelections,
      rawFactualDuplicateSelections,
      rawFactualUnmatchedSelections,
      rawFactualStructurallyInvalidSelections,
      rawFactualSelectionReconciliation,
      rawFactualSelectionDetails: overrides.rawFactualSelectionDetails || [],
      rawSelectionPrecision: overrides.rawSelectionPrecision ?? (rawFactualCandidateSelections ? rawFactualSurfaceMatchedTotal / rawFactualCandidateSelections : null),
      rawFactualSelectionPrecision: overrides.rawFactualSelectionPrecision ?? (rawFactualCandidateSelections ? rawFactualSurfaceMatchedTotal / rawFactualCandidateSelections : null),
      rawFactualSurfaceSelectionPrecision: overrides.rawFactualSurfaceSelectionPrecision ?? (rawFactualCandidateSelections ? rawFactualSurfaceMatchedTotal / rawFactualCandidateSelections : null),
      rawFactualUniqueContributionRate: overrides.rawFactualUniqueContributionRate ?? (rawFactualCandidateSelections ? rawFactualSurfaceMatchedSelections / rawFactualCandidateSelections : null),
      rawFactualDuplicateRate: overrides.rawFactualDuplicateRate ?? (rawFactualCandidateSelections ? rawFactualDuplicateSelections / rawFactualCandidateSelections : null),
      rawFactualStructuralValidity: overrides.rawFactualStructuralValidity ?? (rawFactualCandidateSelections ? (rawFactualCandidateSelections - rawFactualStructurallyInvalidSelections) / rawFactualCandidateSelections : null),
      rawFactualAuthoritativeContributionRate: overrides.rawFactualAuthoritativeContributionRate ?? (rawFactualCandidateSelections ? modelMatchedFactualSelections / rawFactualCandidateSelections : null),
      roleClassificationAccuracy: overrides.roleClassificationAccuracy ?? 1,
      authoritativeClaimPrecision: overrides.authoritativeClaimPrecision ?? (extractedClaims ? matchedClaims / extractedClaims : 1),
      authoritativeResolutionAccuracy: overrides.authoritativeResolutionAccuracy ?? (authoritativeResolutionDenominator ? authoritativeResolutionNumerator / authoritativeResolutionDenominator : 1),
      authoritativeResolutionNumerator,
      authoritativeResolutionDenominator,
      resolutionUnitBreakdown,
      sourceClassificationCounts: overrides.sourceClassificationCounts || { deterministic_baseline: 0, validated_model_selection: extractedClaims, merged_baseline_and_model: 0, preserved_learner_contradiction: 0, unresolved_model_inference: 0 },
      rejectedSelectionReasons: overrides.rejectedSelectionReasons || {},
      citationCount: overrides.citationCount ?? 2,
      validCitations: overrides.validCitations ?? 2,
      anchorCount: 0,
      validAnchors: 0,
    },
    scoreComponents: overrides.scoreComponents || { findingPoints: score, evidencePoints: 0, reasoningPoints: 0, uncertaintyPoints: category === "valid_uncertainty" ? 2 : 0, remediationPoints: 0, penalties: 0 },
    normalizedSubmissionHash: overrides.normalizedSubmissionHash || `stable-${category}`,
  };
}

function passingPilotResults() {
  return ["fully_correct", "correct_paraphrase", "wrong_subject", "valid_uncertainty", "prompt_injection"].flatMap((category) =>
    [1, 2, 3].map((repeat) => {
      if (category === "wrong_subject") return result(category, repeat, { score: 2, maximumPoints: 20, matchedClaims: 0, extractedClaims: 1, expectedClaims: 1, claimPrecision: 0, claimRecall: 0 });
      if (category === "prompt_injection") return result(category, repeat, { score: 0, maximumPoints: 20, matchedClaims: 0, extractedClaims: 0, expectedClaims: 2, claimPrecision: 1, claimRecall: 0 });
      if (category === "valid_uncertainty") return result(category, repeat, { score: 18, maximumPoints: 20, scoreComponents: { findingPoints: 16, evidencePoints: 0, reasoningPoints: 0, uncertaintyPoints: 2, remediationPoints: 0, penalties: 0 } });
      return result(category, repeat);
    })
  );
}

function passingQualitySmokeResults() {
  return ["fully_correct", "valid_uncertainty", "ambiguous_factual", "ambiguous_non_factual"].flatMap((category) =>
    [1, 2, 3].map((repeat) => {
      if (category === "fully_correct") return result(category, repeat, { rawFactualCandidateSelections: 0, rawFactualSurfaceMatchedSelections: 0, modelMatchedFactualSelections: 0, rawCandidateSelections: 0, validatedCandidateSelections: 0, modelMatchedCandidateSelections: 0 });
      if (category === "valid_uncertainty") return result(category, repeat, { score: 18, maximumPoints: 20, rawFactualCandidateSelections: 0, rawFactualSurfaceMatchedSelections: 0, modelMatchedFactualSelections: 0, rawCandidateSelections: 0, validatedCandidateSelections: 0, modelMatchedCandidateSelections: 0, scoreComponents: { findingPoints: 16, evidencePoints: 0, reasoningPoints: 0, uncertaintyPoints: 2, remediationPoints: 0, penalties: 0 } });
      if (category === "ambiguous_non_factual") return result(category, repeat, { score: 0, maximumPoints: 20, matchedClaims: 0, extractedClaims: 0, expectedClaims: 0, rawFactualCandidateSelections: 0, rawFactualSurfaceMatchedSelections: 0, rawCandidateSelections: 1, validatedCandidateSelections: 1, validatedNonFindingSelections: 1, modelMatchedCandidateSelections: 0, modelMatchedFactualSelections: 0, roleAccuracyNumerator: 1, roleAccuracyDenominator: 1, modelAmbiguousClauses: 1, totalLearnerClauses: 2, deterministicFindingClauses: 0 });
      return result(category, repeat, { rawFactualCandidateSelections: 1, rawFactualSurfaceMatchedSelections: 1, rawCandidateSelections: 1, validatedCandidateSelections: 1, modelMatchedCandidateSelections: 1, modelMatchedFactualSelections: 1, roleAccuracyNumerator: 1, roleAccuracyDenominator: 1, modelAmbiguousClauses: 1, totalLearnerClauses: 2, deterministicFindingClauses: 0 });
    })
  );
}

function observedFalsePassResults() {
  const rows = [];
  [2, 2, 4].forEach((score, index) => rows.push(result("fully_correct", index + 1, { score, maximumPoints: 26, claimPrecision: 0, claimRecall: 0, matchedClaims: 0, extractedClaims: 1, expectedClaims: 2, normalizedSubmissionHash: `bad-full-${index}` })));
  [4, 11, 11].forEach((score, index) => rows.push(result("correct_paraphrase", index + 1, { score, maximumPoints: 28, claimPrecision: index === 0 ? 0 : 1, claimRecall: index === 0 ? 0 : 0.5, matchedClaims: index === 0 ? 0 : 1, extractedClaims: index === 0 ? 4 : 1, expectedClaims: 2, normalizedSubmissionHash: `bad-para-${index ? 1 : 0}` })));
  [1, 3, 3].forEach((score, index) => rows.push(result("wrong_subject", index + 1, { score, maximumPoints: 18, claimPrecision: 0, claimRecall: 0, matchedClaims: 0, extractedClaims: 1, expectedClaims: 1, normalizedSubmissionHash: `bad-wrong-${index ? 1 : 0}` })));
  [0, 0, 0].forEach((score, index) => rows.push(result("valid_uncertainty", index + 1, { score, maximumPoints: 20, claimPrecision: 0, claimRecall: 0, matchedClaims: 0, extractedClaims: 1, expectedClaims: 2, scoreComponents: { uncertaintyPoints: 0 }, normalizedSubmissionHash: `bad-uncert-${index}` })));
  [0, 8, 2].forEach((score, index) => rows.push(result("prompt_injection", index + 1, { score, maximumPoints: 15, claimPrecision: index === 1 ? 0.333 : 0, claimRecall: index === 1 ? 0.5 : 0, matchedClaims: index === 1 ? 1 : 0, extractedClaims: index === 0 ? 0 : 3, expectedClaims: 2, normalizedSubmissionHash: `bad-inject-${index}` })));
  return rows;
}

function gateReport(results, extras = {}) {
  return buildPilotGateReport({
    results,
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
    semanticCandidateSmoke: { ok: true },
    utf8Ok: true,
    ...extras,
  });
}

function qualitySmokeReport(results, extras = {}) {
  return buildQualitySmokeGateReport({
    results,
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
    semanticCandidateSmoke: { ok: true },
    ...extras,
  });
}

function assertFailsMutation(name, mutate) {
  const mutated = mutate(passingPilotResults());
  const report = gateReport(mutated);
  assert(name, !report.passed, JSON.stringify(report.gates.filter((gate) => !gate.passed)));
}

function main() {
  const good = gateReport(passingPilotResults());
  assert("known-good pilot fixture passes policy", good.passed, JSON.stringify(good.blockingReasons));
  assert("known-good pilot report self-validation passes", good.selfValidation.ok, JSON.stringify(good.selfValidation));
  const goodSmoke = qualitySmokeReport(passingQualitySmokeResults());
  assert("known-good quality-smoke fixture passes policy", goodSmoke.passed, JSON.stringify(goodSmoke.blockingReasons));
  assert("known-good quality-smoke self-validation passes", goodSmoke.selfValidation.ok, JSON.stringify(goodSmoke.selfValidation));

  const bad = gateReport(observedFalsePassResults());
  assert("observed false-pass pilot metrics are rejected", !bad.passed, JSON.stringify(bad.blockingReasons));
  assert("observed false-pass gate report arithmetic is internally valid", bad.selfValidation.ok, JSON.stringify(bad.selfValidation));
  assert("observed false-pass blocks recall gate", bad.gates.some((gate) => gate.name === "correct_case_typed_claim_recall" && !gate.passed));
  assert("observed false-pass blocks fully-correct score gate", bad.gates.some((gate) => gate.name === "fully_correct_mean_normalized_score" && !gate.passed));
  assert("observed false-pass blocks valid uncertainty gate", bad.gates.some((gate) => gate.name === "valid_uncertainty_credit" && !gate.passed));
  assert("observed false-pass blocks stability gate", bad.gates.some((gate) => gate.name === "normalized_submission_stability" && !gate.passed));

  assertFailsMutation("precision mutation fails pilot", (rows) => rows.map((row) => row.category === "fully_correct" ? { ...row, metrics: { ...row.metrics, claimPrecision: 0.5, matchedClaims: 1, extractedClaims: 2 } } : row));
  assertFailsMutation("recall mutation fails pilot", (rows) => rows.map((row) => row.category === "correct_paraphrase" ? { ...row, metrics: { ...row.metrics, claimRecall: 0.5, matchedClaims: 1, expectedClaims: 2 } } : row));
  assertFailsMutation("normalized score mutation fails pilot", (rows) => rows.map((row) => row.category === "fully_correct" ? { ...row, score: 2 } : row));
  assertFailsMutation("resolution mutation fails pilot", (rows) => rows.map((row) => row.category === "fully_correct" ? { ...row, metrics: { ...row.metrics, matchedClaims: 0 } } : row));
  assertFailsMutation("uncertainty credit mutation fails pilot", (rows) => rows.map((row) => row.category === "valid_uncertainty" ? { ...row, scoreComponents: { ...row.scoreComponents, uncertaintyPoints: 0 } } : row));
  assertFailsMutation("security success mutation fails pilot", (rows) => rows.map((row) => row.category === "prompt_injection" ? { ...row, diagnostics: [] } : row));
  assertFailsMutation("hash stability mutation fails pilot", (rows) => rows.map((row) => row.category === "fully_correct" ? { ...row, normalizedSubmissionHash: `${row.normalizedSubmissionHash}-${row.repeat}` } : row));

  const arithmeticBroken = JSON.parse(JSON.stringify(good));
  arithmeticBroken.gates.find((gate) => gate.name === "correct_case_typed_claim_precision").observedValue = 0.123;
  assert("ratio arithmetic invariant rejects mismatched observed value", !validatePilotGateReport(arithmeticBroken, passingPilotResults()).ok);
  const categoryBroken = JSON.parse(JSON.stringify(good));
  categoryBroken.categorySummaries.fully_correct.hashCount = 99;
  assert("category/hash reconciliation invariant rejects bad summary", !validatePilotGateReport(categoryBroken, passingPilotResults()).ok);
  const varianceBroken = JSON.parse(JSON.stringify(good));
  varianceBroken.categorySummaries.fully_correct.scoreVariance = 99;
  assert("variance reconciliation invariant rejects bad summary", !validatePilotGateReport(varianceBroken, passingPilotResults()).ok);
  const contradictionBroken = JSON.parse(JSON.stringify(good));
  contradictionBroken.categorySummaries.fully_correct.explicitLearnerContradictionsPreserved = 1;
  contradictionBroken.categorySummaries.fully_correct.sourceClassificationCounts.preserved_learner_contradiction = 0;
  assert("source contradiction reconciliation rejects mismatched summary", !validatePilotGateReport(contradictionBroken, passingPilotResults()).ok);
  const sourceTotalBroken = JSON.parse(JSON.stringify(good));
  sourceTotalBroken.categorySummaries.fully_correct.sourceClassificationCounts.validated_model_selection = 99;
  assert("authoritative source-total reconciliation rejects mismatched summary", !validatePilotGateReport(sourceTotalBroken, passingPilotResults()).ok);
  const rawResultBroken = passingPilotResults();
  rawResultBroken[0].metrics.rawFactualCandidateSelections = 2;
  rawResultBroken[0].metrics.rawFactualSurfaceMatchedSelections = 1;
  rawResultBroken[0].metrics.rawFactualDuplicateSelections = 0;
  rawResultBroken[0].metrics.rawFactualUnmatchedSelections = 0;
  rawResultBroken[0].metrics.rawFactualStructurallyInvalidSelections = 0;
  rawResultBroken[0].metrics.rawFactualSelectionReconciliation = {
    matchedUniqueFactualSelections: 1,
    duplicateEquivalentFactualSelections: 0,
    unmatchedFactualSelections: 0,
    structurallyInvalidFactualSelections: 0,
  };
  assert("raw factual selection self-validation rejects unreconciled terminal buckets", !validatePilotGateReport(gateReport(rawResultBroken), rawResultBroken).ok);
  const rawCategoryBroken = JSON.parse(JSON.stringify(good));
  rawCategoryBroken.categorySummaries.fully_correct.rawFactualSelectionReconciliation.unmatchedFactualSelections += 1;
  assert("category raw factual reconciliation rejects mismatched bucket totals", !validatePilotGateReport(rawCategoryBroken, passingPilotResults()).ok);

  const codeVersion = {
    extractorSchemaVersion: "schema",
    extractorSchemaHash: "hash",
    harnessVersion: "harness",
    gatePolicyVersion: GATE_POLICY_VERSION,
    qualitySmokeCaseSetVersion: QUALITY_SMOKE_CASE_SET_VERSION,
    pilotCaseSetVersion: PILOT_CASE_SET_VERSION,
    behaviorSmokeCaseSetVersion: "phase12-behavior-smoke-case-set-v2-wrong-state",
    fullCaseSetVersion: FULL_CASE_SET_VERSION,
    metricOracleVersion: "phase12-surface-claim-oracle-v1",
    extractionBehaviorHash: "behavior-hash",
    candidateRegistryImplementationHash: "candidate-registry-hash",
    candidateAdjudicationImplementationHash: "candidate-adjudication-hash",
  };
  const smokeArtifact = {
    ...codeVersion,
    passed: true,
    status: "LIVE_QUALITY_SMOKE_PASSED",
    qualitySmokeGateReport: goodSmoke,
    cases: passingQualitySmokeResults(),
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
  };
  assert("pilot mode accepts current passed quality-smoke artifact", validateQualitySmokeArtifactForPilotMode(smokeArtifact, codeVersion).ok);
  const staleSmoke = { ...smokeArtifact, extractorSchemaHash: "old-hash" };
  assert("pilot mode rejects stale quality-smoke artifact", !validateQualitySmokeArtifactForPilotMode(staleSmoke, codeVersion).ok);
  const failedSmoke = { ...smokeArtifact, passed: false, status: "LIVE_QUALITY_SMOKE_FAILED" };
  assert("pilot mode rejects failed quality-smoke artifact", !validateQualitySmokeArtifactForPilotMode(failedSmoke, codeVersion).ok);

  const falsePassArtifact = {
    ...codeVersion,
    passed: true,
    status: "LIVE_PILOT_PASSED",
    cases: observedFalsePassResults(),
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
  };
  const validation = validatePilotArtifactForFullMode(falsePassArtifact, codeVersion);
  assert("full mode rejects stored passed=true artifact with failed gates", !validation.ok && validation.gateReport && !validation.gateReport.passed, JSON.stringify(validation));

  const behaviorRows = ["wrong_subject", "wrong_relationship", "wrong_state_timestamp", "hallucinated_evidence", "valid_uncertainty", "unsupported_certainty", "strong_remediation", "vague_remediation", "prompt_injection"].map((category, index) => {
    const overrides = {};
    if (category.startsWith("wrong_")) {
      const type = category === "wrong_state_timestamp" ? "wrong_state_value" : category;
      overrides.surfaceFidelity = {
        expectedSurfaceClaimCount: 2,
        extractedSurfaceClaimCount: 2,
        matchedSurfaceClaimCount: 2,
        falsePositiveSurfaceClaimCount: 0,
        falseNegativeSurfaceClaimCount: 0,
        precision: 1,
        recall: 1,
        perType: {
          factual: { expected: 1, extracted: 1, matched: 1, falsePositive: 0, falseNegative: 0 },
          wrong_value: { expected: 1, extracted: 1, matched: 1, falsePositive: 0, falseNegative: 0 },
          wrong_subject: { expected: type === "wrong_subject" ? 1 : 0, extracted: type === "wrong_subject" ? 1 : 0, matched: type === "wrong_subject" ? 1 : 0, falsePositive: 0, falseNegative: 0 },
          wrong_relationship: { expected: type === "wrong_relationship" ? 1 : 0, extracted: type === "wrong_relationship" ? 1 : 0, matched: type === "wrong_relationship" ? 1 : 0, falsePositive: 0, falseNegative: 0 },
          wrong_state_value: { expected: type === "wrong_state_value" ? 1 : 0, extracted: type === "wrong_state_value" ? 1 : 0, matched: type === "wrong_state_value" ? 1 : 0, falsePositive: 0, falseNegative: 0 },
        },
      };
    }
    if (category === "hallucinated_evidence") {
      overrides.diagnostics = [{ code: "LINUX_GRADING_EVIDENCE_HALLUCINATION", severity: "medium" }];
      overrides.hallucinatedReferenceClassificationAccuracy = 1;
      overrides.evidenceCreditCorrectness = 1;
    }
    if (category === "unsupported_certainty") {
      overrides.diagnostics = [{ code: "LINUX_GRADING_UNSUPPORTED_CERTAINTY", severity: "medium" }];
      overrides.scoreComponents = { findingPoints: 10, evidencePoints: 0, reasoningPoints: 0, uncertaintyPoints: 0, remediationPoints: 0, penalties: 2 };
    }
    if (category === "strong_remediation") {
      overrides.score = 18;
      overrides.maximumPoints = 20;
      overrides.scoreComponents = { findingPoints: 14, evidencePoints: 0, reasoningPoints: 0, uncertaintyPoints: 0, remediationPoints: 4, penalties: 0 };
    }
    if (category === "vague_remediation") {
      overrides.score = 14;
      overrides.maximumPoints = 20;
      overrides.scoreComponents = { findingPoints: 14, evidencePoints: 0, reasoningPoints: 0, uncertaintyPoints: 0, remediationPoints: 0, penalties: 0 };
    }
    if (category === "prompt_injection") overrides.diagnostics = [{ code: "LINUX_GRADING_INTERNAL_ID_ATTEMPT", severity: "high" }];
    return result(category, index + 1, overrides);
  });
  const behaviorReport = buildBehaviorSmokeGateReport({ results: behaviorRows, connectivity: { ok: true }, productionSchemaSmoke: { ok: true }, semanticCandidateSmoke: { ok: true } });
  assert("known-good behavior-smoke fixture passes policy", behaviorReport.passed, JSON.stringify(behaviorReport.blockingReasons));
  assert("behavior-smoke wrong-claim arithmetic reconciles per type", behaviorReport.gates.find((gate) => gate.name === "wrong_claim_extraction_fidelity").numerator === 3 && behaviorReport.gates.find((gate) => gate.name === "wrong_claim_extraction_fidelity").denominator === 3 && behaviorReport.selfValidation.ok, JSON.stringify(behaviorReport.wrongClaimFidelityByType));
  const badWrongArithmetic = JSON.parse(JSON.stringify(behaviorReport));
  const badWrongGate = badWrongArithmetic.gates.find((gate) => gate.name === "wrong_claim_extraction_fidelity");
  badWrongGate.numerator = 4;
  badWrongGate.denominator = 9;
  badWrongGate.observedValue = 4 / 9;
  assert("behavior-smoke rejects broad surface metric substitution", !validateBehaviorSmokeGateReport(badWrongArithmetic).ok, JSON.stringify(badWrongArithmetic));
  const failedBehavior = buildBehaviorSmokeGateReport({ results: behaviorRows.map((row) => row.category === "hallucinated_evidence" ? { ...row, diagnostics: [], metrics: { ...row.metrics, hallucinatedReferenceClassificationAccuracy: 0 } } : row), connectivity: { ok: true }, productionSchemaSmoke: { ok: true }, semanticCandidateSmoke: { ok: true } });
  assert("behavior-smoke gate rejects missing hallucination diagnostic", !failedBehavior.passed && failedBehavior.gates.some((gate) => gate.name === "hallucinated_evidence_detection" && !gate.passed), JSON.stringify(failedBehavior));
  const fullReport = buildFullGateReport({ results: behaviorRows.concat(["fully_correct", "correct_paraphrase", "partial", "wrong_state_timestamp", "internal_id_attack"].map((category, index) => result(category, index + 1, category === "internal_id_attack" ? { diagnostics: [{ code: "LINUX_GRADING_INTERNAL_ID_ATTEMPT", severity: "high" }] } : {}))), connectivity: { ok: true }, productionSchemaSmoke: { ok: true }, semanticCandidateSmoke: { ok: true }, stabilityCases: [{ variance: 0 }], utf8Ok: true });
  assert("full gate report exposes blocking gates explicitly", Array.isArray(fullReport.gates) && fullReport.gates.some((gate) => gate.name === "surface_claim_extraction_precision") && fullReport.gates.every((gate) => Object.prototype.hasOwnProperty.call(gate, "passed")), JSON.stringify(fullReport.gates));
  const behaviorArtifact = { ...codeVersion, passed: true, status: "LIVE_BEHAVIOR_SMOKE_PASSED", behaviorSmokeGateReport: behaviorReport, cases: behaviorRows, connectivity: { ok: true }, productionSchemaSmoke: { ok: true }, semanticCandidateSmoke: { ok: true } };
  assert("full mode accepts current passed behavior-smoke artifact", validateBehaviorSmokeArtifactForFullMode(behaviorArtifact, codeVersion).ok);
  assert("full mode rejects stale behavior-smoke artifact", !validateBehaviorSmokeArtifactForFullMode({ ...behaviorArtifact, extractionBehaviorHash: "old" }, codeVersion).ok);

  const reportPath = path.join(os.tmpdir(), `phase12-utf8-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ finalVerdict: LIVE_FAILED, pending: LIVE_PENDING }), "utf8");
  const bytes = fs.readFileSync(reportPath);
  const decoded = bytes.toString("utf8");
  const parsed = JSON.parse(decoded);
  assert("UTF-8 byte round trip keeps exact verdict", parsed.finalVerdict === LIVE_FAILED && parsed.pending === LIVE_PENDING, decoded);
  assert("UTF-8 byte round trip rejects mojibake markers", !/Ãƒ|Ã¢|Ã¢â€šÂ¬|�/.test(decoded), decoded);

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
