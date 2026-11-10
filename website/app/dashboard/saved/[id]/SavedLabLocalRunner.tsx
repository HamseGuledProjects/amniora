"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import Button from "@/app/components/ui/Button";
import Badge from "@/app/components/ui/Badge";
import SectionCard from "./SavedInvestigationSection";
import {
  detectRunner, getEligibility, getRunnerStatus, launchLab, resetLab, stopLab,
  runnerMessage, RunnerBrowserError, validateBrowserEndpoint, type BrowserBuild,
} from "@/lib/web-lab/local-runner/browser-client";
import type { RunnerPublicStatus } from "@/lib/web-lab/local-runner/protocol";
import { createRunnerPreview, parseRunnerPreviewState, type RunnerPreviewState } from "@/lib/web-lab/local-runner/development-preview";
import { getMyVmSnapshot } from "@/lib/web-lab/byo-runner/browser-client";
import { getCloudSnapshot } from "@/lib/web-lab/cloud-runtime/browser-client";
import { createCloudPreview, parseCloudPreview } from "@/lib/web-lab/cloud-runtime/development-preview";
import type { CloudSnapshot } from "@/lib/web-lab/cloud-runtime/product-contract";
import SavedLabMyVm from "./SavedLabMyVm";
import SavedLabCloud from "./SavedLabCloud";

type Action = "check" | "launch" | "reset" | "stop";
// Match the Saved task/feedback controls without changing shared button defaults.
const primary = "rounded-[4px] border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white";
const secondary = "rounded-[4px] border-white/10 bg-[#081827] text-slate-300 hover:border-cyan-300/35 hover:bg-[#0b2033] hover:text-white";
const pendingLabels: Record<Action, string> = { check: "Checking Runner", launch: "Starting Lab", reset: "Resetting", stop: "Stopping" };
function isDesktop(): boolean {
  return !window.matchMedia("(max-width: 767px)").matches && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new RunnerBrowserError("CANCELLED")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 1_000);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

type Props = {
  savedLabId: string;
  topic: string;
  previewState?: string | null;
  onExecutableChange?: (executable: boolean) => void;
};

export default function SavedLabLocalRunner({ savedLabId, topic, previewState, onExecutableChange }: Props) {
  const preview = process.env.NODE_ENV === "development" ? parseRunnerPreviewState(previewState) : null;
  const vmPreviewState = process.env.NODE_ENV === "development" && previewState?.startsWith("vm-") ? previewState : null;
  const cloudPreviewState = process.env.NODE_ENV === "development" ? parseCloudPreview(previewState) : null;
  // Query changes remount only this section, cancelling the old observation.
  return <LocalRunnerSection key={`${savedLabId}:${preview ?? vmPreviewState ?? cloudPreviewState ?? "live"}`}
    savedLabId={savedLabId} topic={topic} previewState={preview}
    vmPreviewState={vmPreviewState} cloudPreviewState={cloudPreviewState}
    onExecutableChange={onExecutableChange} />;
}

