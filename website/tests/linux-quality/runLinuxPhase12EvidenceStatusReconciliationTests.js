#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const path = require("path");
const {
  buildCandidate,
  compileIfNeeded,
  fullExtraction,
  loadPhase11,
} = require("./linuxPhase11GradingTestUtils");
const {
  answerFor,
  evidenceStatusTable,
  metricForResult,
} = require("./runLinuxPhase12LiveGradingTests.js");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function codes(result) {
  return new Set((result.diagnostics || []).map((diagnostic) => diagnostic.code));
}

function firstTaskWithEvidence(assessmentPackage) {
  return assessmentPackage.contracts.find((contract) => contract.evidenceRequirements.flatMap((requirement) => requirement.evidencePaths).length > 0)
    || assessmentPackage.contracts[0];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setFirstCitationPath(extraction, evidencePath) {
  const next = clone(extraction);
  if (next.claims?.[0]) {
    next.claims[0].evidence = [{ path: evidencePath, anchors: [], rawReference: evidencePath, extractionConfidence: "high" }];
    next.claims = [next.claims[0]];
  }
  return next;
}

function firstComponentEvidencePoints(result) {
  const first = result.scoreReport?.componentScores?.[0] || {};
  return (first.evidenceCitationPoints || 0) + (first.evidenceAnchorPoints || 0);
}

async function grade(freeForm, contract, learnerAnswer, extraction, renderedEvidencePaths) {
  return freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer,
    rawExtractionObject: extraction,
    renderedEvidencePaths,
    createdAt: "2026-08-04T12:00:00.000Z",
  });
}

