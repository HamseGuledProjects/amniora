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

function forbiddenTokens(contract, pkg) {
  return [
    pkg.assessmentContractHash,
    "requiredFindings",
    "expectedValue",
    "prohibitedClaims",
    "uncertaintyRequirements",
    "remediationRequirements",
    "findingPoints",
    "evidencePoints",
    ...contract.requiredFindings.map((finding) => finding.id),
    ...contract.requiredFindings.flatMap((finding) => finding.canonicalSubjectIds),
  ].filter(Boolean);
}

async function main() {
  const out = compileIfNeeded("phase11-feedback");
  const { linux, assessment, schema, freeForm, feedback } = loadPhase11(out);
  const candidate = buildCandidate(linux.buildLinuxAssetCandidate, "Advanced", "data_staging");
  const pkg = assessment.buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = pkg.contracts.find((item) => item.requiredFindings.length > 0 && item.remediationRequirements.length > 0) ||
    pkg.contracts.find((item) => item.requiredFindings.length > 0) ||
    pkg.contracts[0];
  const full = fullExtraction(schema, contract);
  const tokens = forbiddenTokens(contract, pkg);

  const graded = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: "I cite task-local evidence and provide bounded remediation.",
    rawExtractionObject: full,
    createdAt: "2026-07-29T10:00:00.000Z",
  });
  assert("graded feedback is produced", graded.status === "graded" && graded.feedback.status === "graded", JSON.stringify(graded));
  assert("graded feedback does not expose answer key", feedback.validateLinuxAssessmentFeedbackBoundary(graded.feedback, tokens).length === 0, JSON.stringify(graded.feedback));

  const weakEvidence = JSON.parse(JSON.stringify(full));
  weakEvidence.claims = weakEvidence.claims.map((claim) => ({ ...claim, evidence: [] }));
  const weak = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: "I state the conclusion but cite no evidence.",
    rawExtractionObject: weakEvidence,
    createdAt: "2026-07-29T10:00:00.000Z",
  });
  assert("weak evidence feedback describes citation problem", weak.status === "graded" && weak.feedback.evidenceIssues.length > 0, JSON.stringify(weak.feedback));
  assert("weak evidence feedback hides expected values", feedback.validateLinuxAssessmentFeedbackBoundary(weak.feedback, tokens).length === 0, JSON.stringify(weak.feedback));

  const vague = JSON.parse(JSON.stringify(full));
  vague.remediationActions = [{ action: "secure the server", rawStatement: "secure the server" }];
  const vagueResult = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: "Fix it by securing the server.",
    rawExtractionObject: vague,
    createdAt: "2026-07-29T10:00:00.000Z",
  });
  assert("vague remediation feedback is learner-safe", vagueResult.status === "graded" && feedback.validateLinuxAssessmentFeedbackBoundary(vagueResult.feedback, tokens).length === 0, JSON.stringify(vagueResult.feedback));

  const retry = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: "",
    rawExtractionObject: full,
    createdAt: "2026-07-29T10:00:00.000Z",
  });
  assert("invalid input returns retryable feedback without scoring", retry.status === "retryable" && retry.feedback.status === "rejected", JSON.stringify(retry));
  assert("retry feedback hides answer key", feedback.validateLinuxAssessmentFeedbackBoundary(retry.feedback, tokens).length === 0, JSON.stringify(retry.feedback));

  const schemaFailure = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: "Here is my answer.",
    rawExtractionObject: { version: schema.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION, taskId: contract.taskId, score: 100 },
    createdAt: "2026-07-29T10:00:00.000Z",
  });
  assert("schema failure feedback explains deterministic score authority", schemaFailure.status === "retryable" && JSON.stringify(schemaFailure.feedback).includes("deterministic grader"), JSON.stringify(schemaFailure.feedback));
  assert("schema failure feedback hides answer key", feedback.validateLinuxAssessmentFeedbackBoundary(schemaFailure.feedback, tokens).length === 0, JSON.stringify(schemaFailure.feedback));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
