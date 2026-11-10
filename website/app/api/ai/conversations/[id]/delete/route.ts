import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_req: Request, { params }: RouteContext) {
  const supabase = await createClient();

  const authorization = await authorizeBetaAccess(supabase);
  if (!authorization.allowed) {
    return betaAccessErrorResponse(authorization);
  }
  const { user } = authorization;

  const { id } = await params;

  const { error } = await supabaseAdmin
    .from("ai_conversations")
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
