#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped offline TypeScript loader. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../..");
const sourceRoot = path.join(root, "lib/web-lab");
const load = Module._load;
Module._load = function (specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return load.call(this, specifier, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Only scoped Web lab sources may be loaded");
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};
const {
  saveExecutableWebGeneration, learnerSavedLab, planExecutableWebSpec,
  usesExecutableWebEngine, EXECUTABLE_WEB_GENERATOR,
} = require(path.join(sourceRoot, "generated-executable-lab.ts"));
const { compileWebLab } = require(path.join(sourceRoot, "compiler.ts"));
const { canonicalSpecBytes } = require(path.join(sourceRoot, "manifest.ts"));
const { WEB_LAB_COMPILER_VERSION } = require(path.join(sourceRoot, "postgres-control-repository.ts"));
const { LOCAL_RUNNER_RUNTIME_VERSION } = require(path.join(sourceRoot, "local-runner/protocol.ts"));
const { LocalRunnerProductService, LocalRunnerProductError } = require(path.join(sourceRoot, "local-runner-product-service.ts"));

let assertions = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
async function rejects(work, pattern, message) { await assert.rejects(work, pattern, message); assertions++; }
const ownerId = randomUUID();
const foreignId = randomUUID();
const jobId = randomUUID();
const actor = { userId: ownerId, sessionId: "fixture-session" };
const foreignActor = { userId: foreignId, sessionId: "fixture-session" };
const { privateKey } = generateKeyPairSync("ed25519");
let nextId = 1;
function id() { return `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`; }

class FakeAtomicStore {
  constructor() {
    this.jobs = new Map([[jobId, { ownerId, status: "generating", category: "Web Security",
      difficulty: "Beginner", duration: "30 mins", resultingLabId: null }]]);
    this.labs = new Map();
    this.builds = new Map();
    this.failAt = null;
  }
  async transaction(work) {
    const jobs = new Map(Array.from(this.jobs, ([key, value]) => [key, { ...value }]));
    const labs = new Map(this.labs);
    const builds = new Map(this.builds);
    const fail = (stage) => { if (this.failAt === stage) throw new Error(`fixture_${stage}_failure`); };
    const result = await work({
      async lockedJob(key, user) {
        fail("lock");
        const job = jobs.get(key);
        return job && job.ownerId === user ? { ...job } : null;
      },
      async ownedBuild(savedLabId, user) {
        const build = builds.get(savedLabId);
        return build && build.ownerId === user ? build.metadata : null;
      },
      async insertSavedLab(lab) {
        fail("saved");
        const savedLabId = id();
        labs.set(savedLabId, lab);
        return savedLabId;
      },
      async createBuild({ savedLabId, ownerId: user, spec }) {
        fail("build");
        const manifest = compileWebLab(spec).manifest;
        const metadata = {
          id: id(), savedLabId, canonicalLabId: spec.labId,
          templateId: spec.templateId, templateVersion: spec.templateVersion,
          vulnerabilityModuleId: spec.vulnerability.moduleId,
          vulnerabilityModuleVersion: spec.vulnerability.moduleVersion,
          schemaVersion: spec.schemaVersion, compilerVersion: WEB_LAB_COMPILER_VERSION,
          runtimeVersion: LOCAL_RUNNER_RUNTIME_VERSION,
          buildFingerprint: manifest.canonicalSpecSha256,
          createdAt: new Date(0).toISOString(),
        };
        builds.set(savedLabId, { ownerId: user, metadata, spec, canonicalSpec: canonicalSpecBytes(spec) });
        return metadata;
      },
      async linkJob(key, user, savedLabId) {
        fail("link");
        const job = jobs.get(key);
        if (!job || job.ownerId !== user || job.resultingLabId) throw new Error("fixture_job_link_invalid");
        job.resultingLabId = savedLabId;
      },
    });
    this.jobs = jobs;
    this.labs = labs;
    this.builds = builds;
    return result;
  }
  productRepository() {
    return {
      getBuildMetadata: async (savedLabId, user) => {
        const build = this.builds.get(savedLabId);
        return build?.ownerId === user ? build.metadata : null;
      },
      getTrustedBuild: async (buildId, user) => {
        const build = Array.from(this.builds.values()).find(value => value.metadata.id === buildId && value.ownerId === user);
        return build ? { metadata: build.metadata, spec: build.spec } : null;
      },
    };
  }
}

async function main() {
  check(usesExecutableWebEngine("Web Security", "Beginner", "30 mins", true), true, "only eligible engine selection");
  for (const [category, difficulty, duration, enabled] of [
    ["Linux", "Beginner", "30 mins", true], ["Web Security", "Intermediate", "30 mins", true],
    ["Web Security", "Beginner", "60 mins", true], ["Web Security", "Beginner", "30 mins", false],
  ]) check(usesExecutableWebEngine(category, difficulty, duration, enabled), false, "static/unsupported never executable");
  check(EXECUTABLE_WEB_GENERATOR, "deterministic-web-v1", "engine identity");
  const spec = planExecutableWebSpec(jobId, ownerId);
  check(planExecutableWebSpec(jobId, ownerId), spec, "same job/owner deterministic");
  check(planExecutableWebSpec(jobId, foreignId).seed !== spec.seed, true, "owner-separated seed");
  check(spec.schemaVersion, 1, "schema version");
  check(spec.templateVersion, "1.0.0", "template version");
  check(spec.vulnerability.moduleVersion, "1.0.0", "module version");
  check(spec.durationMinutes, 30, "duration");
  check(spec.difficulty, "Beginner", "difficulty");
  const learner = learnerSavedLab(ownerId, spec);
  check(learner.topic, "Web Security", "saved category");
  check(learner.tasks.length, 3, "saved tasks");
  check(Array.isArray(learner.tasks) && learner.tasks.every(item => typeof item === "string"), true,
    "tasks preserve the Saved Lab JSONB array-of-strings shape");
  for (const item of learner.tasks) {
    const task = JSON.parse(item);
    check(typeof task.title === "string" && Array.isArray(task.evidence), true, "Saved page task contract");
  }
  check(Array.isArray(learner.hints) && learner.hints.every(item => typeof item === "string"), true,
    "hints preserve the Saved Lab JSONB string-array shape");
  check(Array.isArray(learner.outcomes) && learner.outcomes.every(item => typeof item === "string"), true,
    "outcomes preserve the Saved Lab JSONB string-array shape");
  const learnerJson = JSON.stringify(learner);
  for (const forbidden of ["internalSolution", "groundTruthTag", "canonical_spec", "service_role", "privateKey", "providerKind"]) {
    check(learnerJson.includes(forbidden), false, `Saved row excludes ${forbidden}`);
  }

  const store = new FakeAtomicStore();
  const stages = [];
  const saved = await saveExecutableWebGeneration(store, jobId, ownerId, stage => stages.push(stage));
  check(stages, ["generation_job_lock", "spec_plan", "saved_lab_insert", "build_insert", "job_link"],
    "new persistence advances every operation stage in order");
  check(saved.replayed, false, "new generation");
  check(store.jobs.get(jobId).resultingLabId, saved.savedLabId, "job link");
  check(store.labs.size, 1, "one Saved Lab");
  check(store.builds.size, 1, "one private build");
  const privateBuild = store.builds.get(saved.savedLabId);
  check(privateBuild.metadata.savedLabId, saved.savedLabId, "build Saved Lab relationship");
  check(privateBuild.ownerId, ownerId, "build owner");
  check(privateBuild.metadata.canonicalLabId, spec.labId, "canonical lab identity");
  check(privateBuild.metadata.compilerVersion, WEB_LAB_COMPILER_VERSION, "compiler version");
  check(privateBuild.metadata.runtimeVersion, LOCAL_RUNNER_RUNTIME_VERSION, "runtime version");
  check(privateBuild.metadata.buildFingerprint, compileWebLab(spec).manifest.canonicalSpecSha256, "fingerprint");
  check(privateBuild.canonicalSpec, canonicalSpecBytes(spec), "immutable canonical spec input");
  check(privateBuild.canonicalSpec.includes("internalSolution"), true, "solution service-only in private build");
  const replayStages = [];
  const replay = await saveExecutableWebGeneration(store, jobId, ownerId, stage => replayStages.push(stage));
  check(replayStages, ["generation_job_lock", "build_replay_lookup"],
    "replay advances lock and build lookup stages");
  check(replay.replayed, true, "idempotent replay");
  check(replay.savedLabId, saved.savedLabId, "replay identity");
  check(store.labs.size, 1, "no duplicate Saved Lab");
  check(store.builds.size, 1, "no duplicate build");
  await rejects(() => saveExecutableWebGeneration(store, jobId, foreignId), /GENERATION_JOB_INVALID/, "foreign job rejected");

  const service = new LocalRunnerProductService({
    repository: store.productRepository(),
    signingAuthority: () => ({ keyId: "phase15c-test-key", privateKey }),
    now: () => 1_800_000_000_000,
  });
  const eligibility = await service.eligibility(actor, saved.savedLabId);
  check(eligibility.eligible, true, "real build is eligible without preview");
  check(eligibility.build.buildFingerprint, privateBuild.metadata.buildFingerprint, "eligibility fingerprint");
  check((await service.eligibility(foreignActor, saved.savedLabId)).eligible, false, "foreign owner cannot resolve");
  const issued = await service.issuePackage(actor, saved.savedLabId);
  check(issued.buildId, privateBuild.metadata.id, "package real build ID");
  check(issued.buildFingerprint, privateBuild.metadata.buildFingerprint, "package fingerprint");
  check(issued.runtimeVersion, LOCAL_RUNNER_RUNTIME_VERSION, "package runtime version");
  check(issued.templateVersion, spec.templateVersion, "package template version");
  check(issued.vulnerabilityModuleVersion, spec.vulnerability.moduleVersion, "package module version");
  for (const forbidden of ["internalSolution", "groundTruthTag", "providerKind", "privateKey", "service_role"]) {
    check(JSON.stringify(issued).includes(forbidden), false, `package excludes ${forbidden}`);
  }
  await rejects(() => service.issuePackage(foreignActor, saved.savedLabId),
    error => error instanceof LocalRunnerProductError && error.code === "LAB_NOT_FOUND", "foreign package denied");
  privateBuild.metadata = { ...privateBuild.metadata, runtimeVersion: "retired-runtime" };
  await rejects(() => service.issuePackage(actor, saved.savedLabId),
    error => error instanceof LocalRunnerProductError && error.code === "LAB_INCOMPATIBLE", "legacy build denied");

  const failureStage = {
    lock: "generation_job_lock",
    saved: "saved_lab_insert",
    build: "build_insert",
    link: "job_link",
  };
  for (const stage of ["lock", "saved", "build", "link"]) {
    const failing = new FakeAtomicStore();
    failing.failAt = stage;
    const observedStages = [];
    await rejects(() => saveExecutableWebGeneration(failing, jobId, ownerId,
      observedStage => observedStages.push(observedStage)),
      new RegExp(`fixture_${stage}_failure`), `${stage} failure propagates`);
    check(observedStages.at(-1), failureStage[stage], `${stage} failure retains its safe stage`);
    check(failing.labs.size, 0, `${stage} rollback Saved Lab`);
    check(failing.builds.size, 0, `${stage} rollback build`);
    check(failing.jobs.get(jobId).resultingLabId, null, `${stage} rollback job link`);
  }
  process.stdout.write(`Phase 15C generation contracts PASS (${assertions} assertions)\n`);
}
main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
