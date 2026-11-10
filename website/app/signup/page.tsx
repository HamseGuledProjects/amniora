"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { createClient } from "../../lib/supabase/client";
import { AuthShell, AuthStatus } from "../components/auth/AuthShell";
import PasswordField from "../components/auth/PasswordField";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  function validateForm() {
    setError("");
    setSuccess("");
    if (!fullName.trim()) return "Full name is required.";
    if (!email.trim()) return "Email is required.";
    if (!email.includes("@") || !email.includes(".")) return "Enter a valid email.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter.";
    if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter.";
    if (!/[0-9]/.test(password)) return "Password must contain at least one number.";
    if (password !== confirmPassword) return "Passwords do not match.";
    return "";
  }

  async function handleSignup(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/callback`,
        data: { full_name: fullName },
      },
    });
    setLoading(false);

    if (signupError) {
      if (signupError.message.toLowerCase().includes("email rate limit")) {
        setError("Too many verification emails have been sent recently. Please wait a few minutes before trying again.");
        return;
      }
      setError(signupError.message);
      return;
    }

    setSuccess("Account created successfully! We've sent a verification email to your inbox. Verify your email before logging in.");
  }

  return (
    <AuthShell title="Create your account" description="Get access to investigation labs, saved progress and the Amniora dashboard.">
      {success ? (
        <div className="mt-6 rounded-ui-sm border border-success/30 bg-success-subtle p-4" role="status">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-text">Account created successfully</h2>
              <p className="mt-1 text-sm leading-6 text-text-secondary">{success}</p>
              <p className="mt-3 text-xs leading-5 text-text-muted">Didn&apos;t receive the email? Check your spam or junk folder before requesting another verification email.</p>
              <Link href="/login" className="mt-4 inline-flex rounded-ui-sm bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover">Go to login</Link>
            </div>
          </div>
        </div>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={handleSignup}>
          <div>
            <label htmlFor="signup-name" className="text-sm font-medium text-text">Full name</label>
            <Input id="signup-name" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" className="mt-2" />
          </div>
          <div>
            <label htmlFor="signup-email" className="text-sm font-medium text-text">Email address</label>
            <Input id="signup-email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" className="mt-2" />
          </div>
          <PasswordField id="signup-password" label="Password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
          <PasswordField id="signup-confirm-password" label="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
          <p className="text-xs leading-5 text-text-muted">Use at least 8 characters with uppercase, lowercase and a number.</p>
          {error && <AuthStatus variant="error">{error}</AuthStatus>}
          <Button type="submit" loading={loading} loadingText="Creating account…" className="w-full">Create account</Button>
          <div className="grid gap-2 border-t border-border pt-4">
            <Button disabled variant="secondary" className="w-full">Google sign-up. Coming soon</Button>
            <Button disabled variant="secondary" className="w-full">Apple sign-up. Coming soon</Button>
          </div>
        </form>
      )}
      <p className="mt-5 text-center text-sm text-text-secondary">
        Already have an account? <Link href="/login" className="font-medium text-primary hover:text-primary-hover">Log in</Link>
      </p>
      <p className="mt-3 text-center text-xs text-text-muted">Passwords are handled securely by the account system.</p>
    </AuthShell>
  );
}
