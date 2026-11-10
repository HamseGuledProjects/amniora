import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const LAB_FEEDBACK_NOTE_MAX = 1500;
export const LAB_COMPLAINT_DESCRIPTION_MAX = 3000;
export const LAB_COMPLAINT_TASK_REFERENCE_MAX = 100;
export const LAB_FEEDBACK_MAX_BODY_BYTES = 8192;

export const LAB_FEEDBACK_RATINGS = ["poor", "fair", "good", "excellent"] as const;
export type LabFeedbackRating = (typeof LAB_FEEDBACK_RATINGS)[number];

export const LAB_COMPLAINT_CATEGORIES = [
  "incorrect_or_contradictory_evidence",
  "task_cannot_be_completed",
  "grading_problem",
  "offensive_or_inappropriate_content",
  "privacy_or_security_concern",
  "export_or_download_problem",
  "other",
] as const;
export type LabComplaintCategory = (typeof LAB_COMPLAINT_CATEGORIES)[number];

export const LAB_COMPLAINT_STATUSES = ["new", "reviewing", "resolved", "dismissed"] as const;
export type LabComplaintStatus = (typeof LAB_COMPLAINT_STATUSES)[number];

export const LAB_FEEDBACK_LEARNER_ERROR =
  "Amniora could not save this feedback right now. Please try again.";
export const LAB_COMPLAINT_LEARNER_ERROR =
  "Amniora could not submit this report right now. Please try again.";

export type LabFeedbackContext = {
  lab: {
    id: string;
    user_id: string;
    title: string | null;
    topic: string | null;
    difficulty: string | null;
    estimated_time: string | null;
    created_at: string | null;
  };
  generatedLabId: string | null;
  appEnvironment: string;
};

const rateLimitBuckets = new Map<string, number[]>();

export function feedbackRateLimitAllowed(key: string, limit = 8, windowMs = 60_000) {
  const now = Date.now();
  const current = rateLimitBuckets.get(key)?.filter((item) => now - item < windowMs) || [];
  if (current.length >= limit) return false;
  current.push(now);
  rateLimitBuckets.set(key, current);
  return true;
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function appEnvironment() {
  return (
    process.env.VERCEL_ENV ||
    process.env.NEXT_PUBLIC_VERCEL_ENV ||
    process.env.NODE_ENV ||
    "unknown"
  ).slice(0, 40);
}

export function normalizeBoundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return { ok: false as const, code: "invalid_type" };
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (normalized.length > maxLength) return { ok: false as const, code: "too_long" };
  return { ok: true as const, value: normalized };
}

