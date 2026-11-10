/** Server-only deterministic hosted grader. It never accepts learner grading rules. */
import "server-only";

import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeBackendContext } from "./control-plane";
import type { ReconciliableRuntimeBackend } from "./durable-control-plane";
import { attestObservedWebLabEvent, evaluateWebLabResult } from "./grading";
import { canonicalJson } from "./canonical-json";
import type { InternalRuntimeState } from "./postgres-control-repository";
import type { WebLabTrustedGrader } from "./production-control-service";
import type { WebLabSpec } from "./schema";

export const PRODUCTION_WEB_LAB_GRADER_VERSION = "hosted-browser-observer-v1";
export const WEB_LAB_HARMLESS_EXECUTION_SIGNAL = "AMNIORA_PHASE5_HARMLESS_EXECUTION";

type TrustedGradeTarget = Readonly<{
  kind: "vercel-sandbox";
  origin: string;
  requestHeaders: Readonly<Record<string, string>>;
}>;

export interface TrustedHostedGradeBackend extends ReconciliableRuntimeBackend {
  resolveTrustedGradeTarget(reference: string,
    expected: RuntimeBackendContext): Promise<TrustedGradeTarget | null>;
}

type BrowserGradeResult = Readonly<{
  status: "pass" | "not-complete";
  reason: "trusted-observation-matched" | "no-matching-trusted-observation";
}>;

const SINK_SELECTORS: Readonly<Record<string, string>> = Object.freeze({
  "catalog-summary": "#catalog-summary",
  "search-summary": "#search-summary",
  "product-review-body": "[data-review-body]",
  "ticket-comment-body": "[data-ticket-comment-body]",
});

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return !!value && !Array.isArray(value) && typeof value === "object" &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function validTarget(target: TrustedGradeTarget | null): target is TrustedGradeTarget {
  if (!target || target.kind !== "vercel-sandbox" ||
      !exactKeys(target.requestHeaders, ["X-Web-Lab-Grader-Key", "X-Web-Lab-Proxy-Key"]) ||
      !Object.values(target.requestHeaders).every(value =>
        typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value))) return false;
  try {
    const url = new URL(target.origin);
    return !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)));
  } catch { return false; }
}

function trustedBackend(value: ReconciliableRuntimeBackend): value is TrustedHostedGradeBackend {
  return typeof (value as Partial<TrustedHostedGradeBackend>).resolveTrustedGradeTarget === "function";
}

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("trusted_grader_timeout");
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() { signal.removeEventListener("abort", cancel); resolve(); }
    function cancel() { clearTimeout(timer); reject(new Error("trusted_grader_timeout")); }
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function boundedText(response: Response, maximumBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > maximumBytes) throw new Error("trusted_runtime_response_too_large");
  const value = await response.text();
  if (Buffer.byteLength(value, "utf8") > maximumBytes) throw new Error("trusted_runtime_response_too_large");
  return value;
}

type CdpReply = Readonly<{ id?: number; error?: unknown; result?: Record<string, unknown> }>;
type CdpConsoleEvent = Readonly<{ args?: readonly Readonly<{ value?: unknown }>[] }>;

