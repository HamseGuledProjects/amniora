import { compileWebLab } from "./compiler";
import { canonicalWebLabRuntimeState } from "./runtime-state";
import type { WebLabSpec } from "./schema";
import { webApplicationTemplate } from "./templates/registry";

export type VercelRuntimeBundleFile = Readonly<{
  path: string;
  content: string;
  mode?: number;
}>;

function runtimeHtml(compiledHtml: string, storedField: string,
  reflectedField: string, reflectedRoute: string): string {
  if (!compiledHtml.includes("connect-src 'none'") ||
      !compiledHtml.includes('id="web-lab-data"') ||
      !compiledHtml.includes('id="reset"') ||
      !compiledHtml.includes("sessionStorage.getItem(storageKey)") ||
      !compiledHtml.includes("sessionStorage.setItem(storageKey") ||
      !compiledHtml.includes("sessionStorage.removeItem(storageKey)")) {
    throw new Error("unsupported_compiled_web_lab_runtime_bundle");
  }
  const shim = [
    "<script>",
    "const runtimeStorage = {",
    "  getItem() {",
    "    const request = new XMLHttpRequest();",
    "    request.open('GET', '__runtime/state', false);",
    "    request.send();",
    "    if (request.status !== 200) throw new Error('Runtime state unavailable');",
    "    return request.responseText;",
    "  },",
    "  setItem(_key, value) {",
    "    const request = new XMLHttpRequest();",
    "    request.open('PUT', '__runtime/state', false);",
    "    request.setRequestHeader('Content-Type', 'application/json');",
    `    request.setRequestHeader('X-Web-Lab-Field', ${JSON.stringify(storedField)});`,
    "    request.setRequestHeader('X-Web-Lab-Route', (location.hash.slice(1).split('?')[0] || '/'));",
    "    request.send(value);",
    "    if (request.status !== 204) throw new Error('Runtime submission rejected');",
    "  },",
    "  removeItem() { throw new Error('Use trusted runtime reset'); }",
    "};",
    "addEventListener('submit', event => {",
    "  const form = event.target;",
    "  if (!(form instanceof HTMLFormElement)) return;",
    `  const field = form.elements.namedItem(${JSON.stringify(reflectedField)});`,
    "  if (!(field instanceof HTMLInputElement)) return;",
    "  const value = field.value;",
    "  if (!value || value.length > 500) return;",
    "  try {",
    "    const request = new XMLHttpRequest();",
    "    request.open('PUT', '__runtime/reflected-candidate', false);",
    "    request.setRequestHeader('Content-Type', 'application/json');",
    `    request.send(JSON.stringify({ labId: data.labId, route: ${JSON.stringify(reflectedRoute)}, field: ${JSON.stringify(reflectedField)}, value }));`,
    "  } catch { /* Grading evidence failure never changes the learner runtime. */ }",
    "}, true);",
    "</script>",
  ].join("\n");
  return compiledHtml
    .replace("connect-src 'none'", "connect-src 'self'")
    .replace('id="reset"', 'id="reset" disabled title="Use the trusted runtime manager to reset"')
    .replace('<script id="web-lab-data"', `${shim}<script id="web-lab-data"`)
    .replaceAll("sessionStorage.getItem(storageKey)", "runtimeStorage.getItem(storageKey)")
    .replaceAll("sessionStorage.setItem(storageKey", "runtimeStorage.setItem(storageKey")
    .replaceAll("sessionStorage.removeItem(storageKey)", "runtimeStorage.removeItem(storageKey)");
}

const challengeServer = String.raw`"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const root = __dirname;
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const initial = JSON.parse(fs.readFileSync(path.join(root, "initial-state.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(root, "runtime-config.json"), "utf8"));
let state = structuredClone(initial);
let reflectedCandidate = null;

function validTransition(next, field, route) {
  if (field !== config.storedField || route !== config.storedRoute ||
      next?.schemaVersion !== 1 || next.labId !== initial.labId ||
      next.nextContentNumber !== state.nextContentNumber + 1 ||
      !next.contentByObject || typeof next.contentByObject !== "object") return false;
  if (!isDeepStrictEqual(Object.keys(next).sort(), ["contentByObject", "labId", "nextContentNumber", "schemaVersion"])) return false;
  const ids = Object.keys(state.contentByObject);
  if (!isDeepStrictEqual(Object.keys(next.contentByObject).sort(), [...ids].sort())) return false;
  let changed = 0;
  for (const id of ids) {
    const before = state.contentByObject[id];
    const after = next.contentByObject[id];
    if (!Array.isArray(after)) return false;
    if (isDeepStrictEqual(after, before)) continue;
    if (!config.writableObjectIds.includes(id) || after.length !== before.length + 1 ||
        !isDeepStrictEqual(after.slice(0, -1), before)) return false;
    const entry = after.at(-1);
    if (!entry || !isDeepStrictEqual(Object.keys(entry).sort(), ["authorId", "body", "id", "submittedByLearner"]) ||
        entry.id !== "learner-" + state.nextContentNumber ||
        entry.authorId !== config.displayUserId || entry.submittedByLearner !== true ||
        typeof entry.body !== "string" || !entry.body.trim() || entry.body !== entry.body.trim() ||
        entry.body.length > 500) return false;
    changed++;
  }
  return changed === 1;
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    request.on("end", () => size > limit ? reject(Object.assign(new Error("too_large"), { status: 413 })) : resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000 }, async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Amniora-Hop-Forwarded", request.headers["x-amniora-internal-hop"] ? "yes" : "no");
  const pathname = new URL(request.url, "http://localhost").pathname;
  if ((request.method === "GET" || request.method === "HEAD") && pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : html);
    return;
  }
  if (request.method === "GET" && pathname === "/__runtime/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ready: true }));
    return;
  }
  if (request.method === "GET" && pathname === "/__runtime/state") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(state));
    return;
  }
  if (request.method === "GET" && pathname === "/__runtime/reflected-candidate") {
    response.writeHead(reflectedCandidate ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(reflectedCandidate ? JSON.stringify(reflectedCandidate) : undefined);
    return;
  }
  if (request.method === "PUT" && pathname === "/__runtime/reflected-candidate") {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
      response.writeHead(415); response.end(); return;
    }
    try {
      const candidate = JSON.parse((await readBody(request, 4096)).toString("utf8"));
      if (!candidate || !isDeepStrictEqual(Object.keys(candidate).sort(), ["field", "labId", "route", "value"]) ||
          candidate.labId !== initial.labId || candidate.route !== config.reflectedRoute ||
          candidate.field !== config.reflectedField || typeof candidate.value !== "string" ||
          !candidate.value || candidate.value.length > 500) {
        response.writeHead(422); response.end(); return;
      }
      reflectedCandidate = candidate;
      response.writeHead(204); response.end();
    } catch (error) {
      response.writeHead(error?.status || 400); response.end();
    }
    return;
  }
  if (request.method === "PUT" && pathname === "/__runtime/state") {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
      response.writeHead(415); response.end(); return;
    }
    try {
      const next = JSON.parse((await readBody(request, 65536)).toString("utf8"));
      if (!validTransition(next, request.headers["x-web-lab-field"], request.headers["x-web-lab-route"])) {
        response.writeHead(422); response.end(); return;
      }
      state = next;
      response.writeHead(204); response.end();
    } catch (error) {
      response.writeHead(error?.status || 400); response.end();
    }
    return;
  }
  response.writeHead(404); response.end();
}).listen(8081, "127.0.0.1");
`;

