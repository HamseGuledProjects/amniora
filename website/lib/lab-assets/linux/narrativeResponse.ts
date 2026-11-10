export type GeneratedTaskShape = {
  phase: unknown;
  title: unknown;
  evidence: unknown;
  deliverable: unknown;
};

export type GeneratedLabShape = {
  title?: unknown;
  topic?: unknown;
  difficulty?: unknown;
  estimated_time?: unknown;
  objective?: unknown;
  scenario?: unknown;
  tasks?: unknown;
  hints?: unknown;
  outcomes?: unknown;
};

export type NarrativeParseReason =
  | "empty_response"
  | "incomplete_output"
  | "invalid_json"
  | "schema_mismatch"
  | "contract_violation"
  | "refusal"
  | "unknown";

export type NarrativeParseResult =
  | {
      ok: true;
      value: GeneratedLabShape;
      rawLength: number;
      details: string;
    }
  | {
      ok: false;
      reason: NarrativeParseReason;
      details: string;
      rawLength: number;
      rawPrefix?: string;
      rawSuffix?: string;
    };

export const GENERATED_LAB_TASK_COUNT_MIN = 5;
export const GENERATED_LAB_TASK_COUNT_MAX = 8;

export type GeneratedLabParseOptions = {
  expectedTaskCount?: number;
};

export type OpenAIResponseDiagnostics = {
  status: string;
  incompleteReason: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  outputTextLength: number;
  outputContentBlockCount: number;
  schemaOutputReturned: boolean;
  refusal: boolean;
};

const trailingConnectorPattern =
  /\b(?:to|with|and|or|using|for|by|through|against|from|of|on|via|into|while|because|where)\s*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function usageNumber(usage: unknown, key: string) {
  if (!isRecord(usage)) return null;
  const value = usage[key];
  return typeof value === "number" ? value : null;
}

function collectOutputContentBlocks(data: unknown) {
  if (!isRecord(data) || !Array.isArray(data.output)) return [];
  return data.output.flatMap((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) return [];
    return item.content;
  });
}

export function extractOpenAIResponseText(data: unknown) {
  if (!isRecord(data)) return "";

  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  return collectOutputContentBlocks(data)
    .map((content) => {
      if (!isRecord(content)) return "";
      if (content.parsed !== undefined) return JSON.stringify(content.parsed);
      if (content.type && content.type !== "output_text") return "";
      return typeof content.text === "string" ? content.text : "";
    })
    .join("")
    .trim();
}

export function getOpenAIResponseDiagnostics(data: unknown): OpenAIResponseDiagnostics {
  const text = extractOpenAIResponseText(data);
  const contentBlocks = collectOutputContentBlocks(data);
  const status = isRecord(data) && typeof data.status === "string" ? data.status : "unknown";
  const incompleteDetails = isRecord(data) ? data.incomplete_details : null;
  const incompleteReason =
    isRecord(incompleteDetails) && typeof incompleteDetails.reason === "string"
      ? incompleteDetails.reason
      : "";
  const usage = isRecord(data) ? data.usage : null;
  const refusal = contentBlocks.some(
    (content) =>
      isRecord(content) &&
      (content.type === "refusal" ||
        typeof content.refusal === "string" ||
        typeof content.refusal_text === "string")
  );

  return {
    status,
    incompleteReason,
    inputTokens: usageNumber(usage, "input_tokens"),
    outputTokens: usageNumber(usage, "output_tokens"),
    totalTokens: usageNumber(usage, "total_tokens"),
    outputTextLength: text.length,
    outputContentBlockCount: contentBlocks.length,
    schemaOutputReturned: Boolean(text.trim()),
    refusal,
  };
}

