import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";
import {
  AiContentConsentError,
  bindAiContentConsent,
  consumeAiContentConsentToken,
} from "@/lib/ai/contentSharingConsentServer";

function firstString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) return betaAccessErrorResponse(authorization);
    const { user } = authorization;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const labId = firstString(record.labId);
    const token = record.aiContentConsentToken;
    if (!labId) return NextResponse.json({ error: "Lab ID is required." }, { status: 400 });

    const { data: lab, error: labError } = await supabaseAdmin
      .from("labs")
      .select("id, user_id, topic")
      .eq("id", labId)
      .eq("user_id", user.id)
      .single<{ id: string; user_id: string; topic?: string | null }>();
    if (labError || !lab) return NextResponse.json({ error: "Lab not found." }, { status: 404 });
    if (lab.topic !== "Linux") return NextResponse.json({ error: "Linux grading consent is only available for Linux labs." }, { status: 400 });

    const { data: provenanceRows, error: provenanceError } = await supabaseAdmin
      .from("linux_generation_provenance")
      .select("generated_lab_id")
      .eq("lab_id", labId)
      .eq("user_id", user.id)
      .limit(1);
    if (provenanceError) return NextResponse.json({ error: "Linux grading consent could not be verified." }, { status: 503 });
    const generatedLabId = Array.isArray(provenanceRows) ? provenanceRows[0]?.generated_lab_id : undefined;
    if (!generatedLabId) {
      return NextResponse.json(
        { error: "Linux grading consent cannot be attached to this historical lab." },
        { status: 409 }
      );
    }

    const consentId = await consumeAiContentConsentToken({
      userId: user.id,
      feature: "linux_grading",
      token,
    });
    await bindAiContentConsent({
      consentId,
      userId: user.id,
      labRequestId: generatedLabId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AiContentConsentError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Linux grading consent is temporarily unavailable." },
      { status: 500 }
    );
  }
}
