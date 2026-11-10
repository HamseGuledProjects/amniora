import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { authorizeBetaAccess } from "@/lib/auth/betaAccessAuthorization";

export async function requireAdmin() {
  const supabase = await createClient();

  const authorization = await authorizeBetaAccess(supabase);

  if (!authorization.authenticated) {
    redirect("/login");
  }

  if (!authorization.isAdmin) {
    redirect("/dashboard");
  }

  const { user } = authorization;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  return {
    user,
    profile,
    supabase,
  };
}
