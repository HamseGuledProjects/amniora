// Display-only snapshots. No transport, persistence, credentials or runtime operations.
import type { BrowserBuild } from "./browser-client";
import type { RunnerPublicStatus } from "./protocol";

export type RunnerPreviewState = "ready" | "offline" | "docker-unavailable" | "version-mismatch" | "starting" | "failed";

export function parseRunnerPreviewState(value: unknown): RunnerPreviewState | null {
  if (process.env.NODE_ENV !== "development") return null;
  switch (value) {
    case "ready": case "offline": case "docker-unavailable":
    case "version-mismatch": case "starting": case "failed": return value;
    default: return null;
  }
}

export function createRunnerPreview(value: unknown) {
  const state = parseRunnerPreviewState(value);
  if (!state) return null;
  const build: BrowserBuild = {
    buildId: "development-preview-only", buildFingerprint: "0".repeat(64), runtimeVersion: "web-lab-local-1",
  };
  const errors: Partial<Record<RunnerPreviewState, string>> = {
    offline: "RUNNER_OFFLINE", "docker-unavailable": "DOCKER_UNAVAILABLE",
    "version-mismatch": "PROTOCOL_VERSION_UNSUPPORTED", failed: "LOCAL_RUNTIME_START_FAILED",
  };
  const status: RunnerPublicStatus | null = ["ready", "starting", "failed"].includes(state) ? {
    state: state === "ready" ? "ready" : state === "starting" ? "starting" : "failed",
    sessionId: "0".repeat(32), buildId: build.buildId, buildFingerprint: build.buildFingerprint,
    generation: 1, createdAt: 0, expiresAt: 8_640_000_000_000_000,
    // Display placeholder only: the component never opens an address in preview mode.
    endpoint: state === "ready" ? "http://127.0.0.1:45678" : null,
    trustLevel: "local_self_hosted",
  } : null;
  return { state, build, status, error: errors[state] ?? "",
    notice: state === "ready" ? "Lab started. (Simulated preview)" : "Simulated Runner state; no runtime is running.",
    busy: state === "starting" ? "launch" as const : null };
}
