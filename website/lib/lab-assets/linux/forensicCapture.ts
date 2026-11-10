import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { createHash } from "crypto";
import type { FinalLinuxNarrative, LinuxFinalQualityResult, LinuxQualityIssue } from "./qualityChecker";

type FieldDiagnostics = {
  length: number;
  sha256: string;
  first120: string;
  last120: string;
  terminalUnicodeCodePoints: string[];
  endsSentence: boolean;
  containsReplacementCharacter: boolean;
  containsControlCharacter: boolean;
  containsUnmatchedQuote: boolean;
  containsUnmatchedBracket: boolean;
  containsMarkdownFence: boolean;
  containsHTML: boolean;
  containsUnicodeReplacement: boolean;
  reachedSchemaMaxLength: boolean;
  changedFromPreviousStage: boolean;
};

type PipelineStage = {
  stage: string;
  reason: string;
  fields: Record<string, FieldDiagnostics>;
};

type PipelineDiff = {
  stage: string;
  field: string;
  reason: string;
  oldHash: string;
  newHash: string;
  oldLength: number;
  newLength: number;
  oldLast120: string;
  newLast120: string;
};

type Manifest = {
  runId: string;
  generatedAt: string;
  assetAttempts: number[];
  taskAttempts: Array<{ assetAttempt: number; taskAttempt: number; taskId: string; intent: string }>;
  finalOutcome: string;
  qualityScore: number | null;
  failureReason: string;
  capturedFiles: string[];
};

export type LinuxForensicCapture = {
  runId: string;
  relativeDir: string;
  absoluteDir: string;
  manifest: Manifest;
};

export function linuxForensicCaptureEnabled() {
  return process.env.CYBERLAB_LINUX_FORENSIC_CAPTURE?.toLowerCase() === "true";
}

function runTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeJson(capture: LinuxForensicCapture, relativeFile: string, value: unknown) {
  const file = path.join(capture.absoluteDir, relativeFile);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  const normalized = relativeFile.replace(/\\/g, "/");
  if (!capture.manifest.capturedFiles.includes(normalized)) capture.manifest.capturedFiles.push(normalized);
}

export function createLinuxForensicCapture(): LinuxForensicCapture | null {
  if (!linuxForensicCaptureEnabled()) return null;
  const runId = runTimestamp();
  const relativeDir = `test-output/linux-live-forensics/${runId}`;
  const absoluteDir = path.join(process.cwd(), relativeDir);
  const capture: LinuxForensicCapture = {
    runId,
    relativeDir,
    absoluteDir,
    manifest: {
      runId,
      generatedAt: new Date().toISOString(),
      assetAttempts: [],
      taskAttempts: [],
      finalOutcome: "started",
      qualityScore: null,
      failureReason: "",
      capturedFiles: [],
    },
  };
  mkdirSync(absoluteDir, { recursive: true });
  console.info(`[CyberLab Linux Forensics]\ncapture enabled\ndirectory="${relativeDir}"`);
  writeManifest(capture);
  return capture;
}

