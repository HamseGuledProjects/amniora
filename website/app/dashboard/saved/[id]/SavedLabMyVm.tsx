"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/app/components/ui/Button";
import {
  createMyVmEnrollment, getMyVmSnapshot, mutateMyVm, openMyVm, submitMyVmOpen, MyVmBrowserError,
} from "@/lib/web-lab/byo-runner/browser-client";
import { createMyVmPreview } from "@/lib/web-lab/byo-runner/development-preview";
import type { MyVmEnrollment, MyVmRunner, MyVmSnapshot } from "@/lib/web-lab/byo-runner/product-contract";

const primary = "rounded-[4px] border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white";
const secondary = "rounded-[4px] border-white/10 bg-[#081827] text-slate-300 hover:border-cyan-300/35 hover:bg-[#0b2033] hover:text-white";
const messages: Record<string, string> = { RUNNER_NOT_FOUND: "That VM is no longer connected to your account.", RUNNER_OFFLINE: "Connection lost. Amniora will recover its status when Runner reconnects.", RUNNER_INCOMPATIBLE: "Update required before this lab can start.", RUNTIME_NOT_READY: "The lab is not ready to open yet.", ENROLLMENT_EXPIRED: "That one-time setup command expired. Create a new one to connect your VM.", UNAVAILABLE: "My VM is temporarily unavailable. Try again shortly." };

