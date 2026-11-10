#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const { spawn } = require("node:child_process");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const baseUrl = process.env.AMNIORA_R2B_BASE_URL;
if (!baseUrl) throw new Error("Set AMNIORA_R2B_BASE_URL to a local or production Amniora URL.");

const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => fs.existsSync(candidate));
if (!chrome) throw new Error("No Chromium browser found for Phase R2B visual probe.");

const screenshotRoot = process.env.AMNIORA_R2B_SCREENSHOT_DIR || resolve(".tmp", "amniora-homepage-final-responsive-polish");
mkdirSync(screenshotRoot, { recursive: true });

const publicPaths = ["/", "/features", "/labs", "/about", "/pricing", "/roadmap", "/development-log", "/contact", "/privacy", "/terms", "/cookies"];
const fivePagePaths = ["/features", "/labs", "/roadmap", "/pricing", "/about"];
const widths = [320, 390, 768, 1024, 1440, 1920];
const fivePageWidths = [320, 360, 390, 430, 768, 820, 912, 1024, 1280, 1440, 1920];
const screenshotWidths = [320, 390, 1024, 1440];
const requiredViewports = [
  { label: "800x600", width: 800, height: 600 },
  { label: "900x700", width: 900, height: 700 },
  { label: "1024x600", width: 1024, height: 600 },
  { label: "1024x768", width: 1024, height: 768 },
  { label: "1280x720", width: 1280, height: 720 },
  { label: "1280x800", width: 1280, height: 800 },
  { label: "1366x768", width: 1366, height: 768 },
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1920x1080", width: 1920, height: 1080 },
  { label: "2560x1440", width: 2560, height: 1440 },
  { label: "ipad-mini-portrait", width: 768, height: 1024 },
  { label: "ipad-mini-landscape", width: 1024, height: 768 },
  { label: "ipad-air-portrait", width: 820, height: 1180 },
  { label: "ipad-air-landscape", width: 1180, height: 820 },
  { label: "ipad-pro-11-portrait", width: 834, height: 1194 },
  { label: "ipad-pro-11-landscape", width: 1194, height: 834 },
  { label: "ipad-pro-13-portrait", width: 1024, height: 1366 },
  { label: "ipad-pro-13-landscape", width: 1366, height: 1024 },
  { label: "surface-go-portrait", width: 800, height: 1280 },
  { label: "surface-go-landscape", width: 1280, height: 800 },
  { label: "surface-pro-portrait", width: 912, height: 1368 },
  { label: "surface-pro-landscape", width: 1368, height: 912 },
  { label: "phone-320x568", width: 320, height: 568 },
  { label: "phone-360x800", width: 360, height: 800 },
  { label: "phone-390x844", width: 390, height: 844 },
  { label: "phone-430x932", width: 430, height: 932 },
];
let assertions = 0;
let commandId = 1;
const screenshots = [];

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function removeProfile(profile) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { rmSync(profile, { recursive: true, force: true }); return; } catch { await wait(250); }
  }
}
async function fetchJson(target) { const response = await fetch(target); if (!response.ok) throw new Error(`${target} returned ${response.status}`); return response.json(); }
function safeName(pathname) { return pathname === "/" ? "home" : pathname.replace(/^\//, "").replace(/[^a-z0-9-]+/gi, "-"); }
function luminance([r, g, b]) {
  const values = [r, g, b].map((value) => {
    const next = value / 255;
    return next <= 0.03928 ? next / 12.92 : Math.pow((next + 0.055) / 1.055, 2.4);
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrastRatio(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

let launchCounter = 0;
function browserEventText(event) {
  if (!event) return "";
  if (event.method === "Runtime.consoleAPICalled") {
    return (event.params?.args || []).map((arg) => String(arg.value || arg.description || "")).join(" ");
  }
  if (event.method === "Runtime.exceptionThrown") return String(event.params?.exceptionDetails?.text || event.params?.exceptionDetails?.exception?.description || "");
  if (event.method === "Log.entryAdded") return String(event.params?.entry?.text || "");
  return "";
}
function assertNoGsapTargetWarnings(label, events) {
  const warnings = events.map(browserEventText).filter((text) => /GSAP target .*not found|target not found/i.test(text));
  assert(`${label} emits no GSAP target warnings`, warnings.length === 0, JSON.stringify(warnings.slice(0, 5)));
}

async function withPage(viewportInput, callback) {
  const viewport = typeof viewportInput === "number" ? { label: `${viewportInput}`, width: viewportInput, height: 1200 } : viewportInput;
  const { label, width, height } = viewport;
  let child;
  let profile;
  let port;
  try {
    let ready = false;
    for (let launchAttempt = 0; launchAttempt < 2 && !ready; launchAttempt += 1) {
      port = 9800 + launchCounter;
      launchCounter += 1;
      profile = mkdtempSync(join(tmpdir(), `amniora-r2b-gsap-${label}-`));
      child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try { await fetchJson(`http://127.0.0.1:${port}/json/version`); ready = true; break; } catch { await wait(150); }
        if (child.exitCode !== null) break;
      }
      if (!ready) {
        child.kill();
        await wait(700);
        await removeProfile(profile);
        child = undefined;
        profile = undefined;
      }
    }
    assert(`${width}px browser launched`, ready);
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const pageTarget = targets.find((target) => target.type === "page") || targets[0];
    assert(`${width}px has browser page target`, Boolean(pageTarget?.webSocketDebuggerUrl));
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    const pending = new Map();
    const browserEvents = [];
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.id) {
        const resolver = pending.get(data.id);
        if (resolver) { pending.delete(data.id); resolver(data); }
        return;
      }
      if (data.method === "Runtime.consoleAPICalled" || data.method === "Runtime.exceptionThrown" || data.method === "Log.entryAdded") browserEvents.push(data);
    });
    const send = (method, params = {}) => new Promise((resolve) => { const id = commandId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 600 });
    await callback(send, viewport, browserEvents);
    assertNoGsapTargetWarnings(`${label} browser session`, browserEvents);
    ws.close();
  } finally {
    if (child) child.kill();
    await wait(700);
    if (profile) await removeProfile(profile);
  }
}

async function evaluatePage(send, url, expression) {
  await send("Page.navigate", { url });
  await wait(1000);
  const evaluated = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (evaluated.error || evaluated.result?.exceptionDetails) throw new Error(JSON.stringify(evaluated));
  return evaluated.result.result.value;
}
async function resolveConsent(send) {
  await send("Runtime.evaluate", {
    expression: `(() => {
      localStorage.setItem('cyberlab-cookie-consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, preferences: false, updatedAt: new Date().toISOString() }));
      return true;
    })()`,
    returnByValue: true,
  });
}
async function evaluatePageWithConsent(send, url, expression) {
  await send("Page.navigate", { url });
  await wait(700);
  await resolveConsent(send);
  await send("Page.navigate", { url });
  await wait(900);
  const evaluated = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (evaluated.error || evaluated.result?.exceptionDetails) throw new Error(JSON.stringify(evaluated));
  return evaluated.result.result.value;
}
async function screenshot(send, pathname, width, label = "full") {
  const metrics = await send("Page.getLayoutMetrics");
  const size = metrics.result?.contentSize || { x: 0, y: 0, width, height: 1200 };
  const capture = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 },
  });
  const file = join(screenshotRoot, `${safeName(pathname)}-${width}-${label}.png`);
  writeFileSync(file, Buffer.from(capture.result.data, "base64"));
  screenshots.push(file);
}

