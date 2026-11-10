#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-final-quality-diagnostics-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function resultFor(issue) {
  return {
    interimAssetScore: 94,
    finalProductionScore: 72,
    passed: false,
    coverage: {
      incidentIdentityEvaluated: true,
      processGraphEvaluated: true,
      fileMetadataEvaluated: true,
      chronologyEvaluated: true,
      sudoPolicyEvaluated: true,
      serviceSemanticsEvaluated: true,
      timelineEvidenceEvaluated: true,
      roleRealismEvaluated: true,
      documentationEvaluated: true,
      finalNarrativeEvaluated: true,
      originalityEvaluated: true,
    },
    issues: [issue],
    categoryScores: {},
    workloadEstimateHash: "workload-estimate-hash",
    workloadReportHash: "workload-report-hash",
    assessmentContractHash: "assessment-contract-hash",
    assessmentQualityHash: "assessment-quality-hash",
  };
}

function main() {
  const out = compileIfNeeded();
  const {
    safeLinuxFinalQualityDiagnostics,
    stableLinuxFinalQualityIssueCode,
  } = require(path.join(out, "linux", "finalQualityDiagnostics.js"));
  const categories = [
    "generated_text",
    "timeline",
    "service_model",
    "daemon_realism",
    "role_leakage",
    "identity",
    "ssh_policy",
    "sudo_audit",
    "process_open_files",
    "permissions",
    "semantic",
    "package_management",
    "documentation",
    "background_noise",
    "asset_consistency",
    "assessment",
    "batch_diversity",
  ];
  let assertions = 0;
  for (const category of categories) {
    for (const severity of ["high", "critical"]) {
      const issue = {
        severity,
        category,
        description: `Task 2 ${category} validator blocked the generated investigation.`,
        evidence: "assets/private/should-not-leak.log contains learner prose that must not be logged",
      };
      const diagnostics = safeLinuxFinalQualityDiagnostics(resultFor(issue));
      const serialized = JSON.stringify(diagnostics);
      assert(`${category} ${severity} gets stable final-quality issue code`, diagnostics.issueCodes.length === 1 && diagnostics.issueCodes[0].startsWith(`LINUX_FINAL_QUALITY_${category.toUpperCase()}`), serialized);
      assert(`${category} ${severity} gets safe category`, diagnostics.issueCategories.includes(category), serialized);
      assert(`${category} ${severity} gets task index`, diagnostics.taskIndexes.includes(1), serialized);
      assert(`${category} ${severity} gets issue count`, diagnostics.issueCounts[`${category}:${severity}`] === 1, serialized);
      assert(`${category} ${severity} never reports unknown stage-equivalent data`, diagnostics.issueCodes[0] !== "unknown" && diagnostics.qualityScore === 72, serialized);
      assert(`${category} ${severity} omits messages and evidence paths`, !serialized.includes(issue.description) && !serialized.includes("assets/private") && !serialized.includes("learner prose"), serialized);
      assertions += 6;
    }
  }

  const embedded = stableLinuxFinalQualityIssueCode({
    severity: "critical",
    category: "asset_consistency",
    description: "LINUX_TASK_SOLVABILITY_FAILED: task evidence cannot satisfy contract.",
  });
  assert("embedded stable Linux code is preserved", embedded === "LINUX_TASK_SOLVABILITY_FAILED", embedded);
  assertions += 1;

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
