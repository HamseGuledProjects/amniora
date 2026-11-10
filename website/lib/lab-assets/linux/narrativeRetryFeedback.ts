import type { LinuxFinalQualityResult } from "./qualityChecker";

export type LinuxSafeRetryFeedbackCategory =
  | "task_structure"
  | "task_identity"
  | "evidence_scope"
  | "subject_selection"
  | "relationship_selection"
  | "timestamp_selection"
  | "current_state_scope"
  | "historical_state_scope"
  | "bounded_inference_scope"
  | "recommendation_scope"
  | "capability_scope"
  | "internal_detail_scope"
  | "path_scope"
  | "atomic_plain_text"
  | "output_schema"
  | "incomplete_text"
  | "invalid_json"
  | "empty_response"
  | "model_refusal"
  | "final_quality_completeness"
  | "final_quality_unsupported_conclusion"
  | "final_quality_duplication"
  | "final_quality_readability"
  | "final_quality_grounding"
  | "final_quality_evidence_wording"
  | "ai_quality_readability"
  | "general_contract_scope";

export const LINUX_SAFE_RETRY_FEEDBACK_CATEGORY_ORDER: LinuxSafeRetryFeedbackCategory[] = [
  "task_structure",
  "task_identity",
  "evidence_scope",
  "subject_selection",
  "relationship_selection",
  "timestamp_selection",
  "current_state_scope",
  "historical_state_scope",
  "bounded_inference_scope",
  "recommendation_scope",
  "capability_scope",
  "internal_detail_scope",
  "path_scope",
  "atomic_plain_text",
  "output_schema",
  "incomplete_text",
  "invalid_json",
  "empty_response",
  "model_refusal",
  "final_quality_completeness",
  "final_quality_unsupported_conclusion",
  "final_quality_duplication",
  "final_quality_readability",
  "final_quality_grounding",
  "final_quality_evidence_wording",
  "ai_quality_readability",
  "general_contract_scope",
];

export const LINUX_SAFE_RETRY_FEEDBACK_TEMPLATES: Record<LinuxSafeRetryFeedbackCategory, string> = {
  task_structure: "Keep the same task count, order, task identity, and required JSON shape.",
  task_identity: "Keep the supplied task intent and task identity exactly as assigned.",
  evidence_scope: "Use only evidence items listed in the current task payload.",
  subject_selection: "Use only numbered subject selections supplied for the current task.",
  relationship_selection: "Use only numbered relationship selections supplied for the current task.",
  timestamp_selection: "Use only numbered timestamp selections supplied for the current task.",
  current_state_scope: "Make current-state claims only when the current task explicitly supplies current-state facts.",
  historical_state_scope: "Make historical-state claims only from facts supplied for the current task.",
  bounded_inference_scope: "Keep inference bounded to the supplied observations and uncertainty limits.",
  recommendation_scope: "Use only recommendation scopes supplied for the current task.",
  capability_scope: "Do not name or infer unavailable investigation capabilities.",
  internal_detail_scope: "Do not include internal metadata, implementation terms, or validator details.",
  path_scope: "Do not add local, source-code, or unavailable evidence paths.",
  atomic_plain_text: "Use bounded plain text cells only; do not author headings, lists, tables, separators, or code fences.",
  output_schema: "Return one complete JSON object matching the requested schema.",
  incomplete_text: "Complete every learner-facing field so it ends at a natural sentence boundary.",
  invalid_json: "Return parseable JSON only.",
  empty_response: "Return the complete required JSON object.",
  model_refusal: "Return only the allowed defensive training narrative JSON.",
  final_quality_completeness: "Make every required learner-facing investigation requirement explicit without adding conclusions.",
  final_quality_unsupported_conclusion: "Remove unsupported conclusions and keep wording evidence-bounded.",
  final_quality_duplication: "Avoid duplicating the same task purpose or deliverable.",
  final_quality_readability: "Use concise professional SOC wording.",
  final_quality_grounding: "Ground each task in the supplied evidence and bounded requirements.",
  final_quality_evidence_wording: "Refer only to selected evidence through the supplied task evidence list.",
  ai_quality_readability: "Improve clarity while preserving the same evidence and bounded task scope.",
  general_contract_scope: "Use only the safe task data supplied in the current payload.",
};

const GENERIC_SAFE_RETRY_CATEGORY: LinuxSafeRetryFeedbackCategory = "general_contract_scope";

export function normalizeLinuxSafeRetryFeedbackCategories(categories: Iterable<unknown>): LinuxSafeRetryFeedbackCategory[] {
  const known = new Set<LinuxSafeRetryFeedbackCategory>(LINUX_SAFE_RETRY_FEEDBACK_CATEGORY_ORDER);
  const selected = new Set<LinuxSafeRetryFeedbackCategory>();
  for (const category of categories) {
    if (typeof category === "string" && known.has(category as LinuxSafeRetryFeedbackCategory)) {
      selected.add(category as LinuxSafeRetryFeedbackCategory);
    }
  }
  const ordered: LinuxSafeRetryFeedbackCategory[] = LINUX_SAFE_RETRY_FEEDBACK_CATEGORY_ORDER.filter((category) => selected.has(category));
  return ordered.length > 0 ? ordered : [GENERIC_SAFE_RETRY_CATEGORY];
}

