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

const publicRoutes = [
  ["/features", "app/features/page.tsx"],
  ["/labs", "app/labs/page.tsx"],
  ["/about", "app/about/page.tsx"],
  ["/pricing", "app/pricing/page.tsx"],
  ["/roadmap", "app/roadmap/page.tsx"],
  ["/development-log", "app/development-log/page.tsx"],
  ["/contact", "app/contact/page.tsx"],

  ["/privacy", "app/privacy/page.tsx"],
  ["/terms", "app/terms/page.tsx"],
  ["/cookies", "app/cookies/page.tsx"],
];

const nav = readText("app/components/PublicNavbar.tsx");
const footer = readText("app/components/PublicFooter.tsx");
const productPage = readText("app/components/public/ProductPage.tsx");
const contentPage = readText("app/components/public/PublicContentPage.tsx");
const routeAccess = readText("lib/auth/routeAccess.ts");
const sitemap = readText("app/sitemap.ts");
const robots = readText("app/robots.ts");
const authShell = readText("app/components/auth/AuthShell.tsx");
const login = readText("app/login/page.tsx");
const signup = readText("app/signup/page.tsx");
const forgot = readText("app/forgot-password/page.tsx");
const reset = readText("app/reset-password/page.tsx");
const betaPage = readText("app/beta-access/page.tsx");
const betaForm = readText("app/beta-access/BetaAccessForm.tsx");
const dashboard = readText("app/dashboard/page.tsx");
const dashboardPanels = readText("app/dashboard/_components/DashboardPanels.tsx");
const savedInvestigation = readText("app/dashboard/saved/[id]/page.tsx");
const sidebar = readText("app/components/Sidebar.tsx");
const globals = readText("app/globals.css");
const home = readText("app/page.tsx");
const productDemo = readText("app/components/ProductProofDemo.tsx");
const allPublic = publicRoutes.map(([, file]) => readText(file)).join("\n") + nav + footer + productPage + contentPage;

for (const [route, file] of publicRoutes) {
  const source = readText(file);
  assert(`${route} exports metadata`, source.includes("publicPageMetadata"));
  assert(`${route} canonical path is preserved`, source.includes(`path: "${route}"`));
  assert(`${route} has crawlable heading shell`, /ProductHero|PublicContentPage|<h1\b/.test(source));
  assert(`${route} is in public route access`, routeAccess.includes(`"${route}"`));
  assert(`${route} is in sitemap`, sitemap.includes(route === "/" ? 'path: ""' : `path: "${route}"`));
}

