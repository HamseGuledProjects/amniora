// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}
let assertions = 0;
function assert(name, condition, detail = "") {
  assertions += 1;
  if (!condition) {
    throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
  }
}

const migration = read("supabase/migrations/20260821010227_lab_feedback_and_complaints.sql");
const helper = read("lib/labFeedback.ts");
const feedbackRoute = read("app/api/labs/[id]/feedback/route.ts");
const complaintRoute = read("app/api/labs/[id]/complaints/route.ts");
const adminRoute = read("app/api/admin/lab-feedback/complaints/[id]/route.ts");
const labPage = read("app/dashboard/saved/[id]/page.tsx");
const card = read("app/dashboard/saved/[id]/LabFeedbackCard.tsx");
const adminPage = read("app/admin/feedback/page.tsx");
const adminNav = read("app/admin/AdminNavigation.tsx");
const expectedRatings = ["poor", "fair", "good", "excellent"];
const expectedCategories = [
  "incorrect_or_contradictory_evidence",
  "task_cannot_be_completed",
  "grading_problem",
  "offensive_or_inappropriate_content",
  "privacy_or_security_concern",
  "export_or_download_problem",
  "other",
];

assert("migration creates separate feedback table", /create table if not exists public\.lab_feedback/i.test(migration));
assert("migration creates separate complaint table", /create table if not exists public\.lab_complaints/i.test(migration));
assert("feedback has uuid primary key", /id uuid primary key default gen_random_uuid\(\)/i.test(migration));
assert("feedback references auth users", /user_id uuid not null references auth\.users\(id\) on delete cascade/i.test(migration));
assert("feedback references saved labs", /lab_id uuid not null references public\.labs\(id\) on delete cascade/i.test(migration));
assert("feedback references generated labs", /generated_lab_id uuid null references public\.generated_labs\(id\)/i.test(migration));
assert("feedback has non sequential public reference", /FBK-.*gen_random_uuid/i.test(migration));
assert("complaint has non sequential public reference", /CMP-.*gen_random_uuid/i.test(migration));
assert("feedback rating constrained", /rating in \('poor', 'fair', 'good', 'excellent'\)/i.test(migration));
assert("feedback note bounded", /char_length\(improvement_note\) <= 1500/i.test(migration));
assert("complaint categories constrained", /incorrect_or_contradictory_evidence/.test(migration) && /privacy_or_security_concern/.test(migration));
assert("complaint description bounded and required", /char_length\(description\) between 1 and 3000/i.test(migration));
assert("complaint task reference bounded", /char_length\(task_reference\) <= 100/i.test(migration));
assert("complaint status constrained", /status in \('new', 'reviewing', 'resolved', 'dismissed'\)/i.test(migration));
assert("notification status stored", /notification_status text not null default 'not_configured'/i.test(migration));
assert("feedback unique current record per user lab", /unique \(user_id, lab_id\)/i.test(migration));
assert("RLS enabled on feedback", /alter table public\.lab_feedback enable row level security/i.test(migration));
assert("RLS enabled on complaints", /alter table public\.lab_complaints enable row level security/i.test(migration));
assert("anon revoked on feedback", /revoke all on table public\.lab_feedback from public, anon, authenticated/i.test(migration));
assert("anon revoked on complaints", /revoke all on table public\.lab_complaints from public, anon, authenticated/i.test(migration));
assert("authenticated feedback grants are explicit", /grant select, insert, update on table public\.lab_feedback to authenticated/i.test(migration));
assert("authenticated complaint grants exclude update", /grant select, insert on table public\.lab_complaints to authenticated/i.test(migration));
assert("service role granted feedback", /grant all on table public\.lab_feedback to service_role/i.test(migration));
assert("service role granted complaints", /grant all on table public\.lab_complaints to service_role/i.test(migration));
assert("feedback select uses auth uid", /for select\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)/is.test(migration));
assert("feedback update uses check", /for update\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)\s+with check \(\(select auth\.uid\(\)\) = user_id\)/is.test(migration));
assert("complaint insert defaults new status", /with check[\s\S]*status = 'new'/i.test(migration));
assert("learners cannot update complaints", /Learners cannot update lab complaints[\s\S]*using \(false\)[\s\S]*with check \(false\)/i.test(migration));
assert("learners cannot delete complaints", /Learners cannot delete lab complaints[\s\S]*using \(false\)/i.test(migration));
assert("admin indexes exist", /lab_complaints_admin_status_created_idx/.test(migration) && /lab_feedback_admin_created_idx/.test(migration));

