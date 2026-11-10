"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";

export type BetaActionState = {
  ok: boolean;
  code?: string;
  error?: string;
};

const EMPTY_STATE: BetaActionState = { ok: false };

export async function createCodeAction(
  _previousState: BetaActionState = EMPTY_STATE,
  formData: FormData,
): Promise<BetaActionState> {
  void _previousState;
  const label = String(formData.get("label") || "").trim();
  const limitValue = String(formData.get("maxRedemptions") || "").trim();
  const expirationValue = String(formData.get("expiresAt") || "").trim();
  const maxRedemptions = limitValue ? Number(limitValue) : null;
  const expiration = expirationValue ? new Date(expirationValue) : null;
  const expiresAt =
    expiration && Number.isFinite(expiration.getTime())
      ? expiration.toISOString()
      : null;

  if (
    !label ||
    label.length > 80 ||
    (expirationValue && !expiresAt) ||
    (maxRedemptions !== null &&
      (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0))
  ) {
    return { ok: false, error: "Enter a valid label and redemption limit." };
  }

  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc(
    "admin_create_beta_invitation_code",
    {
      p_label: label,
      p_max_redemptions: maxRedemptions,
      p_expires_at: expiresAt,
    },
  );

  if (error || !data || typeof data.code !== "string") {
    return { ok: false, error: "The invitation code could not be created." };
  }

  revalidatePath("/admin/beta");
  return { ok: true, code: data.code };
}

export async function setGlobalBetaAction(formData: FormData) {
  const enabled = formData.get("enabled") === "true";
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_set_private_beta_enabled", {
    p_enabled: enabled,
  });
  if (error) throw new Error("The private beta setting could not be updated.");
  revalidatePath("/admin/beta");
}

export async function setCodeEnabledAction(formData: FormData) {
  const codeId = String(formData.get("codeId") || "");
  const enabled = formData.get("enabled") === "true";
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_set_beta_code_enabled", {
    p_code_id: codeId,
    p_enabled: enabled,
  });
  if (error) throw new Error("The invitation status could not be updated.");
  revalidatePath("/admin/beta");
}

export async function deleteCodeAction(formData: FormData) {
  const codeId = String(formData.get("codeId") || "");
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_delete_beta_code", {
    p_code_id: codeId,
  });
  if (error) throw new Error("The invitation code could not be deleted.");
  revalidatePath("/admin/beta");
}

export async function regenerateCodeAction(
  _previousState: BetaActionState,
  formData: FormData,
): Promise<BetaActionState> {
  void _previousState;
  const codeId = String(formData.get("codeId") || "");
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_regenerate_beta_code", {
    p_code_id: codeId,
  });
  if (error || !data || typeof data.code !== "string") {
    return { ok: false, error: "The invitation code could not be regenerated." };
  }
  revalidatePath("/admin/beta");
  return { ok: true, code: data.code };
}

export async function revokeAllAccessAction() {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_revoke_all_beta_access");
  if (error) throw new Error("Beta access could not be revoked.");
  revalidatePath("/admin/beta");
}
