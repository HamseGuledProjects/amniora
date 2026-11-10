#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated offline browser/component harness. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { generateKeyPairSync } = require("node:crypto");
const webpack = require("webpack");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const { resolveBrowserExecutable } = require("../browserDiscovery");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "../../..");
const PREVIEW = process.argv.includes("--preview");
const CLOUD = process.argv.includes("--cloud");
const sourceRoot = path.join(ROOT, "lib", "web-lab");
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Fixture only transpiles Web lab TypeScript");
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const { createLocalRunnerPackage } = require("../../../lib/web-lab/local-runner/package.ts");
const { planBeginnerEcommerceStoredXssLab } = require("../../../lib/web-lab/ecommerce-planner.ts");
const OUTPUT = path.join(ROOT, ".tmp", "web-lab-phase15b-ui");
const BUILD = path.join(OUTPUT, PREVIEW ? "preview-bundle" : "bundle");
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let checks = 0;
function ok(name, condition) { assert.ok(condition, name); checks++; console.log("PASS " + name); }

async function compileFixture() {
  fs.mkdirSync(BUILD, { recursive: true });
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: PREVIEW ? "development" : "production", devtool: false, context: ROOT, target: "web",
      entry: path.join(__dirname, "browserFixture.jsx"), output: { path: BUILD, filename: "fixture.js" },
      resolve: { extensions: [".tsx", ".ts", ".jsx", ".js"], alias: { "@": ROOT } },
      module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.join(__dirname, "fixtureTsLoader.cjs") }] },
      plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: PREVIEW ? "development" : "production" }) })],
      optimization: { minimize: false }, performance: { hints: false },
    });
    compiler.run((error, stats) => compiler.close(closeError => {
      if (error || closeError) reject(error || closeError);
      else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
  });
  const cssPath = path.join(ROOT, "app", "globals.css");
  const css = await postcss([tailwind({ base: ROOT, optimize: true })]).process(fs.readFileSync(cssPath, "utf8"), { from: cssPath });
  fs.writeFileSync(path.join(BUILD, "fixture.css"), css.css);
  const { privateKey } = generateKeyPairSync("ed25519");
  const pkg = createLocalRunnerPackage({
    buildId: "phase15b-ui-build", ownerId: "phase15b-ui-owner", explicitExecutable: true,
    spec: planBeginnerEcommerceStoredXssLab("phase15b-ui-fixture"),
  }, { userId: "phase15b-ui-owner" }, { keyId: "ephemeral-fixture-key", privateKey }, { lifetimeMs: 3_600_000 });
  const bootstrap = JSON.stringify(pkg).replace(/</g, "\\u003c");
  fs.writeFileSync(path.join(BUILD, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phase 15B isolated UI fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.__phase15bPackage=${bootstrap};</script><script src="/fixture.js"></script></body></html>`);
}

async function serveFixture() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const name = { "/": "index.html", "/fixture.css": "fixture.css", "/fixture.js": "fixture.js" }[pathname];
    if (!name) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": name.endsWith("css") ? "text/css" : name.endsWith("js") ? "text/javascript" : "text/html", "Cache-Control": "no-store" });
    response.end(fs.readFileSync(path.join(BUILD, name)));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function browserPage(callback) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase15b-ui-"));
  const browser = spawn(resolveBrowserExecutable(), ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
  let startupError;
  browser.on("error", error => { startupError = error; });
  let socket;
  try {
    let target;
    for (let attempt = 0; attempt < 100 && !target; attempt++) {
      if (startupError) throw startupError;
      try {
        const port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })).json();
        target = targets.find(item => item.type === "page" && item.webSocketDebuggerUrl);
      } catch { /* fresh fixture browser starting */ }
      if (!target) await wait(100);
    }
    assert.ok(target, "Fixture Chromium started");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let nextId = 1;
    const pending = new Map();
    const exceptions = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
      if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Fixture browser command timed out: " + method)); }, 8_000);
      pending.set(id, message => { clearTimeout(timer); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (reply.exceptionDetails) throw new Error("Fixture evaluation failed: " + reply.exceptionDetails.text);
      return reply.result?.value;
    };
    const until = async (expression, label) => {
      for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await wait(50); }
      throw new Error("Fixture wait failed: " + label + "\n" + await evaluate("document.body.innerText") + "\n" + exceptions.join("\n"));
    };
    const click = async text => {
      const found = await evaluate(`(() => { const el = [...document.querySelectorAll('button,a')].find(node => node.textContent.trim() === ${JSON.stringify(text)} && !node.disabled); if (!el) return false; el.click(); return true; })()`);
      assert.ok(found, "Clickable control: " + text);
    };
    const has = text => evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
    const screenshot = async name => {
      await wait(450); // Let the unchanged TaskCard's existing entrance transition complete.
      // Capture the current viewport; full-page capture can transiently change viewport/media state.
      const image = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const output = path.join(OUTPUT, name + ".png");
      fs.writeFileSync(output, Buffer.from(image.data, "base64"));
      return output;
    };
    await send("Page.enable"); await send("Runtime.enable");
    await callback({ send, evaluate, until, click, has, screenshot, exceptions });
  } finally {
    socket?.close();
    const exited = new Promise(resolve => {
      if (browser.exitCode !== null || browser.pid === undefined) { resolve(); return; }
      const timer = setTimeout(resolve, 5_000);
      browser.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    browser.kill(); await exited;
    const safeTempRoot = path.resolve(os.tmpdir());
    if (path.dirname(path.resolve(profile)) !== safeTempRoot || !path.basename(profile).startsWith("amniora-phase15b-ui-")) {
      throw new Error("Refusing to remove a browser profile outside the owned fixture temp directory");
    }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function main() {
  await compileFixture();
  const { server, origin } = await serveFixture();
  const screenshots = [];
  try {
    await browserPage(async page => {
      const { send, evaluate, until, click, has } = page;
      const navigate = async (scenario, width = 1440, extra = "") => {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
        await send("Page.navigate", { url: `${origin}/?scenario=${scenario}${extra}` });
        await until("window.__phase15b?.ready && !!document.querySelector('[data-fixture-task-section]')", "actual components render");
        await wait(120);
      };
      const runtimePresent = () => has("Run this lab");
      const count = route => evaluate(`window.__phase15b.requests.filter(item => item.path === ${JSON.stringify(route)}).length`);
      const localCount = () => evaluate("window.__phase15b.requests.filter(item => item.local).length");

      if (CLOUD) {
        const cloudPath = "/api/web-labs/cloud/fixture-saved-lab";
        if (PREVIEW) {
          const states = [["cloud-pro", "Cloud available"], ["cloud-starting", "Starting Cloud lab"],
            ["cloud-ready", "Cloud lab ready"], ["cloud-capacity", "Cloud capacity is full"],
            ["cloud-expiring", "Cloud lab expiring soon"], ["cloud-unavailable", "Cloud temporarily unavailable"],
            ["cloud-free", "Available with Pro"]];
          for (const [state, text] of states) {
            await navigate("flagoff", 1440, "&runnerPreview=" + state);
            await until(`document.body.innerText.includes(${JSON.stringify(text)})`, "Cloud preview " + state);
            ok(`${state}: real Cloud component clearly labelled`, await has("Development preview") && await has("Amniora Cloud"));
            ok(`${state}: preview performs no API, database or gateway request`, await evaluate("window.__phase15b.requests.length === 0"));
            ok(`${state}: provider identity and raw route absent`, !(await has("vercel.run")) && !(await has("Sandbox")) && !(await has("provider")));
          }
          await navigate("flagoff", 390, "&runnerPreview=cloud-expiring");
          await until("document.body.innerText.includes('Cloud lab expiring soon')", "Cloud mobile preview");
          ok("Cloud mobile preview remains usable without desktop Runner", await has("Open Lab") && await has("My Computer") && await has("My VM"));
          ok("Cloud mobile preview has no horizontal overflow", await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
          ok("Cloud preview actions stay inert", await evaluate(`(() => { document.querySelectorAll('[data-cloud-runtime] button:not(:disabled)').forEach(el => el.click()); return window.__phase15b.requests.length === 0 && window.__phase15b.opened.length === 0; })()`));
          screenshots.push(await page.screenshot("phase17b-cloud-preview-mobile"));
          ok("Cloud preview campaign has no uncaught exceptions", page.exceptions.length === 0);
          return;
        }

        await navigate("cloud-free");
        await until("document.body.innerText.includes('Amniora Cloud')", "Free Cloud card");
        ok("Free sees Cloud but cannot select it", await evaluate(`(() => {
          const buttons = [...document.querySelectorAll('button')];
          return buttons.find(el => el.textContent.trim() === 'Amniora Cloud')?.disabled === true &&
            buttons.find(el => el.textContent.trim() === 'My Computer')?.disabled === false &&
            buttons.find(el => el.textContent.trim() === 'My VM')?.disabled === false;
        })()`));
        ok("Free receives restrained Pro copy", await has("Available with Pro") && !(await has("checkout")) && !(await has("payment")));

        for (const [scenarioName, text] of [["cloud-capacity", "Cloud capacity is full"],
          ["cloud-unavailable", "Cloud temporarily unavailable"]]) {
          await navigate(scenarioName);
          await until("document.body.innerText.includes('Amniora Cloud')", scenarioName + " card");
          await click("Amniora Cloud");
          await until(`document.body.innerText.includes(${JSON.stringify(text)})`, scenarioName + " status");
          ok(`${scenarioName}: fallback options remain visible`, await has("My Computer") && await has("My VM"));
          ok(`${scenarioName}: no provider detail rendered`, !(await has("vercel")) && !(await has("Sandbox")) && !(await has("region")));
        }

        await navigate("cloud-live");
        await until("document.body.innerText.includes('Amniora Cloud')", "Cloud selectable");
        await click("Amniora Cloud");
        await until("document.body.innerText.includes('Launch Cloud Lab')", "Cloud launch control");
        await evaluate(`window.__phase15b.hold = ${JSON.stringify(cloudPath)}`);
        await click("Launch Cloud Lab");
        await until("window.__phase15b.release !== null && document.body.innerText.includes('Launching')", "Cloud launch in flight");
        ok("Cloud launch uses calm indeterminate progress", !(await has("%")) && !(await has("queue position")));
        await evaluate("window.__phase15b.hold = null; window.__phase15b.release()");
        await until("document.body.innerText.includes('Cloud lab ready')", "Cloud ready");
        ok("Cloud ready exposes lifecycle controls", await evaluate(`['Open Lab','Refresh Status','Reset','Stop'].every(label => [...document.querySelectorAll('[data-cloud-runtime] button')].some(el => el.textContent.trim() === label))`));
        ok("one launch request created the recovered logical runtime", await evaluate(`window.__phase15b.requests.filter(item => item.path === ${JSON.stringify(cloudPath)} && item.method === 'POST').length === 1`));

        await click("Open Lab");
        await until("window.__phase15b.opened.length === 1", "Cloud gateway handoff");
        ok("Open Lab submits a trusted POST in a new tab", await evaluate(`window.__phase15b.opened[0].method === 'post' && window.__phase15b.opened[0].target === '_blank' && window.__phase15b.opened[0].handoffField === 'grant' && new URL(window.__phase15b.opened[0].url).pathname === '/__amniora/cloud/launch'`));
        ok("gateway handoff never appears in the URL", await evaluate("!window.__phase15b.opened[0].url.includes('aaaa') && !window.__phase15b.opened[0].url.includes('?')"));

        await click("Reset");
        await until("document.body.innerText.includes('Reset Cloud lab?')", "Cloud reset confirmation");
        ok("Cloud reset confirmation focuses Cancel", await evaluate("document.activeElement.textContent.trim() === 'Cancel'"));
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
        await until("!document.body.innerText.includes('Reset Cloud lab?')", "Cloud reset cancelled");
        await click("Reset"); await click("Reset Lab");
        await until("document.body.innerText.includes('Cloud lab ready')", "Cloud reset ready");
        await click("Stop");
        await until("document.body.innerText.includes('Launch Cloud Lab') && !document.body.innerText.includes('Open Lab')", "Cloud stopped");
        ok("stop preserves Saved Lab and returns Cloud to launchable", await has("Review the supplied catalogue") && await has("Launch Cloud Lab"));

        await send("Page.reload");
        await until("window.__phase15b?.ready && !!document.querySelector('[data-fixture-task-section]')", "Cloud page refresh");
        await until("document.body.innerText.includes('Amniora Cloud')", "Cloud card after refresh");
        ok("page refresh does not create a duplicate Cloud runtime", await evaluate(`window.__phase15b.requests.filter(item => item.path === ${JSON.stringify(cloudPath)} && item.method === 'POST').length === 0`));

        await navigate("cloud-expiring", 390);
        await until("document.body.innerText.includes('Amniora Cloud')", "Cloud mobile card");
        await click("Amniora Cloud");
        await until("document.body.innerText.includes('Cloud lab expiring soon')", "Cloud expiry notice");
        ok("Cloud expiry uses approximate minutes", await evaluate("/expires in about \\d+ minutes?/.test(document.body.innerText)"));
        ok("Cloud mobile remains usable and does not overflow", await has("Open Lab") && await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
        const visual = await evaluate(`(() => {
          const root = document.querySelector('[data-local-runner-section]');
          const panel = document.querySelector('[data-cloud-runtime] [role="status"]');
          const buttons = [...root.querySelectorAll('button')];
          return { shell: getComputedStyle(root.querySelector('section')).borderRadius,
            panel: getComputedStyle(panel).borderRadius,
            buttons: buttons.every(el => getComputedStyle(el).borderRadius === '4px') };
        })()`);
        ok("Cloud preserves approved 3px panels and 4px controls", visual.shell === "3px" && visual.panel === "3px" && visual.buttons);
        screenshots.push(await page.screenshot("phase17b-cloud-mobile-expiring"));
        ok("Cloud browser campaign has no uncaught exceptions", page.exceptions.length === 0);
        ok("Cloud browser campaign created no loopback Runner request", await localCount() === 0);
        const persisted = await evaluate("JSON.stringify({local: {...localStorage}, session: {...sessionStorage}})");
        ok("Cloud grants and handoffs are not persisted", !persisted.includes("control-launch-grant") && !persisted.includes("aaaa"));
        console.log(JSON.stringify({ passed: true, checks, browser: "installed Chromium-family browser via CDP", screenshots,
          scope: "Actual Saved Lab runtime components and compiled app CSS; synthetic authenticated Cloud API only; no database, hosted runtime, Docker or deployment." }, null, 2));
        return;
      }

      const previewStates = [["ready", "Lab Ready"], ["offline", "Runner Offline"],
        ["docker-unavailable", "Docker Desktop is required"], ["version-mismatch", "Runner update required"],
        ["starting", "Starting Lab"], ["failed", "The local lab couldn't start"]];
      if (PREVIEW) {
        for (const [state, text] of previewStates) {
          await navigate("flagoff", 1440, "&runnerPreview=" + state);
          await until(`document.body.innerText.includes(${JSON.stringify(text)})`, "preview " + state);
          ok(`${state}: preview clearly labelled`, await has("Development preview"));
          ok(`${state}: actual runtime and surrounding task rendered`, await runtimePresent() && await has("Review the supplied catalogue"));
          await evaluate(`document.querySelectorAll('[data-local-runner-section] button:not(:disabled)').forEach(el => el.click())`);
          if (state === "ready") {
            await until("document.body.innerText.includes('Reset lab?')", "preview reset confirmation");
            await click("Reset Lab");
            await click("Cancel");
            ok("ready: all requested controls retained", await evaluate(`['My Computer','My VM','Amniora Cloud','Open Lab','Refresh Status','Reset','Stop'].every(label => [...document.querySelectorAll('[data-local-runner-section] button')].some(el => el.textContent === label))`));
            screenshots.push(await page.screenshot("development-preview-ready"));
          }
          ok(`${state}: zero API requests after preview actions`, await evaluate("window.__phase15b.requests.length === 0"));
          ok(`${state}: Open Lab never opens a URL`, await evaluate("window.__phase15b.opened.length === 0"));
        }
        for (const [state, text] of [["vm-connected", "Ubuntu practice VM"], ["vm-offline", "VM offline"],
          ["vm-ready", "Open Lab"], ["vm-starting", "Lab starting"], ["vm-reconnecting", "Runner reconnecting"],
          ["vm-incompatible", "Runner incompatible"], ["vm-waiting", "Connect your VM"]]) {
          await navigate("flagoff", 1440, "&runnerPreview=" + state);
          await until(`document.body.innerText.includes(${JSON.stringify(text)})`, "My VM preview " + state);
          ok(`${state}: real My VM component clearly labelled`, await has("Development preview") && await has("My VM"));
          ok(`${state}: preview performs no API, Runner, or relay request`, await evaluate("window.__phase15b.requests.length === 0"));
          ok(`${state}: no raw VM URL is rendered`, !(await has("10.0.2.")) && !(await has("192.168.")));
        }
        await navigate("linux", 1440, "&runnerPreview=ready");
        await until("document.body.innerText.includes('Lab Ready')", "preview on non-executable record");
        ok("preview needs no executable build or category eligibility", await evaluate("window.__phase15b.requests.length === 0"));
        await evaluate("window.__phase15b.setPreviewState('offline')");
        await until("document.body.innerText.includes('Runner Offline')", "query state changes");
        ok("preview change discards prior ready controls", !(await has("Open Lab")));
        await evaluate("window.__phase15b.setPreviewState('ready')");
        await until("document.body.innerText.includes('Lab Ready')", "preview ready restored");
        await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
        await until("document.body.innerText.includes('Desktop required')", "preview mobile");
        ok("preview mobile has no runtime actions or overflow", !(await has("Open Lab")) && await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
        screenshots.push(await page.screenshot("development-preview-mobile"));
        await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await until("document.body.innerText.includes('Lab Ready')", "preview desktop restored");
        ok("resize keeps preview offline from all APIs", await evaluate("window.__phase15b.requests.length === 0"));
        await evaluate("window.__phase15b.setPreviewState(null)");
        await until("!document.querySelector('[data-local-runner-section]')", "preview removed");
        ok("removing preview restores normal non-Web eligibility", await localCount() === 0);
        await navigate("flagoff", 1440, "&runnerPreview=unknown");
        ok("invalid preview leaves live feature flag authoritative", !(await runtimePresent()) && await count("/api/web-labs/local-runner/fixture-saved-lab") === 1);
        ok("preview campaign has no uncaught exceptions", page.exceptions.length === 0);
        return;
      }
      for (const [state] of previewStates) {
        await navigate("flagoff", 1440, "&runnerPreview=" + state);
        ok(`production ignores ${state} preview and respects eligibility`, !(await runtimePresent()) && !(await has("Development preview")) && await count("/api/web-labs/local-runner/fixture-saved-lab") === 1 && await localCount() === 0);
      }

      for (const scenario of ["static", "linux", "flagoff"]) {
        await navigate(scenario);
        ok(`${scenario}: runtime hidden`, !(await runtimePresent()));
        ok(`${scenario}: surrounding saved task retained`, await has("Review the supplied catalogue"));
        ok(`${scenario}: no loopback requests`, await localCount() === 0);
        if (scenario === "linux") ok("Linux: no runtime eligibility request", await count("/api/web-labs/local-runner/fixture-saved-lab") === 0);
      }
      await navigate("vm-only");
      await until("document.body.innerText.includes('My VM')", "independent My VM option");
      ok("My VM is independent of the My Computer flag", await evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button')];
        return buttons.find(el => el.textContent.trim() === 'My Computer')?.disabled === true &&
          buttons.find(el => el.textContent.trim() === 'My VM')?.disabled === false &&
          buttons.find(el => el.textContent.trim() === 'Amniora Cloud')?.disabled === true;
      })()`));
      await click("My VM");
      await until("document.body.innerText.includes('Connect your VM')", "My VM connection state");
      ok("VM-only flow exposes enrollment without probing loopback", await localCount() === 0 && await has("Available · Free and Pro"));
      await navigate("ready", 390);
      await until("document.body.innerText.includes('Desktop required')", "mobile desktop-only guidance");
      ok("mobile: saved task and Tutor controls retained", await has("Explain") && await has("Quiz"));
      ok("mobile: hints begin collapsed with accessible reveal state", await evaluate(`(() => {
        const control = document.querySelector('[data-saved-lab-progressive-hints] button');
        return control?.textContent.trim() === 'Reveal' && control.getAttribute('aria-expanded') === 'false' &&
          !!control.getAttribute('aria-controls') && !document.getElementById(control.getAttribute('aria-controls'));
      })()`));
      await click("Reveal");
      ok("mobile: hint reveals without exposing the next hint", await evaluate(`(() => {
        const controls = [...document.querySelectorAll('[data-saved-lab-progressive-hints] button')];
        return controls[0].textContent.trim() === 'Hide' && controls[0].getAttribute('aria-expanded') === 'true' &&
          !!document.getElementById(controls[0].getAttribute('aria-controls')) && controls[1].textContent.trim() === 'Reveal';
      })()`));
      ok("mobile: no loopback requests", await localCount() === 0);
      ok("mobile: no horizontal overflow", await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
      ok("mobile: runtime retains Saved section geometry", await evaluate(`(() => {
        const runtime = getComputedStyle(document.querySelector('[data-local-runner-section] section'));
        const saved = getComputedStyle(document.querySelector('[data-fixture-task-section]'));
        return runtime.borderRadius === '3px' && runtime.borderRadius === saved.borderRadius &&
          runtime.backgroundColor === saved.backgroundColor && runtime.borderTopColor === saved.borderTopColor;
      })()`));
      screenshots.push(await page.screenshot("mobile-desktop-required"));

      await navigate("resize-check");
      await until("document.body.innerText.includes('My Computer')", "resize fixture option");
      await evaluate("window.__phase15b.hold = '/v1/capabilities'");
      await click("My Computer");
      await until("window.__phase15b.release !== null", "resize check in flight");
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
      await until("document.body.innerText.includes('Desktop required') && window.__phase15b.release === null", "resize cancels observation");
      ok("resize to mobile aborts local check without a launch", await count("/v1/launch") === 0 && await count("/v1/status") === 0);
      const afterResizeCount = await localCount();
      await evaluate("window.__phase15b.hold = null");
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await until("document.body.innerText.includes('My Computer')", "desktop restored");
      ok("return to desktop needs explicit reactivation", await localCount() === afterResizeCount);

      for (const [scenario, message] of [["offline", "isn't available"], ["docker", "Docker Desktop isn't running"], ["docker-missing", "Docker Desktop is required"], ["version", "Runner update required"], ["unsupported", "isn't supported on this computer"], ["unsafe", "unsafe lab address"], ["foreign", "Another lab is already running"]]) {
        await navigate(scenario);
        await until("document.body.innerText.includes('My Computer')", scenario + " runtime option");
        ok(`${scenario}: discovery not automatic`, await localCount() === 0);
        await click("My Computer");
        await until(`document.body.innerText.includes(${JSON.stringify(message)})`, scenario + " safe message");
        ok(`${scenario}: no Open Lab`, !(await has("Open Lab")));
        ok(`${scenario}: no package issuance`, await count("/api/web-labs/local-runner/fixture-saved-lab/package") === 0);
        ok(`${scenario}: no launch`, await count("/v1/launch") === 0);
      }

      await navigate("ready");
      await until("document.body.innerText.includes('My Computer')", "runtime options");
      ok("Free: runtime option available", await runtimePresent());
      ok("Cloud and VM remain disabled", await evaluate("[...document.querySelectorAll('button')].filter(el => /My VM|Amniora Cloud/.test(el.textContent)).length === 2 && [...document.querySelectorAll('button')].filter(el => /My VM|Amniora Cloud/.test(el.textContent)).every(el => el.disabled)"));
      await evaluate("window.__phase15b.hold = '/v1/capabilities'");
      await click("My Computer");
      await until("window.__phase15b.release !== null", "capability request in flight");
      ok("checking state visible within section", await has("Checking Runner"));
      ok("loading action retains compact geometry", await evaluate("getComputedStyle(document.querySelector('[data-local-runner-section] button[aria-busy=\"true\"]')).borderRadius === '4px'"));
      ok("checking does not remove tasks", await has("Review the supplied catalogue"));
      await evaluate("window.__phase15b.hold = null; window.__phase15b.release()");
      await until("document.body.innerText.includes('Start Lab')", "Runner ready");
      ok("Runner Ready state", await has("Runner Ready"));
      await evaluate("window.__phase15b.hold = '/v1/launch'");
      await click("Start Lab");
      await until("window.__phase15b.release !== null", "launch request in flight");
      ok("starting state visible", await has("Starting Lab"));
      await evaluate("window.__phase15b.hold = null; window.__phase15b.release()");
      await until("document.body.innerText.includes('Open Lab')", "ready endpoint");
      ok("one package request and one launch", await count("/api/web-labs/local-runner/fixture-saved-lab/package") === 1 && await count("/v1/launch") === 1);
      await click("Open Lab");
      ok("Open Lab only validated numeric loopback", await evaluate("window.__phase15b.opened.length === 1 && window.__phase15b.opened[0].url.replace(/\\/$/, '') === 'http://127.0.0.1:45678'"));
      ok("Open Lab isolates the new tab", await evaluate("window.__phase15b.opened[0].target === '_blank' && window.__phase15b.opened[0].features.includes('noopener') && window.__phase15b.opened[0].features.includes('noreferrer')"));
      ok("desktop no horizontal overflow", await evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
      const visual = await evaluate(`(() => {
        const root = document.querySelector('[data-local-runner-section]');
        const style = element => { const css = getComputedStyle(element); return {
          radius: css.borderRadius, background: css.backgroundColor, border: css.borderTopWidth,
          fontSize: css.fontSize, padding: css.padding, shadow: css.boxShadow,
        }; };
        const buttons = [...root.querySelectorAll('button')];
        return {
          shell: style(root.querySelector('section')),
          heading: style(root.querySelector('h2')),
          status: style(root.querySelector('[role="status"]')),
          badge: style([...root.querySelectorAll('span')].find(el => el.textContent === 'Pro')),
          buttons: buttons.map(style),
          primary: style(buttons.find(el => el.textContent === 'Open Lab')),
          secondary: style(buttons.find(el => el.textContent === 'My Computer')),
        };
      })()`);
      ok("desktop: Saved shell and status retain 3px corners and 1px borders", [visual.shell, visual.status].every(style => style.radius === "3px" && style.border === "1px"));
      ok("desktop: all runtime buttons use 4px corners", visual.buttons.every(style => style.radius === "4px"));
      ok("desktop: Pro badge is dark and rectangular, not a pale pill", visual.badge.radius === "3px" && visual.badge.background === "rgb(7, 20, 38)" && visual.badge.border === "1px");
      ok("desktop: actions use existing Saved dark surfaces", visual.primary.background === "rgb(11, 32, 51)" && visual.secondary.background === "rgb(8, 24, 39)");
      ok("desktop: section hierarchy unchanged", visual.heading.fontSize === "20px" && visual.status.padding === "16px" && visual.shell.background === "rgb(7, 20, 38)");
      screenshots.push(await page.screenshot("desktop-lab-ready"));
      await click("Refresh Status");
      await until("!document.querySelector('[aria-busy=\"true\"]')", "refresh completes");
      ok("reconnect does not launch duplicate", await count("/v1/launch") === 1);

      await send("Page.reload");
      await until("window.__phase15b?.ready && !!document.querySelector('[data-fixture-task-section]')", "page refresh");
      await until("document.body.innerText.includes('My Computer')", "refreshed runtime option");
      ok("page refresh leaves persisted fixture runtime ready", await evaluate("window.__phase15b.runtime.state === 'ready'"));
      ok("page refresh does not auto-probe", await localCount() === 0);
      await click("My Computer");
      await until("document.body.innerText.includes('Open Lab')", "reconnected existing session");
      ok("existing session reconnect creates no second runtime", await count("/v1/launch") === 0 && await count("/api/web-labs/local-runner/fixture-saved-lab/package") === 0);

      await click("Reset");
      await until("document.body.innerText.includes('Reset lab?')", "reset confirmation");
      ok("reset confirmation makes no mutation", await count("/v1/reset") === 0);
      ok("reset confirmation focuses Cancel", await evaluate("document.activeElement.textContent.trim() === 'Cancel'"));
      ok("reset confirmation retains compact controls and red destructive action", await evaluate(`(() => {
        const buttons = [...document.querySelectorAll('[aria-labelledby="local-runner-reset-title"] button')];
        return buttons.every(el => getComputedStyle(el).borderRadius === '4px') &&
          getComputedStyle(buttons.find(el => el.textContent === 'Reset Lab')).backgroundColor === 'rgb(220, 38, 38)';
      })()`));
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
      await until("!document.body.innerText.includes('Reset lab?')", "Escape cancels reset");
      await until("document.activeElement.textContent.trim() === 'Reset'", "reset focus restored");
      ok("Escape cancels without reset", await count("/v1/reset") === 0);
      await click("Reset");
      await click("Cancel");
      ok("cancel retains runtime generation", await evaluate("window.__phase15b.runtime.generation === 1"));
      await click("Reset");
      await evaluate("window.__phase15b.hold = '/v1/reset'");
      await click("Reset Lab");
      await until("window.__phase15b.release !== null", "reset in flight");
      ok("resetting state visible", await has("Resetting"));
      await evaluate("window.__phase15b.hold = null; window.__phase15b.release()");
      await until("window.__phase15b.runtime.generation === 2 && document.body.innerText.includes('Open Lab')", "reset ready");
      ok("reset increments generation once", await count("/v1/reset") === 1);
      await evaluate("window.__phase15b.hold = '/v1/stop'");
      await click("Stop");
      await until("window.__phase15b.release !== null", "stop in flight");
      ok("stopping state visible", await has("Stopping"));
      await evaluate("window.__phase15b.hold = null; window.__phase15b.release()");
      await until("window.__phase15b.runtime.state === 'idle' && !document.body.innerText.includes('Open Lab')", "stopped");
      ok("stop clears endpoint and preserves saved tasks", await evaluate("window.__phase15b.runtime.endpoint === null") && await has("Review the supplied catalogue"));

      for (const scenario of ["failure", "privileged"]) {
        await navigate(scenario);
        await until("document.body.innerText.includes('My Computer')", "error-case options");
        await click("My Computer");
        await until("document.body.innerText.includes('Start Lab')", "error-case detection");
        await click("Start Lab");
        await until("document.body.innerText.includes('Unable to run lab')", "error shown");
        ok(`${scenario}: no unsafe Open Lab`, !(await has("Open Lab")));
        if (scenario === "privileged") ok("privileged package rejected before Runner authorization", await count("/v1/authorize") === 0);
      }

      await navigate("failed-status");
      await until("document.body.innerText.includes('My Computer')", "failed session option");
      await click("My Computer");
      await until("document.body.innerText.includes('Unable to run lab')", "failed session status");
      ok("owned failed session retains Stop cleanup", await evaluate("[...document.querySelectorAll('button')].some(el => el.textContent.trim() === 'Stop' && !el.disabled)"));
      await click("Stop");
      await until("window.__phase15b.runtime.state === 'idle' && document.body.innerText.includes('Start Lab')", "failed session cleanup");
      ok("failed session stops once and permits explicit restart", await count("/v1/stop") === 1 && await count("/v1/launch") === 0);

      await navigate("already", 1440, "&plan=pro");
      await until("document.body.innerText.includes('My Computer')", "Pro fixture available");
      for (const [label, mode] of [["Explain", "explain"], ["Hint", "hint"], ["Command", "command"], ["Quiz", "quiz"]]) {
        await click(label);
        const expected = mode === "command" ? "Synthetic fixture guidance" : mode === "quiz" ? "Which evidence should you inspect?" : `Synthetic ${mode} guidance`;
        await until(`document.body.innerText.includes(${JSON.stringify(expected)})`, "mocked Tutor " + mode);
        ok(`actual TaskCard ${label} still displays offline response`, await has(expected));
      }
      ok("no uncaught browser exceptions", page.exceptions.length === 0);
      ok("no unintended product or external requests", await evaluate("window.__phase15b.unexpectedRequests.length === 0"));
      const persisted = await evaluate("JSON.stringify({local: {...localStorage}, session: {...sessionStorage}})");
      ok("capabilities never persisted", !persisted.includes("fixture-capability"));
    });
    console.log(JSON.stringify({ passed: true, checks, browser: "installed Chromium-family browser via CDP", screenshots,
      scope: "Actual runtime component, actual TaskCard/Button and compiled app CSS; isolated synthetic API/Runner fixtures; no authenticated live page, Docker or hosted resources." }, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
