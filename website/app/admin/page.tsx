import { requireAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Link from "next/link";
import AdminNavigation from "./AdminNavigation";

export default async function AdminPage() {
  const { profile } = await requireAdmin();

const [
  usersResult,
  conversationsResult,
  messagesResult,
  labsResult,
  usageEventsResult,
  safetyLogsResult,
  subscriptionsResult,
  feedbackResult,
] = await Promise.all([
  supabaseAdmin
    .from("profiles")
    .select("id", { count: "exact", head: true }),

  supabaseAdmin
    .from("ai_conversations")
    .select("id", { count: "exact", head: true }),

  supabaseAdmin
    .from("ai_messages")
    .select("id", { count: "exact", head: true }),

  supabaseAdmin
    .from("generated_labs")
    .select("id", { count: "exact", head: true }),

  supabaseAdmin
    .from("ai_usage_events")
    .select("estimated_cost,total_tokens"),

  supabaseAdmin
    .from("ai_safety_logs")
    .select("id", { count: "exact", head: true }),

  supabaseAdmin
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("plan", "pro"),

  supabaseAdmin
    .from("ai_feedback")
    .select("id", { count: "exact", head: true }),
]);

  const totalTokens =
    usageEventsResult.data?.reduce((sum, event) => sum + (event.total_tokens || 0), 0) ?? 0;

  const totalCost =
    usageEventsResult.data?.reduce((sum, event) => sum + Number(event.estimated_cost || 0), 0) ?? 0;

  const stats = [
    { label: "Total Users", value: usersResult.count ?? 0 },
    { label: "Pro Users", value: subscriptionsResult.count ?? 0 },
    { label: "AI Conversations", value: conversationsResult.count ?? 0 },
    { label: "AI Messages", value: messagesResult.count ?? 0 },
    { label: "Generated Labs", value: labsResult.count ?? 0 },
    { label: "Total Tokens", value: totalTokens.toLocaleString() },
    { label: "Estimated AI Cost", value: `£${totalCost.toFixed(4)}` },
    { label: "Safety Logs", value: safetyLogsResult.count ?? 0 },
    { label: "AI Feedback", value: feedbackResult.count ?? 0 },
  ];

  const adminLinks = [
    { href: "/admin/users", title: "Users", desc: "View users, roles, plans and activity." },
    { href: "/admin/beta", title: "Private Beta", desc: "Manage availability, invitation codes and redemptions." },
    { href: "/admin/ai", title: "AI Analytics", desc: "Track usage, tokens, models and costs." },
    { href: "/admin/labs", title: "Labs", desc: "Review generated and saved labs." },
    { href: "/admin/safety", title: "Safety", desc: "View AI safety logs and flagged activity." },
    { href: "/admin/support", title: "Support", desc: "Manage contact messages and tickets." },
    { href: "/admin/billing", title: "Billing", desc: "Monitor subscriptions and revenue." },
  ];

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <AdminNavigation backHref="/dashboard" />
        <div className="mb-8 rounded-3xl border border-cyan-400/20 bg-slate-900/70 p-6 shadow-2xl shadow-cyan-500/10">
          <p className="text-sm font-medium text-cyan-300">Amniora Admin</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Platform Control Centre
          </h1>
          <p className="mt-3 text-slate-400">
            Signed in as {profile.email}. Monitor users, AI usage, costs, labs, safety and billing.
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-lg"
            >
              <p className="text-sm text-slate-400">{stat.label}</p>
              <p className="mt-2 text-3xl font-bold text-white">{stat.value}</p>
            </div>
          ))}
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {adminLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-2xl border border-white/10 bg-slate-900/70 p-5 transition hover:border-cyan-400/50 hover:bg-slate-900"
            >
              <h2 className="text-xl font-semibold text-white group-hover:text-cyan-300">
                {item.title}
              </h2>
              <p className="mt-2 text-sm text-slate-400">{item.desc}</p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
