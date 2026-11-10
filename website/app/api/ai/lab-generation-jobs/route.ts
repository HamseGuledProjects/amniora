import { after, NextResponse } from "next/server";
import { POST as generateLab } from "@/app/api/ai/generate-lab/route";
import { recordAIUsage, releaseAIUsageReservation, reserveAIUsage } from "@/lib/ai/usageService";
import {
  usesExecutableWebEngine,
  EXECUTABLE_WEB_GENERATOR,
  type ExecutableGenerationStage,
  type ExecutableGenerationStageReporter,
} from "@/lib/web-lab/generated-executable-lab";
import { executableWebGenerationEnabled, saveGeneratedExecutableWebLab } from "@/lib/web-lab/generated-executable-product";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 300;

const allowedCategories = ["Linux", "Networking", "Web Security", "OSINT"];
const allowedDurations = ["15 mins", "30 mins", "60 mins"];
const SAFE_LINUX_GENERATION_FAILURE_MESSAGE =
  "We couldn’t generate this investigation safely. Please try again.";
const LINUX_DURATION_COMPATIBILITY_MESSAGE =
  "15-minute Linux investigations are available for Beginner difficulty. Choose 30 minutes for Intermediate or Advanced.";
const STALE_JOB_MS = 14 * 60 * 1000;
const JOB_SCHEMA_UNAVAILABLE_CODE = "lab_generation_job_schema_unavailable";
const SAFE_EXECUTABLE_WORKER_ERROR_CODES: ReadonlySet<string> = new Set([
  "EXECUTABLE_WEB_GENERATION_DISABLED",
  "GENERATION_BUILD_LINK_MISMATCH",
  "GENERATION_BUILD_LINK_MISSING",
  "GENERATION_JOB_COMPLETION_FAILED",
  "GENERATION_JOB_INVALID",
  "GENERATION_JOB_LINK_FAILED",
  "GENERATION_JOB_RESERVATION_FAILED",
  "GENERATION_SAVED_LAB_INSERT_FAILED",
  "INVALID_GENERATION_IDENTITY",
]);
type GenerationWorkerDiagnosticStage = ExecutableGenerationStage | "static_generation";

type LabGenerationJobRow = {
  id: string;
  user_id: string;
  category: string;
  difficulty: string;
  duration: string;
  status: "queued" | "generating" | "completed" | "failed";
  resulting_lab_id: string | null;
  usage_reservation_id: string | null;
  safe_error_code: string | null;
  safe_error_message: string | null;
  retryable: boolean;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  expires_at: string;
};

function safeJob(row: LabGenerationJobRow) {
  return {
    id: row.id,
    category: row.category,
    difficulty: row.difficulty,
    duration: row.duration,
    status: row.status,
    resultingLabId: row.resulting_lab_id,
    safeErrorCode: row.safe_error_code,
    safeErrorMessage: row.safe_error_message,
    retryable: row.retryable,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    expiresAt: row.expires_at,
  };
}

function durationToMinutes(duration: string) {
  return Number.parseInt(duration) || 30;
}

function linuxDurationIsSupported(category: string, difficulty: string, duration: string) {
  return category !== "Linux" || durationToMinutes(duration) !== 15 || difficulty === "Beginner";
}

function safeFailureCode(payload: unknown) {
  if (!payload || typeof payload !== "object") return "generation_failed";
  const value = (payload as { error?: unknown }).error;
  if (typeof value !== "string" || !/^[a-z0-9_:-]{1,80}$/i.test(value)) {
    return "generation_failed";
  }
  return value;
}

function safeFailureMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return SAFE_LINUX_GENERATION_FAILURE_MESSAGE;
  }
  const value = (payload as { message?: unknown }).message;
  if (typeof value !== "string" || !value.trim()) {
    return SAFE_LINUX_GENERATION_FAILURE_MESSAGE;
  }
  return value;
}

function jobStoreFailureCode(error: unknown) {
  const details = error as { code?: unknown; message?: unknown };
  const code = typeof details?.code === "string" ? details.code : "";
  const message = typeof details?.message === "string" ? details.message : "";
  if (code === "42P01" || /lab_generation_jobs/i.test(message)) {
    return JOB_SCHEMA_UNAVAILABLE_CODE;
  }
  return "lab_generation_job_store_failed";
}

