#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const { reasoning, uncertaintyAssertions, prohibitedConclusionFor } = require("./linuxPhase10AssessmentTestUtils");
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
const VARIANTS = [
  "full",
  "incomplete_evidence",
  "correct_subject_wrong_relationship",
  "correct_relationship_wrong_subject",
  "correct_value_wrong_timestamp",
  "correct_conclusion_irrelevant_citation",
  "correct_evidence_invalid_anchor",
  "missing_corroboration",
  "valid_uncertainty",
  "unsupported_certainty",
  "prohibited_overclaim",
  "canonical_contradiction",
  "missing_remediation",
  "vague_remediation",
  "duplicate_remediation",
  "empty",
];

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase10-matrix-${Date.now()}`);
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
        seed: `phase10-scoring-matrix:${difficulty}:${family}`,
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${difficulty} ${family}`);
}

function wrongValue(value) {
  if (value.kind === "relationship") return { ...value, sourceId: `${value.sourceId}:wrong` };
  if (value.kind === "state") return { ...value, value: `${value.value}:wrong` };
  if (value.kind === "timestamp") return { ...value, eventId: `${value.eventId || "event"}:wrong` };
  if (value.kind === "service") return { ...value, activeState: value.activeState === "active" ? "inactive" : "active" };
  if (value.kind === "identity") return { ...value, identityId: "identity:wrong", username: "wrong-user" };
  return { kind: "state", objectId: "wrong", value: "wrong", timeScope: "historical_reconstruction" };
}

function wrongSubjectValue(value) {
  if (value.kind === "relationship") return { ...value, sourceId: "subject:wrong", targetId: value.targetId };
  if (value.kind === "identity") return { ...value, identityId: "identity:wrong", username: "wrong-user" };
  if (value.kind === "command") return { ...value, commandId: "command:wrong" };
  if (value.kind === "process") return { ...value, processId: "process:wrong", pid: 999999 };
  if (value.kind === "file") return { ...value, fileId: "file:wrong", path: "/tmp/wrong" };
  if (value.kind === "service") return { ...value, serviceId: "service:wrong", unit: "wrong.service" };
  if (value.kind === "cron") return { ...value, cronId: "cron:wrong" };
  return wrongValue(value);
}

function claimFor(contract, finding) {
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
}

function fullSubmission(contract) {
  return {
    taskId: contract.taskId,
    claims: contract.requiredFindings.map((finding) => claimFor(contract, finding)),
    uncertaintyAssertions: uncertaintyAssertions(contract),
    remediationActions: contract.remediationRequirements.map((item) => item.action),
  };
}

function variantApplicability(contract, variant) {
  if (variant === "correct_subject_wrong_relationship") {
    const applicable = contract.requiredFindings.some((finding) => finding.relationship || finding.expectedValue.kind === "relationship");
    return { applicable, reason: applicable ? "task has relationship-scored findings" : "task has no relationship component" };
  }
  if (variant === "correct_value_wrong_timestamp") {
    const applicable = contract.requiredFindings.some((finding) => finding.expectedValue.kind === "timestamp" || finding.expectedValue.kind === "sequence" || finding.timeScope !== "historical_reconstruction");
    return { applicable, reason: applicable ? "task has a time-scoped finding" : "task has no timestamp/time-scope component" };
  }
  if (variant === "missing_corroboration") {
    const applicable = contract.evidenceRequirements.some((requirement) => (requirement.minimumCount || 1) > 1 || requirement.mode === "all");
    return { applicable, reason: applicable ? "task requires multiple evidence sources" : "task evidence is single-source/any-mode" };
  }
  if (variant === "valid_uncertainty") {
    const applicable = contract.uncertaintyRequirements.length > 0;
    return { applicable, reason: applicable ? "task has uncertainty requirements" : "task has no uncertainty requirement" };
  }
  if (variant === "canonical_contradiction") {
    const applicable = contract.requiredFindings.some((finding) => finding.contradictions.length > 0);
    return { applicable, reason: applicable ? "task has canonical contradiction facts" : "task has no contradiction model" };
  }
  if (variant === "missing_remediation" || variant === "vague_remediation" || variant === "duplicate_remediation") {
    const applicable = contract.remediationRequirements.length > 0;
    return { applicable, reason: applicable ? "task carries remediation requirements" : "task has no remediation requirement" };
  }
  return { applicable: true, reason: "variant applies to all scored tasks" };
}

