import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkAIUsage } from "@/lib/ai/usageService";
import { createAIConversation } from "@/lib/ai/conversationService";
import {
  AiContentConsentError,
  bindAiContentConsent,
  consumeAiContentConsentToken,
} from "@/lib/ai/contentSharingConsentServer";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";

export async function GET() {
  try {
    const supabase = await createClient();
    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) {
      return betaAccessErrorResponse(authorization);
    }
    const { user } = authorization;

    const { data, error } = await supabaseAdmin
      .from("ai_conversations")
      .select("id, title, mode, created_at, updated_at")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      conversations: data || [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load conversations.",
      },
      { status: 500 }
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
    const { user } = authorization;

    const body = await req.json();
    const consentId = await consumeAiContentConsentToken({
      userId: user.id,
      feature: "tutor_chat",
      token: body.aiContentConsentToken,
    });

    const usage = await checkAIUsage(user.id, "tutor_prompt");

    if (!usage.allowed) {
      return NextResponse.json({ error: usage.reason, usage }, { status: 403 });
    }

    if (usage.plan === "free") {
      const { count, error: countError } = await supabaseAdmin
        .from("ai_conversations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("mode", "tutor")
        .eq("is_archived", false);

      if (countError) {
        return NextResponse.json({ error: countError.message }, { status: 500 });
      }

      if ((count ?? 0) >= 3) {
        return NextResponse.json(
          {
            error:
              "Free users can keep up to 3 AI Tutor conversations. Delete an old conversation to start a new chat.",
          },
          { status: 403 }
        );
      }
    }

    const conversation = await createAIConversation({
      userId: user.id,
      title: "New AI Chat",
      mode: "tutor",
    });

    await bindAiContentConsent({
      consentId,
      userId: user.id,
      chatId: conversation.id,
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    if (error instanceof AiContentConsentError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create conversation.",
      },
      { status: 500 }
    );
  }
}
