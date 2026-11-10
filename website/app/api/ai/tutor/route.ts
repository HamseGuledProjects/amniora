import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AI_CONFIG } from "@/lib/ai/config";
import {
  recordAIUsage,
  releaseAIUsageReservation,
  reserveAIUsage,
} from "@/lib/ai/usageService";
import { chooseAIModel } from "@/lib/ai/modelRouter";
import { checkCybersecurityScope, checkSafety } from "@/lib/ai/safetyService";
import { buildSystemPrompt } from "@/lib/ai/promptService";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateAIResponse, generateConversationTitle } from "@/lib/ai/openai";
import { OpenAITimeoutError } from "@/lib/ai/openaiFetch";
import {
  createAIConversation,
  getAIConversation,
  getConversationMessages,
  saveAIMessage,
} from "@/lib/ai/conversationService";
import {
  AiContentConsentError,
  assertTutorConversationHasAiContentConsent,
  bindAiContentConsent,
  consumeAiContentConsentToken,
} from "@/lib/ai/contentSharingConsentServer";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export async function POST(req: Request) {
  let reservationId: string | undefined;

  try {
    const supabase = await createClient();

    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) {
      return betaAccessErrorResponse(authorization);
    }
    const { user } = authorization;

    const body = await req.json();

    const message = String(body.message || "").trim();
    let conversationId = body.conversationId
      ? String(body.conversationId)
      : null;

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    if (message.length > AI_CONFIG.MAX_INPUT_CHARACTERS) {
      return NextResponse.json({ error: "Message is too long." }, { status: 400 });
    }

    const safety = checkSafety(message);

    if (!safety.allowed) {
      return NextResponse.json({ error: safety.reason }, { status: 400 });
    }

    const scope = checkCybersecurityScope(message);

    if (!scope.allowed) {
      return NextResponse.json(
        { error: scope.reason },
        { status: 400 }
      );
    }

    let pendingConsentId: string | null = null;

    if (conversationId) {
      await getAIConversation(conversationId, user.id);
      await assertTutorConversationHasAiContentConsent({
        userId: user.id,
        chatId: conversationId,
      });
    } else {
      pendingConsentId = await consumeAiContentConsentToken({
        userId: user.id,
        feature: "tutor_chat",
        token: body.aiContentConsentToken,
      });
    }

    const usage = await reserveAIUsage(user.id, "tutor_prompt");

    if (!usage.allowed || !usage.reservationId) {
      return NextResponse.json({ error: usage.reason, usage }, { status: 403 });
    }
    reservationId = usage.reservationId;

    if (!conversationId) {
      if (usage.plan === "free") {
        const { count, error: countError } = await supabaseAdmin
          .from("ai_conversations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("mode", "tutor")
          .eq("is_archived", false);

        if (countError) {
          await releaseAIUsageReservation(reservationId);
          reservationId = undefined;
          return NextResponse.json(
            { error: countError.message },
            { status: 500 }
          );
        }

        if ((count ?? 0) >= 3) {
          await releaseAIUsageReservation(reservationId);
          reservationId = undefined;
          return NextResponse.json(
            {
              error:
                "Free users can keep up to 3 AI Tutor conversations. Delete an old conversation to start a new chat.",
            },
            { status: 403 }
          );
        }
      }

const title = await generateConversationTitle(message);

const conversation = await createAIConversation({
  userId: user.id,
  title,
  mode: "tutor",
});

      conversationId = conversation.id;

      if (pendingConsentId) {
        await bindAiContentConsent({
          consentId: pendingConsentId,
          userId: user.id,
          chatId: conversation.id,
        });
      }
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: "Conversation could not be created." },
        { status: 500 }
      );
    }

    const activeConversationId = conversationId;

    const previousMessages = await getConversationMessages(
      activeConversationId,
      user.id,
      20
    );

    const userMessage = await saveAIMessage({
      conversationId: activeConversationId,
      userId: user.id,
      role: "user",
      content: message,
      safetyStatus: "allowed",
    });

    const model = chooseAIModel({
      feature: "tutor_prompt",
      plan: usage.plan,
      complexity: "normal",
    });

    const systemPrompt = buildSystemPrompt({
      feature: "tutor_prompt",
      plan: usage.plan,
    });

    const conversationText = previousMessages
      .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
      .join("\n\n");

    const input = `
Previous conversation:
${conversationText || "No previous messages."}

User message:
${message}
`.trim();

    const aiResponse = await generateAIResponse({
      model,
      systemPrompt,
      input,
    });

    const assistantText = aiResponse.text;

    const inputTokens = estimateTokens(systemPrompt + input);
    const outputTokens = estimateTokens(assistantText);
    const totalTokens = inputTokens + outputTokens;

    const assistantMessage = await saveAIMessage({
      conversationId: activeConversationId,
      userId: user.id,
      role: "assistant",
      content: assistantText,
      modelUsed: model,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCost: 0,
      safetyStatus: "allowed",
    });

    await recordAIUsage({
      reservationId,
      userId: user.id,
      feature: "tutor_prompt",
      modelUsed: model,
      inputTokens,
      outputTokens,
      estimatedCost: 0,
      conversationId: activeConversationId,
      messageId: assistantMessage.id,
    });
    reservationId = undefined;

    return NextResponse.json({
      conversationId: activeConversationId,
      userMessage,
      assistantMessage,
      message: assistantText,
      usage: {
        plan: usage.plan,
        tutorPromptsUsed: usage.tutorPromptsUsed,
        tutorLimit: usage.tutorLimit,
      },
    });
  } catch (error) {
    await releaseAIUsageReservation(reservationId);

    if (error instanceof AiContentConsentError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof OpenAITimeoutError) {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }

    return NextResponse.json(
      {
        error: "AI Tutor is temporarily unavailable. Please try again.",
      },
      { status: 500 }
    );
  }
}
