"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DeleteUserButtonProps = {
  userId: string;
  email: string;
};

export default function DeleteUserButton({ userId, email }: DeleteUserButtonProps) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const [adminSecret, setAdminSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setLoading(true);
    setError("");

    const res = await fetch("/api/admin/users/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        targetEmail: email,
        typedEmail,
        adminSecret,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Failed to delete user.");
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
        className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 transition hover:bg-red-500/20"
      >
        Delete
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-slate-950 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white">Delete user permanently?</h2>

            <p className="mt-3 text-sm text-slate-400">
              This will remove the user from Supabase Auth. They will lose access and must create a new account.
            </p>

            <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">
              Target user: <span className="font-semibold">{email}</span>
            </div>

            <label className="mt-5 block text-sm text-slate-300">
              Type the user email to confirm
            </label>
            <input
              value={typedEmail}
              onChange={(e) => setTypedEmail(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-red-400"
              placeholder={email}
            />

            <label className="mt-4 block text-sm text-slate-300">
              Admin action secret
            </label>
            <input
              type="password"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-red-400"
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
                disabled={loading || typedEmail.toLowerCase() !== email.toLowerCase() || !adminSecret}
                onClick={handleDelete}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}