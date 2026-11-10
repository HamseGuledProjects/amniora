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
  authoritativeSubmissionHash,
  buildBehaviorSmokeGateReport,
  buildCorpus,
  buildQualitySmokeGateReport,
  metricForResult,
  learnerFindingPhrase,
  runSemanticCandidateSmoke,
} = require("./runLinuxPhase12LiveGradingTests.js");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function firstContractWithKind(pkg, kind) {
  return pkg.contracts.find((contract) => contract.requiredFindings.some((finding) => finding.expectedValue.kind === kind)) || pkg.contracts[0];
}

function rawFactualMetrics(raw, matchedUnique, duplicate = 0, structurallyInvalid = 0) {
  const unmatched = Math.max(0, raw - matchedUnique - duplicate - structurallyInvalid);
  const surfaceMatched = matchedUnique + duplicate;
  return {
    rawFactualCandidateSelections: raw,
    rawFactualSurfaceMatchedSelections: matchedUnique,
    rawFactualDuplicateSelections: duplicate,
    rawFactualUnmatchedSelections: unmatched,
    rawFactualStructurallyInvalidSelections: structurallyInvalid,
    rawMatchedClaims: surfaceMatched,
    rawFactualSelectionPrecision: raw ? surfaceMatched / raw : null,
    rawFactualSurfaceSelectionPrecision: raw ? surfaceMatched / raw : null,
    rawFactualUniqueContributionRate: raw ? matchedUnique / raw : null,
    rawFactualDuplicateRate: raw ? duplicate / raw : null,
    rawFactualStructuralValidity: raw ? (raw - structurallyInvalid) / raw : null,
    rawFactualAuthoritativeContributionRate: raw ? matchedUnique / raw : null,
    rawFactualSelectionReconciliation: {
      matchedUniqueFactualSelections: matchedUnique,
      duplicateEquivalentFactualSelections: duplicate,
      unmatchedFactualSelections: unmatched,
      structurallyInvalidFactualSelections: structurallyInvalid,
    },
    rawFactualSelectionDetails: [],
  };
}

