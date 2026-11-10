// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free Node container runtime. */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const { isDeepStrictEqual } = require("node:util");

const html = fs.readFileSync("/bundle/index.html", "utf8");
const initial = JSON.parse(fs.readFileSync("/bundle/initial-state.json", "utf8"));
const config = JSON.parse(fs.readFileSync("/bundle/runtime-config.json", "utf8"));
let state = structuredClone(initial);

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

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method === "GET" && pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (request.method === "GET" && pathname === "/__runtime/state") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(state));
    return;
  }
  if (request.method === "PUT" && pathname === "/__runtime/state") {
    if (request.headers["content-type"] !== "application/json") {
      response.writeHead(415); response.end(); return;
    }
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 65536) request.destroy();
    });
    request.on("end", () => {
      let next;
      try { next = JSON.parse(body); } catch { response.writeHead(400); response.end(); return; }
      if (!validTransition(next, request.headers["x-web-lab-field"], request.headers["x-web-lab-route"])) {
        response.writeHead(422); response.end(); return;
      }
      state = next;
      response.writeHead(204); response.end();
    });
    return;
  }
  response.writeHead(404); response.end();
});
server.listen(8080, "0.0.0.0");
