import { buildLinuxAssetCandidate } from ".";
import { buildLinuxAssessmentPackage, validateLinuxAssessmentPackage, type LinuxAssessmentPackage, type LinuxAssessmentScoreReport, type LinuxTaskAssessmentContract } from "./assessmentContract";
import { hashLinuxGradingValue, replayLinuxAssessmentScoring, type LinuxAssessmentGradingProvenance } from "./assessmentGradingProvenance";
import type { LinuxAssessmentSubmission } from "./assessmentContract";
import type { LinuxDeterministicHashes, LinuxGenerationProvenance } from "./generationContext";
import { replayLinuxGeneration } from "./replay";
import type { LinuxFreeFormAssessmentResult } from "./freeFormAssessment";

export const LINUX_PHASE12_GRADING_ROUTE_VERSION = "linux-phase12-grading-route-v1";
export const LINUX_PHASE12_MAX_ANSWER_LENGTH = 12000;
export const LINUX_PHASE12_MAX_BODY_BYTES = 16_384;

export type LinuxPhase12RouteInput = {
  labId: string;
  taskId: string;
  learnerAnswer: string;
  idempotencyKey: string;
};

export type LinuxPhase12TrustedContract = {
  contract: LinuxTaskAssessmentContract;
  assessmentPackage: LinuxAssessmentPackage;
  studentTask?: { title?: string; description?: string; deliverable?: string; evidence?: string[] };
  renderedEvidencePaths: string[];
  hashes: LinuxDeterministicHashes;
  provenance: LinuxGenerationProvenance;
  replayStatus: "exact_match";
};

export type LinuxPhase12SafeResponse = {
  status: "graded" | "retryable";
  taskId: string;
  score?: number;
  maximumPoints?: number;
  feedback: LinuxFreeFormAssessmentResult["feedback"];
  diagnostics: Array<{ code: string; severity: string; message: string }>;
  idempotencyKey: string;
  attemptId?: string;
};

