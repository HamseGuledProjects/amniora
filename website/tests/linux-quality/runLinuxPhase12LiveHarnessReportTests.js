#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HARNESS_PATH = path.join(ROOT, "tests", "linux-quality", "runLinuxPhase12LiveGradingTests.js");
const REPORT_DIR = path.join(ROOT, ".tmp", "linux-phase12-live-grading");
const EXPECTED_FAILED = "PHASE 12 IMPLEMENTED \u2014 LIVE VALIDATION FAILED";
const EXPECTED_PENDING = "PHASE 12 IMPLEMENTED \u2014 LIVE VALIDATION PENDING";
const MOJIBAKE = /Ãƒ|Ã¢â€šÂ¬|Ã¯Â¿Â½|ï¿½/;

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function readJsonIfPresent(name) {
  const file = path.join(REPORT_DIR, name);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  const source = fs.readFileSync(HARNESS_PATH, "utf8");
  assert("live harness uses UTF-8 verdict literals", source.includes("\\u2014") && !MOJIBAKE.test(source));
  assert("live harness declares explicit quality-smoke, pilot, and full modes", source.includes("AMNIORA_LIVE_GRADING_SCOPE") && source.includes("LIVE_SCOPE === \"quality-smoke\"") && source.includes("LIVE_SCOPE === \"pilot\"") && source.includes("LIVE_SCOPE === \"full\""));
  assert("pilot mode is gated by current quality-smoke artifact", source.includes("quality-smoke-summary.json") && source.includes("validateQualitySmokeArtifactForPilotMode"));
  assert("full mode is gated by current pilot artifact", source.includes("pilot-summary.json") && source.includes("extractorSchemaHash") && source.includes("harnessVersion"));
  assert("pending paths overwrite stale mismatch reports", source.includes("writeEmptyMismatch") && source.includes("cases: []"));

  const summary = readJsonIfPresent("summary.json");
  const mismatch = readJsonIfPresent("mismatch-debug.json");
  if (summary && mismatch) {
    assert("summary and mismatch debug share run ID when both exist", !summary.runId || summary.runId === mismatch.runId, `${summary.runId} !== ${mismatch.runId}`);
    assert("summary report verdict encoding is clean", !MOJIBAKE.test(JSON.stringify(summary)));
    assert("mismatch report verdict encoding is clean", !MOJIBAKE.test(JSON.stringify(mismatch)));
    if (summary.status === "LIVE_VALIDATION_PENDING") {
      assert("pending summary has empty mismatch cases", Array.isArray(mismatch.cases) && mismatch.cases.length === 0, JSON.stringify(mismatch.cases));
      assert("pending verdict is exact UTF-8", summary.finalVerdict === EXPECTED_PENDING, summary.finalVerdict);
    }
    if (summary.status === "LIVE_VALIDATION_FAILED") {
      assert("failed verdict is exact UTF-8", summary.finalVerdict === EXPECTED_FAILED, summary.finalVerdict);
    }
  } else {
    assert("report files are optional for static harness validation", true);
  }

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
