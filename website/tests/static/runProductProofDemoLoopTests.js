#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const baseUrl = process.env.AMNIORA_PRODUCT_LOOP_BASE_URL;
if (!baseUrl) throw new Error("Set AMNIORA_PRODUCT_LOOP_BASE_URL to a local or production Amniora URL.");

const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => fs.existsSync(candidate));
if (!chrome) throw new Error("No Chromium browser found for ProductProofDemo loop probe.");

let assertions = 0;
let commandId = 1;
let launchCounter = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function fetchJson(target) { const response = await fetch(target); if (!response.ok) throw new Error(`${target} returned ${response.status}`); return response.json(); }
function browserEventText(event) {
  if (!event) return "";
  if (event.method === "Runtime.consoleAPICalled") return (event.params?.args || []).map((arg) => String(arg.value || arg.description || "")).join(" ");
  if (event.method === "Runtime.exceptionThrown") return String(event.params?.exceptionDetails?.text || event.params?.exceptionDetails?.exception?.description || "");
  if (event.method === "Log.entryAdded") return String(event.params?.entry?.text || "");
  return "";
}

async function withPage({ width, height, mobile = false, reducedMotion = false }, callback) {
  const port = 10_700 + launchCounter++;
  const profile = mkdtempSync(join(tmpdir(), `amniora-product-loop-${width}-`));
  const child = spawn(chrome, [
    "--headless=new",
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
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { await fetchJson(`http://127.0.0.1:${port}/json/version`); ready = true; break; } catch { await wait(100); }
      if (child.exitCode !== null) break;
    }
    assert(`${width}px browser launched`, ready);
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const target = targets.find((item) => item.type === "page") || targets[0];
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    const pending = new Map();
    const events = [];
    const send = (method, params = {}) => new Promise((resolve) => { const id = commandId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.id) { const resolve = pending.get(data.id); if (resolve) { pending.delete(data.id); resolve(data); } return; }
      if (data.method === "Runtime.consoleAPICalled" || data.method === "Runtime.exceptionThrown" || data.method === "Log.entryAdded") events.push(data);
    });
    await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    if (reducedMotion) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await callback(send, events);
    const warnings = events.map(browserEventText).filter((text) => /GSAP target .*not found|target not found|exception|error/i.test(text));
    assert(`${width}px has no ProductProofDemo runtime warnings`, warnings.length === 0, JSON.stringify(warnings.slice(0, 8)));
    ws.close();
  } finally {
    child.kill();
    await wait(350);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

const stateProbe = `(() => {
  const tour = document.querySelector('[data-product-proof="compact-gsap-tour"]');
  tour?.scrollIntoView({ block: 'center' });
  const frame = document.querySelector('.product-tour__frame');
  const cursor = document.querySelector('.product-tour__cursor');
  const frameRect = frame?.getBoundingClientRect();
  const cursorRect = cursor?.getBoundingClientRect();
  const style = cursor ? getComputedStyle(cursor) : null;
  const cursorVisible = Boolean(cursor && style && style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '0') > 0.05);
  return {
    act: tour?.getAttribute('data-tour-act') || '',
    mode: tour?.getAttribute('data-tour-mode') || '',
    paused: tour?.getAttribute('data-tour-paused') || '',
    ready: tour?.getAttribute('data-tour-ready') || '',
    cursorVisible,
    cursorInside: !cursorVisible || Boolean(frameRect && cursorRect && cursorRect.left >= frameRect.left - 4 && cursorRect.top >= frameRect.top - 4 && cursorRect.right <= frameRect.right + 28 && cursorRect.bottom <= frameRect.bottom + 28),
    desktopMainCount: document.querySelectorAll('.product-tour__main').length,
    mobileShellCount: document.querySelectorAll('.product-tour__mobile-shell').length,
    visibleDesktopScenes: [...document.querySelectorAll('.product-tour__scene')].filter((node) => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && Number.parseFloat(s.opacity || '1') > 0.05; }).length,
    visibleMobileSteps: [...document.querySelectorAll('.product-tour__mobile-step')].filter((node) => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && Number.parseFloat(s.opacity || '1') > 0.05; }).length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`;

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
  return result.result.result.value;
}

async function openHome(send) {
  await send("Page.navigate", { url: `${baseUrl}/` });
  await wait(850);
  await send("Runtime.evaluate", { expression: "localStorage.setItem('cyberlab-cookie-consent', JSON.stringify({necessary:true,analytics:false,marketing:false,preferences:false,updatedAt:new Date().toISOString()}))" });
  await send("Page.navigate", { url: `${baseUrl}/` });
  await wait(1200);
  await send("Runtime.evaluate", { expression: "document.querySelector('[data-product-proof=\"compact-gsap-tour\"]')?.scrollIntoView({block:'center'})" });
  await wait(400);
}

function countDashboardReentries(samples) {
  let count = 0;
  let sawInvestigate = false;
  for (const sample of samples) {
    if (sample.act === "investigate") sawInvestigate = true;
    if (sawInvestigate && sample.act === "dashboard") {
      count += 1;
      sawInvestigate = false;
    }
  }
  return count;
}

async function sampleFor(send, totalMs, stepMs = 500) {
  const samples = [];
  const steps = Math.ceil(totalMs / stepMs);
  for (let i = 0; i < steps; i += 1) {
    samples.push(await evaluate(send, stateProbe));
    await wait(stepMs);
  }
  return samples;
}

