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

const settings = readText("app/dashboard/settings/page.tsx");
const roadmap = readText("app/dashboard/roadmap/page.tsx");
const notificationBell = readText("app/components/NotificationBell.tsx");
const achievementToast = readText("app/components/AchievementToast.tsx");
const skeleton = readText("app/components/ui/Skeleton.tsx");
const dashboardLayout = readText("app/dashboard/layout.tsx");
const appShell = readText("app/components/shell/AppShell.tsx");
const sidebar = readText("app/components/Sidebar.tsx");
const progress = readText("app/dashboard/progress/page.tsx");
const saved = readText("app/dashboard/saved/page.tsx");
const savedDetail = readText("app/dashboard/saved/[id]/page.tsx");
const tutor = readText("app/dashboard/tutor/page.tsx");
const labs = readText("app/dashboard/labs/page.tsx");

assert(
  "settings keeps existing profile read and supported write fields",
  settings.includes('select("full_name, email, plan, level, target_level, xp")') &&
    settings.includes("full_name: name") &&
    settings.includes("target_level: targetLevel") &&
    !settings.includes("delete account") &&
    !settings.includes("Delete Account")
);
assert(
  "settings keeps password recovery architecture",
    settings.includes('href="/forgot-password"') &&
    settings.includes("Password changes are handled through the secure reset flow.") &&
    !settings.includes("updateUser") &&
    !settings.includes(["password", ":"].join(""))
);
assert(
  "settings has action pending, status and safe error states",
  settings.includes("const [saving, setSaving] = useState(false)") &&
    settings.includes("loading={saving}") &&
    settings.includes('loadingText="Saving..."') &&
    settings.includes('role={error ? "alert" : "status"}') &&
    settings.includes("Amniora could not save your settings right now.")
);
assert(
  "settings renders authenticated dark section system",
  settings.includes("bg-[#071426]") &&
    settings.includes("bg-[#061222]") &&
    settings.includes("rounded-[4px]") &&
    settings.includes("border-white/10") &&
    settings.includes("Account and preferences.") &&
    !settings.includes("rounded-xl") &&
    !settings.includes("rounded-2xl")
);
assert(
  "settings uses dark local form controls and readable section navigation",
  settings.includes("const darkFieldClassName") &&
    settings.includes("!bg-[#061222]") &&
    settings.includes("disabled:!bg-white/[0.035]") &&
    settings.includes("border-cyan-200/35 bg-cyan-300/10 text-white") &&
    settings.includes("text-slate-300 hover:border-white/10") &&
    !settings.includes("bg-primary-subtle text-primary")
);
assert(
  "settings page header and normal helper copy stay readable on navy",
  settings.includes("[&_h1]:!text-white") &&
    settings.includes("[&_p:not(.type-label)]:!text-slate-200") &&
    settings.includes("mt-1 text-sm leading-5 text-slate-200") &&
    settings.includes("mt-1.5 text-xs text-slate-300") &&
    !settings.includes("text-text-secondary")
);
assert(
  "settings controls keep accessibility helpers",
  settings.includes('name="full_name"') &&
    settings.includes('autoComplete="name"') &&
    settings.includes('type="email"') &&
    settings.includes("spellCheck={false}") &&
    settings.includes('name="target_level"')
);
assert(
  "settings preferences do not invent unsupported delivery channels",
  settings.includes("In-app notification preference") &&
    settings.includes("without adding unsupported delivery channels") &&
    !/digest|mobile push|promotional|SMS|marketing/i.test(settings)
);
assert(
  "settings loading skeleton is representative and dark",
  skeleton.includes('data-settings-loading="account-preferences"') &&
    skeleton.includes("Loading settings") &&
    skeleton.includes("bg-[#071426]") &&
    !/SettingsSkeleton[\s\S]*PanelSkeleton \/>/.test(skeleton)
);