function jobStoreFailureStatus(code: string) {
  return code === JOB_SCHEMA_UNAVAILABLE_CODE ? 503 : 500;
}

function safeDatabaseIdentifier(value: unknown) {
  return typeof value === "string" && /^[a-z_][a-z0-9_$]{0,62}$/i.test(value)
    ? value
    : undefined;
}

function safeWorkerErrorCode(error: unknown, errorCode: string | undefined) {
  if (errorCode && /^[0-9A-Z]{5}$/.test(errorCode)) return errorCode;
  if (errorCode && SAFE_EXECUTABLE_WORKER_ERROR_CODES.has(errorCode)) return errorCode;
  if (error instanceof Error && SAFE_EXECUTABLE_WORKER_ERROR_CODES.has(error.message)) {
    return error.message;
  }
  return "unknown";
}

function safeGenerationWorkerDiagnostic(error: unknown, stage: GenerationWorkerDiagnosticStage) {
  const details = error && typeof error === "object"
    ? error as { code?: unknown; table_name?: unknown; column_name?: unknown; constraint_name?: unknown }
    : {};
  const errorCode = typeof details.code === "string" ? details.code : undefined;
  const postgresError = Boolean(errorCode && /^[0-9A-Z]{5}$/.test(errorCode));
  const table = postgresError ? safeDatabaseIdentifier(details.table_name) : undefined;
  const column = postgresError ? safeDatabaseIdentifier(details.column_name) : undefined;
  const constraint = postgresError ? safeDatabaseIdentifier(details.constraint_name) : undefined;

  return {
    stage,
    code: safeWorkerErrorCode(error, errorCode),
    ...(table ? { table } : {}),
    ...(column ? { column } : {}),
    ...(constraint ? { constraint } : {}),
  };
}

async function reconcileStaleJob(job: LabGenerationJobRow) {
  if (!["queued", "generating"].includes(job.status)) return job;
  const updatedAt = Date.parse(job.updated_at || job.created_at);
  const expiresAt = Date.parse(job.expires_at);
  const staleByUpdate = Number.isFinite(updatedAt) && Date.now() - updatedAt > STALE_JOB_MS;
  const staleByExpiry = Number.isFinite(expiresAt) && Date.now() > expiresAt;
  if (!staleByUpdate && !staleByExpiry) return job;

  await releaseAIUsageReservation(job.usage_reservation_id || undefined);
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from("lab_generation_jobs")
    .update({
      status: "failed",
      safe_error_code: "generation_stale",
      safe_error_message: SAFE_LINUX_GENERATION_FAILURE_MESSAGE,
      retryable: true,
      updated_at: now,
      failed_at: now,
    })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .in("status", ["queued", "generating"])
    .select("*")
    .single();

  return (data as LabGenerationJobRow | null) || job;
}

async function loadLatestJob(userId: string, id?: string) {
  let query = supabaseAdmin
    .from("lab_generation_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (id) query = query.eq("id", id);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(jobStoreFailureCode(error));
  }
  const job = data as LabGenerationJobRow | null;
  return job ? reconcileStaleJob(job) : null;
}

async function loadActiveJob(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("lab_generation_jobs")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["queued", "generating"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(jobStoreFailureCode(error));
  }
  const job = data as LabGenerationJobRow | null;
  return job ? reconcileStaleJob(job) : null;
}

async function markJobFailed(jobId: string, code = "generation_failed", retryable = true) {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("lab_generation_jobs")
    .update({
      status: "failed",
      safe_error_code: code,
      safe_error_message: SAFE_LINUX_GENERATION_FAILURE_MESSAGE,
      retryable,
      updated_at: now,
      failed_at: now,
    })
    .eq("id", jobId)
    .in("status", ["queued", "generating"]);
}