export default function SavedLabMyVm({ savedLabId, previewState }: { savedLabId: string; previewState?: string | null }) {
  const [preview] = useState(() => createMyVmPreview(previewState));
  const [snapshot, setSnapshot] = useState<MyVmSnapshot | null>(preview);
  const [selected, setSelected] = useState("");
  const [enrollment, setEnrollment] = useState<MyVmEnrollment | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const keys = useRef(new Map<string, string>());
  const work = useRef(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  async function refresh(signal?: AbortSignal) {
    if (preview) return;
    try {
      const value = await getMyVmSnapshot(savedLabId, signal); setSnapshot(value);
      setSelected(current => current || value.runners[0]?.runnerKey || "");
      if (value.runners.length > 0) setEnrollment(null);
      setError("");
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof MyVmBrowserError ? failure.code : "UNAVAILABLE"); }
  }
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    void getMyVmSnapshot(savedLabId, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setSnapshot(value); setSelected(current => current || value.runners[0]?.runnerKey || "");
      if (value.runners.length > 0) setEnrollment(null);
      setError("");
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof MyVmBrowserError ? failure.code : "UNAVAILABLE"); });
    return () => controller.abort();
  }, [savedLabId, preview]);
  useEffect(() => {
    if (preview || (!enrollment && !snapshot?.runners.some(runner => ["offline", "reconnecting"].includes(runner.state) || ["starting", "resetting", "stopping"].includes(runner.labState)))) return;
    const timer = setInterval(() => void refresh(), 2_000); return () => clearInterval(timer);
  }, [snapshot, preview, enrollment]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enrollment || preview) return;
    const timer = setTimeout(() => { setEnrollment(null); setError("ENROLLMENT_EXPIRED"); },
      Math.max(0, new Date(enrollment.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [enrollment, preview]);
  useEffect(() => { if (confirmReset) cancelButton.current?.focus(); }, [confirmReset]);

  const runner: MyVmRunner | undefined = snapshot?.runners.find(item => item.runnerKey === selected) ?? snapshot?.runners[0];
  async function enroll() {
    if (preview || work.current) return; work.current = true; setBusy("Connecting VM"); setError("");
    try { setEnrollment(await createMyVmEnrollment(savedLabId)); } catch (failure) { setError(failure instanceof MyVmBrowserError ? failure.code : "UNAVAILABLE"); }
    finally { work.current = false; setBusy(""); }
  }
  async function action(name: "launch" | "reset" | "stop" | "disconnect") {
    if (preview || !runner || work.current) return; work.current = true; setBusy(name === "launch" ? "Starting Lab" : name === "reset" ? "Resetting" : name === "disconnect" ? "Disconnecting" : "Stopping"); setError(""); setConfirmReset(false); setConfirmDisconnect(false);
    const scope = `${name}:${runner.runnerKey}:${runner.generation ?? 0}`;
    const key = keys.current.get(scope) ?? crypto.randomUUID(); keys.current.set(scope, key);
    try { await mutateMyVm(savedLabId, name, runner.runnerKey, key); keys.current.delete(scope); await refresh(); }
    catch (failure) { setError(failure instanceof MyVmBrowserError ? failure.code : "UNAVAILABLE"); }
    finally { work.current = false; setBusy(""); }
  }
  async function open() {
    if (preview || !runner || work.current) return; work.current = true; setError("");
    try { submitMyVmOpen(await openMyVm(savedLabId, runner.runnerKey)); }
    catch (failure) { setError(failure instanceof MyVmBrowserError ? failure.code : "UNAVAILABLE"); }
    finally { work.current = false; }
  }

  if (!snapshot && !preview) return <p className="type-body mt-space-4 text-slate-400">Checking VM status…</p>;
  if (!snapshot?.enabled && !preview) return <p className="type-body mt-space-4 text-slate-400">My VM is not available yet.</p>;
  return <div className="mt-space-4" data-my-vm-panel data-my-vm-preview={previewState ?? undefined}>
    {preview && <p className="type-caption mb-space-4 border-l border-cyan-100/20 pl-space-3 text-cyan-100">Development preview: simulated VM state. Controls do not connect, disconnect, launch, reset, stop or open a runtime.</p>}
    {error && <div className="mb-space-3 border-l border-rose-300/40 pl-space-3" role="status"><p className="type-body font-semibold text-white">Unable to complete operation</p><p className="type-body text-slate-300">{messages[error] ?? "The operation could not be completed safely. Refresh the VM status and try again."}</p></div>}
    {!runner ? <div className="rounded-[3px] border border-cyan-300/20 bg-[#071426] p-space-4">
      <p className="type-body font-semibold text-white">{enrollment ? "Waiting for your VM…" : "Connect your VM"}</p>
      <p className="type-body mt-1 text-slate-300">Install Amniora Runner on a supported Ubuntu VM and connect it to your account.</p>
      <ol className="type-body mt-space-3 list-decimal space-y-1 pl-5 text-slate-300"><li>Open a terminal on your Ubuntu VM.</li><li>Copy the command below.</li><li>Run it once.</li><li>Return here while Runner connects.</li></ol>
      {enrollment && <div className="mt-space-3"><label className="type-caption text-slate-300" htmlFor="vm-enrollment-command">One-time setup command</label><textarea id="vm-enrollment-command" readOnly value={enrollment.command} rows={3} className="mt-1 w-full resize-none rounded-[3px] border border-white/10 bg-[#04101d] p-3 font-mono text-xs text-slate-200"/><p className="type-caption mt-1 text-slate-400">This enrollment expires shortly and can be used once. Runner connects outbound; no SSH or cloud credentials are needed.</p></div>}
      <div className="mt-space-3 flex flex-wrap gap-space-2">{!enrollment && <Button className={primary} onClick={() => void enroll()} disabled={!!busy}>{busy || "Connect VM"}</Button>}{enrollment && <Button variant="secondary" className={secondary} onClick={() => navigator.clipboard.writeText(enrollment.command)}>Copy install command</Button>}<Button variant="secondary" className={secondary} onClick={() => void refresh()}>Check connection</Button></div>
    </div> : <>
      <div className="rounded-[3px] border border-cyan-300/20 bg-[#071426] p-space-4">
        {snapshot!.runners.length > 1 && <select aria-label="Connected VM" value={runner.runnerKey} onChange={event => setSelected(event.target.value)} className="mb-space-3 w-full rounded-[3px] border border-white/10 bg-[#081827] p-2 text-slate-200">{snapshot!.runners.map(item => <option key={item.runnerKey} value={item.runnerKey}>{item.displayName}</option>)}</select>}
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="type-body font-semibold text-white">{runner.displayName}</p><p className="type-caption mt-1 text-slate-300">{runner.platform} · {runner.architecture} · Runner {runner.version}</p></div><span className="type-caption text-cyan-100">{runner.state === "connected" ? "Runner online" : runner.state === "offline" ? "Connection lost" : runner.state === "reconnecting" ? "Reconnect" : "Update required"}</span></div>
        <div className="mt-space-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-3"><span>Docker {runner.dockerAvailable ? "ready" : "unavailable"}</span><span>Lab {runner.labState}</span><span>{runner.lastSeenAt ? `Last seen ${new Date(runner.lastSeenAt).toLocaleString()}` : "Not seen yet"}</span></div>
      </div>
      {runner.state === "incompatible" && <div className="mt-space-4 rounded-[3px] border border-amber-200/20 bg-[#18170f] p-space-4"><p className="type-body font-semibold text-white">Update required</p><p className="type-body mt-1 text-slate-300">Run the verified update command on your VM. Your Runner identity is preserved.</p><textarea aria-label="Runner update command" readOnly rows={3} value={snapshot!.distribution.updateCommand} className="mt-space-3 w-full resize-none rounded-[3px] border border-white/10 bg-[#0c120f] p-3 font-mono text-xs text-slate-200"/><Button variant="secondary" className={`${secondary} mt-space-3`} onClick={() => navigator.clipboard.writeText(snapshot!.distribution.updateCommand)}>Copy update command</Button></div>}
      <div className="mt-space-4 flex flex-wrap gap-space-2">
        {busy && <Button className={primary} loading loadingText={busy}>Please wait</Button>}
        {!busy && runner.state === "connected" && runner.labState === "ready" && <Button className={primary} onClick={() => void open()}>Open Lab</Button>}
        {!busy && runner.state === "connected" && ["idle", "expired", "failed"].includes(runner.labState) && <Button className={primary} onClick={() => void action("launch")}>Launch Lab</Button>}
        {!busy && <Button variant="secondary" className={secondary} onClick={() => void refresh()}>Refresh Status</Button>}
        {!busy && runner.labState === "ready" && !confirmReset && <Button ref={resetButton} variant="secondary" className={secondary} onClick={() => setConfirmReset(true)}>Reset</Button>}
        {!busy && ["ready", "failed"].includes(runner.labState) && !confirmReset && <Button variant="ghost" className="rounded-[4px] !text-slate-200 hover:!bg-white/10 hover:!text-white" onClick={() => void action("stop")}>Stop</Button>}
        {!busy && <Button variant="ghost" className="rounded-[4px] !text-slate-200 hover:!bg-white/10 hover:!text-white" onClick={() => { setShowRemove(value => !value); setConfirmDisconnect(false); }}>Remove Runner</Button>}
      </div>
      {confirmReset && <div role="group" aria-labelledby="my-vm-reset-title" className="mt-space-4 border-t border-white/10 pt-space-4" onKeyDown={event => { if (event.key === "Escape") { setConfirmReset(false); requestAnimationFrame(() => resetButton.current?.focus()); } }}><h3 id="my-vm-reset-title" className="type-body font-semibold text-white">Reset lab?</h3><p className="type-body mt-1 text-slate-300">This restores the lab state and invalidates the previous session. Your connected VM remains available.</p><div className="mt-space-3 flex gap-space-2"><Button ref={cancelButton} variant="secondary" className={secondary} onClick={() => { setConfirmReset(false); requestAnimationFrame(() => resetButton.current?.focus()); }}>Cancel</Button><Button variant="destructive" className="rounded-[4px]" onClick={() => void action("reset")}>Reset Lab</Button></div></div>}
      {showRemove && <div className="mt-space-4 border-t border-white/10 pt-space-4"><h3 className="type-body font-semibold text-white">Remove Runner</h3><p className="type-body mt-1 text-slate-300">Disconnect stops Amniora access. Uninstall removes the local software while preserving the durable identity unless you explicitly purge it.</p><textarea aria-label="Runner uninstall command" readOnly rows={2} value={snapshot!.distribution.uninstallCommand} className="mt-space-3 w-full resize-none rounded-[3px] border border-white/10 bg-[#04101d] p-3 font-mono text-xs text-slate-200"/><div className="mt-space-3 flex flex-wrap gap-space-2"><Button variant="secondary" className={secondary} onClick={() => navigator.clipboard.writeText(snapshot!.distribution.uninstallCommand)}>Copy uninstall command</Button>{!confirmDisconnect && <Button variant="destructive" className="rounded-[4px]" onClick={() => setConfirmDisconnect(true)}>Disconnect VM</Button>}</div>{confirmDisconnect && <div role="group" aria-label="Confirm disconnect" className="mt-space-3 border-l border-rose-300/30 pl-space-3"><p className="type-body text-slate-300">Disconnect this VM from your Amniora account?</p><div className="mt-space-2 flex gap-space-2"><Button variant="secondary" className={secondary} onClick={() => setConfirmDisconnect(false)}>Cancel</Button><Button variant="destructive" className="rounded-[4px]" onClick={() => void action("disconnect")}>Confirm disconnect</Button></div></div>}</div>}
    </>}
    <p className="type-caption mt-space-4 text-slate-400">Runs on your VM. Browser access uses Amniora&apos;s trusted relay; no VM address or public lab port is exposed.</p>
  </div>;
}
