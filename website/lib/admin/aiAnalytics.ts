/** Guarded server-only data access for the Admin AI analytics page. */
import "server-only";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type AdminAiUsageEvent = Readonly<{
  id: string;
  featureType: string;
  model: string;
  plan: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  createdAt: string | null;
}>;

export type AdminAiAnalytics = Readonly<{
  totalRequests: number;
  tutorRequests: number;
  labGenerations: number;
  linuxGradings: number;
  totalTokens: number;
  totalCost: number;
  events: readonly AdminAiUsageEvent[];
}>;

export type AdminAiAnalyticsResult =
  | Readonly<{ ok: true; data: AdminAiAnalytics }>
  | Readonly<{ ok: false; code: "ADMIN_AI_ANALYTICS_UNAVAILABLE" }>;

type UsageEventRow = Readonly<{
  id: unknown;
  feature_type: unknown;
  model_used: unknown;
  plan_snapshot: unknown;
  input_tokens: unknown;
  output_tokens: unknown;
  total_tokens: unknown;
  estimated_cost: unknown;
  created_at: unknown;
}>;

function text(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maxLength)
    : fallback;
}

function count(value: unknown): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function cost(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function project(row: UsageEventRow): AdminAiUsageEvent {
  return {
    id: text(row.id, "unknown", 64),
    featureType: text(row.feature_type, "unknown", 64),
    model: text(row.model_used, "Unknown", 120),
    plan: text(row.plan_snapshot, "unknown", 24),
    inputTokens: count(row.input_tokens),
    outputTokens: count(row.output_tokens),
    totalTokens: count(row.total_tokens),
    estimatedCost: cost(row.estimated_cost),
    createdAt: timestamp(row.created_at),
  };
}

/**
 * Re-authorizes the current server session before using service-role access.
 * Redirects from requireAdmin intentionally occur outside the query error path.
 */
export async function loadAdminAiAnalytics(): Promise<AdminAiAnalyticsResult> {
  await requireAdmin();

  try {
    const { data, error } = await supabaseAdmin
      .from("ai_usage_events")
      .select(
        "id, feature_type, model_used, input_tokens, output_tokens, total_tokens, estimated_cost, plan_snapshot, created_at"
      )
      .order("created_at", { ascending: false });

    if (error) return { ok: false, code: "ADMIN_AI_ANALYTICS_UNAVAILABLE" };

    const events = ((data ?? []) as readonly UsageEventRow[]).map(project);
    return {
      ok: true,
      data: {
        totalRequests: events.length,
        tutorRequests: events.filter(event => event.featureType === "tutor_prompt").length,
        labGenerations: events.filter(event => event.featureType === "lab_generation").length,
        linuxGradings: events.filter(event => event.featureType === "linux_grading").length,
        totalTokens: events.reduce((sum, event) => sum + event.totalTokens, 0),
        totalCost: events.reduce((sum, event) => sum + event.estimatedCost, 0),
        events,
      },
    };
  } catch {
    return { ok: false, code: "ADMIN_AI_ANALYTICS_UNAVAILABLE" };
  }
}
