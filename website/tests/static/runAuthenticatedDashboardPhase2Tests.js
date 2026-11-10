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

const dashboard = readText("app/dashboard/page.tsx");
const dashboardLayout = readText("app/dashboard/layout.tsx");
const topBar = readText("app/components/shell/TopBar.tsx");
const notificationBell = readText("app/components/NotificationBell.tsx");
const panels = readText("app/dashboard/_components/DashboardPanels.tsx");
const skeleton = readText("app/components/ui/Skeleton.tsx");
const publicNav = readText("app/components/PublicNavbar.tsx");
const sitemap = readText("app/sitemap.ts");

assert("dashboard keeps existing Supabase profile read", dashboard.includes("profiles") && dashboard.includes("full_name, level, xp, labs_generated, labs_completed"));
assert("dashboard keeps existing saved investigation read", dashboard.includes("labs") && dashboard.includes("id, title, difficulty, completed, created_at"));
assert("dashboard keeps existing achievements read", dashboard.includes("achievements") && dashboard.includes("user_achievements"));
assert("dashboard keeps existing roadmap read", dashboard.includes("roadmap_progress") && dashboard.includes("roadmap_modules"));
assert("dashboard does not read plan or invented fields", !dashboard.includes("profiles.plan") && !dashboard.includes("task_count") && !dashboard.includes("evidence_count") && !dashboard.includes("streak"));
assert("dashboard removes current streak placeholder", !dashboard.includes("CURRENT_STREAK_PLACEHOLDER") && !panels.includes("Current Streak"));
assert("dashboard uses investigation-first marker", dashboard.includes('data-dashboard-phase="investigation-first"'));
assert("current investigation is first major region", dashboard.indexOf("<CurrentInvestigationPanel") < dashboard.indexOf("<InvestigationQueue"));
assert("capability development follows queue", dashboard.indexOf("<InvestigationQueue") < dashboard.indexOf("<CapabilityDevelopment"));
assert("milestones remain subordinate", dashboard.indexOf("<CapabilityDevelopment") < dashboard.indexOf("<MilestoneActivity"));
assert("dashboard keeps contextual generate action", dashboard.includes('href="/dashboard/labs"') && dashboard.includes("Generate investigation"));
assert("dashboard owns desktop utility actions without empty topbar strip", dashboard.includes('data-dashboard-header-actions') && dashboard.includes('data-dashboard-desktop-notifications') && dashboard.includes("desktopUtilities ?") && dashboard.includes("<NotificationBell />") && dashboard.indexOf("<NotificationBell />") < dashboard.indexOf("Generate investigation") && dashboardLayout.includes("topBar={<TopBar />}") && topBar.includes("if (!actions) return null"));
assert("dashboard keeps tutor route only as secondary support", dashboard.includes("<TutorAction") && panels.includes('href="/dashboard/tutor"'));
assert("current investigation has continue and empty actions", panels.includes("Continue investigation") && panels.includes("Generate investigation"));
assert("current investigation does not fake task or evidence counts", !panels.includes("task count") && !panels.includes("evidence count") && !panels.includes("14 evidence"));
assert("queue uses structured row semantics", panels.includes('data-dashboard-record="investigation"') && panels.includes("grid-cols-[minmax(0,1.5fr)_7.5rem_7.5rem_8.5rem]"));
assert("dashboard queue previews two records plus archive action", panels.includes("const previewLabs = labs.slice(0, 2)") && panels.includes("const hasMoreInvestigations = labs.length > previewLabs.length") && panels.includes("{previewLabs.map((lab)") && panels.includes("<SeeMoreInvestigationsRow />") && panels.includes('data-dashboard-record="see-more-investigations"') && panels.includes('href="/dashboard/saved"') && panels.includes("See more investigations") && !panels.includes("View saved"));
assert("queue has desktop headings", panels.includes("Investigation") && panels.includes("Difficulty") && panels.includes("Created"));
assert("queue has mobile stacked metadata", panels.includes("md:hidden") && panels.includes("· Saved {formatDate(lab.createdAt)}"));
assert("queue avoids old large card/gallery component names", !dashboard.includes("RecentLabsCard") && !dashboard.includes("QuickActionsCard") && !dashboard.includes("DashboardMetricCard"));
assert("capability development uses real progress values", panels.includes("profile.xp.toLocaleString()") && panels.includes("completedRoadmapItems") && panels.includes("unlockedAchievementCount"));
assert("progress rails expose accessible progressbar state", panels.includes('role="progressbar"') && panels.includes("aria-valuenow") && panels.includes("Roadmap completion") && panels.includes("XP progress toward next milestone"));
assert("achievements have restrained empty state", panels.includes("No milestones unlocked yet") && !panels.includes("No achievements unlocked"));
assert("motion is restrained", dashboard.includes("duration: 0.2") && dashboard.includes("y: 4") && !dashboard.includes("stagger"));
assert("dashboard loading mirrors authenticated composition", skeleton.includes("export function DashboardSkeleton") && skeleton.includes('data-dashboard-loading="authenticated"') && skeleton.includes('aria-label="Loading current investigation"') && skeleton.includes('aria-label="Loading investigation queue"') && skeleton.includes('aria-label="Loading development context"'));
assert("dashboard skeleton stays dark and restrained", skeleton.includes("bg-[#071426]") && skeleton.includes("bg-[#0b1829]/55") && skeleton.includes("motion-reduce:transform-none") && skeleton.includes("useReducedMotion") && !skeleton.includes("bg-gradient-to-r from-transparent via-white/20"));
assert("dashboard skeleton no longer renders four KPI tiles", !skeleton.includes("xl:grid-cols-4") || skeleton.indexOf("export function DashboardSkeleton") > skeleton.lastIndexOf("xl:grid-cols-4", skeleton.indexOf("export function DashboardSkeleton")));
assert("dashboard is not exposed in public navigation", !publicNav.includes('href: "/dashboard"') && !sitemap.includes('path: "/dashboard"'));
assert("dashboard uses one unified composition grid", dashboard.includes('data-dashboard-grid="unified"') && dashboard.includes("max-w-[82rem]") && dashboard.includes("gap-space-7") && !dashboard.includes("max-w-[88rem]") && !dashboard.includes("bg-[#081321]") && !dashboard.includes("lg:border-x lg:border-white/10"));
assert("dashboard defines the three requested information zones", dashboard.includes('data-dashboard-zone="active-work"') && dashboard.includes('data-dashboard-zone="work-index"') && dashboard.includes('data-dashboard-zone="development-context"'));
assert("active work binds introduction to current investigation", dashboard.indexOf('data-dashboard-zone="active-work"') < dashboard.indexOf("<CurrentInvestigationPanel") && dashboard.indexOf("<CurrentInvestigationPanel") < dashboard.indexOf('data-dashboard-zone="work-index"'));
assert("major dashboard regions use low-radius or rule-based geometry", panels.includes("rounded-[3px]") && panels.includes("border-t border-white/[0.08] bg-[#0b1829]/55") && !panels.includes("rounded-ui-md border border-white/10 bg-[#0b1829]"));
assert("queue relies on compact index rows and rules", panels.includes("divide-y divide-white/10") && panels.includes("px-space-2 py-space-4") && panels.includes("md:min-h-12") && !panels.includes("app-ledger-row"));
assert("see more row avoids fake metadata columns", panels.includes("md:col-span-4") && !panels.includes("N/A") && !panels.includes("More</span>") && notificationBell.includes("bg-white/[0.035]") && notificationBell.includes("bg-cyan-300"));
assert("lower dashboard sections are subordinate rule planes", panels.includes("xl:pr-space-7") && dashboard.includes("xl:grid-cols-[minmax(0,0.64fr)_minmax(19rem,0.36fr)]") && dashboard.includes("xl:before:absolute") && dashboard.includes("mt-space-3 grid min-w-0 gap-space-5"));
assert("capability metrics avoid mini card treatment", panels.includes("grid min-w-0 grid-cols-3 py-space-4") && panels.includes("after:absolute after:bottom-2") && panels.includes("last:after:hidden") && !panels.includes("rounded-[4px] border border-white/10 bg-white/[0.025] p-space-4"));
assert("mobile section labels are intentionally compact", panels.includes("03 / Capability") && !panels.includes("03 / Capability development"));
assert("activity empty state avoids large dashed box", panels.includes("mt-space-6") && !panels.includes("border-dashed border-white/15"));
assert("dashboard vertical rhythm removes redundant lower rules", panels.includes("border-t border-white/[0.08] bg-[#0b1829]/55") && panels.includes("border-t border-white/[0.08] pt-space-5") && !panels.includes("grid min-w-0 grid-cols-3 border-b border-white/10") && !panels.includes("mt-space-4 border-t border-white/10 pt-space-4"));
assert("section anchor rules stay short and local", panels.includes('const sectionRuleClass = "h-px w-10 bg-white/[0.075] sm:w-16"'));
assert("current metadata and queue rows have optical breathing room", panels.includes("py-space-3.5 sm:border-b-0 sm:px-space-5 sm:py-space-4") && panels.includes("pb-space-3.5 pt-space-2") && panels.includes("py-space-4 outline-none"));assert("Phase 2 did not modify public shell markers", publicNav.includes("/features") && publicNav.includes("/labs"));

console.log(`Authenticated dashboard Phase 2 tests passed (${assertions} assertions).`);
