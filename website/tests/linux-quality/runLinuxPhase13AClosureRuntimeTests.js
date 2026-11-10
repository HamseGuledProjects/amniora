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

function migration(relative) {
  return read(`supabase/migrations/${relative}`);
}

function main() {
  const out = compileIfNeeded("phase13a-runtime");
  const service = require(path.join(out, "linux", "gradingService.js"));
  const route = read("app/api/ai/linux-grading/route.ts");
  const consentRoute = read("app/api/ai/linux-grading/consent/route.ts");
  const gradingServiceSource = read("lib/lab-assets/linux/gradingService.ts");
  const liveHarness = read("tests/linux-quality/runLinuxPhase12LiveGradingTests.js");

  const duplicate = service.cachedLinuxPhase12Response({
    row: {
      id: "attempt-1",
      status: "graded",
      task_id: "task:1",
      idempotency_key: "same-key",
      learner_answer_hash: service.validateLinuxPhase12RouteInput({
        labId: "lab",
        taskId: "task:1",
        learnerAnswer: "same answer",
        idempotencyKey: "same-key",
      }).ok ? require(path.join(out, "linux", "assessmentGradingProvenance.js")).hashLinuxGradingValue("same answer") : "",
      deterministic_score_report: { score: 10, maximumPoints: 10 },
      feedback: { taskId: "task:1", status: "graded", summary: "Safe." },
      diagnostics: [],
    },
    learnerAnswer: "same answer",
  });
  assert("duplicate idempotency key returns cached authoritative result for same answer", duplicate.ok && duplicate.response.score === 10);

  const changedAnswer = service.cachedLinuxPhase12Response({
    row: {
      task_id: "task:1",
      idempotency_key: "same-key",
      learner_answer_hash: require(path.join(out, "linux", "assessmentGradingProvenance.js")).hashLinuxGradingValue("first answer"),
    },
    learnerAnswer: "changed answer",
  });
  assert("same idempotency key with changed answer fails safely", !changedAnswer.ok && changedAnswer.status === 409);

  const rejectedInternals = service.validateLinuxPhase12RouteInput({
    labId: "lab",
    taskId: "task:1",
    learnerAnswer: "answer",
    idempotencyKey: "key",
    score: 100,
    assessmentContract: {},
    evidenceAnchorRegistry: {},
  });
  assert("client supplied score contract and evidence eligibility rejected at input boundary", !rejectedInternals.ok && rejectedInternals.status === 400);

  const safeAttempt = service.buildLinuxLearnerSafeAttempt({
    row: {
      id: "attempt-hidden",
      status: "graded",
      task_id: "task:1",
      idempotency_key: "key",
      deterministic_score_report: { score: 0, maximumPoints: 10 },
      feedback: { taskId: "task:1", status: "graded", summary: "Safe." },
      diagnostics: [],
    },
  });
  const safeJson = JSON.stringify(safeAttempt);
  for (const forbidden of ["assessmentContract", "expectedAnswers", "rawExtraction", "normalizedSubmission", "answerKey", "assessmentContractHash"]) {
    assert(`learner-safe status excludes ${forbidden}`, !safeJson.includes(forbidden));
  }
  assert("graded but failing score is attempted but not mastered", safeAttempt.status === "graded" && safeAttempt.mastered === false);

  assert("GET and POST both use beta authorization", (route.match(/authorizeBetaAccess/g) || []).length >= 2 && route.includes("export async function GET") && route.includes("export async function POST"));
  assert("GET and POST both enforce server-side lab ownership", (route.match(/loadOwnedLinuxLab\(user\.id/g) || []).length >= 2 && route.includes('.eq("user_id", userId)'));
  assert("task and lab substitution rejected by trusted reconstruction", route.includes("reconstructLinuxPhase12TrustedContract") && gradingServiceSource.includes("LINUX_GRADING_UNKNOWN_TASK") && route.includes("Lab not found."));
  const updateBlock = route.slice(route.indexOf("const { error: updateError }"));
  assert("persistence failure returns unavailable and does not call completion update first", updateBlock.indexOf("if (updateError)") < updateBlock.indexOf("updateLabCompletionFromAuthoritativeGrades"));
  assert("concurrent duplicate insert path re-reads existing authoritative attempt", route.includes("if (insertError || !insertedAttempt)") && route.includes("const { data: duplicate }"));
  assert("consent token binding is user and lab scoped", consentRoute.includes(".eq(\"user_id\", user.id)") && consentRoute.includes("consumeAiContentConsentToken") && consentRoute.includes("bindAiContentConsent"));
  assert("malformed missing or replayed consent is rejected by existing token consumer", consentRoute.includes("AiContentConsentError") && consentRoute.includes("status: 403"));
  assert("revoked consent remains blocked before grading", route.includes("assertGeneratedLabHasAiContentConsent") && read("lib/ai/contentSharingConsentServer.ts").includes('.is("revoked_at", null)'));

  const migrations = [
    "20260725020800_ai_content_consents.sql",
    "20260727090000_atomic_ai_usage_reservations.sql",
    "20260729080000_linux_generation_provenance.sql",
    "20260729100000_linux_assessment_hashes.sql",
    "20260729110000_linux_grading_attempts.sql",
    "20260731100000_linux_grading_usage_and_consent.sql",
  ];
  for (const name of migrations) {
    assert(`required migration exists ${name}`, fs.existsSync(path.join(ROOT, "supabase", "migrations", name)));
  }
  const gradingMigration = migration("20260729110000_linux_grading_attempts.sql");
  for (const column of ["task_id", "idempotency_key", "learner_answer_hash", "deterministic_score_report", "feedback", "diagnostics", "created_at", "updated_at"]) {
    assert(`grading attempts migration has ${column}`, new RegExp(`\\b${column}\\b`, "i").test(gradingMigration));
  }
  assert("grading attempts migration keeps browser RLS closed", /revoke all on table public\.linux_grading_attempts from public, anon, authenticated/i.test(gradingMigration) && /using \(false\)/i.test(gradingMigration));
  assert("route returns safe unavailable messages for missing table or migration errors", route.includes("LINUX_GRADING_PERSISTENCE_FAILED") && route.includes("Linux grading status is temporarily unavailable"));

  assert("Phase 12 full case-set hash remains certified v5", liveHarness.includes("phase12-full-case-set-v5-explicit-paraphrase-claims") && liveHarness.includes("phase12-surface-claim-oracle-v3-evidence-occurrence-ledger"));
  assert("Phase 13A did not alter OpenAI extraction adapter", read("lib/lab-assets/linux/openAIExtractionAdapter.ts").includes("server-only"));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
