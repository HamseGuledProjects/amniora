import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";

export async function DELETE() {
  const supabase = await createClient();

  const authorization = await authorizeBetaAccess(supabase);
  if (!authorization.allowed) {
    return betaAccessErrorResponse(authorization);
  }
  const { user } = authorization;

  const { error } = await supabaseAdmin
    .from("ai_conversations")
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("is_archived", false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
