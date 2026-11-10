"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/app/components/ui/Button";
import {
  activateRunner, cancelLocalFirstCommand, cancelLocalFirstPairing, getLocalFirstCommandStatus, getLocalFirstSnapshot,
  issueLocalFirstAction, LocalFirstBrowserError,
  openRunnerForPairing, runnerActivationUri, runnerPresenceIsFresh,
  runnerReadinessIsFresh, unpairLocalFirstRunner,
} from "@/lib/web-lab/local-first-product/browser-client";
import type { ProductAction, ProductCommandStatus, ProductOperation, ProductSnapshot } from "@/lib/web-lab/local-first-product/contract";
import { IDLE_MY_VM_FLOW, nextMyVmFlow, type MyVmEvent, type MyVmFlow } from "@/lib/web-lab/local-first-product/my-vm-flow";
import SavedLabMyVmSetup from "./SavedLabMyVmSetup";

const primary = "rounded-[4px] border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white";
const secondary = "rounded-[4px] border-white/10 bg-[#081827] text-slate-300 hover:border-cyan-300/35 hover:bg-[#0b2033] hover:text-white";
const messages: Record<string, string> = {
  RUNNER_UNPAIRED: "Open Amniora Runner on your computer and choose Connect to Amniora.",
  RUNNER_NOT_INSTALLED: "Install the reviewed owner-test Runner on your computer, then connect it to Amniora.",
  RUNNER_DID_NOT_RESPOND: "Runner is offline. Your next lab action will open it automatically.",
  VM_NOT_CONFIGURED: "No supported Ubuntu virtual machine is configured on this computer yet.",
  VM_POWERED_OFF: "Your supported virtual machine appears to be powered off.",
  GUEST_AGENT_UNAVAILABLE: "The Amniora guest agent is not ready in your virtual machine.",
  DOCKER_UNAVAILABLE: "Docker is unavailable inside your virtual machine.",
  PACKAGE_INCOMPATIBLE: "This lab isn’t available for your VM architecture yet.",
  ARCHITECTURE_UNAVAILABLE: "This lab isn’t available for your VM architecture yet.",
  LAB_LAUNCH_FAILED: "The lab could not start. Check Runner diagnostics and try again.",
  LAB_RESET_FAILED: "The lab could not reset. Its existing state has not been presented as fresh.",
  LAB_STOPPED: "The lab is stopped. Your Saved Investigation is unchanged.",
  STATUS_STALE: "Readiness will be checked automatically with your next lab action.",
  RUNNER_NOT_READY: "Your VM, guest agent, or Docker is not ready yet.",
  RUNTIME_NOT_READY: "Launch this lab before opening, resetting, or stopping it.",
  ANOTHER_LAB_ACTIVE: "Another My VM lab is active. Stop it before launching this one.",
  OPERATION_IN_PROGRESS: "A My VM command is still in progress. Wait for its result before starting another.",
  COMMAND_EXPIRED: "The unopened Runner request expired. Retry the original action.",
  PAIRING_REVOKED: "This Runner is no longer connected. Pair it again to continue.",
  UNAVAILABLE: "My VM is temporarily unavailable. Try again shortly.",
};