const pageProbe = `(() => {
  const doc = document.documentElement;
  const bodyText = document.body.innerText;
  const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  const focusableSmall = [...document.querySelectorAll('nav button, nav a[href="/beta-access"], nav a[href="/login"], nav a[href="/signup"], button, input, textarea, select, a.inline-flex')].filter((el) => {
    const rect = el.getBoundingClientRect();
    if (el.classList.contains('sr-only') || el.closest('.sr-only')) return false;
    return rect.width > 0 && rect.height > 0 && (rect.height < 36 || rect.width < 36);
  }).length;
  const actionContrasts = [...document.querySelectorAll('.ui-action, a[href="/signup"], a[href="/login"], a[href="/beta-access"], button')].map((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { visible: rect.width > 0 && rect.height > 0, color: style.color, backgroundColor: style.backgroundColor, text: el.textContent?.trim().slice(0, 40) || '' };
  }).filter((item) => item.visible && item.text);
  const tour = document.querySelector('[data-product-proof="compact-gsap-tour"]');
  const tourRect = tour?.getBoundingClientRect();
  const hero = document.querySelector('.homepage-hero');
  const next = document.querySelector('#investigation-loop');
  const heroRect = hero?.getBoundingClientRect();
  const heroContentRects = hero ? [...hero.querySelectorAll('.homepage-hero__grid, .homepage-hero__proof-row')].map((el) => el.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0) : [];
  const heroContentBottom = heroContentRects.length ? Math.max(...heroContentRects.map((rect) => rect.bottom)) : 0;
  const nextRect = next?.getBoundingClientRect();
  const ordinaryTextBoxes = [...document.querySelectorAll('p, h1, h2, h3, h4, a, button, span')].filter((el) => {
    if (el.closest('code, .technical-value, svg, .sr-only')) return false;
    const text = (el.textContent || '').trim();
    if (text.length < 7) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.width < Math.max(30, Number.parseFloat(style.fontSize) * 2.35);
  });
  return {
    viewport: window.innerWidth,
    overflow: doc.scrollWidth > window.innerWidth + 1,
    hasMain: Boolean(document.querySelector('main')),
    hasH1: document.querySelectorAll('h1').length === 1,
    hasFooter: Boolean(document.querySelector('footer')),
    hasNav: Boolean(document.querySelector('nav[aria-label="Public navigation"]')),
    hasQaLeak: bodyText.includes('design-system QA') || bodyText.includes('AMNIORA_ENABLE_DESIGN_SYSTEM_QA'),
    hasSecretLeak: /OPENAI_API_KEY|SENTRY_AUTH_TOKEN|SUPABASE_SERVICE_ROLE|assessment contract|answer key|LINUX_[A-Z0-9_]+/.test(bodyText),
    hasDesignSystemLink: links.includes('/design-system'),
    hasConsentPanel: Boolean(document.querySelector('[data-cookie-consent-panel="true"]')) || bodyText.includes('Manage Preferences'),
    smallControls: focusableSmall,
    actionContrasts,
    tourControls: document.querySelectorAll('.product-tour__progress [role="tab"]').length,
    tourHeight: tourRect?.height || 0,
    hasScrollCue: Boolean(document.querySelector('[data-scroll-cue], .homepage-scroll-cue, .homepage-hero__scroll-cue')) || /Scroll to explore|\bSCROLL\b/.test(bodyText),
    heroDirectlyFollowed: Boolean(heroRect && nextRect && Math.abs(nextRect.top - heroRect.bottom) <= 2),
    heroBottomVoid: heroRect && heroContentBottom ? Math.max(0, Math.round(heroRect.bottom - heroContentBottom)) : 0,
    heroHasNaturalHeight: Boolean(heroRect && (heroRect.height < window.innerHeight * 0.94 || (heroContentBottom && Math.max(0, heroRect.bottom - heroContentBottom) < 96))),
    squashedOrdinaryText: ordinaryTextBoxes.length,
    squashedOrdinaryTextDetails: ordinaryTextBoxes.map((el) => ({ tag: el.tagName, className: String(el.className || ""), text: (el.textContent || "").trim().slice(0, 80), width: Math.round(el.getBoundingClientRect().width) })),
  };
})()`;

