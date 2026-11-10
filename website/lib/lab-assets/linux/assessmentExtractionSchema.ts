import type {
  LinuxAssessmentClaimConfidence,
  LinuxAssessmentConclusionAssertionKind,
  LinuxAssessmentFindingTimeScope,
  LinuxAssessmentReasoningAssertionKind,
  LinuxAssessmentSubmission,
  LinuxAssessmentUncertaintyAssertionKind,
  LinuxExpectedAssessmentValue,
} from "./assessmentContract";

export const LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION = "linux-assessment-extraction-schema-v2-candidate-selection";
export const LINUX_ASSESSMENT_LEGACY_SPAN_EXTRACTION_SCHEMA_VERSION = "linux-assessment-extraction-schema-v1";

export type LinuxGradingFailureCode =
  | "LINUX_GRADING_AI_SCORE_ATTEMPT"
  | "LINUX_GRADING_SCHEMA_INVALID"
  | "LINUX_GRADING_UNKNOWN_FIELD"
  | "LINUX_GRADING_INTERNAL_ID_ATTEMPT"
  | "LINUX_GRADING_EVIDENCE_HALLUCINATION"
  | "LINUX_GRADING_EVIDENCE_TASK_INELIGIBLE"
  | "LINUX_GRADING_ANCHOR_HALLUCINATION"
  | "LINUX_GRADING_EXTRACTION_FAILED"
  | "LINUX_GRADING_OUTPUT_MUTATED"
  | "LINUX_GRADING_PROVENANCE_MISMATCH"
  | "LINUX_GRADING_ANSWER_KEY_EXPOSURE"
  | "LINUX_GRADING_INPUT_INVALID"
  | "LINUX_GRADING_UNSUPPORTED_CONTENT"
  | "LINUX_GRADING_AMBIGUOUS_EXTRACTION"
  | "LINUX_GRADING_UNGROUNDED_EXTRACTED_SPAN"
  | "LINUX_GRADING_UNKNOWN_CANDIDATE_ID"
  | "LINUX_GRADING_CANDIDATE_TYPE_MISMATCH"
  | "LINUX_GRADING_CANDIDATE_REGISTRY_MISMATCH"
  | "LINUX_GRADING_UNSUPPORTED_CANDIDATE_RELATIONSHIP"
  | "LINUX_GRADING_CANDIDATE_ID_RECOVERED_FROM_CLAUSE"
  | "LINUX_GRADING_UNKNOWN_OPTIONAL_ENTITY_ID"
  | "LINUX_GRADING_OPTIONAL_ENTITY_TYPE_MISMATCH"
  | "LINUX_GRADING_FACTUAL_RECONSTRUCTION_FAILED"
  | "LINUX_GRADING_AMBIGUOUS_CANDIDATE_MISSING_SELECTION"
  | "LINUX_GRADING_AMBIGUOUS_CANDIDATE_DUPLICATE_SELECTION"
  | "LINUX_GRADING_AMBIGUOUS_CANDIDATE_UNKNOWN_SELECTION"
  | "LINUX_GRADING_AMBIGUOUS_CANDIDATE_ROLE_INCOMPATIBLE"
  | "LINUX_GRADING_AMBIGUOUS_CANDIDATE_COVERAGE_INCOMPLETE"
  | "LINUX_GRADING_UNSUPPORTED_CERTAINTY";

export type LinuxGradingDiagnostic = {
  code: LinuxGradingFailureCode;
  severity: "critical" | "high" | "medium" | "low";
  field?: string;
  message: string;
};

export type LinuxAssessmentExtractionConfidence = "high" | "medium" | "low";

export type LinuxAtomicEntityKind =
  | "identity"
  | "process"
  | "file"
  | "service"
  | "cron"
  | "package"
  | "network"
  | "ssh_key"
  | "container"
  | "command"
  | "event"
  | "timestamp"
  | "state"
  | "unknown";

export type LinuxAtomicPredicate =
  | "authenticated"
  | "executed"
  | "created"
  | "modified"
  | "connected_to"
  | "owned_by"
  | "authorized_by"
  | "scheduled_by"
  | "loaded_by"
  | "installed_from"
  | "currently_active"
  | "historically_active"
  | "supports"
  | "contradicts"
  | "unknown";

export type LinuxClauseSelectionRole =
  | "finding"
  | "reasoning"
  | "uncertainty"
  | "remediation"
  | "conclusion"
  | "non_assessment";

export type LinuxExtractedAtomicEvidenceReference = {
  rawReference: string;
  locator?: string;
  quotedAnchor?: string;
  extractionConfidence?: LinuxAssessmentExtractionConfidence;
};

