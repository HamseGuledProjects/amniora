#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const FAMILIES = [
  "misconfigured_sudoers",
  "ssh_bruteforce",
  "service_account_misuse",
  "ssh_key_compromise",
  "cron_persistence",
  "systemd_persistence",
  "unauthorized_package_install",
  "data_staging",
  "log_tampering",
  "reverse_shell",
  "docker_compromise",
];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase10-assessment-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function buildCandidate(buildLinuxAssetCandidate, family, difficulty) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
        category: "Linux",
        difficulty,
        duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
        title: "Amniora Linux Asset Pack",
        seed: `phase10-assessment:${difficulty}:${family}`,
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${difficulty} ${family}`);
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxAssessmentPackage, validateLinuxAssessmentPackage } = require(path.join(out, "linux", "assessmentContract.js"));
  const rows = [];

  for (const difficulty of DIFFICULTIES) {
    for (const family of FAMILIES) {
      const candidate = buildCandidate(buildLinuxAssetCandidate, family, difficulty);
      const assessmentPackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
      const report = validateLinuxAssessmentPackage({
        simulation: candidate.simulation,
        assets: candidate.assets,
        package: assessmentPackage,
      });
      assert(`${difficulty} ${family} assessment has one contract per task`, assessmentPackage.contracts.length === candidate.simulation.canonicalTasks.length);
      assert(`${difficulty} ${family} assessment has 100 total points`, report.totalPoints === 100);
      assert(`${difficulty} ${family} assessment quality passes`, report.issues.length === 0, report.issues.map((issue) => `${issue.code}:${issue.message}`).join("; "));
      assert(`${difficulty} ${family} final quality includes assessment hash`, Boolean(candidate.assetQuality.assessmentContractHash && candidate.assetQuality.assessmentQualityHash));
      assert(`${difficulty} ${family} deterministic hash includes assessment hash`, Boolean(candidate.deterministicHashes.assessmentContractHash && candidate.deterministicHashes.assessmentQualityHash));
      for (const contract of assessmentPackage.contracts) {
        assert(`${difficulty} ${family} ${contract.taskId} has positive weight`, contract.scoring.maximumPoints > 0);
        assert(`${difficulty} ${family} ${contract.taskId} has required findings`, contract.requiredFindings.length > 0);
        assert(`${difficulty} ${family} ${contract.taskId} has evidence requirements`, contract.evidenceRequirements.length > 0);
        assert(`${difficulty} ${family} ${contract.taskId} scoring buckets sum`, contract.scoring.findingPoints + contract.scoring.evidencePoints + contract.scoring.reasoningPoints + contract.scoring.uncertaintyPoints + contract.scoring.remediationPoints === contract.scoring.maximumPoints);
      }
      rows.push({
        difficulty,
        family,
        tasks: assessmentPackage.contracts.length,
        totalPoints: report.totalPoints,
        requiredFindings: assessmentPackage.contracts.reduce((total, contract) => total + contract.requiredFindings.length, 0),
        evidenceRequirements: assessmentPackage.contracts.reduce((total, contract) => total + contract.evidenceRequirements.length, 0),
        uncertaintyRules: assessmentPackage.contracts.reduce((total, contract) => total + contract.uncertaintyRequirements.length, 0),
        remediationRules: assessmentPackage.contracts.reduce((total, contract) => total + contract.remediationRequirements.length, 0),
        prohibitedClaims: assessmentPackage.contracts.reduce((total, contract) => total + contract.prohibitedClaims.length, 0),
        assessmentContractHash: assessmentPackage.assessmentContractHash,
        assessmentQualityHash: report.assessmentQualityHash,
        finalResult: report.issues.length === 0 ? "pass" : "fail",
      });
    }
  }

  const artifactDir = path.join(ROOT, ".tmp", "linux-phase10-assessment");
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "phase10-assessment-matrix.json"), JSON.stringify({
    version: "phase10-assessment-matrix-v1",
    generatedAt: "2026-07-29T08:00:00.000Z",
    rows,
    assertionSummary: {
      testCasesExecuted: rows.length,
      assertionsExecuted: assertions,
      casesPassed: assertions,
      casesFailed: 0,
      casesSkipped: 0,
    },
  }, null, 2));
  console.log(JSON.stringify({ passed: true, rows: rows.length, assertions }, null, 2));
}

main();