const tourProbe = `(() => {
  const tour = document.querySelector('[data-product-proof="compact-gsap-tour"]');
  tour?.scrollIntoView({ block: 'center' });
  const rect = tour?.getBoundingClientRect();
  const frame = document.querySelector('.product-tour__frame');
  const stage = document.querySelector('.product-tour__stage');
  const activeSceneName = tour?.getAttribute('data-tour-act');
  const scenes = [...document.querySelectorAll('.product-tour__scene')].filter((scene) => scene.getAttribute('data-tour-scene') === activeSceneName).map((scene) => ({
    name: scene.getAttribute('data-tour-scene'),
    scrollHeight: scene.scrollHeight,
    clientHeight: scene.clientHeight,
  }));
  const cursor = document.querySelector('.product-tour__cursor');
  const visibleDarkLogo = [...document.querySelectorAll('[data-brand-logo=\"dark\"]')].find((logo) => { const rect = logo.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && logo.closest('[data-product-proof=\"compact-gsap-tour\"]'); });
  const logoSymbol = visibleDarkLogo?.querySelector('[data-brand-logo-symbol=\"true\"]');
  const logoImg = logoSymbol?.querySelector('img');
  const logoSymbolRect = logoSymbol?.getBoundingClientRect();
  const logoContainer = logoSymbol?.closest('.product-tour__brand');
  const logoContainerStyle = logoContainer ? getComputedStyle(logoContainer) : null;
  const cursorRect = cursor?.getBoundingClientRect();
  const frameRect = frame?.getBoundingClientRect();
  const text = tour?.innerText || '';
  return {
    act: tour?.getAttribute('data-tour-act'),
    paused: tour?.getAttribute('data-tour-paused'),
    ready: tour?.getAttribute('data-tour-ready'),
    height: rect?.height || 0,
    frameHeight: frame?.clientHeight || 0,
    frameScrollHeight: frame?.scrollHeight || 0,
    stageHeight: stage?.clientHeight || 0,
    controls: document.querySelectorAll('.product-tour__progress [role="tab"]').length,
    evidenceRows: document.querySelectorAll('.product-tour__evidence-row').length,
    hasCompleteAnswer: /Task answer|graded|Evidence ZIP|Export|PDF/.test(text),
    hasSettings: /Settings/.test(text),
    hasInternalScroll: frame ? getComputedStyle(frame).overflowY === 'scroll' || getComputedStyle(frame).overflowY === 'auto' : true,
    scenesFit: scenes.every((scene) => scene.scrollHeight <= scene.clientHeight + 6),
    cursorVisible: cursor ? getComputedStyle(cursor).display !== 'none' && getComputedStyle(cursor).opacity !== '0' : false,
    hasMobileShell: Boolean(document.querySelector('.product-tour__mobile-shell')),
    mobileShellVisible: Boolean(document.querySelector('.product-tour__mobile-shell')) && getComputedStyle(document.querySelector('.product-tour__mobile-shell')).display !== 'none',
    cursorInside: Boolean(cursorRect && frameRect && cursorRect.left >= frameRect.left - 4 && cursorRect.top >= frameRect.top - 4 && cursorRect.right <= frameRect.right + 28 && cursorRect.bottom <= frameRect.bottom + 28),
    logo: {
      src: logoImg?.getAttribute('src') || '',
      symbolWidth: Math.round(logoSymbolRect?.width || 0),
      symbolHeight: Math.round(logoSymbolRect?.height || 0),
      backgroundColor: logoContainerStyle?.backgroundColor || '',
      borderWidth: logoContainerStyle?.borderTopWidth || '',
    },
    mode: tour?.getAttribute('data-tour-mode') || '',
    transitioning: tour?.getAttribute('data-tour-transitioning') || '',
    epoch: Number(tour?.getAttribute('data-tour-animation-epoch') || 0),
    desktopMainCount: document.querySelectorAll('.product-tour__main').length,
    sidebarCount: document.querySelectorAll('.product-tour__sidebar').length,
    mobileShellCount: document.querySelectorAll('.product-tour__mobile-shell').length,
    visibleDesktopScenes: [...document.querySelectorAll('.product-tour__scene')].filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.05;
    }).length,
    visibleMobileSteps: [...document.querySelectorAll('.product-tour__mobile-step')].filter((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.05;
    }).length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`;

