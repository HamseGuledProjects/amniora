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
  const build = path.join(os.tmpdir(), `amniora-linux-phase10-values-${Date.now()}`);
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
        seed: "phase10-values:advanced:reverse-shell",
        generationTime: "2026-07-29T08:00:00.000Z",
        assetAttempt: attempt * 8 + 1,
      }, { incidentFamily: "reverse_shell" });
    } catch {
      // Try the next deterministic fixture.
    }
  }
  throw new Error("could not build value fixture");
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

function wrongValue(value) {
  if (value.kind === "identity") return { ...value, identityId: `${value.identityId}:wrong`, username: "wrong-user" };
  if (value.kind === "network") return { ...value, sourceIp: "203.0.113.250", sourcePort: 65000 };
  if (value.kind === "ssh_key") return { ...value, fingerprint: "SHA256:wrongfingerprint" };
  if (value.kind === "command") return { ...value, executable: "/bin/false", normalizedCommand: "/bin/false" };
  if (value.kind === "process") return { ...value, pid: 999999, processId: "process:wrong" };
  if (value.kind === "file") return { ...value, fileId: "file:wrong", path: "/tmp/wrong" };
  if (value.kind === "service") return { ...value, serviceId: "service:wrong", unit: "wrong.service", activeState: "failed" };
  if (value.kind === "cron") return { ...value, cronId: "cron:wrong", schedule: "0 0 31 2 *", command: "/bin/false" };
  if (value.kind === "package") return { ...value, transactionId: "package:wrong", name: "wrong-package" };
  if (value.kind === "timestamp") return { ...value, timestamp: "2026-07-29T00:00:00.000Z", eventId: "event:wrong" };
  if (value.kind === "relationship") return { ...value, sourceId: `${value.sourceId}:wrong` };
  if (value.kind === "state") return { ...value, value: `${value.value}:wrong` };
  if (value.kind === "sequence") return { ...value, orderedEventIds: value.orderedEventIds.slice().reverse() };
  return { kind: "state", objectId: "wrong", value: "wrong", timeScope: "historical_reconstruction" };
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    buildLinuxAssessmentPackage,
    validateLinuxAssessmentPackage,
    scoreLinuxStructuredAssessmentSubmission,
  } = require(path.join(out, "linux", "assessmentContract.js"));

  const candidate = buildCandidate(buildLinuxAssetCandidate);
  const assessmentPackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const report = validateLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets, package: assessmentPackage });
  assert("baseline typed-value package passes", report.issues.length === 0, report.issues.map((issue) => issue.message).join("; "));

  const findings = assessmentPackage.contracts.flatMap((contract) => contract.requiredFindings);
  assert("all required findings have typed expected values", findings.every((finding) => finding.expectedValue && typeof finding.expectedValue === "object" && finding.expectedValue.kind), JSON.stringify(findings[0]));
  assert("no required finding uses a bare capability string as answer", findings.every((finding) => typeof finding.expectedValue !== "string" && JSON.stringify(finding.expectedValue) !== JSON.stringify(finding.capability)));
  assert("typed values cover multiple canonical answer kinds", new Set(findings.map((finding) => finding.expectedValue.kind)).size >= 4, Array.from(new Set(findings.map((finding) => finding.expectedValue.kind))).join(", "));

  const contract = assessmentPackage.contracts.find((item) => item.requiredFindings.some((finding) => finding.expectedValue.kind === "relationship")) || assessmentPackage.contracts[0];
  const full = scoreLinuxStructuredAssessmentSubmission(contract, fullSubmission(contract));
  const wrong = fullSubmission(contract);
  wrong.claims = wrong.claims.map((claim) => ({ ...claim, value: wrongValue(claim.value) }));
  const wrongScore = scoreLinuxStructuredAssessmentSubmission(contract, wrong);
  assert("wrong typed values lose finding and reasoning credit", wrongScore.score < full.score && wrongScore.findingPoints < full.findingPoints, JSON.stringify({ full, wrongScore }));

  const mutated = clone(assessmentPackage);
  mutated.contracts[0].requiredFindings[0].expectedValue = { kind: "state", objectId: "capability", value: mutated.contracts[0].requiredFindings[0].capability, timeScope: "historical_reconstruction" };
  const mutationReport = validateLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets, package: mutated });
  assert("capability-as-answer mutation is rejected", mutationReport.issues.some((issue) => issue.code === "LINUX_ASSESSMENT_CONTRACT_INVALID"), mutationReport.issues.map((issue) => issue.message).join("; "));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
