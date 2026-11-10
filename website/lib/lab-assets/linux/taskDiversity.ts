import type { LabAsset } from "../types";
import { normalizeLinuxEvidencePath, type LinuxDifficulty } from "./difficultyProfile";
import { proveTaskRequirements } from "./grounding";
import {
  linuxIncidentCoverageContract,
  linuxIncidentDifficultyCoverage,
  type LinuxIncidentEvidenceRole,
} from "./incidentCoverage";
import { linuxTaskContract } from "./taskContracts";
import type {
  CanonicalEvidenceAsset,
  CanonicalEvidenceCapability,
  CanonicalInvestigationTask,
  LinuxSimulationWorld,
} from "./simulation";

export type LinuxInvestigationStage =
  | "identify"
  | "correlate"
  | "reconstruct"
  | "validate"
  | "scope"
  | "assess"
  | "respond";

export type LinuxTaskDiversityStatus = "diverse" | "redundant" | "invalid_progression";

export type LinuxTaskDiversityCode =
  | "LINUX_TASK_DUPLICATE_EXACT"
  | "LINUX_TASK_DUPLICATE_SEMANTIC"
  | "LINUX_TASK_NO_UNIQUE_CONTRIBUTION"
  | "LINUX_TASK_LOW_VALUE_GENERIC"
  | "LINUX_TASK_INVALID_PROGRESSION";

export type LinuxTaskContributionSignature = {
  taskId: string;
  order: number;
  intent: CanonicalInvestigationTask["intent"];
  stage: LinuxInvestigationStage;
  requiredCapabilities: CanonicalEvidenceCapability[];
  evidenceRoles: LinuxIncidentEvidenceRole[];
  selectedEvidencePaths: string[];
  incidentRequirementIds: string[];
  primarySubjectIds: string[];
  primaryRelationships: string[];
  expectedClaimKinds: string[];
  expectedDeliverableElements: string[];
  uncertaintyRequirements: string[];
  remediationConcepts: string[];
  reasoningObligations: string[];
};

export type LinuxTaskPairOverlap = {
  leftTaskId: string;
  rightTaskId: string;
  sharedIncidentRequirementIds: string[];
  sharedCapabilities: string[];
  sharedEvidenceRoles: string[];
  sharedEvidencePaths: string[];
  sharedSubjectIds: string[];
  sharedRelationships: string[];
  sharedClaimKinds: string[];
  semanticScore: number;
  distinctContributionSignals: string[];
};

export type LinuxTaskDiversityIssue = {
  code: LinuxTaskDiversityCode;
  severity: "critical";
  taskIds: string[];
  intents: string[];
  message: string;
  overlap?: LinuxTaskPairOverlap;
  missingUniqueSignals?: string[];
};

export type LinuxTaskDiversityReport = {
  difficulty: LinuxDifficulty;
  status: LinuxTaskDiversityStatus;
  signatures: LinuxTaskContributionSignature[];
  pairOverlaps: LinuxTaskPairOverlap[];
  issues: LinuxTaskDiversityIssue[];
};

const stageRank: Record<LinuxInvestigationStage, number> = {
  identify: 0,
  correlate: 1,
  reconstruct: 2,
  validate: 3,
  scope: 4,
  assess: 5,
  respond: 6,
};

const taskPathStages: Record<string, LinuxInvestigationStage[]> = {
  identity_led: ["identify", "correlate", "reconstruct", "validate", "scope", "assess", "respond"],
  timeline_led: ["reconstruct", "identify", "correlate", "validate", "scope", "assess", "respond"],
  control_led: ["validate", "correlate", "reconstruct", "identify", "scope", "assess", "respond"],
  runtime_led: ["reconstruct", "correlate", "validate", "identify", "scope", "assess", "respond"],
  ssh_key_rebalance: ["correlate", "identify", "reconstruct", "validate", "scope", "assess", "respond"],
};

