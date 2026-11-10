import { createHash } from "crypto";
import { normalizeLinuxEvidencePath } from "./difficultyProfile";
import {
  linuxNarrativeStructureDiagnostic,
  validateLinuxNarrativeTextIntegrity,
  type LinuxNarrativeIntegrityCode,
  type LinuxNarrativeStructureDiagnostic,
  type LinuxNarrativeTextKind,
} from "./narrativeIntegrity";
import {
  buildLinuxSafeRetryFeedback,
  linuxRetryFeedbackCategoriesFromNarrativeIssueCodes,
  type LinuxSafeRetryFeedbackCategory,
} from "./narrativeRetryFeedback";
import type {
  CanonicalEvidenceCapability,
  LinuxNarrativeClaimClass,
  LinuxNarrativeContract,
  LinuxNarrativeRelationshipContract,
  LinuxNarrativeTaskContract,
} from "./simulation";

export type LinuxTaskGenerationEvidence = {
  path: string;
  description: string;
};

export type LinuxTaskGenerationSubject = {
  index: number;
  display: string;
  type: string;
};

export type LinuxTaskGenerationRelationship = {
  index: number;
  learnerStatement: string;
  allowedClaimClass: LinuxNarrativeClaimClass;
  canonicalRelationshipId: string;
  relation: string;
  subjectIds: string[];
};

export type LinuxTaskGenerationTimestamp = {
  index: number;
  exactDisplayValue: string;
  learnerContext: string;
  allowedClaimClasses: LinuxNarrativeClaimClass[];
};

export type LinuxTaskGenerationView = {
  taskNumber: number;
  learnerIntent: string;
  learnerObjective: string;
  learnerInstruction: string;
  studentReadableContext: {
    subjects: string[];
    relationships: string[];
    timestamps: string[];
  };
  allowedEvidence: LinuxTaskGenerationEvidence[];
  allowedSubjects: LinuxTaskGenerationSubject[];
  allowedRelationshipStatements: Array<{
    index: number;
    learnerStatement: string;
    allowedClaimClass: LinuxNarrativeClaimClass;
  }>;
  allowedTimestamps: LinuxTaskGenerationTimestamp[];
  allowedTimestampStatements: string[];
  allowedCurrentStateStatements: string[];
  allowedHistoricalStatements: string[];
  allowedRecommendationStatements: string[];
  allowedCapabilityDescriptions: string[];
  prohibitedTopics: string[];
  outputRequirements: string[];
};

export type LinuxGeneratedTaskFromView = {
  task_number?: number;
  learner_intent?: string;
  phase: string;
  title: string;
  evidence: string[];
  deliverable: string;
  claims?: Array<{
    claim_class?: LinuxNarrativeClaimClass | string;
    text?: string;
    supporting_evidence?: string[];
    subject_indexes?: number[];
    relationship_statement_indexes?: number[];
    timestamp_indexes?: number[];
    timestamps?: string[];
  }>;
};

export type LinuxGenerationViewScanIssue = {
  category:
    | "canonical_id"
    | "relationship_key"
    | "capability_key"
    | "validator_issue_code"
    | "contract_field"
    | "closure_metadata"
    | "unapproved_absolute_path"
    | "local_path"
    | "source_path";
  token: string;
  source: string;
  field?: string;
  value?: string;
  provenance?: string;
  rule?: string;
};

export type LinuxTaskAtomicFieldIssue = {
  code: LinuxNarrativeIntegrityCode | "LINUX_NARRATIVE_MODEL_MARKDOWN_STRUCTURE";
  field: string;
  taskIndex: number | null;
  failureCategory:
    | "incomplete"
    | "unbalanced"
    | "corrupted"
    | "required_content"
    | "mutation"
    | "markdown_structure";
  unmatchedStructureType: LinuxNarrativeStructureDiagnostic["unmatchedStructureType"];
  openingCount: number;
  closingCount: number;
  codeFenceCount: number;
  numberedListOpenItems: number;
  length: number;
  completionState:
    | "complete"
    | "incomplete"
    | "unbalanced"
    | "corrupted"
    | "required_content"
    | "mutation"
    | "markdown_structure";
  sha256: string;
};

const LEARNER_CAPABILITY_DESCRIPTIONS: Record<CanonicalEvidenceCapability, string> = {
  authentication: "Review the supplied sign-in records only.",
  session_lifecycle: "Use the supplied session records to describe session timing.",
  actor_attribution: "Associate accounts with observed activity using only the supplied evidence.",
  sudo_authorisation: "Compare privileged command activity with the supplied policy evidence.",
  command_execution: "Use the supplied command records to describe observed execution.",
  process_ancestry: "Use the supplied process history to connect a command to a process.",
  open_file_correlation: "Use the supplied file-access evidence to associate a process with a file or descriptor.",
  file_owner_group_mode: "Review the supplied file ownership, group, and mode evidence.",
  service_state: "Review the supplied service evidence.",
  service_transition: "Use the supplied service evidence to describe state changes.",
  package_transaction: "Use the supplied package records to describe package activity.",
  cron_definition: "Review the supplied scheduled-task definition evidence.",
  cron_execution: "Review the supplied scheduled-task execution evidence.",
  key_provenance: "Review the supplied SSH-key material and ownership evidence.",
  configuration_baseline: "Compare the supplied configuration evidence with the task scope.",
  network_source: "Use the supplied network-source evidence only.",
  current_service_state: "Use only supplied collection-time service-state evidence.",
  current_process_state: "Use only supplied collection-time process-state evidence.",
  current_listener_state: "Use only supplied collection-time listener evidence.",
  current_package_state: "Use only supplied collection-time package inventory evidence.",
  current_persistence_state: "Use only supplied collection-time scheduled or startup configuration evidence.",
  current_identity_state: "Use only supplied collection-time account and group inventory evidence.",
  current_file_state: "Use only supplied collection-time file-state evidence.",
  current_open_file_state: "Use only supplied collection-time open-file evidence.",
  current_policy_state: "Use only supplied collection-time policy evidence.",
  current_configuration_state: "Use only supplied collection-time configuration evidence.",
  change_control: "Use only supplied change-control evidence.",
  maintenance_scope: "Use only supplied maintenance-window evidence.",
  risk_context: "Use only supplied risk or impact context evidence.",
  evidence_integrity: "Document only evidence gaps visible in the supplied artifacts.",
  timeline_exact: "Use the supplied timestamps exactly as written.",
  timeline_context: "Use the supplied timeline context without adding events.",
  timeline_static: "Use supplied collection or snapshot timing only.",
};