export type LinuxExtractedAtomicClaim = {
  claimSpan?: string | null;
  subjectSpan?: string | null;
  objectSpan?: string | null;
  valueSpan?: string | null;
  timestampSpan?: string | null;
  stateSpan?: string | null;
  reasoningSpan?: string | null;
  uncertaintySpan?: string | null;
  remediationSpan?: string | null;
  conclusionSpan?: string | null;
  subject?: { kind: LinuxAtomicEntityKind; text: string } | null;
  predicate?: LinuxAtomicPredicate;
  predicateLabel?: LinuxAtomicPredicate;
  object?: { kind: LinuxAtomicEntityKind | string; text: string } | null;
  valueText?: string | null;
  timestampText?: string | null;
  stateText?: string | null;
  confidence?: LinuxAssessmentClaimConfidence | null;
  evidenceReferences?: LinuxExtractedAtomicEvidenceReference[] | null;
  reasoningAssertions?: string[] | null;
  uncertaintyAssertions?: string[] | null;
  conclusionAssertions?: string[] | null;
  rawStatement?: string | null;
  extractionConfidence?: LinuxAssessmentExtractionConfidence | null;
};

export type LinuxCandidateClaimSelection = {
  clauseId: string;
  role?: LinuxClauseSelectionRole;
  subjectCandidateId?: string | null;
  primaryEntityCandidateId?: string | null;
  secondaryEntityCandidateId?: string | null;
  predicateLabel?: LinuxAtomicPredicate | null;
  objectCandidateId?: string | null;
  valueCandidateId?: string | null;
  timestampCandidateId?: string | null;
  stateCandidateId?: string | null;
  evidenceReferenceIds?: string[];
  reasoningClauseIds?: string[];
  uncertaintyCandidateIds?: string[];
  remediationCandidateIds?: string[];
  conclusionCandidateIds?: string[];
  confidence?: LinuxAssessmentClaimConfidence | null;
  extractionConfidence?: LinuxAssessmentExtractionConfidence | null;
};

export type LinuxExtractedEvidenceCitation = {
  path: string;
  anchors?: string[];
  locator?: string;
  rawReference?: string;
  extractionConfidence?: LinuxAssessmentExtractionConfidence;
};

export type LinuxExtractedReasoning = {
  assertions: Array<{
    kind: LinuxAssessmentReasoningAssertionKind;
    evidencePaths?: string[];
    subjectIds?: string[];
    extractionConfidence?: LinuxAssessmentExtractionConfidence;
  }>;
};

export type LinuxExtractedClaim = {
  value: LinuxExpectedAssessmentValue;
  relationship?: { relation: string; sourceId?: string; targetId?: string };
  timeScope?: LinuxAssessmentFindingTimeScope;
  evidence?: LinuxExtractedEvidenceCitation[];
  confidence?: LinuxAssessmentClaimConfidence;
  reasoning?: LinuxExtractedReasoning;
  conclusions?: Array<{
    kind: LinuxAssessmentConclusionAssertionKind;
    confidence: LinuxAssessmentClaimConfidence;
    subjectId?: string;
    extractionConfidence?: LinuxAssessmentExtractionConfidence;
  }>;
  rawStatement?: string;
  extractionConfidence?: LinuxAssessmentExtractionConfidence;
};

export type LinuxAssessmentExtraction = {
  version: typeof LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION | typeof LINUX_ASSESSMENT_LEGACY_SPAN_EXTRACTION_SCHEMA_VERSION;
  taskId: string;
  candidateRegistryHash?: string | null;
  candidateSelections?: LinuxCandidateClaimSelection[] | null;
  atomicClaims?: LinuxExtractedAtomicClaim[];
  claims?: LinuxExtractedClaim[];
  uncertaintyAssertions?: Array<{
    kind: LinuxAssessmentUncertaintyAssertionKind;
    subjectId?: string;
    confidence: Extract<LinuxAssessmentClaimConfidence, "supported" | "candidate">;
    rawStatement?: string;
    extractionConfidence?: LinuxAssessmentExtractionConfidence;
  }>;
  remediationActions?: Array<{
    action: string;
    rawStatement?: string;
    extractionConfidence?: LinuxAssessmentExtractionConfidence;
  }>;
  unparsedStatements?: string[];
};

export type LinuxAssessmentExtractionParseResult =
  | { ok: true; extraction: LinuxAssessmentExtraction; diagnostics: LinuxGradingDiagnostic[] }
  | { ok: false; diagnostics: LinuxGradingDiagnostic[] };

