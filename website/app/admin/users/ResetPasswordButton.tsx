"use client";

import { useState } from "react";

type ResetPasswordButtonProps = {
  email: string;
};

export default function ResetPasswordButton({ email }: ResetPasswordButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleReset() {
    setLoading(true);
    setError("");

    const res = await fetch("/api/admin/users/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Failed to send reset email.");
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={sent}
        className="rounded-lg border border-yellow-400/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300 transition hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sent ? "Reset Sent" : "Reset Password"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-yellow-400/30 bg-slate-950 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white">Send password reset?</h2>

            <p className="mt-3 text-sm text-slate-400">
              This will send a password reset email to:
            </p>

            <div className="mt-4 rounded-xl border border-yellow-400/20 bg-yellow-500/10 p-3 text-sm text-yellow-200">
              {email}
            </div>

            {sent && (
              <p className="mt-4 text-sm text-green-400">
                Password reset email sent.
              </p>
            )}

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
              >
                Close
              </button>

              {!sent && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={loading}
                  className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Sending..." : "Send Reset"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}