assert(
  "roadmap keeps existing Supabase progression semantics",
  roadmap.includes('from("roadmap_progress")') &&
    roadmap.includes("roadmap_modules") &&
    roadmap.includes('supabase.rpc("reset_my_roadmap")') &&
    roadmap.includes("setItems((current) =>") &&
    !roadmap.includes("from(\"lab_assets\")") &&
    !roadmap.includes("from(\"labs\")")
);
assert(
  "roadmap remains distinct from progress analytics",
  roadmap.includes('data-roadmap-phase="ordered-learning-path"') &&
    roadmap.includes("Your cybersecurity learning plan") &&
    roadmap.includes("Roadmap Timeline") &&
    !/streak|trend|chart|analytics|heatmap/i.test(roadmap)
);
assert(
  "roadmap removes legacy light Card surfaces from main route",
  !roadmap.includes("import Card") &&
    !roadmap.includes("<Card") &&
    roadmap.includes("Amniora learning path") &&
    roadmap.includes("grid min-w-0 divide-y divide-white/10") &&
    roadmap.includes("border border-white/10 bg-[#071426]") &&
    !/Cybersecurity Foundation Roadmap|bg-surface p-space-4|bg-primary-subtle/.test(roadmap)
);
assert(
  "roadmap page copy and module descriptions stay readable on navy",
  roadmap.includes("[&_h1]:!text-white") &&
    roadmap.includes("[&_p:not(.type-label)]:!text-slate-200") &&
    roadmap.includes("leading-7 text-slate-200") &&
    roadmap.includes("line-clamp-3 text-slate-200") &&
    roadmap.includes("type-caption text-slate-300") &&
    !roadmap.includes("type-body mt-space-3 break-words leading-7 text-slate-300")
);
assert(
  "roadmap states are textual and not colour only",
  ["Completed", "Current", "Not Started"].every((label) => roadmap.includes(label)) &&
    roadmap.includes('aria-label="Overall roadmap progress"') &&
    roadmap.includes("aria-valuetext")
);
assert(
  "roadmap reset remains destructive and bounded",
  roadmap.includes("Reset roadmap?") &&
    roadmap.includes("achievements. Your saved investigations will not be deleted.") &&
    roadmap.includes("loading={resetting}") &&
    roadmap.includes('loadingText="Resetting..."')
);
assert(
  "roadmap loading and empty states are dark and truthful",
    skeleton.includes('data-roadmap-loading="ordered-learning-path"') &&
    skeleton.includes("Loading roadmap") &&
    roadmap.includes("No roadmap modules available") &&
    /when modules have been assigned\s+to your account/.test(roadmap) &&
    !/placeholder stage|fake XP/i.test(skeleton)
);

assert(
  "notifications load real owned rows with bounded count",
  notificationBell.includes('from("notifications")') &&
    notificationBell.includes('select("id, title, message, type, read, created_at")') &&
    notificationBell.includes(".limit(20)") &&
    notificationBell.includes("filter: `user_id=eq.${user.id}`")
);
assert(
  "notifications have explicit dark loading rows",
  notificationBell.includes("function NotificationSkeletonRows()") &&
    notificationBell.includes('data-notification-loading="dark-skeleton"') &&
    notificationBell.includes("Loading notifications") &&
    !notificationBell.includes("Loading...")
);
assert(
  "notifications avoid light popover and row surfaces",
  notificationBell.includes("z-[70]") &&
    notificationBell.includes("relative z-40") &&
    notificationBell.includes("bg-[#071426]") &&
    notificationBell.includes("bg-[#061222]") &&
    !/bg-blue-50|border-blue-200|hover:bg-red-50/.test(notificationBell)
);
assert(
  "notifications preserve actions and safe errors",
    notificationBell.includes("markAllAsRead") &&
    notificationBell.includes("clearAllNotifications") &&
    notificationBell.includes("Updating...") &&
    notificationBell.includes("Clearing...") &&
    notificationBell.includes("Mark All Read") &&
    notificationBell.includes("Notifications could not be loaded right now.") &&
    !notificationBell.includes("notificationsError.message") &&
    !notificationBell.includes("userError.message")
);
assert(
  "notification panel remains accessible and viewport safe",
  notificationBell.includes('aria-haspopup="dialog"') &&
    notificationBell.includes('aria-labelledby="notification-panel-title"') &&
    notificationBell.includes("Escape") &&
    notificationBell.includes("pointerdown") &&
    notificationBell.includes("buttonRef.current?.focus()") &&
    notificationBell.includes("w-[min(24rem,calc(100vw-2rem))]") &&
    notificationBell.includes("max-h-[min(26rem,calc(100dvh-7rem))]")
);
assert(
  "notifications show real timestamps only from row data",
    notificationBell.includes("formatNotificationTime(notification.created_at)") &&
    notificationBell.includes("dateTime={notification.created_at}") &&
    !/sample notification|placeholder title|placeholder message/i.test(notificationBell)
);
assert(
  "notification presentation normalizes legacy achievement terminology",
  notificationBell.includes("function normalizeNotificationCopy") &&
    notificationBell.includes('replace(/\\bCyberLab\\b/g, "Amniora")') &&
    notificationBell.includes('replace(/\\bLab Builder\\b/g, "Investigation Builder")') &&
    notificationBell.includes('replace(/\\bcybersecurity labs\\b/g, "cybersecurity investigations")') &&
    notificationBell.includes("normalizeNotificationCopy(notification.title)") &&
    notificationBell.includes("normalizeNotificationCopy(notification.message)")
);