export function hasOnlyKeys(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function complaintCategoryLabel(category: string) {
  switch (category) {
    case "incorrect_or_contradictory_evidence": return "Incorrect or contradictory evidence";
    case "task_cannot_be_completed": return "Task cannot be completed";
    case "grading_problem": return "Grading problem";
    case "offensive_or_inappropriate_content": return "Offensive or inappropriate content";
    case "privacy_or_security_concern": return "Privacy or security concern";
    case "export_or_download_problem": return "Export or download problem";
    default: return "Other";
  }
}

export function ratingLabel(rating: string) {
  switch (rating) {
    case "poor": return "Poor";
    case "fair": return "Fair";
    case "good": return "Good";
    case "excellent": return "Excellent";
    default: return rating;
  }
}

export function labMetadataFromContext(context: LabFeedbackContext) {
  return {
    user_id: context.lab.user_id,
    lab_id: context.lab.id,
    generated_lab_id: context.generatedLabId,
    lab_title: String(context.lab.title || "Untitled lab").slice(0, 240),
    lab_category: String(context.lab.topic || "Unknown").slice(0, 80),
    lab_difficulty: String(context.lab.difficulty || "Unknown").slice(0, 40),
    lab_duration: String(context.lab.estimated_time || "Unknown").slice(0, 40),
    lab_created_at: context.lab.created_at,
    app_environment: context.appEnvironment,
  };
}

export async function loadOwnedLabFeedbackContext(userId: string, labId: string) {
  const { data: lab, error } = await supabaseAdmin
    .from("labs")
    .select("id, user_id, title, topic, difficulty, estimated_time, created_at")
    .eq("id", labId)
    .eq("user_id", userId)
    .single<LabFeedbackContext["lab"]>();

  if (error || !lab) {
    return { ok: false as const, status: 404, code: "LAB_FEEDBACK_LAB_NOT_FOUND" };
  }

  const { data: generatedLab } = await supabaseAdmin
    .from("generated_labs")
    .select("id")
    .eq("saved_lab_id", labId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  return {
    ok: true as const,
    value: {
      lab,
      generatedLabId: generatedLab?.id || null,
      appEnvironment: appEnvironment(),
    },
  };
}

export function learnerSafeFeedbackRow(row: any) {
  if (!row) return null;
  return {
    reference: row.public_reference,
    rating: row.rating,
    improvementNote: row.improvement_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function learnerSafeComplaintRow(row: any) {
  return {
    reference: row.public_reference,
    category: row.category,
    categoryLabel: complaintCategoryLabel(row.category),
    description: row.description,
    taskReference: row.task_reference || "",
    status: row.status,
    createdAt: row.created_at,
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeEmail(value: unknown) {
  const text = String(value || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null;
  if (/[\r\n]/.test(text)) return null;
  return text;
}

function textEmail(input: {
  reference: string;
  category: string;
  submittedAt: string;
  labId: string;
  labTitle: string;
  labCategory: string;
  labDifficulty: string;
  labDuration: string;
  taskReference?: string | null;
  description: string;
  accountEmail?: string | null;
}) {
  return [
    `Complaint reference: ${input.reference}`,
    `Category: ${complaintCategoryLabel(input.category)}`,
    `Submitted: ${input.submittedAt}`,
    `Saved lab ID: ${input.labId}`,
    `Lab: ${input.labTitle}`,
    `Lab type: ${input.labCategory} / ${input.labDifficulty} / ${input.labDuration}`,
    input.taskReference ? `Task reference: ${input.taskReference}` : null,
    input.accountEmail ? `Account email: ${input.accountEmail}` : null,
    "",
    "Learner description:",
    input.description,
  ].filter(Boolean).join("\n");
}

function htmlEmail(input: Parameters<typeof textEmail>[0]) {
  return `
    <h2>Saved lab complaint</h2>
    <p><strong>Reference:</strong> ${escapeHtml(input.reference)}</p>
    <p><strong>Category:</strong> ${escapeHtml(complaintCategoryLabel(input.category))}</p>
    <p><strong>Submitted:</strong> ${escapeHtml(input.submittedAt)}</p>
    <p><strong>Saved lab ID:</strong> ${escapeHtml(input.labId)}</p>
    <p><strong>Lab:</strong> ${escapeHtml(input.labTitle)}</p>
    <p><strong>Lab type:</strong> ${escapeHtml(input.labCategory)} / ${escapeHtml(input.labDifficulty)} / ${escapeHtml(input.labDuration)}</p>
    ${input.taskReference ? `<p><strong>Task reference:</strong> ${escapeHtml(input.taskReference)}</p>` : ""}
    ${input.accountEmail ? `<p><strong>Account email:</strong> ${escapeHtml(input.accountEmail)}</p>` : ""}
    <h3>Learner description</h3>
    <p>${escapeHtml(input.description).replace(/\n/g, "<br>")}</p>
  `.trim();
}

export async function sendComplaintNotification(input: {
  complaintId: string;
  reference: string;
  category: string;
  description: string;
  taskReference?: string | null;
  submittedAt: string;
  labId: string;
  labTitle: string;
  labCategory: string;
  labDifficulty: string;
  labDuration: string;
  accountEmail?: string | null;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = safeEmail(process.env.AMNIORA_SUPPORT_EMAIL);
  const from = safeEmail(process.env.AMNIORA_SUPPORT_FROM_EMAIL);
  const accountEmail = safeEmail(input.accountEmail);

  if (!apiKey || !to || !from) {
    return { status: "not_configured" as const, errorCode: "LAB_COMPLAINT_EMAIL_NOT_CONFIGURED" };
  }

  const payload = {
    from,
    to,
    subject: `Amniora lab complaint ${input.reference}`,
    text: textEmail({ ...input, accountEmail }),
    html: htmlEmail({ ...input, accountEmail }),
    ...(accountEmail ? { reply_to: accountEmail } : {}),
  };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { status: "failed" as const, errorCode: `RESEND_HTTP_${response.status}` };
    }
    return { status: "sent" as const, errorCode: null };
  } catch {
    return { status: "failed" as const, errorCode: "RESEND_REQUEST_FAILED" };
  }
}
