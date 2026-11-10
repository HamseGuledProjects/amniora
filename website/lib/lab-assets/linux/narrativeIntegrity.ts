import { createHash } from "crypto";

export type LinuxNarrativeIntegrityCode =
  | "LINUX_NARRATIVE_INCOMPLETE_TEXT"
  | "LINUX_NARRATIVE_UNBALANCED_STRUCTURE"
  | "LINUX_NARRATIVE_CORRUPTED_TEXT"
  | "LINUX_NARRATIVE_REQUIRED_CONTENT_LOST"
  | "LINUX_NARRATIVE_MUTATED_AFTER_VALIDATION";

export type LinuxNarrativeIntegrityIssue = {
  code: LinuxNarrativeIntegrityCode;
  field: string;
  taskIndex?: number;
  category: "incomplete" | "unbalanced" | "corrupted" | "required_content" | "mutation";
  excerpt: string;
  preHash?: string;
  postHash?: string;
  mutationStage?: string;
  retryAllowed: boolean;
  message: string;
};

export type LinuxNarrativeStructureDiagnostic = {
  unmatchedStructureType:
    | "none"
    | "quote"
    | "parenthesis"
    | "bracket"
    | "brace"
    | "code_fence"
    | "numbered_list";
  openingCount: number;
  closingCount: number;
  codeFenceCount: number;
  numberedListOpenItems: number;
};

export type LinuxNarrativeTextKind =
  | "label"
  | "title"
  | "objective"
  | "scenario"
  | "deliverable"
  | "hint"
  | "outcome";

export type LinuxNarrativeTextValidationOptions = {
  field: string;
  kind: LinuxNarrativeTextKind;
  required?: boolean;
  maxLength?: number;
  beforeMutation?: string;
  mutationStage?: string;
  taskIndex?: number;
};

export type LinuxNarrativeTextFinalizationOptions = LinuxNarrativeTextValidationOptions & {
  fallback?: string;
  normalize?: (value: string) => string;
};

export type LinuxStudentNarrativeObject = {
  title?: unknown;
  topic?: unknown;
  category?: unknown;
  difficulty?: unknown;
  estimated_time?: unknown;
  duration?: unknown;
  objective?: unknown;
  scenario?: unknown;
  tasks?: unknown[];
  hints?: unknown[];
  outcomes?: unknown[];
  learningOutcomes?: unknown[];
};

const danglingConnectorPattern =
  /\b(?:and|or|but|with|using|from|to|for|by|against|including|include|based on|supported by|tied to|referencing|where|while|because|if|then|constrained to)\s*$/i;

const genericPlaceholderPattern =
  /^(?:n\/a|none|todo|tbd|unknown|investigation|analysis|review|task|evidence|complete this investigation step|linux incident response investigation)$/i;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function excerpt(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(-180);
}

function addIssue(
  issues: LinuxNarrativeIntegrityIssue[],
  code: LinuxNarrativeIntegrityCode,
  options: LinuxNarrativeTextValidationOptions,
  message: string,
  value: string,
  category: LinuxNarrativeIntegrityIssue["category"] = "incomplete"
) {
  issues.push({
    code,
    field: options.field,
    taskIndex: options.taskIndex,
    category,
    excerpt: excerpt(value),
    preHash: options.beforeMutation === undefined ? undefined : sha256(options.beforeMutation),
    postHash: sha256(value),
    mutationStage: options.mutationStage,
    retryAllowed: true,
    message,
  });
}

export function normalizeLinuxNarrativeText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .normalize("NFKC");
}

