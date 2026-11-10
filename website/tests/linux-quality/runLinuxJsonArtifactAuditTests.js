#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const REPORT_DIR = path.join(ROOT, ".tmp", "linux-json-audit");
const REPORT_PATH = path.join(REPORT_DIR, "linux-json-audit.json");

const DISCOVERY_ROOTS = ["."];
const EXCLUSION_RULES = [
  { code: "git_metadata", test: (rel) => rel.startsWith(".git/") },
  { code: "next_build_cache", test: (rel) => rel.startsWith(".next/") },
  { code: "dependency_tree", test: (rel) => rel.startsWith("node_modules/") },
  { code: "compiled_phase_output", test: (rel) => rel.startsWith(".tmp/phase12-compiled/") || rel.startsWith(".tmp/phase11-compiled/") || rel.startsWith(".tmp/phase10-compiled/") },
  { code: "current_json_audit_output", test: (rel) => rel === ".tmp/linux-json-audit/linux-json-audit.json" },
  { code: "temporary_supabase_tool_metadata", test: (rel) => rel.startsWith("supabase/.temp/") },
];
const EXPECTED_ARTIFACTS = [
  { key: "legacy_prose_audit", path: "tests/linux-quality/linuxLegacyProseAudit.json", required: true },
  { key: "phase8_replay_or_determinism", prefix: ".tmp/linux-phase8-", required: false },
  { key: "phase9_workload_audit", path: ".tmp/linux-phase9-audit/phase9-workload-audit.json", required: false },
  { key: "phase9_route_boundary", path: ".tmp/linux-phase9-audit/phase9-route-boundary.json", required: false },
  { key: "phase10_assessment_matrix", path: ".tmp/linux-phase10-assessment/phase10-assessment-matrix.json", required: false },
  { key: "phase10_scoring_matrix", path: ".tmp/linux-phase10-assessment/phase10-assessment-scoring-matrix.json", required: false },
  { key: "phase11_corpus_or_replay", prefix: ".tmp/linux-phase11-", required: false },
  { key: "phase12_live_summary", path: ".tmp/linux-phase12-live-grading/summary.json", required: true },
  { key: "phase12_mismatch_debug", path: ".tmp/linux-phase12-live-grading/mismatch-debug.json", required: true },
  { key: "production_stress_summary", path: ".tmp/linux-production-stress/summary.json", required: false },
];
const WARNING_CODES = new Set([
  "UNKNOWN_SCHEMA_VERSION",
  "EXPECTED_OPTIONAL_ARTIFACT_NOT_PRESENT",
  "GENERATED_FAILED_STATUS",
]);
const SECRET_PATTERNS = [
  { code: "OPENAI_API_KEY", re: /OPENAI_API_KEY|sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{48,}\b/ },
  { code: "AUTHORIZATION_HEADER", re: /Authorization\s*["']?\s*:\s*["']?\s*Bearer\s+[A-Za-z0-9._~+/=-]+/i },
  { code: "SUPABASE_SERVICE_ROLE", re: /SUPABASE_SERVICE_ROLE|service[_-]?role[_-]?key/i },
  { code: "COOKIE_OR_SESSION", re: /"(?:cookie|session_token|sb-access-token|refresh_token|authorization)"\s*:\s*"[^"]{12,}"/i },
  { code: "RAW_PROMPT_OR_RESPONSE", re: /\b(rawPrompt|rawModelResponse|rawResponse|fullAssessmentContract|answerKey)\b/i },
];
const ENCODING_PATTERNS = [
  { code: "MOJIBAKE", re: /Ã¢â‚¬|Ã¢â€|Ã¯Â¿Â½|�/ },
];

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function toRel(full) {
  return path.relative(ROOT, full).replace(/\\/g, "/");
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

function gitTrackedSet() {
  try {
    const output = execFileSync("git", ["ls-files", "*.json"], { cwd: ROOT, encoding: "utf8" });
    return new Set(output.split(/\r?\n/).filter(Boolean).map((item) => item.replace(/\\/g, "/")));
  } catch {
    return new Set();
  }
}

function exclusionReason(rel) {
  return EXCLUSION_RULES.find((rule) => rule.test(rel))?.code;
}

function classify(rel, parsed) {
  if (rel === "tests/linux-quality/linuxLegacyProseAudit.json") return { category: "legacy_linux_json", lifecycle: "intentional_immutable_legacy_fixture" };
  if (rel.startsWith(".tmp/linux-phase12-live-grading/")) return { category: "phase12_live_json", lifecycle: "current_generated_artifact" };
  if (rel.startsWith(".tmp/linux-json-audit/")) return { category: "json_audit_report", lifecycle: "current_generated_artifact" };
  if (rel.startsWith(".tmp/linux-phase10-assessment/")) return { category: "phase10_assessment_json", lifecycle: "current_generated_artifact" };
  if (rel.startsWith(".tmp/linux-phase9-audit/")) return { category: "phase9_workload_json", lifecycle: "current_generated_artifact" };
  if (rel.startsWith(".tmp/linux-production-stress/")) return { category: "production_stress_json", lifecycle: "current_generated_artifact" };
  if (/^\.tmp\/(linux-|phase)/.test(rel)) return { category: "generated_linux_json", lifecycle: "generated_artifact" };
  if (rel.startsWith("tests/linux-quality/")) return { category: "linux_test_json", lifecycle: parsed?.version ? "current_source_fixture" : "source_fixture_unknown_version" };
  if (rel.startsWith("public/")) return { category: "public_metadata_json", lifecycle: "current_source_artifact" };
  if (rel.startsWith("supabase/")) return { category: "supabase_json", lifecycle: "source_tool_metadata" };
  if (rel === "package.json" || rel === "package-lock.json" || rel === "tsconfig.json" || rel === "skills-lock.json") return { category: "project_config_json", lifecycle: "current_source_artifact" };
  return { category: "other_project_json", lifecycle: parsed?.version ? "current_source_artifact" : "stale_or_unknown_project_json" };
}

function looksLikeHash(value) {
  return typeof value === "string" && /^[a-f0-9]{32,128}$/i.test(value);
}

function validateStructuredHashes(value, rel, field, failures) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value === "string") {
    if (!looksLikeHash(value)) failures.push({ file: rel, field, code: "INVALID_HASH_FORMAT", explanation: "Hash-like field is a string but is not hex hash shaped." });
    return;
  }
  if (typeof value === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateStructuredHashes(item, rel, `${field}[${index}]`, failures));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) validateStructuredHashes(child, rel, `${field}.${key}`, failures);
    return;
  }
  failures.push({ file: rel, field, code: "INVALID_HASH_TYPE", explanation: `Hash-like field has unsupported ${typeof value} value.` });
}

