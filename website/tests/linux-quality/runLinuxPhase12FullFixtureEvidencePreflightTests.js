#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const {
  compileIfNeeded,
  loadPhase11,
} = require("./linuxPhase11GradingTestUtils");
const {
  evidenceStatusTable,
  fullCorpusRegistry,
  validateFullCaseEvidencePreflight,
} = require("./runLinuxPhase12LiveGradingTests.js");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function taskEvidenceSet(item) {
  return new Set(item.contract.evidenceRequirements.flatMap((requirement) => requirement.evidencePaths));
}

function main() {
  const out = compileIfNeeded("phase12-full-fixture-preflight");
  const { linux, assessment } = loadPhase11(out);
  const registry = fullCorpusRegistry(linux, assessment);
  const cases = registry.cases;
  const preflight = validateFullCaseEvidencePreflight(cases);
  assert("full fixture preflight covers all 15 current cases", cases.length === 15 && preflight.perCase.length === 15);
  assert("all current full fixtures pass evidence preflight", preflight.ok, JSON.stringify(preflight.issues));

  for (const category of ["fully_correct", "correct_paraphrase"]) {
    const item = cases.find((candidate) => candidate.category === category);
    const statuses = evidenceStatusTable(item.contract, item, item.learnerAnswer);
    assert(`${category} references are all task-local and creditable`, statuses.length > 0 && statuses.every((status) => ["valid_task_evidence", "valid_alias_task_evidence"].includes(status.status) && status.receivesCredit), JSON.stringify(statuses));
    const allowed = taskEvidenceSet(item);
    assert(`${category} does not rely on stale hard-coded paths`, statuses.every((status) => status.status === "valid_alias_task_evidence" || allowed.has(status.resolvedPath)), JSON.stringify(statuses));
  }

  const hallucinated = cases.find((item) => item.category === "hallucinated_evidence");
  const hallucinatedStatuses = evidenceStatusTable(hallucinated.contract, hallucinated, hallucinated.learnerAnswer);
  assert("hallucinated-evidence fixture references are nonexistent and uncreditable", hallucinatedStatuses.length > 0 && hallucinatedStatuses.every((status) => status.status === "nonexistent_hallucinated" && status.receivesCredit === false), JSON.stringify(hallucinatedStatuses));

  const positive = cases.find((item) => item.category === "correct_paraphrase");
  const positiveStatuses = evidenceStatusTable(positive.contract, positive, positive.learnerAnswer);
  assert("correct_paraphrase replacement references are authoritative task evidence", positiveStatuses.length === 2 && positiveStatuses.every((status) => status.status === "valid_task_evidence" && status.assetExists && status.taskLocal), JSON.stringify(positiveStatuses));

  const taskEvidence = taskEvidenceSet(positive);
  const ineligiblePath = positive.renderedEvidencePaths.find((item) => !taskEvidence.has(item));
  assert("task-ineligible mutation can reference rendered non-task evidence", Boolean(ineligiblePath));
  const ineligibleStatuses = evidenceStatusTable(positive.contract, { ...positive, learnerAnswer: `I cite ${ineligiblePath}.` }, `I cite ${ineligiblePath}.`);
  assert("task-ineligible fixture mutation is distinct from hallucination", ineligibleStatuses[0]?.status === "existing_but_task_ineligible", JSON.stringify(ineligibleStatuses));

  const ambiguousContract = {
    ...positive.contract,
    evidenceRequirements: [{
      ...positive.contract.evidenceRequirements[0],
      evidencePaths: ["assets/logs/shared.log", "assets/reports/shared.log"],
      requiredAnchors: [],
    }],
  };
  const ambiguousStatuses = evidenceStatusTable(ambiguousContract, { ...positive, renderedEvidencePaths: ["assets/logs/shared.log", "assets/reports/shared.log"], learnerAnswer: "I cite shared.log." }, "I cite shared.log.");
  assert("ambiguous-alias fixture mutation resolves to multiple candidates", ambiguousStatuses[0]?.status === "ambiguous_alias", JSON.stringify(ambiguousStatuses));

  const mutated = cases.map((item) => item.category === "correct_paraphrase"
    ? { ...item, learnerAnswer: `${item.learnerAnswer} Also cite assets/logs/not-real-phase12.log.` }
    : item);
  const mutatedPreflight = validateFullCaseEvidencePreflight(mutated);
  assert("mutating positive fixture to nonexistent evidence fails preflight", !mutatedPreflight.ok && mutatedPreflight.issues.some((issue) => issue.caseId === positive.id && issue.code === "POSITIVE_FIXTURE_INVALID_EVIDENCE"), JSON.stringify(mutatedPreflight.issues));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
