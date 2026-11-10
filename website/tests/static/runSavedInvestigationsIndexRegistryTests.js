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

const savedIndex = readText("app/dashboard/saved/page.tsx");
const savedDetail = readText("app/dashboard/saved/[id]/page.tsx");
const taskCard = readText("app/dashboard/saved/[id]/TaskCard.tsx");
const feedbackCard = readText("app/dashboard/saved/[id]/LabFeedbackCard.tsx");
const responsiveWidthCoverage = [430, 768, 820, 900, 1024, 1100, 1200, 1440];

assert(
  "index uses Saved Investigations terminology",
  savedIndex.includes("Saved Investigations") &&
    savedIndex.includes("Investigation Registry") &&
    savedIndex.includes("Open Investigation") &&
    savedIndex.includes("Delete Investigation")
);
assert(
  "old card-grid visible terminology is removed from index",
  !savedIndex.includes("Saved Labs") &&
    !savedIndex.includes("Open Lab") &&
    !savedIndex.includes("Generate Lab") &&
    !savedIndex.includes("Delete lab?")
);
assert(
  "index keeps lightweight labs query with cheap metadata only",
  savedIndex.includes(".from(\"labs\")") &&
    savedIndex.includes(
      "\"id, title, difficulty, completed, created_at, topic, estimated_time\""
    )
);
assert(
  "index does not fetch heavy detail data",
  !savedIndex.includes(".from(\"lab_assets\")") &&
    !savedIndex.includes("grading_attempt") &&
    !savedIndex.includes("assessment") &&
    !savedIndex.includes("provenance") &&
    !savedIndex.includes("scenario") &&
    !savedIndex.includes("objective") &&
    !savedIndex.includes("tasks,") &&
    !savedIndex.includes("hints") &&
    !savedIndex.includes("outcomes")
);
assert(
  "index preserves user ownership predicates for deletes",
  savedIndex.includes(".eq(\"id\", deleteTarget.id)") &&
    savedIndex.includes(".eq(\"user_id\", user.id)") &&
    savedIndex.includes(".delete()")
);
assert(
  "index preserves newest-first ordering",
  savedIndex.includes(".order(\"created_at\", { ascending: false })")
);
assert(
  "index preserves title search and explicit clear action",
  savedIndex.includes("investigation.title.toLowerCase().includes") &&
    savedIndex.includes("Clear saved investigation search") &&
    savedIndex.includes("Clear Search")
);
assert(
  "search-empty and true-empty states are separate",
  savedIndex.includes("No Matching Investigations") &&
    savedIndex.includes("No Saved Investigations") &&
    savedIndex.includes("hasSearch")
);
assert(
  "index uses a row registry instead of a card grid",
  savedIndex.includes('data-saved-investigations-index="registry"') &&
    savedIndex.includes('data-saved-investigation-record="true"') &&
    savedIndex.includes('data-saved-investigation-layout="responsive-record"') &&
    savedIndex.includes("divide-y divide-white/10") &&
    savedIndex.includes("xl:grid-cols-[minmax(0,1.2fr)_minmax(7rem,8rem)_minmax(8rem,9rem)_minmax(8.5rem,9.5rem)_minmax(17.5rem,19rem)]") &&
    !savedIndex.includes("xl:grid-cols-2") &&
    !savedIndex.includes("SavedLabCard")
);
assert(
  "index uses dark authenticated surfaces",
  savedIndex.includes("bg-[#071426]") &&
    savedIndex.includes("text-white") &&
    savedIndex.includes("border-white/10") &&
    !savedIndex.includes("bg-surface p-space-4 shadow-surface")
);
assert(
  "search control uses native dark registry styling",
  savedIndex.includes("<input") &&
    savedIndex.includes("bg-[#081827]") &&
    savedIndex.includes("border-cyan-100/15") &&
    savedIndex.includes("placeholder:text-slate-500") &&
    savedIndex.includes("focus:border-cyan-300/55") &&
    !savedIndex.includes("import Input")
);
assert(
  "toolbar is a composed control strip",
  savedIndex.includes('aria-label="Saved investigation tools"') &&
    savedIndex.includes("bg-[#061222]") &&
    savedIndex.includes("xl:grid-cols-[minmax(18rem,32rem)_auto]") &&
    savedIndex.includes("xl:border-l xl:border-white/10 xl:pl-space-4")
);
assert(
  "action labels cannot wrap and have enough mid-size and desktop space",
  savedIndex.includes("whitespace-nowrap") &&
    savedIndex.includes("min-w-[5.25rem]") &&
    savedIndex.includes("min-w-[12rem]") &&
    savedIndex.includes("md:flex-col md:items-stretch") &&
    savedIndex.includes("xl:flex-nowrap") &&
    savedIndex.includes("xl:order-1") &&
    savedIndex.includes("xl:order-2")
);
assert(
  "full desktop headings wait for wide content and cannot wrap vertically",
  savedIndex.includes('data-saved-investigations-desktop-heading="true"') &&
    savedIndex.includes("hidden whitespace-nowrap border-b") &&
    savedIndex.includes("xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(7rem,8rem)_minmax(8rem,9rem)_minmax(8.5rem,9.5rem)_minmax(17.5rem,19rem)]") &&
    !savedIndex.includes("lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(7rem,8rem)_minmax(8rem,9rem)_minmax(8.5rem,9.5rem)_minmax(17.5rem,19rem)]")
);
assert(
  "mid-size condensed row exists before the full desktop table",
  savedIndex.includes("md:grid-cols-[minmax(0,1fr)_minmax(8.5rem,10rem)_minmax(15.5rem,auto)]") &&
    savedIndex.includes("md:row-span-2") &&
    savedIndex.includes("md:col-start-2 md:row-start-1") &&
    savedIndex.includes("md:col-start-2 md:row-start-2") &&
    savedIndex.includes("md:col-start-3 md:row-span-2")
);
assert(
  "mobile stacked row keeps metadata visible before the breakpoint",
  savedIndex.includes("<span translate=\"no\">{investigation.difficulty}</span>") &&
    savedIndex.includes("<span className=\"xl:hidden\">Created: </span>") &&
    savedIndex.includes("max-w-full break-words") &&
    savedIndex.includes("flex-col gap-space-2 sm:flex-row")
);
assert(
  "representative responsive widths are protected by source assertions",
  responsiveWidthCoverage.join(",") === "430,768,820,900,1024,1100,1200,1440"
);
assert(
  "primary actions use restrained dark-blue treatment",
  savedIndex.includes("bg-[#0b2033]") &&
    savedIndex.includes("text-cyan-100") &&
    !savedIndex.includes("bg-cyan-300 px-space-4 text-slate-950") &&
    !savedIndex.includes("bg-cyan-300 px-space-3 text-slate-950")
);
assert(
  "Delete All remains readable and destructive",
  savedIndex.includes("Delete All") &&
    savedIndex.includes("border-red-300/30") &&
    savedIndex.includes("bg-red-950/15") &&
    savedIndex.includes("text-red-100")
);
assert(
  "loading state mirrors dark registry rows",
  savedIndex.includes("SavedInvestigationsLoading") &&
    savedIndex.includes('data-saved-investigations-loading="registry"') &&
    savedIndex.includes("Loading saved investigations…") &&
    savedIndex.includes("role=\"status\"") &&
    savedIndex.includes("aria-busy=\"true\"") &&
    savedIndex.includes("xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(7rem,8rem)_minmax(8rem,9rem)_minmax(8.5rem,9.5rem)_minmax(17.5rem,19rem)]")
);
assert(
  "load error is learner-safe and does not surface raw backend text",
  savedIndex.includes("Unable to Load Investigations") &&
    savedIndex.includes("Amniora could not load your saved investigations") &&
    !savedIndex.includes("investigationError.message") &&
    !savedIndex.includes("labsError.message")
);
assert(
  "delete confirmations remain explicit and permanent",
  savedIndex.includes("Delete All Investigations?") &&
    savedIndex.includes("This action is permanent and cannot be undone.") &&
    savedIndex.includes("will be permanently deleted.") &&
    savedIndex.includes("aria-modal=\"true\"")
);
assert(
  "mobile actions remain stacked without a desktop table dependency",
  savedIndex.includes("flex-col gap-space-2 sm:flex-row") &&
    savedIndex.includes("order-1") &&
    savedIndex.includes("order-2") &&
    !savedIndex.includes("<table") &&
    !savedIndex.includes("overflow-x-auto")
);
assert(
  "interactive controls have labels and visible focus states",
  savedIndex.includes("aria-label=\"Search saved investigation titles\"") &&
    savedIndex.includes("aria-label=\"Clear saved investigation search\"") &&
    savedIndex.includes("aria-label=\"Close confirmation dialog\"") &&
    savedIndex.includes("focus-visible:ring")
);
assert(
  "motion respects reduced-motion preference",
  savedIndex.includes("useReducedMotion") &&
    savedIndex.includes("motion-reduce:transform-none")
);
assert(
  "detail workspace files are not imported into the index redesign",
  !savedIndex.includes("TaskCard") &&
    !savedIndex.includes("LabFeedbackCard") &&
    savedDetail.includes("TaskCard") &&
    savedDetail.includes("LabFeedbackCard") &&
    taskCard.includes("TaskCard") &&
    feedbackCard.includes("LabFeedbackCard")
);

console.log(
  `Saved Investigations index registry tests passed (${assertions} assertions).`
);
