import type { LabAsset } from "../types";
import { stableHash } from "./deterministicRandom";
import type {
  CanonicalEvidenceAsset,
  CanonicalEvidenceCapability,
  CanonicalInvestigationTask,
  LinuxSimulationWorld,
} from "./simulation";
import {
  linuxIncidentCoverageContract,
  linuxIncidentDifficultyCoverage,
  type LinuxRemediationConcept,
} from "./incidentCoverage";
import { linuxDurationTaskCountBounds } from "./difficultyProfile";

export const LINUX_WORKLOAD_CALIBRATION_VERSION = "linux-workload-v9.2";

export type LinuxWorkloadIssueCode =
  | "LINUX_WORKLOAD_REPORT_MISSING"
  | "LINUX_WORKLOAD_REPORT_INVALID"
  | "LINUX_WORKLOAD_DURATION_UNDER_TARGET"
  | "LINUX_WORKLOAD_DURATION_OVER_TARGET"
  | "LINUX_WORKLOAD_DIFFICULTY_MISMATCH"
  | "LINUX_WORKLOAD_TASK_OVERLOAD"
  | "LINUX_WORKLOAD_EVIDENCE_OVERLOAD"
  | "LINUX_WORKLOAD_NAVIGATION_OVERLOAD"
  | "LINUX_WORKLOAD_CORRELATION_OVERLOAD"
  | "LINUX_WORKLOAD_INSUFFICIENT_DEPTH"
  | "LINUX_WORKLOAD_NOISE_PADDING"
  | "LINUX_WORKLOAD_DUPLICATED_EFFORT"
  | "LINUX_WORKLOAD_UNBOUNDED_AMBIGUITY"
  | "LINUX_WORKLOAD_UNSUPPORTED_DURATION"
  | "LINUX_WORKLOAD_NONDETERMINISTIC"
  | "LINUX_WORKLOAD_DURATION_ANCHORED_ESTIMATE"
  | "LINUX_WORKLOAD_LABEL_DEPENDENT_ESTIMATE"
  | "LINUX_WORKLOAD_ARTIFICIAL_VARIANCE"
  | "LINUX_WORKLOAD_VOLUME_GAMING"
  | "LINUX_WORKLOAD_FILE_COUNT_INFLATION"
  | "LINUX_WORKLOAD_SYNTHESIS_MISSING"
  | "LINUX_WORKLOAD_SHARED_EFFORT_DOUBLE_COUNTED"
  | "LINUX_WORKLOAD_REMEDIATION_UNCOUNTED"
  | "LINUX_WORKLOAD_REMEDIATION_ACTION_MISSING"
  | "LINUX_WORKLOAD_REMEDIATION_DELIVERABLE_MISSING"
  | "LINUX_WORKLOAD_REMEDIATION_COST_INVALID"
  | "LINUX_WORKLOAD_REMEDIATION_DOUBLE_COUNTED"
  | "LINUX_WORKLOAD_INPUT_MUTATED_AFTER_VALIDATION"
  | "LINUX_WORKLOAD_ESTIMATE_HASH_MISMATCH"
  | "LINUX_WORKLOAD_REPORT_HASH_MISMATCH";

export type LinuxDifficulty = "Beginner" | "Intermediate" | "Advanced";

export type LinuxLabWorkloadIssue = {
  code: LinuxWorkloadIssueCode;
  severity: "high" | "critical";
  message: string;
  taskIndex?: number;
  evidence?: string;
};

export type LinuxLabWorkloadReport = {
  version: string;
  requestedDifficulty: LinuxDifficulty;
  requestedDurationMinutes: number;
  estimatedDurationMinutes: number;
  acceptableDurationRange: {
    minimumMinutes: number;
    maximumMinutes: number;
  };
  totalEffortPoints: number;
  dimensions: {
    taskExecution: number;
    evidenceNavigation: number;
    evidenceReading: number;
    crossSourceCorrelation: number;
    timelineReasoning: number;
    semanticReasoning: number;
    ambiguityResolution: number;
    deliverableConstruction: number;
    remediationReasoning: number;
    duplicatedWork: number;
  };
  taskEstimates: Array<{
    taskIndex: number;
    intent?: string;
    investigationStage?: string;
    estimatedMinutes: number;
    expectedActionCount: number;
    expectedActions: string[];
    sharedActionKeys: string[];
    relevantEvidencePaths: string[];
    requiredCorrelations: string[];
    remediationActions: LinuxWorkloadRemediationAction[];
    reasons: string[];
  }>;
  metrics: {
    taskCount: number;
    uniqueEvidencePathCount: number;
    relevantEvidenceLineCount: number;
    distractorEvidenceLineCount: number;
    relevantToNoiseRatio: number;
    uniqueSubjectCount: number;
    relationshipCount: number;
    crossFileCorrelationCount: number;
    timelineEventCount: number;
    expectedCommandCount: number;
    learnerActionCount: number;
    remediationActionCount: number;
    taskLocalSubjectCount: number;
    taskLocalRelationshipCount: number;
    noiseOnlySubjectCount: number;
    renderedEvidenceAssetCount: number;
    totalPackFileCount: number;
    synthesisTaskCount: number;
    genuineCrossSourceJoinCount: number;
    nonIdentityCrossSourceJoinCount: number;
    uncertaintyDecisionCount: number;
    competingHypothesisDecisionCount: number;
  };
  issues: LinuxLabWorkloadIssue[];
  independentEstimate: LinuxIndependentWorkloadEstimate;
};

export type LinuxWorkloadRemediationAction = {
  concept: LinuxRemediationConcept | "generic_supported_remediation";
  action: string;
  costMinutes: number;
  taskId: string;
  taskIndex: number;
  carrier: "mandatory_question" | "deliverable" | "risk_summary" | "containment_plan";
  carrierDeliverableType: CanonicalInvestigationTask["expectedDeliverableType"];
  dedupeKey: string;
};

export type LinuxWorkloadValidationResult = {
  passed: boolean;
  report: LinuxLabWorkloadReport;
  workloadEstimateHash: string;
  workloadReportHash: string;
  issues: LinuxLabWorkloadIssue[];
};

export type LinuxIndependentWorkloadEstimate = {
  version: string;
  estimatedDurationMinutes: number;
  totalEffortPoints: number;
  dimensions: LinuxLabWorkloadReport["dimensions"];
  taskEstimates: LinuxLabWorkloadReport["taskEstimates"];
  metrics: LinuxLabWorkloadReport["metrics"];
};

const CURRENT_CAPABILITIES = new Set<CanonicalEvidenceCapability>([
  "current_service_state",
  "current_process_state",
  "current_listener_state",
  "current_package_state",
  "current_persistence_state",
  "current_identity_state",
  "current_file_state",
  "current_open_file_state",
  "current_policy_state",
  "current_configuration_state",
]);