const TOP_LEVEL_KEYS = new Set(["version", "taskId", "candidateRegistryHash", "candidateSelections", "atomicClaims", "claims", "uncertaintyAssertions", "remediationActions", "unparsedStatements"]);
const CANDIDATE_SELECTION_KEYS = new Set(["clauseId", "role", "subjectCandidateId", "primaryEntityCandidateId", "secondaryEntityCandidateId", "predicateLabel", "objectCandidateId", "valueCandidateId", "timestampCandidateId", "stateCandidateId", "evidenceReferenceIds", "reasoningClauseIds", "uncertaintyCandidateIds", "remediationCandidateIds", "conclusionCandidateIds", "confidence", "extractionConfidence"]);
const ATOMIC_CLAIM_KEYS = new Set(["claimSpan", "subjectSpan", "predicate", "predicateLabel", "objectSpan", "valueSpan", "timestampSpan", "stateSpan", "reasoningSpan", "uncertaintySpan", "remediationSpan", "conclusionSpan", "subject", "object", "valueText", "timestampText", "stateText", "confidence", "evidenceReferences", "reasoningAssertions", "uncertaintyAssertions", "conclusionAssertions", "rawStatement", "extractionConfidence"]);
const ATOMIC_ENTITY_KEYS = new Set(["kind", "text"]);
const ATOMIC_EVIDENCE_KEYS = new Set(["rawReference", "locator", "quotedAnchor", "extractionConfidence"]);
const CLAIM_KEYS = new Set(["value", "relationship", "timeScope", "evidence", "confidence", "reasoning", "conclusions", "rawStatement", "extractionConfidence"]);
const EVIDENCE_KEYS = new Set(["path", "anchors", "locator", "rawReference", "extractionConfidence"]);
const REASONING_KEYS = new Set(["assertions"]);
const REASONING_ASSERTION_KEYS = new Set(["kind", "evidencePaths", "subjectIds", "extractionConfidence"]);
const UNCERTAINTY_KEYS = new Set(["kind", "subjectId", "confidence", "rawStatement", "extractionConfidence"]);
const REMEDIATION_KEYS = new Set(["action", "rawStatement", "extractionConfidence"]);
const CONCLUSION_KEYS = new Set(["kind", "confidence", "subjectId", "extractionConfidence"]);
const RELATIONSHIP_KEYS = new Set(["relation", "sourceId", "targetId"]);

const VALUE_KEYS: Record<LinuxExpectedAssessmentValue["kind"], Set<string>> = {
  identity: new Set(["kind", "identityId", "username", "uid"]),
  network: new Set(["kind", "sourceIp", "destinationIp", "sourcePort", "destinationPort", "protocol"]),
  ssh_key: new Set(["kind", "fingerprint", "accountId"]),
  command: new Set(["kind", "commandId", "executable", "argv", "normalizedCommand"]),
  process: new Set(["kind", "processId", "pid", "parentPid", "executable", "userId"]),
  file: new Set(["kind", "fileId", "path", "owner", "mode", "state"]),
  service: new Set(["kind", "serviceId", "unit", "activeState", "enabledState", "result"]),
  cron: new Set(["kind", "cronId", "schedule", "runAs", "command", "currentState"]),
  package: new Set(["kind", "transactionId", "name", "version", "action", "repository"]),
  container: new Set(["kind", "containerId", "image", "mount", "runtimeState"]),
  timestamp: new Set(["kind", "timestamp", "timezone", "eventId"]),
  relationship: new Set(["kind", "relation", "sourceId", "targetId"]),
  state: new Set(["kind", "objectId", "value", "timeScope"]),
  sequence: new Set(["kind", "orderedEventIds"]),
};

const VALUE_KINDS = new Set(Object.keys(VALUE_KEYS));
const ATOMIC_ENTITY_KINDS = new Set(["identity", "process", "file", "service", "cron", "package", "network", "ssh_key", "container", "command", "event", "timestamp", "state", "unknown"]);
const ATOMIC_PREDICATES = new Set(["authenticated", "executed", "created", "modified", "connected_to", "owned_by", "authorized_by", "scheduled_by", "loaded_by", "installed_from", "currently_active", "historically_active", "supports", "contradicts", "unknown"]);
const CLAUSE_SELECTION_ROLES = new Set(["finding", "reasoning", "uncertainty", "remediation", "conclusion", "non_assessment"]);
const CONFIDENCE = new Set(["observed", "supported", "candidate", "certain"]);
const UNCERTAINTY_CONFIDENCE = new Set(["supported", "candidate"]);
const EXTRACTION_CONFIDENCE = new Set(["high", "medium", "low"]);
const TIME_SCOPES = new Set(["incident_window", "collection_snapshot", "historical_reconstruction", "static_policy"]);
const REASONING_KINDS = new Set([
  "relationship_supported_by_evidence",
  "sources_corroborate_conclusion",
  "current_state_differs_from_historical",
  "attribution_limited",
  "intent_not_proven",
  "transfer_not_confirmed",
  "timestamp_order_supports_sequence",
  "configuration_state_supports_remediation",
]);
const UNCERTAINTY_KINDS = new Set([
  "limit_attribution",
  "intent_not_proven",
  "transfer_not_confirmed",
  "historical_not_current",
  "execution_not_confirmed",
  "scope_incomplete",
]);
const CONCLUSION_KINDS = new Set([
  "malicious_intent",
  "exact_ssh_key",
  "data_exfiltration",
  "human_operator",
  "historical_transition_from_current",
  "repository_compromise",
  "full_host_compromise",
  "deleted_content_known",
]);

