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
  "current mobile drawer shell is not an internal scroll owner",
  sidebar.includes("data-authenticated-mobile-drawer") &&
    sidebar.includes("flex-col overflow-hidden") &&
    !/data-authenticated-mobile-drawer[^>]*overflow-y-(auto|scroll)/.test(sidebar)
);

assert(
  "current mobile nav middle can scroll only when content exceeds available height",
  sidebar.includes("data-authenticated-mobile-drawer-nav") &&
    sidebar.includes("min-h-0 flex-[0_1_auto]") &&
    sidebar.includes("overflow-y-auto overscroll-contain") &&
    !sidebar.includes("overflow-y-scroll")
);

assert(
  "mobile account footer stays pinned without stretching the nav region",
  sidebar.includes("data-authenticated-mobile-drawer-account") &&
    sidebar.includes("mt-auto shrink-0 border-t border-white/10 pt-3") &&
    sidebar.includes("rounded-[4px] border border-white/10 bg-white/[0.035] p-2.5") &&
    sidebar.includes("mt-3 flex min-h-11 w-full")
);

assert(
  "drawer open locks the visible background authenticated main scroll owner",
  sidebar.includes("document.querySelector<HTMLElement>(") &&
    sidebar.includes("[data-authenticated-main-region]") &&
    sidebar.includes('mainRegion.style.overflowY = "hidden"') &&
    sidebar.includes('mainRegion.style.overscrollBehavior = "contain"') &&
    sidebar.includes("mainRegion.style.overflowY = previousMainOverflowY") &&
    sidebar.includes("mainRegion.style.overscrollBehavior = previousMainOverscrollBehavior")
);

assert(
  "drawer open still locks and restores body scroll",
  sidebar.includes("const previousOverflow = document.body.style.overflow") &&
    sidebar.includes('document.body.style.overflow = "hidden"') &&
    sidebar.includes("document.body.style.overflow = previousOverflow")
);

assert(
  "active row craft remains structurally equal height",
    sidebar.includes("data-authenticated-mobile-drawer-link-active") &&
    sidebar.includes("min-h-12 items-center gap-2.5 overflow-hidden rounded-[3px] border px-2.5 py-2.5") &&
    sidebar.includes("sidebar-active-line border-cyan-200/16 bg-cyan-100/[0.08] text-white") &&
    !/translate-y|scale-|animate-pulse/.test(sidebar)
);

assert(
  "B.1 config and matching remain unchanged",
  navConfig.includes("export const authNavigationItems") &&
    navConfig.includes('label: "Generate Investigation"') &&
    navConfig.includes('label: "Saved Investigations"') &&
    navConfig.includes('if (item.match === "exact") return pathname === item.href') &&
    navConfig.includes("pathname === item.href || pathname.startsWith(`${item.href}/`)")
);

assert(
  "desktop B.2 sidebar remains present and separate from mobile final correction",
  sidebar.includes('data-authenticated-sidebar-craft="phase-b2"') &&
    sidebar.includes("data-authenticated-sidebar-brand") &&
    sidebar.includes("data-authenticated-sidebar-link={link.id}") &&
    sidebar.includes("data-authenticated-sidebar-account") &&
    sidebar.includes('collapsed ? "w-[72px]" : "w-64"')
);

assert(
  "AppShell AI Tutor and Saved Investigation scroll architecture remain unchanged",
  appShell.includes("fixed inset-0") &&
    appShell.includes("data-authenticated-main-region") &&
    appShell.includes("overflow-y-auto overflow-x-clip") &&
    tutorPage.includes("data-ai-tutor-transcript") &&
    tutorPage.includes("overscroll-contain overflow-y-auto") &&
    savedDetail.includes('data-saved-investigation-page="dark-continuous"')
);

console.log(
  `Authenticated Mobile Navigation final craft tests passed (${assertions} assertions).`
);
