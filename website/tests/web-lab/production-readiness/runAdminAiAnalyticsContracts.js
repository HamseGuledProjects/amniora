#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped offline server-component contract loader. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "../../..");
const SERVICE = path.join(ROOT, "lib/admin/aiAnalytics.ts");
const PAGE = path.join(ROOT, "app/admin/ai/page.tsx");
const MIGRATION = path.join(ROOT,
  "supabase/migrations/20260927121713_early_access_public_security_hardening.sql");
const RUNBOOK = path.join(ROOT, "docs/production-readiness-early-access-blockers.md");
const originalLoad = Module._load;

let identity = "admin";
let databaseResult;
let guardedService;
let queryCalls = 0;
let selectedColumns = "";
const sequence = [];

const fixture = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  feature_type: "lab_generation",
  model_used: "fixture-model",
  input_tokens: 120,
  output_tokens: 80,
  total_tokens: 200,
  estimated_cost: "0.125",
  plan_snapshot: "pro",
  created_at: "2026-09-27T12:00:00.000Z",
  provider_private_detail: "must-not-cross-dto",
});
databaseResult = { data: [fixture], error: null };

const supabaseAdmin = {
  from(table) {
    sequence.push("query");
    queryCalls++;
    assert.equal(table, "ai_usage_events");
    return {
      select(columns) {
        selectedColumns = columns;
        return {
          order(column, options) {
            assert.equal(column, "created_at");
            assert.deepEqual(options, { ascending: false });
            return Promise.resolve(databaseResult);
          },
        };
      },
    };
  },
};

Module._load = function (specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  if (specifier === "@/lib/auth/requireAdmin") {
    return {
      async requireAdmin() {
        sequence.push("guard");
        if (identity !== "admin") throw new Error(identity === "deleted" ? "deleted_user" : "not_admin");
        return { user: { id: fixture.user_id }, profile: { role: "admin" } };
      },
    };
  }
  if (specifier === "@/lib/supabase/admin") return { supabaseAdmin };
  if (specifier === "@/lib/admin/aiAnalytics") return guardedService;
  if (specifier === "../AdminNavigation") return function AdminNavigation() {
    return React.createElement("nav", null, "Admin navigation");
  };
  return originalLoad.call(this, specifier, parent, isMain);
};

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    if (!filename.startsWith(`${ROOT}${path.sep}`)) throw new Error("scoped_typescript_load_denied");
    module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, filename);
  };
}

let assertions = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions++;
}
function source(file) { return fs.readFileSync(file, "utf8"); }

async function main() {
  const serviceSource = source(SERVICE);
  const pageSource = source(PAGE);
  const migration = source(MIGRATION);
  const runbook = source(RUNBOOK);

  check(serviceSource.trimStart().startsWith('/** Guarded server-only data access') &&
    serviceSource.includes('import "server-only";'), true,
  "admin analytics data access is explicitly server-only");
  check(serviceSource.indexOf("await requireAdmin()") < serviceSource.indexOf('.from("ai_usage_events")'), true,
    "the authoritative admin guard runs before privileged data access");
  check(pageSource.includes("createClient") || pageSource.includes("supabaseAdmin") ||
    pageSource.includes('.from("ai_usage_events")'), false,
  "the Admin AI page cannot issue a direct privileged table query");
  check(pageSource.includes("loadAdminAiAnalytics"), true,
    "the Admin AI page uses the guarded server-only service");
  check(migration.includes("grant select on table public.ai_usage_events to authenticated"), false,
    "B1 does not restore authenticated analytics access");
  check(migration.includes("grant select, insert on table public.ai_usage_events to service_role"), true,
    "B1 retains the narrow server-side analytics and usage-event path");

  guardedService = require(SERVICE);
  sequence.length = 0;
  const result = await guardedService.loadAdminAiAnalytics();
  check(sequence.slice(0, 2), ["guard", "query"], "real admin path authorizes before querying");
  check(result.ok, true, "authorized admin receives analytics");
  check(Object.keys(result.data.events[0]).sort(), [
    "createdAt", "estimatedCost", "featureType", "id", "inputTokens", "model", "outputTokens",
    "plan", "totalTokens",
  ], "admin browser DTO contains only allowlisted fields");
  check(selectedColumns.includes("user_id") || selectedColumns.includes("provider_private_detail"), false,
    "privileged query requests only fields required by the UI");
  check(JSON.stringify(result).includes(fixture.user_id) ||
    JSON.stringify(result).includes(fixture.provider_private_detail), false,
  "the admin payload excludes owner identity and private provider details");

  for (const deniedIdentity of ["member", "deleted"]) {
    identity = deniedIdentity;
    const beforeQueries = queryCalls;
    await assert.rejects(() => guardedService.loadAdminAiAnalytics(),
      error => error?.message === (deniedIdentity === "deleted" ? "deleted_user" : "not_admin"));
    assertions++;
    check(queryCalls, beforeQueries, `${deniedIdentity} identity cannot reach service-role data access`);
  }

  identity = "admin";
  databaseResult = { data: null, error: { message: "private database diagnostic" } };
  const failed = await guardedService.loadAdminAiAnalytics();
  check(failed, { ok: false, code: "ADMIN_AI_ANALYTICS_UNAVAILABLE" },
    "database failures become a fixed admin-safe result");

  databaseResult = { data: [fixture], error: null };
  const Page = require(PAGE).default;
  const markup = renderToStaticMarkup(await Page());
  check(markup.includes("AI Analytics") && markup.includes("fixture-model") && markup.includes("200"), true,
    "Admin AI page renders the guarded analytics DTO");
  check(markup.includes(fixture.user_id) || markup.includes(fixture.provider_private_detail), false,
    "rendered Admin AI output excludes non-allowlisted privileged data");
  check(pageSource.includes("SUPABASE_SERVICE_ROLE_KEY") ||
    serviceSource.includes("SUPABASE_SERVICE_ROLE_KEY"), false,
  "service-role credential names do not enter the page or analytics service source");

  for (const required of [
    "B3 MUST NOT be applied through Supabase GitHub Integration",
    "npx --no-install supabase@2.110.0 db push",
    "indisvalid",
    "indisready",
    "migration ledger",
  ]) {
    check(runbook.includes(required), true, `B3 runbook records ${required}`);
  }

  process.stdout.write(`Admin AI guarded-path contracts PASS (${assertions} assertions)\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.stack || "admin_ai_analytics_contract_failed"}\n`);
  process.exitCode = 1;
});
