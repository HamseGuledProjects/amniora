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

const detailPage = readText("app/dashboard/saved/[id]/page.tsx");
const taskCard = readText("app/dashboard/saved/[id]/TaskCard.tsx");
const feedbackCard = readText("app/dashboard/saved/[id]/LabFeedbackCard.tsx");
const skeletons = readText("app/components/ui/Skeleton.tsx");
const appShell = readText("app/components/shell/AppShell.tsx");
const combined = `${detailPage}\n${taskCard}\n${feedbackCard}`;
const detailSkeleton = skeletons.slice(
  skeletons.indexOf("export function LabDetailSkeleton"),
  skeletons.indexOf("export function DashboardSkeleton")
);

assert(
  "individual investigation page no longer imports generic Card surfaces",
  !detailPage.includes('from "@/app/components/ui/Card"') &&
    !feedbackCard.includes('from "@/app/components/ui/Card"') &&
    !combined.includes("<Card")
);

assert(
  "major investigation sections use dark low-radius shells",
  detailPage.includes('data-saved-investigation-page="dark-continuous"') &&
    detailPage.includes('data-saved-investigation-brief="dark"') &&
    detailPage.includes('data-saved-investigation-section="dark"') &&
    detailPage.includes("rounded-[3px] border border-cyan-100/12 bg-[#071426]")
);

assert(
  "active task presentation remains integrated into the workspace",
  taskCard.includes('data-saved-investigation-active-task-card="dark"') &&
    taskCard.includes('data-active-task-evidence-requirements="true"') &&
    taskCard.includes('data-active-task-deliverable="true"') &&
    taskCard.includes('data-active-task-answer-workbench="true"') &&
    !taskCard.includes("rounded-ui-md border border-border bg-surface shadow-surface")
);

assert(
  "forensic evidence library uses dark rows and preserves downloads",
  detailPage.includes('data-saved-investigation-evidence-list="dark"') &&
    detailPage.includes("onClick={() => onDownload(asset)}") &&
    detailPage.includes("asset.file_name") &&
    detailPage.includes("asset.file_path") &&
    detailPage.includes("asset.file_type") &&
    !/Evidence Library[\s\S]{0,1400}bg-surface/.test(detailPage)
);

assert(
  "feedback and reporting are dark without changing endpoints",
  feedbackCard.includes('data-saved-investigation-feedback="dark"') &&
    feedbackCard.includes("Help us improve this investigation") &&
    feedbackCard.includes("/api/labs/${encodeURIComponent(labId)}/feedback") &&
    feedbackCard.includes("/api/labs/${encodeURIComponent(labId)}/complaints") &&
    !feedbackCard.includes("Help us improve this lab")
);

assert(
  "feedback controls do not use light textarea/select primitives",
  !feedbackCard.includes('from "@/app/components/ui/Textarea"') &&
    !feedbackCard.includes('from "@/app/components/ui/Select"') &&
    feedbackCard.includes("bg-[#081827]") &&
    feedbackCard.includes("focus:border-cyan-300/55")
);

assert(
  "completion action is compact in the main investigation flow",
  detailPage.includes("function InvestigationCompletionPanel") &&
    detailPage.includes('data-investigation-completion-action="true"') &&
    !detailPage.includes("function InvestigationSidebar") &&
    !detailPage.includes("xl:sticky xl:top-24")
);

assert(
  "detail route does not create a second page-level scroll container",
  !/max-h-\[calc\(100(?:d)?vh-[^\]]+\)\]/.test(detailPage) &&
    !/\boverflow-y-(?:auto|scroll)\b/.test(detailPage) &&
    !/\boverflow-scroll\b/.test(detailPage) &&
    !/\boverscroll-contain\b/.test(detailPage) &&
    !/data-saved-investigation-page="dark-continuous"[\s\S]{0,220}min-h-full/.test(detailPage)
);

assert(
  "authenticated shell prevents document-root scrolling for long saved investigations",
  appShell.includes("data-authenticated-shell") &&
    appShell.includes("fixed inset-0") &&
    appShell.includes("overflow-hidden") &&
    appShell.includes("data-authenticated-main-region") &&
    appShell.includes("overflow-y-auto overflow-x-clip")
);

assert(
  "loaded saved investigation wrapper grows with content instead of viewport clipping",
  detailPage.includes('data-saved-investigation-page="dark-continuous"') &&
    detailPage.includes('className="space-y-space-5 bg-[#0c1828] pb-space-6 text-white"') &&
    !detailPage.includes('className="min-h-full space-y-space-5 bg-[#0c1828] pb-space-6 text-white"')
);

