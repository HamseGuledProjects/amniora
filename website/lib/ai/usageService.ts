import { supabaseAdmin } from "@/lib/supabase/admin";
import { AI_CONFIG, UserPlan } from "./config";

export type AIFeature = "tutor_prompt" | "lab_generation" | "linux_grading";

type UsageCheckResult = {
  allowed: boolean;
  plan: UserPlan;
  reason?: string;
  tutorPromptsUsed: number;
  labGenerationsUsed: number;
  linuxGradingsUsed: number;
  tutorLimit: number;
  labLimit: number;
  gradingLimit: number;
};

type RecordUsageArgs = {
  reservationId: string;
  userId: string;
  feature: AIFeature;
  modelUsed: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  conversationId?: string;
  messageId?: string;
  generatedLabId?: string;
};

export type UsageReservationResult = UsageCheckResult & {
  reservationId?: string;
};

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);

  const monday = new Date(now);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);

  return monday.toISOString().split("T")[0];
}

export async function getUserPlan(userId: string): Promise<UserPlan> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();

  return data?.plan === "pro" ? "pro" : "free";
}

export async function checkAIUsage(
  userId: string,
  feature: AIFeature
): Promise<UsageCheckResult> {
  const plan = await getUserPlan(userId);
  const weekStart = getWeekStart();

  const { data: usage } = await supabaseAdmin
    .from("ai_usage")
    .select("tutor_prompts_used, lab_generations_used, linux_gradings_used")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();

  const tutorPromptsUsed = usage?.tutor_prompts_used ?? 0;
  const labGenerationsUsed = usage?.lab_generations_used ?? 0;
  const linuxGradingsUsed = usage?.linux_gradings_used ?? 0;

  const tutorLimit =
    plan === "pro"
      ? AI_CONFIG.PRO.WEEKLY_TUTOR_PROMPTS
      : AI_CONFIG.FREE.WEEKLY_TUTOR_PROMPTS;

  const labLimit =
    plan === "pro"
      ? AI_CONFIG.PRO.WEEKLY_LAB_GENERATIONS
      : AI_CONFIG.FREE.WEEKLY_LAB_GENERATIONS;

  const gradingLimit =
    plan === "pro"
      ? AI_CONFIG.PRO.WEEKLY_LINUX_GRADINGS
      : AI_CONFIG.FREE.WEEKLY_LINUX_GRADINGS;

  if (feature === "tutor_prompt" && tutorPromptsUsed >= tutorLimit) {
    return {
      allowed: false,
      plan,
      reason: "Weekly AI Tutor limit reached.",
      tutorPromptsUsed,
      labGenerationsUsed,
      linuxGradingsUsed,
      tutorLimit,
      labLimit,
      gradingLimit,
    };
  }

  if (feature === "lab_generation" && labGenerationsUsed >= labLimit) {
    return {
      allowed: false,
      plan,
      reason: "Weekly AI Lab generation limit reached.",
      tutorPromptsUsed,
      labGenerationsUsed,
      linuxGradingsUsed,
      tutorLimit,
      labLimit,
      gradingLimit,
    };
  }

  if (feature === "linux_grading" && linuxGradingsUsed >= gradingLimit) {
    return {
      allowed: false,
      plan,
      reason: "Weekly Linux grading limit reached.",
      tutorPromptsUsed,
      labGenerationsUsed,
      linuxGradingsUsed,
      tutorLimit,
      labLimit,
      gradingLimit,
    };
  }

  return {
    allowed: true,
    plan,
    tutorPromptsUsed,
    labGenerationsUsed,
    linuxGradingsUsed,
    tutorLimit,
    labLimit,
    gradingLimit,
  };
}

export async function reserveAIUsage(
  userId: string,
  feature: AIFeature
): Promise<UsageReservationResult> {
  const plan = await getUserPlan(userId);
  const tutorLimit =
    plan === "pro"
      ? AI_CONFIG.PRO.WEEKLY_TUTOR_PROMPTS
      : AI_CONFIG.FREE.WEEKLY_TUTOR_PROMPTS;
  const labLimit =
    plan === "pro"
      ? AI_CONFIG.PRO.WEEKLY_LAB_GENERATIONS
      : AI_CONFIG.FREE.WEEKLY_LAB_GENERATIONS;
  const gradingLimit =
    plan === "pro"
      ? AI_CONFIG.PRO.WEEKLY_LINUX_GRADINGS
      : AI_CONFIG.FREE.WEEKLY_LINUX_GRADINGS;
  const limit =
    feature === "tutor_prompt"
      ? tutorLimit
      : feature === "lab_generation"
        ? labLimit
        : gradingLimit;
  const reservationId = crypto.randomUUID();

  const { data, error } = await supabaseAdmin.rpc("reserve_ai_usage", {
    p_reservation_id: reservationId,
    p_user_id: userId,
    p_feature: feature,
    p_limit: limit,
    p_plan_snapshot: plan,
  });

  if (error) {
    console.error("AI usage reservation RPC failed.", {
      stage: "reserve",
      code: "AI_USAGE_RESERVATION_FAILED",
    });
    throw new Error("AI usage could not be reserved.");
  }

  const result = data as {
    allowed?: boolean;
    reservationId?: string;
    tutorPromptsUsed?: number;
    labGenerationsUsed?: number;
    linuxGradingsUsed?: number;
  } | null;
  const allowed = result?.allowed === true;

  return {
    allowed,
    plan,
    reason: allowed
      ? undefined
      : feature === "tutor_prompt"
        ? "Weekly AI Tutor limit reached."
        : feature === "lab_generation"
          ? "Weekly AI Lab generation limit reached."
          : "Weekly Linux grading limit reached.",
    reservationId: allowed
      ? result?.reservationId || reservationId
      : undefined,
    tutorPromptsUsed: result?.tutorPromptsUsed ?? 0,
    labGenerationsUsed: result?.labGenerationsUsed ?? 0,
    linuxGradingsUsed: result?.linuxGradingsUsed ?? 0,
    tutorLimit,
    labLimit,
    gradingLimit,
  };
}

export async function releaseAIUsageReservation(reservationId?: string) {
  if (!reservationId) return;

  const { error } = await supabaseAdmin.rpc("release_ai_usage_reservation", {
    p_reservation_id: reservationId,
  });

  if (error) {
    console.error("Failed to release AI usage reservation.");
  }
}

export async function recordAIUsage({
  reservationId,
  userId,
  feature,
  modelUsed,
  inputTokens = 0,
  outputTokens = 0,
  estimatedCost = 0,
  conversationId,
  messageId,
  generatedLabId,
}: RecordUsageArgs) {
  const plan = await getUserPlan(userId);
  const totalTokens = inputTokens + outputTokens;

  const { data: finalized, error: finalizeError } = await supabaseAdmin.rpc(
    "finalize_ai_usage_reservation",
    {
      p_reservation_id: reservationId,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_estimated_cost: estimatedCost,
    }
  );

  if (finalizeError || finalized !== true) {
    throw new Error("AI usage reservation could not be finalized.");
  }

  const { error: eventError } = await supabaseAdmin
    .from("ai_usage_events")
    .insert({
      user_id: userId,
      conversation_id: conversationId || null,
      message_id: messageId || null,
      generated_lab_id: generatedLabId || null,
      feature_type: feature,
      model_used: modelUsed,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      estimated_cost: estimatedCost,
      plan_snapshot: plan,
    });

  if (eventError) {
    console.error("AI usage event persistence failed.", {
      stage: "record_event",
      code: "AI_USAGE_EVENT_WRITE_FAILED",
    });
    throw new Error("AI usage event could not be recorded.");
  }
}
