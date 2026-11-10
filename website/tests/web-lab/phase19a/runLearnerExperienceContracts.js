#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped offline TypeScript contract harness. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const repositoryRoot = path.resolve(__dirname, "../../..");
const webLabRoot = path.join(repositoryRoot, "lib/web-lab");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(webLabRoot + path.sep)) throw new Error("Only Web Lab sources may be transpiled");
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};

const { learnerSavedLab } = require(path.join(webLabRoot, "generated-executable-lab.ts"));
const { planBeginnerHelpdeskLab, planBeginnerStoredXssLab } = require(path.join(webLabRoot, "planner.ts"));
const { planBeginnerEcommerceReflectedXssLab, planBeginnerEcommerceStoredXssLab } = require(path.join(webLabRoot, "ecommerce-planner.ts"));

const ownerId = "11111111-1111-4111-8111-111111111111";
const planners = [
  planBeginnerHelpdeskLab,
  planBeginnerStoredXssLab,
  planBeginnerEcommerceReflectedXssLab,
  planBeginnerEcommerceStoredXssLab,
];
const forbiddenLearnerTerms = /(?:ecommerce-v1|helpdesk-v1|stored-xss-v1|reflected-xss-v1|compilerVersion|runtimeVersion|buildFingerprint|internalSolution|groundTruthTag|successCondition|canonical exploit)/i;
const canonicalPayload = /<script\b|javascript:|onerror\s*=|onload\s*=/i;

for (const [index, planner] of planners.entries()) {
  const seed = String(index + 1).repeat(32);
  const spec = planner(seed);
  const learner = learnerSavedLab(ownerId, spec);
  assert.deepEqual(learnerSavedLab(ownerId, planner(seed)), learner, "same deterministic input produces identical learner content");
  assert.equal(learner.hints.length, 3, "each executable template supplies three progressive hints");
  assert.ok(learner.hints.every(hint => typeof hint === "string" && hint.length > 30), "hints are useful learner-facing sentences");
  assert.ok(learner.outcomes.length >= 4, "learning outcomes cover recognition, behaviour, context and mitigation");
  assert.equal(learner.tasks.length, 3, "learner workflow has three bounded objectives");
  const projection = JSON.stringify(learner);
  assert.doesNotMatch(projection, forbiddenLearnerTerms, "learner projection excludes engine and solution identifiers");
  assert.doesNotMatch(projection, canonicalPayload, "learner projection does not disclose an executable payload");
  assert.equal(projection.includes(spec.internalSolution.groundTruthTag), false, "grading truth remains private");
  for (const taskText of learner.tasks) {
    const task = JSON.parse(taskText);
    assert.ok(task.title && task.description && task.deliverable, "tasks describe an objective and learner deliverable");
    assert.deepEqual(task.evidence, [], "live tasks do not invent downloadable evidence");
  }
}

const savedPage = fs.readFileSync(path.join(repositoryRoot, "app/dashboard/saved/[id]/page.tsx"), "utf8");
const runtime = fs.readFileSync(path.join(repositoryRoot, "app/dashboard/saved/[id]/SavedLabLocalRunner.tsx"), "utf8");
const hints = fs.readFileSync(path.join(repositoryRoot, "app/dashboard/saved/[id]/SavedLabHints.tsx"), "utf8");
assert.match(runtime, /onExecutableChange\?\.\(!!build \|\| myVmAvailable \|\| cloudEligible\)/, "live-lab presentation derives from explicit runtime eligibility");
assert.match(savedPage, /\(!isExecutableWebLab \|\| assets\.length > 0\)/, "executable labs hide only the empty evidence section");
assert.match(savedPage, /lab\.hints\.length > 0/, "empty hint sections are omitted");
assert.match(hints, /aria-expanded=\{isRevealed\}/, "hint reveal state is communicated accessibly");
assert.match(hints, /aria-controls=\{hintId\}/, "hint controls reference their content");
assert.match(hints, /\{isRevealed \? "Hide" : "Reveal"\}/, "hints progressively reveal and can be hidden");
assert.doesNotMatch(savedPage, /local_self_hosted|byo_self_hosted|hosted_verified/, "Saved Lab UI does not expose completion trust enums");

console.log("Phase 19A learner experience contracts: PASS (content, projection, evidence, hints, identifiers, completion)");
