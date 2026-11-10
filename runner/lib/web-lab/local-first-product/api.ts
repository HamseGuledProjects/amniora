import "server-only";
import type { AuthenticatedWebLabActor } from "../production-control-service";
import type { OwnerAuthorization } from "./owner-authorization";
import { DurableLocalFirstAuthority, operationEnabled } from "./authority";
import { ProductProtocolError, shortFingerprint } from "./protocol";
import { LocalFirstProductError, type LocalFirstProductService } from "./product-service";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const ID = /^[A-Za-z0-9_:-]{8,128}$/;
const PAIR = /^par_[A-Za-z0-9_-]{43}$/;

function ok(data: unknown, status = 200): Response { return Response.json({ data, error: null }, { status, headers: HEADERS }); }
function fail(code: string, status: number): Response { return Response.json({ data: null, error: { code } }, { status, headers: HEADERS }); }
function productFailure(error: unknown): Response {
  const code = error instanceof LocalFirstProductError ? error.code : "UNAVAILABLE";
  const status = code === "UNAUTHENTICATED" ? 401 : code === "LAB_NOT_FOUND" || code === "OWNER_ACCESS_REQUIRED" ? 404 :
    code === "CSRF_REJECTED" ? 403 : code === "INVALID_REQUEST" ? 400 : code === "COMMAND_EXPIRED" ? 410 :
      code === "REQUEST_TOO_LARGE" ? 413 :
      ["RUNNER_UNPAIRED", "RUNNER_STATUS_REQUIRED", "RUNNER_NOT_READY", "RUNTIME_NOT_READY", "ARCHITECTURE_UNAVAILABLE",
        "ANOTHER_LAB_ACTIVE", "OPERATION_IN_PROGRESS"].includes(code) ? 409 : 503;
  return fail(code, status);
}
function protocolFailure(error: unknown): Response {
  const code = error instanceof ProductProtocolError ? error.code : "REQUEST_INVALID";
  const status = code.includes("EXPIRED") ? 410 : code.includes("REPLAYED") || code.includes("MISMATCH") ||
    ["PAIRING_REVOKED", "RUNTIME_CONFLICT", "OPERATION_IN_PROGRESS"].includes(code) ? 409 : code === "PROOF_INVALID" ? 401 : 400;
  return fail(code, status);
}
function validOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) ? value : null;
  } catch { return null; }
}
function trustedRequestOrigin(configured: string | undefined, header: string | null, requestUrlOrigin: string): boolean {
  const expected = validOrigin(configured);
  const supplied = validOrigin(header);
  const observed = validOrigin(requestUrlOrigin);
  if (!expected || !supplied || !observed) return false;
  if (supplied === expected && observed === expected) return true;
  const values = [expected, supplied, observed].map(value => new URL(value));
  return values.every(value => value.protocol === "http:" && ["127.0.0.1", "localhost"].includes(value.hostname) &&
    value.port === values[0].port);
}
async function json(request: Request, maximum: number): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") throw new LocalFirstProductError("INVALID_REQUEST");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > maximum) throw new LocalFirstProductError("REQUEST_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new LocalFirstProductError("INVALID_REQUEST");
  let total = 0; let raw = ""; const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > maximum) { await reader.cancel(); throw new LocalFirstProductError("REQUEST_TOO_LARGE"); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(raw); } catch { throw new LocalFirstProductError("INVALID_REQUEST"); }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function actor(authorization: OwnerAuthorization): AuthenticatedWebLabActor {
  if (!authorization.authenticated) throw new LocalFirstProductError("UNAUTHENTICATED");
  if (!authorization.owner || !authorization.actor) throw new LocalFirstProductError("OWNER_ACCESS_REQUIRED");
  return authorization.actor;
}

export function createOwnerProductApi(options: Readonly<{
  enabled: boolean;
  trustedOrigin: string | undefined;
  authorize: () => Promise<OwnerAuthorization>;
  service: () => LocalFirstProductService;
}>) {
  return async (request: Request, savedLabId: string): Promise<Response> => {
    try {
      if (!options.enabled) throw new LocalFirstProductError("LAB_NOT_FOUND");
      const url = new URL(request.url);
      if (!ID.test(savedLabId) || url.pathname !== `/api/web-labs/local-first/my-vm/${savedLabId}` || url.hash ||
          !["GET", "POST"].includes(request.method) || request.headers.get("sec-fetch-site") === "cross-site") {
        throw new LocalFirstProductError("INVALID_REQUEST");
      }
      const owner = actor(await options.authorize());
      if (request.method === "GET") {
        if (!url.search) return ok(await options.service().snapshot(owner, savedLabId));
        const requestId = url.searchParams.get("request") ?? "";
        if ([...url.searchParams.keys()].join(",") !== "request") throw new LocalFirstProductError("INVALID_REQUEST");
        return ok(await options.service().commandStatus(owner, savedLabId, requestId));
      }
      if (url.search) throw new LocalFirstProductError("INVALID_REQUEST");
      if (!trustedRequestOrigin(options.trustedOrigin, request.headers.get("origin"), url.origin)) {
        throw new LocalFirstProductError("CSRF_REJECTED");
      }
      const input = await json(request, 1_024);
      if (!object(input) || typeof input.action !== "string") throw new LocalFirstProductError("INVALID_REQUEST");
      if (input.action === "unpair" && exact(input, ["action", "idempotencyKey"]) &&
          typeof input.idempotencyKey === "string") {
        await options.service().unpair(owner); return ok({ unpaired: true });
      }
      if (input.action === "cancel-command" && exact(input, ["action", "requestId"]) &&
          typeof input.requestId === "string") {
        await options.service().cancelCommand(owner, savedLabId, input.requestId);
        return ok({ cancelled: true });
      }
      if (input.action === "command" && exact(input, ["action", "operation", "idempotencyKey"]) &&
          typeof input.idempotencyKey === "string" && operationEnabled(input.operation)) {
        return ok(await options.service().action(owner, savedLabId, input.operation, input.idempotencyKey), 202);
      }
      throw new LocalFirstProductError("INVALID_REQUEST");
    } catch (error) { return productFailure(error); }
  };
}