export function linuxNarrativeStructureDiagnostic(value: unknown): LinuxNarrativeStructureDiagnostic {
  const text = String(value ?? "");
  const pairs: Array<[string, string, LinuxNarrativeStructureDiagnostic["unmatchedStructureType"]]> = [
    ["(", ")", "parenthesis"],
    ["[", "]", "bracket"],
    ["{", "}", "brace"],
  ];
  for (const [open, close, type] of pairs) {
    const openCount = (text.match(new RegExp(`\\${open}`, "g")) || []).length;
    const closeCount = (text.match(new RegExp(`\\${close}`, "g")) || []).length;
    if (openCount !== closeCount) {
      return { unmatchedStructureType: type, openingCount: openCount, closingCount: closeCount, codeFenceCount: (text.match(/```/g) || []).length, numberedListOpenItems: 0 };
    }
  }
  const doubleQuotes = (text.match(/"/g) || []).length;
  if (doubleQuotes % 2 === 1) {
    return { unmatchedStructureType: "quote", openingCount: doubleQuotes, closingCount: doubleQuotes - 1, codeFenceCount: (text.match(/```/g) || []).length, numberedListOpenItems: 0 };
  }
  const fences = (text.match(/```/g) || []).length;
  if (fences % 2 === 1) {
    return { unmatchedStructureType: "code_fence", openingCount: Math.ceil(fences / 2), closingCount: Math.floor(fences / 2), codeFenceCount: fences, numberedListOpenItems: 0 };
  }
  const openNumbered = (text.match(/(?:^|\n)\s*\d+\.\s*$/gm) || []).length;
  if (openNumbered > 0) {
    return { unmatchedStructureType: "numbered_list", openingCount: openNumbered, closingCount: 0, codeFenceCount: fences, numberedListOpenItems: openNumbered };
  }
  return { unmatchedStructureType: "none", openingCount: 0, closingCount: 0, codeFenceCount: fences, numberedListOpenItems: 0 };
}

function hasBalancedPairs(value: string) {
  return linuxNarrativeStructureDiagnostic(value).unmatchedStructureType === "none";
}

function isLabelKind(kind: LinuxNarrativeTextKind) {
  return kind === "label" || kind === "title";
}

function minimumLength(kind: LinuxNarrativeTextKind) {
  if (kind === "label") return 3;
  if (kind === "title") return 6;
  if (kind === "deliverable") return 10;
  if (kind === "hint" || kind === "outcome") return 12;
  return 20;
}

function words(value: string) {
  return value.match(/[A-Za-z0-9][A-Za-z0-9'/-]*/g) || [];
}

function completeNumberedList(value: string) {
  return !/(?:^|\n)\s*\d+\.\s*$/m.test(value);
}

function repeatedClauseReason(value: string) {
  const clauses = value
    .toLowerCase()
    .split(/[.!?]|\band\b|\bthen\b|,/i)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.split(/\s+/).length >= 4);
  const seen = new Set<string>();
  for (const clause of clauses) {
    if (seen.has(clause)) return "duplicated clause";
    seen.add(clause);
  }
  return "";
}

function corruptionReason(value: string) {
  if (/\uFFFD|ï¿½/.test(value)) return "replacement character";
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return "control character";
  if (/[ÃÂ][^\s]|â[^\s]/.test(value)) return "mojibake sequence";
  if (/\\u(?![0-9a-fA-F]{4})|\\x(?![0-9a-fA-F]{2})/.test(value)) return "broken escape sequence";
  if (/,[a-z]\s*$/i.test(value.trim())) return "corrupted punctuation suffix";
  if (/\b(?:ident|evidenc|Evidence\s+p)\s*$/i.test(value.trim())) return "isolated trailing fragment";
  return "";
}

export function linuxNarrativeTextHygieneReason(value: string) {
  const trimmed = value.trim();
  if (/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]|\u00AD/.test(value)) return "replacement/control/soft-hyphen character";
  if (/(?:^|[^.])\.\.(?:[^.]|$)|!!+|\?\?+|[!?]\.|[.][!?]/.test(value)) return "repeated or malformed punctuation";
  if (/\ba\s+(?:administrative|application|edge|egress|identity|incident|open|unauthorized|advanced)\b/i.test(value)) return "invalid a/an usage";
  if (/\ban\s+(?:backup|container|database|jump|mail|monitoring|service|systemd|cron|linux|vpn|web|dns|ci)\b/i.test(value)) return "invalid a/an usage";
  if (/\bInclude:\s*(?!columns?\b)/i.test(value)) return "bare Include template";
  if ((value.match(/\bInclude:/gi) || []).length > 1) return "repeated Include template";
  if ((value.match(/;/g) || []).length >= 2 && /\b(?:Include|compare|identify|document|define|check|cite|state|correlate)\b/i.test(value)) return "semicolon checklist prose";
  if (/\b(?:sentence|note|finding|task|deliverable)\s+that\s+(?:narrow|map|check|compare|identify|document|describe|state|use|correlate|validate|propose|review|trace)\b/i.test(value)) return "malformed that-clause instruction";
  if (/\b(?:Where relevant,\s+include|Include|Also|It should)\s+(?:identify|map|compare|check|document|describe|state|use|correlate|validate|review|trace)\b/i.test(trimmed)) return "mechanical fragment instruction";
  if (/^(?:compare|identify|document|define|check|cite|state|correlate|summarize)\s+(?:service baseline|cron definition|approval evidence|run-as account|command output|timestamp evidence)\.?\s*$/i.test(trimmed)) return "fragment-only deliverable";
  if (/\b(?:atoms?|checklist|template|rubric|mandatory requirement|output requirement)\b/i.test(value)) return "internal checklist/template language";
  if (repeatedClauseReason(value)) return repeatedClauseReason(value);
  if (/\b(?:withSSH|withcron|usingSSH|usingcron|andSSH)\b/i.test(value)) return "missing space before technology token";
  if (/\b(?:changee|changevs|servicee|authh|evidencee)\b/i.test(value)) return "damaged generated word fragment";
  if (/\b\d{2}:\d{2}\d{2}:\d{2}\b/.test(value)) return "joined HH:MM time range";
  if (/(?:^|\s)\/(?:usr|etc|var|opt|srv|tmp|home|run)\s*$/i.test(trimmed)) return "incomplete filesystem path";
  if (/\/(?:usr\/(?:bin|sbin|local|local\/bin|local\/sbin)|etc\/(?:systemd|cron\.d|ssh)|var\/(?:log|tmp|www)|opt|srv)\s*$/i.test(trimmed)) return "truncated command or path suffix";
  if (/\b(?:command output|output|evidence|path|command|script)\s+(?:for|from|with|to)\s+\/(?:usr|etc|var|opt|srv|tmp|home|run)(?:\/(?:bin|sbin|local|log|cron\.d|systemd))?\s*$/i.test(trimmed)) return "truncated command or path suffix";
  if (/\b(?:systemctl|service)\s+(?:restart|reload|start|stop|enable|disable)\s*$/i.test(trimmed)) return "malformed command suffix";
  if (/\b(?:sudo|bash|sh|python3?|tar|rsync|grep|awk|sed|cat|journalctl)\s+(?:-[A-Za-z0-9-]+)?\s*$/i.test(trimmed)) return "malformed command suffix";
  if (/[,;:/\\-]\s*$/.test(trimmed)) return "trailing incomplete punctuation";
  if (/(?:\(|\[|\{|"|'|`|```|\*\*|__|~~)\s*$/.test(trimmed)) return "trailing unmatched markup or quote opener";
  if (/\[[^\]]*$|\([^)"]*$/.test(trimmed)) return "unmatched bracket";
  if (/\b(?:ident|Evidence\s+p)\s*$/i.test(trimmed)) return "trailing incomplete generated word fragment";
  if (/\b(?:command|process|sudo|ssh|file|service|systemd|audit|journal|cron|apt|package|timeline|evidence|account|host|change|risk|key)-\s*$/i.test(trimmed)) return "trailing technology compound";
  if (/\b(?:command|process|sudo|ssh|file|service|systemd|audit|journal|cron|apt|package|timeline|evidence|account|host|change|risk|key)\s*\/\s*$/i.test(trimmed)) return "trailing technology slash";
  if (/\b(?:with|using|and|or|on|for|a|an|the|to|from|of|by|through|against|via|into|vs|under|between|after|before|around|during)\s*$/i.test(trimmed)) return "trailing connector or preposition";
  return "";
}

function terminalReason(value: string, kind: LinuxNarrativeTextKind) {
  const trimmed = value.trim();
  if (!trimmed) return "empty text";
  if (kind === "title") return linuxNarrativeTextHygieneReason(value);
  if (isLabelKind(kind)) return "";
  const finalHygieneReason = linuxNarrativeTextHygieneReason(value);
  if (finalHygieneReason) return finalHygieneReason;
  if (!/[.!?)]$/.test(trimmed)) return "missing terminal punctuation";
  if (/[,;:\/\-_]\s*$/.test(trimmed)) return "incomplete terminal punctuation";
  if (/\bevidence-preserving\s*$/i.test(trimmed)) return "known incomplete evidence-preserving suffix";
  if (/(?:\(|\[|\{|"|`|```|\*\*|__|~~)\s*$/.test(trimmed)) return "trailing unmatched opener";
  const connector = trimmed.match(danglingConnectorPattern)?.[0]?.trim();
  if (connector) return `dangling connector '${connector}'`;
  return "";
}

function contentLowInformation(value: string, kind: LinuxNarrativeTextKind) {
  const normalized = value.trim().replace(/[.!?]+$/, "");
  if (!normalized) return "empty text";
  if (/^[\W_]+$/.test(normalized)) return "punctuation only";
  if (kind === "label") return "";
  if (genericPlaceholderPattern.test(normalized)) return "generic placeholder";
  if (normalized.length < minimumLength(kind) || words(normalized).length < 2) {
    return "too short to preserve required meaning";
  }
  return "";
}

function normalizedRequirementText(value: string) {
  return value
    .toLowerCase()
    .replace(/[`"'*()[\]{}.,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRequirements(value: string) {
  const requirements = new Set<string>();
  const normalized = normalizedRequirementText(value);
  const columnMatch = value.match(/\bcolumns?\s*:\s*([^.;\n]+)/i);
  if (columnMatch) {
    columnMatch[1].split(/,|\band\b/i).map((item) => item.trim()).filter(Boolean).forEach((item) => requirements.add(`column:${normalizedRequirementText(item)}`));
  }
  for (const match of value.matchAll(/(?:^|\n)\s*\d+\.\s*([^\n]+)/g)) {
    const item = normalizedRequirementText(match[1]);
    if (item) requirements.add(`numbered:${item}`);
  }
  for (const match of value.matchAll(/assets\/[A-Za-z0-9_./@-]+/g)) requirements.add(`evidence:${match[0].toLowerCase()}`);
  for (const match of value.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g)) requirements.add(`time:${match[0]}`);
  const quantity = normalized.match(/\b(?:one|two|three|four|five|six|\d+)(?:\s+to\s+(?:one|two|three|four|five|six|\d+))?\s+(?:findings|rows|entries|items|observations|sections)\b/);
  if (quantity) requirements.add(`quantity:${quantity[0]}`);
  if (/\b(?:using only|only using|supplied evidence|supplied files|listed evidence paths|selected evidence|evidence path)\b/i.test(value)) {
    requirements.add("restriction:evidence");
  }
  if (/\b(?:uncertainty|confidence|whether|cannot|evidence gap|additional validation|candidate hypothesis)\b/i.test(value)) {
    requirements.add("boundary:uncertainty");
  }
  if (/\b(?:recommendation|recommendations|containment|remediation|next validation)\b/i.test(value)) {
    requirements.add("scope:recommendation");
  }
  return requirements;
}

function requirementPresent(requirement: string, after: string) {
  const normalized = normalizedRequirementText(after);
  const [, value] = requirement.split(":", 2);
  if (requirement === "restriction:evidence") return /\b(?:using only|only using|supplied evidence|supplied files|listed evidence paths|selected evidence|evidence path)\b/i.test(after);
  if (requirement === "boundary:uncertainty") return /\b(?:uncertainty|confidence|whether|cannot|evidence gap|additional validation|candidate hypothesis)\b/i.test(after);
  if (requirement === "scope:recommendation") return /\b(?:recommendation|recommendations|containment|remediation|next validation)\b/i.test(after);
  return Boolean(value) && normalized.includes(value);
}

export function validateLinuxNarrativeTextIntegrity(
  value: unknown,
  options: LinuxNarrativeTextValidationOptions
) {
  const text = String(value ?? "");
  const issues: LinuxNarrativeIntegrityIssue[] = [];
  const required = options.required !== false;
  if (!required && text.trim().length === 0) {
    return {
      passed: true,
      issues,
    };
  }
  const corruption = corruptionReason(text);
  if (corruption) {
    addIssue(issues, "LINUX_NARRATIVE_CORRUPTED_TEXT", options, corruption, text, "corrupted");
  }
  if (!hasBalancedPairs(text) || !completeNumberedList(text)) {
    addIssue(issues, "LINUX_NARRATIVE_UNBALANCED_STRUCTURE", options, "unbalanced quote, bracket, code fence, or numbered-list structure", text, "unbalanced");
  }
  const terminal = terminalReason(text, options.kind);
  if (terminal) {
    addIssue(issues, "LINUX_NARRATIVE_INCOMPLETE_TEXT", options, terminal, text, "incomplete");
  }
  if (required) {
    const lowInfo = contentLowInformation(text, options.kind);
    if (lowInfo) addIssue(issues, "LINUX_NARRATIVE_INCOMPLETE_TEXT", options, lowInfo, text, "incomplete");
  }
  if (typeof options.maxLength === "number" && text.length > options.maxLength) {
    addIssue(issues, "LINUX_NARRATIVE_INCOMPLETE_TEXT", options, `field exceeds maximum length ${options.maxLength}`, text, "incomplete");
  }
  if (options.beforeMutation !== undefined) {
    for (const requirement of extractRequirements(options.beforeMutation)) {
      if (!requirementPresent(requirement, text)) {
        addIssue(
          issues,
          "LINUX_NARRATIVE_REQUIRED_CONTENT_LOST",
          options,
          `required component removed during mutation: ${requirement}`,
          text,
          "required_content"
        );
      }
    }
  }
  return {
    passed: issues.length === 0,
    issues,
  };
}

function safelyShortenAtSentenceBoundary(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const candidate = value.slice(0, maxLength + 1);
  const boundaries = [...candidate.matchAll(/[.!?](?=\s|$)/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 24 && index < maxLength);
  const boundary = boundaries.at(-1);
  return boundary === undefined ? "" : value.slice(0, boundary + 1).trim();
}

export function finalizeLinuxNarrativeText(value: unknown, options: LinuxNarrativeTextFinalizationOptions) {
  const raw = String(value ?? "");
  const normalized = options.normalize
    ? options.normalize(normalizeLinuxNarrativeText(raw))
    : normalizeLinuxNarrativeText(raw);
  let candidate = normalized;
  if (typeof options.maxLength === "number" && candidate.length > options.maxLength) {
    candidate = safelyShortenAtSentenceBoundary(candidate, options.maxLength);
    if (!candidate && options.fallback) candidate = normalizeLinuxNarrativeText(options.fallback);
  }
  const result = validateLinuxNarrativeTextIntegrity(candidate, {
    ...options,
    beforeMutation: raw,
  });
  if (!result.passed) {
    const summary = result.issues.slice(0, 3).map((issue) => `${issue.code}:${issue.field}:${issue.message}`).join("; ");
    throw new Error(`Linux narrative integrity validation failed: ${summary}`);
  }
  return candidate;
}

function parseTask(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { title: value };
    }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function validateLinuxStudentNarrativeIntegrity(input: LinuxStudentNarrativeObject) {
  const issues: LinuxNarrativeIntegrityIssue[] = [];
  const add = (value: unknown, options: LinuxNarrativeTextValidationOptions) => {
    issues.push(...validateLinuxNarrativeTextIntegrity(String(value ?? ""), options).issues);
  };
  add(input.title, { field: "title", kind: "title", maxLength: 140 });
  add(input.topic ?? input.category, { field: "topic", kind: "label", maxLength: 80 });
  add(input.difficulty, { field: "difficulty", kind: "label", maxLength: 40 });
  add(input.estimated_time ?? input.duration, { field: "estimated_time", kind: "label", maxLength: 40 });
  add(input.objective, { field: "objective", kind: "objective", maxLength: 500 });
  add(input.scenario, { field: "scenario", kind: "scenario", maxLength: 1200 });
  (input.tasks || []).forEach((taskValue, index) => {
    const task = parseTask(taskValue);
    add(task.phase, { field: `tasks[${index}].phase`, taskIndex: index, kind: "label", maxLength: 40 });
    add(task.title, { field: `tasks[${index}].title`, taskIndex: index, kind: "title", maxLength: 240 });
    add(task.description, { field: `tasks[${index}].description`, taskIndex: index, kind: "title", required: false, maxLength: 240 });
    add(task.deliverable, { field: `tasks[${index}].deliverable`, taskIndex: index, kind: "deliverable", maxLength: 320 });
  });
  (input.hints || []).forEach((hint, index) => add(hint, { field: `hints[${index}]`, kind: "hint", maxLength: 260 }));
  (input.outcomes || []).forEach((outcome, index) => add(outcome, { field: `outcomes[${index}]`, kind: "outcome", maxLength: 220 }));
  (input.learningOutcomes || []).forEach((outcome, index) => add(outcome, { field: `learningOutcomes[${index}]`, kind: "outcome", maxLength: 220 }));
  return {
    passed: issues.length === 0,
    issues,
  };
}

export function linuxNarrativeIntegrityIssueSummary(result: ReturnType<typeof validateLinuxStudentNarrativeIntegrity>) {
  return result.issues.slice(0, 8).map((issue) => `${issue.code} ${issue.field}: ${issue.message}`).join("; ");
}

export function assertLinuxStudentNarrativeIntegrity(input: LinuxStudentNarrativeObject) {
  const result = validateLinuxStudentNarrativeIntegrity(input);
  if (!result.passed) {
    throw new Error(`Linux student narrative integrity validation failed: ${linuxNarrativeIntegrityIssueSummary(result)}`);
  }
  return result;
}

export function hashLinuxStudentNarrativeObject(input: LinuxStudentNarrativeObject) {
  const normalized = {
    title: input.title ?? "",
    topic: input.topic ?? input.category ?? "",
    difficulty: input.difficulty ?? "",
    estimated_time: input.estimated_time ?? input.duration ?? "",
    objective: input.objective ?? "",
    scenario: input.scenario ?? "",
    tasks: (input.tasks || []).map((taskValue) => {
      const task = parseTask(taskValue);
      return {
        phase: task.phase ?? "",
        title: task.title ?? "",
        description: task.description ?? "",
        evidence: Array.isArray(task.evidence) ? task.evidence : [],
        deliverable: task.deliverable ?? "",
      };
    }),
    hints: input.hints || [],
    outcomes: input.outcomes || input.learningOutcomes || [],
  };
  return sha256(stableStringify(normalized));
}

export function assertLinuxNarrativeHashUnchanged(input: {
  before: LinuxStudentNarrativeObject;
  after: LinuxStudentNarrativeObject;
  stage: string;
}) {
  const preHash = hashLinuxStudentNarrativeObject(input.before);
  const postHash = hashLinuxStudentNarrativeObject(input.after);
  if (preHash !== postHash) {
    const issue: LinuxNarrativeIntegrityIssue = {
      code: "LINUX_NARRATIVE_MUTATED_AFTER_VALIDATION",
      field: "studentNarrative",
      category: "mutation",
      excerpt: input.stage,
      preHash,
      postHash,
      mutationStage: input.stage,
      retryAllowed: false,
      message: "Student-facing Linux narrative changed after final integrity validation.",
    };
    throw new Error(`Linux narrative integrity validation failed: ${issue.code} ${issue.mutationStage} ${issue.preHash} <> ${issue.postHash}`);
  }
  return { preHash, postHash };
}
