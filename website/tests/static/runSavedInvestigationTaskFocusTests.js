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

const savedDetail = readText("app/dashboard/saved/[id]/page.tsx");
const taskCard = readText("app/dashboard/saved/[id]/TaskCard.tsx");
const feedbackCard = readText("app/dashboard/saved/[id]/LabFeedbackCard.tsx");

assert(
  "detail page owns selected task state",
  savedDetail.includes("selectedTaskIndex") &&
    savedDetail.includes("safeSelectedTaskIndex") &&
    savedDetail.includes("setSelectedTaskIndex")
);

assert(
  "default selection uses first incomplete real grading state when available",
  savedDetail.includes("hasUserSelectedTask") &&
    savedDetail.includes("gradingTasks.find((task) => !task.latestAttempt?.mastered)") &&
    savedDetail.includes("firstIncomplete?.index ?? 0")
);

assert(
  "legacy all-task TaskCard stack is removed",
  !savedDetail.includes("lab.tasks.map((task, index) => (") &&
    savedDetail.includes("activeTask ? (") &&
    savedDetail.includes("task={activeTask}") &&
    savedDetail.includes("index={safeSelectedTaskIndex}")
);

assert(
  "selected task workspace renders one active TaskCard",
  savedDetail.includes('data-saved-investigation-task-workspace="selected"') &&
    savedDetail.includes('data-saved-investigation-active-task="true"') &&
    savedDetail.includes("<AnimatePresence mode=\"wait\" initial={false}>") &&
    savedDetail.includes("key={safeSelectedTaskIndex}")
);

assert(
  "desktop task rail uses semantic task navigation buttons",
  savedDetail.includes("function TaskRail") &&
    savedDetail.includes('data-saved-investigation-task-rail="desktop"') &&
    savedDetail.includes('aria-label="Investigation task navigation"') &&
    savedDetail.includes('data-saved-investigation-task-rail-row="true"') &&
    savedDetail.includes('aria-current={selected ? "step" : undefined}')
);

assert(
  "desktop rail status uses only real grading data",
  savedDetail.includes("function taskRailStatus") &&
    savedDetail.includes("task.latestAttempt?.mastered") &&
    savedDetail.includes('task.latestAttempt?.status === "graded"') &&
    savedDetail.includes('task.latestAttempt?.status === "retryable"') &&
    savedDetail.includes("!gradingAvailable || !task?.taskId")
);

assert(
  "task switching is UI-only and does not call generation, grading, or guidance APIs",
  savedDetail.includes("onSelect={(index) => {") &&
    savedDetail.includes("hasUserSelectedTask.current = true") &&
    !/onSelect=\{\(index\)[\s\S]{0,240}fetch\(/.test(savedDetail) &&
    !/moveSelection\(nextIndex[\s\S]{0,240}fetch\(/.test(savedDetail)
);

assert(
  "keyboard task movement supports arrow keys",
  savedDetail.includes('event.key === "ArrowDown"') &&
    savedDetail.includes('event.key === "ArrowUp"') &&
    savedDetail.includes("event.preventDefault()") &&
    savedDetail.includes("moveSelection(index + 1)") &&
    savedDetail.includes("moveSelection(index - 1)")
);

assert(
  "mobile uses selector instead of squeezed desktop rail",
  savedDetail.includes('data-saved-investigation-mobile-task-selector="true"') &&
    savedDetail.includes("lg:hidden") &&
    savedDetail.includes("Choose investigation task") &&
    savedDetail.includes('data-saved-investigation-desktop-task-rail="true"') &&
    savedDetail.includes("hidden min-w-0") &&
    savedDetail.includes("lg:block")
);

assert(
  "task rail preserves structured and legacy task parsing",
  savedDetail.includes("function parseTaskSummary") &&
    savedDetail.includes("JSON.parse(task)") &&
    savedDetail.includes("parsed?.phase") &&
    savedDetail.includes("parsed?.title") &&
    savedDetail.includes("task.split(/\\r?\\n/)")
);

assert(
  "draft preservation remains owned by existing TaskCard localStorage keys",
  taskCard.includes("amniora:linux-grading:draft:${labId}:${taskId || index}") &&
    taskCard.includes("window.localStorage.setItem(draftStorageKey, bounded)") &&
    taskCard.includes("window.localStorage.getItem(draftStorageKey)")
);

assert(
  "TaskCard grading and AI guidance behavior remains unchanged",
  taskCard.includes("/api/ai/linux-grading") &&
    taskCard.includes("/api/ai/task-assist") &&
    taskCard.includes("AiContentSharingConsentDialog") &&
    taskCard.includes("SafeFeedback")
);

assert(
  "feedback and reporting component remains untouched by task focus phase",
  feedbackCard.includes("/api/labs/${encodeURIComponent(labId)}/feedback") &&
    feedbackCard.includes("/api/labs/${encodeURIComponent(labId)}/complaints") &&
    feedbackCard.includes("Submit report")
);

assert(
  "Phase 5B.2.1 identity header remains present",
  savedDetail.includes('data-saved-investigation-header="identity"') &&
    savedDetail.includes("Back to Saved Investigations") &&
    savedDetail.includes('data-saved-investigation-header-actions="exports"')
);

console.log(
  `Saved Investigation task focus tests passed (${assertions} assertions).`
);
