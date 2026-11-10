import { Buffer } from "node:buffer";
import {
  hasExactKeys,
  isPlainObject,
  type ByoRelayHttpResponse,
} from "../byo-runner/protocol";
import type { ByoBrowserRequest } from "../byo-runner/browser-relay";
import { normalizeBrowserRequest } from "../byo-runner/browser-relay";
import type { GuestRuntimeStatus } from "../local-first-guest/protocol";
import {
  LOCAL_VIEWER_RELAY_REQUEST_HEADER_LIMITS,
  validLocalViewerRelayHttpResponse,
} from "./http-protocol";

export const LAB_VIEWER_SCHEME = "amniora-lab" as const;
export const LAB_VIEWER_MAX_CONCURRENT_REQUESTS = 8;
export const LAB_VIEWER_MAX_BRIDGE_FRAME_BYTES = 384 * 1_024;

const RUNTIME_ID = /^[0-9a-f]{32}$/;
const VIEWER_AUTHORITY = /^[0-9a-f]{32}-g[1-9][0-9]*$/;
const REQUEST_ID = /^vrq_[A-Za-z0-9_-]{16,64}$/;

export type LabViewerBinding = Readonly<{
  runtimeId: string;
  buildFingerprint: string;
  generation: number;
  authority: string;
  origin: string;
}>;

export type LabViewerRequestFrame = Readonly<{
  type: "viewer-request";
  requestId: string;
  authority: string;
  method: string;
  pathQuery: string;
  headers: Readonly<Record<string, string>>;
  bodyBase64: string;
}>;

export type LabViewerResponseFrame = Readonly<{
  type: "viewer-response";
  requestId: string;
  ok: boolean;
  status: number;
  headers: Readonly<Record<string, string>>;
  bodyBase64: string;
  errorCode: string | null;
  terminal: boolean;
}>;

export type LabViewerControlFrame = Readonly<{
  type: "viewer-control";
  action: "invalidate";
  reason: "generation-changed" | "runtime-stopped" | "runner-disconnected";
}>;

export class LabViewerError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly terminal = false,
  ) {
    super(code);
    this.name = "LabViewerError";
  }
}

export function bindingFromStatus(status: GuestRuntimeStatus): LabViewerBinding {
  if (status.state !== "ready" || !status.ready || !status.ingressReady || !status.runtimeId ||
      !RUNTIME_ID.test(status.runtimeId) || !status.buildFingerprint || !status.generation) {
    throw new LabViewerError("VIEWER_RUNTIME_NOT_READY", 410, true);
  }
  const authority = `${status.runtimeId}-g${status.generation}`;
  if (!VIEWER_AUTHORITY.test(authority)) throw new LabViewerError("VIEWER_RUNTIME_NOT_READY", 410, true);
  return Object.freeze({
    runtimeId: status.runtimeId,
    buildFingerprint: status.buildFingerprint,
    generation: status.generation,
    authority,
    origin: `${LAB_VIEWER_SCHEME}://${authority}`,
  });
}

export function sameBinding(status: GuestRuntimeStatus, binding: LabViewerBinding): boolean {
  return status.state === "ready" && status.ready && status.ingressReady &&
    status.runtimeId === binding.runtimeId && status.buildFingerprint === binding.buildFingerprint &&
    status.generation === binding.generation;
}

function canonicalBase64(value: unknown): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(65_536 / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length <= 65_536 && decoded.toString("base64") === value;
}

export function requireViewerRequestFrame(value: unknown, expectedAuthority: string): Readonly<{
  requestId: string;
  request: ReturnType<typeof normalizeBrowserRequest>;
}> {
  if (!VIEWER_AUTHORITY.test(expectedAuthority) || !isPlainObject(value) || !hasExactKeys(value, [
    "type", "requestId", "authority", "method", "pathQuery", "headers", "bodyBase64",
  ]) || value.type !== "viewer-request" || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId) ||
      value.authority !== expectedAuthority || !canonicalBase64(value.bodyBase64)) {
    throw new LabViewerError("VIEWER_REQUEST_INVALID");
  }
  const allowedHeaders = new Set(Object.keys(LOCAL_VIEWER_RELAY_REQUEST_HEADER_LIMITS));
  if (!isPlainObject(value.headers) || Object.keys(value.headers).some(name => name !== name.toLowerCase() || !allowedHeaders.has(name))) {
    throw new LabViewerError("VIEWER_REQUEST_INVALID");
  }
  const browserRequest: ByoBrowserRequest = {
    method: String(value.method),
    pathQuery: String(value.pathQuery),
    headers: value.headers as Readonly<Record<string, string>>,
    body: Buffer.from(value.bodyBase64, "base64"),
  };
  try {
    return Object.freeze({ requestId: value.requestId,
      request: normalizeBrowserRequest(browserRequest, LOCAL_VIEWER_RELAY_REQUEST_HEADER_LIMITS) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "VIEWER_REQUEST_INVALID";
    const status = typeof error === "object" && error !== null && "status" in error &&
      Number.isSafeInteger(error.status) ? Number(error.status) : 400;
    throw new LabViewerError(code, status);
  }
}

export function viewerResponse(
  requestId: string,
  response: ByoRelayHttpResponse,
): LabViewerResponseFrame {
  if (!REQUEST_ID.test(requestId) || !validLocalViewerRelayHttpResponse(response)) {
    throw new LabViewerError("VIEWER_RESPONSE_INVALID", 502, true);
  }
  return Object.freeze({ type: "viewer-response", requestId, ok: true, status: response.status,
    headers: response.headers, bodyBase64: response.bodyBase64, errorCode: null, terminal: false });
}

export function viewerFailure(requestId: string, error: unknown): LabViewerResponseFrame {
  const candidate = error instanceof LabViewerError ? error : new LabViewerError(
    error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message) ? error.message : "VIEWER_RELAY_FAILED",
    502,
    true,
  );
  return Object.freeze({ type: "viewer-response", requestId: REQUEST_ID.test(requestId) ? requestId : "vrq_invalid_request_0001",
    ok: false, status: candidate.status, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    bodyBase64: Buffer.from(candidate.code, "utf8").toString("base64"), errorCode: candidate.code, terminal: candidate.terminal });
}