async function sampleCursorBounds(send) {
  const result = await send("Runtime.evaluate", {
    expression: `new Promise((resolve) => {
      const tour = document.querySelector('[data-product-proof="compact-gsap-tour"]');
      tour?.scrollIntoView({ block: 'center' });
      const samples = [];
      let frames = 0;
      const step = () => {
        const frame = document.querySelector('.product-tour__frame');
        const cursor = document.querySelector('.product-tour__cursor');
        const click = document.querySelector('.product-tour__click');
        const frameRect = frame?.getBoundingClientRect();
        const cursorRect = cursor?.getBoundingClientRect();
        const clickRect = click?.getBoundingClientRect();
        const cursorVisible = cursor && getComputedStyle(cursor).display !== 'none' && getComputedStyle(cursor).opacity !== '0';
        if (cursorVisible && frameRect && cursorRect) {
          const cursorInside = cursorRect.left >= frameRect.left - 2 && cursorRect.top >= frameRect.top - 2 && cursorRect.right <= frameRect.right + 2 && cursorRect.bottom <= frameRect.bottom + 2;
          const clickInside = !clickRect || getComputedStyle(click).opacity === '0' || (clickRect.left >= frameRect.left - 2 && clickRect.top >= frameRect.top - 2 && clickRect.right <= frameRect.right + 2 && clickRect.bottom <= frameRect.bottom + 2);
          samples.push(cursorInside && clickInside);
        }
        frames += 1;
        if (frames < 120) requestAnimationFrame(step);
        else resolve({ ok: samples.length === 0 || samples.every(Boolean), samples: samples.length, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 });
      };
      requestAnimationFrame(step);
    })`,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result.result.value;
}

async function resizeViewport(send, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 600 });
  await wait(85);
}