function previewSnapshot(value: string | null | undefined): ProductSnapshot | null {
  if (process.env.NODE_ENV !== "development" || !value?.startsWith("vm-")) return null;
  const unpaired = value === "vm-waiting";
  const running = value === "vm-ready";
  const stale = value === "vm-offline" || value === "vm-reconnecting";
  return { enabled: true, eligible: true, paired: !unpaired,
    runner: unpaired ? null : { name: "Test computer", fingerprint: "A1B2 C3D4 E5F6 0708",
      presence: stale ? "offline" : "online", readiness: stale ? "unknown" : value === "vm-incompatible" ? "unavailable" : "ready",
      readinessVerifiedAt: stale ? null : new Date(0).toISOString(), version: "0.7.0",
      lastInteractionAt: new Date(0).toISOString(), presenceExpiresAt: null, readinessExpiresAt: null },
    virtualMachine: unpaired ? null : { name: "Amniora-BYO-Test", operatingSystem: "Ubuntu 24.04", architecture: "arm64",
      state: value === "vm-incompatible" ? "unavailable" : "ready" },
    guestAgent: unpaired ? null : { state: "ready" }, docker: unpaired ? null : { version: "29.8.1", state: "ready" },
    runtime: { state: running ? "running" : value === "vm-starting" ? "launching" : "idle",
      generation: running ? 2 : null, lastVerifiedAt: stale ? null : new Date(0).toISOString() },
    lab: { name: "Northline Desk", state: running ? "running" : value === "vm-starting" ? "starting" : "stopped",
      generation: running ? 2 : null },
    otherActiveLab: null, pendingCommand: null, lastCompletedCommand: null, gradingAvailable: false, failure: unpaired ? "RUNNER_UNPAIRED" : stale ? "STATUS_STALE" :
      value === "vm-incompatible" ? "PACKAGE_INCOMPATIBLE" : running ? null : "LAB_STOPPED" };
}

function previewScenarioLabel(value: string | null | undefined): string {
  return ({ "vm-connected": "Ubuntu practice VM", "vm-offline": "VM offline", "vm-starting": "Lab starting",
    "vm-reconnecting": "Runner reconnecting", "vm-incompatible": "Runner incompatible",
    "vm-waiting": "Connect your VM" } as Record<string, string>)[value ?? ""] ?? "";
}

