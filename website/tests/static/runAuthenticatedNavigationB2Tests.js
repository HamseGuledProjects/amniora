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

const sidebar = readText("app/components/Sidebar.tsx");
const navConfig = readText("app/components/navigation/authNavigation.ts");
const appShell = readText("app/components/shell/AppShell.tsx");
const tutorPage = readText("app/dashboard/tutor/page.tsx");
const savedDetail = readText("app/dashboard/saved/[id]/page.tsx");

assert(
  "desktop sidebar advertises B.2 craft boundary without changing width model",
  sidebar.includes('data-authenticated-sidebar-craft="phase-b2"') &&
    sidebar.includes('collapsed ? "w-[72px]" : "w-64"') &&
    sidebar.includes("transition-[width] duration-200")
);

assert(
  "brand region has compact divider and integrated collapse control",
  sidebar.includes("data-authenticated-sidebar-brand") &&
    sidebar.includes("border-b border-white/10 pb-4") &&
    sidebar.includes("min-h-14 items-center justify-between gap-3") &&
    sidebar.includes("border border-white/10 bg-white/[0.03]") &&
    sidebar.includes('aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}')
);

assert(
  "desktop navigation rows have stable craft geometry",
  sidebar.includes("data-authenticated-sidebar-link={link.id}") &&
    sidebar.includes('data-authenticated-sidebar-link-active={active ? "true" : "false"}') &&
    sidebar.includes("min-h-11") &&
    sidebar.includes("overflow-hidden rounded-[3px] border px-2.5 py-2") &&
    sidebar.includes('collapsed ? "justify-center" : "gap-2.5"')
);

assert(
  "active state is restrained and keeps the B.1 active line",
  sidebar.includes("sidebar-active-line border-cyan-200/16 bg-cyan-100/[0.08] text-white") &&
    sidebar.includes("border-cyan-200/20 bg-cyan-200/10 text-cyan-100") &&
    sidebar.includes("border-transparent text-slate-300 hover:border-white/10 hover:bg-sidebar-elevated hover:text-white")
);

assert(
  "icon column is consistent and decorative",
  sidebar.includes("data-authenticated-sidebar-icon") &&
    sidebar.includes("flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border transition-colors") &&
    sidebar.includes('<Icon size={17} aria-hidden="true" />')
);

assert(
  "long labels and long account data remain safe",
  navConfig.includes('label: "Generate Investigation"') &&
    navConfig.includes('label: "Saved Investigations"') &&
    sidebar.includes('<span className="min-w-0 truncate">{link.label}</span>') &&
    sidebar.includes("flex min-w-0 items-center gap-2.5") &&
    sidebar.includes('<p className="type-card-title truncate text-sidebar-text">') &&
    sidebar.includes('<p className="truncate text-xs text-sidebar-text-muted">')
);

assert(
  "account and logout region stay pinned and visually secondary",
  sidebar.includes('data-authenticated-sidebar-account') &&
    sidebar.includes("mt-4 shrink-0 border-t border-white/10 pt-3") &&
    sidebar.includes('data-authenticated-sidebar-profile') &&
    sidebar.includes("border border-red-400/25 bg-red-950/10 text-sm text-red-300") &&
    sidebar.includes("await supabase.auth.signOut()") &&
    sidebar.includes('router.push("/login")')
);

assert(
  "sidebar scalability keeps only the middle navigation scrollable",
  sidebar.includes("data-authenticated-sidebar-nav") &&
    sidebar.includes("min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain") &&
    sidebar.includes("data-authenticated-sidebar-account") &&
    !/data-authenticated-sidebar[^>]*overflow-y-auto/.test(sidebar)
);

assert(
  "B.2 does not introduce grouping headers or fake products",
  !/Core|Account|Admin|Reports|Billing|Team|Integrations/.test(navConfig) &&
    !/CORE|INVESTIGATIONS|LEARNING/.test(sidebar)
);

assert(
  "B.1 route matching remains authoritative",
  navConfig.includes("export function isAuthNavigationItemActive") &&
    navConfig.includes('if (item.match === "exact") return pathname === item.href') &&
    navConfig.includes("pathname === item.href || pathname.startsWith(`${item.href}/`)") &&
    sidebar.includes("isAuthNavigationItemActive(link, pathname)")
);

assert(
  "desktop accessibility remains intact",
  sidebar.includes('aria-label="Primary navigation"') &&
    sidebar.includes('aria-current={active ? "page" : undefined}') &&
    sidebar.includes("aria-label={collapsed ? link.label : undefined}") &&
    sidebar.includes("focus-visible:ring-2 focus-visible:ring-focus") &&
    sidebar.includes('aria-hidden="true"')
);

assert(
  "motion stays restrained and avoids transition-all",
  !sidebar.includes("transition-all") &&
    sidebar.includes("transition-colors") &&
    sidebar.includes("transition-[width]")
);

assert(
  "mobile drawer still consumes shared config without visual redesign markers",
  (sidebar.match(/authNavigationItems\.map/g) || []).length === 2 &&
    sidebar.includes("closeMobileMenu({ restoreFocus: false })") &&
    sidebar.includes("data-authenticated-mobile-drawer") &&
    sidebar.includes("fixed left-0 top-0 z-[80] flex h-dvh w-[88dvw] max-w-[336px]")
);

assert(
  "AppShell, AI Tutor and Saved Investigation scroll architecture remain untouched",
  appShell.includes("fixed inset-0") &&
    appShell.includes("data-authenticated-main-region") &&
    appShell.includes("overflow-y-auto overflow-x-clip") &&
    tutorPage.includes("data-ai-tutor-transcript") &&
    tutorPage.includes("overscroll-contain overflow-y-auto") &&
    savedDetail.includes('data-saved-investigation-page="dark-continuous"')
);

console.log(
  `Authenticated Navigation B.2 tests passed (${assertions} assertions).`
);
