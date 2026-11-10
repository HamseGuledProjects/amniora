#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated bootstrap lifecycle contract harness. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "../../..");
const WEB_LAB = path.join(ROOT, "lib/web-lab");
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(WEB_LAB + path.sep)) throw new Error("Only Web Lab sources may be transpiled");
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};

const {
  BYO_BOOTSTRAP_STATE_FILENAME,
  ByoBootstrapReporter,
  parseByoBootstrapState,
} = require(path.join(WEB_LAB, "byo-runner/bootstrap-state.ts"));

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-bootstrap-contract-"));
  try {
    let now = 1_000;
    const reporter = new ByoBootstrapReporter(temporary, true, () => now);
    for (const stage of ["PROCESS_ALIVE", "RUNNER_STARTED", "TRANSPORT_CONNECTING", "CONNECTED"]) {
      now += 7;
      await reporter.report(stage);
    }
    const statePath = path.join(temporary, BYO_BOOTSTRAP_STATE_FILENAME);
    const connected = parseByoBootstrapState(fs.readFileSync(statePath, "utf8"));
    assert.equal(connected.stage, "CONNECTED");
    assert.equal(connected.pid, process.pid);
    assert.equal(connected.ppid, process.ppid);
    assert.equal(connected.exitClassification, "NONE");
    assert.equal(connected.exitStatus, 0);
    assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);

    const failed = new ByoBootstrapReporter(temporary, true, () => now);
    await failed.report("PROCESS_ALIVE");
    await failed.report("RUNNER_STARTED");
    await failed.report("TRANSPORT_CONNECTING");
    await failed.fail(failed.failureClassification({ code: "ENROLLMENT_REPLAYED" }));
    const denied = parseByoBootstrapState(fs.readFileSync(statePath, "utf8"));
    assert.equal(denied.stage, "FAILED");
    assert.equal(denied.exitClassification, "ENROLLMENT_REPLAYED");
    assert.equal(denied.exitStatus, 1);

    const invalid = new ByoBootstrapReporter(temporary, true);
    await assert.rejects(invalid.report("RUNNER_STARTED"), /invalid_bootstrap_stage_transition/);
    assert.throws(() => parseByoBootstrapState("schema=1\nstage=CONNECTED\ntoken=secret\n"), /invalid_bootstrap_state/);

    const runtime = fs.readFileSync(path.join(WEB_LAB, "byo-runner/runtime-cli.ts"), "utf8");
    const entry = fs.readFileSync(path.join(__dirname, "../phase16a2b1/vm-runtime-entry.cjs"), "utf8");
    const positions = ["PROCESS_ALIVE", "RUNNER_STARTED", "TRANSPORT_CONNECTING", "CONNECTED"].map(stage => runtime.indexOf(`report(\"${stage}\")`));
    assert.ok(positions.every(position => position >= 0));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, "bootstrap stages must advance monotonically");
    assert.doesNotMatch(entry, /error\?\.(?:code|message)|error\.stack/);
    assert.match(entry, /RUNNER_BOOTSTRAP_FAILED/);
    assert.doesNotMatch(fs.readFileSync(statePath, "utf8"), /token|certificate|private|stderr|command/i);
    console.log("Phase 16B bootstrap contracts: PASS (Runner acknowledgement, monotonic readiness, fixed failures, no credential/log capture)");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
