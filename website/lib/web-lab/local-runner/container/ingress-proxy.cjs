/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free fixed-purpose container runtime. */
/* This ingress is the only process with a loopback-published host port. */
"use strict";
const http = require("node:http");

const upstreamHost = process.env.AMNIORA_LOCAL_UPSTREAM || "";
if (!/^amniora-lr-[0-9a-f]{32}-g[1-9][0-9]*-challenge$/.test(upstreamHost)) throw new Error("invalid_fixed_upstream");
const forwardedHeaders = new Set(["accept", "accept-language", "content-type", "content-length", "x-web-lab-field", "x-web-lab-route"]);
const responseHeaders = new Set(["cache-control", "content-type", "x-content-type-options"]);

http.createServer({ maxHeaderSize: 8192, requestTimeout: 10_000 }, (request, response) => {
  if (!["GET", "HEAD", "POST", "PUT"].includes(request.method || "")) {
    response.writeHead(405, { "Cache-Control": "no-store" }); response.end(); return;
  }
  const declared = request.headers["content-length"];
  if ((declared && (!/^\d+$/.test(declared) || Number(declared) > 65_536)) || request.headers["transfer-encoding"]) {
    response.writeHead(413, { "Cache-Control": "no-store" }); response.end(); return;
  }
  if (["POST", "PUT"].includes(request.method || "") && Number(declared || 0) > 0 &&
      !/^(?:application\/json|application\/x-www-form-urlencoded|text\/plain)(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
    response.writeHead(415, { "Cache-Control": "no-store" }); response.end(); return;
  }
  const headers = { host: upstreamHost + ":8080" };
  for (const [name, value] of Object.entries(request.headers)) {
    if (forwardedHeaders.has(name) && typeof value === "string") headers[name] = value;
  }
  const upstream = http.request({
    host: upstreamHost, port: 8080, method: request.method, path: request.url, headers, timeout: 5_000,
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
