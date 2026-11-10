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

const canonicalOrigin = "https://portfolio.example.test";
const publicRoutes = ["/", "/about", "/features", "/labs", "/pricing", "/roadmap", "/development-log", "/contact", "/privacy", "/terms", "/cookies"];
const privateRoutes = ["/dashboard", "/dashboard/saved", "/dashboard/settings", "/admin", "/admin/feedback", "/api/ai/generate-lab", "/login", "/signup", "/forgot-password", "/reset-password", "/callback", "/beta-access"];
const pageFiles = {
  "/": "app/page.tsx",
  "/about": "app/about/page.tsx",
  "/features": "app/features/page.tsx",
  "/labs": "app/labs/page.tsx",
  "/pricing": "app/pricing/page.tsx",
  "/roadmap": "app/roadmap/page.tsx",
  "/development-log": "app/development-log/page.tsx",
  "/contact": "app/contact/page.tsx",
  "/privacy": "app/privacy/page.tsx",
  "/terms": "app/terms/page.tsx",
  "/cookies": "app/cookies/page.tsx",
};

const brand = readText("lib/brand.ts");
const seo = readText("lib/seo.ts");
const layout = readText("app/layout.tsx");
const sitemap = readText("app/sitemap.ts");
const robots = readText("app/robots.ts");
const nextConfig = readText("next.config.ts");
const manifest = readText("app/manifest.ts");
const routeAccess = readText("lib/auth/routeAccess.ts");
const betaAccessPage = readText("app/beta-access/page.tsx");
const nav = readText("app/components/PublicNavbar.tsx");
const footer = readText("app/components/PublicFooter.tsx");
const publicPageSeoSurface = [brand, seo, layout, sitemap, manifest, ...Object.values(pageFiles).map(readText), nav, footer].join("\n");

assert("canonical brand origin is www", brand.includes('url: "https://portfolio.example.test"'));
assert("root metadataBase uses brand url", layout.includes("metadataBase: new URL(BRAND.url)"));
assert("root title names Amniora and investigation labs", layout.includes("Amniora | Hands-on Cybersecurity Investigation Labs"));
assert("root social metadata uses large image card", layout.includes('card: "summary_large_image"') && layout.includes("/brand/amniora-logo.png"));
assert("manifest start URL uses canonical brand URL", manifest.includes("start_url: BRAND.url"));

assert("next config redirects apex to www permanently", nextConfig.includes('type: "host", value: "portfolio.example.test"') && nextConfig.includes('destination: "https://portfolio.example.test/:path*"') && nextConfig.includes("permanent: true"));
assert("dashboard and admin routes receive noindex headers", nextConfig.includes('source: "/dashboard/:path*"') && nextConfig.includes('source: "/admin/:path*"') && nextConfig.includes("X-Robots-Tag"));
assert("api and auth routes receive noindex headers", ["/api/:path*", "/login", "/signup", "/forgot-password", "/reset-password", "/callback"].every((route) => nextConfig.includes(`source: "${route}"`)));

assert("robots references canonical sitemap", robots.includes("`${BRAND.url}/sitemap.xml`"));
assert("robots disallows private application areas", ["/admin/", "/api/", "/dashboard/", "/login", "/signup", "/forgot-password", "/reset-password", "/callback"].every((route) => robots.includes(route)));
assert("robots allows public assets", ["/brand/", "/icons/", "/favicon.ico", "/manifest.webmanifest"].every((route) => robots.includes(route)));

for (const route of publicRoutes) {
  const expectedPath = route === "/" ? 'path: ""' : `path: "${route}"`;
  assert(`sitemap includes public route ${route}`, sitemap.includes(expectedPath), route);
  assert(`routeAccess classifies ${route} as public`, routeAccess.includes(`"${route}"`), route);
}
for (const route of privateRoutes) {
  assert(`sitemap excludes private route ${route}`, !sitemap.includes(`path: "${route}"`) && !sitemap.includes(`${canonicalOrigin}${route}`), route);
}
assert("sitemap uses canonical brand URL and no apex literal", sitemap.includes("BRAND.url") && !sitemap.includes("https://portfolio.example.test"));
assert("sitemap has lastModified values and no future dates", /lastModified: "2026-08-21"/.test(sitemap) && !/2027-/.test(sitemap));
assert("beta access remains linked but not indexed", nav.includes("/beta-access") && footer.includes("/beta-access") && !sitemap.includes("/beta-access"));
assert("beta access route uses canonical metadata but authenticated gate", betaAccessPage.includes("publicPageMetadata") && betaAccessPage.includes('path: "/beta-access"') && betaAccessPage.includes('redirect("/login?next=/beta-access")'));

const metadataTitles = new Map();
const metadataDescriptions = new Map();
for (const [route, file] of Object.entries(pageFiles)) {
  const source = readText(file);
  assert(`${route} uses shared public metadata helper`, source.includes("publicPageMetadata"));
  assert(`${route} has self canonical path`, source.includes(`path: "${route}"`));
  const title = source.match(/title: "([^"]+)"/)?.[1];
  const description = source.match(/description:\s*\r?\n\s*"([^"]+)"/)?.[1];
  assert(`${route} has metadata title`, Boolean(title), file);
  assert(`${route} has metadata description`, Boolean(description), file);
  assert(`${route} description is restrained`, description.length >= 70 && description.length <= 180, `${description.length}`);
  metadataTitles.set(title, (metadataTitles.get(title) || 0) + 1);
  metadataDescriptions.set(description, (metadataDescriptions.get(description) || 0) + 1);
}
assert("public page titles are unique", [...metadataTitles.values()].every((count) => count === 1));
assert("public page descriptions are unique", [...metadataDescriptions.values()].every((count) => count === 1));

assert("structured data includes only Organization and WebSite", seo.includes('"@type": "Organization"') && seo.includes('"@type": "WebSite"') && !/Review|AggregateRating|FAQPage|Person/.test(seo));
assert("structured data is emitted with JSON stringify", layout.includes('type="application/ld+json"') && layout.includes("JSON.stringify([organizationJsonLd, websiteJsonLd])"));
assert("structured data uses canonical URL and logo", seo.includes("BRAND.url") && seo.includes("/brand/amniora-logo.png"));

const prohibitedPublicPatterns = [
  /CyberLab/i,
  /dpl_[A-Za-z0-9]+/,
  /portfoliofixturebbbb/,
  /202608\d+_.*\.sql/,
  /lab_feedback|lab_complaints/,
  /\/api\//,
  /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY/,
  /Authorization:\s*Bearer/i,
  /assessmentContract|hidden contract|answer key|raw prompt|model response/i,
  /LINUX_[A-Z0-9_]+/,
  /C:\\Users\\/i,
];
for (const pattern of prohibitedPublicPatterns) {
  assert(`public SEO surface omits prohibited pattern ${pattern}`, !pattern.test(publicPageSeoSurface), pattern.toString());
}

assert("homepage has exactly one visible h1", (readText("app/page.tsx").match(/<h1\b/g) || []).length === 1);
for (const [route, file] of Object.entries(pageFiles)) {
  const source = readText(file);
  assert(`${route} has crawlable heading text`, /<h1\b|ProductHero[\s\S]*title=|PublicContentPage[\s\S]*title=/.test(source), file);
}
assert("social image is png and publicly referenced", publicPageSeoSurface.includes("/brand/amniora-logo.png") && !publicPageSeoSurface.includes("opengraph-image.svg"));

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
