#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const baseUrl = process.env.AMNIORA_R2A_BASE_URL;
if (!baseUrl) throw new Error("Set AMNIORA_R2A_BASE_URL to a local Amniora URL.");

const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => fs.existsSync(candidate));
if (!chrome) throw new Error("No Chromium browser found for Phase R2A visual probe.");

const widths = [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920];
const publicPaths = ["/", "/development-log", "/beta-access", "/contact"];
let assertions = 0;
let commandId = 1;

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function removeProfile(profile) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(profile, { recursive: true, force: true });
      return;
    } catch {
      await wait(250);
    }
  }
}
async function fetchJson(target) { const response = await fetch(target); if (!response.ok) throw new Error(`${target} returned ${response.status}`); return response.json(); }

async function withPage(width, callback) {
  const port = 9700 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), `amniora-r2a-visual-${width}-`));
  const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { await fetchJson(`http://127.0.0.1:${port}/json/version`); ready = true; break; } catch { await wait(150); }
    }
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
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1400, deviceScaleFactor: 1, mobile: width < 768 });
    await callback(send);
    ws.close();
  } finally {
    child.kill();
    await wait(400);
    await removeProfile(profile);
  }
}

async function evaluatePage(send, url, expression) {
  await send("Page.navigate", { url });
  await wait(1300);
  const evaluated = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (evaluated.error || evaluated.result?.exceptionDetails) throw new Error(JSON.stringify(evaluated));
  return evaluated.result.result.value;
}

const pageProbe = `(() => {
  const doc = document.documentElement;
  const critical = Array.from(document.querySelectorAll('main, header, footer, section, nav, a, button, code, [aria-label="Synthetic evidence preview"]'));
  const hiddenByAncestor = (node) => {
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      const currentStyle = getComputedStyle(current);
      if (currentStyle.display === 'none' || currentStyle.visibility === 'hidden') return true;
    }
    return false;
  };
  const wide = [];
  const empty = [];
  for (const element of critical) {
    if (hiddenByAncestor(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width > window.innerWidth + 1) wide.push(element.tagName + ':' + (element.textContent || '').slice(0, 24));
    if (rect.width <= 0 || rect.height <= 0) empty.push(element.tagName);
  }
  const technical = Array.from(document.querySelectorAll('.technical-value, code')).filter((element) => !hiddenByAncestor(element));
  const inaccessibleTechnical = technical.filter((element) => element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX === 'visible');
  const banner = document.querySelector('[aria-label="Private beta notice"]');
  const nav = document.querySelector('nav[aria-label="Public navigation"]');
  const footer = document.querySelector('footer');
  const betaRect = banner ? banner.getBoundingClientRect() : null;
  const text = document.body.innerText;
  return {
    viewportWidth: window.innerWidth,
    scrollWidth: doc.scrollWidth,
    overflow: doc.scrollWidth > window.innerWidth + 1,
    wide,
    empty,
    inaccessibleTechnical: inaccessibleTechnical.length,
    betaViewportShare: betaRect ? Number((betaRect.height / window.innerHeight).toFixed(3)) : null,
    hasNav: Boolean(nav),
    hasFooter: Boolean(footer),
    hasHomeMessage: text.includes('Build practical cybersecurity judgement.'),
    hasEvidencePreview: text.includes('Synthetic evidence packet') && text.includes('assets/scheduled/cron.d/platform-sync'),
    hasDevLogLink: text.includes('Development Log'),
    hasPrivateBeta: text.includes('Private Beta'),
    hasQaLeak: text.includes('Amniora foundations') || text.includes('/design-system'),
  };
})()`;

