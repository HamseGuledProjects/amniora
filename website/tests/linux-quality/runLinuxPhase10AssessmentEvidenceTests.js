#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const { reasoning, uncertaintyAssertions } = require("./linuxPhase10AssessmentTestUtils");
let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase10-evidence-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function buildCandidate(buildLinuxAssetCandidate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
        category: "Linux",
        difficulty: "Advanced",
        duration: "60 mins",
        title: "Amniora Linux Asset Pack",
        seed: "phase10-evidence:advanced:cron",
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: "cron_persistence" });
    } catch {
      // Try another deterministic attempt.
    }
  }
  throw new Error("could not build evidence fixture");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function claimFor(contract, finding, override = {}) {
  const requirement = contract.evidenceRequirements.find((item) => item.findingId === finding.id);
  return {
    value: finding.expectedValue,
    relationship: finding.expectedValue.kind === "relationship"
      ? { relation: finding.expectedValue.relation, sourceId: finding.expectedValue.sourceId, targetId: finding.expectedValue.targetId }
      : finding.relationship ? { relation: finding.relationship } : undefined,
    timeScope: finding.timeScope,
    evidence: requirement.evidencePaths.map((path) => ({
      path,
      anchors: requirement.requiredAnchors,
    })),
    confidence: finding.allowedUncertainty ? "supported" : "observed",
    reasoning: reasoning(),
    ...override,
  };
}

function fullSubmission(contract) {
  return {
    taskId: contract.taskId,
    claims: contract.requiredFindings.map((finding) => claimFor(contract, finding)),
    uncertaintyAssertions: uncertaintyAssertions(contract),
    remediationActions: contract.remediationRequirements.map((item) => item.action),
  };
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    buildLinuxAssessmentPackage,
    validateLinuxAssessmentPackage,
    scoreLinuxStructuredAssessmentSubmission,
  } = require(path.join(out, "linux", "assessmentContract.js"));

  const candidate = buildCandidate(buildLinuxAssetCandidate);
  const assessmentPackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = assessmentPackage.contracts.find((item) => item.evidenceRequirements.some((requirement) => requirement.mode === "minimum" || requirement.mode === "all")) ||
    assessmentPackage.contracts.find((item) => item.evidenceRequirements.length > 0);
  const baseline = validateLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets, package: assessmentPackage });
  assert("baseline evidence package passes", baseline.issues.length === 0, baseline.issues.map((issue) => issue.message).join("; "));

  const full = scoreLinuxStructuredAssessmentSubmission(contract, fullSubmission(contract));
  assert("full anchored citations receive full evidence credit", full.evidencePoints === contract.scoring.evidencePoints, JSON.stringify(full));

  const invalidAnchor = fullSubmission(contract);
  invalidAnchor.claims = invalidAnchor.claims.map((claim) => ({
    ...claim,
    evidence: claim.evidence.map((citation) => ({ ...citation, anchors: ["anchor:not-present"] })),
  }));
  const invalidAnchorScore = scoreLinuxStructuredAssessmentSubmission(contract, invalidAnchor);
  assert("invalid evidence anchors lose anchor and reasoning credit", invalidAnchorScore.evidencePoints < full.evidencePoints && invalidAnchorScore.reasoningPoints < full.reasoningPoints, JSON.stringify(invalidAnchorScore));

  const corroborated = contract.evidenceRequirements.find((requirement) => (requirement.minimumCount || 1) > 1);
  if (corroborated) {
    const missingCorroboration = fullSubmission(contract);
    missingCorroboration.claims = missingCorroboration.claims.map((claim) => ({
      ...claim,
      evidence: claim.evidence.slice(0, 1),
    }));
    const missingScore = scoreLinuxStructuredAssessmentSubmission(contract, missingCorroboration);
    assert("missing corroboration loses evidence credit", missingScore.evidencePoints < full.evidencePoints, JSON.stringify(missingScore));
  } else {
    assert("single-source contracts declare any-mode evidence", contract.evidenceRequirements.every((requirement) => requirement.mode === "any"));
  }

  const mutated = clone(assessmentPackage);
  mutated.contracts[0].evidenceRequirements[0].mode = undefined;
  let mutationReport = validateLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets, package: mutated });
  assert("evidence requirement without quantifier is rejected", mutationReport.issues.some((issue) => issue.code === "LINUX_ASSESSMENT_CONTRACT_INVALID"), mutationReport.issues.map((issue) => issue.message).join("; "));

  const anchorMutation = clone(assessmentPackage);
  anchorMutation.contracts[0].evidenceRequirements[0].requiredAnchors = ["anchor:not-in-asset"];
  mutationReport = validateLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets, package: anchorMutation });
  assert("anchor absent from asset is rejected", mutationReport.issues.some((issue) => issue.code === "LINUX_ASSESSMENT_CONTRACT_INVALID"), mutationReport.issues.map((issue) => issue.message).join("; "));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
