import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { InMemoryPairingService } from "./pairing-service";
import {
  LocalFirstError,
  hasExactKeys,
  isPlainObject,
  validIdempotencyKey,
} from "./protocol";
import type { InMemoryCommandTicketService } from "./ticket-service";

const BODY_LIMIT = 8_192;
const SESSION_COOKIE = "amniora_phase1_session";

type Session = Readonly<{ accountId: string; csrf: string }>;

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function cookie(request: IncomingMessage, name: string): string | null {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [candidate, ...rest] = part.trim().split("=");
    if (candidate === name) return rest.join("=");
  }
  return null;
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > BODY_LIMIT) throw new LocalFirstError("REQUEST_INVALID");
    chunks.push(bytes);
  }
  if (length === 0 || request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new LocalFirstError("REQUEST_INVALID");
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new LocalFirstError("REQUEST_INVALID"); }
}

function page(csrf: string): string {
  const scriptNonce = randomBytes(16).toString("base64url");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Amniora Local-First Runner Phase 1</title>
  <style nonce="${scriptNonce}">
    body { background: #07111f; color: #e7f6ff; font: 16px system-ui; margin: 0; min-height: 100vh; display: grid; place-items: center; }
    main { width: min(38rem, calc(100% - 2rem)); border: 1px solid #23445c; border-radius: 12px; padding: 2rem; background: #0b1929; }
    button { border: 0; border-radius: 8px; padding: .8rem 1rem; background: #35c6f4; color: #03111a; font-weight: 700; cursor: pointer; }
    pre { white-space: pre-wrap; min-height: 4rem; color: #b8d8e8; }
  </style>
</head>
<body>
  <main>
    <p>Local-first Phase 1 test harness</p>
    <h1>Secure Runner activation</h1>
    <p>The activation URI carries only an opaque, short-lived ticket. The paired installation key supplies authority.</p>
    <button id="check" type="button">Check Runner</button>
    <pre id="result" role="status">Ready.</pre>
  </main>
  <script nonce="${scriptNonce}">
    const button = document.querySelector('#check');
    const output = document.querySelector('#result');
    button.addEventListener('click', async () => {
      button.disabled = true;
      output.textContent = 'Creating one-use ticket…';
      try {
        const issued = await fetch('/api/phase1/tickets', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': '${csrf}' },
          body: JSON.stringify({ operation: 'STATUS', idempotencyKey: crypto.randomUUID() }),
        }).then(async response => ({ ok: response.ok, body: await response.json() }));
        if (!issued.ok || !issued.body.activationUri) throw new Error(issued.body.error || 'ticket_failed');
        output.textContent = 'Activating Runner…';
        window.location.href = issued.body.activationUri;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 250));
          const observed = await fetch('/api/phase1/results/' + encodeURIComponent(issued.body.requestId), {
            headers: { 'x-csrf-token': '${csrf}' },
          }).then(async response => ({ ok: response.ok, body: await response.json() }));
          if (observed.ok && observed.body.state === 'completed') {
            output.textContent = 'Runner: ' + observed.body.result.status + '\\nSigned result verified by server.';
            return;
          }
        }
        throw new Error('result_timeout');
      } catch (error) {
        output.textContent = 'Request failed: ' + (error instanceof Error ? error.message : 'unknown');
      } finally { button.disabled = false; }
    });
  </script>
</body>
</html>`;
}

function errorStatus(error: LocalFirstError): number {
  if (["TICKET_REPLAYED", "RESULT_REPLAYED", "IDEMPOTENCY_CONFLICT"].includes(error.code)) return 409;
  if (["TICKET_EXPIRED", "PAIRING_EXPIRED"].includes(error.code)) return 410;
  if (["PROOF_INVALID", "RUNNER_MISMATCH", "ACCOUNT_MISMATCH", "PAIRING_REVOKED"].includes(error.code)) return 403;
  return 400;
}

export class LocalFirstPrototypeServer {
  private readonly sessions = new Map<string, Session>();
  private server: Server | null = null;
  private originValue: string | null = null;

  constructor(
    readonly pairings: InMemoryPairingService,
    readonly tickets: InMemoryCommandTicketService,
    private readonly testAccountId = "account_phase1_test",
  ) {}

  get origin(): string {
    if (!this.originValue) throw new Error("prototype_server_not_listening");
    return this.originValue;
  }

  async listen(): Promise<string> {
    if (this.server) return this.origin;
    this.server = createServer((request, response) => {
      this.handle(request, response).catch(error => {
        const safe = error instanceof LocalFirstError ? error : new LocalFirstError("REQUEST_INVALID");
        if (!response.headersSent) json(response, errorStatus(safe), { error: safe.code });
        else response.destroy();
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address() as AddressInfo;
    this.originValue = `http://127.0.0.1:${address.port}`;
    return this.originValue;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.originValue = null;
    this.sessions.clear();
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  private authenticated(request: IncomingMessage, requireCsrf = true): Session {
    const token = cookie(request, SESSION_COOKIE);
    const session = token ? this.sessions.get(token) : null;
    if (!session) throw new LocalFirstError("ACCOUNT_MISMATCH");
    if (requireCsrf) {
      const supplied = request.headers["x-csrf-token"];
      if (typeof supplied !== "string" || !safeEqual(supplied, session.csrf)) throw new LocalFirstError("ACCOUNT_MISMATCH");
    }
    return session;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.originValue) throw new LocalFirstError("REQUEST_INVALID");
    const url = new URL(request.url ?? "/", this.originValue);
    if (request.method === "GET" && url.pathname === "/") {
      const sessionToken = randomBytes(32).toString("base64url");
      const csrf = randomBytes(32).toString("base64url");
      this.sessions.set(sessionToken, Object.freeze({ accountId: this.testAccountId, csrf }));
      const html = page(csrf);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html),
        "Set-Cookie": `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
        "Content-Security-Policy": "default-src 'none'; style-src 'nonce-" + html.match(/nonce="([^"]+)"/)![1] + "'; script-src 'nonce-" + html.match(/nonce="([^"]+)"/)![1] + "'; connect-src 'self'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(html);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/phase1/tickets") {
      const session = this.authenticated(request);
      if (request.headers.origin !== this.originValue) throw new LocalFirstError("ACCOUNT_MISMATCH");
      const input = await body(request);
      if (!isPlainObject(input) || !hasExactKeys(input, ["operation", "idempotencyKey"]) ||
          input.operation !== "STATUS" || !validIdempotencyKey(input.idempotencyKey)) {
        throw new LocalFirstError("REQUEST_INVALID");
      }
      const installation = this.pairings.activeForAccount(session.accountId);
      if (!installation) throw new LocalFirstError("PAIRING_REVOKED");
      const issued = await this.tickets.issue({ accountId: session.accountId,
        installationId: installation.installationId, operation: "STATUS", buildId: null, runtimeId: null,
        generation: null, idempotencyKey: input.idempotencyKey });
      json(response, 201, issued);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/phase1/redeem") {
      json(response, 200, await this.tickets.redeem(await body(request)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/phase1/results") {
      json(response, 200, await this.tickets.submitResult(await body(request)));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/phase1/results/")) {
      const session = this.authenticated(request);
      const requestId = decodeURIComponent(url.pathname.slice("/api/phase1/results/".length));
      json(response, 200, this.tickets.observe(session.accountId, requestId));
      return;
    }
    json(response, 404, { error: "NOT_FOUND" });
  }
}
