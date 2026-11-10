#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const {
  buildCandidate,
  claimFor,
  compileIfNeeded,
  fullSubmission,
  loadPhase11,
} = require("./linuxPhase11GradingTestUtils");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function key(value) {
  return JSON.stringify(value);
}

function metricOracle(expected, actual) {
  const expectedKeys = expected.map(key);
  const actualKeys = actual.map(key);
  const expectedSet = new Set(expectedKeys);
  const actualSet = new Set(actualKeys);
  const matched = actualKeys.filter((item) => expectedSet.has(item)).length;
  return {
    precision: actualKeys.length ? matched / actualKeys.length : 1,
    recall: expectedKeys.length ? expectedKeys.filter((item) => actualSet.has(item)).length / expectedKeys.length : 1,
    matched,
  };
}

function firstFindingOfKind(contract, kind) {
  return contract.requiredFindings.find((finding) => finding.expectedValue.kind === kind) || contract.requiredFindings[0];
}

function surfaceValue(value) {
  switch (value.kind) {
    case "identity":
      return { kind: "identity", username: value.username, uid: value.uid };
    case "file":
      return { kind: "file", path: `./${value.path}` };
    case "service":
      return { kind: "service", unit: value.unit.toUpperCase() };
    case "package":
      return { kind: "package", name: value.name.toUpperCase() };
    case "command":
      return { kind: "command", executable: value.executable, normalizedCommand: value.normalizedCommand };
    case "cron":
      return { kind: "cron", command: value.command, schedule: value.schedule };
    case "network":
      return { kind: "network", sourceIp: value.sourceIp, destinationIp: value.destinationIp, destinationPort: value.destinationPort, protocol: value.protocol };
    case "timestamp":
      return { kind: "timestamp", timestamp: value.timestamp };
    default:
      return value;
  }
}

function claimWithSurface(contract, finding, override = {}) {
  const base = claimFor(contract, finding);
  return {
    ...base,
    value: surfaceValue(finding.expectedValue),
    ...override,
  };
}

function main() {
  const out = compileIfNeeded("phase12-extraction-quality");
  const { linux, assessment, freeForm } = loadPhase11(out);
  const candidate = buildCandidate(linux.buildLinuxAssetCandidate, "Advanced", "cron_persistence");
  const pkg = assessment.buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = pkg.contracts.find((item) => item.requiredFindings.length >= 2) || pkg.contracts[0];
  const finding = contract.requiredFindings[0];
  const second = contract.requiredFindings[1] || finding;

  const exactMetrics = metricOracle([finding.expectedValue], [finding.expectedValue]);
  assert("metric oracle exact submission has precision 1 recall 1", exactMetrics.precision === 1 && exactMetrics.recall === 1);

  const emptyMetrics = metricOracle([finding.expectedValue], []);
  assert("metric oracle empty submission has recall 0", emptyMetrics.precision === 1 && emptyMetrics.recall === 0);

  const mixedMetrics = metricOracle([finding.expectedValue, second.expectedValue], [finding.expectedValue, { kind: "identity", username: "nobody" }]);
  assert("metric oracle one correct and one incorrect claim is partial", mixedMetrics.precision === 0.5 && mixedMetrics.recall === 0.5);

  const equivalent = freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, {
    taskId: contract.taskId,
    claims: [claimWithSurface(contract, finding)],
  });
  assert("surface resolver maps equivalent formatting to canonical value", ["exact", "equivalent_format"].includes(equivalent.resolutionRecords[0].status) && key(equivalent.submission.claims[0].value) === key(finding.expectedValue));

  const wrong = freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, {
    taskId: contract.taskId,
    claims: [{ ...claimWithSurface(contract, finding), value: { kind: "identity", username: "nobody" } }],
  });
  assert("surface resolver does not silently correct wrong values", wrong.resolutionRecords[0].status === "unresolved" && wrong.submission.claims[0].value.username === "nobody");

  const noId = finding.expectedValue.kind === "identity"
    ? freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, { taskId: contract.taskId, claims: [{ ...claimFor(contract, finding), value: { kind: "identity", username: finding.expectedValue.username } }] })
    : equivalent;
  assert("correct surface value without canonical id resolves only when exact task-local value matches", ["exact", "equivalent_format"].includes(noId.resolutionRecords[0].status));

  const requirement = contract.evidenceRequirements.find((item) => item.findingId === finding.id);
  if (requirement) {
    const alias = requirement.evidencePaths[0].split("/").pop();
    const aliasResolved = freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, {
      taskId: contract.taskId,
      claims: [{ ...claimWithSurface(contract, finding), evidence: [{ path: alias, anchors: [] }] }],
    });
    assert("evidence path basename alias resolves when task-local unique", aliasResolved.submission.claims[0].evidence[0].path === requirement.evidencePaths[0]);
    assert("canonical anchors are server-resolved for a valid resolved finding/path", JSON.stringify(aliasResolved.submission.claims[0].evidence[0].anchors || []) === JSON.stringify(requirement.requiredAnchors));

    const hallucinated = freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, {
      taskId: contract.taskId,
      claims: [{ ...claimWithSurface(contract, finding), evidence: [{ path: "assets/logs/not-real.log", anchors: ["made-up-anchor"] }] }],
    });
    assert("hallucinated evidence path is preserved as invalid", hallucinated.submission.claims[0].evidence[0].path === "assets/logs/not-real.log");

    const fabricatedAnchor = freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, {
      taskId: contract.taskId,
      claims: [{ ...claimWithSurface(contract, finding), evidence: [{ path: alias, anchors: ["fabricated-anchor"] }] }],
    });
    assert("fabricated anchors are preserved for canonical validation", JSON.stringify(fabricatedAnchor.submission.claims[0].evidence[0].anchors) === JSON.stringify(["fabricated-anchor"]));
  }

  const scorer = require(`${out}/linux/assessmentContract.js`);
  const full = fullSubmission(contract);
  const fullResolved = freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, full).submission;
  const partial = { taskId: contract.taskId, claims: [claimWithSurface(contract, finding)] };
  const wrongSubject = { taskId: contract.taskId, claims: [{ ...claimWithSurface(contract, finding), value: { kind: "identity", username: "nobody" } }] };
  const empty = { taskId: contract.taskId, claims: [] };
  const fullScore = scorer.scoreLinuxStructuredAssessmentSubmission(contract, fullResolved);
  const partialScore = scorer.scoreLinuxStructuredAssessmentSubmission(contract, freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, partial).submission);
  const wrongScore = scorer.scoreLinuxStructuredAssessmentSubmission(contract, freeForm.resolveLinuxSurfaceAssessmentSubmission(contract, wrongSubject).submission);
  const emptyScore = scorer.scoreLinuxStructuredAssessmentSubmission(contract, empty);
  assert("same-contract full score exceeds partial", fullScore.score > partialScore.score, `${fullScore.score} <= ${partialScore.score}`);
  assert("same-contract partial score exceeds wrong subject", partialScore.score > wrongScore.score, `${partialScore.score} <= ${wrongScore.score}`);
  assert("same-contract empty answer remains zero", emptyScore.score === 0, `${emptyScore.score}`);

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
