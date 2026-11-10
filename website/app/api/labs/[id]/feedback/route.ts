import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { authorizeBetaAccess, betaAccessErrorResponse } from "@/lib/auth/betaAccessAuthorization";
import {
  LAB_FEEDBACK_LEARNER_ERROR,
  LAB_FEEDBACK_MAX_BODY_BYTES,
  LAB_FEEDBACK_NOTE_MAX,
  LAB_FEEDBACK_RATINGS,
  feedbackRateLimitAllowed,
  hasOnlyKeys,
  labMetadataFromContext,
  learnerSafeFeedbackRow,
  loadOwnedLabFeedbackContext,
  normalizeBoundedText,
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
    .from("lab_feedback")
    .select("public_reference, rating, improvement_note, created_at, updated_at")
    .eq("user_id", authorization.user.id)
    .eq("lab_id", id)
    .maybeSingle();

  if (error) return json(503, "Feedback could not be loaded.", "LAB_FEEDBACK_LOOKUP_FAILED");
  return NextResponse.json({ feedback: learnerSafeFeedbackRow(data) });
}

export async function PUT(req: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const authorization = await authorizeBetaAccess(supabase);
  if (!authorization.allowed) return betaAccessErrorResponse(authorization);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > LAB_FEEDBACK_MAX_BODY_BYTES) {
    return json(413, "Feedback is too long.", "LAB_FEEDBACK_BODY_TOO_LARGE");
  }
  if (!feedbackRateLimitAllowed(`feedback:${authorization.user.id}`)) {
    return json(429, "Too many feedback submissions. Please wait and try again.", "LAB_FEEDBACK_RATE_LIMITED");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, "Invalid request body.", "LAB_FEEDBACK_INVALID_JSON");
  }
  if (!hasOnlyKeys(body, ["rating", "improvementNote"])) {
    return json(400, "Invalid feedback fields.", "LAB_FEEDBACK_UNKNOWN_FIELD");
  }
  const typed = body as { rating?: unknown; improvementNote?: unknown };
  if (typeof typed.rating !== "string" || !LAB_FEEDBACK_RATINGS.includes(typed.rating as any)) {
    return json(400, "Choose a valid rating.", "LAB_FEEDBACK_INVALID_RATING");
  }
  const note = normalizeBoundedText(typed.improvementNote ?? "", LAB_FEEDBACK_NOTE_MAX);
  if (!note.ok) return json(413, "Feedback is too long.", "LAB_FEEDBACK_NOTE_TOO_LONG");

  const { id } = await params;
  const context = await loadOwnedLabFeedbackContext(authorization.user.id, id);
  if (!context.ok) return json(context.status, "Lab not found.", context.code);

  const { data, error } = await supabaseAdmin
    .from("lab_feedback")
    .upsert({
      ...labMetadataFromContext(context.value),
      rating: typed.rating,
      improvement_note: note.value || null,
    }, { onConflict: "user_id,lab_id" })
    .select("public_reference, rating, improvement_note, created_at, updated_at")
    .single();

  if (error || !data) {
    return json(503, LAB_FEEDBACK_LEARNER_ERROR, "LAB_FEEDBACK_PERSISTENCE_FAILED");
  }
  return NextResponse.json({ feedback: learnerSafeFeedbackRow(data), message: "Thanks for helping improve this lab." });
}
