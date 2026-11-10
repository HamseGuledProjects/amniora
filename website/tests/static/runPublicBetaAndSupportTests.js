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

const betaPage = readText("app/beta-access/page.tsx");
const contactPage = readText("app/contact/page.tsx");
const routeAccess = readText("lib/auth/routeAccess.ts");
const sitemap = readText("app/sitemap.ts");
const nav = readText("app/components/PublicNavbar.tsx");
const footer = readText("app/components/PublicFooter.tsx");
const home = readText("app/page.tsx");
const motion = readText("app/components/LandingMotion.tsx");

const publicSurface = [betaPage, contactPage, nav, footer, home].join("\n");
const prohibited = [
  /\bPhase\s+\d+/i,
  /\bcommit\b/i,
  /\bdpl_[A-Za-z0-9]+/i,
  /\brequestId\b/i,
  /\bLINUX_[A-Z0-9_]+\b/,
  /\bdiagnostic\b/i,
  /\bprompt\b/i,
  /\bmodel response\b/i,
  /\bhidden contract\b/i,
  /\banswer key\b/i,
  /\bAPI key\s*[:=]/i,
  /\bbearer\b/i,
  /\bJWT\b/i,
  /C:\\Users\\/i,
];

assert("canonical beta route exists", fs.existsSync(path.join(ROOT, "app/beta-access/page.tsx")));
const publicRoutesBlock = routeAccess.match(/const PUBLIC_ROUTES = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
assert("beta route is classified beta gated", !publicRoutesBlock.includes('"/beta-access"') && routeAccess.includes('return "beta"'));
assert("development log route remains public", publicRoutesBlock.includes('"/development-log"'));
assert(
  "beta page has public metadata and canonical",
  betaPage.includes("export const metadata") &&
    betaPage.includes("publicPageMetadata") &&
    betaPage.includes('path: "/beta-access"'),
);
assert("beta page is not noindexed", !/robots\s*:\s*\{[\s\S]*index:\s*false/.test(betaPage));
assert("beta page uses focused authenticated gate components", betaPage.includes("BrandLogo") && betaPage.includes("<BetaAccessForm") && !betaPage.includes("ProductPageShell"));
assert("beta page content does not depend on page-local reveal", !betaPage.includes('import { Reveal } from "../components/LandingMotion"') && !betaPage.includes("<Reveal"));
assert("existing animation primitive supports reduced motion", motion.includes("useReducedMotion") && motion.includes("duration: reducedMotion ? 0"));
assert("beta page explains private beta access", /Private beta/.test(betaPage) && /existing Amniora private beta key|authenticated session/i.test(betaPage));
assert("beta page says enrolment is coming soon", /New enrolment/i.test(betaPage) && /coming soon/i.test(betaPage));
assert("beta page distinguishes existing key holders", /Existing access/i.test(betaPage) && /existing key/i.test(betaPage));
assert("beta page explains active development", /active development/i.test(betaPage));
assert("beta page warns beta data may reset or delete", /reset or be deleted without notice|change, reset or be deleted/i.test(betaPage));
assert("beta page warns not production-ready", /Synthetic only|Use synthetic data only/i.test(betaPage));
assert("beta page warns against sensitive secrets", /Use synthetic data only/i.test(betaPage));
assert("beta enrolment remains informational", betaPage.includes("New enrolment") && betaPage.includes("Coming soon"));
assert("beta page delegates key entry to focused gate", betaPage.includes("<BetaAccessForm") && betaPage.includes("returnTo={returnTo}"));
assert("beta page itself does not expose key plumbing", !/redeem_beta_access|p_invitation_code|invitationCode/.test(betaPage));
assert("sitemap does not advertise authenticated beta route", !sitemap.includes('"/beta-access"'));
assert("footer links to canonical beta route", footer.includes('["Private beta", "/beta-access"]'));
assert("landing page has private beta CTA", home.includes('href="/beta-access"') && home.includes("Join private beta"));
assert("public nav has one Development Log link", (nav.match(/href: "\/development-log"/g) || []).length === 1);
assert("public nav exposes beta as an action, not primary section", nav.includes("Private beta") && nav.includes("/beta-access") && !nav.includes("href: \"/beta-access\""));
assert("beta access page omits global public navigation shell", !betaPage.includes("ProductPageShell") && !betaPage.includes("PublicNavbar") && !betaPage.includes("PublicFooter"));
assert("contact form shows coming soon", /Send a message[\s\S]*Coming soon/.test(contactPage));
assert("contact unavailable surface has no form submission", !/<form\\b/.test(contactPage) && !/onSubmit=|action=/.test(contactPage));
assert("contact form controls are disabled as a group", /<fieldset disabled aria-disabled="true"/.test(contactPage));
assert("contact unavailable button is disabled", /<Button type="button" disabled aria-disabled="true"/.test(contactPage));
assert("contact identity uses verified auth sending domain", contactPage.includes("contact@auth.portfolio.example.test"));
assert("old contact address is not exposed", !contactPage.includes("contact@portfolio.example.test"));
assert("email support is clearly coming soon", contactPage.includes("Email support coming soon") && contactPage.includes("Email support is coming soon."));
assert("contact identity is non-clickable until inbound support exists", !/mailto:contact@auth\.amniora\.com/.test(contactPage));
assert("support status is not color-only", contactPage.includes('id="contact-form-status"') && contactPage.includes('aria-describedby="contact-form-status"'));
assert("no duplicate beta route files introduced", fs.existsSync(path.join(ROOT, "app/beta-access/page.tsx")) && !fs.existsSync(path.join(ROOT, "app/private-beta/page.tsx")) && !fs.existsSync(path.join(ROOT, "app/join-beta/page.tsx")));
for (const pattern of prohibited) {
  assert(`public beta/support surfaces omit prohibited pattern ${pattern}`, !pattern.test(publicSurface), pattern.toString());
}

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
