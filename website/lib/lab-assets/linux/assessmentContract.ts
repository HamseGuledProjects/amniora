import type { LabAsset } from "../types";
import { stableHash } from "./deterministicRandom";
import { normalizeLinuxEvidencePath, type LinuxDifficulty } from "./difficultyProfile";
import { linuxIncidentCoverageContract, linuxIncidentDifficultyCoverage, type LinuxProhibitedConclusion, type LinuxRemediationConcept, type LinuxUncertaintyRequirement } from "./incidentCoverage";
import { proveTaskRequirements, type LinuxEvidenceRelationName, type LinuxEvidenceSupportLevel } from "./grounding";
import type { CanonicalEvidenceAsset, CanonicalEvidenceCapability, CanonicalInvestigationTask, LinuxSimulationWorld } from "./simulation";
import { linuxRemediationActionsForConcept } from "./workloadCalibration";
import { linuxMaintenanceApprovalDecision } from "./claimAuthority";

export const LINUX_ASSESSMENT_CONTRACT_VERSION = "linux-assessment-contract-v1.2";
export const LINUX_ASSESSMENT_QUALITY_VERSION = "linux-assessment-quality-v1.2";
export const LINUX_ASSESSMENT_MAX_POINTS = 100;

function basename(value: string) {
  return value.split("/").filter(Boolean).pop() || value;
}

export type LinuxAssessmentIssueCode =
  | "LINUX_ASSESSMENT_CONTRACT_MISSING"
  | "LINUX_ASSESSMENT_CONTRACT_INVALID"
  | "LINUX_ASSESSMENT_FINDING_UNSUPPORTED"
  | "LINUX_ASSESSMENT_EVIDENCE_MISSING"
  | "LINUX_ASSESSMENT_EVIDENCE_NOT_TASK_LOCAL"
  | "LINUX_ASSESSMENT_INCIDENT_COVERAGE_MISSING"
  | "LINUX_ASSESSMENT_UNCERTAINTY_MISSING"
  | "LINUX_ASSESSMENT_PROHIBITED_CLAIM_UNGRADED"
  | "LINUX_ASSESSMENT_REMEDIATION_MISSING"
  | "LINUX_ASSESSMENT_PARTIAL_CREDIT_OVERLAP"
  | "LINUX_ASSESSMENT_DUPLICATE_CREDIT"
  | "LINUX_ASSESSMENT_POINT_TOTAL_INVALID"
  | "LINUX_ASSESSMENT_WEIGHT_IMBALANCE"
  | "LINUX_ASSESSMENT_ANSWER_KEY_LEAK"
  | "LINUX_ASSESSMENT_MUTATED_AFTER_VALIDATION"
  | "LINUX_ASSESSMENT_HASH_MISMATCH";

export type LinuxAssessmentIssue = {
  code: LinuxAssessmentIssueCode;
  severity: "critical" | "high" | "medium" | "low";
  taskId?: string;
  evidencePath?: string;
  subjectId?: string;
  message: string;
};

export type LinuxExpectedAssessmentValue =
  | { kind: "identity"; identityId: string; username?: string; uid?: number }
  | { kind: "network"; sourceIp?: string; destinationIp?: string; sourcePort?: number; destinationPort?: number; protocol?: string }
  | { kind: "ssh_key"; fingerprint: string; accountId?: string }
  | { kind: "command"; commandId?: string; executable: string; argv?: string[]; normalizedCommand?: string }
  | { kind: "process"; processId?: string; pid?: number; parentPid?: number; executable?: string; userId?: string }
  | { kind: "file"; fileId?: string; path: string; owner?: string; mode?: string; state?: string }
  | { kind: "service"; serviceId?: string; unit: string; activeState?: string; enabledState?: string; result?: string }
  | { kind: "cron"; cronId?: string; schedule?: string; runAs?: string; command?: string; currentState?: string }
  | { kind: "package"; transactionId?: string; name: string; version?: string; action?: string; repository?: string }
  | { kind: "container"; containerId?: string; image?: string; mount?: string; runtimeState?: string }
  | { kind: "timestamp"; timestamp: string; timezone?: string; eventId?: string }
  | { kind: "relationship"; relation: string; sourceId: string; targetId: string }
  | { kind: "state"; objectId: string; value: string; timeScope: LinuxAssessmentFindingTimeScope }
  | { kind: "sequence"; orderedEventIds: string[] };

export type LinuxAssessmentFindingTimeScope =
  | "incident_window"
  | "collection_snapshot"
  | "historical_reconstruction"
  | "static_policy";

export type LinuxAssessmentContradiction = {
  id: string;
  description: string;
  expectedValue: LinuxExpectedAssessmentValue;
  contradicts: LinuxExpectedAssessmentValue;
};

export type LinuxAssessmentFinding = {
  id: string;
  taskId: string;
  canonicalSubjectIds: string[];
  capability: CanonicalEvidenceCapability;
  relationship?: LinuxEvidenceRelationName;
  expectedValue: LinuxExpectedAssessmentValue;
  timeScope: LinuxAssessmentFindingTimeScope;
  evidenceAssetIds: string[];
  evidencePaths: string[];
  support: LinuxEvidenceSupportLevel;
  inference: "direct" | "inferred";
  requiredConfidence: "observed" | "supported" | "candidate";
  allowedUncertainty: boolean;
  incidentQuestionIds: string[];
  partialCreditComponents: Array<{
    id: string;
    description: string;
    points: number;
  }>;
  sharedCreditRule?: "task_local_context" | "corroborating_context";
  contradictions: LinuxAssessmentContradiction[];
  contradictingFactIds: string[];
  unsupportedOverclaimIds: LinuxProhibitedConclusion[];
};

export type LinuxProhibitedClaim = {
  id: LinuxProhibitedConclusion;
  description: string;
  penaltyPoints: number;
};

export type LinuxAssessmentEvidenceRequirement = {
  id: string;
  findingId: string;
  taskId: string;
  evidenceAssetId: string;
  evidencePath: string;
  evidenceAssetIds: string[];
  evidencePaths: string[];
  mode: "all" | "any" | "minimum";
  minimumCount?: number;
  requiredAnchors: string[];
  requiredAnchorKinds: Array<LinuxExpectedAssessmentValue["kind"] | "event" | "relationship" | "task_local">;
  granularity: Array<"file_path" | "event" | "timestamp" | "pid" | "session" | "uid" | "unit" | "package" | "key" | "socket" | "relationship">;
  citationRules: string[];
};

export type LinuxUncertaintyAssessmentRequirement = {
  id: LinuxUncertaintyRequirement;
  taskId: string;
  rewardPoints: number;
  prohibitedCertainty: LinuxProhibitedConclusion[];
};

export type LinuxAssessmentRemediationRequirement = {
  id: string;
  concept: LinuxRemediationConcept;
  taskId: string;
  action: string;
  minimumQuality: "specific" | "evidence_preserving" | "verified";
  evidenceAssetIds: string[];
  points: number;
};

export type LinuxAssessmentPenaltyRule = {
  id: string;
  code: LinuxAssessmentIssueCode | "LINUX_ASSESSMENT_UNSUPPORTED_CERTAINTY";
  claimId?: LinuxProhibitedConclusion;
  points: number;
  floor: 0;
};

export type LinuxTaskAssessmentContract = {
  version: string;
  taskId: string;
  intent: CanonicalInvestigationTask["intent"];
  investigationStage: string;
  requiredFindings: LinuxAssessmentFinding[];
  optionalFindings: LinuxAssessmentFinding[];
  prohibitedClaims: LinuxProhibitedClaim[];
  uncertaintyRequirements: LinuxUncertaintyAssessmentRequirement[];
  evidenceRequirements: LinuxAssessmentEvidenceRequirement[];
  remediationRequirements: LinuxAssessmentRemediationRequirement[];
  scoring: {
    maximumPoints: number;
    findingPoints: number;
    evidencePoints: number;
    reasoningPoints: number;
    uncertaintyPoints: number;
    remediationPoints: number;
    penalties: LinuxAssessmentPenaltyRule[];
  };
};

export type LinuxAssessmentPackage = {
  version: string;
  maximumPoints: number;
  contracts: LinuxTaskAssessmentContract[];
  assessmentContractHash: string;
};

export type LinuxAssessmentQualityReport = {
  version: string;
  taskReports: Array<{
    taskId: string;
    intent: string;
    maximumPoints: number;
    requiredFindings: number;
    evidenceRequirements: number;
    uncertaintyRequirements: number;
    remediationRequirements: number;
    prohibitedClaims: number;
    issues: LinuxAssessmentIssue[];
  }>;
  totalPoints: number;
  findingCoverage: Array<{ id: string; taskId: string; supported: boolean; evidencePaths: string[] }>;
  evidenceCoverage: Array<{ id: string; taskId: string; exists: boolean; taskLocal: boolean; evidencePath: string }>;
  uncertaintyCoverage: Array<{ id: LinuxUncertaintyRequirement; taskIds: string[]; covered: boolean }>;
  remediationCoverage: Array<{ concept: LinuxRemediationConcept; taskIds: string[]; covered: boolean }>;
  prohibitedClaimCoverage: Array<{ id: LinuxProhibitedConclusion; taskIds: string[]; covered: boolean }>;
  issues: LinuxAssessmentIssue[];
  assessmentContractHash: string;
  assessmentQualityHash: string;
};

export type LinuxAssessmentSubmissionFinding = {
  findingId: string;
  subjectIds?: string[];
  relationship?: string;
  evidencePaths?: string[];
  confidence?: "observed" | "supported" | "candidate" | "certain";
};

export type LinuxAssessmentClaimConfidence = "observed" | "supported" | "candidate" | "certain";

export type LinuxAssessmentEvidenceCitation = {
  path: string;
  anchors?: string[];
  /**
   * Ignored by production scoring. Anchor kinds are resolved from the
   * canonical assessment evidence requirement, not learner/parser input.
   */
  anchorKinds?: string[];
  locator?: string;
};

export type LinuxAssessmentReasoningAssertionKind =
  | "relationship_supported_by_evidence"
  | "sources_corroborate_conclusion"
  | "current_state_differs_from_historical"
  | "attribution_limited"
  | "intent_not_proven"
  | "transfer_not_confirmed"
  | "timestamp_order_supports_sequence"
  | "configuration_state_supports_remediation";

export type LinuxAssessmentReasoning = {
  assertions: Array<{
    kind: LinuxAssessmentReasoningAssertionKind;
    evidencePaths?: string[];
    subjectIds?: string[];
  }>;
};

export type LinuxAssessmentUncertaintyAssertionKind =
  | "limit_attribution"
  | "intent_not_proven"
  | "transfer_not_confirmed"
  | "historical_not_current"
  | "execution_not_confirmed"
  | "scope_incomplete";

export type LinuxAssessmentUncertaintyAssertion = {
  kind: LinuxAssessmentUncertaintyAssertionKind;
  subjectId?: string;
  confidence: Extract<LinuxAssessmentClaimConfidence, "supported" | "candidate">;
  id?: string;
};

export type LinuxAssessmentConclusionAssertionKind =
  | "malicious_intent"
  | "exact_ssh_key"
  | "data_exfiltration"
  | "human_operator"
  | "historical_transition_from_current"
  | "repository_compromise"
  | "full_host_compromise"
  | "deleted_content_known";

export type LinuxAssessmentConclusionAssertion = {
  kind: LinuxAssessmentConclusionAssertionKind;
  confidence: LinuxAssessmentClaimConfidence;
  subjectId?: string;
};

export type LinuxAssessmentTypedClaim = {
  findingId?: string;
  value: LinuxExpectedAssessmentValue;
  relationship?: { relation: string; sourceId?: string; targetId?: string };
  timeScope?: LinuxAssessmentFindingTimeScope;
  evidence?: LinuxAssessmentEvidenceCitation[];
  confidence?: LinuxAssessmentClaimConfidence;
  reasoning?: LinuxAssessmentReasoning | string;
  conclusions?: LinuxAssessmentConclusionAssertion[];
};

