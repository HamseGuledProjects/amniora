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
  "mobile drawer keeps the shared B.1 navigation source",
  (sidebar.match(/authNavigationItems\.map/g) || []).length === 2 &&
    (sidebar.match(/isAuthNavigationItemActive\(link, pathname\)/g) || []).length === 2 &&
    navConfig.includes('label: "Generate Investigation"') &&
    navConfig.includes('label: "Saved Investigations"')
);

assert(
  "mobile-only Learning Platform subtitle is removed",
  !sidebar.includes("Learning Platform")
);

assert(
  "mobile drawer uses a fixed shell with a non-scrolling outer container",
  sidebar.includes("data-authenticated-mobile-drawer") &&
    sidebar.includes("fixed left-0 top-0 z-[80] flex h-dvh w-[88dvw] max-w-[336px] flex-col overflow-hidden") &&
    !/data-authenticated-mobile-drawer[^>]*overflow-y-auto/.test(sidebar)
);

assert(
  "mobile drawer has fixed brand flexible nav and pinned account zones",
  sidebar.includes("data-authenticated-mobile-drawer-brand") &&
    sidebar.includes("flex min-h-14 shrink-0 items-center justify-between") &&
    sidebar.includes("data-authenticated-mobile-drawer-nav") &&
    sidebar.includes("mt-4 min-h-0 flex-[0_1_auto] space-y-1 overflow-y-auto overscroll-contain") &&
    sidebar.includes("data-authenticated-mobile-drawer-account") &&
    sidebar.includes("mt-auto shrink-0 border-t border-white/10 pt-3")
);

assert(
  "mobile close control matches the technical desktop control language",
  sidebar.includes("flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border border-white/10 bg-white/[0.03]") &&
    sidebar.includes('aria-label="Close menu"') &&
    sidebar.includes('<X size={19} aria-hidden="true" />')
);

assert(
  "mobile nav rows match the B.2 desktop craft language",
  sidebar.includes("data-authenticated-mobile-drawer-link={link.id}") &&
    sidebar.includes('data-authenticated-mobile-drawer-link-active={active ? "true" : "false"}') &&
    sidebar.includes("min-h-12 items-center gap-2.5 overflow-hidden rounded-[3px] border px-2.5 py-2.5") &&
    sidebar.includes("sidebar-active-line border-cyan-200/16 bg-cyan-100/[0.08] text-white") &&
    sidebar.includes("border-transparent text-slate-300 hover:border-white/10 hover:bg-sidebar-elevated hover:text-white")
);

assert(
  "mobile icon treatment uses structured accessible icon cells",
    sidebar.includes("data-authenticated-mobile-drawer-icon") &&
    sidebar.includes("flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border transition-colors") &&
    sidebar.includes('<Icon size={17} aria-hidden="true" />')
);

assert(
  "mobile long labels and account data stay safely contained",
  sidebar.includes('<span className="min-w-0 truncate font-medium leading-5">{link.label}</span>') &&
    sidebar.includes("flex min-w-0 items-center gap-2.5") &&
    sidebar.includes('<p className="type-card-title truncate text-sidebar-text">') &&
    sidebar.includes('<p className="truncate text-xs text-sidebar-text-muted">') &&
    sidebar.includes("w-[88dvw] max-w-[336px]")
);

assert(
  "mobile account and logout match desktop B.2 without adding account actions",
  sidebar.includes("data-authenticated-mobile-drawer-account") &&
    sidebar.includes("rounded-[4px] border border-white/10 bg-white/[0.035] p-2.5") &&
    sidebar.includes("border border-red-400/25 bg-red-950/10 text-sm text-red-300") &&
    sidebar.includes("await supabase.auth.signOut()") &&
    sidebar.includes('router.push("/login")') &&
    !sidebar.includes("data-authenticated-mobile-drawer-profile-actions")
);

assert(
  "mobile drawer focus management traps Tab and returns focus on close",
  sidebar.includes("const mobileDrawerRef = useRef<HTMLElement>(null)") &&
    sidebar.includes("mobileDrawerRef.current") &&
    sidebar.includes('event.key === "Tab"') &&
    sidebar.includes("last.focus()") &&
    sidebar.includes("first.focus()") &&
    sidebar.includes("requestAnimationFrame(() => mobileMenuButtonRef.current?.focus())")
);

assert(
  "mobile drawer has modal semantics and Escape close behavior",
  sidebar.includes('role="dialog"') &&
    sidebar.includes('aria-modal="true"') &&
    sidebar.includes('aria-label="Authenticated navigation"') &&
    sidebar.includes('event.key === "Escape"') &&
    sidebar.includes('aria-label="Close menu overlay"')
);

assert(
  "background scroll locking remains scoped to drawer open state",
  sidebar.includes("const previousOverflow = document.body.style.overflow") &&
    sidebar.includes("document.querySelector<HTMLElement>(") &&
    sidebar.includes("[data-authenticated-main-region]") &&
    sidebar.includes("const previousMainOverflowY = mainRegion?.style.overflowY") &&
    sidebar.includes("const previousMainOverscrollBehavior") &&
    sidebar.includes('document.body.style.overflow = "hidden"') &&
    sidebar.includes('mainRegion.style.overflowY = "hidden"') &&
    sidebar.includes('mainRegion.style.overscrollBehavior = "contain"') &&
    sidebar.includes("document.body.style.overflow = previousOverflow") &&
    sidebar.includes("mainRegion.style.overflowY = previousMainOverflowY") &&
    sidebar.includes("mainRegion.style.overscrollBehavior = previousMainOverscrollBehavior")
);

assert(
  "mobile safe areas remain present without excessive padding",
  sidebar.includes("pb-[max(0.875rem,env(safe-area-inset-bottom))]") &&
    sidebar.includes("pt-[max(0.875rem,env(safe-area-inset-top))]") &&
    sidebar.includes("px-[max(0.875rem,env(safe-area-inset-left))]") &&
    sidebar.includes("pr-[max(0.875rem,env(safe-area-inset-right))]")
);

assert(
  "mobile drawer does not add visual groups or fake products",
  !/CORE|INVESTIGATIONS|LEARNING|ACCOUNT/.test(sidebar) &&
    !/Admin|Reports|Billing|Team|Integrations/.test(navConfig)
);

assert(
  "desktop B.2 markers remain available for regression comparison",
  sidebar.includes('data-authenticated-sidebar-craft="phase-b2"') &&
    sidebar.includes("data-authenticated-sidebar-brand") &&
    sidebar.includes("data-authenticated-sidebar-link={link.id}") &&
    sidebar.includes("data-authenticated-sidebar-account")
);

assert(
  "AppShell AI Tutor and Saved Investigation scroll architecture remain untouched",
  appShell.includes("fixed inset-0") &&
    appShell.includes("data-authenticated-main-region") &&
    appShell.includes("overflow-y-auto overflow-x-clip") &&
    tutorPage.includes("data-ai-tutor-transcript") &&
    tutorPage.includes("overscroll-contain overflow-y-auto") &&
    savedDetail.includes('data-saved-investigation-page="dark-continuous"')
);

console.log(
  `Authenticated Mobile Navigation craft tests passed (${assertions} assertions).`
);
