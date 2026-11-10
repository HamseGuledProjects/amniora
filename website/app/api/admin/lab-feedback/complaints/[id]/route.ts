import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { authorizeBetaAccess, betaAccessErrorResponse } from "@/lib/auth/betaAccessAuthorization";
import { LAB_COMPLAINT_STATUSES } from "@/lib/labFeedback";

type RouteContext = { params: Promise<{ id: string }> };

function json(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status });
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const supabase = await createClient();
  const authorization = await authorizeBetaAccess(supabase);
  if (!authorization.allowed) return betaAccessErrorResponse(authorization);
  if (!authorization.isAdmin) return json(403, "Admin access is required.", "LAB_COMPLAINT_ADMIN_REQUIRED");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, "Invalid request body.", "LAB_COMPLAINT_STATUS_INVALID_JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "status")) {
    return json(400, "Invalid status update.", "LAB_COMPLAINT_STATUS_UNKNOWN_FIELD");
  }
  const status = (body as { status?: unknown }).status;
  if (typeof status !== "string" || !LAB_COMPLAINT_STATUSES.includes(status as any)) {
    return json(400, "Invalid complaint status.", "LAB_COMPLAINT_STATUS_INVALID");
  }

  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("lab_complaints")
    .update({ status })
    .eq("id", id)
    .select("id, public_reference, status")
    .single();

  if (error || !data) return json(404, "Complaint not found.", "LAB_COMPLAINT_NOT_FOUND");
  return NextResponse.json({ complaint: { id: data.id, reference: data.public_reference, status: data.status } });
}
