import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyOwnerAction } from "@/lib/admin/verifyOwnerAction";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const userId = String(body.userId || "");
    const targetEmail = String(body.targetEmail || "");
    const typedEmail = String(body.typedEmail || "");
    const adminSecret = String(body.adminSecret || "");
    const role = String(body.role || "");

    if (!["user", "admin"].includes(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const verified = await verifyOwnerAction({
      userId,
      targetEmail,
      typedEmail,
      adminSecret,
    });

    if (!verified.ok) return verified.response;

    if (
      role === "user" &&
      targetEmail.toLowerCase() === process.env.ADMIN_EMAIL?.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "The owner admin account cannot be demoted." },
        { status: 403 }
      );
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ role })
      .eq("id", userId);

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