#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");
const {
  buildCandidate,
  compileIfNeeded,
  loadPhase11,
} = require("./linuxPhase11GradingTestUtils");

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

async function main() {
  const out = compileIfNeeded("phase12-route");
  const { linux } = loadPhase11(out);
  const service = require(path.join(out, "linux", "gradingService.js"));
  const route = read("app/api/ai/linux-grading/route.ts");

  const valid = service.validateLinuxPhase12RouteInput({
    labId: "00000000-0000-0000-0000-000000000001",
    taskId: "task:1",
    learnerAnswer: "I cite the task evidence.",
    idempotencyKey: "route-test-1",
  });
  assert("route input accepts only the required grading fields", valid.ok, JSON.stringify(valid));
  for (const key of ["score", "rubric", "assessmentContractHash", "findingIds", "evidenceAnchorRegistry"]) {
    const rejected = service.validateLinuxPhase12RouteInput({
      labId: "lab",
      taskId: "task",
      learnerAnswer: "answer",
      idempotencyKey: "key",
      [key]: "client-supplied",
    });
    assert(`route input rejects client-supplied ${key}`, !rejected.ok && rejected.status === 400, JSON.stringify(rejected));
  }
  const oversized = service.validateLinuxPhase12RouteInput({
    labId: "lab",
    taskId: "task",
    learnerAnswer: "a".repeat(service.LINUX_PHASE12_MAX_ANSWER_LENGTH + 1),
    idempotencyKey: "key",
  });
  assert("route input rejects oversized answers", !oversized.ok && oversized.status === 413, JSON.stringify(oversized));

  const candidate = buildCandidate(linux.buildLinuxAssetCandidate, "Intermediate", "ssh_key_compromise");
  const firstTask = candidate.simulation.canonicalTasks[0].id;
  const reconstructed = service.reconstructLinuxPhase12TrustedContract({
    labId: "00000000-0000-0000-0000-000000000012",
    taskId: firstTask,
    labTitle: "Amniora Linux Asset Pack",
    labTasks: [{ title: "Task title", evidence: candidate.assets.slice(0, 2).map((asset) => asset.file_path), deliverable: "Submit evidence-backed findings." }],
    provenance: candidate.provenance,
    deterministicHashes: candidate.deterministicHashes,
  });
  assert("trusted contract reconstructs from provenance and hashes", reconstructed.ok && reconstructed.value.contract.taskId === firstTask, JSON.stringify(reconstructed));

  const unknownTask = service.reconstructLinuxPhase12TrustedContract({
    labId: "00000000-0000-0000-0000-000000000012",
    taskId: "task:not-real",
    labTitle: "Amniora Linux Asset Pack",
    provenance: candidate.provenance,
    deterministicHashes: candidate.deterministicHashes,
  });
  assert("unknown task is rejected after trusted reconstruction", !unknownTask.ok && unknownTask.status === 404, JSON.stringify(unknownTask));

  assert("route uses beta authorization", route.includes("authorizeBetaAccess") && route.includes("betaAccessErrorResponse"));
  assert("route checks lab ownership server side", route.includes('.eq("user_id", user.id)') && route.includes('.from("labs")'));
  assert("route reconstructs contract server side", route.includes("reconstructLinuxPhase12TrustedContract"));
  assert(
    "route requires generated-lab content consent before AI usage",
    route.includes("assertGeneratedLabHasAiContentConsent") &&
      route.indexOf("assertGeneratedLabHasAiContentConsent") < route.indexOf('reserveAIUsage(user.id, "linux_grading")') &&
      route.indexOf('reserveAIUsage(user.id, "linux_grading")') < route.indexOf("const extractor = createOpenAIResponsesLinuxAssessmentExtractor")
  );
  assert("route reserves and records dedicated Linux grading AI usage", route.includes('reserveAIUsage(user.id, "linux_grading")') && route.includes('feature: "linux_grading"'));
  assert("route rejects grading when consent provenance is unavailable", route.includes("LINUX_GRADING_CONSENT_PROVENANCE_MISSING"));
  assert("route maps consent boundary failures without model scoring", route.includes("AiContentConsentError") && route.includes("status: 403"));
  assert("route returns safe grading response", route.includes("safeLinuxPhase12GradingResponse"));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