export default function SavedLabMyVm({ savedLabId, previewState }: { savedLabId: string; previewState?: string | null }) {
  const [preview] = useState(() => previewSnapshot(previewState));
  const [snapshot, setSnapshot] = useState<ProductSnapshot | null>(preview);
  const [flow, setFlow] = useState<MyVmFlow>(IDLE_MY_VM_FLOW);
  const flowRef = useRef<MyVmFlow>(IDLE_MY_VM_FLOW);
  const [error, setError] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [pairingCancelBusy, setPairingCancelBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [freshnessClock, setFreshnessClock] = useState(0);
  const keys = useRef(new Map<string, string>());
  const pairingAbort = useRef<AbortController | null>(null);
  const pairingCancelInFlight = useRef(false);
  const commandAbort = useRef<AbortController | null>(null);
  const snapshotAbort = useRef<AbortController | null>(null);
  const snapshotInFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async (signal?: AbortSignal, force = false) => {
    if (preview) return;
    if (snapshotInFlight.current && !force) return snapshotInFlight.current;
    if (force) snapshotAbort.current?.abort();
    const controller = new AbortController();
    snapshotAbort.current = controller;
    const bounded = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const task = getLocalFirstSnapshot(savedLabId, bounded).then(next => {
      if (mounted.current && !bounded.aborted) { setSnapshot(next); setFreshnessClock(Date.now()); }
    }).catch(failure => {
      if (!bounded.aborted) throw failure;
    });
    snapshotInFlight.current = task;
    try { await task; }
    finally { if (snapshotInFlight.current === task) snapshotInFlight.current = null;
      if (snapshotAbort.current === controller) snapshotAbort.current = null; }
  }, [preview, savedLabId]);

  const transition = useCallback((event: MyVmEvent): MyVmFlow => {
    if (flowRef.current.state === "idle" && ["PAIR", "ISSUE", "UNPAIR"].includes(event.type)) snapshotAbort.current?.abort();
    const next = nextMyVmFlow(flowRef.current, event);
    flowRef.current = next;
    if (mounted.current) setFlow(next);
    return next;
  }, []);
  function currentFlow(): MyVmFlow { return flowRef.current; }

  const cancelPairing = useCallback(async (alreadyDenied = false) => {
    if (flowRef.current.state !== "pairing") return;
    const startedAt = flowRef.current.startedAt;
    pairingAbort.current?.abort(); pairingAbort.current = null;
    commandAbort.current?.abort(); commandAbort.current = null;
    keys.current.clear(); transition({ type: "SETTLE" });
    setNotice(""); setError("");
    if (!alreadyDenied) {
      pairingCancelInFlight.current = true;
      setPairingCancelBusy(true);
      try {
        let requestId: string | null = null;
        for (let attempt = 0; attempt < 10 && !requestId; attempt += 1) {
          try {
            const saved = JSON.parse(window.localStorage.getItem("amniora:pairing-request:v1") ?? "null") as
              { requestId?: string; at?: number } | null;
            if (saved && /^par_[A-Za-z0-9_-]{43}$/.test(saved.requestId ?? "") &&
                Number(saved.at) >= startedAt) requestId = saved.requestId ?? null;
          } catch { /* Storage is optional; malformed cross-tab state never grants authority. */ }
          if (!requestId && attempt < 9) await new Promise(resolve => window.setTimeout(resolve, 200));
        }
        if (requestId) {
          await cancelLocalFirstPairing(requestId);
          try { window.localStorage.setItem("amniora:pairing-outcome:v1",
            JSON.stringify({ outcome: "denied", requestId, at: Date.now() })); }
          catch { /* Optional cross-tab signal. */ }
          setNotice("Connection cancelled. You can connect again now.");
        } else setNotice("Connection cancelled here. If the approval tab opened, cancel it there before retrying.");
      } catch (failure) {
        if (failure instanceof LocalFirstBrowserError && failure.code === "PAIRING_REPLAYED") {
          setNotice("The approval had already continued. Checking whether Runner connected…");
        } else { setError("UNAVAILABLE");
          setNotice("The connection request may still be pending. Cancel it in the approval tab or retry shortly."); }
      }
      finally { pairingCancelInFlight.current = false;
        try { window.localStorage.removeItem("amniora:pairing-request:v1"); } catch { /* Optional storage. */ }
        if (mounted.current) setPairingCancelBusy(false); }
    } else { try { window.localStorage.removeItem("amniora:pairing-request:v1"); } catch { /* Optional storage. */ } }
    void refresh(undefined, true).catch(() => undefined);
  }, [refresh, transition]);

  useEffect(() => {
    mounted.current = true;
    if (preview) return () => { mounted.current = false; };
    const controller = new AbortController();
    void refresh(controller.signal).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof LocalFirstBrowserError ? failure.code : "UNAVAILABLE");
    });
    return () => { mounted.current = false; controller.abort(); snapshotAbort.current?.abort();
      pairingAbort.current?.abort(); commandAbort.current?.abort(); };
  }, [preview, refresh]);

  useEffect(() => {
    if (preview) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && flowRef.current.state === "idle") void refresh().catch(() => undefined);
    }, 25_000);
    const onVisible = () => { if (document.visibilityState === "visible" && flowRef.current.state === "idle") void refresh().catch(() => undefined); };
    const onPairingOutcome = (event: StorageEvent) => {
      if (event.key !== "amniora:pairing-outcome:v1" || !event.newValue || flowRef.current.state !== "pairing") return;
      try {
        const outcome = JSON.parse(event.newValue) as { outcome?: string; at?: number };
        if (outcome.outcome === "denied" && Number(outcome.at) >= flowRef.current.startedAt) void cancelPairing(true);
      } catch { /* Ignore malformed cross-tab signals; server polling remains authoritative. */ }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onPairingOutcome);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onPairingOutcome); };
  }, [preview, refresh, cancelPairing]);

  useEffect(() => {
    const deadlines = [snapshot?.runner?.readinessExpiresAt, snapshot?.runner?.presenceExpiresAt]
      .filter((value): value is string => !!value).map(Date.parse).filter(Number.isFinite);
    if (preview || deadlines.length === 0) return;
    const deadline = Math.min(...deadlines.filter(value => value >= Date.now()));
    if (!Number.isFinite(deadline)) return;
    const updateClock = () => setFreshnessClock(Date.now());
    const timer = window.setTimeout(updateClock, Math.max(0, deadline - Date.now() + 1));
    document.addEventListener("visibilitychange", updateClock);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", updateClock); };
  }, [preview, snapshot?.runner?.readinessExpiresAt, snapshot?.runner?.presenceExpiresAt, freshnessClock]);

  useEffect(() => {
    if (flow.state !== "awaiting_activation") return;
    const requestId = flow.action.requestId;
    const timer = window.setTimeout(() => {
      const current = flowRef.current;
      if (current.state !== "awaiting_activation" || current.action.requestId !== requestId) return;
      keys.current.delete(current.scope); transition({ type: "SETTLE" });
      setNotice(""); setError("COMMAND_EXPIRED");
      void refresh(undefined, true).catch(() => undefined);
    }, Math.max(0, Date.parse(flow.action.expiresAt) - Date.now() + 100));
    return () => window.clearTimeout(timer);
  }, [flow, refresh, transition]);

  async function connectRunner() {
    if (preview || flowRef.current.state !== "idle" || pairingCancelInFlight.current) return;
    try { window.localStorage.removeItem("amniora:pairing-request:v1"); } catch { /* Optional storage. */ }
    const startedAt = Date.now(); transition({ type: "PAIR", now: startedAt });
    const controller = new AbortController(); pairingAbort.current = controller;
    setError(""); setNotice("Opening Amniora Runner…");
    try {
      openRunnerForPairing();
      const deadline = startedAt + 125_000;
      while (Date.now() < deadline && !controller.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 1_000));
        if (controller.signal.aborted || currentFlow().state !== "pairing") return;
        const next = await getLocalFirstSnapshot(savedLabId, controller.signal);
        if (!mounted.current || controller.signal.aborted || currentFlow().state !== "pairing") return;
        setSnapshot(next);
        if (next.paired) { try { window.localStorage.removeItem("amniora:pairing-request:v1"); }
          catch { /* Optional storage. */ } setNotice("Runner connected ✓"); return; }
      }
      if (!controller.signal.aborted) { try { window.localStorage.removeItem("amniora:pairing-request:v1"); }
        catch { /* Optional storage. */ } setNotice(""); setError("RUNNER_DID_NOT_RESPOND"); }
    } catch (failure) {
      if (!controller.signal.aborted) { setNotice(""); setError(failure instanceof LocalFirstBrowserError ? failure.code : "UNAVAILABLE"); }
    }
    finally { if (pairingAbort.current === controller) pairingAbort.current = null;
      const current = currentFlow();
      if (mounted.current && current.state === "pairing" && current.startedAt === startedAt) transition({ type: "SETTLE" }); }
  }

  function openedNotice(operation: ProductOperation): string {
    return operation === "STATUS" ? "Runner opened. Waiting for its signed readiness report…" :
      operation === "LAUNCH" ? "Runner opened. Starting the lab inside your VM…" :
      operation === "OPEN_LAB" ? "Runner opened. The isolated lab viewer will appear when the runtime is verified." :
      operation === "RESET" ? "Runner opened. Resetting to a new lab generation…" : "Runner opened. Stopping this lab…";
  }

  async function awaitCommand(action: ProductAction, scope: string) {
    const operation = action.operation;
    const controller = new AbortController(); commandAbort.current = controller;
    try {
      const deadline = Math.max(new Date(action.expiresAt).getTime() + 30_000, Date.now() + 150_000);
      const automaticActivationDeadline = Date.now() + 12_000;
      let transientFailures = 0;
      while (Date.now() < deadline && !controller.signal.aborted) {
        let status: ProductCommandStatus;
        try { status = await getLocalFirstCommandStatus(savedLabId, action.requestId, controller.signal); transientFailures = 0; }
        catch (failure) {
          if (controller.signal.aborted) return;
          if (++transientFailures >= 3) throw failure;
          await new Promise(resolve => setTimeout(resolve, 1_000));
          continue;
        }
        if (!mounted.current || controller.signal.aborted || flowRef.current.state !== "awaiting_result" ||
            flowRef.current.action.requestId !== action.requestId) return;
        if (status.state === "cancelled") {
          keys.current.delete(scope); setNotice(""); setError("COMMAND_EXPIRED");
          await refresh(controller.signal, true);
          return;
        }
        if (status.state === "issued" && Date.now() >= automaticActivationDeadline) {
          transition({ type: "ACTIVATION_NOT_OBSERVED", requestId: action.requestId });
          setNotice("Runner did not open automatically. Choose Open Runner to retry this same command.");
          return;
        }
        if (status.state === "completed") {
          keys.current.delete(scope);
          await refresh(controller.signal, true);
          if (!status.ok) { setNotice(""); setError(status.code ?? "RUNNER_DID_NOT_RESPOND"); }
          else setNotice(operation === "STATUS" ? "Runner status refreshed." :
          operation === "LAUNCH" ? "Lab running." : operation === "RESET" ? "Lab reset with a fresh generation." :
          operation === "STOP" ? "Lab stopped." : "Open Lab sent to Runner.");
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
      if (!controller.signal.aborted) { setNotice(""); setError("RUNNER_DID_NOT_RESPOND"); }
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof LocalFirstBrowserError ? failure.code : "UNAVAILABLE"); }
    finally { keys.current.delete(scope); if (commandAbort.current === controller) commandAbort.current = null;
      if (mounted.current && flowRef.current.state === "awaiting_result" &&
          flowRef.current.action.requestId === action.requestId) transition({ type: "SETTLE" }); }
  }

  async function command(operation: ProductOperation) {
    if (preview || flowRef.current.state !== "idle") return;
    setError(""); setNotice(""); setConfirmReset(false); setConfirmStop(false);
    const scope = `${operation}:${snapshot?.lab.state ?? "unknown"}`;
    transition({ type: "ISSUE", operation, scope });
    const key = keys.current.get(scope) ?? crypto.randomUUID(); keys.current.set(scope, key);
    try {
      const action = await issueLocalFirstAction(savedLabId, operation, key);
      const current = currentFlow();
      if (!mounted.current || current.state !== "issuing" || current.scope !== scope) return;
      const uri = runnerActivationUri(action);
      transition({ type: "ISSUED", action, scope });
      if (uri) {
        const activated = activateRunner(action);
        transition({ type: "ACTIVATE", now: Date.now() });
        setNotice(activated ? openedNotice(operation) : "This command was already accepted. Refreshing its authoritative result…");
        await awaitCommand(action, scope);
        return;
      }
      transition({ type: "ACTIVATE", now: Date.now() });
      setNotice("This command was already accepted. Refreshing its authoritative result…");
      await awaitCommand(action, scope);
    } catch (failure) { keys.current.delete(scope); setError(failure instanceof LocalFirstBrowserError ? failure.code : "UNAVAILABLE");
      if (["issuing", "awaiting_activation"].includes(currentFlow().state)) transition({ type: "SETTLE" }); }
  }

  function openPendingRunner() {
    const pending = flowRef.current;
    if (pending.state !== "awaiting_activation") return;
    try {
      const activated = activateRunner(pending.action);
      transition({ type: "ACTIVATE", now: Date.now() });
      window.setTimeout(() => {
        if (!mounted.current || flowRef.current.state !== "awaiting_result" ||
            flowRef.current.action.requestId !== pending.action.requestId) return;
        setError("");
        setNotice(activated ? openedNotice(pending.action.operation) :
          "This command was already accepted. Refreshing its authoritative result…");
        void awaitCommand(pending.action, pending.scope);
      }, 0);
    } catch (failure) { setError(failure instanceof LocalFirstBrowserError ? failure.code : "UNAVAILABLE"); }
  }

  async function cancelPendingRunner() {
    const current = flowRef.current;
    if (current.state !== "awaiting_activation" || cancelBusy) return;
    setCancelBusy(true); setError(""); setNotice("Cancelling unopened Runner request…");
    try {
      await cancelLocalFirstCommand(savedLabId, current.action.requestId);
      if (flowRef.current.state !== "awaiting_activation" ||
          flowRef.current.action.requestId !== current.action.requestId) return;
      keys.current.delete(current.scope); transition({ type: "SETTLE" });
      setNotice("Command cancelled. You can retry now.");
      void refresh(undefined, true).catch(() => undefined);
    } catch (failure) {
      if (flowRef.current.state !== "awaiting_activation" ||
          flowRef.current.action.requestId !== current.action.requestId) return;
      if (failure instanceof LocalFirstBrowserError && failure.code === "OPERATION_IN_PROGRESS") {
        transition({ type: "ACTIVATE", now: Date.now() });
        setNotice("Runner already accepted this command. Waiting for its result…");
        void awaitCommand(current.action, current.scope);
      } else { setNotice(""); setError(failure instanceof LocalFirstBrowserError ? failure.code : "UNAVAILABLE"); }
    } finally { if (mounted.current) setCancelBusy(false); }
  }

  async function unpair() {
    if (preview || flowRef.current.state !== "idle") return;
    transition({ type: "UNPAIR" }); setError("");
    try { await unpairLocalFirstRunner(savedLabId, crypto.randomUUID()); setConfirmUnpair(false);
      await refresh(undefined, true); setNotice("Runner unpaired."); }
    catch (failure) { setError(failure instanceof LocalFirstBrowserError ? failure.code : "UNAVAILABLE"); }
    finally { if (mounted.current && currentFlow().state === "unpairing") transition({ type: "SETTLE" }); }
  }

  if (!snapshot && !error) return <p className="type-body mt-space-4 text-slate-400">Checking Runner status…</p>;
  if (!snapshot?.enabled && !preview) return <p className="type-body mt-space-4 text-slate-400">My VM is not available yet.</p>;
  const paired = snapshot?.paired === true;
  const readinessFresh = preview ? snapshot?.runner?.readiness === "ready" : runnerReadinessIsFresh(snapshot, freshnessClock);
  const presenceFresh = preview ? snapshot?.runner?.presence === "online" : runnerPresenceIsFresh(snapshot, freshnessClock);
  const ready = readinessFresh && snapshot?.virtualMachine?.state === "ready" &&
    snapshot.guestAgent?.state === "ready" && snapshot.docker?.state === "ready";
  const vmNotConfigured = readinessFresh && snapshot?.failure === "VM_NOT_CONFIGURED";
  const running = snapshot?.runtime.state === "running";
  const busy = flow.state === "pairing" ? "PAIR" : flow.state === "unpairing" ? "UNPAIR" :
    flow.state === "issuing" ? flow.operation : flow.state === "awaiting_result" ? flow.action.operation : null;
  const pendingActivation = flow.state === "awaiting_activation" ? flow : null;
  const ownerBusy = snapshot?.pendingCommand !== null && snapshot?.pendingCommand !== undefined;
  const otherLab = snapshot?.otherActiveLab;
  const stateMessage = error || snapshot?.failure || (!preview && paired && !presenceFresh ? "RUNNER_DID_NOT_RESPOND" :
    !preview && !readinessFresh ? "STATUS_STALE" : "") || "";

  return <div className="mt-space-4" data-my-vm-panel data-my-vm-preview={previewState ?? undefined}>
    {preview && <p className="type-caption mb-space-4 border-l border-cyan-100/20 pl-space-3 text-cyan-100">Development preview: simulated local-first Runner state ({previewScenarioLabel(previewState)}). Controls do not execute commands.</p>}
    {(stateMessage || notice) && <div className="mb-space-4 border-l border-cyan-100/20 pl-space-3" role="status" aria-live="polite"><p className="type-body font-semibold text-white">{stateMessage === "STATUS_STALE" ? "Readiness not recent" : error ? "Unable to complete operation" : notice ? "My VM" : snapshot?.lab.state === "stopped" ? "Lab stopped" : "My VM status"}</p><p className="type-body mt-1 text-slate-300">{notice || messages[stateMessage] || "Refresh status for diagnostics or retry the action."}</p></div>}
    {!paired ? <div className="rounded-[3px] border border-cyan-300/20 bg-[#071426] p-space-4">
      <p className="type-body font-semibold text-white">Amniora Runner required</p>
      <p className="type-body mt-1 text-slate-300">Run labs securely using your own supported virtual machine.</p>
      <div className="mt-space-4 flex flex-wrap gap-space-2"><Button variant="secondary" className={secondary} disabled title="Public distribution is not available during the owner test">Download Runner</Button><Button className={primary} disabled={pairingCancelBusy} loading={busy === "PAIR"} loadingText="Waiting for approval" onClick={() => void connectRunner()}>Connect Runner</Button>{flow.state === "pairing" && <Button variant="secondary" className={secondary} onClick={() => void cancelPairing()}>Cancel waiting</Button>}</div>
      <p className="type-caption mt-space-3 text-slate-400">Owner test. Public Runner download is not available yet.</p>
    </div> : <>
      <div className="rounded-[3px] border border-cyan-300/20 bg-[#071426] p-space-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="type-body font-semibold text-white">Runner</p><p className="type-caption mt-1 text-slate-300">{snapshot?.runner?.name} · {snapshot?.runner?.fingerprint}</p></div><span className="type-caption text-cyan-100">{presenceFresh ? readinessFresh ? "Online · ready ✓" : "Online · readiness checks on action" : "Offline · opens on action"}</span></div>
        <div className="mt-space-4 grid gap-space-3 text-sm text-slate-300 sm:grid-cols-3">
          <div><p className="type-caption text-slate-400">Virtual machine</p><p className="mt-1">{vmNotConfigured ? "Not configured" : snapshot?.virtualMachine ? `${snapshot.virtualMachine.operatingSystem} ${snapshot.virtualMachine.architecture}` : "Checked on next action"}{readinessFresh && snapshot?.virtualMachine?.state === "ready" ? " ✓" : ""}</p></div>
          <div><p className="type-caption text-slate-400">Guest agent</p><p className="mt-1">{vmNotConfigured ? "Not configured" : readinessFresh && snapshot?.guestAgent?.state === "ready" ? "Ready ✓" : "Checked on next action"}</p></div>
          <div><p className="type-caption text-slate-400">Docker</p><p className="mt-1">{snapshot?.docker?.version ? `${snapshot.docker.version} · ` : ""}{vmNotConfigured ? "Not configured" : readinessFresh && snapshot?.docker?.state === "ready" ? "Ready ✓" : "Checked on next action"}</p></div>
        </div>
        <div className="mt-space-4 border-t border-white/10 pt-space-3"><p className="type-caption text-slate-400">Lab</p><p className="type-body mt-1 font-semibold text-white">{snapshot?.lab.name}</p><p className="type-caption mt-1 text-cyan-100">{running ? "Running ✓" : snapshot?.runtime.state === "idle" ? "Idle" : snapshot?.runtime.state.replace("_", " ")}{snapshot?.runtime.generation ? ` · Generation ${snapshot.runtime.generation}` : ""}</p></div>
      </div>
      {otherLab && <p className="type-body mt-space-4 border-l border-amber-300/50 pl-space-3 text-amber-100">{otherLab.name} is active on this Runner. <a className="underline underline-offset-2" href={`/dashboard/saved/${encodeURIComponent(otherLab.savedLabId)}`}>Open that Saved Investigation</a> to stop it before launching this lab.</p>}
      {ownerBusy && flow.state === "idle" && <p className="type-body mt-space-4 border-l border-cyan-300/30 pl-space-3 text-slate-300">{snapshot?.pendingCommand?.operation.replace("_", " ")} is {snapshot?.pendingCommand?.state === "redeemed" ? "running in Runner" : "waiting to be opened in Runner"}. Other lab commands are locked until it completes; Refresh status remains available for recovery.</p>}
      <div className="mt-space-4 flex flex-wrap gap-space-2">
        {busy && <Button className={primary} loading loadingText={busy === "STATUS" ? "Checking Runner" : busy === "UNPAIR" ? "Unpairing" : `${busy.replace("_", " ")} in progress`}>Please wait</Button>}
        {!busy && pendingActivation && <><Button className={primary} disabled={cancelBusy} onClick={openPendingRunner}>Open Runner</Button><Button variant="secondary" className={secondary} loading={cancelBusy} loadingText="Cancelling" onClick={() => void cancelPendingRunner()}>Cancel command</Button></>}
        {!busy && !pendingActivation && <Button variant="secondary" className={secondary} onClick={() => void command("STATUS")}>Refresh status</Button>}
        {!busy && !pendingActivation && !running && !otherLab && !ownerBusy && <Button className={primary} onClick={() => void command("LAUNCH")}>Launch Lab</Button>}
        {!busy && !pendingActivation && running && !ownerBusy && <Button className={primary} onClick={() => void command("OPEN_LAB")}>Open Lab</Button>}
        {!busy && !pendingActivation && running && !ownerBusy && !confirmReset && <Button variant="secondary" className={secondary} onClick={() => { setConfirmReset(true); setConfirmStop(false); }}>Reset</Button>}
        {!busy && !pendingActivation && running && !ownerBusy && !confirmReset && !confirmStop && <Button variant="ghost" className="rounded-[4px] !text-slate-200 hover:!bg-white/10 hover:!text-white" onClick={() => setConfirmStop(true)}>Stop</Button>}
        {!busy && !pendingActivation && !running && !otherLab && !ownerBusy && !confirmReset && !confirmStop && <Button variant="ghost" className="rounded-[4px] !text-slate-300 hover:!bg-white/10" onClick={() => setConfirmUnpair(true)}>Unpair</Button>}
      </div>
      {confirmReset && running && !ownerBusy && <div role="group" aria-label="Confirm lab reset" className="mt-space-4 border-t border-white/10 pt-space-4"><p className="type-body font-semibold text-white">Reset lab?</p><p className="type-body mt-1 text-slate-300">The current viewer will close and only the fresh generation can be opened.</p><div className="mt-space-3 flex gap-space-2"><Button variant="secondary" className={secondary} onClick={() => setConfirmReset(false)}>Cancel</Button><Button variant="destructive" className="rounded-[4px]" onClick={() => void command("RESET")}>Reset Lab</Button></div></div>}
      {confirmStop && running && !ownerBusy && <div role="group" aria-label="Confirm lab stop" className="mt-space-4 border-t border-white/10 pt-space-4"><p className="type-body font-semibold text-white">Stop this lab?</p><p className="type-body mt-1 text-slate-300">This removes the lab’s temporary VM resources and in-lab progress. Your Saved Investigation stays intact.</p><div className="mt-space-3 flex gap-space-2"><Button variant="secondary" className={secondary} onClick={() => setConfirmStop(false)}>Cancel</Button><Button variant="destructive" className="rounded-[4px]" onClick={() => void command("STOP")}>Stop Lab</Button></div></div>}
      {confirmUnpair && <div role="group" aria-label="Confirm Runner unpair" className="mt-space-4 border-t border-white/10 pt-space-4"><p className="type-body font-semibold text-white">Unpair this Runner?</p><p className="type-body mt-1 text-slate-300">Future commands will be rejected until you pair again.</p><div className="mt-space-3 flex gap-space-2"><Button variant="secondary" className={secondary} onClick={() => setConfirmUnpair(false)}>Cancel</Button><Button variant="destructive" className="rounded-[4px]" onClick={() => void unpair()}>Unpair Runner</Button></div></div>}
      <p className="type-caption mt-space-4 text-slate-400">{vmNotConfigured ? "No supported Ubuntu VM is configured on this computer." : "Use the website for Launch, Open Lab, Reset, and Stop. Each action opens Runner when needed and checks the Ubuntu VM, Guest Agent, and Docker before continuing. Refresh status is optional diagnostics. Stop the lab before unpairing."}</p>
      <p className="type-caption mt-space-4 text-slate-400">Trusted My VM Web Security grading is not yet available. The website never receives your VM address or local runtime target.</p>
    </>}
    <SavedLabMyVmSetup key={ready || snapshot?.lab.state === "running" ? "ready" : "setup"} snapshot={snapshot} presenceFresh={presenceFresh} statusFresh={readinessFresh}
      failure={stateMessage} busy={flow.state !== "idle" || pairingCancelBusy || ownerBusy || !!pendingActivation}
      onConnect={() => void connectRunner()} onCheck={() => void command("STATUS")}
      onLaunch={() => void command("LAUNCH")} />
  </div>;
}
