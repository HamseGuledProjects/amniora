#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");

const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output directory.");

const {
  createLinuxForensicCapture,
  recordLinuxForensicFinal,
  recordLinuxForensicTaskAttempt,
} = require(path.join(out, "linux", "forensicCapture.js"));

function assert(name, condition, details = "") {
  if (!condition) {
    console.error(`${name}: FAILED ${details}`);
    process.exitCode = 1;
  } else {
    console.log(`${name}: passed ${details}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const originalFlag = process.env.CYBERLAB_LINUX_FORENSIC_CAPTURE;

process.env.CYBERLAB_LINUX_FORENSIC_CAPTURE = "false";
const disabled = createLinuxForensicCapture();
assert("01 capture disabled returns null", disabled === null);

process.env.CYBERLAB_LINUX_FORENSIC_CAPTURE = "true";
const capture = createLinuxForensicCapture();
assert("02 capture enabled returns handle", Boolean(capture && capture.runId && capture.relativeDir));
assert("03 capture directory is under test-output", capture.relativeDir.startsWith("test-output/linux-live-forensics/"));

const rawTask = {
  task_number: 1,
  learner_intent: "SSH sign-in review",
  phase: "sign-in entry point",
  title: "Review SSH sign-in evidence",
  evidence: ["assets/logs/auth.log"],
  deliverable: "Create concise evidence notes confirming the sign-in entry point using only the supplied files.",
  claims: [
    {
      claim_class: "observed",
      text: "The supplied evidence records an SSH session associated with the account.",
      supporting_evidence: ["assets/logs/auth.log"],
      subject_indexes: [1],
      relationship_statement_indexes: [1],
      timestamp_indexes: [1],
    },
  ],
};
const adaptedTask = {
  task_id: "task:1:ssh_authentication",
  task_intent: "ssh_authentication",
  phase: rawTask.phase,
  title: rawTask.title,
  evidence: rawTask.evidence,
  deliverable: `${rawTask.deliverable} Include timestamp indexes.`,
  claims: [{ claim_class: "observed", text: rawTask.claims[0].text, supporting_evidence: rawTask.evidence }],
};

recordLinuxForensicTaskAttempt({
  capture,
  assetAttempt: 1,
  taskAttempt: 1,
  taskId: "task:1:ssh_authentication",
  intent: "ssh_authentication",
  responseId: "resp_test_123",
  status: "completed",
  inputTokens: 100,
  outputTokens: 80,
  parsedTaskOutput: rawTask,
  adapterOutput: adaptedTask,
});

const taskDir = path.join(capture.absoluteDir, "attempts", "asset-attempt-1", "task-task-1-ssh_authentication");
const rawFile = path.join(taskDir, "attempt-1.raw.json");
const pipelineFile = path.join(taskDir, "attempt-1.pipeline.json");
assert("04 raw file written", fs.existsSync(rawFile));
assert("05 pipeline file written", fs.existsSync(pipelineFile));

const rawArtifact = readJson(rawFile);
assert("06 raw response unchanged", JSON.stringify(rawArtifact.parsedTaskOutput) === JSON.stringify(rawTask));
assert("07 raw metadata stored", rawArtifact.responseId === "resp_test_123" && rawArtifact.inputTokens === 100 && rawArtifact.outputTokens === 80);

const pipeline = readJson(pipelineFile);
assert("08 pipeline stages recorded", pipeline.stages.map((item) => item.stage).join("|") === "schema_parsed|cleanup|normalization|adapter");
assert("09 pipeline diagnostics recorded", Boolean(pipeline.stages[0].fields.deliverable.sha256 && pipeline.stages[0].fields.deliverable.last120));
assert("10 pipeline diffs recorded", pipeline.diffs.some((item) => item.field === "deliverable" && item.stage === "adapter"));

const finalLab = {
  title: "Linux evidence review",
  objective: "Review the supplied Linux evidence.",
  scenario: "SOC analysts are reviewing the host.",
  tasks: [{ title: "Review SSH sign-in records", deliverable: rawTask.deliverable, evidence: ["assets/logs/auth.log"] }],
};
recordLinuxForensicFinal({
  capture,
  assembledLab: finalLab,
  qualityInput: finalLab,
  qualityReport: {
    interimAssetScore: 96,
    finalProductionScore: 97,
    passed: false,
    coverage: { finalNarrativeEvaluated: true },
    categoryScores: {},
    issues: [
      {
        severity: "high",
        category: "generated_text",
        description: "Final narrative task deliverable is malformed or truncated.",
        evidence: "Create concise evidence notes confirming the sign-in entry point and ident",
      },
    ],
  },
  failureReason: "HIGH_SEVERITY_OVERRIDE",
});

assert("11 assembled final lab captured", fs.existsSync(path.join(capture.absoluteDir, "final", "assembled-lab.json")));
assert("12 quality report captured", fs.existsSync(path.join(capture.absoluteDir, "final", "quality-report.json")));
const failure = readJson(path.join(capture.absoluteDir, "final", "failure-summary.json"));
assert("13 validator rejection captured", failure.issues[0].validatorInput.endsWith("ident") && failure.issues[0].validatorInputLength === failure.issues[0].validatorInput.length);

const manifest = readJson(path.join(capture.absoluteDir, "manifest.json"));
assert("14 manifest generated", manifest.finalOutcome === "failed" && manifest.qualityScore === 97 && manifest.failureReason === "HIGH_SEVERITY_OVERRIDE");
assert("15 manifest lists captured files", manifest.capturedFiles.includes("final/failure-summary.json") && manifest.capturedFiles.includes("attempts/asset-attempt-1/task-task-1-ssh_authentication/attempt-1.raw.json"));

const gitignore = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
assert("16 .gitignore updated", gitignore.includes("/test-output/linux-live-forensics/"));

if (originalFlag === undefined) {
  delete process.env.CYBERLAB_LINUX_FORENSIC_CAPTURE;
} else {
  process.env.CYBERLAB_LINUX_FORENSIC_CAPTURE = originalFlag;
}
