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

const progress = readText("app/dashboard/progress/page.tsx");
const skeleton = readText("app/components/ui/Skeleton.tsx");
const dashboard = readText("app/dashboard/page.tsx");
const dashboardPanels = readText("app/dashboard/_components/DashboardPanels.tsx");
const roadmap = readText("app/dashboard/roadmap/page.tsx");
const sidebar = readText("app/components/Sidebar.tsx");
const authNavigation = readText("app/components/navigation/authNavigation.ts");
const appShell = readText("app/components/shell/AppShell.tsx");
const aiTutor = readText("app/dashboard/tutor/page.tsx");
const savedDetail = readText("app/dashboard/saved/[id]/page.tsx");

assert(
  "progress keeps existing profile aggregate read",
  progress.includes('from("profiles")') &&
    progress.includes('select("xp, level, plan, labs_generated, labs_completed")')
);
assert(
  "progress keeps existing achievement reads",
  progress.includes('from("achievements")') &&
    progress.includes('from("user_achievements")') &&
    progress.includes('select("achievement_id, unlocked_at")')
);
assert(
  "progress does not add backend reads",
  !/from\("labs"\)|from\("roadmap_progress"\)|from\("roadmap_modules"\)|linux_grading|lab_generation_jobs|lab_assets/.test(progress)
);
assert(
  "progress keeps existing XP helper",
  progress.includes("getNextXpGoal(stats.xp)") && !progress.includes("getXpProgress(")
);
assert(
  "progress uses dark learning-record marker",
  progress.includes('data-progress-phase="dark-learning-record"') &&
    progress.includes("Your learning record.") &&
    progress.includes("Track investigation completion, XP, and milestones from one place.")
);
assert(
  "progress header avoids unrelated plan badge",
  progress.includes("function ProgressHeader()") &&
    progress.includes("<ProgressHeader />") &&
    !progress.includes("<ProgressHeader plan=") &&
    !/function ProgressHeader\([^)]*plan/.test(progress)
);
assert(
  "summary is one ledger-style region",
  progress.includes("ProgressSummary") &&
    progress.includes("01 / Summary") &&
    progress.includes("grid min-w-0 grid-cols-2 border-t border-white/[0.08] sm:grid-cols-4") &&
    progress.includes("SummaryMetric")
);
assert(
  "summary keeps real metrics",
  ["Current Level", "Current XP", "Completed Investigations", "Achievements"].every((label) =>
    progress.includes(label)
  )
);
assert(
  "legacy lab terminology removed from learner-facing progress labels",
  !progress.includes("Completed Labs") &&
    !progress.includes("Lab Completion") &&
    !progress.includes("Generated Labs") &&
    progress.includes("Generated") &&
    progress.includes("Investigation Completion")
);
assert(
  "development section keeps accessible XP meter",
  progress.includes("02 / Development") &&
    progress.includes("Level And XP") &&
    progress.includes('aria-label={label}') &&
    progress.includes("XP progress toward next milestone") &&
    progress.includes("aria-valuetext={valueText}")
);
assert(
  "XP meter presentation clamps overflow without changing XP value",
  progress.includes("const clampedPercent = Math.max(0, Math.min(percent, 100))") &&
    progress.includes("aria-valuenow={Math.min(value, max)}") &&
    progress.includes("formatNumber(xp)")
);
assert(
  "investigation record uses safe aggregate counters",
  progress.includes("const safeGenerated = Math.max(stats.labsGenerated, 0)") &&
    progress.includes("const safeCompleted = Math.max(stats.labsCompleted, 0)") &&
    progress.includes("const inProgress = Math.max(safeGenerated - safeCompleted, 0)") &&
    progress.includes("No generated investigations are saved yet.")
);
assert(
  "historical activity stays truthful and secondary",
  progress.includes("HistoricalActivityStatus") &&
    progress.includes("Detailed progress history is not available yet.") &&
    progress.includes("timestamped progress events") &&
    !progress.includes("role=\"img\"") &&
    !progress.includes("chart") &&
    !/Current Streak|trend data|progress event stream/i.test(progress)
);
assert(
  "achievement registry uses real definitions and unlock state",
  progress.includes("Achievement Registry") &&
    progress.includes("achievement.unlocked_at") &&
    progress.includes("formatAchievementTitle(achievement.name)") &&
    progress.includes("formatAchievementDescription(achievement.description)") &&
    progress.includes("formatAchievementRequirement(achievement)") &&
    progress.includes("Unlocked") &&
    progress.includes("Locked")
);
assert(
  "achievement registry translates legacy database copy for learners",
  progress.includes("function normaliseAchievementCopy(value: string)") &&
    progress.includes('.replace(/\\bCyberLab\\b/g, "Amniora")') &&
    progress.includes('.replace(/\\bLabs\\b/g, "Investigations")') &&
    progress.includes('.replace(/\\blabs\\b/g, "investigations")') &&
    progress.includes("formatAchievementTitle(achievement.name)") &&
    progress.includes("formatAchievementDescription(achievement.description)")
);
assert(
  "achievement requirement column does not expose raw backend categories",
  progress.includes("function formatAchievementRequirement(achievement: Achievement)") &&
    progress.includes('return `Complete ${formatNumber(requirementValue)} ${pluraliseInvestigation(requirementValue)}`') &&
    progress.includes('return `Earn ${formatNumber(requirementValue)} XP`') &&
    progress.includes('return "Complete the milestone requirement"') &&
    !progress.includes("{achievement.category}")
);
assert(
  "known legacy achievement strings are not rendered directly",
  !progress.includes("{achievement.name}") &&
    !progress.includes("{achievement.description}") &&
    !progress.includes("{achievement.category}") &&
    !progress.includes("First Lab Completed") &&
    !progress.includes("Complete your first CyberLab training lab.")
);
assert(
  "achievement registry is row-based not giant tile grid",
  progress.includes("sm:grid-cols-[minmax(0,1.4fr)_minmax(9rem,0.55fr)_minmax(8rem,0.45fr)]") &&
    !progress.includes("xl:grid-cols-3") &&
    !progress.includes("rounded-ui-md border border-border bg-surface")
);
assert(
  "locked achievements remain readable",
  progress.includes("text-slate-300") &&
    !progress.includes("opacity-60") &&
    !progress.includes("cursor-not-allowed")
);
assert(
  "progress does not invent unsupported analytics",
  !/skill score|mastery|difficulty chart|environment distribution|rarity|points|trend data|Current Streak|streak/i.test(progress)
);
assert(
  "progress uses Intl for numbers and dates",
  progress.includes("new Intl.NumberFormat") &&
    progress.includes("new Intl.DateTimeFormat") &&
    progress.includes("formatNumber(") &&
    progress.includes("formatDate(")
);
assert(
  "progress keeps safe generic errors",
  progress.includes("Amniora could not load this data right now. Please try again in a moment.") &&
    progress.includes('data-progress-error="dark-learning-record"') &&
    progress.includes("Try Again") &&
    !progress.includes("profileError.message") &&
    !progress.includes("achievementError.message") &&
    !progress.includes("unlockedError.message")
);
assert(
  "progress loading state is dark and representative",
  skeleton.includes('data-progress-loading="dark-learning-record"') &&
    skeleton.includes("bg-[#071426]") &&
    skeleton.includes("border-cyan-100/12") &&
    skeleton.includes("rounded-[3px]") &&
    skeleton.includes("Array.from({ length: 4 })")
);
assert(
  "progress loading state avoids legacy white cards",
  !/ProgressSkeleton[\s\S]*rounded-ui-md border border-border bg-surface/.test(skeleton) &&
    !/ProgressSkeleton[\s\S]*shadow-surface/.test(skeleton)
);
assert(
  "Dashboard source remains untouched by P1",
  dashboard.includes('data-dashboard-phase="investigation-first"') &&
    dashboardPanels.includes("CapabilityDevelopment") &&
    dashboardPanels.includes('href="/dashboard/progress"')
);
assert(
  "Roadmap source remains untouched by P1",
  roadmap.includes("Your cybersecurity learning plan") &&
    roadmap.includes("reset_my_roadmap") &&
    roadmap.includes("Roadmap Timeline")
);
assert(
  "navigation and shell source remain untouched by P1",
  sidebar.includes("data-authenticated-mobile-drawer-link") &&
    authNavigation.includes('href: "/dashboard/progress"') &&
    appShell.includes("data-authenticated-shell")
);
assert(
  "AI Tutor and Saved Investigation source remain untouched by P1",
  aiTutor.includes("data-ai-tutor-workspace") &&
    savedDetail.includes('data-saved-investigation-page="dark-continuous"')
);
assert(
  "progress page remains responsive without fixed-width mobile traps",
  progress.includes("min-w-0") &&
    progress.includes("break-words") &&
    !/min-w-\[[0-9]+rem\]|w-\[[0-9]+px\]/.test(progress)
);

console.log(`Progress P.1 learning-record tests passed (${assertions} assertions).`);
