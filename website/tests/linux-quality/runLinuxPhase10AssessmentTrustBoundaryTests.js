#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { fullSubmission, prohibitedConclusionFor } = require("./linuxPhase10AssessmentTestUtils");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase10b-trust-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function buildCandidate(buildLinuxAssetCandidate, family) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
        category: "Linux",
        difficulty: "Advanced",
        duration: "60 mins",
        title: "Amniora Linux Asset Pack",
        seed: `phase10b-trust:advanced:${family}`,
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: family });
    } catch {
      // Try another deterministic attempt.
    }
  }
  throw new Error(`could not build trust fixture for ${family}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scoreWithFirstContract(buildLinuxAssetCandidate, buildLinuxAssessmentPackage, scoreLinuxStructuredAssessmentSubmission, family) {
  const candidate = buildCandidate(buildLinuxAssetCandidate, family);
  const assessmentPackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = assessmentPackage.contracts.find((item) => item.requiredFindings.length > 0);
  const full = fullSubmission(contract);
  return { contract, full, fullScore: scoreLinuxStructuredAssessmentSubmission(contract, full) };
}

function sourceFiles() {
  const roots = ["app", "components", "lib"];
  const files = [];
  for (const root of roots) {
    const absolute = path.join(ROOT, root);
    if (!fs.existsSync(absolute)) continue;
    const stack = [absolute];
    while (stack.length) {
      const item = stack.pop();
      const stat = fs.statSync(item);
      if (stat.isDirectory()) {
        for (const child of fs.readdirSync(item)) stack.push(path.join(item, child));
      } else if (/\.(ts|tsx|js|jsx)$/.test(item)) {
        files.push(item);
      }
    }
  }
  return files;
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    buildLinuxAssessmentPackage,
    scoreLinuxStructuredAssessmentSubmission,
    scoreLinuxTrustedFixtureAssessmentSubmission,
  } = require(path.join(out, "linux", "assessmentContract.js"));

  const { contract, full, fullScore } = scoreWithFirstContract(
    buildLinuxAssetCandidate,
    buildLinuxAssessmentPackage,
    scoreLinuxStructuredAssessmentSubmission,
    "misconfigured_sudoers"
  );
  assert("baseline trust fixture reaches maximum", fullScore.score === contract.scoring.maximumPoints, JSON.stringify(fullScore));

  const internalIds = clone(full);
  internalIds.findingId = contract.requiredFindings[0].id;
  internalIds.findings = contract.requiredFindings.map((finding) => ({ findingId: finding.id, evidencePaths: finding.evidencePaths, confidence: "observed" }));
  internalIds.prohibitedClaimIds = contract.prohibitedClaims.map((item) => item.id);
  internalIds.contradictionIds = contract.requiredFindings.flatMap((finding) => finding.contradictions.map((item) => item.id));
  internalIds.uncertaintyIds = contract.uncertaintyRequirements.map((item) => item.id);
  internalIds.uncertaintyStatements = contract.uncertaintyRequirements.map((item) => ({ id: item.id, confidence: "candidate" }));
  const internalScore = scoreLinuxStructuredAssessmentSubmission(contract, internalIds);
  assert("learner internal IDs cannot manipulate production score", internalScore.score === fullScore.score && internalScore.penalties === fullScore.penalties, JSON.stringify({ fullScore, internalScore }));

  const idsOnly = {
    taskId: contract.taskId,
    findings: contract.requiredFindings.map((finding) => ({ findingId: finding.id, evidencePaths: finding.evidencePaths, confidence: "observed" })),
    uncertaintyIds: contract.uncertaintyRequirements.map((item) => item.id),
    prohibitedClaimIds: [],
    contradictionIds: [],
  };
  const idsOnlyScore = scoreLinuxStructuredAssessmentSubmission(contract, idsOnly);
  assert("learner finding IDs cannot manufacture a correct claim", idsOnlyScore.score === 0, JSON.stringify(idsOnlyScore));

  const uncertaintyOnlyIds = { taskId: contract.taskId, claims: [], uncertaintyIds: contract.uncertaintyRequirements.map((item) => item.id), uncertaintyStatements: contract.uncertaintyRequirements.map((item) => ({ id: item.id, confidence: "candidate" })) };
  const uncertaintyOnlyScore = scoreLinuxStructuredAssessmentSubmission(contract, uncertaintyOnlyIds);
  assert("copied or invented internal uncertainty IDs earn no credit", uncertaintyOnlyScore.uncertaintyPoints === 0 && uncertaintyOnlyScore.score === 0, JSON.stringify(uncertaintyOnlyScore));

  const overclaim = clone(full);
  overclaim.claims[0].reasoning = "This note avoids the exact banned phrase.";
  overclaim.claims[0].conclusions = [{ kind: prohibitedConclusionFor(contract.prohibitedClaims[0]?.id), confidence: "supported" }];
  const overclaimScore = scoreLinuxStructuredAssessmentSubmission(contract, overclaim);
  assert("typed prohibited conclusion is penalized without phrase matching", overclaimScore.penalties > fullScore.penalties && overclaimScore.score < fullScore.score, JSON.stringify(overclaimScore));

  const phraseOnly = clone(full);
  phraseOnly.claims[0].reasoning = "confirmed exfiltration and malicious intent";
  const phraseOnlyScore = scoreLinuxStructuredAssessmentSubmission(contract, phraseOnly);
  assert("free-form prohibited wording is not authoritative structured grading", phraseOnlyScore.penalties === fullScore.penalties, JSON.stringify(phraseOnlyScore));

  assert("trusted fixture adapter rejects missing internal boundary", (() => {
    try {
      scoreLinuxTrustedFixtureAssessmentSubmission(contract, idsOnly);
      return false;
    } catch (error) {
      return /LINUX_ASSESSMENT_TRUST_BOUNDARY/.test(String(error instanceof Error ? error.message : error));
    }
  })());

  const forbiddenImports = sourceFiles()
    .filter((file) => !file.endsWith(path.join("lib", "lab-assets", "linux", "assessmentContract.ts")))
    .filter((file) => !file.includes(`${path.sep}tests${path.sep}`))
    .filter((file) => fs.readFileSync(file, "utf8").includes("scoreLinuxTrustedFixtureAssessmentSubmission"));
  assert("privileged fixture adapter is not imported by production routes/client modules", forbiddenImports.length === 0, forbiddenImports.join(", "));

  const relationships = [
    ["historical execution versus current inactive state", "systemd_persistence"],
    ["failed authentication versus successful session", "ssh_bruteforce"],
    ["attempted versus successful execution", "misconfigured_sudoers"],
    ["staged versus transferred data", "data_staging"],
    ["removed cron definition versus historical execution", "cron_persistence"],
    ["closed current listener versus historical connection", "reverse_shell"],
  ];
  for (const [name, family] of relationships) {
    const fixture = scoreWithFirstContract(buildLinuxAssetCandidate, buildLinuxAssessmentPackage, scoreLinuxStructuredAssessmentSubmission, family);
    const contradictionFinding = fixture.contract.requiredFindings.find((finding) => finding.contradictions.length > 0) || fixture.contract.requiredFindings[0];
    const contradictory = {
      taskId: fixture.contract.taskId,
      claims: [{
        value: contradictionFinding.contradictions[0]?.contradicts || { kind: "state", objectId: contradictionFinding.id, value: "certain_without_direct_support", timeScope: contradictionFinding.timeScope },
        timeScope: contradictionFinding.timeScope,
        confidence: "certain",
        evidence: [],
        reasoning: { assertions: [{ kind: "relationship_supported_by_evidence" }] },
      }],
      contradictionIds: contradictionFinding.contradictions.map((item) => item.id),
    };
    const contradictionScore = scoreLinuxStructuredAssessmentSubmission(fixture.contract, contradictory);
    assert(`${name} contradiction derives from canonical facts`, contradictionScore.penalties > 0 && contradictionScore.score < fixture.fullScore.score, JSON.stringify(contradictionScore));
  }

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