async function runResponsiveLifecycleProbe(send) {
  await evaluatePageWithConsent(send, `${baseUrl}/`, tourProbe);
  await send("Runtime.evaluate", {
    expression: `(() => {
      document.querySelector('[data-product-proof="compact-gsap-tour"]')?.scrollIntoView({ block: 'center' });
      const generateTab = [...document.querySelectorAll('.product-tour__progress [role="tab"]')].find((node) => /Generate/.test(node.textContent || ''));
      generateTab?.click();
      return true;
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  await wait(650);

  const widths = [1024, 768, 390, 320, 390, 768, 1440, 390, 320, 1024, 1440];
  const states = [];
  for (const width of widths) {
    await resizeViewport(send, width, width <= 600 ? 844 : width === 768 ? 1024 : 900);
    const state = await send("Runtime.evaluate", { expression: tourProbe, returnByValue: true, awaitPromise: true });
    states.push({ width, ...state.result.result.value });
  }
  await wait(450);
  const settled = await send("Runtime.evaluate", { expression: tourProbe, returnByValue: true, awaitPromise: true });
  states.push({ width: 1440, ...settled.result.result.value });
  return states;
}

function assertResponsiveLifecycleState(state) {
  const label = `responsive lifecycle ${state.width}px`;
  assert(`${label} has no overflow`, !state.overflow, JSON.stringify(state));
  assert(`${label} has controls`, state.controls === 3, JSON.stringify(state));
  assert(`${label} has bounded frame`, state.frameScrollHeight <= state.frameHeight + 8, JSON.stringify(state));
  if (state.width <= 600) {
    assert(`${label} uses mobile mode`, state.mode === "mobile", JSON.stringify(state));
    assert(`${label} renders only mobile shell`, state.mobileShellCount === 1 && state.desktopMainCount === 0 && state.sidebarCount === 0, JSON.stringify(state));
    assert(`${label} has one visible mobile step`, state.visibleMobileSteps === 1 && state.visibleDesktopScenes === 0, JSON.stringify(state));
    assert(`${label} hides cursor`, !state.cursorVisible, JSON.stringify(state));
  } else {
    assert(`${label} uses desktop mode`, state.mode === "desktop", JSON.stringify(state));
    assert(`${label} renders only desktop/tablet shell`, state.mobileShellCount === 0 && state.desktopMainCount === 1 && state.sidebarCount === 1, JSON.stringify(state));
    assert(`${label} has one visible desktop scene`, state.visibleDesktopScenes === 1 && state.visibleMobileSteps === 0, JSON.stringify(state));
    assert(`${label} cursor is bounded or temporarily hidden`, !state.cursorVisible || state.cursorInside, JSON.stringify(state));
  }
}
async function measureTourPerformance(send) {
  const result = await send("Runtime.evaluate", {
    expression: `new Promise((resolve) => {
      document.querySelector('[data-product-proof="compact-gsap-tour"]')?.scrollIntoView({ block: 'center' });
      let frames = 0;
      let longFrames = 0;
      let maxDelta = 0;
      let first = 0;
      let last = 0;
      const tour = document.querySelector('[data-product-proof="compact-gsap-tour"]');
      const startHeight = tour?.getBoundingClientRect().height || 0;
      const step = (time) => {
        if (!first) first = time;
        const delta = last ? time - last : 0;
        if (delta > maxDelta) maxDelta = delta;
        if (delta > 50) longFrames += 1;
        last = time;
        frames += 1;
        if (time - first < 2200) requestAnimationFrame(step);
        else resolve({ frames, approxFps: Math.round((frames / ((time - first) / 1000)) * 10) / 10, longFrames, maxDelta: Math.round(maxDelta * 10) / 10, layoutShift: Math.abs((tour?.getBoundingClientRect().height || 0) - startHeight) });
      };
      requestAnimationFrame(step);
    })`,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result.result.value;
}

async function main() {
  for (const width of widths) {
    await withPage(width, async (send) => {
      const result = await evaluatePageWithConsent(send, `${baseUrl}/`, pageProbe);
      assert(`${width}px viewport width exact`, result.viewport === width, JSON.stringify(result));
      assert(`${width}px homepage no horizontal overflow`, !result.overflow, JSON.stringify(result));
      assert(`${width}px homepage has no scroll cue`, !result.hasScrollCue, JSON.stringify(result));
      assert(`${width}px hero is directly followed by next section`, result.heroDirectlyFollowed, JSON.stringify(result));
      if (width > 600) assert(`${width}px hero avoids forced full viewport`, result.heroHasNaturalHeight, JSON.stringify(result));
      assert(`${width}px ordinary text is not squashed`, result.squashedOrdinaryText === 0, JSON.stringify(result));
      assert(`${width}px homepage shell visible`, result.hasMain && result.hasH1 && result.hasFooter && result.hasNav, JSON.stringify(result));
      assert(`${width}px baseline has no consent obstruction`, !result.hasConsentPanel, JSON.stringify(result));
      assert(`${width}px no public QA leak`, !result.hasQaLeak && !result.hasDesignSystemLink, JSON.stringify(result));
      assert(`${width}px no public secret/internal leak`, !result.hasSecretLeak, JSON.stringify(result));
      assert(`${width}px touch targets remain usable`, result.smallControls === 0, JSON.stringify(result));
      assert(`${width}px compact product tour has three acts`, result.tourControls === 3, JSON.stringify(result));
      assert(`${width}px compact product tour height bounded`, result.tourHeight >= (width <= 600 ? 300 : 420) && result.tourHeight <= (width <= 600 ? 390 : 560), JSON.stringify(result));
      for (const action of result.actionContrasts) {
        const fg = action.color.match(/rgba?\(([^)]+)\)/)?.[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part));
        const bg = action.backgroundColor.match(/rgba?\(([^)]+)\)/)?.[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part));
        if (fg && bg && action.backgroundColor !== 'rgba(0, 0, 0, 0)') assert(`${width}px action contrast ${action.text}`, contrastRatio(fg, bg) >= 4.5, JSON.stringify(action));
      }
    });
  }

  for (const width of widths) {
    await withPage(width, async (send) => {
      const result = await evaluatePageWithConsent(send, `${baseUrl}/`, pageProbe);
      assert(`homepage ${width}px capture no overflow`, !result.overflow, JSON.stringify(result));
      await screenshot(send, "/", width, "homepage-focused");
    });
  }

  for (const viewport of requiredViewports) {
    await withPage(viewport, async (send) => {
      const result = await evaluatePageWithConsent(send, `${baseUrl}/`, pageProbe);
      assert(`${viewport.label} homepage no overflow`, !result.overflow, JSON.stringify(result));
      assert(`${viewport.label} homepage avoids squashed text`, result.squashedOrdinaryText === 0, JSON.stringify(result));
      assert(`${viewport.label} homepage has no scroll cue`, !result.hasScrollCue, JSON.stringify(result));
      assert(`${viewport.label} hero is directly followed by next section`, result.heroDirectlyFollowed, JSON.stringify(result));
      if (viewport.width > 600) assert(`${viewport.label} hero avoids forced full viewport`, result.heroHasNaturalHeight, JSON.stringify(result));
      await screenshot(send, "/", viewport.label, "homepage-focused");
    });
  }

  for (const width of screenshotWidths) {
    for (const pathname of publicPaths) {
      await withPage(width, async (send) => {
        const result = await evaluatePageWithConsent(send, `${baseUrl}${pathname}`, pageProbe);
        assert(`${pathname} ${width}px no overflow`, !result.overflow, JSON.stringify(result));
        assert(`${pathname} ${width}px public shell`, result.hasMain && result.hasFooter, JSON.stringify(result));
        assert(`${pathname} ${width}px no internal leak`, !result.hasQaLeak && !result.hasSecretLeak, JSON.stringify(result));
        await screenshot(send, pathname, width);
      });
    }
  }


  for (const width of fivePageWidths) {
    for (const pathname of fivePagePaths) {
      await withPage({ label: `${safeName(pathname)}-${width}`, width, height: width <= 430 ? 932 : width <= 912 ? 1180 : 1000 }, async (send) => {
        const result = await evaluatePageWithConsent(send, `${baseUrl}${pathname}`, pageProbe);
        assert(`${pathname} five-page ${width}px has one h1`, result.hasH1, JSON.stringify(result));
        assert(`${pathname} five-page ${width}px no overflow`, !result.overflow, JSON.stringify(result));
        assert(`${pathname} five-page ${width}px no squashed text`, result.squashedOrdinaryText === 0, JSON.stringify(result));
        assert(`${pathname} five-page ${width}px no internal leak`, !result.hasQaLeak && !result.hasSecretLeak, JSON.stringify(result));
        assert(`${pathname} five-page ${width}px usable controls`, result.smallControls === 0, JSON.stringify(result));
        await screenshot(send, pathname, width, "five-page-responsive");
      });
    }
  }

  await withPage({ label: "responsive-lifecycle", width: 1440, height: 900 }, async (send) => {
    const states = await runResponsiveLifecycleProbe(send);
    assert("Product Tour responsive lifecycle changed modes", states.some((state) => state.mode === "mobile") && states.some((state) => state.mode === "desktop"), JSON.stringify(states));
    assert("Product Tour responsive lifecycle rebuilt animation", Math.max(...states.map((state) => state.epoch)) >= 3, JSON.stringify(states));
    for (const state of states) assertResponsiveLifecycleState(state);
    const beforeToggle = await send("Runtime.evaluate", { expression: tourProbe, returnByValue: true, awaitPromise: true });
    await send("Runtime.evaluate", { expression: `(() => { const button = [...document.querySelectorAll('.product-tour__controls button')].find((item) => /Pause|Play/.test(item.textContent || '')); button?.click(); return true; })()`, returnByValue: true, awaitPromise: true });
    await wait(250);
    const afterToggle = await send("Runtime.evaluate", { expression: tourProbe, returnByValue: true, awaitPromise: true });
    assert("Product Tour responsive lifecycle controls still toggle", afterToggle.result.result.value.paused !== beforeToggle.result.result.value.paused, JSON.stringify({ before: beforeToggle.result.result.value, after: afterToggle.result.result.value }));
  });
  for (const productWidth of [390, 768, 1440]) {
    await withPage(productWidth, async (send) => {
      const initial = await evaluatePageWithConsent(send, `${baseUrl}/`, tourProbe);
      assert(`Product Tour ${productWidth}px initial compact state`, initial.ready === "true" && initial.controls === 3 && !initial.hasCompleteAnswer && !initial.hasSettings && !initial.hasInternalScroll && initial.scenesFit && !initial.overflow, JSON.stringify(initial));
      if (productWidth <= 600) {
        assert(`Product Tour ${productWidth}px renders only mobile composition`, initial.mode === "mobile" && initial.mobileShellCount === 1 && initial.desktopMainCount === 0 && initial.sidebarCount === 0 && initial.visibleMobileSteps === 1, JSON.stringify(initial));
        assert(`Product Tour ${productWidth}px keeps desktop evidence rows unmounted`, initial.evidenceRows === 0, JSON.stringify(initial));
      } else {
        assert(`Product Tour ${productWidth}px renders only desktop/tablet composition`, initial.mode === "desktop" && initial.mobileShellCount === 0 && initial.desktopMainCount === 1 && initial.sidebarCount === 1 && initial.visibleDesktopScenes === 1, JSON.stringify(initial));
        assert(`Product Tour ${productWidth}px keeps compact evidence rows readable`, initial.evidenceRows === 2, JSON.stringify(initial));
      }
      assert(`Product Tour ${productWidth}px logo uses cropped white icon`, initial.logo.src.includes('amniora-icon-white-cropped'), JSON.stringify(initial.logo));
      assert(`Product Tour ${productWidth}px logo mark is readable`, initial.logo.symbolWidth >= 26 && initial.logo.symbolWidth <= 34 && initial.logo.symbolHeight >= 26 && initial.logo.symbolHeight <= 34, JSON.stringify(initial.logo));
      if (productWidth > 600) assert(`Product Tour ${productWidth}px logo has no visible box`, initial.logo.backgroundColor === 'rgba(0, 0, 0, 0)' && initial.logo.borderWidth === '0px', JSON.stringify(initial.logo));
      await screenshot(send, "/", productWidth, "tour-dashboard-act");
      await wait(1300);
      const approach = await send("Runtime.evaluate", { expression: tourProbe, returnByValue: true, awaitPromise: true });
      if (productWidth <= 600) assert(`Product Tour ${productWidth}px mobile hides cursor`, !approach.result.result.value.cursorVisible && approach.result.result.value.mobileShellVisible, JSON.stringify(approach.result.result.value));
      else assert(`Product Tour ${productWidth}px tablet/desktop cursor visible and inside`, approach.result.result.value.cursorVisible && approach.result.result.value.cursorInside && !approach.result.result.value.mobileShellVisible, JSON.stringify(approach.result.result.value));
      await screenshot(send, "/", productWidth, "tour-cursor-approach-generate");
      if (productWidth > 600) {
        const sampledBounds = await sampleCursorBounds(send);
        assert(`Product Tour ${productWidth}px cursor remains bounded during loop`, sampledBounds.ok && !sampledBounds.overflow, JSON.stringify(sampledBounds));
      }
      await wait(2200);
      await screenshot(send, "/", productWidth, "tour-cursor-press-generate");
      await wait(1100);
      const generate = await send("Runtime.evaluate", { expression: tourProbe, returnByValue: true, awaitPromise: true });
      assert(`Product Tour ${productWidth}px reaches generate act`, generate.result.result.value.act === "generate" && generate.result.result.value.scenesFit && !generate.result.result.value.overflow, JSON.stringify(generate.result.result.value));
      await screenshot(send, "/", productWidth, "tour-generate-form");
      await wait(3600);
      await screenshot(send, "/", productWidth, "tour-progress-ready");
      await wait(1600);
      const investigate = await send("Runtime.evaluate", { expression: tourProbe, returnByValue: true, awaitPromise: true });
      assert(`Product Tour ${productWidth}px reaches investigate act`, investigate.result.result.value.act === "investigate" && investigate.result.result.value.scenesFit && !investigate.result.result.value.hasCompleteAnswer && !investigate.result.result.value.overflow, JSON.stringify(investigate.result.result.value));
      await screenshot(send, "/", productWidth, "tour-generated-lab-opening");
      await wait(2600);
      await screenshot(send, "/", productWidth, "tour-evidence-selected");
      await wait(1600);
      await screenshot(send, "/", productWidth, "tour-hint-open");
      await wait(1800);
      await screenshot(send, "/", productWidth, "tour-final-resting-state");
      for (const frame of [400, 900, 1400, 1900, 2400]) {
        await wait(frame);
        await screenshot(send, "/", productWidth, `tour-loop-frame-${frame}`);
      }
      const perf = await measureTourPerformance(send);
      assert(`Product Tour ${productWidth}px performance target`, perf.approxFps >= 30 && perf.longFrames <= 2 && perf.layoutShift <= 1, JSON.stringify(perf));
      await send("Runtime.evaluate", { expression: `(() => { document.querySelector('[data-product-proof="compact-gsap-tour"]')?.scrollIntoView({ block: 'center' }); const button = [...document.querySelectorAll('.product-tour__controls button')].find((item) => /Pause|Play/.test(item.textContent || '')); button?.click(); return true; })()`, returnByValue: true, awaitPromise: true });
      await wait(250);
      const paused = await send("Runtime.evaluate", { expression: tourProbe, returnByValue: true, awaitPromise: true });
      assert(`Product Tour ${productWidth}px pause control works`, paused.result.result.value.paused === "true", JSON.stringify(paused.result.result.value));
      await screenshot(send, "/", productWidth, "tour-paused-state");
    });
  }

  await withPage(390, async (send) => {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const state = await evaluatePageWithConsent(send, `${baseUrl}/`, tourProbe);
    assert("Product Tour reduced motion starts complete and hides cursor", state.act === "investigate" && state.paused === "true" && !state.cursorVisible && !state.hasCompleteAnswer && !state.overflow, JSON.stringify(state));
    await screenshot(send, "/", 390, "tour-reduced-motion");
  });

  await withPage(390, async (send) => {
    const result = await evaluatePageWithConsent(send, `${baseUrl}/`, pageProbe);
    assert("mobile cookie appears before menu", !result.overflow, JSON.stringify(result));
    await screenshot(send, "/", 390, "mobile-menu-baseline");
  });

  console.log(JSON.stringify({ passed: true, assertions, screenshotRoot, screenshots }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
