import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getPasswordRecoveryRedirectUrl } from "@/lib/auth/passwordRecovery";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    await requireAdmin();

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: "Missing email." }, { status: 400 });
    }

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordRecoveryRedirectUrl(),
    });

    if (error) {
      return NextResponse.json(
        { error: "Password reset email could not be sent." },
        { status: 429 },
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Unauthorized admin request." },
      { status: 401 }
    );
  }
}