export function writeManifest(capture: LinuxForensicCapture | null) {
  if (!capture) return;
  writeJson(capture, "manifest.json", capture.manifest);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function fieldDiagnostics(value: unknown, previous?: unknown, schemaMaxLength?: number): FieldDiagnostics {
  const text = stringValue(value);
  const prev = previous === undefined ? undefined : stringValue(previous);
  const quoteCount = (text.match(/"/g) || []).length + (text.match(/'/g) || []).length;
  return {
    length: text.length,
    sha256: sha256(text),
    first120: text.slice(0, 120),
    last120: text.slice(-120),
    terminalUnicodeCodePoints: Array.from(text.slice(-8)).map((char) => `U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`),
    endsSentence: /[.!?)]$/.test(text.trim()),
    containsReplacementCharacter: /\uFFFD/.test(text),
    containsControlCharacter: /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text),
    containsUnmatchedQuote: quoteCount % 2 === 1,
    containsUnmatchedBracket: /\[[^\]]*$|\([^)"]*$|\{[^}]*$/.test(text.trim()),
    containsMarkdownFence: /```/.test(text),
    containsHTML: /<\/?[a-z][\s\S]*>/i.test(text),
    containsUnicodeReplacement: /\uFFFD/.test(text),
    reachedSchemaMaxLength: typeof schemaMaxLength === "number" && text.length >= schemaMaxLength,
    changedFromPreviousStage: prev !== undefined && prev !== text,
  };
}

function narrativeFields(value: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const key of ["phase", "title", "question", "deliverable", "hint", "learningGoal", "learner_intent"]) {
    if (value[key] !== undefined) fields[key] = value[key];
  }
  if (Array.isArray(value.claims)) {
    value.claims.forEach((claim, index) => {
      if (claim && typeof claim === "object" && "text" in claim) fields[`claims[${index}].text`] = (claim as { text?: unknown }).text;
    });
  }
  return fields;
}

function stageRecord(stage: string, reason: string, value: Record<string, unknown>, previous?: Record<string, unknown>): PipelineStage {
  const fields: Record<string, FieldDiagnostics> = {};
  const current = narrativeFields(value);
  const prior = previous ? narrativeFields(previous) : {};
  for (const [field, currentValue] of Object.entries(current)) {
    fields[field] = fieldDiagnostics(currentValue, prior[field], field === "deliverable" ? 320 : undefined);
  }
  return { stage, reason, fields };
}

function diffRecord(stage: PipelineStage, previous?: PipelineStage): PipelineDiff[] {
  if (!previous) return [];
  return Object.entries(stage.fields)
    .filter(([field, current]) => previous.fields[field] && current.sha256 !== previous.fields[field].sha256)
    .map(([field, current]) => {
      const old = previous.fields[field];
      return {
        stage: stage.stage,
        field,
        reason: stage.reason,
        oldHash: old.sha256,
        newHash: current.sha256,
        oldLength: old.length,
        newLength: current.length,
        oldLast120: old.last120,
        newLast120: current.last120,
      };
    });
}

export function recordLinuxForensicTaskAttempt(input: {
  capture: LinuxForensicCapture | null;
  assetAttempt: number;
  taskAttempt: number;
  taskId: string;
  intent: string;
  responseId?: string;
  status?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  parsedTaskOutput: Record<string, unknown>;
  cleanupOutput?: Record<string, unknown>;
  normalizationOutput?: Record<string, unknown>;
  adapterOutput?: Record<string, unknown>;
}) {
  const { capture } = input;
  if (!capture) return;
  if (!capture.manifest.assetAttempts.includes(input.assetAttempt)) capture.manifest.assetAttempts.push(input.assetAttempt);
  capture.manifest.taskAttempts.push({
    assetAttempt: input.assetAttempt,
    taskAttempt: input.taskAttempt,
    taskId: input.taskId,
    intent: input.intent,
  });
  const dir = `attempts/asset-attempt-${input.assetAttempt}/task-${input.taskId.replace(/[^a-z0-9._-]+/gi, "-")}`;
  writeJson(capture, `${dir}/attempt-${input.taskAttempt}.raw.json`, {
    runId: capture.runId,
    assetAttempt: input.assetAttempt,
    taskAttempt: input.taskAttempt,
    taskId: input.taskId,
    intent: input.intent,
    responseId: input.responseId || "",
    status: input.status || "",
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    parsedTaskOutput: input.parsedTaskOutput,
  });

  const rawStage = stageRecord("schema_parsed", "raw structured task accepted by schema", input.parsedTaskOutput);
  const cleanupValue = input.cleanupOutput || input.parsedTaskOutput;
  const cleanupStage = stageRecord("cleanup", "task-isolated route has no cleanup before adapter", cleanupValue, input.parsedTaskOutput);
  const normalizedValue = input.normalizationOutput || cleanupValue;
  const normalizationStage = stageRecord("normalization", "task-isolated route has no normalization before adapter", normalizedValue, cleanupValue);
  const adapterValue = input.adapterOutput || normalizedValue;
  const adapterStage = stageRecord("adapter", "adaptLinuxGeneratedTaskFromView", adapterValue, normalizedValue);
  const stages = [rawStage, cleanupStage, normalizationStage, adapterStage];
  writeJson(capture, `${dir}/attempt-${input.taskAttempt}.pipeline.json`, {
    runId: capture.runId,
    assetAttempt: input.assetAttempt,
    taskAttempt: input.taskAttempt,
    taskId: input.taskId,
    intent: input.intent,
    stages,
    diffs: stages.flatMap((stage, index) => diffRecord(stage, stages[index - 1])),
  });
  writeManifest(capture);
}

export function recordLinuxForensicFinal(input: {
  capture: LinuxForensicCapture | null;
  assembledLab?: unknown;
  qualityInput?: FinalLinuxNarrative;
  qualityReport?: LinuxFinalQualityResult;
  failureReason?: string;
}) {
  const { capture } = input;
  if (!capture) return;
  if (input.assembledLab !== undefined) writeJson(capture, "final/assembled-lab.json", input.assembledLab);
  if (input.qualityInput !== undefined) {
    writeJson(capture, "final/quality-input.json", {
      runId: capture.runId,
      validatorInput: input.qualityInput,
      fields: Object.fromEntries(
        [
          ["title", input.qualityInput.title],
          ["objective", input.qualityInput.objective],
          ["scenario", input.qualityInput.scenario],
          ...((input.qualityInput.tasks || []).flatMap((task, index) => [
            [`tasks[${index}].title`, task.title],
            [`tasks[${index}].deliverable`, task.deliverable],
          ] as Array<[string, unknown]>)),
        ].map(([field, value]) => [field, fieldDiagnostics(value, undefined, String(field).includes("deliverable") ? 320 : undefined)])
      ),
    });
  }
  if (input.qualityReport !== undefined) {
    capture.manifest.qualityScore = input.qualityReport.finalProductionScore;
    capture.manifest.finalOutcome = input.qualityReport.passed && input.qualityReport.issues.length === 0 ? "passed" : "failed";
    capture.manifest.failureReason = input.failureReason || "";
    writeJson(capture, "final/quality-report.json", input.qualityReport);
    if (!input.qualityReport.passed || input.qualityReport.issues.length > 0) {
      writeJson(capture, "final/failure-summary.json", {
        runId: capture.runId,
        failureReason: input.failureReason || "",
        qualityScore: input.qualityReport.finalProductionScore,
        issues: input.qualityReport.issues.map((issue) => qualityFailureRecord(issue)),
      });
    }
  }
  writeManifest(capture);
}

function qualityFailureRecord(issue: LinuxQualityIssue) {
  const validatorInput = issue.evidence || "";
  return {
    validatorInput,
    validatorInputHash: sha256(validatorInput),
    validatorInputLength: validatorInput.length,
    validatorReason: issue.description,
    validatorPredicate: issue.description,
    validatorEvidence: issue.evidence || "",
    validatorCategory: issue.category,
    validatorSeverity: issue.severity,
    file: issue.file,
    line: issue.line,
  };
}
