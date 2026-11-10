import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const { profile } = await requireAdmin();

    if (profile.email !== process.env.ADMIN_EMAIL) {
      return NextResponse.json(
        { error: "Only the owner admin can delete users." },
        { status: 403 }
      );
    }

    const body = await req.json();

    const userId = String(body.userId || "");
    const targetEmail = String(body.targetEmail || "").trim().toLowerCase();
    const typedEmail = String(body.typedEmail || "").trim().toLowerCase();
    const adminSecret = String(body.adminSecret || "");

    if (!userId || !targetEmail || !typedEmail || !adminSecret) {
      return NextResponse.json(
        { error: "Missing required confirmation fields." },
        { status: 400 }
      );
    }

    if (targetEmail === process.env.ADMIN_EMAIL?.toLowerCase()) {
      return NextResponse.json(
        { error: "The owner admin account cannot be deleted." },
        { status: 403 }
      );
    }

    if (userId === profile.id) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 403 }
      );
    }

    if (typedEmail !== targetEmail) {
      return NextResponse.json(
        { error: "Typed email does not match the target user email." },
        { status: 400 }
      );
    }

    if (adminSecret !== process.env.ADMIN_ACTION_SECRET) {
      return NextResponse.json(
        { error: "Invalid admin action secret." },
        { status: 403 }
      );
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Unauthorized admin request." },
      { status: 401 }
    );
  }
}