async function main() {
  const out = compileIfNeeded("phase12-evidence-status");
  const { linux, assessment, schema, freeForm } = loadPhase11(out);
  const candidate = buildCandidate(linux.buildLinuxAssetCandidate, "Advanced", "systemd_persistence");
  const pkg = assessment.buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = firstTaskWithEvidence(pkg);
  const renderedEvidencePaths = candidate.assets.map((asset) => asset.file_path);
  const taskEvidence = Array.from(new Set(contract.evidenceRequirements.flatMap((requirement) => requirement.evidencePaths)));
  const taskEvidencePath = taskEvidence[0];
  const alias = path.basename(taskEvidencePath);
  const baseExtraction = fullExtraction(schema, contract);

  const exact = await grade(freeForm, contract, `I cite ${taskEvidencePath}.`, setFirstCitationPath(baseExtraction, taskEvidencePath), renderedEvidencePaths);
  assert("exact task-local path receives credit with no hallucination diagnostic", exact.status === "graded" && !codes(exact).has("LINUX_GRADING_EVIDENCE_HALLUCINATION") && exact.scoreReport.evidencePoints > 0, JSON.stringify(exact.diagnostics));

  const aliasResult = await grade(freeForm, contract, `I cite ${alias}.`, setFirstCitationPath(baseExtraction, alias), renderedEvidencePaths);
  assert("unique basename alias resolves and receives credit with no hallucination diagnostic", aliasResult.status === "graded" && !codes(aliasResult).has("LINUX_GRADING_EVIDENCE_HALLUCINATION") && aliasResult.scoreReport.evidencePoints > 0, JSON.stringify(aliasResult));
  const aliasMetrics = metricForResult(contract, aliasResult, { contract, learnerAnswer: `I cite ${alias}.`, renderedEvidencePaths });
  assert("valid alias task evidence has no contradictory metric", aliasMetrics.authoritativeEvidenceStatusCounts.valid_alias_task_evidence === 1 && aliasMetrics.validReferenceClassificationAccuracy === 1 && aliasMetrics.evidenceCreditCorrectness === 1, JSON.stringify(aliasMetrics));

  const ineligiblePath = renderedEvidencePaths.find((item) => !taskEvidence.includes(item));
  assert("fixture has rendered non-task evidence for ineligible mutation", Boolean(ineligiblePath), JSON.stringify({ taskEvidence, renderedEvidencePaths: renderedEvidencePaths.slice(0, 8) }));
  const ineligible = await grade(freeForm, contract, `I cite ${ineligiblePath}.`, setFirstCitationPath(baseExtraction, ineligiblePath), renderedEvidencePaths);
  assert("existing but task-ineligible evidence has distinct diagnostic and no credit", ineligible.status === "graded" && codes(ineligible).has("LINUX_GRADING_EVIDENCE_TASK_INELIGIBLE") && !codes(ineligible).has("LINUX_GRADING_EVIDENCE_HALLUCINATION") && firstComponentEvidencePoints(ineligible) === 0, JSON.stringify(ineligible));
  const ineligibleMetrics = metricForResult(contract, ineligible, { contract, learnerAnswer: `I cite ${ineligiblePath}.`, renderedEvidencePaths });
  assert("existing but task-ineligible metric is non-hallucinated rejection", ineligibleMetrics.authoritativeEvidenceStatusCounts.existing_but_task_ineligible === 1 && ineligibleMetrics.taskIneligibleReferenceClassificationAccuracy === 1 && ineligibleMetrics.evidenceCreditCorrectness === 1, JSON.stringify(ineligibleMetrics));

  const nonexistentPath = "assets/logs/not-real-phase12.log";
  const nonexistent = await grade(freeForm, contract, `I cite ${nonexistentPath}.`, setFirstCitationPath(baseExtraction, nonexistentPath), renderedEvidencePaths);
  assert("nonexistent evidence emits hallucination and receives no credit", nonexistent.status === "graded" && codes(nonexistent).has("LINUX_GRADING_EVIDENCE_HALLUCINATION") && firstComponentEvidencePoints(nonexistent) === 0, JSON.stringify(nonexistent));

  const ambiguousContract = {
    ...contract,
    evidenceRequirements: [{
      ...contract.evidenceRequirements[0],
      evidencePaths: ["assets/logs/shared.log", "assets/reports/shared.log"],
      requiredAnchors: [],
    }],
  };
  const ambiguousStatuses = evidenceStatusTable(ambiguousContract, { learnerAnswer: "I cite shared.log.", renderedEvidencePaths: ["assets/logs/shared.log", "assets/reports/shared.log"] }, "I cite shared.log.");
  assert("ambiguous basename emits ambiguity status and no credit", ambiguousStatuses[0]?.status === "ambiguous_alias" && ambiguousStatuses[0].receivesCredit === false, JSON.stringify(ambiguousStatuses));

  const mixedMetrics = metricForResult(contract, nonexistent, { contract, learnerAnswer: `I cite ${taskEvidencePath} and ${nonexistentPath}.`, renderedEvidencePaths });
  assert("mixed valid and hallucinated references reconcile exactly", mixedMetrics.authoritativeEvidenceStatusCounts.valid_task_evidence === 1 && mixedMetrics.authoritativeEvidenceStatusCounts.nonexistent_hallucinated === 1 && mixedMetrics.matchedEvidenceReferences <= mixedMetrics.extractedEvidenceReferences, JSON.stringify(mixedMetrics));

  const correctParaphrase = await grade(freeForm, contract, answerFor(contract, "correct_paraphrase"), setFirstCitationPath(baseExtraction, alias), renderedEvidencePaths);
  const correctMetrics = metricForResult(contract, correctParaphrase, { contract, category: "correct_paraphrase", learnerAnswer: `The task evidence points to the finding. I cite ${alias}.`, renderedEvidencePaths });
  assert("correct_paraphrase path has no contradictory evidence metrics", correctParaphrase.status === "graded" && !codes(correctParaphrase).has("LINUX_GRADING_EVIDENCE_HALLUCINATION") && correctMetrics.validReferenceClassificationAccuracy === 1 && correctMetrics.evidenceCreditCorrectness === 1, JSON.stringify({ diagnostics: correctParaphrase.diagnostics, metrics: correctMetrics }));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
