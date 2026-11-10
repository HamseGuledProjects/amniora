"use client";

import { useState } from "react";
import Button from "@/app/components/ui/Button";
import type { ProductSnapshot } from "@/lib/web-lab/local-first-product/contract";
import {
  GUEST_INSTALL_COMMANDS, myVmSetupState, myVmSetupTroubleshooting,
} from "@/lib/web-lab/local-first-product/setup-guide";

const actionClass = "rounded-[4px] border-white/15 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a]";

type Props = {
  snapshot: ProductSnapshot | null;
  presenceFresh: boolean;
  statusFresh: boolean;
  failure: string;
  busy: boolean;
  onConnect: () => void;
  onCheck: () => void;
  onLaunch: () => void;
};

export default function SavedLabMyVmSetup({ snapshot, presenceFresh, statusFresh, failure, busy,
  onConnect, onCheck, onLaunch }: Props) {
  const state = myVmSetupState(snapshot, presenceFresh, statusFresh);
  const [expanded, setExpanded] = useState(!state.ready && !state.firstLabRunning);
  const [vmInstructions, setVmInstructions] = useState(false);
  const [copied, setCopied] = useState("");
  const needsFreshCheck = state.connected && !statusFresh;
  const staleGuidance = <p>Readiness is not recent. The next lab action checks this component automatically; Refresh status is optional diagnostics.</p>;

  async function copyCommand(label: string, command: string) {
    try { await navigator.clipboard.writeText(command); setCopied(`${label} copied`); }
    catch { setCopied(`Could not copy ${label}. Select the command text instead.`); }
  }

  function commandBlock(label: string, command: string) {
    return <div key={label} className="mt-space-2 rounded-[3px] border border-white/10 bg-[#04111e] p-space-3">
      <div className="flex flex-wrap items-start justify-between gap-space-2">
        <div className="min-w-0 flex-1"><p className="type-caption text-slate-300">{label}</p>
          <code className="mt-1 block select-text break-all font-mono text-xs text-white">{command}</code></div>
        <Button variant="secondary" className={actionClass} aria-label={`Copy ${label} command`}
          onClick={() => void copyCommand(label, command)}>Copy command</Button>
      </div>
    </div>;
  }

  const steps = [
    { title: "Install Amniora Runner", done: state.runnerVerified,
      body: <><p>Amniora Runner is required to run labs on your own VM. During this owner test, use only a reviewed Mac or Windows build supplied through the private handoff. There is no public installer yet.</p>
        <Button variant="secondary" className={`${actionClass} mt-space-2`} disabled title="Public distribution is not available during the owner test">Download Runner</Button></> },
    { title: "Create or start a supported Ubuntu VM", done: state.vmReady,
      body: needsFreshCheck ? staleGuidance : <><p>Use Ubuntu 24.04. Reviewed owner-test paths use a Mac ARM64 host with an Ubuntu ARM64 VM or a Windows x64 host with an Ubuntu AMD64 VirtualBox VM. The supplied CPU and memory settings are validated test settings, not certified minimums.</p>
        <Button variant="secondary" className={`${actionClass} mt-space-2`} aria-expanded={vmInstructions}
          aria-controls="my-vm-virtualbox-setup" onClick={() => setVmInstructions(value => !value)}>View VM setup instructions</Button>
        {vmInstructions && <div id="my-vm-virtualbox-setup" className="mt-space-3 border-l border-cyan-300/30 pl-space-3">
          <p>Use the reviewed private handoff for the host-specific VirtualBox and Ubuntu 24.04 configuration. The VM uses its normal internet adapter plus the preconfigured Amniora private adapter. A new VM must use the reviewed owner-test network configuration before Runner can reach it.</p>
          <p className="mt-space-2">Keep the VM running while using a lab. Other hypervisors are not part of this owner test.</p>
        </div>}</> },
    { title: "Install the Amniora Guest Agent", done: state.guestReady,
      body: needsFreshCheck ? staleGuidance : <><p>Attach the reviewed Phase 4 Guest Agent ISO to the Ubuntu VM as a virtual optical disc. In an Ubuntu Terminal opened in the mounted media folder, run the checks below in order. These commands run <strong>inside Ubuntu, not on your Mac</strong>.</p>
        {commandBlock("Verify the reviewed media", GUEST_INSTALL_COMMANDS.verify)}
        {commandBlock("Install the Guest Agent and signed runtime image", GUEST_INSTALL_COMMANDS.install)}
        <p className="mt-space-2">The installer chooses the VM architecture and checks the included artifact and image hashes. It deliberately does not enable the Guest Agent before the one-time VM-to-Runner pairing. That pairing still needs the reviewed owner-test handoff; the website cannot safely replace it.</p>
        <p className="mt-space-2">After that pairing is complete, activate the service in Ubuntu:</p>
        {commandBlock("Enable the paired Guest Agent", GUEST_INSTALL_COMMANDS.enable)}</> },
    { title: "Ensure Docker is running", done: state.dockerReady,
      body: needsFreshCheck ? staleGuidance : <p>The Ubuntu VM needs Docker Engine installed with its system service active. The displayed version is diagnostic, not a certified minimum. If Docker is unavailable, start it inside Ubuntu and retry the lab action. The owner-test installer verifies and loads the reviewed runtime image; it does not install Docker.</p> },
    { title: "Connect Runner to Amniora", done: state.connected,
      body: <><p>Open Runner on this computer, connect it to your Amniora account, and approve the request in your browser. If you close the approval tab or cancel, retry from here.</p>
        <Button className={`${actionClass} mt-space-2`} disabled={busy} onClick={onConnect}>Connect Runner</Button></> },
    { title: "Confirm readiness", done: state.ready,
      body: <><p>Launch checks the VM, Guest Agent and Docker automatically. Use this optional control when you only want diagnostics.</p>
        {state.connected && <Button className={`${actionClass} mt-space-2`} disabled={busy} onClick={onCheck}>Refresh status</Button>}</> },
    { title: "Launch your first lab", done: state.firstLabRunning,
      body: <><p>When every readiness item says Ready, launch the lab from this Saved Investigation. The isolated viewer opens separately.</p>
        {state.connected && !state.firstLabRunning && <Button className={`${actionClass} mt-space-2`} disabled={busy} onClick={onLaunch}>Launch Lab</Button>}</> },
  ];
  const troubleshooting = myVmSetupTroubleshooting(failure);

  return <section className="mt-space-4 rounded-[3px] border border-cyan-300/20 bg-[#071426] p-space-4" aria-labelledby="my-vm-setup-title" data-my-vm-setup>
    <div className="flex flex-wrap items-center justify-between gap-space-2">
      <div><h3 id="my-vm-setup-title" className="type-body font-semibold text-white">My VM setup</h3>
        <p className="type-caption mt-1 text-slate-300">{state.firstLabRunning ? "A lab is running. Reopen this guide whenever you need it." : state.ready ? "Ready to run labs. Reopen this guide whenever you need it." : "Follow the steps below. Runner verifies readiness; no step is marked complete by guesswork."}</p></div>
      <Button variant="secondary" className={actionClass} aria-expanded={expanded} aria-controls="my-vm-setup-steps"
        onClick={() => setExpanded(value => !value)}>{expanded ? "Hide setup guide" : "Setup guide"}</Button>
    </div>
    {expanded && <div id="my-vm-setup-steps" className="mt-space-4 border-t border-white/10 pt-space-4">
      {troubleshooting && <p role="status" className="type-body mb-space-4 border-l border-amber-300/50 pl-space-3 text-amber-100">{troubleshooting}</p>}
      <ol className="space-y-space-3">{steps.map((step, index) => <li key={step.title} className="rounded-[3px] border border-white/10 p-space-3">
        <div className="flex items-start gap-space-2"><span className="type-caption shrink-0 text-cyan-100" aria-hidden="true">{step.done ? "✓" : `${index + 1}.`}</span>
          <div className="min-w-0"><h4 className="type-body font-semibold text-white">{step.title} <span className="type-caption font-normal text-slate-300">{step.done ? ": Complete" : needsFreshCheck && index >= 1 && index <= 3 ? ": Checked on action" : ": To do"}</span></h4>
            {!step.done && <div className="type-caption mt-space-2 space-y-space-2 text-slate-300">{step.body}</div>}</div></div>
      </li>)}</ol>
      {copied && <p role="status" className="type-caption mt-space-3 text-cyan-100">{copied}</p>}
      <p className="type-caption mt-space-4 text-slate-400">Owner-only test. Do not install unreviewed media or use this as a public setup guide.</p>
    </div>}
  </section>;
}
