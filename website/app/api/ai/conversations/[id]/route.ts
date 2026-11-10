import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  _req: Request,
  { params }: RouteContext
) {
  try {
    const supabase = await createClient();

    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) {
      return betaAccessErrorResponse(authorization);
    }
    const { user } = authorization;

    const { id } = await params;

    const { data: conversation, error: conversationError } =
      await supabaseAdmin
        .from("ai_conversations")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

    if (conversationError || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404 }
      );
    }

    const { data: messages, error: messagesError } =
      await supabaseAdmin
        .from("ai_messages")
        .select("*")
        .eq("conversation_id", id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

    if (messagesError) {
      return NextResponse.json(
        { error: messagesError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      conversation,
      messages: messages || [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load conversation.",
      },
      { status: 500 }
    );
  }
}
