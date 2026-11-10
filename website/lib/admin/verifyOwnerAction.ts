import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";

type VerifyOwnerActionArgs = {
  userId: string;
  targetEmail: string;
  typedEmail: string;
  adminSecret: string;
};

export async function verifyOwnerAction({
  userId,
  targetEmail,
  typedEmail,
  adminSecret,
}: VerifyOwnerActionArgs) {
  const { profile } = await requireAdmin();

  const ownerEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const target = targetEmail.trim().toLowerCase();
  const typed = typedEmail.trim().toLowerCase();

  if (profile.email?.toLowerCase() !== ownerEmail) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only the owner admin can perform this action." },
        { status: 403 }
      ),
    };
  }

  if (!userId || !target || !typed || !adminSecret) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing required confirmation fields." },
        { status: 400 }
      ),
    };
  }

  if (typed !== target) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Typed email does not match target user email." },
        { status: 400 }
      ),
    };
  }

  if (adminSecret !== process.env.ADMIN_ACTION_SECRET) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid admin action secret." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, profile };
}