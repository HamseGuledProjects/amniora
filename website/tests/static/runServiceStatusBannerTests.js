#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function loadServiceStatusModule() {
  const source = readText("lib/serviceStatus.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    process: { env: {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    AbortController,
    URL,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(output, sandbox, { filename: "serviceStatus.ts" });
  return sandbox.module.exports;
}

const serviceStatus = readText("lib/serviceStatus.ts");
const route = readText("app/api/service-status/route.ts");
const banner = readText("components/layout/ServiceStatusBanner.tsx");
const nav = readText("app/components/PublicNavbar.tsx");
const region = readText("components/layout/GlobalStatusRegion.tsx");
const developmentBanner = readText("components/layout/DevelopmentBanner.tsx");
const layout = readText("app/layout.tsx");
const globals = readText("app/globals.css");
const { classifySupabaseStatus } = loadServiceStatusModule();

function classify(summary, probe = "healthy") {
  return classifySupabaseStatus(summary, probe, "2026-08-28T12:00:00.000Z");
}

const healthy = classify({ components: [{ name: "Auth", status: "operational" }, { name: "API", status: "operational" }], incidents: [] });
assert("healthy status is silent", healthy.status === "healthy" && healthy.message === null && healthy.detail === null, JSON.stringify(healthy));

const authIncident = classify({ components: [{ name: "Auth", status: "degraded_performance" }], incidents: [] });
assert("relevant Auth incident shows banner", authIncident.status === "degraded" && authIncident.source === "official_status" && /account features/.test(authIncident.message || ""), JSON.stringify(authIncident));

const apiIncident = classify({ components: [{ name: "API Gateway", status: "partial_outage" }], incidents: [] });
assert("API Gateway incident alone does not show account banner", apiIncident.status === "healthy" && apiIncident.message === null, JSON.stringify(apiIncident));

const unresolvedIncident = classify({ components: [], incidents: [{ name: "Authentication latency", status: "investigating", components: [] }] });
assert("relevant unresolved incident name shows banner", unresolvedIncident.status === "degraded", JSON.stringify(unresolvedIncident));

const authComponentIncident = classify({ components: [], incidents: [{ name: "Service disruption", status: "investigating", components: [{ name: "Auth", status: "partial_outage" }] }] });
assert("relevant Auth incident component shows banner", authComponentIncident.status === "degraded", JSON.stringify(authComponentIncident));

const unrelatedIncident = classify({ components: [{ name: "Storage", status: "partial_outage" }], incidents: [{ name: "Storage uploads delayed", status: "investigating", components: [{ name: "Storage", status: "partial_outage" }] }] });
assert("unrelated Supabase incident stays silent", unrelatedIncident.status === "healthy" && unrelatedIncident.message === null, JSON.stringify(unrelatedIncident));

const projectFailure = classify({ components: [{ name: "Auth", status: "operational" }], incidents: [] }, "infrastructure_failure");
assert("repeated project infrastructure failure shows banner", projectFailure.status === "degraded" && projectFailure.source === "project_health", JSON.stringify(projectFailure));

const unknown = classify(null, "unknown");
assert("status API unavailable is unknown and silent", unknown.status === "unknown" && unknown.message === null, JSON.stringify(unknown));

const recovered = classify({ components: [{ name: "Auth", status: "operational" }, { name: "API", status: "operational" }], incidents: [] }, "healthy");
assert("recovery returns healthy and clears message", recovered.status === "healthy" && recovered.message === null, JSON.stringify(recovered));

