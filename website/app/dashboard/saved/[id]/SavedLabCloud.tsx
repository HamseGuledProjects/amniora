"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/app/components/ui/Button";
import {
  cloudMessage, CloudBrowserError, getCloudSnapshot, mutateCloud, openCloud, submitCloudOpen,
} from "@/lib/web-lab/cloud-runtime/browser-client";
import { createCloudPreview } from "@/lib/web-lab/cloud-runtime/development-preview";
import type { CloudAvailability, CloudSnapshot } from "@/lib/web-lab/cloud-runtime/product-contract";

const primary = "rounded-[4px] border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white";
const secondary = "rounded-[4px] border-white/10 bg-[#081827] text-slate-300 hover:border-cyan-300/35 hover:bg-[#0b2033] hover:text-white";
type Action = "refresh" | "launch" | "reset" | "stop" | "open";
const pending: Record<Action, string> = {
  refresh: "Refreshing", launch: "Launching", reset: "Resetting", stop: "Stopping", open: "Opening Lab",
};
const transient = new Set(["launching", "starting", "resetting", "stopping", "expiring"]);

function availabilityCopy(value: CloudAvailability): { title: string; body: string } {
  switch (value) {
    case "plan_required": return { title: "Available with Pro", body: "My Computer and My VM remain available on Free." };
    case "capacity_full": return { title: "Cloud capacity is full", body: "Try again shortly or use My Computer / My VM." };
    case "active_elsewhere": return { title: "Another Cloud lab is active", body: "Stop it before starting this one. My Computer and My VM remain available." };
    case "budget_unavailable": return { title: "Cloud temporarily unavailable", body: "Use My Computer or My VM while Cloud launch is unavailable." };
    case "service_disabled": return { title: "Cloud temporarily unavailable", body: "Try again later, or use My Computer / My VM." };
    case "unavailable": return { title: "Cloud unavailable for this lab", body: "My Computer and My VM remain available." };
    default: return { title: "Cloud available", body: "Launch a bounded hosted session with no local setup." };
  }
}

