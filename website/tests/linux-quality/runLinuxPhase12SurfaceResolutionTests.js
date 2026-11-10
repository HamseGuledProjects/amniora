#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const { buildCandidate, compileIfNeeded, loadPhase11 } = require("./linuxPhase11GradingTestUtils");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function main() {
  const out = compileIfNeeded("phase12-surface-resolution");
  const { linux, assessment, freeForm } = loadPhase11(out);
  const candidate = buildCandidate(linux.buildLinuxAssetCandidate, "Advanced", "cron_persistence");
  const pkg = assessment.buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = pkg.contracts[0];
  const finding = contract.requiredFindings[0];
  const requirement = contract.evidenceRequirements.find((item) => item.findingId === finding.id);
  const path = requirement.evidencePaths[0];
  const alias = path.split("/").pop();

  const valid = freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, {
    taskId: contract.taskId,
    claims: [{ value: finding.expectedValue, evidence: [{ path: alias, anchors: [] }] }],
  });
  assert("unique basename evidence alias resolves", valid.submission.claims[0].evidence[0].path === path);
  assert("empty anchors are server filled only after valid path resolution", (valid.submission.claims[0].evidence[0].anchors || []).length > 0);

  const wrongAnchor = freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, {
    taskId: contract.taskId,
    claims: [{ value: finding.expectedValue, evidence: [{ path: alias, anchors: ["fabricated-anchor"] }] }],
  });
  assert("supplied fabricated anchors are preserved", wrongAnchor.submission.claims[0].evidence[0].anchors[0] === "fabricated-anchor");

  const unresolved = freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, {
    taskId: contract.taskId,
    claims: [{ value: { kind: "identity", username: "not-the-user" }, evidence: [{ path: "not-real.log", anchors: [] }] }],
  });
  assert("wrong values remain unresolved", unresolved.resolutionRecords[0].status === "unresolved");
  assert("hallucinated paths remain invalid", unresolved.submission.claims[0].evidence[0].path === "not-real.log");

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
