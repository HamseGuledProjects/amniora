#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS test loads only scoped Web lab TypeScript sources. */
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
const { planBeginnerHelpdeskLab, planBeginnerStoredXssLab, compileWebLab, validateWebLabSpec } = require(path.join(sourceRoot, "index.ts"));
const { storedXssV1 } = require(path.join(sourceRoot, "vulnerabilities/stored-xss-v1.ts"));
const { renderHelpdeskV1 } = require(path.join(sourceRoot, "templates/helpdesk-v1.ts"));
const { canonicalSpecBytes, sha256 } = require(path.join(sourceRoot, "manifest.ts"));
const { createMemoryWebLabStateStorage, createWebLabRuntimeInstance, canonicalWebLabRuntimeState } = require(path.join(sourceRoot, "runtime-state.ts"));
const { attestObservedWebLabEvent, evaluateWebLabResult } = require(path.join(sourceRoot, "grading.ts"));

let assertions = 0;
function check(label, actual, expected) { assert.deepEqual(actual, expected, label); assertions += 1; }
function invalid(label, spec) {
  assert.ok(validateWebLabSpec(spec, storedXssV1).length, `${label}: accepted invalid contract`); assertions++;
  assert.throws(() => compileWebLab(spec), /validation failed/); assertions++;
}
function changed(label, mutate) { const copy = structuredClone(storedSpecs[0]); mutate(copy); invalid(label, copy); }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const seeds = Array.from({ length: 25 }, (_, n) => `phase3-stored-${String(n + 1).padStart(2, "0")}`);
const storedSpecs = seeds.map(planBeginnerStoredXssLab);

