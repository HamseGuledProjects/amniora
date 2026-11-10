"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import {
  PASSWORD_RECOVERY_INVALID_PARAM,
  PASSWORD_RECOVERY_VERIFIED_PARAM,
} from "../../lib/auth/passwordRecovery";
import { AuthShell, AuthStatus } from "../components/auth/AuthShell";
import PasswordField from "../components/auth/PasswordField";
import Button from "../components/ui/Button";

type RecoveryState = "verifying" | "ready" | "missing" | "invalid" | "error";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("verifying");

  const recoveryStatus = searchParams.get("recovery");

  useEffect(() => {
    let active = true;

    async function checkRecoverySession() {
      if (recoveryState === "ready") return;

      if (recoveryStatus === PASSWORD_RECOVERY_INVALID_PARAM) {
        setRecoveryState("invalid");
        return;
      }

      if (recoveryStatus !== PASSWORD_RECOVERY_VERIFIED_PARAM) {
        setRecoveryState("missing");
        return;
      }

      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!active) return;
      if (userError) {
        setRecoveryState("error");
        return;
      }

      if (!user) {
        setRecoveryState("invalid");
        return;
      }

      setRecoveryState("ready");
      router.replace("/reset-password");
    }

    checkRecoverySession();

    return () => {
      active = false;
    };
  }, [recoveryState, recoveryStatus, router]);

  function validatePassword() {
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter.";
    if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter.";
    if (!/[0-9]/.test(password)) return "Password must contain a number.";
    if (password !== confirmPassword) return "Passwords do not match.";
    return "";
  }

  async function handleResetPassword(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError("");
    setSuccess("");

    if (recoveryState !== "ready") {
      setError("Request a new password reset link before choosing a new password.");
      return;
    }

    const validationError = validatePassword();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (resetError) {
      setError("We couldn't update your password. Request a new reset link and try again.");
      return;
    }

    await supabase.auth.signOut({ scope: "local" });
    setPassword("");
    setConfirmPassword("");
    setSuccess("Password updated successfully. You can now log in with your new password.");
    setTimeout(() => router.replace("/login"), 2000);
  }

  if (recoveryState === "verifying") {
    return <AuthStatus variant="success">Checking your reset link…</AuthStatus>;
  }

  if (recoveryState === "error") {
    return (
      <div className="mt-6 space-y-4">
        <AuthStatus variant="error">
          We could not verify this reset link right now. Please try again in a moment.
        </AuthStatus>
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-ui-sm bg-primary px-5 text-sm font-semibold text-white outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  if (recoveryState === "missing") {
    return (
      <div className="mt-6 space-y-4">
        <AuthStatus variant="error">
          Request a password reset link before choosing a new password.
        </AuthStatus>
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-ui-sm bg-primary px-5 text-sm font-semibold text-white outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          Request a reset link
        </Link>
      </div>
    );
  }

  if (recoveryState === "invalid") {
    return (
      <div className="mt-6 space-y-4">
        <AuthStatus variant="error">
          This password reset link is no longer valid. Request a new reset link and try again.
        </AuthStatus>
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-ui-sm bg-primary px-5 text-sm font-semibold text-white outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={handleResetPassword}>
      <PasswordField id="new-password" label="New password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
      <PasswordField id="confirm-new-password" label="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
      <p className="text-xs leading-5 text-text-muted">Use at least 8 characters with uppercase, lowercase and a number.</p>
      {error && <AuthStatus variant="error">{error}</AuthStatus>}
      {success && <AuthStatus variant="success">{success}</AuthStatus>}
      <Button type="submit" loading={loading} loadingText="Updating password…" className="w-full">Update password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Create a new password" description="Choose a secure password for your Amniora account.">
      <Suspense fallback={<AuthStatus variant="success">Checking your reset link…</AuthStatus>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