const SEMANTIC_CAPABILITIES = new Set<CanonicalEvidenceCapability>([
  "sudo_authorisation",
  "process_ancestry",
  "open_file_correlation",
  "service_state",
  "service_transition",
  "package_transaction",
  "cron_definition",
  "cron_execution",
  "key_provenance",
  "network_source",
  "change_control",
  "maintenance_scope",
  "risk_context",
]);

const DOMAIN_CAPABILITIES = new Set<CanonicalEvidenceCapability>([
  "service_state",
  "service_transition",
  "current_service_state",
  "cron_definition",
  "cron_execution",
  "current_persistence_state",
  "package_transaction",
  "current_package_state",
  "network_source",
  "current_listener_state",
  "open_file_correlation",
  "file_owner_group_mode",
  "current_file_state",
  "current_open_file_state",
]);

export const LINUX_MIN_REMEDIATION_ACTION_COST_MINUTES = 0.35;

const REMEDIATION_ACTION_CATALOG: Record<LinuxRemediationConcept, Array<{ action: string; costMinutes: number }>> = {
  narrow_sudo_rule: [
    { action: "identify excessive sudo rule", costMinutes: 0.4 },
    { action: "propose least-privilege sudo replacement", costMinutes: 0.45 },
  ],
  validate_account_purpose: [
    { action: "compare activity with account purpose", costMinutes: 0.4 },
    { action: "recommend account restriction or credential review", costMinutes: 0.45 },
  ],
  rotate_or_restrict_ssh_key: [
    { action: "preserve SSH key evidence", costMinutes: 0.4 },
    { action: "recommend key rotation or source restriction", costMinutes: 0.45 },
  ],
  disable_scheduled_task_after_capture: [
    { action: "preserve scheduled task definition", costMinutes: 0.45 },
    { action: "recommend disabling unsupported schedule", costMinutes: 0.45 },
    { action: "verify scheduler state after containment", costMinutes: 0.45 },
  ],
  preserve_and_disable_unit: [
    { action: "preserve unit and journal evidence", costMinutes: 0.45 },
    { action: "recommend disabling or masking unsupported unit", costMinutes: 0.45 },
    { action: "verify resulting service state", costMinutes: 0.45 },
  ],
  verify_package_provenance_or_rollback: [
    { action: "verify package source and approval", costMinutes: 0.45 },
    { action: "recommend rollback or removal if unauthorized", costMinutes: 0.45 },
  ],
  quarantine_staged_data_and_validate_transfer: [
    { action: "preserve staged data metadata", costMinutes: 0.4 },
    { action: "recommend quarantine or access restriction", costMinutes: 0.45 },
    { action: "validate whether transfer occurred", costMinutes: 0.45 },
  ],
  restore_logging_and_preserve_secondary_sources: [
    { action: "preserve alternate evidence sources", costMinutes: 0.45 },
    { action: "recommend restoring logging integrity", costMinutes: 0.45 },
    { action: "validate collection continuity", costMinutes: 0.45 },
  ],
  contain_process_and_review_egress: [
    { action: "recommend safe process containment", costMinutes: 0.45 },
    { action: "review or block egress path", costMinutes: 0.45 },
    { action: "preserve process and network evidence", costMinutes: 0.45 },
  ],
  harden_container_runtime_boundary: [
    { action: "recommend containing affected container runtime", costMinutes: 0.45 },
    { action: "remove unsafe runtime access or mount", costMinutes: 0.45 },
    { action: "verify daemon or socket boundary", costMinutes: 0.45 },
  ],
};

