#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS test uses a scoped TypeScript transpile hook. */
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
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Only Web lab sources may be transpiled");
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const { planBeginnerHelpdeskLab, compileWebLab, validateWebLabSpec } = require(path.join(sourceRoot, "index.ts"));
const { reflectedXssV1 } = require(path.join(sourceRoot, "vulnerabilities", "reflected-xss-v1.ts"));
const { renderHelpdeskV1 } = require(path.join(sourceRoot, "templates", "helpdesk-v1.ts"));
const { canonicalSpecBytes, sha256 } = require(path.join(sourceRoot, "manifest.ts"));
const { attestObservedWebLabEvent, evaluateWebLabResult } = require(path.join(sourceRoot, "grading.ts"));

let assertions = 0;
function check(label, actual, expected) { assert.deepEqual(actual, expected, label); assertions += 1; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clone(spec) { return structuredClone(spec); }
function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).reverse().map(key => [key, reverseObjectKeys(value[key])]));
  return value;
}
function invalid(label, spec, module = reflectedXssV1) {
  const issues = validateWebLabSpec(spec, module);
  assert.ok(issues.length, `${label}: malformed spec was accepted`); assertions += 1;
  if (module === reflectedXssV1) { assert.throws(() => compileWebLab(spec), /validation failed/); assertions += 1; }
}