export type LinuxLearnerSafeGradingAttempt = {
  status: "graded" | "retryable";
  taskId: string;
  score?: number;
  maximumPoints?: number;
  mastered?: boolean;
  feedback: LinuxPhase12SafeResponse["feedback"];
  diagnostics: LinuxPhase12SafeResponse["diagnostics"];
  idempotencyKey: string;
  attemptId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type LinuxLearnerSafeGradingTask = {
  index: number;
  taskId: string;
  latestAttempt?: LinuxLearnerSafeGradingAttempt;
};

const ALLOWED_INPUT_KEYS = new Set(["labId", "investigationId", "taskId", "learnerAnswer", "answer", "idempotencyKey"]);
const PROHIBITED_CLIENT_KEYS = new Set([
  "assessmentContract",
  "expectedAnswers",
  "expectedAnswer",
  "rubric",
  "rubricWeights",
  "score",
  "points",
  "findingId",
  "findingIds",
  "uncertaintyId",
  "uncertaintyIds",
  "contradictionId",
  "contradictionIds",
  "assessmentHash",
  "assessmentContractHash",
  "assessmentQualityHash",
  "evidenceAnchorRegistry",
  "anchorRegistry",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstString(...values: unknown[]) {
  const found = values.find((value) => typeof value === "string" && value.trim());
  return typeof found === "string" ? found.trim() : "";
}

export function validateLinuxPhase12RouteInput(body: unknown): { ok: true; input: LinuxPhase12RouteInput } | { ok: false; status: number; error: string; field?: string } {
  if (!isRecord(body)) return { ok: false, status: 400, error: "Invalid request body." };
  for (const key of Object.keys(body)) {
    if (PROHIBITED_CLIENT_KEYS.has(key)) return { ok: false, status: 400, error: "Client-supplied grading internals are not accepted.", field: key };
    if (!ALLOWED_INPUT_KEYS.has(key)) return { ok: false, status: 400, error: "Unsupported grading request field.", field: key };
  }
  const labId = firstString(body.labId, body.investigationId);
  const taskId = firstString(body.taskId);
  const learnerAnswer = firstString(body.learnerAnswer, body.answer);
  const idempotencyKey = firstString(body.idempotencyKey);
  if (!labId) return { ok: false, status: 400, error: "Lab ID is required.", field: "labId" };
  if (!taskId) return { ok: false, status: 400, error: "Task ID is required.", field: "taskId" };
  if (!learnerAnswer) return { ok: false, status: 400, error: "Learner answer is required.", field: "learnerAnswer" };
  if (!idempotencyKey || idempotencyKey.length > 120 || !/^[A-Za-z0-9_.:-]+$/.test(idempotencyKey)) {
    return { ok: false, status: 400, error: "A valid idempotency key is required.", field: "idempotencyKey" };
  }
  if (learnerAnswer.length > LINUX_PHASE12_MAX_ANSWER_LENGTH) {
    return { ok: false, status: 413, error: "Learner answer is too large.", field: "learnerAnswer" };
  }
  return { ok: true, input: { labId, taskId, learnerAnswer, idempotencyKey } };
}

function parseTask(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return { title: value };
    }
  }
  return isRecord(value) ? value : {};
}

function studentTaskFromSavedLab(tasks: unknown, contractIndex: number) {
  if (!Array.isArray(tasks) || contractIndex < 0 || contractIndex >= tasks.length) return undefined;
  const parsed = parseTask(tasks[contractIndex]);
  return {
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    description: typeof parsed.description === "string" ? parsed.description : typeof parsed.title === "string" ? parsed.title : undefined,
    deliverable: typeof parsed.deliverable === "string" ? parsed.deliverable : undefined,
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter((item): item is string => typeof item === "string") : undefined,
  };
}

export function reconstructLinuxPhase12TrustedContract(input: {
  labId: string;
  taskId: string;
  labTitle?: string;
  labTasks?: unknown;
  provenance: LinuxGenerationProvenance | null | undefined;
  deterministicHashes: LinuxDeterministicHashes | null | undefined;
}): { ok: true; value: LinuxPhase12TrustedContract } | { ok: false; status: number; error: string; code: string } {
  const trusted = reconstructLinuxPhase12TrustedAssessmentPackage({
    labId: input.labId,
    labTitle: input.labTitle,
    provenance: input.provenance,
    deterministicHashes: input.deterministicHashes,
  });
  if (!trusted.ok) return trusted;
  const contractIndex = trusted.value.contracts.findIndex((contract) => contract.taskId === input.taskId);
  const contract = trusted.value.contracts[contractIndex];
  if (!contract) return { ok: false, status: 404, error: "Task not found for this lab.", code: "LINUX_GRADING_UNKNOWN_TASK" };
  return {
    ok: true,
    value: {
      contract,
      assessmentPackage: trusted.value.assessmentPackage,
      studentTask: studentTaskFromSavedLab(input.labTasks, contractIndex),
      renderedEvidencePaths: trusted.value.renderedEvidencePaths,
      hashes: trusted.value.hashes,
      provenance: trusted.value.provenance,
      replayStatus: "exact_match",
    },
  };
}

export function reconstructLinuxPhase12TrustedAssessmentPackage(input: {
  labId: string;
  labTitle?: string;
  provenance: LinuxGenerationProvenance | null | undefined;
  deterministicHashes: LinuxDeterministicHashes | null | undefined;
}): { ok: true; value: Omit<LinuxPhase12TrustedContract, "contract" | "studentTask"> & { contracts: LinuxTaskAssessmentContract[] } } | { ok: false; status: number; error: string; code: string } {
  if (!input.provenance || !input.deterministicHashes) {
    return { ok: false, status: 409, error: "Linux assessment provenance is unavailable for this lab.", code: "LINUX_GRADING_PROVENANCE_MISSING" };
  }
  if (!input.deterministicHashes.assessmentContractHash || !input.deterministicHashes.assessmentQualityHash) {
    return { ok: false, status: 409, error: "Historical lab was generated before assessment provenance was recorded.", code: "LINUX_GRADING_HISTORICAL_WITHOUT_ASSESSMENT_PROVENANCE" };
  }

  const replay = replayLinuxGeneration({
    labId: input.labId,
    provenance: input.provenance,
    expectedHashes: input.deterministicHashes,
    title: input.labTitle || "Amniora Linux Asset Pack",
  });
  if (replay.status !== "exact_match") {
    return { ok: false, status: 409, error: "Linux assessment contract could not be verified for this lab.", code: "LINUX_GRADING_PROVENANCE_MISMATCH" };
  }

  const candidate = buildLinuxAssetCandidate({
    category: "Linux",
    difficulty: input.provenance.difficulty,
    duration: `${input.provenance.durationMinutes} mins`,
    title: input.labTitle || "Amniora Linux Asset Pack",
    seed: input.provenance.seed,
    generationTime: input.provenance.generationTime,
    timezone: input.provenance.timezone,
    assetAttempt: input.provenance.assetAttempt,
    featureFlags: input.provenance.featureFlags,
  });
  const assessmentPackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const quality = validateLinuxAssessmentPackage({
    simulation: candidate.simulation,
    assets: candidate.assets,
    package: assessmentPackage,
    expectedAssessmentContractHash: input.deterministicHashes.assessmentContractHash,
    expectedAssessmentQualityHash: input.deterministicHashes.assessmentQualityHash,
  });
  if (quality.issues.length > 0) {
    return { ok: false, status: 409, error: "Linux assessment contract failed validation for this lab.", code: "LINUX_GRADING_CONTRACT_INVALID" };
  }

  return {
    ok: true,
    value: {
      contracts: assessmentPackage.contracts,
      assessmentPackage,
      renderedEvidencePaths: candidate.assets.map((asset) => asset.file_path),
      hashes: input.deterministicHashes,
      provenance: input.provenance,
      replayStatus: "exact_match",
    },
  };
}

export function buildLinuxLearnerSafeAttempt(input: {
  row: {
    id?: string;
    status?: string;
    task_id?: string;
    idempotency_key?: string;
    deterministic_score_report?: LinuxAssessmentScoreReport | null;
    feedback?: LinuxPhase12SafeResponse["feedback"] | null;
    diagnostics?: Array<{ code: string; severity: string; message: string }> | null;
    created_at?: string | null;
    updated_at?: string | null;
  };
}): LinuxLearnerSafeGradingAttempt | null {
  if (!input.row.task_id || !input.row.idempotency_key) return null;
  const report = input.row.deterministic_score_report || undefined;
  return {
    status: input.row.status === "graded" ? "graded" : "retryable",
    taskId: input.row.task_id,
    score: report?.score,
    maximumPoints: report?.maximumPoints,
    mastered: linuxAssessmentScoreIsMastered(report),
    feedback: input.row.feedback || {
      taskId: input.row.task_id,
      status: "retryable",
      summary: "The previous grading attempt could not be completed.",
      missingComponents: [],
      evidenceIssues: [],
      reasoningIssues: [],
      uncertaintyIssues: [],
      remediationIssues: [],
      boundaryIssues: [],
      diagnostics: [],
    },
    diagnostics: input.row.diagnostics || [],
    idempotencyKey: input.row.idempotency_key,
    attemptId: input.row.id,
    createdAt: input.row.created_at || undefined,
    updatedAt: input.row.updated_at || undefined,
  };
}

export function linuxAssessmentScoreIsMastered(report?: LinuxAssessmentScoreReport | null) {
  return Boolean(
    report &&
      Number.isFinite(report.score) &&
      Number.isFinite(report.maximumPoints) &&
      report.maximumPoints > 0 &&
      report.score >= report.maximumPoints
  );
}

export function buildLinuxLearnerSafeTaskStatuses(input: {
  taskIds: string[];
  attempts: Array<Parameters<typeof buildLinuxLearnerSafeAttempt>[0]["row"]>;
}): LinuxLearnerSafeGradingTask[] {
  const latestByTask = new Map<string, LinuxLearnerSafeGradingAttempt>();
  for (const row of input.attempts) {
    const safe = buildLinuxLearnerSafeAttempt({ row });
    if (!safe) continue;
    const existing = latestByTask.get(safe.taskId);
    if (!existing || String(safe.updatedAt || safe.createdAt || "") > String(existing.updatedAt || existing.createdAt || "")) {
      latestByTask.set(safe.taskId, safe);
    }
  }
  return input.taskIds.map((taskId, index) => ({
    index,
    taskId,
    latestAttempt: latestByTask.get(taskId),
  }));
}

export function allLinuxTasksHaveGradedAttempts(input: {
  taskIds: string[];
  attempts: Array<{ task_id?: string | null; status?: string | null }>;
}) {
  const graded = new Set(
    input.attempts
      .filter((row) => row.status === "graded" && row.task_id)
      .map((row) => String(row.task_id))
  );
  return input.taskIds.length > 0 && input.taskIds.every((taskId) => graded.has(taskId));
}

export function allLinuxTasksHaveMasteredAttempts(input: {
  taskIds: string[];
  attempts: Array<{ task_id?: string | null; status?: string | null; deterministic_score_report?: LinuxAssessmentScoreReport | null }>;
}) {
  const mastered = new Set(
    input.attempts
      .filter((row) => row.status === "graded" && row.task_id && linuxAssessmentScoreIsMastered(row.deterministic_score_report))
      .map((row) => String(row.task_id))
  );
  return input.taskIds.length > 0 && input.taskIds.every((taskId) => mastered.has(taskId));
}

export function safeLinuxPhase12GradingResponse(input: {
  result: LinuxFreeFormAssessmentResult;
  idempotencyKey: string;
  attemptId?: string;
}): LinuxPhase12SafeResponse {
  const diagnostics = input.result.diagnostics.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
  }));
  if (input.result.status === "graded") {
    return {
      status: "graded",
      taskId: input.result.taskId,
      score: input.result.scoreReport.score,
      maximumPoints: input.result.scoreReport.maximumPoints,
      feedback: input.result.feedback,
      diagnostics,
      idempotencyKey: input.idempotencyKey,
      attemptId: input.attemptId,
    };
  }
  return {
    status: "retryable",
    taskId: input.result.taskId,
    feedback: input.result.feedback,
    diagnostics,
    idempotencyKey: input.idempotencyKey,
    attemptId: input.attemptId,
  };
}

