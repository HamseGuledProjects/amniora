#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { fullSubmission } = require("./linuxPhase10AssessmentTestUtils");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase10b-anchor-${Date.now()}`);
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
        seed: "phase10b-anchor:advanced:cron",
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: "cron_persistence" });
    } catch {
      // Try another deterministic attempt.
    }
  }
  throw new Error("could not build anchor registry fixture");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxAssessmentPackage, scoreLinuxStructuredAssessmentSubmission } = require(path.join(out, "linux", "assessmentContract.js"));

  const candidate = buildCandidate(buildLinuxAssetCandidate);
  const assessmentPackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = assessmentPackage.contracts.find((item) => item.requiredFindings.length > 1 && item.evidenceRequirements.length > 1) ||
    assessmentPackage.contracts.find((item) => item.evidenceRequirements.length > 0);
  const full = fullSubmission(contract);
  const fullScore = scoreLinuxStructuredAssessmentSubmission(contract, full);
  assert("baseline anchored answer scores maximum", fullScore.score === contract.scoring.maximumPoints, JSON.stringify(fullScore));

  const fabricatedKind = clone(full);
  fabricatedKind.claims = fabricatedKind.claims.map((claim) => ({
    ...claim,
    evidence: claim.evidence.map((citation) => ({ ...citation, anchors: ["fabricated-anchor"], anchorKinds: ["pid", "timestamp", "relationship"] })),
  }));
  const fabricatedKindScore = scoreLinuxStructuredAssessmentSubmission(contract, fabricatedKind);
  assert("fabricated anchor kind earns no anchor credit", fabricatedKindScore.evidencePoints < fullScore.evidencePoints, JSON.stringify(fabricatedKindScore));

  const wrongDeclaredKind = clone(full);
  wrongDeclaredKind.claims = wrongDeclaredKind.claims.map((claim) => ({
    ...claim,
    evidence: claim.evidence.map((citation) => ({ ...citation, anchorKinds: ["socket", "pid", "invented"] })),
  }));
  const wrongKindScore = scoreLinuxStructuredAssessmentSubmission(contract, wrongDeclaredKind);
  assert("correct anchor with wrong learner-declared kind still uses canonical kind", wrongKindScore.evidencePoints === fullScore.evidencePoints, JSON.stringify(wrongKindScore));

  const wrongAsset = clone(full);
  const wrongPath = contract.evidenceRequirements.find((requirement) => requirement.evidencePaths[1])?.evidencePaths[1] ||
    assessmentPackage.contracts.flatMap((item) => item.evidenceRequirements).find((requirement) => !contract.evidenceRequirements.some((local) => local.evidencePath === requirement.evidencePath))?.evidencePath ||
    "assets/not-selected.log";
  wrongAsset.claims[0].evidence = wrongAsset.claims[0].evidence.map((citation) => ({ ...citation, path: wrongPath }));
  const wrongAssetScore = scoreLinuxStructuredAssessmentSubmission(contract, wrongAsset);
  assert("valid anchor from wrong asset earns no credit", wrongAssetScore.evidencePoints < fullScore.evidencePoints, JSON.stringify(wrongAssetScore));

  if (contract.requiredFindings.length > 1) {
    const otherRequirement = contract.evidenceRequirements.find((requirement) => requirement.findingId === contract.requiredFindings[1].id);
    const wrongFindingAnchor = clone(full);
    wrongFindingAnchor.claims[0].evidence = wrongFindingAnchor.claims[0].evidence.map((citation) => ({
      ...citation,
      path: otherRequirement?.evidencePath || citation.path,
      anchors: otherRequirement?.requiredAnchors || citation.anchors,
    }));
    const wrongFindingScore = scoreLinuxStructuredAssessmentSubmission(contract, wrongFindingAnchor);
    assert("real anchor supporting another finding earns no anchor credit", wrongFindingScore.evidencePoints < fullScore.evidencePoints, JSON.stringify(wrongFindingScore));
  } else {
    assert("single-finding contract cannot exercise different-finding anchor", true);
  }

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
