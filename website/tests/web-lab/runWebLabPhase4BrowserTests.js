#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS browser test loads scoped Web lab TypeScript. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const ts = require("typescript");

const sourceRoot = path.resolve(__dirname, "../../lib/web-lab");
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Only Web lab sources may be transpiled");
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const { planBeginnerEcommerceReflectedXssLab, planBeginnerEcommerceStoredXssLab, compileWebLab } = require(path.join(sourceRoot, "index.ts"));
const { renderEcommerceV1 } = require(path.join(sourceRoot, "templates/ecommerce-v1.ts"));
const { attestObservedWebLabEvent, evaluateWebLabResult } = require(path.join(sourceRoot, "grading.ts"));

let assertions = 0;
function check(label, actual, expected) { assert.deepEqual(actual, expected, label); assertions++; }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const chrome = require("./browserDiscovery").resolveBrowserExecutable();

async function browserMatrix() {
  const pages = new Map();
  const server = http.createServer((request, response) => {
    const html = pages.get(request.url.split("?")[0]);
    if (!html) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); response.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-web-phase4-"));
  const port = 15900 + process.pid % 1000;
  const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    let target;
    for (let n = 0; n < 60; n++) {
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === "page"); if (target?.webSocketDebuggerUrl) break; } catch { /* launching */ }
      await wait(100);
    }
    assert.ok(target?.webSocketDebuggerUrl, "browser launched"); assertions++;
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    const pending = new Map(), contexts = new Map(), consoleEvents = []; let nextId = 1;
    ws.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
      if (message.method === "Runtime.executionContextCreated") contexts.set(message.params.context.id, message.params.context);
      if (message.method === "Runtime.executionContextDestroyed") contexts.delete(message.params.executionContextId);
      if (message.method === "Runtime.executionContextsCleared") contexts.clear();
      if (message.method === "Runtime.consoleAPICalled") consoleEvents.push(message.params);
    });
    const send = (method, params = {}) => new Promise(resolve => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression, contextId) => {
      const response = await send("Runtime.evaluate", { expression, contextId, returnByValue: true, awaitPromise: true });
      if (response.error || response.result?.exceptionDetails) throw new Error(JSON.stringify(response.error || response.result.exceptionDetails));
      return response.result?.result?.value;
    };
    await send("Page.enable"); await send("Runtime.enable");
    async function ready(urlFragment) {
      for (let n = 0; n < 60; n++) {
        const context = [...contexts.values()].find(item => item.auxData?.isDefault);
        if (context) {
          try { if (await evaluate(`location.href.includes(${JSON.stringify(urlFragment)}) && document.readyState === 'complete' && !!document.getElementById('brand')?.textContent`, context.id)) return context.id; } catch { /* old context */ }
        }
        await wait(100);
      }
      throw new Error(`Lab did not boot: ${urlFragment}`);
    }
    async function navigate(name, html) {
      pages.set(`/${name}`, html);
      const result = await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/${name}` });
      if (result.error || result.result?.errorText) throw new Error(`Navigation failed: ${JSON.stringify(result.error || result.result.errorText)}`);
      return ready(name);
    }
    async function afterHash(hash, context) {
      await evaluate(`location.hash=${JSON.stringify(hash)}`, context);
      for (let n = 0; n < 30; n++) {
        if (await evaluate(`location.hash===${JSON.stringify(hash)} && !!document.getElementById('heading')?.textContent`, context)) { await wait(40); return; }
        await wait(30);
      }
      throw new Error(`Hash route did not load: ${hash}`);
    }
    const observed = marker => consoleEvents.some(event => event.args?.some(arg => arg.value === marker));
    const submitSearch = term => `(() => { const input=document.getElementById('catalog-search-input'); input.value=${JSON.stringify(term)}; document.getElementById('catalog-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); })()`;
    const submitReview = body => `(() => { const field=document.getElementById('product-review'); field.value=${JSON.stringify(body)}; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); })()`;
    const stateFingerprint = "JSON.stringify({hash:location.hash,heading:document.getElementById('heading').textContent,state:runtimeState,content:document.getElementById('content').textContent})";

    const seedIndices = [0, 6, 12, 18, 24];
    for (const [index, seedIndex] of seedIndices.entries()) {
      const spec = planBeginnerEcommerceReflectedXssLab(`phase4-browser-${String(seedIndex + 1).padStart(2, "0")}`);
      const name = `ecommerce-reflected-${index}`;
      let context = await navigate(name, compileWebLab(spec).html);
      const initial = await evaluate(stateFingerprint, context);
      check(`${name}: storefront heading`, await evaluate("document.getElementById('heading').textContent", context), "Everyday goods, thoughtfully chosen.");
      check(`${name}: catalogue cards exist`, await evaluate("document.querySelectorAll('.card').length >= 4", context), true);
      check(`${name}: no external or payment elements`, await evaluate("document.querySelectorAll('script[src],img[src^=http],form[action],iframe').length", context), 0);
      await evaluate(submitSearch(`notebook ${index}`), context); await wait(60);
      check(`${name}: normal search summary`, await evaluate("document.getElementById('catalog-summary').textContent", context), `Results for notebook ${index}`);
      const marker = `WEB_PHASE4_REFLECTED_${index}`;
      await evaluate(submitSearch(`<img src=x onerror="console.info('${marker}')">`), context); await wait(110);
      check(`${name}: intended catalogue sink creates element`, await evaluate("!!document.querySelector('#catalog-summary img')", context), true);
      check(`${name}: intended reflected signal observed`, observed(marker), true);
      const event = { labId: spec.labId, moduleId: "reflected-xss", eventType: spec.internalSolution.successCondition, route: spec.internalSolution.route, input: spec.internalSolution.input, sink: spec.internalSolution.sink, renderingContext: spec.internalSolution.renderingContext };
      check(`${name}: generic reflected grader passes`, evaluateWebLabResult(spec, [attestObservedWebLabEvent(event)]).status, "pass");
      await afterHash("#/products/detail?id=product-1", context);
      const safeMarker = `WEB_PHASE4_REFLECTED_REVIEW_SAFE_${index}`;
      await evaluate(submitReview(`<img src=x onerror="console.info('${safeMarker}')">`), context);
      await afterHash("#/catalog", context); await send("Page.reload", { ignoreCache: true }); context = await ready(name);
      await afterHash("#/products/detail?id=product-1", context);
      check(`${name}: stored review path remains encoded`, await evaluate("document.querySelector('.reviews img') === null", context), true);
      check(`${name}: stored review path does not execute`, observed(safeMarker), false);
      await afterHash("#/catalog?category=%3Cimg%20src%3Dx%3E", context);
      check(`${name}: unrelated category value inert`, await evaluate("document.querySelector('#catalog-summary img') === null", context), true);
      await evaluate("document.getElementById('reset').click()", context); context = await ready(name);
      check(`${name}: reflected reset canonical fingerprint`, await evaluate(stateFingerprint, context), initial);
    }

    for (const [index, seedIndex] of seedIndices.entries()) {
      const spec = planBeginnerEcommerceStoredXssLab(`phase4-browser-${String(seedIndex + 1).padStart(2, "0")}`);
      const name = `ecommerce-stored-${index}`, target = spec.vulnerability.storedFlow.targetObjectId;
      const productHash = `#/products/detail?id=${target}`;
      let context = await navigate(name, compileWebLab(spec).html);
      const initial = await evaluate("JSON.stringify(runtimeState)", context);
      await afterHash(productHash, context);
      check(`${name}: seeded review visible`, await evaluate("document.querySelectorAll('.review').length", context), 1);
      const normal = `Normal product review ${index}`;
      await evaluate(submitReview(normal), context);
      check(`${name}: review not immediately reflected`, await evaluate(`document.querySelector('.reviews').textContent.includes(${JSON.stringify(normal)})`, context), false);
      await afterHash("#/catalog", context); await send("Page.reload", { ignoreCache: true }); context = await ready(name);
      await afterHash(productHash, context);
      check(`${name}: normal review survives reload`, await evaluate(`document.querySelector('.reviews').textContent.includes(${JSON.stringify(normal)})`, context), true);
      check(`${name}: stored record targets real product`, await evaluate(`runtimeState.contentByObject[${JSON.stringify(target)}].at(-1).body`, context), normal);
      await evaluate("document.getElementById('reset').click()", context); context = await ready(name);
      check(`${name}: first reset restores canonical state`, await evaluate("JSON.stringify(runtimeState)", context), initial);
      await afterHash(productHash, context);
      const marker = `WEB_PHASE4_STORED_${index}`;
      const payload = `<img src=x onerror="console.info('${marker}')">`;
      await evaluate(submitReview(payload), context); await wait(30);
      check(`${name}: no immediate execution`, observed(marker), false);
      check(`${name}: no immediate injected element`, await evaluate("document.querySelector('.reviews img') === null", context), true);
      await afterHash("#/catalog", context); await send("Page.reload", { ignoreCache: true }); context = await ready(name);
      check(`${name}: no execution on unrelated page`, observed(marker), false);
      await afterHash(productHash, context); await wait(100);
      check(`${name}: stored review retrieved`, await evaluate(`runtimeState.contentByObject[${JSON.stringify(target)}].at(-1).body`, context), payload);
      check(`${name}: intended review sink creates element`, await evaluate("!!document.querySelector('.reviews img')", context), true);
      check(`${name}: harmless stored signal observed later`, observed(marker), true);
      const event = { labId: spec.labId, moduleId: "stored-xss", eventType: spec.internalSolution.successCondition, route: spec.internalSolution.route, input: spec.internalSolution.input, sink: spec.internalSolution.sink, renderingContext: spec.internalSolution.renderingContext, storedEvidence: { ...spec.vulnerability.storedFlow, instanceId: name, storedBeforeRender: true } };
      check(`${name}: generic stored grader passes`, evaluateWebLabResult(spec, [attestObservedWebLabEvent(event)], name).status, "pass");
      const safeMarker = `WEB_PHASE4_STORED_SEARCH_SAFE_${index}`;
      await evaluate(submitSearch(`<img src=x onerror="console.info('${safeMarker}')">`), context); await wait(70);
      check(`${name}: unrelated search encoded`, await evaluate("document.querySelector('#catalog-summary img') === null", context), true);
      check(`${name}: unrelated search does not execute`, observed(safeMarker), false);
      await afterHash("#/products/detail?id=product-2", context);
      check(`${name}: unrelated product has no review form`, await evaluate("document.querySelector('#product-review') === null", context), true);
      check(`${name}: unrelated product review safe`, await evaluate("document.querySelector('.reviews img') === null", context), true);
      await evaluate("document.getElementById('reset').click()", context); context = await ready(name);
      check(`${name}: final reset restores canonical state`, await evaluate("JSON.stringify(runtimeState)", context), initial);
    }

    const baseline = planBeginnerEcommerceStoredXssLab("phase4-safe-template");
    const publicData = { labId: baseline.labId, application: baseline.application, users: baseline.users, session: baseline.session, categories: baseline.categories, products: baseline.products, routes: baseline.routes };
    let context = await navigate("ecommerce-safe-baseline", renderEcommerceV1(publicData));
    const safeSearchMarker = "WEB_PHASE4_SAFE_BASE_SEARCH", safeReviewMarker = "WEB_PHASE4_SAFE_BASE_REVIEW";
    await evaluate(submitSearch(`<img src=x onerror="console.info('${safeSearchMarker}')">`), context); await wait(70);
    check("safe ecommerce search encoded", await evaluate("document.querySelector('#catalog-summary img') === null", context), true);
    check("safe ecommerce search does not execute", observed(safeSearchMarker), false);
    await afterHash("#/products/detail?id=product-1", context);
    await evaluate(submitReview(`<img src=x onerror="console.info('${safeReviewMarker}')">`), context);
    await afterHash("#/catalog", context); await send("Page.reload", { ignoreCache: true }); context = await ready("ecommerce-safe-baseline");
    await afterHash("#/products/detail?id=product-1", context);
    check("safe ecommerce stored review encoded", await evaluate("document.querySelector('.reviews img') === null", context), true);
    check("safe ecommerce review literal text visible", await evaluate("document.querySelector('.reviews').textContent.includes('<img')", context), true);
    check("safe ecommerce review does not execute", observed(safeReviewMarker), false);
    await afterHash("#/products/detail?id=missing", context);
    check("missing product has coherent empty state", await evaluate("document.getElementById('heading').textContent", context), "Product not found");

    const hostile = structuredClone(planBeginnerEcommerceStoredXssLab("phase4-hostile-fixture"));
    const hostileMarker = "WEB_PHASE4_SEEDED_SAFE", hostileText = `<img src=x onerror="console.info('${hostileMarker}')">`;
    hostile.users[0].name += hostileText; hostile.categories[0].name += hostileText; hostile.products[0].name += hostileText; hostile.products[0].description += hostileText; hostile.products[0].reviews[0].body += hostileText;
    context = await navigate("ecommerce-hostile-fixture", compileWebLab(hostile).html);
    await afterHash("#/products/detail?id=product-1", context);
    check("seeded identity/category/product/review stay text", await evaluate("document.querySelectorAll('img').length", context), 0);
    check("seeded content cannot execute", observed(hostileMarker), false);
    return { reflected: seedIndices.length, stored: seedIndices.length };
  } finally {
    if (ws) ws.close();
    child.kill();
    server.close();
    await wait(400);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

browserMatrix().then(cases => console.log(`Web lab Phase 4 browser: ${assertions} assertions passed; ${cases.reflected} sequential ecommerce reflected and ${cases.stored} sequential ecommerce stored cases plus safe baseline`)).catch(error => { console.error(error); process.exitCode = 1; });
