import { stableHash } from "./deterministicRandom";
import type { LinuxAssessmentPackage, LinuxAssessmentScoreReport, LinuxAssessmentSubmission, LinuxTaskAssessmentContract } from "./assessmentContract";
import type { LinuxAssessmentExtraction } from "./assessmentExtractionSchema";

export const LINUX_ASSESSMENT_GRADING_PROVENANCE_VERSION = "linux-assessment-grading-provenance-v1";

export type LinuxAssessmentGradingStatus =
  | "graded"
  | "retryable_extraction_failed"
  | "rejected_invalid_input"
  | "rejected_schema_invalid"
  | "rejected_security_boundary"
  | "rejected_provenance_mismatch";

export type LinuxAssessmentGradingProvenance = {
  version: typeof LINUX_ASSESSMENT_GRADING_PROVENANCE_VERSION;
  labId?: string;
  investigationId?: string;
  taskId: string;
  assessmentContractVersion: string;
  assessmentContractHash: string;
  extractorSchemaVersion: string;
  promptTemplateHash: string;
  modelConfigurationId: string;
  learnerSubmissionHash: string;
  rawExtractionResponseHash?: string;
  normalizedTypedSubmissionHash?: string;
  deterministicScoreReportHash?: string;
  attempt: number;
  status: LinuxAssessmentGradingStatus;
  failureCode?: string;
  createdAt: string;
};

export type LinuxAssessmentScoringReplayStatus =
  | "exact_match"
  | "extraction_differs_score_unchanged"
  | "typed_submission_differs"
  | "assessment_contract_differs"
  | "score_report_differs"
  | "historical_provenance_incomplete";

export function hashLinuxGradingValue(value: unknown) {
  return stableHash(value);
}

export function buildLinuxAssessmentGradingProvenance(input: {
  labId?: string;
  investigationId?: string;
  contract: LinuxTaskAssessmentContract;
  assessmentPackage?: LinuxAssessmentPackage;
  extractorSchemaVersion: string;
  promptTemplate: string;
  modelConfigurationId?: string;
  learnerAnswer: string;
  rawExtractionResponse?: unknown;
  normalizedSubmission?: LinuxAssessmentSubmission;
  scoreReport?: LinuxAssessmentScoreReport;
  attempt?: number;
  status: LinuxAssessmentGradingStatus;
  failureCode?: string;
  createdAt?: string;
}): LinuxAssessmentGradingProvenance {
  return {
    version: LINUX_ASSESSMENT_GRADING_PROVENANCE_VERSION,
    labId: input.labId,
    investigationId: input.investigationId,
    taskId: input.contract.taskId,
    assessmentContractVersion: input.contract.version,
    assessmentContractHash: input.assessmentPackage?.assessmentContractHash || hashLinuxGradingValue(input.contract),
    extractorSchemaVersion: input.extractorSchemaVersion,
    promptTemplateHash: hashLinuxGradingValue(input.promptTemplate),
    modelConfigurationId: input.modelConfigurationId || "offline-extractor",
    learnerSubmissionHash: hashLinuxGradingValue(input.learnerAnswer),
    rawExtractionResponseHash: input.rawExtractionResponse === undefined ? undefined : hashLinuxGradingValue(input.rawExtractionResponse),
    normalizedTypedSubmissionHash: input.normalizedSubmission === undefined ? undefined : hashLinuxGradingValue(input.normalizedSubmission),
    deterministicScoreReportHash: input.scoreReport === undefined ? undefined : hashLinuxGradingValue(input.scoreReport),
    attempt: input.attempt || 1,
    status: input.status,
    failureCode: input.failureCode,
    createdAt: input.createdAt || new Date(0).toISOString(),
  };
}

export function replayLinuxAssessmentScoring(input: {
  provenance: LinuxAssessmentGradingProvenance;
  contract: LinuxTaskAssessmentContract;
  typedSubmission?: LinuxAssessmentSubmission;
  scoreReport?: LinuxAssessmentScoreReport;
  rawExtractionResponse?: LinuxAssessmentExtraction | string;
  assessmentPackage?: LinuxAssessmentPackage;
}): { status: LinuxAssessmentScoringReplayStatus; mismatchedLayers: string[] } {
  const mismatchedLayers: string[] = [];
  if (!input.provenance.normalizedTypedSubmissionHash || !input.provenance.deterministicScoreReportHash) {
    return { status: "historical_provenance_incomplete", mismatchedLayers: ["normalizedTypedSubmissionHash", "deterministicScoreReportHash"] };
  }
  const assessmentContractHash = input.assessmentPackage?.assessmentContractHash || hashLinuxGradingValue(input.contract);
  if (assessmentContractHash !== input.provenance.assessmentContractHash) mismatchedLayers.push("assessmentContractHash");
  if (!input.typedSubmission || hashLinuxGradingValue(input.typedSubmission) !== input.provenance.normalizedTypedSubmissionHash) mismatchedLayers.push("normalizedTypedSubmissionHash");
  if (!input.scoreReport || hashLinuxGradingValue(input.scoreReport) !== input.provenance.deterministicScoreReportHash) mismatchedLayers.push("deterministicScoreReportHash");
  if (
    input.rawExtractionResponse !== undefined &&
    input.provenance.rawExtractionResponseHash &&
    hashLinuxGradingValue(input.rawExtractionResponse) !== input.provenance.rawExtractionResponseHash &&
    !mismatchedLayers.includes("normalizedTypedSubmissionHash") &&
    !mismatchedLayers.includes("deterministicScoreReportHash") &&
    !mismatchedLayers.includes("assessmentContractHash")
  ) {
    return { status: "extraction_differs_score_unchanged", mismatchedLayers: ["rawExtractionResponseHash"] };
  }
  if (mismatchedLayers.includes("assessmentContractHash")) return { status: "assessment_contract_differs", mismatchedLayers };
  if (mismatchedLayers.includes("normalizedTypedSubmissionHash")) return { status: "typed_submission_differs", mismatchedLayers };
  if (mismatchedLayers.includes("deterministicScoreReportHash")) return { status: "score_report_differs", mismatchedLayers };
  return { status: "exact_match", mismatchedLayers };
}