const FORBIDDEN_TOP_LEVEL = new Set([
  "score",
  "points",
  "pass",
  "passed",
  "fail",
  "failed",
  "grade",
  "rubric",
  "rubricWeights",
  "expectedAnswer",
  "answerKey",
  "findingId",
  "findingIds",
  "internalFindingId",
  "uncertaintyId",
  "uncertaintyIds",
  "contradictionId",
  "contradictionIds",
  "assessmentContractHash",
  "assessmentQualityHash",
  "canonicalAnswerId",
]);

const INTERNAL_ID_PATTERN = /\b(?:finding|uncertainty|contradiction|assessment|canonical|rubric):[A-Za-z0-9_.:-]+\b|\bassessment(?:Contract|Quality)?Hash\b/i;

function diagnostic(code: LinuxGradingFailureCode, field: string | undefined, message: string, severity: LinuxGradingDiagnostic["severity"] = "critical"): LinuxGradingDiagnostic {
  return { code, severity, field, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function unknownKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function optionalString(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}

function optionalNumber(value: unknown) {
  return value === undefined || value === null || typeof value === "number";
}

function validateExtractionConfidence(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && EXTRACTION_CONFIDENCE.has(value));
}

function stripNullOptionalFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNullOptionalFields);
  }
  if (!isRecord(value)) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null) continue;
    output[key] = stripNullOptionalFields(raw);
  }
  return output;
}

