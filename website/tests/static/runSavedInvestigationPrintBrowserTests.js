#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((candidate) => fs.existsSync(candidate));
if (!chrome) throw new Error("Chrome is unavailable; rendered saved-page print verification is BLOCKED.");

const cssSource = fs.readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
const printMarker = "/* Saved-investigation printing must escape the fixed authenticated workspace.";
const markerIndex = cssSource.indexOf(printMarker);
assert.ok(markerIndex >= 0, "saved-investigation print contract is missing");
const printCss = cssSource.slice(markerIndex);
const savedSource = fs.readFileSync(path.join(ROOT, "app", "dashboard", "saved", "[id]", "page.tsx"), "utf8");
const componentStart = savedSource.indexOf("function SavedInvestigationPrintDocument");
const componentEnd = savedSource.indexOf("function InvestigationOverview", componentStart);
const printComponent = savedSource.slice(componentStart, componentEnd);
assert.match(printComponent, /tasks\.map\(\(task, index\) =>/);
assert.match(printComponent, /assets\.map\(\(asset\) =>/);
assert.doesNotMatch(printComponent, /lab\.hints\.map/);
assert.match(printComponent, /data-saved-investigation-print-inventory-item/);
assert.match(printCss, /\[data-authenticated-shell\][\s\S]*position:\s*static\s*!important/);
assert.match(printCss, /\[data-authenticated-main-region\][\s\S]*overflow:\s*visible\s*!important/);

const taskFixtures = Array.from({ length: 6 }, (_, index) => ({
  heading: `Task ${index + 1}: ${[
    "Establish the review window",
    "Correlate identity and authentication",
    "Compare command and process provenance",
    "Assess approval without inventing a decision",
    "Evaluate telemetry limits and competing explanations",
    "Write the final bounded finding and evidence-supported next step",
  ][index]}`,
  body: `UNIQUE-FINAL-BODY-${index + 1} `.repeat(index === 5 ? 85 : 38),
}));
const inventory = Array.from({ length: 34 }, (_, index) =>
  `assets/evidence/very-long-investigation-directory-${index + 1}/source-with-a-long-unbroken-segment-${"evidence".repeat(5)}-${index + 1}.txt`
);
const longTitle = "Advanced Linux investigation with an exceptionally long saved title that must wrap safely across the printable page without clipping or horizontal overflow";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

const taskHtml = taskFixtures.map((task, index) => `
  <li data-saved-investigation-print-task="${index + 1}">
    <h3>${escapeHtml(task.heading)}</h3>
    <p>${escapeHtml(task.body)}</p>
    <p><strong>Evidence:</strong> ${escapeHtml(inventory[index])}</p>
  </li>`).join("");
const inventoryHtml = inventory.map((item) =>
  `<li data-saved-investigation-print-inventory-item>${escapeHtml(item)}</li>`
).join("");

const documentHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; font: 14px/1.45 Arial, sans-serif; }
[data-authenticated-shell] { position: fixed; inset: 0; display: flex; height: 100vh; overflow: hidden; background: #071426; }
[data-authenticated-global-stack] { position: sticky; top: 0; height: 54px; }
[data-authenticated-workspace] { display: flex; flex: 1; min-height: 0; overflow: hidden; }
[data-authenticated-sidebar] { width: 240px; flex: 0 0 240px; }
[data-authenticated-main-region] { flex: 1; min-height: 0; overflow-y: auto; overflow-x: clip; }
[data-authenticated-content-frame] { width: 100%; max-width: 1440px; min-height: 100%; margin: 0 auto; padding: 20px; }
[data-saved-investigation-screen] { display: block; }
[data-saved-investigation-print="complete"] { display: none; }
[data-saved-investigation-print="complete"] { color: #071426; padding: 28px 34px; }
[data-saved-investigation-print="complete"] h1 { font-size: 30px; line-height: 1.15; margin: 0 0 16px; }
[data-saved-investigation-print="complete"] h2 { font-size: 21px; margin: 24px 0 10px; }
[data-saved-investigation-print="complete"] h3 { font-size: 16px; margin: 0 0 7px; }
[data-saved-investigation-print="complete"] p { margin: 0 0 8px; }
[data-saved-investigation-print-task-list], [data-saved-investigation-print-inventory] ul { padding-left: 24px; }
[data-saved-investigation-print-task] { border-top: 1px solid #9aa6b2; padding-top: 12px; margin-top: 14px; }
${printCss}
</style></head><body>
<main data-authenticated-shell>
  <div data-authenticated-global-stack>Authenticated global controls</div>
  <div data-authenticated-workspace>
    <aside data-authenticated-sidebar>Sidebar navigation</aside>
    <section data-authenticated-main-region>
      <div data-authenticated-content-frame>
        <header data-authenticated-app-header>Interactive saved-investigation header</header>
        <div data-saved-investigation-screen>SCREEN-SAVED-WORKSPACE <button onclick="window.__mutations += 1">Grade answer</button></div>
        <article data-saved-investigation-print="complete" data-saved-investigation-print-task-count="${taskFixtures.length}">
          <header><p>Amniora saved investigation</p><h1 data-saved-investigation-print-title>${escapeHtml(longTitle)}</h1></header>
          <section><h2>Objective</h2><p>Use only the supplied task evidence to produce bounded findings.</p></section>
          <section><h2>Scenario</h2><p>${escapeHtml("Multi-page authenticated saved investigation. ".repeat(18))}</p></section>
          <section><h2>Investigation tasks (${taskFixtures.length})</h2><ol data-saved-investigation-print-task-list>${taskHtml}</ol></section>
          <section data-saved-investigation-print-inventory><h2>Evidence inventory (${inventory.length})</h2><ul>${inventoryHtml}</ul></section>
        </article>
      </div>
    </section>
  </div>
</main><script>window.__mutations = 0;</script></body></html>`;

let commandId = 1;
let assertionCount = 8;
const outputs = [];
function ok(name, condition, detail = "") {
  assertionCount += 1;
  assert.ok(condition, `${name}${detail ? `: ${detail}` : ""}`);
  console.log(`PASS ${name}`);
}
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function runAtWidth(width, outputRoot) {
  const port = 11600 + Math.floor(Math.random() * 1500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `amniora-print-chrome-${width}-`));
  const browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { await fetchJson(`http://127.0.0.1:${port}/json/version`); ready = true; break; }
      catch { await wait(100); }
    }
    ok(`${width}px Chrome launched`, ready);
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find((target) => target.type === "page") || targets[0];
    ok(`${width}px page target exists`, Boolean(page?.webSocketDebuggerUrl));
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const resolve = pending.get(message.id);
      if (resolve) { pending.delete(message.id); resolve(message); }
    });
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = commandId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (response.error || response.result?.exceptionDetails) throw new Error(JSON.stringify(response));
      return response.result.result.value;
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height: 820, deviceScaleFactor: 1, mobile: width < 768 });
    await send("Page.setDocumentContent", { frameId: (await send("Page.getFrameTree")).result.frameTree.frame.id, html: documentHtml });
    await send("Emulation.setEmulatedMedia", { media: "screen" });
    const screen = await evaluate(`(() => {
      const shell = document.querySelector('[data-authenticated-shell]');
      const main = document.querySelector('[data-authenticated-main-region]');
      const printable = document.querySelector('[data-saved-investigation-print="complete"]');
      return { shellPosition: getComputedStyle(shell).position, shellOverflow: getComputedStyle(shell).overflow,
        mainOverflowY: getComputedStyle(main).overflowY, printDisplay: getComputedStyle(printable).display,
        screenVisible: getComputedStyle(document.querySelector('[data-saved-investigation-screen]')).display !== 'none', mutations: window.__mutations };
    })()`);
    ok(`${width}px screen shell remains fixed`, screen.shellPosition === "fixed", JSON.stringify(screen));
    ok(`${width}px screen shell remains clipped`, screen.shellOverflow === "hidden", JSON.stringify(screen));
    ok(`${width}px screen main retains scroll ownership`, ["auto", "scroll"].includes(screen.mainOverflowY), JSON.stringify(screen));
    ok(`${width}px print document remains hidden on screen`, screen.printDisplay === "none" && screen.screenVisible, JSON.stringify(screen));

    await send("Emulation.setEmulatedMedia", { media: "print" });
    const printed = await evaluate(`(() => {
      const shell = document.querySelector('[data-authenticated-shell]');
      const main = document.querySelector('[data-authenticated-main-region]');
      const printable = document.querySelector('[data-saved-investigation-print="complete"]');
      const tasks = [...document.querySelectorAll('[data-saved-investigation-print-task]')];
      const inventory = [...document.querySelectorAll('[data-saved-investigation-print-inventory-item]')];
      const title = document.querySelector('[data-saved-investigation-print-title]');
      const uniqueTaskText = new Set(tasks.map((node) => node.textContent.trim()));
      const rightBound = document.documentElement.scrollWidth + 1;
      return {
        shellPosition: getComputedStyle(shell).position, shellOverflow: getComputedStyle(shell).overflow,
        mainPosition: getComputedStyle(main).position, mainOverflow: getComputedStyle(main).overflow,
        printDisplay: getComputedStyle(printable).display, taskCount: tasks.length, uniqueTaskCount: uniqueTaskText.size,
        inventoryCount: inventory.length, finalBody: tasks.at(-1)?.textContent || '', titleText: title?.textContent || '',
        titleWithinBounds: title.getBoundingClientRect().left >= 0 && title.getBoundingClientRect().right <= rightBound,
        allItemsWithinBounds: [...tasks, ...inventory].every((node) => node.getBoundingClientRect().right <= rightBound),
        documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight,
        controlsHidden: getComputedStyle(document.querySelector('[data-authenticated-app-header]')).display === 'none' && getComputedStyle(document.querySelector('[data-authenticated-sidebar]')).display === 'none' && getComputedStyle(document.querySelector('[data-saved-investigation-screen]')).display === 'none',
        hintPrinted: printable.textContent.includes('OPTIONAL-HINT-SHOULD-NOT-PRINT'), mutations: window.__mutations,
        text: printable.innerText,
      };
    })()`);
    ok(`${width}px print shell enters normal flow`, printed.shellPosition === "static" && printed.mainPosition === "static", JSON.stringify(printed));
    ok(`${width}px print ancestors allow pagination`, printed.shellOverflow === "visible" && printed.mainOverflow === "visible", JSON.stringify(printed));
    ok(`${width}px all tasks render exactly once`, printed.taskCount === taskFixtures.length && printed.uniqueTaskCount === taskFixtures.length, JSON.stringify(printed));
    ok(`${width}px final task body survives`, printed.finalBody.includes("UNIQUE-FINAL-BODY-6"), printed.finalBody.slice(0, 120));
    ok(`${width}px complete inventory survives`, printed.inventoryCount === inventory.length && inventory.every((entry) => printed.text.includes(entry)), JSON.stringify(printed));
    ok(`${width}px long title wraps within bounds`, printed.titleText === longTitle && printed.titleWithinBounds, JSON.stringify(printed));
    ok(`${width}px long paths stay within bounds`, printed.allItemsWithinBounds, JSON.stringify(printed));
    ok(`${width}px content exceeds viewport without truncation`, printed.documentHeight > printed.viewportHeight + 500, JSON.stringify(printed));
    ok(`${width}px navigation and controls are excluded`, printed.controlsHidden, JSON.stringify(printed));
    ok(`${width}px print performs no mutation`, printed.mutations === 0 && !printed.hintPrinted, JSON.stringify(printed));

    const pdf = await send("Page.printToPDF", {
      printBackground: true, paperWidth: 8.27, paperHeight: 11.69,
      marginTop: 0.42, marginBottom: 0.42, marginLeft: 0.42, marginRight: 0.42,
      preferCSSPageSize: false,
    });
    const pdfBuffer = Buffer.from(pdf.result.data, "base64");
    const pageCount = (pdfBuffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
    ok(`${width}px browser PDF is multi-page`, pdfBuffer.length > 20_000 && pageCount >= 3, `bytes=${pdfBuffer.length} pages=${pageCount}`);
    const pdfPath = path.join(outputRoot, `saved-investigation-${width}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);
    const metrics = await send("Page.getLayoutMetrics");
    const size = metrics.result.cssContentSize || metrics.result.contentSize;
    const image = await send("Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 },
    });
    const screenshotPath = path.join(outputRoot, `saved-investigation-${width}-print-media.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(image.result.data, "base64"));
    outputs.push({ width, pdfPath, screenshotPath, pageCount, bytes: pdfBuffer.length });
    socket.close();
  } finally {
    browser.kill();
    await wait(250);
  }
}

(async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-saved-print-"));
  await runAtWidth(1440, outputRoot);
  await runAtWidth(390, outputRoot);
  console.log(JSON.stringify({ passed: true, browser: "Google Chrome", assertionCount, outputRoot, expectedTasks: taskFixtures.length, expectedInventory: inventory.length, outputs }, null, 2));
})().catch((error) => { console.error(error); process.exit(1); });