export function buildLinuxSafeRetryFeedback(input: {
  categories: Iterable<unknown>;
  scope?: "task" | "narrative" | "final_quality" | "ai_quality";
}) {
  const categories = normalizeLinuxSafeRetryFeedbackCategories(input.categories);
  const scopeLine =
    input.scope === "final_quality"
      ? "Your previous narrative did not pass the deterministic final-quality gate."
      : input.scope === "ai_quality"
        ? "Your previous narrative needs clearer learner-facing wording."
        : input.scope === "narrative"
          ? "Your previous narrative response did not match the safe narrative contract."
          : "Your previous task JSON did not match the safe task data.";
  return [
    scopeLine,
    "Correct only the returned JSON.",
    "Use exact evidence paths and numbered selections already present in the current payload.",
    "For timestamps, select only entries from the supplied allowed-timestamps list.",
    "Do not add unsupported relationships, current-state claims, recommendations, internal labels, or extra evidence.",
    "Retry feedback is not evidence authority.",
    `Issues: ${categories.slice(0, 6).map((category) => LINUX_SAFE_RETRY_FEEDBACK_TEMPLATES[category]).join(" | ")}`,
  ].join(" ");
}

export function linuxRetryFeedbackCategoriesFromNarrativeIssueCodes(codes: Iterable<string>): LinuxSafeRetryFeedbackCategory[] {
  const categories = new Set<LinuxSafeRetryFeedbackCategory>();
  for (const code of codes) {
    if (/\bLINUX_NARRATIVE_(?:TASK_COUNT_MISMATCH|TASK_MISSING|TASK_DUPLICATE|TASK_UNKNOWN|TASK_ORDER_MISMATCH)\b/.test(code)) categories.add("task_structure");
    else if (code === "LINUX_NARRATIVE_INTENT_MISMATCH") categories.add("task_identity");
    else if (code === "LINUX_NARRATIVE_EVIDENCE_OUTSIDE_CONTRACT" || code === "LINUX_NARRATIVE_UNRENDERED_EVIDENCE" || code === "LINUX_NARRATIVE_ADVANCED_LEAK") categories.add("evidence_scope");
    else if (code === "LINUX_NARRATIVE_UNKNOWN_SUBJECT") categories.add("subject_selection");
    else if (code === "LINUX_NARRATIVE_UNSUPPORTED_RELATIONSHIP") categories.add("relationship_selection");
    else if (code === "LINUX_NARRATIVE_INVENTED_TIMESTAMP") categories.add("timestamp_selection");
    else if (code === "LINUX_NARRATIVE_UNSUPPORTED_CURRENT_STATE") categories.add("current_state_scope");
    else if (code === "LINUX_NARRATIVE_UNSUPPORTED_HISTORICAL_STATE") categories.add("historical_state_scope");
    else if (code === "LINUX_NARRATIVE_UNBOUNDED_INFERENCE") categories.add("bounded_inference_scope");
    else if (code === "LINUX_NARRATIVE_UNSUPPORTED_RECOMMENDATION") categories.add("recommendation_scope");
    else if (code === "LINUX_NARRATIVE_PROHIBITED_CAPABILITY") categories.add("capability_scope");
    else if (code === "LINUX_NARRATIVE_INTERNAL_DETAIL_LEAK") categories.add("internal_detail_scope");
    else if (code === "LINUX_NARRATIVE_LOCAL_PATH_LEAK") categories.add("path_scope");
    else categories.add("general_contract_scope");
  }
  return normalizeLinuxSafeRetryFeedbackCategories(categories);
}

export function linuxRetryFeedbackCategoriesFromParseReason(reason: string): LinuxSafeRetryFeedbackCategory[] {
  if (reason === "incomplete_output") return ["output_schema", "incomplete_text"];
  if (reason === "empty_response") return ["empty_response", "output_schema"];
  if (reason === "schema_mismatch") return ["output_schema"];
  if (reason === "contract_violation") return ["general_contract_scope"];
  if (reason === "refusal") return ["model_refusal"];
  if (reason === "invalid_json") return ["invalid_json", "output_schema"];
  return ["general_contract_scope"];
}

export function linuxRetryFeedbackCategoriesFromFinalQuality(result: LinuxFinalQualityResult): LinuxSafeRetryFeedbackCategory[] {
  const categories = new Set<LinuxSafeRetryFeedbackCategory>();
  for (const issue of result.issues) {
    if (issue.category === "asset_consistency") categories.add("general_contract_scope");
    else if (issue.category === "generated_text") {
      const description = issue.description || "";
      if (/narrative completeness|missing|incomplete|malformed|truncated/i.test(description)) categories.add("final_quality_completeness");
      else if (/unsupported conclusion|answer|spoiler/i.test(description)) categories.add("final_quality_unsupported_conclusion");
      else if (/duplicate|repeated/i.test(description)) categories.add("final_quality_duplication");
      else if (/readability|clear investigative action|professional/i.test(description)) categories.add("final_quality_readability");
      else if (/ground|evidence reference|canonical/i.test(description)) categories.add("final_quality_grounding");
      else if (/evidence wording|evidence/i.test(description)) categories.add("final_quality_evidence_wording");
      else categories.add("final_quality_completeness");
    } else {
      categories.add("general_contract_scope");
    }
  }
  return normalizeLinuxSafeRetryFeedbackCategories(categories);
}
