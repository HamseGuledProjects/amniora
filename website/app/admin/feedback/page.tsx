import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { complaintCategoryLabel, ratingLabel } from "@/lib/labFeedback";
import AdminNavigation from "../AdminNavigation";
import ComplaintStatusSelect from "./ComplaintStatusSelect";

function param(searchParams: Record<string, string | string[] | undefined>, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-GB") : "Unknown";
}

export default async function AdminFeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const params = await searchParams;
  const type = param(params, "type") || "all";
  const status = param(params, "status") || "all";
  const category = param(params, "category") || "all";
  const difficulty = param(params, "difficulty") || "all";

  let complaintsQuery = supabaseAdmin
    .from("lab_complaints")
    .select("id, public_reference, category, status, description, task_reference, user_id, lab_id, lab_title, lab_category, lab_difficulty, lab_duration, notification_status, notification_error_code, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status !== "all") complaintsQuery = complaintsQuery.eq("status", status);
  if (category !== "all") complaintsQuery = complaintsQuery.eq("category", category);
  if (difficulty !== "all") complaintsQuery = complaintsQuery.eq("lab_difficulty", difficulty);

  let feedbackQuery = supabaseAdmin
    .from("lab_feedback")
    .select("id, public_reference, rating, improvement_note, user_id, lab_id, lab_title, lab_category, lab_difficulty, lab_duration, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (difficulty !== "all") feedbackQuery = feedbackQuery.eq("lab_difficulty", difficulty);

  const [complaintsResult, feedbackResult, profilesResult] = await Promise.all([
    complaintsQuery,
    feedbackQuery,
    supabaseAdmin.from("profiles").select("id, email").limit(1000),
  ]);

  const profiles = new Map((profilesResult.data || []).map((item: any) => [item.id, item.email]));
  const complaints = complaintsResult.data || [];
  const feedback = feedbackResult.data || [];
  const showComplaints = type === "all" || type === "complaints";
  const showFeedback = type === "all" || type === "feedback";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <AdminNavigation />
        <div className="mb-6 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-6">
          <p className="text-sm font-medium text-cyan-300">Admin / Lab feedback</p>
          <h1 className="mt-2 text-3xl font-bold">Feedback and complaints</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Review saved-lab ratings and learner-submitted problem reports without exposing prompts, hidden contracts, answer keys, or evidence contents.
          </p>
        </div>

        <form className="mb-6 grid gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-4 md:grid-cols-5">
          {["type", "status", "category", "difficulty"].map((name) => (
            <label key={name} className="text-sm text-slate-300">
              <span className="mb-1 block capitalize">{name}</span>
              <select name={name} defaultValue={{ type, status, category, difficulty }[name as "type"] || "all"} className="min-h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white">
                {name === "type" && <><option value="all">All</option><option value="feedback">Feedback</option><option value="complaints">Complaints</option></>}
                {name === "status" && <><option value="all">All</option><option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></>}
                {name === "category" && <><option value="all">All</option><option value="incorrect_or_contradictory_evidence">Incorrect evidence</option><option value="task_cannot_be_completed">Task cannot be completed</option><option value="grading_problem">Grading problem</option><option value="offensive_or_inappropriate_content">Offensive content</option><option value="privacy_or_security_concern">Privacy/security</option><option value="export_or_download_problem">Export/download</option><option value="other">Other</option></>}
                {name === "difficulty" && <><option value="all">All</option><option value="Beginner">Beginner</option><option value="Intermediate">Intermediate</option><option value="Advanced">Advanced</option></>}
              </select>
            </label>
          ))}
          <button type="submit" className="mt-6 min-h-10 rounded-lg bg-cyan-400 px-4 text-sm font-semibold text-slate-950">Apply filters</button>
        </form>

        {showComplaints && <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Complaints</h2>
          <div className="space-y-3">
            {complaints.map((item: any) => (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-cyan-300">{item.public_reference} · {complaintCategoryLabel(item.category)}</p>
                    <h3 className="mt-1 break-words text-lg font-semibold text-white">{item.lab_title}</h3>
                    <p className="mt-1 text-sm text-slate-400">{item.lab_category} / {item.lab_difficulty} / {item.lab_duration} · {formatDate(item.created_at)}</p>
                    <p className="mt-1 text-sm text-slate-400">User: {profiles.get(item.user_id) || item.user_id} · Lab: <Link className="text-cyan-300 underline" href={`/dashboard/saved/${item.lab_id}`}>{item.lab_id}</Link></p>
                    {item.task_reference && <p className="mt-1 text-sm text-slate-400">Task reference: {item.task_reference}</p>}
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{item.description}</p>
                    <p className="mt-3 text-xs text-slate-500">Notification: {item.notification_status}{item.notification_error_code ? ` (${item.notification_error_code})` : ""}</p>
                  </div>
                  <ComplaintStatusSelect complaintId={item.id} initialStatus={item.status} />
                </div>
              </article>
            ))}
            {complaints.length === 0 && <p className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-slate-400">No complaints match these filters.</p>}
          </div>
        </section>}

        {showFeedback && <section>
          <h2 className="mb-3 text-xl font-semibold">Rating feedback</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {feedback.map((item: any) => (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                <p className="text-sm font-semibold text-cyan-300">{item.public_reference} · {ratingLabel(item.rating)}</p>
                <h3 className="mt-1 break-words text-lg font-semibold text-white">{item.lab_title}</h3>
                <p className="mt-1 text-sm text-slate-400">{item.lab_category} / {item.lab_difficulty} / {item.lab_duration} · {formatDate(item.updated_at)}</p>
                <p className="mt-1 text-sm text-slate-400">User: {profiles.get(item.user_id) || item.user_id} · Lab: <Link className="text-cyan-300 underline" href={`/dashboard/saved/${item.lab_id}`}>{item.lab_id}</Link></p>
                {item.improvement_note && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{item.improvement_note}</p>}
              </article>
            ))}
            {feedback.length === 0 && <p className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-slate-400">No rating feedback matches these filters.</p>}
          </div>
        </section>}
      </div>
    </main>
  );
}
