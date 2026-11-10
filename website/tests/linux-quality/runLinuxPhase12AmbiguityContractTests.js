#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const {
  buildCandidate,
  compileIfNeeded,
  loadPhase11,
} = require("./linuxPhase11GradingTestUtils");
const {
  answerFor,
  buildCorpus,
  buildQualitySmokeGateReport,
} = require("./runLinuxPhase12LiveGradingTests.js");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function extraction(schema, contract, registry, candidateSelections) {
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

function selectionFor(schema, contract, registry, clause, role, overrides = {}) {
  void schema;
  const sameClause = registry.candidates.filter((candidate) => candidate.clauseId === clause.id || candidate.id === clause.id);
  const identity = sameClause.find((candidate) => candidate.type === "identity") || sameClause.find((candidate) => ["command", "file", "service", "timestamp", "state"].includes(candidate.type));
  const evidence = sameClause.find((candidate) => candidate.type === "evidence_reference");
  return {
    clauseId: clause.id,
    role,
    primaryEntityCandidateId: identity?.id || null,
    secondaryEntityCandidateId: null,
    subjectCandidateId: identity?.id || null,
    objectCandidateId: null,
    valueCandidateId: identity?.id || null,
    timestampCandidateId: null,
    stateCandidateId: null,
    evidenceReferenceIds: evidence ? [evidence.id] : [],
    reasoningClauseIds: [],
    uncertaintyCandidateIds: [],
    remediationCandidateIds: [],
    conclusionCandidateIds: [],
    predicateLabel: role === "finding" ? "authenticated" : null,
    confidence: "candidate",
    extractionConfidence: "high",
    ...overrides,
  };
}

function modelFacingClauses(registry) {
  return registry.candidates.filter((candidate) => candidate.type === "clause" && candidate.disposition === "model_ambiguous");
}

function codes(result) {
  return (result.diagnostics || []).map((issue) => issue.code);
}

function terminalTotal(coverage) {
  return Object.values(coverage.terminalDispositionCounts || {}).reduce((sum, count) => sum + (count || 0), 0);
}

function clauseForRole(registry, role) {
  return registry.candidates.find((candidate) => candidate.type === "clause" && candidate.allowedRoles?.includes(role));
}

async function gradeSelection(freeForm, schema, contract, answer, role, overrides = {}) {
  const registry = freeForm.buildLinuxLearnerCandidateRegistry(contract, answer);
  const clause = clauseForRole(registry, role);
  const result = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: answer,
    rawExtractionObject: extraction(schema, contract, registry, [selectionFor(schema, contract, registry, clause, role, overrides)]),
  });
  return { result, registry, clause };
}

function assertRoleReconciliation(name, stages) {
  const coverage = stages.ambiguityCoverage;
  const population = coverage.modelFacingCandidateCount > 0 ? coverage.uniqueRecognizedSelectionCount : stages.rawCandidateSelections;
  assert(`${name} role reconciliation`, stages.validatedRoleClassifications + stages.rejectedRoleClassifications === population, JSON.stringify(stages));
  assert(`${name} validated split reconciliation`, stages.validatedFactualSelections + stages.validatedNonFactualSelections === stages.validatedRoleClassifications, JSON.stringify(stages));
}