export function buildLinuxPhase12PersistenceRow(input: {
  userId: string;
  labId: string;
  generatedLabId?: string | null;
  taskId: string;
  idempotencyKey: string;
  learnerAnswer: string;
  result: LinuxFreeFormAssessmentResult;
  attempt: number;
}) {
  const provenance = input.result.provenance;
  return {
    user_id: input.userId,
    lab_id: input.labId,
    generated_lab_id: input.generatedLabId || null,
    task_id: input.taskId,
    idempotency_key: input.idempotencyKey,
    learner_answer_hash: hashLinuxGradingValue(input.learnerAnswer),
    status: input.result.status === "graded" ? "graded" : provenance.status,
    failure_code: provenance.failureCode || null,
    attempt: input.attempt,
    assessment_contract_version: provenance.assessmentContractVersion,
    assessment_contract_hash: provenance.assessmentContractHash,
    extractor_schema_version: provenance.extractorSchemaVersion,
    prompt_template_hash: provenance.promptTemplateHash,
    model_configuration_id: provenance.modelConfigurationId,
    learner_submission_hash: provenance.learnerSubmissionHash,
    raw_extraction_response_hash: provenance.rawExtractionResponseHash || null,
    normalized_typed_submission_hash: provenance.normalizedTypedSubmissionHash || null,
    deterministic_score_report_hash: provenance.deterministicScoreReportHash || null,
    normalized_typed_submission: input.result.status === "graded" ? input.result.normalizedSubmission : null,
    deterministic_score_report: input.result.status === "graded" ? input.result.scoreReport : null,
    feedback: input.result.feedback,
    diagnostics: input.result.diagnostics,
    grading_provenance: provenance,
  };
}