for (const route of [feedbackRoute, complaintRoute]) {
  assert("learner route authorizes beta access", route.includes("authorizeBetaAccess") && route.includes("betaAccessErrorResponse"));
  assert("learner route loads server-owned lab context", route.includes("loadOwnedLabFeedbackContext"));
  assert("learner route uses service role only server-side", route.includes("supabaseAdmin"));
  assert("learner route rejects unknown fields", route.includes("hasOnlyKeys"));
  assert("learner route applies rate limit", route.includes("feedbackRateLimitAllowed"));
  assert("learner route does not accept user id", !/hasOnlyKeys\(body, \[[^\]]*(userId|user_id)/.test(route));
}
assert("feedback route upserts one current record", feedbackRoute.includes("upsert") && feedbackRoute.includes('onConflict: "user_id,lab_id"'));
assert("feedback route validates rating", feedbackRoute.includes("LAB_FEEDBACK_RATINGS.includes"));
assert("feedback route bounds note", feedbackRoute.includes("LAB_FEEDBACK_NOTE_MAX"));
assert("complaint route rejects empty description", complaintRoute.includes("LAB_COMPLAINT_DESCRIPTION_REQUIRED"));
assert("complaint route bounds description", complaintRoute.includes("LAB_COMPLAINT_DESCRIPTION_MAX"));
assert("complaint route bounds task reference", complaintRoute.includes("LAB_COMPLAINT_TASK_REFERENCE_MAX"));
assert("complaint route persists before notification", complaintRoute.indexOf(".insert(row)") > -1 && complaintRoute.indexOf(".insert(row)") < complaintRoute.indexOf("await sendComplaintNotification"));
assert("complaint route returns reference", complaintRoute.includes("reference: data.public_reference"));
assert("complaint route does not roll back on notification failure", complaintRoute.includes("notification_status") && complaintRoute.includes("return NextResponse.json"));

assert("admin route requires admin", adminRoute.includes("authorization.isAdmin"));
assert("admin route only accepts status", adminRoute.includes('key !== "status"'));
assert("admin route validates statuses", adminRoute.includes("LAB_COMPLAINT_STATUSES.includes"));
assert("admin route updates only status", /update\(\{ status \}\)/.test(adminRoute));

assert("helper derives metadata from labs server-side", helper.includes('.from("labs")') && helper.includes("labMetadataFromContext"));
assert("helper derives generated lab identity when available", helper.includes('.from("generated_labs")') && helper.includes("saved_lab_id"));
assert("helper records app environment", helper.includes("VERCEL_ENV") && helper.includes("appEnvironment"));
assert("helper escapes html email", helper.includes("escapeHtml") && helper.includes("replace(/</g"));
assert("helper validates support emails", helper.includes("safeEmail"));
assert("helper uses server-only Resend env", helper.includes("RESEND_API_KEY") && helper.includes("AMNIORA_SUPPORT_EMAIL") && helper.includes("AMNIORA_SUPPORT_FROM_EMAIL"));
assert("helper does not import client env secret", !helper.includes("NEXT_PUBLIC_RESEND"));
assert("email body allowlist omits hidden engine data", !/prompt|model response|assessment contract|answer key|evidence contents/i.test(helper));
assert("helper sends plain text and html", helper.includes("textEmail") && helper.includes("htmlEmail"));
assert("notification not configured is explicit", helper.includes("LAB_COMPLAINT_EMAIL_NOT_CONFIGURED"));

assert("saved lab page mounts feedback card", labPage.includes("<LabFeedbackCard labId={String(id)} />"));
assert("feedback card heading present", card.includes("Help us improve this investigation"));
assert("feedback card has required ratings", expectedRatings.every((value) => card.includes(value)));
assert("feedback card has report problem action", card.includes("Report a problem"));
assert("feedback card includes complaint categories", expectedCategories.every((value) => card.includes(value)));
assert("feedback card has privacy notice", card.includes("does not attach prompts") && card.includes("hidden answers") && card.includes("evidence contents"));
assert("feedback card has character counters", card.includes("characters remaining"));
assert("feedback card does not fake success before fetch", card.includes("if (!res.ok)") && card.includes("setComplaintState(\"success\")"));
assert("feedback card uses dark investigation workspace styling", card.includes('data-saved-investigation-feedback="dark"') && card.includes("bg-[#071426]") && card.includes("bg-[#081827]") && card.includes("Button"));
assert("feedback card avoids raw secret terms beyond privacy notice", !/OPENAI_" + "API_KEY|SUPABASE_SERVICE_ROLE_KEY|Authorization: Bearer/.test(card));

assert("admin feedback page exists", adminPage.includes("Feedback and complaints"));
assert("admin feedback page uses requireAdmin", adminPage.includes("requireAdmin"));
assert("admin feedback page hides hidden engine internals", adminPage.includes("without exposing prompts, hidden contracts, answer keys, or evidence contents"));
assert("admin page filters status", adminPage.includes('status !== "all"') && adminPage.includes('reviewing'));
assert("admin page filters category", adminPage.includes('category !== "all"') && adminPage.includes('privacy_or_security_concern'));
assert("admin page filters difficulty", adminPage.includes('difficulty !== "all"') && adminPage.includes('Intermediate'));
assert("admin nav includes feedback", adminNav.includes('/admin/feedback') && adminNav.includes("Feedback"));

const allChanged = [migration, helper, feedbackRoute, complaintRoute, adminRoute, labPage, card, adminPage, adminNav].join("\n");
assert("no service role key literal exposed", !/SUPABASE_SERVICE_ROLE_KEY\s*=/.test(allChanged));
assert("no raw prompts persisted", !/raw prompts?|raw model" + " responses?/i.test(allChanged.replace(/does not attach raw prompts|raw model" + " responses/g, "")));
assert("no environment values printed", !/console\.log\([^)]*process\.env/.test(allChanged));
assert("no evidence contents included in email helper", !/content:\s*asset|evidenceContent|full evidence/i.test(allChanged));

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