async function main() {
  const out = compileIfNeeded("phase12-deterministic-extraction");
  const { linux, assessment, schema, freeForm } = loadPhase11(out);
  const renderedKinds = [
    { expectedValue: { kind: "identity", username: "alice", uid: 1001 } },
    { expectedValue: { kind: "relationship", relation: "authenticated_as", sourceId: "session:ssh:incident-primary", targetId: "identity:alice" } },
    { expectedValue: { kind: "command", normalizedCommand: "/usr/bin/id" } },
    { expectedValue: { kind: "process", pid: 123, executable: "/usr/bin/id" } },
    { expectedValue: { kind: "file", path: "/tmp/audit.out" }, relationship: "modified_file" },
    { expectedValue: { kind: "service", unit: "ssh.service", activeState: "active" } },
    { expectedValue: { kind: "cron", command: "/usr/local/bin/job", schedule: "*/5 * * * *", runAs: "root" } },
    { expectedValue: { kind: "package", name: "curl", action: "installed", repository: "mirror.local" } },
    { expectedValue: { kind: "container", image: "registry.local/app:1", mount: "/srv:/mnt" } },
    { expectedValue: { kind: "network", destinationIp: "10.0.0.8", destinationPort: 443, protocol: "tcp" } },
    { expectedValue: { kind: "state", objectId: "service:ssh", value: "active", timeScope: "collection_snapshot" } },
    { expectedValue: { kind: "timestamp", timestamp: "2026-08-02T12:00:00Z" } },
  ];
  for (const fixture of renderedKinds) {
    const phrase = learnerFindingPhrase(fixture);
    assert(`learner finding renderer emits a complete ${fixture.expectedValue.kind} assertion`, typeof phrase === "string" && phrase.length > 8 && !/finding:|evidence:|identity:|session:ssh:incident-primary/.test(phrase), phrase);
  }

  const corpus = buildCorpus(linux, assessment);
  const fullFixture = corpus.find((item) => item.category === "fully_correct");
  const uncertaintyFixture = corpus.find((item) => item.category === "valid_uncertainty");
  for (const item of [fullFixture, uncertaintyFixture]) {
    const answer = answerFor(item.contract, item.category);
    const registry = freeForm.buildLinuxLearnerCandidateRegistry(item.contract, answer);
    const emptyCandidateExtraction = {
      version: schema.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION,
      taskId: item.contract.taskId,
      candidateRegistryHash: registry.registryHash,
      candidateSelections: [],
      atomicClaims: null,
      claims: null,
      uncertaintyAssertions: null,
      remediationActions: null,
      unparsedStatements: null,
    };
    const fixtureResult = await freeForm.gradeLinuxFreeFormAssessment({
      contract: item.contract,
      learnerAnswer: answer,
      rawExtractionObject: emptyCandidateExtraction,
      createdAt: "2026-08-02T00:00:00.000Z",
    });
    const normalized = fixtureResult.status === "graded" ? fixtureResult.scoreReport.score / fixtureResult.scoreReport.maximumPoints : 0;
    assert(`${item.category} fixture is certified by deterministic oracle at >=85%`, fixtureResult.status === "graded" && normalized >= 0.85, JSON.stringify({ category: item.category, scoreReport: fixtureResult.scoreReport, answer }));
    if (item.category === "valid_uncertainty") {
      assert("valid uncertainty fixture selects an uncertainty-bearing contract", item.contract.uncertaintyRequirements.length > 0, JSON.stringify(item.contract.uncertaintyRequirements));
      assert("valid uncertainty fixture earns uncertainty credit", fixtureResult.status === "graded" && fixtureResult.scoreReport.uncertaintyPoints > 0 && (fixtureResult.normalizedSubmission.uncertaintyAssertions || []).some((assertion) => assertion.kind === "intent_not_proven" || assertion.kind === "limit_attribution" || assertion.kind === "scope_incomplete" || assertion.kind === "transfer_not_confirmed" || assertion.kind === "historical_not_current"), JSON.stringify(fixtureResult));
    }
  }
  const semanticSmoke = await runSemanticCandidateSmoke({ item: fullFixture, freeForm, schema });
  assert("semantic candidate smoke accepts a genuine candidate selection", semanticSmoke.ok && semanticSmoke.validatedCandidateSelections > 0 && semanticSmoke.modelMatchedCandidateSelections > 0, JSON.stringify(semanticSmoke));
  const rejectedSelectionReport = buildQualitySmokeGateReport({
    results: ["fully_correct", "valid_uncertainty"].flatMap((category) => [1, 2, 3].map((repeat) => ({
      id: `${category}-${repeat}`,
      category,
      status: "graded",
      score: 20,
      maximumPoints: 20,
      diagnostics: [],
      metrics: {
        schemaValid: true,
        claimPrecision: 1,
        authoritativeClaimPrecision: 1,
        rawSelectionPrecision: 0,
        claimRecall: 1,
        evidencePathPrecision: 1,
        anchorPrecision: 1,
        deterministicScoreAgreement: true,
        extractedClaims: 2,
        authoritativeClaims: 2,
        matchedClaims: 2,
        expectedClaims: 2,
        rawCandidateSelections: 2,
        validatedCandidateSelections: 0,
        rejectedCandidateSelections: 2,
        ...rawFactualMetrics(2, 0),
        modelMatchedCandidateSelections: 0,
        authoritativeResolutionAccuracy: 1,
        citationCount: 2,
        validCitations: 2,
        anchorCount: 0,
        validAnchors: 0,
      },
      scoreComponents: { findingPoints: 10, evidencePoints: 5, reasoningPoints: 3, uncertaintyPoints: category === "valid_uncertainty" ? 1 : 0, remediationPoints: 0, penalties: 0 },
      normalizedSubmissionHash: `stable-${category}`,
    }))),
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
    semanticCandidateSmoke: { ok: true },
  });
  assert("quality-smoke gate rejects all-selections-rejected positive cases", !rejectedSelectionReport.passed && rejectedSelectionReport.gates.some((gate) => gate.name === "positive_validated_candidate_selection_rate" && !gate.passed), JSON.stringify(rejectedSelectionReport));

  const candidate = buildCandidate(linux.buildLinuxAssetCandidate, "Beginner", "ssh_key_compromise");
  const pkg = assessment.buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = firstContractWithKind(pkg, "identity");
  const finding = contract.requiredFindings.find((item) => item.expectedValue.kind === "identity") || contract.requiredFindings[0];
  const evidencePath = contract.evidenceRequirements.find((item) => item.findingId === finding.id).evidencePaths[0];
  const username = finding.expectedValue.username || finding.expectedValue.identityId;
  const learnerAnswer = `${evidencePath} shows ${username} authenticated; this is a candidate conclusion that requires validation. Recommended action: ${contract.remediationRequirements[0]?.action || "preserve the evidence"}.`;

  const clauses = freeForm.buildLinuxLearnerClauseCandidates(contract, learnerAnswer);
  assert("deterministic clause segmentation returns stable IDs", clauses.length >= 2 && clauses.every((clause, index) => clause.clauseId.includes(`clause:${index + 1}`) || clause.sentenceId.startsWith("sentence:")), JSON.stringify(clauses));
  assert("clause offsets point at exact spans", clauses.every((clause) => learnerAnswer.slice(clause.startOffset, clause.endOffset) === clause.textSpan), JSON.stringify(clauses));
  assert("clause candidates carry deterministic evidence references", clauses.some((clause) => clause.evidenceReferences.some((reference) => reference.path === evidencePath && reference.status === "exact_path")), JSON.stringify(clauses));
  assert("clause candidates detect uncertainty and remediation terms", clauses.some((clause) => clause.certaintyTerms.length === 0) && clauses.some((clause) => clause.remediationTerms.length > 0), JSON.stringify(clauses));
  assert("clause candidates expose request-local candidate IDs only", clauses.every((clause) => /^clause_\d+$/.test(clause.localCandidateIds.clauseId) && clause.localCandidateIds.evidenceRefIds.every((id) => /^evidence_ref_\d+$/.test(id))), JSON.stringify(clauses));
  const registry = freeForm.buildLinuxLearnerCandidateRegistry(contract, learnerAnswer);
  const registryAgain = freeForm.buildLinuxLearnerCandidateRegistry(contract, learnerAnswer.replace(/\n/g, "\r\n"));
  assert("candidate registry is deterministic for equivalent newlines", registry.registryHash === registryAgain.registryHash, JSON.stringify({ first: registry, second: registryAgain }));
  assert("candidate registry contains typed request-local IDs", registry.candidates.some((item) => item.type === "identity" && item.text === username) && registry.candidates.some((item) => item.type === "evidence_reference"), JSON.stringify(registry));
  assert("candidate registry offsets point at exact spans", registry.candidates.every((candidate) => learnerAnswer.normalize("NFKC").replace(/\r\n/g, "\n").replace(/\r/g, "\n").slice(candidate.startOffset, candidate.endOffset) === candidate.text), JSON.stringify(registry.candidates));
  const routingFixture = `Evidence cited: ${evidencePath}; The cited sources corroborate the finding; Intent is not proven from this task; Recommended action: ${contract.remediationRequirements[0]?.action || "preserve evidence"}; This proves full host compromise.`;
  const routingRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, routingFixture);
  const routedClauses = routingRegistry.candidates.filter((candidate) => candidate.type === "clause");
  assert("deterministic evidence-list routing is marked non-assessment", routedClauses.some((clause) => clause.deterministicRole === "non_assessment" && clause.allowedRoles.length === 1 && clause.allowedRoles[0] === "non_assessment" && clause.roleMarkers.evidenceList), JSON.stringify(routedClauses));
  assert("deterministic reasoning routing is marked reasoning", routedClauses.some((clause) => clause.deterministicRole === "reasoning" && clause.roleMarkers.reasoning), JSON.stringify(routedClauses));
  assert("deterministic uncertainty routing is marked uncertainty", routedClauses.some((clause) => clause.deterministicRole === "uncertainty" && clause.roleMarkers.uncertainty), JSON.stringify(routedClauses));
  assert("deterministic remediation routing is marked remediation", routedClauses.some((clause) => clause.deterministicRole === "remediation" && clause.roleMarkers.remediation), JSON.stringify(routedClauses));
  assert("deterministic conclusion routing is marked conclusion", routedClauses.some((clause) => clause.deterministicRole === "conclusion" && clause.roleMarkers.conclusion), JSON.stringify(routedClauses));
  const corroborationRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, "The cited sources corroborate the relationship and support the sequence, so the conclusion requires validation.");
  const corroborationClause = corroborationRegistry.candidates.find((candidate) => candidate.type === "clause");
  assert("corroboration or relationship prose without an asserted predicate cannot advertise finding", corroborationClause && corroborationClause.deterministicRole === "reasoning" && !corroborationClause.allowedRoles.includes("finding"), JSON.stringify(corroborationRegistry.candidates));
  const fragmentRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, `${evidencePath}`);
  const fragmentClause = fragmentRegistry.candidates.find((candidate) => candidate.type === "clause");
  assert("incomplete path fragments cannot advertise finding", fragmentClause?.roleMarkers.incompleteFragment && fragmentClause.allowedRoles.length === 1 && fragmentClause.allowedRoles[0] === "non_assessment", JSON.stringify(fragmentRegistry.candidates));
  const mixedFixture = `${evidencePath} shows ${username} authenticated. Evidence cited: ${evidencePath}, users.csv. The cited sources corroborate the finding. Recommended action: ${contract.remediationRequirements[0]?.action || "preserve evidence"}. This proves full host compromise.`;
  const mixedRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, mixedFixture);
  const mixedClauses = mixedRegistry.candidates.filter((candidate) => candidate.type === "clause");
  const mixedFindingClauses = mixedClauses.filter((clause) => clause.allowedRoles.includes("finding"));
  assert("mixed clauses split into bounded role-specific candidates", mixedClauses.length >= 5 && mixedFindingClauses.length === 1, JSON.stringify(mixedClauses));
  assert("evidence-list candidate cannot be selected as factual by model-facing registry", mixedClauses.some((clause) => clause.roleMarkers.evidenceList && !clause.allowedRoles.includes("finding")), JSON.stringify(mixedClauses));
  assert("reasoning candidate cannot be selected as an event", mixedClauses.some((clause) => clause.deterministicRole === "reasoning" && !clause.allowedRoles.includes("finding")), JSON.stringify(mixedClauses));
  assert("complete assertions remain selectable", mixedFindingClauses.some((clause) => clause.roleMarkers.factualLanguage && clause.allowedRoles.includes("finding")), JSON.stringify(mixedFindingClauses));
  const prompt = freeForm.buildLinuxFreeFormExtractionPrompt({ contract, learnerAnswer: routingFixture, studentTask: { evidence: [evidencePath] } });
  const promptRegistry = JSON.parse(prompt.match(/<learner_candidate_registry>\n([\s\S]*?)\n<\/learner_candidate_registry>/)[1]);
  const modelClauseIds = new Set(promptRegistry.candidates.filter((candidate) => candidate.type === "clause").map((candidate) => candidate.id));
  assert("model-facing registry excludes conclusive non-factual clauses", promptRegistry.deterministicRoutes.length >= 4 && promptRegistry.deterministicRoutes.every((route) => !modelClauseIds.has(route.clauseId)), JSON.stringify(promptRegistry));
  const identityCandidate = registry.candidates.find((item) => item.type === "identity" && item.text === username);
  const clauseCandidate = registry.candidates.find((item) => item.type === "clause" && item.id === identityCandidate?.clauseId);
  const evidenceCandidate = registry.candidates.find((item) => item.type === "evidence_reference" && item.clauseId === identityCandidate?.clauseId);
  const uncertaintyCandidate = registry.candidates.find((item) => item.type === "uncertainty");
  const remediationCandidate = registry.candidates.find((item) => item.type === "remediation");
  assert("candidate fixture has reconstruction inputs", identityCandidate && clauseCandidate && evidenceCandidate && uncertaintyCandidate, JSON.stringify(registry.candidates));

  const emptyModelExtraction = {
    version: schema.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION,
    taskId: contract.taskId,
    candidateRegistryHash: registry.registryHash,
    candidateSelections: [],
    atomicClaims: [],
    claims: null,
    uncertaintyAssertions: null,
    remediationActions: null,
    unparsedStatements: null,
  };
  const fallbackResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer,
    rawExtractionObject: emptyModelExtraction,
    createdAt: "2026-07-31T12:00:00.000Z",
  });
  assert("deterministic fallback resolves exact learner-visible username without model claims", fallbackResult.status === "graded" && fallbackResult.normalizedSubmission.claims.some((claim) => JSON.stringify(claim.value).includes(username)), JSON.stringify(fallbackResult));
  assert("deterministic fallback preserves exact evidence references", fallbackResult.normalizedSubmission.claims.some((claim) => (claim.evidence || []).some((citation) => citation.path === evidencePath)), JSON.stringify(fallbackResult.normalizedSubmission));
  assert("deterministic fallback extracts valid uncertainty credit when applicable", contract.uncertaintyRequirements.length === 0 || fallbackResult.scoreReport.uncertaintyPoints > 0, JSON.stringify(fallbackResult.scoreReport));

  const fullyCorrectAnswer = answerFor(contract, "fully_correct");
  const fullyCorrectRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, fullyCorrectAnswer);
  const fullyCorrectOmittedModel = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: fullyCorrectAnswer,
    rawExtractionObject: { ...emptyModelExtraction, candidateRegistryHash: fullyCorrectRegistry.registryHash, candidateSelections: [] },
    createdAt: "2026-07-31T12:00:00.000Z",
  });
  const fullyCorrectMetrics = metricForResult(contract, fullyCorrectOmittedModel, { category: "fully_correct", contract, learnerAnswer: fullyCorrectAnswer });
  assert("fully correct production fallback produces no extra learner-surface claims", fullyCorrectOmittedModel.status === "graded" && fullyCorrectMetrics.extractedClaims === fullyCorrectMetrics.matchedClaims, JSON.stringify({ metrics: fullyCorrectMetrics, submission: fullyCorrectOmittedModel.normalizedSubmission, records: fullyCorrectOmittedModel.normalizationRecords }));
  assert("fully correct authoritative precision remains exact after surface merge", fullyCorrectMetrics.authoritativeClaimPrecision === 1 && fullyCorrectMetrics.authoritativeResolutionAccuracy === 1, JSON.stringify(fullyCorrectMetrics));
  assert("fully correct resolution units reconcile exactly", fullyCorrectMetrics.authoritativeResolutionNumerator === fullyCorrectMetrics.authoritativeResolutionDenominator && fullyCorrectMetrics.resolutionUnitBreakdown.unresolved === 0 && fullyCorrectMetrics.resolutionUnitBreakdown.inapplicable === 0, JSON.stringify(fullyCorrectMetrics.resolutionUnitBreakdown));
  const fullyCorrectReorderedModel = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: fullyCorrectAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: fullyCorrectRegistry.registryHash,
      candidateSelections: [{
        clauseId: fullyCorrectRegistry.candidates.find((item) => item.type === "clause")?.id,
        role: "non_assessment",
        predicateLabel: null,
        primaryEntityCandidateId: null,
        secondaryEntityCandidateId: null,
        subjectCandidateId: null,
        objectCandidateId: null,
        valueCandidateId: null,
        timestampCandidateId: null,
        stateCandidateId: null,
        evidenceReferenceIds: [],
        reasoningClauseIds: [],
        uncertaintyCandidateIds: [],
        remediationCandidateIds: [],
        conclusionCandidateIds: [],
        confidence: "candidate",
        extractionConfidence: "high",
      }],
    },
    createdAt: "2026-07-31T12:00:00.000Z",
  });
  assert("identical fully correct submissions keep one authoritative hash despite raw extraction differences", fullyCorrectOmittedModel.status === "graded" && fullyCorrectReorderedModel.status === "graded" && authoritativeSubmissionHash(fullyCorrectOmittedModel.normalizedSubmission) === authoritativeSubmissionHash(fullyCorrectReorderedModel.normalizedSubmission) && fullyCorrectOmittedModel.candidateSelectionStages.rawExtractionHash !== fullyCorrectReorderedModel.candidateSelectionStages.rawExtractionHash, JSON.stringify({ first: fullyCorrectOmittedModel.candidateSelectionStages.rawExtractionHash, second: fullyCorrectReorderedModel.candidateSelectionStages.rawExtractionHash }));

  const fakeResolutionReport = buildQualitySmokeGateReport({
    results: [
      {
        id: "fake-full-correct",
        category: "fully_correct",
        status: "graded",
        score: 20,
        maximumPoints: 20,
        diagnostics: [],
        metrics: {
          schemaValid: true,
          claimPrecision: 1,
          authoritativeClaimPrecision: 1,
          rawSelectionPrecision: 1,
          claimRecall: 1,
          evidencePathPrecision: 1,
          anchorPrecision: 1,
          deterministicScoreAgreement: true,
          extractedClaims: 2,
          authoritativeClaims: 2,
          matchedClaims: 2,
          expectedClaims: 2,
          rawCandidateSelections: 1,
          validatedCandidateSelections: 1,
          rejectedCandidateSelections: 0,
          ...rawFactualMetrics(1, 1),
          modelMatchedCandidateSelections: 1,
          modelMatchedFactualSelections: 1,
          authoritativeResolutionAccuracy: 0.5,
          authoritativeResolutionNumerator: 1,
          authoritativeResolutionDenominator: 2,
          resolutionUnitBreakdown: { population: "fully_correct_factual_authoritative_claims", exact: 1, equivalent_format: 0, contradictory: 0, ambiguous: 0, unresolved: 1, inapplicable: 3, byKind: { identity: { exact: 1, unresolved: 1, inapplicable: 3 } } },
          citationCount: 0,
          validCitations: 0,
          anchorCount: 0,
          validAnchors: 0,
        },
        scoreComponents: { findingPoints: 10, evidencePoints: 5, reasoningPoints: 3, uncertaintyPoints: 0, remediationPoints: 0, penalties: 0 },
        normalizedSubmissionHash: "fake-full",
      },
      ...["fully_correct", "fully_correct", "valid_uncertainty", "valid_uncertainty", "valid_uncertainty"].map((category, index) => ({
        id: `support-${index}`,
        category,
        status: "graded",
        score: 20,
        maximumPoints: 20,
        diagnostics: [],
        metrics: {
          schemaValid: true,
          claimPrecision: 1,
          authoritativeClaimPrecision: 1,
          rawSelectionPrecision: 1,
          claimRecall: 1,
          evidencePathPrecision: 1,
          anchorPrecision: 1,
          deterministicScoreAgreement: true,
          extractedClaims: 1,
          authoritativeClaims: 1,
          matchedClaims: 1,
          expectedClaims: 1,
          rawCandidateSelections: 1,
          validatedCandidateSelections: 1,
          rejectedCandidateSelections: 0,
          ...rawFactualMetrics(1, 1),
          modelMatchedCandidateSelections: 1,
          modelMatchedFactualSelections: 1,
          authoritativeResolutionAccuracy: 1,
          authoritativeResolutionNumerator: 1,
          authoritativeResolutionDenominator: 1,
          resolutionUnitBreakdown: { population: category === "fully_correct" ? "fully_correct_factual_authoritative_claims" : "category_factual_authoritative_claims", exact: 1, equivalent_format: 0, contradictory: 0, ambiguous: 0, unresolved: 0, inapplicable: category === "valid_uncertainty" ? 1 : 0, byKind: { identity: { exact: 1, inapplicable: category === "valid_uncertainty" ? 1 : 0 } } },
          citationCount: 0,
          validCitations: 0,
          anchorCount: 0,
          validAnchors: 0,
        },
        scoreComponents: { findingPoints: 10, evidencePoints: 5, reasoningPoints: 3, uncertaintyPoints: category === "valid_uncertainty" ? 1 : 0, remediationPoints: 0, penalties: 0 },
        normalizedSubmissionHash: `support-${category}`,
      })),
    ],
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
    semanticCandidateSmoke: { ok: true },
  });
  assert("genuine unresolved applicable resolution unit still fails the quality gate", !fakeResolutionReport.passed && fakeResolutionReport.gates.some((gate) => gate.name === "authoritative_resolution_accuracy" && !gate.passed && gate.numerator === 3 && gate.denominator === 4), JSON.stringify(fakeResolutionReport.gates));

  const candidateSelectionExtraction = {
    version: schema.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION,
    taskId: contract.taskId,
    candidateRegistryHash: registry.registryHash,
    candidateSelections: [{
      clauseId: clauseCandidate.id,
      role: "finding",
      primaryEntityCandidateId: identityCandidate.id,
      secondaryEntityCandidateId: null,
      subjectCandidateId: identityCandidate.id,
      predicateLabel: "authenticated",
      objectCandidateId: null,
      valueCandidateId: identityCandidate.id,
      timestampCandidateId: null,
      stateCandidateId: null,
      evidenceReferenceIds: [evidenceCandidate.id],
      reasoningClauseIds: [clauseCandidate.id],
      uncertaintyCandidateIds: uncertaintyCandidate ? [uncertaintyCandidate.id] : [],
      remediationCandidateIds: remediationCandidate ? [remediationCandidate.id] : [],
      conclusionCandidateIds: [],
      confidence: "supported",
      extractionConfidence: "high",
    }],
    atomicClaims: null,
    claims: null,
    uncertaintyAssertions: null,
    remediationActions: null,
    unparsedStatements: null,
  };
  const candidateResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer,
    rawExtractionObject: candidateSelectionExtraction,
    createdAt: "2026-07-31T12:00:00.000Z",
  });
  assert("candidate-ID extraction reconstructs without copied spans", candidateResult.status === "graded" && candidateResult.extraction.candidateSelections?.length === 1 && candidateResult.normalizedSubmission.claims.some((claim) => JSON.stringify(claim.value).includes(username)), JSON.stringify(candidateResult));
  assert("candidate-ID extraction awards applicable uncertainty when finding is present", contract.uncertaintyRequirements.length === 0 || candidateResult.scoreReport.uncertaintyPoints > 0, JSON.stringify(candidateResult.scoreReport));
  assert("deterministic factual clauses are not counted in model-facing raw precision", candidateResult.status === "graded" && candidateResult.candidateSelectionStages.rawFactualCandidateSelections === 0 && candidateResult.candidateSelectionStages.rawFactualSurfaceMatchedSelections === 0 && candidateResult.candidateSelectionStages.rawFactualDuplicateSelections === 0 && candidateResult.candidateSelectionStages.candidateDispositionSummary.deterministicFindingClauses >= 1, JSON.stringify(candidateResult.candidateSelectionStages));

  const unknownId = JSON.parse(JSON.stringify(candidateSelectionExtraction));
  unknownId.candidateSelections[0].subjectCandidateId = "identity_9999";
  unknownId.candidateSelections[0].primaryEntityCandidateId = "identity_9999";
  const unknownResult = await freeForm.gradeLinuxFreeFormAssessment({ contract, learnerAnswer, rawExtractionObject: unknownId });
  assert("invalid entity candidate IDs reconstruct deterministically from the selected clause", unknownResult.status === "graded" && (unknownResult.candidateSelectionStages?.modelMatchedFactualSelections || 0) > 0 && !unknownResult.diagnostics.some((issue) => issue.code === "LINUX_GRADING_UNKNOWN_CANDIDATE_ID"), JSON.stringify({ diagnostics: unknownResult.diagnostics, stages: unknownResult.candidateSelectionStages }));

  const wrongType = JSON.parse(JSON.stringify(candidateSelectionExtraction));
  wrongType.candidateSelections[0].subjectCandidateId = evidenceCandidate.id;
  wrongType.candidateSelections[0].primaryEntityCandidateId = evidenceCandidate.id;
  const wrongTypeResult = await freeForm.gradeLinuxFreeFormAssessment({ contract, learnerAnswer, rawExtractionObject: wrongType });
  assert("wrong entity candidate types reconstruct deterministically from the selected clause", wrongTypeResult.status === "graded" && (wrongTypeResult.candidateSelectionStages?.modelMatchedFactualSelections || 0) > 0 && !wrongTypeResult.diagnostics.some((issue) => issue.code === "LINUX_GRADING_CANDIDATE_TYPE_MISMATCH"), JSON.stringify({ diagnostics: wrongTypeResult.diagnostics, stages: wrongTypeResult.candidateSelectionStages }));

  const unknownClause = JSON.parse(JSON.stringify(candidateSelectionExtraction));
  unknownClause.candidateSelections[0].clauseId = "clause_9999";
  const unknownClauseResult = await freeForm.gradeLinuxFreeFormAssessment({ contract, learnerAnswer, rawExtractionObject: unknownClause });
  assert("unknown clause IDs are still rejected diagnostically", unknownClauseResult.status === "graded" && unknownClauseResult.diagnostics.some((issue) => issue.code === "LINUX_GRADING_UNKNOWN_CANDIDATE_ID"), JSON.stringify(unknownClauseResult.diagnostics));

  const badHash = JSON.parse(JSON.stringify(candidateSelectionExtraction));
  badHash.candidateRegistryHash = "not-this-registry";
  const badHashResult = await freeForm.gradeLinuxFreeFormAssessment({ contract, learnerAnswer, rawExtractionObject: badHash });
  assert("cross-request registry hash mismatch is rejected diagnostically", badHashResult.status === "graded" && badHashResult.diagnostics.some((issue) => issue.code === "LINUX_GRADING_CANDIDATE_REGISTRY_MISMATCH"), JSON.stringify(badHashResult.diagnostics));

  const duplicateSelection = JSON.parse(JSON.stringify(candidateSelectionExtraction));
  duplicateSelection.candidateSelections.push(JSON.parse(JSON.stringify(candidateSelectionExtraction.candidateSelections[0])));
  const duplicateResult = await freeForm.gradeLinuxFreeFormAssessment({ contract, learnerAnswer, rawExtractionObject: duplicateSelection });
  assert("duplicate candidate selections normalize without extra finding credit", duplicateResult.status === "graded" && duplicateResult.scoreReport.findingPoints === candidateResult.scoreReport.findingPoints, JSON.stringify({ duplicate: duplicateResult.scoreReport, single: candidateResult.scoreReport }));
  assert("duplicate candidate selections are reported as rejected model noise", duplicateResult.status === "graded" && duplicateResult.candidateSelectionStages.rejectedSelectionReasons.duplicate_authoritative_claim === 1, JSON.stringify(duplicateResult.candidateSelectionStages));
  assert("duplicate deterministic factual selections stay outside model-facing raw precision", duplicateResult.status === "graded" && duplicateResult.candidateSelectionStages.rawFactualCandidateSelections === 0 && duplicateResult.candidateSelectionStages.rawFactualSurfaceMatchedSelections === 0 && duplicateResult.candidateSelectionStages.rawFactualDuplicateSelections === 0, JSON.stringify(duplicateResult.candidateSelectionStages));

  const reordered = JSON.parse(JSON.stringify(fallbackResult.normalizedSubmission));
  reordered.claims = [...(reordered.claims || [])].reverse();
  for (const claim of reordered.claims || []) claim.evidence = [...(claim.evidence || [])].reverse();
  reordered.remediationActions = [...(reordered.remediationActions || [])].reverse();
  assert("authoritative normalized hash ignores equivalent ordering", authoritativeSubmissionHash(reordered) === authoritativeSubmissionHash(fallbackResult.normalizedSubmission));

  const wrongAnswer = `assets/logs/auth.log shows account not-${username} authenticated.`;
  const wrongRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, wrongAnswer);
  const wrongResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: wrongAnswer,
    rawExtractionObject: { ...emptyModelExtraction, candidateRegistryHash: wrongRegistry.registryHash },
    createdAt: "2026-07-31T12:00:00.000Z",
  });
  assert("deterministic fallback extracts wrong values without correcting them", wrongResult.status === "graded" && (wrongResult.normalizedSubmission.claims || []).some((claim) => claim.value.kind === "identity" && claim.value.username === `not-${username}`), JSON.stringify(wrongResult.normalizedSubmission));
  assert("wrong extracted value remains unresolved/no finding credit", wrongResult.status === "graded" && wrongResult.scoreReport.findingPoints === 0, JSON.stringify(wrongResult.scoreReport));

  const wrongClause = wrongRegistry.candidates.find((item) => item.type === "clause");
  const wrongIdentity = wrongRegistry.candidates.find((item) => item.type === "identity");
  const explicitWrongResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: wrongAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: wrongRegistry.registryHash,
      candidateSelections: [{
        clauseId: wrongClause.id,
        role: "finding",
        primaryEntityCandidateId: wrongIdentity?.id || null,
        secondaryEntityCandidateId: null,
        subjectCandidateId: wrongIdentity?.id || null,
        predicateLabel: "authenticated",
        objectCandidateId: null,
        valueCandidateId: wrongIdentity?.id || null,
        timestampCandidateId: null,
        stateCandidateId: null,
        evidenceReferenceIds: [],
        reasoningClauseIds: [],
        uncertaintyCandidateIds: [],
        remediationCandidateIds: [],
        conclusionCandidateIds: [],
        confidence: "candidate",
        extractionConfidence: "high",
      }],
    },
  });
  assert("explicit wrong learner assertion is preserved for wrong-answer handling", explicitWrongResult.status === "graded" && explicitWrongResult.candidateSelectionStages.explicitLearnerContradictionsPreserved === 1 && explicitWrongResult.scoreReport.findingPoints === 0, JSON.stringify(explicitWrongResult.candidateSelectionStages));

  const modelInferenceAnswer = "The account shadowuser authenticated.";
  const modelInferenceRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, modelInferenceAnswer);
  const modelInferenceClause = modelInferenceRegistry.candidates.find((item) => item.type === "clause");
  const modelInferenceIdentity = modelInferenceRegistry.candidates.find((item) => item.type === "identity");
  const unresolvedInferenceResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: modelInferenceAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: modelInferenceRegistry.registryHash,
      candidateSelections: [{
        clauseId: modelInferenceClause.id,
        role: "finding",
        primaryEntityCandidateId: modelInferenceIdentity?.id || null,
        secondaryEntityCandidateId: null,
        subjectCandidateId: modelInferenceIdentity?.id || null,
        predicateLabel: "authenticated",
        objectCandidateId: null,
        valueCandidateId: modelInferenceIdentity?.id || null,
        timestampCandidateId: null,
        stateCandidateId: null,
        evidenceReferenceIds: [],
        reasoningClauseIds: [],
        uncertaintyCandidateIds: [],
        remediationCandidateIds: [],
        conclusionCandidateIds: [],
        confidence: "candidate",
        extractionConfidence: "high",
      }],
    },
  });
  assert("unresolved model inference is rejected before authoritative claims", unresolvedInferenceResult.status === "graded" && unresolvedInferenceResult.candidateSelectionStages.unresolvedModelInferencesRejected === 1 && unresolvedInferenceResult.candidateSelectionStages.sourceClassificationCounts.unresolved_model_inference === 0, JSON.stringify(unresolvedInferenceResult.candidateSelectionStages));

  const wrongRelationshipAnswer = "The relationship is reversed or unrelated: the referenced source caused a different target than the task evidence indicates.";
  const wrongRelationshipRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, wrongRelationshipAnswer);
  const wrongRelationshipClause = wrongRelationshipRegistry.candidates.find((item) => item.type === "clause");
  const wrongRelationshipResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: wrongRelationshipAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: wrongRelationshipRegistry.registryHash,
      candidateSelections: [{
        clauseId: wrongRelationshipClause.id,
        role: "finding",
        primaryEntityCandidateId: null,
        secondaryEntityCandidateId: null,
        subjectCandidateId: null,
        predicateLabel: "supports",
        objectCandidateId: null,
        valueCandidateId: null,
        timestampCandidateId: null,
        stateCandidateId: null,
        evidenceReferenceIds: [],
        reasoningClauseIds: [],
        uncertaintyCandidateIds: [],
        remediationCandidateIds: [],
        conclusionCandidateIds: [],
        confidence: "candidate",
        extractionConfidence: "high",
      }],
    },
  });
  assert("explicit wrong relationship is preserved rather than structurally rejected", wrongRelationshipResult.status === "graded" && wrongRelationshipResult.candidateSelectionStages.validatedCandidateSelections === 1 && wrongRelationshipResult.candidateSelectionStages.rejectedCandidateSelections === 0 && wrongRelationshipResult.candidateSelectionStages.sourceClassificationCounts.preserved_learner_contradiction === 1, JSON.stringify(wrongRelationshipResult.candidateSelectionStages));
  assert("explicit wrong relationship receives no inappropriate canonical credit", wrongRelationshipResult.status === "graded" && wrongRelationshipResult.scoreReport.findingPoints === 0, JSON.stringify(wrongRelationshipResult.scoreReport));
  assert("unique deterministic learner contradiction is preserved without model-facing raw factual credit", wrongRelationshipResult.status === "graded" && wrongRelationshipResult.candidateSelectionStages.explicitLearnerContradictionsPreserved === 1 && wrongRelationshipResult.candidateSelectionStages.rawFactualCandidateSelections === 0 && wrongRelationshipResult.candidateSelectionStages.rawFactualSelectionReconciliation.matchedUniqueFactualSelections === 0, JSON.stringify(wrongRelationshipResult.candidateSelectionStages));

  const wrongStateAnswer = "The wrong current state is active at 2099-01-01T00:00:00Z, which I treat as the decisive timestamp.";
  const wrongStateRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, wrongStateAnswer);
  const wrongStateClause = wrongStateRegistry.candidates.find((item) => item.type === "clause");
  const wrongStateCandidate = wrongStateRegistry.candidates.find((item) => item.type === "state");
  const wrongTimeCandidate = wrongStateRegistry.candidates.find((item) => item.type === "timestamp");
  const wrongStateResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: wrongStateAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: wrongStateRegistry.registryHash,
      candidateSelections: [{
        clauseId: wrongStateClause.id,
        role: "finding",
        primaryEntityCandidateId: wrongStateCandidate?.id || wrongTimeCandidate?.id || null,
        secondaryEntityCandidateId: null,
        subjectCandidateId: wrongStateCandidate?.id || null,
        predicateLabel: "currently_active",
        objectCandidateId: null,
        valueCandidateId: wrongStateCandidate?.id || wrongTimeCandidate?.id || null,
        timestampCandidateId: wrongTimeCandidate?.id || null,
        stateCandidateId: wrongStateCandidate?.id || null,
        evidenceReferenceIds: [],
        reasoningClauseIds: [],
        uncertaintyCandidateIds: [],
        remediationCandidateIds: [],
        conclusionCandidateIds: [],
        confidence: "candidate",
        extractionConfidence: "high",
      }],
    },
  });
  assert("explicit wrong state or timestamp is preserved", wrongStateResult.status === "graded" && wrongStateResult.normalizedSubmission.claims.length === 1 && wrongStateResult.candidateSelectionStages.sourceClassificationCounts.preserved_learner_contradiction === 1, JSON.stringify({ submission: wrongStateResult.normalizedSubmission, stages: wrongStateResult.candidateSelectionStages }));
  assert("explicit wrong state or timestamp receives no inappropriate canonical credit", wrongStateResult.status === "graded" && wrongStateResult.scoreReport.findingPoints === 0, JSON.stringify(wrongStateResult.scoreReport));

  const liveShapeWrongSubjectAnswer = answerFor(contract, "wrong_subject");
  const liveShapeWrongSubjectRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, liveShapeWrongSubjectAnswer);
  const liveShapeWrongSubject = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: liveShapeWrongSubjectAnswer,
    rawExtractionObject: { ...emptyModelExtraction, candidateRegistryHash: liveShapeWrongSubjectRegistry.registryHash, candidateSelections: [] },
    createdAt: "2026-07-31T12:00:00.000Z",
  });
  const liveShapeWrongSubjectMetrics = metricForResult(contract, liveShapeWrongSubject, { category: "wrong_subject", contract, learnerAnswer: liveShapeWrongSubjectAnswer });
  assert("production-path wrong subject omission still extracts learner contradiction", liveShapeWrongSubject.status === "graded" && liveShapeWrongSubjectMetrics.surfaceFidelity.perType.wrong_subject.expected === 1 && liveShapeWrongSubjectMetrics.surfaceFidelity.perType.wrong_subject.extracted === 1 && liveShapeWrongSubjectMetrics.surfaceFidelity.perType.wrong_subject.matched === 1, JSON.stringify({ metrics: liveShapeWrongSubjectMetrics.surfaceFidelity, submission: liveShapeWrongSubject.normalizedSubmission }));
  assert("production-path wrong subject receives no canonical finding credit", liveShapeWrongSubject.status === "graded" && liveShapeWrongSubject.scoreReport.findingPoints < contract.scoring.findingPoints, JSON.stringify(liveShapeWrongSubject.scoreReport));

  const liveShapeWrongRelationshipAnswer = answerFor(contract, "wrong_relationship");
  const liveShapeWrongRelationshipRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, liveShapeWrongRelationshipAnswer);
  const liveShapeWrongRelationship = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: liveShapeWrongRelationshipAnswer,
    rawExtractionObject: { ...emptyModelExtraction, candidateRegistryHash: liveShapeWrongRelationshipRegistry.registryHash, candidateSelections: [] },
    createdAt: "2026-07-31T12:00:00.000Z",
  });
  const liveShapeWrongRelationshipMetrics = metricForResult(contract, liveShapeWrongRelationship, { category: "wrong_relationship", contract, learnerAnswer: liveShapeWrongRelationshipAnswer });
  assert("production-path wrong relationship omission still extracts learner contradiction", liveShapeWrongRelationship.status === "graded" && liveShapeWrongRelationshipMetrics.surfaceFidelity.perType.wrong_relationship.expected === 1 && liveShapeWrongRelationshipMetrics.surfaceFidelity.perType.wrong_relationship.extracted === 1 && liveShapeWrongRelationshipMetrics.surfaceFidelity.perType.wrong_relationship.matched === 1, JSON.stringify({ metrics: liveShapeWrongRelationshipMetrics.surfaceFidelity, submission: liveShapeWrongRelationship.normalizedSubmission, records: liveShapeWrongRelationship.normalizationRecords }));
  assert("production-path wrong relationship receives no canonical finding credit", liveShapeWrongRelationship.status === "graded" && liveShapeWrongRelationship.scoreReport.findingPoints === 0, JSON.stringify(liveShapeWrongRelationship.scoreReport));

  const liveShapeWrongStateAnswer = answerFor(contract, "wrong_state_timestamp");
  const liveShapeWrongStateRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, liveShapeWrongStateAnswer);
  const liveShapeWrongState = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: liveShapeWrongStateAnswer,
    rawExtractionObject: { ...emptyModelExtraction, candidateRegistryHash: liveShapeWrongStateRegistry.registryHash, candidateSelections: [] },
    createdAt: "2026-07-31T12:00:00.000Z",
  });
  const liveShapeWrongStateMetrics = metricForResult(contract, liveShapeWrongState, { category: "wrong_state_timestamp", contract, learnerAnswer: liveShapeWrongStateAnswer });
  assert("production-path wrong state/value omission still extracts learner contradiction", liveShapeWrongState.status === "graded" && liveShapeWrongStateMetrics.surfaceFidelity.perType.wrong_state_value.expected === 1 && liveShapeWrongStateMetrics.surfaceFidelity.perType.wrong_state_value.extracted === 1 && liveShapeWrongStateMetrics.surfaceFidelity.perType.wrong_state_value.matched === 1, JSON.stringify({ metrics: liveShapeWrongStateMetrics.surfaceFidelity, submission: liveShapeWrongState.normalizedSubmission, records: liveShapeWrongState.normalizationRecords }));
  assert("production-path wrong state/value receives no inappropriate canonical finding credit", liveShapeWrongState.status === "graded" && liveShapeWrongState.scoreReport.findingPoints === 0, JSON.stringify(liveShapeWrongState.scoreReport));

  const combinedWrongReport = buildBehaviorSmokeGateReport({
    results: [
      { category: "wrong_subject", status: "graded", diagnostics: [], metrics: liveShapeWrongSubjectMetrics, score: liveShapeWrongSubject.scoreReport.score, maximumPoints: liveShapeWrongSubject.scoreReport.maximumPoints, scoreComponents: liveShapeWrongSubject.scoreReport, normalizedSubmissionHash: authoritativeSubmissionHash(liveShapeWrongSubject.normalizedSubmission) },
      { category: "wrong_relationship", status: "graded", diagnostics: [], metrics: liveShapeWrongRelationshipMetrics, score: liveShapeWrongRelationship.scoreReport.score, maximumPoints: liveShapeWrongRelationship.scoreReport.maximumPoints, scoreComponents: liveShapeWrongRelationship.scoreReport, normalizedSubmissionHash: authoritativeSubmissionHash(liveShapeWrongRelationship.normalizedSubmission) },
      { category: "wrong_state_timestamp", status: "graded", diagnostics: [], metrics: liveShapeWrongStateMetrics, score: liveShapeWrongState.scoreReport.score, maximumPoints: liveShapeWrongState.scoreReport.maximumPoints, scoreComponents: liveShapeWrongState.scoreReport, normalizedSubmissionHash: authoritativeSubmissionHash(liveShapeWrongState.normalizedSubmission) },
    ],
    connectivity: { ok: false },
    productionSchemaSmoke: { ok: false },
    semanticCandidateSmoke: { ok: false },
  });
  const wrongGate = combinedWrongReport.gates.find((gate) => gate.name === "wrong_claim_extraction_fidelity");
  assert("combined wrong-claim fidelity uses applicable wrong rows only", wrongGate.numerator === 3 && wrongGate.denominator === 3 && wrongGate.observedValue === 1, JSON.stringify(combinedWrongReport));

  const evidenceOnlyAnswer = `${evidencePath}. ${contract.evidenceRequirements[0]?.requiredAnchors?.[0] || "The source is listed for review"}.`;
  const evidenceOnlyRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, evidenceOnlyAnswer);
  const evidenceOnlyClause = evidenceOnlyRegistry.candidates.find((item) => item.type === "clause");
  const evidenceOnlyRef = evidenceOnlyRegistry.candidates.find((item) => item.type === "evidence_reference");
  const evidenceOnlyResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: evidenceOnlyAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: evidenceOnlyRegistry.registryHash,
      candidateSelections: [{
        clauseId: evidenceOnlyClause.id,
        role: "non_assessment",
        primaryEntityCandidateId: null,
        secondaryEntityCandidateId: null,
        subjectCandidateId: null,
        predicateLabel: null,
        objectCandidateId: null,
        valueCandidateId: null,
        timestampCandidateId: null,
        stateCandidateId: null,
        evidenceReferenceIds: evidenceOnlyRef ? [evidenceOnlyRef.id] : [],
        reasoningClauseIds: [],
        uncertaintyCandidateIds: [],
        remediationCandidateIds: [],
        conclusionCandidateIds: [],
        confidence: "supported",
        extractionConfidence: "high",
      }],
    },
  });
  assert("non-assessment evidence-list prose is safely ignored as a non-claim", evidenceOnlyResult.status === "graded" && evidenceOnlyResult.candidateSelectionStages.validatedNonFindingSelections === 1 && evidenceOnlyResult.normalizedSubmission.claims.length === 0 && !evidenceOnlyResult.diagnostics.some((issue) => issue.severity === "high" || issue.severity === "critical"), JSON.stringify(evidenceOnlyResult));
  const evidenceAsFindingResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: evidenceOnlyAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: evidenceOnlyRegistry.registryHash,
      candidateSelections: [{
        clauseId: evidenceOnlyClause.id,
        role: "finding",
        primaryEntityCandidateId: null,
        secondaryEntityCandidateId: null,
        subjectCandidateId: null,
        predicateLabel: "authenticated",
        objectCandidateId: null,
        valueCandidateId: null,
        timestampCandidateId: null,
        stateCandidateId: null,
        evidenceReferenceIds: evidenceOnlyRef ? [evidenceOnlyRef.id] : [],
        reasoningClauseIds: [],
        uncertaintyCandidateIds: [],
        remediationCandidateIds: [],
        conclusionCandidateIds: [],
        confidence: "supported",
        extractionConfidence: "high",
      }],
    },
  });
  assert("non-factual clause selected as finding is rejected as role error", evidenceAsFindingResult.status === "graded" && evidenceAsFindingResult.candidateSelectionStages.rejectedSelectionReasons.role_not_allowed_for_clause === 1 && evidenceAsFindingResult.candidateSelectionStages.disallowedRoleSelections === 1 && evidenceAsFindingResult.candidateSelectionStages.roleAccuracyNumerator === 0 && evidenceAsFindingResult.candidateSelectionStages.roleAccuracyDenominator === 1, JSON.stringify(evidenceAsFindingResult.candidateSelectionStages));
  assert("ambiguous non-factual clause selected as finding is terminally structural-invalid raw factual noise", evidenceAsFindingResult.status === "graded" && evidenceAsFindingResult.candidateSelectionStages.rawFactualCandidateSelections === 1 && evidenceAsFindingResult.candidateSelectionStages.rawFactualStructurallyInvalidSelections === 1 && evidenceAsFindingResult.candidateSelectionStages.rawFactualSelectionReconciliation.structurallyInvalidFactualSelections === 1, JSON.stringify(evidenceAsFindingResult.candidateSelectionStages));

  const uncertaintyOnlyAnswer = `${username}. Scope remains incomplete and requires validation.`;
  const uncertaintyOnlyRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, uncertaintyOnlyAnswer);
  const uncertaintyOnlyClause = uncertaintyOnlyRegistry.candidates.find((item) => item.type === "clause" && /scope|validation/i.test(item.text));
  const uncertaintyIdentity = uncertaintyOnlyRegistry.candidates.find((item) => item.type === "identity");
  const uncertaintyCandidateOnly = uncertaintyOnlyRegistry.candidates.find((item) => item.type === "uncertainty");
  const uncertaintyOnlyResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: uncertaintyOnlyAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: uncertaintyOnlyRegistry.registryHash,
      candidateSelections: [{
        clauseId: uncertaintyOnlyClause.id,
        role: "uncertainty",
        primaryEntityCandidateId: null,
        secondaryEntityCandidateId: null,
        subjectCandidateId: uncertaintyIdentity?.id || null,
        predicateLabel: null,
        objectCandidateId: null,
        valueCandidateId: uncertaintyIdentity?.id || null,
        timestampCandidateId: null,
        stateCandidateId: null,
        evidenceReferenceIds: [],
        reasoningClauseIds: [],
        uncertaintyCandidateIds: uncertaintyCandidateOnly ? [uncertaintyCandidateOnly.id] : [],
        remediationCandidateIds: [],
        conclusionCandidateIds: [],
        confidence: "candidate",
        extractionConfidence: "high",
      }],
    },
  });
  assert("uncertainty clause is routed outside factual claims", uncertaintyOnlyResult.status === "graded" && uncertaintyOnlyResult.candidateSelectionStages.validatedNonFindingSelections === 1 && uncertaintyOnlyResult.normalizedSubmission.claims.length === 0, JSON.stringify(uncertaintyOnlyResult));

  const remediationOnlyAnswer = `Recommended action: ${contract.remediationRequirements[0]?.action || "preserve the evidence"}.`;
  const remediationOnlyRegistry = freeForm.buildLinuxLearnerCandidateRegistry(contract, remediationOnlyAnswer);
  const remediationOnlyClause = remediationOnlyRegistry.candidates.find((item) => item.type === "clause");
  const remediationOnlyCandidate = remediationOnlyRegistry.candidates.find((item) => item.type === "remediation");
  const remediationOnlyResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: remediationOnlyAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: remediationOnlyRegistry.registryHash,
      candidateSelections: [{
        clauseId: remediationOnlyClause.id,
        role: "remediation",
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
        remediationCandidateIds: remediationOnlyCandidate ? [remediationOnlyCandidate.id] : [],
        conclusionCandidateIds: [],
        confidence: "supported",
        extractionConfidence: "high",
      }],
    },
  });
  assert("remediation prose is routed outside historical event claims", remediationOnlyResult.status === "graded" && remediationOnlyResult.candidateSelectionStages.validatedNonFindingSelections === 1 && remediationOnlyResult.scoreReport.findingPoints === 0, JSON.stringify(remediationOnlyResult));

  const hallucinatedEvidenceAnswer = `${learnerFindingPhrase(finding)}. Evidence cited: assets/logs/not-real.log and anchor made-up-anchor.`;
  const hallucinatedEvidenceResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: hallucinatedEvidenceAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: freeForm.buildLinuxLearnerCandidateRegistry(contract, hallucinatedEvidenceAnswer).registryHash,
    },
  });
  assert("learner-stated hallucinated path is diagnosed even without accepted citation", hallucinatedEvidenceResult.status === "graded" && hallucinatedEvidenceResult.diagnostics.some((issue) => issue.code === "LINUX_GRADING_EVIDENCE_HALLUCINATION"), JSON.stringify(hallucinatedEvidenceResult.diagnostics));
  assert("learner-stated fabricated anchor is diagnosed even without accepted citation", hallucinatedEvidenceResult.status === "graded" && hallucinatedEvidenceResult.diagnostics.some((issue) => issue.code === "LINUX_GRADING_ANCHOR_HALLUCINATION"), JSON.stringify(hallucinatedEvidenceResult.diagnostics));
  const punctuatedEvidence = freeForm.discoverLinuxLearnerEvidenceReferences(contract, `${evidencePath}. ${evidencePath}.`);
  assert("evidence discovery trims punctuation without hallucinated duplicates", punctuatedEvidence.length === 2 && punctuatedEvidence.every((reference) => reference.path === evidencePath && reference.status === "exact_path"), JSON.stringify(punctuatedEvidence));

  const unsupportedCertaintyAnswer = `${learnerFindingPhrase(finding)}. This proves malicious intent and full host compromise with certainty.`;
  const unsupportedCertaintyResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: unsupportedCertaintyAnswer,
    rawExtractionObject: {
      ...emptyModelExtraction,
      candidateRegistryHash: freeForm.buildLinuxLearnerCandidateRegistry(contract, unsupportedCertaintyAnswer).registryHash,
    },
  });
  assert("unsupported certainty emits stable diagnostic", unsupportedCertaintyResult.status === "graded" && unsupportedCertaintyResult.diagnostics.some((issue) => issue.code === "LINUX_GRADING_UNSUPPORTED_CERTAINTY"), JSON.stringify(unsupportedCertaintyResult.diagnostics));
  assert("unsupported certainty penalty agrees with typed conclusion", unsupportedCertaintyResult.status === "graded" && unsupportedCertaintyResult.scoreReport.penalties > 0, JSON.stringify(unsupportedCertaintyResult.scoreReport));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
