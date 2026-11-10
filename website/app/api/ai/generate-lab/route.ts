import { NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  authorizeBetaAccess,
  betaAccessErrorResponse,
} from "@/lib/auth/betaAccessAuthorization";
import {
  getUserPlan,
  recordAIUsage,
  releaseAIUsageReservation,
  reserveAIUsage,
} from "@/lib/ai/usageService";
import { fetchOpenAI, OpenAITimeoutError } from "@/lib/ai/openaiFetch";
import { chooseAIModel } from "@/lib/ai/modelRouter";
import { checkSafety } from "@/lib/ai/safetyService";
import { buildSystemPrompt } from "@/lib/ai/promptService";
import {
  reviewInvestigationQuality,
  type AIQualityReviewResult,
  type QualityReviewLab,
} from "@/lib/ai/qualityReview";
import { buildAssetPack } from "@/lib/lab-assets";
import { buildLinuxAssetCandidate } from "@/lib/lab-assets/linux";
import { checkLinuxRecentDiversity, LinuxDiversityHistoryError, selectLinuxRecentDistinctCandidate } from "@/lib/lab-assets/linux/recentDiversity";
import { loadLinuxRecentAcceptedCases } from "@/lib/lab-assets/linux/recentDiversityPersistence";
import { buildLinuxStructuralFingerprint, LINUX_STRUCTURAL_DIVERSITY_VERSION } from "@/lib/lab-assets/linux/structuralDiversity";
import type { LabAsset } from "@/lib/lab-assets/types";
import { createLinuxRootSeed } from "@/lib/lab-assets/linux/deterministicRandom";
import type { LinuxDeterministicHashes, LinuxGenerationProvenance } from "@/lib/lab-assets/linux/generationContext";
import { buildLinuxGenerationProvenanceRow } from "@/lib/lab-assets/linux/provenancePersistence";
import {
  buildLinuxEvidenceAliasMap,
  checkLinuxFinalProductionQuality,
  type FinalLinuxNarrative,
  type LinuxFinalQualityResult,
  type LinuxQualityResult,
} from "@/lib/lab-assets/linux/qualityChecker";
import type { LinuxInvestigationContext } from "@/lib/lab-assets/linux/investigation";
import {
  buildLinuxCanonicalNarrativeBrief,
  buildLinuxNarrativeContract,
  sanitizeLinuxLearnerText,
  type LinuxNarrativeContract,
  type LinuxNarrativeTaskContract,
  type LinuxSimulationWorld,
} from "@/lib/lab-assets/linux/simulation";
import {
  validateLinuxGeneratedNarrativeAgainstContract,
  type LinuxGeneratedNarrativeForContract,
  type LinuxGeneratedTaskForContract,
  type LinuxNarrativeContractValidationResult,
} from "@/lib/lab-assets/linux/narrativeContract";
import {
  adaptLinuxGeneratedTaskFromView,
  assertLinuxTaskGenerationViewIsModelSafe,
  buildLinuxTaskGenerationView,
  linuxAtomicTaskRetryFeedback,
  linuxNarrativeContractIssueRetryFeedback,
  linuxTaskGenerationSchema,
  serializeLinuxTaskGenerationPrompt,
  validateLinuxGeneratedTaskAtomicFields,
  type LinuxGeneratedTaskFromView,
  type LinuxTaskAtomicFieldIssue,
} from "@/lib/lab-assets/linux/narrativeGenerationView";
import {
  buildLinuxSafeRetryFeedback,
  linuxRetryFeedbackCategoriesFromFinalQuality,
  linuxRetryFeedbackCategoriesFromParseReason,
} from "@/lib/lab-assets/linux/narrativeRetryFeedback";
import {
  buildLinuxAssembledNarrative,
  type LinuxAssembledNarrative,
  type LinuxAssembledTask,
} from "@/lib/lab-assets/linux/narrativeAssembly";
import { assertLinuxStudentContent } from "@/lib/lab-assets/linux/studentContentValidation";
import {
  assertLinuxNarrativeHashUnchanged,
  assertLinuxStudentNarrativeIntegrity,
  finalizeLinuxNarrativeText,
  hashLinuxStudentNarrativeObject,
  linuxNarrativeStructureDiagnostic,
  validateLinuxNarrativeTextIntegrity,
  type LinuxNarrativeTextKind,
} from "@/lib/lab-assets/linux/narrativeIntegrity";
import { assertLinuxStudentTaskSolvability } from "@/lib/lab-assets/linux/taskSolvability";
import { assertLinuxIncidentCoverage } from "@/lib/lab-assets/linux/incidentCoverage";
import { assertLinuxTaskDiversity } from "@/lib/lab-assets/linux/taskDiversity";
import { assertLinuxPreSaveWorkloadBoundary } from "@/lib/lab-assets/linux/preSaveWorkloadBoundary";
import {
  cleanNarrativeField,
  extractOpenAIResponseText,
  GENERATED_LAB_TASK_COUNT_MAX,
  GENERATED_LAB_TASK_COUNT_MIN,
  getOpenAIResponseDiagnostics,
  narrativeFieldDiagnostics,
  narrativeCompletenessIssue,
  parseGeneratedLabResponse,
  type NarrativeParseReason,
  type NarrativeParseResult,
} from "@/lib/lab-assets/linux/narrativeResponse";
import {
  createLinuxForensicCapture,
  recordLinuxForensicFinal,
  recordLinuxForensicTaskAttempt,
  type LinuxForensicCapture,
} from "@/lib/lab-assets/linux/forensicCapture";
import { linuxFinalNarrativeTextHygieneReason } from "@/lib/lab-assets/linux/qualityChecker";
import { safeLinuxFinalQualityDiagnostics } from "@/lib/lab-assets/linux/finalQualityDiagnostics";
import {
  AiContentConsentError,
  bindAiContentConsent,
  consumeAiContentConsentToken,
} from "@/lib/ai/contentSharingConsentServer";
import { linuxIndefiniteArticle } from "@/lib/lab-assets/linux/grammar";

const allowedCategories = ["Linux", "Networking", "Web Security", "OSINT"];
const allowedDurations = ["15 mins", "30 mins", "60 mins"];
const SAFE_LINUX_GENERATION_FAILURE_MESSAGE =
  "We couldn’t generate this investigation safely. Please try again.";
const LINUX_DURATION_COMPATIBILITY_MESSAGE =
  "15-minute Linux investigations are available for Beginner difficulty. Choose 30 minutes for Intermediate or Advanced.";

const LINUX_NARRATIVE_SERIALIZER_RULES = `
Linux serializer mode:
- You are not investigating the Linux incident. The deterministic investigation is already complete.
- Your only job is to serialize the supplied Linux narrative contract into learner-facing English and the required JSON fields.
- The Linux narrative contract is the complete investigation universe. Treat everything outside it as false.
- Use only contract values. Do not use cybersecurity knowledge, common Linux knowledge, assumptions, substitutions, or gap filling.
- If a fact is absent from the contract, omit it completely. Do not create replacement content.
- Never invent filenames, users, services, processes, packages, commands, evidence, timestamps, relationships, capabilities, recommendations, task steps, root cause, attacker identity, compromise status, or business impact.
- Every learner-facing sentence must be traceable to the supplied contract.
- Every task is task-local. A value allowed for one task is forbidden for every other task unless it also appears in that other task contract.
- For task.evidence and claim.supporting_evidence, use exact selectedEvidence[].path values from that same task only. Never use selectedEvidence[].id, displayName, evidence: aliases, globalRenderedEvidencePaths, or an evidence path selected for another task.
- For claim.subjects, use exact groundedSubjects[].id values from that same task only. If no relevant subject appears in that task, use an empty subjects array.
- Each claim.subjects array item must be one exact groundedSubjects[].id string. Do not combine multiple subject IDs into one comma-separated string.
- For claim.relationships, use only exact groundedRelationships[].relation and subjectIds from that same task. If no exact relationship appears, use an empty relationships array.
- Each relationship subject_ids array item must be one exact subjectIds value. Do not combine multiple IDs into one string.
- For claim.timestamps, use only allowedTimestamps from that same task or the global incident window values. If no exact timestamp is needed, use an empty timestamps array.
- Use current_state only when that same task has allowedCurrentStateFacts or a current-state capability in requiredCapabilities. Otherwise use observed, historical_state, bounded_inference, or recommendation as supported.
- Use bounded_inference only for uncertainty, consistency with rendered change/maintenance records, or additional evidence needed. Do not turn two supported facts into a new unsupported conclusion.
- Use recommendation only within that task's allowedRecommendationCategories. If no concrete recommendation is supplied, limit it to evidence gaps or next validation.
- Do not mention any capability unless it appears in that task's requiredCapabilities or allowed fact lists.
- Do not copy raw capability labels such as authentication, command execution, process ancestry, service transition, evidence integrity, change control, or current policy state into learner-facing prose unless the same capability is expressly allowed for that exact task.
- Capability arrays are machine constraints, not wording suggestions.
- Task titles and deliverables must be concrete analyst actions using supplied scenario and evidence terms. Do not use only the contract objective label, a number, or a generic word such as timeline, analysis, collection, inventory, context, or review.
- Put case ID, ticket ID, change ID, host, host role, primary service, incident window, timezone, and company in objective or scenario when supplied. Do not put case or ticket metadata in the title.
- Before finalizing internally remove any sentence, evidence item, subject, relationship, timestamp, or recommendation that is not explicitly present in the relevant task contract. Do not output this self-check.
`.trim();

type GeneratedTask = LinuxAssembledTask & {
  task_id?: string;
  task_intent?: string;
  phase: string;
  title: string;
  evidence: string[];
  deliverable: string;
  claims?: Array<{
    claim_class?: string;
    text?: string;
    supporting_evidence?: string[];
    subjects?: string[];
    relationships?: Array<{ relation?: string; subject_ids?: string[] }>;
    timestamps?: string[];
  }>;
};

