#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const qaUrl = process.env.AMNIORA_R1_QA_URL;
if (!qaUrl) throw new Error("Set AMNIORA_R1_QA_URL to a local design-system QA URL.");

const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => fs.existsSync(candidate));
if (!chrome) throw new Error("No Chromium browser found for Phase R1 visual probe.");

const widths = [320, 390, 768, 1024, 1440, 1920];
let assertions = 0;
let commandId = 1;

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(target) {
  const response = await fetch(target);
  if (!response.ok) throw new Error(`${target} returned ${response.status}`);
  return response.json();
}

async function runViewport(width) {
  const port = 9600 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), `amniora-r1-visual-${width}-`));
  const child = spawn(chrome, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await fetchJson(`http://127.0.0.1:${port}/json/version`);
        break;
      } catch {
        await wait(150);
      }
    }

    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const pageTarget = targets.find((target) => target.type === "page") || targets[0];
    assert(`${width}px has browser page target`, Boolean(pageTarget?.webSocketDebuggerUrl));

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });

    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      const resolver = pending.get(data.id);
      if (resolver) {
        pending.delete(data.id);
        resolver(data);
      }
    });

    const send = (method, params = {}) => new Promise((resolve) => {
      const id = commandId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1300,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await send("Page.navigate", { url: qaUrl });
    await wait(1400);

    const expression = `(() => {
      const doc = document.documentElement;
      const elements = Array.from(document.querySelectorAll('main, section, button, input, select, textarea, table, [data-density], [aria-label="Evidence examples"]'));
      const wide = [];
      const empty = [];
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.width > window.innerWidth + 1) wide.push(element.tagName);
        if (rect.width <= 0 || rect.height <= 0) empty.push(element.tagName);
      }
      const technical = Array.from(document.querySelectorAll('.technical-value, .type-mono-metadata'));
      const inaccessibleTechnical = technical.filter((element) => element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX === 'visible');
      const focusTarget = document.querySelector('input[aria-label="Sample input"]');
      if (focusTarget) focusTarget.focus();
      const beta = document.querySelector('aside');
      const betaRect = beta ? beta.getBoundingClientRect() : null;
      return {
        viewportWidth: window.innerWidth,
        scrollWidth: doc.scrollWidth,
        overflow: doc.scrollWidth > window.innerWidth + 1,
        wide,
        empty,
        inaccessibleTechnical: inaccessibleTechnical.length,
        focusedSampleInput: document.activeElement === focusTarget,
        betaViewportShare: betaRect ? Number((betaRect.height / window.innerHeight).toFixed(3)) : null,
        hasQaTitle: document.body.innerText.includes('Amniora foundations'),
        hasStatuses: document.body.innerText.includes('Needs review') && document.body.innerText.includes('Private beta'),
        hasEvidence: document.body.innerText.includes('assets/logs/audit.log'),
      };
    })()`;

    const evaluated = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluated.error || evaluated.result?.exceptionDetails) throw new Error(JSON.stringify(evaluated));
    const result = evaluated.result.result.value;
    ws.close();

    assert(`${width}px viewport width is exact`, result.viewportWidth === width, JSON.stringify(result));
    assert(`${width}px page has no horizontal overflow`, !result.overflow, JSON.stringify(result));
    assert(`${width}px no critical element exceeds viewport`, result.wide.length === 0, JSON.stringify(result));
    assert(`${width}px critical states are visible`, result.empty.length === 0, JSON.stringify(result));
    assert(`${width}px technical values remain accessible`, result.inaccessibleTechnical === 0, JSON.stringify(result));
    assert(`${width}px focus reaches sample input`, result.focusedSampleInput, JSON.stringify(result));
    assert(`${width}px beta notice is not dominant`, result.betaViewportShare !== null && result.betaViewportShare < 0.25, JSON.stringify(result));
    assert(`${width}px QA content rendered`, result.hasQaTitle && result.hasStatuses && result.hasEvidence, JSON.stringify(result));
  } finally {
    child.kill();
    await wait(250);
    rmSync(profile, { recursive: true, force: true });
  }
}

(async () => {
  for (const width of widths) await runViewport(width);
  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});