const SAFE_TASK_INTENT_LABELS: Record<LinuxNarrativeTaskContract["intent"], string> = {
  scope_timeline: "Timeline reconstruction",
  actor_attribution: "Account attribution",
  ssh_authentication: "SSH sign-in review",
  key_provenance: "SSH key review",
  sudo_policy: "Privileged policy review",
  command_process: "Command and process correlation",
  file_permissions: "File permission review",
  service_state: "Service evidence review",
  package_transaction: "Package activity review",
  cron_analysis: "Scheduled task review",
  network_source: "Network source review",
  configuration_review: "Configuration review",
  change_control: "Change-control review",
  evidence_integrity: "Evidence coverage review",
  impact_assessment: "Impact context review",
  risk_assessment: "Risk context review",
  containment_recommendation: "Bounded containment notes",
};

const INTERNAL_CAPABILITY_KEYS = Object.keys(LEARNER_CAPABILITY_DESCRIPTIONS);
const RELATIONSHIP_KEYS = [
  "authenticated_as",
  "executed_by",
  "executed_in_session",
  "spawned_process",
  "opened_file",
  "created_file",
  "covered_by_change",
  "inside_maintenance_window",
  "service_state",
  "service_transition",
  "transitioned_service",
  "changed_service",
  "defines_schedule",
  "executed_schedule",
  "installed_package",
  "member_of_group",
  "owned_by",
];

const CONTRACT_FIELD_NAMES = [
  "canonicalTaskCount",
  "taskContracts",
  "taskContract",
  "selectedEvidence",
  "groundedSubjects",
  "groundedRelationships",
  "requiredCapabilities",
  "requiredCanonicalSubjects",
  "groundedCanonicalSubjects",
  "requiredRelationships",
  "globalGroundedSubjects",
  "globalGroundedRelationships",
  "prohibitedCapabilityClaims",
  "narrativeConstraints",
  "canonicalRelationshipId",
  "subjectIds",
  "relation",
];

const CLOSURE_FIELD_NAMES = [
  "evidenceClosure",
  "closure",
  "satisfiedCapabilities",
  "missingCapabilities",
  "requirementProofs",
  "selectionDiagnostics",
  "planningEvidenceRegistry",
  "evidenceRegistry",
  "registryCardinality",
];

const CANONICAL_ID_PATTERN =
  /\b(?:identity|session|command|process|descriptor|file|service|transition|cron|scheduled|package|maintenance|event):[A-Za-z0-9._:@-]+|\btask:\d+:[A-Za-z0-9_-]+\b/g;
