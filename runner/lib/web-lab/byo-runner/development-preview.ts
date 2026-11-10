import type { MyVmSnapshot } from "./product-contract";

export type MyVmPreviewState = "vm-connected" | "vm-offline" | "vm-ready" | "vm-starting" | "vm-reconnecting" | "vm-incompatible" | "vm-waiting";
export function parseMyVmPreview(value: unknown): MyVmPreviewState | null {
  if (process.env.NODE_ENV !== "development") return null;
  return ["vm-connected", "vm-offline", "vm-ready", "vm-starting", "vm-reconnecting", "vm-incompatible", "vm-waiting"].includes(String(value))
    ? value as MyVmPreviewState : null;
}
export function createMyVmPreview(value: unknown): MyVmSnapshot | null {
  const state = parseMyVmPreview(value); if (!state) return null;
  const distribution = {
    currentVersion: "1.0.0", minimumCompatibleVersion: "1.0.0", protocolVersion: "1.0",
    updateCommand: "Verified update command appears here.",
    uninstallCommand: "sudo /usr/local/sbin/amniora-runner-uninstall",
  };
  if (state === "vm-waiting") return { enabled: true, eligible: true, runners: [], distribution };
  return { enabled: true, eligible: true, distribution, runners: [{
    runnerKey: "preview-runner", displayName: "Ubuntu practice VM", platform: "Linux", architecture: "x64", version: "1.0.0",
    state: state === "vm-offline" ? "offline" : state === "vm-reconnecting" ? "reconnecting" : state === "vm-incompatible" ? "incompatible" : "connected",
    lastSeenAt: new Date(0).toISOString(), dockerAvailable: state !== "vm-incompatible",
    labState: state === "vm-ready" ? "ready" : state === "vm-starting" ? "starting" : "idle", generation: state === "vm-ready" ? 2 : null,
  }] };
}
