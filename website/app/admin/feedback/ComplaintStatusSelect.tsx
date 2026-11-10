"use client";

import { useState } from "react";

const statuses = [
  ["new", "New"],
  ["reviewing", "Reviewing"],
  ["resolved", "Resolved"],
  ["dismissed", "Dismissed"],
];

export default function ComplaintStatusSelect({ complaintId, initialStatus }: { complaintId: string; initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function update(nextStatus: string) {
    setStatus(nextStatus);
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/lab-feedback/complaints/${encodeURIComponent(complaintId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        setMessage("Status update failed.");
        setStatus(initialStatus);
        return;
      }
      setMessage("Saved");
    } catch {
      setMessage("Status update failed.");
      setStatus(initialStatus);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-40">
      <label className="sr-only" htmlFor={`complaint-status-${complaintId}`}>Complaint status</label>
      <select
        id={`complaint-status-${complaintId}`}
        value={status}
        onChange={(event) => update(event.target.value)}
        disabled={saving}
        className="min-h-10 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-60"
      >
        {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {message && <p className="mt-1 text-xs text-slate-400">{message}</p>}
    </div>
  );
}