for (const route of ["/features", "/labs", "/roadmap", "/pricing", "/development-log", "/about"]) {
  assert(`desktop nav includes ${route}`, nav.includes(`href: "${route}"`));
}
for (const route of ["/beta-access", "/login", "/signup"]) {
  assert(`nav action includes ${route}`, nav.includes(`href="${route}"`));
}
assert("nav has active page state", nav.includes("usePathname") && nav.includes("aria-current") && nav.includes("isCurrent"));
assert("shared action system is used across public CTAs", globals.includes(".ui-action-dark-primary") && readText("app/page.tsx").includes("ui-action-dark-primary") && productPage.includes("ui-action-primary") && nav.includes("ui-action-primary"));
assert("homepage hero uses compact natural navy section", globals.includes("background: #071426") && globals.includes(".homepage-hero .layout-workspace") && globals.includes("min-height: auto") && !globals.includes("--homepage-hero-offset"));
assert("homepage cursor geometry is measured and clamped", productDemo.includes("ResizeObserver") && productDemo.includes("data-cursor-geometry=\"measured-clamped\"") && productDemo.includes("clamp(x, 4, maxX)"));
assert("product tour repeat boundary does not kill its own tweens", productDemo.includes("repeatRefresh: true") && productDemo.includes("resetAnimatedElements({ clearTweens: false })") && productDemo.includes("if (clearTweens) killAndClearTargets(animatedTargets())"));
assert("homepage scroll cue is fully removed", !productDemo.includes("HomepageScrollCue") && !productDemo.includes("homepage-scroll-cue") && !productDemo.includes("data-scroll-cue") && !home.includes("Scroll to explore") && !globals.includes("homepage-scroll-cue") && !globals.includes("homepage-hero__scroll-cue"));
assert("product tour exposes selectable controls", productDemo.includes("role=\"tablist\"") && productDemo.includes("aria-selected") && productDemo.includes("Restart") && home.includes("data-primary-hero-cta"));
assert("product teaser uses persistent responsive dark application shell", productDemo.includes("data-product-proof=\"compact-gsap-tour\"") && productDemo.includes("product-tour__frame") && productDemo.includes("product-tour__sidebar") && productDemo.includes("product-tour__topbar") && productDemo.includes("product-tour__mobile-shell") && productDemo.includes("gsap.matchMedia") && globals.includes("#081728"));
assert("compact product journey state is explicit", productDemo.includes("Demonstration uses synthetic data.") && productDemo.includes("Learning workspace") && productDemo.includes("Preparing lab") && productDemo.includes("Ready to investigate") && productDemo.includes("Open investigation") && productDemo.includes("gsap.timeline") && !productDemo.includes("manualIdleMs"));
assert("motion tokens are centralized", globals.includes("--duration-deliberate") && globals.includes("--ease-premium") && globals.includes("--motion-page-proof"));
assert("mobile nav has summaries", nav.includes("Method and boundaries") && nav.includes("Evidence index"));
assert("mobile focus trap and scroll lock preserved", nav.includes('event.key === "Escape"') && nav.includes('event.key !== "Tab"') && nav.includes("preventBackgroundScroll"));
assert("cookie collision event remains", nav.includes("amniora-public-navigation-open-change"));
assert("design system is never linked", !nav.includes("/design-system") && !footer.includes("/design-system") && !sitemap.includes("/design-system"));
assert("homepage hero is demo-left on desktop and copy-first on mobile", home.includes("homepage-hero__grid") && home.indexOf("homepage-hero__copy") < home.indexOf("homepage-hero__product") && globals.includes("grid-template-columns: minmax(0, 64fr) minmax(20rem, 36fr)"));
assert("phone product teaser excludes cursor dependency", productDemo.includes("MobileDashboardStep") && productDemo.includes("MobileGenerateStep") && productDemo.includes("MobileInvestigateStep") && productDemo.includes("(max-width: 600px)") && globals.includes(".product-tour__cursor,") && globals.includes("display: none !important"));
assert("dark-surface auth and demo logos use white icon", readText("app/components/BrandLogo.tsx").includes("/brand/amniora-icon-white-cropped.png") && authShell.includes("<BrandLogo size=\"lg\" theme=\"dark\" />") && productDemo.includes("<BrandLogo variant=\"icon\" theme=\"dark\" size=\"md\" />") && authShell.includes("auth-mobile-brand"));
assert("light navigation keeps navy logo mapping", readText("app/components/BrandLogo.tsx").includes("/brand/amniora-icon-navy-cropped.png") && nav.includes("theme=\"light\""));
assert("auth shell uses evidence-led split composition", authShell.includes("auth-page-shell") && authShell.includes("auth-proof-shell") && authShell.includes("Evidence-led access") && authShell.includes("auth-form-panel"));
assert("auth shell keeps accessible loading status", authShell.includes('role="status"') && authShell.includes('aria-busy="true"') && authShell.includes("Confirming the account session") && authShell.includes('data-authenticated-loading-shell') && authShell.includes("bg-[#0c1828]"));
assert("auth forms expose deliberate pending labels", login.includes("Signing in…") && signup.includes("Creating account…") && forgot.includes("Sending reset link…") && reset.includes("Updating password…"));
assert("auth forms keep account behaviour calls", login.includes("signInWithPassword") && signup.includes("auth.signUp") && forgot.includes("resetPasswordForEmail") && reset.includes("updateUser({ password })"));
assert("auth forms keep permanent labels and password controls", login.includes('htmlFor="login-email"') && signup.includes('htmlFor="signup-email"') && readText("app/components/auth/PasswordField.tsx").includes("aria-pressed"));
assert("beta gate keeps established secure behaviour with polished state", betaPage.includes('redirect("/login?next=/beta-access")') && betaForm.includes('.rpc("redeem_beta_access"') && betaForm.includes("Verifying key…") && betaPage.includes("Private beta gate"));
assert("dashboard uses investigation-first authenticated workspace", dashboard.includes('data-dashboard-phase="investigation-first"') && dashboardPanels.includes('data-dashboard-region="current-investigation"') && dashboardPanels.includes('data-dashboard-record="investigation"'));
assert("dashboard preserves connected progress and milestone surfaces", dashboardPanels.includes("CapabilityDevelopment") && dashboardPanels.includes("MilestoneActivity") && dashboardPanels.includes('role="progressbar"'));
assert("saved investigation uses numbered case structure", savedInvestigation.includes("case-step-marker") && savedInvestigation.includes("01") && savedInvestigation.includes('step="02"') && savedInvestigation.includes('step="03"'));
assert("saved investigation preserves downloads feedback and grading", savedInvestigation.includes("downloadEvidencePack") && savedInvestigation.includes("downloadInvestigationPdf") && savedInvestigation.includes("LabFeedbackCard") && savedInvestigation.includes("linux-grading"));
assert("sidebar keeps links while sharpening active state", sidebar.includes("sidebar-active-line") && ["/dashboard", "/dashboard/tutor", "/dashboard/labs", "/dashboard/saved", "/dashboard/roadmap", "/dashboard/progress", "/dashboard/settings"].every((route) => sidebar.includes(route)));