function variantSubmission(contract, variant) {
  const submission = fullSubmission(contract);
  if (variant === "full") return submission;
  if (variant === "empty") return { taskId: contract.taskId, claims: [] };
  if (variant === "incomplete_evidence") submission.claims = submission.claims.map((claim) => ({ ...claim, evidence: [] }));
  if (variant === "correct_subject_wrong_relationship") {
    submission.claims = submission.claims.map((claim) => ({ ...claim, relationship: claim.relationship ? { ...claim.relationship, relation: "wrong_relationship" } : undefined, value: claim.value.kind === "relationship" ? { ...claim.value, relation: "wrong_relationship" } : claim.value }));
  }
  if (variant === "correct_relationship_wrong_subject") submission.claims = submission.claims.map((claim) => ({ ...claim, value: wrongSubjectValue(claim.value) }));
  if (variant === "correct_value_wrong_timestamp") submission.claims = submission.claims.map((claim) => ({ ...claim, timeScope: "collection_snapshot", value: claim.value.kind === "timestamp" ? { ...claim.value, timestamp: "2026-07-29T00:00:00.000Z" } : claim.value }));
  if (variant === "correct_conclusion_irrelevant_citation") {
    submission.claims = submission.claims.map((claim) => ({ ...claim, evidence: [{ path: "assets/not-selected.log", anchors: ["not-present"] }] }));
    submission.uncertaintyAssertions = [];
    submission.remediationActions = [];
  }
  if (variant === "correct_evidence_invalid_anchor") submission.claims = submission.claims.map((claim) => ({ ...claim, evidence: claim.evidence.map((citation) => ({ ...citation, anchors: ["not-present"] })) }));
  if (variant === "missing_corroboration") submission.claims = submission.claims.map((claim) => ({ ...claim, evidence: claim.evidence.slice(0, 1) }));
  if (variant === "valid_uncertainty") submission.uncertaintyAssertions = uncertaintyAssertions(contract);
  if (variant === "unsupported_certainty") submission.claims = submission.claims.map((claim) => ({ ...claim, confidence: "certain" }));
  if (variant === "prohibited_overclaim") submission.claims[0].conclusions = [{
    kind: prohibitedConclusionFor(contract.prohibitedClaims[0]?.id),
    confidence: "certain",
  }];
  if (variant === "canonical_contradiction") {
    const finding = contract.requiredFindings.find((item) => item.contradictions.length > 0);
    if (finding) submission.claims = [{ value: finding.contradictions[0].contradicts, timeScope: finding.timeScope, confidence: "certain", evidence: [] }];
  }
  if (variant === "missing_remediation") submission.remediationActions = [];
  if (variant === "vague_remediation") submission.remediationActions = ["secure the server", "check logs"];
  if (variant === "duplicate_remediation") submission.remediationActions = submission.remediationActions.concat(submission.remediationActions);
  return submission;
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    buildLinuxAssessmentPackage,
    scoreLinuxStructuredAssessmentSubmission,
  } = require(path.join(out, "linux", "assessmentContract.js"));
  const rows = [];
  const applicabilitySummary = { applicableAssertions: 0, inapplicableVariants: 0, failedApplicableAssertions: 0 };
  const assertApplicable = (name, condition, details = "") => {
    applicabilitySummary.applicableAssertions += 1;
    try {
      assert(name, condition, details);
    } catch (error) {
      applicabilitySummary.failedApplicableAssertions += 1;
      throw error;
    }
  };
  for (const difficulty of DIFFICULTIES) {
    for (const family of FAMILIES) {
      const candidate = buildCandidate(buildLinuxAssetCandidate, family, difficulty);
      const assessmentPackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
      for (const contract of assessmentPackage.contracts) {
        const variantScores = {};
        const applicability = {};
        for (const variant of VARIANTS) {
          applicability[variant] = variantApplicability(contract, variant);
          if (!applicability[variant].applicable) applicabilitySummary.inapplicableVariants += 1;
          const score = scoreLinuxStructuredAssessmentSubmission(contract, variantSubmission(contract, variant));
          variantScores[variant] = score;
        }
        const full = variantScores.full;
        const missingReasoning = fullSubmission(contract);
        missingReasoning.claims = missingReasoning.claims.map((claim) => ({ ...claim, reasoning: undefined }));
        const missingReasoningScore = scoreLinuxStructuredAssessmentSubmission(contract, missingReasoning);
        assertApplicable(`${difficulty} ${family} ${contract.taskId} full score`, full.score === contract.scoring.maximumPoints, JSON.stringify(full));
        assertApplicable(`${difficulty} ${family} ${contract.taskId} empty score`, variantScores.empty.score === 0, JSON.stringify(variantScores.empty));
        assertApplicable(`${difficulty} ${family} ${contract.taskId} missing reasoning loses reasoning`, missingReasoningScore.reasoningPoints === 0 && missingReasoningScore.score < full.score, JSON.stringify(missingReasoningScore));
        assertApplicable(`${difficulty} ${family} ${contract.taskId} incomplete evidence lower`, variantScores.incomplete_evidence.score < full.score, JSON.stringify(variantScores.incomplete_evidence));
        assertApplicable(`${difficulty} ${family} ${contract.taskId} invalid anchor lower`, variantScores.correct_evidence_invalid_anchor.evidencePoints < full.evidencePoints, JSON.stringify(variantScores.correct_evidence_invalid_anchor));
        if (applicability.correct_subject_wrong_relationship.applicable) {
          assertApplicable(`${difficulty} ${family} ${contract.taskId} wrong relationship loses relationship`, variantScores.correct_subject_wrong_relationship.findingPoints < full.findingPoints, JSON.stringify(variantScores.correct_subject_wrong_relationship));
        }
        assertApplicable(`${difficulty} ${family} ${contract.taskId} unsupported certainty not better`, variantScores.unsupported_certainty.score <= full.score, JSON.stringify(variantScores.unsupported_certainty));
        assertApplicable(`${difficulty} ${family} ${contract.taskId} typed overclaim penalized`, variantScores.prohibited_overclaim.penalties > 0 && variantScores.prohibited_overclaim.score < full.score, JSON.stringify(variantScores.prohibited_overclaim));
        if (applicability.canonical_contradiction.applicable) {
          assertApplicable(`${difficulty} ${family} ${contract.taskId} canonical contradiction penalized`, variantScores.canonical_contradiction.score < full.score && variantScores.canonical_contradiction.notes.some((note) => /canonical contradiction/.test(note)), JSON.stringify(variantScores.canonical_contradiction));
        }
        if (applicability.vague_remediation.applicable) {
          assertApplicable(`${difficulty} ${family} ${contract.taskId} vague remediation no remediation credit`, variantScores.vague_remediation.remediationPoints === 0, JSON.stringify(variantScores.vague_remediation));
        }
        assertApplicable(`${difficulty} ${family} ${contract.taskId} headline guess cannot pass`, variantScores.correct_conclusion_irrelevant_citation.score < Math.ceil(contract.scoring.maximumPoints * 0.7), JSON.stringify(variantScores.correct_conclusion_irrelevant_citation));
        rows.push({
          difficulty,
          family,
          taskId: contract.taskId,
          intent: contract.intent,
          maximumPoints: contract.scoring.maximumPoints,
          findingPoints: contract.scoring.findingPoints,
          evidencePoints: contract.scoring.evidencePoints,
          valueStatePoints: full.componentScores.reduce((total, item) => total + item.valuePoints + item.timeScopePoints, 0),
          relationshipPoints: full.componentScores.reduce((total, item) => total + item.relationshipPoints, 0),
          reasoningPoints: contract.scoring.reasoningPoints,
          uncertaintyPoints: contract.scoring.uncertaintyPoints,
          remediationPoints: contract.scoring.remediationPoints,
          maximumPenalties: contract.scoring.penalties.reduce((total, penalty) => total + penalty.points, 0),
          criticalFindingShare: contract.scoring.findingPoints / contract.scoring.maximumPoints,
          optionalFindingShare: 0,
          variantScores: Object.fromEntries(Object.entries(variantScores).map(([name, report]) => [name, report.score])),
          variantApplicability: applicability,
          missingReasoningScore: missingReasoningScore.score,
        });
      }
    }
  }
  const artifactDir = path.join(ROOT, ".tmp", "linux-phase10-assessment");
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "phase10-assessment-scoring-matrix.json"), JSON.stringify({
    version: "phase10-assessment-scoring-matrix-v1",
    generatedAt: "2026-07-29T08:00:00.000Z",
    variants: VARIANTS,
    rows,
    assertionSummary: { assertionsExecuted: assertions, casesSkipped: 0, ...applicabilitySummary },
  }, null, 2));
  console.log(JSON.stringify({ passed: true, rows: rows.length, variants: VARIANTS.length, assertions, applicabilitySummary }, null, 2));
}

main();
