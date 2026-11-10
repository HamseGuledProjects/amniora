import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { authorizeBetaAccess, betaAccessErrorResponse } from "@/lib/auth/betaAccessAuthorization";
import {
  LAB_COMPLAINT_CATEGORIES,
  LAB_COMPLAINT_DESCRIPTION_MAX,
  LAB_COMPLAINT_LEARNER_ERROR,
  LAB_COMPLAINT_TASK_REFERENCE_MAX,
  LAB_FEEDBACK_MAX_BODY_BYTES,
  feedbackRateLimitAllowed,
  hasOnlyKeys,
  labMetadataFromContext,
  learnerSafeComplaintRow,
  loadOwnedLabFeedbackContext,
  normalizeBoundedText,
  sendComplaintNotification,
} from "@/lib/labFeedback";

type RouteContext = { params: Promise<{ id: string }> };

function json(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status });
}

export async function GET(_req: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const authorization = await authorizeBetaAccess(supabase);
  if (!authorization.allowed) return betaAccessErrorResponse(authorization);
  const { id } = await params;
  const context = await loadOwnedLabFeedbackContext(authorization.user.id, id);
  if (!context.ok) return json(context.status, "Lab not found.", context.code);

  const { data, error } = await supabaseAdmin
    .from("lab_complaints")
    .select("public_reference, category, description, task_reference, status, created_at")
    .eq("user_id", authorization.user.id)
    .eq("lab_id", id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return json(503, "Reports could not be loaded.", "LAB_COMPLAINT_LOOKUP_FAILED");
  return NextResponse.json({ complaints: (data || []).map(learnerSafeComplaintRow) });
}

export async function POST(req: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const authorization = await authorizeBetaAccess(supabase);
  if (!authorization.allowed) return betaAccessErrorResponse(authorization);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > LAB_FEEDBACK_MAX_BODY_BYTES) {
    return json(413, "Report is too long.", "LAB_COMPLAINT_BODY_TOO_LARGE");
  }
  if (!feedbackRateLimitAllowed(`complaint:${authorization.user.id}`, 5)) {
    return json(429, "Too many reports. Please wait and try again.", "LAB_COMPLAINT_RATE_LIMITED");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, "Invalid request body.", "LAB_COMPLAINT_INVALID_JSON");
  }
  if (!hasOnlyKeys(body, ["category", "description", "taskReference"])) {
    return json(400, "Invalid report fields.", "LAB_COMPLAINT_UNKNOWN_FIELD");
  }
  const typed = body as { category?: unknown; description?: unknown; taskReference?: unknown };
  if (typeof typed.category !== "string" || !LAB_COMPLAINT_CATEGORIES.includes(typed.category as any)) {
    return json(400, "Choose a valid report category.", "LAB_COMPLAINT_INVALID_CATEGORY");
  }
  const description = normalizeBoundedText(typed.description, LAB_COMPLAINT_DESCRIPTION_MAX);
  if (!description.ok || !description.value) {
    return json(description.ok ? 400 : 413, description.ok ? "Describe the problem before submitting." : "Report description is too long.", description.ok ? "LAB_COMPLAINT_DESCRIPTION_REQUIRED" : "LAB_COMPLAINT_DESCRIPTION_TOO_LONG");
  }
  const taskReference = normalizeBoundedText(typed.taskReference ?? "", LAB_COMPLAINT_TASK_REFERENCE_MAX);
  if (!taskReference.ok) return json(413, "Task reference is too long.", "LAB_COMPLAINT_TASK_REFERENCE_TOO_LONG");

  const { id } = await params;
  const context = await loadOwnedLabFeedbackContext(authorization.user.id, id);
  if (!context.ok) return json(context.status, "Lab not found.", context.code);

  const row = {
    ...labMetadataFromContext(context.value),
    category: typed.category,
    description: description.value,
    task_reference: taskReference.value || null,
    status: "new",
    notification_status: "pending",
  };
  const { data, error } = await supabaseAdmin
    .from("lab_complaints")
    .insert(row)
    .select("id, public_reference, category, description, task_reference, status, created_at, lab_title, lab_category, lab_difficulty, lab_duration")
    .single();

  if (error || !data) {
    return json(503, LAB_COMPLAINT_LEARNER_ERROR, "LAB_COMPLAINT_PERSISTENCE_FAILED");
  }

  const notification = await sendComplaintNotification({
    complaintId: data.id,
    reference: data.public_reference,
    category: data.category,
    description: data.description,
    taskReference: data.task_reference,
    submittedAt: data.created_at,
    labId: id,
    labTitle: data.lab_title,
    labCategory: data.lab_category,
    labDifficulty: data.lab_difficulty,
    labDuration: data.lab_duration,
    accountEmail: authorization.user.email || null,
  });

  await supabaseAdmin
    .from("lab_complaints")
    .update({
      notification_status: notification.status,
      notification_attempts: 1,
      notification_last_attempt_at: new Date().toISOString(),
      notification_error_code: notification.errorCode,
    })
    .eq("id", data.id)
    .eq("user_id", authorization.user.id);

  return NextResponse.json({
    complaint: learnerSafeComplaintRow(data),
    reference: data.public_reference,
    message: "Thanks. Your report was saved for review.",
  });
}
