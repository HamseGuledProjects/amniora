#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated offline route loader. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { randomUUID } = require("node:crypto");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../..");
const routePath = path.join(root, "app/api/ai/lab-generation-jobs/route.ts");
const routeSource = fs.readFileSync(routePath, "utf8");
const userId = randomUUID();
const savedLabId = randomUUID();
const jobs = [];
const callbacks = [];
let executableEnabled = true;
let executableCalls = 0;
let executableError = null;
let executableFailureStage = "saved_lab_insert";
let staticCalls = 0;
let reservations = 0;
let finalized = 0;
let assertions = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }

class Query {
  constructor(table) { this.table = table; this.filters = []; this.action = "read"; this.payload = null; }
  select() { return this; }
  order() { return this; }
  limit() { return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  is(key, value) { this.filters.push(row => row[key] === value); return this; }
  update(payload) { this.action = "update"; this.payload = payload; return this; }
  insert(payload) { this.action = "insert"; this.payload = payload; return this; }
  execute() {
    if (this.table !== "lab_generation_jobs") throw new Error("unexpected fixture table");
    if (this.action === "insert") {
      const row = { id: randomUUID(), resulting_lab_id: null, usage_reservation_id: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        started_at: null, completed_at: null, failed_at: null, expires_at: new Date(Date.now() + 1_800_000).toISOString(),
        safe_error_code: null, safe_error_message: null, retryable: true, ...this.payload };
      jobs.push(row);
      return { data: row, error: null };
    }
    const matches = jobs.filter(row => this.filters.every(filter => filter(row)));
    if (this.action === "update") {
      for (const row of matches) Object.assign(row, this.payload);
      return { data: matches[0] || null, error: null };
    }
    return { data: matches[0] || null, error: null };
  }
  maybeSingle() { return Promise.resolve(this.execute()); }
  single() { return Promise.resolve(this.execute()); }
  then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
}

const stubs = {
  "next/server": { after: callback => callbacks.push(callback), NextResponse: { json: (value, init) => Response.json(value, init) } },
  "@/app/api/ai/generate-lab/route": { POST: async () => { staticCalls++; return Response.json({ lab: { id: savedLabId } }); } },
  "@/lib/ai/usageService": {
    reserveAIUsage: async () => { reservations++; return { allowed: true, reservationId: randomUUID() }; },
    recordAIUsage: async () => { finalized++; },
    releaseAIUsageReservation: async () => {},
  },
  "@/lib/auth/betaAccessAuthorization": {
    authorizeBetaAccess: async () => ({ allowed: true, user: { id: userId } }),
    betaAccessErrorResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  },
  "@/lib/supabase/server": { createClient: async () => ({}) },
  "@/lib/supabase/admin": { supabaseAdmin: { from: table => new Query(table) } },
  "@/lib/web-lab/generated-executable-lab": {
    usesExecutableWebEngine: (category, difficulty, duration, enabled) =>
      enabled && category === "Web Security" && difficulty === "Beginner" && duration === "30 mins",
    EXECUTABLE_WEB_GENERATOR: "deterministic-web-v1",
  },
  "@/lib/web-lab/generated-executable-product": {
    executableWebGenerationEnabled: () => executableEnabled,
    saveGeneratedExecutableWebLab: async (_jobId, _ownerId, advanceStage) => {
      executableCalls++;
      if (executableError) {
        advanceStage(executableFailureStage);
        throw executableError;
      }
      return { savedLabId };
    },
  },
};
const load = Module._load;
Module._load = function (specifier, parent, isMain) {
  if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
  return load.call(this, specifier, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (filename !== routePath) throw new Error("Only the generation job route may be loaded");
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const route = require(routePath);
async function post(body) {
  return route.POST(new Request("http://localhost:3000/api/ai/lab-generation-jobs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}
async function main() {
  const compactRouteSource = routeSource.replace(/\s+/g, " ");
  for (const [stage, operation] of [
    ["usage_reserve", "const usage = await reserveAIUsage"],
    ["job_reservation_link", "const { data: reservedJob, error: reservationError } = await supabaseAdmin"],
    ["generation_job_lock", "const saved = await saveGeneratedExecutableWebLab"],
    ["usage_finalize", "await recordAIUsage"],
    ["job_complete", "const { error: completionError } = await supabaseAdmin"],
    ["failure_record", "await markJobFailed"],
  ]) {
    check(compactRouteSource.includes(`advanceStage("${stage}"); ${operation}`), true,
      `${stage} advances immediately before its risky operation`);
  }
  const config = { category: "Web Security", difficulty: "Beginner", duration: "30 mins" };
  let response = await route.GET(new Request("http://localhost:3000/api/ai/lab-generation-jobs"));
  check((await response.json()).executableWebAvailable, true, "server advertises enabled deterministic route");
  response = await post({ ...config, generationEngine: "ai", aiContentConsentToken: "fixture" });
  check(response.status, 409, "stale AI request cannot silently switch to executable engine");
  response = await post({ ...config, generationEngine: "deterministic-web-v1" });
  check(response.status, 202, "deterministic job accepted without AI-sharing consent");
  const created = (await response.json()).job;
  check(created.category, "Web Security", "normal generation job contract");
  check(callbacks.length, 1, "one background worker");
  await callbacks.shift()();
  check(executableCalls, 1, "deterministic product service called once");
  check(staticCalls, 0, "static AI route not called");
  check(reservations, 1, "normal weekly generation quota reserved");
  check(finalized, 1, "zero-cost deterministic usage finalized");
  check(jobs[0].status, "completed", "job terminal completion");
  check(jobs[0].resulting_lab_id, savedLabId, "Saved Lab ID returned through normal job");
  response = await route.GET(new Request(`http://localhost:3000/api/ai/lab-generation-jobs?id=${created.id}`));
  check((await response.json()).job.resultingLabId, savedLabId, "polling sees saved result");

  jobs.length = 0;
  executableEnabled = false;
  response = await post({ ...config, generationEngine: "deterministic-web-v1" });
  check(response.status, 409, "disabled engine rejected without static fallback");
  check(executableCalls, 1, "disabled engine creates no build");
  response = await post({ ...config, generationEngine: "ai" });
  check(response.status, 400, "static route still requires AI sharing consent");
  response = await post({ ...config, generationEngine: "ai", aiContentConsentToken: "fixture" });
  check(response.status, 202, "old static Web Security path remains separate");
  await callbacks.shift()();
  check(staticCalls, 1, "static route called only for explicit AI job");
  check(executableCalls, 1, "static Web Security does not create build");

  jobs.length = 0;
  executableEnabled = true;
  response = await post({ category: "Linux", difficulty: "Beginner", duration: "30 mins",
    generationEngine: "deterministic-web-v1" });
  check(response.status, 409, "Linux cannot select executable Web engine");
  check(executableCalls, 1, "Linux creates no Web build");

  jobs.length = 0;
  executableFailureStage = "saved_lab_insert";
  executableError = Object.assign(new Error("arbitrary database detail must not be logged"), {
    code: "22P02",
    table_name: "labs",
    column_name: "tasks",
    constraint_name: "labs_tasks_jsonb_check",
    detail: "row contents must not be logged",
    hint: "phase15c-secret-sentinel",
    sql: "phase15c-secret-sentinel",
    parameters: ["phase15c-secret-sentinel"],
    password: "phase15c-secret-sentinel",
    token: "phase15c-secret-sentinel",
  });
  response = await post({ ...config, generationEngine: "deterministic-web-v1" });
  check(response.status, 202, "database failure fixture job accepted");
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    await callbacks.shift()();
  } finally {
    console.error = originalConsoleError;
  }
  check(jobs[0].status, "failed", "database failure marks job failed");
  check(logged.length, 1, "database failure produces one safe diagnostic");
  check(logged[0][1], {
    stage: "saved_lab_insert",
    code: "22P02",
    table: "labs",
    column: "tasks",
    constraint: "labs_tasks_jsonb_check",
  }, "safe diagnostic retains only allowlisted database fields");
  check(JSON.stringify(logged).includes("arbitrary database detail"), false,
    "safe diagnostic excludes error messages");
  check(JSON.stringify(logged).includes("row contents"), false,
    "safe diagnostic excludes database detail and row contents");
  check(JSON.stringify(logged).includes("phase15c-secret-sentinel"), false,
    "safe diagnostic excludes secret-bearing arbitrary fields");

  jobs.length = 0;
  executableFailureStage = "build_insert";
  executableError = new Error("GENERATION_SAVED_LAB_INSERT_FAILED");
  response = await post({ ...config, generationEngine: "deterministic-web-v1" });
  check(response.status, 202, "application failure fixture job accepted");
  const applicationLogs = [];
  console.error = (...args) => applicationLogs.push(args);
  try {
    await callbacks.shift()();
  } finally {
    console.error = originalConsoleError;
  }
  check(applicationLogs[0][1], {
    stage: "build_insert",
    code: "GENERATION_SAVED_LAB_INSERT_FAILED",
  }, "safe diagnostic preserves a known allowlisted application code");

  jobs.length = 0;
  executableFailureStage = "job_link";
  executableError = Object.assign(new Error("hidden message"), {
    code: "23505",
    table_name: "labs;select",
    column_name: "tasks secret",
    constraint_name: "valid_constraint_name",
    detail: "phase15c-hidden-detail",
  });
  response = await post({ ...config, generationEngine: "deterministic-web-v1" });
  check(response.status, 202, "identifier sanitization fixture job accepted");
  const identifierLogs = [];
  console.error = (...args) => identifierLogs.push(args);
  try {
    await callbacks.shift()();
  } finally {
    console.error = originalConsoleError;
  }
  check(identifierLogs[0][1], {
    stage: "job_link",
    code: "23505",
    constraint: "valid_constraint_name",
  }, "invalid table and column identifiers are omitted while a valid constraint is retained");
  check(JSON.stringify(identifierLogs).includes("phase15c-hidden-detail"), false,
    "arbitrary PostgreSQL detail remains hidden");
  process.stdout.write(`Phase 15C job route PASS (${assertions} assertions)\n`);
}
main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
