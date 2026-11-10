#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");

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
  const adapter = read("lib/lab-assets/linux/openAIExtractionAdapter.ts");
  const freeForm = read("lib/lab-assets/linux/freeFormAssessment.ts");

  assert("adapter is marked server-only", adapter.includes('import "server-only";'));
  assert("adapter implements Phase 11 extractor interface", adapter.includes("LinuxFreeFormAssessmentExtractor") && adapter.includes("LinuxFreeFormExtractionRequest"));
  assert("adapter uses OpenAI Responses API", adapter.includes("https://api.openai.com/v1/responses"));
  assert("adapter uses structured json schema output", adapter.includes('type: "json_schema"') && adapter.includes("strict: true"));
  assert("adapter requests typed extraction schema version only", adapter.includes("LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION"));
  assert("adapter prompt forbids model scoring", /Do not assign scores, points, grades, pass\/fail status, rubrics, answer keys, or internal identifiers/.test(adapter));
  assert("adapter returns extraction failures instead of scores", adapter.includes("LINUX_GRADING_EXTRACTION_FAILED") && !/scoreReport\s*:/.test(adapter));
  assert("adapter records latency and token diagnostics", adapter.includes("latencyMs") && adapter.includes("promptTokens") && adapter.includes("completionTokens"));
  assert("adapter records sanitized ambiguity telemetry", adapter.includes("schemaVersion") && adapter.includes("candidateRegistryHash") && adapter.includes("requestCandidateCount") && adapter.includes("responseSelectionCount") && adapter.includes("recognizedCandidateCount"));
  assert("adapter handles empty model output", adapter.includes("OpenAI returned an empty extraction"));
  assert("adapter preserves Phase 11 orchestration as scorer owner", freeForm.includes("scoreLinuxStructuredAssessmentSubmission(input.contract, normalizedSubmission)"));

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
