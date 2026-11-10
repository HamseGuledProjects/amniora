#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const {
  FULL_CASE_SET_VERSION,
  FULL_CATEGORIES,
  buildFullGateReport,
} = require("./runLinuxPhase12LiveGradingTests.js");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function registry(ids = FULL_CATEGORIES.map((category, index) => `full-${String(index + 1).padStart(2, "0")}-${category}`)) {
  return {
    version: FULL_CASE_SET_VERSION,
    expectedIds: ids,
    expectedIdHash: "test-hash",
    expectedCount: ids.length,
    requiredCategories: [...FULL_CATEGORIES],
  };
}

function result(category, index, overrides = {}) {
  const id = overrides.id || `full-${String(index + 1).padStart(2, "0")}-${category}`;
  return {
    id,
    category,
    difficulty: overrides.difficulty || (index < 2 ? "Beginner" : index < 4 ? "Intermediate" : "Advanced"),
    status: overrides.status || "graded",
    attempts: overrides.attempts || [],
    diagnostics: overrides.diagnostics || [],
    scoreComponents: overrides.scoreComponents || { evidencePoints: 1, penalties: 0 },
    metrics: {
      schemaValid: true,
      surfaceFidelity: { matchedSurfaceClaimCount: 1, extractedSurfaceClaimCount: 1, expectedSurfaceClaimCount: 1 },
      matchedEvidenceReferences: 1,
      extractedEvidenceReferences: 1,
      learnerStatedEvidenceReferences: 1,
      evidenceCreditCorrectness: 1,
      deterministicScoreAgreement: true,
      citationCount: 1,
      validCitations: 1,
      authoritativeEvidenceStatuses: [{ status: "valid_task_evidence", receivesCredit: true, taskLocal: true }],
      authoritativeEvidenceStatusCounts: { valid_task_evidence: 1 },
      validReferenceClassificationAccuracy: 1,
      hallucinatedReferenceClassificationAccuracy: null,
      ...overrides.metrics,
    },
  };
}

function rows(overrides = {}) {
  return FULL_CATEGORIES.map((category, index) => result(category, index, overrides.byIndex?.[index] || {}));
}

function reportFor(results, reg = registry()) {
  return buildFullGateReport({
    results,
    corpusRegistry: reg,
    connectivity: { ok: true },
    productionSchemaSmoke: { ok: true },
    semanticCandidateSmoke: { ok: true },
    stabilityCases: [{ variance: 0 }],
    utf8Ok: true,
  });
}

function main() {
  const reg = registry();
  assert("current full registry produces exact expected count", reg.expectedIds.length === 15 && FULL_CATEGORIES.length === 15);
  assert("expected IDs are unique", new Set(reg.expectedIds).size === reg.expectedIds.length);

  const complete = reportFor(rows(), reg);
  assert("all expected IDs graded completes", complete.gates.find((gate) => gate.name === "all_cases_completed").passed && complete.corpusCompletion.complete && complete.corpusCompletion.corpusCasesExpected === 15, JSON.stringify(complete.blockingReasons));
  assert("completion ratio never exceeds one", complete.corpusCompletion.completionRatio <= 1 && complete.gates.find((gate) => gate.name === "all_cases_completed").observedValue <= 1);
  assert("case-set version and expected-ID hash included", complete.fullCaseSet.version === FULL_CASE_SET_VERSION && typeof complete.fullCaseSet.expectedIdHash === "string");

  const missing = reportFor(rows().slice(1), reg);
  assert("one missing ID fails", !missing.gates.find((gate) => gate.name === "all_cases_completed").passed && missing.corpusCompletion.missingIds.length === 1);

  const duplicateRows = rows();
  duplicateRows[1] = { ...duplicateRows[1], id: duplicateRows[0].id };
  const duplicate = reportFor(duplicateRows, reg);
  assert("one duplicate ID fails", !duplicate.gates.find((gate) => gate.name === "all_cases_completed").passed && duplicate.corpusCompletion.duplicateExecutedIds.length === 1);

  const unexpectedRows = rows();
  unexpectedRows[0] = { ...unexpectedRows[0], id: "unexpected-case" };
  const unexpected = reportFor(unexpectedRows, reg);
  assert("one unexpected ID fails", !unexpected.gates.find((gate) => gate.name === "all_cases_completed").passed && unexpected.corpusCompletion.unexpectedIds.length === 1 && unexpected.corpusCompletion.missingIds.length === 1);

  const deterministicRows = rows();
  deterministicRows[0] = { ...deterministicRows[0], attempts: [] };
  deterministicRows[1] = { ...deterministicRows[1], attempts: [{ ok: true }] };
  const deterministic = reportFor(deterministicRows, reg);
  assert("deterministic-only cases complete without external API calls", deterministic.corpusCompletion.deterministicOnlyCases >= 14 && deterministic.corpusCompletion.externalApiRequests === 1);
  assert("infrastructure probes do not alter corpus denominator", deterministic.populationAccounting.connectivitySmoke === 1 && deterministic.populationAccounting.fullGradingCorpus === 15);

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