export type LinuxAssessmentSubmission = {
  taskId: string;
  claims?: LinuxAssessmentTypedClaim[];
  uncertaintyStatements?: Array<{ id?: string; value?: string; confidence?: LinuxAssessmentClaimConfidence }>;
  uncertaintyAssertions?: LinuxAssessmentUncertaintyAssertion[];
  findings?: LinuxAssessmentSubmissionFinding[];
  uncertaintyIds?: string[];
  remediationActions?: string[];
  prohibitedClaimIds?: string[];
  contradictionIds?: string[];
};

export type LinuxAssessmentScoreReport = {
  taskId: string;
  maximumPoints: number;
  score: number;
  findingPoints: number;
  evidencePoints: number;
  reasoningPoints: number;
  uncertaintyPoints: number;
  remediationPoints: number;
  penalties: number;
  notes: string[];
  componentScores?: Array<{
    findingId: string;
    subjectPoints: number;
    valuePoints: number;
    relationshipPoints: number;
    timeScopePoints: number;
    evidenceCitationPoints: number;
    evidenceAnchorPoints: number;
    reasoningPoints: number;
    confidenceCompatible: boolean;
    contributionKeys: string[];
  }>;
};

export type LinuxAssessmentLabScoreReport = {
  maximumPoints: number;
  score: number;
  duplicateSuppressed: number;
  taskReports: LinuxAssessmentScoreReport[];
  notes: string[];
};

const PROHIBITED_DESCRIPTIONS: Record<LinuxProhibitedConclusion, string> = {
  malicious_intent_without_support: "Asserting malicious intent without direct supporting evidence.",
  exact_key_without_identifier: "Claiming a specific SSH key or fingerprint when the evidence does not identify it.",
  exfiltration_from_local_staging: "Claiming data exfiltration from local staging evidence alone.",
  human_operator_from_account_use: "Equating account use with a proven human operator.",
  historical_transition_from_current_state: "Using current state alone to prove a historical transition.",
  repository_compromise_from_package_install: "Inferring repository compromise from an installed package event alone.",
  full_host_compromise_from_container_mount: "Claiming full host compromise from container mount evidence alone.",
};

function canonicalJsonHash(value: unknown) {
  return stableHash(value);
}

function selectedAssets(task: CanonicalInvestigationTask, registry: CanonicalEvidenceAsset[]) {
  const byId = new Map(registry.map((asset) => [asset.id, asset]));
  return task.selectedEvidenceAssetIds.map((id) => byId.get(id)).filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset));
}

function assetPathSet(assets: LabAsset[]) {
  return new Set(assets.map((asset) => normalizeLinuxEvidencePath(asset.file_path)));
}

function taskStage(task: CanonicalInvestigationTask) {
  if (["ssh_authentication", "actor_attribution", "key_provenance"].includes(task.intent)) return "identify";
  if (["scope_timeline", "command_process", "cron_analysis", "package_transaction", "service_state", "network_source"].includes(task.intent)) return "reconstruct";
  if (["sudo_policy", "file_permissions", "configuration_review", "change_control", "evidence_integrity"].includes(task.intent)) return "compare";
  return "assess";
}

function timeScopeFor(task: CanonicalInvestigationTask, capability: CanonicalEvidenceCapability): LinuxAssessmentFinding["timeScope"] {
  if (capability.startsWith("current_")) return "collection_snapshot";
  if (task.inquiryTypes.includes("current_state")) return "collection_snapshot";
  if (["change_control", "maintenance_scope", "configuration_baseline"].includes(capability)) return "static_policy";
  return "historical_reconstruction";
}

function questionIdsForFinding(
  simulation: LinuxSimulationWorld,
  task: CanonicalInvestigationTask,
  capability: CanonicalEvidenceCapability
) {
  const contract = linuxIncidentCoverageContract(simulation.investigation.incidentFamily);
  if (!contract) return [];
  const capabilityMatches = (required: CanonicalEvidenceCapability) =>
    required === capability ||
    `current_${required}` === capability ||
    (required === "service_state" && capability === "current_service_state") ||
    (required === "configuration_baseline" && capability === "current_configuration_state");
  return Object.entries(contract.questionRequirements)
    .filter(([, requirement]) =>
      (requirement.taskIntents || []).includes(task.intent) ||
      (requirement.capabilities || []).some(capabilityMatches)
    )
    .map(([id]) => id);
}

function splitPoints(total: number, weights: number[]) {
  const sum = weights.reduce((value, item) => value + item, 0) || 1;
  const raw = weights.map((weight) => (total * weight) / sum);
  const floors = raw.map(Math.floor);
  let remaining = total - floors.reduce((value, item) => value + item, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const item of order) {
    if (remaining <= 0) break;
    floors[item.index] += 1;
    remaining -= 1;
  }
  return floors;
}

function distributeTaskPoints(tasks: CanonicalInvestigationTask[], remediationByTask: Map<string, number>, uncertaintyByTask: Map<string, number>) {
  const raw = tasks.map((task) =>
    10 +
    Math.max(1, task.requirements.length) * 4 +
    task.selectedEvidenceAssetIds.length * 2 +
    (remediationByTask.get(task.id) || 0) * 3 +
    (uncertaintyByTask.get(task.id) || 0) * 2 +
    (task.intent === "scope_timeline" ? 2 : 0)
  );
  return splitPoints(LINUX_ASSESSMENT_MAX_POINTS, raw);
}

function findTaskForConcept(
  simulation: LinuxSimulationWorld,
  concept: LinuxRemediationConcept,
  tasks: CanonicalInvestigationTask[]
) {
  const contract = linuxIncidentCoverageContract(simulation.investigation.incidentFamily);
  const requirement = contract
    ? Object.values(contract.questionRequirements).find((item) => item.remediation === concept)
    : undefined;
  const byIntent = requirement?.taskIntents
    ? tasks.find((task) => requirement.taskIntents?.includes(task.intent))
    : undefined;
  return byIntent || tasks.find((task) => ["change_control", "configuration_review", "sudo_policy", "service_state"].includes(task.intent)) || tasks[tasks.length - 1];
}

function findTaskForUncertainty(
  simulation: LinuxSimulationWorld,
  boundary: LinuxUncertaintyRequirement,
  tasks: CanonicalInvestigationTask[]
) {
  const contract = linuxIncidentCoverageContract(simulation.investigation.incidentFamily);
  const requirement = contract
    ? Object.values(contract.questionRequirements).find((item) => item.uncertainty === boundary)
    : undefined;
  const byIntent = requirement?.taskIntents
    ? tasks.find((task) => requirement.taskIntents?.includes(task.intent))
    : undefined;
  return byIntent || tasks.find((task) => ["evidence_integrity", "impact_assessment", "risk_assessment", "scope_timeline"].includes(task.intent)) || tasks[tasks.length - 1];
}

function difficultyCoverage(simulation: LinuxSimulationWorld) {
  return linuxIncidentDifficultyCoverage(simulation.investigation.incidentFamily, simulation.canonicalTasks[0]?.difficulty || "Advanced");
}

function buildAssignmentMaps(simulation: LinuxSimulationWorld) {
  const tasks = simulation.canonicalTasks;
  const coverage = difficultyCoverage(simulation);
  const remediation = new Map<string, LinuxRemediationConcept[]>();
  const uncertainty = new Map<string, LinuxUncertaintyRequirement[]>();
  for (const concept of coverage?.requiredRemediationConcepts || []) {
    const task = findTaskForConcept(simulation, concept, tasks);
    if (!task) continue;
    remediation.set(task.id, [...(remediation.get(task.id) || []), concept]);
  }
  for (const boundary of coverage?.requiredUncertaintyBoundaries || []) {
    const task = findTaskForUncertainty(simulation, boundary, tasks);
    if (!task) continue;
    uncertainty.set(task.id, [...(uncertainty.get(task.id) || []), boundary]);
  }
  return { remediation, uncertainty };
}

function normalizeComparable(value: string | undefined) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeCommandValue(value: string | undefined) {
  return normalizeComparable(value).replace(/^sudo\s+/, "");
}

function normalizeFileMode(mode: number | string | undefined) {
  if (mode === undefined) return undefined;
  if (typeof mode === "number") return (mode & 0o777).toString(8).padStart(4, "0");
  return String(mode).replace(/^0o?/, "").padStart(4, "0");
}

function identityUsername(simulation: LinuxSimulationWorld, identityId?: string) {
  return simulation.identities.find((identity) => identity.id === identityId)?.username;
}

function commandText(command: { executable?: string; argv?: string[]; renderedCommand?: string }) {
  return command.renderedCommand || [command.executable, ...(command.argv || [])].filter(Boolean).join(" ");
}

function findObjectById(simulation: LinuxSimulationWorld, id: string): { type: string; value: any } | undefined {
  const collections: Array<[string, any[]]> = [
    ["identity", simulation.identities],
    ["ssh_session", simulation.sshSessions],
    ["authentication", simulation.authenticationOrigins],
    ["identity_transition", simulation.identityTransitions],
    ["execution", simulation.executions],
    ["command", simulation.commands],
    ["process", simulation.processes],
    ["file", simulation.files],
    ["open_descriptor", simulation.openFileDescriptors],
    ["event", simulation.events],
    ["service", simulation.services],
    ["service_transition", simulation.serviceTransitions],
    ["timer", simulation.timers],
    ["cron", simulation.cronDefinitions],
    ["scheduled_execution", simulation.scheduledExecutions],
    ["package_transaction", simulation.packageTransactions],
    ["maintenance", simulation.maintenanceActivities],
  ];
  for (const [type, values] of collections) {
    const value = values.find((item) => item.id === id);
    if (value) return { type, value };
  }
  return undefined;
}

