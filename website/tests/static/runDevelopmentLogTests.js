#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");

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

const data = readText("lib/developmentLog.ts");
const page = readText("app/development-log/page.tsx");
const nav = readText("app/components/PublicNavbar.tsx");
const footer = readText("app/components/PublicFooter.tsx");
const sitemap = readText("app/sitemap.ts");
const routeAccess = readText("lib/auth/routeAccess.ts");
const motion = readText("app/components/LandingMotion.tsx");

const publicSurface = `${data}\n${page}`;
const prohibited = [
  /\bPhase\s+\d+/i,
  /\bcommit\b/i,
  /\bdpl_[A-Za-z0-9]+/i,
  /\bVercel\b/i,
  /\bSupabase\b/i,
  /\bLINUX_[A-Z0-9_]+\b/,
  /\bvalidator\b/i,
  /\bdiagnostic code\b/i,
  /\bprompt\b/i,
  /\bmodel response\b/i,
  /\bhidden contract\b/i,
  /\banswer key\b/i,
  /\bAPI key\b/i,
  /\bbearer\b/i,
  /\bJWT\b/i,
  /C:\\Users\\/i,
];

assert("development log route exists", fs.existsSync(path.join(ROOT, "app/development-log/page.tsx")));
assert("development log uses source-controlled release data", page.includes("sortedDevelopmentLogEntries") && data.includes("DEVELOPMENT_LOG_ENTRIES"));
assert(
  "development log has page metadata",
  page.includes("export const metadata") &&
    page.includes("publicPageMetadata") &&
    page.includes('path: "/development-log"'),
);
assert("development log is classified public", /PUBLIC_ROUTES[\s\S]*"\/development-log"/.test(routeAccess));
assert("development log content does not depend on page-local reveal", !page.includes('import { Reveal } from "../components/LandingMotion"') && !page.includes("<Reveal"));
assert("existing Reveal primitive respects reduced motion", motion.includes("useReducedMotion") && motion.includes("duration: reducedMotion ? 0"));
assert("development log has no duplicate public nav link", (nav.match(/href: "\/development-log"/g) || []).length === 1);
assert("desktop and mobile public nav include Development Log", nav.includes('{ label: "Development Log", href: "/development-log", summary: "Public product updates" }'));
assert("footer includes Development Log", footer.includes('["Development Log", "/development-log"]'));
assert("sitemap includes Development Log", sitemap.includes('"/development-log"'));
assert("development log has safe empty state", page.includes("No public development updates are available yet."));
assert("development log renders newest-first sorted entries", data.includes("sortedDevelopmentLogEntries") && data.includes("right.date.localeCompare(left.date)"));
assert("development log references private beta without finality claims", /private beta/i.test(publicSurface) && !/\bfinal release\b/i.test(publicSurface));
assert("development log includes Linux investigation engine refinement entry", /date: "2026-09-07"[\s\S]*title: "Linux investigation engine refinement"/.test(data));
assert("development log Linux refinement entry is newest", data.indexOf('title: "Linux investigation engine refinement"') < data.indexOf('title: "Signed-in workspace refinement"'));
assert("development log Linux refinement entry explains supported duration boundary", /Fifteen-minute investigations are now limited to Beginner difficulty[\s\S]*Intermediate and Advanced investigations require at least 30 minutes/.test(data));
assert("development log Linux refinement entry uses fewer checklist bullets", (data.match(/Linux investigation engine refinement[\s\S]*?improvements: \[[\s\S]*?\]/) || [""])[0].split("\n").filter((line) => line.trim().startsWith('"')).length <= 2);
assert("development log includes signed-in workspace refinement entry", /date: "2026-09-06"[\s\S]*title: "Signed-in workspace refinement"/.test(data));
assert("development log signed-in workspace entry remains above password recovery", data.indexOf('title: "Signed-in workspace refinement"') < data.indexOf('title: "Password recovery reliability improvements"'));
assert("development log signed-in workspace entry uses fewer checklist bullets", (data.match(/Signed-in workspace refinement[\s\S]*?improvements: \[[\s\S]*?\]/) || [""])[0].split("\n").filter((line) => line.trim().startsWith('"')).length <= 2);
assert("development log includes password recovery reliability entry", /date: "2026-09-05"[\s\S]*title: "Password recovery reliability improvements"/.test(data));
assert("development log password recovery entry avoids implementation terms", !/PKCE|auth code|token exchange|callback internals|Supabase internals|recovery marker|session cleanup/i.test((data.match(/Password recovery reliability improvements[\s\S]*?improvements: \[[\s\S]*?\]/) || [""])[0]));
assert("development log password recovery entry uses fewer checklist bullets", (data.match(/Password recovery reliability improvements[\s\S]*?improvements: \[[\s\S]*?\]/) || [""])[0].split("\n").filter((line) => line.trim().startsWith('"')).length <= 2);
assert("development log includes public interface stability entry", /title: "Public interface stability fixes"/.test(data));
assert("development log public interface stability entry is not duplicated", (data.match(/title: "Public interface stability fixes"/g) || []).length === 1);
assert("development log public stability entry is dated today", /date: "2026-08-28"[\s\S]*title: "Public interface stability fixes"/.test(data));
assert("development log includes public experience refinement entry", /title: "Public experience refinement"/.test(data));
assert("development log public stability entry remains above public experience entry", data.indexOf('title: "Public interface stability fixes"') < data.indexOf('title: "Public experience refinement"'));
assert("development log public experience entry remains near top", data.indexOf('title: "Public experience refinement"') < data.indexOf('title: "Lab feedback and reporting"'));
assert("development log public experience entry stays concise", (data.match(/Public experience refinement[\s\S]*?improvements: \[[\s\S]*?\]/) || [""])[0].split("\n").filter((line) => line.trim().startsWith('"')).length <= 3);
assert("development log includes lab feedback release entry", /title: "Lab feedback and reporting"/.test(data));
assert("development log includes current Linux reliability entry", /Linux investigations are clearer and more dependable/.test(data));
for (const pattern of prohibited) {
  assert(`development log omits prohibited internal pattern ${pattern}`, !pattern.test(publicSurface), pattern.toString());
}
assert("development log uses editorial ledger instead of cards", /border-y border-border bg-white/.test(page) && !/rounded-ui-md|rounded-full|bg-\[#041327\]/.test(page));
assert("development log exposes semantic headings", /<h1/.test(page) && /<h2/.test(page) && /<h3/.test(page));
assert("development log uses accessible time and category text", /<time dateTime=/.test(page) && /entry.categories.join/.test(page));

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