class ChromiumSession {
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (reply: CdpReply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  readonly consoleEvents: CdpConsoleEvent[] = [];

  private constructor(
    private readonly browser: ChildProcess,
    private readonly profile: string,
    private readonly socket: WebSocket,
    private readonly signal: AbortSignal,
  ) {
    socket.addEventListener("message", event => {
      let data: Record<string, unknown>;
      try { data = JSON.parse(String(event.data)) as Record<string, unknown>; }
      catch { return; }
      if (typeof data.id === "number") {
        const entry = this.pending.get(data.id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(data.id);
          entry.resolve(data as CdpReply);
        }
      }
      if (data.method === "Runtime.consoleAPICalled" && exactKeys(data.params, ["args", "executionContextId", "stackTrace", "timestamp", "type"])) {
        this.consoleEvents.push(data.params as CdpConsoleEvent);
      } else if (data.method === "Runtime.consoleAPICalled" && data.params && typeof data.params === "object") {
        this.consoleEvents.push(data.params as CdpConsoleEvent);
      }
    });
  }

  static async start(browserExecutable: string, headers: Readonly<Record<string, string>>,
    signal: AbortSignal): Promise<ChromiumSession> {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-trusted-grader-"));
    const browser = spawn(browserExecutable, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
      `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore" });
    try {
      let port: string | null = null;
      for (let attempt = 0; attempt < 150 && !port; attempt++) {
        aborted(signal);
        if (browser.exitCode !== null || browser.signalCode !== null) {
          throw new Error("trusted_browser_exited_before_ready");
        }
        try {
          const candidate = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8")
            .split("\n", 1)[0].trim();
          if (/^\d+$/.test(candidate) && Number(candidate) > 0 && Number(candidate) <= 65_535) port = candidate;
        } catch { /* browser is starting */ }
        if (!port) await wait(100, signal);
      }
      if (!port) throw new Error("trusted_browser_debugger_unavailable");
      let target: { webSocketDebuggerUrl?: string } | null = null;
      for (let attempt = 0; attempt < 50 && !target?.webSocketDebuggerUrl; attempt++) {
        aborted(signal);
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
          });
          const candidates = JSON.parse(await boundedText(response, 32_768)) as readonly {
            type?: string; webSocketDebuggerUrl?: string;
          }[];
          target = candidates.find(item => item.type === "page" && item.webSocketDebuggerUrl) ?? null;
        } catch { /* debugger target is starting */ }
        if (!target?.webSocketDebuggerUrl) await wait(100, signal);
      }
      if (!target?.webSocketDebuggerUrl) throw new Error("trusted_browser_page_unavailable");
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise<void>((resolve, reject) => {
        const cancel = () => reject(new Error("trusted_grader_timeout"));
        signal.addEventListener("abort", cancel, { once: true });
        socket.addEventListener("open", () => {
          signal.removeEventListener("abort", cancel);
          resolve();
        }, { once: true });
        socket.addEventListener("error", () => {
          signal.removeEventListener("abort", cancel);
          reject(new Error("trusted_browser_socket_failed"));
        }, { once: true });
      });
      const session = new ChromiumSession(browser, profile, socket, signal);
      await session.send("Page.enable");
      await session.send("Runtime.enable");
      await session.send("Network.enable");
      await session.send("Network.setExtraHTTPHeaders", { headers });
      return session;
    } catch (error) {
      browser.kill();
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      throw error;
    }
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<CdpReply> {
    aborted(this.signal);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("trusted_browser_command_timeout"));
      }, 5_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<unknown> {
    const reply = await this.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    const result = reply.result as { exceptionDetails?: unknown; result?: { value?: unknown } } | undefined;
    if (reply.error || result?.exceptionDetails) throw new Error("trusted_browser_evaluation_failed");
    return result?.result?.value;
  }

  async navigate(url: string): Promise<void> {
    const reply = await this.send("Page.navigate", { url });
    const result = reply.result as { errorText?: string } | undefined;
    if (reply.error || result?.errorText) throw new Error("trusted_browser_navigation_failed");
    for (let attempt = 0; attempt < 60; attempt++) {
      aborted(this.signal);
      try {
        if (await this.evaluate("document.readyState === 'complete' && !!document.getElementById('brand')?.textContent")) return;
      } catch { /* page is loading */ }
      await wait(100, this.signal);
    }
    throw new Error("trusted_browser_page_not_ready");
  }

  async close(): Promise<void> {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("trusted_browser_closed"));
      this.pending.delete(id);
    }
    this.socket.close();
    this.browser.kill();
    if (this.browser.exitCode === null && this.browser.signalCode === null) {
      await Promise.race([
        new Promise<void>(resolve => this.browser.once("exit", () => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 2_000)),
      ]);
    }
    fs.rmSync(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function signalled(events: readonly CdpConsoleEvent[]): boolean {
  return events.some(event => event.args?.some(arg => arg.value === WEB_LAB_HARMLESS_EXECUTION_SIGNAL));
}

/** Runs only on trusted infrastructure with a reviewed Chromium-family binary. */
export class NodeChromiumWebLabObserver {
  readonly production = true as const;

  constructor(private readonly browserExecutable: string) {
    if (!path.isAbsolute(browserExecutable)) throw new Error("trusted_browser_path_must_be_absolute");
    const stat = fs.statSync(browserExecutable);
    if (!stat.isFile()) throw new Error("trusted_browser_path_not_file");
    fs.accessSync(browserExecutable, fs.constants.X_OK);
  }

  async grade(input: { spec: WebLabSpec; instanceId: string; target: TrustedGradeTarget;
    signal: AbortSignal }): Promise<BrowserGradeResult> {
    const { spec, instanceId, target, signal } = input;
    const incomplete = { status: "not-complete",
      reason: "no-matching-trusted-observation" } as const;
    const solution = spec.internalSolution;
    const selector = SINK_SELECTORS[solution.sink];
    if (!selector || !validTarget(target)) throw new Error("trusted_grade_target_invalid");

    let candidate: string;
    if (solution.behavior === "stored") {
      const response = await fetch(`${target.origin}/__runtime/state`, {
        headers: target.requestHeaders,
        signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
      });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) {
        throw new Error("trusted_runtime_state_unavailable");
      }
      const state = JSON.parse(await boundedText(response, 65_536)) as Record<string, unknown>;
      const entries = (state.contentByObject as Record<string, unknown[]> | undefined)?.[
        solution.storedFlow!.targetObjectId
      ];
      let storedCandidate: string | null = null;
      for (const value of entries ?? []) {
        if (exactKeys(value, ["authorId", "body", "id", "submittedByLearner"]) &&
            value.submittedByLearner === true && typeof value.body === "string" &&
            value.body.includes(WEB_LAB_HARMLESS_EXECUTION_SIGNAL)) {
          storedCandidate = value.body;
          break;
        }
      }
      if (!storedCandidate) return incomplete;
      candidate = storedCandidate;
    } else {
      const response = await fetch(`${target.origin}/__runtime/reflected-candidate`, {
        headers: target.requestHeaders,
        signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
      });
      if (response.status === 404) return incomplete;
      if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) {
        throw new Error("trusted_runtime_candidate_unavailable");
      }
      const value = JSON.parse(await boundedText(response, 4_096)) as unknown;
      if (!exactKeys(value, ["field", "labId", "route", "value"]) ||
          value.labId !== spec.labId || value.route !== solution.route ||
          value.field !== solution.input || typeof value.value !== "string" ||
          !value.value.includes(WEB_LAB_HARMLESS_EXECUTION_SIGNAL)) return incomplete;
      candidate = value.value;
    }

    const browser = await ChromiumSession.start(this.browserExecutable, target.requestHeaders, signal);
    try {
      const unrelated = spec.templateId === "ecommerce" ? "/catalog" : "/articles";
      await browser.navigate(`${target.origin}/#${unrelated}`);
      await browser.send("Page.reload", { ignoreCache: true });
      await wait(200, signal);
      if (signalled(browser.consoleEvents)) return incomplete;
      const targetHash = solution.behavior === "stored"
        ? `${solution.route}?id=${encodeURIComponent(solution.storedFlow!.targetObjectId)}`
        : `${solution.route}?${encodeURIComponent(solution.input)}=${encodeURIComponent(candidate)}`;
      await browser.navigate(`${target.origin}/#${targetHash}`);
      for (let attempt = 0; attempt < 30 && !signalled(browser.consoleEvents); attempt++) {
        await wait(100, signal);
      }
      if (!signalled(browser.consoleEvents)) return incomplete;
      const containsSignalNode = await browser.evaluate(
        `!!document.querySelector(${JSON.stringify(`${selector} img[onerror]`)})?.getAttribute('onerror')?.includes(${JSON.stringify(WEB_LAB_HARMLESS_EXECUTION_SIGNAL)})`,
      );
      if (!containsSignalNode) return incomplete;
      const event = attestObservedWebLabEvent({
        labId: spec.labId,
        moduleId: solution.moduleId,
        eventType: solution.successCondition,
        route: solution.route,
        input: solution.input,
        sink: solution.sink,
        renderingContext: solution.renderingContext,
        ...(solution.storedFlow ? { storedEvidence: {
          ...solution.storedFlow, instanceId, storedBeforeRender: true as const,
        } } : {}),
      });
      const evaluated = evaluateWebLabResult(spec, [event], instanceId);
      return evaluated.status === "pass"
        ? { status: "pass", reason: "trusted-observation-matched" }
        : incomplete;
    } finally {
      await browser.close();
    }
  }
}

export class HostedWebLabTrustedGrader implements WebLabTrustedGrader {
  readonly production = true as const;

