#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const { buildCandidate, claimFor, compileIfNeeded, fullSubmission, loadPhase11 } = require("./linuxPhase11GradingTestUtils");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function pct(report) {
  return report.maximumPoints ? report.score / report.maximumPoints : 0;
}

function main() {
  const out = compileIfNeeded("phase12-differential");
  const { linux, assessment } = loadPhase11(out);
  const scorer = require(`${out}/linux/assessmentContract.js`);
  const candidate = buildCandidate(linux.buildLinuxAssetCandidate, "Advanced", "data_staging");
  const pkg = assessment.buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = pkg.contracts.find((item) => item.requiredFindings.length >= 2) || pkg.contracts[0];
  const first = contract.requiredFindings[0];
  const full = scorer.scoreLinuxStructuredAssessmentSubmission(contract, fullSubmission(contract));
  const partial = scorer.scoreLinuxStructuredAssessmentSubmission(contract, { taskId: contract.taskId, claims: [claimFor(contract, first)] });
  const wrong = scorer.scoreLinuxStructuredAssessmentSubmission(contract, { taskId: contract.taskId, claims: [{ ...claimFor(contract, first), value: { kind: "identity", username: "wrong-user" } }] });
  const empty = scorer.scoreLinuxStructuredAssessmentSubmission(contract, { taskId: contract.taskId, claims: [] });

  assert("same-contract full exceeds partial", pct(full) > pct(partial), `${pct(full)} <= ${pct(partial)}`);
  assert("same-contract partial exceeds materially wrong", pct(partial) > pct(wrong), `${pct(partial)} <= ${pct(wrong)}`);
  assert("same-contract materially wrong exceeds or equals empty", pct(wrong) >= pct(empty), `${pct(wrong)} < ${pct(empty)}`);
  assert("same-contract empty is zero", pct(empty) === 0, String(pct(empty)));

  const remediationCandidate = buildCandidate(linux.buildLinuxAssetCandidate, "Advanced", "systemd_persistence");
  const remediationPkg = assessment.buildLinuxAssessmentPackage({ simulation: remediationCandidate.simulation, assets: remediationCandidate.assets });
  const remediationContract = remediationPkg.contracts.find((item) => item.remediationRequirements.length >= 2 && item.scoring.remediationPoints >= item.remediationRequirements.length) ||
    remediationPkg.contracts.find((item) => item.remediationRequirements.length > 0 && item.scoring.remediationPoints > 0);
  if (remediationContract) {
    const actions = remediationContract.remediationRequirements.map((item) => item.action);
    const noRemediation = scorer.scoreLinuxStructuredAssessmentSubmission(remediationContract, { taskId: remediationContract.taskId, remediationActions: [] });
    const vague = scorer.scoreLinuxStructuredAssessmentSubmission(remediationContract, { taskId: remediationContract.taskId, remediationActions: ["fix it", "investigate further"] });
    const unrelated = scorer.scoreLinuxStructuredAssessmentSubmission(remediationContract, { taskId: remediationContract.taskId, remediationActions: ["reset a random unrelated user password"] });
    const specific = scorer.scoreLinuxStructuredAssessmentSubmission(remediationContract, { taskId: remediationContract.taskId, remediationActions: [actions[0]] });
    const multiStep = scorer.scoreLinuxStructuredAssessmentSubmission(remediationContract, { taskId: remediationContract.taskId, remediationActions: actions });
    assert("specific remediation outscores vague remediation", specific.remediationPoints > vague.remediationPoints, `${specific.remediationPoints} <= ${vague.remediationPoints}`);
    assert("applicable remediation outscores unrelated remediation", specific.remediationPoints > unrelated.remediationPoints, `${specific.remediationPoints} <= ${unrelated.remediationPoints}`);
    assert("actionable multi-step remediation is at least as strong as one specific action", multiStep.remediationPoints >= specific.remediationPoints, `${multiStep.remediationPoints} < ${specific.remediationPoints}`);
    assert("no remediation receives zero remediation credit", noRemediation.remediationPoints === 0, String(noRemediation.remediationPoints));
  } else {
    assert("remediation differential fixture has remediation coverage", false, "No remediation contract found in data_staging package.");
  }

  console.log(JSON.stringify({ passed: true, assertions, scores: { full: pct(full), partial: pct(partial), wrong: pct(wrong), empty: pct(empty) } }, null, 2));
}

main();
