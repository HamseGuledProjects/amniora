import type { CloudSnapshot } from "./product-contract";

export type CloudPreviewState = "cloud-pro" | "cloud-starting" | "cloud-ready" |
  "cloud-capacity" | "cloud-expiring" | "cloud-unavailable" | "cloud-free";

export function parseCloudPreview(value: unknown): CloudPreviewState | null {
  if (process.env.NODE_ENV !== "development") return null;
  return ["cloud-pro", "cloud-starting", "cloud-ready", "cloud-capacity", "cloud-expiring",
    "cloud-unavailable", "cloud-free"].includes(String(value)) ? value as CloudPreviewState : null;
}

export function createCloudPreview(value: unknown): CloudSnapshot | null {
  const state = parseCloudPreview(value);
  if (!state) return null;
  const now = Date.now();
  const runtime = state === "cloud-starting" ? {
    state: "starting" as const, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 60_000).toISOString(),
    openAvailable: false, resetAvailable: false, stopAvailable: true,
  } : ["cloud-ready", "cloud-expiring"].includes(state) ? {
    state: "ready" as const, createdAt: new Date(now - 5 * 60_000).toISOString(),
    expiresAt: new Date(now + (state === "cloud-expiring" ? 8 : 25) * 60_000).toISOString(),
    openAvailable: true, resetAvailable: true, stopAvailable: true,
  } : null;
  return {
    enabled: true,
    eligible: true,
    plan: state === "cloud-free" ? "free" : "pro",
    availability: state === "cloud-free" ? "plan_required" : state === "cloud-capacity" ? "capacity_full" :
      state === "cloud-unavailable" ? "service_disabled" : "available",
    runtime,
  };
}