async function main() {
  const out = compileIfNeeded("phase12-ambiguity-contract");
  const { linux, assessment, schema, freeForm } = loadPhase11(out);
  const corpus = buildCorpus(linux, assessment);
  const factualItem = corpus.find((item) => item.category === "ambiguous_factual");
  const nonFactualItem = corpus.find((item) => item.category === "ambiguous_non_factual");
  const identityFinding = factualItem.contract.requiredFindings.find((finding) => finding.expectedValue.kind === "identity") || factualItem.contract.requiredFindings[0];
  const username = identityFinding.expectedValue.username || "casey.soc";
  const factualAnswer = `The account ${username} authenticated but attribution is not proven`;
  const nonFactualAnswer = answerFor(nonFactualItem.contract, "ambiguous_non_factual");
  const factualRegistry = freeForm.buildLinuxLearnerCandidateRegistry(factualItem.contract, factualAnswer);
  const nonFactualRegistry = freeForm.buildLinuxLearnerCandidateRegistry(nonFactualItem.contract, nonFactualAnswer);
  const factualClause = modelFacingClauses(factualRegistry)[0];
  const nonFactualClause = modelFacingClauses(nonFactualRegistry)[0];

  assert("fixture has factual ambiguity clause", factualClause && factualClause.allowedRoles.includes("finding"), JSON.stringify(modelFacingClauses(factualRegistry)));
  assert("fixture has non-factual ambiguity clause", nonFactualClause && nonFactualClause.allowedRoles.includes("non_assessment"), JSON.stringify(modelFacingClauses(nonFactualRegistry)));

  const factualResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract: factualItem.contract,
    learnerAnswer: factualAnswer,
    rawExtractionObject: extraction(schema, factualItem.contract, factualRegistry, [selectionFor(schema, factualItem.contract, factualRegistry, factualClause, "finding")]),
  });
  assert("one-to-one factual ambiguity classification validates coverage", factualResult.status === "graded" && factualResult.candidateSelectionStages.ambiguityCoverage.uniqueRecognizedSelectionCount === 1 && factualResult.candidateSelectionStages.validatedFactualSelections === 1, JSON.stringify(factualResult.candidateSelectionStages));

  const nonFactualResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: nonFactualAnswer,
    rawExtractionObject: extraction(schema, nonFactualItem.contract, nonFactualRegistry, [selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment")]),
  });
  assert("one-to-one non-factual ambiguity classification validates without factual authority", nonFactualResult.status === "graded" && nonFactualResult.candidateSelectionStages.validatedNonFactualSelections === 1 && nonFactualResult.candidateSelectionStages.authoritativeFactualContributions === 0, JSON.stringify(nonFactualResult.candidateSelectionStages));

  const missing = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: nonFactualAnswer,
    rawExtractionObject: extraction(schema, nonFactualItem.contract, nonFactualRegistry, []),
  });
  assert("missing ambiguity selection is diagnosed", missing.status === "graded" && codes(missing).includes("LINUX_GRADING_AMBIGUOUS_CANDIDATE_MISSING_SELECTION"), JSON.stringify(missing));

  const duplicate = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: nonFactualAnswer,
    rawExtractionObject: extraction(schema, nonFactualItem.contract, nonFactualRegistry, [
      selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment"),
      selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment"),
    ]),
  });
  assert("duplicate ambiguity selection is diagnosed without opaque terminal inflation", duplicate.status === "graded" && duplicate.candidateSelectionStages.ambiguityCoverage.duplicateCandidateCount === 1 && terminalTotal(duplicate.candidateSelectionStages.ambiguityCoverage) <= duplicate.candidateSelectionStages.ambiguityCoverage.returnedSelectionCount + duplicate.candidateSelectionStages.ambiguityCoverage.missingCandidateCount, JSON.stringify(duplicate.candidateSelectionStages.ambiguityCoverage));

  const unknown = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: nonFactualAnswer,
    rawExtractionObject: extraction(schema, nonFactualItem.contract, nonFactualRegistry, [{ ...selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment"), clauseId: "clause_9999" }]),
  });
  assert("unknown ambiguity selection is diagnosed", unknown.status === "graded" && codes(unknown).includes("LINUX_GRADING_AMBIGUOUS_CANDIDATE_UNKNOWN_SELECTION"), JSON.stringify(unknown));

  const wrongRole = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: nonFactualAnswer,
    rawExtractionObject: extraction(schema, nonFactualItem.contract, nonFactualRegistry, [selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "finding")]),
  });
  assert("role-incompatible ambiguity selection is diagnosed", wrongRole.status === "graded" && codes(wrongRole).includes("LINUX_GRADING_AMBIGUOUS_CANDIDATE_ROLE_INCOMPATIBLE"), JSON.stringify(wrongRole));

  const invalidEntity = await freeForm.gradeLinuxFreeFormAssessment({
    contract: factualItem.contract,
    learnerAnswer: factualAnswer,
    rawExtractionObject: extraction(schema, factualItem.contract, factualRegistry, [selectionFor(schema, factualItem.contract, factualRegistry, factualClause, "finding", {
      primaryEntityCandidateId: "identity_9999",
      subjectCandidateId: "identity_9999",
      valueCandidateId: "identity_9999",
    })]),
  });
  assert("invalid optional entity IDs are recovered without discarding role classification", invalidEntity.status === "graded" && invalidEntity.candidateSelectionStages.validatedFactualSelections === 1 && codes(invalidEntity).includes("LINUX_GRADING_CANDIDATE_ID_RECOVERED_FROM_CLAUSE") && invalidEntity.candidateSelectionStages.ambiguityCoverage.terminalDispositionCounts.validated_factual_reconstructed === 1, JSON.stringify(invalidEntity));
  assert("entity ID defect never emits unknown clause candidate diagnostic", !codes(invalidEntity).includes("LINUX_GRADING_UNKNOWN_CANDIDATE_ID"), JSON.stringify(invalidEntity.diagnostics));

  const noEntityNonAssessment = await gradeSelection(freeForm, schema, nonFactualItem.contract, "Evidence cited: auth.log and sudo.log only.", "non_assessment", {
    primaryEntityCandidateId: null,
    subjectCandidateId: null,
    valueCandidateId: null,
  });
  assert("compatible non-assessment role with all entity IDs null validates", noEntityNonAssessment.result.status === "graded" && noEntityNonAssessment.result.candidateSelectionStages.validatedNonFactualSelections === 1 && noEntityNonAssessment.result.candidateSelectionStages.ambiguityCoverage.terminalDispositionCounts.validated_non_factual_role === 1, JSON.stringify(noEntityNonAssessment.result));
  assertRoleReconciliation("non-assessment null entities", noEntityNonAssessment.result.candidateSelectionStages);

  const reasoningInvalidEntities = await gradeSelection(freeForm, schema, nonFactualItem.contract, "Reasoning: auth.log corroborates sudo.log for the session.", "reasoning", {
    primaryEntityCandidateId: "identity_404",
    subjectCandidateId: "identity_404",
    valueCandidateId: "identity_404",
  });
  assert("compatible reasoning role with invalid entity IDs validates", reasoningInvalidEntities.result.status === "graded" && reasoningInvalidEntities.result.candidateSelectionStages.validatedNonFactualSelections === 1 && codes(reasoningInvalidEntities.result).includes("LINUX_GRADING_UNKNOWN_OPTIONAL_ENTITY_ID"), JSON.stringify(reasoningInvalidEntities.result));

  const uncertaintyUnknownEntities = await gradeSelection(freeForm, schema, nonFactualItem.contract, "Attribution is not proven and requires validation.", "uncertainty", {
    primaryEntityCandidateId: "identity_405",
    uncertaintyCandidateIds: ["uncertainty_405"],
  });
  assert("compatible uncertainty role with unknown entity IDs validates", uncertaintyUnknownEntities.result.status === "graded" && uncertaintyUnknownEntities.result.candidateSelectionStages.validatedNonFactualSelections === 1 && codes(uncertaintyUnknownEntities.result).includes("LINUX_GRADING_UNKNOWN_OPTIONAL_ENTITY_ID"), JSON.stringify(uncertaintyUnknownEntities.result));

  const remediationTypeMismatch = await gradeSelection(freeForm, schema, nonFactualItem.contract, "Recommended action: rotate the key and review sudo access.", "remediation", {
    remediationCandidateIds: [clauseForRole(freeForm.buildLinuxLearnerCandidateRegistry(nonFactualItem.contract, "Recommended action: rotate the key and review sudo access."), "remediation").id],
  });
  assert("compatible remediation role with entity type mismatch validates", remediationTypeMismatch.result.status === "graded" && remediationTypeMismatch.result.candidateSelectionStages.validatedNonFactualSelections === 1 && codes(remediationTypeMismatch.result).includes("LINUX_GRADING_OPTIONAL_ENTITY_TYPE_MISMATCH"), JSON.stringify(remediationTypeMismatch.result));

  const conclusionDuplicateEntities = await gradeSelection(freeForm, schema, nonFactualItem.contract, "Conclusion: full host compromise is shown.", "conclusion", {
    primaryEntityCandidateId: "clause_0",
    subjectCandidateId: "clause_0",
    valueCandidateId: "clause_0",
    conclusionCandidateIds: ["clause_0", "clause_0"],
  });
  assert("compatible conclusion role with duplicate/mistyped entity IDs validates", conclusionDuplicateEntities.result.status === "graded" && conclusionDuplicateEntities.result.candidateSelectionStages.validatedNonFactualSelections === 1 && codes(conclusionDuplicateEntities.result).includes("LINUX_GRADING_OPTIONAL_ENTITY_TYPE_MISMATCH"), JSON.stringify(conclusionDuplicateEntities.result));

  for (const [name, result] of [
    ["reasoning invalid entities", reasoningInvalidEntities.result],
    ["uncertainty unknown entities", uncertaintyUnknownEntities.result],
    ["remediation type mismatch", remediationTypeMismatch.result],
    ["conclusion duplicate entities", conclusionDuplicateEntities.result],
  ]) {
    assert(`${name} does not emit unsupported relationship`, !codes(result).includes("LINUX_GRADING_UNSUPPORTED_CANDIDATE_RELATIONSHIP"), JSON.stringify(result.diagnostics));
    assertRoleReconciliation(name, result.candidateSelectionStages);
  }

  const validFactual = await gradeSelection(freeForm, schema, factualItem.contract, factualAnswer, "finding");
  assert("compatible factual role with valid entity IDs validates", validFactual.result.status === "graded" && validFactual.result.candidateSelectionStages.validatedFactualSelections === 1 && validFactual.result.candidateSelectionStages.ambiguityCoverage.terminalDispositionCounts.validated_factual_enriched === 1, JSON.stringify(validFactual.result));

  const failedFactual = await gradeSelection(freeForm, schema, factualItem.contract, "Someone logged in.", "finding", {
    primaryEntityCandidateId: null,
    subjectCandidateId: null,
    valueCandidateId: null,
  });
  assert("compatible factual role with failed reconstruction keeps role validated and rejects authority only", failedFactual.result.status === "graded" && failedFactual.result.candidateSelectionStages.validatedRoleClassifications === 1 && failedFactual.result.candidateSelectionStages.validatedFactualSelections === 1 && failedFactual.result.candidateSelectionStages.authoritativeFactualContributions === 0 && failedFactual.result.candidateSelectionStages.ambiguityCoverage.terminalDispositionCounts.validated_role_factual_reconstruction_failed === 1 && codes(failedFactual.result).includes("LINUX_GRADING_FACTUAL_RECONSTRUCTION_FAILED") && !codes(failedFactual.result).includes("LINUX_GRADING_UNSUPPORTED_CANDIDATE_RELATIONSHIP"), JSON.stringify(failedFactual.result));
  assertRoleReconciliation("failed factual reconstruction", failedFactual.result.candidateSelectionStages);

  let retryCalls = 0;
  const retryRepair = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: nonFactualAnswer,
    extractor: () => {
      retryCalls += 1;
      return {
        ok: true,
        rawText: "{}",
        parsed: retryCalls === 1
          ? extraction(schema, nonFactualItem.contract, nonFactualRegistry, [])
          : extraction(schema, nonFactualItem.contract, nonFactualRegistry, [selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment")]),
      };
    },
  });
  assert("retry repairs incomplete ambiguity coverage", retryRepair.status === "graded" && retryCalls === 2 && retryRepair.candidateSelectionStages.ambiguityCoverage.missingCandidateCount === 0, JSON.stringify(retryRepair));
  assert("retry repair records accepted attempt two", retryRepair.acceptedExtractionAttemptIndex === 2 && retryRepair.extractionAttemptCoverage.length === 2 && retryRepair.extractionAttemptCoverage[0].coverageComplete === false && retryRepair.extractionAttemptCoverage[1].coverageComplete === true, JSON.stringify(retryRepair.extractionAttemptCoverage));

  let failedRetryCalls = 0;
  const retryFailed = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: nonFactualAnswer,
    extractor: () => {
      failedRetryCalls += 1;
      return { ok: true, rawText: "{}", parsed: extraction(schema, nonFactualItem.contract, nonFactualRegistry, []) };
    },
  });
  assert("retry remains incomplete and safely fails without scoring", retryFailed.status === "retryable" && failedRetryCalls === 2 && codes(retryFailed).includes("LINUX_GRADING_AMBIGUOUS_CANDIDATE_COVERAGE_INCOMPLETE"), JSON.stringify(retryFailed));
  assert("failed retry preserves request candidate counts and registry hash", retryFailed.candidateSelectionStages.candidateDispositionSummary.modelAmbiguousClauses > 0 && retryFailed.candidateSelectionStages.candidateDispositionSummary.modelFacingCandidates > 0 && retryFailed.extractionAttemptCoverage[0].candidateRegistryHash === nonFactualRegistry.registryHash && retryFailed.extractionAttemptCoverage[1].requestedCandidateCount === retryFailed.extractionAttemptCoverage[0].requestedCandidateCount, JSON.stringify(retryFailed));

  let unknownRepairCalls = 0;
  const unknownRequests = [];
  const unknownRepair = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: nonFactualAnswer,
    extractor: (request) => {
      unknownRepairCalls += 1;
      unknownRequests.push(request);
      return {
        ok: true,
        rawText: "{}",
        parsed: unknownRepairCalls === 1
          ? extraction(schema, nonFactualItem.contract, nonFactualRegistry, [{ ...selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment"), clauseId: "identity_0" }])
          : extraction(schema, nonFactualItem.contract, nonFactualRegistry, [selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment")]),
      };
    },
  });
  assert("unknown ID rejected on attempt one and repaired on attempt two", unknownRepair.status === "graded" && unknownRepairCalls === 2 && unknownRepair.extractionAttemptCoverage[0].unknownCandidateCount === 1 && unknownRepair.extractionAttemptCoverage[1].unknownCandidateCount === 0 && unknownRepair.acceptedExtractionAttemptIndex === 2, JSON.stringify(unknownRepair.extractionAttemptCoverage));
  assert("retry instruction is materially corrective and safe", unknownRequests.length === 2 && unknownRequests[1].prompt !== unknownRequests[0].prompt && /candidate_selection_retry_correction/.test(unknownRequests[1].prompt) && /Expected model-facing clause candidate count/.test(unknownRequests[1].prompt) && !/finding:|assessmentContractHash|answer key/i.test(unknownRequests[1].retryInstruction || ""), JSON.stringify(unknownRequests.map((request) => ({ retryInstruction: request.retryInstruction, retryAttempt: request.retryAttempt }))));

  let unknownRepeatCalls = 0;
  const unknownRepeat = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: nonFactualAnswer,
    extractor: () => {
      unknownRepeatCalls += 1;
      return {
        ok: true,
        rawText: "{}",
        parsed: extraction(schema, nonFactualItem.contract, nonFactualRegistry, [{ ...selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment"), clauseId: "identity_0" }]),
      };
    },
  });
  assert("unknown ID repeated on attempt two safely fails", unknownRepeat.status === "retryable" && unknownRepeatCalls === 2 && unknownRepeat.acceptedExtractionAttemptIndex === null && unknownRepeat.extractionAttemptCoverage.every((attempt) => attempt.unknownCandidateCount === 1), JSON.stringify(unknownRepeat));

  let duplicateRepairCalls = 0;
  const duplicateRepair = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: nonFactualAnswer,
    extractor: () => {
      duplicateRepairCalls += 1;
      return {
        ok: true,
        rawText: "{}",
        parsed: duplicateRepairCalls === 1
          ? extraction(schema, nonFactualItem.contract, nonFactualRegistry, [
            selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment"),
            selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment"),
          ])
          : extraction(schema, nonFactualItem.contract, nonFactualRegistry, [selectionFor(schema, nonFactualItem.contract, nonFactualRegistry, nonFactualClause, "non_assessment")]),
      };
    },
  });
  assert("duplicate candidate repaired on retry", duplicateRepair.status === "graded" && duplicateRepair.extractionAttemptCoverage[0].duplicateCandidateCount === 1 && duplicateRepair.extractionAttemptCoverage[1].duplicateCandidateCount === 0, JSON.stringify(duplicateRepair.extractionAttemptCoverage));

  const twoCandidateAnswer = `${nonFactualAnswer} ${factualAnswer}`;
  const twoCandidateRegistry = freeForm.buildLinuxLearnerCandidateRegistry(nonFactualItem.contract, twoCandidateAnswer);
  const twoModelClauses = modelFacingClauses(twoCandidateRegistry);
  const twoCandidateResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract: nonFactualItem.contract,
    learnerAnswer: twoCandidateAnswer,
    rawExtractionObject: extraction(schema, nonFactualItem.contract, twoCandidateRegistry, twoModelClauses.map((clause) => selectionFor(schema, nonFactualItem.contract, twoCandidateRegistry, clause, clause.allowedRoles[0]))),
  });
  assert("multiple candidates all classified once", twoModelClauses.length > 1 && twoCandidateResult.status === "graded" && twoCandidateResult.candidateSelectionStages.ambiguityCoverage.uniqueRecognizedSelectionCount === twoModelClauses.length && twoCandidateResult.candidateSelectionStages.ambiguityCoverage.duplicateCandidateCount === 0, JSON.stringify(twoCandidateResult.candidateSelectionStages.ambiguityCoverage));

  const nullPrecisionReport = buildQualitySmokeGateReport({
    results: [{
      id: "ambiguous_factual-null",
      category: "ambiguous_factual",
      status: "graded",
      score: 0,
      maximumPoints: 20,
      diagnostics: [],
      metrics: {
        schemaValid: true,
        matchedClaims: 0,
        expectedClaims: 1,
        extractedClaims: 0,
        authoritativeClaims: 0,
        rawFactualCandidateSelections: 0,
        rawMatchedClaims: 0,
        rawCandidateSelections: 0,
        validatedCandidateSelections: 0,
        modelMatchedCandidateSelections: 0,
        modelMatchedFactualSelections: 0,
        deterministicScoreAgreement: true,
        candidateDispositionSummary: { totalLearnerClauses: 1, deterministicRoutedClauses: 0, deterministicFindingClauses: 0, modelAmbiguousClauses: 1, rejectedIncompleteClauses: 0, modelFacingCandidates: 1, modelFacingCandidateRatio: 1, duplicateModelFacingCandidates: 0, dispositionCounts: { model_ambiguous: 1 }, partitionValid: true },
        ambiguityCoverage: { modelFacingCandidateCount: 1, returnedSelectionCount: 0, uniqueRecognizedSelectionCount: 0, missingCandidateCount: 1, duplicateCandidateCount: 0, unknownCandidateCount: 0, roleCompatibleSelectionCount: 0, roleIncompatibleSelectionCount: 0, reconstructedSelectionCount: 0, validatedSelectionCount: 0, rejectedSelectionCount: 0, terminalDispositionCounts: { missing_selection: 1 }, arithmeticValid: true },
      },
      normalizedSubmissionHash: "null-precision",
    }],
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
    semanticCandidateSmoke: { ok: true },
  });
  assert("precision null plus failed factual coverage is internally valid", nullPrecisionReport.selfValidation.ok && nullPrecisionReport.gates.some((gate) => gate.name === "model_necessary_raw_selection_precision" && gate.observedValue === null && gate.applicability === "not_applicable") && nullPrecisionReport.gates.some((gate) => gate.name === "factual_ambiguity_coverage" && !gate.passed), JSON.stringify(nullPrecisionReport));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
