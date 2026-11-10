// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const route = read("app/api/ai/generate-lab/route.ts");
const jobs = read("app/api/ai/lab-generation-jobs/route.ts");
const migration = read("supabase/migrations/20260916090000_linux_recent_diversity_index.sql");
let passed = 0;

function assert(name, condition) {
  if (!condition) throw new Error(`FAIL ${name}`);
  passed += 1;
  console.log(`PASS ${name}`);
}

const selector = route.indexOf("selectLinuxRecentDistinctCandidate({");
const narrative = route.indexOf("await generateCandidate(linuxAssetCandidate");
const finalHistory = route.lastIndexOf("loadLinuxRecentAcceptedCases(supabaseAdmin, user.id");
const labInsert = route.indexOf('.from("labs")', finalHistory);
const provenance = route.indexOf("diversityContractVersion: LINUX_STRUCTURAL_DIVERSITY_VERSION");

assert("production Linux generation uses the bounded recent-history selector", selector >= 0);
assert("recent-history structural selection occurs before paid narrative generation", selector < narrative);
assert("history is scoped to the authenticated learner and candidate family", route.includes("loadLinuxRecentAcceptedCases(supabaseAdmin, user.id, family)"));
assert("history is re-read after validation and before persistence", finalHistory > narrative && finalHistory < labInsert);
assert("a changed history rejects the candidate before lab insertion", route.indexOf("LINUX_DIVERSITY_HISTORY_CHANGED_BEFORE_SAVE", finalHistory) < labInsert);
assert("accepted provenance stores the diversity contract version", provenance > labInsert);
assert("accepted provenance stores the semantic structural fingerprint", route.includes("structuralFingerprint: buildLinuxStructuralFingerprint(finalCandidate.linuxSimulation!)"));
assert("accepted provenance stores the exact bounded history used at final acceptance", route.includes("diversityHistory: acceptedDiversityHistory"));
assert("Linux generation requires an owned active generation job", route.includes('"generation_job_required"') && route.includes('.eq("status", "generating")'));
assert("one reservation can claim a generation job", route.includes('.is("usage_reservation_id", null)') && route.includes('"generation_job_claim_failed"'));
assert("queued to generating is an atomic worker claim", jobs.includes('.eq("status", "queued")') && jobs.includes('.select("*")') && jobs.includes("if (claimError || !claimedJob)"));
assert("a worker that loses the claim does not call the generator", jobs.indexOf("if (claimError || !claimedJob)") < jobs.indexOf("const response = await generateLab"));
assert("database index scopes recent history by learner family and contract version", migration.includes("user_id") && migration.includes("incidentFamily") && migration.includes("diversityContractVersion"));
assert("database index preserves deterministic newest-first tie breaking", migration.includes("created_at desc") && migration.includes("id desc"));

console.log(`Linux Patch B production-path checks passed (${passed} assertions).`);