export function linuxRemediationActionsForConcept(concept: LinuxRemediationConcept) {
  return (REMEDIATION_ACTION_CATALOG[concept] || []).map((item) => ({ ...item }));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function parseLinuxRequestedDurationMinutes(value: unknown, fallback = 30) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeLinuxWorkloadDifficulty(value: unknown): LinuxDifficulty {
  return value === "Beginner" || value === "Intermediate" || value === "Advanced" ? value : "Intermediate";
}

export function linuxWorkloadDurationRange(difficulty: LinuxDifficulty, requestedDurationMinutes: number) {
  if (!Number.isFinite(requestedDurationMinutes) || requestedDurationMinutes < 10 || requestedDurationMinutes > 120) {
    return { minimumMinutes: 0, maximumMinutes: 0 };
  }
  if (difficulty === "Beginner") {
    if (requestedDurationMinutes <= 15) {
      return {
        minimumMinutes: Math.max(12, Math.round(requestedDurationMinutes * 0.73)),
        maximumMinutes: Math.round(requestedDurationMinutes * 1.4),
      };
    }
    return {
      minimumMinutes: Math.max(12, Math.round(requestedDurationMinutes * 0.73)),
      maximumMinutes: Math.round(requestedDurationMinutes * 1.17),
    };
  }
  if (difficulty === "Intermediate") {
    if (requestedDurationMinutes <= 30) {
      return {
        minimumMinutes: Math.round(requestedDurationMinutes * 0.83),
        maximumMinutes: Math.round(requestedDurationMinutes * 1.35),
      };
    }
    return {
      minimumMinutes: Math.round(requestedDurationMinutes * 0.78),
      maximumMinutes: Math.round(requestedDurationMinutes * 1.22),
    };
  }
  if (requestedDurationMinutes <= 30) {
    return {
      minimumMinutes: Math.round(requestedDurationMinutes * 0.8),
      maximumMinutes: Math.round(requestedDurationMinutes * 1.4),
    };
  }
  return {
    minimumMinutes: Math.round(requestedDurationMinutes * 0.8),
    maximumMinutes: Math.round(requestedDurationMinutes * 1.25),
  };
}

function isWorkloadMetadataLine(line: string) {
  return /^#?\s*(?:Time authority|Schedule timezone):/i.test(line) || /^\s*"time_authority"\s*:/i.test(line);
}

function assetLineCount(asset: LabAsset | undefined) {
  if (!asset) return 0;
  return asset.content.split(/\r?\n/).filter((line) => line.trim() && !isWorkloadMetadataLine(line)).length;
}

function boundedRelevantLineCount(asset: LabAsset | undefined, registryAsset: CanonicalEvidenceAsset | undefined, task: CanonicalInvestigationTask) {
  const lines = assetLineCount(asset);
  if (lines === 0) return 0;
  const objectHints = new Set([
    ...task.canonicalObjectIds,
    ...task.primarySubjectIds,
    ...task.supportingSubjectIds,
    ...(registryAsset?.canonicalObjectIds || []),
  ].map((id) => id.replace(/^[a-z_]+:/, "").split(":")[0]).filter(Boolean));
  const matched = asset!.content
    .split(/\r?\n/)
    .filter((line) => !isWorkloadMetadataLine(line))
    .filter((line) => [...objectHints].some((hint) => hint.length >= 4 && line.includes(hint))).length;
  const baseline = registryAsset?.support === "exact" ? 10 : registryAsset?.support === "context" ? 6 : 4;
  return Math.min(lines, Math.max(baseline, matched + 4));
}

function taskStage(task: CanonicalInvestigationTask) {
  if (task.inquiryTypes.includes("remediation_or_containment")) return "remediation";
  if (task.inquiryTypes.includes("risk_assessment")) return "impact";
  if (task.intent === "scope_timeline") return "scope";
  if (task.intent === "actor_attribution" || task.intent === "ssh_authentication" || task.intent === "sudo_policy") return "identity-access";
  if (task.intent === "command_process" || task.intent === "file_permissions" || task.intent === "network_source") return "runtime-correlation";
  if (task.intent === "service_state" || task.intent === "cron_analysis" || task.intent === "package_transaction") return "state-change";
  return "analysis";
}

function selectedEvidence(task: CanonicalInvestigationTask, registryById: Map<string, CanonicalEvidenceAsset>) {
  return task.selectedEvidenceAssetIds
    .map((id) => registryById.get(id))
    .filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset));
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function duplicateWork(tasks: CanonicalInvestigationTask[], registryById: Map<string, CanonicalEvidenceAsset>) {
  const signatures = new Map<string, number>();
  for (const task of tasks) {
    const paths = selectedEvidence(task, registryById).map((asset) => asset.path).sort().join("|");
    const subjects = task.primarySubjectIds.slice().sort().join("|");
    const signature = `${task.intent}:${paths}:${subjects}`;
    signatures.set(signature, (signatures.get(signature) || 0) + 1);
  }
  return [...signatures.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function timelineActionCount(task: CanonicalInvestigationTask, evidence: CanonicalEvidenceAsset[]) {
  if (!task.requiredCapabilities.includes("timeline_exact")) return 0;
  const timestampedSources = evidence.filter((asset) =>
    asset.exactTimestampSupport ||
    asset.capabilities.includes("timeline_exact") ||
    asset.capabilities.includes("timeline_context")
  ).length;
  return Math.max(1, Math.min(4, timestampedSources));
}

function commandActionCount(task: CanonicalInvestigationTask) {
  return task.requiredCapabilities.filter((capability) =>
    capability === "command_execution" ||
    capability === "sudo_authorisation" ||
    capability === "process_ancestry" ||
    capability === "package_transaction" ||
    capability === "cron_execution" ||
    capability === "service_transition"
  ).length;
}

function taskRelationshipCount(task: CanonicalInvestigationTask) {
  return new Set(task.requirements.map((requirement) => requirement.relation).filter(Boolean)).size;
}

function taskSubjectCount(task: CanonicalInvestigationTask) {
  // Supporting subjects describe surrounding rows in selected evidence. They are
  // not Beginner task obligations, so charging each one makes richer background
  // context look like extra learner work even when the question is unchanged.
  return new Set([
    ...task.primarySubjectIds,
    ...(task.difficulty === "Beginner" ? [] : task.supportingSubjectIds),
    ...task.requirements.flatMap((requirement) => requirement.subjectIds),
  ]).size;
}

function remediationActionWeight(task: CanonicalInvestigationTask) {
  if (task.expectedDeliverableType === "containment_plan") return 3;
  if (task.inquiryTypes.includes("remediation_or_containment") || task.intent === "containment_recommendation") return 2;
  if (task.expectedDeliverableType === "risk_summary" || task.inquiryTypes.includes("risk_assessment")) return 1;
  return 0;
}

function remediationCarrier(task: CanonicalInvestigationTask): LinuxWorkloadRemediationAction["carrier"] {
  if (task.expectedDeliverableType === "containment_plan") return "containment_plan";
  if (task.expectedDeliverableType === "risk_summary" || task.inquiryTypes.includes("risk_assessment")) return "risk_summary";
  if (task.inquiryTypes.includes("remediation_or_containment") || task.intent === "containment_recommendation") return "deliverable";
  return "mandatory_question";
}

function remediationActionsForTask(args: {
  task: CanonicalInvestigationTask;
  taskIndex: number;
  concepts: LinuxRemediationConcept[];
}): LinuxWorkloadRemediationAction[] {
  const carrier = remediationCarrier(args.task);
  return args.concepts.flatMap((concept) =>
    (REMEDIATION_ACTION_CATALOG[concept] || []).map((item) => ({
      concept,
      action: item.action,
      costMinutes: item.costMinutes,
      taskId: args.task.id,
      taskIndex: args.taskIndex,
      carrier,
      carrierDeliverableType: args.task.expectedDeliverableType,
      dedupeKey: `${concept}:${item.action}`,
    }))
  );
}

function requiredRemediationConceptsForSimulation(input: {
  investigation?: { incidentFamily?: string };
  canonicalTasks?: CanonicalInvestigationTask[];
}) {
  const difficulty = input.canonicalTasks?.[0]?.difficulty;
  return linuxIncidentDifficultyCoverage(input.investigation?.incidentFamily, difficulty)?.requiredRemediationConcepts || [];
}

function taskRemediationConcepts(input: {
  investigation?: { incidentFamily?: string };
  canonicalTasks?: CanonicalInvestigationTask[];
}, task: CanonicalInvestigationTask) {
  const contract = linuxIncidentCoverageContract(input.investigation?.incidentFamily);
  const difficulty = task.difficulty.toLowerCase() as Lowercase<LinuxDifficulty>;
  const required = contract?.difficultyRequirements[difficulty]?.requiredRemediationConcepts || [];
  if (!contract || required.length === 0) return [];
  return required.filter((concept) => {
    const requirement = Object.values(contract.questionRequirements).find((item) => item.remediation === concept);
    if (requirement?.taskIntents?.includes(task.intent)) return true;
    if (task.intent === "containment_recommendation") return true;
    if (task.inquiryTypes.includes("remediation_or_containment")) return true;
    if (task.expectedDeliverableType === "containment_plan") return true;
    if (task.expectedDeliverableType === "risk_summary" || task.inquiryTypes.includes("risk_assessment")) {
      return task.intent === "impact_assessment" || task.intent === "risk_assessment" || task.intent === "configuration_review" || task.intent === "evidence_integrity";
    }
    return false;
  });
}

function fallbackRemediationConceptsByTask(input: {
  investigation?: { incidentFamily?: string };
  canonicalTasks?: CanonicalInvestigationTask[];
}) {
  const tasks = (input.canonicalTasks || []).slice().sort((left, right) => left.order - right.order);
  const required = requiredRemediationConceptsForSimulation(input);
  const assigned = new Map<string, LinuxRemediationConcept[]>();
  const seen = new Set<LinuxRemediationConcept>();
  for (const task of tasks) {
    const concepts = taskRemediationConcepts(input, task);
    if (concepts.length) {
      assigned.set(task.id, concepts);
      for (const concept of concepts) seen.add(concept);
    }
  }
  const missing = required.filter((concept) => !seen.has(concept));
  if (missing.length && tasks.length) {
    const fallback = tasks.find((task) => task.expectedDeliverableType === "risk_summary" || task.intent === "configuration_review" || task.intent === "evidence_integrity") || tasks[tasks.length - 1];
    assigned.set(fallback.id, Array.from(new Set([...(assigned.get(fallback.id) || []), ...missing])));
  }
  return assigned;
}

function addAction(
  actions: Array<{ key: string; label: string; minutes: number; dimension: keyof LinuxLabWorkloadReport["dimensions"] }>,
  key: string,
  label: string,
  minutes: number,
  dimension: keyof LinuxLabWorkloadReport["dimensions"]
) {
  actions.push({ key, label, minutes, dimension });
}

function assertIndependentEstimateInput(input: Record<string, unknown>) {
  for (const key of ["requestedDifficulty", "requestedDurationMinutes", "difficulty", "duration", "targetDurationMinutes"]) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new Error(`LINUX_WORKLOAD_DURATION_ANCHORED_ESTIMATE: independent workload estimation cannot read ${key}.`);
    }
  }
}

