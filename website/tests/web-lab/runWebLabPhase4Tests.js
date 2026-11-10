#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS test loads scoped Web lab TypeScript sources. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourceRoot = path.resolve(__dirname, "../../lib/web-lab");
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Only Web lab sources may be transpiled");
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
};
const { planBeginnerHelpdeskLab, planBeginnerStoredXssLab, planBeginnerEcommerceReflectedXssLab, planBeginnerEcommerceStoredXssLab, compileWebLab, validateWebLabSpec } = require(path.join(sourceRoot, "index.ts"));
const { reflectedXssV1 } = require(path.join(sourceRoot, "vulnerabilities/reflected-xss-v1.ts"));
const { storedXssV1 } = require(path.join(sourceRoot, "vulnerabilities/stored-xss-v1.ts"));
const { helpdeskV1 } = require(path.join(sourceRoot, "templates/helpdesk-v1.ts"));
const { ecommerceV1 } = require(path.join(sourceRoot, "templates/ecommerce-v1.ts"));
const { canonicalSpecBytes, sha256 } = require(path.join(sourceRoot, "manifest.ts"));
const { canonicalWebLabRuntimeState, createMemoryWebLabStateStorage, createWebLabRuntimeInstance } = require(path.join(sourceRoot, "runtime-state.ts"));
const { attestObservedWebLabEvent, evaluateWebLabResult } = require(path.join(sourceRoot, "grading.ts"));