assert("service status utility uses official Supabase Statuspage summary API", serviceStatus.includes("https://status.supabase.com/api/v2/summary.json"));
assert("service status utility has bounded public status timeout", serviceStatus.includes("STATUS_TIMEOUT_MS = 3_500") && serviceStatus.includes("AbortController"));
assert("project health probe has strict timeout", serviceStatus.includes("PROJECT_HEALTH_TIMEOUT_MS = 2_500"));
assert("project probe uses existing public runtime configuration only", serviceStatus.includes("NEXT_PUBLIC_SUPABASE_URL") && serviceStatus.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY") && !serviceStatus.includes("SERVICE_ROLE") && !serviceStatus.includes("SUPABASE_SERVICE_ROLE"));
assert("project probe does not attempt login or mutation", !/signIn|signUp|resetPassword|insert|update|delete|rpc/i.test(serviceStatus));
assert("project probe treats only infrastructure failures as degraded", serviceStatus.includes("response.status >= 500") && !serviceStatus.includes("response.status === 401") && !serviceStatus.includes("response.status === 403"));
assert("project probe requires repeated failure before degradation", serviceStatus.includes("PROJECT_FAILURE_STREAK_THRESHOLD = 2") && serviceStatus.includes("projectHealthFailureStreak"));
assert("healthy state returns no message", /status:\s*summary \? "healthy" : "unknown"[\s\S]*message:\s*null/.test(serviceStatus));
assert("unknown status returns no banner message", serviceStatus.includes('status: summary ? "healthy" : "unknown"') && serviceStatus.includes("message: null"));
assert("relevant Auth incidents are detected", serviceStatus.includes("\\bauth\\b") && serviceStatus.includes("authentication"));
assert("API Gateway incidents are not treated as account auth status", !serviceStatus.includes("api gateway") && !serviceStatus.includes('normalized === "api"') && serviceStatus.includes("authentication"));
assert("unrelated incidents are ignored by relevant-name predicate", serviceStatus.includes("isRelevantSupabaseName") && serviceStatus.includes("componentRelevant || textRelevant"));
assert("degraded copy is learner-safe and restrained", serviceStatus.includes("Some account features are temporarily unavailable") && serviceStatus.includes("Login and account access may be affected"));
assert("copy omits Supabase project details and technical errors", !/project ref|portfoliofixturebbbb|HTTP 5|auth\/v1\/settings/i.test(`${banner}\n${route}`));
assert("route returns safe unknown response on monitor failure", route.includes('status: "unknown"') && route.includes("status: 200") && !route.includes("console."));
assert("route is dynamic and browser-safe", route.includes('dynamic = "force-dynamic"') && route.includes("NextResponse.json"));
assert("client polls Amniora endpoint rather than Statuspage", banner.includes('fetch("/api/service-status"') && !banner.includes("status.supabase.com"));
assert("client polling is restrained", banner.includes("DEFAULT_POLL_MS = 180_000") && banner.includes("MIN_POLL_MS = 120_000") && banner.includes("MAX_POLL_MS = 300_000"));
assert("healthy banner renders nothing", banner.includes('if (status?.status !== "degraded" || !status.message) return null'));
assert("service status API failure does not preserve stale outage", banner.includes('setStatus({ status: "unknown" })') && !banner.includes('current?.status === "degraded"'));
assert("recovery can clear the banner", banner.includes('nextStatus === "healthy"') && banner.includes("clearDismissal()") && banner.includes("setStatus(nextPayload)"));
assert("banner uses accessible status semantics", banner.includes('role="status"') && banner.includes('aria-label="Account service status"') && banner.includes("aria-live"));
assert("service warning has accessible local dismissal", banner.includes('aria-label="Dismiss service status warning"') && banner.includes("DISMISSAL_TTL_MS = 60 * 60 * 1000") && banner.includes("window.localStorage.setItem") && !banner.includes("createClient"));
assert("service banner has dedicated data marker", banner.includes("data-service-status-banner"));
assert("global status region keeps banners in normal document flow", region.includes("data-global-status-region") && !region.includes("sticky") && !region.includes("ResizeObserver") && !region.includes("development-banner-resize"));
assert("global status region does not rewrite navbar offsets", !region.includes("document.documentElement.style.setProperty") && !region.includes("--development-banner-height"));
assert("public navbar uses fixed sticky top independent of banner measurement", nav.includes("sticky top-0") && !nav.includes("top-[var(--development-banner-height)]") && !/addEventListener\(\s*"resize"/.test(nav) && !nav.includes("ResizeObserver") && !nav.includes("useLayoutEffect") && globals.includes("--public-navbar-height: 4rem") && globals.includes("--public-mobile-header-height: var(--public-navbar-height)"));
assert("layout uses single global status region", layout.includes("GlobalStatusRegion") && !layout.includes("DevelopmentBanner />"));
assert("private beta banner no longer owns global height measurement", !developmentBanner.includes("--development-banner-height") && !developmentBanner.includes("ResizeObserver"));
assert("private beta and service status coexist in one region", region.includes("<DevelopmentBanner />") && region.includes("<ServiceStatusBanner />"));
assert("service status styling is restrained", globals.includes(".service-status-banner") && globals.includes("border-bottom") && globals.includes("var(--color-warning-subtle)") && !globals.includes("service-status-banner__modal") && !globals.includes("animate-pulse"));
assert("mobile service status has compact responsive adjustment", globals.includes("@media (max-width: 430px)") && globals.includes(".service-status-banner"));

for (const pattern of [
  /OPENAI_API_KEY/i,
  /SUPABASE_SERVICE_ROLE/i,
  /SENTRY_AUTH_TOKEN/i,
  /authorization:/i,
  /bearer\s+[A-Za-z0-9._-]+/i,
  /password\s*[:=]/i,
  /project ref/i,
  /raw model response/i,
  /assessment contract/i,
]) {
  assert(`service status implementation omits secret/internal pattern ${pattern}`, !pattern.test(`${serviceStatus}\n${route}\n${banner}`), pattern.toString());
}

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