type GeneratedLab = {
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

type PreparedCandidate = {
  selectedAssets: LabAsset[];
  assetFiles: string[];
  labToInsert: {
    user_id: string;
    title: string;
    topic: string;
    difficulty: string;
    estimated_time: string;
    objective: string;
    scenario: string;
    tasks: string[];
    hints: string[];
    outcomes: string[];
    completed: false;
  };
  reviewLab: QualityReviewLab;
  rawText: string;
  input: string;
  systemPrompt: string;
  linuxQuality?: LinuxQualityResult;
  linuxFinalQuality?: LinuxFinalQualityResult;
  linuxNarrativeContractValidation?: LinuxNarrativeContractValidationResult;
  qualityReview?: AIQualityReviewResult;
  linuxInvestigation?: LinuxInvestigationContext;
  linuxSimulation?: LinuxSimulationWorld;
  linuxGenerationProvenance?: LinuxGenerationProvenance;
  linuxDeterministicHashes?: LinuxDeterministicHashes;
  validatedFinalObject?: PreparedCandidate["labToInsert"];
  validatedStudentNarrativeHash?: string;
};

type LinuxAssetRouteCandidate = ReturnType<typeof buildLinuxAssetCandidate>;

type NarrativeAttemptInfo = {
  assetAttempt?: number;
  narrativeAttempt?: number;
};

type SafeNarrativeFieldDiagnostic = {
  field: string;
  taskIndex: number | null;
  failureCategory: string;
  code: string | null;
  length: number;
  maxLength: number | null;
  completionStatus:
    | "complete"
    | "incomplete"
    | "unbalanced"
    | "corrupted"
    | "required_content"
    | "mutation"
    | "markdown_structure";
  unmatchedStructureType: string;
  openingCount: number;
  closingCount: number;
  codeFenceCount: number;
  numberedListOpenItems: number;
  sha256: string;
};

type SafeNarrativeEvidenceDiagnostic = {
  taskIndex: number | null;
  referencedPathHash: string;
  referenceClassification:
    | "invented_path"
    | "global_not_task_selected"
    | "unrendered_path"
    | "basename_alias"
    | "task_selected"
    | "unknown";
  existsGlobally: boolean;
  rendered: boolean;
  selectedForTask: boolean;
  allowedEvidenceCount: number;
  referencedEvidenceCount: number;
  contractHash: string;
  manifestHash: string;
};

type TraceField = {
  name: string;
  value: unknown;
};

class GenerationQualityError extends Error {
  constructor(
    message: string,
    public retryable = true,
    public linuxFinalQuality?: LinuxFinalQualityResult,
    public deterministicHashes?: Partial<LinuxDeterministicHashes>
  ) {
    super(message);
    this.name = "GenerationQualityError";
  }
}

class NarrativeGenerationError extends Error {
  constructor(
    public parseResult: Exclude<NarrativeParseResult, { ok: true }>,
    public retryable = true,
    public fieldDiagnostics: SafeNarrativeFieldDiagnostic[] = [],
    public evidenceDiagnostics: SafeNarrativeEvidenceDiagnostic[] = []
  ) {
    super(parseResult.details);
    this.name = "NarrativeGenerationError";
  }
}

class LearnerSafeGenerationError extends Error {
  constructor(
    public code: string,
    public status: number,
    public learnerMessage = SAFE_LINUX_GENERATION_FAILURE_MESSAGE,
    public retryable = true
  ) {
    super(code);
    this.name = "LearnerSafeGenerationError";
  }
}

function safeGenerationFailurePayload(code: string, message = SAFE_LINUX_GENERATION_FAILURE_MESSAGE, retryable = true) {
  return {
    error: code,
    message,
    retryable,
  };
}

function safeLinuxValidationCode(error: unknown) {
  if (error instanceof GenerationQualityError && error.linuxFinalQuality) {
    const firstCode = safeLinuxFinalQualityDiagnostics(error.linuxFinalQuality).issueCodes[0];
    return firstCode || "LINUX_FINAL_QUALITY_FAILED";
  }
  const text =
    error instanceof NarrativeGenerationError
      ? `${error.parseResult.reason} ${error.parseResult.details}`
      : error instanceof Error
        ? error.message
        : String(error || "");
  const linuxCode = text.match(/\bLINUX_[A-Z0-9_]+\b/)?.[0];
  if (linuxCode) return linuxCode;
  if (/model-facing task payload contains internal details/i.test(text)) return "LINUX_MODEL_FACING_INTERNAL_DETAIL";
  if (/student content validation failed/i.test(text)) return "LINUX_STUDENT_CONTENT_VALIDATION_FAILED";
  if (/task solvability/i.test(text)) return "LINUX_TASK_SOLVABILITY_FAILED";
  if (/incident coverage/i.test(text)) return "LINUX_INCIDENT_COVERAGE_FAILED";
  if (/task diversity/i.test(text)) return "LINUX_TASK_DIVERSITY_FAILED";
  if (/workload/i.test(text)) return "LINUX_WORKLOAD_VALIDATION_FAILED";
  if (/final quality|final validation/i.test(text)) return "LINUX_FINAL_QUALITY_FAILED";
  if (/asset validation failed|asset quality/i.test(text)) return "LINUX_ASSET_VALIDATION_FAILED";
  if (/narrative/i.test(text)) return "LINUX_NARRATIVE_GENERATION_FAILED";
  return undefined;
}

function safeLinuxGenerationStage(error: unknown) {
  if (error instanceof GenerationQualityError && error.linuxFinalQuality) return "final_quality";
  const text =
    error instanceof NarrativeGenerationError
      ? `${error.parseResult.reason} ${error.parseResult.details}`
      : error instanceof Error
        ? error.message
        : String(error || "");
  if (/content consent/i.test(text)) return "ai_consent";
  if (/reservation|usage/i.test(text)) return "usage_reservation";
  if (/OpenAI|AI lab generation failed|timeout/i.test(text)) return "openai_request";
  if (/invalid_json|schema|parse/i.test(text)) return "narrative_parsing";
  if (/model-facing task payload|retry feedback/i.test(text)) return "retry_feedback_sanitization";
  if (/student content validation failed/i.test(text)) return "student_content_validation";
  if (/narrative integrity|mutated after validation/i.test(text)) return "narrative_integrity";
  if (/semantic closure/i.test(text)) return "semantic_closure";
  if (/task solvability/i.test(text)) return "task_solvability";
  if (/incident coverage/i.test(text)) return "incident_coverage";
  if (/task diversity/i.test(text)) return "task_diversity";
  if (/workload/i.test(text)) return "workload_validation";
  if (/asset validation failed|asset quality/i.test(text)) return "evidence_generation";
  if (/lab_persistence|asset_persistence|provenance_persistence|Supabase|persistence/i.test(text)) return "supabase_persistence";
  if (/final quality|final validation/i.test(text)) return "final_quality";
  if (/narrative/i.test(text)) return "narrative_generation";
  return "unknown";
}

function safeGenerationDiagnostic(error: unknown) {
  const validationCode = safeLinuxValidationCode(error);
  const stage = safeLinuxGenerationStage(error);
  const common = validationCode ? { stage, validationCode } : { stage };
  if (error instanceof LearnerSafeGenerationError) {
    return { type: error.name, code: error.code, status: error.status, retryable: error.retryable, ...common };
  }
  if (error instanceof OpenAITimeoutError) {
    return { type: error.name, code: "generation_timeout", status: 504, retryable: true, ...common };
  }
  if (error instanceof GenerationQualityError) {
    return {
      type: error.name,
      code: "generation_quality_failed",
      status: 422,
      retryable: error.retryable,
      ...common,
      ...(error.linuxFinalQuality ? safeLinuxFinalQualityDiagnostics(error.linuxFinalQuality) : {}),
      deterministicHashes: {
        ...(error.linuxFinalQuality ? safeLinuxFinalQualityDiagnostics(error.linuxFinalQuality).deterministicHashes : {}),
        ...(error.deterministicHashes || {}),
      },
    };
  }
  if (error instanceof NarrativeGenerationError) {
    return {
      type: error.name,
      code: "narrative_generation_failed",
      status: 422,
      retryable: error.retryable,
      ...common,
      reason: error.parseResult.reason,
      rawLength: error.parseResult.rawLength,
      fieldDiagnostics: error.fieldDiagnostics,
      evidenceDiagnostics: error.evidenceDiagnostics,
    };
  }
  if (error instanceof AiContentConsentError) {
    return { type: error.name, code: "content_consent_failed", status: 403, retryable: false, ...common };
  }
  return { type: error instanceof Error ? error.name : typeof error, code: "unexpected_generation_error", status: 500, retryable: true, ...common };
}

type StructuredOpenAIResult = {
  value: unknown;
  rawText: string;
  diagnostics: ReturnType<typeof getOpenAIResponseDiagnostics>;
  responseId: string;
};

function enumItems(values: string[], maxLength = 120) {
  return values.length > 0
    ? { type: "string", enum: values, maxLength }
    : { type: "string", maxLength };
}

function linuxTaskNarrativeSchema(task: LinuxNarrativeTaskContract) {
  const evidencePaths = task.selectedEvidence.map((asset) => asset.path);
  const subjectIds = task.groundedSubjects.map((subject) => subject.id);
  const relationNames = Array.from(new Set(task.groundedRelationships.map((relationship) => relationship.relation)));
  const relationSubjectIds = Array.from(new Set(task.groundedRelationships.flatMap((relationship) => relationship.subjectIds)));
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      task_id: { type: "string", enum: [task.taskId] },
      task_intent: { type: "string", enum: [task.intent] },
      phase: { type: "string", maxLength: 40 },
      title: { type: "string", maxLength: 240 },
      evidence: {
        type: "array",
        minItems: Math.min(1, evidencePaths.length),
        maxItems: Math.min(3, Math.max(1, evidencePaths.length)),
        items: { type: "string", enum: evidencePaths, maxLength: 120 },
      },
      deliverable: { type: "string", maxLength: 320 },
      claims: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claim_class: {
              type: "string",
              enum: ["observed", "historical_state", "current_state", "bounded_inference", "recommendation"],
            },
            text: { type: "string", maxLength: 360 },
            supporting_evidence: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(3, Math.max(1, evidencePaths.length)),
              items: { type: "string", enum: evidencePaths, maxLength: 120 },
            },
            subjects: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(8, subjectIds.length),
              items: enumItems(subjectIds),
            },
            relationships: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(6, task.groundedRelationships.length),
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  relation: enumItems(relationNames, 80),
                  subject_ids: {
                    type: "array",
                    minItems: 0,
                    maxItems: Math.min(8, relationSubjectIds.length),
                    items: enumItems(relationSubjectIds),
                  },
                },
                required: ["relation", "subject_ids"],
              },
            },
            timestamps: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(8, task.allowedTimestamps.length),
              items: enumItems(task.allowedTimestamps, 40),
            },
          },
          required: ["claim_class", "text", "supporting_evidence", "subjects", "relationships", "timestamps"],
        },
      },
    },
    required: ["task_id", "task_intent", "phase", "title", "evidence", "deliverable", "claims"],
  };
}

function taskIsolatedContract(contract: LinuxNarrativeContract, task: LinuxNarrativeTaskContract): LinuxNarrativeContract {
  return {
    ...contract,
    canonicalTaskCount: 1,
    globalRenderedEvidencePaths: task.selectedEvidence.map((asset) => asset.path).sort(),
    globalGroundedSubjects: task.groundedSubjects,
    globalGroundedRelationships: task.groundedRelationships,
    globalAllowedTimestamps: task.allowedTimestamps,
    taskContracts: [task],
  };
}

function linuxTaskNarrativePrompt(contract: LinuxNarrativeContract, task: LinuxNarrativeTaskContract, feedback = "") {
  const isolated = taskIsolatedContract(contract, task);
  return [
    "Serialize exactly one Linux investigation task.",
    LINUX_NARRATIVE_SERIALIZER_RULES,
    "This API call is task-isolated. The task contract below is the complete universe for this task.",
    "Do not reference any other task, any global evidence not listed in selectedEvidence, or any relationship/capability not listed in this task contract.",
    "Return one JSON object for this task only. Do not return title, scenario, hints, outcomes, or other tasks.",
    "Use exact selectedEvidence[].path values in evidence and supporting_evidence.",
    "Use exact groundedSubjects[].id values only when needed; otherwise use an empty subjects array.",
    "Use exact groundedRelationships only when the full relation and subject_ids match; otherwise use an empty relationships array.",
    feedback ? `Task retry feedback:\n${feedback}` : "",
    JSON.stringify({
      version: isolated.version,
      caseId: isolated.caseId,
      difficulty: isolated.difficulty,
      scenarioFraming: isolated.scenarioFraming,
      taskContract: task,
      narrativeConstraints: isolated.narrativeConstraints,
      prohibitedCapabilityClaims: isolated.prohibitedCapabilityClaims,
    }, null, 2),
  ].filter(Boolean).join("\n\n");
}

async function callStructuredOpenAI(input: {
  model: string;
  instructions: string;
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}): Promise<StructuredOpenAIResult> {
  const openaiResponse = await fetchOpenAI("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      instructions: input.instructions,
      input: input.prompt,
      max_output_tokens: input.maxOutputTokens,
      reasoning: { effort: "minimal" },
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
    }),
  });

  if (!openaiResponse.ok) {
    const details = await openaiResponse.text();
    throw new Error(`AI lab generation failed: ${details}`);
  }

  const data = await openaiResponse.json();
  const rawText = extractOpenAIResponseText(data);
  try {
    return {
      value: JSON.parse(rawText),
      rawText,
      diagnostics: getOpenAIResponseDiagnostics(data),
      responseId: typeof data?.id === "string" ? data.id : "",
    };
  } catch (error) {
    throw new NarrativeGenerationError({
      ok: false,
      reason: "invalid_json",
      details: error instanceof Error ? error.message : "OpenAI response was not parseable JSON.",
      rawLength: rawText.length,
      rawPrefix: rawText.slice(0, 220),
      rawSuffix: rawText.slice(-220),
    }, true);
  }
}

