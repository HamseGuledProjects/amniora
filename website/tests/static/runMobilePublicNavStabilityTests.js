#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const baseUrl = process.env.AMNIORA_MOBILE_NAV_BASE_URL;
if (!baseUrl) throw new Error("Set AMNIORA_MOBILE_NAV_BASE_URL to a local or production Amniora URL.");

const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => fs.existsSync(candidate));
if (!chrome) throw new Error("No Chromium browser found for mobile nav stability probe.");

const pages = ["/", "/features", "/labs", "/development-log", "/about"];
const mobileProfiles = [
  { label: "ios", widths: [320, 375, 390, 430], userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
  { label: "android", widths: [360, 412, 430], userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36" },
];
const statusModes = ["healthy", "degraded"];
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
async function cleanupProfile(profile) { try { rmSync(profile, { recursive: true, force: true }); } catch {} }

function browserEventText(event) {
  if (!event) return "";
  if (event.method === "Runtime.consoleAPICalled") {
    return (event.params?.args || []).map((arg) => String(arg.value || arg.description || "")).join(" ");
  }
  if (event.method === "Runtime.exceptionThrown") return String(event.params?.exceptionDetails?.text || event.params?.exceptionDetails?.exception?.description || "");
  if (event.method === "Log.entryAdded") return String(event.params?.entry?.text || "");
  return "";
}

async function withMobilePage(profile, width, statusMode, callback) {
  const port = 10_200 + launchCounter;
  launchCounter += 1;
  const profileDir = mkdtempSync(join(tmpdir(), `amniora-mobile-nav-${profile.label}-${width}-${statusMode}-`));
  const child = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { await fetchJson(`http://127.0.0.1:${port}/json/version`); ready = true; break; } catch { await wait(100); }
      if (child.exitCode !== null) break;
    }
    assert(`${profile.label} ${width}px ${statusMode} browser launched`, ready);
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const target = targets.find((item) => item.type === "page") || targets[0];
    assert(`${profile.label} ${width}px ${statusMode} page target exists`, Boolean(target?.webSocketDebuggerUrl));

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const pending = new Map();
    const events = [];
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = commandId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.id) {
        const resolve = pending.get(data.id);
        if (resolve) { pending.delete(data.id); resolve(data); }
        return;
      }
      if (data.method === "Runtime.consoleAPICalled" || data.method === "Runtime.exceptionThrown" || data.method === "Log.entryAdded") events.push(data);
      if (data.method !== "Network.requestIntercepted") return;
      const payload = statusMode === "degraded"
        ? { status: "degraded", message: "Some account features are temporarily unavailable.", detail: "Login and account access may be affected.", cacheTtlSeconds: 180 }
        : { status: "healthy", message: null, detail: null, cacheTtlSeconds: 180 };
      const response = Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}`).toString("base64");
      send("Network.continueInterceptedRequest", { interceptionId: data.params.interceptionId, rawResponse: response });
    });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Network.enable");
    await send("Network.setUserAgentOverride", { userAgent: profile.userAgent, platform: profile.label === "ios" ? "iPhone" : "Linux armv8l" });
    await send("Network.setRequestInterception", { patterns: [{ urlPattern: "*://*/api/service-status*", resourceType: "Fetch", interceptionStage: "HeadersReceived" }] });
    await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await callback(send, events);
    const warningTexts = events.map(browserEventText).filter(Boolean).filter((text) => /error|exception|GSAP target .*not found|target not found/i.test(text));
    assert(`${profile.label} ${width}px ${statusMode} has no console/runtime warnings`, warningTexts.length === 0, JSON.stringify(warningTexts.slice(0, 8)));
    ws.close();
  } finally {
    child.kill();
    await wait(350);
    await cleanupProfile(profileDir);
  }
}

const layoutProbe = `(() => {
  function rect(selector) {
    const element = document.querySelector(selector);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { top: Math.round(r.top * 100) / 100, bottom: Math.round(r.bottom * 100) / 100, left: Math.round(r.left * 100) / 100, right: Math.round(r.right * 100) / 100, width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100 };
  }
  const bodyText = document.body.innerText || "";
  const header = rect('header.sticky');
  const logo = rect('nav[aria-label="Public navigation"] [aria-label="Amniora home"]');
  const menuButton = rect('button[aria-controls="public-mobile-menu"]');
  const global = rect('[data-global-status-region]');
  const service = rect('[data-service-status-banner]');
  const nav = rect('nav[aria-label="Public navigation"]');
  const menu = rect('#public-mobile-menu');
  const menuPanel = rect('#public-mobile-menu [role="dialog"]');
  return {
    scrollY: window.scrollY,
    width: window.innerWidth,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    header,
    global,
    service,
    nav,
    logo,
    menuButton,
    menu,
    menuPanel,
    bannerVar: getComputedStyle(document.documentElement).getPropertyValue('--development-banner-height').trim(),
    headerVar: getComputedStyle(document.documentElement).getPropertyValue('--public-mobile-header-height').trim(),
    navHeightVar: getComputedStyle(document.documentElement).getPropertyValue('--public-navbar-height').trim(),
    visualViewportHeight: Math.round((window.visualViewport?.height || window.innerHeight) * 100) / 100,
    open: document.documentElement.dataset.publicNavigationOpen === 'true',
    hasServiceBanner: Boolean(document.querySelector('[data-service-status-banner]')),
    hasPrivateBeta: /Private Beta/.test(bodyText),
    hasDuplicateHeaderLogo: document.querySelectorAll('nav[aria-label="Public navigation"] [aria-label="Amniora home"]').length !== 1,
  };
})()`;

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
  return result.result.result.value;
}

function assertStableStack(label, samples, statusMode) {
  const headerTops = samples.map((sample) => sample.header?.top).filter((value) => typeof value === "number");
  const headerHeights = samples.map((sample) => sample.header?.height).filter((value) => typeof value === "number");
  const logoTops = samples.map((sample) => sample.logo?.top).filter((value) => typeof value === "number");
  const logoLefts = samples.map((sample) => sample.logo?.left).filter((value) => typeof value === "number");
  const menuButtonTops = samples.map((sample) => sample.menuButton?.top).filter((value) => typeof value === "number");
  const menuButtonLefts = samples.map((sample) => sample.menuButton?.left).filter((value) => typeof value === "number");
  const maxTopDelta = Math.max(...headerTops) - Math.min(...headerTops);
  const maxHeightDelta = Math.max(...headerHeights) - Math.min(...headerHeights);
  const maxLogoTopDelta = Math.max(...logoTops) - Math.min(...logoTops);
  const maxLogoLeftDelta = Math.max(...logoLefts) - Math.min(...logoLefts);
  const maxButtonTopDelta = Math.max(...menuButtonTops) - Math.min(...menuButtonTops);
  const maxButtonLeftDelta = Math.max(...menuButtonLefts) - Math.min(...menuButtonLefts);
  assert(`${label} sticky navbar is locked to viewport top`, headerTops.every((top) => Math.abs(top) <= 1), JSON.stringify({ headerTops }));
  assert(`${label} header vertical position is deterministic`, maxTopDelta <= 1, JSON.stringify({ maxTopDelta, headerTops }));
  assert(`${label} header height is stable`, maxHeightDelta <= 1, JSON.stringify({ maxHeightDelta, headerHeights }));
  assert(`${label} logo remains visually stationary while scrolling`, maxLogoTopDelta <= 1 && maxLogoLeftDelta <= 1, JSON.stringify({ maxLogoTopDelta, maxLogoLeftDelta, logoTops, logoLefts }));
  assert(`${label} hamburger remains visually stationary while scrolling`, maxButtonTopDelta <= 1 && maxButtonLeftDelta <= 1, JSON.stringify({ maxButtonTopDelta, maxButtonLeftDelta, menuButtonTops, menuButtonLefts }));
  assert(`${label} navbar ignores banner measurement variables`, samples.every((sample) => sample.bannerVar === "0px" && sample.headerVar === "4rem" && sample.navHeightVar === "4rem"), JSON.stringify(samples));
  assert(`${label} has no horizontal overflow`, samples.every((sample) => !sample.overflow), JSON.stringify(samples));
  assert(`${label} keeps private beta banner in page content`, samples.every((sample) => sample.hasPrivateBeta), JSON.stringify(samples));
  assert(`${label} service banner state is correct`, samples.every((sample) => sample.hasServiceBanner === (statusMode === "degraded")), JSON.stringify(samples));
  assert(`${label} has one public header logo`, samples.every((sample) => !sample.hasDuplicateHeaderLogo), JSON.stringify(samples));
}

async function runPage(send, path, width, statusMode) {
  await send("Page.navigate", { url: `${baseUrl}${path}` });
  await wait(800);
  await send("Runtime.evaluate", { expression: "localStorage.setItem('cyberlab-cookie-consent', JSON.stringify({necessary:true,analytics:false,marketing:false,preferences:false,updatedAt:new Date().toISOString()}))" });
  await send("Page.navigate", { url: `${baseUrl}${path}` });
  await wait(900);
  const samples = [];
  for (const height of [844, 804, 760, 844]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await wait(60);
    for (const delta of [520, 520, -380, 700, -640, 420]) {
      await send("Runtime.evaluate", { expression: `window.scrollBy(0, ${delta})` });
      await wait(20);
      samples.push(await evaluate(send, layoutProbe));
    }
  }
  assertStableStack(`${path} ${width}px ${statusMode}`, samples, statusMode);

  const beforeMenu = await evaluate(send, layoutProbe);
  await send("Runtime.evaluate", { expression: `document.querySelector('button[aria-controls="public-mobile-menu"]')?.click()` });
  await wait(280);
  const open = await evaluate(send, layoutProbe);
  assert(`${path} ${width}px ${statusMode} menu opens`, open.open && open.menu && open.menuPanel, JSON.stringify(open));
  assert(`${path} ${width}px ${statusMode} menu starts below full header stack`, Math.abs(open.menu.top - open.header.bottom) <= 1, JSON.stringify(open));
  assert(`${path} ${width}px ${statusMode} menu uses navbar-only CSS offset`, open.headerVar === "4rem" && open.navHeightVar === "4rem", JSON.stringify(open));
  assert(`${path} ${width}px ${statusMode} menu does not shift header`, Math.abs((open.header?.top || 0) - (beforeMenu.header?.top || 0)) <= 1, JSON.stringify({ beforeMenu, open }));
  await send("Runtime.evaluate", { expression: `document.querySelector('#public-mobile-menu button[aria-label="Close navigation menu"]')?.click()` });
  await wait(280);
  const closed = await evaluate(send, layoutProbe);
  assert(`${path} ${width}px ${statusMode} menu closes`, !closed.open && !closed.menu, JSON.stringify(closed));
  assert(`${path} ${width}px ${statusMode} close does not shift header`, Math.abs((closed.header?.top || 0) - (beforeMenu.header?.top || 0)) <= 1, JSON.stringify({ beforeMenu, closed }));
}

async function main() {
  for (const profile of mobileProfiles) {
    for (const statusMode of statusModes) {
      for (const width of profile.widths) {
        await withMobilePage(profile, width, statusMode, async (send) => {
          for (const page of pages) {
            await runPage(send, page, width, statusMode);
          }
        });
      }
    }
  }
  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
