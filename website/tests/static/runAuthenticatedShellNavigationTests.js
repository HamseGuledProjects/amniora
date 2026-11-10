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

const dashboardLayout = readText("app/dashboard/layout.tsx");
const appShell = readText("app/components/shell/AppShell.tsx");
const sidebar = readText("app/components/Sidebar.tsx");
const topBar = readText("app/components/shell/TopBar.tsx");
const notificationBell = readText("app/components/NotificationBell.tsx");
const globalStatusRegion = readText("components/layout/GlobalStatusRegion.tsx");
const developmentBanner = readText("components/layout/DevelopmentBanner.tsx");
const serviceStatusBanner = readText("components/layout/ServiceStatusBanner.tsx");
const globals = readText("app/globals.css");

assert("dashboard imports one notification component", (dashboardLayout.match(/import NotificationBell/g) || []).length === 1);
assert("dashboard shell keeps mobile notifications in the mobile header only", dashboardLayout.includes('window.matchMedia("(min-width: 1024px)")') && dashboardLayout.includes("mobileActions={!desktopShell ? <NotificationBell /> : null}") && dashboardLayout.includes("topBar={<TopBar />}") && !dashboardLayout.includes("actions={desktopShell ? <NotificationBell /> : null}"));
assert("dashboard passes split authenticated shell regions", dashboardLayout.includes("mobileHeader=") && dashboardLayout.includes('mode="mobile"') && dashboardLayout.includes('sidebar={<Sidebar mode="desktop" />}'));
assert("authenticated shell exposes a scoped token boundary", appShell.includes("data-authenticated-shell") && appShell.includes("bg-[#0c1828]") && globals.includes("[data-authenticated-shell]") && globals.includes("--auth-bg: #0b1726") && globals.includes("--auth-surface-1: #f7f9fc") && globals.includes("--auth-surface-4: #dbe7f3"));
assert("authenticated shell is anchored to the viewport instead of contributing document scroll", appShell.includes("fixed inset-0 flex h-screen h-dvh min-h-screen") && appShell.includes("overflow-hidden bg-[#0c1828]"));
assert("authenticated global stack contains banners and mobile header only", appShell.includes("data-authenticated-global-stack") && appShell.includes("sticky top-0") && appShell.includes("<DevelopmentBanner />") && appShell.includes("<ServiceStatusBanner />") && appShell.includes("{mobileHeader}") && appShell.indexOf("{topBar}") > appShell.indexOf("data-authenticated-workspace"));
assert("authenticated workspace begins after global banners", appShell.includes("data-authenticated-workspace") && appShell.includes("flex min-h-0 min-w-0 flex-1 overflow-hidden") && appShell.indexOf("data-authenticated-global-stack") < appShell.indexOf("data-authenticated-workspace") && appShell.indexOf("{sidebar}") < appShell.indexOf("data-authenticated-main-region"));
assert("desktop app header lives inside main workspace when actions exist", appShell.includes("data-authenticated-main-region") && appShell.indexOf("data-authenticated-main-region") < appShell.indexOf("{topBar}") && topBar.includes("data-authenticated-app-header") && topBar.includes("if (!actions) return null") && !topBar.includes("data-authenticated-utility-header"));
assert("desktop app header collapses instead of showing an empty strip", topBar.includes("if (!actions) return null") && topBar.includes("sticky top-0 z-20") && topBar.includes("mb-3") && topBar.includes("justify-end") && topBar.includes("bg-[#0c1828]/95") && !topBar.includes("Workspace") && !topBar.includes("min-h-8") && !topBar.includes("h-16") && !topBar.includes("className=\"hidden h-16") && !topBar.includes("bg-surface px-8"));
assert("root global status stays public-only for authenticated paths", globalStatusRegion.includes("usePathname") && globalStatusRegion.includes('startsWith("/dashboard")') && globalStatusRegion.includes('startsWith("/admin")') && globalStatusRegion.includes("return null"));
assert("private beta notice is permanent and non-collapsible", developmentBanner.includes("data-private-beta-notice") && !developmentBanner.includes("useState") && !developmentBanner.includes("aria-expanded") && !developmentBanner.includes("Details") && !developmentBanner.includes("Hide") && !developmentBanner.includes("beta-warning__details"));
assert("mobile authenticated header owns notification actions", sidebar.includes("mobileActions?: ReactNode") && sidebar.includes("data-authenticated-mobile-header") && sidebar.includes("data-authenticated-mobile-actions") && sidebar.indexOf("{mobileActions}") < sidebar.indexOf("aria-label=\"Open menu\""));
assert("mobile authenticated header uses dark shell treatment", sidebar.includes("bg-sidebar") && sidebar.includes("text-sidebar-text") && sidebar.includes('<BrandLogo size="sm" theme="dark" />'));
assert("mobile authenticated header is normal flow inside sticky stack", !sidebar.includes("top-[var(--development-banner-height)]") && !sidebar.includes("sticky top-0 z-50"));
assert("desktop authenticated sidebar uses fixed workspace height, not page scrolling or banner offsets", sidebar.includes("data-authenticated-sidebar") && sidebar.includes("h-full min-h-0") && !sidebar.includes("sticky top-0") && !sidebar.includes("100dvh-var(--development-banner-height)"));
assert("desktop sidebar has pinned top middle and bottom zones", sidebar.includes("data-authenticated-sidebar-nav") && sidebar.includes("min-h-0 flex-1") && sidebar.includes("overflow-y-auto overscroll-contain") && sidebar.includes("data-authenticated-sidebar-account") && sidebar.includes("mt-4 shrink-0"));
assert("desktop main region owns the page scroll", appShell.includes("data-authenticated-main-region") && appShell.includes("overflow-y-auto overflow-x-clip") && appShell.includes("lg:h-full") && appShell.includes("data-authenticated-content-frame") && appShell.includes("flex min-h-full w-full") && !appShell.includes("flex h-full min-h-0 w-full max-w-[90rem]") && !appShell.includes("min-h-full w-full max-w-[90rem] flex-1"));
assert("desktop notification bell moves into dashboard page utilities", topBar.includes("{actions}") && dashboardLayout.includes("topBar={<TopBar />}") && !dashboardLayout.includes("actions={desktopShell ? <NotificationBell /> : null}") && !appShell.match(/data-authenticated-global-stack[\s\S]*NotificationBell/));
assert("notification panel is anchored to the bell wrapper", notificationBell.includes("data-notification-root") && notificationBell.includes("relative") && notificationBell.includes("absolute right-0 top-12") && notificationBell.includes("aria-haspopup=\"dialog\"") && notificationBell.includes("aria-labelledby=\"notification-panel-title\"") && notificationBell.includes("border border-white/15 bg-white/[0.035] text-slate-300"));
assert("notification panel uses viewport-safe width without global measuring", notificationBell.includes("w-[min(24rem,calc(100vw-2rem))]") && globals.includes("[data-authenticated-mobile-header] [data-notification-root]") && notificationBell.includes("max-h-[min(26rem,calc(100dvh-7rem))]") && !notificationBell.includes("getBoundingClientRect") && !notificationBell.includes("--notification-panel-top") && !notificationBell.includes("panelTop"));
assert("notification panel closes accessibly", notificationBell.includes("Escape") && notificationBell.includes("pointerdown") && notificationBell.includes("buttonRef.current?.focus()") && notificationBell.includes("panelRef"));
assert("notification popover uses restrained fade and y motion only", notificationBell.includes("initial={{ opacity: 0, y: 4 }}") && notificationBell.includes("animate={{ opacity: 1, y: 0 }}") && !notificationBell.includes("scale:") && !notificationBell.includes("whileHover") && !notificationBell.includes("whileTap"));
assert("tablet and desktop notification panel preserve anchored behavior", notificationBell.includes("absolute right-0 top-12") && notificationBell.includes("w-[min(24rem,calc(100vw-2rem))]") && !notificationBell.includes("fixed left-3 right-3"));
assert("mobile drawer uses restrained non-bouncy motion", sidebar.includes("transition={{ duration: 0.22") && !sidebar.includes("type: \"spring\"") && !sidebar.includes("stiffness:"));
assert("global status region remains banner-only", globalStatusRegion.includes("<DevelopmentBanner />") && globalStatusRegion.includes("<ServiceStatusBanner />") && !globalStatusRegion.includes("NotificationBell") && !globalStatusRegion.includes("Open notifications"));
assert("private beta banner does not own notifications or dismissal", !developmentBanner.includes("NotificationBell") && !developmentBanner.includes("Open notifications") && !developmentBanner.includes("Dismiss"));
assert("service status banner owns only service dismissal", !serviceStatusBanner.includes("NotificationBell") && !serviceStatusBanner.includes("Open notifications") && serviceStatusBanner.includes('aria-label="Dismiss service status warning"'));
assert("service dismissal is local and bounded to 60 minutes", serviceStatusBanner.includes('DISMISSAL_STORAGE_KEY = "amniora-service-status-dismissal"') && serviceStatusBanner.includes("DISMISSAL_TTL_MS = 60 * 60 * 1000") && serviceStatusBanner.includes("window.localStorage.setItem") && serviceStatusBanner.includes("expiresAt") && !serviceStatusBanner.includes("createClient") && !serviceStatusBanner.includes(".from("));
assert("service recovery clears stale dismissal", serviceStatusBanner.includes('nextStatus === "healthy"') && serviceStatusBanner.includes("clearDismissal()") && serviceStatusBanner.includes("setDismissedFingerprint(null)"));
assert("service status has no reserved hidden warning space", serviceStatusBanner.includes('return null') && !serviceStatusBanner.includes("visibility: hidden") && !serviceStatusBanner.includes("opacity-0"));

for (const source of [dashboardLayout, sidebar, topBar, globalStatusRegion, appShell, notificationBell]) {
  assert("authenticated shell avoids scroll-driven banner measurement hacks", !/ResizeObserver|visualViewport|scrollY|addEventListener\(\s*["']scroll|development-banner-resize|setProperty\("--development-banner-height"|getBoundingClientRect\(\)/.test(source));
}

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