assert(
  "achievement toast is driven only by real achievement notifications",
    achievementToast.includes('from("notifications")') &&
    achievementToast.includes('.eq("type", "achievement")') &&
    achievementToast.includes('if (notification.type !== "achievement") return false') &&
    !achievementToast.includes('from("user_achievements").insert') &&
    !achievementToast.includes("user_achievements")
);
assert(
  "achievement toast queues multiple earned achievements without overlap",
  achievementToast.includes("const [queue, setQueue]") &&
    achievementToast.includes("const [activeAchievement, setActiveAchievement]") &&
    achievementToast.includes("data-achievement-toast-queue") &&
    achievementToast.includes("more achievement")
);
assert(
  "achievement toast prevents duplicate display by notification id",
  achievementToast.includes("displayedIdsRef") &&
    achievementToast.includes("displayedIdsRef.current.has(notification.id)") &&
    achievementToast.includes("displayedIdsRef.current.add(notification.id)")
);
assert(
  "achievement toast supports reduced motion and restrained motion only",
  achievementToast.includes("useReducedMotion") &&
    achievementToast.includes("reducedMotion ? { opacity: 0 }") &&
    !/confetti|particle|bounce|rotate:|scale:/.test(achievementToast)
);
assert(
  "achievement toast is compact, dismissible and dark",
  achievementToast.includes('data-achievement-toast="earned"') &&
    achievementToast.includes("bg-[#071426]") &&
    achievementToast.includes('aria-label="Close achievement notification"') &&
    !/rounded-ui-md|bg-surface p-4 text-text/.test(achievementToast)
);
assert(
  "achievement toast normalizes legacy achievement copy in presentation only",
  achievementToast.includes("function normalizeAchievementCopy") &&
    achievementToast.includes('replace(/\\bCyberLab\\b/g, "Amniora")') &&
    achievementToast.includes('replace(/\\bLab Builder\\b/g, "Investigation Builder")') &&
    achievementToast.includes("normalizeAchievementCopy(activeAchievement.title)") &&
    achievementToast.includes("normalizeAchievementCopy(activeAchievement.message)")
);

assert(
  "frozen authenticated shell and navigation remain structurally untouched",
  dashboardLayout.includes("topBar={<TopBar />}") &&
    appShell.includes("data-authenticated-main-region") &&
    sidebar.includes("data-authenticated-sidebar-nav") &&
    sidebar.includes("data-authenticated-mobile-drawer")
);
assert(
  "approved major authenticated pages remain out of this checkpoint",
  progress.includes('data-progress-phase="dark-learning-record"') &&
    saved.includes('data-saved-investigations-index="registry"') &&
    savedDetail.includes('data-saved-investigation-page="dark-continuous"') &&
    tutor.includes("data-ai-tutor-workspace") &&
    labs.includes("IMPORTANT SAFETY NOTICE")
);
assert(
  "learner-facing authenticated terminology avoids legacy CyberLab copy",
  !/CyberLab/.test(`${settings}\n${roadmap}`)
);

console.log(`Authenticated remaining surfaces tests passed (${assertions} assertions).`);
