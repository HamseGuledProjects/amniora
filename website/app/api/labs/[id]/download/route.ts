import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildEvidenceZip,
  buildLabPdf,
  type SavedLabExportAsset,
  type SavedLabExportRecord,
} from "@/lib/lab-export";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function safeFileName(value: string, fallback = "amniora-export") {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback
  );
}

export async function GET(req: Request, { params }: RouteContext) {
  const supabase = await createClient();

  const authorization = await authorizeBetaAccess(supabase);
  if (!authorization.allowed) {
    return betaAccessErrorResponse(authorization);
  }
  const { user } = authorization;

  const { id } = await params;
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") || "zip").toLowerCase();

  const { data: lab, error: labError } = await supabaseAdmin
    .from("labs")
    .select("id, title, topic, difficulty, estimated_time, objective, scenario, tasks, hints, outcomes")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (labError || !lab) {
    return NextResponse.json({ error: "Lab not found." }, { status: 404 });
  }

  const { data: assets, error: assetError } = await supabaseAdmin
    .from("lab_assets")
    .select("file_path, file_name, content")
    .eq("lab_id", id)
    .eq("user_id", user.id)
    .order("file_path", { ascending: true });

  if (assetError) {
    return NextResponse.json({ error: assetError.message }, { status: 500 });
  }

  if (!assets?.length) {
    return NextResponse.json(
      { error: "No assets found for this lab." },
      { status: 404 }
    );
  }

  const labRecord = lab as SavedLabExportRecord;
  const exportAssets = assets as SavedLabExportAsset[];
  const baseName = safeFileName(lab.title || "amniora-investigation", "amniora-investigation");

  if (format === "pdf") {
    const pdf = buildLabPdf(labRecord, exportAssets);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}-investigation.pdf"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (format !== "zip") {
    return NextResponse.json({ error: "Unsupported export format." }, { status: 400 });
  }

  const { zip } = buildEvidenceZip(labRecord, exportAssets);

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${baseName}-evidence.zip"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "private, no-store",
    },
  });
}