function validateValue(value: unknown, field: string, issues: LinuxGradingDiagnostic[]) {
  if (!isRecord(value)) {
    issues.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, "Claim value must be an object."));
    return false;
  }
  if (typeof value.kind !== "string" || !VALUE_KINDS.has(value.kind)) {
    issues.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.kind`, "Claim value has an unsupported kind."));
    return false;
  }
  const allowed = VALUE_KEYS[value.kind as LinuxExpectedAssessmentValue["kind"]];
  const extra = unknownKeys(value, allowed);
  if (extra.length) issues.push(diagnostic("LINUX_GRADING_UNKNOWN_FIELD", field, `Unknown value fields: ${extra.join(", ")}.`));
  const kind = value.kind as LinuxExpectedAssessmentValue["kind"];
  const checks: boolean[] = [];
  if (kind === "identity") checks.push(typeof value.identityId === "string" || typeof value.username === "string");
  if (kind === "network") checks.push(optionalString(value.sourceIp), optionalString(value.destinationIp), optionalNumber(value.sourcePort), optionalNumber(value.destinationPort), optionalString(value.protocol));
  if (kind === "ssh_key") checks.push(typeof value.fingerprint === "string");
  if (kind === "command") checks.push(typeof value.executable === "string", value.argv === undefined || stringArray(value.argv), optionalString(value.normalizedCommand), optionalString(value.commandId));
  if (kind === "process") checks.push(optionalString(value.processId), optionalNumber(value.pid), optionalNumber(value.parentPid), optionalString(value.executable), optionalString(value.userId));
  if (kind === "file") checks.push(typeof value.path === "string", optionalString(value.fileId), optionalString(value.owner), optionalString(value.mode), optionalString(value.state));
  if (kind === "service") checks.push(typeof value.unit === "string", optionalString(value.serviceId), optionalString(value.activeState), optionalString(value.enabledState), optionalString(value.result));
  if (kind === "cron") checks.push(optionalString(value.cronId), optionalString(value.schedule), optionalString(value.runAs), optionalString(value.command), optionalString(value.currentState));
  if (kind === "package") checks.push(typeof value.name === "string", optionalString(value.transactionId), optionalString(value.version), optionalString(value.action), optionalString(value.repository));
  if (kind === "container") checks.push(optionalString(value.containerId), optionalString(value.image), optionalString(value.mount), optionalString(value.runtimeState));
  if (kind === "timestamp") checks.push(typeof value.timestamp === "string", optionalString(value.timezone), optionalString(value.eventId));
  if (kind === "relationship") checks.push(typeof value.relation === "string", typeof value.sourceId === "string", typeof value.targetId === "string");
  if (kind === "state") checks.push(typeof value.objectId === "string", typeof value.value === "string", typeof value.timeScope === "string" && TIME_SCOPES.has(value.timeScope));
  if (kind === "sequence") checks.push(Array.isArray(value.orderedEventIds) && value.orderedEventIds.every((item) => typeof item === "string"));
  if (checks.some((item) => !item)) {
    issues.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, `Claim value ${kind} is malformed.`));
    return false;
  }
  return extra.length === 0;
}

function validateStringList(value: unknown, field: string, issues: LinuxGradingDiagnostic[]) {
  if (value === undefined) return true;
  if (!stringArray(value)) {
    issues.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, "Expected a string array."));
    return false;
  }
  return true;
}

function validateAtomicEntity(value: unknown, field: string, issues: LinuxGradingDiagnostic[]) {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) {
    issues.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, "Atomic entity must be an object or null."));
    return false;
  }
  for (const key of unknownKeys(value, ATOMIC_ENTITY_KEYS)) issues.push(diagnostic("LINUX_GRADING_UNKNOWN_FIELD", `${field}.${key}`, `Unknown atomic entity field: ${key}.`));
  if (typeof value.kind !== "string" || !ATOMIC_ENTITY_KINDS.has(value.kind)) issues.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.kind`, "Unsupported atomic entity kind."));
  if (typeof value.text !== "string") issues.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.text`, "Atomic entity text is required."));
  if (typeof value.text === "string" && INTERNAL_ID_PATTERN.test(value.text)) issues.push(diagnostic("LINUX_GRADING_INTERNAL_ID_ATTEMPT", `${field}.text`, "Atomic entity text includes internal-looking identifiers."));
  return true;
}

export function validateLinuxAssessmentExtraction(value: unknown): LinuxAssessmentExtractionParseResult {
  const diagnostics: LinuxGradingDiagnostic[] = [];
  value = stripNullOptionalFields(value);
  if (!isRecord(value)) return { ok: false, diagnostics: [diagnostic("LINUX_GRADING_SCHEMA_INVALID", undefined, "Extraction must be a JSON object.")] };

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_TOP_LEVEL.has(key)) diagnostics.push(diagnostic(key.includes("score") || key.includes("point") || key === "grade" ? "LINUX_GRADING_AI_SCORE_ATTEMPT" : "LINUX_GRADING_UNKNOWN_FIELD", key, `Forbidden or unknown top-level field: ${key}.`));
  }
  const extraTop = unknownKeys(value, TOP_LEVEL_KEYS).filter((key) => !FORBIDDEN_TOP_LEVEL.has(key));
  for (const key of extraTop) diagnostics.push(diagnostic("LINUX_GRADING_UNKNOWN_FIELD", key, `Unknown top-level field: ${key}.`));

  if (value.version !== LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION && value.version !== LINUX_ASSESSMENT_LEGACY_SPAN_EXTRACTION_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", "version", "Extraction schema version is missing or unsupported."));
  }
  if (typeof value.taskId !== "string" || value.taskId.trim() === "") {
    diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", "taskId", "taskId is required."));
  }
  if (!optionalString(value.candidateRegistryHash)) {
    diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", "candidateRegistryHash", "candidateRegistryHash must be a string or null."));
  }

  if (value.candidateSelections !== undefined && value.candidateSelections !== null) {
    if (!Array.isArray(value.candidateSelections)) {
      diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", "candidateSelections", "candidateSelections must be an array or null."));
    } else {
      value.candidateSelections.forEach((selection, index) => {
        const field = `candidateSelections[${index}]`;
        if (!isRecord(selection)) {
          diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, "Candidate selection must be an object."));
          return;
        }
        for (const key of unknownKeys(selection, CANDIDATE_SELECTION_KEYS)) {
          diagnostics.push(diagnostic(/score|rubric|finding|canonical|assessment/i.test(key) ? "LINUX_GRADING_INTERNAL_ID_ATTEMPT" : "LINUX_GRADING_UNKNOWN_FIELD", `${field}.${key}`, `Unknown candidate selection field: ${key}.`));
        }
        if (typeof selection.clauseId !== "string" || selection.clauseId.trim() === "") diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.clauseId`, "clauseId is required."));
        if (selection.role !== undefined && (typeof selection.role !== "string" || !CLAUSE_SELECTION_ROLES.has(selection.role))) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.role`, "Unsupported clause selection role."));
        if (selection.predicateLabel !== undefined && selection.predicateLabel !== null && (typeof selection.predicateLabel !== "string" || !ATOMIC_PREDICATES.has(selection.predicateLabel))) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.predicateLabel`, "Unsupported predicate label."));
        for (const key of ["subjectCandidateId", "primaryEntityCandidateId", "secondaryEntityCandidateId", "objectCandidateId", "valueCandidateId", "timestampCandidateId", "stateCandidateId"] as const) {
          if (!optionalString(selection[key])) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.${key}`, `${key} must be a string or null.`));
          if (typeof selection[key] === "string" && INTERNAL_ID_PATTERN.test(selection[key] as string)) diagnostics.push(diagnostic("LINUX_GRADING_INTERNAL_ID_ATTEMPT", `${field}.${key}`, `${key} includes internal-looking identifiers.`));
        }
        for (const key of ["evidenceReferenceIds", "reasoningClauseIds", "uncertaintyCandidateIds", "remediationCandidateIds", "conclusionCandidateIds"] as const) {
          validateStringList(selection[key], `${field}.${key}`, diagnostics);
          if (Array.isArray(selection[key])) {
            for (const [itemIndex, item] of (selection[key] as string[]).entries()) {
              if (INTERNAL_ID_PATTERN.test(item)) diagnostics.push(diagnostic("LINUX_GRADING_INTERNAL_ID_ATTEMPT", `${field}.${key}[${itemIndex}]`, `${key} includes internal-looking identifiers.`));
            }
          }
        }
        if (selection.confidence !== undefined && selection.confidence !== null && (typeof selection.confidence !== "string" || !CONFIDENCE.has(selection.confidence))) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.confidence`, "Unsupported confidence."));
        if (!validateExtractionConfidence(selection.extractionConfidence)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.extractionConfidence`, "Unsupported extraction confidence."));
      });
    }
  }

  if (value.atomicClaims !== undefined) {
    if (!Array.isArray(value.atomicClaims)) {
      diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", "atomicClaims", "atomicClaims must be an array."));
    } else {
      value.atomicClaims.forEach((claim, index) => {
        const field = `atomicClaims[${index}]`;
        if (!isRecord(claim)) {
          diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, "Atomic claim must be an object."));
          return;
        }
        for (const key of unknownKeys(claim, ATOMIC_CLAIM_KEYS)) diagnostics.push(diagnostic(/Id$|finding|rubric|score/i.test(key) ? "LINUX_GRADING_INTERNAL_ID_ATTEMPT" : "LINUX_GRADING_UNKNOWN_FIELD", `${field}.${key}`, `Unknown atomic claim field: ${key}.`));
        validateAtomicEntity(claim.subject, `${field}.subject`, diagnostics);
        validateAtomicEntity(claim.object, `${field}.object`, diagnostics);
        const predicate = claim.predicateLabel || claim.predicate;
        if (typeof predicate !== "string" || !ATOMIC_PREDICATES.has(predicate)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.predicateLabel`, "Unsupported atomic predicate."));
        for (const optional of ["claimSpan", "subjectSpan", "objectSpan", "valueSpan", "timestampSpan", "stateSpan", "reasoningSpan", "uncertaintySpan", "remediationSpan", "conclusionSpan", "valueText", "timestampText", "stateText", "rawStatement"]) {
          if (!optionalString(claim[optional])) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.${optional}`, `${optional} must be a string or null.`));
          if (typeof claim[optional] === "string" && INTERNAL_ID_PATTERN.test(claim[optional] as string)) diagnostics.push(diagnostic("LINUX_GRADING_INTERNAL_ID_ATTEMPT", `${field}.${optional}`, `${optional} includes internal-looking identifiers.`));
        }
        if (claim.confidence !== undefined && claim.confidence !== null && (typeof claim.confidence !== "string" || !CONFIDENCE.has(claim.confidence))) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.confidence`, "Unsupported confidence."));
        if (!validateExtractionConfidence(claim.extractionConfidence)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.extractionConfidence`, "Unsupported extraction confidence."));
        validateStringList(claim.reasoningAssertions, `${field}.reasoningAssertions`, diagnostics);
        validateStringList(claim.uncertaintyAssertions, `${field}.uncertaintyAssertions`, diagnostics);
        validateStringList(claim.conclusionAssertions, `${field}.conclusionAssertions`, diagnostics);
        if (claim.evidenceReferences !== undefined && claim.evidenceReferences !== null) {
          if (!Array.isArray(claim.evidenceReferences)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.evidenceReferences`, "evidenceReferences must be an array or null."));
          else claim.evidenceReferences.forEach((reference, referenceIndex) => {
            const referenceField = `${field}.evidenceReferences[${referenceIndex}]`;
            if (!isRecord(reference)) {
              diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", referenceField, "Evidence reference must be an object."));
              return;
            }
            for (const key of unknownKeys(reference, ATOMIC_EVIDENCE_KEYS)) diagnostics.push(diagnostic("LINUX_GRADING_UNKNOWN_FIELD", `${referenceField}.${key}`, `Unknown evidence reference field: ${key}.`));
            if (typeof reference.rawReference !== "string") diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${referenceField}.rawReference`, "rawReference is required."));
            if (!optionalString(reference.locator) || !optionalString(reference.quotedAnchor) || !validateExtractionConfidence(reference.extractionConfidence)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", referenceField, "Evidence reference contains malformed optional fields."));
          });
        }
      });
    }
  }

  if (value.claims !== undefined) {
    if (!Array.isArray(value.claims)) {
      diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", "claims", "claims must be an array."));
    } else {
      value.claims.forEach((claim, index) => {
        const field = `claims[${index}]`;
        if (!isRecord(claim)) {
          diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, "Claim must be an object."));
          return;
        }
        for (const key of unknownKeys(claim, CLAIM_KEYS)) {
          diagnostics.push(diagnostic(key === "findingId" || /Id$/.test(key) ? "LINUX_GRADING_INTERNAL_ID_ATTEMPT" : "LINUX_GRADING_UNKNOWN_FIELD", `${field}.${key}`, `Unknown claim field: ${key}.`));
        }
        validateValue(claim.value, `${field}.value`, diagnostics);
        if (claim.relationship !== undefined) {
          if (!isRecord(claim.relationship)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.relationship`, "Relationship must be an object."));
          else {
            for (const key of unknownKeys(claim.relationship, RELATIONSHIP_KEYS)) diagnostics.push(diagnostic("LINUX_GRADING_UNKNOWN_FIELD", `${field}.relationship.${key}`, `Unknown relationship field: ${key}.`));
            if (typeof claim.relationship.relation !== "string") diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.relationship.relation`, "Relationship relation is required."));
          }
        }
        if (claim.timeScope !== undefined && (typeof claim.timeScope !== "string" || !TIME_SCOPES.has(claim.timeScope))) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.timeScope`, "Unsupported time scope."));
        if (claim.confidence !== undefined && (typeof claim.confidence !== "string" || !CONFIDENCE.has(claim.confidence))) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.confidence`, "Unsupported confidence."));
        if (!validateExtractionConfidence(claim.extractionConfidence)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.extractionConfidence`, "Unsupported extraction confidence."));
        if (!optionalString(claim.rawStatement)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.rawStatement`, "rawStatement must be a string."));
        if (typeof claim.rawStatement === "string" && INTERNAL_ID_PATTERN.test(claim.rawStatement)) diagnostics.push(diagnostic("LINUX_GRADING_INTERNAL_ID_ATTEMPT", `${field}.rawStatement`, "Claim includes internal-looking identifiers."));
        if (claim.evidence !== undefined) {
          if (!Array.isArray(claim.evidence)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.evidence`, "evidence must be an array."));
          else claim.evidence.forEach((citation, citationIndex) => {
            const citationField = `${field}.evidence[${citationIndex}]`;
            if (!isRecord(citation)) {
              diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", citationField, "Evidence citation must be an object."));
              return;
            }
            for (const key of unknownKeys(citation, EVIDENCE_KEYS)) diagnostics.push(diagnostic(key === "anchorKinds" ? "LINUX_GRADING_UNKNOWN_FIELD" : "LINUX_GRADING_UNKNOWN_FIELD", `${citationField}.${key}`, `Unknown evidence field: ${key}.`));
            if (typeof citation.path !== "string") diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${citationField}.path`, "Evidence path is required."));
            validateStringList(citation.anchors, `${citationField}.anchors`, diagnostics);
            if (!optionalString(citation.locator) || !optionalString(citation.rawReference) || !validateExtractionConfidence(citation.extractionConfidence)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", citationField, "Evidence citation contains malformed optional fields."));
          });
        }
        if (claim.reasoning !== undefined) {
          if (!isRecord(claim.reasoning)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.reasoning`, "reasoning must be a structured object."));
          else {
            for (const key of unknownKeys(claim.reasoning, REASONING_KEYS)) diagnostics.push(diagnostic("LINUX_GRADING_UNKNOWN_FIELD", `${field}.reasoning.${key}`, `Unknown reasoning field: ${key}.`));
            if (!Array.isArray(claim.reasoning.assertions)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.reasoning.assertions`, "reasoning.assertions must be an array."));
            else claim.reasoning.assertions.forEach((assertion, assertionIndex) => {
              const assertionField = `${field}.reasoning.assertions[${assertionIndex}]`;
              if (!isRecord(assertion)) {
                diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", assertionField, "Reasoning assertion must be an object."));
                return;
              }
              for (const key of unknownKeys(assertion, REASONING_ASSERTION_KEYS)) diagnostics.push(diagnostic("LINUX_GRADING_UNKNOWN_FIELD", `${assertionField}.${key}`, `Unknown reasoning assertion field: ${key}.`));
              if (typeof assertion.kind !== "string" || !REASONING_KINDS.has(assertion.kind)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${assertionField}.kind`, "Unsupported reasoning assertion kind."));
              validateStringList(assertion.evidencePaths, `${assertionField}.evidencePaths`, diagnostics);
              validateStringList(assertion.subjectIds, `${assertionField}.subjectIds`, diagnostics);
            });
          }
        }
        if (claim.conclusions !== undefined) {
          if (!Array.isArray(claim.conclusions)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.conclusions`, "conclusions must be an array."));
          else claim.conclusions.forEach((conclusion, conclusionIndex) => {
            const conclusionField = `${field}.conclusions[${conclusionIndex}]`;
            if (!isRecord(conclusion)) {
              diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", conclusionField, "Conclusion must be an object."));
              return;
            }
            for (const key of unknownKeys(conclusion, CONCLUSION_KEYS)) diagnostics.push(diagnostic("LINUX_GRADING_UNKNOWN_FIELD", `${conclusionField}.${key}`, `Unknown conclusion field: ${key}.`));
            if (typeof conclusion.kind !== "string" || !CONCLUSION_KINDS.has(conclusion.kind)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${conclusionField}.kind`, "Unsupported conclusion kind."));
            if (typeof conclusion.confidence !== "string" || !CONFIDENCE.has(conclusion.confidence)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${conclusionField}.confidence`, "Unsupported conclusion confidence."));
          });
        }
      });
    }
  }

  if (value.uncertaintyAssertions !== undefined) {
    if (!Array.isArray(value.uncertaintyAssertions)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", "uncertaintyAssertions", "uncertaintyAssertions must be an array."));
    else value.uncertaintyAssertions.forEach((assertion, index) => {
      const field = `uncertaintyAssertions[${index}]`;
      if (!isRecord(assertion)) {
        diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, "Uncertainty assertion must be an object."));
        return;
      }
      for (const key of unknownKeys(assertion, UNCERTAINTY_KEYS)) diagnostics.push(diagnostic(key === "id" || /Id$/.test(key) ? "LINUX_GRADING_INTERNAL_ID_ATTEMPT" : "LINUX_GRADING_UNKNOWN_FIELD", `${field}.${key}`, `Unknown uncertainty field: ${key}.`));
      if (typeof assertion.kind !== "string" || !UNCERTAINTY_KINDS.has(assertion.kind)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.kind`, "Unsupported uncertainty assertion kind."));
      if (typeof assertion.confidence !== "string" || !UNCERTAINTY_CONFIDENCE.has(assertion.confidence)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.confidence`, "Unsupported uncertainty confidence."));
      if (!optionalString(assertion.subjectId) || !optionalString(assertion.rawStatement) || !validateExtractionConfidence(assertion.extractionConfidence)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, "Uncertainty assertion contains malformed optional fields."));
    });
  }

  if (value.remediationActions !== undefined) {
    if (!Array.isArray(value.remediationActions)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", "remediationActions", "remediationActions must be an array."));
    else value.remediationActions.forEach((action, index) => {
      const field = `remediationActions[${index}]`;
      if (!isRecord(action)) {
        diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, "Remediation action must be an object."));
        return;
      }
      for (const key of unknownKeys(action, REMEDIATION_KEYS)) diagnostics.push(diagnostic("LINUX_GRADING_UNKNOWN_FIELD", `${field}.${key}`, `Unknown remediation field: ${key}.`));
      if (typeof action.action !== "string") diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", `${field}.action`, "Remediation action is required."));
      if (!optionalString(action.rawStatement) || !validateExtractionConfidence(action.extractionConfidence)) diagnostics.push(diagnostic("LINUX_GRADING_SCHEMA_INVALID", field, "Remediation action contains malformed optional fields."));
    });
  }

  validateStringList(value.unparsedStatements, "unparsedStatements", diagnostics);

  if (diagnostics.some((item) => item.severity === "critical")) return { ok: false, diagnostics };
  return { ok: true, extraction: value as LinuxAssessmentExtraction, diagnostics };
}

export function parseLinuxAssessmentExtractionJson(raw: string): LinuxAssessmentExtractionParseResult {
  try {
    return validateLinuxAssessmentExtraction(JSON.parse(raw));
  } catch {
    return { ok: false, diagnostics: [diagnostic("LINUX_GRADING_SCHEMA_INVALID", undefined, "Extraction response is not valid JSON.")] };
  }
}

export function extractionToSubmission(extraction: LinuxAssessmentExtraction): LinuxAssessmentSubmission {
  return {
    taskId: extraction.taskId,
    claims: extraction.claims?.map((claim) => ({
      value: claim.value,
      relationship: claim.relationship,
      timeScope: claim.timeScope,
      evidence: claim.evidence?.map((citation) => ({
        path: citation.path,
        anchors: citation.anchors,
        locator: citation.locator,
      })),
      confidence: claim.confidence,
      reasoning: claim.reasoning,
      conclusions: claim.conclusions?.map((conclusion) => ({
        kind: conclusion.kind,
        confidence: conclusion.confidence,
        subjectId: conclusion.subjectId,
      })),
    })),
    uncertaintyAssertions: extraction.uncertaintyAssertions?.map((assertion) => ({
      kind: assertion.kind,
      subjectId: assertion.subjectId,
      confidence: assertion.confidence,
    })),
    remediationActions: extraction.remediationActions?.map((action) => action.action),
  };
}
