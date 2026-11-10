#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { fullSubmission, reasoning } = require("./linuxPhase10AssessmentTestUtils");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase10b-reasoning-${Date.now()}`);
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
        seed: "phase10b-reasoning:advanced:systemd",
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: "systemd_persistence" });
    } catch {
      // Try another deterministic attempt.
    }
  }
  throw new Error("could not build reasoning fixture");
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
  const contract = assessmentPackage.contracts.find((item) => item.scoring.reasoningPoints > 0 && item.requiredFindings.length > 0);
  const full = fullSubmission(contract);
  const fullScore = scoreLinuxStructuredAssessmentSubmission(contract, full);
  assert("baseline structured reasoning earns reasoning points", fullScore.reasoningPoints === contract.scoring.reasoningPoints, JSON.stringify(fullScore));

  const emptyReasoning = clone(full);
  emptyReasoning.claims = emptyReasoning.claims.map((claim) => ({ ...claim, reasoning: undefined }));
  const emptyReasoningScore = scoreLinuxStructuredAssessmentSubmission(contract, emptyReasoning);
  assert("empty reasoning earns zero reasoning points", emptyReasoningScore.reasoningPoints === 0 && emptyReasoningScore.score < fullScore.score, JSON.stringify(emptyReasoningScore));

  const proseReasoning = clone(full);
  proseReasoning.claims = proseReasoning.claims.map((claim) => ({ ...claim, reasoning: "This looks right because the evidence says so." }));
  const proseReasoningScore = scoreLinuxStructuredAssessmentSubmission(contract, proseReasoning);
  assert("free-form reasoning prose does not earn structured reasoning credit", proseReasoningScore.reasoningPoints === 0, JSON.stringify(proseReasoningScore));

  const irrelevantReasoning = clone(full);
  irrelevantReasoning.claims = irrelevantReasoning.claims.map((claim) => ({ ...claim, reasoning: { assertions: [{ kind: "transfer_not_confirmed" }] } }));
  const irrelevantReasoningScore = scoreLinuxStructuredAssessmentSubmission(contract, irrelevantReasoning);
  assert("irrelevant structured reasoning does not automatically earn full credit", irrelevantReasoningScore.reasoningPoints < fullScore.reasoningPoints, JSON.stringify(irrelevantReasoningScore));

  const restored = clone(emptyReasoning);
  restored.claims = restored.claims.map((claim) => ({ ...claim, reasoning: reasoning() }));
  const restoredScore = scoreLinuxStructuredAssessmentSubmission(contract, restored);
  assert("restored bounded assertions recover reasoning credit", restoredScore.reasoningPoints === fullScore.reasoningPoints, JSON.stringify(restoredScore));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