function resolvedTaskPathStages(taskPath: string, variant = 0) {
  const base = taskPathStages[taskPath] || taskPathStages.identity_led;
  const investigativeStages = base.slice(0, 4);
  const offset = ((variant % investigativeStages.length) + investigativeStages.length) % investigativeStages.length;
  return [
    ...investigativeStages.slice(offset),
    ...investigativeStages.slice(0, offset),
    ...base.slice(4),
  ];
}

const roleCapabilities: Record<LinuxIncidentEvidenceRole, CanonicalEvidenceCapability[]> = {
  observed_authentication: ["authentication"],
  observed_privileged_command: ["sudo_authorisation", "command_execution"],
  effective_sudo_policy: ["sudo_authorisation", "configuration_baseline"],
  account_identity: ["actor_attribution"],
  service_transition: ["service_transition"],
  service_current_state: ["service_state", "current_service_state"],
  file_metadata: ["file_owner_group_mode"],
  process_execution: ["command_execution"],
  process_ancestry: ["process_ancestry"],
  scheduled_task_definition: ["cron_definition", "current_persistence_state"],
  scheduled_task_execution: ["cron_execution"],
  package_transaction: ["package_transaction"],
  change_record: ["change_control"],
  maintenance_window: ["maintenance_scope"],
  network_connection: ["network_source", "current_listener_state"],
  key_provenance: ["key_provenance"],
  configuration_baseline: ["configuration_baseline"],
  business_impact_context: ["risk_context"],
  timeline_sequence: ["timeline_exact", "timeline_context"],
  evidence_integrity: ["evidence_integrity", "timeline_context"],
};

const expectedClaimKinds: Record<CanonicalInvestigationTask["intent"], string[]> = {
  scope_timeline: ["timeline_sequence", "event_ordering", "time_boundary"],
  actor_attribution: ["identity_context", "account_role", "ownership_boundary"],
  ssh_authentication: ["authentication_result", "source_endpoint", "session_context"],
  key_provenance: ["key_identifier", "key_lifecycle", "provenance_gap"],
  sudo_policy: ["sudo_invocation", "sudo_rule", "privilege_boundary"],
  command_process: ["command_execution", "process_ancestry", "runtime_context"],
  file_permissions: ["file_owner", "file_mode", "access_boundary"],
  service_state: ["service_state", "service_transition", "unit_configuration"],
  package_transaction: ["package_operation", "package_version", "install_window"],
  cron_analysis: ["schedule_definition", "scheduled_execution", "persistence_boundary"],
  network_source: ["network_endpoint", "listener_state", "source_context"],
  configuration_review: ["configuration_baseline", "policy_boundary", "approved_state"],
  change_control: ["change_record", "maintenance_scope", "approval_boundary"],
  evidence_integrity: ["evidence_gap", "source_limit", "confidence_boundary"],
  impact_assessment: ["business_context", "affected_scope", "risk_boundary"],
  risk_assessment: ["risk_context", "likelihood_boundary", "control_gap"],
  containment_recommendation: ["containment_action", "validation_step", "least_privilege"],
};

const deliverableElements: Record<CanonicalInvestigationTask["expectedDeliverableType"], string[]> = {
  timeline: ["ordered_events", "timestamp_support", "evidence_reference"],
  correlation_table: ["subject", "relationship", "evidence_reference"],
  gap_assessment: ["known_fact", "unknown_fact", "validation_need"],
  policy_mapping: ["observed_action", "policy_source", "allowed_boundary"],
  evidence_notes: ["observation", "evidence_reference", "uncertainty"],
  risk_summary: ["impact", "likelihood", "business_context"],
  escalation_summary: ["finding", "supporting_evidence", "next_owner"],
  containment_plan: ["action", "condition", "validation_step"],
};

