#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");
const { compileIfNeeded } = require("./linuxPhase11GradingTestUtils");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function main() {
  const out = compileIfNeeded("phase13a-learner-grading");
  const service = require(path.join(out, "linux", "gradingService.js"));
  const gradingRoute = read("app/api/ai/linux-grading/route.ts");
  const consentRoute = read("app/api/ai/linux-grading/consent/route.ts");
  const savedPage = read("app/dashboard/saved/[id]/page.tsx");
  const taskCard = read("app/dashboard/saved/[id]/TaskCard.tsx");
  const consentDialog = read("components/ai/AiContentSharingConsentDialog.tsx");

  const taskStatuses = service.buildLinuxLearnerSafeTaskStatuses({
    taskIds: ["task:a", "task:b"],
    attempts: [
      {
        id: "attempt-1",
        status: "graded",
        task_id: "task:a",
        idempotency_key: "idem-a",
        deterministic_score_report: { score: 7, maximumPoints: 10 },
        feedback: { taskId: "task:a", status: "graded", summary: "Safe summary." },
        diagnostics: [],
        updated_at: "2026-07-29T12:00:00.000Z",
      },
    ],
  });
  assert("learner-safe task status exposes task ids and safe grading result", taskStatuses[0].taskId === "task:a" && taskStatuses[0].latestAttempt.score === 7);
  assert("learner-safe task status does not expose hidden assessment internals", !JSON.stringify(taskStatuses).includes("assessmentContractHash"));
  assert("all graded helper requires every task to have authoritative graded attempt", service.allLinuxTasksHaveGradedAttempts({ taskIds: ["task:a", "task:b"], attempts: [{ task_id: "task:a", status: "graded" }] }) === false);
  assert("all graded helper accepts complete authoritative graded set", service.allLinuxTasksHaveGradedAttempts({ taskIds: ["task:a", "task:b"], attempts: [{ task_id: "task:a", status: "graded" }, { task_id: "task:b", status: "graded" }] }) === true);
  assert("zero-score graded attempt is not mastered", service.linuxAssessmentScoreIsMastered({ score: 0, maximumPoints: 10 }) === false);
  assert("failing-score graded attempt is not mastered", service.linuxAssessmentScoreIsMastered({ score: 6, maximumPoints: 10 }) === false);
  assert("full-score graded attempt is mastered", service.linuxAssessmentScoreIsMastered({ score: 10, maximumPoints: 10 }) === true);
  assert("all mastered helper rejects complete but failing graded set", service.allLinuxTasksHaveMasteredAttempts({
    taskIds: ["task:a", "task:b"],
    attempts: [
      { task_id: "task:a", status: "graded", deterministic_score_report: { score: 10, maximumPoints: 10 } },
      { task_id: "task:b", status: "graded", deterministic_score_report: { score: 0, maximumPoints: 10 } },
    ],
  }) === false);
  assert("all mastered helper accepts complete full-score set", service.allLinuxTasksHaveMasteredAttempts({
    taskIds: ["task:a", "task:b"],
    attempts: [
      { task_id: "task:a", status: "graded", deterministic_score_report: { score: 10, maximumPoints: 10 } },
      { task_id: "task:b", status: "graded", deterministic_score_report: { score: 10, maximumPoints: 10 } },
    ],
  }) === true);

  assert("grading route exposes learner-safe GET status without browser table access", gradingRoute.includes("export async function GET") && gradingRoute.includes("buildLinuxLearnerSafeTaskStatuses"));
  assert("grading POST input contract remains Phase 12 minimum", service.validateLinuxPhase12RouteInput({ labId: "lab", taskId: "task", learnerAnswer: "answer", idempotencyKey: "idem", aiContentConsentToken: "token" }).ok === false);
  assert("grading route updates lab completion only after authoritative mastered attempts", gradingRoute.includes("updateLabCompletionFromAuthoritativeGrades") && gradingRoute.includes("allLinuxTasksHaveMasteredAttempts"));
  assert("consent route consumes existing linux_grading token and binds server-side generated lab id", consentRoute.includes('feature: "linux_grading"') && consentRoute.includes("consumeAiContentConsentToken") && consentRoute.includes("bindAiContentConsent") && consentRoute.includes("generated_lab_id"));
  assert("saved lab page fetches grading status from protected route", savedPage.includes("/api/ai/linux-grading?labId=") && savedPage.includes("refreshGradingStatus"));
  assert("task card submits only labId taskId learnerAnswer idempotencyKey to grading route", /body:\s*JSON\.stringify\(\{\s*labId,\s*taskId,\s*learnerAnswer:\s*trimmed,\s*idempotencyKey:\s*getIdempotencyKey\(\),\s*\}\)/s.test(taskCard));
  assert("task card preserves drafts and idempotency in localStorage", taskCard.includes("localStorage.setItem(draftStorageKey") && taskCard.includes("localStorage.setItem(idempotencyStorageKey"));
  assert("task card blocks duplicate submission while submitting", taskCard.includes('submissionState === "submitting"') && taskCard.includes("disabled={!taskId || !answer.trim() || submissionState === \"submitting\"}"));
  assert("task card uses existing consent dialog for Linux grading", taskCard.includes("AiContentSharingConsentDialog") && taskCard.includes('feature="linux_grading"'));
  assert("existing consent dialog has Linux grading-specific information-sent copy", consentDialog.includes('feature === "linux_grading"') && consentDialog.includes("selected Linux investigation task"));
  assert(
    "Linux manual completion is locked for gradable Linux labs",
    savedPage.includes("manualCompletionLocked") &&
      savedPage.includes("Linux completion is controlled by deterministic task grading.") &&
      savedPage.includes("Controlled by grading")
  );
  assert(
    "Linux manual completion fails closed when grading status cannot be loaded",
    savedPage.includes('setManualCompletionLocked(data.code !== "LINUX_GRADING_PROVENANCE_MISSING")') &&
      savedPage.includes("setManualCompletionLocked(true)")
  );
  assert("low-score graded task is not labelled mastered", taskCard.includes("visibleAttempt.mastered === true") && taskCard.includes("Mastered") && taskCard.includes("Graded"));
  assert("task card maps learner-safe failure states", taskCard.includes("learnerSafeError") && taskCard.includes("Too many grading requests") && taskCard.includes("Network failure while grading"));
  assert("task card renders safe structured feedback without dangerous HTML", taskCard.includes("SafeFeedback") && !taskCard.includes("dangerouslySetInnerHTML"));

  for (const source of [savedPage, taskCard]) {
    for (const forbidden of ["assessmentContract", "assessmentHash", "rubricWeights", "expectedAnswers", "answerKey", "OPENAI_API_KEY", "Authorization"]) {
      assert(`client source excludes ${forbidden}`, !source.includes(forbidden));
    }
  }

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
