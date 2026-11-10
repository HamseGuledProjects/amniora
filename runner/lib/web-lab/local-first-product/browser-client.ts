import type { ProductAction, ProductCommandStatus, ProductOperation, ProductSnapshot } from "./contract";

export class LocalFirstBrowserError extends Error { constructor(readonly code: string) { super(code); } }

async function request(savedLabId: string, input?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(input ? 20_000 : 10_000)]) :
    AbortSignal.timeout(input ? 20_000 : 10_000);
  const response = await fetch(`/api/web-labs/local-first/my-vm/${encodeURIComponent(savedLabId)}`, {
    method: input ? "POST" : "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: bounded,
    headers: input ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || !("data" in value) || !("error" in value)) throw new LocalFirstBrowserError("INVALID_RESPONSE");
  const envelope = value as { data: unknown; error: null | { code?: unknown } };
  if (!response.ok || envelope.error) throw new LocalFirstBrowserError(typeof envelope.error?.code === "string" ? envelope.error.code : "UNAVAILABLE");
  return envelope.data;
}

export const getLocalFirstSnapshot = (id: string, signal?: AbortSignal) => request(id, undefined, signal) as Promise<ProductSnapshot>;
export async function getLocalFirstCommandStatus(id: string, requestId: string, signal?: AbortSignal): Promise<ProductCommandStatus> {
  if (!/^req_[A-Za-z0-9_-]{43}$/.test(requestId)) throw new LocalFirstBrowserError("INVALID_RESPONSE");
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  const response = await fetch(`/api/web-labs/local-first/my-vm/${encodeURIComponent(id)}?request=${encodeURIComponent(requestId)}`,
    { cache: "no-store", credentials: "same-origin", redirect: "error", signal: bounded, headers: { Accept: "application/json" } });
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || !("data" in value) || !("error" in value)) throw new LocalFirstBrowserError("INVALID_RESPONSE");
  const envelope = value as { data: ProductCommandStatus; error: null | { code?: unknown } };
  if (!response.ok || envelope.error) throw new LocalFirstBrowserError(typeof envelope.error?.code === "string" ? envelope.error.code : "UNAVAILABLE");
  return envelope.data;
}
export const issueLocalFirstAction = (id: string, operation: ProductOperation, idempotencyKey: string, signal?: AbortSignal) =>
  request(id, { action: "command", operation, idempotencyKey }, signal) as Promise<ProductAction>;
export const unpairLocalFirstRunner = (id: string, idempotencyKey: string, signal?: AbortSignal) =>
  request(id, { action: "unpair", idempotencyKey }, signal) as Promise<{ unpaired: true }>;
export const cancelLocalFirstCommand = (id: string, requestId: string, signal?: AbortSignal) =>
  request(id, { action: "cancel-command", requestId }, signal) as Promise<{ cancelled: true }>;

export async function cancelLocalFirstPairing(requestId: string, signal?: AbortSignal): Promise<void> {
  if (!/^par_[A-Za-z0-9_-]{43}$/.test(requestId)) throw new LocalFirstBrowserError("INVALID_RESPONSE");
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
  const response = await fetch("/api/web-labs/local-first/pairing/approval", {
    method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", signal: bounded,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "cancel", requestId }),
  });
  const value = await response.json().catch(() => null) as { data?: { cancelled?: boolean }; error?: { code?: string } } | null;
  if (!response.ok || value?.data?.cancelled !== true) {
    throw new LocalFirstBrowserError(typeof value?.error?.code === "string" ? value.error.code : "UNAVAILABLE");
  }
}

export function runnerReadinessIsFresh(snapshot: ProductSnapshot | null, now: number): boolean {
  const runner = snapshot?.runner;
  const expiresAt = runner?.readinessExpiresAt ? Date.parse(runner.readinessExpiresAt) : Number.NaN;
  return runner?.readiness === "ready" && Number.isFinite(expiresAt) && now <= expiresAt;
}

export function runnerPresenceIsFresh(snapshot: ProductSnapshot | null, now: number): boolean {
  const expiresAt = snapshot?.runner?.presenceExpiresAt ? Date.parse(snapshot.runner.presenceExpiresAt) : Number.NaN;
  return snapshot?.paired === true && Number.isFinite(expiresAt) && now <= expiresAt;
}

const RUNNER_CONNECT_URI = "com.amniora.runner:/connect";

export function openRunnerForPairing(): void {
  const uri = new URL(RUNNER_CONNECT_URI);
  if (uri.protocol !== "com.amniora.runner:" || uri.hostname || uri.pathname !== "/connect" ||
      uri.search || uri.hash || uri.username || uri.password) throw new LocalFirstBrowserError("INVALID_RESPONSE");
  window.location.assign(RUNNER_CONNECT_URI);
}

export function runnerActivationUri(action: ProductAction): string | null {
  if (!action || !/^req_[A-Za-z0-9_-]{43}$/.test(action.requestId) ||
      !["STATUS", "LAUNCH", "OPEN_LAB", "RESET", "STOP"].includes(action.operation) ||
      !["issued", "redeemed", "completed"].includes(action.state) || !Number.isFinite(new Date(action.expiresAt).getTime())) {
    throw new LocalFirstBrowserError("INVALID_RESPONSE");
  }
  if (action.activationUri === null) return null;
  if (new Date(action.expiresAt).getTime() <= Date.now()) throw new LocalFirstBrowserError("INVALID_RESPONSE");
  const uri = new URL(action.activationUri);
  if (uri.protocol !== "com.amniora.runner:" || uri.hostname || uri.pathname !== "/activate" || uri.username || uri.password ||
      uri.hash || [...uri.searchParams.keys()].join(",") !== "ticket" || !/^[A-Za-z0-9_-]{43}$/.test(uri.searchParams.get("ticket") ?? "") ||
      new TextEncoder().encode(action.activationUri).length > 256) throw new LocalFirstBrowserError("INVALID_RESPONSE");
  return action.activationUri;
}

export function activateRunner(action: ProductAction): boolean {
  const uri = runnerActivationUri(action);
  if (uri === null) return false;
  window.location.assign(uri);
  return true;
}
