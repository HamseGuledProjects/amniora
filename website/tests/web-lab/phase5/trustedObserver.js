// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS trusted browser observer. */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveBrowserExecutable } = require("../browserDiscovery");
const { attestObservedWebLabEvent, evaluateWebLabResult } = require("./loadWebLab");

const SIGNAL = "AMNIORA_PHASE5_HARMLESS_EXECUTION";
const BROWSER_START_TIMEOUT_MS = 15_000;
const BROWSER_START_POLL_MS = 100;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const readDevToolsActivePort = profile => {
  try {
    const value = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0].trim();
    const port = Number(value);
    return /^\d+$/.test(value) && Number.isInteger(port) && port > 0 && port <= 65_535 ? value : undefined;
  } catch {
    return undefined;
  }
};
const waitForDevToolsActivePort = (browser, profile, getBrowserError, onTimeout) => new Promise((resolve, reject) => {
  let settled = false;
  let pollTimer;
  let timeoutTimer;
  const cleanup = () => {
    clearTimeout(pollTimer);
    clearTimeout(timeoutTimer);
    browser.removeListener("error", onError);
    browser.removeListener("exit", onExit);
  };
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    cleanup();
    callback(value);
  };
  const failForProcessState = () => {
    const browserError = getBrowserError();
    if (browserError) {
      finish(reject, new Error(`Trusted browser process error before debugger readiness: ${browserError.message}`, {
        cause: browserError,
      }));
      return true;
    }
    if (browser.exitCode !== null || browser.signalCode !== null) {
      const outcome = browser.signalCode ? `signal ${browser.signalCode}` : `exit code ${browser.exitCode}`;
      finish(reject, new Error(`Trusted browser exited before debugger readiness (${outcome})`));
      return true;
    }
    return false;
  };
  const check = () => {
    if (failForProcessState()) return;
    const port = readDevToolsActivePort(profile);
    if (port) {
      finish(resolve, port);
      return;
    }
    pollTimer = setTimeout(check, BROWSER_START_POLL_MS);
  };
  const onError = error => finish(reject,
    new Error(`Trusted browser process error before debugger readiness: ${error.message}`, { cause: error }));
  const onExit = (code, signal) => {
    const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
    finish(reject, new Error(`Trusted browser exited before debugger readiness (${outcome})`));
  };

  browser.once("error", onError);
  browser.once("exit", onExit);
  timeoutTimer = setTimeout(() => {
    if (failForProcessState()) return;
    const port = readDevToolsActivePort(profile);
    if (port) finish(resolve, port);
    else {
      onTimeout();
      finish(reject, new Error(`Trusted browser debugger failed to start within ${BROWSER_START_TIMEOUT_MS}ms`));
    }
  }, BROWSER_START_TIMEOUT_MS);
  check();
});
const waitForBrowserExit = (browser, timeout = 5000) => {
  if (browser.pid === undefined || browser.exitCode !== null || browser.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const onExit = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { browser.removeListener("exit", onExit); resolve(); }, timeout);
    browser.once("exit", onExit);
  });
};
const sinkSelectors = {
  "catalog-summary": "#catalog-summary",
  "search-summary": "#search-summary",
  "product-review-body": "[data-review-body]",
  "ticket-comment-body": "[data-ticket-comment-body]",
};

