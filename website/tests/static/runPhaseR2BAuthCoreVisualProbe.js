#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const { spawn } = require("node:child_process");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const baseUrl = process.env.AMNIORA_R2B_BASE_URL;
if (!baseUrl) throw new Error("Set AMNIORA_R2B_BASE_URL.");
const screenshotRoot = process.env.AMNIORA_R2B_SCREENSHOT_DIR || resolve(".tmp", `amniora-r2-auth-core-${Date.now()}`);
mkdirSync(screenshotRoot, { recursive: true });
const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => fs.existsSync(candidate));
if (!chrome) throw new Error("No Chromium browser found.");
let assertions = 0;
let commandId = 1;
const screenshots = [];
function assert(name, condition, details = "") { assertions += 1; if (!condition) throw new Error(`${name}: ${details || "failed"}`); console.log(`PASS ${name}`); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function fetchJson(target) { const response = await fetch(target); if (!response.ok) throw new Error(`${target} returned ${response.status}`); return response.json(); }
function safeName(pathname) { return pathname === "/" ? "home" : pathname.replace(/^\//, "").replace(/[^a-z0-9-]+/gi, "-"); }
async function withPage(width, callback) {
  const port = 10400 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), `amniora-r2-auth-${width}-`));
  const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) { try { await fetchJson(`http://127.0.0.1:${port}/json/version`); ready = true; break; } catch { await wait(150); } }
    assert(`${width}px browser launched`, ready);
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const pageTarget = targets.find((target) => target.type === "page") || targets[0];
    assert(`${width}px has browser page target`, Boolean(pageTarget?.webSocketDebuggerUrl));
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    const pending = new Map();
    ws.addEventListener("message", (event) => { const data = JSON.parse(event.data); const resolver = pending.get(data.id); if (resolver) { pending.delete(data.id); resolver(data); } });
    const send = (method, params = {}) => new Promise((resolve) => { const id = commandId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1200, deviceScaleFactor: 1, mobile: width < 768 });
    await callback(send);
    ws.close();
  } finally {
    child.kill();
    await wait(300);
    rmSync(profile, { recursive: true, force: true });
  }
}
async function evaluate(send, url, expression) {
  await send("Page.navigate", { url });
  await wait(900);
  const evaluated = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (evaluated.error || evaluated.result?.exceptionDetails) throw new Error(JSON.stringify(evaluated));
  return evaluated.result.result.value;
}
async function screenshot(send, pathname, width, label) {
  const metrics = await send("Page.getLayoutMetrics");
  const size = metrics.result?.contentSize || { x: 0, y: 0, width, height: 1200 };
  const capture = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 } });
  const file = join(screenshotRoot, `${safeName(pathname)}-${width}-${label}.png`);
  writeFileSync(file, Buffer.from(capture.result.data, "base64"));
  screenshots.push(file);
}
const authProbe = `(() => {
  const text = document.body.innerText;
  const visibleLogo = [...document.querySelectorAll('[data-brand-logo="dark"]')].find((logo) => {
    const rect = logo.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  const logoSymbol = visibleLogo?.querySelector('[data-brand-logo-symbol="true"]');
  const logoWordmark = visibleLogo?.querySelector('[data-brand-logo-wordmark="true"]');
  const logoSymbolRect = logoSymbol?.getBoundingClientRect();
  const logoWordmarkRect = logoWordmark?.getBoundingClientRect();
  const buttons = [...document.querySelectorAll('button, .ui-action, a.inline-flex')].filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (el.textContent || '').trim();
  }).map((el) => ({ text: (el.textContent || '').replace(/\s+/g, ' ').trim(), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, busy: el.getAttribute('aria-busy'), disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' }));
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    hasAuthShell: Boolean(document.querySelector('.auth-page-shell')),
    hasAuthPanel: Boolean(document.querySelector('.auth-form-panel')),
    hasProof: Boolean(document.querySelector('.auth-proof-shell')),
    labels: document.querySelectorAll('label[for]').length,
    passwordToggles: document.querySelectorAll('button[aria-pressed]').length,
    hasLeak: /OPENAI_API_KEY|SENTRY_AUTH_TOKEN|SUPABASE_SERVICE_ROLE|assessment contract|answer key|LINUX_[A-Z0-9_]+/.test(text),
    logo: {
      hasDarkLogo: Boolean(visibleLogo),
      symbolWidth: Math.round(logoSymbolRect?.width || 0),
      symbolHeight: Math.round(logoSymbolRect?.height || 0),
      wordmarkWidth: Math.round(logoWordmarkRect?.width || 0),
      wordmarkHeight: Math.round(logoWordmarkRect?.height || 0),
      symbolWordmarkGap: logoSymbolRect && logoWordmarkRect ? Math.round(logoWordmarkRect.left - logoSymbolRect.right) : 0,
      src: logoSymbol?.querySelector('img')?.getAttribute('src') || '',
    },
    buttons,
  };
})()`;
(async () => {
  for (const width of [320, 390, 430, 768, 1440]) {
    for (const pathname of ["/login", "/signup", "/forgot-password", "/reset-password"]) {
      await withPage(width, async (send) => {
        const result = await evaluate(send, `${baseUrl}${pathname}`, authProbe);
        assert(`${pathname} ${width}px auth shell`, result.hasAuthShell && result.hasAuthPanel, JSON.stringify(result));
        assert(`${pathname} ${width}px no overflow`, !result.overflow, JSON.stringify(result));
        assert(`${pathname} ${width}px labels present`, pathname === "/reset-password" ? result.buttons.length >= 1 : result.labels >= 1, JSON.stringify(result));
        assert(`${pathname} ${width}px no internal leak`, !result.hasLeak, JSON.stringify(result));
        assert(`${pathname} ${width}px dark-surface logo uses white mark`, result.logo.hasDarkLogo && result.logo.src.includes("amniora-icon-white-cropped"), JSON.stringify(result.logo));
        const minLogo = width < 1024 ? 26 : 32;
        const maxLogo = width < 1024 ? 34 : 44;
        assert(`${pathname} ${width}px logo symbol is readable`, result.logo.symbolWidth >= minLogo && result.logo.symbolWidth <= maxLogo && result.logo.symbolHeight >= minLogo && result.logo.symbolHeight <= maxLogo, JSON.stringify(result.logo));
        assert(`${pathname} ${width}px logo wordmark aligns with symbol`, result.logo.wordmarkWidth > result.logo.symbolWidth * 2.1 && result.logo.wordmarkHeight >= result.logo.symbolHeight * 0.42 && result.logo.wordmarkHeight <= result.logo.symbolHeight * 1.08 && result.logo.symbolWordmarkGap >= 6 && result.logo.symbolWordmarkGap <= 16, JSON.stringify(result.logo));
        for (const button of result.buttons) assert(`${pathname} ${width}px visible action ${button.text}`, button.width >= 36 && button.height >= 36, JSON.stringify(button));
        await screenshot(send, pathname, width, "auth");
      });
    }
  }
  await withPage(390, async (send) => {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const result = await evaluate(send, `${baseUrl}/login`, authProbe);
    assert("login reduced motion still renders immediately", result.hasAuthShell && !result.overflow, JSON.stringify(result));
    await screenshot(send, "/login", 390, "reduced-motion");
  });
  await withPage(390, async (send) => {
    const result = await evaluate(send, `${baseUrl}/dashboard`, authProbe);
    assert("signed-out dashboard redirects safely", result.pathname === "/login", JSON.stringify(result));
    assert("signed-out dashboard redirect no overflow", !result.overflow, JSON.stringify(result));
    await screenshot(send, "/dashboard", 390, "signed-out-redirect");
  });
  console.log(JSON.stringify({ passed: true, assertions, screenshotRoot, screenshots }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