export function createPairingApprovalApi(options: Readonly<{
  enabled: boolean; trustedOrigin: string | undefined; authorize: () => Promise<OwnerAuthorization>;
  authority: () => DurableLocalFirstAuthority;
}>) {
  return async (request: Request): Promise<Response> => {
    try {
      if (!options.enabled) throw new LocalFirstProductError("LAB_NOT_FOUND");
      const url = new URL(request.url);
      if (url.pathname !== "/api/web-labs/local-first/pairing/approval" || request.headers.get("sec-fetch-site") === "cross-site") {
        throw new LocalFirstProductError("INVALID_REQUEST");
      }
      const owner = actor(await options.authorize());
      if (request.method === "GET") {
        const requestId = url.searchParams.get("request") ?? ""; const state = url.searchParams.get("state") ?? "";
        if ([...url.searchParams.keys()].sort().join(",") !== "request,state" || !PAIR.test(requestId)) throw new LocalFirstProductError("INVALID_REQUEST");
        const record = await options.authority().pairingForApproval(requestId, state);
        return ok({ requestId, deviceName: record.deviceName, fingerprint: shortFingerprint(record.publicKey),
          expiresAt: new Date(record.expiresAt).toISOString() });
      }
      if (request.method !== "POST" || url.search || url.hash) throw new LocalFirstProductError("INVALID_REQUEST");
      if (!trustedRequestOrigin(options.trustedOrigin, request.headers.get("origin"), url.origin)) {
        throw new LocalFirstProductError("CSRF_REJECTED");
      }
      const input = await json(request, 1_024);
      if (object(input) && exact(input, ["action", "requestId"]) && input.action === "cancel" &&
          typeof input.requestId === "string") {
        if (!await options.authority().cancelPairing(input.requestId)) throw new ProductProtocolError("PAIRING_REPLAYED");
        return ok({ cancelled: true });
      }
      if (!object(input) || !exact(input, ["requestId", "state", "approved"]) || typeof input.requestId !== "string" ||
          typeof input.state !== "string" || typeof input.approved !== "boolean") throw new LocalFirstProductError("INVALID_REQUEST");
      return ok(await options.authority().approvePairing({ authorizationRequestId: input.requestId, state: input.state,
        authenticatedAccountId: owner.userId, approved: input.approved }));
    } catch (error) {
      if (error instanceof LocalFirstProductError) return productFailure(error);
      return protocolFailure(error);
    }
  };
}

export function createRunnerProtocolApi(options: Readonly<{
  enabled: boolean; trustedOrigin: string | undefined; authority: () => DurableLocalFirstAuthority;
  redeem?: (input: unknown) => Promise<unknown>;
}>) {
  return async (operation: "pairing-begin" | "pairing-complete" | "redeem" | "result" | "unpair" | "presence", request: Request): Promise<Response> => {
    try {
      if (!options.enabled) return fail("UNAVAILABLE", 404);
      const url = new URL(request.url);
      const path = `/api/web-labs/local-first/runner/${operation}`;
      if (request.method !== "POST" || url.pathname !== path || url.search || url.hash) return fail("REQUEST_INVALID", 400);
      const input = await json(request, 16_384);
      if (operation === "pairing-begin") {
        const origin = validOrigin(options.trustedOrigin); if (!origin) return fail("UNAVAILABLE", 503);
        return ok(await options.authority().beginPairing(input, origin), 201);
      }
      if (operation === "pairing-complete") {
        const paired = await options.authority().completePairing(input);
        return ok({ connected: true, installationId: paired.installationId });
      }
      if (operation === "redeem") return ok(options.redeem ? await options.redeem(input) : await options.authority().redeem(input));
      if (operation === "presence") { await options.authority().recordPresence(input); return ok({ accepted: true }); }
      if (operation === "unpair") { await options.authority().revokeFromRunner(input); return ok({ unpaired: true }); }
      await options.authority().submitResult(input);
      return ok({ accepted: true });
    } catch (error) {
      if (error instanceof LocalFirstProductError) return productFailure(error);
      return protocolFailure(error);
    }
  };
}