async function runExecutableWebGenerationJob(
  job: LabGenerationJobRow,
  advanceStage: ExecutableGenerationStageReporter,
) {
  advanceStage("usage_reserve");
  const usage = await reserveAIUsage(job.user_id, "lab_generation");
  if (!usage.allowed || !usage.reservationId) {
    advanceStage("failure_record");
    await markJobFailed(job.id, "generation_limit_reached", true);
    return;
  }
  let reservationId: string | undefined = usage.reservationId;
  try {
    advanceStage("job_reservation_link");
    const { data: reservedJob, error: reservationError } = await supabaseAdmin
      .from("lab_generation_jobs")
      .update({ usage_reservation_id: reservationId, updated_at: new Date().toISOString() })
      .eq("id", job.id).eq("user_id", job.user_id).eq("status", "generating")
      .is("usage_reservation_id", null).select("id").maybeSingle();
    if (reservationError || !reservedJob) throw new Error("GENERATION_JOB_RESERVATION_FAILED");

    advanceStage("generation_job_lock");
    const saved = await saveGeneratedExecutableWebLab(job.id, job.user_id, advanceStage);
    advanceStage("usage_finalize");
    await recordAIUsage({
      reservationId, userId: job.user_id, feature: "lab_generation",
      modelUsed: EXECUTABLE_WEB_GENERATOR, inputTokens: 0, outputTokens: 0,
      estimatedCost: 0,
    });
    reservationId = undefined;
    const completedAt = new Date().toISOString();
    advanceStage("job_complete");
    const { error: completionError } = await supabaseAdmin.from("lab_generation_jobs")
      .update({ status: "completed", resulting_lab_id: saved.savedLabId,
        safe_error_code: null, safe_error_message: null, retryable: false,
        updated_at: completedAt, completed_at: completedAt })
      .eq("id", job.id).eq("user_id", job.user_id).eq("status", "generating");
    if (completionError) throw new Error("GENERATION_JOB_COMPLETION_FAILED");
  } catch (error) {
    await releaseAIUsageReservation(reservationId);
    throw error;
  }
}

