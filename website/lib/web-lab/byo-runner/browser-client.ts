import type { MyVmEnrollment, MyVmOpen, MyVmSnapshot } from "./product-contract";

export class MyVmBrowserError extends Error { constructor(readonly code: string) { super(code); } }

async function call(savedLabId: string, input?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`/api/web-labs/my-vm/${encodeURIComponent(savedLabId)}`, {
    method: input ? "POST" : "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal,
    headers: input ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || !("data" in value) || !("error" in value)) throw new MyVmBrowserError("INVALID_RESPONSE");
  const envelope = value as { data: unknown; error: null | { code?: unknown } };
  if (!response.ok || envelope.error) throw new MyVmBrowserError(typeof envelope.error?.code === "string" ? envelope.error.code : "UNAVAILABLE");
  return envelope.data;
}
export const getMyVmSnapshot = (id: string, signal?: AbortSignal) => call(id, undefined, signal) as Promise<MyVmSnapshot>;
export const createMyVmEnrollment = (id: string, signal?: AbortSignal) =>
  call(id, { action: "enroll", idempotencyKey: crypto.randomUUID() }, signal) as Promise<MyVmEnrollment>;
export const mutateMyVm = (id: string, action: "launch" | "reset" | "stop" | "disconnect", runnerKey: string, idempotencyKey: string, signal?: AbortSignal) =>
  call(id, { action, runnerKey, idempotencyKey }, signal);
export const openMyVm = (id: string, runnerKey: string, signal?: AbortSignal) => call(id, { action: "open", runnerKey }, signal) as Promise<MyVmOpen>;

export function submitMyVmOpen(value: MyVmOpen): void {
  if (!value || typeof value !== "object" || !/^[A-Za-z0-9_-]{43}$/.test(value.grant) ||
      !Number.isFinite(new Date(value.expiresAt).getTime()) || new Date(value.expiresAt).getTime() <= Date.now()) {
    throw new MyVmBrowserError("INVALID_RESPONSE");
  }
  const target = new URL(value.action, window.location.origin);
  const localHttp = target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname);
  if ((target.protocol !== "https:" && !localHttp) || target.username || target.password || target.search || target.hash ||
      target.pathname !== "/__amniora/byo/launch") {
    throw new MyVmBrowserError("INVALID_RESPONSE");
  }
  const form = document.createElement("form");
  form.method = "POST"; form.action = target.href; form.target = "_blank"; form.rel = "noopener";
  const grant = document.createElement("input"); grant.type = "hidden"; grant.name = "grant"; grant.value = value.grant;
  form.append(grant); document.body.append(form); form.submit(); form.remove();
}