(async () => {
  for (const width of widths) {
    await withPage(width, async (send) => {
      const result = await evaluatePage(send, `${baseUrl}/`, pageProbe);
      assert(`${width}px viewport width exact`, result.viewportWidth === width, JSON.stringify(result));
      assert(`${width}px homepage no horizontal overflow`, !result.overflow, JSON.stringify(result));
      assert(`${width}px critical elements fit`, result.wide.length === 0, JSON.stringify(result));
      assert(`${width}px critical elements visible`, result.empty.length === 0, JSON.stringify(result));
      assert(`${width}px technical content accessible`, result.inaccessibleTechnical === 0, JSON.stringify(result));
      assert(`${width}px banner not dominant`, result.betaViewportShare !== null && result.betaViewportShare < 0.18, JSON.stringify(result));
      assert(`${width}px homepage core content rendered`, result.hasNav && result.hasFooter && result.hasHomeMessage && result.hasEvidencePreview, JSON.stringify(result));
      assert(`${width}px public links rendered`, result.hasDevLogLink && result.hasPrivateBeta, JSON.stringify(result));
      assert(`${width}px QA route not exposed`, !result.hasQaLeak, JSON.stringify(result));
    });
  }
  await withPage(390, async (send) => {
    const menuProbe = `async () => {
      localStorage.removeItem('cyberlab-cookie-consent');
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const button = document.querySelector('button[aria-controls="public-mobile-menu"]');
      const cookieBefore = document.querySelector('[aria-labelledby="cookie-consent-title"]');
      if (!button) return { hasButton: false };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      const links = dialog ? Array.from(dialog.querySelectorAll('a')).map((link) => link.getAttribute('href')) : [];
      const cookieWhileOpen = document.querySelector('[aria-labelledby="cookie-consent-title"]');
      const expandedWhileOpen = button.getAttribute('aria-expanded') === 'true';
      const close = dialog?.querySelector('button[aria-label="Close navigation menu"]');
      close?.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const cookieAfterClose = document.querySelector('[aria-labelledby="cookie-consent-title"]');
      return {
        hasButton: true,
        expanded: expandedWhileOpen,
        hasDialog: Boolean(dialog),
        links,
        bodyWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        cookieBefore: Boolean(cookieBefore),
        cookieWhileOpen: Boolean(cookieWhileOpen),
        cookieAfterClose: Boolean(cookieAfterClose),
      };
    }`;
    const result = await evaluatePage(send, `${baseUrl}/`, `(${menuProbe})()`);
    assert("mobile menu button exists", result.hasButton, JSON.stringify(result));
    assert("mobile menu opens", result.expanded && result.hasDialog, JSON.stringify(result));
    for (const href of ["/features", "/labs", "/roadmap", "/pricing", "/development-log", "/about", "/login", "/signup"]) assert(`mobile menu includes ${href}`, result.links.includes(href), JSON.stringify(result));
    assert("mobile menu does not create overflow", result.bodyWidth <= result.viewportWidth + 1, JSON.stringify(result));
    assert("unresolved cookie panel appears before menu", result.cookieBefore, JSON.stringify(result));
    assert("cookie panel yields while menu is open", !result.cookieWhileOpen, JSON.stringify(result));
    assert("cookie panel returns after menu closes", result.cookieAfterClose, JSON.stringify(result));
  });
  await withPage(390, async (send) => {
    const acceptedMenuProbe = `async () => {
      await new Promise((resolve) => setTimeout(resolve, 2200));
      localStorage.setItem('cyberlab-cookie-consent', JSON.stringify({ essential: true, analytics: false, performance: false, functional: false, marketing: false, savedAt: '2026-08-23T00:00:00.000Z' }));
      const button = document.querySelector('button[aria-controls="public-mobile-menu"]');
      if (!button) return { hasButton: false };
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      return {
        hasButton: true,
        hasDialog: Boolean(dialog),
        cookiePanel: Boolean(document.querySelector('[aria-labelledby="cookie-consent-title"]')),
        activeLabel: document.activeElement?.getAttribute('aria-label') || '',
      };
    }`;
    const result = await evaluatePage(send, `${baseUrl}/`, `(${acceptedMenuProbe})()`);
    assert("accepted-consent mobile menu opens", result.hasButton && result.hasDialog, JSON.stringify(result));
    assert("accepted-consent menu has no cookie collision", !result.cookiePanel, JSON.stringify(result));
    assert("mobile menu receives focus", result.activeLabel === "Close navigation menu", JSON.stringify(result));
  });
  for (const publicPath of publicPaths) {
    await withPage(390, async (send) => {
      const result = await evaluatePage(send, `${baseUrl}${publicPath}`, pageProbe);
      assert(`${publicPath} mobile public shell no overflow`, !result.overflow, JSON.stringify(result));
      if (publicPath === "/") assert(`${publicPath} mobile nav and footer visible`, result.hasNav && result.hasFooter, JSON.stringify(result));
      assert(`${publicPath} mobile beta banner visible`, result.hasPrivateBeta, JSON.stringify(result));
    });
  }
  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