export function estimateLinuxLearnerWorkload(input: {
  simulation: Pick<LinuxSimulationWorld,
    | "investigation"
    | "canonicalTasks"
    | "evidenceRegistry"
    | "planningEvidenceRegistry"
    | "events"
    | "commands"
    | "processes"
    | "services"
    | "serviceTransitions"
    | "cronDefinitions"
    | "scheduledExecutions"
    | "packageTransactions"
    | "openFileDescriptors"
  >;
  assets: LabAsset[];
}): LinuxIndependentWorkloadEstimate {
  assertIndependentEstimateInput(input as unknown as Record<string, unknown>);
  const registry = input.simulation.planningEvidenceRegistry?.length ? input.simulation.planningEvidenceRegistry : input.simulation.evidenceRegistry;
  const registryById = new Map(registry.map((asset) => [asset.id, asset]));
  const registryByPath = new Map(input.simulation.evidenceRegistry.map((asset) => [asset.path, asset]));
  const assetByPath = new Map(input.assets.map((asset) => [asset.file_path, asset]));
  const tasks = input.simulation.canonicalTasks.slice().sort((left, right) => left.order - right.order);
  const contractRemediationByTask = fallbackRemediationConceptsByTask(input.simulation);

  const selectedPaths = unique(tasks.flatMap((task) => selectedEvidence(task, registryById).map((asset) => asset.path))).sort();
  const selectedPathSet = new Set(selectedPaths);
  const relevantEvidenceLineCount = selectedPaths.reduce((total, path) => {
    const registryAsset = registryByPath.get(path);
    const task = tasks.find((candidate) => selectedEvidence(candidate, registryById).some((asset) => asset.path === path)) || tasks[0];
    return total + boundedRelevantLineCount(assetByPath.get(path), registryAsset, task);
  }, 0);
  const totalRenderedLineCount = input.assets.reduce((total, asset) => total + assetLineCount(asset), 0);
  const selectedActualLineCount = selectedPaths.reduce((total, path) => total + assetLineCount(assetByPath.get(path)), 0);
  const distractorEvidenceLineCount = Math.max(0, totalRenderedLineCount - relevantEvidenceLineCount + Math.max(0, selectedActualLineCount - relevantEvidenceLineCount));
  const relevantToNoiseRatio = Number((relevantEvidenceLineCount / Math.max(1, distractorEvidenceLineCount)).toFixed(3));

  const taskLocalSubjects = unique(tasks.flatMap((task) => [
    ...task.primarySubjectIds,
    ...task.supportingSubjectIds,
    ...task.requirements.flatMap((requirement) => requirement.subjectIds),
  ]));
  const taskLocalRelationships = unique(tasks.flatMap((task) => task.requirements.map((requirement) => requirement.relation).filter(Boolean) as string[]));
  const registrySubjects = unique(registry.flatMap((asset) => asset.canonicalObjectIds || []));
  const noiseOnlySubjectCount = registrySubjects.filter((id) => !taskLocalSubjects.includes(id)).length;
  const crossFileCorrelationCount = tasks.reduce((total, task) => total + Math.max(0, selectedEvidence(task, registryById).length - 1), 0);
  const timelineEventCount = tasks.reduce((total, task) => total + timelineActionCount(task, selectedEvidence(task, registryById)), 0);
  const expectedCommandCount = tasks.reduce((total, task) => total + commandActionCount(task), 0);
  const duplicateCount = duplicateWork(tasks, registryById);
  const actionTotals = {
    taskExecution: 0,
    evidenceNavigation: 0,
    evidenceReading: 0,
    crossSourceCorrelation: 0,
    timelineReasoning: 0,
    semanticReasoning: 0,
    ambiguityResolution: 0,
    deliverableConstruction: 0,
    remediationReasoning: 0,
    duplicatedWork: 0,
  };
  let learnerActionCount = 0;
  let remediationActionCount = 0;
  const chargedRemediationKeys = new Set<string>();
  const chargedNavigationPaths = new Set<string>();

  const taskEstimates = tasks.map((task, index) => {
    const evidence = selectedEvidence(task, registryById);
    const evidencePaths = unique(evidence.map((asset) => asset.path)).sort();
    const capabilityCount = new Set(task.requiredCapabilities).size;
    const relationCount = taskRelationshipCount(task);
    const currentStateCount = task.requiredCapabilities.filter((capability) => CURRENT_CAPABILITIES.has(capability)).length;
    const semanticCount = task.requiredCapabilities.filter((capability) => SEMANTIC_CAPABILITIES.has(capability)).length;
    const domainCount = task.requiredCapabilities.filter((capability) => DOMAIN_CAPABILITIES.has(capability)).length;
    const subjectCount = taskSubjectCount(task);
    const taskRelevantLines = evidencePaths.reduce((total, path) => total + boundedRelevantLineCount(assetByPath.get(path), registryByPath.get(path), task), 0);
    const taskActions: Array<{ key: string; label: string; minutes: number; dimension: keyof LinuxLabWorkloadReport["dimensions"] }> = [];
    addAction(taskActions, `task:${task.id}:read`, "read task question and identify requested finding", 0.95, "taskExecution");
    for (const path of evidencePaths) {
      if (!chargedNavigationPaths.has(path)) {
        addAction(taskActions, `evidence:${path}`, `locate ${path}`, 0.4, "evidenceNavigation");
        chargedNavigationPaths.add(path);
      }
      addAction(taskActions, `evidence:${path}:skim:${task.id}`, `scan relevant rows in ${path}`, Math.min(1.65, Math.max(0.4, boundedRelevantLineCount(assetByPath.get(path), registryByPath.get(path), task) / 28)), "evidenceReading");
    }
    if (evidencePaths.length > 1) {
      addAction(taskActions, `task:${task.id}:cross-source`, "compare selected evidence sources", (evidencePaths.length - 1) * 0.95, "crossSourceCorrelation");
    }
    if (relationCount) addAction(taskActions, `task:${task.id}:relations`, "join required canonical relationships", relationCount * 0.75, "crossSourceCorrelation");
    if (timelineActionCount(task, evidence)) addAction(taskActions, `task:${task.id}:timeline`, "place observed events in chronology", timelineActionCount(task, evidence) * 0.65, "timelineReasoning");
    if (semanticCount) addAction(taskActions, `task:${task.id}:semantic`, "interpret domain-specific evidence semantics", semanticCount * 0.45 + domainCount * 0.18, "semanticReasoning");
    if (currentStateCount) addAction(taskActions, `task:${task.id}:current-state`, "separate current-state evidence from historical evidence", currentStateCount * 0.9, "semanticReasoning");
    if (task.inquiryTypes.includes("risk_assessment") || task.intent === "evidence_integrity" || task.intent === "impact_assessment") {
      addAction(taskActions, `task:${task.id}:uncertainty`, "bound uncertainty and impact language", 1.2, "ambiguityResolution");
    }
    const requiredRemediationConcepts = contractRemediationByTask.get(task.id) || [];
    const remediationActions = remediationActionsForTask({
      task,
      taskIndex: index + 1,
      concepts: requiredRemediationConcepts,
    });
    const uniqueRemediationActions = unique(remediationActions.map((action) => action.dedupeKey))
      .map((key) => remediationActions.find((action) => action.dedupeKey === key)!)
      .filter(Boolean)
      .filter((action) => {
        if (chargedRemediationKeys.has(action.dedupeKey)) return false;
        chargedRemediationKeys.add(action.dedupeKey);
        return true;
      });
    if (uniqueRemediationActions.length === 0 && remediationActionWeight(task) > 0) {
      const genericCost = task.expectedDeliverableType === "containment_plan" ? 1.25 : 0.85;
      uniqueRemediationActions.push({
        concept: "generic_supported_remediation",
        action: "construct supported remediation or follow-up",
        costMinutes: genericCost,
        taskId: task.id,
        taskIndex: index + 1,
        carrier: remediationCarrier(task),
        carrierDeliverableType: task.expectedDeliverableType,
        dedupeKey: `generic_supported_remediation:${task.id}`,
      });
    }
    for (const action of uniqueRemediationActions) {
      addAction(taskActions, `task:${task.id}:remediation:${action.dedupeKey}`, action.action, action.costMinutes, "remediationReasoning");
    }
    if (uniqueRemediationActions.length > 0) {
      remediationActionCount += uniqueRemediationActions.length;
    }
    addAction(taskActions, `task:${task.id}:write`, "write the task deliverable", task.expectedDeliverableType === "containment_plan" ? 2.3 : task.expectedDeliverableType === "correlation_table" ? 1.85 : 1.35, "deliverableConstruction");
    if (subjectCount > 3) addAction(taskActions, `task:${task.id}:subjects`, "resolve task-local subject labels", Math.min(1.4, (subjectCount - 3) * 0.28), "taskExecution");
    for (const action of taskActions) actionTotals[action.dimension] += action.minutes;
    learnerActionCount += taskActions.length;
    const estimatedMinutes = Number(taskActions.reduce((total, action) => total + action.minutes, 0).toFixed(2));
    const requiredCorrelations = unique([
      ...task.requirements.map((requirement) => requirement.relation).filter(Boolean) as string[],
      ...task.requiredCapabilities.filter((capability) => SEMANTIC_CAPABILITIES.has(capability)),
    ]).sort();
    const sharedActionKeys = evidencePaths.map((path) => `evidence:${path}`);
    const reasons = [
      `${evidencePaths.length} task-local evidence source(s)`,
      `${capabilityCount} required capability/capabilities`,
      `${task.primarySubjectIds.length + task.supportingSubjectIds.length} subject reference(s)`,
      `${taskActions.length} learner action(s)`,
    ];
    if (currentStateCount) reasons.push(`${currentStateCount} current-state distinction(s)`);
    if (relationCount) reasons.push(`${relationCount} explicit relationship(s)`);
    if (requiredRemediationConcepts.length) reasons.push(`${requiredRemediationConcepts.length} required remediation concept(s)`);
    return {
      taskIndex: index + 1,
      intent: task.intent,
      investigationStage: taskStage(task),
      estimatedMinutes,
      expectedActionCount: taskActions.length,
      expectedActions: taskActions.map((action) => action.label),
      sharedActionKeys,
      relevantEvidencePaths: evidencePaths,
      requiredCorrelations,
      remediationActions: uniqueRemediationActions,
      reasons,
    };
  });

  const dimensions = {
    taskExecution: Number((actionTotals.taskExecution + 1.25 + (
      tasks[0]?.difficulty === "Beginner"
        ? Math.min(
            Math.max(0.55, 2.05 - tasks.length * 0.25),
            Math.max(0, taskLocalSubjects.length - 3) * 0.08
          )
        : 0
    )).toFixed(2)),
    evidenceNavigation: Number(actionTotals.evidenceNavigation.toFixed(2)),
    evidenceReading: Number((actionTotals.evidenceReading + Math.min(4, distractorEvidenceLineCount / 320)).toFixed(2)),
    crossSourceCorrelation: Number(actionTotals.crossSourceCorrelation.toFixed(2)),
    timelineReasoning: Number(actionTotals.timelineReasoning.toFixed(2)),
    semanticReasoning: Number(actionTotals.semanticReasoning.toFixed(2)),
    ambiguityResolution: Number(actionTotals.ambiguityResolution.toFixed(2)),
    deliverableConstruction: Number(actionTotals.deliverableConstruction.toFixed(2)),
    remediationReasoning: Number(actionTotals.remediationReasoning.toFixed(2)),
    duplicatedWork: Number((duplicateCount * 2.5).toFixed(2)),
  };

  const rawEffort = Object.values(dimensions).reduce((total, value) => total + value, 0) - dimensions.duplicatedWork;
  const estimatedDurationMinutes = Number(Math.max(8, rawEffort).toFixed(2));
  const totalEffortPoints = Number(rawEffort.toFixed(2));
  const synthesisTaskCount = taskEstimates.filter((task) =>
    task.relevantEvidencePaths.length >= 2 &&
    task.expectedActions.includes("compare selected evidence sources") &&
    (
      task.requiredCorrelations.length > 0 ||
      task.expectedActions.includes("place observed events in chronology") ||
      task.expectedActions.includes("separate current-state evidence from historical evidence") ||
      task.expectedActions.includes("interpret domain-specific evidence semantics")
    )
  ).length;
  const genuineJoinEstimates = taskEstimates.filter((task) =>
    task.relevantEvidencePaths.length >= 2 &&
    (
      task.requiredCorrelations.length > 0 ||
      ["scope_timeline", "change_control", "evidence_integrity", "command_process", "service_state", "package_transaction", "cron_analysis"].includes(task.intent || "")
    )
  );
  const genuineCrossSourceJoinCount = genuineJoinEstimates.reduce(
    (total, task) => total + Math.max(0, task.relevantEvidencePaths.length - 1),
    0
  );
  const nonIdentityCrossSourceJoinCount = genuineJoinEstimates
    .filter((task) => !["actor_attribution", "ssh_authentication", "key_provenance"].includes(task.intent || ""))
    .reduce((total, task) => total + Math.max(0, task.relevantEvidencePaths.length - 1), 0);
  const uncertaintyDecisionCount = linuxIncidentDifficultyCoverage(
    input.simulation.investigation?.incidentFamily,
    tasks[0]?.difficulty
  )?.requiredUncertaintyBoundaries.length || 0;
  const competingHypothesisDecisionCount = tasks.filter((task) => {
    if (task.difficulty !== "Advanced") return false;
    const capabilities = new Set([
      ...task.requiredCapabilities,
      ...task.requirements.map((requirement) => requirement.capability),
    ]);
    return capabilities.has("risk_context") && capabilities.has("command_execution") && selectedEvidence(task, registryById).length >= 2;
  }).length;

  const metrics = {
    taskCount: tasks.length,
    uniqueEvidencePathCount: selectedPaths.length,
    relevantEvidenceLineCount,
    distractorEvidenceLineCount,
    relevantToNoiseRatio,
    uniqueSubjectCount: taskLocalSubjects.length,
    relationshipCount: taskLocalRelationships.length,
    crossFileCorrelationCount,
    timelineEventCount,
    expectedCommandCount,
    learnerActionCount,
    remediationActionCount,
    taskLocalSubjectCount: taskLocalSubjects.length,
    taskLocalRelationshipCount: taskLocalRelationships.length,
    noiseOnlySubjectCount,
    renderedEvidenceAssetCount: input.assets.filter((asset) => asset.file_path.startsWith("assets/")).length,
    totalPackFileCount: input.assets.length,
    synthesisTaskCount,
    genuineCrossSourceJoinCount,
    nonIdentityCrossSourceJoinCount,
    uncertaintyDecisionCount,
    competingHypothesisDecisionCount,
  };

  return {
    version: LINUX_WORKLOAD_CALIBRATION_VERSION,
    estimatedDurationMinutes,
    totalEffortPoints,
    dimensions,
    taskEstimates,
    metrics,
  };
}