  constructor(private readonly observer: NodeChromiumWebLabObserver,
    private readonly timeoutMs = 20_000) {
    if (observer.production !== true || !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 5_000 || timeoutMs > 30_000) throw new Error("trusted_grader_configuration_invalid");
  }

  async grade(input: { spec: WebLabSpec; runtime: InternalRuntimeState;
    backend: ReconciliableRuntimeBackend; context: RuntimeBackendContext }) {
    const { runtime, backend, context, spec } = input;
    if (runtime.runtimeMode !== "amniora_hosted" || runtime.providerKind !== "vercel_sandbox" ||
        runtime.status !== "ready" || !runtime.backendReference ||
        runtime.backendReference !== runtime.instanceId || context.instanceId !== runtime.instanceId ||
        context.generationVersion !== runtime.generationVersion ||
        context.runtimeVersion !== runtime.runtimeVersion || !trustedBackend(backend)) {
      return { outcome: "error" as const, graderVersion: PRODUCTION_WEB_LAB_GRADER_VERSION };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const inspected = await Promise.race([
        backend.inspect(runtime.backendReference, context),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort",
          () => reject(new Error("trusted_grader_timeout")), { once: true })),
      ]);
      if (inspected.state !== "ready" || !inspected.observation ||
          inspected.observation.instanceId !== context.instanceId ||
          inspected.observation.buildFingerprint !== context.buildFingerprint ||
          inspected.observation.generationVersion !== context.generationVersion ||
          inspected.observation.runtimeVersion !== context.runtimeVersion) {
        return { outcome: "error" as const, graderVersion: PRODUCTION_WEB_LAB_GRADER_VERSION };
      }
      const target = await backend.resolveTrustedGradeTarget(runtime.backendReference, context);
      if (!validTarget(target)) {
        return { outcome: "error" as const, graderVersion: PRODUCTION_WEB_LAB_GRADER_VERSION };
      }
      const result = await this.observer.grade({ spec, instanceId: runtime.instanceId,
        target, signal: controller.signal });
      if (result.status !== "pass") {
        return { outcome: "not_complete" as const, graderVersion: PRODUCTION_WEB_LAB_GRADER_VERSION };
      }
      const observationFingerprint = createHash("sha256").update(canonicalJson({
        instanceId: runtime.instanceId,
        buildFingerprint: context.buildFingerprint,
        generationVersion: context.generationVersion,
        runtimeVersion: context.runtimeVersion,
        canonicalLabId: spec.labId,
        moduleId: spec.internalSolution.moduleId,
        outcome: "pass",
        reason: result.reason,
        graderVersion: PRODUCTION_WEB_LAB_GRADER_VERSION,
      })).digest("hex");
      return { outcome: "pass" as const, observationFingerprint,
        graderVersion: PRODUCTION_WEB_LAB_GRADER_VERSION };
    } catch {
      return { outcome: "error" as const, graderVersion: PRODUCTION_WEB_LAB_GRADER_VERSION };
    } finally {
      clearTimeout(timer);
    }
  }
}