export function linuxInvestigationStageForIntent(intent: CanonicalInvestigationTask["intent"]): LinuxInvestigationStage {
  switch (intent) {
    case "ssh_authentication":
    case "key_provenance":
      return "identify";
    case "actor_attribution":
    case "network_source":
    case "change_control":
      return "correlate";
    case "scope_timeline":
    case "command_process":
    case "package_transaction":
    case "cron_analysis":
      return "reconstruct";
    case "sudo_policy":
    case "file_permissions":
    case "service_state":
    case "configuration_review":
    case "evidence_integrity":
      return "validate";
    case "impact_assessment":
    case "risk_assessment":
      return "assess";
    case "containment_recommendation":
      return "respond";
    default:
      return "validate";
  }
}

export function orderLinuxTasksByInvestigationStage(
  tasks: CanonicalInvestigationTask[],
  taskPath = "identity_led",
  variant = 0
) {
  const stages = resolvedTaskPathStages(taskPath, variant);
  const pathRank = new Map(stages.map((stage, index) => [stage, index]));
  const sshKeyRank: Record<string, number> = {
    change_control: 0, key_provenance: 1, ssh_authentication: 2, impact_assessment: 3,
  };
  return tasks
    .slice()
    .sort((left, right) => {
      if (taskPath === "ssh_key_rebalance") return (sshKeyRank[left.intent] ?? 99) - (sshKeyRank[right.intent] ?? 99);
      const leftStage = linuxInvestigationStageForIntent(left.intent);
      const rightStage = linuxInvestigationStageForIntent(right.intent);
      const rankDelta = (pathRank.get(leftStage) ?? stageRank[leftStage]) - (pathRank.get(rightStage) ?? stageRank[rightStage]);
      if (rankDelta) return rankDelta;
      const leftTie = (left.order + variant) % Math.max(1, tasks.length);
      const rightTie = (right.order + variant) % Math.max(1, tasks.length);
      return leftTie - rightTie || left.order - right.order;
    })
    .map((task, index) => ({
      ...task,
      id: `task:${index + 1}:${task.intent}`,
      order: index + 1,
    }));
}

function uniqueSorted<T extends string>(values: Array<T | undefined | null>) {
  return Array.from(new Set(values.filter((value): value is T => Boolean(value)))).sort();
}

function registryById(registry: CanonicalEvidenceAsset[]) {
  return new Map(registry.map((asset) => [asset.id, asset]));
}

function selectedAssets(task: CanonicalInvestigationTask, registry: CanonicalEvidenceAsset[]) {
  const byId = registryById(registry);
  return task.selectedEvidenceAssetIds
    .map((id) => byId.get(id))
    .filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset));
}

function selectedAssetPaths(task: CanonicalInvestigationTask, registry: CanonicalEvidenceAsset[]) {
  return uniqueSorted(selectedAssets(task, registry).map((asset) => normalizeLinuxEvidencePath(asset.path)));
}

function taskCapabilities(task: CanonicalInvestigationTask, _assets: CanonicalEvidenceAsset[]) {
  return uniqueSorted([
    ...task.requiredCapabilities,
    ...task.currentStateRequirements.map((requirement) => requirement.capability),
    ...task.requirements.map((requirement) => requirement.capability),
  ]);
}

function roleCoveredByCapabilities(role: LinuxIncidentEvidenceRole, capabilities: CanonicalEvidenceCapability[]) {
  return roleCapabilities[role].some((capability) => capabilities.includes(capability));
}

function taskEvidenceRoles(capabilities: CanonicalEvidenceCapability[]) {
  return (Object.keys(roleCapabilities) as LinuxIncidentEvidenceRole[])
    .filter((role) => roleCoveredByCapabilities(role, capabilities))
    .sort();
}

function relationshipKey(relation: { relation?: string; subjectIds?: string[] }) {
  return relation.relation ? `${relation.relation}:${uniqueSorted(relation.subjectIds || []).join("+")}` : undefined;
}

function taskRelationships(task: CanonicalInvestigationTask, _assets: CanonicalEvidenceAsset[]) {
  return uniqueSorted([
    ...task.requirements.map((requirement) => relationshipKey(requirement)),
    ...task.currentStateRequirements.map((requirement) => relationshipKey(requirement)),
  ]);
}