async function runGenerationJob({
  job,
  body,
  headers,
}: {
  job: LabGenerationJobRow;
  body: Record<string, unknown>;
  headers: Headers;
}) {
  const now = new Date().toISOString();
  const { data: claimedJob, error: claimError } = await supabaseAdmin
    .from("lab_generation_jobs")
    .update({
      status: "generating",
      started_at: now,
      updated_at: now,
    })
    .eq("id", job.id)
    .eq("user_id", job.user_id)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  // The queued -> generating transition is the single execution claim. A
  // second worker or replay must not continue when it did not win that claim.
  if (claimError || !claimedJob) {
    if (claimError) {
      console.warn("[Amniora Lab Generation Job] safe claim failure", {
        jobId: job.id,
        code: claimError.code,
      });
    }
    return;
  }
  const activeJob = claimedJob as LabGenerationJobRow;
  let diagnosticStage: GenerationWorkerDiagnosticStage = body.generationEngine === EXECUTABLE_WEB_GENERATOR
    ? "usage_reserve"
    : "static_generation";
  const advanceStage: ExecutableGenerationStageReporter = (stage) => {
    diagnosticStage = stage;
  };

  try {
    if (body.generationEngine === EXECUTABLE_WEB_GENERATOR) {
      if (!usesExecutableWebEngine(activeJob.category, activeJob.difficulty, activeJob.duration,
        executableWebGenerationEnabled())) {
        advanceStage("failure_record");
        await markJobFailed(activeJob.id, "executable_web_unavailable", true);
        return;
      }
      await runExecutableWebGenerationJob(activeJob, advanceStage);
      return;
    }
    const response = await generateLab(
      new Request("https://amniora.local/api/ai/generate-lab", {
        method: "POST",
        headers,
        body: JSON.stringify({
          category: activeJob.category,
          difficulty: activeJob.difficulty,
          duration: activeJob.duration,
          aiContentConsentToken: body.aiContentConsentToken,
          generationJobId: activeJob.id,
        }),
      })
    );
    const payload = await response.json().catch(() => null);
    const completedAt = new Date().toISOString();

    if (!response.ok || !payload?.lab?.id) {
      advanceStage("failure_record");
      await markJobFailed(activeJob.id, safeFailureCode(payload), Boolean(payload?.retryable ?? true));
      return;
    }

    advanceStage("job_complete");
    await supabaseAdmin
      .from("lab_generation_jobs")
      .update({
        status: "completed",
        resulting_lab_id: payload.lab.id,
        safe_error_code: null,
        safe_error_message: null,
        retryable: false,
        updated_at: completedAt,
        completed_at: completedAt,
      })
      .eq("id", activeJob.id)
      .eq("user_id", activeJob.user_id)
      .in("status", ["queued", "generating"]);
  } catch (error) {
    console.error("[Amniora Lab Generation Job] safe failure",
      safeGenerationWorkerDiagnostic(error, diagnosticStage));
    advanceStage("failure_record");
    await markJobFailed(activeJob.id);
  }
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) {
      return betaAccessErrorResponse(authorization);
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id") || undefined;
    const job = await loadLatestJob(authorization.user.id, id);
    return NextResponse.json({ job: job ? safeJob(job) : null,
      executableWebAvailable: executableWebGenerationEnabled() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "lab_generation_job_lookup_failed";
    return NextResponse.json(
      {
        error: code === JOB_SCHEMA_UNAVAILABLE_CODE ? code : "lab_generation_job_lookup_failed",
        message: "Generation status could not be checked right now.",
      },
      { status: jobStoreFailureStatus(code) }
    );
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) {
      return betaAccessErrorResponse(authorization);
    }

    const active = await loadActiveJob(authorization.user.id);
    if (active && ["queued", "generating"].includes(active.status)) {
      return NextResponse.json({ job: safeJob(active), duplicate: true });
    }

    const body = await req.json();
    const category = String(body.category || "Linux").trim();
    const difficulty = String(body.difficulty || "Beginner").trim();
    const duration = String(body.duration || "30 mins").trim();

    if (!allowedCategories.includes(category)) {
      return NextResponse.json({ error: "invalid_category" }, { status: 400 });
    }
    if (!allowedDurations.includes(duration)) {
      return NextResponse.json({ error: "invalid_duration" }, { status: 400 });
    }
    if (!linuxDurationIsSupported(category, difficulty, duration)) {
      return NextResponse.json(
        {
          error: "unsupported_duration_difficulty",
          message: LINUX_DURATION_COMPATIBILITY_MESSAGE,
        },
        { status: 400 }
      );
    }
    const executableWeb = usesExecutableWebEngine(category, difficulty, duration,
      executableWebGenerationEnabled());
    const requestedEngine = body.generationEngine === EXECUTABLE_WEB_GENERATOR
      ? EXECUTABLE_WEB_GENERATOR : body.generationEngine === "ai" || body.generationEngine == null ? "ai" : null;
    if (!requestedEngine || (requestedEngine === EXECUTABLE_WEB_GENERATOR) !== executableWeb) {
      return NextResponse.json({ error: "generation_engine_unavailable",
        message: "Generation settings changed. Refresh the page and try again." }, { status: 409 });
    }
    if (!executableWeb && (typeof body.aiContentConsentToken !== "string" || !body.aiContentConsentToken.trim())) {
      return NextResponse.json({ error: "content_consent_required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("lab_generation_jobs")
      .insert({
        user_id: authorization.user.id,
        category,
        difficulty,
        duration,
        status: "queued",
      })
      .select("*")
      .single();

    if (error || !data) {
      const code = error ? jobStoreFailureCode(error) : "lab_generation_job_create_failed";
      console.warn("[Amniora Lab Generation Job] safe store failure", {
        code,
        stage: "job_create",
      });
      if (code !== JOB_SCHEMA_UNAVAILABLE_CODE) {
        const fallback = await loadActiveJob(authorization.user.id);
        if (fallback && ["queued", "generating"].includes(fallback.status)) {
          return NextResponse.json({ job: safeJob(fallback), duplicate: true });
        }
      }
      return NextResponse.json(
        {
          error: code === JOB_SCHEMA_UNAVAILABLE_CODE ? code : "lab_generation_job_create_failed",
          message: SAFE_LINUX_GENERATION_FAILURE_MESSAGE,
        },
        { status: jobStoreFailureStatus(code) }
      );
    }

    const job = data as LabGenerationJobRow;
    const headers = new Headers({ "Content-Type": "application/json" });
    const cookie = req.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    after(() => runGenerationJob({ job, body, headers }));

    return NextResponse.json({ job: safeJob(job) }, { status: 202 });
  } catch {
    return NextResponse.json(
      {
        error: "lab_generation_job_create_failed",
        message: SAFE_LINUX_GENERATION_FAILURE_MESSAGE,
      },
      { status: 500 }
    );
  }
}
