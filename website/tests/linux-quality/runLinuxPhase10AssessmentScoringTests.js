#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const { reasoning, uncertaintyAssertions, prohibitedConclusionFor } = require("./linuxPhase10AssessmentTestUtils");
let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase10-scoring-${Date.now()}`);
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
        seed: "phase10-scoring:advanced:cron",
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: "cron_persistence" });
    } catch {
      // Try the next deterministic family attempt.
    }
  }
  throw new Error("could not build scoring fixture");
}

function fullSubmission(contract) {
  return {
    taskId: contract.taskId,
    claims: contract.requiredFindings.map((finding) => {
      const requirement = contract.evidenceRequirements.find((item) => item.findingId === finding.id);
      return {
        value: finding.expectedValue,
        relationship: finding.relationship && finding.expectedValue.kind === "relationship"
          ? { relation: finding.relationship, sourceId: finding.expectedValue.sourceId, targetId: finding.expectedValue.targetId }
          : finding.relationship
            ? { relation: finding.relationship }
            : undefined,
        timeScope: finding.timeScope,
        evidence: (requirement?.evidencePaths || finding.evidencePaths).map((path) => ({
          path,
          anchors: requirement?.requiredAnchors || [],
        })),
        confidence: finding.allowedUncertainty ? "supported" : "observed",
        reasoning: reasoning(),
      };
    }),
    uncertaintyAssertions: uncertaintyAssertions(contract),
    remediationActions: contract.remediationRequirements.map((item) => item.action),
    prohibitedClaimIds: [],
    contradictionIds: [],
  };
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    buildLinuxAssessmentPackage,
    scoreLinuxStructuredAssessmentSubmission,
  } = require(path.join(out, "linux", "assessmentContract.js"));

  const candidate = buildCandidate(buildLinuxAssetCandidate);
  const assessmentPackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contracts = assessmentPackage.contracts;
  const remediationContract = contracts.find((contract) => contract.remediationRequirements.length > 0) || contracts[contracts.length - 1];
  const normalContract = contracts[0];
  const uncertaintyContract = contracts.find((contract) => contract.requiredFindings.some((finding) => finding.allowedUncertainty && finding.contradictions.length > 0)) || remediationContract;

  const full = scoreLinuxStructuredAssessmentSubmission(remediationContract, fullSubmission(remediationContract));
  assert("full structured answer receives maximum task score", full.score === remediationContract.scoring.maximumPoints, JSON.stringify(full));

  const incompleteEvidence = fullSubmission(remediationContract);
  incompleteEvidence.claims = incompleteEvidence.claims.map((claim) => ({ ...claim, evidence: [] }));
  const incomplete = scoreLinuxStructuredAssessmentSubmission(remediationContract, incompleteEvidence);
  assert("correct conclusion with incomplete evidence loses evidence/reasoning credit", incomplete.score < full.score && incomplete.findingPoints > 0 && incomplete.evidencePoints === 0, JSON.stringify(incomplete));

  const partial = fullSubmission(remediationContract);
  partial.claims = partial.claims.slice(0, 1).map((claim) => ({ ...claim, relationship: { relation: "wrong_relationship" } }));
  partial.uncertaintyAssertions = [];
  partial.remediationActions = [];
  const partialScore = scoreLinuxStructuredAssessmentSubmission(remediationContract, partial);
  assert("partial finding receives defensible partial credit", partialScore.score > 0 && partialScore.score < full.score, JSON.stringify(partialScore));

  const overclaim = fullSubmission(remediationContract);
  overclaim.claims[0].conclusions = [{
    kind: prohibitedConclusionFor(remediationContract.prohibitedClaims[0]?.id),
    confidence: "certain",
  }];
  const overclaimScore = scoreLinuxStructuredAssessmentSubmission(remediationContract, overclaim);
  assert("unsupported overclaim is penalized", overclaimScore.score < full.score && overclaimScore.penalties > 0, JSON.stringify(overclaimScore));

  const incorrectSubject = fullSubmission(normalContract);
  incorrectSubject.claims = incorrectSubject.claims.map((claim) => ({ ...claim, value: { kind: "identity", identityId: "identity:not-present", username: "not-present" } }));
  const subjectScore = scoreLinuxStructuredAssessmentSubmission(normalContract, incorrectSubject);
  assert("incorrect subject loses finding credit", subjectScore.findingPoints < normalContract.scoring.findingPoints, JSON.stringify(subjectScore));

  const irrelevantCitation = fullSubmission(normalContract);
  irrelevantCitation.claims = irrelevantCitation.claims.map((claim) => ({ ...claim, evidence: [{ path: "assets/does/not/exist.log", anchors: ["not-present"] }] }));
  const citationScore = scoreLinuxStructuredAssessmentSubmission(normalContract, irrelevantCitation);
  assert("irrelevant citation loses evidence credit", citationScore.evidencePoints === 0, JSON.stringify(citationScore));

  const missingRemediation = fullSubmission(remediationContract);
  missingRemediation.remediationActions = [];
  const remediationScore = scoreLinuxStructuredAssessmentSubmission(remediationContract, missingRemediation);
  assert("missing remediation loses remediation credit", remediationScore.remediationPoints === 0 && remediationScore.score < full.score, JSON.stringify(remediationScore));

  const vagueRemediation = fullSubmission(remediationContract);
  vagueRemediation.remediationActions = ["secure the server", "block the attacker"];
  const vagueScore = scoreLinuxStructuredAssessmentSubmission(remediationContract, vagueRemediation);
  assert("vague remediation earns no remediation credit", vagueScore.remediationPoints === 0, JSON.stringify(vagueScore));

  const contradiction = fullSubmission(uncertaintyContract);
  const uncertain = uncertaintyContract.requiredFindings.find((finding) => finding.allowedUncertainty && finding.contradictions.length > 0);
  if (uncertain) {
    contradiction.claims = [{
      value: uncertain.contradictions[0].contradicts,
      timeScope: uncertain.timeScope,
      confidence: "certain",
      evidence: [],
    }];
  } else {
    contradiction.claims = contradiction.claims.map((claim) => ({ ...claim, confidence: "certain" }));
  }
  const contradictionFull = scoreLinuxStructuredAssessmentSubmission(uncertaintyContract, fullSubmission(uncertaintyContract));
  const contradictionScore = scoreLinuxStructuredAssessmentSubmission(uncertaintyContract, contradiction);
  assert("contradictory answer is penalized", contradictionScore.score < contradictionFull.score, JSON.stringify(contradictionScore));

  const empty = scoreLinuxStructuredAssessmentSubmission(remediationContract, { taskId: remediationContract.taskId });
  assert("empty answer scores zero", empty.score === 0, JSON.stringify(empty));

  const repeat = scoreLinuxStructuredAssessmentSubmission(remediationContract, fullSubmission(remediationContract));
  assert("structured scoring is deterministic", JSON.stringify(full) === JSON.stringify(repeat));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