export function evaluateLinuxWorkloadContract(input: {
  estimate: LinuxIndependentWorkloadEstimate;
  simulation?: Pick<LinuxSimulationWorld, "investigation" | "canonicalTasks">;
  assets?: LabAsset[];
  requestedDifficulty?: string;
  requestedDurationMinutes?: number;
}): LinuxLabWorkloadReport {
  const requestedDifficulty = normalizeLinuxWorkloadDifficulty(input.requestedDifficulty || input.simulation?.canonicalTasks?.[0]?.difficulty);
  const requestedDurationMinutes = parseLinuxRequestedDurationMinutes(input.requestedDurationMinutes, requestedDifficulty === "Advanced" ? 60 : 30);
  const acceptableDurationRange = linuxWorkloadDurationRange(requestedDifficulty, requestedDurationMinutes);
  const report: LinuxLabWorkloadReport = {
    version: LINUX_WORKLOAD_CALIBRATION_VERSION,
    requestedDifficulty,
    requestedDurationMinutes,
    estimatedDurationMinutes: input.estimate.estimatedDurationMinutes,
    acceptableDurationRange,
    totalEffortPoints: input.estimate.totalEffortPoints,
    dimensions: input.estimate.dimensions,
    taskEstimates: input.estimate.taskEstimates,
    metrics: input.estimate.metrics,
    independentEstimate: input.estimate,
    issues: [],
  };
  report.issues = validateLinuxLabWorkloadReport(report, { simulation: input.simulation, assets: input.assets });
  return report;
}

