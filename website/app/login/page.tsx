"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import { AuthShell, AuthStatus } from "../components/auth/AuthShell";
import PasswordField from "../components/auth/PasswordField";
import { sanitizeInternalReturnPath } from "../../lib/auth/routeAccess";

function AccountDeletedNotice() {
  const searchParams = useSearchParams();
  if (searchParams.get("reason") !== "account_deleted") return null;

  return (
    <div className="mt-5">
      <AuthStatus variant="error">
        Your account is no longer available. If this was unexpected, please
        contact support. Otherwise, you can create a new account to continue
        using Amniora.
      </AuthStatus>
    </div>
  );
}

function getPostLoginDestination() {
  if (typeof window === "undefined") return "/dashboard";
  return sanitizeInternalReturnPath(
    new URLSearchParams(window.location.search).get("next"),
    "/dashboard",
    { allowBetaAccess: true },
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function checkSession() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) router.push(getPostLoginDestination());
    }
    checkSession();
  }, [router]);

  async function handleLogin(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);

    if (loginError) {
      setError(loginError.message);
      return;
    }
    router.push(getPostLoginDestination());
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Log in to continue your hands-on cybersecurity practice."
    >
      <Suspense fallback={null}>
        <AccountDeletedNotice />
      </Suspense>
      <form className="mt-6 space-y-4" onSubmit={handleLogin}>
        <div>
          <label htmlFor="login-email" className="text-sm font-medium text-text">Email address</label>
          <Input id="login-email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" className="mt-2" />
        </div>
        <PasswordField id="login-password" label="Password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        <div className="text-right">
          <Link href="/forgot-password" className="text-sm font-medium text-primary outline-none hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-focus">Forgot password?</Link>
        </div>
        {error && <AuthStatus variant="error">{error}</AuthStatus>}
        <Button type="submit" loading={loading} loadingText="Signing in…" className="w-full">Log in</Button>
        <div className="grid gap-2 border-t border-border pt-4">
          <Button disabled variant="secondary" className="w-full">Google sign-in. Coming soon</Button>
          <Button disabled variant="secondary" className="w-full">Apple sign-in. Coming soon</Button>
        </div>
      </form>
      <p className="mt-5 text-center text-sm text-text-secondary">
        No account? <Link href="/signup" className="font-medium text-primary hover:text-primary-hover">Create one</Link>
      </p>
      <p className="mt-3 text-center text-xs text-text-muted">You may need to verify your email before signing in.</p>
    </AuthShell>
  );
}