function expectedValueForObject(
  simulation: LinuxSimulationWorld,
  objectId: string,
  capability: CanonicalEvidenceCapability,
  timeScope: LinuxAssessmentFindingTimeScope
): LinuxExpectedAssessmentValue | undefined {
  const found = findObjectById(simulation, objectId);
  if (!found) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(objectId)) return { kind: "timestamp", timestamp: new Date(objectId).toISOString(), timezone: "UTC" };
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(objectId)) return { kind: "network", sourceIp: objectId };
    if (/^SHA256:/.test(objectId)) return { kind: "ssh_key", fingerprint: objectId };
    return undefined;
  }
  const { type, value } = found;
  if (type === "identity") return { kind: "identity", identityId: value.id, username: value.username, uid: value.uid };
  if (type === "ssh_session") {
    if (capability === "key_provenance" && value.keyFingerprint) return { kind: "ssh_key", fingerprint: value.keyFingerprint, accountId: value.identityId };
    return {
      kind: "network",
      sourceIp: value.sourceIp,
      sourcePort: value.sourcePort,
      destinationPort: value.destinationPort,
      protocol: "tcp",
    };
  }
  if (type === "authentication") {
    if (capability === "key_provenance" && value.keyFingerprint) return { kind: "ssh_key", fingerprint: value.keyFingerprint, accountId: value.identityId };
    return {
      kind: "network",
      sourceIp: value.sourceIp,
      sourcePort: value.sourcePort,
      destinationPort: value.destinationPort,
      protocol: "tcp",
    };
  }
  if (type === "command") {
    return {
      kind: "command",
      commandId: value.id,
      executable: value.executable,
      argv: value.argv,
      normalizedCommand: normalizeCommandValue(commandText(value)),
    };
  }
  if (type === "process") {
    return { kind: "process", processId: value.id, pid: value.pid, parentPid: value.ppid, executable: value.executable, userId: value.identityId };
  }
  if (type === "file") {
    return {
      kind: "file",
      fileId: value.id,
      path: value.path,
      owner: identityUsername(simulation, value.ownerIdentityId),
      mode: normalizeFileMode(value.mode),
      state: value.deletedAt ? "deleted" : "present",
    };
  }
  if (type === "open_descriptor") {
    if (value.targetKind === "socket") {
      return {
        kind: "network",
        sourceIp: value.localAddress,
        sourcePort: value.localPort,
        destinationIp: value.remoteAddress,
        destinationPort: value.remotePort,
        protocol: value.protocol,
      };
    }
    return { kind: "file", path: value.targetPath || value.targetId, state: value.state };
  }
  if (type === "event") return { kind: "timestamp", timestamp: new Date(value.timestamp).toISOString(), timezone: "UTC", eventId: value.id };
  if (type === "service") {
    return {
      kind: "service",
      serviceId: value.id,
      unit: value.unitName,
      activeState: value.activeState,
      enabledState: value.unitFileState,
      result: value.result,
    };
  }
  if (type === "service_transition") {
    return {
      kind: "state",
      objectId: value.serviceId,
      value: `${value.operation}:${value.previousState.activeState}->${value.resultingState.activeState}:${value.outcome}`,
      timeScope,
    };
  }
  if (type === "cron") {
    const command = simulation.commands.find((item) => item.id === value.commandId);
    return {
      kind: "cron",
      cronId: value.id,
      schedule: value.schedule,
      runAs: identityUsername(simulation, value.runAsIdentityId),
      command: command ? commandText(command) : value.commandId,
      currentState: value.persistenceState,
    };
  }
  if (type === "scheduled_execution") {
    const command = simulation.commands.find((item) => item.id === value.commandId);
    return {
      kind: "command",
      commandId: command?.id,
      executable: command?.executable || value.commandId,
      argv: command?.argv,
      normalizedCommand: normalizeCommandValue(command ? commandText(command) : value.commandId),
    };
  }
  if (type === "package_transaction") {
    const pkg = value.packages?.[0];
    return {
      kind: "package",
      transactionId: value.id,
      name: pkg?.name || value.id,
      version: pkg?.resultingVersion || pkg?.previousVersion,
      action: value.action,
      repository: pkg?.repository,
    };
  }
  if (type === "maintenance") {
    return { kind: "state", objectId: value.id, value: linuxMaintenanceApprovalDecision(value), timeScope: "static_policy" };
  }
  return undefined;
}

function deriveExpectedValue(input: {
  simulation: LinuxSimulationWorld;
  task: CanonicalInvestigationTask;
  capability: CanonicalEvidenceCapability;
  subjectIds: string[];
  relationship?: LinuxEvidenceRelationName;
  timeScope: LinuxAssessmentFindingTimeScope;
  selectedAssets: CanonicalEvidenceAsset[];
}): LinuxExpectedAssessmentValue {
  if (input.relationship && input.subjectIds.length >= 2) {
    return { kind: "relationship", relation: input.relationship, sourceId: input.subjectIds[0], targetId: input.subjectIds[1] };
  }
  for (const subjectId of input.subjectIds) {
    const value = expectedValueForObject(input.simulation, subjectId, input.capability, input.timeScope);
    if (value) return value;
  }
  if (input.capability === "timeline_exact") {
    const orderedEventIds = input.simulation.events
      .filter((event) => input.selectedAssets.some((asset) => asset.eventIds.includes(event.id)) || input.task.canonicalObjectIds.includes(event.id))
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .map((event) => event.id);
    if (orderedEventIds.length > 1) return { kind: "sequence", orderedEventIds };
  }
  for (const subjectId of input.selectedAssets.flatMap((asset) => asset.canonicalObjectIds)) {
    const value = expectedValueForObject(input.simulation, subjectId, input.capability, input.timeScope);
    if (value) return value;
  }
  const fallbackObjectId = input.subjectIds[0] || input.task.canonicalObjectIds[0] || `${input.task.id}:${input.capability}`;
  return { kind: "state", objectId: fallbackObjectId, value: `requires_${input.capability}`, timeScope: input.timeScope };
}

function requiredAnchorKindsFor(value: LinuxExpectedAssessmentValue, relationship?: LinuxEvidenceRelationName) {
  return Array.from(new Set<LinuxAssessmentEvidenceRequirement["requiredAnchorKinds"][number]>([
    value.kind,
    ...(value.kind === "timestamp" || value.kind === "sequence" ? ["event" as const] : []),
    ...(relationship || value.kind === "relationship" ? ["relationship" as const] : []),
    "task_local",
  ]));
}

function expectedValueContributionKey(value: LinuxExpectedAssessmentValue) {
  if (value.kind === "identity") return `${value.kind}:${value.identityId}:${normalizeComparable(value.username)}`;
  if (value.kind === "network") return `${value.kind}:${value.sourceIp || ""}:${value.sourcePort || ""}:${value.destinationIp || ""}:${value.destinationPort || ""}:${value.protocol || ""}`;
  if (value.kind === "ssh_key") return `${value.kind}:${value.fingerprint}:${value.accountId || ""}`;
  if (value.kind === "command") return `${value.kind}:${value.commandId || ""}:${normalizeCommandValue(value.normalizedCommand || [value.executable, ...(value.argv || [])].join(" "))}`;
  if (value.kind === "process") return `${value.kind}:${value.processId || ""}:${value.pid || ""}:${value.parentPid || ""}:${value.userId || ""}`;
  if (value.kind === "file") return `${value.kind}:${normalizeComparable(value.path)}:${normalizeComparable(value.state)}`;
  if (value.kind === "service") return `${value.kind}:${normalizeComparable(value.unit)}:${value.activeState || ""}:${value.enabledState || ""}`;
  if (value.kind === "cron") return `${value.kind}:${value.cronId || ""}:${value.schedule || ""}:${normalizeCommandValue(value.command)}`;
  if (value.kind === "package") return `${value.kind}:${value.transactionId || ""}:${normalizeComparable(value.name)}:${value.action || ""}:${value.version || ""}`;
  if (value.kind === "timestamp") return `${value.kind}:${normalizedTimestamp(value.timestamp)}:${value.eventId || ""}`;
  if (value.kind === "relationship") return `${value.kind}:${value.relation}:${value.sourceId}:${value.targetId}`;
  if (value.kind === "state") return `${value.kind}:${value.objectId}:${normalizeComparable(value.value)}:${value.timeScope}`;
  if (value.kind === "sequence") return `${value.kind}:${value.orderedEventIds.join(">")}`;
  return canonicalJsonHash(value);
}

function contradictionsForFinding(input: {
  finding: Omit<LinuxAssessmentFinding, "contradictions" | "contradictingFactIds">;
  assignedUncertainty: LinuxUncertaintyRequirement[];
}): LinuxAssessmentContradiction[] {
  const contradictions: LinuxAssessmentContradiction[] = [];
  const value = input.finding.expectedValue;
  for (const boundary of input.assignedUncertainty) {
    const contradictionValue: LinuxExpectedAssessmentValue = {
      kind: "state",
      objectId: input.finding.canonicalSubjectIds[0] || input.finding.id,
      value: `unsupported_certain_${boundary}`,
      timeScope: input.finding.timeScope,
    };
    contradictions.push({
      id: `contradiction:${input.finding.id}:${boundary}`,
      description: `The answer must not turn ${boundary} into a certain conclusion.`,
      expectedValue: value,
      contradicts: contradictionValue,
    });
  }
  if (input.finding.allowedUncertainty) {
    contradictions.push({
      id: `contradiction:${input.finding.id}:unsupported-certainty`,
      description: "Inferred or contextual support contradicts a certain conclusion.",
      expectedValue: value,
      contradicts: { kind: "state", objectId: input.finding.id, value: "certain_without_direct_support", timeScope: input.finding.timeScope },
    });
  }
  return contradictions;
}

