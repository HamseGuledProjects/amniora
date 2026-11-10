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
  const build = path.join(os.tmpdir(), `amniora-linux-phase10-duplicates-${Date.now()}`);
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
        seed: "phase10-duplicates:advanced:sudo",
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: "misconfigured_sudoers" });
    } catch {
      // Continue.
    }
  }
  throw new Error("could not build duplicate fixture");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fullSubmission(contract) {
  return {
    taskId: contract.taskId,
    claims: contract.requiredFindings.map((finding) => {
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
      };
    }),
    uncertaintyAssertions: uncertaintyAssertions(contract),
    remediationActions: contract.remediationRequirements.map((item) => item.action),
  };
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    buildLinuxAssessmentPackage,
    scoreLinuxStructuredAssessmentSubmission,
    scoreLinuxAssessmentLabSubmission,
  } = require(path.join(out, "linux", "assessmentContract.js"));

  const candidate = buildCandidate(buildLinuxAssetCandidate);
  const base = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const sourceContract = base.contracts.find((contract) => contract.requiredFindings.length > 0);
  const first = clone(sourceContract);
  const second = clone(sourceContract);
  first.taskId = "task:duplicate:1";
  second.taskId = "task:duplicate:2";
  const labPackage = {
    version: base.version,
    maximumPoints: first.scoring.maximumPoints + second.scoring.maximumPoints,
    assessmentContractHash: "duplicate-test",
    contracts: [first, second],
  };
  const submissions = [fullSubmission(first), fullSubmission(second)];
  const individual = submissions.reduce((total, submission, index) =>
    total + scoreLinuxStructuredAssessmentSubmission(labPackage.contracts[index], submission).score,
  0);
  const lab = scoreLinuxAssessmentLabSubmission(labPackage, submissions);
  assert("individual duplicate task scores can sum fully without lab tracking", individual === labPackage.maximumPoints, JSON.stringify({ individual, maximum: labPackage.maximumPoints }));
  assert("lab-level duplicate contribution tracking suppresses repeated credit", lab.score < individual && lab.duplicateSuppressed > 0, JSON.stringify(lab));

  const suppliedIds = fullSubmission(first);
  suppliedIds.prohibitedClaimIds = ["malicious_intent_without_support"];
  suppliedIds.contradictionIds = ["contradiction:invented"];
  suppliedIds.uncertaintyIds = first.uncertaintyRequirements.map((item) => item.id).concat(["uncertainty:invented"]);
  suppliedIds.findings = [{ findingId: "finding:invented", subjectIds: ["identity:invented"], evidencePaths: ["assets/none"], confidence: "observed" }];
  const clean = scoreLinuxStructuredAssessmentSubmission(first, fullSubmission(first));
  const tampered = scoreLinuxStructuredAssessmentSubmission(first, suppliedIds);
  assert("learner-supplied internal ids cannot manipulate production score", tampered.score === clean.score && tampered.penalties === clean.penalties, JSON.stringify({ clean, tampered }));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