const WINDOWS_LOCAL_PATH_PATTERN = /\b[A-Za-z]:\\[^\s"',)]*/g;
const INTERNAL_LOCAL_PATH_PATTERN =
  /(?:^|[\s"'(])(?:file:\/\/[^\s"',)]*|\/Users\/[^\s"',)]*|\/home\/oai\/[^\s"',)]*|\/mnt\/data\/[^\s"',)]*|\/workspace\/[^\s"',)]*|\/app\/[^\s"',)]*|\/root\/(?:project|repo|workspace)[^\s"',)]*|\/tmp\/(?:cyberlab|cyberlab-build|repo|build|node|npm)[^\s"',)]*|\/[^\s"',)]*(?:node_modules|\.next|sourceMappingURL)[^\s"',)]*)/g;
const ABSOLUTE_TARGET_PATH_PATTERN = /\/(?:home|etc|var|opt|tmp|srv|usr|bin|sbin|lib|run)\/[A-Za-z0-9._~:@%+=,\/-]+/g;
const SOURCE_PATH_PATTERN = /(?:^|\s)(?:lib|app|tests)\/[A-Za-z0-9_./@-]+/g;
const VALIDATOR_CODE_PATTERN = /\bLINUX_[A-Z0-9_]+\b/g;

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function timestampTokens(text: string) {
  const values = new Set<string>();
  for (const match of text.matchAll(/\b20\d\d-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?Z?\b/g)) values.add(match[0].replace("T", " ").replace(/Z$/, ""));
  for (const match of text.matchAll(/\b\d\d:\d\d(?::\d\d)?\b/g)) values.add(match[0]);
  return Array.from(values);
}

function normalizeTimestampText(value: string) {
  return value.replace("T", " ").replace(/Z$/, "");
}

function normalizePromptPathForComparison(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/[.,;:!?'"`)\]}]+$/g, "");
}

function absoluteTargetPaths(text: string) {
  return Array.from(text.matchAll(ABSOLUTE_TARGET_PATH_PATTERN))
    .map((match) => match[0])
    .filter((path) => !/^\/(?:tmp\/(?:cyberlab|cyberlab-build|repo|build|node|npm)|home\/oai|mnt\/data|workspace|app)\b/i.test(path));
}

function addApprovedPathsFromText(approved: Set<string>, text: string) {
  for (const path of absoluteTargetPaths(text)) {
    approved.add(normalizePromptPathForComparison(path));
  }
}

export function linuxTaskGenerationApprovedPathAuthority(view: LinuxTaskGenerationView) {
  const approved = new Set<string>();
  for (const subject of view.allowedSubjects) addApprovedPathsFromText(approved, subject.display);
  for (const relationship of view.allowedRelationshipStatements) addApprovedPathsFromText(approved, relationship.learnerStatement);
  for (const statement of [
    ...view.allowedCurrentStateStatements,
    ...view.allowedHistoricalStatements,
    ...view.allowedRecommendationStatements,
  ]) {
    addApprovedPathsFromText(approved, statement);
  }
  return approved;
}

function stringFields(value: unknown, source: string) {
  if (typeof value === "string") return [{ field: source, value }];
  const rows: Array<{ field: string; value: string }> = [];
  const walk = (item: unknown, field: string) => {
    if (typeof item === "string") {
      rows.push({ field, value: item });
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => walk(child, `${field}[${index}]`));
      return;
    }
    if (item && typeof item === "object") {
      Object.entries(item as Record<string, unknown>).forEach(([key, child]) => walk(child, field ? `${field}.${key}` : key));
    }
  };
  walk(value, "");
  return rows;
}

function inferredApprovedPathAuthority(value: unknown) {
  const approved = new Set<string>();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const maybeView = value as Partial<LinuxTaskGenerationView>;
    for (const subject of maybeView.allowedSubjects || []) addApprovedPathsFromText(approved, subject.display);
    for (const relationship of maybeView.allowedRelationshipStatements || []) addApprovedPathsFromText(approved, relationship.learnerStatement);
  }
  if (typeof value === "string") {
    for (const match of value.matchAll(/"(?:display|learnerStatement)"\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
      try {
        addApprovedPathsFromText(approved, JSON.parse(`"${match[1]}"`));
      } catch {
        addApprovedPathsFromText(approved, match[1]);
      }
    }
  }
  return approved;
}

function learnerSafePhrase(value: string) {
  return value
    .replace(/\bSSH authentication\b/gi, "SSH sign-in")
    .replace(/\bauthentication\b/gi, "sign-in")
    .replace(/\bservice_transition\b/g, "service event")
    .replace(/\bactor_attribution\b/g, "account attribution")
    .replace(/\bcommand_execution\b/g, "command activity")
    .replace(/\bprocess_ancestry\b/g, "process lineage")
    .replace(/\bopen_file_correlation\b/g, "file-access correlation")
    .replace(/\btimeline_exact\b/g, "exact timestamp use");
}

function canonicalRelationshipId(relationship: LinuxNarrativeRelationshipContract) {
  return `${relationship.relation}:${relationship.subjectIds.join("|")}`;
}

function subjectLabel(task: LinuxNarrativeTaskContract, id: string) {
  return task.groundedSubjects.find((subject) => subject.id === id)?.label || "the referenced object";
}

function learnerSubjectType(value: string) {
  const labels: Record<string, string> = {
    host: "host",
    identity: "account",
    group: "group",
    ssh_session: "SSH session",
    ssh_key: "SSH key",
    command: "command",
    process: "process",
    open_descriptor: "open descriptor",
    file: "file",
    service: "service",
    service_transition: "service event",
    timer: "timer",
    cron_definition: "scheduled task",
    scheduled_execution: "scheduled run",
    package_transaction: "package activity",
    package: "package",
    network_connection: "network connection",
    change: "change record",
    maintenance_activity: "maintenance activity",
    policy: "policy",
    incident: "case",
    timeline_event: "timeline event",
    risk: "risk note",
    evidence_gap: "evidence gap",
  };
  return labels[value] || value.replace(/_/g, " ");
}

function relationshipClaimClass(relation: string): LinuxNarrativeClaimClass {
  if (relation === "service_state") return "current_state";
  if (relation === "service_transition" || relation === "transitioned_service" || relation === "changed_service") return "historical_state";
  return "observed";
}

function relationshipStatement(task: LinuxNarrativeTaskContract, relationship: LinuxNarrativeRelationshipContract) {
  const labels = relationship.subjectIds.map((id) => subjectLabel(task, id));
  const [first, second] = labels;
  switch (relationship.relation) {
    case "authenticated_as":
      return `The supplied evidence records ${first || "a session"} associated with ${second || "an account"}.`;
    case "executed_by":
      return `The supplied evidence associates ${first || "a command"} with execution by ${second || "an account"}.`;
    case "executed_in_session":
      return `The supplied evidence associates ${first || "a command"} with ${second || "a session"}.`;
    case "spawned_process":
      return `The supplied evidence associates ${first || "a command"} with ${second || "a process"}.`;
    case "opened_file":
      return `The supplied evidence links ${first || "a process"} to file or descriptor activity involving ${second || "a file"}.`;
    case "created_file":
      return `The supplied evidence links ${first || "a process"} to creation activity involving ${second || "a file"}.`;
    case "covered_by_change":
      return `The supplied evidence associates ${first || "the activity"} with change record ${second || "the change record"}.`;
    case "inside_maintenance_window":
      return `The supplied evidence places ${first || "the activity"} inside the documented maintenance window.`;
    case "service_state":
      return `The supplied current-state evidence records ${first || "the service"} in the documented service state.`;
    case "service_transition":
    case "transitioned_service":
    case "changed_service":
      return `The supplied service evidence records ${first || "a service event"} involving ${second || "the service"}.`;
    case "defines_schedule":
      return `The supplied scheduled-task evidence associates ${first || "a schedule"} with ${second || "a command"}.`;
    case "executed_schedule":
      return `The supplied scheduled-task evidence records ${first || "a schedule"} running as ${second || "an account"}.`;
    case "installed_package":
      return `The supplied package evidence associates ${first || "a package transaction"} with package ${second || "the package"}.`;
    case "member_of_group":
      return `The supplied identity evidence associates ${first || "an account"} with ${second || "a group"}.`;
    case "owned_by":
      return `The supplied file evidence associates ${first || "a file"} with owner ${second || "an account or group"}.`;
    default:
      return `The supplied evidence associates ${labels.filter(Boolean).join(" with ")}.`;
  }
}

function currentStateStatements(task: LinuxNarrativeTaskContract) {
  const currentCapabilities = task.requiredCapabilities.filter((capability) => capability.startsWith("current_"));
  const facts = unique(currentCapabilities.map((capability) => LEARNER_CAPABILITY_DESCRIPTIONS[capability]));
  return facts.length
    ? facts.map((fact) => `Current-state statement may be based on this only: ${fact}`)
    : ["No current-state conclusion is permitted for this task."];
}

function historicalStatements(task: LinuxNarrativeTaskContract) {
  const facts = unique(task.requiredCapabilities
    .filter((capability) => !capability.startsWith("current_"))
    .map((capability) => LEARNER_CAPABILITY_DESCRIPTIONS[capability]));
  return facts.length
    ? facts.map((fact) => `Historical or observed statement may be based on this only: ${fact}`)
    : ["Use only observations from the supplied evidence."];
}

function recommendationStatements(task: LinuxNarrativeTaskContract) {
  if (!task.allowedRecommendationCategories.length) {
    return ["No remediation or recommendation statement is permitted for this task."];
  }
  return task.allowedRecommendationCategories.map((category) =>
    category === "evidence gaps and next validation step only"
      ? "Recommendations are limited to evidence gaps and the next validation step for this task."
      : `Recommendation scope: ${category}.`
  );
}

function timestampEntriesForTask(task: LinuxNarrativeTaskContract): LinuxTaskGenerationTimestamp[] {
  return unique(task.allowedTimestamps.map(normalizeTimestampText)).map((timestamp, index) => ({
    index: index + 1,
    exactDisplayValue: timestamp,
    learnerContext: "Exact timestamp available for this task.",
    allowedClaimClasses: ["observed", "historical_state", "current_state", "bounded_inference", "recommendation"],
  }));
}

function assertTimestampExposureIsApproved(view: LinuxTaskGenerationView) {
  const approved = new Set(view.allowedTimestamps.flatMap((timestamp) => [
    timestamp.exactDisplayValue,
    ...timestampTokens(timestamp.exactDisplayValue),
  ]));
  const sources = [
    ["task objective", view.learnerObjective],
    ["task instruction", view.learnerInstruction],
    ...view.allowedSubjects.map((subject) => [`subject ${subject.index}`, subject.display] as const),
    ...view.allowedRelationshipStatements.map((relationship) => [`relationship ${relationship.index}`, relationship.learnerStatement] as const),
    ...view.allowedTimestampStatements.map((statement, index) => [`timestamp statement ${index + 1}`, statement] as const),
    ...view.allowedCurrentStateStatements.map((statement, index) => [`current statement ${index + 1}`, statement] as const),
    ...view.allowedHistoricalStatements.map((statement, index) => [`historical statement ${index + 1}`, statement] as const),
    ...view.allowedRecommendationStatements.map((statement, index) => [`recommendation statement ${index + 1}`, statement] as const),
  ];
  for (const [source, text] of sources) {
    for (const token of timestampTokens(text)) {
      if (!approved.has(token)) {
        throw new Error(`Linux task generation view exposes unapproved timestamp ${token} in ${source}.`);
      }
    }
  }
}

export function buildLinuxTaskGenerationView(input: {
  contract: LinuxNarrativeContract;
  task: LinuxNarrativeTaskContract;
}): LinuxTaskGenerationView {
  const { contract, task } = input;
  const rendered = new Set(contract.globalRenderedEvidencePaths.map(normalizeLinuxEvidencePath));
  const selectedPaths = task.selectedEvidence.map((asset) => normalizeLinuxEvidencePath(asset.path));
  for (const path of selectedPaths) {
    if (!rendered.has(path)) {
      throw new Error(`Linux task generation view cannot expose unrendered evidence path ${path}.`);
    }
  }
  const relationshipLookup = relationshipMappingsForTask(task);
  const allowedTimestamps = timestampEntriesForTask(task);
  const view: LinuxTaskGenerationView = {
    taskNumber: task.order,
    learnerIntent: SAFE_TASK_INTENT_LABELS[task.intent],
    learnerObjective: learnerSafePhrase(task.objective),
    learnerInstruction: `Prepare a ${task.deliverableType.replace(/_/g, " ")} using only the listed evidence paths and readable case facts supplied for this task.`,
    studentReadableContext: {
      subjects: task.groundedSubjects.map((subject) => `${learnerSubjectType(subject.type)}: ${subject.label}`),
      relationships: relationshipLookup.map((relationship) => relationship.learnerStatement),
      timestamps: allowedTimestamps.map((timestamp) => `${timestamp.exactDisplayValue} (${timestamp.learnerContext})`),
    },
    allowedEvidence: task.selectedEvidence.map((asset) => ({
      path: normalizeLinuxEvidencePath(asset.path),
      description: asset.displayName,
    })),
    allowedSubjects: task.groundedSubjects.map((subject, index) => ({
      index: index + 1,
      display: subject.label,
      type: learnerSubjectType(subject.type),
    })),
    allowedRelationshipStatements: relationshipLookup.map(({ index, learnerStatement, allowedClaimClass }) => ({
      index,
      learnerStatement,
      allowedClaimClass,
    })),
    allowedTimestamps,
    allowedTimestampStatements: allowedTimestamps.map((timestamp) => `${timestamp.exactDisplayValue} (${timestamp.learnerContext})`),
    allowedCurrentStateStatements: currentStateStatements(task),
    allowedHistoricalStatements: historicalStatements(task),
    allowedRecommendationStatements: recommendationStatements(task),
    allowedCapabilityDescriptions: task.requiredCapabilities.map((capability) => {
      const description = LEARNER_CAPABILITY_DESCRIPTIONS[capability];
      if (!description) throw new Error(`Linux task generation view has no learner-facing mapping for capability ${capability}.`);
      return description;
    }),
    prohibitedTopics: [
      ...task.prohibitedClaims,
      "Do not state root cause, compromise, attacker identity, intent, causation, or remediation unless an allowed statement says so.",
      "Do not mention internal identifiers, relationship names, validator codes, or implementation metadata.",
    ],
    outputRequirements: [
      "Cite exact evidence path strings only from the allowed evidence list.",
      "Use student-readable account, host, path, service, process, relationship, and timestamp labels in phase, title, claim text, and deliverable prose.",
      "Keep phase, title, deliverable, and claim text as plain text only; do not generate Markdown headings, bullet lists, numbered lists, tables, code fences, or separators.",
      "Populate required numeric-reference arrays only from the allowed machine-reference lists for this task.",
      "Never mention schema field names, machine-reference numbers, internal validation metadata, or undefined numbered subjects in learner-facing prose.",
      "Use an empty metadata array when a claim does not need a subject, relationship, or timestamp reference.",
    ],
  };
  assertTimestampExposureIsApproved(view);
  assertLinuxTaskGenerationViewIsModelSafe(view, "generation view", {
    approvedAbsolutePaths: linuxTaskGenerationApprovedPathAuthority(view),
  });
  return view;
}

export function relationshipMappingsForTask(task: LinuxNarrativeTaskContract): LinuxTaskGenerationRelationship[] {
  return task.groundedRelationships.map((relationship, index) => ({
    index: index + 1,
    learnerStatement: relationshipStatement(task, relationship),
    allowedClaimClass: relationshipClaimClass(relationship.relation),
    canonicalRelationshipId: canonicalRelationshipId(relationship),
    relation: relationship.relation,
    subjectIds: relationship.subjectIds,
  }));
}

export function scanLinuxModelFacingPayload(value: unknown, source = "payload", options: {
  approvedAbsolutePaths?: Iterable<string>;
} = {}): LinuxGenerationViewScanIssue[] {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const issues: LinuxGenerationViewScanIssue[] = [];
  const approvedAbsolutePaths = new Set(Array.from(options.approvedAbsolutePaths || []).map(normalizePromptPathForComparison));
  for (const path of inferredApprovedPathAuthority(value)) approvedAbsolutePaths.add(path);
  const addMatches = (pattern: RegExp, category: LinuxGenerationViewScanIssue["category"]) => {
    for (const match of text.matchAll(pattern)) {
      issues.push({ category, token: match[0].trim(), source, rule: pattern.source });
    }
  };
  addMatches(CANONICAL_ID_PATTERN, "canonical_id");
  addMatches(WINDOWS_LOCAL_PATH_PATTERN, "local_path");
  addMatches(INTERNAL_LOCAL_PATH_PATTERN, "local_path");
  addMatches(SOURCE_PATH_PATTERN, "source_path");
  addMatches(VALIDATOR_CODE_PATTERN, "validator_issue_code");
  for (const row of stringFields(value, source)) {
    for (const match of row.value.matchAll(ABSOLUTE_TARGET_PATH_PATTERN)) {
      const rawPath = match[0];
      const normalizedPath = normalizePromptPathForComparison(rawPath);
      if (/^\/(?:home\/oai|mnt\/data|workspace|app)\b|^\/tmp\/(?:cyberlab|cyberlab-build|repo|build|node|npm)\b|(?:node_modules|\.next|sourceMappingURL)/i.test(normalizedPath)) {
        continue;
      }
      if (!approvedAbsolutePaths.has(normalizedPath)) {
        issues.push({
          category: "unapproved_absolute_path",
          token: rawPath,
          source,
          field: row.field,
          value: row.value,
          provenance: "not_found_in_approved_path_authority",
          rule: ABSOLUTE_TARGET_PATH_PATTERN.source,
        });
      }
    }
  }
  for (const key of RELATIONSHIP_KEYS) {
    if (new RegExp(`\\b${key}\\b`).test(text)) issues.push({ category: "relationship_key", token: key, source });
  }
  for (const key of INTERNAL_CAPABILITY_KEYS) {
    if (new RegExp(`\\b${key}\\b`).test(text)) issues.push({ category: "capability_key", token: key, source });
  }
  for (const key of CONTRACT_FIELD_NAMES) {
    if (new RegExp(`\\b${key}\\b`).test(text)) issues.push({ category: "contract_field", token: key, source });
  }
  for (const key of CLOSURE_FIELD_NAMES) {
    if (new RegExp(`\\b${key}\\b`).test(text)) issues.push({ category: "closure_metadata", token: key, source });
  }
  return issues;
}

export function assertLinuxTaskGenerationViewIsModelSafe(value: unknown, source = "payload", options: {
  approvedAbsolutePaths?: Iterable<string>;
} = {}) {
  const issues = scanLinuxModelFacingPayload(value, source, options);
  if (issues.length > 0) {
    const details = issues.slice(0, 8).map((issue) => `${issue.category}:${issue.token}`).join(", ");
    throw new Error(`Linux model-facing task payload contains internal details: ${details}`);
  }
}

export function serializeLinuxTaskGenerationPrompt(input: {
  view: LinuxTaskGenerationView;
  feedback?: string;
}) {
  const payload = {
    task: {
      number: input.view.taskNumber,
      intent: input.view.learnerIntent,
      objective: input.view.learnerObjective,
      instruction: input.view.learnerInstruction,
    },
    studentReadableContext: input.view.studentReadableContext,
    onlyAllowedEvidence: input.view.allowedEvidence,
    onlyAllowedSubjects: input.view.allowedSubjects,
    onlyAllowedRelationshipStatements: input.view.allowedRelationshipStatements,
    onlyAllowedTimestamps: input.view.allowedTimestamps.map((timestamp) => ({
      index: timestamp.index,
      exactDisplayValue: timestamp.exactDisplayValue,
      learnerContext: timestamp.learnerContext,
      allowedClaimClasses: timestamp.allowedClaimClasses,
    })),
    onlyAllowedTimestampStatements: input.view.allowedTimestampStatements,
    onlyAllowedCurrentStateStatements: input.view.allowedCurrentStateStatements,
    onlyAllowedHistoricalStatements: input.view.allowedHistoricalStatements,
    onlyAllowedRecommendations: input.view.allowedRecommendationStatements,
    onlyAllowedCapabilityDescriptions: input.view.allowedCapabilityDescriptions,
    forbidden: input.view.prohibitedTopics,
    outputRequirements: input.view.outputRequirements,
    retryFeedback: input.feedback || undefined,
  };
  const prompt = [
    "ROLE",
    "You are a constrained serializer. You do not investigate, infer, or add facts.",
    "TASK",
    "Write exactly one learner-facing Linux investigation task from the safe task data below.",
    "ONLY USE",
    "Use only the evidence paths and the student-readable subject, relationship, timestamp, and boundary facts in this payload for learner-facing prose.",
    "FORBIDDEN",
    "Do not output internal identifiers, raw relationship names, raw capability names, validator codes, local paths, source-code paths, or implementation metadata.",
    "Do not mention schema field names, machine-reference numbers, index language, approved statements, accepted evidence contracts, or undefined numbered subjects in phase, title, claim text, or deliverable.",
    "Do not use cause, compromise, persistence, malware, attacker, intent, or remediation language unless the supplied task facts explicitly permit it.",
    "Do not generate Markdown structure. Do not write headings, bullet lists, numbered lists, tables, code fences, separators, or nested formatting in any text field.",
    "OUTPUT",
    "Return the JSON shape requested by the schema. Keep machine references only inside the required metadata arrays; never copy their field names into learner-facing prose.",
    "Write phase, title, deliverable, and claim text as bounded plain text only. Do not put evidence lists in prose; place evidence paths only in the evidence arrays.",
    "FINAL CHECK",
    "Remove any sentence not directly supported by the safe task data.",
    JSON.stringify(payload, null, 2),
  ].join("\n\n");
  assertLinuxTaskGenerationViewIsModelSafe(prompt, "serialized prompt", {
    approvedAbsolutePaths: linuxTaskGenerationApprovedPathAuthority(input.view),
  });
  return prompt;
}

export function linuxTaskGenerationSchema(view: LinuxTaskGenerationView) {
  const evidencePaths = view.allowedEvidence.map((asset) => asset.path);
  const subjectIndexes = view.allowedSubjects.map((subject) => subject.index);
  const relationshipIndexes = view.allowedRelationshipStatements.map((relationship) => relationship.index);
  const timestampIndexes = view.allowedTimestamps.map((timestamp) => timestamp.index);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      task_number: { type: "number", enum: [view.taskNumber] },
      learner_intent: { type: "string", enum: [view.learnerIntent], maxLength: 80 },
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
            subject_indexes: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(8, Math.max(1, subjectIndexes.length)),
              items: subjectIndexes.length ? { type: "number", enum: subjectIndexes } : { type: "number" },
            },
            relationship_statement_indexes: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(6, Math.max(1, relationshipIndexes.length)),
              items: relationshipIndexes.length ? { type: "number", enum: relationshipIndexes } : { type: "number" },
            },
            timestamp_indexes: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(8, Math.max(1, timestampIndexes.length)),
              items: timestampIndexes.length ? { type: "number", enum: timestampIndexes } : { type: "number" },
            },
          },
          required: ["claim_class", "text", "supporting_evidence", "subject_indexes", "relationship_statement_indexes", "timestamp_indexes"],
        },
      },
    },
    required: ["task_number", "learner_intent", "phase", "title", "evidence", "deliverable", "claims"],
  };
}

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function markdownStructureType(value: string): LinuxTaskAtomicFieldIssue["unmatchedStructureType"] | null {
  if (/```/.test(value)) return "code_fence";
  if (/(?:^|\n)\s{0,3}#{1,6}\s+\S/.test(value)) return "numbered_list";
  if (/(?:^|\n)\s{0,8}(?:[-*+]\s+\S|\d+\.\s+\S)/.test(value)) return "numbered_list";
  if (/(?:^|\n)\s*\|.+\|\s*(?:\n|$)/.test(value)) return "numbered_list";
  return null;
}

function atomicIssueFromValidation(input: {
  field: string;
  value: unknown;
  kind: LinuxNarrativeTextKind;
  taskIndex: number | null;
  maxLength: number;
}): LinuxTaskAtomicFieldIssue[] {
  const text = String(input.value ?? "");
  const diagnostics = linuxNarrativeStructureDiagnostic(text);
  const validation = validateLinuxNarrativeTextIntegrity(text, {
    field: input.field,
    kind: input.kind,
    taskIndex: input.taskIndex ?? undefined,
    maxLength: input.maxLength,
  });
  const issues: LinuxTaskAtomicFieldIssue[] = validation.issues.map((issue) => ({
    code: issue.code,
    field: input.field,
    taskIndex: input.taskIndex,
    failureCategory: issue.category,
    unmatchedStructureType: diagnostics.unmatchedStructureType,
    openingCount: diagnostics.openingCount,
    closingCount: diagnostics.closingCount,
    codeFenceCount: diagnostics.codeFenceCount,
    numberedListOpenItems: diagnostics.numberedListOpenItems,
    length: text.length,
    completionState: issue.category,
    sha256: sha256Text(text),
  }));
  const markdownType = markdownStructureType(text);
  if (markdownType) {
    issues.push({
      code: "LINUX_NARRATIVE_MODEL_MARKDOWN_STRUCTURE",
      field: input.field,
      taskIndex: input.taskIndex,
      failureCategory: "markdown_structure",
      unmatchedStructureType: markdownType,
      openingCount: diagnostics.openingCount,
      closingCount: diagnostics.closingCount,
      codeFenceCount: diagnostics.codeFenceCount,
      numberedListOpenItems: diagnostics.numberedListOpenItems,
      length: text.length,
      completionState: "markdown_structure",
      sha256: sha256Text(text),
    });
  }
  return issues;
}

function atomicFieldLabel(field: string) {
  if (field.endsWith(".phase")) return "task phase";
  if (field.endsWith(".title")) return "task title";
  if (field.endsWith(".deliverable")) return "task deliverable";
  if (field.includes(".claims[")) return "task claim text";
  return "task text";
}

export function validateLinuxGeneratedTaskAtomicFields(input: {
  view: LinuxTaskGenerationView;
  generated: LinuxGeneratedTaskFromView;
}): { passed: true; issues: [] } | { passed: false; issues: LinuxTaskAtomicFieldIssue[] } {
  const taskIndex = Math.max(0, input.view.taskNumber - 1);
  const issues = [
    ...(input.generated.claims || []).flatMap((claim, claimIndex) =>
      atomicIssueFromValidation({
        field: `tasks[${taskIndex}].claims[${claimIndex}].text`,
        value: claim.text,
        kind: "deliverable",
        taskIndex,
        maxLength: 360,
      })
    ),
  ];
  return issues.length === 0 ? { passed: true, issues: [] } : { passed: false, issues };
}

export function linuxAtomicTaskRetryFeedback(issues: LinuxTaskAtomicFieldIssue[]) {
  if (issues.length === 0) return "";
  const categories = new Set<LinuxSafeRetryFeedbackCategory>(["atomic_plain_text"]);
  for (const issue of issues) {
    if (issue.failureCategory === "incomplete") categories.add("incomplete_text");
    if (
      issue.failureCategory === "unbalanced" ||
      issue.failureCategory === "corrupted" ||
      issue.failureCategory === "markdown_structure"
    ) {
      categories.add("atomic_plain_text");
    }
  }
  const feedback = buildLinuxSafeRetryFeedback({ categories, scope: "task" });
  const sanitizedFeedback = sanitizeRemainingModelFacingRetryTokens(feedback);
  assertLinuxTaskGenerationViewIsModelSafe(sanitizedFeedback, "atomic retry feedback");
  return sanitizedFeedback;
}

export function adaptLinuxGeneratedTaskFromView(input: {
  task: LinuxNarrativeTaskContract;
  generated: LinuxGeneratedTaskFromView;
}) {
  const subjects = new Map(input.task.groundedSubjects.map((subject, index) => [index + 1, subject.id]));
  const relationships = new Map(relationshipMappingsForTask(input.task).map((relationship) => [relationship.index, relationship]));
  const timestamps = new Map(timestampEntriesForTask(input.task).map((timestamp) => [timestamp.index, timestamp.exactDisplayValue]));
  const allowedEvidence = input.task.selectedEvidence.map((asset) => normalizeLinuxEvidencePath(asset.path));
  const exactEvidence = new Map(allowedEvidence.map((evidencePath) => [evidencePath, evidencePath]));
  const basenameCounts = new Map<string, number>();
  const basenameEvidence = new Map<string, string>();
  for (const evidencePath of allowedEvidence) {
    const basename = evidencePath.split("/").pop() || evidencePath;
    basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1);
    basenameEvidence.set(basename, evidencePath);
  }
  const resolveEvidenceReference = (value: string) => {
    const normalized = normalizeLinuxEvidencePath(value);
    const exact = exactEvidence.get(normalized);
    if (exact) return exact;
    const basename = normalized.split("/").pop() || normalized;
    if (normalized === basename && basenameCounts.get(basename) === 1) {
      return basenameEvidence.get(basename) || normalized;
    }
    return normalized;
  };
  const mapEvidenceReferences = (values: string[] | undefined) => (values || []).map(resolveEvidenceReference);
  const mapTimestampIndexes = (indexes: number[] | undefined, legacyTimestamps: string[] | undefined) => {
    if (legacyTimestamps && legacyTimestamps.length > 0) {
      throw new Error("Linux sanitized task adapter rejects free-form timestamp strings; use timestamp_indexes.");
    }
    const seen = new Set<number>();
    return (indexes || []).map((index) => {
      if (seen.has(index)) throw new Error(`Linux sanitized task adapter rejects duplicate timestamp index ${index}.`);
      seen.add(index);
      const timestamp = timestamps.get(index);
      if (!timestamp) throw new Error(`Linux sanitized task adapter rejects unknown timestamp index ${index}.`);
      return timestamp;
    });
  };
  return {
    task_id: input.task.taskId,
    task_intent: input.task.intent,
    phase: input.generated.phase,
    title: input.generated.title,
    evidence: mapEvidenceReferences(input.generated.evidence),
    deliverable: input.generated.deliverable,
    claims: (input.generated.claims || []).map((claim) => ({
      claim_class: claim.claim_class,
      text: claim.text,
      supporting_evidence: mapEvidenceReferences(claim.supporting_evidence),
      subjects: unique((claim.subject_indexes || []).map((index) => subjects.get(index) || "")),
      relationships: unique((claim.relationship_statement_indexes || []).map((index) => String(index)))
        .map((index) => relationships.get(Number(index)))
        .filter((relationship): relationship is LinuxTaskGenerationRelationship => Boolean(relationship))
        .map((relationship) => ({
          relation: relationship.relation,
          subject_ids: relationship.subjectIds,
        })),
      timestamps: mapTimestampIndexes(claim.timestamp_indexes, claim.timestamps),
    })),
  };
}

function sanitizeEvidencePathReferences(text: string) {
  return text
    .replace(/\bassets\/[A-Za-z0-9_./@-]+/g, "an unavailable evidence path")
    .replace(/\bevidence(?:\s+path)?\s+[A-Za-z0-9_.@-]+\/[A-Za-z0-9_./@-]+/gi, "an unavailable evidence path")
    .replace(/\b[A-Za-z0-9_.@-]+\.(?:conf|csv|json|log|md|sample|service|timer|txt)\b/g, "an unavailable evidence item");
}

function retryFeedbackScannerReplacement(category: LinuxGenerationViewScanIssue["category"]) {
  switch (category) {
    case "canonical_id":
      return "the referenced item";
    case "relationship_key":
      return "the approved relationship";
    case "capability_key":
      return "the approved capability";
    case "validator_issue_code":
      return "validation issue";
    case "contract_field":
      return "task-contract metadata";
    case "closure_metadata":
      return "evidence-closure metadata";
    case "unapproved_absolute_path":
      return "an unapproved path";
    case "local_path":
    case "source_path":
      return "an internal path";
    default:
      return "internal metadata";
  }
}

function sanitizeRemainingModelFacingRetryTokens(value: string) {
  let sanitized = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const issues = scanLinuxModelFacingPayload(sanitized, "retry feedback sanitizer");
    if (issues.length === 0) return sanitized;
    for (const issue of issues) {
      if (!issue.token) continue;
      sanitized = sanitized.split(issue.token).join(retryFeedbackScannerReplacement(issue.category));
    }
  }
  return sanitized;
}

export function linuxSanitizedRetryFeedback(categories: Iterable<LinuxSafeRetryFeedbackCategory>) {
  const feedback = buildLinuxSafeRetryFeedback({ categories, scope: "task" });
  const sanitizedFeedback = sanitizeRemainingModelFacingRetryTokens(feedback);
  assertLinuxTaskGenerationViewIsModelSafe(sanitizedFeedback, "retry feedback");
  return sanitizedFeedback;
}

export function linuxNarrativeContractIssueRetryFeedback(codes: Iterable<string>, scope: "task" | "narrative" = "task") {
  const feedback = buildLinuxSafeRetryFeedback({
    categories: linuxRetryFeedbackCategoriesFromNarrativeIssueCodes(codes),
    scope,
  });
  const sanitizedFeedback = sanitizeRemainingModelFacingRetryTokens(feedback);
  assertLinuxTaskGenerationViewIsModelSafe(sanitizedFeedback, `${scope} retry feedback`);
  return sanitizedFeedback;
}
