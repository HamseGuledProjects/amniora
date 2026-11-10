#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const {
  buildCandidate,
  compileIfNeeded,
  loadPhase11,
} = require("./linuxPhase11GradingTestUtils");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function main() {
  const out = compileIfNeeded("phase12-atomic");
  const { linux, assessment, schema, freeForm } = loadPhase11(out);
  const candidate = buildCandidate(linux.buildLinuxAssetCandidate, "Beginner", "ssh_key_compromise");
  const pkg = assessment.buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = pkg.contracts.find((item) => item.requiredFindings.some((finding) => finding.expectedValue.kind === "identity")) || pkg.contracts[0];
  const identity = contract.requiredFindings.find((finding) => finding.expectedValue.kind === "identity");
  const evidencePath = contract.evidenceRequirements.find((item) => item.findingId === identity.id).evidencePaths[0];
  const evidence = evidencePath.split("/").pop();
  const remediation = contract.remediationRequirements[0]?.action;
  const learnerAnswer = `${evidence} shows ${identity.expectedValue.username} authenticated. ${remediation ? `Recommended action: ${remediation}. ` : ""}This proves full compromise.`;
  const extraction = {
    version: schema.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION,
    taskId: contract.taskId,
    atomicClaims: [{
      claimSpan: `${identity.expectedValue.username} authenticated`,
      subjectSpan: identity.expectedValue.username,
      predicateLabel: "authenticated",
      objectSpan: null,
      valueSpan: identity.expectedValue.username,
      timestampSpan: null,
      stateSpan: null,
      reasoningSpan: null,
      uncertaintySpan: null,
      remediationSpan: remediation || null,
      conclusionSpan: "proves full compromise",
      subject: { kind: "identity", text: "model-normalized-should-not-win" },
      predicate: null,
      object: null,
      valueText: null,
      timestampText: null,
      stateText: null,
      confidence: "supported",
      evidenceReferences: [{ rawReference: evidence, locator: null, quotedAnchor: null, extractionConfidence: "high" }],
      reasoningAssertions: ["relationship_supported_by_evidence"],
      uncertaintyAssertions: null,
      conclusionAssertions: null,
      rawStatement: "learner named the authenticated account",
      extractionConfidence: "high",
    }, {
      claimSpan: `${identity.expectedValue.username} authenticated`,
      subjectSpan: identity.expectedValue.username,
      predicateLabel: "authenticated",
      objectSpan: null,
      valueSpan: identity.expectedValue.username,
      timestampSpan: null,
      stateSpan: null,
      reasoningSpan: null,
      uncertaintySpan: null,
      remediationSpan: null,
      conclusionSpan: null,
      subject: { kind: "identity", text: identity.expectedValue.username },
      predicate: null,
      object: null,
      valueText: null,
      timestampText: null,
      stateText: null,
      confidence: "supported",
      evidenceReferences: [{ rawReference: evidence, locator: null, quotedAnchor: null, extractionConfidence: "high" }],
      reasoningAssertions: null,
      uncertaintyAssertions: null,
      conclusionAssertions: null,
      rawStatement: null,
      extractionConfidence: "high",
    }],
    claims: null,
    uncertaintyAssertions: null,
    remediationActions: null,
    unparsedStatements: null,
  };
  const parsed = schema.validateLinuxAssessmentExtraction(extraction);
  assert("atomic extraction schema is accepted", parsed.ok, JSON.stringify(parsed));
  const discovered = freeForm.discoverLinuxLearnerEvidenceReferences(contract, `${learnerAnswer} ./not-real/evidence.log`);
  assert("deterministic evidence discovery resolves unique basename", discovered.some((item) => item.rawReference === evidence && item.path === evidencePath && item.status === "unique_basename"), JSON.stringify(discovered));
  assert("deterministic evidence discovery preserves hallucinated paths", discovered.some((item) => item.status === "hallucinated" && item.rawReference.includes("not-real/evidence.log")), JSON.stringify(discovered));
  const result = freeForm.gradeLinuxFreeFormAssessment({ contract, learnerAnswer, rawExtractionObject: extraction });
  Promise.resolve(result).then((graded) => {
    assert("atomic extraction grades through deterministic scorer", graded.status === "graded", JSON.stringify(graded));
    assert("atomic extraction resolves at least one claim", graded.normalizationRecords.some((record) => record.field.includes("surfaceResolution") && ["exact", "equivalent_format"].includes(record.rawValue)));
    const identityClaims = (graded.normalizedSubmission.claims || []).filter((claim) => claim.value.kind === "identity" && claim.value.username === identity.expectedValue.username);
    assert("duplicate grounded atomic identity claims normalize to one scored claim", identityClaims.length === 1, JSON.stringify(graded.normalizedSubmission.claims));
    assert("model-normalized entity text does not override grounded subject span", JSON.stringify(graded.normalizedSubmission).includes(identity.expectedValue.username) && !JSON.stringify(graded.normalizedSubmission).includes("model-normalized-should-not-win"));
    assert("explicit overclaim phrase is extracted deterministically", (graded.normalizedSubmission.claims || []).some((claim) => (claim.conclusions || []).some((conclusion) => conclusion.kind === "full_host_compromise" && conclusion.confidence === "certain")), JSON.stringify(graded.normalizedSubmission.claims));
    if (remediation) assert("grounded specific remediation is preserved", (graded.normalizedSubmission.remediationActions || []).includes(remediation), JSON.stringify(graded.normalizedSubmission.remediationActions));
    assert("atomic extraction does not expose canonical claims in model input", extraction.claims === null);
    const ungrounded = JSON.parse(JSON.stringify(extraction));
    ungrounded.atomicClaims = [{
      ...ungrounded.atomicClaims[0],
      claimSpan: "this exact phrase is absent",
      subjectSpan: "absent-user",
      valueSpan: "absent-user",
    }];
    return freeForm.gradeLinuxFreeFormAssessment({ contract, learnerAnswer, rawExtractionObject: ungrounded });
  }).then((ungroundedResult) => {
    assert("ungrounded spans are rejected before resolution", ungroundedResult.status === "graded" && ungroundedResult.diagnostics.some((diagnostic) => diagnostic.code === "LINUX_GRADING_UNGROUNDED_EXTRACTED_SPAN"), JSON.stringify(ungroundedResult));
    assert("ungrounded rejected claim receives no finding credit", (ungroundedResult.normalizedSubmission.claims || []).length === 0, JSON.stringify(ungroundedResult.normalizedSubmission));
    console.log(JSON.stringify({ passed: true, assertions }, null, 2));
  });
}

main();
