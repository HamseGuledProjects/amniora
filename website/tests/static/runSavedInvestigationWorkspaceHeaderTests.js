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
const headerBlock = savedDetail.slice(
  savedDetail.indexOf("function InvestigationIdentityHeader"),
  savedDetail.indexOf("function HeaderMetadata")
);

assert(
  "detail page uses a dedicated saved investigation identity header",
  savedDetail.includes("function InvestigationIdentityHeader") &&
    savedDetail.includes('data-saved-investigation-header="identity"') &&
    savedDetail.includes('aria-labelledby="saved-investigation-title"')
);

assert(
  "header preserves Saved Investigations back navigation",
  savedDetail.includes('href="/dashboard/saved"') &&
    savedDetail.includes("Back to Saved Investigations") &&
    savedDetail.includes("ArrowLeft")
);

assert(
  "header makes the investigation title the primary element",
  savedDetail.includes('id="saved-investigation-title"') &&
    savedDetail.includes("{lab.title}") &&
    savedDetail.includes("break-words") &&
    savedDetail.includes("text-2xl") &&
    savedDetail.includes("sm:text-3xl")
);

assert(
  "header renders real metadata fields",
  savedDetail.includes('data-saved-investigation-header-metadata="true"') &&
    savedDetail.includes('label="Category" value={lab.topic}') &&
    savedDetail.includes('label="Difficulty" value={lab.difficulty}') &&
    savedDetail.includes('label="Duration" value={lab.estimated_time}')
);

assert(
  "header uses only real completion states",
  savedDetail.includes('const status = lab.completed ? "Completed" : "In Progress"') &&
    savedDetail.includes("lab.completed ?") &&
    !savedDetail.includes("Archived") &&
    !savedDetail.includes("Needs Review")
);

assert(
  "header keeps export actions functional",
  savedDetail.includes('data-saved-investigation-header-actions="exports"') &&
    savedDetail.includes("onDownload={downloadEvidencePack}") &&
    savedDetail.includes("onDownloadPdf={downloadInvestigationPdf}") &&
    savedDetail.includes("Evidence pack") &&
    savedDetail.includes("Investigation PDF")
);

assert(
  "header does not include destructive actions",
  !/data-saved-investigation-header="identity"[\s\S]*Delete Investigation/.test(savedDetail) &&
    !/data-saved-investigation-header="identity"[\s\S]*Delete All/.test(savedDetail) &&
    !/data-saved-investigation-header="identity"[\s\S]*Trash2/.test(savedDetail)
);

assert(
  "header uses dark analytical Amniora surfaces",
  headerBlock.includes("bg-[#071426]") &&
    headerBlock.includes("bg-[#061222]") &&
    headerBlock.includes("border-white/10") &&
    headerBlock.includes("text-white") &&
    !headerBlock.includes("bg-white")
);

assert(
  "header has mobile overflow protection",
  savedDetail.includes("min-w-0") &&
    savedDetail.includes("max-w-4xl") &&
    savedDetail.includes("break-words") &&
    savedDetail.includes("grid min-w-0 gap-space-2 sm:grid-cols-2") &&
    !savedDetail.includes("overflow-x-auto")
);

assert(
  "detail page does not import the generic PageHeader for the identity band",
  !savedDetail.includes("import PageHeader") &&
    !savedDetail.includes("<PageHeader")
);

assert(
  "Phase 5B.2.1 does not redesign task or feedback components",
  taskCard.includes("function parseStructuredTask") &&
    taskCard.includes("/api/ai/linux-grading") &&
    feedbackCard.includes("/api/labs/${encodeURIComponent(labId)}/feedback") &&
    feedbackCard.includes("/api/labs/${encodeURIComponent(labId)}/complaints")
);

console.log(
  `Saved Investigation workspace header tests passed (${assertions} assertions).`
);
