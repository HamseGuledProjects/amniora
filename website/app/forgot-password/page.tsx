"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { getPasswordRecoveryRedirectUrl } from "../../lib/auth/passwordRecovery";
import { AuthShell, AuthStatus } from "../components/auth/AuthShell";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleReset() {
    setError("");
    setMessage("");
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordRecoveryRedirectUrl(window.location.origin),
    });
    setLoading(false);

    if (resetError) {
      setError("We couldn't send a reset email right now. Please try again.");
      return;
    }
    setMessage("If an account exists for that email, a password reset link will be sent.");
  }

  return (
    <AuthShell title="Reset password" description="Enter your email and we'll send you a password reset link.">
      <div className="mt-6 space-y-4">
        <div>
          <label htmlFor="reset-email" className="text-sm font-medium text-text">Email address</label>
          <Input id="reset-email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" className="mt-2" />
        </div>
        {error && <AuthStatus variant="error">{error}</AuthStatus>}
        {message && <AuthStatus variant="success">{message}</AuthStatus>}
        <Button onClick={handleReset} loading={loading} loadingText="Sending reset link…" className="w-full">Send reset email</Button>
      </div>
      <p className="mt-5 text-center text-sm text-text-secondary">
        Remembered your password? <Link href="/login" className="font-medium text-primary hover:text-primary-hover">Log in</Link>
      </p>
    </AuthShell>
  );
}