export function buildLinuxLabWorkloadReport(input: {
  simulation: Parameters<typeof estimateLinuxLearnerWorkload>[0]["simulation"];
  assets: LabAsset[];
  requestedDifficulty?: string;
  requestedDurationMinutes?: number;
}): LinuxLabWorkloadReport {
  const estimate = estimateLinuxLearnerWorkload({ simulation: input.simulation, assets: input.assets });
  return evaluateLinuxWorkloadContract({
    estimate,
    simulation: input.simulation,
    assets: input.assets,
    requestedDifficulty: input.requestedDifficulty,
    requestedDurationMinutes: input.requestedDurationMinutes,
  });
}

export function linuxWorkloadReportHash(report: LinuxLabWorkloadReport) {
  return stableHash({
    ...report,
    issues: report.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      taskIndex: issue.taskIndex,
      evidence: issue.evidence,
    })),
  });
}

export function linuxWorkloadEstimateHash(estimate: LinuxIndependentWorkloadEstimate) {
  return stableHash(estimate);
}

export function validateLinuxLabWorkloadReport(
  report: LinuxLabWorkloadReport,
  input?: { simulation?: Pick<LinuxSimulationWorld, "investigation" | "canonicalTasks">; assets?: LabAsset[] }
): LinuxLabWorkloadIssue[] {
  const issues: LinuxLabWorkloadIssue[] = [];
  const add = (code: LinuxWorkloadIssueCode, severity: LinuxLabWorkloadIssue["severity"], message: string, taskIndex?: number, evidence?: string) => {
    issues.push({ code, severity, message, taskIndex, evidence });
  };
  if (!report || report.version !== LINUX_WORKLOAD_CALIBRATION_VERSION) {
    add("LINUX_WORKLOAD_REPORT_INVALID", "critical", "Workload report version is missing or unsupported.");
    return issues;
  }
  const range = report.acceptableDurationRange;
  if (range.minimumMinutes <= 0 || range.maximumMinutes <= range.minimumMinutes) {
    add("LINUX_WORKLOAD_UNSUPPORTED_DURATION", "critical", "Requested duration is outside supported Linux workload bounds.");
  }
  if (report.estimatedDurationMinutes < range.minimumMinutes) {
    add("LINUX_WORKLOAD_DURATION_UNDER_TARGET", "critical", `Estimated ${report.estimatedDurationMinutes} minutes is below ${range.minimumMinutes}.`);
  }
  if (report.estimatedDurationMinutes > range.maximumMinutes) {
    add("LINUX_WORKLOAD_DURATION_OVER_TARGET", "critical", `Estimated ${report.estimatedDurationMinutes} minutes exceeds ${range.maximumMinutes}.`);
  }
  if (report.independentEstimate && report.estimatedDurationMinutes !== report.independentEstimate.estimatedDurationMinutes) {
    add("LINUX_WORKLOAD_DURATION_ANCHORED_ESTIMATE", "critical", "Reported estimate differs from the independent learner-work estimate.");
  }
  const taskCount = report.metrics.taskCount;
  const taskBounds = linuxDurationTaskCountBounds(report.requestedDifficulty, report.requestedDurationMinutes);
  if (taskCount > taskBounds.max) add("LINUX_WORKLOAD_TASK_OVERLOAD", "critical", `${report.requestedDifficulty} workload has too many distinct canonical tasks for the requested duration.`);
  if (taskCount < taskBounds.min) add("LINUX_WORKLOAD_REPORT_INVALID", "critical", `${report.requestedDifficulty} workload has too few canonical tasks for the requested duration.`);
  if (report.requestedDifficulty === "Beginner" && report.metrics.crossFileCorrelationCount > 9) add("LINUX_WORKLOAD_CORRELATION_OVERLOAD", "critical", "Beginner workload requires excessive cross-file correlation.");
  if (
    report.requestedDifficulty === "Intermediate" &&
    (report.metrics.genuineCrossSourceJoinCount < 2 || report.metrics.nonIdentityCrossSourceJoinCount < 1)
  ) {
    add("LINUX_WORKLOAD_INSUFFICIENT_DEPTH", "critical", "Intermediate workload requires at least two genuine cross-source joins, including one beyond repeated identity lookup.");
  }
  if (report.requestedDifficulty === "Intermediate" && report.metrics.uncertaintyDecisionCount < 1) {
    add("LINUX_WORKLOAD_INSUFFICIENT_DEPTH", "critical", "Intermediate workload lacks a bounded uncertainty decision.");
  }
  if (report.requestedDifficulty === "Advanced" && taskCount < taskBounds.min) add("LINUX_WORKLOAD_INSUFFICIENT_DEPTH", "critical", "Advanced workload has insufficient task depth.");
  const advancedMinimumCorrelationCount = report.requestedDifficulty === "Advanced" && report.requestedDurationMinutes <= 30
    ? Math.max(4, report.metrics.taskCount)
    : 6;
  if (report.requestedDifficulty === "Advanced" && report.metrics.crossFileCorrelationCount < advancedMinimumCorrelationCount) add("LINUX_WORKLOAD_INSUFFICIENT_DEPTH", "critical", "Advanced workload lacks multi-source correlation depth.");
  if (
    report.requestedDifficulty === "Advanced" &&
    report.metrics.synthesisTaskCount < 3
  ) {
    add("LINUX_WORKLOAD_SYNTHESIS_MISSING", "critical", "Advanced workload relies on isolated lookups instead of cross-source synthesis.");
  }
  if (report.requestedDifficulty === "Advanced" && report.metrics.competingHypothesisDecisionCount < 1) {
    add("LINUX_WORKLOAD_INSUFFICIENT_DEPTH", "critical", "Advanced workload lacks a grounded competing-hypothesis decision.");
  }
  if (report.requestedDifficulty === "Advanced" && report.metrics.uncertaintyDecisionCount < 1) {
    add("LINUX_WORKLOAD_INSUFFICIENT_DEPTH", "critical", "Advanced workload lacks a bounded uncertainty judgment.");
  }
  if (
    report.requestedDifficulty === "Advanced" &&
    report.requestedDurationMinutes <= 30 &&
    (report.metrics.totalPackFileCount > 44 || report.metrics.renderedEvidenceAssetCount > 40)
  ) {
    add("LINUX_WORKLOAD_FILE_COUNT_INFLATION", "critical", "Focused Advanced workload uses excessive file volume instead of task-local synthesis.");
  }
  if (
    report.requestedDifficulty === "Advanced" &&
    report.requestedDurationMinutes >= 45 &&
    !report.taskEstimates.some((task) => /risk|impact|containment|remediation/i.test(`${task.intent || ""} ${task.investigationStage || ""}`))
  ) {
    add("LINUX_WORKLOAD_INSUFFICIENT_DEPTH", "critical", "Advanced workload lacks remediation, containment, or risk follow-through.");
  }
  if (report.metrics.uniqueEvidencePathCount > 24 && report.requestedDurationMinutes <= 30) add("LINUX_WORKLOAD_NAVIGATION_OVERLOAD", "critical", "Short-duration workload has excessive evidence navigation.");
  const overloadedNavigationTask = report.taskEstimates.find((task) => task.relevantEvidencePaths.length > 10);
  if (overloadedNavigationTask && report.requestedDurationMinutes <= 30) {
    add("LINUX_WORKLOAD_NAVIGATION_OVERLOAD", "critical", "Short-duration task requires excessive evidence navigation.", overloadedNavigationTask.taskIndex);
  }
  if (report.metrics.relevantEvidenceLineCount > 520 && report.requestedDurationMinutes <= 30) add("LINUX_WORKLOAD_EVIDENCE_OVERLOAD", "critical", "Short-duration workload has excessive relevant evidence volume.");
  const distractorEvidenceLineLimit = report.requestedDifficulty === "Advanced" && report.requestedDurationMinutes <= 30
    ? Math.max(710, report.metrics.relevantEvidenceLineCount * 10)
    : Math.max(650, report.metrics.relevantEvidenceLineCount * 10);
  if (report.metrics.distractorEvidenceLineCount > distractorEvidenceLineLimit) {
    add("LINUX_WORKLOAD_NOISE_PADDING", "critical", "Distractor evidence volume overwhelms relevant evidence.");
  }
  if (report.dimensions.duplicatedWork >= 2.5) add("LINUX_WORKLOAD_DUPLICATED_EFFORT", "high", "Workload estimate includes duplicated task effort.");
  if (report.dimensions.duplicatedWork >= 2.5) add("LINUX_WORKLOAD_SHARED_EFFORT_DOUBLE_COUNTED", "high", "Duplicate task signatures were detected and deducted from valuable workload.");
  if (report.taskEstimates.some((task) => task.relevantEvidencePaths.length === 0)) {
    const task = report.taskEstimates.find((item) => item.relevantEvidencePaths.length === 0);
    add("LINUX_WORKLOAD_REPORT_INVALID", "critical", "Task has no task-local evidence in workload report.", task?.taskIndex);
  }
  if (report.taskEstimates.some((task) => /unknown|unbounded/i.test(task.reasons.join(" ")))) {
    add("LINUX_WORKLOAD_UNBOUNDED_AMBIGUITY", "critical", "Workload includes unbounded ambiguity.");
  }
  if (input?.simulation?.canonicalTasks && input.simulation.canonicalTasks.length !== report.metrics.taskCount) {
    add("LINUX_WORKLOAD_REPORT_INVALID", "critical", "Workload report task count does not match canonical task set.");
  }
  if (input?.simulation) {
    const requiredRemediationConcepts = requiredRemediationConceptsForSimulation(input.simulation);
    const remediationActions = report.taskEstimates.flatMap((task) => task.remediationActions || []);
    const remediationConceptsWithActions = new Set(remediationActions.map((action) => action.concept));
    const remediationActionCosts = remediationActions.map((action) => action.costMinutes);
    const duplicateActionKeys = remediationActions
      .map((action) => action.dedupeKey)
      .filter((key, index, keys) => keys.indexOf(key) !== index);
    for (const concept of requiredRemediationConcepts) {
      if (!remediationConceptsWithActions.has(concept)) {
        add(
          "LINUX_WORKLOAD_REMEDIATION_ACTION_MISSING",
          "critical",
          `Incident coverage requires remediation concept ${concept}, but no canonical learner remediation action carries it.`
        );
      }
    }
    const missingCarrier = remediationActions.find((action) =>
      !Number.isInteger(action.taskIndex) ||
      action.taskIndex < 1 ||
      action.taskIndex > report.taskEstimates.length ||
      !action.taskId ||
      !action.carrierDeliverableType ||
      !report.taskEstimates[action.taskIndex - 1]?.expectedActions?.includes(action.action)
    );
    if (missingCarrier) {
      add(
        "LINUX_WORKLOAD_REMEDIATION_DELIVERABLE_MISSING",
        "critical",
        `Remediation action ${missingCarrier.action} is not carried by a task deliverable/action list.`,
        missingCarrier.taskIndex
      );
    }
    const invalidCost = remediationActions.find((action) =>
      !Number.isFinite(action.costMinutes) ||
      action.costMinutes < LINUX_MIN_REMEDIATION_ACTION_COST_MINUTES
    );
    if (invalidCost) {
      add(
        "LINUX_WORKLOAD_REMEDIATION_COST_INVALID",
        "critical",
        `Remediation action ${invalidCost.action} has invalid token cost ${invalidCost.costMinutes}; minimum legitimate action cost is ${LINUX_MIN_REMEDIATION_ACTION_COST_MINUTES}.`,
        invalidCost.taskIndex
      );
    }
    if (duplicateActionKeys.length > 0) {
      add(
        "LINUX_WORKLOAD_REMEDIATION_DOUBLE_COUNTED",
        "critical",
        `Remediation action was counted more than once: ${unique(duplicateActionKeys).join(",")}.`
      );
    }
    const actionCostTotal = Number(remediationActionCosts.reduce((total, value) => total + value, 0).toFixed(2));
    if (requiredRemediationConcepts.length > 0 && (report.dimensions.remediationReasoning <= 0 || actionCostTotal <= 0)) {
      add(
        "LINUX_WORKLOAD_REMEDIATION_UNCOUNTED",
        "critical",
        `Incident coverage requires remediation concepts that are absent from workload remediation effort: ${requiredRemediationConcepts.join(",")}.`
      );
    }
    if (requiredRemediationConcepts.length > 0 && actionCostTotal > 0 && report.dimensions.remediationReasoning < actionCostTotal) {
      add(
        "LINUX_WORKLOAD_REMEDIATION_UNCOUNTED",
        "critical",
        `Remediation workload dimension ${report.dimensions.remediationReasoning} is below the concrete learner action cost ${actionCostTotal}.`
      );
    }
  }
  if (input?.simulation?.canonicalTasks?.length) {
    const taskDifficulties = new Set(input.simulation.canonicalTasks.map((task) => task.difficulty));
    if (taskDifficulties.size > 0 && !taskDifficulties.has(report.requestedDifficulty)) {
      add("LINUX_WORKLOAD_DIFFICULTY_MISMATCH", "critical", "Requested workload difficulty does not match canonical task difficulty.");
    }
  }
  if (input?.assets) {
    const paths = new Set(input.assets.map((asset) => asset.file_path));
    const missing = report.taskEstimates.flatMap((task) => task.relevantEvidencePaths.filter((path) => !paths.has(path)));
    if (missing.length) add("LINUX_WORKLOAD_REPORT_INVALID", "critical", "Workload report references missing rendered evidence.", undefined, unique(missing).join("|"));
    const contentFingerprints = new Map<string, string[]>();
    for (const asset of input.assets) {
      const lineCount = assetLineCount(asset);
      if (lineCount < 20) continue;
      const fingerprint = stableHash(asset.content.replace(/\d+/g, "#").replace(/\s+/g, " ").trim());
      const pathsForContent = contentFingerprints.get(fingerprint) || [];
      pathsForContent.push(asset.file_path);
      contentFingerprints.set(fingerprint, pathsForContent);
    }
    const duplicatedContent = [...contentFingerprints.values()].find((pathsForContent) => pathsForContent.length > 1);
    if (duplicatedContent) {
      add("LINUX_WORKLOAD_VOLUME_GAMING", "critical", "Rendered evidence contains duplicate high-volume content.", undefined, duplicatedContent.join("|"));
    }
  }
  return issues;
}