export function cachedLinuxPhase12Response(input: {
  row: {
    id?: string;
    status?: string;
    task_id?: string;
    idempotency_key?: string;
    learner_answer_hash?: string;
    deterministic_score_report?: LinuxAssessmentScoreReport | null;
    feedback?: LinuxPhase12SafeResponse["feedback"] | null;
    diagnostics?: Array<{ code: string; severity: string; message: string }> | null;
  };
  learnerAnswer: string;
}): { ok: true; response: LinuxPhase12SafeResponse } | { ok: false; status: number; error: string } {
  if (input.row.learner_answer_hash !== hashLinuxGradingValue(input.learnerAnswer)) {
    return { ok: false, status: 409, error: "Idempotency key was already used for a different answer." };
  }
  const report = input.row.deterministic_score_report || undefined;
  return {
    ok: true,
    response: {
      status: input.row.status === "graded" ? "graded" : "retryable",
      taskId: input.row.task_id || "",
      score: report?.score,
      maximumPoints: report?.maximumPoints,
      feedback: input.row.feedback || {
        taskId: input.row.task_id || "",
        status: "retryable",
        summary: "The previous grading attempt could not be completed.",
        missingComponents: [],
        evidenceIssues: [],
        reasoningIssues: [],
        uncertaintyIssues: [],
        remediationIssues: [],
        boundaryIssues: [],
        diagnostics: [],
      },
      diagnostics: input.row.diagnostics || [],
      idempotencyKey: input.row.idempotency_key || "",
      attemptId: input.row.id,
    },
  };
}

export function validateLinuxPhase12Replay(input: {
  provenance: LinuxAssessmentGradingProvenance;
  contract: LinuxTaskAssessmentContract;
  typedSubmission?: LinuxAssessmentSubmission;
  scoreReport?: LinuxAssessmentScoreReport;
  assessmentPackage: LinuxAssessmentPackage;
}) {
  return replayLinuxAssessmentScoring(input);
}