const ingressShim = String.raw`"use strict";
const http = require("node:http");
const { timingSafeEqual } = require("node:crypto");

const secret = process.env.AMNIORA_HOP_SECRET || "";
const graderSecret = process.env.AMNIORA_GRADER_SECRET || "";
if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("invalid_hop_authority");
if (!/^[A-Za-z0-9_-]{43}$/.test(graderSecret)) throw new Error("invalid_grader_authority");
const forwardedHeaders = ["accept", "accept-language", "content-type", "content-length", "x-web-lab-field", "x-web-lab-route"];
const responseHeaders = new Set(["cache-control", "content-type", "x-content-type-options", "x-amniora-hop-forwarded"]);

function authorizedWith(value, authority) {
  const candidate = typeof value === "string" ? Buffer.from(value) : Buffer.alloc(0);
  const expected = Buffer.from(authority);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000 }, (request, response) => {
  if (!authorizedWith(request.headers["x-web-lab-proxy-key"], secret)) {
    response.writeHead(403, { "Cache-Control": "no-store" }); response.end(); return;
  }
  if (!["GET", "HEAD", "PUT"].includes(request.method || "")) {
    response.writeHead(405, { "Cache-Control": "no-store" }); response.end(); return;
  }
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (request.method === "GET" && pathname === "/__runtime/reflected-candidate" &&
      !authorizedWith(request.headers["x-web-lab-grader-key"], graderSecret)) {
    response.writeHead(404, { "Cache-Control": "no-store" }); response.end(); return;
  }
  const declared = request.headers["content-length"];
  if ((declared && (!/^\d+$/.test(declared) || Number(declared) > 65536)) || request.headers["transfer-encoding"]) {
    response.writeHead(413, { "Cache-Control": "no-store" }); response.end(); return;
  }
  const headers = { host: "127.0.0.1:8081" };
  for (const name of forwardedHeaders) {
    if (typeof request.headers[name] === "string") headers[name] = request.headers[name];
  }
  const upstream = http.request({
    hostname: "127.0.0.1", port: 8081, method: request.method, path: request.url, headers, timeout: 5000,
  }, target => {
    const safe = {};
    for (const [name, value] of Object.entries(target.headers)) {
      if (responseHeaders.has(name) && typeof value === "string") safe[name] = value;
    }
    response.writeHead(target.statusCode || 502, safe);
    target.pipe(response);
  });
  upstream.on("timeout", () => upstream.destroy(new Error("upstream_timeout")));
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  request.pipe(upstream);
}).listen(8080, "0.0.0.0");
`;

/** Builds only learner-runtime files. The spec and internal solution are never serialized. */
export function buildVercelRuntimeBundle(spec: WebLabSpec): readonly VercelRuntimeBundleFile[] {
  const compiled = compileWebLab(spec);
  const template = webApplicationTemplate(spec.templateId);
  if (!template) throw new Error("unknown_web_lab_template");
  const stored = template.bindings.stored;
  const reflected = template.bindings.reflected;
  const writableObjectIds = spec.templateId === "ecommerce"
    ? (spec.products ?? []).filter(product => product.reviewEnabled).map(product => product.id)
    : (spec.tickets ?? []).filter(ticket => ticket.replyEnabled && ticket.ownerId === spec.session.displayUserId).map(ticket => ticket.id);
  return [
    { path: "index.html", content: runtimeHtml(compiled.html, stored.input,
      reflected.input, reflected.route) },
    { path: "initial-state.json", content: JSON.stringify(canonicalWebLabRuntimeState(spec)) },
    { path: "runtime-config.json", content: JSON.stringify({
      storedField: stored.input,
      storedRoute: stored.route,
      reflectedField: reflected.input,
      reflectedRoute: reflected.route,
      writableObjectIds,
      displayUserId: spec.session.displayUserId,
    }) },
    { path: "challenge-server.cjs", content: challengeServer, mode: 0o644 },
    { path: "ingress-shim.cjs", content: ingressShim, mode: 0o644 },
  ];
}