function taskSubjects(task: CanonicalInvestigationTask, _assets: CanonicalEvidenceAsset[]) {
  return uniqueSorted([
    ...task.primarySubjectIds,
    ...task.requirements.flatMap((requirement) => requirement.subjectIds),
    ...task.currentStateRequirements.flatMap((requirement) => requirement.subjectIds),
  ]).slice(0, 48);
}

function taskIncidentRequirementIds(
  simulation: LinuxSimulationWorld | undefined,
  difficulty: LinuxDifficulty,
  task: CanonicalInvestigationTask
) {
  if (!simulation) return [];
  const contract = linuxIncidentCoverageContract(simulation.investigation.incidentFamily);
  const difficultyCoverage = linuxIncidentDifficultyCoverage(simulation.investigation.incidentFamily, difficulty);
  if (!contract || !difficultyCoverage) return [];
  const requirements = Object.values(contract.questionRequirements)
    .filter((requirement) => difficultyCoverage.mandatoryQuestionIds.includes(requirement.id))
    .filter((requirement) => (requirement.taskIntents || []).includes(task.intent))
    .filter((requirement) => {
      const requiredCapabilities = requirement.capabilities || [];
      return requiredCapabilities.length === 0 || requiredCapabilities.some((capability) => task.requiredCapabilities.includes(capability));
    })
    .map((requirement) => requirement.id);
  const intentIds = difficultyCoverage.mandatoryTaskIntents.includes(task.intent) ? [`intent:${task.intent}`] : [];
  return uniqueSorted([...requirements, ...intentIds]);
}

function taskUncertaintyRequirements(simulation: LinuxSimulationWorld | undefined, difficulty: LinuxDifficulty, task: CanonicalInvestigationTask) {
  const contract = simulation ? linuxIncidentCoverageContract(simulation.investigation.incidentFamily) : undefined;
  const difficultyCoverage = simulation ? linuxIncidentDifficultyCoverage(simulation.investigation.incidentFamily, difficulty) : undefined;
  if (!contract || !difficultyCoverage) return [];
  return uniqueSorted(Object.values(contract.questionRequirements)
    .filter((requirement) => requirement.uncertainty && difficultyCoverage.requiredUncertaintyBoundaries.includes(requirement.uncertainty))
    .filter((requirement) => (requirement.taskIntents || []).includes(task.intent))
    .map((requirement) => requirement.uncertainty));
}

function taskRemediationConcepts(simulation: LinuxSimulationWorld | undefined, difficulty: LinuxDifficulty, task: CanonicalInvestigationTask) {
  const contract = simulation ? linuxIncidentCoverageContract(simulation.investigation.incidentFamily) : undefined;
  const difficultyCoverage = simulation ? linuxIncidentDifficultyCoverage(simulation.investigation.incidentFamily, difficulty) : undefined;
  if (!contract || !difficultyCoverage) return [];
  return uniqueSorted(Object.values(contract.questionRequirements)
    .filter((requirement) => requirement.remediation && difficultyCoverage.requiredRemediationConcepts.includes(requirement.remediation))
    .filter((requirement) => (requirement.taskIntents || []).includes(task.intent))
    .map((requirement) => requirement.remediation));
}

