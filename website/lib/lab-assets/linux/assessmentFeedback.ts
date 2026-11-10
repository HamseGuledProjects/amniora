import type { LinuxAssessmentScoreReport, LinuxTaskAssessmentContract } from "./assessmentContract";
import type { LinuxGradingDiagnostic } from "./assessmentExtractionSchema";

export type LinuxLearnerSafeAssessmentFeedback = {
  taskId: string;
  status: "graded" | "retryable" | "rejected";
  summary: string;
  missingComponents: string[];
  evidenceIssues: string[];
  reasoningIssues: string[];
  uncertaintyIssues: string[];
  remediationIssues: string[];
  boundaryIssues: string[];
  diagnostics: Array<{ code: string; message: string }>;
};

function safeDiagnosticMessage(issue: LinuxGradingDiagnostic) {
  switch (issue.code) {
    case "LINUX_GRADING_AI_SCORE_ATTEMPT":
      return "The submitted interpretation included scoring fields. Scores are calculated by the deterministic grader only.";
    case "LINUX_GRADING_UNKNOWN_FIELD":
    case "LINUX_GRADING_SCHEMA_INVALID":
      return "The extracted answer did not match the supported grading format.";
    case "LINUX_GRADING_INTERNAL_ID_ATTEMPT":
      return "The answer referenced internal identifiers that are not accepted for grading.";
    case "LINUX_GRADING_EVIDENCE_HALLUCINATION":
      return "One or more cited evidence files are not available for this task.";
    case "LINUX_GRADING_EVIDENCE_TASK_INELIGIBLE":
      return "One or more cited evidence files are outside this task's evidence scope.";
    case "LINUX_GRADING_ANCHOR_HALLUCINATION":
      return "One or more cited anchors could not be confirmed in the task evidence.";
    case "LINUX_GRADING_OUTPUT_MUTATED":
    case "LINUX_GRADING_PROVENANCE_MISMATCH":
      return "The grading record failed integrity checks.";
    case "LINUX_GRADING_ANSWER_KEY_EXPOSURE":
      return "Feedback was blocked because it attempted to expose internal assessment material.";
    case "LINUX_GRADING_EXTRACTION_FAILED":
      return "The answer could not be interpreted reliably enough to grade.";
    default:
      return "The answer could not be graded in its current form.";
  }
}

export function buildLinuxAssessmentFeedback(input: {
  contract: LinuxTaskAssessmentContract;
  scoreReport?: LinuxAssessmentScoreReport;
  diagnostics?: LinuxGradingDiagnostic[];
  status?: LinuxLearnerSafeAssessmentFeedback["status"];
}): LinuxLearnerSafeAssessmentFeedback {
  const diagnostics = input.diagnostics || [];
  const score = input.scoreReport;
  const missingComponents: string[] = [];
  const evidenceIssues: string[] = [];
  const reasoningIssues: string[] = [];
  const uncertaintyIssues: string[] = [];
  const remediationIssues: string[] = [];
  const boundaryIssues: string[] = diagnostics.map(safeDiagnosticMessage);

  if (score) {
    if (score.findingPoints < input.contract.scoring.findingPoints) {
      missingComponents.push("Some required findings were missing, incomplete, or did not match the claim type requested by the task.");
    }
    if (score.evidencePoints < input.contract.scoring.evidencePoints) {
      evidenceIssues.push("Some claims lacked task-local citations or confirmable anchors.");
    }
    if (score.reasoningPoints < input.contract.scoring.reasoningPoints) {
      reasoningIssues.push("Some claims lacked structured reasoning that connected the cited evidence to the conclusion.");
    }
    if (score.uncertaintyPoints < input.contract.scoring.uncertaintyPoints) {
      uncertaintyIssues.push("Required uncertainty boundaries were missing or stated with unsupported certainty.");
    }
    if (score.remediationPoints < input.contract.scoring.remediationPoints) {
      remediationIssues.push("Remediation was missing, vague, or not specific enough to the task evidence.");
    }
    if (score.penalties > 0 || score.notes.some((note) => /overclaim|contradiction|certainty/i.test(note))) {
      boundaryIssues.push("One or more claims exceeded, contradicted, or overstated what the task evidence supports.");
    }
  }

  const status = input.status || (score ? "graded" : "retryable");
  return {
    taskId: input.contract.taskId,
    status,
    summary: score
      ? "The deterministic grader evaluated the typed interpretation of the answer."
      : "The answer was not scored because extraction or validation failed.",
    missingComponents,
    evidenceIssues,
    reasoningIssues,
    uncertaintyIssues,
    remediationIssues,
    boundaryIssues,
    diagnostics: diagnostics.map((issue) => ({ code: issue.code, message: safeDiagnosticMessage(issue) })),
  };
}

export function validateLinuxAssessmentFeedbackBoundary(feedback: LinuxLearnerSafeAssessmentFeedback, forbiddenTokens: string[]) {
  const text = JSON.stringify(feedback);
  return forbiddenTokens.filter((token) => token && text.includes(token));
}
