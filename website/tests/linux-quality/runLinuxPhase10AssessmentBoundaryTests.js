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
  const build = path.join(os.tmpdir(), `amniora-linux-phase10-boundary-${Date.now()}`);
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
        seed: "phase10-boundary:advanced:docker",
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: "docker_compromise" });
    } catch {
      // Continue to the next deterministic attempt.
    }
  }
  throw new Error("could not build boundary fixture");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function codes(report) {
  return report.issues.map((issue) => issue.code);
}

function expectCode(name, report, code) {
  assert(name, codes(report).includes(code), codes(report).join(", "));
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    buildLinuxAssessmentPackage,
    validateLinuxAssessmentPackage,
  } = require(path.join(out, "linux", "assessmentContract.js"));
  const { assertLinuxPreSaveWorkloadBoundary } = require(path.join(out, "linux", "preSaveWorkloadBoundary.js"));

  const candidate = buildCandidate(buildLinuxAssetCandidate);
  const basePackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const baseline = validateLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets, package: basePackage });
  assert("baseline assessment package passes", baseline.issues.length === 0, codes(baseline).join(", "));

  const mutations = [];
  function addMutation(name, mutate, expectedCode) {
    const mutated = clone(basePackage);
    const assets = clone(candidate.assets);
    const simulation = clone(candidate.simulation);
    const lab = undefined;
    const input = mutate({ package: mutated, assets, simulation, lab }) || { package: mutated, assets, simulation, lab };
    const report = validateLinuxAssessmentPackage({
      simulation: input.simulation,
      assets: input.assets,
      package: input.package,
      lab: input.lab,
      expectedAssessmentContractHash: input.expectedAssessmentContractHash,
      expectedAssessmentQualityHash: input.expectedAssessmentQualityHash,
    });
    expectCode(name, report, expectedCode);
    mutations.push({ name, expectedCode, codes: codes(report) });
  }

  addMutation("missing task rubric", ({ package: pkg }) => {
    pkg.contracts.pop();
  }, "LINUX_ASSESSMENT_CONTRACT_MISSING");

  addMutation("missing mandatory finding", ({ package: pkg }) => {
    for (const contract of pkg.contracts) contract.requiredFindings = [];
  }, "LINUX_ASSESSMENT_INCIDENT_COVERAGE_MISSING");

  addMutation("unsupported finding", ({ package: pkg }) => {
    pkg.contracts[0].requiredFindings[0].evidenceAssetIds = [];
    pkg.contracts[0].requiredFindings[0].evidencePaths = [];
  }, "LINUX_ASSESSMENT_FINDING_UNSUPPORTED");

  addMutation("evidence not present in ZIP", ({ assets }) => {
    const pathToRemove = basePackage.contracts[0].evidenceRequirements[0].evidencePath;
    return { package: clone(basePackage), assets: assets.filter((asset) => asset.file_path !== pathToRemove), simulation: clone(candidate.simulation) };
  }, "LINUX_ASSESSMENT_EVIDENCE_MISSING");

  addMutation("evidence not task local", ({ package: pkg }) => {
    const other = candidate.simulation.evidenceRegistry.find((asset) => !candidate.simulation.canonicalTasks[0].selectedEvidenceAssetIds.includes(asset.id));
    pkg.contracts[0].evidenceRequirements[0].evidenceAssetId = other.id;
    pkg.contracts[0].evidenceRequirements[0].evidencePath = other.path;
  }, "LINUX_ASSESSMENT_EVIDENCE_NOT_TASK_LOCAL");

  addMutation("duplicate awarded finding id", ({ package: pkg }) => {
    pkg.contracts[0].requiredFindings.push(clone(pkg.contracts[0].requiredFindings[0]));
  }, "LINUX_ASSESSMENT_DUPLICATE_CREDIT");

  addMutation("overlapping partial credit", ({ package: pkg }) => {
    pkg.contracts[0].requiredFindings[0].partialCreditComponents[1].id = pkg.contracts[0].requiredFindings[0].partialCreditComponents[0].id;
  }, "LINUX_ASSESSMENT_PARTIAL_CREDIT_OVERLAP");

  addMutation("capability used as expected value", ({ package: pkg }) => {
    pkg.contracts[0].requiredFindings[0].expectedValue = {
      kind: "state",
      objectId: "mutated",
      value: pkg.contracts[0].requiredFindings[0].capability,
      timeScope: "historical_reconstruction",
    };
  }, "LINUX_ASSESSMENT_CONTRACT_INVALID");

  addMutation("relationship value without endpoints", ({ package: pkg }) => {
    pkg.contracts[0].requiredFindings[0].expectedValue = {
      kind: "relationship",
      relation: "executed_by",
      sourceId: "",
      targetId: "",
    };
  }, "LINUX_ASSESSMENT_CONTRACT_INVALID");

  addMutation("missing actual expected value", ({ package: pkg }) => {
    delete pkg.contracts[0].requiredFindings[0].expectedValue;
  }, "LINUX_ASSESSMENT_CONTRACT_INVALID");

  addMutation("finding with no value comparator", ({ package: pkg }) => {
    pkg.contracts[0].requiredFindings[0].expectedValue = { kind: "unsupported_kind", value: "x" };
  }, "LINUX_ASSESSMENT_CONTRACT_INVALID");

  addMutation("evidence requirement without quantifier", ({ package: pkg }) => {
    delete pkg.contracts[0].evidenceRequirements[0].mode;
  }, "LINUX_ASSESSMENT_CONTRACT_INVALID");

  addMutation("missing required anchor", ({ package: pkg }) => {
    pkg.contracts[0].evidenceRequirements[0].requiredAnchors = [];
  }, "LINUX_ASSESSMENT_CONTRACT_INVALID");

  addMutation("anchor absent from asset", ({ package: pkg }) => {
    pkg.contracts[0].evidenceRequirements[0].requiredAnchors = ["anchor:not-present"];
  }, "LINUX_ASSESSMENT_CONTRACT_INVALID");

  addMutation("any used where corroboration is required", ({ package: pkg }) => {
    const requirement = pkg.contracts.flatMap((contract) => contract.evidenceRequirements).find((item) => item.evidencePaths.length > 1);
    if (!requirement) {
      pkg.contracts[0].evidenceRequirements[0].evidencePaths = [
        pkg.contracts[0].evidenceRequirements[0].evidencePath,
        pkg.contracts[0].evidenceRequirements[0].evidencePath,
      ];
      pkg.contracts[0].requiredFindings[0].support = "exact";
      pkg.contracts[0].evidenceRequirements[0].mode = "any";
    } else {
      requirement.mode = "any";
      const contract = pkg.contracts.find((item) => item.evidenceRequirements.includes(requirement));
      const finding = contract.requiredFindings.find((item) => item.id === requirement.findingId);
      finding.support = "exact";
    }
  }, "LINUX_ASSESSMENT_CONTRACT_INVALID");

  addMutation("empty contradiction model for uncertain finding", ({ package: pkg }) => {
    const contract = pkg.contracts.find((item) => item.uncertaintyRequirements.length > 0 && item.requiredFindings.some((finding) => finding.allowedUncertainty));
    const finding = contract?.requiredFindings.find((item) => item.allowedUncertainty);
    if (finding) finding.contradictions = [];
  }, "LINUX_ASSESSMENT_UNCERTAINTY_MISSING");

  addMutation("point total above maximum", ({ package: pkg }) => {
    pkg.contracts[0].scoring.maximumPoints += 1;
  }, "LINUX_ASSESSMENT_CONTRACT_INVALID");

  addMutation("point total below lab maximum", ({ package: pkg }) => {
    pkg.maximumPoints = 99;
  }, "LINUX_ASSESSMENT_POINT_TOTAL_INVALID");

  addMutation("zero-point mandatory task", ({ package: pkg }) => {
    pkg.contracts[0].scoring.maximumPoints = 0;
  }, "LINUX_ASSESSMENT_CONTRACT_INVALID");

  addMutation("optional finding outweighs mandatory total", ({ package: pkg }) => {
    pkg.contracts[0].scoring.findingPoints = 0;
    pkg.contracts[0].scoring.evidencePoints = pkg.contracts[0].scoring.maximumPoints;
  }, "LINUX_ASSESSMENT_WEIGHT_IMBALANCE");

  addMutation("missing uncertainty grading", ({ package: pkg }) => {
    for (const contract of pkg.contracts) contract.uncertaintyRequirements = [];
  }, "LINUX_ASSESSMENT_UNCERTAINTY_MISSING");

  addMutation("missing remediation grading", ({ package: pkg }) => {
    for (const contract of pkg.contracts) contract.remediationRequirements = [];
  }, "LINUX_ASSESSMENT_REMEDIATION_MISSING");

  addMutation("missing prohibited claim penalty", ({ package: pkg }) => {
    for (const contract of pkg.contracts) contract.scoring.penalties = [];
  }, "LINUX_ASSESSMENT_PROHIBITED_CLAIM_UNGRADED");

  addMutation("answer-key leakage in learner task", ({ package: pkg }) => ({
    package: pkg,
    assets: clone(candidate.assets),
    simulation: clone(candidate.simulation),
    lab: {
      title: "Assessment leak test",
      scenario: pkg.contracts[0].requiredFindings[0].id,
      tasks: [{ title: "Task", description: "Use the evidence.", deliverable: "Notes", evidence: ["assets/logs/auth.log"] }],
    },
  }), "LINUX_ASSESSMENT_ANSWER_KEY_LEAK");

  addMutation("answer-key leakage in evidence", ({ package: pkg, assets }) => {
    assets[0].content += `\nassessmentContractHash=${pkg.assessmentContractHash}`;
  }, "LINUX_ASSESSMENT_ANSWER_KEY_LEAK");

  addMutation("task mutation after rubric validation", ({ package: pkg }) => {
    const simulation = clone(candidate.simulation);
    simulation.canonicalTasks[0].selectedEvidenceAssetIds = [];
    return {
      package: pkg,
      assets: clone(candidate.assets),
      simulation,
      expectedAssessmentContractHash: basePackage.assessmentContractHash,
      expectedAssessmentQualityHash: baseline.assessmentQualityHash,
    };
  }, "LINUX_ASSESSMENT_HASH_MISMATCH");

  addMutation("evidence mutation after rubric validation", ({ package: pkg }) => ({
    package: pkg,
    assets: candidate.assets.filter((asset) => asset.file_path !== pkg.contracts[0].evidenceRequirements[0].evidencePath),
    simulation: clone(candidate.simulation),
    expectedAssessmentContractHash: basePackage.assessmentContractHash,
    expectedAssessmentQualityHash: baseline.assessmentQualityHash,
  }), "LINUX_ASSESSMENT_HASH_MISMATCH");

  addMutation("rubric hash tampering", ({ package: pkg }) => ({
    package: pkg,
    assets: clone(candidate.assets),
    simulation: clone(candidate.simulation),
    expectedAssessmentContractHash: "tampered",
  }), "LINUX_ASSESSMENT_HASH_MISMATCH");

  addMutation("assessment-quality hash tampering", ({ package: pkg }) => ({
    package: pkg,
    assets: clone(candidate.assets),
    simulation: clone(candidate.simulation),
    expectedAssessmentQualityHash: "tampered",
  }), "LINUX_ASSESSMENT_HASH_MISMATCH");

  const staleHashes = {
    ...candidate.deterministicHashes,
    assessmentContractHash: "tampered",
  };
  let blocked = false;
  try {
    assertLinuxPreSaveWorkloadBoundary({
      context: candidate.investigation,
      assets: candidate.assets,
      simulation: candidate.simulation,
      lab: { title: "x", objective: "x", scenario: "x", tasks: [] },
      provenance: candidate.provenance,
      deterministicHashes: staleHashes,
    });
  } catch (error) {
    blocked = /LINUX_ASSESSMENT_HASH_MISMATCH|LINUX_ASSESSMENT_MUTATED_AFTER_VALIDATION/.test(error.message);
  }
  assert("pre-save blocks stale assessment hashes", blocked);

  console.log(JSON.stringify({ passed: true, mutations: mutations.length, assertions }, null, 2));
}

main();