function buildTaskContract(
  simulation: LinuxSimulationWorld,
  task: CanonicalInvestigationTask,
  registry: CanonicalEvidenceAsset[],
  maximumPoints: number,
  assignedRemediation: LinuxRemediationConcept[],
  assignedUncertainty: LinuxUncertaintyRequirement[]
): LinuxTaskAssessmentContract {
  const selected = selectedAssets(task, registry);
  const selectedById = new Map(selected.map((asset) => [asset.id, asset]));
  const proofs = proveTaskRequirements(task, selected);
  const prohibited = linuxIncidentCoverageContract(simulation.investigation.incidentFamily)?.prohibitedConclusions || [];
  const requiredFindings: LinuxAssessmentFinding[] = proofs.map((proof, index) => {
    const evidenceAssetIds = proof.satisfiedBy.map((item) => item.evidenceAssetId).filter((id) => selectedById.has(id));
    const support = proof.satisfiedBy[0]?.support || task.requirements[index]?.minimumSupport || "static";
    const timeScope = timeScopeFor(task, proof.capability as CanonicalEvidenceCapability);
    const expectedValue = deriveExpectedValue({
      simulation,
      task,
      capability: proof.capability as CanonicalEvidenceCapability,
      subjectIds: proof.requiredSubjectIds,
      relationship: proof.requiredRelation as LinuxEvidenceRelationName | undefined,
      timeScope,
      selectedAssets: selected,
    });
    const baseFinding = {
      id: `finding:${task.id}:${proof.requirementId}`,
      taskId: task.id,
      canonicalSubjectIds: proof.requiredSubjectIds,
      capability: proof.capability as CanonicalEvidenceCapability,
      relationship: proof.requiredRelation as LinuxEvidenceRelationName | undefined,
      expectedValue,
      timeScope,
      evidenceAssetIds,
      evidencePaths: evidenceAssetIds.map((id) => selectedById.get(id)?.path || id),
      support,
      inference: proof.requiredRelation ? "direct" : "inferred",
      requiredConfidence: support === "exact" ? "observed" : "supported",
      allowedUncertainty: support !== "exact",
      incidentQuestionIds: questionIdsForFinding(simulation, task, proof.capability as CanonicalEvidenceCapability),
      partialCreditComponents: [
        { id: `partial:${task.id}:${proof.requirementId}:subject`, description: "Correct canonical subject or object.", points: 1 },
        { id: `partial:${task.id}:${proof.requirementId}:relationship`, description: "Correct relationship, state, or mechanism.", points: 1 },
        { id: `partial:${task.id}:${proof.requirementId}:evidence`, description: "Relevant task-local evidence cited.", points: 1 },
      ],
      sharedCreditRule: proof.capability === "package_transaction" && simulation.investigation.incidentFamily === "unauthorized_package_install" &&
        (task.intent === "package_transaction" || task.intent === "change_control")
        ? "corroborating_context"
        : String(proof.capability).startsWith("current_") || proof.capability === "actor_attribution"
        ? "task_local_context"
        : ["authentication", "session_lifecycle", "timeline_exact", "timeline_context"].includes(String(proof.capability)) || task.intent === "scope_timeline"
          ? "corroborating_context"
          : undefined,
      unsupportedOverclaimIds: prohibited,
    } satisfies Omit<LinuxAssessmentFinding, "contradictions" | "contradictingFactIds">;
    const contradictions = contradictionsForFinding({ finding: baseFinding, assignedUncertainty });
    return {
      ...baseFinding,
      contradictions,
      contradictingFactIds: contradictions.map((contradiction) => contradiction.id),
    } satisfies LinuxAssessmentFinding;
  });
  const existingQuestions = new Set(requiredFindings.flatMap((finding) => finding.incidentQuestionIds));
  const familyContract = linuxIncidentCoverageContract(simulation.investigation.incidentFamily);
  if (familyContract) {
    for (const [questionId, question] of Object.entries(familyContract.questionRequirements)) {
      if (existingQuestions.has(questionId)) continue;
      if (question.taskIntents?.length && !question.taskIntents.includes(task.intent)) continue;
      const matchingCapability = (question.capabilities || []).find((capability) =>
        selected.some((asset) =>
          asset.capabilities.includes(capability) ||
          asset.capabilities.includes(`current_${capability}` as CanonicalEvidenceCapability) ||
          (capability === "service_state" && asset.capabilities.includes("current_service_state")) ||
          (capability === "configuration_baseline" && asset.capabilities.includes("current_configuration_state"))
        )
      );
      if (!matchingCapability) continue;
      const matchingAssets = selected.filter((asset) =>
        asset.capabilities.includes(matchingCapability) ||
        asset.capabilities.includes(`current_${matchingCapability}` as CanonicalEvidenceCapability) ||
        (matchingCapability === "service_state" && asset.capabilities.includes("current_service_state")) ||
        (matchingCapability === "configuration_baseline" && asset.capabilities.includes("current_configuration_state"))
      );
      if (matchingAssets.length === 0) continue;
      const timeScope = timeScopeFor(task, matchingCapability);
      const expectedValue = deriveExpectedValue({
        simulation,
        task,
        capability: matchingCapability,
        subjectIds: Array.from(new Set(matchingAssets.flatMap((asset) => asset.canonicalObjectIds))).slice(0, 8),
        timeScope,
        selectedAssets: matchingAssets,
      });
      const baseFinding = {
        id: `finding:${task.id}:incident-question:${questionId}`,
        taskId: task.id,
        canonicalSubjectIds: Array.from(new Set(matchingAssets.flatMap((asset) => asset.canonicalObjectIds))).slice(0, 8),
        capability: matchingCapability,
        relationship: undefined,
        expectedValue,
        timeScope,
        evidenceAssetIds: matchingAssets.map((asset) => asset.id),
        evidencePaths: matchingAssets.map((asset) => asset.path),
        support: matchingAssets[0].support || "static",
        inference: "inferred",
        requiredConfidence: matchingAssets[0].support === "exact" ? "observed" : "supported",
        allowedUncertainty: matchingAssets[0].support !== "exact",
        incidentQuestionIds: [questionId],
        partialCreditComponents: [
          { id: `partial:${task.id}:${questionId}:subject`, description: "Correct canonical subject or object.", points: 1 },
          { id: `partial:${task.id}:${questionId}:evidence`, description: "Relevant task-local evidence cited.", points: 1 },
        ],
        sharedCreditRule: "task_local_context",
        unsupportedOverclaimIds: prohibited,
      } satisfies Omit<LinuxAssessmentFinding, "contradictions" | "contradictingFactIds">;
      const contradictions = contradictionsForFinding({ finding: baseFinding, assignedUncertainty });
      requiredFindings.push({
        ...baseFinding,
        contradictions,
        contradictingFactIds: contradictions.map((contradiction) => contradiction.id),
      });
      existingQuestions.add(questionId);
    }
  }

  const evidenceRequirements = requiredFindings.map((finding) => {
    const assetsForFinding = finding.evidenceAssetIds.map((id) => selectedById.get(id)).filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset));
    const availableAnchors = new Set([
      ...assetsForFinding.map((asset) => asset.id),
      ...assetsForFinding.flatMap((asset) => asset.canonicalObjectIds || []),
      ...assetsForFinding.flatMap((asset) => asset.eventIds || []),
      ...assetsForFinding.flatMap((asset) => (asset.relations || []).flatMap((relation) => relation.subjectIds)),
    ]);
    const anchors = Array.from(new Set([
      ...finding.canonicalSubjectIds.filter((id) => availableAnchors.has(id)),
      ...assetsForFinding.flatMap((asset) => asset.eventIds || []),
      ...(finding.expectedValue.kind === "timestamp" && finding.expectedValue.eventId ? [finding.expectedValue.eventId] : []),
      ...(finding.expectedValue.kind === "sequence" ? finding.expectedValue.orderedEventIds : []),
      ...assetsForFinding.map((asset) => asset.id),
    ].filter((anchor) => availableAnchors.has(anchor)))).slice(0, 16);
    const directMinimum = Math.max(1, ...task.requirements.filter((requirement) => requirement.capability === finding.capability).map((requirement) => requirement.minimumAssetCount || 1));
    const minimumCount = Math.min(Math.max(1, directMinimum, finding.support === "exact" && assetsForFinding.length > 1 ? 2 : 1), Math.max(1, assetsForFinding.length));
    const mode: LinuxAssessmentEvidenceRequirement["mode"] = minimumCount > 1 ? "minimum" : "any";
    const asset = assetsForFinding[0];
    return {
      id: `evidence:${finding.id}:sources`,
      findingId: finding.id,
      taskId: task.id,
      evidenceAssetId: asset?.id || finding.evidenceAssetIds[0],
      evidencePath: asset?.path || finding.evidencePaths[0] || finding.evidenceAssetIds[0],
      evidenceAssetIds: finding.evidenceAssetIds,
      evidencePaths: finding.evidencePaths,
      mode,
      minimumCount,
      requiredAnchors: anchors,
      requiredAnchorKinds: requiredAnchorKindsFor(finding.expectedValue, finding.relationship),
      granularity: ["file_path", ...(finding.relationship ? ["relationship" as const] : []), ...(assetsForFinding.some((item) => item.exactTimestampSupport) ? ["timestamp" as const] : [])],
      citationRules: [
        "citation must name selected task evidence files",
        "citation anchors must identify supporting canonical subjects, events, or relationships",
        mode === "minimum" ? `at least ${minimumCount} corroborating evidence sources are required` : "any one listed direct source is sufficient",
      ],
    } satisfies LinuxAssessmentEvidenceRequirement;
  });

  const remediationRequirements = assignedRemediation.flatMap((concept) =>
    linuxRemediationActionsForConcept(concept).map((action, index) => ({
      id: `remediation:${task.id}:${concept}:${index + 1}`,
      concept,
      taskId: task.id,
      action: action.action,
      minimumQuality: index === 0 ? "evidence_preserving" : "specific",
      evidenceAssetIds: selected.slice(0, Math.max(1, Math.min(2, selected.length))).map((asset) => asset.id),
      points: 1,
    } satisfies LinuxAssessmentRemediationRequirement))
  );

  const uncertaintyRequirements = assignedUncertainty.map((id) => ({
    id,
    taskId: task.id,
    rewardPoints: 1,
    prohibitedCertainty: prohibited,
  } satisfies LinuxUncertaintyAssessmentRequirement));

  const scoringParts = splitPoints(maximumPoints, [
    Math.max(3, requiredFindings.length * 5),
    Math.max(2, evidenceRequirements.length * 3),
    Math.max(2, requiredFindings.length * 2),
    assignedUncertainty.length > 0 ? Math.max(assignedUncertainty.length, 1) : 0,
    remediationRequirements.length > 0 ? Math.max(remediationRequirements.length * 2, 2) : 0,
  ]);

  return {
    version: LINUX_ASSESSMENT_CONTRACT_VERSION,
    taskId: task.id,
    intent: task.intent,
    investigationStage: taskStage(task),
    requiredFindings,
    optionalFindings: [],
    prohibitedClaims: prohibited.map((id) => ({
      id,
      description: PROHIBITED_DESCRIPTIONS[id],
      penaltyPoints: Math.max(2, Math.floor(maximumPoints * 0.2)),
    })),
    uncertaintyRequirements,
    evidenceRequirements,
    remediationRequirements,
    scoring: {
      maximumPoints,
      findingPoints: scoringParts[0],
      evidencePoints: scoringParts[1],
      reasoningPoints: scoringParts[2],
      uncertaintyPoints: scoringParts[3],
      remediationPoints: scoringParts[4],
      penalties: prohibited.map((id) => ({
        id: `penalty:${task.id}:${id}`,
        code: "LINUX_ASSESSMENT_UNSUPPORTED_CERTAINTY",
        claimId: id,
        points: Math.max(2, Math.floor(maximumPoints * 0.2)),
        floor: 0,
      })),
    },
  };
}

export function buildLinuxAssessmentPackage(input: {
  simulation: LinuxSimulationWorld;
  assets?: LabAsset[];
}): LinuxAssessmentPackage {
  const { remediation, uncertainty } = buildAssignmentMaps(input.simulation);
  const taskPoints = distributeTaskPoints(
    input.simulation.canonicalTasks,
    new Map([...remediation.entries()].map(([taskId, concepts]) => [taskId, concepts.length])),
    new Map([...uncertainty.entries()].map(([taskId, boundaries]) => [taskId, boundaries.length]))
  );
  const contracts = input.simulation.canonicalTasks.map((task, index) =>
    buildTaskContract(
      input.simulation,
      task,
      input.simulation.evidenceRegistry,
      taskPoints[index],
      remediation.get(task.id) || [],
      uncertainty.get(task.id) || []
    )
  );
  const withoutHash = {
    version: LINUX_ASSESSMENT_CONTRACT_VERSION,
    maximumPoints: LINUX_ASSESSMENT_MAX_POINTS,
    contracts,
  };
  return {
    ...withoutHash,
    assessmentContractHash: canonicalJsonHash(withoutHash),
  };
}

function issue(
  issues: LinuxAssessmentIssue[],
  code: LinuxAssessmentIssueCode,
  message: string,
  taskId?: string,
  evidencePath?: string,
  severity: LinuxAssessmentIssue["severity"] = "critical"
) {
  issues.push({ code, severity, taskId, evidencePath, message });
}

function contractScoreTotal(contract: LinuxTaskAssessmentContract) {
  return contract.scoring.findingPoints +
    contract.scoring.evidencePoints +
    contract.scoring.reasoningPoints +
    contract.scoring.uncertaintyPoints +
    contract.scoring.remediationPoints;
}

function normalizedTimestamp(value: string | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? normalizeComparable(value) : parsed.toISOString();
}

function valueSubjectIds(value: LinuxExpectedAssessmentValue) {
  if (value.kind === "identity") return [value.identityId];
  if (value.kind === "ssh_key") return [value.accountId].filter(Boolean) as string[];
  if (value.kind === "command") return [value.commandId].filter(Boolean) as string[];
  if (value.kind === "process") return [value.processId, value.userId].filter(Boolean) as string[];
  if (value.kind === "file") return [value.fileId].filter(Boolean) as string[];
  if (value.kind === "service") return [value.serviceId].filter(Boolean) as string[];
  if (value.kind === "cron") return [value.cronId].filter(Boolean) as string[];
  if (value.kind === "package") return [value.transactionId].filter(Boolean) as string[];
  if (value.kind === "timestamp") return [value.eventId].filter(Boolean) as string[];
  if (value.kind === "relationship") return [value.sourceId, value.targetId];
  if (value.kind === "state") return [value.objectId];
  if (value.kind === "sequence") return value.orderedEventIds;
  return [];
}

function normalizedArray(values: string[] | undefined) {
  return (values || []).map(normalizeComparable);
}

