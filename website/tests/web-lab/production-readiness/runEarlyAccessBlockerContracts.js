#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped offline TypeScript contract loader. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { randomUUID } = require("node:crypto");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "../../..");
const SOURCE = path.join(ROOT, "lib/web-lab");
const originalLoad = Module._load;
Module._load = function (specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return originalLoad.call(this, specifier, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(`${path.join(ROOT, "lib")}${path.sep}`)) {
    throw new Error("scoped_typescript_load_denied");
  }
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
};

const security = require(path.join(SOURCE, "production-security-controls.ts"));
const composition = require(path.join(SOURCE, "runtime-route-composition.ts"));

let assertions = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
async function rejects(work, predicate, message) { await assert.rejects(work, predicate, message); assertions++; }

function source(relative) { return fs.readFileSync(path.join(ROOT, relative), "utf8"); }

async function main() {
  const generation = source("lib/web-lab/generated-executable-product.ts");
  const generationRoute = source("app/api/ai/lab-generation-jobs/route.ts");
  check(generation.includes("WEB_LAB_DETERMINISTIC_GENERATION_ENABLED"), true,
    "B4 keeps an independent deterministic-generation gate");
  check(generation.includes("WEB_LAB_LOCAL_RUNNER_ENABLED"), false,
    "B4 no longer couples deterministic persistence to Local Runner");
  check(generation.includes("store !== null && alerts !== null"), true,
    "B4 requires explicit store and production alert registration");
  const postRoute = generationRoute.slice(generationRoute.indexOf("export async function POST"));
  check(postRoute.indexOf("authorizeBetaAccess") < postRoute.indexOf("executableWebGenerationEnabled"), true,
    "B4 keeps private-beta authorization ahead of executable engine selection");

  const admin = source("lib/supabase/admin.ts");
  const usage = source("lib/ai/usageService.ts");
  check(admin.trimStart().startsWith('import "server-only";'), true,
    "B5 privileged admin module is server-only");
  for (const forbidden of ["error.message", "error.details", "error.hint", "reservationIdPrefix",
    "userIdPrefix", "cause: error", "throw new Error(eventError.message)"]) {
    check(usage.includes(forbidden), false, `B5 excludes raw diagnostic pattern ${forbidden}`);
  }
  for (const code of ["AI_USAGE_RESERVATION_FAILED", "AI_USAGE_EVENT_WRITE_FAILED"]) {
    check(usage.includes(code), true, `B5 uses fixed telemetry code ${code}`);
  }

  const b1b2 = source("supabase/migrations/20260927121713_early_access_public_security_hardening.sql");
  const b3 = source("supabase/migrations/20260927121714_early_access_resulting_lab_index.sql");
  const b6 = source("supabase/migrations/20260927121715_early_access_runtime_security_controls.sql");
  check(b1b2.includes("grant update (completed) on table public.labs to authenticated"), true,
    "B1 preserves only the approved learner column update");
  check(b1b2.includes("set search_path = ''"), true, "B2 fixes SECURITY DEFINER search paths");
  check(b1b2.includes("revoke execute on functions from public, anon, authenticated, service_role"), true,
    "B2 future functions fail closed");
  check(b3.startsWith("-- pg-delta: transaction=false\n"), true,
    "B3 is explicitly non-transactional for concurrent creation");
  check(b3.includes("where resulting_lab_id is not null"), true, "B3 retains the approved partial predicate");
  check(b6.includes("enable row level security"), true, "B6 private persistence enables RLS");
  check(b6.includes("token_hash"), true, "B6 persists enrollment digests rather than raw capabilities");

  const ownerId = randomUUID();
  const fingerprint = security.safeRequestFingerprint({ savedLabId: randomUUID() });
  const policy = new security.InMemoryDistributedAbusePolicy({
    runner_package: { limit: 2, windowMs: 60_000 },
  }, () => 1_800_000_000_000);
  const duplicate = { ownerId, surface: "runner_package", idempotencyKey: "duplicate_request",
    requestFingerprint: fingerprint };
  await Promise.all([policy.assertAllowed(duplicate), policy.assertAllowed(duplicate)]);
  await policy.assertAllowed({ ...duplicate, idempotencyKey: "second_request" });
  await rejects(() => policy.assertAllowed({ ...duplicate, idempotencyKey: "third_request" }),
    error => error?.code === "RATE_LIMITED", "bounded surface denies after its explicit limit");
  await rejects(() => policy.assertAllowed({ ...duplicate, requestFingerprint: "0".repeat(64) }),
    error => error?.code === "IDEMPOTENCY_CONFLICT", "duplicate key with different intent is denied");
  const missing = new security.InMemoryDistributedAbusePolicy({}, () => 1_800_000_000_000);
  await rejects(() => missing.assertAllowed(duplicate), error => error?.code === "CONTROL_UNAVAILABLE",
    "missing rate configuration fails closed");

  const alerts = new security.InMemoryWebLabAlertSink();
  await alerts.notify({ code: "RUNNER_OFFLINE", stage: "runner", runtimeMode: "byo_runtime" });
  check(alerts.events, [{ code: "RUNNER_OFFLINE", stage: "runner", runtimeMode: "byo_runtime" }],
    "local alert sink captures only fixed safe event fields");
  const failingAlert = { production: true, async notify() { throw new Error("provider_unavailable"); } };
  const reconciliation = new security.WebLabReconciliationAdapter({
    async reconcile() { throw new Error("provider_detail_not_exposed"); },
  }, failingAlert);
  await rejects(() => reconciliation.run(new Date(0)), error => error?.message === "reconciliation_failed",
    "reconciliation and alert-provider failure remains a fixed fail-closed result");

  assert.throws(() => composition.createWebLabControlPlane(), /web_lab_control_unconfigured/);
  assertions++;
  const production = { production: true };
  const validShape = {
    entitlement: { ...production, async planFor() { return "pro"; } },
    ratePolicy: { ...production, async assertAllowed() {} },
    compatibility: { verdict() { return "SUPPORTED"; } },
    grader: { ...production, async grade() { return { outcome: "error", graderVersion: "fixture" }; } },
    backends: [{ ...production, mode: "amniora_hosted", providerKind: "fixture",
      runtimeVersion: "fixture", backend: {
        async create() {}, async status() {}, async reset() {}, async destroy() {},
        async inspect() {}, async listManaged() {}, async destroyManaged() {},
      } }],
    alerts: { ...production, async notify() {} },
    reconciliation: { ...production, register() {} },
  };
  for (const missingKey of ["entitlement", "ratePolicy", "grader", "backends", "alerts", "reconciliation"]) {
    const candidate = { ...validShape };
    delete candidate[missingKey];
    assert.throws(() => composition.registerWebLabProductionAdapters(candidate),
      /web_lab_production_adapters_invalid/);
    assertions++;
  }
  check(source("lib/web-lab/local-runner-product-composition.ts").includes("if (!security)"), true,
    "Local Runner production composition fails closed without abuse and alert controls");
  check(source("lib/web-lab/byo-runner/product-composition.ts").includes("!security"), true,
    "My VM production composition fails closed without abuse and alert controls");
  check(source("lib/web-lab/byo-runner/postgres-enrollment.ts").includes("consumed_at is null"), true,
    "durable enrollment consumes exactly once with an atomic predicate");
  check(source("lib/web-lab/runtime-route-composition.ts").includes("new WebLabReconciliationAdapter"), true,
    "production runtime composition exposes the trusted reconciliation adapter");

  process.stdout.write(`Early Access blocker contracts PASS (${assertions} assertions)\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.stack || "early_access_contract_failed"}\n`);
  process.exitCode = 1;
});
