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
  if (specifier === "@/lib/supabase/server") {
    return { createClient: async () => { throw new Error("not_used_by_boot_contract"); } };
  }
  return originalLoad.call(this, specifier, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(`${path.join(ROOT, "lib")}${path.sep}`)) {
    throw new Error("scoped_typescript_load_denied");
  }
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText, filename);
};

const security = require(path.join(SOURCE, "production-security-controls.ts"));
const { SentryWebLabAlertSink } = require(path.join(SOURCE, "production-alerts.ts"));

let assertions = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions++;
}
async function rejects(work, predicate, message) {
  await assert.rejects(work, predicate, message);
  assertions++;
}

async function assertRule(surface, expected) {
  check(security.EARLY_ACCESS_PRODUCTION_RATE_RULES[surface], expected,
    `${surface} uses the approved production limit and fixed window`);
  let now = 1_800_000_000_000;
  const policy = new security.InMemoryDistributedAbusePolicy(
    security.EARLY_ACCESS_PRODUCTION_RATE_RULES,
    () => now,
  );
  const ownerId = randomUUID();
  const requestFingerprint = security.safeRequestFingerprint({ surface });
  for (let index = 0; index < expected.limit; index++) {
    await policy.assertAllowed({
      ownerId,
      surface,
      idempotencyKey: `approved_${surface}_${index}`,
      requestFingerprint,
    });
  }
  await rejects(() => policy.assertAllowed({
    ownerId,
    surface,
    idempotencyKey: `approved_${surface}_denied`,
    requestFingerprint,
  }), error => error?.code === "RATE_LIMITED", `${surface} denies request limit plus one`);
  now += expected.windowMs;
  await policy.assertAllowed({
    ownerId,
    surface,
    idempotencyKey: `approved_${surface}_new_window`,
    requestFingerprint,
  });
  assertions++;
}

async function main() {
  const hour = 60 * 60_000;
  const tenMinutes = 10 * 60_000;
  await assertRule("runner_package", { limit: 20, windowMs: hour });
  await assertRule("my_vm_enrollment", { limit: 5, windowMs: hour });
  await assertRule("runtime_launch", { limit: 4, windowMs: hour });
  await assertRule("runtime_reset", { limit: 6, windowMs: hour });
  await assertRule("runtime_grade", { limit: 30, windowMs: tenMinutes });
  await assertRule("launch_exchange", { limit: 30, windowMs: tenMinutes });

  const missing = new security.InMemoryDistributedAbusePolicy({});
  await rejects(() => missing.assertAllowed({
    ownerId: randomUUID(),
    surface: "runtime_launch",
    idempotencyKey: "missing_rule",
    requestFingerprint: "0".repeat(64),
  }), error => error?.code === "CONTROL_UNAVAILABLE", "missing production rule fails closed");
  const malformed = new security.InMemoryDistributedAbusePolicy({
    runtime_launch: { limit: 0, windowMs: hour },
  });
  await rejects(() => malformed.assertAllowed({
    ownerId: randomUUID(),
    surface: "runtime_launch",
    idempotencyKey: "malformed_rule",
    requestFingerprint: "0".repeat(64),
  }), error => error?.code === "CONTROL_UNAVAILABLE", "malformed production rule fails closed");

  const actor = { userId: randomUUID(), sessionId: "authoritative_session" };
  const proEntitlement = new security.PostgresProfileEntitlementPolicy(
    async () => [{ plan: "pro" }],
  );
  check(await proEntitlement.planFor(actor), "pro",
    "entitlement derives Pro from the authoritative server-side profile row");
  const freeEntitlement = new security.PostgresProfileEntitlementPolicy(
    async () => [{ plan: "free" }],
  );
  check(await freeEntitlement.planFor(actor), "free",
    "entitlement derives Free from the authoritative server-side profile row");
  const missingEntitlement = new security.PostgresProfileEntitlementPolicy(async () => []);
  await rejects(() => missingEntitlement.planFor(actor),
    error => error?.code === "CONTROL_UNAVAILABLE",
    "missing authoritative plan fails closed");

  const captured = [];
  const sink = new SentryWebLabAlertSink({
    configured: true,
    client: {
      captureMessage(message, context) { captured.push({ message, context }); return "fixture"; },
      async flush() { return true; },
    },
  });
  await sink.notify({
    code: "RUNNER_OFFLINE",
    stage: "runner",
    surface: "my_vm_enrollment",
    runtimeMode: "byo_runtime",
  });
  check(captured, [{
    message: "WEB_LAB_SECURITY_EVENT:RUNNER_OFFLINE:runner:my_vm_enrollment:byo_runtime",
    context: {
      level: "warning",
      tags: {
        subsystem: "web_lab_runtime",
        error_category: "runner_offline",
        route_family: "runner:my_vm_enrollment:byo_runtime",
      },
    },
  }], "production alert carries fixed safe fields only");

  const failedDelivery = new SentryWebLabAlertSink({
    configured: true,
    client: { captureMessage() { return "fixture"; }, async flush() { return false; } },
  });
  await rejects(() => failedDelivery.notify({ code: "RECONCILIATION_FAILED", stage: "reconciliation" }),
    error => error?.message === "web_lab_alert_delivery_failed",
    "alert delivery failure remains an explicit failure");
  assert.throws(() => new SentryWebLabAlertSink({ configured: false }),
    /web_lab_alert_provider_unconfigured/);
  assertions++;

  const bootstrap = fs.readFileSync(path.join(SOURCE, "production-adapter-bootstrap.ts"), "utf8");
  for (const expected of [
    "EARLY_ACCESS_PRODUCTION_RATE_RULES",
    "PostgresProfileEntitlementPolicy",
    "registerExecutableWebGenerationProductionControls",
    "registerLocalRunnerProductionSecurityControls",
    "registerMyVmProductionSecurityControls",
  ]) {
    check(bootstrap.includes(expected), true, `production bootstrap includes ${expected}`);
  }
  check(bootstrap.includes("registerWebLabProductionAdapters"), false,
    "incomplete Cloud composition is not registered");
  check(bootstrap.includes("process.env.NODE_ENV !== \"production\""), true,
    "production bootstrap cannot run in a non-production process");
  check(bootstrap.includes("max: 1"), true,
    "shared serverless bootstrap uses one application connection per warm instance");
  const bootstrapModule = require(path.join(SOURCE, "production-adapter-bootstrap.ts"));
  check(bootstrapModule.configureAvailablePhase9ProductionAdapters(), false,
    "missing production provider names leave runtime adapters unavailable without crashing boot");

  process.stdout.write(`Production adapter configuration contracts PASS (${assertions} assertions)\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.stack || "production_adapter_configuration_contract_failed"}\n`);
  process.exitCode = 1;
});