function expectedValueMatches(expected: LinuxExpectedAssessmentValue, actual: LinuxExpectedAssessmentValue) {
  const result = {
    kind: expected.kind === actual.kind,
    subject: false,
    value: false,
    relationship: false,
    time: false,
  };
  if (!result.kind) return result;
  if (expected.kind === "identity" && actual.kind === "identity") {
    result.subject = expected.identityId === actual.identityId || normalizeComparable(expected.username) === normalizeComparable(actual.username);
    result.value = result.subject && (expected.uid === undefined || actual.uid === undefined || expected.uid === actual.uid);
  } else if (expected.kind === "network" && actual.kind === "network") {
    result.subject = [expected.sourceIp, expected.destinationIp].filter(Boolean).some((value) => [actual.sourceIp, actual.destinationIp].includes(value));
    result.value = ["sourceIp", "destinationIp", "sourcePort", "destinationPort", "protocol"].every((key) =>
      (expected as any)[key] === undefined || (actual as any)[key] === undefined || normalizeComparable(String((expected as any)[key])) === normalizeComparable(String((actual as any)[key]))
    );
  } else if (expected.kind === "ssh_key" && actual.kind === "ssh_key") {
    result.subject = !expected.accountId || !actual.accountId || expected.accountId === actual.accountId;
    result.value = normalizeComparable(expected.fingerprint) === normalizeComparable(actual.fingerprint);
  } else if (expected.kind === "command" && actual.kind === "command") {
    result.subject = !expected.commandId || !actual.commandId || expected.commandId === actual.commandId;
    const expectedCommand = normalizeCommandValue(expected.normalizedCommand || [expected.executable, ...(expected.argv || [])].join(" "));
    const actualCommand = normalizeCommandValue(actual.normalizedCommand || [actual.executable, ...(actual.argv || [])].join(" "));
    result.value = expectedCommand === actualCommand || normalizeComparable(expected.executable) === normalizeComparable(actual.executable);
  } else if (expected.kind === "process" && actual.kind === "process") {
    result.subject = (!!expected.processId && expected.processId === actual.processId) || (!!expected.pid && expected.pid === actual.pid);
    result.value = result.subject &&
      (expected.parentPid === undefined || actual.parentPid === undefined || expected.parentPid === actual.parentPid) &&
      (!expected.executable || !actual.executable || normalizeComparable(expected.executable) === normalizeComparable(actual.executable)) &&
      (!expected.userId || !actual.userId || expected.userId === actual.userId);
  } else if (expected.kind === "file" && actual.kind === "file") {
    result.subject = (!!expected.fileId && expected.fileId === actual.fileId) || normalizeComparable(expected.path) === normalizeComparable(actual.path);
    result.value = result.subject &&
      (!expected.owner || !actual.owner || normalizeComparable(expected.owner) === normalizeComparable(actual.owner)) &&
      (!expected.mode || !actual.mode || normalizeFileMode(expected.mode) === normalizeFileMode(actual.mode)) &&
      (!expected.state || !actual.state || normalizeComparable(expected.state) === normalizeComparable(actual.state));
  } else if (expected.kind === "service" && actual.kind === "service") {
    result.subject = (!!expected.serviceId && expected.serviceId === actual.serviceId) || normalizeComparable(expected.unit) === normalizeComparable(actual.unit);
    result.value = result.subject &&
      (!expected.activeState || !actual.activeState || expected.activeState === actual.activeState) &&
      (!expected.enabledState || !actual.enabledState || expected.enabledState === actual.enabledState) &&
      (!expected.result || !actual.result || expected.result === actual.result);
  } else if (expected.kind === "cron" && actual.kind === "cron") {
    result.subject = (!!expected.cronId && expected.cronId === actual.cronId) || normalizeCommandValue(expected.command) === normalizeCommandValue(actual.command);
    result.value = result.subject &&
      (!expected.schedule || !actual.schedule || normalizeComparable(expected.schedule) === normalizeComparable(actual.schedule)) &&
      (!expected.runAs || !actual.runAs || normalizeComparable(expected.runAs) === normalizeComparable(actual.runAs)) &&
      (!expected.currentState || !actual.currentState || expected.currentState === actual.currentState);
  } else if (expected.kind === "package" && actual.kind === "package") {
    result.subject = (!!expected.transactionId && expected.transactionId === actual.transactionId) || normalizeComparable(expected.name) === normalizeComparable(actual.name);
    result.value = result.subject &&
      (!expected.version || !actual.version || expected.version === actual.version) &&
      (!expected.action || !actual.action || expected.action === actual.action) &&
      (!expected.repository || !actual.repository || normalizeComparable(expected.repository) === normalizeComparable(actual.repository));
  } else if (expected.kind === "timestamp" && actual.kind === "timestamp") {
    result.subject = !expected.eventId || !actual.eventId || expected.eventId === actual.eventId;
    result.value = normalizedTimestamp(expected.timestamp) === normalizedTimestamp(actual.timestamp);
    result.time = result.value;
  } else if (expected.kind === "relationship" && actual.kind === "relationship") {
    result.subject = expected.sourceId === actual.sourceId && expected.targetId === actual.targetId;
    result.value = result.subject;
    result.relationship = result.subject && expected.relation === actual.relation;
  } else if (expected.kind === "state" && actual.kind === "state") {
    result.subject = expected.objectId === actual.objectId;
    result.value = result.subject && normalizeComparable(expected.value) === normalizeComparable(actual.value);
    result.time = expected.timeScope === actual.timeScope;
  } else if (expected.kind === "sequence" && actual.kind === "sequence") {
    result.subject = expected.orderedEventIds.some((id) => actual.orderedEventIds.includes(id));
    result.value = expected.orderedEventIds.length === actual.orderedEventIds.length &&
      expected.orderedEventIds.every((id, index) => actual.orderedEventIds[index] === id);
  } else if (expected.kind === "container" && actual.kind === "container") {
    result.subject = (!!expected.containerId && expected.containerId === actual.containerId) || (!!expected.image && normalizeComparable(expected.image) === normalizeComparable(actual.image));
    result.value = result.subject &&
      (!expected.mount || !actual.mount || normalizeComparable(expected.mount) === normalizeComparable(actual.mount)) &&
      (!expected.runtimeState || !actual.runtimeState || expected.runtimeState === actual.runtimeState);
  }
  result.time = result.time || result.value;
  return result;
}

function relationshipMatches(finding: LinuxAssessmentFinding, claim: LinuxAssessmentTypedClaim) {
  if (!finding.relationship) return true;
  if (claim.relationship?.relation === finding.relationship) {
    const expected = finding.expectedValue.kind === "relationship" ? finding.expectedValue : undefined;
    if (!expected) return true;
    return claim.relationship.sourceId === expected.sourceId && claim.relationship.targetId === expected.targetId;
  }
  if (claim.value.kind === "relationship" && finding.expectedValue.kind === "relationship") {
    return claim.value.relation === finding.expectedValue.relation &&
      claim.value.sourceId === finding.expectedValue.sourceId &&
      claim.value.targetId === finding.expectedValue.targetId;
  }
  return false;
}

function confidenceCompatible(finding: LinuxAssessmentFinding, claim: LinuxAssessmentTypedClaim) {
  const confidence = claim.confidence || "candidate";
  if (confidence === "certain" && (finding.allowedUncertainty || finding.requiredConfidence !== "observed")) return false;
  if (finding.requiredConfidence === "observed") return ["observed", "certain", "supported"].includes(confidence);
  if (finding.requiredConfidence === "supported") return ["supported", "candidate", "observed"].includes(confidence);
  return ["candidate", "supported"].includes(confidence);
}

function claimContradictsCanonical(finding: LinuxAssessmentFinding, claim: LinuxAssessmentTypedClaim) {
  if (claim.confidence === "certain" && finding.allowedUncertainty) return true;
  return finding.contradictions.some((contradiction) => {
    const match = expectedValueMatches(contradiction.contradicts, claim.value);
    return match.kind && match.subject && match.value &&
      (contradiction.contradicts.kind !== "relationship" || match.relationship);
  });
}

const PROHIBITED_CONCLUSION_KIND_BY_INCIDENT: Record<LinuxProhibitedConclusion, LinuxAssessmentConclusionAssertionKind> = {
  malicious_intent_without_support: "malicious_intent",
  exact_key_without_identifier: "exact_ssh_key",
  exfiltration_from_local_staging: "data_exfiltration",
  human_operator_from_account_use: "human_operator",
  historical_transition_from_current_state: "historical_transition_from_current",
  repository_compromise_from_package_install: "repository_compromise",
  full_host_compromise_from_container_mount: "full_host_compromise",
};

function claimOverclaims(contract: LinuxTaskAssessmentContract, claim: LinuxAssessmentTypedClaim) {
  const conclusions = claim.conclusions || [];
  return contract.prohibitedClaims.some((prohibited) => {
    const prohibitedKind = PROHIBITED_CONCLUSION_KIND_BY_INCIDENT[prohibited.id];
    return conclusions.some((conclusion) =>
      conclusion.kind === prohibitedKind &&
      conclusion.confidence !== "candidate"
    );
  });
}

function evidenceRequirementFor(contract: LinuxTaskAssessmentContract, finding: LinuxAssessmentFinding) {
  return contract.evidenceRequirements.find((requirement) => requirement.findingId === finding.id);
}

type LinuxAssessmentAnchorRecord = {
  assetId: string;
  path: string;
  anchor: string;
  anchorKind: LinuxAssessmentEvidenceRequirement["requiredAnchorKinds"][number];
  findingId: string;
  supportsValueKey: string;
  timeScope: LinuxAssessmentFindingTimeScope;
};

function anchorKindForValue(value: LinuxExpectedAssessmentValue, anchor: string): LinuxAssessmentEvidenceRequirement["requiredAnchorKinds"][number] {
  if (value.kind === "sequence" && value.orderedEventIds.includes(anchor)) return "event";
  if (value.kind === "timestamp" && value.eventId === anchor) return "event";
  if (value.kind === "relationship") {
    if (value.sourceId === anchor || value.targetId === anchor) return "relationship";
    return "relationship";
  }
  if (valueSubjectIds(value).includes(anchor)) return value.kind;
  return "task_local";
}

function canonicalAnchorRegistryForRequirement(
  requirement: LinuxAssessmentEvidenceRequirement | undefined,
  finding: LinuxAssessmentFinding | undefined
): LinuxAssessmentAnchorRecord[] {
  if (!requirement || !finding) return [];
  const valueKey = expectedValueContributionKey(finding.expectedValue);
  return requirement.evidenceAssetIds.flatMap((assetId, index) => {
    const path = requirement.evidencePaths[index] || requirement.evidencePath;
    return requirement.requiredAnchors.flatMap((anchor) => {
      const kinds = Array.from(new Set([
        anchorKindForValue(finding.expectedValue, anchor),
        ...requirement.requiredAnchorKinds.filter((kind) => kind !== "task_local"),
      ]));
      return kinds.map((anchorKind) => ({
        assetId,
        path,
        anchor,
        anchorKind,
        findingId: finding.id,
        supportsValueKey: valueKey,
        timeScope: finding.timeScope,
      }));
    });
  });
}

function citationSupport(
  requirement: LinuxAssessmentEvidenceRequirement | undefined,
  finding: LinuxAssessmentFinding | undefined,
  claim: LinuxAssessmentTypedClaim
) {
  if (!requirement) return { citationOk: false, anchorOk: false, count: 0, required: 1 };
  const allowedPaths = requirement.evidencePaths.map(normalizeLinuxEvidencePath);
  const allowedPathSet = new Set(allowedPaths);
  const resolveCitationPath = (value: string) => {
    const normalized = normalizeLinuxEvidencePath(value);
    if (allowedPathSet.has(normalized)) return normalized;
    const matches = allowedPaths.filter((candidate) => basename(candidate) === basename(normalized));
    return matches.length === 1 ? matches[0] : normalized;
  };
  const cited = (claim.evidence || [])
    .map((citation) => ({ citation, resolvedPath: resolveCitationPath(citation.path) }))
    .filter((item) => allowedPathSet.has(item.resolvedPath));
  const uniquePaths = new Set(cited.map((item) => item.resolvedPath));
  const required = requirement.mode === "all"
    ? requirement.evidencePaths.length
    : requirement.mode === "minimum"
      ? Math.max(1, requirement.minimumCount || 1)
      : 1;
  const countOk = uniquePaths.size >= Math.min(required, Math.max(1, requirement.evidencePaths.length));
  const registry = canonicalAnchorRegistryForRequirement(requirement, finding);
  const requiredKinds = new Set(requirement.requiredAnchorKinds.filter((kind) => kind !== "task_local"));
  const matchedRecords = cited.flatMap(({ citation, resolvedPath }) =>
    (citation.anchors || []).flatMap((anchor) =>
      registry.filter((record) =>
        record.anchor === anchor &&
        normalizeLinuxEvidencePath(record.path) === resolvedPath &&
        (!finding || record.findingId === finding.id) &&
        (!finding || record.supportsValueKey === expectedValueContributionKey(finding.expectedValue))
      )
    )
  );
  const matchedKinds = new Set(matchedRecords.map((record) => record.anchorKind));
  const anchorOk = matchedRecords.length > 0 && Array.from(requiredKinds).every((kind) => matchedKinds.has(kind) || kind === "relationship");
  return { citationOk: countOk, anchorOk, count: uniquePaths.size, required };
}

