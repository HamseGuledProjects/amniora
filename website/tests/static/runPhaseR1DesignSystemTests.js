#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

const globals = readText("app/globals.css");
const card = readText("app/components/ui/Card.tsx");
const badge = readText("app/components/ui/Badge.tsx");
const button = readText("app/components/ui/Button.tsx");
const input = readText("app/components/ui/Input.tsx");
const textarea = readText("app/components/ui/Textarea.tsx");
const select = readText("app/components/ui/Select.tsx");
const foundations = readText("app/components/ui/Foundations.tsx");
const qaRoute = readText("app/design-system/page.tsx");
const nav = readText("app/components/PublicNavbar.tsx");
const footer = readText("app/components/PublicFooter.tsx");
const sitemap = readText("app/sitemap.ts");
const routeAccess = readText("lib/auth/routeAccess.ts");

const tokenNames = [
  "--color-paper",
  "--color-paper-muted",
  "--color-paper-inset",
  "--color-ink",
  "--color-graphite",
  "--color-slate",
  "--color-mist",
  "--color-surface-elevated",
  "--color-surface-inset",
  "--color-border-subtle",
  "--color-primary-line",
  "--color-primary-muted",
  "--color-heading",
  "--color-verified",
  "--color-needs-review",
  "--color-blocked",
  "--color-private-beta",
  "--color-evidence-log",
  "--color-evidence-config",
  "--color-evidence-policy",
  "--color-evidence-data",
  "--radius-ui-2",
  "--radius-ui-4",
  "--radius-ui-6",
  "--radius-ui-8",
  "--spacing-density-compact",
  "--container-workspace",
  "--duration-standard",
];

for (const token of tokenNames) {
  assert(`semantic token exists ${token}`, globals.includes(token));
}

const compatibilityTokens = [
  "--color-app-bg",
  "--color-surface",
  "--color-border",
  "--color-primary",
  "--color-text",
  "--radius-ui-sm",
  "--shadow-surface",
  "--spacing-space-4",
];
for (const token of compatibilityTokens) {
  assert(`compatibility token remains ${token}`, globals.includes(token));
}

assert("layout helper classes exist", globals.includes(".layout-public") && globals.includes(".layout-workspace") && globals.includes(".layout-dashboard"));
assert("technical wrapping helper exists", globals.includes(".technical-value") && globals.includes("overflow-wrap: anywhere"));
assert("task typography helper exists", globals.includes(".type-task-title") && globals.includes("letter-spacing: 0"));
assert("reduced motion safeguard exists", globals.includes("prefers-reduced-motion: reduce") && globals.includes("transition-duration: 1ms"));

assert("Card keeps public variant prop", /type CardVariant = "default" \| "hover" \| "selected" \| "disabled"/.test(card));
assert("Card adds optional density without changing default", card.includes("density?: CardDensity") && card.includes('density = "standard"'));
assert("Card exposes density data attribute", card.includes("data-density={density}"));
assert("Badge keeps legacy variants", /"neutral"[\s\S]*"primary"[\s\S]*"success"[\s\S]*"warning"[\s\S]*"error"/.test(badge));
assert("Badge adds status and evidence variants", badge.includes('"verified"') && badge.includes('"needsReview"') && badge.includes('"evidencePolicy"'));
assert("Button API remains compatible", button.includes("loading?: boolean") && button.includes("leadingIcon?: ReactNode") && button.includes('variant = "primary"'));
assert("form primitives retain field state", input.includes("export type FieldState") && textarea.includes("fieldState?: FieldState") && select.includes("fieldState?: FieldState"));
assert("form primitives add optional density", input.includes("density?: FieldDensity") && textarea.includes("density?: FieldDensity") && select.includes("density?: FieldDensity"));
assert("error state public API remains untouched", exists("app/components/ui/ErrorState.tsx"));

const foundationExports = [
  "EvidenceReference",
  "TaskRequirement",
  "InvestigationStatus",
  "MetadataList",
  "FindingPanel",
  "BetaNotice",
  "AdminDataTable",
];
for (const exportName of foundationExports) {
  assert(`foundation export exists ${exportName}`, foundations.includes(`export function ${exportName}`));
}
assert("foundations are server-compatible", !foundations.includes('"use client"') && !foundations.includes("'use client'"));
assert("foundations are presentation-only", !/from "\.\.\/\.\.\/lib\/lab-assets\/linux/.test(foundations) && !/from "@\/lib\/lab-assets\/linux/.test(foundations));
assert("admin table uses semantic table structure", foundations.includes("<table") && foundations.includes("<caption") && foundations.includes('scope="col"'));
assert("metadata list uses semantic dl", foundations.includes("<dl") && foundations.includes("<dt") && foundations.includes("<dd"));
assert("beta notice uses aside", foundations.includes("export function BetaNotice") && foundations.includes("<aside"));

assert("QA harness route exists", exists("app/design-system/page.tsx"));
assert("QA harness is production disabled", qaRoute.includes("notFound()") && qaRoute.includes("NODE_ENV") && qaRoute.includes("AMNIORA_ENABLE_DESIGN_SYSTEM_QA"));
assert("QA harness is noindex", qaRoute.includes("robots") && qaRoute.includes("index: false") && qaRoute.includes("follow: false"));
assert("QA harness uses synthetic content", qaRoute.includes("Synthetic") && qaRoute.includes("qa-case-001"));
assert("QA harness is not in public nav", !nav.includes("/design-system") && !footer.includes("/design-system"));
assert("QA harness is not in sitemap", !sitemap.includes("/design-system"));
assert("QA route is local flag only", routeAccess.includes("DESIGN_SYSTEM_QA_PATH") && routeAccess.includes("AMNIORA_ENABLE_DESIGN_SYSTEM_QA") && routeAccess.includes("process.env.NODE_ENV !== \"production\""));
assert("QA route does not use public environment flag", !routeAccess.includes("NEXT_PUBLIC_") && !qaRoute.includes("NEXT_PUBLIC_"));
assert("QA route remains absent from public routes", !/PUBLIC_ROUTES[\s\S]*\/design-system/.test(routeAccess));
assert("QA production guard is server-owned", qaRoute.includes("process.env.AMNIORA_ENABLE_DESIGN_SYSTEM_QA") && qaRoute.includes("notFound()"));
assert("QA page requires non-production and server flag", /process\.env\.NODE_ENV !== "production"\s*&&\s*process\.env\.AMNIORA_ENABLE_DESIGN_SYSTEM_QA === "1"/.test(qaRoute));

const guardedSources = `${globals}\n${foundations}\n${qaRoute}`;
const prohibitedVisualPatterns = [
  /bg-gradient/i,
  /gradient-orb/i,
  /backdrop-blur/i,
  /shadow-2xl/i,
  /rounded-3xl/i,
  /cyberpunk/i,
  /bokeh/i,
];
for (const pattern of prohibitedVisualPatterns) {
  assert(`generic visual pattern absent ${pattern}`, !pattern.test(guardedSources), pattern.toString());
}

const prohibitedPublicTerms = [
  /OPENAI_API_KEY/i,
  /SUPABASE_SERVICE_ROLE/i,
  /SENTRY_AUTH_TOKEN/i,
  /authorization:/i,
  /bearer\s+[A-Za-z0-9._-]+/i,
];
for (const pattern of prohibitedPublicTerms) {
  assert(`QA source omits secret-like pattern ${pattern}`, !pattern.test(qaRoute), pattern.toString());
}

console.log(JSON.stringify({ passed: true, assertions }, null, 2));