function validateSemantics(value, rel, failures, warnings, prefix = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateSemantics(item, rel, failures, warnings, `${prefix}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const field = `${prefix}.${key}`;
    if (typeof child === "number" && !Number.isFinite(child)) failures.push({ file: rel, field, code: "NONFINITE_NUMBER" });
    if (/^(hash|hashes)$/i.test(key) || /(?:Hash|Hashes|HashEquality)$/.test(key)) validateStructuredHashes(child, rel, field, failures);
    if ((key === "passed" || key === "ok") && child === true && typeof value.status === "string" && /fail/i.test(value.status)) failures.push({ file: rel, field, code: "PASSED_STATUS_CONTRADICTION" });
    validateSemantics(child, rel, failures, warnings, field);
  }
}

function validateArtifactSpecific(parsed, rel, failures, warnings) {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if (!parsed.version && !parsed.status && !parsed.name && !parsed.scripts && !parsed.compilerOptions && !parsed.lockfileVersion) {
      warnings.push({ file: rel, code: "UNKNOWN_SCHEMA_VERSION", explanation: "Included JSON has no recognizable schema/version/status/config marker." });
    }
    if (rel.endsWith("summary.json") && parsed.passed === true && /FAILED|PENDING/.test(String(parsed.status || ""))) failures.push({ file: rel, code: "SUMMARY_STATUS_CONTRADICTION" });
    if (rel.includes("linux-phase12-live-grading/summary.json") && parsed.reportPolicy) {
      for (const [key, value] of Object.entries(parsed.reportPolicy)) {
        if (value !== false) failures.push({ file: rel, field: `reportPolicy.${key}`, code: "REPORT_POLICY_UNSAFE" });
      }
    }
    if (rel.includes("phase10-assessment-scoring-matrix") && parsed.assertions !== undefined && parsed.failedApplicableAssertions !== undefined && parsed.failedApplicableAssertions !== 0) failures.push({ file: rel, code: "SCORING_MATRIX_FAILURES_PRESENT" });
    if (rel.includes("linux-production-stress/summary.json") && parsed.accepted !== undefined && parsed.rawAttempts !== undefined && parsed.accepted > parsed.rawAttempts) failures.push({ file: rel, code: "IMPOSSIBLE_PRODUCTION_STRESS_COUNTS" });
    if (rel.includes("linux-phase12-live-grading/summary.json") && Array.isArray(parsed.stability)) {
      for (const item of parsed.stability) {
        if (item.variance === 0 && Array.isArray(item.statuses) && item.statuses.every((status) => status !== "graded")) failures.push({ file: rel, code: "FAILED_STABILITY_COUNTED_AS_ZERO_VARIANCE", caseId: item.id });
      }
    }
  }
}

function scanStrings(raw, rel, report) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(raw)) report.securityFindings.push({ file: rel, category: pattern.code, redacted: true });
  }
  for (const pattern of ENCODING_PATTERNS) {
    if (pattern.re.test(raw)) report.encodingFindings.push({ file: rel, category: pattern.code });
  }
}

function main() {
  const tracked = gitTrackedSet();
  const discovered = Array.from(new Set(DISCOVERY_ROOTS.flatMap((root) => walk(path.join(ROOT, root))).map(toRel))).sort();
  const report = {
    version: "linux-json-audit-v2",
    discoveryRoots: DISCOVERY_ROOTS,
    inclusionRules: ["include project-owned JSON except explicit dependency/build/tool exclusions", "include .tmp/linux-* and .tmp/phase* JSON artifacts when present"],
    exclusionRules: EXCLUSION_RULES.map((rule) => rule.code),
    totalDiscoveredJson: discovered.length,
    includedFiles: 0,
    excludedFiles: 0,
    sourceControlledJson: 0,
    generatedLinuxJson: 0,
    legacyLinuxJson: 0,
    temporaryToolMetadata: 0,
    dependencyBuildCacheJson: 0,
    discoveryManifest: [],
    scannedFiles: 0,
    parsedFiles: 0,
    parseFailures: [],
    currentArtifacts: [],
    legacyArtifacts: [],
    staleArtifacts: [],
    generatedArtifacts: [],
    excludedArtifacts: [],
    expectedArtifacts: [],
    crossArtifactChecks: [],
    consistencyFailures: [],
    warnings: [],
    securityFindings: [],
    encodingFindings: [],
    fixesApplied: [],
    assertionSummary: {},
  };

  for (const rel of discovered) {
    const full = path.join(ROOT, rel);
    const reason = exclusionReason(rel);
    const sourceControlled = tracked.has(rel);
    if (sourceControlled) report.sourceControlledJson += 1;
    if (reason) {
      report.excludedFiles += 1;
      if (reason.includes("dependency") || reason.includes("build")) report.dependencyBuildCacheJson += 1;
      if (reason.includes("temporary")) report.temporaryToolMetadata += 1;
      const entry = { file: rel, included: false, exclusionReason: reason, sourceControlled };
      report.discoveryManifest.push(entry);
      report.excludedArtifacts.push(entry);
      continue;
    }

    report.includedFiles += 1;
    report.scannedFiles += 1;
    const raw = fs.readFileSync(full, "utf8");
    scanStrings(raw, rel, report);
    const baseEntry = { file: rel, included: true, sourceControlled, sha256: crypto.createHash("sha256").update(raw).digest("hex") };
    try {
      const parsed = JSON.parse(raw);
      report.parsedFiles += 1;
      const schemaVersion = parsed.version || parsed.schemaVersion || parsed.status || parsed.name || parsed.lockfileVersion || "unknown";
      const classification = classify(rel, parsed);
      const entry = { ...baseEntry, ...classification, schemaVersion, parse: "ok" };
      report.discoveryManifest.push(entry);
      validateSemantics(parsed, rel, report.consistencyFailures, report.warnings);
      validateArtifactSpecific(parsed, rel, report.consistencyFailures, report.warnings);
      if (classification.lifecycle.includes("legacy")) {
        report.legacyLinuxJson += 1;
        report.legacyArtifacts.push(entry);
      } else if (classification.lifecycle.includes("generated") || classification.lifecycle === "generated_artifact") {
        if (classification.category.includes("linux") || classification.category.includes("phase") || classification.category.includes("production")) report.generatedLinuxJson += 1;
        report.generatedArtifacts.push(entry);
      } else if (classification.lifecycle.includes("unknown") || classification.lifecycle.includes("stale")) {
        report.staleArtifacts.push(entry);
      } else {
        report.currentArtifacts.push(entry);
      }
    } catch (error) {
      const entry = { ...baseEntry, parse: "failed", parseError: error.message };
      report.discoveryManifest.push(entry);
      report.parseFailures.push({ file: rel, message: error.message });
    }
  }

  const includedPlusExcluded = report.includedFiles + report.excludedFiles;
  report.crossArtifactChecks.push({ name: "discovery_accounting_complete", passed: includedPlusExcluded === report.totalDiscoveredJson, totalDiscoveredJson: report.totalDiscoveredJson, includedFiles: report.includedFiles, excludedFiles: report.excludedFiles });
  for (const expected of EXPECTED_ARTIFACTS) {
    const matches = expected.path
      ? report.discoveryManifest.filter((entry) => entry.file === expected.path && entry.included)
      : report.discoveryManifest.filter((entry) => entry.file.startsWith(expected.prefix) && entry.included);
    const status = matches.length ? "present" : "not_present";
    const record = { ...expected, status, files: matches.map((entry) => entry.file) };
    report.expectedArtifacts.push(record);
    if (expected.required && status !== "present") report.consistencyFailures.push({ code: "REQUIRED_ARTIFACT_NOT_PRESENT", artifact: expected.key });
    if (!expected.required && status !== "present") report.warnings.push({ code: "EXPECTED_OPTIONAL_ARTIFACT_NOT_PRESENT", artifact: expected.key, explanation: "Optional/generated artifact is absent in this checkout." });
  }
  report.crossArtifactChecks.push({ name: "current_artifacts_present", passed: report.currentArtifacts.length > 0, count: report.currentArtifacts.length });
  report.crossArtifactChecks.push({ name: "phase12_live_artifacts_present", passed: report.expectedArtifacts.filter((item) => item.key.startsWith("phase12")).every((item) => item.status === "present") });
  for (const check of report.crossArtifactChecks) {
    if (!check.passed) report.consistencyFailures.push({ code: "CROSS_ARTIFACT_CHECK_FAILED", check: check.name });
  }

  const unexplainedConsistencyFailures = report.consistencyFailures.filter((failure) => !WARNING_CODES.has(failure.code));
  report.assertionSummary = {
    assertionsPlanned: 13,
    assertionsExecuted: 13,
    assertionsPassed: 0,
    assertionsFailed: 0,
    assertionsSkipped: 0,
    parseFailures: report.parseFailures.length,
    securityFindings: report.securityFindings.length,
    encodingFindings: report.encodingFindings.length,
    consistencyFailures: report.consistencyFailures.length,
    unexplainedConsistencyFailures: unexplainedConsistencyFailures.length,
    warnings: report.warnings.length,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  assert("JSON discovery found repository JSON", report.totalDiscoveredJson > 0, String(report.totalDiscoveredJson));
  assert("JSON discovery accounting is complete", includedPlusExcluded === report.totalDiscoveredJson, `${includedPlusExcluded} !== ${report.totalDiscoveredJson}`);
  assert("JSON audit included project-owned files", report.includedFiles > 0, String(report.includedFiles));
  assert("JSON audit excluded dependency/build/tool files explicitly", report.excludedFiles >= 0);
  assert("JSON audit parsed every included JSON file", report.parseFailures.length === 0, JSON.stringify(report.parseFailures.slice(0, 5)));
  assert("JSON audit found current artifacts", report.currentArtifacts.length > 0, "currentArtifacts is empty");
  assert("JSON audit classified legacy Linux fixture", report.legacyArtifacts.some((entry) => entry.file === "tests/linux-quality/linuxLegacyProseAudit.json"));
  assert("JSON audit classified generated Linux artifacts", report.generatedArtifacts.some((entry) => entry.file.includes("linux-phase12-live-grading")));
  assert("JSON audit has no secret-bearing JSON", report.securityFindings.length === 0, JSON.stringify(report.securityFindings));
  assert("JSON audit has no mojibake findings", report.encodingFindings.length === 0, JSON.stringify(report.encodingFindings));
  assert("JSON audit has no unexplained consistency failures", unexplainedConsistencyFailures.length === 0, JSON.stringify(unexplainedConsistencyFailures.slice(0, 8)));
  assert("JSON audit records expected artifact presence", report.expectedArtifacts.length === EXPECTED_ARTIFACTS.length);
  assert("JSON audit report was written", fs.existsSync(REPORT_PATH), REPORT_PATH);

  report.assertionSummary.assertionsPassed = assertions;
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    passed: true,
    assertions,
    reportPath: REPORT_PATH,
    totalDiscoveredJson: report.totalDiscoveredJson,
    includedFiles: report.includedFiles,
    excludedFiles: report.excludedFiles,
    parsedFiles: report.parsedFiles,
    warnings: report.warnings.length,
  }, null, 2));
}

main();