assert(
  "desktop task rail participates in normal page scroll",
  detailPage.includes('data-saved-investigation-desktop-task-rail="true"') &&
    detailPage.includes('className="divide-y divide-white/10"') &&
    !/data-saved-investigation-desktop-task-rail="true"[\s\S]{0,900}overflow-y-auto/.test(detailPage) &&
    !/data-saved-investigation-desktop-task-rail="true"[\s\S]{0,900}max-h-\[calc/.test(detailPage)
);

assert(
  "feedback textareas retain their native internal scroll behavior",
  feedbackCard.includes("resize-y") &&
    feedbackCard.includes('id="lab-feedback-note"') &&
    feedbackCard.includes('id="lab-complaint-description"') &&
    !/\boverflow-y-(?:auto|scroll)\b/.test(feedbackCard)
);

assert(
  "approved header and task rail remain frozen",
  detailPage.includes('data-saved-investigation-header="identity"') &&
    detailPage.includes('data-saved-investigation-header-actions="exports"') &&
    detailPage.includes('data-saved-investigation-task-workspace="selected"') &&
    detailPage.includes('data-saved-investigation-task-rail="desktop"') &&
    detailPage.includes('data-saved-investigation-mobile-task-selector="true"')
);

assert(
  "legacy bright/light surface classes are absent from individual workspace files",
  !/\b(app-analytical-surface|bg-surface|bg-surface-muted|border-border|rounded-ui-md|rounded-ui-lg|rounded-xl|rounded-2xl)\b/.test(combined)
);

assert(
  "mobile overflow protections remain present",
  detailPage.includes("break-all") &&
    detailPage.includes("min-w-0") &&
    taskCard.includes("max-w-full overflow-hidden") &&
    taskCard.includes("max-w-full overflow-x-auto") &&
    feedbackCard.includes("min-w-0")
);

assert(
  "saved investigation loading state mirrors redesigned dark workspace",
  detailSkeleton.includes('data-saved-investigation-loading="dark-workspace"') &&
    detailSkeleton.includes("Loading investigation identity") &&
    detailSkeleton.includes("Loading case overview") &&
    detailSkeleton.includes("Loading task focus") &&
    detailSkeleton.includes("Loading evidence library") &&
    detailSkeleton.includes("bg-[#071426]") &&
    detailSkeleton.includes("bg-[#061222]")
);

assert(
  "saved investigation loading state follows the same single-scroll architecture",
  !/max-h-\[calc\(100(?:d)?vh-[^\]]+\)\]/.test(detailSkeleton) &&
    !/\boverflow-y-(?:auto|scroll)\b/.test(detailSkeleton) &&
    !/\boverflow-scroll\b/.test(detailSkeleton) &&
    !/\boverscroll-contain\b/.test(detailSkeleton) &&
    !/data-saved-investigation-loading="dark-workspace"[\s\S]{0,220}min-h-full/.test(detailSkeleton)
);

assert(
  "saved investigation loading state omits legacy light details sidebar",
  !/Lab Details|Investigation Status|rounded-ui-md|bg-surface|bg-surface-muted|border-border|shadow-surface/.test(detailSkeleton)
);

assert(
  "saved investigation error and not-found states are route-local dark surfaces",
  detailPage.includes("function SavedInvestigationErrorState") &&
    detailPage.includes('data-saved-investigation-error="dark"') &&
    detailPage.includes("bg-[#0c1828]") &&
    detailPage.includes("bg-[#071426]") &&
    !detailPage.includes('from "@/app/components/ui/ErrorState"')
);

assert(
  "saved investigation readable content avoids too-dark muted body classes",
  !/text-text(?:\b|-secondary|-muted)/.test(combined) &&
    detailPage.includes("text-slate-200") &&
    detailPage.includes("text-slate-300") &&
    detailPage.includes("font-semibold text-slate-100 lg:hidden") &&
    feedbackCard.includes("placeholder:text-slate-400") &&
    taskCard.includes("placeholder:text-slate-400")
);

assert(
  "saved investigation loading labels use polished ellipsis copy",
  detailPage.includes('loadingText="Saving…"') &&
    taskCard.includes('loadingText="Submitting…"') &&
    feedbackCard.includes('loadingText="Saving…"') &&
    feedbackCard.includes('loadingText="Submitting…"') &&
    !/loadingText="(?:Saving|Submitting)\.\.\."/.test(combined)
);

console.log(
  `Saved Investigation legacy cleanup tests passed (${assertions} assertions).`
);