async function runDesktopLoop() {
  await withPage({ width: 1440, height: 900 }, async (send) => {
    await openHome(send);
    const samples = await sampleFor(send, 38_000, 500);
    const acts = new Set(samples.map((sample) => sample.act));
    assert("desktop loop visits all acts", acts.has("dashboard") && acts.has("generate") && acts.has("investigate"), JSON.stringify([...acts]));
    assert("desktop loop enters a new cycle after completion", countDashboardReentries(samples) >= 2, JSON.stringify(samples.map((sample) => sample.act)));
    assert("desktop loop keeps one desktop composition", samples.every((sample) => sample.mode === "desktop" && sample.desktopMainCount === 1 && sample.mobileShellCount === 0 && sample.visibleDesktopScenes === 1), JSON.stringify(samples));
    assert("desktop loop keeps cursor bounded whenever visible", samples.every((sample) => sample.cursorInside), JSON.stringify(samples.filter((sample) => !sample.cursorInside)));
    assert("desktop loop restores cursor after first cycle", samples.some((sample, index) => index > 35 && sample.cursorVisible), JSON.stringify(samples.slice(35).map((sample) => ({ act: sample.act, cursorVisible: sample.cursorVisible }))));
    assert("desktop loop has no overflow", samples.every((sample) => !sample.overflow), JSON.stringify(samples));

    await send("Runtime.evaluate", { expression: `(() => { const button = [...document.querySelectorAll('.product-tour__controls button')].find((item) => /Pause/.test(item.textContent || '')); button?.click(); return true; })()` });
    await wait(500);
    const pausedBefore = await evaluate(send, stateProbe);
    await wait(2500);
    const pausedAfter = await evaluate(send, stateProbe);
    assert("pause freezes the loop", pausedBefore.act === pausedAfter.act && pausedAfter.paused === "true", JSON.stringify({ pausedBefore, pausedAfter }));

    await send("Runtime.evaluate", { expression: `(() => { const button = [...document.querySelectorAll('.product-tour__controls button')].find((item) => /Play/.test(item.textContent || '')); button?.click(); return true; })()` });
    await wait(1200);
    const resumed = await evaluate(send, stateProbe);
    assert("play resumes the loop", resumed.paused === "false", JSON.stringify(resumed));

    for (let i = 0; i < 4; i += 1) {
      await send("Runtime.evaluate", { expression: `(() => { const button = [...document.querySelectorAll('.product-tour__controls button')].find((item) => /Restart/.test(item.textContent || '')); button?.click(); return true; })()` });
      await wait(120);
    }
    await wait(900);
    const restarted = await evaluate(send, stateProbe);
    assert("rapid restart preserves one looping lifecycle", restarted.ready === "true" && restarted.mode === "desktop" && restarted.desktopMainCount === 1 && restarted.mobileShellCount === 0 && !restarted.overflow, JSON.stringify(restarted));
    const afterRestart = await sampleFor(send, 18_000, 600);
    assert("loop continues after restart", countDashboardReentries(afterRestart) >= 1, JSON.stringify(afterRestart.map((sample) => sample.act)));
  });
}

async function runMobileLoop() {
  await withPage({ width: 390, height: 844, mobile: true }, async (send) => {
    await openHome(send);
    const samples = await sampleFor(send, 34_000, 600);
    const acts = new Set(samples.map((sample) => sample.act));
    assert("mobile loop visits all acts", acts.has("dashboard") && acts.has("generate") && acts.has("investigate"), JSON.stringify([...acts]));
    assert("mobile loop enters another cycle", countDashboardReentries(samples) >= 1, JSON.stringify(samples.map((sample) => sample.act)));
    assert("mobile loop keeps cursor hidden", samples.every((sample) => !sample.cursorVisible), JSON.stringify(samples.filter((sample) => sample.cursorVisible)));
    assert("mobile loop keeps one mobile composition", samples.every((sample) => sample.mode === "mobile" && sample.mobileShellCount === 1 && sample.desktopMainCount === 0 && sample.visibleMobileSteps === 1), JSON.stringify(samples));
  });
}

async function runResizeLoopSafety() {
  await withPage({ width: 1440, height: 900 }, async (send) => {
    await openHome(send);
    await wait(18_000);
    for (const viewport of [
      { width: 390, height: 844, mobile: true },
      { width: 320, height: 700, mobile: true },
      { width: 768, height: 1024, mobile: false },
      { width: 1440, height: 900, mobile: false },
      { width: 390, height: 844, mobile: true },
      { width: 1440, height: 900, mobile: false },
    ]) {
      await send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
      await wait(260);
      const state = await evaluate(send, stateProbe);
      assert(`resize ${viewport.width}px has one matching composition`, viewport.width <= 600 ? state.mode === "mobile" && state.mobileShellCount === 1 && state.desktopMainCount === 0 : state.mode === "desktop" && state.desktopMainCount === 1 && state.mobileShellCount === 0, JSON.stringify(state));
      assert(`resize ${viewport.width}px has no overflow`, !state.overflow, JSON.stringify(state));
      if (viewport.width <= 600) assert(`resize ${viewport.width}px hides cursor`, !state.cursorVisible, JSON.stringify(state));
      else assert(`resize ${viewport.width}px cursor bounded or hidden during rebuild`, state.cursorInside, JSON.stringify(state));
    }
  });
}

async function runReducedMotion() {
  await withPage({ width: 390, height: 844, mobile: true, reducedMotion: true }, async (send) => {
    await openHome(send);
    const first = await evaluate(send, stateProbe);
    await wait(3500);
    const second = await evaluate(send, stateProbe);
    assert("reduced motion remains static and paused", first.act === "investigate" && second.act === "investigate" && second.paused === "true" && !second.cursorVisible, JSON.stringify({ first, second }));
  });
}

async function main() {
  await runDesktopLoop();
  await runMobileLoop();
  await runResizeLoopSafety();
  await runReducedMotion();
  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
