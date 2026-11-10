import { supabaseAdmin } from "@/lib/supabase/admin";

type CreateConversationArgs = {
  userId: string;
  title?: string;
  mode?: string;
};

type SaveMessageArgs = {
  conversationId: string;
  userId: string;
  role: "user" | "assistant" | "system";
  content: string;
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  safetyStatus?: "allowed" | "limited" | "blocked" | "flagged";
};

export async function createAIConversation({
  userId,
  title = "New AI Chat",
  mode = "tutor",
}: CreateConversationArgs) {
  const { data, error } = await supabaseAdmin
    .from("ai_conversations")
    .insert({
      user_id: userId,
      title,
      mode,
    })
    .select("id, title, mode, created_at")
    .single();

  if (error) throw new Error(error.message);

  return data;
}

export async function getAIConversation(conversationId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("ai_conversations")
    .select("id, user_id, title, mode, is_archived, created_at, updated_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single();

  if (error) throw new Error(error.message);

  return data;
}

export async function saveAIMessage({
  conversationId,
  userId,
  role,
  content,
  modelUsed,
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = inputTokens + outputTokens,
  estimatedCost = 0,
  safetyStatus = "allowed",
}: SaveMessageArgs) {
  const { data, error } = await supabaseAdmin
    .from("ai_messages")
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role,
      content,
      model_used: modelUsed || null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      estimated_cost: estimatedCost,
      safety_status: safetyStatus,
    })
    .select("id, role, content, created_at")
    .single();

  if (error) throw new Error(error.message);

  return data;
}

export async function getConversationMessages(
  conversationId: string,
  userId: string,
  limit = 30
) {
  const { data, error } = await supabaseAdmin
    .from("ai_messages")
    .select("id, role, content, model_used, created_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);

  return data || [];
}

export async function updateConversationTitle(
  conversationId: string,
  userId: string,
  title: string
) {
  const { error } = await supabaseAdmin
    .from("ai_conversations")
    .update({ title })
    .eq("id", conversationId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}