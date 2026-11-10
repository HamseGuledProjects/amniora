import type { ProductSnapshot } from "./contract";

// These are the commands printed by the reviewed Phase 4 optical media and
// the post-pairing service activation used by the retained Ubuntu guest.
export const GUEST_INSTALL_COMMANDS = Object.freeze({
  verify: "sha256sum --check sha256.txt",
  install: "sudo ./install.sh",
  enable: "sudo systemctl enable --now amniora-guest-agent.service",
});

export function myVmSetupState(snapshot: ProductSnapshot | null, presenceFresh: boolean, statusFresh: boolean) {
  const paired = snapshot?.paired === true;
  // A past approved pairing proves installation even if presence later expires.
  const runnerVerified = paired;
  const vmReady = statusFresh && snapshot?.virtualMachine?.state === "ready";
  const guestReady = statusFresh && snapshot?.guestAgent?.state === "ready";
  const dockerReady = statusFresh && snapshot?.docker?.state === "ready";
  return {
    runnerVerified,
    vmReady,
    guestReady,
    dockerReady,
    connected: paired,
    ready: runnerVerified && presenceFresh && vmReady && guestReady && dockerReady,
    firstLabRunning: snapshot?.lab.state === "running",
  };
}

export function myVmSetupTroubleshooting(code: string): string | null {
  const guidance: Record<string, string> = {
    RUNNER_NOT_INSTALLED: "The owner-test Runner must be installed on this computer before connecting. A public download is not available yet.",
    RUNNER_UNPAIRED: "Open Runner, then connect it to this Amniora account.",
    RUNNER_DID_NOT_RESPOND: "Open Runner on this computer, then check again. If you closed the approval tab, cancel the waiting request before retrying.",
    VM_NOT_CONFIGURED: "No supported Ubuntu VM is configured on this computer yet. Complete the separate Windows W2 setup before trying to launch a lab.",
    VM_POWERED_OFF: "Start the supported Ubuntu VM, wait for it to finish booting, then check again.",
    GUEST_AGENT_UNAVAILABLE: "Start the Amniora Guest Agent inside Ubuntu, then check again. A fresh VM also needs one-time owner-test pairing.",
    DOCKER_UNAVAILABLE: "Start Docker inside Ubuntu, then check again. The owner-test VM must already have Docker Engine installed.",
    ARCHITECTURE_UNAVAILABLE: "This lab package does not match the VM architecture. Do not try to bypass package verification.",
    PACKAGE_INCOMPATIBLE: "This lab package does not match the VM architecture. Do not try to bypass package verification.",
    ANOTHER_LAB_ACTIVE: "Stop the other active My VM lab from its Saved Investigation before launching this one.",
    STATUS_STALE: "Readiness is not recent. The next lab action checks it automatically; Refresh status is optional diagnostics.",
    COMMAND_EXPIRED: "The unopened Runner request expired. Retry the original action.",
    PAIRING_REVOKED: "This Runner is no longer connected. Pair it again before sending commands.",
  };
  return guidance[code] ?? null;
}
