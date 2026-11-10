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

assert(
  "active task card uses dark workspace marker and surface",
  taskCard.includes('data-saved-investigation-active-task-card="dark"') &&
    taskCard.includes("bg-[#071426]") &&
    taskCard.includes("bg-[#061222]") &&
    taskCard.includes("border-white/10") &&
    taskCard.includes("rounded-[4px]")
);

assert(
  "active task card no longer uses giant legacy card styling",
  !taskCard.includes("rounded-ui-md border border-border bg-surface shadow-surface") &&
    !taskCard.includes("bg-surface-muted p-space-3") &&
    !taskCard.includes("bg-primary text-sm font-bold text-white")
);

assert(
  "evidence requirements use compact dark records",
  taskCard.includes('data-active-task-evidence-requirements="true"') &&
    taskCard.includes("Evidence Required") &&
    taskCard.includes("bg-[#081827]") &&
    taskCard.includes("bg-[#0b2033]") &&
    !taskCard.includes('<Badge\n                        key={item}')
);

assert(
  "deliverable is a dark structured region",
  taskCard.includes('data-active-task-deliverable="true"') &&
    taskCard.includes("Deliverable") &&
    taskCard.includes("text-slate-200") &&
    !taskCard.includes("rounded-ui-sm border border-border bg-surface-muted p-space-3")
);

assert(
  "answer workbench uses dark input surface",
    taskCard.includes('data-active-task-answer-workbench="true"') &&
    taskCard.includes("bg-[#061222]") &&
    taskCard.includes("bg-[#081827]") &&
    taskCard.includes("placeholder:text-slate-400") &&
    taskCard.includes("focus:border-cyan-300/55")
);

assert(
  "AI guidance controls remain present but darkened",
  taskCard.includes('data-active-task-guidance-strip="true"') &&
    ["Explain", "Hint", "Command", "Quiz"].every((label) => taskCard.includes(label)) &&
    taskCard.includes("/api/ai/task-assist") &&
    taskCard.includes("border-cyan-300/45 bg-cyan-300/10")
);

assert(
  "guidance response and grading feedback are dark surfaces",
  taskCard.includes('aria-live="polite"') &&
    taskCard.includes("Loading AI guidance") &&
    taskCard.includes("bg-cyan-300/15") &&
    taskCard.includes("function SafeFeedback") &&
    taskCard.includes("bg-[#081827] p-space-4")
);

assert(
  "grading and consent behavior remain unchanged",
  taskCard.includes("/api/ai/linux-grading") &&
    taskCard.includes("/api/ai/linux-grading/consent") &&
    taskCard.includes("AiContentSharingConsentDialog") &&
    taskCard.includes("idempotencyKey: getIdempotencyKey()")
);

assert(
  "draft persistence remains unchanged",
  taskCard.includes("amniora:linux-grading:draft:${labId}:${taskId || index}") &&
    taskCard.includes("window.localStorage.getItem(draftStorageKey)") &&
    taskCard.includes("window.localStorage.setItem(draftStorageKey, bounded)")
);

assert(
  "duplicate legacy sidebar metadata is removed",
  !detailPage.includes("Investigation status") &&
    !detailPage.includes("Overall lab status") &&
    !detailPage.includes("Lab Details") &&
    !detailPage.includes("<MetadataRow")
);

assert(
  "unique completion action is preserved outside header",
  detailPage.includes('data-investigation-completion-action="true"') &&
    detailPage.includes("onToggleCompleted") &&
    detailPage.includes("manualCompletionLocked") &&
    detailPage.includes("Mark as completed") &&
    detailPage.includes("Controlled by grading")
);

assert(
  "approved header and task rail markers remain frozen",
  detailPage.includes('data-saved-investigation-header="identity"') &&
    detailPage.includes('data-saved-investigation-task-workspace="selected"') &&
    detailPage.includes('data-saved-investigation-task-rail="desktop"') &&
    detailPage.includes('data-saved-investigation-mobile-task-selector="true"')
);

assert(
  "feedback/reporting behavior remains preserved",
  feedbackCard.includes("/api/labs/${encodeURIComponent(labId)}/feedback") &&
    feedbackCard.includes("/api/labs/${encodeURIComponent(labId)}/complaints") &&
    feedbackCard.includes("Report a problem")
);

assert(
  "mobile dark controls retain overflow protection",
  taskCard.includes("grid grid-cols-2 gap-space-2 sm:flex sm:flex-wrap") &&
    taskCard.includes("max-w-full overflow-hidden") &&
    taskCard.includes("max-w-full overflow-x-auto") &&
    taskCard.includes("break-words")
);

console.log(
  `Saved Investigation active task workspace tests passed (${assertions} assertions).`
);