export function checkLinuxLabWorkload(input: {
  simulation: LinuxSimulationWorld;
  assets: LabAsset[];
  requestedDifficulty?: string;
  requestedDurationMinutes?: number;
  expectedWorkloadEstimateHash?: string;
  expectedWorkloadReportHash?: string;
}): LinuxWorkloadValidationResult {
  const report = buildLinuxLabWorkloadReport(input);
  const issues = validateLinuxLabWorkloadReport(report, input);
  const workloadEstimateHash = linuxWorkloadEstimateHash(report.independentEstimate);
  const workloadReportHash = linuxWorkloadReportHash({ ...report, issues });
  if (input.expectedWorkloadEstimateHash && input.expectedWorkloadEstimateHash !== workloadEstimateHash) {
    issues.push({
      code: "LINUX_WORKLOAD_ESTIMATE_HASH_MISMATCH",
      severity: "critical",
      message: "Independent workload estimate hash no longer matches the previously validated candidate.",
    });
    issues.push({
      code: "LINUX_WORKLOAD_INPUT_MUTATED_AFTER_VALIDATION",
      severity: "critical",
      message: "Linux workload input changed after validation.",
    });
  }
  if (input.expectedWorkloadReportHash && input.expectedWorkloadReportHash !== workloadReportHash) {
    issues.push({
      code: "LINUX_WORKLOAD_REPORT_HASH_MISMATCH",
      severity: "critical",
      message: "Workload contract report hash no longer matches the previously validated candidate.",
    });
    if (!issues.some((issue) => issue.code === "LINUX_WORKLOAD_INPUT_MUTATED_AFTER_VALIDATION")) {
      issues.push({
        code: "LINUX_WORKLOAD_INPUT_MUTATED_AFTER_VALIDATION",
        severity: "critical",
        message: "Linux workload input changed after validation.",
      });
    }
  }
  return {
    passed: issues.filter((issue) => issue.severity === "critical" || issue.severity === "high").length === 0,
    report: { ...report, issues },
    workloadEstimateHash,
    workloadReportHash,
    issues,
  };
}
