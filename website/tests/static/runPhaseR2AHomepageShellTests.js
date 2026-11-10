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

const home = readText("app/page.tsx");
const nav = readText("app/components/PublicNavbar.tsx");
const footer = readText("app/components/PublicFooter.tsx");
const banner = readText("components/layout/DevelopmentBanner.tsx");
const cookieConsent = readText("app/components/CookieConsent.tsx");
const sitemap = readText("app/sitemap.ts");
const routeAccess = readText("lib/auth/routeAccess.ts");
const seo = readText("lib/seo.ts");
const productDemo = readText("app/components/ProductProofDemo.tsx");
const homepageProofSource = `${home}\n${productDemo}`;

for (const pattern of [
  /Build practical cybersecurity judgement\./,
  /Learn through guided practice, realistic synthetic investigations/,
  /structured feedback designed to help you reason through evidence/,
  /Product tour/,
  /See Amniora in motion\./,
  /Guidance and grading/,
  /controlled by the platform/,
  /Private beta access is limited/,
  /Ready to investigate/,
  /Difficulty changes the investigation work/,
]) assert(`homepage includes ${pattern}`, pattern.test(homepageProofSource));

for (const label of ["Dashboard", "Generate", "Investigate"]) {
  assert(`product tour act label exists ${label}`, homepageProofSource.includes(label));
}
for (const staleLabel of ["Task answer", "Evidence ZIP", "Export"]) {
  assert(`rejected product tour label absent ${staleLabel}`, !productDemo.includes(staleLabel));
}
for (const label of ["Beginner", "Intermediate", "Advanced"]) assert(`difficulty label exists ${label}`, homepageProofSource.includes(label));
for (const evidence of ["assets/docs/change_request.md", "assets/scheduled/cron.d/platform-sync"]) {
  assert(`safe synthetic evidence appears ${evidence}`, homepageProofSource.includes(evidence));
}
assert("product teaser omits larger evidence pack", !productDemo.includes("maintenance_ticket.md") && !productDemo.includes("process_execution_history"));

for (const needle of ['href="/signup"', 'href="/labs"', 'href="/beta-access"', 'href="/development-log"']) {
  assert(`homepage link exists ${needle}`, home.includes(needle));
}
for (const route of ["/features", "/labs", "/roadmap", "/pricing", "/development-log", "/about"]) {
  assert(`navigation route exists ${route}`, nav.includes(`href: "${route}"`));
}
for (const route of ["/features", "/labs", "/roadmap", "/pricing", "/development-log", "/beta-access", "/about", "/contact", "/privacy", "/terms", "/cookies", "/login", "/signup"]) {
  assert(`footer route exists ${route}`, footer.includes(`"${route}"`));
}

assert("mobile menu focus trap preserved", nav.includes('event.key === "Escape"') && nav.includes('event.key !== "Tab"') && nav.includes('aria-modal="true"'));
assert("mobile scroll lock preserved", nav.includes("preventBackgroundScroll") && nav.includes("touchmove") && nav.includes("wheel"));
assert("touch targets remain at least 44px", nav.includes("min-h-11") && nav.includes("h-11 w-11"));
assert("mobile menu honors reduced motion", nav.includes("useReducedMotion") && nav.includes("reducedMotion ? 0"));
assert("mobile menu publishes local layer state", nav.includes("publicNavigationOpen") && nav.includes("amniora-public-navigation-open-change"));
assert("cookie consent listens to menu layer state", cookieConsent.includes("publicNavigationOpen") && cookieConsent.includes("amniora-public-navigation-open-change"));
assert("cookie panel yields while mobile menu is open", cookieConsent.includes("isVisible && !publicNavigationOpen") && cookieConsent.includes("preferencesOpen && !publicNavigationOpen"));
for (const label of ["Accept All", "Reject Non-Essential", "Manage Preferences", "Save Preferences"]) assert(`cookie control preserved ${label}`, cookieConsent.includes(label));
for (const route of ["/privacy", "/cookies"]) assert(`cookie policy link preserved ${route}`, cookieConsent.includes(`href="${route}"`));
assert("nav stays compact and grounded", nav.includes("border-b border-border bg-paper") && !nav.includes("backdrop-blur-xl") && !nav.includes("rounded-2xl"));
assert("footer retains public beta truth", footer.includes("Private Beta") && footer.includes("Use synthetic data only"));
assert("footer does not add giant CTA", !/Start building|Get started free|Try Amniora now/i.test(footer));
assert("banner keeps exact permanent private beta warning", banner.includes("Private Beta \u2014") && banner.includes("Do not enter sensitive, confidential, or production information."));
assert("banner has controlled disclosure", banner.includes("aria-expanded") && banner.includes("beta-warning__details") && !banner.includes("animate-pulse") && !banner.includes("marquee") && !banner.includes("backdrop-blur"));

const redesignedSources = `${home}\n${nav}\n${footer}\n${banner}`;
for (const pattern of [/Investigate\.\s*Learn\.\s*Master\./, /Powerful/i, /Seamless/i, /Revolutionary/i, /customers/i, /testimonial/i, /trusted by/i, /99%/, /10x/i, /fake terminal/i, /shadow-2xl/i, /rounded-3xl/i, /bokeh/i, /gradient-orb/i, /backdrop-blur-xl/i]) {
  assert(`prohibited marketing pattern absent ${pattern}`, !pattern.test(redesignedSources), pattern.toString());
}

