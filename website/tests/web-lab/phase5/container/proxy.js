// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free Node proxy. */
"use strict";
const http = require("node:http");
const { timingSafeEqual } = require("node:crypto");
const upstreamHost = process.env.WEB_LAB_UPSTREAM_HOST;
if (!/^amniora-web-[0-9a-f]{32}$/.test(upstreamHost || "")) throw new Error("Invalid fixed upstream");
const proxyKey = process.env.WEB_LAB_PROXY_KEY || null;
if (proxyKey && !/^[A-Za-z0-9_-]{43}$/.test(proxyKey)) throw new Error("Invalid local proxy key");

const forwardedHeaders = ["accept", "accept-language", "content-type", "content-length", "x-web-lab-field", "x-web-lab-route"];

http.createServer((request, response) => {
  if (proxyKey) {
    const provided = request.headers["x-web-lab-proxy-key"];
    const candidate = typeof provided === "string" ? Buffer.from(provided) : Buffer.alloc(0);
    const expected = Buffer.from(proxyKey);
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      response.writeHead(403, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
  }
  const headers = { host: upstreamHost + ":8080" };
  for (const name of forwardedHeaders) {
    if (typeof request.headers[name] === "string") headers[name] = request.headers[name];
  }
  const upstream = http.request({
    host: upstreamHost,
    port: 8080,
    method: request.method,
    path: request.url,
    headers,
    timeout: 5000,
  }, target => {
    response.writeHead(target.statusCode, target.headers);
    target.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
}).listen(8080, "0.0.0.0");