for (const [index, spec] of storedSpecs.entries()) {
  const seed = seeds[index];
  const compiled = compileWebLab(spec);
  const again = planBeginnerStoredXssLab(seed);
  check(`${seed}: valid`, validateWebLabSpec(spec, storedXssV1), []);
  check(`${seed}: same canonical bytes`, canonicalSpecBytes(spec), canonicalSpecBytes(again));
  check(`${seed}: same bundle`, compiled.html, compileWebLab(again).html);
  check(`${seed}: same manifest`, compiled.manifest, compileWebLab(again).manifest);
  check(`${seed}: spec hash`, compiled.manifest.canonicalSpecSha256, sha256(canonicalSpecBytes(spec)));
  check(`${seed}: bundle hash`, compiled.manifest.learnerBundleSha256, sha256(compiled.html));
  check(`${seed}: module in manifest`, [compiled.manifest.templateId, compiled.manifest.templateVersion, compiled.manifest.vulnerabilityId, compiled.manifest.vulnerabilityVersion, compiled.manifest.seed], ["helpdesk", "1.0.0", "stored-xss", "1.0.0", seed]);
  check(`${seed}: distinct reflected identity`, spec.labId !== planBeginnerHelpdeskLab(seed).labId, true);
  check(`${seed}: distinct reflected fingerprint`, compiled.manifest.canonicalSpecSha256 !== compileWebLab(planBeginnerHelpdeskLab(seed)).manifest.canonicalSpecSha256, true);
  check(`${seed}: target resolves`, spec.tickets.find(ticket => ticket.id === spec.vulnerability.storedFlow.targetObjectId)?.ownerId, spec.session.displayUserId);
  check(`${seed}: one writable ticket`, spec.tickets.filter(ticket => ticket.replyEnabled).map(ticket => ticket.id), [spec.vulnerability.storedFlow.targetObjectId]);
  check(`${seed}: aligned structured flow`, [spec.learner.storedFlow, spec.internalSolution.storedFlow], [spec.vulnerability.storedFlow, spec.vulnerability.storedFlow]);
  check(`${seed}: one intentional assignment`, (compiled.html.match(/\.innerHTML\s*=/g) || []).length, 1);
  check(`${seed}: solution absent`, compiled.html.includes(spec.internalSolution.groundTruthTag) || /internalSolution|groundTruthTag|trusted-runtime-event|stored-html|script-executed-from-stored-content/.test(compiled.html), false);
  check(`${seed}: no external dependency`, /https?:\/\/|\/api\/|supabase|openai|<script[^>]+src=|\bfetch\s*\(|\bWebSocket\s*\(/i.test(compiled.html), false);
  check(`${seed}: stateful future requirement`, compiled.runtimeRequirements.stateStorage, "per-instance-mutable-no-cross-user-leakage");
}
const contextSignatures = new Set(storedSpecs.map(spec => JSON.stringify([spec.application, spec.users, spec.articles, spec.tickets.map(ticket => [ticket.subject, ticket.status])])));
check("stored seeds vary context", contextSignatures.size >= 15, true);
check("stored seeds preserve one structural flow", new Set(storedSpecs.map(spec => JSON.stringify(spec.vulnerability.storedFlow))).size, 1);

changed("missing target", spec => { spec.vulnerability.storedFlow.targetObjectId = "absent"; });
changed("missing submission route", spec => { spec.routes = spec.routes.filter(route => route.path !== "/requests/detail"); });
changed("wrong submission route", spec => { spec.vulnerability.storedFlow.submissionRoute = "/search"; });
changed("wrong action", spec => { spec.vulnerability.storedFlow.action = "search"; });
changed("wrong stored field", spec => { spec.vulnerability.storedFlow.inputField = "q"; });
changed("wrong retrieval route", spec => { spec.vulnerability.storedFlow.retrievalRoute = "/requests"; });
changed("missing persistence", spec => { delete spec.vulnerability.storedFlow.persistence; });
changed("false persistence", spec => { spec.vulnerability.storedFlow.persistence = "none"; });
changed("reflected mislabeled stored", spec => { spec.vulnerability.route = "/search"; spec.vulnerability.input = "q"; spec.vulnerability.sink = "search-summary"; });
changed("wrong task field", spec => { spec.learner.storedFlow.inputField = "q"; });
changed("wrong task ticket", spec => { spec.learner.storedFlow.targetObjectId = "request-3"; });
changed("wrong task claim", spec => { spec.learner.claimedBehavior = "reflected"; });
changed("wrong task route", spec => { spec.learner.targetRoute = "/search"; });
changed("wrong task prose", spec => { spec.learner.objective = "Immediately reflect a query parameter."; });
changed("wrong solution sink", spec => { spec.internalSolution.sink = "unknown-sink"; });
changed("wrong solution flow", spec => { spec.internalSolution.storedFlow.retrievalRoute = "/search"; });
changed("module version mismatch", spec => { spec.vulnerability.moduleVersion = "2.0.0"; });
changed("module identity mismatch", spec => { spec.vulnerability.moduleId = "reflected-xss"; });
changed("wrong reset contract", spec => { spec.resetState.completed = true; });
changed("target no longer writable", spec => { spec.tickets[0].replyEnabled = false; });
changed("target no longer owned", spec => { spec.tickets[0].ownerId = "user-3"; });
changed("second unsafe target", spec => { spec.tickets[2].replyEnabled = true; });

const baseline = storedSpecs[0];
const flow = baseline.vulnerability.storedFlow;
const expectedEvent = {
  labId: baseline.labId, moduleId: "stored-xss", eventType: baseline.internalSolution.successCondition,
  route: baseline.internalSolution.route, input: baseline.internalSolution.input,
  sink: baseline.internalSolution.sink, renderingContext: baseline.internalSolution.renderingContext,
  storedEvidence: { ...flow, instanceId: "phase3-instance-a", storedBeforeRender: true },
};
const grade = (event, instance = "phase3-instance-a") => evaluateWebLabResult(baseline, [attestObservedWebLabEvent(event)], instance).status;
check("trusted stored flow grades", grade(expectedEvent), "pass");
check("fake completion flag fails", evaluateWebLabResult(baseline, [{ completed: true }], "phase3-instance-a").status, "not-complete");
check("forged plain event fails", evaluateWebLabResult(baseline, [expectedEvent], "phase3-instance-a").status, "not-complete");
check("no observed storage fails", grade({ ...expectedEvent, storedEvidence: undefined }), "not-complete");
check("no trusted instance fails", evaluateWebLabResult(baseline, [attestObservedWebLabEvent(expectedEvent)]).status, "not-complete");
check("other instance fails", grade(expectedEvent, "phase3-instance-b"), "not-complete");
for (const [name, event] of Object.entries({
  "wrong lab": { labId: "other-lab" }, "wrong module": { moduleId: "reflected-xss" },
  "wrong event": { eventType: "script-executed-from-reflected-input" }, "wrong route": { route: "/search" },
  "wrong input": { input: "q" }, "wrong sink": { sink: "search-summary" },
  "wrong context": { renderingContext: "HTML search-summary element" },
})) check(`${name} fails grading`, grade({ ...expectedEvent, ...event }), "not-complete");
for (const [name, key, value] of [
  ["wrong ticket", "targetObjectId", "request-3"], ["wrong object type", "targetObjectType", "product"], ["wrong field", "inputField", "q"],
  ["wrong storage", "storageLocation", "search"], ["wrong retrieval", "retrievalRoute", "/search"],
  ["wrong submission", "submissionRoute", "/search"], ["wrong action", "action", "search"],
  ["no persistence", "persistence", "none"], ["no prior storage", "storedBeforeRender", false],
  ["other stored instance", "instanceId", "phase3-instance-b"],
]) check(`${name} fails grading`, grade({ ...expectedEvent, storedEvidence: { ...expectedEvent.storedEvidence, [key]: value } }), "not-complete");
const attested = attestObservedWebLabEvent(expectedEvent);
check("attested evidence frozen", Object.isFrozen(attested.storedEvidence), true);

const storage = createMemoryWebLabStateStorage();
const a = createWebLabRuntimeInstance(baseline, "phase3-instance-a", storage);
const b = createWebLabRuntimeInstance(baseline, "phase3-instance-b", storage);
const initialFingerprint = sha256(JSON.stringify(a.snapshot()));
check("canonical initial state", a.snapshot(), canonicalWebLabRuntimeState(baseline));
a.submitComment(flow.targetObjectId, "Normal persisted update");
check("mutation changes fingerprint", sha256(JSON.stringify(a.snapshot())) !== initialFingerprint, true);
check("other instance isolated", b.snapshot(), canonicalWebLabRuntimeState(baseline));
check("same instance survives reload", createWebLabRuntimeInstance(baseline, "phase3-instance-a", storage).commentsFor(flow.targetObjectId).at(-1).body, "Normal persisted update");
check("unrelated ticket isolated", a.commentsFor("request-3").length, baseline.tickets.find(ticket => ticket.id === "request-3").comments.length);
assert.throws(() => a.submitComment("request-3", "not allowed")); assertions++;
a.reset();
check("reset restores exact fingerprint", sha256(JSON.stringify(a.snapshot())), initialFingerprint);
check("reset removes persisted mutation", createWebLabRuntimeInstance(baseline, "phase3-instance-a", storage).snapshot(), canonicalWebLabRuntimeState(baseline));
check("empty instance reset does not affect B", b.snapshot(), canonicalWebLabRuntimeState(baseline));

const chrome = require("./browserDiscovery").resolveBrowserExecutable();

async function browserMatrix() {
  const pages = new Map();
  const server = http.createServer((request, response) => {
    const html = pages.get(request.url.split("?")[0]);
    if (!html) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); response.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-web-phase3-"));
  const port = 14900 + process.pid % 1000;
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
    async function ready(urlFragment = "") {
      for (let n = 0; n < 60; n++) {
        const context = [...contexts.values()].find(item => item.auxData?.isDefault);
        if (context) {
          try {
            if (await evaluate(`location.href.includes(${JSON.stringify(urlFragment)}) && document.readyState === 'complete' && !!document.getElementById('brand')?.textContent`, context.id)) return context.id;
          } catch { /* old context */ }
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
    const submit = body => `(() => { const field=document.getElementById('ticket-comment'); field.value=${JSON.stringify(body)}; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); })()`;
    const observed = marker => consoleEvents.some(event => event.args?.some(arg => arg.value === marker));
    const afterHash = async (hash, context) => { await evaluate(`location.hash=${JSON.stringify(hash)}`, context); for (let n = 0; n < 30; n++) { if (await evaluate(`location.hash===${JSON.stringify(hash)} && !!document.getElementById('heading')?.textContent`, context)) return; await wait(30); } throw new Error(`Hash route did not load: ${hash}`); };
    for (const [index, spec] of [storedSpecs[0], storedSpecs[6], storedSpecs[12], storedSpecs[18], storedSpecs[24]].entries()) {
      const name = `stored-${index}`; let context = await navigate(name, compileWebLab(spec).html);
      const target = spec.vulnerability.storedFlow.targetObjectId;
      const targetHash = `#/requests/detail?id=${target}`;
      const initial = await evaluate("JSON.stringify(runtimeState)", context);
      await afterHash(targetHash, context); await wait(30);
      check(`${name}: existing comment`, await evaluate("document.querySelectorAll('.comment').length", context), 1);
      const normal = `Normal comment ${index}`;
      await evaluate(submit(normal), context);
      check(`${name}: submission does not reflect immediately`, await evaluate(`document.querySelector('.comments').textContent.includes(${JSON.stringify(normal)})`, context), false);
      await afterHash("#/articles", context); await send("Page.reload", { ignoreCache: true }); context = await ready(name);
      await afterHash(targetHash, context); await wait(40);
      check(`${name}: normal comment persists across navigation/reload`, await evaluate(`document.querySelector('.comments').textContent.includes(${JSON.stringify(normal)})`, context), true);
      check(`${name}: stored record belongs to target`, await evaluate(`runtimeState.contentByObject[${JSON.stringify(target)}].at(-1).body`, context), normal);
      await evaluate("document.getElementById('reset').click()", context); context = await ready(name);
      check(`${name}: reset exact canonical fingerprint`, await evaluate("JSON.stringify(runtimeState)", context), initial);
      await afterHash(targetHash, context); await wait(30);
      check(`${name}: reset removes comment`, await evaluate(`document.querySelector('.comments').textContent.includes(${JSON.stringify(normal)})`, context), false);
      const marker = `WEB_PHASE3_STORED_${index}`;
      const payload = `<img src=x onerror="console.info('${marker}')">`;
      await evaluate(submit(payload), context); await wait(30);
      check(`${name}: no immediate execution`, observed(marker), false);
      check(`${name}: no immediate injected element`, await evaluate("document.querySelector('.comments img') === null", context), true);
      await afterHash("#/articles", context); await send("Page.reload", { ignoreCache: true }); context = await ready(name);
      check(`${name}: no execution while on unrelated page`, observed(marker), false);
      await afterHash(targetHash, context); await wait(110);
      check(`${name}: stored payload retrieved`, await evaluate(`runtimeState.contentByObject[${JSON.stringify(target)}].at(-1).body`, context), payload);
      check(`${name}: intended stored sink created element`, await evaluate("!!document.querySelector('.comments img')", context), true);
      check(`${name}: harmless signal independently observed`, observed(marker), true);
      const evidence = { ...spec.vulnerability.storedFlow, instanceId: name, storedBeforeRender: true };
      const event = { labId: spec.labId, moduleId: "stored-xss", eventType: spec.internalSolution.successCondition, route: "/requests/detail", input: "comment", sink: "ticket-comment-body", renderingContext: "HTML ticket comment body", storedEvidence: evidence };
      check(`${name}: trusted stateful browser observation grades`, evaluateWebLabResult(spec, [attestObservedWebLabEvent(event)], name).status, "pass");
      const safeMarker = `WEB_PHASE3_SAFE_SEARCH_${index}`;
      await afterHash(`#/search?q=${encodeURIComponent(`<img src=x onerror="console.info('${safeMarker}')">`)}`, context); await wait(60);
      check(`${name}: search path remains encoded`, await evaluate("document.querySelector('#search-summary img') === null", context), true);
      check(`${name}: safe search does not execute`, observed(safeMarker), false);
      await afterHash("#/requests/detail?id=request-3", context); await wait(30);
      check(`${name}: unrelated ticket cannot accept comments`, await evaluate("document.querySelector('#ticket-comment') === null", context), true);
      check(`${name}: unrelated ticket remains safe`, await evaluate("document.querySelector('.comments img') === null", context), true);
      await evaluate("document.getElementById('reset').click()", context); context = await ready(name);
      check(`${name}: post-payload reset fingerprint`, await evaluate("JSON.stringify(runtimeState)", context), initial);
    }
    const spec = storedSpecs[0], publicData = { labId: spec.labId, application: spec.application, users: spec.users, session: spec.session, articles: spec.articles, tickets: spec.tickets, routes: spec.routes };
    const safeMarker = "WEB_PHASE3_SAFE_COMMENT";
    let context = await navigate("safe-base", renderHelpdeskV1(publicData));
    await afterHash("#/requests/detail?id=request-1", context);
    await evaluate(submit(`<img src=x onerror="console.info('${safeMarker}')">`), context);
    await afterHash("#/articles", context); await afterHash("#/requests/detail?id=request-1", context); await wait(80);
    check("safe template comment encoded", await evaluate("document.querySelector('.comments img') === null", context), true);
    check("safe template literal comment visible", await evaluate("document.querySelector('.comments').textContent.includes('<img')", context), true);
    check("safe template comment no execution", observed(safeMarker), false);
    const searchMarker = "WEB_PHASE3_SAFE_BASE_SEARCH";
    await afterHash(`#/search?q=${encodeURIComponent(`<img src=x onerror="console.info('${searchMarker}')">`)}`, context); await wait(60);
    check("safe template search encoded", await evaluate("document.querySelector('#search-summary img') === null", context), true);
    check("safe template search no execution", observed(searchMarker), false);

    const reflected = planBeginnerHelpdeskLab("phase3-reflected-cross-module");
    context = await navigate("reflected-cross", compileWebLab(reflected).html);
    await afterHash("#/requests/detail?id=request-1", context);
    const reflectedSafeMarker = "WEB_PHASE3_REFLECTED_COMMENT_SAFE";
    await evaluate(submit(`<img src=x onerror="console.info('${reflectedSafeMarker}')">`), context);
    await afterHash("#/articles", context); await afterHash("#/requests/detail?id=request-1", context); await wait(80);
    check("reflected module comment remains encoded", await evaluate("document.querySelector('.comments img') === null", context), true);
    check("reflected module comment does not execute", observed(reflectedSafeMarker), false);
    const reflectedMarker = "WEB_PHASE3_REFLECTED_SEARCH";
    await afterHash(`#/search?q=${encodeURIComponent(`<img src=x onerror="console.info('${reflectedMarker}')">`)}`, context); await wait(100);
    check("reflected module search remains vulnerable", observed(reflectedMarker), true);
    const seeded = structuredClone(storedSpecs[1]), seededMarker = "WEB_PHASE3_SEEDED_SAFE";
    const hostile = `<img src=x onerror="console.info('${seededMarker}')">`;
    seeded.users[0].name += hostile; seeded.articles[0].body += hostile; seeded.tickets[0].subject += hostile; seeded.tickets[0].comments[0].body += hostile;
    context = await navigate("stored-seeded-safe", compileWebLab(seeded).html);
    await afterHash("#/requests/detail?id=request-1", context); await wait(80);
    check("seeded comment cannot execute", observed(seededMarker), false);
    check("seeded title/identity/comment stay text", await evaluate("document.querySelectorAll('img').length", context), 0);
    await afterHash("#/articles", context); await wait(60);
    check("seeded article stays text", observed(seededMarker), false);
    check("seeded article has no injected image", await evaluate("document.querySelectorAll('img').length", context), 0);
    return 5;
  } finally {
    if (ws) ws.close();
    child.kill();
    server.close();
    await wait(400);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

browserMatrix().then(cases => console.log(`Web lab Phase 3: ${assertions} assertions passed; ${seeds.length} deterministic stored seeds; ${contextSignatures.size} contextual signatures; ${cases} sequential stored browser cases plus safe/reflected controls`)).catch(error => { console.error(error); process.exitCode = 1; });