function reasoningAssertions(claim: LinuxAssessmentTypedClaim): LinuxAssessmentReasoningAssertionKind[] {
  if (!claim.reasoning || typeof claim.reasoning !== "object" || !Array.isArray(claim.reasoning.assertions)) return [];
  return claim.reasoning.assertions.map((assertion) => assertion.kind);
}

function reasoningSupportsFinding(finding: LinuxAssessmentFinding, claim: LinuxAssessmentTypedClaim, citation: ReturnType<typeof citationSupport>) {
  const assertions = new Set(reasoningAssertions(claim));
  if (assertions.size === 0) return false;
  if (finding.relationship || finding.expectedValue.kind === "relationship") {
    return assertions.has("relationship_supported_by_evidence");
  }
  if (finding.expectedValue.kind === "sequence" || finding.expectedValue.kind === "timestamp" || finding.capability.includes("timeline")) {
    return assertions.has("timestamp_order_supports_sequence");
  }
  if (finding.timeScope === "collection_snapshot") {
    return assertions.has("current_state_differs_from_historical") || assertions.has("configuration_state_supports_remediation");
  }
  if (citation.required > 1) return assertions.has("sources_corroborate_conclusion");
  if (finding.allowedUncertainty) {
    return assertions.has("attribution_limited") ||
      assertions.has("intent_not_proven") ||
      assertions.has("transfer_not_confirmed") ||
      assertions.has("current_state_differs_from_historical");
  }
  return assertions.has("relationship_supported_by_evidence") ||
    assertions.has("sources_corroborate_conclusion") ||
    assertions.has("configuration_state_supports_remediation");
}

function uncertaintyKindForBoundary(boundary: LinuxUncertaintyRequirement): LinuxAssessmentUncertaintyAssertionKind {
  switch (boundary) {
    case "account_use_not_human_operator":
    case "outbound_session_not_attacker_identity":
      return "limit_attribution";
    case "excessive_sudo_not_malicious_intent":
    case "scheduled_execution_not_malicious_intent":
    case "package_install_not_repository_compromise":
    case "container_mount_not_full_host_compromise":
      return "intent_not_proven";
    case "local_staging_not_exfiltration":
      return "transfer_not_confirmed";
    case "current_state_not_historical_transition":
      return "historical_not_current";
    case "exact_ssh_key_may_be_unavailable":
    case "log_gap_limits_confidence":
      return "scope_incomplete";
    default:
      return "scope_incomplete";
  }
}

function splitFindingComponentPoints(total: number, findings: LinuxAssessmentFinding[]) {
  const units = findings.map((finding) => ({
    subject: 1,
    value: 2,
    relationship: finding.relationship || finding.expectedValue.kind === "relationship" ? 2 : 0,
    time: finding.expectedValue.kind === "timestamp" || finding.expectedValue.kind === "sequence" || finding.timeScope !== "historical_reconstruction" ? 1 : 0,
  }));
  const weights = units.flatMap((unit) => [unit.subject, unit.value, unit.relationship, unit.time]);
  const points = splitPoints(total, weights);
  let index = 0;
  return units.map((unit) => {
    const value = {
      subject: unit.subject ? points[index] : 0,
      value: unit.value ? points[index + 1] : 0,
      relationship: unit.relationship ? points[index + 2] : 0,
      time: unit.time ? points[index + 3] : 0,
    };
    index += 4;
    return value;
  });
}

function validateLearnerBoundary(input: {
  package: LinuxAssessmentPackage;
  lab?: {
    title?: string;
    subtitle?: string;
    objective?: string;
    scenario?: string;
    tasks?: Array<{ phase?: string; title?: string; description?: string; deliverable?: string; evidence?: string[]; hint?: string; solution?: string }>;
    hints?: string[];
    outcomes?: string[];
    learningOutcomes?: string[];
  };
  assets: LabAsset[];
}, issues: LinuxAssessmentIssue[]) {
  const texts: Array<{ field: string; value: string }> = [];
  if (input.lab) {
    texts.push(
      { field: "title", value: input.lab.title || "" },
      { field: "subtitle", value: input.lab.subtitle || "" },
      { field: "objective", value: input.lab.objective || "" },
      { field: "scenario", value: input.lab.scenario || "" },
      ...((input.lab.hints || []).map((value, index) => ({ field: `hints[${index}]`, value }))),
      ...((input.lab.outcomes || input.lab.learningOutcomes || []).map((value, index) => ({ field: `outcomes[${index}]`, value }))),
      ...((input.lab.tasks || []).flatMap((task, index) => [
        { field: `tasks[${index}].phase`, value: task.phase || "" },
        { field: `tasks[${index}].title`, value: task.title || "" },
        { field: `tasks[${index}].description`, value: task.description || "" },
        { field: `tasks[${index}].deliverable`, value: task.deliverable || "" },
        { field: `tasks[${index}].hint`, value: task.hint || "" },
        { field: `tasks[${index}].solution`, value: task.solution || "" },
        { field: `tasks[${index}].evidence`, value: (task.evidence || []).join(" ") },
      ]))
    );
  }
  texts.push(...input.assets.map((asset) => ({ field: asset.file_path, value: asset.content })));
  const internalTokens = [
    input.package.assessmentContractHash,
    "assessmentContractHash",
    "assessmentQualityHash",
    "requiredFindings",
    "optionalFindings",
    "prohibitedClaims",
    "uncertaintyRequirements",
    "remediationRequirements",
    "partialCreditComponents",
    "scoring",
    "maximumPoints",
    "findingPoints",
    "evidencePoints",
    "reasoningPoints",
    "canonicalSubjectIds",
    "expectedValue",
    "accepted values",
    "rubric criteria",
  ];
  const findingTokens = input.package.contracts.flatMap((contract) => [
    contract.taskId,
    ...contract.requiredFindings.flatMap((finding) => [
      finding.id,
      ...finding.evidenceAssetIds.filter((id) => id.startsWith("assessment:")),
    ]),
    ...contract.prohibitedClaims.map((claim) => claim.id),
  ]);
  for (const { field, value } of texts) {
    if (!value) continue;
    for (const token of [...internalTokens, ...findingTokens]) {
      if (token && value.includes(token)) {
        issue(issues, "LINUX_ASSESSMENT_ANSWER_KEY_LEAK", `Student-visible content leaks assessment material ${token}.`, undefined, field);
      }
    }
  }
}

