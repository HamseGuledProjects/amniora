import {
  CLOUD_GATEWAY_LAUNCH_PATH, type CloudOpen, type CloudSnapshot,
} from "./product-contract";

export class CloudBrowserError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CloudBrowserError"; }
}

function fail(code = "INVALID_RESPONSE"): never { throw new CloudBrowserError(code); }
function exact(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.slice().sort().every((key, index) => key === actual[index]);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function finiteDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}
function snapshot(value: unknown): CloudSnapshot {
  const availability = ["available", "plan_required", "capacity_full", "active_elsewhere",
    "budget_unavailable", "service_disabled", "unavailable"];
  const states = ["launching", "starting", "ready", "resetting", "stopping", "expiring", "expired", "failed"];
  if (!record(value) || !exact(value, ["enabled", "eligible", "plan", "availability", "runtime"]) ||
      typeof value.enabled !== "boolean" || typeof value.eligible !== "boolean" ||
      !["free", "pro"].includes(String(value.plan)) || !availability.includes(String(value.availability))) return fail();
  if (value.runtime !== null && (!record(value.runtime) ||
      !exact(value.runtime, ["state", "createdAt", "expiresAt", "openAvailable", "resetAvailable", "stopAvailable"]) ||
      !states.includes(String(value.runtime.state)) || !finiteDate(value.runtime.createdAt) || !finiteDate(value.runtime.expiresAt) ||
      typeof value.runtime.openAvailable !== "boolean" || typeof value.runtime.resetAvailable !== "boolean" ||
      typeof value.runtime.stopAvailable !== "boolean")) return fail();
  return value as CloudSnapshot;
}

async function call(savedLabId: string, input?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (!/^[0-9a-f-]{36}$/i.test(savedLabId) && savedLabId !== "fixture-saved-lab") return fail("INVALID_REQUEST");
  let response: Response;
  try {
    response = await fetch(`/api/web-labs/cloud/${encodeURIComponent(savedLabId)}`, {
      method: input ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
      redirect: "error", signal,
      headers: input ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
  } catch {
    if (signal?.aborted) throw new CloudBrowserError("CANCELLED");
    throw new CloudBrowserError("UNAVAILABLE");
  }
  if (response.redirected || (response.status >= 300 && response.status < 400) ||
      !response.headers.get("content-type")?.includes("application/json")) return fail();
  const value: unknown = await response.json().catch(() => null);
  if (!record(value) || !exact(value, ["data", "error"])) return fail();
  if (!response.ok || value.error !== null) {
    if (value.data !== null || !record(value.error) || !exact(value.error, ["code"]) ||
        typeof value.error.code !== "string" || !/^[A-Z_]{3,64}$/.test(value.error.code)) return fail();
    return fail(value.error.code);
  }
  return value.data;
}

export async function getCloudSnapshot(savedLabId: string, signal?: AbortSignal): Promise<CloudSnapshot> {
  return snapshot(await call(savedLabId, undefined, signal));
}
export async function mutateCloud(savedLabId: string, action: "launch" | "reset" | "stop",
  idempotencyKey: string, signal?: AbortSignal): Promise<CloudSnapshot> {
  return snapshot(await call(savedLabId, { action, idempotencyKey }, signal));
}
export async function openCloud(savedLabId: string, signal?: AbortSignal): Promise<CloudOpen> {
  const value = await call(savedLabId, { action: "open" }, signal);
  if (!record(value) || !exact(value, ["action", "handoff", "expiresAt"]) ||
      typeof value.action !== "string" || typeof value.handoff !== "string" ||
      !/^[A-Za-z0-9_-]{20,2048}\.[A-Za-z0-9_-]{20,128}$/.test(value.handoff) ||
      !finiteDate(value.expiresAt) || new Date(value.expiresAt).getTime() <= Date.now()) return fail();
  return value as CloudOpen;
}

export function submitCloudOpen(value: CloudOpen): void {
  if (!value || !finiteDate(value.expiresAt) || new Date(value.expiresAt).getTime() <= Date.now() ||
      !/^[A-Za-z0-9_-]{20,2048}\.[A-Za-z0-9_-]{20,128}$/.test(value.handoff)) return fail();
  let target: URL;
  try { target = new URL(value.action, window.location.origin); } catch { return fail(); }
  const local = target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname);
  if ((!local && target.protocol !== "https:") || target.username || target.password || target.search || target.hash ||
      target.pathname !== CLOUD_GATEWAY_LAUNCH_PATH) return fail();
  const form = document.createElement("form");
  form.method = "POST"; form.action = target.href; form.target = "_blank"; form.rel = "noopener noreferrer";
  const handoff = document.createElement("input");
  handoff.type = "hidden"; handoff.name = "grant"; handoff.value = value.handoff;
  form.append(handoff); document.body.append(form); form.submit(); form.remove();
}

export function cloudMessage(code: string): string {
  const messages: Record<string, string> = {
    HOSTED_PLAN_REQUIRED: "Amniora Cloud is available with Pro. My Computer and My VM remain available.",
    HOSTED_CAPACITY_FULL: "Cloud capacity is currently full. Try again shortly or use My Computer / My VM.",
    RUNTIME_ALREADY_ACTIVE: "Another Cloud lab is active. Stop it before starting this one.",
    HOSTED_BUDGET_RESTRICTED: "Amniora Cloud is temporarily unavailable. My Computer and My VM remain available.",
    HOSTED_BUDGET_EXCEEDED: "Amniora Cloud is temporarily unavailable. My Computer and My VM remain available.",
    HOSTED_DISABLED: "Amniora Cloud is temporarily unavailable. My Computer and My VM remain available.",
    RUNNER_UNAVAILABLE: "Amniora Cloud is temporarily unavailable. Try again later.",
    RUNTIME_PROVISIONING_FAILED: "The Cloud lab could not start safely. Try again or use My Computer / My VM.",
    RUNTIME_NOT_READY: "The Cloud lab is not ready to open yet. Refresh its status.",
    RUNTIME_EXPIRED: "This Cloud session has expired. You can launch a new session when available.",
    RESET_LIMIT_EXCEEDED: "This Cloud lab has reached its reset limit. Stop it and launch a new session.",
    UNAUTHENTICATED: "Sign in again to use Amniora Cloud.",
    LAB_INCOMPATIBLE: "This Saved Lab is not available in Amniora Cloud.",
    LAB_NOT_FOUND: "Amniora Cloud is not enabled for this Saved Lab.",
    UNAVAILABLE: "Amniora Cloud is temporarily unavailable. Try again later.",
  };
  return messages[code] ?? "The Cloud operation could not be completed safely. Refresh its status before trying again.";
}