function LocalRunnerSection({ savedLabId, topic, previewState, vmPreviewState, cloudPreviewState, onExecutableChange }:
  Omit<Props, "previewState"> & { previewState: RunnerPreviewState | null; vmPreviewState: string | null; cloudPreviewState: string | null }) {
  const [preview] = useState(() => process.env.NODE_ENV === "development" ? createRunnerPreview(previewState) : null);
  const [cloudPreview] = useState(() => createCloudPreview(cloudPreviewState));
  const vmPreviewBuild: BrowserBuild | null = vmPreviewState ? { buildId: "development-preview-only", buildFingerprint: "0".repeat(64), runtimeVersion: "web-lab-local-1" } : null;
  const cloudPreviewBuild: BrowserBuild | null = cloudPreview ? { buildId: "development-preview-only", buildFingerprint: "0".repeat(64), runtimeVersion: "web-lab-local-1" } : null;
  const [build, setBuild] = useState<BrowserBuild | null>(preview?.build ?? vmPreviewBuild ?? cloudPreviewBuild);
  const [runtimeChoice, setRuntimeChoice] = useState<"computer" | "vm" | "cloud">(vmPreviewState ? "vm" : cloudPreview ? "cloud" : "computer");
  const [myVmAvailable, setMyVmAvailable] = useState(!!vmPreviewState);
  const [cloudSnapshot, setCloudSnapshot] = useState<CloudSnapshot | null>(cloudPreview);
  const [cloudChecked, setCloudChecked] = useState(!!preview || !!vmPreviewState || !!cloudPreview);
  const [desktop, setDesktop] = useState(false);
  const [status, setStatus] = useState<RunnerPublicStatus | null>(preview?.status ?? null);
  const [busy, setBusy] = useState<Action | null>(preview?.busy ?? null);
  const [error, setError] = useState(preview?.error ?? "");
  const [notice, setNotice] = useState(preview?.notice ?? "");
  const [confirmReset, setConfirmReset] = useState(false);
  const work = useRef<AbortController | null>(null);
  const keys = useRef(new Map<string, string>());
  const resetButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  const cloudEligible = !!cloudSnapshot?.enabled && cloudSnapshot.eligible;

  useEffect(() => {
    onExecutableChange?.(!!build || myVmAvailable || cloudEligible);
    return () => onExecutableChange?.(false);
  }, [build, myVmAvailable, cloudEligible, onExecutableChange]);

  useEffect(() => {
    if (preview || vmPreviewState || cloudPreview) return;
    const controller = new AbortController();
    // Category only avoids unnecessary product requests. The server proves executability.
    if (topic === "Web Security") {
      void getEligibility(savedLabId, controller.signal).then(value => {
        if (!controller.signal.aborted) setBuild(value.enabled && value.eligible ? value.build : null);
      }).catch(() => { /* Fail closed; the saved investigation remains usable. */ });
    }
    return () => { controller.abort(); work.current?.abort(); };
  }, [savedLabId, topic, preview, vmPreviewState, cloudPreview]);

  useEffect(() => {
    if (topic !== "Web Security" || vmPreviewState || preview || cloudPreview) return;
    const controller = new AbortController();
    void getMyVmSnapshot(savedLabId, controller.signal).then(value => setMyVmAvailable(value.enabled && value.eligible)).catch(() => setMyVmAvailable(false));
    return () => controller.abort();
  }, [savedLabId, topic, vmPreviewState, preview, cloudPreview]);

  useEffect(() => {
    if (topic !== "Web Security" || preview || vmPreviewState || cloudPreview) return;
    const controller = new AbortController();
    void getCloudSnapshot(savedLabId, controller.signal).then(value => {
      if (!controller.signal.aborted) { setCloudSnapshot(value); setCloudChecked(true); }
    }).catch(() => { if (!controller.signal.aborted) { setCloudSnapshot(null); setCloudChecked(true); } });
    return () => controller.abort();
  }, [savedLabId, topic, preview, vmPreviewState, cloudPreview]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => {
      const available = isDesktop();
      setDesktop(available);
      if (preview && available) {
        setStatus(preview.status); setBusy(preview.busy); setError(preview.error); setNotice(preview.notice);
      }
      if (!available) {
        work.current?.abort(); work.current = null;
        setBusy(null); setConfirmReset(false); setStatus(null); setError("");
      }
    };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preview]);

  useEffect(() => { if (confirmReset) cancelButton.current?.focus(); }, [confirmReset]);
  useEffect(() => {
    if (preview || status?.state !== "ready" || !status.expiresAt) return;
    const timer = setTimeout(() => {
      setStatus(previous => previous?.state === "ready" ? { ...previous, state: "expired", endpoint: null } : previous);
      setNotice("This local session has expired. Check again before starting a new session.");
    }, Math.max(0, status.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [status, preview]);

  async function run(action: Action) {
    if (preview) return; // Display-only: never discover, authorize, issue packages or mutate a runtime.
    // A ref locks immediately, before React can render a disabled button.
    if (!build || !isDesktop() || work.current) return;
    const controller = new AbortController();
    work.current = controller;
    const previous = status;
    setBusy(action); setError(""); setNotice(""); setConfirmReset(false);
    if (action !== "check") setStatus(null); // Remove the old endpoint immediately on reset/stop.
    const scope = `${action}:${build.buildFingerprint}:${previous?.sessionId ?? "new"}:${previous?.generation ?? 0}`;
    const key = keys.current.get(scope) ?? crypto.randomUUID();
    keys.current.set(scope, key);
    try {
      let next = action === "check" ? await detectRunner(build, controller.signal)
        : action === "launch" ? await launchLab(savedLabId, build, key, controller.signal)
        : action === "reset" && previous ? await resetLab(build, previous, key, controller.signal)
        : action === "stop" && previous ? await stopLab(build, previous, key, controller.signal)
        : null;
      if (!next) throw new RunnerBrowserError("LOCAL_RUNTIME_NOT_FOUND");
      for (let attempt = 0; attempt < 6 && ["starting", "resetting", "stopping"].includes(next.state); attempt++) {
        if (controller.signal.aborted) return;
        setStatus(next);
        await pause(controller.signal);
        next = await getRunnerStatus(build, controller.signal);
      }
      if (controller.signal.aborted) return;
      setStatus(next);
      if (!["starting", "resetting", "stopping"].includes(next.state)) keys.current.delete(scope);
      if (next.state === "ready") setNotice(action === "check" ? "Lab already running. Reconnected to your local session."
        : action === "reset" && next.generation !== previous?.generation ? "Lab reset."
        : action === "launch" ? "Lab started." : "Local session status refreshed.");
      else if (next.state === "idle") setNotice(action === "stop" ? "Lab stopped. Your Saved Lab is unchanged." : "Runner Ready. Ready to run on your computer.");
      else if (next.state === "failed") setError(next.errorCode ?? "LOCAL_RUNTIME_START_FAILED");
      else if (next.state === "expired") setNotice("This local session has expired. You can start a new session.");
      else setNotice("The operation is still in progress. Refresh Status to reconnect; no additional launch has been sent.");
    } catch (failure) {
      if (!controller.signal.aborted) {
        setStatus(null);
        setError(failure instanceof RunnerBrowserError ? failure.code : "INTERNAL_ERROR");
      }
    } finally {
      if (work.current === controller) { work.current = null; setBusy(null); }
    }
  }

  const cloudSelectable = cloudEligible && cloudSnapshot?.plan === "pro";
  if ((!build && !myVmAvailable && !cloudEligible) || (!preview && !vmPreviewState && !cloudPreview && topic !== "Web Security")) return null;
  const ready = status?.state === "ready" && !!status.endpoint && !error;
  const canStart = !!build && !!status && ["idle", "expired", "failed"].includes(status.state) && !error;
  const canStop = !!build && !!status?.sessionId && status.buildId === build.buildId && status.buildFingerprint === build.buildFingerprint &&
    (ready || status.state === "failed");
  const title = busy ? pendingLabels[busy] : error ? error === "RUNNER_OFFLINE" ? "Runner Offline" : "Unable to run lab"
    : ready ? "Lab Ready" : status?.state === "idle" ? "Ready to run"
    : status?.state === "expired" ? "Session expired" : status?.state === "starting" ? "Starting Lab"
    : status?.state === "resetting" ? "Resetting" : status?.state === "stopping" ? "Stopping" : "";

  return (
    <div className="print:hidden" data-local-runner-section data-local-runner-preview={preview?.state}>
      <SectionCard step="02" icon={<Monitor size={19} />} eyebrow="Live investigation" title="Run this lab">
        {preview && <p className="type-caption mb-space-4 border-l border-cyan-100/20 pl-space-3 text-cyan-100">Development preview: simulated Runner state. Controls do not start, reset, stop or open a runtime. Your saved investigation is unchanged.</p>}
        <p className="type-body text-slate-300">Choose where the practice application runs. Your Saved Lab stays here.</p>
        <>
            <div className="mt-space-4 grid gap-space-3 sm:grid-cols-3">
              <div className="min-w-0 rounded-[3px] border border-cyan-100/15 p-space-3">
                <Button variant="secondary" className={`${secondary} w-full`} aria-pressed={runtimeChoice === "computer"} onClick={() => { setRuntimeChoice("computer"); if (desktop) void run("check"); }} disabled={!!busy || !build}>My Computer</Button>
                <p className="type-caption mt-space-2 text-slate-300">Run with Amniora Runner</p><p className={`type-caption mt-1 ${build ? "text-cyan-100" : "text-slate-400"}`}>{build ? "Available · Free and Pro" : "Unavailable"}</p>
              </div>
              <div className="min-w-0 rounded-[3px] border border-white/10 p-space-3">
                <Button variant="secondary" className={`${secondary} w-full`} aria-pressed={runtimeChoice === "vm"} onClick={() => setRuntimeChoice("vm")} disabled={!myVmAvailable}>My VM</Button><p className="type-caption mt-space-2 text-slate-300">{myVmAvailable ? "Available · Free and Pro" : "Coming soon"}</p>
              </div>
              <div className="min-w-0 rounded-[3px] border border-white/10 p-space-3">
                <Button variant="secondary" className={`${secondary} w-full`} aria-pressed={runtimeChoice === "cloud"} onClick={() => setRuntimeChoice("cloud")} disabled={!cloudSelectable}>Amniora Cloud</Button>
                <p className="type-caption mt-space-2 text-slate-300">Runs securely on Amniora-managed infrastructure. No local setup required.</p>
                <div className="mt-space-2 flex flex-wrap items-center gap-2"><Badge variant="neutral" className="!rounded-[3px] border border-cyan-100/15 !bg-[#071426] px-2.5 py-1 !font-semibold !text-slate-300 !ring-0">Pro</Badge><span className={`type-caption ${cloudSelectable ? "text-cyan-100" : "text-slate-400"}`}>{!cloudChecked ? "Checking availability" : cloudSnapshot?.plan === "free" ? "Available with Pro" : cloudEligible ? "View Cloud status" : "Unavailable"}</span></div>
              </div>
            </div>
            {runtimeChoice === "vm" && <SavedLabMyVm savedLabId={savedLabId} previewState={vmPreviewState} />}
            {runtimeChoice === "cloud" && <SavedLabCloud savedLabId={savedLabId} initialSnapshot={cloudSnapshot} previewState={cloudPreviewState} />}
            {runtimeChoice === "computer" && (!desktop ? <div className="mt-space-4 border-l border-cyan-100/20 pl-space-4" role="status"><p className="type-body font-semibold text-white">Desktop required</p><p className="type-body mt-1 text-slate-300">You can still view the Saved Lab normally. Choose My VM or Amniora Cloud here, or open it on a desktop to use Amniora Runner.</p></div> : <>
            {(title || notice || error) && <div className="mt-space-4 rounded-[3px] border border-cyan-300/20 bg-[#071426] p-space-4" role="status" aria-live="polite" aria-atomic="true">
              <p className="type-body font-semibold text-white">{title}</p><p className="type-body mt-1 text-slate-300">{error ? runnerMessage(error) : notice || "Please wait. Your investigation remains available below."}</p>
            </div>}
            <div className="mt-space-4 flex flex-wrap gap-space-2">
              {busy && <Button className={primary} loading loadingText={pendingLabels[busy]}>Please wait</Button>}
              {ready && !busy && <Button className={primary} onClick={() => {
                if (preview) return;
                try {
                  if (!status?.expiresAt || status.expiresAt <= Date.now()) throw new RunnerBrowserError("LOCAL_RUNTIME_EXPIRED");
                  window.open(validateBrowserEndpoint(status.endpoint), "_blank", "noopener,noreferrer");
                } catch (failure) { setStatus(null); setError(failure instanceof RunnerBrowserError ? failure.code : "INVALID_ENDPOINT"); }
              }}>Open Lab</Button>}
              {canStart && !busy && <Button className={primary} onClick={() => void run("launch")}>Start Lab</Button>}
              {(status || error) && !busy && <Button variant="secondary" className={secondary} onClick={() => void run("check")}>{error ? "Check Again" : "Refresh Status"}</Button>}
              {ready && !busy && !confirmReset && <Button ref={resetButton} variant="secondary" className={secondary} onClick={() => setConfirmReset(true)}>Reset</Button>}
              {canStop && !busy && !confirmReset && <Button variant="ghost" className="rounded-[4px] !text-slate-200 hover:!bg-white/10 hover:!text-white" onClick={() => void run("stop")}>Stop</Button>}
            </div>
            {confirmReset && <div role="group" aria-labelledby="local-runner-reset-title" className="mt-space-4 border-t border-white/10 pt-space-4" onKeyDown={event => { if (event.key === "Escape") { setConfirmReset(false); requestAnimationFrame(() => resetButton.current?.focus()); } }}>
              <h3 id="local-runner-reset-title" className="type-body font-semibold">Reset lab?</h3><p className="type-body mt-1 text-slate-300">This restores the lab to its original state and removes your runtime progress. Your Saved Lab is unchanged.</p>
              <div className="mt-space-3 flex flex-wrap gap-space-2"><Button ref={cancelButton} variant="secondary" className={secondary} onClick={() => { setConfirmReset(false); requestAnimationFrame(() => resetButton.current?.focus()); }}>Cancel</Button><Button variant="destructive" className="rounded-[4px]" onClick={() => void run("reset")}>Reset Lab</Button></div>
            </div>}
            <p className="type-caption mt-space-4 text-slate-400">Runs on your computer. Local activity is not hosted verification. Runner installation is unavailable in this local website demo.</p>
            </>)}
          </>
      </SectionCard>
    </div>
  );
}
