import type { LabAsset } from "../types";

export type LinuxStudentContentValidationCode =
  | "LINUX_STUDENT_INTERNAL_CONTRACT_LEAK"
  | "LINUX_STUDENT_UNRESOLVED_SUBJECT_REFERENCE";

export type LinuxStudentContentValidationIssue = {
  code: LinuxStudentContentValidationCode;
  field: string;
  matched: string;
  message: string;
};

export type LinuxStudentVisibleTask = {
  phase?: unknown;
  title?: unknown;
  description?: unknown;
  deliverable?: unknown;
};

export type LinuxStudentVisibleContent = {
  title?: unknown;
  topic?: unknown;
  category?: unknown;
  objective?: unknown;
  scenario?: unknown;
  tasks?: unknown[];
  hints?: unknown[];
  outcomes?: unknown[];
  learningOutcomes?: unknown[];
  assets?: Pick<LabAsset, "file_path" | "content">[];
};

const INTERNAL_CONTRACT_PATTERNS: RegExp[] = [
  /\bcapability\s+key\b/i,
  /\bsubject\s+index(?:es)?\b/i,
  /\btimestamp\s+index(?:es)?\b/i,
  /\brelationship\s+statement\s+index(?:es)?\b/i,
  /\bapproved\s+statements?\b/i,
  /\bapproved\s+statement\s+metadata\b/i,
  /\baccepted\s+evidence\s+contracts?\b/i,
  /\bcanonical\s+subjects?\b/i,
  /\bcanonical\s+relationships?\b/i,
  /\bevidence\s+registry\b/i,
  /\bplanning\s+registry\b/i,
  /\binternal\s+capabilit(?:y|ies)\b/i,
];

const RAW_INTERNAL_CONTRACT_PATTERNS: RegExp[] = [
  /\bidentity:[A-Za-z0-9._:@-]+\b/i,
  /\btask:\d+:[A-Za-z0-9_-]+\b/i,
];

const UNRESOLVED_REFERENCE_PATTERNS: RegExp[] = [
  /\bsubject\s*(?:#|number|no\.?|index)?\s*\d+\b/i,
  /\bthe\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+subject\b/i,
  /\btimestamp\s*(?:#|number|no\.?|index)?\s*\d+\b/i,
  /\brelationship\s*(?:#|number|no\.?|statement|index)?\s*\d+\b/i,
  /\bthe\s+approved\s+subject\b/i,
];

function normalizeForStudentLeakage(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[_-]+/g, " ")
    .replace(/[()[\]{}.,;:!?'"`]+/g, " ")
    .replace(/\bindex\s+es\b/gi, "indexes")
    .replace(/\bstatement\s+es\b/gi, "statements")
    .replace(/\bcontract\s+s\b/gi, "contracts")
    .replace(/\s+/g, " ")
    .trim();
}

function addIssue(
  issues: LinuxStudentContentValidationIssue[],
  code: LinuxStudentContentValidationCode,
  field: string,
  matched: string
) {
  issues.push({
    code,
    field,
    matched,
    message:
      code === "LINUX_STUDENT_INTERNAL_CONTRACT_LEAK"
        ? "Student-facing Linux content contains internal task-contract terminology."
        : "Student-facing Linux content contains an unresolved internal numbered reference.",
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseTask(value: unknown): LinuxStudentVisibleTask {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed as LinuxStudentVisibleTask : { title: value };
    } catch {
      return { title: value };
    }
  }
  return value && typeof value === "object" ? value as LinuxStudentVisibleTask : {};
}

function scanField(
  issues: LinuxStudentContentValidationIssue[],
  field: string,
  value: unknown
) {
  const raw = stringValue(value);
  if (!raw.trim()) return;
  for (const pattern of RAW_INTERNAL_CONTRACT_PATTERNS) {
    const match = raw.match(pattern);
    if (match) addIssue(issues, "LINUX_STUDENT_INTERNAL_CONTRACT_LEAK", field, match[0]);
  }
  const normalized = normalizeForStudentLeakage(raw);
  for (const pattern of INTERNAL_CONTRACT_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) addIssue(issues, "LINUX_STUDENT_INTERNAL_CONTRACT_LEAK", field, match[0]);
  }
  for (const pattern of UNRESOLVED_REFERENCE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) addIssue(issues, "LINUX_STUDENT_UNRESOLVED_SUBJECT_REFERENCE", field, match[0]);
  }
}

export function validateLinuxStudentContent(input: LinuxStudentVisibleContent) {
  const issues: LinuxStudentContentValidationIssue[] = [];
  scanField(issues, "title", input.title);
  scanField(issues, "topic", input.topic ?? input.category);
  scanField(issues, "objective", input.objective);
  scanField(issues, "scenario", input.scenario);
  (input.hints || []).forEach((hint, index) => scanField(issues, `hints[${index}]`, hint));
  (input.outcomes || []).forEach((outcome, index) => scanField(issues, `outcomes[${index}]`, outcome));
  (input.learningOutcomes || []).forEach((outcome, index) => scanField(issues, `learningOutcomes[${index}]`, outcome));
  (input.tasks || []).forEach((taskValue, index) => {
    const task = parseTask(taskValue);
    scanField(issues, `tasks[${index}].phase`, task.phase);
    scanField(issues, `tasks[${index}].title`, task.title);
    scanField(issues, `tasks[${index}].description`, task.description);
    scanField(issues, `tasks[${index}].deliverable`, task.deliverable);
  });
  (input.assets || []).forEach((asset) => {
    if (!asset.content) return;
    scanField(issues, `assets:${asset.file_path}`, asset.content);
  });
  return {
    passed: issues.length === 0,
    issues,
  };
}

export function linuxStudentContentIssueSummary(result: ReturnType<typeof validateLinuxStudentContent>) {
  return result.issues
    .slice(0, 8)
    .map((issue) => `${issue.code} ${issue.field}: ${issue.matched}`)
    .join("; ");
}

export function assertLinuxStudentContent(input: LinuxStudentVisibleContent) {
  const result = validateLinuxStudentContent(input);
  if (!result.passed) {
    throw new Error(`Linux student content validation failed: ${linuxStudentContentIssueSummary(result)}`);
  }
  return result;
}
