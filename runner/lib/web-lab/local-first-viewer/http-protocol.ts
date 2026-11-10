import {
  BYO_RELAY_MAX_HEADER_BYTES,
  BYO_RELAY_MAX_REQUEST_BODY_BYTES,
  BYO_RELAY_MAX_RESPONSE_BODY_BYTES,
  hasExactKeys,
  isPlainObject,
  validRelayPathQuery,
  type ByoRelayHttpRequest,
  type ByoRelayHttpResponse,
} from "../byo-runner/protocol";

export const LOCAL_VIEWER_RELAY_REQUEST_HEADER_LIMITS: Readonly<Record<string, number>> = {
  accept: 512,
  "accept-language": 256,
  cookie: 4_096,
  "content-type": 128,
  "content-length": 16,
  "x-web-lab-field": 256,
  "x-web-lab-route": 256,
};

export const LOCAL_VIEWER_RELAY_RESPONSE_HEADERS = new Set([
  "cache-control", "content-type", "location", "set-cookie", "x-content-type-options",
]);

function validCanonicalBase64(value: unknown, maximumBytes: number): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(maximumBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length <= maximumBytes && decoded.toString("base64") === value;
}

function validHeaders(value: unknown, limits: Readonly<Record<string, number>> | Set<string>): value is Record<string, string> {
  if (!isPlainObject(value)) return false;
  let total = 0;
  for (const [name, headerValue] of Object.entries(value)) {
    const limit = limits instanceof Set ? (limits.has(name) ? 4_096 : 0) : limits[name] ?? 0;
    if (!limit || name !== name.toLowerCase() || !/^[a-z0-9-]+$/.test(name) || typeof headerValue !== "string" ||
        Buffer.byteLength(headerValue) > limit || /[\u0000-\u001f\u007f]/.test(headerValue)) return false;
    total += Buffer.byteLength(name) + Buffer.byteLength(headerValue) + 4;
  }
  return total <= BYO_RELAY_MAX_HEADER_BYTES;
}

export function validLocalViewerRelayHttpRequest(value: unknown): value is ByoRelayHttpRequest {
  if (!isPlainObject(value) || !hasExactKeys(value, ["method", "pathQuery", "headers", "bodyBase64"]) ||
      !["GET", "HEAD", "POST", "PUT"].includes(String(value.method)) || !validRelayPathQuery(value.pathQuery) ||
      !validHeaders(value.headers, LOCAL_VIEWER_RELAY_REQUEST_HEADER_LIMITS) ||
      !validCanonicalBase64(value.bodyBase64, BYO_RELAY_MAX_REQUEST_BODY_BYTES)) return false;
  const length = Buffer.from(value.bodyBase64 as string, "base64").length;
  const headers = value.headers as Record<string, string>;
  if ((value.method === "GET" || value.method === "HEAD") && length !== 0) return false;
  if (headers["content-length"] !== undefined && headers["content-length"] !== String(length)) return false;
  return length === 0 || /^(?:application\/json|application\/x-www-form-urlencoded|text\/plain)(?:\s*;|$)/i.test(
    headers["content-type"] ?? "",
  );
}

export function validLocalViewerRelayHttpResponse(value: unknown): value is ByoRelayHttpResponse {
  return isPlainObject(value) && hasExactKeys(value, ["status", "headers", "bodyBase64"]) &&
    Number.isSafeInteger(value.status) && Number(value.status) >= 100 && Number(value.status) <= 599 &&
    validHeaders(value.headers, LOCAL_VIEWER_RELAY_RESPONSE_HEADERS) &&
    validCanonicalBase64(value.bodyBase64, BYO_RELAY_MAX_RESPONSE_BODY_BYTES);
}
