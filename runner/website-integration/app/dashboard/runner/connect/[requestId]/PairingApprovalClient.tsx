"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Button from "@/app/components/ui/Button";
import type { PairingApproval } from "@/lib/web-lab/local-first-product/contract";

type ViewState = "loading" | "ready" | "approved" | "denied" | "failed";
const primary = "rounded-[4px] border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white";
const secondary = "rounded-[4px] border-white/10 bg-[#081827] text-slate-300 hover:border-cyan-300/35 hover:bg-[#0b2033] hover:text-white";

export default function PairingApprovalClient() {
  const { requestId } = useParams<{ requestId: string }>();
  const state = useSearchParams().get("state") ?? "";
  const [details, setDetails] = useState<PairingApproval | null>(null);
  const [view, setView] = useState<ViewState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ request: requestId, state });
    void fetch(`/api/web-labs/local-first/pairing/approval?${query}`, {
      cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal,
      headers: { Accept: "application/json" },
    }).then(async response => {
      const value = await response.json().catch(() => null) as { data?: PairingApproval; error?: { code?: string } } | null;
      if (!response.ok || !value?.data) throw new Error(value?.error?.code ?? "UNAVAILABLE");
      setDetails(value.data); setView(current => current === "denied" ? current : "ready");
      // The opaque request ID lets the Saved Investigation retire an unopened request if this tab closes.
      // Neither the PKCE state nor an authorization code is copied to storage.
      try { window.localStorage.setItem("amniora:pairing-request:v1",
        JSON.stringify({ requestId: value.data.requestId, at: Date.now() })); }
      catch { /* A bounded wait remains available without cross-tab storage. */ }
    }).catch(error => {
      if (!controller.signal.aborted) { setMessage(error instanceof Error && error.message === "UNAUTHENTICATED" ?
        "Sign in to the owner account, then reopen the connection request from Amniora Runner." :
        "This connection request is unavailable or has expired."); setView(current => current === "denied" ? current : "failed"); }
    });
    const onOutcome = (event: StorageEvent) => {
      if (event.key !== "amniora:pairing-outcome:v1" || !event.newValue) return;
      try {
        const value = JSON.parse(event.newValue) as { outcome?: string; requestId?: string };
        if (value.outcome === "denied" && value.requestId === requestId) setView("denied");
      } catch { /* Ignore malformed cross-tab signals. */ }
    };
    window.addEventListener("storage", onOutcome);
    return () => { controller.abort(); window.removeEventListener("storage", onOutcome); };
  }, [requestId, state]);

  async function decide(approved: boolean) {
    if (view !== "ready") return;
    setView("loading"); setMessage("");
    try {
      const response = await fetch("/api/web-labs/local-first/pairing/approval", {
        method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ requestId, state, approved }),
      });
      const value = await response.json().catch(() => null) as { data?: { activationUri: string | null }; error?: { code?: string } } | null;
      if (!response.ok || !value?.data) throw new Error(value?.error?.code ?? "UNAVAILABLE");
      if (!approved) {
        // Only an outcome and timestamp cross tabs; no pairing code, state, or device secret is stored.
        try { window.localStorage.setItem("amniora:pairing-outcome:v1", JSON.stringify({ outcome: "denied", requestId, at: Date.now() })); }
        catch { /* The Saved Investigation also has a bounded wait and manual cancel. */ }
        setView("denied"); return;
      }
      if (!value.data.activationUri?.startsWith("com.amniora.runner:/pair?")) throw new Error("INVALID_RESPONSE");
      setView("approved");
      window.location.assign(value.data.activationUri);
    } catch { setMessage("Amniora could not complete this connection request. Start a new request in Runner."); setView("failed"); }
  }

  return <main className="min-h-screen bg-[#03101d] px-space-4 py-space-12 text-white">
    <section className="mx-auto max-w-xl rounded-[4px] border border-cyan-100/15 bg-[#071426] p-space-6 shadow-2xl">
      <p className="type-caption uppercase tracking-[0.16em] text-cyan-100">Owner test · Amniora Runner</p>
      <h1 className="type-heading-2 mt-space-2">Connect Amniora Runner</h1>
      {view === "loading" && <p className="type-body mt-space-4 text-slate-300">Checking this connection request…</p>}
      {view === "ready" && details && <>
        <p className="type-body mt-space-4 text-slate-300">Approve only if this is the Runner on your Mac.</p>
        <dl className="mt-space-5 grid gap-space-3 rounded-[3px] border border-white/10 bg-[#04101d] p-space-4">
          <div><dt className="type-caption text-slate-400">Device</dt><dd className="type-body mt-1 font-semibold">{details.deviceName}</dd></div>
          <div><dt className="type-caption text-slate-400">Fingerprint</dt><dd className="mt-1 font-mono text-sm text-cyan-100">{details.fingerprint}</dd></div>
        </dl>
        <div className="mt-space-5 flex gap-space-2"><Button className={primary} onClick={() => void decide(true)}>Approve</Button><Button variant="secondary" className={secondary} onClick={() => void decide(false)}>Cancel</Button></div>
      </>}
      {view === "approved" && <><p className="type-body mt-space-4 font-semibold text-cyan-100">Runner approved ✓</p><p className="type-body mt-1 text-slate-300">Return to Amniora Runner to finish connecting.</p></>}
      {view === "denied" && <><p className="type-body mt-space-4 font-semibold">Connection cancelled</p><p className="type-body mt-1 text-slate-300">No Runner was connected.</p></>}
      {view === "failed" && <p role="alert" className="type-body mt-space-4 text-slate-300">{message}</p>}
    </section>
  </main>;
}
