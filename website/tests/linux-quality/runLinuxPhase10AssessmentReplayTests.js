#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase10-replay-${Date.now()}`);
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
        difficulty: "Intermediate",
        duration: "30 mins",
        title: "Amniora Linux Asset Pack",
        seed: "phase10-replay:intermediate:systemd",
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: "systemd_persistence" });
    } catch {
      // Try the next deterministic attempt.
    }
  }
  throw new Error("could not build replay fixture");
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { replayLinuxGeneration } = require(path.join(out, "linux", "replay.js"));
  const { buildLinuxGenerationProvenanceRow } = require(path.join(out, "linux", "provenancePersistence.js"));
  const candidate = buildCandidate(buildLinuxAssetCandidate);

  const exact = replayLinuxGeneration({
    provenance: candidate.provenance,
    expectedHashes: candidate.deterministicHashes,
    title: "Amniora Linux Asset Pack",
  });
  assert("same-seed replay matches assessment hashes", exact.status === "exact_match", JSON.stringify(exact.firstMismatch || exact.mismatchedLayers));
  assert("assessment contract hash is present", Boolean(candidate.deterministicHashes.assessmentContractHash));
  assert("assessment quality hash is present", Boolean(candidate.deterministicHashes.assessmentQualityHash));

  const legacyHashes = { ...candidate.deterministicHashes };
  delete legacyHashes.assessmentContractHash;
  delete legacyHashes.assessmentQualityHash;
  delete legacyHashes.finalDeterministicHash;
  const legacy = replayLinuxGeneration({
    provenance: candidate.provenance,
    expectedHashes: legacyHashes,
    title: "Amniora Linux Asset Pack",
  });
  assert("historical workload-era labs without assessment hashes get legacy status", legacy.status === "legacy_without_assessment_hash", legacy.status);

  const taskMismatch = replayLinuxGeneration({
    provenance: candidate.provenance,
    expectedHashes: { ...candidate.deterministicHashes, taskContractHash: "tampered" },
    title: "Amniora Linux Asset Pack",
  });
  assert("task changes produce replay mismatch", taskMismatch.status === "mismatch" && taskMismatch.mismatchedLayers.includes("taskContractHash"), JSON.stringify(taskMismatch));

  const evidenceMismatch = replayLinuxGeneration({
    provenance: candidate.provenance,
    expectedHashes: { ...candidate.deterministicHashes, assetContentHash: "tampered" },
    title: "Amniora Linux Asset Pack",
  });
  assert("evidence changes produce replay mismatch", evidenceMismatch.status === "mismatch" && evidenceMismatch.mismatchedLayers.includes("assetContentHash"), JSON.stringify(evidenceMismatch));

  const contractMismatch = replayLinuxGeneration({
    provenance: candidate.provenance,
    expectedHashes: { ...candidate.deterministicHashes, assessmentContractHash: "tampered" },
    title: "Amniora Linux Asset Pack",
  });
  assert("rubric-weight or finding changes produce assessment contract mismatch", contractMismatch.status === "mismatch" && contractMismatch.mismatchedLayers.includes("assessmentContractHash"), JSON.stringify(contractMismatch));

  const qualityMismatch = replayLinuxGeneration({
    provenance: candidate.provenance,
    expectedHashes: { ...candidate.deterministicHashes, assessmentQualityHash: "tampered" },
    title: "Amniora Linux Asset Pack",
  });
  assert("assessment quality changes produce assessment quality mismatch", qualityMismatch.status === "mismatch" && qualityMismatch.mismatchedLayers.includes("assessmentQualityHash"), JSON.stringify(qualityMismatch));

  const row = buildLinuxGenerationProvenanceRow({
    labId: "lab-phase10",
    generatedLabId: "generated-phase10",
    userId: "00000000-0000-0000-0000-000000000010",
    provenance: candidate.provenance,
    deterministicHashes: candidate.deterministicHashes,
  });
  assert("provenance row stores assessment contract hash", row.assessment_contract_hash === candidate.deterministicHashes.assessmentContractHash);
  assert("provenance row stores assessment quality hash", row.assessment_quality_hash === candidate.deterministicHashes.assessmentQualityHash);
  assert("provenance deterministic hashes keep assessment internal", Boolean(row.deterministic_hashes.assessmentContractHash && row.deterministic_hashes.assessmentQualityHash));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