async function generateTaskIsolatedLinuxNarrative(input: {
  model: string;
  systemPrompt: string;
  contract: LinuxNarrativeContract;
  context: LinuxInvestigationContext;
  difficulty: string;
  duration: string;
  maxTaskAttempts: number;
  finalQualityFeedback?: string;
  assetAttempt?: number;
  renderedAssetPaths?: string[];
  forensicCapture?: LinuxForensicCapture | null;
}) {
  const tasks: GeneratedTask[] = [];
  const rawTaskResponses: string[] = [];
  const taskValidations: LinuxNarrativeContractValidationResult[] = [];
  let promptTranscript = "";

  for (const task of input.contract.taskContracts) {
    let acceptedTask: GeneratedTask | null = null;
    let lastValidation: LinuxNarrativeContractValidationResult | null = null;
    let lastGeneratedTask: GeneratedTask | null = null;
    let lastAtomicIssues: LinuxTaskAtomicFieldIssue[] = [];
    let feedback = input.finalQualityFeedback || "";

    for (let taskAttempt = 1; taskAttempt <= input.maxTaskAttempts && !acceptedTask; taskAttempt += 1) {
      const generationView = buildLinuxTaskGenerationView({ contract: input.contract, task });
      const taskPrompt = serializeLinuxTaskGenerationPrompt({ view: generationView, feedback });
      promptTranscript += `\n\n--- task ${task.taskId} attempt ${taskAttempt} ---\n${taskPrompt}`;
      const response = await callStructuredOpenAI({
        model: input.model,
        instructions: [
          input.systemPrompt,
          "For this Linux call, serialize only the one supplied safe task view. Return only JSON for that one task.",
          "Write model-controlled text fields as plain text cells only. Do not author Markdown headings, lists, tables, separators, or code fences.",
        ].join("\n\n"),
        prompt: taskPrompt,
        schemaName: "cyberlab_linux_task_narrative",
        schema: linuxTaskGenerationSchema(generationView),
        maxOutputTokens: 1600,
      });

      rawTaskResponses.push(response.rawText);
      logLinuxNarrativeResponse({
        assetAttempt: input.assetAttempt,
        narrativeAttempt: taskAttempt,
        diagnostics: response.diagnostics,
        parseResult: {
          ok: true,
          value: {
            title: "task isolated",
            topic: "Linux",
            difficulty: input.difficulty,
            estimated_time: input.duration,
            objective: "task isolated",
            scenario: "task isolated",
            tasks: [response.value],
            hints: ["task isolated", "task isolated", "task isolated"],
            outcomes: ["task isolated", "task isolated", "task isolated"],
          },
          rawLength: response.rawText.length,
          details: "task-isolated JSON response",
        },
      });

      const generatedFromView = response.value as LinuxGeneratedTaskFromView;
      const atomicValidation = validateLinuxGeneratedTaskAtomicFields({
        view: generationView,
        generated: generatedFromView,
      });
      if (!atomicValidation.passed) {
        lastAtomicIssues = atomicValidation.issues;
        feedback = linuxAtomicTaskRetryFeedback(atomicValidation.issues);
        console.warn(
          `[CyberLab Linux Task Narrative] assetAttempt=${input.assetAttempt ?? "n/a"} task=${task.taskId} taskAttempt=${taskAttempt} status=atomic_format_violation issues=${atomicValidation.issues.map((issue) => issue.code).join("|")}`
        );
        continue;
      }
      lastAtomicIssues = [];

      const generatedTask = adaptLinuxGeneratedTaskFromView({
        task,
        generated: generatedFromView,
      }) as GeneratedTask;
      lastGeneratedTask = generatedTask;
      recordLinuxForensicTaskAttempt({
        capture: input.forensicCapture || null,
        assetAttempt: input.assetAttempt || 1,
        taskAttempt,
        taskId: task.taskId,
        intent: task.intent,
        responseId: response.responseId,
        status: response.diagnostics.status,
        inputTokens: response.diagnostics.inputTokens,
        outputTokens: response.diagnostics.outputTokens,
        parsedTaskOutput: response.value as Record<string, unknown>,
        adapterOutput: generatedTask as Record<string, unknown>,
      });
      const isolatedContract = taskIsolatedContract(input.contract, task);
      const validation = validateLinuxGeneratedNarrativeAgainstContract(isolatedContract, {
        title: "Linux task evidence review",
        objective: `Use selected evidence for ${input.contract.caseId} during ${input.contract.scenarioFraming.incidentWindow} ${input.contract.scenarioFraming.timezone}.`,
        scenario: `${input.contract.scenarioFraming.hostname} is reviewed as ${linuxIndefiniteArticle(input.contract.scenarioFraming.hostRole)} ${input.contract.scenarioFraming.hostRole}.`,
        tasks: [generatedTask as LinuxGeneratedTaskForContract],
        hints: ["Use only selected task evidence.", "Keep the task-local scope.", "Separate observation from uncertainty."],
        outcomes: ["Task-local evidence review.", "Supported claim mapping.", "Bounded analyst notes."],
      });
      lastValidation = validation;
      if (validation.passed) {
        acceptedTask = generatedTask;
        taskValidations.push(validation);
        break;
      }

      feedback = linuxNarrativeContractIssueRetryFeedback(validation.issues.map((issue) => issue.code), "task");
      console.warn(
        `[CyberLab Linux Task Narrative] assetAttempt=${input.assetAttempt ?? "n/a"} task=${task.taskId} taskAttempt=${taskAttempt} status=contract_violation issues=${validation.issues.map((issue) => issue.code).join("|")}`
      );
    }

    if (!acceptedTask) {
      const atomicFailure = lastAtomicIssues.length > 0;
      const details = lastValidation
        ? linuxNarrativeContractIssueRetryFeedback(lastValidation.issues.map((issue) => issue.code), "narrative")
        : atomicFailure
          ? buildLinuxSafeRetryFeedback({ categories: ["atomic_plain_text"], scope: "narrative" })
        : buildLinuxSafeRetryFeedback({ categories: ["general_contract_scope"], scope: "narrative" });
      const diagnosticTasks: LinuxGeneratedTaskForContract[] = input.contract.taskContracts.map((contractTask) =>
        contractTask.taskId === task.taskId && lastGeneratedTask
          ? {
              task_id: lastGeneratedTask.task_id,
              task_intent: lastGeneratedTask.task_intent,
              phase: lastGeneratedTask.phase,
              title: lastGeneratedTask.title,
              evidence: lastGeneratedTask.evidence,
              deliverable: lastGeneratedTask.deliverable,
              claims: lastGeneratedTask.claims as LinuxGeneratedTaskForContract["claims"],
            }
          : { task_id: contractTask.taskId, evidence: [], claims: [] }
      );
      throw new NarrativeGenerationError({
        ok: false,
        reason: atomicFailure ? "schema_mismatch" : "contract_violation",
        details,
        rawLength: rawTaskResponses.join("\n").length,
        rawPrefix: atomicFailure ? "" : rawTaskResponses.join("\n").slice(0, 220),
        rawSuffix: atomicFailure ? "" : rawTaskResponses.join("\n").slice(-220),
      }, true, atomicFailure ? safeFieldDiagnosticsFromAtomicIssues(lastAtomicIssues) : [], lastValidation
        ? buildSafeNarrativeEvidenceDiagnostics({
            contract: input.contract,
            validation: lastValidation,
            generatedTasks: diagnosticTasks,
            renderedAssetPaths: input.renderedAssetPaths,
          })
        : []);
    }

    tasks.push(acceptedTask);
  }

  const assembled = buildLinuxAssembledNarrative({
    contract: input.contract,
    context: input.context,
    difficulty: input.difficulty,
    duration: input.duration,
    tasks,
  }) as LinuxAssembledNarrative & GeneratedLab;
  recordLinuxForensicFinal({
    capture: input.forensicCapture || null,
    assembledLab: assembled,
  });
  const finalValidation = validateLinuxGeneratedNarrativeAgainstContract(
    input.contract,
    assembled as LinuxGeneratedNarrativeForContract
  );
  if (!finalValidation.passed) {
    throw new NarrativeGenerationError({
      ok: false,
      reason: "contract_violation",
      details: linuxNarrativeContractIssueRetryFeedback(finalValidation.issues.map((issue) => issue.code), "narrative"),
      rawLength: JSON.stringify(assembled).length,
      rawPrefix: JSON.stringify(assembled).slice(0, 220),
      rawSuffix: JSON.stringify(assembled).slice(-220),
    }, true, [], buildSafeNarrativeEvidenceDiagnostics({
      contract: input.contract,
      validation: finalValidation,
      generatedTasks: assembled.tasks as LinuxGeneratedTaskForContract[],
      renderedAssetPaths: input.renderedAssetPaths,
    }));
  }

  return {
    lab: assembled,
    rawText: JSON.stringify(assembled),
    input: promptTranscript.trim(),
    taskValidations,
    finalValidation,
  };
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function categoryTraceEnabled() {
  return process.env.CYBERLAB_LINUX_NARRATIVE_TRACE === "true" || process.env.NODE_ENV !== "production";
}

function traceString(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function traceFirst(value: unknown) {
  return traceString(value).replace(/\s+/g, " ").slice(0, 50);
}

function traceLast(value: unknown) {
  return traceString(value).replace(/\s+/g, " ").slice(-80);
}

function unifiedDiff(before: string, after: string) {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  if (beforeLines.length === 1 && afterLines.length === 1) {
    return `--- before\n+++ after\n-${before}\n+${after}`;
  }
  const max = Math.max(beforeLines.length, afterLines.length);
  const lines = ["--- before", "+++ after"];
  for (let index = 0; index < max; index += 1) {
    if (beforeLines[index] === afterLines[index]) {
      if (beforeLines[index] !== undefined) lines.push(` ${beforeLines[index]}`);
      continue;
    }
    if (beforeLines[index] !== undefined) lines.push(`-${beforeLines[index]}`);
    if (afterLines[index] !== undefined) lines.push(`+${afterLines[index]}`);
  }
  return lines.join("\n");
}

function logNarrativeStage(input: {
  stage: string;
  field: string;
  before?: unknown;
  after: unknown;
  functionName?: string;
  reason?: string;
}) {
  if (!categoryTraceEnabled()) return;
  const beforeText = input.before === undefined ? undefined : traceString(input.before);
  const afterText = traceString(input.after);
  const changed = beforeText !== undefined && beforeText !== afterText;
  const diagnostics = /deliverable/i.test(input.field)
    ? narrativeFieldDiagnostics(afterText, 320)
    : undefined;
  const diagnosticSuffix = diagnostics
    ? ` sha256=${diagnostics.sha256} terminal=${diagnostics.terminalCodePoints.join(",")} sentenceEnd=${diagnostics.endsInSentencePunctuation} maxLength=${diagnostics.reachesMaxLength} unmatched=${diagnostics.hasUnmatchedQuoteOrBracket} replacement=${diagnostics.containsReplacementCharacter} completeness="${diagnostics.completenessIssue}"`
    : "";
  const common =
    `[CyberLab Linux Narrative Trace] stage="${input.stage}" field="${input.field}" ` +
    `length=${afterText.length} first="${traceFirst(afterText)}" last="${traceLast(afterText)}" changed=${changed}${diagnosticSuffix}`;
  if (!changed) {
    console.info(common);
    return;
  }
  console.info(
    `${common} function="${input.functionName || "unknown"}" reason="${input.reason || "not supplied"}" oldLength=${beforeText?.length ?? 0} newLength=${afterText.length}\n${unifiedDiff(beforeText || "", afterText)}`
  );
}

function collectGeneratedLabFields(lab: GeneratedLab, prefix = "lab"): TraceField[] {
  const fields: TraceField[] = [
    { name: `${prefix}.title`, value: lab.title },
    { name: `${prefix}.topic`, value: lab.topic },
    { name: `${prefix}.difficulty`, value: lab.difficulty },
    { name: `${prefix}.estimated_time`, value: lab.estimated_time },
    { name: `${prefix}.objective`, value: lab.objective },
    { name: `${prefix}.scenario`, value: lab.scenario },
  ];
  if (Array.isArray(lab.tasks)) {
    lab.tasks.forEach((task, index) => {
      if (!task || typeof task !== "object") return;
      const item = task as Record<string, unknown>;
      fields.push(
        { name: `${prefix}.tasks[${index}].phase`, value: item.phase },
        { name: `${prefix}.tasks[${index}].title`, value: item.title },
        { name: `${prefix}.tasks[${index}].evidence`, value: item.evidence },
        { name: `${prefix}.tasks[${index}].deliverable`, value: item.deliverable }
      );
    });
  }
  if (Array.isArray(lab.hints)) {
    lab.hints.forEach((hint, index) => fields.push({ name: `${prefix}.hints[${index}]`, value: hint }));
  }
  if (Array.isArray(lab.outcomes)) {
    lab.outcomes.forEach((outcome, index) => fields.push({ name: `${prefix}.outcomes[${index}]`, value: outcome }));
  }
  return fields;
}

function logGeneratedLabStage(stage: string, lab: GeneratedLab) {
  collectGeneratedLabFields(lab).forEach((field) => {
    logNarrativeStage({ stage, field: field.name, after: field.value });
  });
}

function assertNoUnexpectedMutation(input: {
  stage: string;
  field: string;
  before: unknown;
  after: unknown;
  allowed: boolean;
  functionName: string;
  reason: string;
}) {
  const beforeText = traceString(input.before);
  const afterText = traceString(input.after);
  if (beforeText === afterText) return;
  logNarrativeStage({
    stage: input.stage,
    field: input.field,
    before: beforeText,
    after: afterText,
    functionName: input.functionName,
    reason: input.reason,
  });
  if (!input.allowed) {
    throw new Error(
      `Unexpected Linux narrative mutation at ${input.stage} field=${input.field} function=${input.functionName}`
    );
  }
}

function categoryBreakdown(result: LinuxFinalQualityResult) {
  return Object.entries(result.categoryScores)
    .map(([id, score]) => `${id}:${score.earned}/${score.possible}${score.evaluated ? "" : ":not-evaluated"}`)
    .join(" ");
}

function coverageFlags(result: LinuxFinalQualityResult) {
  return Object.entries(result.coverage)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function passBlockReason(result: LinuxFinalQualityResult) {
  if (!result.coverage.finalNarrativeEvaluated) return "FINAL_NARRATIVE_NOT_EVALUATED";
  if (result.issues.some((issue) => issue.severity === "critical")) return "CRITICAL_SEVERITY_OVERRIDE";
  if (result.issues.some((issue) => issue.severity === "high")) return "HIGH_SEVERITY_OVERRIDE";
  if (result.finalProductionScore < 90) return "SCORE_BELOW_THRESHOLD";
  return result.passed ? "PASSED" : "VALIDATION_FAILED";
}

function issueField(issue: LinuxFinalQualityResult["issues"][number]) {
  const text = `${issue.description} ${issue.evidence || ""}`.toLowerCase();
  if (text.includes("subtitle")) return "subtitle";
  if (text.includes("hint")) return "hint";
  if (text.includes("objective")) return "objective";
  if (text.includes("scenario")) return "scenario";
  if (text.includes("deliverable")) return "deliverable";
  if (text.includes("task")) return "task";
  if (text.includes("title")) return "title";
  return issue.category;
}

function classifyFinalQualityFailure(result: LinuxFinalQualityResult) {
  if (!result.coverage.finalNarrativeEvaluated) return "programming_error";
  if (result.issues.some((issue) => issue.category !== "generated_text" && issue.category !== "asset_consistency")) {
    return "asset_regeneration_required";
  }
  if (result.issues.some((issue) => issue.description.includes("validated") || issue.description.includes("score calculation"))) {
    return "programming_error";
  }
  return "narrative_retryable";
}

function correctionFeedback(result: LinuxFinalQualityResult) {
  if (result.issues.length === 0) return "";
  const feedback = buildLinuxSafeRetryFeedback({
    categories: linuxRetryFeedbackCategoriesFromFinalQuality(result),
    scope: "final_quality",
  });
  assertLinuxTaskGenerationViewIsModelSafe(feedback, "final-quality retry feedback");
  return feedback;
}

function logLinuxFinalQualityFailure(input: {
  assetAttempt: number;
  narrativeAttempt: number;
  result: LinuxFinalQualityResult;
  investigation: LinuxInvestigationContext;
}) {
  const { assetAttempt, narrativeAttempt, result, investigation } = input;
  const safeDiagnostics = safeLinuxFinalQualityDiagnostics(result);
  const common = `assetAttempt=${assetAttempt} narrativeAttempt=${narrativeAttempt} assetScore=${result.interimAssetScore} finalScore=${result.finalProductionScore} finalNarrativeEvaluated=${result.coverage.finalNarrativeEvaluated} passed=${result.passed} reason=${passBlockReason(result)} issues=${result.issues.length} issueCodes=${safeDiagnostics.issueCodes.join("|")} issueCategories=${safeDiagnostics.issueCategories.join("|")}`;
  if (process.env.NODE_ENV === "production") {
    console.warn(`[CyberLab Linux Final Quality] ${common}`);
    return;
  }
  console.warn(`[CyberLab Linux Final Quality]\n${common}\ncoverage=${coverageFlags(result)}\ncategories=${categoryBreakdown(result)}\nissues:\n${result.issues.map((issue, index) => {
    const taskIndex = issue.evidence?.match(/task\s+(\d+)/i)?.[1];
    const task = taskIndex ? ` task[${taskIndex}]` : "";
    const file = issue.file ? ` file=${issue.file}` : "";
    const evidence = issue.evidence ? ` evidence="${String(issue.evidence).slice(0, 180)}"` : "";
    return `- ${index + 1}. ${issue.severity.toUpperCase()} ${issue.category} ${issueField(issue)}${task}${file}: ${issue.description}${evidence}`;
  }).join("\n")}`);
}

function durationToMinutes(duration: string) {
  const parsed = Number.parseInt(duration);
  return Number.isFinite(parsed) ? parsed : 30;
}

function linuxDurationIsSupported(category: string, difficulty: string, duration: string) {
  return category !== "Linux" || durationToMinutes(duration) !== 15 || difficulty === "Beginner";
}

function isCybersecurityRelated(text: string) {
  const allowed = [
    "linux",
    "network",
    "networking",
    "web security",
    "security",
    "cyber",
    "osint",
    "logs",
    "permissions",
    "firewall",
    "dns",
    "http",
    "tcp",
    "ip",
    "scripting",
    "sql",
    "xss",
    "csrf",
  ];

  return allowed.some((word) => text.toLowerCase().includes(word));
}

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();
}

function cleanNarrativeText(
  value: unknown,
  fallback = "Linux incident response investigation"
) {
  return sanitizeLinuxLearnerText(cleanNarrativeField(value, fallback));
}

function finalizeLinuxRouteNarrativeText(
  value: unknown,
  options: Parameters<typeof finalizeLinuxNarrativeText>[1]
) {
  return finalizeLinuxNarrativeText(value, {
    ...options,
    normalize: sanitizeLinuxLearnerText,
  });
}

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildSafeNarrativeFieldDiagnostic(
  value: unknown,
  options: {
    field: string;
    kind: LinuxNarrativeTextKind;
    taskIndex?: number;
    maxLength?: number;
  }
): SafeNarrativeFieldDiagnostic {
  const text = sanitizeLinuxLearnerText(String(value ?? ""));
  const validation = validateLinuxNarrativeTextIntegrity(text, {
    field: options.field,
    kind: options.kind,
    taskIndex: options.taskIndex,
    maxLength: options.maxLength,
  });
  const structure = linuxNarrativeStructureDiagnostic(text);
  const firstIssue = validation.issues[0];
  const completionStatus = validation.passed
    ? "complete"
    : firstIssue?.category || "incomplete";
  return {
    field: options.field,
    taskIndex: options.taskIndex ?? null,
    failureCategory: firstIssue?.category || "unknown",
    code: firstIssue?.code || null,
    length: text.length,
    maxLength: options.maxLength ?? null,
    completionStatus,
    unmatchedStructureType: structure.unmatchedStructureType,
    openingCount: structure.openingCount,
    closingCount: structure.closingCount,
    codeFenceCount: structure.codeFenceCount,
    numberedListOpenItems: structure.numberedListOpenItems,
    sha256: sha256Text(text),
  };
}

function safeFieldDiagnosticsFromAtomicIssues(issues: LinuxTaskAtomicFieldIssue[]): SafeNarrativeFieldDiagnostic[] {
  return issues.map((issue) => ({
    field: issue.field,
    taskIndex: issue.taskIndex,
    failureCategory: issue.failureCategory,
    code: issue.code,
    length: issue.length,
    maxLength: null,
    completionStatus: issue.completionState,
    unmatchedStructureType: issue.unmatchedStructureType,
    openingCount: issue.openingCount,
    closingCount: issue.closingCount,
    codeFenceCount: issue.codeFenceCount,
    numberedListOpenItems: issue.numberedListOpenItems,
    sha256: issue.sha256,
  }));
}

function stablePathSetHash(values: Iterable<string>) {
  return sha256Text(JSON.stringify(Array.from(new Set(Array.from(values).map(normalizeEvidencePath))).sort()));
}

function collectTaskEvidenceReferences(task: LinuxGeneratedTaskForContract) {
  const values = new Set<string>();
  for (const item of task.evidence || []) values.add(normalizeEvidencePath(item));
  for (const claim of task.claims || []) {
    for (const item of claim.supporting_evidence || []) values.add(normalizeEvidencePath(item));
    const text = String(claim.text || "");
    for (const match of text.matchAll(/assets\/[A-Za-z0-9_./@-]+/g)) values.add(normalizeEvidencePath(match[0]));
  }
  for (const text of [task.phase, task.title, task.deliverable]) {
    for (const match of String(text || "").matchAll(/assets\/[A-Za-z0-9_./@-]+/g)) values.add(normalizeEvidencePath(match[0]));
  }
  return Array.from(values);
}

function buildSafeNarrativeEvidenceDiagnostics(input: {
  contract: LinuxNarrativeContract;
  validation: LinuxNarrativeContractValidationResult;
  generatedTasks: LinuxGeneratedTaskForContract[];
  renderedAssetPaths?: string[];
}) {
  const evidenceIssues = input.validation.issues.filter((issue) =>
    issue.code === "LINUX_NARRATIVE_UNRENDERED_EVIDENCE" ||
    issue.code === "LINUX_NARRATIVE_EVIDENCE_OUTSIDE_CONTRACT"
  );
  if (evidenceIssues.length === 0) return [];

  const globalRendered = new Set(input.contract.globalRenderedEvidencePaths.map(normalizeEvidencePath));
  const manifestPaths = new Set((input.renderedAssetPaths || input.contract.globalRenderedEvidencePaths).map(normalizeEvidencePath));
  const contractHash = stablePathSetHash(input.contract.globalRenderedEvidencePaths);
  const manifestHash = stablePathSetHash(manifestPaths);

  const byTaskId = new Map(input.contract.taskContracts.map((task, index) => [task.taskId, { task, index }]));
  const diagnostics: SafeNarrativeEvidenceDiagnostic[] = [];

  for (const issue of evidenceIssues) {
    const referenced = normalizeEvidencePath(issue.evidence || "");
    const taskEntry = issue.taskId ? byTaskId.get(issue.taskId) : undefined;
    const taskIndex = taskEntry?.index ?? null;
    const selected = new Set((taskEntry?.task.selectedEvidence || []).map((asset) => normalizeEvidencePath(asset.path)));
    const generatedTask = taskIndex === null ? undefined : input.generatedTasks[taskIndex];
    const referencedEvidenceCount = generatedTask ? collectTaskEvidenceReferences(generatedTask).length : 0;
    const selectedBasenameMatches = Array.from(selected).filter((pathValue) => {
      const basename = pathValue.split("/").pop() || pathValue;
      return referenced === basename;
    });
    const selectedForTask = selected.has(referenced);
    const existsGlobally = globalRendered.has(referenced);
    const rendered = manifestPaths.has(referenced);
    const referenceClassification: SafeNarrativeEvidenceDiagnostic["referenceClassification"] =
      selectedForTask
        ? "task_selected"
        : selectedBasenameMatches.length === 1
          ? "basename_alias"
          : existsGlobally
            ? "global_not_task_selected"
            : rendered
              ? "unrendered_path"
              : referenced
                ? "invented_path"
                : "unknown";

    diagnostics.push({
      taskIndex,
      referencedPathHash: sha256Text(referenced),
      referenceClassification,
      existsGlobally,
      rendered,
      selectedForTask,
      allowedEvidenceCount: selected.size,
      referencedEvidenceCount,
      contractHash,
      manifestHash,
    });
  }

  return diagnostics;
}

function narrativeIntegrityGenerationError(input: {
  validationError: unknown;
  rawLength: number;
  fallbackDetails: string;
  fieldDiagnostics?: SafeNarrativeFieldDiagnostic[];
  evidenceDiagnostics?: SafeNarrativeEvidenceDiagnostic[];
}) {
  return new NarrativeGenerationError({
    ok: false,
    reason: "schema_mismatch",
    details:
      input.validationError instanceof Error
        ? input.validationError.message
        : input.fallbackDetails,
    rawLength: input.rawLength,
  }, true, input.fieldDiagnostics || [], input.evidenceDiagnostics || []);
}

function canonicalLinuxTopic(incidentFamily?: string) {
  const topics: Record<string, string> = {
    ssh_bruteforce: "Linux DFIR: SSH Authentication Review",
    ssh_key_compromise: "Linux DFIR: SSH Key Provenance",
    misconfigured_sudoers: "Linux DFIR: Sudo Policy Review",
    service_account_misuse: "Linux DFIR: Service Account Misuse",
    cron_persistence: "Linux DFIR: Cron Execution Review",
    systemd_persistence: "Linux DFIR: Systemd Persistence",
    unauthorized_package_install: "Linux DFIR: Package Installation Review",
    data_staging: "Linux DFIR: Data Staging Review",
    log_tampering: "Linux DFIR: Log Integrity Investigation",
    docker_compromise: "Linux DFIR: Container Runtime Review",
    reverse_shell: "Linux DFIR: Process and Egress Correlation",
  };
  return topics[String(incidentFamily || "")] || "Linux DFIR: Host Investigation";
}

function normalizeEvidencePath(value: unknown) {
  return cleanText(value)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
}

function buildEvidenceResolver(assetFiles: string[]) {
  const evidenceMap = new Map<string, string>();

  for (const filePath of assetFiles) {
    const normalizedPath = normalizeEvidencePath(filePath);
    const withoutAssets = normalizedPath.replace(/^assets\//, "");
    const fileName = normalizedPath.split("/").at(-1);

    evidenceMap.set(normalizedPath, filePath);
    evidenceMap.set(withoutAssets, filePath);

    if (fileName) {
      evidenceMap.set(fileName, filePath);
    }
  }

  return (value: unknown) => {
    const normalized = normalizeEvidencePath(value);

    return evidenceMap.get(normalized) || null;
  };
}

function buildLinuxEvidenceResolver(assets: LabAsset[]) {
  const aliasMap = buildLinuxEvidenceAliasMap(assets);
  return (value: unknown) => {
    const normalized = normalizeEvidencePath(value);
    return aliasMap.get(normalized)?.file_path || null;
  };
}

function formatTasks(tasks: GeneratedTask[], assetFiles: string[], assets?: LabAsset[], options: { linux?: boolean } = {}) {
  const resolveEvidence = assets
    ? buildLinuxEvidenceResolver(assets)
    : buildEvidenceResolver(assetFiles);

  return tasks.map((task, index) => {
    const phase = options.linux
      ? finalizeLinuxRouteNarrativeText(task.phase, {
          field: `tasks[${index}].phase`,
          taskIndex: index,
          kind: "label",
          maxLength: 40,
          mutationStage: "8 task normalization",
        })
      : cleanNarrativeText(task.phase, "Investigation");
    const title = options.linux
      ? finalizeLinuxRouteNarrativeText(task.title, {
          field: `tasks[${index}].title`,
          taskIndex: index,
          kind: "title",
          maxLength: 240,
          mutationStage: "8 task normalization",
        })
      : cleanText(task.title, "Complete this investigation step.");
    const deliverable = options.linux
      ? finalizeLinuxRouteNarrativeText(task.deliverable, {
          field: `tasks[${index}].deliverable`,
          taskIndex: index,
          kind: "deliverable",
          maxLength: 320,
          mutationStage: "8 task normalization",
        })
      : cleanText(
          task.deliverable,
          "Record a concise evidence-backed finding."
        );

    const evidence = (Array.isArray(task.evidence)
      ? task.evidence
          .map((item) => resolveEvidence(item))
          .filter((item): item is string => Boolean(item))
          .slice(0, 3)
      : []) as string[];

    if (evidence.length === 0) {
      throw new Error(
        `Generated task ${index + 1} does not reference a valid evidence file.`
      );
    }

    const cleanedTitle = options.linux
      ? title
      : cleanNarrativeText(title, "Complete this investigation step.");
    const cleanedDeliverable = options.linux
      ? deliverable
      : cleanNarrativeText(
          deliverable,
          "Record a concise evidence-backed finding."
        );
    assertNoUnexpectedMutation({
      stage: "8 task normalization",
      field: `tasks[${index}].title`,
      before: title,
      after: cleanedTitle,
      allowed: title !== cleanedTitle,
      functionName: "cleanNarrativeText",
      reason: "task title cleanup/sanitization",
    });
    assertNoUnexpectedMutation({
      stage: "8 task normalization",
      field: `tasks[${index}].deliverable`,
      before: deliverable,
      after: cleanedDeliverable,
      allowed: deliverable !== cleanedDeliverable,
      functionName: "cleanNarrativeText",
      reason: "task deliverable cleanup/sanitization",
    });
    logNarrativeStage({
      stage: "7 alias resolution",
      field: `tasks[${index}].evidence`,
      before: task.evidence,
      after: evidence,
      functionName: assets ? "buildLinuxEvidenceResolver" : "buildEvidenceResolver",
      reason: "resolve model evidence aliases to saved asset paths",
    });

    return JSON.stringify({
      phase,
      title: cleanedTitle,
      evidence,
      deliverable: cleanedDeliverable,
    });
  });
}

function finalNarrativeFromSavedLab(labToInsert: PreparedCandidate["labToInsert"]): FinalLinuxNarrative {
  return {
    title: labToInsert.title,
    objective: labToInsert.objective,
    scenario: labToInsert.scenario,
    tasks: labToInsert.tasks.map((task) => {
      const parsed = JSON.parse(task) as GeneratedTask;
      return {
        phase: parsed.phase,
        title: parsed.title,
        description: parsed.title,
        evidence: parsed.evidence,
        deliverable: parsed.deliverable,
      };
    }),
    hints: labToInsert.hints,
    outcomes: labToInsert.outcomes,
    learningOutcomes: labToInsert.outcomes,
    duration: labToInsert.estimated_time,
    category: labToInsert.topic,
    difficulty: labToInsert.difficulty,
  };
}

function buildAssetContextBrief(
  assets: { file_path: string; content: string }[],
  difficulty: string
) {
  const advanced = difficulty === "Advanced";
  const contextFiles = advanced
    ? [
        { filePath: "assets/evidence/incident_brief.md", lines: 42 },
        { filePath: "assets/evidence/audit_notes.md", lines: 18 },
        { filePath: "assets/evidence/timeline.csv", lines: 9 },
        { filePath: "assets/reports/service_inventory.txt", lines: 8 },
      ]
    : [
        { filePath: "assets/evidence/incident_brief.md", lines: 34 },
        { filePath: "assets/evidence/timeline.csv", lines: 10 },
        { filePath: "assets/csv/users.csv", lines: 10 },
        { filePath: "assets/reports/service_inventory.txt", lines: 10 },
        { filePath: "assets/configs/linux_config_pack.txt", lines: 8 },
      ];

  return contextFiles
    .map(({ filePath, lines }) => {
      const asset = assets.find((item) => item.file_path === filePath);
      if (!asset) return null;

      const excerpt = asset.content
        .split("\n")
        .filter((line) => line.trim())
        .slice(0, lines)
        .join("\n");

      return `### ${filePath}\n${excerpt}`;
    })
    .filter((item): item is string => Boolean(item))
    .join("\n\n");
}

function narrativeRetryFeedback(reason: NarrativeParseReason, details: string) {
  void details;
  const feedback = buildLinuxSafeRetryFeedback({
    categories: linuxRetryFeedbackCategoriesFromParseReason(reason),
    scope: "narrative",
  });
  assertLinuxTaskGenerationViewIsModelSafe(feedback, "narrative retry feedback");
  return feedback;
}

function logLinuxNarrativeResponse(input: {
  assetAttempt?: number;
  narrativeAttempt?: number;
  diagnostics: ReturnType<typeof getOpenAIResponseDiagnostics>;
  parseResult: NarrativeParseResult;
}) {
  const { assetAttempt, narrativeAttempt, diagnostics, parseResult } = input;
  const parseStatus = parseResult.ok ? "valid" : parseResult.reason;
  const suffix = parseResult.ok
    ? ""
    : ` details="${parseResult.details.slice(0, 160)}"${
        parseResult.rawPrefix ? ` rawPrefix="${parseResult.rawPrefix}"` : ""
      }${parseResult.rawSuffix ? ` rawSuffix="${parseResult.rawSuffix}"` : ""}`;
  console.info(
    `[CyberLab Linux Narrative] assetAttempt=${assetAttempt ?? "n/a"} narrativeAttempt=${narrativeAttempt ?? "n/a"} status=${diagnostics.status} reason=${diagnostics.incompleteReason || "none"} inputTokens=${diagnostics.inputTokens ?? "unknown"} outputTokens=${diagnostics.outputTokens ?? "unknown"} outputTextLength=${diagnostics.outputTextLength} outputContentBlocks=${diagnostics.outputContentBlockCount} schemaOutputReturned=${diagnostics.schemaOutputReturned} parseStatus=${parseStatus}${suffix}`
  );
}

function hintSuffix(value: unknown) {
  return cleanText(value).slice(-60);
}

function logLinuxHintTransformation(input: {
  assetAttempt?: number;
  narrativeAttempt?: number;
  rawHints: unknown;
  cleanedHints: string[];
  schemaMaxLength: number;
}) {
  if (process.env.NODE_ENV === "production") return;
  const rawHints = Array.isArray(input.rawHints) ? input.rawHints : [];
  input.cleanedHints.forEach((cleaned, index) => {
    const raw = rawHints[index];
    console.info(
      `[CyberLab Linux Hint] assetAttempt=${input.assetAttempt ?? "n/a"} narrativeAttempt=${input.narrativeAttempt ?? "n/a"} hint=${index + 1} schemaMaxLength=${input.schemaMaxLength} rawLength=${cleanText(raw).length} rawSuffix="${hintSuffix(raw)}" cleanedLength=${cleaned.length} cleanedSuffix="${hintSuffix(cleaned)}" finalLength=${cleaned.length} finalSuffix="${hintSuffix(cleaned)}" completeness="${narrativeCompletenessIssue(cleaned) || "complete"}"`
    );
  });
}
export async function POST(req: Request) {
  const diagnosticRequestId = randomUUID();
  let reservationId: string | undefined;
  let requestCategory = "";
  let requestDifficulty = "";
  let requestDuration = "";
  let diagnosticAssetAttempt: number | undefined;
  let diagnosticNarrativeAttempt: number | undefined;
  let usageReservationOutcome:
    | "not_started"
    | "rejected"
    | "reserved"
    | "released"
    | "finalized" = "not_started";
  let persistenceOutcome:
    | "not_started"
    | "lab_insert_started"
    | "lab_inserted"
    | "asset_insert_started"
    | "assets_inserted"
    | "generated_lab_insert_started"
    | "generated_lab_inserted"
    | "generated_lab_missing"
    | "provenance_insert_started"
    | "provenance_inserted"
    | "complete" = "not_started";

  try {
    const supabase = await createClient();
    const authorization = await authorizeBetaAccess(supabase);
    if (!authorization.allowed) {
      return betaAccessErrorResponse(authorization);
    }
    const { user } = authorization;

    const body = await req.json();

    const category = String(body.category || "Linux").trim();
    requestCategory = category;
    const difficulty = String(body.difficulty || "Beginner").trim();
    requestDifficulty = difficulty;
    const duration = String(body.duration || "30 mins").trim();
    requestDuration = duration;
    const generationJobId =
      typeof body.generationJobId === "string" && /^[0-9a-f-]{36}$/i.test(body.generationJobId)
        ? body.generationJobId
        : null;

    if (category === "Linux") {
      if (!generationJobId) {
        return NextResponse.json(
          safeGenerationFailurePayload("generation_job_required", SAFE_LINUX_GENERATION_FAILURE_MESSAGE, false),
          { status: 409 }
        );
      }
      const { data: activeJob, error: activeJobError } = await supabaseAdmin
        .from("lab_generation_jobs")
        .select("id")
        .eq("id", generationJobId)
        .eq("user_id", user.id)
        .eq("category", category)
        .eq("difficulty", difficulty)
        .eq("duration", duration)
        .eq("status", "generating")
        .maybeSingle();
      if (activeJobError || !activeJob) {
        return NextResponse.json(
          safeGenerationFailurePayload("generation_job_invalid", SAFE_LINUX_GENERATION_FAILURE_MESSAGE, false),
          { status: 409 }
        );
      }
    }

    const consentId = await consumeAiContentConsentToken({
      userId: user.id,
      feature: "lab_generation",
      token: body.aiContentConsentToken,
    });

    if (!allowedCategories.includes(category)) {
      return NextResponse.json(
        {
          error:
            "This category is coming soon. CyberLab currently supports Linux, Networking, Web Security and OSINT labs.",
        },
        { status: 400 }
      );
    }

    if (!allowedDurations.includes(duration)) {
      return NextResponse.json(
        { error: "Invalid lab duration." },
        { status: 400 }
      );
    }

    if (!linuxDurationIsSupported(category, difficulty, duration)) {
      return NextResponse.json(
        {
          error: "unsupported_duration_difficulty",
          message: LINUX_DURATION_COMPATIBILITY_MESSAGE,
        },
        { status: 400 }
      );
    }

    const requestText = `${category} ${difficulty} ${duration}`;

    if (!isCybersecurityRelated(requestText)) {
      return NextResponse.json(
        { error: "CyberLab AI only generates cybersecurity training labs." },
        { status: 400 }
      );
    }

    const safety = checkSafety(requestText);

    if (!safety.allowed) {
      return NextResponse.json({ error: safety.reason }, { status: 400 });
    }

    const minutes = durationToMinutes(duration);
    const plan = await getUserPlan(user.id);

    if (plan !== "pro" && minutes > 30) {
      return NextResponse.json(
        {
          error:
            "Free users can generate 15 and 30 minute labs. Upgrade to CyberLab Pro to unlock 60 minute labs.",
        },
        { status: 403 }
      );
    }

    const usage = await reserveAIUsage(user.id, "lab_generation");

    if (!usage.allowed || !usage.reservationId) {
      usageReservationOutcome = "rejected";
      return NextResponse.json({ error: usage.reason, usage }, { status: 403 });
    }
    reservationId = usage.reservationId;
    usageReservationOutcome = "reserved";
    if (generationJobId) {
      const { data: reservedJob, error: jobReservationError } = await supabaseAdmin
        .from("lab_generation_jobs")
        .update({
          usage_reservation_id: reservationId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", generationJobId)
        .eq("user_id", user.id)
        .eq("status", "generating")
        .is("usage_reservation_id", null)
        .select("id")
        .maybeSingle();
      if (jobReservationError || !reservedJob) {
        throw new LearnerSafeGenerationError(
          "generation_job_claim_failed",
          409,
          SAFE_LINUX_GENERATION_FAILURE_MESSAGE,
          false
        );
      }
    }

    const model = chooseAIModel({
      feature: "lab_generation",
      plan: usage.plan,
      complexity: "normal",
    });

    const systemPrompt = buildSystemPrompt({
      feature: "lab_generation",
      plan: usage.plan,
    });

    const linuxForensicCapture = category === "Linux" ? createLinuxForensicCapture() : null;
    const linuxRootSeed = category === "Linux" ? createLinuxRootSeed() : undefined;
    const linuxGenerationTime = category === "Linux" ? new Date().toISOString() : undefined;

    const generateCandidate = async (
      linuxCandidateOverride?: LinuxAssetRouteCandidate,
      feedback = "",
      attemptInfo: NarrativeAttemptInfo = {}
    ): Promise<PreparedCandidate> => {
      const assetInput = {
        category,
        difficulty,
        duration,
        title: "CyberLab Asset Pack",
        seed: linuxRootSeed,
        generationTime: linuxGenerationTime,
        assetAttempt: attemptInfo.assetAttempt,
      };
      const linuxCandidate =
        category === "Linux" ? linuxCandidateOverride || buildLinuxAssetCandidate(assetInput) : null;
      const selectedAssets = linuxCandidate
        ? linuxCandidate.assets
        : buildAssetPack(assetInput);

      const assetFiles = selectedAssets
        .filter((asset) => asset.file_path.startsWith("assets/"))
        .map((asset) => asset.file_path);

      const assetList = assetFiles.map((file) => `- ${file}`).join("\n");
      const assetContextBrief = buildAssetContextBrief(selectedAssets, difficulty);
      const linuxNarrativeContract = linuxCandidate
        ? buildLinuxNarrativeContract(linuxCandidate.simulation, selectedAssets.map((asset) => asset.file_path))
        : null;
      const canonicalNarrativeBrief = linuxNarrativeContract
        ? buildLinuxCanonicalNarrativeBrief(linuxNarrativeContract)
        : "";
      const expectedLinuxTaskCount = linuxCandidate?.simulation.canonicalTasks.length;
      const assetContextSection = assetContextBrief
        ? `
Use this generated evidence context as the single source of truth. Do not invent different hostnames, users, IPs, services, incident dates, timelines, or files:

${assetContextBrief}
`
        : "";
      const canonicalBriefSection = canonicalNarrativeBrief
        ? `
Linux investigation narrative constraints:
${LINUX_NARRATIVE_SERIALIZER_RULES}

Contract field map:
- scenarioFraming is the only source for host, case ID, ticket ID, change ID, incident window, timezone, host role, IP, and service framing.
- taskContracts is the only source for task order, task intent, deliverable type, allowed evidence, allowed subjects, allowed relationships, allowed timestamps, allowed current-state claims, allowed historical claims, allowed bounded inferences, allowed recommendations, and allowed capabilities.
- narrativeConstraints lists global claim classes and prohibited claim categories.
- prohibitedCapabilityClaims lists concepts that must not appear in learner-facing text.

OpenAI may phrase title, objective, scenario, task text, deliverables, hints and outcomes only within the contract.
OpenAI must not choose facts, evidence, task order, task intent, deliverable type, host, actor, service, package, file, change ID, or incident window.
Use the task plan below. Return task wording in the same order and use only exact selectedEvidence[].path values listed for each task.
For every Linux task, return the exact task_id and task_intent from the contract.
For every Linux task, include classified claims. Each claim must use one of: observed, historical_state, current_state, bounded_inference, recommendation.
Every observed, historical_state, or current_state claim must list supporting_evidence paths selected for that exact same task. Current-state claims are allowed only when that same task contract includes current-state capabilities or allowedCurrentStateFacts.
Claims may reference subjects only by canonical subject IDs from that same task contract, and relationships only by exact relation plus subject_ids from that same task contract.
Do not reference globalRenderedEvidencePaths in task.evidence or supporting_evidence unless that path is also listed in the task's selectedEvidence array.
Return exactly the number of tasks supplied in the task plan. Do not merge tasks, split tasks, add extra tasks, or omit optional-looking tasks.
Frame every task as offline analysis of the supplied evidence pack. Do not ask the learner to run commands, SSH into a host, restart services, capture fresh traffic, delete files, or collect new evidence.
Do not expose internal canonical IDs, graph node names, registry identifiers, or relationship keys such as identity:, session:, command:, process:, file:, executed_by, spawned_process, opened_file, covered_by_change, inside_maintenance_window, authenticated_as, service_state, or service_transition. Use analyst wording only.
If a supplied task plan marks current-state evidence needs, the task wording must stay within those listed files. Do not ask whether something is currently running, active, enabled, installed, listening, configured, open, present, or still in place unless the task plan lists evidence that exposes that current state.
Treat timeline.csv, process_execution_history.txt, file_access_history.csv, audit.log, auth.log, sudo.log, journal exports, cron.log, and apt_history.log as historical evidence unless the task plan explicitly lists a current-state capability for that task.
Historical file access does not prove a file is currently open; current open-file or socket claims require open_files.txt plus a live process snapshot, and "(deleted)" means the directory entry is gone while the descriptor remains open.
For systemd evidence, keep enablement and runtime activity separate: enabled does not mean active, disabled does not mean stopped, and service_inventory.txt is the current-state source when selected.
journal_systemd.txt describes transition history. Do not use journal history or process_execution_history.txt alone as proof that a service is currently running.
Treat active/exited as valid for oneshot units when service_inventory.txt shows that state. Describe failed services only when the rendered state and result support failure.
For cron evidence, separate historical execution from current persistence. cron.log, audit.log, syslog, process_execution_history.txt, and timeline.csv show past execution, not proof that the cron entry still exists.
Only current scheduled definition evidence such as root_crontab.txt or files under scheduled/cron.d can support claims that cron persistence remains present. Removed cron jobs or past executions must not be described as active persistence.

${canonicalNarrativeBrief}
`
        : "";
      const correctionSection = feedback
        ? `
Narrative retry feedback:
${feedback}
`
        : "";

      const generationSeed = linuxCandidate
        ? `${linuxCandidate.provenance.seed}:asset:${linuxCandidate.provenance.assetAttempt}:narrative:${attemptInfo.narrativeAttempt ?? 1}`
        : "non-linux-openai-narrative";

      const input = `
Generate ONE premium CyberLab cybersecurity investigation lab.

The lab MUST be built around these exact asset files:

${assetList}
${assetContextSection}
${canonicalBriefSection}
${correctionSection}

Category: ${category}
Difficulty: ${difficulty}
Duration: ${duration}
Generation seed: ${generationSeed}

Your job is to create a professional investigation experience, not a generic checklist.
For Linux labs with a narrative contract, your job is narrower: serialize only the supplied contract into clear learner-facing English without adding facts.

Title and scenario diversity rules:
- For Linux labs with a narrative contract, derive the title only from scenarioFraming, task objectives, task intents, and selected evidence paths in the contract.
- For non-Linux labs, derive the title from the strongest evidence theme in the provided context, such as SSH key review, service account shell use, cron execution, systemd daemon activity, package review, Docker runtime behaviour, web service egress, data staging, or log integrity.
- Do not use generic titles centred on "Maintenance Drift", "Change-Control Drift", "Maintenance vs Unauthorised Access", "Linux Host Activity Reconciliation", or "Access Anomaly + Change-Control" unless the evidence specifically demands it.
- Do not make the change request the main story by default; it is context, not automatically the incident.
- Make the organisation feel specific by reflecting only supplied host role, industry, security maturity, documentation style, and logging quality.
- A batch of generated labs should read like different SOC tickets, not renamed copies of one workflow.

Return:
- a specific title
- one clear objective
- a realistic safe scenario
- ${GENERATED_LAB_TASK_COUNT_MIN} to ${GENERATED_LAB_TASK_COUNT_MAX} structured investigation tasks
- 3 useful hints
- 3 learning outcomes

Task rules:
- Each task must have a phase, title, evidence array, and deliverable.
- For Linux labs with a provided task plan, each task must also have task_id, task_intent, and 1 to 4 classified claims.
- Task titles must be complete sentences or complete action statements.
- For Linux labs with a provided task plan, return one task for every task-plan entry in order and preserve its intent, evidence contract, and deliverable type.
- For Linux labs with a provided task plan, the returned task count must exactly match that plan.
- For Linux labs with a provided task plan, each task evidence array must contain only exact selectedEvidence[].path values from that same task.
- For Linux labs with a provided task plan, each claim supporting_evidence array must contain only exact selectedEvidence[].path values from that same task.
- For Linux labs with a provided task plan, do not mention an evidence file in task title, deliverable, or claim text unless it is selected for that same task.
- Write Linux tasks as analysis of supplied offline artifacts only; never request live host access or new evidence collection.
- For labs without a provided task plan, blend task styles where appropriate: timeline reconstruction, ownership checks, policy comparison, service/process correlation, change-control review, and evidence-quality notes.
- Do not cut off task text.
- Do not end tasks with incomplete file paths.
- Evidence must only reference files from the allowed asset list. For Linux task plans, the stricter per-task selectedEvidence list overrides the global asset list.
- Every task must use 1 to 3 evidence files.
- Use the evidence context's suggested method when present.
- Do not use a fixed triage/scope/risk/remediation template.
- Do not reveal the incident family, compromised account, or final conclusion.
- Require correlation and justification from independent evidence sources only when the relevant task contract supplies those sources.
- Do not make every task sound identical.
- Avoid repetitive openings such as "Determine whether", "Assess", "Validate", "Review", and "Cross-check"; use natural SOC phrasing such as "Reconstruct", "Compare", "Map", "Correlate", "Document", "Prioritize", "Explain", or "Identify gaps" when suitable.
- Deliverables should ask for analyst notes, evidence tables, timeline entries, escalation summaries, or containment recommendations, not one-word answers.
- Do not generate commands.
- Do not generate tutorials.
- Do not include solutions.
- Hints must be concise complete one- or two-sentence hints. Do not end a hint with a connector such as to, with, and, or, using, for, by, through, against, or from.
- Keep everything safe, defensive, authorised, and cybersecurity-related.
- Scenario, objective, task titles, and deliverables must be complete. Never end mid-sentence.
- Avoid long file paths in task titles. Put file names only in the evidence array.

Style:
- Make it feel like a professional DFIR/SOC exercise with business impact, constraints, uncertainty, handoff context, and an escalation reason.
- Keep the scenario realistic: reference only provided ticket/change context, host role, review window, and evidence limitations without inventing new facts.
- For Linux labs, explicitly include the host, case ID, change ID, incident window, timezone, and host role in the final scenario/objective when those values appear in the provided evidence context.
- Make tasks practical and professional.
- Make the lab worth paying for.
`.trim();

      let linuxNarrativeContractValidation: LinuxNarrativeContractValidationResult | undefined;
      let rawText: string;
      let lab: GeneratedLab;
      let promptInput = input;

      if (linuxNarrativeContract && linuxCandidate?.investigation) {
        const isolated = await generateTaskIsolatedLinuxNarrative({
          model,
          systemPrompt,
          contract: linuxNarrativeContract,
          context: linuxCandidate.investigation,
          difficulty,
          duration,
          maxTaskAttempts: maxLinuxTaskAttempts,
          finalQualityFeedback: feedback,
          assetAttempt: attemptInfo.assetAttempt,
          renderedAssetPaths: selectedAssets.map((asset) => asset.file_path),
          forensicCapture: linuxForensicCapture,
        });
        lab = isolated.lab;
        rawText = isolated.rawText;
        promptInput = isolated.input;
        linuxNarrativeContractValidation = isolated.finalValidation;
        logNarrativeStage({
          stage: "3 GeneratedLab after task-isolated assembly",
          field: "json",
          after: rawText,
          functionName: "generateTaskIsolatedLinuxNarrative",
          reason: "assemble individually validated Linux task narratives",
        });
      } else {
        const openaiResponse = await fetchOpenAI("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            instructions: systemPrompt,
            input,
            max_output_tokens: 5200,
            reasoning: { effort: "minimal" },
            text: {
              format: {
                type: "json_schema",
                name: "cyberlab_premium_investigation_lab",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string", maxLength: 140 },
                    topic: { type: "string", maxLength: 50 },
                    difficulty: {
                      type: "string",
                      enum: ["Beginner", "Intermediate", "Advanced"],
                    },
                    estimated_time: { type: "string", maxLength: 30 },
                    objective: { type: "string", maxLength: 500 },
                    scenario: { type: "string", maxLength: 1200 },
                    tasks: {
                      type: "array",
                      minItems: GENERATED_LAB_TASK_COUNT_MIN,
                      maxItems: GENERATED_LAB_TASK_COUNT_MAX,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          phase: { type: "string", maxLength: 40 },
                          title: { type: "string", maxLength: 240 },
                          evidence: {
                            type: "array",
                            minItems: 1,
                            maxItems: 3,
                            items: { type: "string", maxLength: 90 },
                          },
                          deliverable: { type: "string", maxLength: 320 },
                        },
                        required: ["phase", "title", "evidence", "deliverable"],
                      },
                    },
                    hints: {
                      type: "array",
                      minItems: 3,
                      maxItems: 3,
                      items: { type: "string", maxLength: 260 },
                    },
                    outcomes: {
                      type: "array",
                      minItems: 3,
                      maxItems: 3,
                      items: { type: "string", maxLength: 220 },
                    },
                  },
                  required: [
                    "title",
                    "topic",
                    "difficulty",
                    "estimated_time",
                    "objective",
                    "scenario",
                    "tasks",
                    "hints",
                    "outcomes",
                  ],
                },
              },
            },
          }),
        });

        if (!openaiResponse.ok) {
          const details = await openaiResponse.text();
          throw new Error(`AI lab generation failed: ${details}`);
        }

        const aiData = await openaiResponse.json();
        const diagnostics = getOpenAIResponseDiagnostics(aiData);
        const rawExtractedText = extractOpenAIResponseText(aiData);
        logNarrativeStage({
          stage: "1 raw OpenAI response",
          field: "output_text",
          after: rawExtractedText,
        });
        const parseResult = parseGeneratedLabResponse(aiData, {
          expectedTaskCount: expectedLinuxTaskCount,
        });
        if (category === "Linux") {
          logLinuxNarrativeResponse({
            assetAttempt: attemptInfo.assetAttempt,
            narrativeAttempt: attemptInfo.narrativeAttempt,
            diagnostics,
            parseResult,
          });
        }
        if (!parseResult.ok) {
          throw new NarrativeGenerationError(parseResult, parseResult.reason !== "refusal");
        }
        logNarrativeStage({
          stage: "2 structured JSON extracted",
          field: "json",
          before: rawExtractedText,
          after: JSON.stringify(parseResult.value),
          functionName: "parseGeneratedLabResponse",
          reason: "parse strict schema JSON response into GeneratedLab object",
        });
        rawText = JSON.stringify(parseResult.value);
        lab = parseResult.value as GeneratedLab;
        logGeneratedLabStage("3 GeneratedLab after parsing", lab);
      }

      let formattedTasks: string[];

      try {
        formattedTasks = formatTasks(
          Array.isArray(lab.tasks) ? (lab.tasks as GeneratedTask[]) : [],
          assetFiles,
          category === "Linux" ? selectedAssets : undefined,
          { linux: category === "Linux" }
        );
      } catch (validationError) {
        const fieldDiagnostics = category === "Linux" && Array.isArray(lab.tasks)
          ? (lab.tasks as GeneratedTask[]).flatMap((task, index) => [
              buildSafeNarrativeFieldDiagnostic(task.phase, {
                field: `tasks[${index}].phase`,
                taskIndex: index,
                kind: "label",
                maxLength: 40,
              }),
              buildSafeNarrativeFieldDiagnostic(task.title, {
                field: `tasks[${index}].title`,
                taskIndex: index,
                kind: "title",
                maxLength: 240,
              }),
              buildSafeNarrativeFieldDiagnostic(task.deliverable, {
                field: `tasks[${index}].deliverable`,
                taskIndex: index,
                kind: "deliverable",
                maxLength: 320,
              }),
            ]).filter((diagnostic) => diagnostic.completionStatus !== "complete")
          : [];
        throw narrativeIntegrityGenerationError({
          validationError,
          rawLength: rawText.length,
          fallbackDetails: "Generated lab tasks failed evidence validation.",
          fieldDiagnostics,
        });
      }

      const reviewTasks = formattedTasks.map(
        (task) => JSON.parse(task) as GeneratedTask
      );
      let cleanedTitle: string;
      let cleanedTopic: string;
      let cleanedDifficulty: string;
      let cleanedEstimatedTime: string;
      let cleanedObjective: string;
      let cleanedScenario: string;
      try {
        cleanedTitle = category === "Linux"
          ? finalizeLinuxRouteNarrativeText(lab.title, {
              field: "title",
              kind: "title",
              maxLength: 140,
              mutationStage: "4 narrative cleanup",
            })
          : cleanNarrativeText(lab.title, "Linux incident response investigation");
        cleanedTopic = category === "Linux"
          ? canonicalLinuxTopic(linuxCandidate?.investigation.incidentFamily)
          : cleanNarrativeText(lab.topic || category, category);
        if (category === "Linux") {
          cleanedTopic = finalizeLinuxRouteNarrativeText(cleanedTopic, {
            field: "topic",
            kind: "label",
            maxLength: 80,
            mutationStage: "4 narrative cleanup",
          });
        }
        cleanedDifficulty = category === "Linux"
          ? finalizeLinuxRouteNarrativeText(lab.difficulty || difficulty, {
              field: "difficulty",
              kind: "label",
              maxLength: 40,
              mutationStage: "4 narrative cleanup",
            })
          : cleanNarrativeText(lab.difficulty || difficulty, difficulty);
        cleanedEstimatedTime = category === "Linux"
          ? finalizeLinuxRouteNarrativeText(lab.estimated_time || duration, {
              field: "estimated_time",
              kind: "label",
              maxLength: 40,
              mutationStage: "4 narrative cleanup",
            })
          : cleanNarrativeText(lab.estimated_time || duration, duration);
        cleanedObjective = category === "Linux"
          ? finalizeLinuxRouteNarrativeText(lab.objective, {
              field: "objective",
              kind: "objective",
              maxLength: 500,
              mutationStage: "4 narrative cleanup",
            })
          : cleanNarrativeText(lab.objective);
        cleanedScenario = category === "Linux"
          ? finalizeLinuxRouteNarrativeText(lab.scenario, {
              field: "scenario",
              kind: "scenario",
              maxLength: 1200,
              mutationStage: "4 narrative cleanup",
            })
          : cleanNarrativeText(lab.scenario);
      } catch (validationError) {
        const fieldDiagnostics = category === "Linux"
          ? [
              buildSafeNarrativeFieldDiagnostic(lab.title, { field: "title", kind: "title", maxLength: 140 }),
              buildSafeNarrativeFieldDiagnostic(lab.topic || category, { field: "topic", kind: "label", maxLength: 80 }),
              buildSafeNarrativeFieldDiagnostic(lab.difficulty || difficulty, { field: "difficulty", kind: "label", maxLength: 40 }),
              buildSafeNarrativeFieldDiagnostic(lab.estimated_time || duration, { field: "estimated_time", kind: "label", maxLength: 40 }),
              buildSafeNarrativeFieldDiagnostic(lab.objective, { field: "objective", kind: "objective", maxLength: 500 }),
              buildSafeNarrativeFieldDiagnostic(lab.scenario, { field: "scenario", kind: "scenario", maxLength: 1200 }),
            ].filter((diagnostic) => diagnostic.completionStatus !== "complete")
          : [];
        throw narrativeIntegrityGenerationError({
          validationError,
          rawLength: rawText.length,
          fallbackDetails: "Generated lab fields failed final narrative integrity validation.",
          fieldDiagnostics,
        });
      }
      [
        ["title", lab.title, cleanedTitle],
        ["topic", lab.topic || category, cleanedTopic],
        ["difficulty", lab.difficulty || difficulty, cleanedDifficulty],
        ["estimated_time", lab.estimated_time || duration, cleanedEstimatedTime],
        ["objective", lab.objective, cleanedObjective],
        ["scenario", lab.scenario, cleanedScenario],
      ].forEach(([field, before, after]) => {
        assertNoUnexpectedMutation({
          stage: "4 narrative cleanup",
          field: String(field),
          before,
          after,
          allowed: traceString(before) !== traceString(after),
          functionName: "cleanNarrativeText",
          reason: "field cleanup/sanitization",
        });
      });
      [
        ["title", cleanedTitle],
        ["topic", cleanedTopic],
        ["difficulty", cleanedDifficulty],
        ["estimated_time", cleanedEstimatedTime],
        ["objective", cleanedObjective],
        ["scenario", cleanedScenario],
      ].forEach(([field, value]) => {
        logNarrativeStage({
          stage: "5 narrative normalization",
          field: String(field),
          before: value,
          after: value,
          functionName: "none",
          reason: "no additional normalization after cleanup",
        });
        logNarrativeStage({
          stage: "6 field truncation",
          field: String(field),
          before: value,
          after: value,
          functionName: "none",
          reason: "no local character truncation applied",
        });
      });
      let cleanedHints: string[];
      let cleanedOutcomes: string[];
      try {
        cleanedHints = Array.isArray(lab.hints)
          ? lab.hints.map((hint: unknown, index: number) => {
              const cleaned = category === "Linux"
                ? finalizeLinuxRouteNarrativeText(hint, {
                    field: `hints[${index}]`,
                    kind: "hint",
                    maxLength: 260,
                    mutationStage: "4 narrative cleanup",
                  })
                : cleanNarrativeText(hint);
              assertNoUnexpectedMutation({
                stage: "4 narrative cleanup",
                field: `hints[${index}]`,
                before: hint,
                after: cleaned,
                allowed: traceString(hint) !== traceString(cleaned),
                functionName: "cleanNarrativeText",
                reason: "hint cleanup/sanitization",
              });
              return cleaned;
            }).slice(0, 3)
          : [];
        cleanedOutcomes = Array.isArray(lab.outcomes)
          ? lab.outcomes
              .map((outcome: unknown, index: number) => {
                const cleaned = category === "Linux"
                  ? finalizeLinuxRouteNarrativeText(outcome, {
                      field: `outcomes[${index}]`,
                      kind: "outcome",
                      maxLength: 220,
                      mutationStage: "4 narrative cleanup",
                    })
                  : cleanNarrativeText(outcome);
                assertNoUnexpectedMutation({
                  stage: "4 narrative cleanup",
                  field: `outcomes[${index}]`,
                  before: outcome,
                  after: cleaned,
                  allowed: traceString(outcome) !== traceString(cleaned),
                  functionName: "cleanNarrativeText",
                  reason: "outcome cleanup/sanitization",
                });
                return cleaned;
              })
              .slice(0, 3)
          : [];
      } catch (validationError) {
        const hintDiagnostics = category === "Linux" && Array.isArray(lab.hints)
          ? lab.hints.map((hint: unknown, index: number) =>
              buildSafeNarrativeFieldDiagnostic(hint, {
                field: `hints[${index}]`,
                kind: "hint",
                maxLength: 260,
              })
            )
          : [];
        const outcomeDiagnostics = category === "Linux" && Array.isArray(lab.outcomes)
          ? lab.outcomes.map((outcome: unknown, index: number) =>
              buildSafeNarrativeFieldDiagnostic(outcome, {
                field: `outcomes[${index}]`,
                kind: "outcome",
                maxLength: 220,
              })
            )
          : [];
        throw narrativeIntegrityGenerationError({
          validationError,
          rawLength: rawText.length,
          fallbackDetails: "Generated hints or outcomes failed final narrative integrity validation.",
          fieldDiagnostics: [...hintDiagnostics, ...outcomeDiagnostics].filter(
            (diagnostic) => diagnostic.completionStatus !== "complete"
          ),
        });
      }
      logLinuxHintTransformation({
        assetAttempt: attemptInfo.assetAttempt,
        narrativeAttempt: attemptInfo.narrativeAttempt,
        rawHints: lab.hints,
        cleanedHints,
        schemaMaxLength: 260,
      });

      const labToInsert = {
        user_id: user.id,
        title: cleanedTitle,
        topic: cleanedTopic,
        difficulty: cleanedDifficulty,
        estimated_time: cleanedEstimatedTime,
        objective: cleanedObjective,
        scenario: cleanedScenario,
        tasks: formattedTasks,
        hints: cleanedHints,
        outcomes: cleanedOutcomes,
        completed: false as const,
      };
      [
        ["title", cleanedTitle, labToInsert.title],
        ["topic", cleanedTopic, labToInsert.topic],
        ["difficulty", cleanedDifficulty, labToInsert.difficulty],
        ["estimated_time", cleanedEstimatedTime, labToInsert.estimated_time],
        ["objective", cleanedObjective, labToInsert.objective],
        ["scenario", cleanedScenario, labToInsert.scenario],
        ["hints", cleanedHints, labToInsert.hints],
        ["outcomes", cleanedOutcomes, labToInsert.outcomes],
      ].forEach(([field, before, after]) => {
        assertNoUnexpectedMutation({
          stage: "9 labToInsert mapping",
          field: String(field),
          before,
          after,
          allowed: false,
          functionName: "labToInsert",
          reason: "mapping must preserve cleaned values",
        });
      });
      let validatedStudentNarrativeHash: string | undefined;
      if (category === "Linux") {
        try {
          assertLinuxStudentNarrativeIntegrity(labToInsert);
          validatedStudentNarrativeHash = hashLinuxStudentNarrativeObject(labToInsert);
        } catch (validationError) {
          const parsedTasks = labToInsert.tasks.map((task) => JSON.parse(task) as GeneratedTask);
          throw narrativeIntegrityGenerationError({
            validationError,
            rawLength: rawText.length,
            fallbackDetails: "Generated lab failed final student narrative integrity validation.",
            fieldDiagnostics: [
              buildSafeNarrativeFieldDiagnostic(labToInsert.title, { field: "title", kind: "title", maxLength: 140 }),
              buildSafeNarrativeFieldDiagnostic(labToInsert.objective, { field: "objective", kind: "objective", maxLength: 500 }),
              buildSafeNarrativeFieldDiagnostic(labToInsert.scenario, { field: "scenario", kind: "scenario", maxLength: 1200 }),
              ...parsedTasks.flatMap((task, index) => [
                buildSafeNarrativeFieldDiagnostic(task.phase, {
                  field: `tasks[${index}].phase`,
                  taskIndex: index,
                  kind: "label",
                  maxLength: 40,
                }),
                buildSafeNarrativeFieldDiagnostic(task.title, {
                  field: `tasks[${index}].title`,
                  taskIndex: index,
                  kind: "title",
                  maxLength: 240,
                }),
                buildSafeNarrativeFieldDiagnostic(task.deliverable, {
                  field: `tasks[${index}].deliverable`,
                  taskIndex: index,
                  kind: "deliverable",
                  maxLength: 320,
                }),
              ]),
              ...labToInsert.hints.map((hint, index) =>
                buildSafeNarrativeFieldDiagnostic(hint, {
                  field: `hints[${index}]`,
                  kind: "hint",
                  maxLength: 260,
                })
              ),
              ...labToInsert.outcomes.map((outcome, index) =>
                buildSafeNarrativeFieldDiagnostic(outcome, {
                  field: `outcomes[${index}]`,
                  kind: "outcome",
                  maxLength: 220,
                })
              ),
            ].filter((diagnostic) => diagnostic.completionStatus !== "complete"),
          });
        }
      }

      return {
        selectedAssets,
        assetFiles,
        labToInsert,
        reviewLab: {
          title: labToInsert.title,
          topic: labToInsert.topic,
          difficulty: labToInsert.difficulty,
          estimated_time: labToInsert.estimated_time,
          objective: labToInsert.objective,
          scenario: labToInsert.scenario,
          tasks: reviewTasks,
          hints: labToInsert.hints,
          outcomes: labToInsert.outcomes,
        },
        rawText,
        input: promptInput,
        systemPrompt,
        linuxQuality: linuxCandidate?.assetQuality,
        linuxInvestigation: linuxCandidate?.investigation,
        linuxSimulation: linuxCandidate?.simulation,
        linuxGenerationProvenance: linuxCandidate?.provenance,
        linuxDeterministicHashes: linuxCandidate?.deterministicHashes,
        linuxNarrativeContractValidation,
        validatedStudentNarrativeHash,
      };
    };

    const maxAssetAttempts = category === "Linux" ? 3 : 1;
    const maxLinuxTaskAttempts = 3;
    const maxNarrativeAttempts = category === "Linux" ? 2 : 1;
    const aiQualityReviewEnabled =
      process.env.ENABLE_AI_QUALITY_REVIEW?.toLowerCase() === "true";
    let selectedCandidate: PreparedCandidate | null = null;
    let lastFinalFailure: LinuxFinalQualityResult | null = null;
    let lastFinalFailureHashes: Partial<LinuxDeterministicHashes> | undefined;

    if (category !== "Linux") {
      selectedCandidate = await generateCandidate();
    } else {
      let lastNarrativeFailure: Exclude<NarrativeParseResult, { ok: true }> | null = null;
      let feedback = "";

      for (let assetAttempt = 1; assetAttempt <= maxAssetAttempts && !selectedCandidate; assetAttempt += 1) {
        diagnosticAssetAttempt = assetAttempt;
        let linuxAssetCandidate: LinuxAssetRouteCandidate;
        try {
          const distinct = await selectLinuxRecentDistinctCandidate({
            build: (diversityAttempt) => buildLinuxAssetCandidate({
              category,
              difficulty,
              duration,
              title: "CyberLab Asset Pack",
              seed: linuxRootSeed,
              generationTime: linuxGenerationTime,
              assetAttempt: (assetAttempt - 1) * 64 + diversityAttempt * 8 + 1,
            }),
            loadHistory: (family) => loadLinuxRecentAcceptedCases(supabaseAdmin, user.id, family),
          });
          linuxAssetCandidate = distinct.candidate;
        } catch (error) {
          // Missing/unknown history is not a diversity rejection and cannot be
          // rescued by selecting another seed or spending on narrative calls.
          if (error instanceof LinuxDiversityHistoryError && !error.message.startsWith("LINUX_DIVERSITY_EXHAUSTED")) throw error;
          console.warn(
            `[CyberLab Linux Asset Quality] assetAttempt=${assetAttempt} failed ${error instanceof Error ? error.message : "unknown error"}`
          );
          continue;
        }

        feedback = "";
        for (let narrativeAttempt = 1; narrativeAttempt <= maxNarrativeAttempts; narrativeAttempt += 1) {
          diagnosticNarrativeAttempt = narrativeAttempt;
          let candidate: PreparedCandidate;
          try {
            candidate = await generateCandidate(linuxAssetCandidate, feedback, {
              assetAttempt,
              narrativeAttempt,
            });
          } catch (error) {
            if (error instanceof NarrativeGenerationError) {
              lastNarrativeFailure = error.parseResult;
              console.warn(
                `[CyberLab Linux Narrative] assetAttempt=${assetAttempt} narrativeAttempt=${narrativeAttempt} parseStatus=${error.parseResult.reason} retryable=${error.retryable} rawLength=${error.parseResult.rawLength} details="${error.parseResult.details.slice(0, 180)}"`
              );
              if (!error.retryable) {
                throw error;
              }
              feedback = narrativeRetryFeedback(error.parseResult.reason, error.parseResult.details);
              continue;
            }
            throw error;
          }

          if (!candidate.linuxInvestigation || !candidate.linuxQuality?.passed) {
            break;
          }

          const finalNarrative = finalNarrativeFromSavedLab(candidate.labToInsert);
          [
            ["title", candidate.labToInsert.title, finalNarrative.title],
            ["objective", candidate.labToInsert.objective, finalNarrative.objective],
            ["scenario", candidate.labToInsert.scenario, finalNarrative.scenario],
            ["hints", candidate.labToInsert.hints, finalNarrative.hints],
            ["outcomes", candidate.labToInsert.outcomes, finalNarrative.outcomes],
          ].forEach(([field, before, after]) => {
            assertNoUnexpectedMutation({
              stage: "10 final quality checker input",
              field: String(field),
              before,
              after,
              allowed: false,
              functionName: "finalNarrativeFromSavedLab",
              reason: "checker input must preserve saved lab fields",
            });
          });
          const linuxFinalQuality = checkLinuxFinalProductionQuality({
            context: candidate.linuxInvestigation,
            assets: candidate.selectedAssets,
            simulation: candidate.linuxSimulation,
            lab: finalNarrative,
            workload: {
              requestedDifficulty: candidate.linuxGenerationProvenance?.difficulty,
              requestedDurationMinutes: candidate.linuxGenerationProvenance?.durationMinutes,
              expectedWorkloadEstimateHash: candidate.linuxDeterministicHashes?.workloadEstimateHash,
              expectedWorkloadReportHash: candidate.linuxDeterministicHashes?.workloadReportHash,
            },
          });
          const forensicQualityReport = {
            ...linuxFinalQuality,
            issues: linuxFinalQuality.issues.map((issue) => ({
              ...issue,
              evidence: issue.evidence || "",
              ...(issue.description === "Final narrative task deliverable is malformed or truncated."
                ? {
                    forensicPredicate: "linuxFinalNarrativeTextHygieneReason",
                    forensicReason: linuxFinalNarrativeTextHygieneReason(issue.evidence || ""),
                  }
                : {}),
            })),
          } as LinuxFinalQualityResult;
          recordLinuxForensicFinal({
            capture: linuxForensicCapture,
            qualityInput: finalNarrative,
            qualityReport: forensicQualityReport,
            failureReason: passBlockReason(linuxFinalQuality),
          });
          candidate.linuxFinalQuality = linuxFinalQuality;
          candidate.validatedFinalObject = candidate.labToInsert;

          console.info(
            `[CyberLab Linux Quality] assetAttempt=${assetAttempt} narrativeAttempt=${narrativeAttempt} ${linuxFinalQuality.passed ? "PASS" : "FAIL"} assetScore=${linuxFinalQuality.interimAssetScore} finalScore=${linuxFinalQuality.finalProductionScore} finalNarrativeEvaluated=${linuxFinalQuality.coverage.finalNarrativeEvaluated} reason=${passBlockReason(linuxFinalQuality)} issues=${linuxFinalQuality.issues.length}`
          );

          if (!linuxFinalQuality.passed) {
            lastFinalFailure = linuxFinalQuality;
            lastFinalFailureHashes = candidate.linuxDeterministicHashes;
            logLinuxFinalQualityFailure({
              assetAttempt: linuxAssetCandidate.provenance.assetAttempt,
              narrativeAttempt,
              result: linuxFinalQuality,
              investigation: candidate.linuxInvestigation,
            });
            const classification = classifyFinalQualityFailure(linuxFinalQuality);
            if (classification === "programming_error") {
              throw new GenerationQualityError(
                "CyberLab Linux final validation configuration failed.",
                false,
                linuxFinalQuality,
                candidate.linuxDeterministicHashes
              );
            }
            if (classification === "asset_regeneration_required") {
              break;
            }
            feedback = correctionFeedback(linuxFinalQuality);
            continue;
          }
          if (candidate.validatedStudentNarrativeHash) {
            const currentHash = hashLinuxStudentNarrativeObject(candidate.labToInsert);
            if (currentHash !== candidate.validatedStudentNarrativeHash) {
              throw new GenerationQualityError(
                "LINUX_NARRATIVE_MUTATED_AFTER_VALIDATION: CyberLab Linux student narrative changed after final integrity validation.",
                false
              );
            }
          }

          if (aiQualityReviewEnabled) {
            const qualityReview = await reviewInvestigationQuality({
              category,
              difficulty,
              duration,
              model,
              lab: candidate.reviewLab,
              assets: candidate.selectedAssets,
              validatorSummary:
                "The generated Linux investigation completed deterministic asset validation and exact final narrative validation before optional AI quality review.",
            });
            candidate.qualityReview = qualityReview;
            console.info(
              `[CyberLab AI Quality] assetAttempt=${assetAttempt} narrativeAttempt=${narrativeAttempt} decision=${qualityReview.decision} score=${qualityReview.score}`
            );

            if (qualityReview.decision !== "PASS") {
              feedback = buildLinuxSafeRetryFeedback({ categories: ["ai_quality_readability"], scope: "ai_quality" });
              assertLinuxTaskGenerationViewIsModelSafe(feedback, "ai-quality retry feedback");
              continue;
            }
          }

          selectedCandidate = candidate;
          break;
        }
      }

      if (!selectedCandidate && lastFinalFailure) {
        console.warn(
          `[CyberLab Linux Final Quality] exhausted narrative retries finalScore=${lastFinalFailure.finalProductionScore} reason=${passBlockReason(lastFinalFailure)}`
        );
      }
      if (!selectedCandidate && !lastFinalFailure && lastNarrativeFailure) {
        console.warn(
          `[CyberLab Linux Narrative] exhausted narrative retries parseStatus=${lastNarrativeFailure.reason} rawLength=${lastNarrativeFailure.rawLength} details="${lastNarrativeFailure.details.slice(0, 180)}"`
        );
        throw new NarrativeGenerationError(lastNarrativeFailure, true);
      }
    }

    const finalCandidate = selectedCandidate;

    if (!finalCandidate) {
      throw new GenerationQualityError(
        "CyberLab could not prepare a consistent Linux investigation. Please retry.",
        true,
        lastFinalFailure || undefined,
        lastFinalFailureHashes
      );
    }

    const { labToInsert, selectedAssets, rawText, input } = finalCandidate;

    if (
      category === "Linux" &&
      finalCandidate.validatedFinalObject !== labToInsert
    ) {
      throw new Error(
        "CyberLab Linux final validation object did not match the object selected for saving."
      );
    }
    if (category === "Linux") {
      try {
        assertLinuxStudentNarrativeIntegrity(labToInsert);
        if (finalCandidate.validatedFinalObject) {
          assertLinuxNarrativeHashUnchanged({
            before: finalCandidate.validatedFinalObject,
            after: labToInsert,
            stage: "pre-save boundary",
          });
        }
        if (
          finalCandidate.validatedStudentNarrativeHash &&
          hashLinuxStudentNarrativeObject(labToInsert) !== finalCandidate.validatedStudentNarrativeHash
        ) {
          throw new Error("LINUX_NARRATIVE_MUTATED_AFTER_VALIDATION: validated hash does not match pre-save object.");
        }
        assertLinuxStudentContent({
          ...labToInsert,
          assets: selectedAssets,
        });
        assertLinuxStudentTaskSolvability({
          simulation: finalCandidate.linuxSimulation,
          finalAssets: selectedAssets,
          lab: finalNarrativeFromSavedLab(labToInsert),
        });
        assertLinuxIncidentCoverage({
          simulation: finalCandidate.linuxSimulation,
          finalAssets: selectedAssets,
          lab: finalNarrativeFromSavedLab(labToInsert),
        });
        assertLinuxTaskDiversity({
          simulation: finalCandidate.linuxSimulation,
          finalAssets: selectedAssets,
        });
        assertLinuxPreSaveWorkloadBoundary({
          context: finalCandidate.linuxInvestigation,
          assets: selectedAssets,
          simulation: finalCandidate.linuxSimulation,
          lab: finalNarrativeFromSavedLab(labToInsert),
          provenance: finalCandidate.linuxGenerationProvenance,
          deterministicHashes: finalCandidate.linuxDeterministicHashes,
        });
      } catch (error) {
        throw new GenerationQualityError(
          error instanceof Error ? error.message : "CyberLab Linux student content validation failed.",
          false
        );
      }
    }

    let acceptedDiversityHistory: NonNullable<LinuxGenerationProvenance["diversityHistory"]> = [];
    if (category === "Linux" && finalCandidate.linuxSimulation) {
      const history = await loadLinuxRecentAcceptedCases(supabaseAdmin, user.id, finalCandidate.linuxSimulation.investigation.incidentFamily);
      if (!checkLinuxRecentDiversity(finalCandidate.linuxSimulation, history).passed) {
        throw new GenerationQualityError("LINUX_DIVERSITY_HISTORY_CHANGED_BEFORE_SAVE", false);
      }
      acceptedDiversityHistory = history;
    }
    persistenceOutcome = "lab_insert_started";
    const { data: savedLab, error: labError } = await supabaseAdmin
      .from("labs")
      .insert(labToInsert)
      .select("*")
      .single();

    if (labError) {
      throw new LearnerSafeGenerationError("lab_persistence_failed", 500, SAFE_LINUX_GENERATION_FAILURE_MESSAGE, true);
    }
    persistenceOutcome = "lab_inserted";
    if (category === "Linux") {
      try {
        assertLinuxNarrativeHashUnchanged({
          before: labToInsert,
          after: savedLab as PreparedCandidate["labToInsert"],
          stage: "database write",
        });
      } catch (error) {
        throw new GenerationQualityError(
          error instanceof Error ? error.message : "LINUX_NARRATIVE_MUTATED_AFTER_VALIDATION: saved lab changed during persistence.",
          false
        );
      }
    }
    [
      ["title", labToInsert.title, savedLab?.title],
      ["topic", labToInsert.topic, savedLab?.topic],
      ["difficulty", labToInsert.difficulty, savedLab?.difficulty],
      ["estimated_time", labToInsert.estimated_time, savedLab?.estimated_time],
      ["objective", labToInsert.objective, savedLab?.objective],
      ["scenario", labToInsert.scenario, savedLab?.scenario],
      ["hints", labToInsert.hints, savedLab?.hints],
      ["outcomes", labToInsert.outcomes, savedLab?.outcomes],
      ["tasks", labToInsert.tasks, savedLab?.tasks],
    ].forEach(([field, before, after]) => {
      assertNoUnexpectedMutation({
        stage: "11 database write",
        field: String(field),
        before,
        after,
        allowed: false,
        functionName: "supabase.labs.insert",
        reason: "database-returned row must match selected final lab",
      });
    });

    persistenceOutcome = "asset_insert_started";
    const { error: assetError } = await supabaseAdmin.from("lab_assets").insert(
      selectedAssets.map((asset) => ({
        lab_id: savedLab.id,
        user_id: user.id,
        file_name: asset.file_name,
        file_type: asset.file_type,
        file_path: asset.file_path,
        content: asset.content,
      }))
    );

    if (assetError) {
      throw new LearnerSafeGenerationError("asset_persistence_failed", 500, SAFE_LINUX_GENERATION_FAILURE_MESSAGE, true);
    }
    persistenceOutcome = "assets_inserted";

    persistenceOutcome = "generated_lab_insert_started";
    const { data: generatedLab } = await supabaseAdmin
      .from("generated_labs")
      .insert({
        user_id: user.id,
        saved_lab_id: savedLab.id,
        source: "ai",
        title: labToInsert.title,
        category: labToInsert.topic,
        difficulty: labToInsert.difficulty,
        duration_minutes: Number.parseInt(labToInsert.estimated_time) || null,
        scenario: labToInsert.scenario,
        objectives: JSON.stringify([labToInsert.objective]),
        tasks: JSON.stringify(labToInsert.tasks),
        hints: JSON.stringify(labToInsert.hints),
        solution: null,
        commands: null,
        safety_note:
          "Use this asset pack only inside owned, isolated, or explicitly authorised lab environments.",
        learning_outcomes: JSON.stringify(labToInsert.outcomes),
        is_saved: true,
      })
      .select("id")
      .single();
    persistenceOutcome = generatedLab?.id ? "generated_lab_inserted" : "generated_lab_missing";

    if (generatedLab?.id) {
      await bindAiContentConsent({
        consentId,
        userId: user.id,
        labRequestId: generatedLab.id,
      });
    }

    if (
      category === "Linux" &&
      finalCandidate.linuxGenerationProvenance &&
      finalCandidate.linuxDeterministicHashes
    ) {
      persistenceOutcome = "provenance_insert_started";
      const provenance = {
        ...finalCandidate.linuxGenerationProvenance,
        incidentFamily: finalCandidate.linuxSimulation!.investigation.incidentFamily,
        diversityContractVersion: LINUX_STRUCTURAL_DIVERSITY_VERSION,
        structuralFingerprint: buildLinuxStructuralFingerprint(finalCandidate.linuxSimulation!),
        diversityHistory: acceptedDiversityHistory,
        attempt: {
          ...finalCandidate.linuxGenerationProvenance.attempt,
          narrativeAttempt: finalCandidate.linuxGenerationProvenance.attempt.narrativeAttempt ?? 1,
        },
      };
      const { error: provenanceError } = await supabaseAdmin
        .from("linux_generation_provenance")
        .insert(buildLinuxGenerationProvenanceRow({
          labId: savedLab.id,
          generatedLabId: generatedLab?.id || null,
          userId: user.id,
          provenance,
          deterministicHashes: finalCandidate.linuxDeterministicHashes,
        }));
      if (provenanceError) {
        throw new LearnerSafeGenerationError("generation_provenance_persistence_failed", 500, SAFE_LINUX_GENERATION_FAILURE_MESSAGE, true);
      }
      persistenceOutcome = "provenance_inserted";
    }

    await recordAIUsage({
      reservationId,
      userId: user.id,
      feature: "lab_generation",
      modelUsed: model,
      inputTokens: estimateTokens(systemPrompt + input),
      outputTokens: estimateTokens(rawText),
      estimatedCost: 0,
      generatedLabId: generatedLab?.id,
    });
    reservationId = undefined;
    usageReservationOutcome = "finalized";
    persistenceOutcome = "complete";

    return NextResponse.json({
      lab: savedLab,
      assets: selectedAssets.map((asset) => ({
        file_name: asset.file_name,
        file_type: asset.file_type,
        file_path: asset.file_path,
      })),
      usage: {
        plan: usage.plan,
        labGenerationsUsed: usage.labGenerationsUsed,
        labLimit: usage.labLimit,
      },
    });
  } catch (error) {
    const reservationWasActive = Boolean(reservationId);
    await releaseAIUsageReservation(reservationId);
    if (reservationWasActive) {
      usageReservationOutcome = "released";
    }
    console.error("[Amniora Generate Lab] safe failure", {
      requestId: diagnosticRequestId,
      category: requestCategory || "unknown",
      difficulty: requestDifficulty || "unknown",
      duration: requestDuration || "unknown",
      attempt: {
        assetAttempt: diagnosticAssetAttempt ?? null,
        narrativeAttempt: diagnosticNarrativeAttempt ?? null,
      },
      usageReservationOutcome,
      persistenceOutcome,
      ...safeGenerationDiagnostic(error),
    });

    if (error instanceof OpenAITimeoutError) {
      return NextResponse.json(
        safeGenerationFailurePayload("generation_timeout", SAFE_LINUX_GENERATION_FAILURE_MESSAGE, true),
        { status: 504 }
      );
    }

    if (error instanceof LinuxDiversityHistoryError) {
      return NextResponse.json(
        safeGenerationFailurePayload("generation_quality_failed", SAFE_LINUX_GENERATION_FAILURE_MESSAGE, false),
        { status: 422 }
      );
    }
    if (error instanceof GenerationQualityError) {
      return NextResponse.json(
        safeGenerationFailurePayload("generation_quality_failed", SAFE_LINUX_GENERATION_FAILURE_MESSAGE, error.retryable),
        { status: 422 }
      );
    }

    if (error instanceof NarrativeGenerationError) {
      return NextResponse.json(
        safeGenerationFailurePayload("narrative_generation_failed", SAFE_LINUX_GENERATION_FAILURE_MESSAGE, error.retryable),
        { status: 422 }
      );
    }

    if (error instanceof AiContentConsentError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 403 }
      );
    }

    if (error instanceof LearnerSafeGenerationError) {
      return NextResponse.json(
        safeGenerationFailurePayload(error.code, error.learnerMessage, error.retryable),
        { status: error.status }
      );
    }

    return NextResponse.json(
      safeGenerationFailurePayload("unexpected_generation_error", SAFE_LINUX_GENERATION_FAILURE_MESSAGE, true),
      { status: 500 }
    );
  }
}
