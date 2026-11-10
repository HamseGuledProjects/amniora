import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";
import {
  recordAIUsage,
  releaseAIUsageReservation,
  reserveAIUsage,
} from "@/lib/ai/usageService";
import { chooseAIModel } from "@/lib/ai/modelRouter";
import { OpenAITimeoutError } from "@/lib/ai/openaiFetch";
import {
  AiContentConsentError,
  assertGeneratedLabHasAiContentConsent,
} from "@/lib/ai/contentSharingConsentServer";
import { createOpenAIResponsesLinuxAssessmentExtractor, type LinuxOpenAIExtractionAttempt } from "@/lib/lab-assets/linux/openAIExtractionAdapter";
import { gradeLinuxFreeFormAssessment } from "@/lib/lab-assets/linux/freeFormAssessment";
import {
  allLinuxTasksHaveMasteredAttempts,
  buildLinuxLearnerSafeTaskStatuses,
  buildLinuxPhase12PersistenceRow,
  cachedLinuxPhase12Response,
  LINUX_PHASE12_GRADING_ROUTE_VERSION,
  LINUX_PHASE12_MAX_ANSWER_LENGTH,
  LINUX_PHASE12_MAX_BODY_BYTES,
  reconstructLinuxPhase12TrustedAssessmentPackage,
  reconstructLinuxPhase12TrustedContract,
  safeLinuxPhase12GradingResponse,
  validateLinuxPhase12RouteInput,
} from "@/lib/lab-assets/linux/gradingService";
import { hashLinuxGradingValue } from "@/lib/lab-assets/linux/assessmentGradingProvenance";
import type { LinuxDeterministicHashes, LinuxGenerationProvenance } from "@/lib/lab-assets/linux/generationContext";

type LabRow = {
  id: string;
  user_id: string;
  title?: string | null;
  topic?: string | null;
  tasks?: unknown;
};

type ProvenanceRow = {
  generated_lab_id?: string | null;
  provenance?: LinuxGenerationProvenance | null;
  deterministic_hashes?: LinuxDeterministicHashes | null;
};

