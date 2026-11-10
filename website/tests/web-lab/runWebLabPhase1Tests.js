#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Existing offline test convention uses CommonJS and a local TS transpile hook. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const sourceRoot = path.join(root, "lib", "web-lab");
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Test transpiler may only load Web lab sources");
  const source = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  module._compile(result.outputText, filename);
};
const { planBeginnerHelpdeskLab, compileWebLab, validateWebLabSpec } = require(path.join(sourceRoot, "index.ts"));
const { reflectedXssV1 } = require(path.join(sourceRoot, "vulnerabilities", "reflected-xss-v1.ts"));

let checks = 0;
function check(message, actual, expected) { assert.deepEqual(actual, expected, message); checks += 1; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const seeds = ["phase1-alpha", "phase1-beta", "phase1-gamma", "phase1-delta", "phase1-epsilon"];
const fixtures = seeds.map(seed => planBeginnerHelpdeskLab(seed));
for (const [index, spec] of fixtures.entries()) {
  check(`${seeds[index]} deterministic spec`, spec, planBeginnerHelpdeskLab(seeds[index]));
  check(`${seeds[index]} schema and contracts`, validateWebLabSpec(spec, reflectedXssV1), []);
  const compiled = compileWebLab(spec);
  check(`${seeds[index]} deterministic HTML`, compiled.html, compileWebLab(planBeginnerHelpdeskLab(seeds[index])).html);
  check(`${seeds[index]} sandbox contract`, compiled.isolation, { iframeSandbox: "allow-scripts", opaqueOriginRequired: true, networkAccess: "subresources-blocked-by-CSP" });
  check(`${seeds[index]} no internal solution tag in runtime`, compiled.html.includes(spec.internalSolution.groundTruthTag), false);
  check(`${seeds[index]} no learner objective in target app`, compiled.html.includes(spec.learner.objective), false);
}
check("seeds vary company/content", new Set(fixtures.map(spec => JSON.stringify([spec.application, spec.articles, spec.tickets]))).size, seeds.length);
const badOwner = structuredClone(fixtures[0]); badOwner.tickets[0].ownerId = "missing";
check("broken owner rejected", validateWebLabSpec(badOwner, reflectedXssV1).some(issue => issue.includes("ownership")), true);
const badTask = structuredClone(fixtures[0]); badTask.learner.targetInput = "other";
check("task mismatch rejected", validateWebLabSpec(badTask, reflectedXssV1).some(issue => issue.includes("task")), true);
const badRoute = structuredClone(fixtures[0]); badRoute.routes.pop();
check("broken route rejected", validateWebLabSpec(badRoute, reflectedXssV1).some(issue => issue.includes("routes")), true);
const executable = structuredClone(fixtures[0]); executable.application.eval = () => 1;
check("executable spec rejected", validateWebLabSpec(executable, reflectedXssV1).length > 0, true);
const wrongVersion = structuredClone(fixtures[0]); wrongVersion.templateVersion = "2.0.0";
check("unknown template version rejected", validateWebLabSpec(wrongVersion, reflectedXssV1).length > 0, true);
const hostileContent = structuredClone(fixtures[0]);
hostileContent.articles[0].body = '</script><script>window.__unexpected_execution=true</script>';
const hostileHtml = compileWebLab(hostileContent).html;
check("fixture content cannot break out of JSON script", hostileHtml.includes('<script>window.__unexpected_execution'), false);
check("only reviewed module owns an HTML sink", (hostileHtml.match(/\.innerHTML\s*=/g) || []).length, 1);

const chrome = require("./browserDiscovery").resolveBrowserExecutable();

async function runtimeTest() {
  const compiled = compileWebLab(fixtures[0]);
  const escaped = compiled.html.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const parent = `<!doctype html><title>Isolated lab harness</title><iframe id="lab" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escaped}" style="width:900px;height:700px"></iframe>`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-web-lab-"));
  const harnessPath = path.join(profile, "harness.html");
  fs.writeFileSync(harnessPath, parent, "utf8");
  const labPath = path.join(profile, "lab.html");
  fs.writeFileSync(labPath, compiled.html, "utf8");
  const port = 12900 + process.pid % 1000;
  const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    let target;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await response.json();
        target = list.find(item => item.type === "page");
        if (target?.webSocketDebuggerUrl) break;
      } catch { /* browser still starting */ }
      await wait(100);
    }
    assert.ok(target?.webSocketDebuggerUrl, "browser debugger started"); checks += 1;
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    const pending = new Map(); const contexts = new Map(); const consoleEvents = []; let nextId = 1;
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
    const navigation = await send("Page.navigate", { url: pathToFileURL(harnessPath).href });
    if (navigation.error || navigation.result?.errorText) throw new Error(`Browser navigation failed: ${JSON.stringify(navigation.error || navigation.result.errorText)}`);
    await wait(300);
    const parentContext = [...contexts.values()].find(context => context.auxData?.isDefault);
    assert.ok(parentContext, "sandbox parent context started"); checks += 1;
    check("sandboxed frame exists", await evaluate("window.frames.length", parentContext.id), 1);
    check("opaque origin blocks parent DOM access", await evaluate("(() => { try { return !!document.getElementById('lab').contentWindow.document.body; } catch (error) { return error.name === 'SecurityError'; } })()", parentContext.id), true);
    await send("Page.navigate", { url: pathToFileURL(labPath).href });
    let runtimeContext;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      runtimeContext = [...contexts.values()].find(context => context.auxData?.isDefault);
      if (runtimeContext) {
        try {
          if (await evaluate("document.readyState === 'complete' && !!document.getElementById('brand')", runtimeContext.id)) break;
        } catch { /* old context was replaced during navigation */ }
      }
      await wait(100);
    }
    assert.ok(runtimeContext, "lab runtime context started"); checks += 1;
    const stateFingerprint = "JSON.stringify({hash:location.hash,heading:document.getElementById('heading').textContent,input:document.getElementById('search-input').value,summary:document.getElementById('search-summary').innerHTML,content:document.getElementById('content').innerHTML})";
    const initialState = await evaluate(stateFingerprint, runtimeContext.id);
    check("helpdesk boots", await evaluate("document.getElementById('heading').textContent", runtimeContext.id), "How can we help?");
    check("normal content renders", await evaluate("document.querySelectorAll('.card').length", runtimeContext.id), 3);
    check("no learner-controlled completion callback", await evaluate("typeof window.__webLabTrainingHit", runtimeContext.id), "undefined");
    const submit = term => `(() => { const input=document.getElementById('search-input'); input.value=${JSON.stringify(term)}; document.getElementById('search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return location.hash; })()`;
    await evaluate(submit("password"), runtimeContext.id); await wait(100);
    check("normal search route", await evaluate("location.hash.startsWith('#/search?q=password')", runtimeContext.id), true);
    check("normal search summary", await evaluate("document.getElementById('search-summary').textContent", runtimeContext.id), "Results for password");
    check("normal search emits no test event", consoleEvents.some(event => event.args?.some(arg => arg.value === "WEB_LAB_TEST_EVENT")), false);
    await evaluate(submit('<img src=x onerror="console.info(\'WEB_LAB_TEST_EVENT\')">'), runtimeContext.id); await wait(150);
    check("controlled input reaches intended sink", await evaluate("!!document.querySelector('#search-summary img')", runtimeContext.id), true);
    check("benign script event observed by browser debugger", consoleEvents.some(event => event.args?.some(arg => arg.value === "WEB_LAB_TEST_EVENT")), true);
    await evaluate("document.getElementById('reset').click()", runtimeContext.id); await wait(100);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      runtimeContext = [...contexts.values()].find(context => context.auxData?.isDefault);
      if (runtimeContext) {
        try { if (await evaluate("document.readyState === 'complete' && document.getElementById('heading')?.textContent === 'How can we help?'", runtimeContext.id)) break; } catch { /* reload in progress */ }
      }
      await wait(100);
    }
    check("reset returns home", await evaluate("document.getElementById('heading').textContent", runtimeContext.id), "How can we help?");
    check("reset restores exact initial application state", await evaluate(stateFingerprint, runtimeContext.id), initialState);
    check("reset clears query", await evaluate("document.getElementById('search-input').value", runtimeContext.id), "");
    await evaluate("location.hash='/articles'", runtimeContext.id); await wait(100);
    check("article navigation works", await evaluate("document.getElementById('heading').textContent", runtimeContext.id), "Support articles");
    await evaluate("location.hash='/missing'", runtimeContext.id); await wait(100);
    check("not-found route works", await evaluate("document.getElementById('heading').textContent", runtimeContext.id), "Page not found");
  } finally {
    if (ws) ws.close();
    child.kill();
    await wait(400);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

runtimeTest().then(() => console.log(`Web lab Phase 1: ${checks} assertions passed`)).catch(error => { console.error(error); process.exitCode = 1; });