export function validateLinuxAssessmentPackage(input: {
  simulation: LinuxSimulationWorld;
  assets: LabAsset[];
  package?: LinuxAssessmentPackage;
  lab?: Parameters<typeof validateLearnerBoundary>[0]["lab"];
  expectedAssessmentContractHash?: string;
  expectedAssessmentQualityHash?: string;
}): LinuxAssessmentQualityReport {
  const assessmentPackage = input.package || buildLinuxAssessmentPackage({ simulation: input.simulation, assets: input.assets });
  const issues: LinuxAssessmentIssue[] = [];
  const registryById = new Map(input.simulation.evidenceRegistry.map((asset) => [asset.id, asset]));
  const taskById = new Map(input.simulation.canonicalTasks.map((task) => [task.id, task]));
  const rendered = assetPathSet(input.assets);
  const selectedByTask = new Map(input.simulation.canonicalTasks.map((task) => [task.id, new Set(task.selectedEvidenceAssetIds)]));
  const taskReports: LinuxAssessmentQualityReport["taskReports"] = [];
  const findingCoverage: LinuxAssessmentQualityReport["findingCoverage"] = [];
  const evidenceCoverage: LinuxAssessmentQualityReport["evidenceCoverage"] = [];
  const findingIds = new Set<string>();
  const partialIds = new Set<string>();
  const contributionKeys = new Map<string, LinuxAssessmentFinding>();

  if (assessmentPackage.contracts.length !== input.simulation.canonicalTasks.length) {
    issue(issues, "LINUX_ASSESSMENT_CONTRACT_MISSING", "Every canonical task must have one assessment contract.");
  }

  for (const task of input.simulation.canonicalTasks) {
    if (!assessmentPackage.contracts.some((contract) => contract.taskId === task.id)) {
      issue(issues, "LINUX_ASSESSMENT_CONTRACT_MISSING", `Task ${task.id} has no assessment contract.`, task.id);
    }
  }

  for (const contract of assessmentPackage.contracts) {
    const localIssues: LinuxAssessmentIssue[] = [];
    const task = taskById.get(contract.taskId);
    if (!task || contract.version !== LINUX_ASSESSMENT_CONTRACT_VERSION || contractScoreTotal(contract) !== contract.scoring.maximumPoints) {
      issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", "Assessment contract shape or score buckets are invalid.", contract.taskId);
    }
    if (contract.scoring.maximumPoints <= 0) {
      issue(localIssues, "LINUX_ASSESSMENT_WEIGHT_IMBALANCE", "Task assessment contract has no meaningful point value.", contract.taskId);
    }
    if (contract.requiredFindings.length > 0 && contract.scoring.findingPoints <= 0) {
      issue(localIssues, "LINUX_ASSESSMENT_WEIGHT_IMBALANCE", "Required findings have no meaningful score weight.", contract.taskId);
    }
    for (const finding of contract.requiredFindings) {
      if (findingIds.has(finding.id)) issue(localIssues, "LINUX_ASSESSMENT_DUPLICATE_CREDIT", `Duplicate finding id ${finding.id}.`, contract.taskId);
      findingIds.add(finding.id);
      const key = `${finding.capability}:${finding.relationship || ""}:${finding.canonicalSubjectIds.slice().sort().join("|")}`;
      const previous = contributionKeys.get(key);
      if (previous && !(previous.sharedCreditRule && finding.sharedCreditRule)) {
        issue(localIssues, "LINUX_ASSESSMENT_DUPLICATE_CREDIT", `Duplicate contribution ${key}.`, contract.taskId);
      }
      contributionKeys.set(key, finding);
      if (!finding.expectedValue || typeof finding.expectedValue !== "object" || !("kind" in finding.expectedValue)) {
        issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", `Finding ${finding.id} is missing a typed expected value.`, contract.taskId);
      } else {
        const expected = finding.expectedValue as LinuxExpectedAssessmentValue;
        const validKinds = new Set(["identity", "network", "ssh_key", "command", "process", "file", "service", "cron", "package", "container", "timestamp", "relationship", "state", "sequence"]);
        if (!validKinds.has((expected as any).kind)) {
          issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", `Finding ${finding.id} has no registered value comparator.`, contract.taskId);
        }
        const expectedText = (expected as any).value || (expected as any).objectId || (expected as any).relation || "";
        if (expected.kind === "state" && expectedText === finding.capability) {
          issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", `Finding ${finding.id} uses a capability name as the expected answer.`, contract.taskId);
        }
        if (expected.kind === "relationship" && (!expected.sourceId || !expected.targetId || !expected.relation)) {
          issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", `Finding ${finding.id} has a relationship answer without endpoints.`, contract.taskId);
        }
        if (expected.kind === "sequence" && expected.orderedEventIds.length < 2) {
          issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", `Finding ${finding.id} has no comparable sequence value.`, contract.taskId);
        }
      }
      const taskLocal = selectedByTask.get(contract.taskId) || new Set<string>();
      const supported = finding.evidenceAssetIds.some((id) => taskLocal.has(id));
      if (!supported) issue(localIssues, "LINUX_ASSESSMENT_FINDING_UNSUPPORTED", `Finding ${finding.id} is not supported by task-local evidence.`, contract.taskId);
      if (contract.uncertaintyRequirements.length > 0 && finding.allowedUncertainty && finding.contradictions.length === 0) {
        issue(localIssues, "LINUX_ASSESSMENT_UNCERTAINTY_MISSING", `Finding ${finding.id} has no contradiction model for uncertain support.`, contract.taskId);
      }
      for (const component of finding.partialCreditComponents) {
        if (partialIds.has(component.id)) issue(localIssues, "LINUX_ASSESSMENT_PARTIAL_CREDIT_OVERLAP", `Partial credit id ${component.id} is reused.`, contract.taskId);
        partialIds.add(component.id);
      }
      findingCoverage.push({
        id: finding.id,
        taskId: contract.taskId,
        supported,
        evidencePaths: finding.evidencePaths,
      });
    }
    for (const requirement of contract.evidenceRequirements) {
      const registryAsset = registryById.get(requirement.evidenceAssetId);
      const exists = Boolean(registryAsset && rendered.has(normalizeLinuxEvidencePath(registryAsset.path)));
      const taskLocal = Boolean((selectedByTask.get(contract.taskId) || new Set<string>()).has(requirement.evidenceAssetId));
      if (!exists) issue(localIssues, "LINUX_ASSESSMENT_EVIDENCE_MISSING", `Assessment evidence ${requirement.evidencePath} is missing from rendered assets.`, contract.taskId, requirement.evidencePath);
      if (!taskLocal) issue(localIssues, "LINUX_ASSESSMENT_EVIDENCE_NOT_TASK_LOCAL", `Assessment evidence ${requirement.evidencePath} is not selected by the task.`, contract.taskId, requirement.evidencePath);
      if (!requirement.mode || !["all", "any", "minimum"].includes(requirement.mode)) {
        issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", `Evidence requirement ${requirement.id} has no quantifier.`, contract.taskId, requirement.evidencePath);
      }
      if ((requirement.mode === "minimum" || requirement.mode === "all") && (!requirement.minimumCount || requirement.minimumCount < 2) && requirement.evidencePaths.length > 1) {
        issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", `Evidence requirement ${requirement.id} has an invalid corroboration count.`, contract.taskId, requirement.evidencePath);
      }
      const finding = contract.requiredFindings.find((item) => item.id === requirement.findingId);
      if (finding && finding.support === "exact" && requirement.evidencePaths.length > 1 && requirement.mode === "any") {
        issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", `Evidence requirement ${requirement.id} uses any where corroboration is required.`, contract.taskId, requirement.evidencePath);
      }
      if (requirement.requiredAnchors.length === 0) {
        issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", `Evidence requirement ${requirement.id} has no required anchor.`, contract.taskId, requirement.evidencePath);
      }
      const candidateAssetIds = requirement.evidenceAssetIds?.length ? requirement.evidenceAssetIds : [requirement.evidenceAssetId];
      const assetAnchors = new Set(candidateAssetIds.flatMap((id) => {
        const asset = registryById.get(id);
        return [
          id,
          ...(asset?.canonicalObjectIds || []),
          ...(asset?.eventIds || []),
          ...(asset?.relations || []).flatMap((relation) => relation.subjectIds),
        ];
      }));
      if (requirement.requiredAnchors.some((anchor) => !assetAnchors.has(anchor))) {
        issue(localIssues, "LINUX_ASSESSMENT_CONTRACT_INVALID", `Evidence requirement ${requirement.id} references an anchor absent from its assets.`, contract.taskId, requirement.evidencePath);
      }
      evidenceCoverage.push({ id: requirement.id, taskId: contract.taskId, exists, taskLocal, evidencePath: requirement.evidencePath });
    }
    taskReports.push({
      taskId: contract.taskId,
      intent: contract.intent,
      maximumPoints: contract.scoring.maximumPoints,
      requiredFindings: contract.requiredFindings.length,
      evidenceRequirements: contract.evidenceRequirements.length,
      uncertaintyRequirements: contract.uncertaintyRequirements.length,
      remediationRequirements: contract.remediationRequirements.length,
      prohibitedClaims: contract.prohibitedClaims.length,
      issues: localIssues,
    });
    issues.push(...localIssues);
  }

  const totalPoints = assessmentPackage.contracts.reduce((total, contract) => total + contract.scoring.maximumPoints, 0);
  if (totalPoints !== assessmentPackage.maximumPoints || totalPoints !== LINUX_ASSESSMENT_MAX_POINTS) {
    issue(issues, "LINUX_ASSESSMENT_POINT_TOTAL_INVALID", `Assessment points total ${totalPoints}; expected ${LINUX_ASSESSMENT_MAX_POINTS}.`);
  }

  const coverage = difficultyCoverage(input.simulation);
  const familyContract = linuxIncidentCoverageContract(input.simulation.investigation.incidentFamily);
  const totalRequiredFindings = assessmentPackage.contracts.reduce((total, contract) => total + contract.requiredFindings.length, 0);
  if (totalRequiredFindings === 0 && input.simulation.canonicalTasks.length > 0) {
    issue(issues, "LINUX_ASSESSMENT_INCIDENT_COVERAGE_MISSING", "Assessment package contains no required findings.");
  }
  const questionIdsForRemediation = (concept: LinuxRemediationConcept) =>
    familyContract
      ? Object.entries(familyContract.questionRequirements).filter(([, requirement]) => requirement.remediation === concept).map(([id]) => id)
      : [];
  const questionIdsForUncertainty = (boundary: LinuxUncertaintyRequirement) =>
    familyContract
      ? Object.entries(familyContract.questionRequirements).filter(([, requirement]) => requirement.uncertainty === boundary).map(([id]) => id)
      : [];
  const allQuestionIds = new Set([
    ...(totalRequiredFindings > 0 ? (coverage?.mandatoryQuestionIds || []) : []),
    ...assessmentPackage.contracts.flatMap((contract) => contract.requiredFindings.flatMap((finding) => finding.incidentQuestionIds)),
    ...(familyContract
      ? assessmentPackage.contracts.flatMap((contract) =>
          Object.entries(familyContract.questionRequirements)
            .filter(([, requirement]) => (requirement.taskIntents || []).includes(contract.intent))
            .map(([id]) => id)
        )
      : []),
    ...assessmentPackage.contracts.flatMap((contract) => contract.remediationRequirements.flatMap((requirement) => questionIdsForRemediation(requirement.concept))),
    ...assessmentPackage.contracts.flatMap((contract) => contract.uncertaintyRequirements.flatMap((requirement) => questionIdsForUncertainty(requirement.id))),
  ]);
  if ((coverage?.requiredUncertaintyBoundaries || []).length > 0 && familyContract) {
    for (const questionId of coverage?.mandatoryQuestionIds || []) {
      if (/_or_gap$/.test(questionId)) allQuestionIds.add(questionId);
    }
  }
  for (const questionId of coverage?.mandatoryQuestionIds || []) {
    if (!allQuestionIds.has(questionId)) issue(issues, "LINUX_ASSESSMENT_INCIDENT_COVERAGE_MISSING", `Mandatory incident question ${questionId} is not graded.`);
  }

  const uncertaintyCoverage = (coverage?.requiredUncertaintyBoundaries || []).map((id) => {
    const taskIds = assessmentPackage.contracts.filter((contract) => contract.uncertaintyRequirements.some((item) => item.id === id)).map((contract) => contract.taskId);
    if (taskIds.length === 0) issue(issues, "LINUX_ASSESSMENT_UNCERTAINTY_MISSING", `Required uncertainty boundary ${id} is not graded.`);
    return { id, taskIds, covered: taskIds.length > 0 };
  });

  const remediationCoverage = (coverage?.requiredRemediationConcepts || []).map((concept) => {
    const taskIds = assessmentPackage.contracts.filter((contract) => contract.remediationRequirements.some((item) => item.concept === concept)).map((contract) => contract.taskId);
    if (taskIds.length === 0) issue(issues, "LINUX_ASSESSMENT_REMEDIATION_MISSING", `Required remediation concept ${concept} is not graded.`);
    return { concept, taskIds, covered: taskIds.length > 0 };
  });

  const prohibited = familyContract?.prohibitedConclusions || [];
  const prohibitedClaimCoverage = prohibited.map((id) => {
    const taskIds = assessmentPackage.contracts.filter((contract) =>
      contract.scoring.penalties.some((penalty) => penalty.claimId === id)
    ).map((contract) => contract.taskId);
    if (taskIds.length === 0) issue(issues, "LINUX_ASSESSMENT_PROHIBITED_CLAIM_UNGRADED", `Prohibited claim ${id} has no penalty rule.`);
    return { id, taskIds, covered: taskIds.length > 0 };
  });

  validateLearnerBoundary({ package: assessmentPackage, lab: input.lab, assets: input.assets }, issues);

  const reportWithoutHash = {
    version: LINUX_ASSESSMENT_QUALITY_VERSION,
    taskReports,
    totalPoints,
    findingCoverage,
    evidenceCoverage,
    uncertaintyCoverage,
    remediationCoverage,
    prohibitedClaimCoverage,
    issues,
    assessmentContractHash: assessmentPackage.assessmentContractHash,
  };
  const assessmentQualityHash = canonicalJsonHash(reportWithoutHash);
  if (input.expectedAssessmentContractHash && input.expectedAssessmentContractHash !== assessmentPackage.assessmentContractHash) {
    issue(issues, "LINUX_ASSESSMENT_HASH_MISMATCH", "Assessment contract hash does not match the prevalidated value.");
    issue(issues, "LINUX_ASSESSMENT_MUTATED_AFTER_VALIDATION", "Assessment contract input changed after validation.");
  }
  if (input.expectedAssessmentQualityHash && input.expectedAssessmentQualityHash !== assessmentQualityHash) {
    issue(issues, "LINUX_ASSESSMENT_HASH_MISMATCH", "Assessment quality hash does not match the prevalidated value.");
    issue(issues, "LINUX_ASSESSMENT_MUTATED_AFTER_VALIDATION", "Assessment quality input changed after validation.");
  }
  return {
    ...reportWithoutHash,
    issues,
    assessmentQualityHash,
  };
}

export function checkLinuxAssessmentQuality(input: {
  simulation: LinuxSimulationWorld;
  assets: LabAsset[];
  lab?: Parameters<typeof validateLinuxAssessmentPackage>[0]["lab"];
  expectedAssessmentContractHash?: string;
  expectedAssessmentQualityHash?: string;
}) {
  const assessmentPackage = buildLinuxAssessmentPackage({ simulation: input.simulation, assets: input.assets });
  const report = validateLinuxAssessmentPackage({
    ...input,
    package: assessmentPackage,
  });
  return {
    passed: report.issues.length === 0,
    package: assessmentPackage,
    report,
    assessmentContractHash: assessmentPackage.assessmentContractHash,
    assessmentQualityHash: report.assessmentQualityHash,
  };
}

