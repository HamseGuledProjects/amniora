#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const {
  FULL_CASE_SET_VERSION,
  buildFullGateReport,
  compileForLiveHarness,
  currentCodeVersion,
  fullCaseContentHash,
  fullCorpusRegistry,
  loadCompiledLinux,
  sanitizedFullCaseContentRecord,
  validateFullArtifactForPhase12Closure,
} = require("./runLinuxPhase12LiveGradingTests.js");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function resultFor(item, overrides = {}) {
  const evidenceCount = sanitizedFullCaseContentRecord(item).expectedSurfaceClaimCounts.evidence_reference;
  return {
    id: item.id,
    category: item.category,
    difficulty: item.difficulty,
    family: item.family,
    status: "graded",
    attempts: [{ ok: true }],
    diagnostics: item.category === "internal_id_attack" || item.category === "prompt_injection"
      ? [{ code: "LINUX_GRADING_INTERNAL_ID_ATTEMPT", severity: "high" }]
      : item.category === "hallucinated_evidence"
        ? [{ code: "LINUX_GRADING_EVIDENCE_HALLUCINATION", severity: "medium" }]
        : item.category === "unsupported_certainty"
          ? [{ code: "LINUX_GRADING_UNSUPPORTED_CERTAINTY", severity: "medium" }]
          : [],
    score: item.category === "vague_remediation" ? 14 : 18,
    maximumPoints: 20,
    scoreComponents: {
      findingPoints: 10,
      evidencePoints: item.category === "hallucinated_evidence" ? 0 : evidenceCount,
      reasoningPoints: 2,
      uncertaintyPoints: item.category === "valid_uncertainty" ? 1 : 0,
      remediationPoints: item.category === "strong_remediation" ? 4 : 0,
      penalties: item.category === "unsupported_certainty" ? 2 : 0,
    },
    metrics: {
      schemaValid: true,
      surfaceFidelity: {
        expectedSurfaceClaimCount: 1,
        extractedSurfaceClaimCount: 1,
        matchedSurfaceClaimCount: 1,
      },
      learnerStatedEvidenceReferences: evidenceCount,
      extractedEvidenceReferences: evidenceCount,
      matchedEvidenceReferences: evidenceCount,
      evidenceCreditCorrectness: 1,
      deterministicScoreAgreement: true,
      citationCount: evidenceCount,
      validCitations: item.category === "hallucinated_evidence" ? 0 : evidenceCount,
      authoritativeEvidenceStatuses: sanitizedFullCaseContentRecord(item).expectedEvidenceStatusClassifications.map((status) => ({
        status: status.status,
        receivesCredit: status.receivesCredit,
      })),
      authoritativeEvidenceStatusCounts: sanitizedFullCaseContentRecord(item).expectedEvidenceStatusCounts,
      validReferenceClassificationAccuracy: item.category === "hallucinated_evidence" ? null : 1,
      hallucinatedReferenceClassificationAccuracy: item.category === "hallucinated_evidence" ? 1 : null,
    },
    ...overrides,
  };
}

function passedSummary(codeVersion, registry) {
  const results = registry.cases.map((item) => resultFor(item));
  const fullGateReport = buildFullGateReport({
    results,
    corpusRegistry: registry,
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
    semanticCandidateSmoke: { ok: true },
    stabilityCases: [{ variance: 0 }],
    utf8Ok: true,
  });
  fullGateReport.passed = true;
  fullGateReport.blockingReasons = [];
  return {
    version: "linux-phase12-live-summary-v2",
    ...codeVersion,
    passed: true,
    status: "LIVE_VALIDATION_PASSED",
    finalVerdict: "PHASE 12 VERIFIED CLOSED",
    fullGateReport,
    reportPolicy: {
      rawModelResponsesPersisted: false,
      promptsPersisted: false,
      assessmentContractsPersisted: false,
      answerKeysPersisted: false,
      apiKeyPersisted: false,
      responseHeadersPersisted: false,
    },
  };
}

function main() {
  compileForLiveHarness();
  const { linux, assessment, adapter, schema } = loadCompiledLinux();
  const registry = fullCorpusRegistry(linux, assessment);
  const codeVersion = currentCodeVersion(schema, adapter, registry);

  assert("full case-set version bumped to explicit paraphrase claim version", FULL_CASE_SET_VERSION === "phase12-full-case-set-v5-explicit-paraphrase-claims");
  assert("registry exposes expected-ID and content hashes", /^[a-f0-9]{64}$/.test(registry.expectedIdHash) && /^[a-f0-9]{64}$/.test(registry.fullCaseContentHash));
  assert("content hash covers all 15 full cases", registry.cases.length === 15 && registry.expectedCount === 15);

  const mutated = registry.cases.map((item, index) => index === 1 ? { ...item, learnerAnswer: `${item.learnerAnswer} assets/logs/auth.log` } : item);
  assert("changed full fixture content changes the content hash", fullCaseContentHash(mutated) !== registry.fullCaseContentHash);
  assert("reordered identical cases preserve order-insensitive content hash", fullCaseContentHash([...registry.cases].reverse()) === registry.fullCaseContentHash);

  const sampleRecord = sanitizedFullCaseContentRecord(registry.cases[1]);
  const serializedRecord = JSON.stringify(sampleRecord);
  assert("sanitized content record contains answer hash but not raw learner answer", sampleRecord.learnerAnswerHash && !serializedRecord.includes(registry.cases[1].learnerAnswer));
  assert("sanitized content record excludes hidden contract text", !serializedRecord.includes("assessmentContractHash") && !serializedRecord.includes("requiredFindings"));

  const summary = passedSummary(codeVersion, registry);
  assert("current full version/hash accepted", validateFullArtifactForPhase12Closure(summary, codeVersion).ok);
  assert("stale full version rejected", !validateFullArtifactForPhase12Closure({ ...summary, fullCaseSetVersion: "phase12-full-case-set-v3-surface-fidelity" }, codeVersion).ok);
  assert("previous evidence-authoritative full version rejected", !validateFullArtifactForPhase12Closure({ ...summary, fullCaseSetVersion: "phase12-full-case-set-v4-evidence-authoritative" }, codeVersion).ok);
  assert("stale full content hash rejected", !validateFullArtifactForPhase12Closure({ ...summary, fullCaseContentHash: "0".repeat(64) }, codeVersion).ok);
  const staleGate = JSON.parse(JSON.stringify(summary));
  staleGate.fullGateReport.fullCaseSet.fullCaseContentHash = "1".repeat(64);
  delete staleGate.fullCaseContentHash;
  assert("stale full gate report content hash rejected", !validateFullArtifactForPhase12Closure(staleGate, codeVersion).ok);

  const sanitizedReport = JSON.stringify(summary);
  const secret = process.env.OPENAI_API_KEY || "";
  assert("sanitized report contains no API key", !secret || !sanitizedReport.includes(secret));
  assert("sanitized report contains no raw full-case learner answers", registry.cases.every((item) => !sanitizedReport.includes(item.learnerAnswer)));
  assert("sanitized report contains no hidden contracts", !sanitizedReport.includes("requiredFindings") && !sanitizedReport.includes("answerKeysPersisted\":true"));

  console.log(JSON.stringify({
    passed: true,
    assertions,
    fullCaseSetVersion: FULL_CASE_SET_VERSION,
    expectedIdHash: registry.expectedIdHash,
    fullCaseContentHash: registry.fullCaseContentHash,
  }, null, 2));
}

main();
