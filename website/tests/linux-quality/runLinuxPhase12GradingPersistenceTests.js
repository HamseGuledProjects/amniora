#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");
const {
  buildCandidate,
  compileIfNeeded,
  fullExtraction,
  loadPhase11,
} = require("./linuxPhase11GradingTestUtils");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

async function main() {
  const migration = fs.readFileSync(path.join(ROOT, "supabase/migrations/20260729110000_linux_grading_attempts.sql"), "utf8");
  const usageMigration = fs.readFileSync(path.join(ROOT, "supabase/migrations/20260731100000_linux_grading_usage_and_consent.sql"), "utf8");
  const out = compileIfNeeded("phase12-persistence");
  const { linux, assessment, schema, freeForm } = loadPhase11(out);
  const service = require(path.join(out, "linux", "gradingService.js"));
  const candidate = buildCandidate(linux.buildLinuxAssetCandidate, "Advanced", "cron_persistence");
  const pkg = assessment.buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  const contract = pkg.contracts[0];
  const result = await freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: "I cite the task evidence and keep the finding bounded.",
    rawExtractionObject: fullExtraction(schema, contract),
    createdAt: "2026-07-29T12:00:00.000Z",
  });
  const row = service.buildLinuxPhase12PersistenceRow({
    userId: "00000000-0000-0000-0000-000000000001",
    labId: "00000000-0000-0000-0000-000000000002",
    generatedLabId: "00000000-0000-0000-0000-000000000003",
    taskId: contract.taskId,
    idempotencyKey: "persist-key",
    learnerAnswer: "I cite the task evidence and keep the finding bounded.",
    result,
    attempt: 1,
  });

  assert("migration creates additive grading attempts table", /create table if not exists public\.linux_grading_attempts/i.test(migration));
  assert("migration uses lab/user/generation foreign keys", /references auth\.users\(id\)/i.test(migration) && /references public\.labs\(id\)/i.test(migration) && /references public\.generated_labs\(id\)/i.test(migration));
  assert("migration enforces idempotency uniqueness", /unique \(user_id, lab_id, task_id, idempotency_key\)/i.test(migration));
  assert("migration enables RLS", /alter table public\.linux_grading_attempts enable row level security/i.test(migration));
  assert("migration revokes browser access", /revoke all on table public\.linux_grading_attempts from public, anon, authenticated/i.test(migration));
  assert("migration denies authenticated CRUD policies", /for select[\s\S]*using \(false\)/i.test(migration) && /for insert[\s\S]*with check \(false\)/i.test(migration));
  assert("usage migration adds dedicated Linux grading counter", /add column if not exists linux_gradings_used integer not null default 0/i.test(usageMigration));
  assert("usage migration allows linux_grading reservations and events", /feature_type in \('tutor_prompt', 'lab_generation', 'linux_grading'\)/i.test(usageMigration));
  assert("usage migration releases linux_grading reservations without touching tutor quota", /linux_gradings_used = greatest\(linux_gradings_used - 1, 0\)/i.test(usageMigration));
  assert("usage migration extends consent feature constraints", /ai_content_consents_feature_type_check/i.test(usageMigration) && /ai_content_consent_tokens_feature_type_check/i.test(usageMigration));
  assert("persistence row stores hashes not raw answer", row.learner_answer_hash && !JSON.stringify(row).includes("I cite the task evidence"), JSON.stringify(row));
  assert("persistence row stores normalized typed submission and deterministic report", row.normalized_typed_submission && row.deterministic_score_report && row.deterministic_score_report_hash, JSON.stringify(row));
  assert("safe cached response does not expose typed submission", !JSON.stringify(service.cachedLinuxPhase12Response({ row: { ...row, id: "attempt-1" }, learnerAnswer: "I cite the task evidence and keep the finding bounded." })).includes("normalized_typed_submission"));
  assert("duplicate idempotency with different answer is rejected", !service.cachedLinuxPhase12Response({ row: { ...row, id: "attempt-1" }, learnerAnswer: "different answer" }).ok);

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