function stripHarmlessJsonFormatting(rawText: string) {
  let text = rawText.replace(/^\uFEFF/, "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();
  return text;
}

function safeSnippet(value: string, fromEnd = false) {
  const text = fromEnd ? value.slice(-220) : value.slice(0, 220);
  return text.replace(/\s+/g, " ").trim();
}

export function narrativeCompletenessIssue(value: string) {
  const trimmed = value.trim();
  const connector = trimmed.match(trailingConnectorPattern)?.[0]?.trim();
  if (connector) return `ends with the incomplete connector '${connector}'`;
  if (/[,;:/-]\s*$/.test(trimmed)) return "ends with incomplete punctuation";
  return "";
}

export function narrativeFieldDiagnostics(value: unknown, maxLength?: number) {
  const text = String(value ?? "");
  const trimmed = text.trim();
  const terminal = Array.from(trimmed.slice(-8)).map((char) => `U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`);
  return {
    length: text.length,
    sha256: createHash("sha256").update(text).digest("hex"),
    first120: text.slice(0, 120),
    last120: text.slice(-120),
    terminalCodePoints: terminal,
    endsInSentencePunctuation: /[.!?)]$/.test(trimmed),
    reachesMaxLength: typeof maxLength === "number" && text.length >= maxLength,
    hasUnmatchedQuoteOrBracket:
      (trimmed.match(/"/g)?.length || 0) % 2 === 1 ||
      (trimmed.match(/'/g)?.length || 0) % 2 === 1 ||
      /\[[^\]]*$|\([^)"]*$|\{[^}]*$/.test(trimmed),
    containsReplacementCharacter: /\uFFFD/.test(text),
    completenessIssue: narrativeCompletenessIssue(text),
  };
}

export function truncateAtSentenceBoundary(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return { ok: true as const, value: normalized, truncated: false };
  }

  const candidate = normalized.slice(0, maxLength + 1);
  const boundaries = [...candidate.matchAll(/[.!?](?=\s|$)|;(?=\s|$)/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 40 && index < maxLength);
  for (const boundary of boundaries.reverse()) {
    const value = normalized.slice(0, boundary + 1).trim();
    if (!narrativeCompletenessIssue(value)) {
      return { ok: true as const, value, truncated: true };
    }
  }

  return {
    ok: false as const,
    value: normalized,
    truncated: false,
    reason: "No safe sentence or clause boundary exists before the maximum length.",
  };
}

export function cleanNarrativeField(value: unknown, fallback = "Linux incident response investigation") {
  const cleaned = String(value || fallback)
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[\uFFFD]+/g, "")
    .replace(/,\s*eTMas$/i, "")
    .replace(/\b(\d{2}:\d{2})(\d{2}:\d{2})\b/g, "$1-$2")
    .replace(/\b(\d{2}:\d{2}:\d{2})(\d{2}:\d{2}:\d{2})\b/g, "$1-$2")
    .replace(/\b610 line\b/gi, "6-10 line")
    .replace(/\bchangee\b/gi, "change")
    .replace(/\b(with|using)(SSH|cron|sudo|systemd|APT|dpkg|Linux)\b/g, "$1 $2")
    .replace(/\b(with|using)(ssh|cron|sudo|systemd|apt|dpkg|linux)\b/g, "$1 $2")
    .replace(/,\s*(?:and\s*)?$/i, "")
    .replace(/\b(?:with a|using host|using|with|and)\s*[.,;:]?$/i, "")
    .replace(/\s+['"]$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const letters = cleaned.match(/[A-Za-z]/g)?.length || 0;
  if (cleaned.length < 6 || letters < 4) return fallback;
  if (
    /\b\d{2}:\d{2}\d{2}:\d{2}\b/.test(cleaned) ||
    /\b(?:withSSH|usingSSH|withcron|changee|610 line)\b/i.test(cleaned)
  ) {
    return fallback;
  }

  return cleaned;
}

function validateGeneratedLabShape(value: unknown, options: GeneratedLabParseOptions = {}) {
  if (!isRecord(value)) return "root must be an object";
  const requiredStrings = ["title", "topic", "difficulty", "estimated_time", "objective", "scenario"];
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string" || !String(value[key]).trim()) {
      return `${key} must be a non-empty string`;
    }
  }
  if (!Array.isArray(value.tasks) || value.tasks.length < GENERATED_LAB_TASK_COUNT_MIN || value.tasks.length > GENERATED_LAB_TASK_COUNT_MAX) {
    return `tasks must contain ${GENERATED_LAB_TASK_COUNT_MIN} to ${GENERATED_LAB_TASK_COUNT_MAX} items`;
  }
  if (
    typeof options.expectedTaskCount === "number" &&
    Number.isInteger(options.expectedTaskCount) &&
    value.tasks.length !== options.expectedTaskCount
  ) {
    return `Narrative returned ${value.tasks.length} tasks; canonical blueprint requires ${options.expectedTaskCount}.`;
  }
  for (const [index, task] of value.tasks.entries()) {
    if (!isRecord(task)) return `tasks[${index}] must be an object`;
    for (const key of ["phase", "title", "deliverable"]) {
      if (typeof task[key] !== "string" || !String(task[key]).trim()) {
        return `tasks[${index}].${key} must be a non-empty string`;
      }
    }
    if (!Array.isArray(task.evidence) || task.evidence.length < 1 || task.evidence.length > 3) {
      return `tasks[${index}].evidence must contain 1 to 3 items`;
    }
    if (!task.evidence.every((item) => typeof item === "string" && item.trim())) {
      return `tasks[${index}].evidence must contain strings`;
    }
  }
  if (!Array.isArray(value.hints) || value.hints.length !== 3) return "hints must contain exactly 3 items";
  if (!Array.isArray(value.outcomes) || value.outcomes.length !== 3) return "outcomes must contain exactly 3 items";
  return "";
}

export function parseGeneratedLabResponse(data: unknown, options: GeneratedLabParseOptions = {}): NarrativeParseResult {
  const diagnostics = getOpenAIResponseDiagnostics(data);
  const rawText = extractOpenAIResponseText(data);
  const rawLength = rawText.length;

  if (diagnostics.refusal || diagnostics.status === "refused") {
    return {
      ok: false,
      reason: "refusal",
      details: "OpenAI response contained a refusal block.",
      rawLength,
    };
  }

  if (diagnostics.status === "incomplete" || diagnostics.incompleteReason) {
    return {
      ok: false,
      reason: "incomplete_output",
      details: diagnostics.incompleteReason || "OpenAI response status was incomplete.",
      rawLength,
      rawPrefix: safeSnippet(rawText),
      rawSuffix: safeSnippet(rawText, true),
    };
  }

  if (!rawText.trim()) {
    return {
      ok: false,
      reason: "empty_response",
      details: "OpenAI response did not contain output text.",
      rawLength,
    };
  }

  const parseTarget = stripHarmlessJsonFormatting(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(parseTarget);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_json",
      details: error instanceof Error ? error.message : "JSON.parse failed.",
      rawLength,
      rawPrefix: safeSnippet(rawText),
      rawSuffix: safeSnippet(rawText, true),
    };
  }

  const schemaError = validateGeneratedLabShape(parsed, options);
  if (schemaError) {
    return {
      ok: false,
      reason: "schema_mismatch",
      details: schemaError,
      rawLength,
    };
  }

  return {
    ok: true,
    value: parsed as GeneratedLabShape,
    rawLength,
    details: "valid",
  };
}
import { createHash } from "crypto";
