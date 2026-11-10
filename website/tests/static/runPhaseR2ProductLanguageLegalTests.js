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
const demo = readText("app/components/ProductProofDemo.tsx");
const banner = readText("components/layout/DevelopmentBanner.tsx");
const globals = readText("app/globals.css");
const contentPage = readText("app/components/public/PublicContentPage.tsx");
const privacy = readText("app/privacy/page.tsx");
const terms = readText("app/terms/page.tsx");
const cookies = readText("app/cookies/page.tsx");
const publicCopy = [
  home,
  demo,
  readText("app/features/page.tsx"),
  readText("app/labs/page.tsx"),
  readText("app/about/page.tsx"),
  readText("app/pricing/page.tsx"),
  readText("app/roadmap/page.tsx"),
  readText("app/development-log/page.tsx"),
  readText("app/contact/page.tsx"),
  readText("app/beta-access/page.tsx"),
  privacy,
  terms,
  cookies,
].join("\n");

assert("Product tour uses compact GSAP contract", demo.includes('data-product-proof="compact-gsap-tour"') && demo.includes('import { gsap } from "gsap"') && demo.includes('useGSAP'));
assert("Product tour owns one master GSAP timeline", demo.includes("gsap.timeline") && demo.includes("timelineRef") && demo.includes("repeat: -1") && demo.includes("addLabel(\"dashboard\"") && demo.includes("addLabel(\"generate\"") && demo.includes("addLabel(\"progress\"") && demo.includes("addLabel(\"investigation\""));
assert("Product tour has exactly three acts", /const controls = \[[\s\S]*Dashboard[\s\S]*Generate[\s\S]*Investigate[\s\S]*\] as const/.test(demo) && !demo.includes("chapterStops") && !demo.includes("chapter-strip"));
assert("Product tour no longer uses slideshow timers", !demo.includes("setTimeout") && !demo.includes("tourSteps") && !demo.includes("chapterStops") && !demo.includes("currentStep"));
assert("Product tour uses public teaser framing", demo.includes("Product tour") && demo.includes("See Amniora in motion.") && demo.includes("Generate a lab, open it, and start investigating evidence.") && demo.includes("Mobile dashboard summary") && demo.includes("Open investigation"));
assert("Product tour starts and pauses from browser state", demo.includes("IntersectionObserver") && demo.includes("visibilitychange") && demo.includes("document.hidden") && demo.includes("timeline.pause()"));
assert("Product tour has pause play restart controls", demo.includes("aria-pressed") && demo.includes("Pause") && demo.includes("Play") && demo.includes("Restart"));
assert("Product tour supports keyboard act navigation", demo.includes("ArrowDown") && demo.includes("ArrowRight") && demo.includes("Home") && demo.includes("End") && demo.includes("role=\"tablist\"") && demo.includes("role=\"tab\""));
assert("Product tour reduced motion is immediate and nonessential", demo.includes("prefers-reduced-motion: reduce") && demo.includes("display: \"none\"") && globals.includes("prefers-reduced-motion: reduce") && globals.includes(".product-tour__cursor"));
assert("Product tour cursor is GSAP controlled, measured and decorative", demo.includes("moveCursor") && demo.includes("targetPoint") && demo.includes("ResizeObserver") && demo.includes("data-cursor-geometry=\"measured-clamped\"") && demo.includes("aria-hidden=\"true\"") && demo.includes("gsap.matchMedia") && globals.includes("pointer-events: none") && globals.includes("display: none !important"));
assert("Product tour uses persistent desktop and mobile shells", demo.includes("product-tour__frame") && demo.includes("product-tour__sidebar") && demo.includes("product-tour__topbar") && demo.includes("product-tour__stage") && demo.includes("product-tour__mobile-shell"));
assert("Product tour keeps scenes mounted", demo.includes("DashboardAct") && demo.includes("GenerateAct") && demo.includes("InvestigateAct") && !demo.includes("return current") && !demo.includes("current.body"));
assert("Product tour uses compact bounded responsive dimensions", globals.includes("--tour-frame-height: clamp(20rem, 36vw, 22.5rem)") && globals.includes("max-width: min(100%, 58rem)") && globals.includes("overflow: hidden") && globals.includes("@media (min-width: 601px) and (max-width: 1099px)"));
assert("Product tour uses dark analytical workspace", globals.includes("#071425") && globals.includes("#081728") && globals.includes("#06111f") && !globals.includes("large cream"));
assert("Product tour allows only one light evidence preview", globals.includes(".product-tour__evidence-preview") && globals.includes("#d8e2e8") && !demo.includes("product-tour__paper"));
assert("Product tour uses real product terminology", demo.includes("Generate New Lab") && demo.includes("Generate Lab") && demo.includes("Saved Investigation") && demo.includes("AI Tutor"));
assert("Product tour limits evidence to task-local visible references", (demo.match(/assets\//g) || []).length <= 5 && demo.includes("assets/docs/change_request.md") && demo.includes("assets/scheduled/cron.d/platform-sync") && !demo.includes("process_execution_history"));
assert("Product tour does not show a completed learner answer", !demo.includes("Task answer") && !demo.includes("finding") && !demo.includes("graded") && !demo.includes("Evidence ZIP") && !demo.includes("PDF") && !demo.includes("Export"));
assert("Product tour excludes Settings", !demo.includes("Settings"));
assert("Product tour does not import authenticated data or APIs", !demo.includes("createClient") && !demo.includes("fetch(") && !demo.includes("/api/") && !demo.includes("Supabase"));
assert("Product tour uses one immutable synthetic fixture and actual logo", demo.includes("const fixture") && demo.includes("as const") && demo.includes("synthetic data") && demo.includes("BrandLogo") && !demo.includes(">A</div>"));
assert("dark-surface logos use white cropped icon asset", readText("app/components/BrandLogo.tsx").includes("/brand/amniora-icon-white-cropped.png") && !readText("app/components/BrandLogo.tsx").includes("/brand/amniora-icon-white.png") && readText("app/components/auth/AuthShell.tsx").includes("<BrandLogo size=\"lg\" theme=\"dark\" />"));
assert("cropped white icon derivative exists", require("fs").existsSync(require("path").join(ROOT, "public/brand/amniora-icon-white-cropped.png")) && readText("public/brand/README.md").includes("amniora-icon-white-cropped.png"));
const brandCssBlock = globals.match(/\.product-tour__brand \{[\s\S]*?\}/g)?.join("\n") || "";
assert("demo logo remains transparent on navy", brandCssBlock.includes("background: transparent") && brandCssBlock.includes("border: 0") && !brandCssBlock.includes("background: #d8e2e8") && !brandCssBlock.includes("border: 1px"));
assert("Product tour does not mix Framer Motion", !demo.includes("framer-motion") && !demo.includes("<motion"));

assert("Beta warning collapsed text is concise", banner.includes("Data may reset. Use synthetic, non-sensitive information only."));
assert("Beta warning exposes expanded state", banner.includes("aria-expanded") && banner.includes("aria-controls"));
assert("Beta warning has smooth details class", banner.includes("beta-warning__details") && globals.includes("grid-template-rows"));
assert("Beta warning has hide control", banner.includes("Hide"));
assert("Beta warning keeps original safety meaning", banner.includes("Do not enter sensitive, confidential, or production information."));

assert("Legal shell uses navy header", contentPage.includes("bg-investigation") && contentPage.includes("Last updated /"));
assert("Legal contents rail has wider desktop column", contentPage.includes("lg:grid-cols-[18rem_minmax(0,1fr)]"));
assert("Legal contents avoids internal scrollbar trap", !contentPage.includes("lg:max-h-[56vh]") && !contentPage.includes("lg:overflow-y-auto"));
assert("Legal sections use numbered markers", contentPage.includes("data-section-number") && globals.includes("legal-section::before"));
assert("Legal mobile index remains page-scroll friendly", globals.includes("legal-index__list"));
assert("Legal note remains non-advice", privacy.includes("not a substitute for advice") && terms.includes("not a substitute for advice"));

for (const pattern of [
  /connected primitives/i,
  /task-local/i,
  /deterministic boundaries/i,
  /uncertainty boundary/i,
  /analytical depth/i,
  /dependency chain/i,
  /server-controlled/i,
  /optional sharing of API inputs/i,
  /Stripe/i,
  /presented as/i,
  /\\bstructured\\s+as\\b/i,
  /product surfaces/i,
  /generic software claims/i,
  /verified sending domain/i,
  /does not create a fake inbox/i,
  /permanent public contract/i,
]) assert(`public copy avoids ${pattern}`, !pattern.test(publicCopy), pattern.toString());

assert("Legal review still required for future analytics/payments statements", /analytics cookies in the future/i.test(cookies) && /paid plans in the future/i.test(terms));

assert("homepage cue remains absent after product-language pass", !readText("app/components/ProductProofDemo.tsx").includes("HomepageScrollCue") && !readText("app/components/ProductProofDemo.tsx").includes("data-scroll-cue") && !readText("app/globals.css").includes("homepage-scroll-cue"));
assert("homepage demo fixture stays compact", readText("app/components/ProductProofDemo.tsx").includes("Linux Cron Review") && readText("app/components/ProductProofDemo.tsx").includes("Compare the cron definition with the change record.") && !readText("app/components/ProductProofDemo.tsx").includes("maintenance_ticket.md"));

console.log(JSON.stringify({ passed: true, assertions }, null, 2));