assert("homepage avoids generic feature-card array", !home.includes("const features =") && !home.includes("AI Investigation Labs"));
assert("homepage exposes compact responsive GSAP product teaser", home.includes("ProductProofDemo") && productDemo.includes("data-product-proof=\"compact-gsap-tour\"") && productDemo.includes("gsap.timeline") && productDemo.includes("gsap.matchMedia") && productDemo.includes("data-tour-mode") && productDemo.includes("product-tour__mobile-shell") && productDemo.includes("role=\"tablist\"") && productDemo.includes("aria-selected") && productDemo.includes("Pause") && productDemo.includes("Restart"));
assert("homepage limits exact Private Beta repetition", (home.match(/Private Beta/g) || []).length === 0);
assert("desktop hero uses product-left copy-right composition", home.includes("homepage-hero__grid") && home.indexOf("homepage-hero__copy") < home.indexOf("homepage-hero__product") && readText("app/globals.css").includes("grid-template-columns: minmax(0, 64fr) minmax(20rem, 36fr)"));
assert("homepage hero uses natural content height", readText("app/globals.css").includes(".homepage-hero .layout-workspace") && readText("app/globals.css").includes("min-height: auto") && !readText("app/globals.css").includes("--homepage-hero-offset"));
assert("homepage hero vertically centers product and copy", readText("app/globals.css").includes(".homepage-hero__grid") && readText("app/globals.css").includes("align-items: center") && readText("app/globals.css").includes("align-self: center"));
assert("homepage tablet keeps full product tour", productDemo.includes("(min-width: 601px)") && readText("app/globals.css").includes("@media (min-width: 601px) and (max-width: 1099px)"));
assert("homepage uses measured cursor geometry", productDemo.includes("data-cursor-geometry=\"measured-clamped\"") && productDemo.includes("ResizeObserver") && productDemo.includes("timeline.invalidate()"));
assert("homepage removes scroll cue entirely", !homepageProofSource.includes("HomepageScrollCue") && !homepageProofSource.includes("Scroll to explore") && !homepageProofSource.includes("data-scroll-cue") && !readText("app/globals.css").includes("homepage-scroll-cue") && !readText("app/globals.css").includes("homepage-hero__scroll-cue") && home.includes("id=\"investigation-loop\""));
assert("product teaser uses real transparent light brand mark", productDemo.includes("BrandLogo") && productDemo.includes("theme=\"dark\"") && readText("app/components/BrandLogo.tsx").includes("/brand/amniora-icon-white-cropped.png") && !productDemo.includes(">A</div>") && readText("app/globals.css").includes("background: transparent !important"));
assert("phone teaser has no cursor dependency", productDemo.includes("MobileDashboardStep") && productDemo.includes("MobileGenerateStep") && productDemo.includes("MobileInvestigateStep") && productDemo.includes("(max-width: 600px)") && readText("app/globals.css").includes(".product-tour__cursor,") && readText("app/globals.css").includes("display: none !important"));
assert("homepage avoids decorative beta badges", (home.match(/<Badge/g) || []).length === 0 && !home.includes('from "./components/ui/Badge"'));
assert("homepage replaces difficulty cards with comparison structure", homepageProofSource.includes("Evidence volume") && homepageProofSource.includes("Task output") && homepageProofSource.includes("Confidence and limits") && !home.includes("<Card key={item.level}"));
assert("homepage keeps one hero signup conversion", (home.match(/href="\/signup"/g) || []).length === 1);
assert("homepage keeps one explore-labs action", (home.match(/href="\/labs"/g) || []).length === 1);
assert("homepage final section does not repeat hero CTA cluster", !home.includes("Start with a guided investigation, then build from evidence."));
assert("hero primary CTA has computed-style probe marker", home.includes("data-primary-hero-cta"));
assert("technical values use wrapping helper", homepageProofSource.includes("technical-value"));
assert("homepage keeps public metadata path", home.includes("publicPageMetadata") && home.includes('path: "/"'));
assert("SEO helper remains available", seo.includes("publicPageMetadata"));
assert("design-system absent from public shell", !home.includes("/design-system") && !nav.includes("/design-system") && !footer.includes("/design-system"));
assert("design-system absent from sitemap", !sitemap.includes("/design-system"));
assert("design-system remains production guarded", routeAccess.includes("AMNIORA_ENABLE_DESIGN_SYSTEM_QA") && routeAccess.includes('process.env.NODE_ENV !== "production"'));
assert("QA flag is not public", !routeAccess.includes("NEXT_PUBLIC_") && !readText("app/design-system/page.tsx").includes("NEXT_PUBLIC_"));

for (const pattern of [/OPENAI_API_KEY/i, /SUPABASE_SERVICE_ROLE/i, /SENTRY_AUTH_TOKEN/i, /authorization:/i, /bearer\s+[A-Za-z0-9._-]+/i, /assessment contract/i, /answer key/i, /canonical hidden/i]) {
  assert(`public shell omits internal pattern ${pattern}`, !pattern.test(redesignedSources), pattern.toString());
}

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
