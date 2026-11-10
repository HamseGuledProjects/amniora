import { createHash } from "crypto";
import type { LinuxFinalQualityResult } from "./qualityChecker";

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function passBlockReason(result: LinuxFinalQualityResult) {
  if (!result.coverage.finalNarrativeEvaluated) return "FINAL_NARRATIVE_NOT_EVALUATED";
  if (result.issues.some((issue) => issue.severity === "critical")) return "CRITICAL_SEVERITY_OVERRIDE";
  if (result.issues.some((issue) => issue.severity === "high")) return "HIGH_SEVERITY_OVERRIDE";
  if (result.finalProductionScore < 90) return "SCORE_BELOW_THRESHOLD";
  return result.passed ? "PASSED" : "VALIDATION_FAILED";
}

function stableGeneratedTextCode(description: string) {
  if (/malformed|truncated|incomplete phrase|too short|too long|excessively long/i.test(description)) {
    return "LINUX_FINAL_QUALITY_GENERATED_TEXT_NARRATIVE_COMPLETENESS";
  }
  if (/unsupported conclusion|gives away the answer|spoiler/i.test(description)) {
    return "LINUX_FINAL_QUALITY_GENERATED_TEXT_UNSUPPORTED_CONCLUSION";
  }
  if (/duplicates|repetitive|fixed task sequence|too little verb variety|deliverable variety/i.test(description)) {
    return "LINUX_FINAL_QUALITY_GENERATED_TEXT_DUPLICATION";
  }
  if (/too generic|lacks a clear investigative action|lacks a Linux investigative focus/i.test(description)) {
    return "LINUX_FINAL_QUALITY_GENERATED_TEXT_LEARNER_READABILITY";
  }
  if (/does not reference|does not include|omits|does not match|non-canonical|not canonical|wrong/i.test(description)) {
    return "LINUX_FINAL_QUALITY_GENERATED_TEXT_GROUNDING";
  }
  if (/live-system access|offline evidence review|evidence/i.test(description)) {
    return "LINUX_FINAL_QUALITY_GENERATED_TEXT_EVIDENCE_WORDING";
  }
  return null;
}

export function stableLinuxFinalQualityIssueCode(issue: LinuxFinalQualityResult["issues"][number]) {
  const embedded = issue.description.match(/\bLINUX_[A-Z0-9_]+\b/)?.[0];
  if (embedded) return embedded;
  if (issue.category === "generated_text") {
    const generatedTextCode = stableGeneratedTextCode(issue.description);
    if (generatedTextCode) return generatedTextCode;
  }
  const category = issue.category.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const severity = issue.severity.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const hash = sha256Text(`${issue.severity}|${issue.category}|${issue.description}`).slice(0, 16).toUpperCase();
  return `LINUX_FINAL_QUALITY_${category}_${severity}_${hash}`;
}

function safeQualityTaskIndex(issue: LinuxFinalQualityResult["issues"][number]) {
  const text = `${issue.description} ${issue.evidence || ""}`;
  const match = text.match(/\btask\s*(?:\[|\s)?(\d+)\]?/i);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isFinite(index) && index > 0 ? index - 1 : null;
}

export function safeLinuxFinalQualityDiagnostics(result: LinuxFinalQualityResult) {
  const blocking = result.issues.filter((issue) => issue.severity === "critical" || issue.severity === "high");
  const selected = blocking.length > 0 ? blocking : result.issues;
  const issueCodes = Array.from(new Set(selected.map(stableLinuxFinalQualityIssueCode)));
  const issueCategories = Array.from(new Set(selected.map((issue) => issue.category))).sort();
  const taskIndexes = Array.from(new Set(selected.map(safeQualityTaskIndex).filter((index): index is number => index !== null))).sort((a, b) => a - b);
  const issueCounts = selected.reduce<Record<string, number>>((counts, issue) => {
    const key = `${issue.category}:${issue.severity}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  return {
    issueCodes,
    issueCategories,
    issueCounts,
    issueCount: selected.length,
    totalIssueCount: result.issues.length,
    taskIndexes,
    qualityScore: result.finalProductionScore,
    passBlockReason: passBlockReason(result),
    coverage: {
      finalNarrativeEvaluated: result.coverage.finalNarrativeEvaluated,
    },
    deterministicHashes: {
      workloadEstimateHash: result.workloadEstimateHash || null,
      workloadReportHash: result.workloadReportHash || null,
      assessmentContractHash: result.assessmentContractHash || null,
      assessmentQualityHash: result.assessmentQualityHash || null,
    },
  };
}
