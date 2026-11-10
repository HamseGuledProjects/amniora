import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

type AllowedBetaAccessAuthorization =
  | {
      authenticated: true;
      isAdmin: true;
      betaGranted: false;
      allowed: true;
      user: User;
    }
  | {
      authenticated: true;
      isAdmin: false;
      betaGranted: true;
      allowed: true;
      user: User;
    };

type DeniedBetaAccessAuthorization =
  | {
      authenticated: false;
      isAdmin: false;
      betaGranted: false;
      allowed: false;
      user: null;
    }
  | {
      authenticated: true;
      isAdmin: false;
      betaGranted: false;
      allowed: false;
      user: User;
    };

export type BetaAccessAuthorization =
  | AllowedBetaAccessAuthorization
  | DeniedBetaAccessAuthorization;

export async function authorizeBetaAccess(
  supabase: SupabaseClient,
): Promise<BetaAccessAuthorization> {
  let user: User | null = null;
  try {
    const authResult = await supabase.auth.getUser();
    user = authResult.data.user;

    if (authResult.error || !user) {
      return unauthenticated();
    }
  } catch {
    return unauthenticated();
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (
      profileError ||
      !profile ||
      typeof profile.role !== "string" ||
      !["admin", "user"].includes(profile.role)
    ) {
      return deniedFor(user);
    }

    if (profile.role === "admin") {
      return {
        authenticated: true,
        isAdmin: true,
        betaGranted: false,
        allowed: true,
        user,
      };
    }

    const [settingsResult, accessResult] = await Promise.all([
      supabase
        .from("app_settings")
        .select("private_beta_enabled")
        .eq("id", true)
        .maybeSingle(),
      supabase
        .from("user_access")
        .select("beta_access_granted")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    if (
      settingsResult.error ||
      settingsResult.data?.private_beta_enabled !== true ||
      accessResult.error ||
      accessResult.data?.beta_access_granted !== true
    ) {
      return deniedFor(user);
    }

    return {
      authenticated: true,
      isAdmin: false,
      betaGranted: true,
      allowed: true,
      user,
    };
  } catch {
    return deniedFor(user);
  }
}

export function betaAccessErrorResponse(
  authorization: DeniedBetaAccessAuthorization,
) {
  if (!authorization.authenticated) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { error: "beta_access_required" },
    { status: 403 },
  );
}

function deniedFor(user: User): DeniedBetaAccessAuthorization {
  return {
    authenticated: true,
    isAdmin: false,
    betaGranted: false,
    allowed: false,
    user,
  };
}

function unauthenticated(): DeniedBetaAccessAuthorization {
  return {
    authenticated: false,
    isAdmin: false,
    betaGranted: false,
    allowed: false,
    user: null,
  };
}