export default function SavedLabCloud({ savedLabId, initialSnapshot, previewState }: {
  savedLabId: string;
  initialSnapshot: CloudSnapshot | null;
  previewState?: string | null;
}) {
  const [preview] = useState(() => createCloudPreview(previewState));
  const [snapshot, setSnapshot] = useState<CloudSnapshot | null>(preview ?? initialSnapshot);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [clock, setClock] = useState<number | null>(null);
  const work = useRef<AbortController | null>(null);
  const keys = useRef(new Map<string, string>());
  const resetButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (preview) return;
    try {
      const value = await getCloudSnapshot(savedLabId, signal);
      if (!signal?.aborted) { setSnapshot(value); setError(""); }
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof CloudBrowserError ? failure.code : "UNAVAILABLE");
    }
  }, [preview, savedLabId]);

  useEffect(() => {
    if (preview || !snapshot?.runtime || !transient.has(snapshot.runtime.state)) return;
    const timer = setInterval(() => void refresh(), 2_000);
    return () => clearInterval(timer);
  }, [preview, snapshot?.runtime, refresh]);
  useEffect(() => {
    if (snapshot?.runtime?.state !== "ready") return;
    const first = setTimeout(() => setClock(Date.now()), 0);
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [preview, snapshot?.runtime?.state]);
  useEffect(() => {
    if (preview || !snapshot?.runtime?.expiresAt || ["expired", "failed"].includes(snapshot.runtime.state)) return;
    const delay = new Date(snapshot.runtime.expiresAt).getTime() - Date.now();
    const timer = setTimeout(() => void refresh(), Math.max(0, Math.min(delay, 2_147_000_000)));
    return () => clearTimeout(timer);
  }, [preview, snapshot?.runtime?.expiresAt, snapshot?.runtime?.state, refresh]);
  useEffect(() => { if (confirmReset) cancelButton.current?.focus(); }, [confirmReset]);
  useEffect(() => () => work.current?.abort(), []);

  async function run(action: Exclude<Action, "open">) {
    if (preview || work.current) return;
    const controller = new AbortController();
    work.current = controller;
    setBusy(action); setError(""); setNotice(""); setConfirmReset(false);
    const scope = `${action}:${snapshot?.runtime?.createdAt ?? "new"}`;
    const key = keys.current.get(scope) ?? crypto.randomUUID();
    keys.current.set(scope, key);
    try {
      const value = action === "refresh" ? await getCloudSnapshot(savedLabId, controller.signal)
        : await mutateCloud(savedLabId, action, key, controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot(value);
      if (!value.runtime || !transient.has(value.runtime.state)) keys.current.delete(scope);
      setNotice(action === "stop" ? "Cloud lab stopped. Your Saved Lab and verified completion are unchanged."
        : action === "reset" ? "Cloud lab reset. Fresh access will be issued when it is ready."
        : action === "launch" ? "Cloud launch accepted." : "Cloud status refreshed.");
    } catch (failure) {
      if (!controller.signal.aborted) {
        const code = failure instanceof CloudBrowserError ? failure.code : "UNAVAILABLE";
        setError(code);
        if (code === "RUNTIME_ALREADY_ACTIVE") await refresh(controller.signal);
      }
    } finally {
      if (work.current === controller) { work.current = null; setBusy(null); }
    }
  }

  async function open() {
    if (preview || work.current) return;
    const controller = new AbortController(); work.current = controller;
    setBusy("open"); setError(""); setNotice("");
    try {
      const value = await openCloud(savedLabId, controller.signal);
      if (!controller.signal.aborted) { submitCloudOpen(value); setNotice("Cloud lab opened through Amniora."); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof CloudBrowserError ? failure.code : "UNAVAILABLE");
    } finally {
      if (work.current === controller) { work.current = null; setBusy(null); }
    }
  }

  const runtime = snapshot?.runtime ?? null;
  const ready = runtime?.state === "ready" && !error;
  const remainingMinutes = runtime && clock !== null ? Math.max(0, Math.ceil((new Date(runtime.expiresAt).getTime() - clock) / 60_000)) : null;
  const expiringSoon = ready && remainingMinutes !== null && remainingMinutes <= 10;
  const availability = availabilityCopy(snapshot?.availability ?? "unavailable");
  const title = busy ? pending[busy] : error ? "Cloud unavailable" : runtime?.state === "launching" ? "Launching Cloud lab"
    : runtime?.state === "starting" ? "Starting Cloud lab" : runtime?.state === "ready" ? expiringSoon ? "Cloud lab expiring soon" : "Cloud lab ready"
    : runtime?.state === "resetting" ? "Resetting Cloud lab" : runtime?.state === "stopping" ? "Stopping Cloud lab"
    : runtime?.state === "expiring" ? "Cloud lab expiring" : runtime?.state === "expired" ? "Cloud session expired"
    : runtime?.state === "failed" ? "Cloud launch failed" : availability.title;
  const body = error ? cloudMessage(error) : runtime?.state === "ready" ?
    (remainingMinutes !== null ? `Cloud lab expires in about ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.` : "Your Cloud lab is ready.")
    : runtime?.state === "launching" || runtime?.state === "starting" ? "Amniora is preparing your lab. No exact completion time is promised."
    : runtime?.state === "resetting" ? "The logical Cloud lab is being restored. Old access cannot be reused."
    : runtime?.state === "stopping" || runtime?.state === "expiring" ? "Amniora is closing the hosted session safely."
    : runtime?.state === "expired" ? "You can launch a new bounded session when Cloud is available."
    : runtime?.state === "failed" ? "Try again, or use My Computer / My VM."
    : notice || availability.body;
  const canLaunch = snapshot?.plan === "pro" && snapshot.eligible && snapshot.availability === "available" &&
    (!runtime || ["expired", "failed"].includes(runtime.state));

  return <div className="mt-space-4" data-cloud-runtime data-cloud-preview={previewState ?? undefined}>
    {preview && <p className="type-caption mb-space-4 border-l border-cyan-100/20 pl-space-3 text-cyan-100">Development preview: simulated Cloud state. Controls perform no runtime, database or gateway operation.</p>}
    <div className="rounded-[3px] border border-cyan-300/20 bg-[#071426] p-space-4" role="status" aria-live="polite" aria-atomic="true">
      <p className="type-body font-semibold text-white">{title}</p>
      <p className="type-body mt-1 text-slate-300">{body}</p>
    </div>
    <div className="mt-space-4 flex flex-wrap gap-space-2">
      {busy && <Button className={primary} loading loadingText={pending[busy]}>Please wait</Button>}
      {ready && runtime.openAvailable && !busy && <Button className={primary} onClick={() => void open()}>Open Lab</Button>}
      {canLaunch && !busy && <Button className={primary} onClick={() => void run("launch")}>{runtime ? "Launch Again" : "Launch Cloud Lab"}</Button>}
      {snapshot && !busy && <Button variant="secondary" className={secondary} onClick={() => void run("refresh")}>Refresh Status</Button>}
      {ready && runtime.resetAvailable && !busy && !confirmReset && <Button ref={resetButton} variant="secondary" className={secondary} onClick={() => setConfirmReset(true)}>Reset</Button>}
      {runtime?.stopAvailable && !busy && !confirmReset && <Button variant="ghost" className="rounded-[4px] !text-slate-200 hover:!bg-white/10 hover:!text-white" onClick={() => void run("stop")}>Stop</Button>}
    </div>
    {confirmReset && <div role="group" aria-labelledby="cloud-reset-title" className="mt-space-4 border-t border-white/10 pt-space-4" onKeyDown={event => {
      if (event.key === "Escape") { setConfirmReset(false); requestAnimationFrame(() => resetButton.current?.focus()); }
    }}>
      <h3 id="cloud-reset-title" className="type-body font-semibold">Reset Cloud lab?</h3>
      <p className="type-body mt-1 text-slate-300">This restores the hosted lab and removes runtime progress. Your Saved Lab and verified completion remain unchanged.</p>
      <div className="mt-space-3 flex flex-wrap gap-space-2">
        <Button ref={cancelButton} variant="secondary" className={secondary} onClick={() => { setConfirmReset(false); requestAnimationFrame(() => resetButton.current?.focus()); }}>Cancel</Button>
        <Button variant="destructive" className="rounded-[4px]" onClick={() => void run("reset")}>Reset Lab</Button>
      </div>
    </div>}
    <p className="type-caption mt-space-4 text-slate-400">Hosted sessions are time-limited. Amniora resolves and protects the lab destination.</p>
  </div>;
}