export function buildLinuxTaskContributionSignatures(input: {
  simulation?: LinuxSimulationWorld;
  tasks?: CanonicalInvestigationTask[];
  registry?: CanonicalEvidenceAsset[];
  difficulty?: LinuxDifficulty;
}): LinuxTaskContributionSignature[] {
  const tasks = (input.tasks || input.simulation?.canonicalTasks || []).slice().sort((left, right) => left.order - right.order);
  const registry = input.registry || input.simulation?.planningEvidenceRegistry || input.simulation?.evidenceRegistry || [];
  const difficulty = input.difficulty || tasks[0]?.difficulty || "Advanced";
  return tasks.map((task) => {
    const assets = selectedAssets(task, registry);
    const capabilities = taskCapabilities(task, assets);
    const contract = linuxTaskContract(task.intent);
    return {
      taskId: task.id,
      order: task.order,
      intent: task.intent,
      stage: linuxInvestigationStageForIntent(task.intent),
      requiredCapabilities: capabilities,
      evidenceRoles: taskEvidenceRoles(capabilities),
      selectedEvidencePaths: selectedAssetPaths(task, registry),
      incidentRequirementIds: taskIncidentRequirementIds(input.simulation, difficulty, task),
      primarySubjectIds: taskSubjects(task, assets),
      primaryRelationships: taskRelationships(task, assets),
      expectedClaimKinds: uniqueSorted(expectedClaimKinds[task.intent]),
      expectedDeliverableElements: uniqueSorted([
        ...deliverableElements[task.expectedDeliverableType],
        contract.expectedDeliverableType,
      ]),
      uncertaintyRequirements: taskUncertaintyRequirements(input.simulation, difficulty, task),
      remediationConcepts: taskRemediationConcepts(input.simulation, difficulty, task),
      reasoningObligations: uniqueSorted([...task.requirements, ...task.currentStateRequirements].map((requirement) =>
        `${requirement.capability}:${requirement.relation || "none"}:${requirement.minimumSupport}:${uniqueSorted(requirement.subjectIds).join("+")}`)),
    };
  });
}

