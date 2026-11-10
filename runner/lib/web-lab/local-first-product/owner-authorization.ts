import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AuthenticatedWebLabActor } from "../production-control-service";

export type OwnerAuthorization =
  | Readonly<{ authenticated: false; owner: false; actor: null }>
  | Readonly<{ authenticated: true; owner: false; actor: null }>
  | Readonly<{ authenticated: true; owner: true; actor: AuthenticatedWebLabActor }>;

/** Database-backed owner entitlement. Session metadata and client role claims are deliberately ignored. */
export async function authorizeLocalFirstOwner(): Promise<OwnerAuthorization> {
  try {
    const supabase = await createClient();
    const [userResult, claimsResult] = await Promise.all([supabase.auth.getUser(), supabase.auth.getClaims()]);
    const user = userResult.data.user;
    const claims = claimsResult.data?.claims;
    if (userResult.error || claimsResult.error || !user || !claims || claims.sub !== user.id ||
        typeof claims.session_id !== "string" || !claims.session_id) {
      return { authenticated: false, owner: false, actor: null };
    }
    const profile = await supabase.from("profiles").select("local_first_owner_enabled").eq("id", user.id).maybeSingle();
    if (profile.error || profile.data?.local_first_owner_enabled !== true) {
      return { authenticated: true, owner: false, actor: null };
    }
    return { authenticated: true, owner: true, actor: { userId: user.id, sessionId: claims.session_id } };
  } catch { return { authenticated: false, owner: false, actor: null }; }
}