function privilegedSubmissionToClaims(contract: LinuxTaskAssessmentContract, submission: LinuxAssessmentSubmission): LinuxAssessmentSubmission {
  return {
    taskId: submission.taskId,
    claims: (submission.findings || []).flatMap((submitted) => {
      const finding = contract.requiredFindings.find((item) => item.id === submitted.findingId);
      if (!finding) return [];
      return [{
        value: finding.expectedValue,
        relationship: finding.relationship && finding.expectedValue.kind === "relationship"
          ? { relation: finding.relationship, sourceId: finding.expectedValue.sourceId, targetId: finding.expectedValue.targetId }
          : finding.relationship
            ? { relation: finding.relationship }
            : undefined,
        timeScope: finding.timeScope,
        evidence: (submitted.evidencePaths || []).map((path) => {
          const requirement = evidenceRequirementFor(contract, finding);
          return {
            path,
            anchors: requirement?.requiredAnchors || [],
          };
        }),
        confidence: submitted.confidence,
        reasoning: {
          assertions: [
            { kind: "relationship_supported_by_evidence" },
            { kind: "sources_corroborate_conclusion" },
            { kind: "timestamp_order_supports_sequence" },
            { kind: "configuration_state_supports_remediation" },
            { kind: "attribution_limited" },
            { kind: "intent_not_proven" },
            { kind: "transfer_not_confirmed" },
            { kind: "current_state_differs_from_historical" },
          ],
        },
      } satisfies LinuxAssessmentTypedClaim];
    }),
    uncertaintyAssertions: [
      "limit_attribution",
      "intent_not_proven",
      "transfer_not_confirmed",
      "historical_not_current",
      "execution_not_confirmed",
      "scope_incomplete",
    ].map((kind) => ({ kind: kind as LinuxAssessmentUncertaintyAssertionKind, confidence: "candidate" as const })),
    remediationActions: submission.remediationActions,
  };
}

function bestClaimForFinding(finding: LinuxAssessmentFinding, claims: LinuxAssessmentTypedClaim[], requirement?: LinuxAssessmentEvidenceRequirement) {
  let best: { claim: LinuxAssessmentTypedClaim; match: ReturnType<typeof expectedValueMatches>; relationshipOk: boolean; confidenceOk: boolean; score: number } | undefined;
  for (const claim of claims) {
    const match = expectedValueMatches(finding.expectedValue, claim.value);
    const relationshipOk = relationshipMatches(finding, claim);
    const confidenceOk = confidenceCompatible(finding, claim);
    const timeOk = claim.timeScope ? claim.timeScope === finding.timeScope : match.time;
    const citation = citationSupport(requirement, finding, claim);
    const score =
      (match.subject ? 2 : 0) +
      (match.value ? 3 : 0) +
      (relationshipOk ? 2 : 0) +
      (timeOk ? 1 : 0) +
      (citation.citationOk ? 2 : 0) +
      (citation.anchorOk ? 2 : 0) +
      (confidenceOk ? 1 : 0);
    if (!best || score > best.score) best = { claim, match: { ...match, time: timeOk }, relationshipOk, confidenceOk, score };
  }
  return best;
}

function normalizedRemediation(action: string) {
  return normalizeComparable(action).replace(/[^\w\s/.-]/g, "");
}

function remediationMatches(expected: string, actual: string) {
  return normalizedRemediation(expected) === normalizedRemediation(actual);
}

function scoreLinuxStructuredAssessmentSubmissionInternal(
  contract: LinuxTaskAssessmentContract,
  submission: LinuxAssessmentSubmission,
  options: { contributionKeys?: Set<string> } = {}
): LinuxAssessmentScoreReport {
  const notes: string[] = [];
  const claims = submission.claims || [];
  const componentScores: NonNullable<LinuxAssessmentScoreReport["componentScores"]> = [];
  const findingComponentPoints = splitFindingComponentPoints(contract.scoring.findingPoints, contract.requiredFindings);
  const evidenceCitationParts = splitPoints(contract.scoring.evidencePoints, contract.requiredFindings.flatMap(() => [1, 1]));
  const reasoningParts = splitPoints(contract.scoring.reasoningPoints, contract.requiredFindings.map(() => 1));
  let findingPoints = 0;
  let evidencePoints = 0;
  let reasoningPoints = 0;
  let penalties = 0;
  let evidenceIndex = 0;

  contract.requiredFindings.forEach((finding, index) => {
    const requirement = evidenceRequirementFor(contract, finding);
    const best = bestClaimForFinding(finding, claims, requirement);
    const findingParts = findingComponentPoints[index];
    const component = {
      findingId: finding.id,
      subjectPoints: 0,
      valuePoints: 0,
      relationshipPoints: 0,
      timeScopePoints: 0,
      evidenceCitationPoints: 0,
      evidenceAnchorPoints: 0,
      reasoningPoints: 0,
      confidenceCompatible: false,
      contributionKeys: [] as string[],
    };
    if (!best) {
      evidenceIndex += 2;
      componentScores.push(component);
      return;
    }
    const duplicateAware = (key: string, points: number, shared?: LinuxAssessmentFinding["sharedCreditRule"]) => {
      component.contributionKeys.push(key);
      if (!options.contributionKeys || shared === "corroborating_context") return points;
      if (options.contributionKeys.has(key)) {
        notes.push(`duplicate contribution suppressed: ${key}`);
        return 0;
      }
      options.contributionKeys.add(key);
      return points;
    };
    const valueKey = expectedValueContributionKey(finding.expectedValue);
    if (best.match.subject) {
      component.subjectPoints = duplicateAware(`subject:${valueKey}`, findingParts.subject, finding.sharedCreditRule);
      findingPoints += component.subjectPoints;
    }
    if (best.match.value) {
      component.valuePoints = duplicateAware(`value:${valueKey}`, findingParts.value, finding.sharedCreditRule);
      findingPoints += component.valuePoints;
    }
    if (best.relationshipOk) {
      component.relationshipPoints = duplicateAware(`relationship:${finding.relationship || valueKey}`, findingParts.relationship, finding.sharedCreditRule);
      findingPoints += component.relationshipPoints;
    }
    if (best.match.time || best.claim.timeScope === finding.timeScope) {
      component.timeScopePoints = duplicateAware(`time:${valueKey}:${finding.timeScope}`, findingParts.time, finding.sharedCreditRule);
      findingPoints += component.timeScopePoints;
    }
    const citation = citationSupport(requirement, finding, best.claim);
    const citationPoints = evidenceCitationParts[evidenceIndex] || 0;
    const anchorPoints = evidenceCitationParts[evidenceIndex + 1] || 0;
    evidenceIndex += 2;
    if (citation.citationOk) {
      component.evidenceCitationPoints = duplicateAware(`evidence:path:${finding.id}:${(best.claim.evidence || []).map((item) => normalizeLinuxEvidencePath(item.path)).sort().join("|")}`, citationPoints, finding.sharedCreditRule);
      evidencePoints += component.evidenceCitationPoints;
    }
    if (citation.anchorOk) {
      component.evidenceAnchorPoints = duplicateAware(`evidence:anchor:${finding.id}:${(best.claim.evidence || []).flatMap((item) => item.anchors || []).sort().join("|")}`, anchorPoints, finding.sharedCreditRule);
      evidencePoints += component.evidenceAnchorPoints;
    }
    component.confidenceCompatible = best.confidenceOk;
    const completeConclusion = best.match.subject && best.match.value && best.relationshipOk && (best.match.time || best.claim.timeScope === finding.timeScope);
    const completeEvidence = citation.citationOk && citation.anchorOk;
    if (completeConclusion && completeEvidence && best.confidenceOk && reasoningSupportsFinding(finding, best.claim, citation)) {
      component.reasoningPoints = duplicateAware(`reasoning:${valueKey}`, reasoningParts[index] || 0, finding.sharedCreditRule);
      reasoningPoints += component.reasoningPoints;
    }
    if (!best.confidenceOk) {
      const penalty = Math.max(1, Math.floor((contract.scoring.penalties[0]?.points || contract.scoring.maximumPoints * 0.2) / 2));
      penalties += penalty;
      notes.push(`unsupported certainty or incompatible confidence on ${finding.id}`);
    }
    if (claimContradictsCanonical(finding, best.claim)) {
      penalties += Math.max(1, Math.floor(contract.scoring.maximumPoints * 0.1));
      notes.push(`canonical contradiction detected on ${finding.id}`);
    }
    componentScores.push(component);
  });

  for (const claim of claims) {
    if (claimOverclaims(contract, claim)) {
      penalties += Math.max(1, Math.floor(contract.scoring.maximumPoints * 0.2));
      notes.push("prohibited overclaim detected from typed claim");
    }
  }

  const uncertaintyMatched = new Set<string>();
  for (const assertion of submission.uncertaintyAssertions || []) {
    const requirement = contract.uncertaintyRequirements.find((item) => uncertaintyKindForBoundary(item.id) === assertion.kind);
    if (requirement) uncertaintyMatched.add(requirement.id);
  }
  const uncertaintyPoints = Math.floor(contract.scoring.uncertaintyPoints * (uncertaintyMatched.size / Math.max(1, contract.uncertaintyRequirements.length)));

  const remediationMatched = new Set<string>();
  const remediationSubmitted = Array.from(new Set(submission.remediationActions || []));
  for (const action of remediationSubmitted) {
    const requirement = contract.remediationRequirements.find((item) => remediationMatches(item.action, action));
    if (requirement) remediationMatched.add(requirement.id);
  }
  const remediationPoints = Math.floor(contract.scoring.remediationPoints * (remediationMatched.size / Math.max(1, contract.remediationRequirements.length)));

  penalties = Math.min(findingPoints + evidencePoints + reasoningPoints + uncertaintyPoints + remediationPoints, penalties);
  const score = Math.max(0, Math.min(contract.scoring.maximumPoints, findingPoints + evidencePoints + reasoningPoints + uncertaintyPoints + remediationPoints - penalties));
  return {
    taskId: contract.taskId,
    maximumPoints: contract.scoring.maximumPoints,
    score,
    findingPoints,
    evidencePoints,
    reasoningPoints,
    uncertaintyPoints,
    remediationPoints,
    penalties,
    notes,
    componentScores,
  };
}

const TRUSTED_ASSESSMENT_FIXTURE_BOUNDARY = Symbol("trusted-assessment-fixture-boundary");

export function scoreLinuxTrustedFixtureAssessmentSubmission(
  contract: LinuxTaskAssessmentContract,
  submission: LinuxAssessmentSubmission,
  boundary: typeof TRUSTED_ASSESSMENT_FIXTURE_BOUNDARY
): LinuxAssessmentScoreReport {
  if (boundary !== TRUSTED_ASSESSMENT_FIXTURE_BOUNDARY) {
    throw new Error("LINUX_ASSESSMENT_TRUST_BOUNDARY: trusted fixture scoring adapter is not available to learner/API paths.");
  }
  return scoreLinuxStructuredAssessmentSubmissionInternal(contract, privilegedSubmissionToClaims(contract, submission));
}

export function scoreLinuxStructuredAssessmentSubmission(
  contract: LinuxTaskAssessmentContract,
  submission: LinuxAssessmentSubmission
): LinuxAssessmentScoreReport {
  return scoreLinuxStructuredAssessmentSubmissionInternal(contract, submission);
}

export function scoreLinuxAssessmentLabSubmission(
  assessmentPackage: LinuxAssessmentPackage,
  submissions: LinuxAssessmentSubmission[]
): LinuxAssessmentLabScoreReport {
  const contributionKeys = new Set<string>();
  const taskReports = assessmentPackage.contracts.map((contract) =>
    scoreLinuxStructuredAssessmentSubmissionInternal(
      contract,
      submissions.find((submission) => submission.taskId === contract.taskId) || { taskId: contract.taskId, claims: [] },
      { contributionKeys }
    )
  );
  const score = taskReports.reduce((total, report) => total + report.score, 0);
  const duplicateNotes = taskReports.flatMap((report) => report.notes.filter((note) => note.startsWith("duplicate contribution suppressed")));
  return {
    maximumPoints: assessmentPackage.maximumPoints,
    score: Math.max(0, Math.min(assessmentPackage.maximumPoints, score)),
    duplicateSuppressed: duplicateNotes.length,
    taskReports,
    notes: duplicateNotes,
  };
}
