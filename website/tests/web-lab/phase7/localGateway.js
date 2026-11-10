// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free local Phase 7 gateway. */
"use strict";
const http = require("node:http");
const https = require("node:https");
const { createHash, randomBytes } = require("node:crypto");

const LAUNCH_PATH = "/__gateway/launch";
const SESSION_COOKIE = "amniora_lab_session";
const METHODS = new Set(["GET", "HEAD", "PUT"]);
const REQUEST_HEADERS = {
  accept: 512,
  "accept-language": 256,
  "content-type": 128,
  "x-web-lab-field": 256,
  "x-web-lab-route": 256,
};
const RESPONSE_HEADERS = new Set(["cache-control", "content-type", "x-content-type-options"]);

function body(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on("end", () => tooLarge
      ? reject(Object.assign(new Error("request_too_large"), { statusCode: 413 }))
      : resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function cookieValue(header, name) {
  if (typeof header !== "string" || header.length > 4096) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function send(response, status, value) {
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

class LocalWebLabGateway {
  constructor({ control, authenticateLearner, resolveBackend, now = () => Date.now(), sessionMs = 30_000, bodyLimit = 65_536 }) {
    this.control = control;
    this.authenticateLearner = authenticateLearner;
    this.resolveBackend = resolveBackend;
    this.now = now;
    this.sessionMs = sessionMs;
    this.bodyLimit = bodyLimit;
    this.sessions = new Map();
    this.consumedGrants = new Set();
    this.auditEvents = [];
    this.server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10_000 }, (request, response) => {
      this.handle(request, response).catch(error => {
        if (response.headersSent || response.destroyed) return;
        send(response, error.statusCode || 500, { error: error.statusCode ? error.message : "gateway_failure" });
      });
    });
  }

  audit(event, result, instanceId, reason) {
    this.auditEvents.push({ at: this.now(), event, result, ...(instanceId ? { instanceId } : {}), ...(reason ? { reason } : {}) });
  }

  async listen() {
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1") throw new Error("gateway_not_loopback");
    this.origin = `http://127.0.0.1:${address.port}`;
    return this.origin;
  }

  async close() {
    this.sessions.clear();
    this.consumedGrants.clear();
    if (!this.server.listening) return;
    await new Promise((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
  }

  async handle(request, response) {
    if (typeof request.url !== "string" || !request.url.startsWith("/") || request.url.startsWith("//")) {
      this.audit("gateway_access_denied", "rejected", undefined, "invalid_path");
      return send(response, 400, { error: "invalid_path" });
    }
    const url = new URL(request.url, "http://gateway.local");
    if (url.pathname === LAUNCH_PATH) return this.launch(request, response);
    return this.proxy(request, response, url);
  }

  async launch(request, response) {
    if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" });
    const identity = await this.authenticateLearner(request);
    if (!identity?.ownerId || !identity?.sessionId) {
      this.audit("launch_grant_rejected", "rejected", undefined, "learner_session_required");
      return send(response, 401, { error: "learner_session_required" });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
      this.audit("launch_grant_rejected", "rejected", undefined, "invalid_content_type");
      return send(response, 415, { error: "invalid_content_type" });
    }
    const raw = await body(request, 8192);
    let input;
    try { input = JSON.parse(raw.toString("utf8")); }
    catch {
      this.audit("launch_grant_rejected", "rejected", undefined, "malformed_request");
      return send(response, 400, { error: "malformed_request" });
    }
    if (!input || typeof input !== "object" ||
      Object.keys(input).length !== 1 || typeof input.grant !== "string" || input.grant.length > 4096) {
      this.audit("launch_grant_rejected", "rejected", undefined, "invalid_grant");
      return send(response, 403, { error: "launch_denied" });
    }
    const digest = createHash("sha256").update(input.grant).digest("base64url");
    if (this.consumedGrants.has(digest)) {
      this.audit("launch_grant_rejected", "rejected", undefined, "grant_replayed");
      return send(response, 403, { error: "launch_denied" });
    }
    const target = await this.control.authorizeDataPlaneLaunch(input.grant, identity);
    if (!target) {
      this.audit("launch_grant_rejected", "rejected", undefined, "grant_invalid");
      return send(response, 403, { error: "launch_denied" });
    }
    const expiresAt = Math.min(this.now() + this.sessionMs, target.expiresAt);
    if (expiresAt <= this.now()) {
      this.audit("launch_grant_rejected", "rejected", target.instanceId, "runtime_expired");
      return send(response, 403, { error: "launch_denied" });
    }
    this.consumedGrants.add(digest);
    const sessionToken = randomBytes(32).toString("base64url");
    this.sessions.set(sessionToken, {
      instanceId: target.instanceId, ownerId: identity.ownerId, learnerSessionId: identity.sessionId,
      routeKey: target.routeKey, expiresAt,
    });
    const route = `/lab/${target.routeKey}/`;
    const maxAge = Math.max(1, Math.floor((expiresAt - this.now()) / 1000));
    response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=${route}; Max-Age=${maxAge}`);
    this.audit("launch_grant_accepted", "accepted", target.instanceId);
    this.audit("lab_session_created", "accepted", target.instanceId);
    return send(response, 201, { route, expiresAt });
  }

  async proxy(request, response, url) {
    const match = /^\/lab\/([A-Za-z0-9_-]{32})(\/.*|$)/.exec(url.pathname);
    if (!match) {
      this.audit("gateway_access_denied", "rejected", undefined, "unknown_route");
      return send(response, 404, { error: "not_found" });
    }
    const sessionToken = cookieValue(request.headers.cookie, SESSION_COOKIE);
    const session = sessionToken ? this.sessions.get(sessionToken) : null;
    if (!session) {
      this.audit("gateway_access_denied", "rejected", undefined, "session_required");
      return send(response, 401, { error: "lab_session_required" });
    }
    if (this.now() >= session.expiresAt) {
      this.sessions.delete(sessionToken);
      this.audit("lab_session_expired", "rejected", session.instanceId, "session_expired");
      return send(response, 401, { error: "lab_session_expired" });
    }
    if (match[1] !== session.routeKey) {
      this.audit("gateway_access_denied", "rejected", session.instanceId, "route_mismatch");
      return send(response, 403, { error: "access_denied" });
    }
    if (!METHODS.has(request.method)) {
      this.audit("gateway_access_denied", "rejected", session.instanceId, "method_not_allowed");
      return send(response, 405, { error: "method_not_allowed" });
    }
    const declaredLength = request.headers["content-length"];
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > this.bodyLimit)) {
      this.audit("gateway_access_denied", "rejected", session.instanceId, "request_too_large");
      return send(response, 413, { error: "request_too_large" });
    }
    if (request.method !== "PUT" && (request.headers["transfer-encoding"] || Number(declaredLength || 0) > 0)) {
      this.audit("gateway_access_denied", "rejected", session.instanceId, "body_not_allowed");
      return send(response, 400, { error: "body_not_allowed" });
    }
    if (request.method === "PUT" && !/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
      this.audit("gateway_access_denied", "rejected", session.instanceId, "invalid_content_type");
      return send(response, 415, { error: "invalid_content_type" });
    }
    const target = await this.control.resolveDataPlaneTarget({
      instanceId: session.instanceId, ownerId: session.ownerId, routeKey: session.routeKey,
    });
    if (!target) {
      this.sessions.delete(sessionToken);
      this.audit("gateway_access_denied", "rejected", session.instanceId, "runtime_unavailable");
      return send(response, 410, { error: "runtime_unavailable" });
    }
    const backend = await this.resolveBackend(target.backendReference, target);
    const upstream = new URL(backend?.origin || "invalid:");
    const localBackend = upstream.protocol === "http:" && upstream.hostname === "127.0.0.1" && /^\d+$/.test(upstream.port);
    const vercelSandboxBackend = backend?.kind === "vercel-sandbox" && upstream.protocol === "https:" && !upstream.port &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.run$/.test(upstream.hostname) && upstream.pathname === "/" &&
      !upstream.username && !upstream.password;
    if ((!localBackend && !vercelSandboxBackend) ||
      typeof backend.proxyKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(backend.proxyKey)) {
      this.audit("gateway_access_denied", "rejected", session.instanceId, "backend_unavailable");
      return send(response, 502, { error: "runtime_unavailable" });
    }
    const requestBody = request.method === "PUT" ? await body(request, this.bodyLimit) : Buffer.alloc(0);
    const headers = { "x-web-lab-proxy-key": backend.proxyKey };
    for (const [name, limit] of Object.entries(REQUEST_HEADERS)) {
      const value = request.headers[name];
      if (typeof value !== "string") continue;
      if (Buffer.byteLength(value) > limit) {
        this.audit("gateway_access_denied", "rejected", session.instanceId, "header_too_large");
        return send(response, 431, { error: "header_too_large" });
      }
      headers[name] = value;
    }
    if (requestBody.length) headers["content-length"] = String(requestBody.length);
    const suffix = match[2] || "/";
    const upstreamPath = suffix + url.search;
    const transport = upstream.protocol === "https:" ? https : http;
    const upstreamRequest = transport.request({
      hostname: upstream.hostname, ...(upstream.port ? { port: upstream.port } : {}), method: request.method,
      path: upstreamPath, headers, timeout: 5000,
    }, upstreamResponse => {
      const responseHeaders = {};
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (RESPONSE_HEADERS.has(name) && typeof value === "string") responseHeaders[name] = value;
      }
      response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(response);
    });
    upstreamRequest.on("timeout", () => upstreamRequest.destroy(new Error("upstream_timeout")));
    upstreamRequest.on("error", () => {
      if (!response.headersSent) send(response, 502, { error: "runtime_unavailable" });
      else response.end();
    });
    upstreamRequest.end(requestBody);
  }
}

module.exports = { LocalWebLabGateway, LAUNCH_PATH, SESSION_COOKIE };