const seeds = Array.from({ length: 25 }, (_, index) => `phase2-seed-${String(index + 1).padStart(2, "0")}`);
const cases = seeds.map(planBeginnerHelpdeskLab);
for (const [index, seed] of seeds.entries()) {
  const spec = cases[index];
  check(`${seed}: valid contract`, validateWebLabSpec(spec, reflectedXssV1), []);
  const first = compileWebLab(spec);
  for (let repeat = 0; repeat < 3; repeat += 1) {
    const repeatedSpec = planBeginnerHelpdeskLab(seed);
    const repeated = compileWebLab(repeatedSpec);
    check(`${seed}: byte-identical canonical spec ${repeat}`, canonicalSpecBytes(repeatedSpec), canonicalSpecBytes(spec));
    check(`${seed}: byte-identical bundle ${repeat}`, repeated.html, first.html);
    check(`${seed}: identical manifest ${repeat}`, repeated.manifest, first.manifest);
  }
  check(`${seed}: spec hash`, first.manifest.canonicalSpecSha256, sha256(canonicalSpecBytes(spec)));
  check(`${seed}: bundle hash`, first.manifest.learnerBundleSha256, sha256(first.html));
  check(`${seed}: manifest identity`, [first.manifest.schemaVersion, first.manifest.templateId, first.manifest.templateVersion, first.manifest.vulnerabilityId, first.manifest.vulnerabilityVersion, first.manifest.seed, first.manifest.difficulty, first.manifest.durationMinutes], [1, "helpdesk", "1.0.0", "reflected-xss", "1.0.0", seed, "Beginner", 30]);
  check(`${seed}: solution sentinel absent from bundle`, first.html.includes(spec.internalSolution.groundTruthTag), false);
  check(`${seed}: no serialized solution`, /internalSolution|groundTruthTag|internal-web-|__webLabTrainingHit|WEB_PHASE2_EVENT/.test(first.html), false);
  check(`${seed}: no hidden implementation metadata`, /reflected-xss|search-summary-html|trusted-runtime-event|canonicalSpecSha256/.test(first.html), false);
  check(`${seed}: no external service dependency`, /https?:\/\/|\/api\/|supabase|openai|<script[^>]+src=|\bfetch\s*\(|\bWebSocket\s*\(/i.test(first.html), false);
  check(`${seed}: only one HTML assignment`, (first.html.match(/\.innerHTML\s*=/g) || []).length, 1);
  check(`${seed}: future runtime requirements not claimed active`, first.runtimeRequirements.implementationStatus, "required-for-production-not-implemented");
}
const contextSignatures = new Set(cases.map(spec => JSON.stringify({ articles: spec.articles.map(item => item.title), tickets: spec.tickets.map(item => [item.subject, item.status]), names: spec.users.map(user => user.name) })));
check("25 seeds vary content/order/status beyond company naming", contextSignatures.size >= 15, true);
check("25 seeds retain one security truth", new Set(cases.map(spec => JSON.stringify([spec.vulnerability, spec.learner.targetRoute, spec.learner.targetInput, spec.learner.targetSink, spec.learner.successCondition]))).size, 1);

const baseline = cases[0];
const reordered = reverseObjectKeys(baseline);
check("key insertion order does not change canonical spec bytes", canonicalSpecBytes(reordered), canonicalSpecBytes(baseline));
check("key insertion order does not change learner bundle", compileWebLab(reordered).html, compileWebLab(baseline).html);
const wrongTemplate = clone(baseline); wrongTemplate.templateVersion = "9.0.0"; invalid("unknown template version", wrongTemplate);
const wrongModule = clone(baseline); wrongModule.vulnerability.moduleVersion = "9.0.0"; invalid("unknown vulnerability version", wrongModule);
invalid("incompatible template/module", baseline, { ...reflectedXssV1, requiredCapability: "nonexistent-capability" });
const missingSearch = clone(baseline); missingSearch.routes = missingSearch.routes.filter(route => route.path !== "/search"); invalid("missing vulnerable route", missingSearch);
const missingUser = clone(baseline); missingUser.users = missingUser.users.filter(user => user.id !== "user-1"); invalid("missing referenced user", missingUser);
const badTicket = clone(baseline); badTicket.tickets[0].ownerId = "user-missing"; invalid("missing referenced object owner", badTicket);
const wrongTaskRoute = clone(baseline); wrongTaskRoute.learner.targetRoute = "/requests"; invalid("wrong task route", wrongTaskRoute);
const wrongTaskInput = clone(baseline); wrongTaskInput.learner.targetInput = "query"; invalid("wrong task input", wrongTaskInput);
const wrongTaskSink = clone(baseline); wrongTaskSink.learner.targetSink = "ticket-title"; invalid("wrong task sink", wrongTaskSink);
const storedClaim = clone(baseline); storedClaim.learner.claimedBehavior = "stored"; invalid("stored behavior claim", storedClaim);
const storedProse = clone(baseline); storedProse.learner.objective = "Demonstrate stored script execution from a ticket."; invalid("stored behavior prose", storedProse);
const wrongSuccess = clone(baseline); wrongSuccess.learner.successCondition.eventType = "ticket-created"; invalid("unsupported success event", wrongSuccess);
const wrongSolution = clone(baseline); wrongSolution.internalSolution.route = "/requests"; invalid("solution route mismatch", wrongSolution);
const wrongReset = clone(baseline); wrongReset.resetState.route = "/absent"; invalid("reset route mismatch", wrongReset);
const badSeed = clone(baseline); badSeed.seed = "contains spaces"; invalid("invalid seed representation", badSeed);
const executable = clone(baseline); executable.application.code = () => 1; invalid("executable spec field", executable);

const expectedEvent = spec => ({
  labId: spec.labId,
  moduleId: spec.vulnerability.moduleId,
  eventType: spec.internalSolution.successCondition,
  route: spec.internalSolution.route,
  input: spec.internalSolution.input,
  sink: spec.internalSolution.sink,
  renderingContext: spec.internalSolution.renderingContext,
});
check("normal interaction does not grade", evaluateWebLabResult(baseline, []).status, "not-complete");
check("learner completed flag does not grade", evaluateWebLabResult(baseline, [{ completed: true }]).status, "not-complete");
check("forged event object does not grade", evaluateWebLabResult(baseline, [expectedEvent(baseline)]).status, "not-complete");
check("attested intended event grades", evaluateWebLabResult(baseline, [attestObservedWebLabEvent(expectedEvent(baseline))]).status, "pass");
check("wrong route does not grade", evaluateWebLabResult(baseline, [attestObservedWebLabEvent({ ...expectedEvent(baseline), route: "/requests" })]).status, "not-complete");
check("wrong input does not grade", evaluateWebLabResult(baseline, [attestObservedWebLabEvent({ ...expectedEvent(baseline), input: "other" })]).status, "not-complete");
check("wrong sink does not grade", evaluateWebLabResult(baseline, [attestObservedWebLabEvent({ ...expectedEvent(baseline), sink: "ticket-title" })]).status, "not-complete");
check("wrong lab does not grade", evaluateWebLabResult(baseline, [attestObservedWebLabEvent({ ...expectedEvent(baseline), labId: "another-lab" })]).status, "not-complete");

const chrome = require("./browserDiscovery").resolveBrowserExecutable();

async function browserMatrix() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-web-phase2-"));
  const port = 13900 + process.pid % 1000;
  const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    let target;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === "page"); if (target?.webSocketDebuggerUrl) break; } catch { /* launching */ }
      await wait(100);
    }
    assert.ok(target?.webSocketDebuggerUrl, "browser launched"); assertions += 1;
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
    const navigate = async (name, html) => {
      const file = path.join(profile, name);
      fs.writeFileSync(file, html, "utf8");
      const response = await send("Page.navigate", { url: pathToFileURL(file).href });
      if (response.error || response.result?.errorText) throw new Error(`Browser navigation failed: ${JSON.stringify(response.error || response.result.errorText)}`);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const context = [...contexts.values()].find(item => item.auxData?.isDefault);
        if (context) {
          try {
            if (await evaluate(`location.href.includes(${JSON.stringify(name)}) && document.readyState === 'complete' && !!document.getElementById('brand')?.textContent`, context.id)) return context;
          } catch { /* old page context */ }
        }
        await wait(100);
      }
      throw new Error(`Lab did not boot: ${name}`);
    };
    const submit = term => `(() => { const input=document.getElementById('search-input'); input.value=${JSON.stringify(term)}; document.getElementById('search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); })()`;
    const fingerprint = "JSON.stringify({hash:location.hash,heading:document.getElementById('heading').textContent,identity:document.getElementById('identity').textContent,input:document.getElementById('search-input').value,summary:document.getElementById('search-summary').innerHTML,content:document.getElementById('content').innerHTML})";
    const observed = marker => consoleEvents.some(event => event.args?.some(arg => arg.value === marker));
    const browserSeeds = [cases[0], cases[6], cases[12], cases[18], cases[24]];
    for (const [index, spec] of browserSeeds.entries()) {
      const compiled = compileWebLab(spec);
      let context = await navigate(`vulnerable-${index}.html`, compiled.html);
      const initialState = await evaluate(fingerprint, context.id);
      check(`browser ${index}: normal app boot`, await evaluate("document.getElementById('heading').textContent", context.id), "How can we help?");
      check(`browser ${index}: no external resources`, await evaluate("document.querySelectorAll('script[src],link[href^=http],img[src^=http]').length", context.id), 0);
      const quietMarker = `NORMAL_${index}`;
      await evaluate(submit(`ordinary ${quietMarker}`), context.id); await wait(60);
      check(`browser ${index}: normal summary`, await evaluate("document.getElementById('search-summary').textContent", context.id), `Results for ordinary ${quietMarker}`);
      check(`browser ${index}: normal input not executable`, observed(quietMarker), false);
      const marker = `WEB_PHASE2_EVENT_${index}`;
      await evaluate(submit(`<img src=x onerror="console.info('${marker}')">`), context.id); await wait(120);
      check(`browser ${index}: intended sink receives input`, await evaluate("!!document.querySelector('#search-summary img')", context.id), true);
      check(`browser ${index}: benign execution independently observed`, observed(marker), true);
      check(`browser ${index}: attested event passes grading contract`, evaluateWebLabResult(spec, [attestObservedWebLabEvent(expectedEvent(spec))]).status, "pass");
      await evaluate("document.getElementById('reset').click()", context.id);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        context = [...contexts.values()].find(item => item.auxData?.isDefault);
        if (context) {
          try { if (await evaluate("document.readyState === 'complete' && document.getElementById('heading')?.textContent === 'How can we help?'", context.id)) break; } catch { /* reload */ }
        }
        await wait(80);
      }
      check(`browser ${index}: canonical reset fingerprint`, await evaluate(fingerprint, context.id), initialState);
      const routeMarker = `ROUTE_NEGATIVE_${index}`;
      await evaluate(`location.hash='/requests?note='+encodeURIComponent(${JSON.stringify(`<img src=x onerror="console.info('${routeMarker}')">`)})`, context.id); await wait(80);
      check(`browser ${index}: unrelated route parameter is inert`, observed(routeMarker), false);
      check(`browser ${index}: requests still render`, await evaluate("document.getElementById('heading').textContent", context.id), "My requests");

      const hostile = clone(spec);
      const hostileMarker = `FIXTURE_NEGATIVE_${index}`;
      const hostileText = `<img src=x onerror="console.info('${hostileMarker}')">`;
      hostile.users[0].name += hostileText;
      hostile.articles[0].body += hostileText;
      hostile.tickets[0].subject += hostileText;
      context = await navigate(`hostile-fixture-${index}.html`, compileWebLab(hostile).html);
      check(`browser ${index}: fixture content cannot create executable elements`, await evaluate("document.querySelectorAll('img').length", context.id), 0);
      check(`browser ${index}: display data remains text`, await evaluate("document.getElementById('identity').textContent.includes('<img')", context.id), true);
      await evaluate("location.hash='/requests'", context.id); await wait(60);
      check(`browser ${index}: ticket content remains text`, await evaluate("document.querySelectorAll('img').length", context.id), 0);
      check(`browser ${index}: no fixture execution`, observed(hostileMarker), false);

      const publicData = { labId: spec.labId, application: spec.application, users: spec.users, session: spec.session, articles: spec.articles, tickets: spec.tickets, routes: spec.routes };
      context = await navigate(`safe-template-${index}.html`, renderHelpdeskV1(publicData));
      const safeMarker = `SAFE_NEGATIVE_${index}`;
      await evaluate(submit(`<img src=x onerror="console.info('${safeMarker}')">`), context.id); await wait(80);
      check(`browser ${index}: safe template creates no injected element`, await evaluate("!!document.querySelector('#search-summary img')", context.id), false);
      check(`browser ${index}: safe template does not execute`, observed(safeMarker), false);
      check(`browser ${index}: safe template displays literal input`, await evaluate("document.getElementById('search-summary').textContent.includes('<img')", context.id), true);
    }
    return browserSeeds.length;
  } finally {
    if (ws) ws.close();
    child.kill();
    await wait(400);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

browserMatrix().then(browserCases => console.log(`Web lab Phase 2: ${assertions} assertions passed; ${seeds.length} deterministic seeds; ${contextSignatures.size} distinct context signatures; ${browserCases} sequential browser cases`)).catch(error => { console.error(error); process.exitCode = 1; });