let assertions = 0;
function check(label, actual, expected) { assert.deepEqual(actual, expected, label); assertions++; }
function invalid(label, spec, vulnerabilityModule = spec.vulnerability.moduleId === "stored-xss" ? storedXssV1 : reflectedXssV1) {
  assert.ok(validateWebLabSpec(spec, vulnerabilityModule).length, `${label}: invalid spec accepted`); assertions++;
  if (vulnerabilityModule === reflectedXssV1 || vulnerabilityModule === storedXssV1) { assert.throws(() => compileWebLab(spec), /validation failed/); assertions++; }
}
function changed(label, original, mutate) { const spec = structuredClone(original); mutate(spec); invalid(label, spec); }
const seeds = Array.from({ length: 25 }, (_, index) => `phase4-matrix-${String(index + 1).padStart(2, "0")}`);
const combinations = [
  ["helpdesk-reflected", planBeginnerHelpdeskLab, helpdeskV1, reflectedXssV1],
  ["helpdesk-stored", planBeginnerStoredXssLab, helpdeskV1, storedXssV1],
  ["ecommerce-reflected", planBeginnerEcommerceReflectedXssLab, ecommerceV1, reflectedXssV1],
  ["ecommerce-stored", planBeginnerEcommerceStoredXssLab, ecommerceV1, storedXssV1],
];
const all = [];
for (const seed of seeds) {
  const row = [];
  for (const [name, plan, template, vulnerabilityModule] of combinations) {
    const spec = plan(seed), build = compileWebLab(spec), repeated = plan(seed);
    row.push({ spec, build }); all.push({ name, spec, build });
    const binding = template.bindings[vulnerabilityModule.behavior];
    check(`${name}/${seed}: contract valid`, validateWebLabSpec(spec, vulnerabilityModule), []);
    check(`${name}/${seed}: canonical bytes stable`, canonicalSpecBytes(spec), canonicalSpecBytes(repeated));
    check(`${name}/${seed}: bundle stable`, build.html, compileWebLab(repeated).html);
    check(`${name}/${seed}: manifest stable`, build.manifest, compileWebLab(repeated).manifest);
    check(`${name}/${seed}: spec fingerprint`, build.manifest.canonicalSpecSha256, sha256(canonicalSpecBytes(spec)));
    check(`${name}/${seed}: bundle fingerprint`, build.manifest.learnerBundleSha256, sha256(build.html));
    check(`${name}/${seed}: template/module manifest identity`, [build.manifest.templateId, build.manifest.templateVersion, build.manifest.vulnerabilityId, build.manifest.vulnerabilityVersion, build.manifest.seed], [template.id, template.version, vulnerabilityModule.id, vulnerabilityModule.version, seed]);
    check(`${name}/${seed}: bound route/input/sink`, [spec.vulnerability.route, spec.vulnerability.input, spec.vulnerability.sink], [binding.route, binding.input, binding.sink]);
    check(`${name}/${seed}: task and solution binding`, [spec.learner.targetRoute, spec.learner.targetInput, spec.learner.targetSink, spec.learner.renderingContext, spec.internalSolution.route, spec.internalSolution.input, spec.internalSolution.sink, spec.internalSolution.renderingContext], [binding.route, binding.input, binding.sink, binding.renderingContext, binding.route, binding.input, binding.sink, binding.renderingContext]);
    check(`${name}/${seed}: template-specific task copy`, [spec.learner.objective, spec.learner.expectedObservations], [template.taskCopy[vulnerabilityModule.behavior].objective, [...template.taskCopy[vulnerabilityModule.behavior].expectedObservations]]);
    check(`${name}/${seed}: same module runtime binding`, build.html.includes(vulnerabilityModule.runtimeBinding), true);
    check(`${name}/${seed}: exactly one intentional sink`, (build.html.match(/\.innerHTML\s*=/g) || []).length, 1);
    check(`${name}/${seed}: solution remains secret`, build.html.includes(spec.internalSolution.groundTruthTag) || /internalSolution|groundTruthTag|trusted-runtime-event|script-executed-from-(reflected-input|stored-content)/.test(build.html), false);
    check(`${name}/${seed}: no external dependencies`, /https?:\/\/|\/api\/|supabase|openai|<script[^>]+src=|\bfetch\s*\(|\bWebSocket\s*\(/i.test(build.html), false);
    check(`${name}/${seed}: reset declaration`, spec.resetState, { route: "/", query: "", completed: false });
    if (vulnerabilityModule.behavior === "stored") {
      const flow = spec.vulnerability.storedFlow;
      check(`${name}/${seed}: flow bound to template`, [flow.submissionRoute, flow.action, flow.inputField, flow.targetObjectType, flow.storageLocation, flow.retrievalRoute], [binding.route, binding.action, binding.input, binding.targetObjectType, binding.storageLocation, binding.retrievalRoute]);
      check(`${name}/${seed}: flow reflected in task and solution`, [spec.learner.storedFlow, spec.internalSolution.storedFlow], [flow, flow]);
      const objects = template.id === "helpdesk" ? spec.tickets : spec.products;
      check(`${name}/${seed}: real target object`, objects.some(object => object.id === flow.targetObjectId), true);
    }
  }
  check(`${seed}: four unique lab IDs`, new Set(row.map(item => item.spec.labId)).size, 4);
  check(`${seed}: four unique spec fingerprints`, new Set(row.map(item => item.build.manifest.canonicalSpecSha256)).size, 4);
  check(`${seed}: four unique bundle fingerprints`, new Set(row.map(item => item.build.manifest.learnerBundleSha256)).size, 4);
}
check("matrix contains 100 deterministic builds", all.length, 100);
check("ecommerce contexts vary", new Set(all.filter(item => item.name === "ecommerce-stored").map(item => JSON.stringify([item.spec.application, item.spec.users, item.spec.products]))).size >= 15, true);
check("modules contain no template names/routes/object names", /helpdesk|ecommerce|ticket|product|\/search|\/catalog|\/requests/.test(reflectedXssV1.runtimeBinding + storedXssV1.runtimeBinding), false);

const commerceReflected = planBeginnerEcommerceReflectedXssLab("phase4-negative-reflected");
const commerceStored = planBeginnerEcommerceStoredXssLab("phase4-negative-stored");
changed("wrong search route", commerceReflected, spec => { spec.vulnerability.route = "/not-found"; });
changed("wrong search input", commerceReflected, spec => { spec.vulnerability.input = "q"; });
changed("wrong search sink", commerceReflected, spec => { spec.vulnerability.sink = "catalog-title"; });
changed("missing catalog route", commerceReflected, spec => { spec.routes = spec.routes.filter(route => route.path !== "/catalog"); });
changed("wrong template version", commerceReflected, spec => { spec.templateVersion = "2.0.0"; });
changed("wrong template identity", commerceReflected, spec => { spec.templateId = "helpdesk"; });
changed("missing category reference", commerceReflected, spec => { spec.products[0].categoryId = "missing"; });
changed("malformed price", commerceReflected, spec => { spec.products[0].priceDisplay = "checkout now"; });
changed("wrong task term", commerceReflected, spec => { spec.learner.objective = helpdeskV1.taskCopy.reflected.objective; });
changed("wrong task field", commerceReflected, spec => { spec.learner.targetInput = "q"; });
changed("wrong stored target ID", commerceStored, spec => { spec.vulnerability.storedFlow.targetObjectId = "missing"; });
changed("wrong stored object type", commerceStored, spec => { spec.vulnerability.storedFlow.targetObjectType = "ticket"; });
changed("wrong review author", commerceStored, spec => { spec.products[0].reviews[0].authorId = "missing"; });
changed("wrong review field", commerceStored, spec => { spec.vulnerability.storedFlow.inputField = "comment"; });
changed("wrong review action", commerceStored, spec => { spec.vulnerability.storedFlow.action = "add-comment"; });
changed("wrong review retrieval", commerceStored, spec => { spec.vulnerability.storedFlow.retrievalRoute = "/catalog"; });
changed("missing product route", commerceStored, spec => { spec.routes = spec.routes.filter(route => route.path !== "/products/detail"); });
changed("review target disabled", commerceStored, spec => { spec.products[0].reviewEnabled = false; });
changed("second review target enabled", commerceStored, spec => { spec.products[1].reviewEnabled = true; });
changed("task wrong product", commerceStored, spec => { spec.learner.storedFlow.targetObjectId = "product-2"; });
changed("solution wrong sink", commerceStored, spec => { spec.internalSolution.sink = "product-title"; });
changed("module version mismatch", commerceStored, spec => { spec.vulnerability.moduleVersion = "2.0.0"; });
invalid("reflected module lacks capability", commerceReflected, { ...reflectedXssV1, requiredCapability: "missing-v2" });
invalid("stored module lacks capability", commerceStored, { ...storedXssV1, requiredCapability: "missing-v2" });
invalid("binding extension point mismatch", commerceStored, { ...storedXssV1, extensionPoint: "reflected-output" });

const expectedEvent = spec => ({
  labId: spec.labId, moduleId: spec.vulnerability.moduleId, eventType: spec.internalSolution.successCondition,
  route: spec.internalSolution.route, input: spec.internalSolution.input, sink: spec.internalSolution.sink,
  renderingContext: spec.internalSolution.renderingContext,
  ...(spec.vulnerability.storedFlow ? { storedEvidence: { ...spec.vulnerability.storedFlow, instanceId: "phase4-a", storedBeforeRender: true } } : {}),
});
for (const spec of [commerceReflected, commerceStored]) {
  const instance = spec.vulnerability.storedFlow ? "phase4-a" : undefined;
  check(`${spec.vulnerability.moduleId}: trusted matching event grades`, evaluateWebLabResult(spec, [attestObservedWebLabEvent(expectedEvent(spec))], instance).status, "pass");
  check(`${spec.vulnerability.moduleId}: forged event rejected`, evaluateWebLabResult(spec, [expectedEvent(spec)], instance).status, "not-complete");
  check(`${spec.vulnerability.moduleId}: cross-template event rejected`, evaluateWebLabResult(spec, [attestObservedWebLabEvent(expectedEvent(spec.templateId === "ecommerce" && spec.vulnerability.moduleId === "stored-xss" ? planBeginnerStoredXssLab(spec.seed) : planBeginnerHelpdeskLab(spec.seed)))], instance).status, "not-complete");
  check(`${spec.vulnerability.moduleId}: wrong sink rejected`, evaluateWebLabResult(spec, [attestObservedWebLabEvent({ ...expectedEvent(spec), sink: "other" })], instance).status, "not-complete");
  check(`${spec.vulnerability.moduleId}: completion flag rejected`, evaluateWebLabResult(spec, [{ completed: true }], instance).status, "not-complete");
}
check("stored without provenance fails", evaluateWebLabResult(commerceStored, [attestObservedWebLabEvent({ ...expectedEvent(commerceStored), storedEvidence: undefined })], "phase4-a").status, "not-complete");
check("stored from other instance fails", evaluateWebLabResult(commerceStored, [attestObservedWebLabEvent(expectedEvent(commerceStored))], "phase4-b").status, "not-complete");
check("stored wrong product fails", evaluateWebLabResult(commerceStored, [attestObservedWebLabEvent({ ...expectedEvent(commerceStored), storedEvidence: { ...expectedEvent(commerceStored).storedEvidence, targetObjectId: "product-2" } })], "phase4-a").status, "not-complete");
check("reflected-only event fails stored grading", evaluateWebLabResult(commerceStored, [attestObservedWebLabEvent(expectedEvent(commerceReflected))], "phase4-a").status, "not-complete");

for (const [name, spec] of [["helpdesk reflected", planBeginnerHelpdeskLab("phase4-state")], ["helpdesk stored", planBeginnerStoredXssLab("phase4-state")], ["ecommerce reflected", planBeginnerEcommerceReflectedXssLab("phase4-state")], ["ecommerce stored", planBeginnerEcommerceStoredXssLab("phase4-state")]]) {
  const storage = createMemoryWebLabStateStorage();
  const a = createWebLabRuntimeInstance(spec, "phase4-a", storage), b = createWebLabRuntimeInstance(spec, "phase4-b", storage);
  const canonical = canonicalWebLabRuntimeState(spec), initial = sha256(JSON.stringify(a.snapshot()));
  const target = spec.vulnerability.storedFlow?.targetObjectId ?? (spec.templateId === "helpdesk" ? "request-1" : "product-1");
  check(`${name}: canonical baseline`, a.snapshot(), canonical);
  a.submitContent(target, "A review or comment from instance A");
  check(`${name}: A mutation changes fingerprint`, sha256(JSON.stringify(a.snapshot())) !== initial, true);
  check(`${name}: B isolated`, b.snapshot(), canonical);
  check(`${name}: A survives model reload`, createWebLabRuntimeInstance(spec, "phase4-a", storage).contentFor(target).at(-1).body, "A review or comment from instance A");
  a.reset();
  check(`${name}: reset exact fingerprint`, sha256(JSON.stringify(a.snapshot())), initial);
  check(`${name}: reset durable store cleared`, createWebLabRuntimeInstance(spec, "phase4-a", storage).snapshot(), canonical);
}

console.log(`Web lab Phase 4 contracts: ${assertions} assertions passed; ${all.length} deterministic template/module builds; 25 seeds`);