type AttemptRow = {
  id?: string;
  status?: string;
  task_id?: string;
  idempotency_key?: string;
  learner_answer_hash?: string;
  deterministic_score_report?: any;
  feedback?: any;
  diagnostics?: Array<{ code: string; severity: string; message: string }> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const rateLimitBuckets = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function rateLimitAllowed(userId: string) {
  const now = Date.now();
  const existing = rateLimitBuckets.get(userId)?.filter((item) => now - item < RATE_LIMIT_WINDOW_MS) || [];
  if (existing.length >= RATE_LIMIT_MAX) return false;
  existing.push(now);
  rateLimitBuckets.set(userId, existing);
  return true;
}

function responseForFailure(status: number, error: string, code?: string) {
  return NextResponse.json({ error, code, retryable: status >= 500 || status === 409 }, { status });
}

async function loadOwnedLinuxLab(userId: string, labId: string) {
  const { data: lab, error } = await supabaseAdmin
    .from("labs")
    .select("id, user_id, title, topic, tasks, completed")
    .eq("id", labId)
    .eq("user_id", userId)
    .single<LabRow & { completed?: boolean | null }>();
  if (error || !lab) return { ok: false as const, response: NextResponse.json({ error: "Lab not found." }, { status: 404 }) };
  if (lab.topic !== "Linux") {
    return { ok: false as const, response: NextResponse.json({ error: "Linux grading is only available for Linux labs." }, { status: 400 }) };
  }
  return { ok: true as const, lab };
}

async function loadLinuxProvenance(userId: string, labId: string) {
  const { data: provenanceRows, error } = await supabaseAdmin
    .from("linux_generation_provenance")
    .select("generated_lab_id, provenance, deterministic_hashes")
    .eq("lab_id", labId)
    .eq("user_id", userId)
    .limit(1);
  return {
    error,
    provenanceRow: (Array.isArray(provenanceRows) ? provenanceRows[0] : undefined) as ProvenanceRow | undefined,
  };
}

async function updateLabCompletionFromAuthoritativeGrades(input: {
  userId: string;
  labId: string;
  taskIds: string[];
}) {
  const { data: attempts, error } = await supabaseAdmin
    .from("linux_grading_attempts")
    .select("task_id, status, deterministic_score_report")
    .eq("user_id", input.userId)
    .eq("lab_id", input.labId);
  if (error) return false;
  if (!allLinuxTasksHaveMasteredAttempts({ taskIds: input.taskIds, attempts: attempts || [] })) return false;
  await supabaseAdmin
    .from("labs")
    .update({ completed: true })
    .eq("id", input.labId)
    .eq("user_id", input.userId)
    .eq("completed", false);
  return true;
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) return betaAccessErrorResponse(authorization);
    const { user } = authorization;
    const labId = new URL(req.url).searchParams.get("labId")?.trim();
    if (!labId) return NextResponse.json({ error: "Lab ID is required." }, { status: 400 });

    const labResult = await loadOwnedLinuxLab(user.id, labId);
    if (!labResult.ok) return labResult.response;
    const { lab } = labResult;

    const { provenanceRow, error: provenanceError } = await loadLinuxProvenance(user.id, labId);
    if (provenanceError) return responseForFailure(503, "Linux assessment provenance lookup failed.", "LINUX_GRADING_PROVENANCE_LOOKUP_FAILED");
    const trusted = reconstructLinuxPhase12TrustedAssessmentPackage({
      labId,
      labTitle: lab.title || undefined,
      provenance: provenanceRow?.provenance,
      deterministicHashes: provenanceRow?.deterministic_hashes,
    });
    if (!trusted.ok) {
      return NextResponse.json({
        available: false,
        code: trusted.code,
        message: trusted.error,
        maxAnswerLength: LINUX_PHASE12_MAX_ANSWER_LENGTH,
        tasks: [],
      }, { status: trusted.status });
    }

    const { data: attempts, error: attemptsError } = await supabaseAdmin
      .from("linux_grading_attempts")
      .select("id, status, task_id, idempotency_key, deterministic_score_report, feedback, diagnostics, created_at, updated_at")
      .eq("user_id", user.id)
      .eq("lab_id", labId)
      .order("updated_at", { ascending: false });
    if (attemptsError) return responseForFailure(503, "Grading attempts could not be loaded.", "LINUX_GRADING_PERSISTENCE_FAILED");

    const taskIds = trusted.value.contracts.map((contract) => contract.taskId);
    const tasks = buildLinuxLearnerSafeTaskStatuses({ taskIds, attempts: attempts || [] });
    return NextResponse.json({
      available: true,
      labId,
      maxAnswerLength: LINUX_PHASE12_MAX_ANSWER_LENGTH,
      tasks,
      attemptedTaskCount: tasks.filter((task) => task.latestAttempt?.status === "graded").length,
      masteredTaskCount: tasks.filter((task) => task.latestAttempt?.mastered === true).length,
      totalTaskCount: tasks.length,
      allTasksGraded: tasks.length > 0 && tasks.every((task) => task.latestAttempt?.status === "graded"),
      allTasksMastered: tasks.length > 0 && tasks.every((task) => task.latestAttempt?.mastered === true),
    });
  } catch {
    return NextResponse.json(
      { error: "Linux grading status is temporarily unavailable." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  let reservationId: string | undefined;

  try {
    const supabase = await createClient();
    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) return betaAccessErrorResponse(authorization);
    const { user } = authorization;

    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > LINUX_PHASE12_MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
    }

    if (!rateLimitAllowed(user.id)) {
      return NextResponse.json({ error: "Too many grading requests. Please wait and try again." }, { status: 429 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const inputValidation = validateLinuxPhase12RouteInput(body);
    if (!inputValidation.ok) {
      return NextResponse.json(
        { error: inputValidation.error, field: inputValidation.field },
        { status: inputValidation.status }
      );
    }
    const input = inputValidation.input;
    const learnerAnswerHash = hashLinuxGradingValue(input.learnerAnswer);

    const labResult = await loadOwnedLinuxLab(user.id, input.labId);
    if (!labResult.ok) return labResult.response;
    const { lab } = labResult;

    const { data: existingAttempt, error: existingError } = await supabaseAdmin
      .from("linux_grading_attempts")
      .select("id, status, task_id, idempotency_key, learner_answer_hash, deterministic_score_report, feedback, diagnostics")
      .eq("user_id", user.id)
      .eq("lab_id", input.labId)
      .eq("task_id", input.taskId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle<AttemptRow>();
    if (existingError) return responseForFailure(503, "Grading attempt lookup failed.", "LINUX_GRADING_PERSISTENCE_FAILED");
    if (existingAttempt) {
      const cached = cachedLinuxPhase12Response({ row: existingAttempt, learnerAnswer: input.learnerAnswer });
      if (!cached.ok) return NextResponse.json({ error: cached.error }, { status: cached.status });
      return NextResponse.json(cached.response);
    }

    const { provenanceRow, error: provenanceError } = await loadLinuxProvenance(user.id, input.labId);
    if (provenanceError) return responseForFailure(503, "Linux assessment provenance lookup failed.", "LINUX_GRADING_PROVENANCE_LOOKUP_FAILED");
    const trusted = reconstructLinuxPhase12TrustedContract({
      labId: input.labId,
      taskId: input.taskId,
      labTitle: lab.title || undefined,
      labTasks: lab.tasks,
      provenance: provenanceRow?.provenance,
      deterministicHashes: provenanceRow?.deterministic_hashes,
    });
    if (!trusted.ok) return responseForFailure(trusted.status, trusted.error, trusted.code);

    if (!provenanceRow?.generated_lab_id) {
      return responseForFailure(
        409,
        "Linux grading requires generated-lab consent provenance.",
        "LINUX_GRADING_CONSENT_PROVENANCE_MISSING"
      );
    }

    await assertGeneratedLabHasAiContentConsent({
      userId: user.id,
      generatedLabId: provenanceRow.generated_lab_id,
    });

    const { data: insertedAttempt, error: insertError } = await supabaseAdmin
      .from("linux_grading_attempts")
      .insert({
        user_id: user.id,
        lab_id: input.labId,
        generated_lab_id: provenanceRow?.generated_lab_id || null,
        task_id: input.taskId,
        idempotency_key: input.idempotencyKey,
        learner_answer_hash: learnerAnswerHash,
        status: "processing",
        attempt: 1,
        assessment_contract_version: trusted.value.contract.version,
        assessment_contract_hash: trusted.value.assessmentPackage.assessmentContractHash,
        extractor_schema_version: "pending",
        prompt_template_hash: "pending",
        model_configuration_id: "pending",
        learner_submission_hash: learnerAnswerHash,
        feedback: {},
        diagnostics: [],
        grading_provenance: {},
      })
      .select("id")
      .single<{ id: string }>();
    if (insertError || !insertedAttempt) {
      const { data: duplicate } = await supabaseAdmin
        .from("linux_grading_attempts")
        .select("id, status, task_id, idempotency_key, learner_answer_hash, deterministic_score_report, feedback, diagnostics")
        .eq("user_id", user.id)
        .eq("lab_id", input.labId)
        .eq("task_id", input.taskId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle<AttemptRow>();
      if (duplicate) {
        const cached = cachedLinuxPhase12Response({ row: duplicate, learnerAnswer: input.learnerAnswer });
        if (!cached.ok) return NextResponse.json({ error: cached.error }, { status: cached.status });
        return NextResponse.json(cached.response);
      }
      return responseForFailure(503, "Grading attempt could not be created.", "LINUX_GRADING_PERSISTENCE_FAILED");
    }

    const usage = await reserveAIUsage(user.id, "linux_grading");
    if (!usage.allowed || !usage.reservationId) {
      return NextResponse.json({ error: usage.reason, usage }, { status: 403 });
    }
    reservationId = usage.reservationId;

    const plan = usage.plan;
    const model = chooseAIModel({ feature: "linux_grading", plan, complexity: "normal" });
    const extractionAttempts: LinuxOpenAIExtractionAttempt[] = [];
    const extractor = createOpenAIResponsesLinuxAssessmentExtractor({
      model,
      onAttempt: (attempt) => extractionAttempts.push(attempt),
    });
    const result = await gradeLinuxFreeFormAssessment({
      contract: trusted.value.contract,
      learnerAnswer: input.learnerAnswer,
      studentTask: trusted.value.studentTask,
      renderedEvidencePaths: trusted.value.renderedEvidencePaths,
      extractor,
      modelConfigurationId: `${LINUX_PHASE12_GRADING_ROUTE_VERSION}:${model}`,
      attempt: 1,
      labId: input.labId,
      investigationId: input.labId,
      createdAt: new Date().toISOString(),
    });
    const row = buildLinuxPhase12PersistenceRow({
      userId: user.id,
      labId: input.labId,
      generatedLabId: provenanceRow?.generated_lab_id || null,
      taskId: input.taskId,
      idempotencyKey: input.idempotencyKey,
      learnerAnswer: input.learnerAnswer,
      result,
      attempt: 1,
    });
    const { error: updateError } = await supabaseAdmin
      .from("linux_grading_attempts")
      .update(row)
      .eq("id", insertedAttempt.id)
      .eq("user_id", user.id);
    if (updateError) return responseForFailure(503, "Grading result could not be persisted.", "LINUX_GRADING_PERSISTENCE_FAILED");
    if (result.status === "graded") {
      await updateLabCompletionFromAuthoritativeGrades({
        userId: user.id,
        labId: input.labId,
        taskIds: trusted.value.assessmentPackage.contracts.map((contract) => contract.taskId),
      });
    }

    const usageSummary = extractionAttempts.reduce(
      (total, attempt) => ({
        inputTokens: total.inputTokens + attempt.promptTokens,
        outputTokens: total.outputTokens + attempt.completionTokens,
      }),
      { inputTokens: 0, outputTokens: 0 }
    );
    await recordAIUsage({
      reservationId,
      userId: user.id,
      feature: "linux_grading",
      modelUsed: model,
      inputTokens: usageSummary.inputTokens || estimateTokens(input.learnerAnswer),
      outputTokens: usageSummary.outputTokens,
      estimatedCost: 0,
      generatedLabId: provenanceRow?.generated_lab_id || undefined,
    });
    reservationId = undefined;

    return NextResponse.json(safeLinuxPhase12GradingResponse({
      result,
      idempotencyKey: input.idempotencyKey,
      attemptId: insertedAttempt.id,
    }));
  } catch (error) {
    await releaseAIUsageReservation(reservationId);
    if (error instanceof OpenAITimeoutError) {
      return NextResponse.json({ error: error.message, retryable: true }, { status: 504 });
    }
    if (error instanceof AiContentConsentError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Linux grading is temporarily unavailable. Please try again.", retryable: true },
      { status: 500 }
    );
  }
}
