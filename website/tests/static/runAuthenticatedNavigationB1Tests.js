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

const expectedItems = [
  ["dashboard", "Dashboard", "/dashboard", "exact"],
  ["tutor", "AI Tutor", "/dashboard/tutor", "prefix"],
  ["generate-investigation", "Generate Investigation", "/dashboard/labs", "prefix"],
  ["saved-investigations", "Saved Investigations", "/dashboard/saved", "prefix"],
  ["roadmap", "Learning Roadmap", "/dashboard/roadmap", "prefix"],
  ["progress", "Progress", "/dashboard/progress", "prefix"],
  ["settings", "Settings", "/dashboard/settings", "prefix"],
];

assert(
  "authenticated navigation has one typed source of truth",
  navConfig.includes("export type AuthNavigationItem") &&
    navConfig.includes("export const authNavigationItems") &&
    navConfig.includes("satisfies readonly AuthNavigationItem[]") &&
    sidebar.includes("authNavigationItems") &&
    sidebar.includes("isAuthNavigationItemActive") &&
    !sidebar.includes("const links = [")
);

for (const [id, label, href, match] of expectedItems) {
  assert(
    `navigation item ${id} is registered once with label href and match`,
    (navConfig.match(new RegExp(`id: "${id}"`, "g")) || []).length === 1 &&
      navConfig.includes(`label: "${label}"`) &&
      navConfig.includes(`href: "${href}"`) &&
      navConfig.includes(`match: "${match}"`)
  );
}

assert(
  "learner-facing labels use investigation terminology",
  sidebar.includes("Saved Investigations") &&
    navConfig.includes('label: "Generate Investigation"') &&
    navConfig.includes('label: "Saved Investigations"') &&
    !sidebar.includes("Generate Labs") &&
    !sidebar.includes("Saved Labs")
);

assert(
  "desktop and mobile navigation render from the same config",
  (sidebar.match(/authNavigationItems\.map/g) || []).length === 2 &&
    (sidebar.match(/isAuthNavigationItemActive\(link, pathname\)/g) || []).length === 2 &&
    sidebar.includes("closeMobileMenu({ restoreFocus: false })") &&
    sidebar.includes('data-authenticated-sidebar-nav')
);

assert(
  "dashboard matching is exact and cannot activate for every route",
  navConfig.includes('id: "dashboard"') &&
    navConfig.includes('match: "exact"') &&
    navConfig.includes("if (item.match === \"exact\") return pathname === item.href") &&
    navConfig.includes("pathname.startsWith(`${item.href}/`)")
);

assert(
  "saved investigation detail descendants keep Saved Investigations active",
  navConfig.includes('id: "saved-investigations"') &&
    navConfig.includes('href: "/dashboard/saved"') &&
    navConfig.includes('match: "prefix"') &&
    savedDetail.includes('href="/dashboard/saved"')
);

assert(
  "collapsed navigation keeps accessible names",
  sidebar.includes("aria-label={collapsed ? link.label : undefined}") &&
    sidebar.includes("title={collapsed ? link.label : undefined}") &&
    sidebar.includes("!collapsed && <span className=\"min-w-0 truncate\">{link.label}</span>")
);

assert(
  "decorative configured icons stay hidden from assistive technology",
  sidebar.includes("const Icon = link.icon") &&
    (sidebar.match(/<Icon size=\{\d+\} aria-hidden="true" \/>/g) || []).length >= 2
);

assert(
  "primary navigation remains semantic and labelled",
  (sidebar.match(/<nav/g) || []).length >= 2 &&
    (sidebar.match(/aria-label="Primary navigation"/g) || []).length === 2 &&
    sidebar.includes('aria-current={active ? "page" : undefined}')
);

assert(
  "sidebar fixed-zone architecture remains intact",
  sidebar.includes("data-authenticated-sidebar") &&
    sidebar.includes("h-full min-h-0") &&
    sidebar.includes("data-authenticated-sidebar-nav") &&
    sidebar.includes("min-h-0 flex-1") &&
    sidebar.includes("overflow-y-auto overscroll-contain") &&
    sidebar.includes("data-authenticated-sidebar-account") &&
    sidebar.includes("mt-4 shrink-0")
);

assert(
  "account region and logout behavior are preserved",
  sidebar.includes("full_name") &&
    sidebar.includes("plan") &&
    sidebar.includes("async function logout()") &&
    sidebar.includes("await supabase.auth.signOut()") &&
    sidebar.includes('router.push("/login")') &&
    sidebar.includes("Profile") &&
    sidebar.includes("Saved Investigations")
);

assert(
  "B.1 does not alter shell scroll ownership or Tutor transcript architecture",
  appShell.includes("fixed inset-0") &&
    appShell.includes("data-authenticated-main-region") &&
    appShell.includes("overflow-y-auto overflow-x-clip") &&
    tutorPage.includes("data-ai-tutor-transcript") &&
    tutorPage.includes("overscroll-contain overflow-y-auto") &&
    savedDetail.includes('data-saved-investigation-page="dark-continuous"')
);

assert(
  "navigation config does not introduce groups or fake future products",
  !/Core|Account|Admin|Reports|Billing|Team|Integrations/.test(
    navConfig
  )
);

console.log(
  `Authenticated Navigation B.1 tests passed (${assertions} assertions).`
);
