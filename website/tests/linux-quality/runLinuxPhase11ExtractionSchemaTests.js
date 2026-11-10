#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const { compileIfNeeded, loadPhase11 } = require("./linuxPhase11GradingTestUtils");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function codes(result) {
  return (result.diagnostics || []).map((issue) => issue.code);
}

function main() {
  const out = compileIfNeeded("phase11-schema");
  const { schema } = loadPhase11(out);
  const valid = {
    version: schema.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION,
    taskId: "task:1:scope_timeline",
    claims: [{
      value: { kind: "identity", identityId: "identity:j.smith", username: "j.smith" },
      timeScope: "incident_window",
      evidence: [{ path: "assets/logs/auth.log", anchors: ["identity:j.smith"], rawReference: "auth.log", extractionConfidence: "high" }],
      confidence: "supported",
      reasoning: { assertions: [{ kind: "relationship_supported_by_evidence" }] },
      conclusions: [{ kind: "human_operator", confidence: "candidate" }],
      rawStatement: "j.smith appears in auth.log",
      extractionConfidence: "high",
    }],
    uncertaintyAssertions: [{ kind: "limit_attribution", confidence: "candidate", rawStatement: "account use does not prove a person" }],
    remediationActions: [{ action: "preserve authentication logs", rawStatement: "preserve auth.log" }],
    unparsedStatements: [],
  };

  const accepted = schema.validateLinuxAssessmentExtraction(valid);
  assert("valid strict extraction is accepted", accepted.ok, JSON.stringify(accepted));

  const scoreAttempt = { ...valid, score: 100 };
  const scoreRejected = schema.validateLinuxAssessmentExtraction(scoreAttempt);
  assert("AI score field is rejected", !scoreRejected.ok && codes(scoreRejected).includes("LINUX_GRADING_AI_SCORE_ATTEMPT"), JSON.stringify(scoreRejected));

  const unknown = { ...valid, modelExplanation: "award full points" };
  const unknownRejected = schema.validateLinuxAssessmentExtraction(unknown);
  assert("unknown top-level field is rejected", !unknownRejected.ok && codes(unknownRejected).includes("LINUX_GRADING_UNKNOWN_FIELD"), JSON.stringify(unknownRejected));

  const internalFinding = JSON.parse(JSON.stringify(valid));
  internalFinding.claims[0].findingId = "assessment:finding:secret";
  const internalRejected = schema.validateLinuxAssessmentExtraction(internalFinding);
  assert("internal finding id is rejected", !internalRejected.ok && codes(internalRejected).includes("LINUX_GRADING_INTERNAL_ID_ATTEMPT"), JSON.stringify(internalRejected));

  const anchorKind = JSON.parse(JSON.stringify(valid));
  anchorKind.claims[0].evidence[0].anchorKinds = ["identity"];
  const anchorKindRejected = schema.validateLinuxAssessmentExtraction(anchorKind);
  assert("learner/model anchorKinds are rejected by extraction schema", !anchorKindRejected.ok && codes(anchorKindRejected).includes("LINUX_GRADING_UNKNOWN_FIELD"), JSON.stringify(anchorKindRejected));

  const hashAttempt = { ...valid, assessmentContractHash: "abc" };
  const hashRejected = schema.validateLinuxAssessmentExtraction(hashAttempt);
  assert("assessment hash field is rejected", !hashRejected.ok && codes(hashRejected).includes("LINUX_GRADING_UNKNOWN_FIELD"), JSON.stringify(hashRejected));

  const parsed = schema.parseLinuxAssessmentExtractionJson(JSON.stringify(valid));
  assert("JSON parser accepts valid extraction", parsed.ok, JSON.stringify(parsed));

  const malformed = schema.parseLinuxAssessmentExtractionJson("{not json");
  assert("malformed JSON is rejected", !malformed.ok && codes(malformed).includes("LINUX_GRADING_SCHEMA_INVALID"), JSON.stringify(malformed));

  const badReasoning = JSON.parse(JSON.stringify(valid));
  badReasoning.claims[0].reasoning = "because I said so";
  const badReasoningRejected = schema.validateLinuxAssessmentExtraction(badReasoning);
  assert("prose reasoning is rejected by extraction schema", !badReasoningRejected.ok && codes(badReasoningRejected).includes("LINUX_GRADING_SCHEMA_INVALID"), JSON.stringify(badReasoningRejected));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