for (const route of ["/features", "/labs", "/roadmap", "/pricing", "/development-log", "/beta-access", "/about", "/contact", "/privacy", "/terms", "/cookies", "/login", "/signup"]) {
  assert(`footer includes ${route}`, footer.includes(`"${route}"`));
}
assert("footer keeps beta safety context", footer.includes("Private Beta") && footer.includes("Use synthetic data only"));
assert("footer adds restrained mobile separation before link groups", footer.includes("gap-y-space-6 pt-space-4 sm:grid-cols-3 md:pt-0"));
assert("footer avoids oversized CTA language", !/Try Amniora now|Start building|Book a demo/i.test(footer));

for (const file of ["app/features/page.tsx", "app/labs/page.tsx", "app/about/page.tsx", "app/pricing/page.tsx", "app/roadmap/page.tsx", "app/contact/page.tsx"]) {
  assert(`${file} uses shared public shell`, readText(file).includes("ProductPageShell"));
}
assert("legal pages use improved content shell", contentPage.includes("layout-workspace") && contentPage.includes("max-w-3xl"));
assert("product pages use evidence-led primitives", productPage.includes("ProductEvidenceTable") && productPage.includes("ProductNumberedList"));
assert("feature page explains how labs work", readText("app/features/page.tsx").includes("How labs work") && readText("app/features/page.tsx").includes("Each lab follows a practical case flow."));
assert("feature page describes real investigation tools", readText("app/features/page.tsx").includes("Investigation tools") && readText("app/features/page.tsx").includes("Task evidence scope") && readText("app/features/page.tsx").includes("Work through investigations using scoped evidence") && !readText("app/features/page.tsx").includes("ProductFeatureGrid"));
assert("labs page explains lab structure", readText("app/labs/page.tsx").includes("Lab structure") && readText("app/labs/page.tsx").includes("A lab gives you a case brief, evidence and tasks."));
assert("labs page uses guidance and evidence scope without course marketplace grid", readText("app/labs/page.tsx").includes("Guidance") && readText("app/labs/page.tsx").includes("Use the right evidence for each claim") && !readText("app/labs/page.tsx").includes("ProductFeatureGrid"));
assert("pricing retains Pro price unpublished", readText("app/pricing/page.tsx").includes("Price to be announced"));
assert("pricing has mobile-first plan rows", readText("app/pricing/page.tsx").includes("sm:hidden") && readText("app/pricing/page.tsx").includes("Current plan access comparison") && readText("app/pricing/page.tsx").includes("Private beta access is limited."));
assert("roadmap explains availability without release dates", readText("app/roadmap/page.tsx").includes("Follow a clear sequence of learning areas.") && readText("app/roadmap/page.tsx").includes("completed, current and upcoming"));
assert("roadmap uses restrained availability model", readText("app/roadmap/page.tsx").includes("Availability") && readText("app/roadmap/page.tsx").includes("Now") && readText("app/roadmap/page.tsx").includes("Next") && readText("app/roadmap/page.tsx").includes("Later"));
assert("beta key form remains delegated behind auth", readText("app/beta-access/page.tsx").includes("<BetaAccessForm") && readText("app/beta-access/page.tsx").includes('redirect("/login?next=/beta-access")') && !readText("app/beta-access/page.tsx").includes("ProductPageShell"));
assert("contact form remains disabled", readText("app/contact/page.tsx").includes("<fieldset disabled") && !readText("app/contact/page.tsx").includes("<form"));
assert("contact email remains non-clickable", readText("app/contact/page.tsx").includes("contact@auth.portfolio.example.test") && !readText("app/contact/page.tsx").includes("mailto:"));
assert("reveal keeps content visible before observer", !readText("app/components/LandingMotion.tsx").includes("opacity: 0"));
assert("pricing comparison is paired not wide table only", readText("app/pricing/page.tsx").includes("Plan comparison") && !readText("app/pricing/page.tsx").includes("ProductEvidenceTable"));
const fivePublicPages = ["app/features/page.tsx", "app/labs/page.tsx", "app/roadmap/page.tsx", "app/pricing/page.tsx", "app/about/page.tsx"].map(readText).join("\n");
for (const pattern of [/presented as/i, /\\bstructured\\s+as\\b/i, /product surfaces/i, /generic software claims/i, /visual system/i, /product language/i, /interface pattern/i, /this page/i, /this section/i, /the design should/i, /without invented prediction metrics/i, /permanent public contract/i, /current beta information/i, /status labels help/i, /more learning areas can be added/i]) {
  assert(`five public pages omit design-commentary phrase ${pattern}`, !pattern.test(fivePublicPages), pattern.toString());
}
const auditedPublicCopy = fivePublicPages + readText("app/contact/page.tsx") + readText("app/beta-access/page.tsx") + readText("app/privacy/page.tsx");
for (const pattern of [/does not create a fake inbox/i, /verified sending domain/i, /support boundary/i, /this address/i, /this page is intentionally/i, /page states/i, /development log access from this gate/i]) {
  assert(`audited public pages omit internal-support phrase ${pattern}`, !pattern.test(auditedPublicCopy), pattern.toString());
}
assert("development log uses ledger without rounded category pills", readText("app/development-log/page.tsx").includes("border-y border-border bg-white") && !readText("app/development-log/page.tsx").includes("rounded-full"));
assert("about page replaces platform card grid with product ledger", readText("app/about/page.tsx").includes("Current platform") && readText("app/about/page.tsx").includes("Casework") && readText("app/about/page.tsx").includes("Boundary") && !readText("app/about/page.tsx").includes("ProductFeatureGrid"));
assert("authenticated beta route is not public or sitemap advertised", !(routeAccess.match(/const PUBLIC_ROUTES = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "").includes('"/beta-access"') && routeAccess.includes('return "beta"') && !sitemap.includes('path: "/beta-access"'));
assert("contact form is secondary to support paths", readText("app/contact/page.tsx").indexOf("Current support paths") < readText("app/contact/page.tsx").indexOf("Message form preview"));
assert("beta access gate states appear before form", readText("app/beta-access/page.tsx").indexOf("State") < readText("app/beta-access/page.tsx").indexOf("<BetaAccessForm"));
assert("mobile evidence table has stacked rows", productPage.includes("sm:hidden") && productPage.includes("sm:block") && productPage.includes("grid grid-cols-[7.5rem_minmax(0,1fr)]"));

for (const pattern of [
  /trusted by/i,
  /testimonial/i,
  /99%/,
  /10x/i,
  /fake terminal/i,
  /cyberpunk/i,
  /neon/i,
  /glassmorphism/i,
  /backdrop-blur-xl/i,
  /rounded-3xl/i,
  /gradient-orb/i,
  /\/api\//,
  /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE|SENTRY_AUTH_TOKEN|RESEND_API_KEY/,
  /assessment contract|answer key|model response|raw prompt|canonical hidden/i,
  /LINUX_[A-Z0-9_]+/,
  /dpl_[A-Za-z0-9]+/,
  /C:\\Users\\/i,
]) {
  assert(`public R2B surface omits prohibited pattern ${pattern}`, !pattern.test(allPublic), pattern.toString());
}

assert("robots still blocks private areas", ["/admin/", "/api/", "/dashboard/", "/login", "/signup"].every((route) => robots.includes(route)));
assert("design-system remains production guarded", routeAccess.includes("AMNIORA_ENABLE_DESIGN_SYSTEM_QA") && routeAccess.includes('process.env.NODE_ENV !== "production"'));
assert("QA flag is server-only", !routeAccess.includes("NEXT_PUBLIC_") && !readText("app/design-system/page.tsx").includes("NEXT_PUBLIC_"));

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