async function browserSession(callback, extraHeaders = {}, options = {}) {
  const profile = fs.mkdtempSync(path.join("/private/tmp", "amniora-web-grader-"));
  const spawnTimestamp = Date.now();
  const browser = spawn(resolveBrowserExecutable(), [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    ...(options.ignoreCertificateErrors === true ? ["--ignore-certificate-errors"] : []),
    "--user-data-dir=" + profile, "about:blank",
  ], { stdio: "ignore" });
  let browserError;
  let cleanupStarted = false;
  const diagnostic = (event, details = {}) => {
    const eventTimestamp = Date.now();
    console.error("[trusted-browser] " + JSON.stringify({
      event,
      pid: browser.pid ?? null,
      spawnTimestamp: new Date(spawnTimestamp).toISOString(),
      eventTimestamp: new Date(eventTimestamp).toISOString(),
      elapsedMilliseconds: eventTimestamp - spawnTimestamp,
      cleanupStarted,
      ...details,
    }));
  };
  diagnostic("spawned");
  browser.on("error", error => {
    browserError = error;
    diagnostic("spawn-error", { errorName: error.name, errorMessage: error.message });
  });
  browser.on("exit", (exitCode, exitSignal) => diagnostic("exit", { exitCode, exitSignal }));
  let ws;
  try {
    const port = await waitForDevToolsActivePort(browser, profile, () => browserError,
      () => diagnostic("readiness-timeout"));
    const devToolsPortTimestamp = Date.now();
    const startup = {
      pid: browser.pid,
      spawnTimestamp: new Date(spawnTimestamp).toISOString(),
      devToolsPortTimestamp: new Date(devToolsPortTimestamp).toISOString(),
      milliseconds: devToolsPortTimestamp - spawnTimestamp,
    };
    diagnostic("devtools-port-ready", { startupMilliseconds: startup.milliseconds });
    let target;
    for (let attempt = 0; attempt < 50 && !target; attempt++) {
      if (browserError) throw browserError;
      try {
        const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list", {
          signal: AbortSignal.timeout(500),
        })).json();
        target = targets.find(item => item.type === "page" && item.webSocketDebuggerUrl);
      } catch { /* debugger target starting */ }
      if (!target) await wait(100);
    }
    if (!target?.webSocketDebuggerUrl) throw new Error("Trusted browser page unavailable");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    const consoleEvents = [];
    ws.addEventListener("message", message => {
      const data = JSON.parse(message.data);
      if (data.id && pending.has(data.id)) {
        pending.get(data.id)(data);
        pending.delete(data.id);
      }
      if (data.method === "Runtime.consoleAPICalled") consoleEvents.push(data.params);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Browser command timed out: " + method)); }, 5000);
      pending.set(id, result => { clearTimeout(timer); resolve(result); });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (reply.error || reply.result?.exceptionDetails) throw new Error("Trusted browser evaluation failed");
      return reply.result?.result?.value;
    };
    const navigate = async url => {
      const result = await send("Page.navigate", { url });
      if (result.error || result.result?.errorText) throw new Error("Trusted browser navigation failed");
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          if (await evaluate("document.readyState === 'complete' && !!document.getElementById('brand')?.textContent")) return;
        } catch { /* page loading */ }
        await wait(100);
      }
      throw new Error("Trusted browser page did not become ready");
    };
    await send("Page.enable");
    await send("Runtime.enable");
    if (Object.keys(extraHeaders).length) {
      await send("Network.enable");
      await send("Network.setExtraHTTPHeaders", { headers: extraHeaders });
    }
    return await callback({ send, evaluate, navigate, consoleEvents, startup });
  } finally {
    cleanupStarted = true;
    diagnostic("cleanup-started");
    if (ws) ws.close();
    const browserExit = waitForBrowserExit(browser);
    diagnostic("cleanup-signal", { signal: "SIGTERM", delivered: browser.kill() });
    await browserExit;
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function signalled(events) {
  return events.some(event => event.args?.some(arg => arg.value === SIGNAL));
}

async function gradeInstance(record, { input } = {}) {
  const spec = record.spec;
  const solution = spec.internalSolution;
  const selector = sinkSelectors[solution.sink];
  if (!selector) throw new Error("Unknown trusted sink binding");
  const incomplete = { status: "not-complete", reason: "no-matching-trusted-observation" };
  const accessHeaders = {
    ...(record.proxyAccessKey ? { "X-Web-Lab-Proxy-Key": record.proxyAccessKey } : {}),
    ...(record.cookieHeader ? { Cookie: record.cookieHeader } : {}),
  };
  let storedEntry;
  if (solution.behavior === "stored") {
    const response = await fetch(record.endpoint + "/__runtime/state", {
      headers: accessHeaders,
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error("Runtime state unavailable to trusted observer");
    const state = await response.json();
    const flow = solution.storedFlow;
    storedEntry = state.contentByObject?.[flow.targetObjectId]?.find(entry =>
      entry.submittedByLearner === true && typeof entry.body === "string" && entry.body.includes(SIGNAL));
    if (!storedEntry) return incomplete;
  } else if (typeof input !== "string" || !input.includes(SIGNAL)) {
    return incomplete;
  }
  return browserSession(async browser => {
    const unrelated = spec.templateId === "ecommerce" ? "/catalog" : "/articles";
    await browser.navigate(record.endpoint + "/#" + unrelated);
    await browser.send("Page.reload", { ignoreCache: true });
    await wait(200);
    if (signalled(browser.consoleEvents)) return incomplete;
    const targetHash = solution.behavior === "stored"
      ? solution.route + "?id=" + encodeURIComponent(solution.storedFlow.targetObjectId)
      : solution.route + "?" + encodeURIComponent(solution.input) + "=" + encodeURIComponent(input);
    await browser.navigate(record.endpoint + "/#" + targetHash);
    for (let attempt = 0; attempt < 30 && !signalled(browser.consoleEvents); attempt++) await wait(100);
    if (!signalled(browser.consoleEvents)) return incomplete;
    const sinkHasExecutionNode = await browser.evaluate(
      "!!document.querySelector(" + JSON.stringify(selector + " img[onerror]") + ")?.getAttribute('onerror')?.includes(" +
      JSON.stringify(SIGNAL) + ")"
    );
    if (!sinkHasExecutionNode) return incomplete;
    if (solution.behavior === "stored") {
      const rendered = await browser.evaluate(
        "Array.from(document.querySelectorAll(" + JSON.stringify(selector) + ")).some(node => " +
        "node.querySelector('img[onerror]')?.getAttribute('onerror')?.includes(" + JSON.stringify(SIGNAL) + "))"
      );
      if (!rendered) return incomplete;
    }
    const event = {
      labId: spec.labId,
      moduleId: solution.moduleId,
      eventType: solution.successCondition,
      route: solution.route,
      input: solution.input,
      sink: solution.sink,
      renderingContext: solution.renderingContext,
      ...(solution.storedFlow ? {
        storedEvidence: { ...solution.storedFlow, instanceId: record.instanceId, storedBeforeRender: true },
      } : {}),
    };
    return evaluateWebLabResult(spec, [attestObservedWebLabEvent(event)], record.instanceId);
  }, accessHeaders, { ignoreCertificateErrors: record.ignoreCertificateErrors === true });
}

module.exports = { SIGNAL, gradeInstance, browserSession };
