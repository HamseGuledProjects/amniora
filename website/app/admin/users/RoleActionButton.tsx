"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RoleActionButtonProps = {
  userId: string;
  email: string;
  role: "user" | "admin";
};

export default function RoleActionButton({
  userId,
  email,
  role,
}: RoleActionButtonProps) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const [adminSecret, setAdminSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const actionLabel = role === "admin" ? "Make Admin" : "Make User";

  async function handleSubmit() {
    setLoading(true);
    setError("");

    const res = await fetch("/api/admin/users/role", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        targetEmail: email,
        typedEmail,
        adminSecret,
        role,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Action failed.");
      setLoading(false);
      return;
    }

    setOpen(false);
    setTypedEmail("");
    setAdminSecret("");
    setLoading(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-purple-400/30 bg-purple-500/10 px-3 py-2 text-xs text-purple-300 transition hover:bg-purple-500/20"
      >
        {actionLabel}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-purple-400/30 bg-slate-950 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white">{actionLabel}?</h2>

            <p className="mt-3 text-sm text-slate-400">
              {role === "admin"
                ? "This will give the user full admin access."
                : "This will remove admin access from the user."}
            </p>

            <div className="mt-4 rounded-xl border border-purple-400/20 bg-purple-500/10 p-3 text-sm text-purple-200">
              Target user: <span className="font-semibold">{email}</span>
            </div>

            <label className="mt-5 block text-sm text-slate-300">
              Type the user email to confirm
            </label>
            <input
              value={typedEmail}
              onChange={(e) => setTypedEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-purple-400"
              placeholder={email}
            />

            <label className="mt-4 block text-sm text-slate-300">
              Admin action secret
            </label>
            <input
              type="password"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-purple-400"
              placeholder="Enter admin secret"
            />

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError("");
                  setTypedEmail("");
                  setAdminSecret("");
                }}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={
                  loading ||
                  typedEmail.toLowerCase() !== email.toLowerCase() ||
                  !adminSecret
                }
                onClick={handleSubmit}
                className="rounded-xl bg-purple-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving..." : actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}