import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AuthenticatedWebLabActor } from "./production-control-service";

/** Future route adapter: identity comes from the existing server cookie client. */
export async function resolveSupabaseWebLabActor(): Promise<AuthenticatedWebLabActor | null> {
  try {
    const supabase = await createClient();
    const [userResult, claimsResult] = await Promise.all([
      supabase.auth.getUser(), supabase.auth.getClaims(),
    ]);
    const user = userResult.data.user;
    const claims = claimsResult.data?.claims;
    if (userResult.error || claimsResult.error || !user || !claims ||
        claims.sub !== user.id || typeof claims.session_id !== "string" ||
        !claims.session_id) return null;
    return { userId: user.id, sessionId: claims.session_id };
  } catch { return null; }
}