function intersection(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function sameSet(left: string[], right: string[]) {
  return left.length === right.length && intersection(left, right).length === left.length;
}

function semanticOverlap(left: LinuxTaskContributionSignature, right: LinuxTaskContributionSignature): LinuxTaskPairOverlap {
  const sharedIncidentRequirementIds = intersection(left.incidentRequirementIds, right.incidentRequirementIds);
  const sharedCapabilities = intersection(left.requiredCapabilities, right.requiredCapabilities);
  const sharedEvidenceRoles = intersection(left.evidenceRoles, right.evidenceRoles);
  const sharedEvidencePaths = intersection(left.selectedEvidencePaths, right.selectedEvidencePaths);
  const sharedSubjectIds = intersection(left.primarySubjectIds, right.primarySubjectIds);
  const sharedRelationships = intersection(left.primaryRelationships, right.primaryRelationships);
  const sharedClaimKinds = intersection(left.expectedClaimKinds, right.expectedClaimKinds);
  const distinctContributionSignals = uniqueSorted([
    ...left.incidentRequirementIds.filter((item) => !right.incidentRequirementIds.includes(item)).map((item) => `left_requirement:${item}`),
    ...right.incidentRequirementIds.filter((item) => !left.incidentRequirementIds.includes(item)).map((item) => `right_requirement:${item}`),
    ...left.evidenceRoles.filter((item) => !right.evidenceRoles.includes(item)).map((item) => `left_role:${item}`),
    ...right.evidenceRoles.filter((item) => !left.evidenceRoles.includes(item)).map((item) => `right_role:${item}`),
    left.stage !== right.stage ? `stage:${left.stage}->${right.stage}` : undefined,
    ...left.primaryRelationships.filter((item) => !right.primaryRelationships.includes(item)).slice(0, 4).map((item) => `left_relation:${item}`),
    ...right.primaryRelationships.filter((item) => !left.primaryRelationships.includes(item)).slice(0, 4).map((item) => `right_relation:${item}`),
  ]);
  let semanticScore =
    sharedIncidentRequirementIds.length * 5 +
    sharedRelationships.length * 4 +
    sharedClaimKinds.length * 3 +
    sharedEvidenceRoles.length * 3 +
    Math.min(sharedEvidencePaths.length, 4) * 2 +
    Math.min(sharedSubjectIds.length, 6) +
    (left.stage === right.stage ? 2 : 0);
  semanticScore -= Math.min(distinctContributionSignals.length, 6) * 2;
  return {
    leftTaskId: left.taskId,
    rightTaskId: right.taskId,
    sharedIncidentRequirementIds,
    sharedCapabilities,
    sharedEvidenceRoles,
    sharedEvidencePaths,
    sharedSubjectIds,
    sharedRelationships,
    sharedClaimKinds,
    semanticScore,
    distinctContributionSignals,
  };
}

function exactlyDuplicates(left: LinuxTaskContributionSignature, right: LinuxTaskContributionSignature) {
  return left.intent === right.intent &&
    sameSet(left.requiredCapabilities, right.requiredCapabilities) &&
    sameSet(left.evidenceRoles, right.evidenceRoles) &&
    sameSet(left.selectedEvidencePaths, right.selectedEvidencePaths) &&
    sameSet(left.primarySubjectIds, right.primarySubjectIds) &&
    sameSet(left.primaryRelationships, right.primaryRelationships) &&
    sameSet(left.expectedClaimKinds, right.expectedClaimKinds);
}

function semanticallyDuplicates(left: LinuxTaskContributionSignature, right: LinuxTaskContributionSignature, overlap: LinuxTaskPairOverlap) {
  if (exactlyDuplicates(left, right)) return false;
  if (sameSet(left.selectedEvidencePaths, right.selectedEvidencePaths) &&
      left.reasoningObligations.length > 0 && sameSet(left.reasoningObligations, right.reasoningObligations) &&
      sameSet(left.expectedDeliverableElements, right.expectedDeliverableElements)) return true;
  const intentPair = new Set([left.intent, right.intent]);
  if (
    intentPair.has("ssh_authentication") &&
    intentPair.has("actor_attribution") &&
    overlap.sharedRelationships.some((relationship) => relationship.startsWith("authenticated_as:")) &&
    overlap.sharedEvidencePaths.some((path) => /auth\.log|users\.csv/.test(path)) &&
    left.uncertaintyRequirements.length === 0 &&
    right.uncertaintyRequirements.length === 0 &&
    left.remediationConcepts.length === 0 &&
    right.remediationConcepts.length === 0 &&
    overlap.distinctContributionSignals.filter((signal) => /^left_requirement:|^right_requirement:|^left_relation:|^right_relation:/.test(signal)).length === 0
  ) {
    return true;
  }
  if (overlap.distinctContributionSignals.some((signal) => /^left_requirement:|^right_requirement:/.test(signal))) return false;
  if (overlap.distinctContributionSignals.length >= 4) return false;
  if (overlap.sharedIncidentRequirementIds.length > 0 && overlap.sharedEvidenceRoles.length > 0 && overlap.semanticScore >= 8) return true;
  if (overlap.sharedClaimKinds.length >= 2 && overlap.sharedRelationships.length > 0 && overlap.semanticScore >= 9) return true;
  if (overlap.sharedEvidencePaths.length >= 3 && overlap.sharedSubjectIds.length >= 2 && overlap.sharedClaimKinds.length >= 2 && overlap.semanticScore >= 10) return true;
  return false;
}

function contributionSignals(signature: LinuxTaskContributionSignature) {
  return uniqueSorted([
    ...signature.incidentRequirementIds.map((item) => `requirement:${item}`),
    ...signature.requiredCapabilities.map((item) => `capability:${item}`),
    ...signature.evidenceRoles.map((item) => `role:${item}`),
    ...signature.primaryRelationships.map((item) => `relationship:${item}`),
    ...signature.expectedClaimKinds.map((item) => `claim:${item}`),
    ...signature.uncertaintyRequirements.map((item) => `uncertainty:${item}`),
    ...signature.remediationConcepts.map((item) => `remediation:${item}`),
    `stage:${signature.stage}`,
  ]);
}

function lowValueGeneric(signature: LinuxTaskContributionSignature) {
  const genericIntents: CanonicalInvestigationTask["intent"][] = [
    "actor_attribution",
    "service_state",
    "configuration_review",
    "impact_assessment",
    "risk_assessment",
    "evidence_integrity",
  ];
  if (!genericIntents.includes(signature.intent)) return false;
  const hasIncidentContractWork = signature.incidentRequirementIds.length > 0 ||
    signature.uncertaintyRequirements.length > 0 ||
    signature.remediationConcepts.length > 0;
  const hasRelationshipWork = signature.primaryRelationships.length > 0;
  const hasRoleWork = signature.evidenceRoles.some((role) => !["account_identity", "business_impact_context", "evidence_integrity"].includes(role));
  return !hasIncidentContractWork && !hasRelationshipWork && !hasRoleWork;
}

function progressionIssues(signatures: LinuxTaskContributionSignature[], taskPath = "identity_led", variant = 0) {
  const issues: LinuxTaskDiversityIssue[] = [];
  const stages = resolvedTaskPathStages(taskPath, variant);
  const pathRank = new Map(stages.map((stage, index) => [stage, index]));
  for (let index = 1; index < signatures.length; index += 1) {
    const previous = signatures[index - 1];
    const current = signatures[index];
    if ((pathRank.get(current.stage) ?? stageRank[current.stage]) < (pathRank.get(previous.stage) ?? stageRank[previous.stage])) {
      issues.push({
        code: "LINUX_TASK_INVALID_PROGRESSION",
        severity: "critical",
        taskIds: [previous.taskId, current.taskId],
        intents: [previous.intent, current.intent],
        message: `Task progression moves backward from ${previous.stage} to ${current.stage}.`,
      });
    }
  }
  const firstRespond = signatures.findIndex((signature) => signature.stage === "respond");
  const firstIdentifyOrCorrelate = signatures.findIndex((signature) => signature.stage === "identify" || signature.stage === "correlate");
  if (firstRespond >= 0 && (firstIdentifyOrCorrelate < 0 || firstRespond < firstIdentifyOrCorrelate)) {
    const task = signatures[firstRespond];
    issues.push({
      code: "LINUX_TASK_INVALID_PROGRESSION",
      severity: "critical",
      taskIds: [task.taskId],
      intents: [task.intent],
      message: "Containment or response appears before identification or correlation work.",
    });
  }
  return issues;
}

function renderedAssetPaths(finalAssets?: LabAsset[]) {
  return new Set((finalAssets || []).flatMap((asset) => [
    normalizeLinuxEvidencePath(asset.file_path || ""),
    normalizeLinuxEvidencePath(asset.file_name || ""),
  ]));
}

function taskGroundedInRenderedPack(task: CanonicalInvestigationTask, registry: CanonicalEvidenceAsset[], finalAssets?: LabAsset[]) {
  if (!finalAssets) return true;
  const rendered = renderedAssetPaths(finalAssets);
  const assets = selectedAssets(task, registry).filter((asset) => rendered.has(normalizeLinuxEvidencePath(asset.path)));
  if (assets.length === 0) return false;
  return proveTaskRequirements(task, assets).every((proof) => proof.feasible);
}

export function validateLinuxTaskDiversity(input: {
  simulation?: LinuxSimulationWorld;
  tasks?: CanonicalInvestigationTask[];
  registry?: CanonicalEvidenceAsset[];
  finalAssets?: LabAsset[];
  difficulty?: LinuxDifficulty;
}): LinuxTaskDiversityReport {
  const tasks = (input.tasks || input.simulation?.canonicalTasks || []).slice().sort((left, right) => left.order - right.order);
  const registry = input.registry || input.simulation?.planningEvidenceRegistry || input.simulation?.evidenceRegistry || [];
  const difficulty = input.difficulty || tasks[0]?.difficulty || "Advanced";
  const signatures = buildLinuxTaskContributionSignatures({ ...input, tasks, registry, difficulty });
  const issues: LinuxTaskDiversityIssue[] = [];
  const pairOverlaps: LinuxTaskPairOverlap[] = [];
  for (let leftIndex = 0; leftIndex < signatures.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < signatures.length; rightIndex += 1) {
      const left = signatures[leftIndex];
      const right = signatures[rightIndex];
      const overlap = semanticOverlap(left, right);
      pairOverlaps.push(overlap);
      if (exactlyDuplicates(left, right)) {
        issues.push({
          code: "LINUX_TASK_DUPLICATE_EXACT",
          severity: "critical",
          taskIds: [left.taskId, right.taskId],
          intents: [left.intent, right.intent],
          overlap,
          message: `Tasks ${left.taskId} and ${right.taskId} have the same contribution signature.`,
        });
      } else if (semanticallyDuplicates(left, right, overlap)) {
        issues.push({
          code: "LINUX_TASK_DUPLICATE_SEMANTIC",
          severity: "critical",
          taskIds: [left.taskId, right.taskId],
          intents: [left.intent, right.intent],
          overlap,
          message: `Tasks ${left.taskId} and ${right.taskId} ask for the same investigative contribution without a distinct subject, relationship, role, or incident requirement.`,
        });
      }
    }
  }

  const seenSignals = new Set<string>();
  for (const signature of signatures) {
    const signals = contributionSignals(signature);
    const uniqueSignals = signals.filter((signal) => !seenSignals.has(signal));
    const grounded = taskGroundedInRenderedPack(tasks.find((task) => task.id === signature.taskId) || tasks[0], registry, input.finalAssets);
    if (!grounded) {
      issues.push({
        code: "LINUX_TASK_NO_UNIQUE_CONTRIBUTION",
        severity: "critical",
        taskIds: [signature.taskId],
        intents: [signature.intent],
        missingUniqueSignals: ["rendered_task_grounding"],
        message: `Task ${signature.taskId} is not grounded in the rendered evidence pack and cannot add a verifiable contribution.`,
      });
    } else if (uniqueSignals.length === 0) {
      issues.push({
        code: "LINUX_TASK_NO_UNIQUE_CONTRIBUTION",
        severity: "critical",
        taskIds: [signature.taskId],
        intents: [signature.intent],
        missingUniqueSignals: signals,
        message: `Task ${signature.taskId} does not add a new capability, role, relationship, incident requirement, uncertainty, or remediation contribution.`,
      });
    }
    if (lowValueGeneric(signature)) {
      issues.push({
        code: "LINUX_TASK_LOW_VALUE_GENERIC",
        severity: "critical",
        taskIds: [signature.taskId],
        intents: [signature.intent],
        missingUniqueSignals: ["incident_requirement", "relationship", "non_generic_evidence_role"],
        message: `Task ${signature.taskId} is a generic inventory or documentation task without incident-specific contribution.`,
      });
    }
    for (const signal of signals) seenSignals.add(signal);
  }

  const scopedSshKeyPlan = input.simulation?.investigation.incidentFamily === "ssh_key_compromise" &&
    input.simulation.requestedDurationMinutes === 30 && difficulty === "Advanced" &&
    tasks.length === 4 && tasks.some((task) => task.intent === "impact_assessment");
  issues.push(...progressionIssues(
    signatures,
    scopedSshKeyPlan ? "ssh_key_rebalance" : input.simulation?.diversityProfile?.taskPath,
    scopedSshKeyPlan ? 0 : input.simulation?.diversityProfile?.taskVariant
  ));
  const status: LinuxTaskDiversityStatus = issues.some((issue) => issue.code === "LINUX_TASK_INVALID_PROGRESSION")
    ? "invalid_progression"
    : issues.length > 0
      ? "redundant"
      : "diverse";
  return { difficulty, status, signatures, pairOverlaps, issues };
}

export function assertLinuxTaskDiversity(input: {
  simulation?: LinuxSimulationWorld;
  tasks?: CanonicalInvestigationTask[];
  registry?: CanonicalEvidenceAsset[];
  finalAssets?: LabAsset[];
  difficulty?: LinuxDifficulty;
}) {
  const report = validateLinuxTaskDiversity(input);
  if (report.status !== "diverse") {
    const first = report.issues[0];
    throw new Error(
      `${first?.code || "LINUX_TASK_DIVERSITY_FAILED"}: ${first?.message || "Linux task set is redundant or out of progression."} difficulty=${report.difficulty} tasks=${first?.taskIds.join("|") || ""} intents=${first?.intents.join("|") || ""}`
    );
  }
  return report;
}
