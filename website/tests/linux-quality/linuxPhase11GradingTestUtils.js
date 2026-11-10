// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { claimFor, fullSubmission, reasoning, uncertaintyAssertions, prohibitedConclusionFor } = require("./linuxPhase10AssessmentTestUtils");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded(namespace = "phase11") {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-${namespace}-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function buildCandidate(buildLinuxAssetCandidate, difficulty = "Advanced", family = "cron_persistence", attemptLimit = 96) {
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
        category: "Linux",
        difficulty,
        duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
        title: "Amniora Linux Asset Pack",
        seed: `phase11:${difficulty}:${family}`,
        generationTime: "2026-07-29T10:00:00.000Z",
        assetAttempt: attempt * 11 + 1,
      }, { incidentFamily: family });
    } catch {
      // Try next deterministic attempt.
    }
  }
  throw new Error(`could not build ${difficulty} ${family}`);
}

function loadPhase11(out) {
  return {
    linux: require(path.join(out, "linux", "index.js")),
    assessment: require(path.join(out, "linux", "assessmentContract.js")),
    schema: require(path.join(out, "linux", "assessmentExtractionSchema.js")),
    freeForm: require(path.join(out, "linux", "freeFormAssessment.js")),
    feedback: require(path.join(out, "linux", "assessmentFeedback.js")),
    provenance: require(path.join(out, "linux", "assessmentGradingProvenance.js")),
  };
}

function extractionFromSubmission(schema, submission) {
  return {
    version: schema.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION,
    taskId: submission.taskId,
    claims: (submission.claims || []).map((claim) => ({
      value: claim.value,
      relationship: claim.relationship,
      timeScope: claim.timeScope,
      evidence: (claim.evidence || []).map((citation) => ({
        path: citation.path,
        anchors: citation.anchors || [],
        rawReference: citation.path,
        extractionConfidence: "high",
      })),
      confidence: claim.confidence,
      reasoning: claim.reasoning,
      conclusions: claim.conclusions || [],
      rawStatement: "learner stated a bounded finding with task-local evidence",
      extractionConfidence: "high",
    })),
    uncertaintyAssertions: (submission.uncertaintyAssertions || []).map((assertion) => ({
      kind: assertion.kind,
      subjectId: assertion.subjectId,
      confidence: assertion.confidence,
      rawStatement: "learner stated an evidence limitation",
      extractionConfidence: "high",
    })),
    remediationActions: (submission.remediationActions || []).map((action) => ({
      action,
      rawStatement: action,
      extractionConfidence: "high",
    })),
    unparsedStatements: [],
  };
}

function fullExtraction(schema, contract) {
  return extractionFromSubmission(schema, fullSubmission(contract));
}

function mutateFirstClaimValue(extraction, value) {
  const mutated = JSON.parse(JSON.stringify(extraction));
  if (mutated.claims && mutated.claims[0]) mutated.claims[0].value = value;
  return mutated;
}

module.exports = {
  ROOT,
  buildCandidate,
  claimFor,
  compileIfNeeded,
  extractionFromSubmission,
  fullExtraction,
  fullSubmission,
  loadPhase11,
  mutateFirstClaimValue,
  prohibitedConclusionFor,
  reasoning,
  uncertaintyAssertions,
};
