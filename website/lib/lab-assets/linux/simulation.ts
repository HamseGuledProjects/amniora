import type { InvestigationWorld } from "../world";
import type { LinuxIncident } from "./incidents";
import {
  incidentClock,
  incidentTimestamp,
  type LinuxInvestigationContext,
} from "./investigation";
import type { LinuxAssetInput } from "./types";
import type { LinuxSimulationTestOverrides } from "./types";
import { homeDirectoryFor, identityFor } from "./noise";
import { linuxPlannerTaskSpecs, linuxTaskContract } from "./taskContracts";
import {
  buildLinuxEvidenceRelations,
  linuxCanonicalIncidentSubjectIds,
  linuxLearnerReviewSubjectIds,
  linuxSubjectRef,
  proveTaskRequirements,
  validateLinuxLearnerPackGrounding,
  validateLinuxProductionClosure,
  type CanonicalTaskRequirement,
  type LinuxCanonicalSubjectRef,
  type LinuxEvidenceRelation,
  type LinuxEvidenceSupportLevel,
  type TaskRequirementProof,
} from "./grounding";
import { validateLinuxSemanticClosure } from "./semanticClosure";
import {
  CURRENT_STATE_EVIDENCE_HINTS,
  currentStateCapabilitiesForIntent,
  type LinuxCurrentStateCapability,
} from "./currentStateEvidence";
import {
  filterEvidenceRegistryForDifficulty,
  linuxDurationTaskCountBounds,
  linuxDifficultyProfile,
  normalizeLinuxEvidencePath,
  validateLinuxTaskPlanAgainstDifficultyProfile,
  type LinuxTaskPlannerDiagnostic,
  type LinuxDifficultyDiagnosticResult,
} from "./difficultyProfile";
import { mandatoryLinuxIncidentTaskIntents } from "./incidentCoverage";
import { orderLinuxTasksByInvestigationStage } from "./taskDiversity";
import { deterministicFingerprint } from "./cryptographicEvidence";
import { linuxLocalCaseTimeToUtcTimestamp } from "./time";
import { resolveLinuxShellCommand } from "./commandSemantics";
import {
  buildLinuxDiversityProfile,
  linuxStableDiversityHash,
  rotateLinuxDiversityList,
  type LinuxDiversityProfile,
} from "./diversityProfile";

export type CanonicalCollectionState = {
  collectedAt: string;
  windowStart: string;
  windowEnd: string;
  earliestAllowedEvent: string;
  latestAllowedEvent: string;
};

export type CanonicalIdentity = {
  id: string;
  username: string;
  uid: number;
  gid: number;
  primaryGroupId: string;
};

export type CanonicalGroup = {
  id: string;
  name: string;
  gid: number;
};

export type CanonicalSshSession = {
  id: string;
  identityId: string;
  username: string;
  uid: number;
  gid: number;
  sourceIp: string;
  sourcePort: number;
  destinationPort: number;
  authenticationMethod: "publickey" | "password" | "keyboard-interactive";
  keyFingerprint?: string;
  tty?: string;
  monitorPid: number;
  sessionPid: number;
  shellPid?: number;
  openedAt: string;
  closedAt?: string;
  purpose: "incident" | "background" | "analyst" | "maintenance";
};

export type CanonicalAuthenticationOrigin = {
  id: string;
  kind: "ssh";
  identityId: string;
  sessionId: string;
  sourceIp: string;
  sourcePort: number;
  destinationPort: number;
  authenticationMethod: CanonicalSshSession["authenticationMethod"];
  keyFingerprint?: string;
  authenticatedAt: string;
};

export type CanonicalIdentityTransition = {
  id: string;
  kind: "sudo";
  actorIdentityId: string;
  targetIdentityId: string;
  sessionId?: string;
  sudoRuleId?: string;
  sudoProcessId: number;
  commandId: string;
  executionId: string;
  requestedAt: string;
  completedAt: string;
  outcome: "success";
};

export type CanonicalCommandRenderTarget =
  | "auth"
  | "sudo"
  | "audit"
  | "syslog"
  | "journal"
  | "timeline"
  | "process"
  | "open_files";

export type CanonicalCommand = {
  id: string;
  kind: "primary_incident" | "secondary_incident" | "supporting" | "analyst" | "background";
  executionId?: string;
  constructionOrigin?: "execution_first" | "legacy_derived";
  actorIdentityId: string;
  sessionId?: string;
  timestamp: string;
  tty?: string;
  cwd: string;
  executable: string;
  argv: string[];
  renderedCommand: string;
  runAsIdentityId?: string;
  sudoRuleId?: string;
  parentCommandId?: string;
  processId: number;
  sudoProcessId?: number;
  shellProcessId?: number;
  affectedFileIds: string[];
  affectedServiceIds?: string[];
  expectedRenderTargets: CanonicalCommandRenderTarget[];
};

export type CanonicalProcess = {
  id: string;
  executionId?: string;
  lifecycleOrigin?: "execution_first" | "system_origin" | "legacy_derived";
  hostedExecutionIds?: string[];
  pid: number;
  ppid: number;
  executable: string;
  argv: string[];
  identityId: string;
  realUid: number;
  effectiveUid: number;
  realGid: number;
  effectiveGid: number;
  cwd: string;
  tty?: string;
  sessionId?: string;
  commandId?: string;
  startedAt: string;
  endedAt?: string;
  /** A service transition can retire a daemon after its startup execution was registered. */
  serviceRetiredAt?: string;
  /** Current PPID after the original parent exits; ppid remains historical ancestry. */
  currentPpid?: number;
  lifecycleKind?: "short_lived" | "bounded" | "long_running" | "daemon" | "container_runtime" | "interactive_shell";
  childProcessIds: string[];
  openFileIds: string[];
};

export type CanonicalExecutionReason =
  | "boot_system"
  | "daemon_startup"
  | "ssh_session"
  | "interactive_shell"
  | "interactive_command"
  | "privilege_escalation"
  | "cron"
  | "systemd_timer"
  | "service_action"
  | "maintenance"
  | "package";

export type CanonicalExecution = {
  id: string;
  constructionOrigin: "execution_first" | "system_origin" | "legacy_derived";
  intentId?: string;
  intentCreatedAt?: string;
  commandProjectedAt?: string;
  processProjectedAt?: string;
  finalizedAt?: string;
  identityId: string;
  effectiveIdentityId?: string;
  identityOrigin?:
    | "authenticated_session"
    | "inherited"
    | "privilege_transition"
    | "system_origin"
    | "analyst_or_background";
  authenticationOriginId?: string;
  identityTransitionId?: string;
  sessionId?: string;
  commandId?: string;
  processId?: string;
  hostProcessId?: string;
  parentProcessId?: string;
  cwd: string;
  hostname: string;
  startTime: string;
  endTime?: string;
  environment?: Record<string, string>;
  reason: CanonicalExecutionReason;
  privilegeLevel: "user" | "root" | "service";
  openedFileIds: string[];
  affectedServiceIds: string[];
  scheduledExecutionId?: string;
  serviceTransitionIds: string[];
  packageTransactionIds: string[];
  maintenanceActivityIds: string[];
  processPolicy: "create_process" | "reuse_parent_process" | "no_child_process" | "system_process";
  outcome?: "success" | "failure" | "partial" | "unknown";
  exitCode?: number;
};

export type CanonicalLifecycleRegistryRecord = {
  registrationId: string;
  registrationSequence: number;
  executionId: string;
  commandId?: string;
  processId?: string;
  hostProcessId?: string;
  mode: CanonicalExecution["processPolicy"];
  origin: CanonicalExecution["constructionOrigin"];
  state: "pending" | "completed" | "construction_failed";
  finalizedCount: number;
  immutable: {
    execution: {
      identityId: string;
      effectiveIdentityId?: string;
      identityOrigin?: CanonicalExecution["identityOrigin"];
      authenticationOriginId?: string;
      identityTransitionId?: string;
      sessionId?: string;
      cwd: string;
      hostname: string;
      startTime: string;
      endTime?: string;
      processId?: string;
      hostProcessId?: string;
      parentProcessId?: string;
      commandId?: string;
    };
    command?: {
      actorIdentityId: string;
      runAsIdentityId?: string;
      sessionId?: string;
      timestamp: string;
      cwd: string;
      executable: string;
      renderedCommand: string;
      processId: number;
      sudoRuleId?: string;
      sudoProcessId?: number;
    };
    process?: {
      pid: number;
      ppid: number;
      executable: string;
      identityId: string;
      realUid: number;
      effectiveUid: number;
      realGid: number;
      effectiveGid: number;
      cwd: string;
      sessionId?: string;
      commandId?: string;
      startedAt: string;
      endedAt?: string;
      lifecycleKind?: CanonicalProcess["lifecycleKind"];
    };
  };
  enrichedFileIds: string[];
  mutationViolations: string[];
  integrityFingerprint: string;
};

export type CanonicalLifecycleRegistry = {
  records: CanonicalLifecycleRegistryRecord[];
  rolledBack: string[];
};

export type CanonicalFile = {
  id: string;
  path: string;
  fileType: "regular" | "directory" | "symlink" | "socket" | "device";
  ownerIdentityId: string;
  ownerUid: number;
  groupId: string;
  groupGid: number;
  mode: number;
  inode: number;
  size: number;
  createdAt?: string;
  modifiedAt: string;
  accessedAt?: string;
  deletedAt?: string;
  contentRole:
    | "incident_target"
    | "incident_output"
    | "configuration"
    | "credential"
    | "log"
    | "script"
    | "background";
  relatedCommandIds: string[];
};

export type CanonicalOpenFileDescriptor = {
  id: string;
  processId: string;
  pid: number;
  processStartedAt: string;
  userIdentityId: string;
  username: string;
  fd: string;
  descriptorType: "regular_file" | "log_file" | "configuration_file" | "deleted_regular_file" | "listening_socket" | "connected_socket" | "pipe";
  accessMode: "r" | "w" | "u";
  targetKind: "file" | "socket" | "pipe";
  targetId: string;
  targetPath?: string;
  localAddress?: string;
  localPort?: number;
  remoteAddress?: string;
  remotePort?: number;
  protocol?: "tcp" | "udp" | "unix";
  inode?: number;
  openedAt: string;
  closedAt?: string;
  state: "current" | "closed";
  deleted: boolean;
  eventIds: string[];
  relatedServiceId?: string;
};

export type CanonicalSimulationEvent = {
  id: string;
  timestamp: string;
  kind: "ssh_session_open" | "ssh_session_close" | "command_exec" | "file_touch";
  summary: string;
  commandId?: string;
  sessionId?: string;
  fileId?: string;
};

export type CanonicalHistoricalFileAccessRecord = {
  sourceType: "execution";
  sourceExecutionId: string;
  sourceCommandId: string;
  sourceProcessId: string;
  timestamp: string;
  allowedStart: string;
  allowedEnd: string;
  operationIndex: number;
  pid: number;
  userIdentityId: string;
  renderedCommand: string;
  fileId: string;
  filePath: string;
};

export type CanonicalService = {
  id: string;
  unitName: string;
  role: "primary" | "secondary" | "background";
  description: string;
  unitPresent: boolean;
  loadState: "loaded" | "not-found" | "masked" | "error";
  unitType:
    | "simple"
    | "forking"
    | "oneshot"
    | "notify"
    | "idle"
    | "timer"
    | "socket"
    | "target"
    | "path";
  unitPath: string;
  unitFileState:
    | "enabled"
    | "disabled"
    | "static"
    | "masked"
    | "indirect"
    | "generated"
    | "transient";
  activeState:
    | "active"
    | "inactive"
      | "failed"
      | "activating"
      | "deactivating";
  subState: string;
  result: "success" | "exit-code" | "signal" | "timeout" | "start-limit-hit" | "none";
  serviceType: "long-running" | "oneshot";
  mainProcessId?: string;
  execStart?: string;
  lastTransitionAt?: string;
  ownerTeam: string;
  packageName?: string;
  localOverrideFileId?: string;
  relatedTimerId?: string;
};

export type CanonicalServiceTransition = {
  id: string;
  executionId?: string;
  serviceId: string;
  operation:
    | "enable"
    | "disable"
    | "start"
    | "stop"
    | "restart"
    | "reload"
    | "daemon_reload"
    | "mask"
    | "unmask"
    | "activate"
    | "complete"
    | "fail";
  cause:
    | { type: "command"; commandId: string }
    | { type: "boot"; eventId: string }
    | { type: "dependency"; serviceTransitionId: string }
    | { type: "timer"; timerEventId: string }
    | { type: "socket"; socketEventId: string }
    | { type: "package"; packageTransactionId: string }
    | { type: "signal"; processId: string; signal: string };
  occurredAt: string;
  previousState: {
    unitPresent: boolean;
    loadState: string;
    unitFileState: string;
    activeState: string;
    subState: string;
    result: string;
    mainProcessId?: string;
  };
  resultingState: {
    unitPresent: boolean;
    loadState: string;
    unitFileState: string;
    activeState: string;
    subState: string;
    result: string;
    mainProcessId?: string;
  };
  outcome: "success" | "failure";
  processId?: string;
  expectedRenderTargets: Array<
    "audit" | "journal_systemd" | "syslog" | "timeline" | "service_inventory"
  >;
};

export type CanonicalSystemdTimer = {
  id: string;
  timerUnitName: string;
  serviceId: string;
  calendarExpression?: string;
  onBootSec?: string;
  onUnitActiveSec?: string;
  activeState: "active" | "inactive" | "failed";
  subState: "waiting" | "elapsed" | "dead" | string;
  lastTriggerAt?: string;
  nextTriggerAt?: string;
};

export type CanonicalCronDefinition = {
  id: string;
  source:
    | "system_crontab"
    | "root_crontab"
    | "user_crontab"
    | "cron_d"
    | "cron_hourly"
    | "cron_daily"
    | "cron_weekly"
    | "cron_monthly";
  sourcePath: string;
  ownerIdentityId: string;
  runAsIdentityId: string;
  schedule: string;
  commandId: string;
  environment?: Record<string, string>;
  enabled: boolean;
  persistenceState: "present" | "removed" | "disabled";
  createdAt: string;
  modifiedAt: string;
  removedAt?: string;
  /** Collection policy, not a conclusion inferred from missing rendered rows. */
  telemetryCoverage?: { mode: "complete" | "sampled"; start: string; end: string; reason?: "partial_logs" };
  relatedChangeId?: string;
  purpose:
    | "backup"
    | "monitoring"
    | "certificate"
    | "database"
    | "web"
    | "mail"
    | "container"
    | "cleanup"
    | "security"
    | "package"
    | "incident"
    | "other";
};

export type CanonicalScheduledExecution = {
  id: string;
  executionId?: string;
  definitionId?: string;
  timerId?: string;
  commandId: string;
  processId: string;
  occurredAt: string;
  outcome: "success" | "failure" | "partial";
  exitCode?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
  affectedFileIds: string[];
  affectedServiceIds: string[];
  expectedRenderTargets: Array<
    | "cron_log"
    | "audit"
    | "syslog"
    | "journal_systemd"
    | "process"
    | "open_files"
    | "timeline"
  >;
};

/** A dispatch is not a completion. Only a recorded process end with a known
 * successful outcome and zero exit status supports a success claim. */
export function scheduledExecutionRenderedPhase(simulation: LinuxSimulationWorld, scheduled: CanonicalScheduledExecution) {
  const process = simulation.processes.find((item) => item.id === scheduled.processId);
  const execution = simulation.executions.find((item) => item.id === scheduled.executionId);
  const endedAt = process?.endedAt;
  if (!endedAt || endedAt > simulation.collection.collectedAt || endedAt < scheduled.occurredAt) {
    return { timestamp: scheduled.occurredAt, phase: "started" as const };
  }
  if (scheduled.outcome === "success" && scheduled.exitCode === 0 &&
      execution?.outcome === "success" && execution.exitCode === 0 && execution.endTime === endedAt) {
    return { timestamp: endedAt, phase: "completed" as const };
  }
  if (scheduled.outcome === "failure" || execution?.outcome === "failure") {
    return { timestamp: endedAt, phase: "failed" as const };
  }
  return { timestamp: endedAt, phase: "ended_unconfirmed" as const };
}

export type CanonicalPackageTransaction = {
  id: string;
  executionIds?: string[];
  source:
    | "manual"
    | "apt_daily"
    | "unattended_upgrade"
    | "configuration_management"
    | "maintenance_script";
  actorIdentityId: string;
  commandId?: string;
  timerId?: string;
  processIds: string[];
  requestedAt: string;
  startedAt: string;
  completedAt: string;
  action: "install" | "upgrade" | "remove" | "reconfigure";
  packages: Array<{
    name: string;
    previousVersion?: string;
    resultingVersion?: string;
    repository?: string;
  }>;
  changeId?: string;
  outcome: "success" | "failure" | "partial";
  affectedFileIds: string[];
  affectedServiceIds: string[];
};

export type CanonicalMaintenanceActivity = {
  id: string;
  title: string;
  owningTeam: string;
  actorIdentityId: string;
  /** Legacy positive flag. `false` never means an explicit rejection. */
  approved: boolean;
  approvalDecision?: "unknown" | "approved" | "rejected";
  approvalEvidenceAvailability?: "available" | "partial" | "unavailable";
  approvalSourceCompleteness?: "complete" | "partial" | "unknown";
  approvalSourcePaths?: string[];
  changeId?: string;
  ticketId?: string;
  windowStart: string;
  windowEnd: string;
  recurringPolicyWindow?: string;
  timezone?: string;
  commandIds: string[];
  serviceTransitionIds: string[];
  packageTransactionIds: string[];
  cronDefinitionIds: string[];
  purpose: string;
};

export type CanonicalBackgroundProfile = {
  hostRole: string;
  industry: string;
  organisationMaturity: string;
  businessHours: string;
  timezone: string;
  permittedJobFamilies: string[];
  permittedServiceFamilies: string[];
  permittedPackageActivities: string[];
  activityDensity: "low" | "moderate" | "high";
};

export type CanonicalExecutionMigrationDiagnostics = {
  totalCommands: number;
  executionFirstCommands: number;
  legacyCommands: number;
  totalProcesses: number;
  executionFirstProcesses: number;
  backgroundSystemProcesses: number;
  legacyUnclassifiedProcesses: number;
  executionIntentsCreated: number;
  completedExecutions: number;
  failedNoChildExecutions: number;
  builderRegisteredExecutions: number;
  pendingExecutions: number;
  constructionFailedExecutions: number;
  builderRegisteredCommands: number;
  builderRegisteredProcesses: number;
  shellHostedExecutions: number;
  backgroundStaticLegacyCommands: number;
  backgroundStaticLegacyProcesses: number;
  incidentRelevantLegacyCommands: number;
  incidentRelevantLegacyProcesses: number;
  forgedLabelObjects: number;
  postFinalizationMutationViolations: number;
  packageDpkgLegacyProcesses: number;
  duplicateExecutionRegistrations: number;
  duplicateCommandRegistrations: number;
  duplicateProcessRegistrations: number;
  invalidRegistrationFingerprints: number;
  replacedRegistryRecords: number;
  registryCardinalityViolations: number;
  frozenRecordMutationAttempts: number;
  authoritativeLedgerRecords: number;
  serializedDiagnosticRecords: number;
  authoritativeSerializedRegistryMismatches: number;
};

export type CanonicalEvidenceCapability =
  | "authentication"
  | "session_lifecycle"
  | "actor_attribution"
  | "sudo_authorisation"
  | "command_execution"
  | "process_ancestry"
  | "open_file_correlation"
  | "file_owner_group_mode"
  | "service_state"
  | "service_transition"
  | "package_transaction"
  | "cron_definition"
  | "cron_execution"
  | "key_provenance"
  | "configuration_baseline"
  | "network_source"
  | "current_service_state"
  | "current_process_state"
  | "current_listener_state"
  | "current_package_state"
  | "current_persistence_state"
  | "current_identity_state"
  | "current_file_state"
  | "current_open_file_state"
  | "current_policy_state"
  | "current_configuration_state"
  | "change_control"
  | "maintenance_scope"
  | "risk_context"
  | "evidence_integrity"
  | "timeline_exact"
  | "timeline_context"
  | "timeline_static";

export type CanonicalEvidenceAsset = {
  id: string;
  path: string;
  displayName: string;
  assetType:
    | "timestamped_log"
    | "journal"
    | "static_config"
    | "identity_inventory"
    | "process_snapshot"
    | "open_files"
    | "file_metadata"
    | "service_inventory"
    | "package_history"
    | "package_inventory"
    | "scheduled_definition"
    | "network_state"
    | "change_document"
    | "maintenance_document"
    | "policy_document"
    | "analyst_document"
    | "risk_document"
    | "key_material"
    | "manifest"
    | "other";
  canonicalObjectIds: string[];
  subjectRefs: LinuxCanonicalSubjectRef[];
  relations: LinuxEvidenceRelation[];
  eventIds: string[];
  capabilities: CanonicalEvidenceCapability[];
  support: LinuxEvidenceSupportLevel;
  exactTimestampSupport: boolean;
  collectionTimestamp?: string;
  timezone?: string;
  timestampFormat?: string;
  stateType?: "collection_snapshot" | "incident_snapshot" | "historical_reconstruction" | "static_document";
  aliases: string[];
};

export type CanonicalDocumentFact = {
  id: string;
  factType:
    | "case_identity"
    | "host_identity"
    | "incident_window"
    | "actor"
    | "source_network"
    | "command"
    | "file"
    | "service"
    | "package"
    | "change"
    | "maintenance"
    | "policy_expectation"
    | "observed_deviation"
    | "risk_hypothesis"
    | "evidence_gap"
    | "containment_option";
  canonicalObjectIds: string[];
  certainty: "observed" | "inferred" | "candidate" | "policy" | "unknown";
  allowedDocumentTypes: string[];
  spoilerRisk: "none" | "low" | "high";
};

export type CanonicalDocument = {
  id: string;
  documentType:
    | "incident_brief"
    | "change_request"
    | "maintenance_ticket"
    | "security_policy"
    | "audit_notes"
    | "analyst_working_notes"
    | "analyst_questions"
    | "risk_register"
    | "advanced_risk_register"
    | "hardening_checklist";
  styleArchetype:
    | "formal_itil"
    | "ticket_first"
    | "terse_operations"
    | "compliance_heavy"
    | "engineering_runbook"
    | "chat_derived"
    | "msp_style"
    | "startup_informal";
  factIds: string[];
  requiredFactTypes: CanonicalDocumentFact["factType"][];
  forbiddenFactIds: string[];
  createdAt: string;
  authorRole: string;
  owningTeam: string;
};

export type CanonicalInvestigationTask = {
  id: string;
  intent:
    | "scope_timeline"
    | "actor_attribution"
    | "ssh_authentication"
    | "key_provenance"
    | "sudo_policy"
    | "command_process"
    | "file_permissions"
    | "service_state"
    | "package_transaction"
    | "cron_analysis"
    | "network_source"
    | "configuration_review"
    | "change_control"
    | "evidence_integrity"
    | "impact_assessment"
    | "risk_assessment"
    | "containment_recommendation";
  requiredCapabilities: CanonicalEvidenceCapability[];
  inquiryTypes: Array<
    | "historical_reconstruction"
    | "current_state"
    | "configuration_state"
    | "runtime_state"
    | "identity_access_state"
    | "persistence_state"
    | "network_listener_state"
    | "package_state"
    | "file_state"
    | "policy_state"
    | "risk_assessment"
    | "remediation_or_containment"
  >;
  currentStateRequirements: CanonicalTaskRequirement[];
  selectedEvidenceAssetIds: string[];
  canonicalObjectIds: string[];
  primarySubjectIds: string[];
  supportingSubjectIds: string[];
  requirements: CanonicalTaskRequirement[];
  expectedDeliverableType:
    | "timeline"
    | "correlation_table"
    | "gap_assessment"
    | "policy_mapping"
    | "evidence_notes"
    | "risk_summary"
    | "escalation_summary"
    | "containment_plan";
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  order: number;
  blueprintId?: string;
  blueprintLabel?: string;
  stepLabel?: string;
  suggestedVerb?: string;
};

export type TaskFeasibilityProof = {
  taskId: string;
  requiredCapabilities: string[];
  requirementProofs: TaskRequirementProof[];
  satisfiedBy: Array<{
    capability: string;
    assetIds: string[];
    canonicalObjectIds: string[];
  }>;
  missingCapabilities: string[];
  feasible: boolean;
};

export type LinuxLegacyBackgroundData = {
  phase: 1;
  remainingLocalFactOrigins: string[];
};

export type LinuxSimulationWorld = {
  version: 1;
  seed: string;
  diversityProfile: LinuxDiversityProfile;
  requestedDurationMinutes?: number;
  investigation: LinuxInvestigationContext;
  collection: CanonicalCollectionState;
  identities: CanonicalIdentity[];
  groups: CanonicalGroup[];
  sshSessions: CanonicalSshSession[];
  authenticationOrigins: CanonicalAuthenticationOrigin[];
  identityTransitions: CanonicalIdentityTransition[];
  executions: CanonicalExecution[];
  lifecycleRegistry: CanonicalLifecycleRegistry;
  commands: CanonicalCommand[];
  processes: CanonicalProcess[];
  files: CanonicalFile[];
  openFileDescriptors: CanonicalOpenFileDescriptor[];
  events: CanonicalSimulationEvent[];
  services: CanonicalService[];
  serviceTransitions: CanonicalServiceTransition[];
  timers: CanonicalSystemdTimer[];
  cronDefinitions: CanonicalCronDefinition[];
  scheduledExecutions: CanonicalScheduledExecution[];
  packageTransactions: CanonicalPackageTransaction[];
  maintenanceActivities: CanonicalMaintenanceActivity[];
  backgroundProfile: CanonicalBackgroundProfile;
  evidenceRegistry: CanonicalEvidenceAsset[];
  planningEvidenceRegistry: CanonicalEvidenceAsset[];
  documentFacts: CanonicalDocumentFact[];
  documents: CanonicalDocument[];
  canonicalTasks: CanonicalInvestigationTask[];
  taskFeasibilityProofs: TaskFeasibilityProof[];
  taskPlannerDiagnostics: LinuxTaskPlannerDiagnostic[];
  difficultyDiagnostics: LinuxDifficultyDiagnosticResult;
  executionMigrationDiagnostics: CanonicalExecutionMigrationDiagnostics;
  legacy: LinuxLegacyBackgroundData;
};

type BuildArgs = {
  world: InvestigationWorld;
  incident: LinuxIncident;
  investigation: LinuxInvestigationContext;
  difficulty: string;
  seed: string;
  requestedDurationMinutes?: number;
  testOverrides?: LinuxSimulationTestOverrides;
};

type CanonicalExecutionIntent = {
  intentId: string;
  executionId: string;
  hostname: string;
  actorIdentity: CanonicalIdentity;
  effectiveIdentity: CanonicalIdentity;
  sessionId?: string;
  parentPid: number;
  commandId?: string;
  processId: string;
  pid: number;
  commandKind?: CanonicalCommand["kind"];
  renderedCommand?: string;
  executable: string;
  argv: string[];
  cwd: string;
  tty?: string;
  startTime: string;
  endTime?: string;
  lifecycleKind?: CanonicalProcess["lifecycleKind"];
  reason: CanonicalExecutionReason;
  privilegeLevel: CanonicalExecution["privilegeLevel"];
  processPolicy: CanonicalExecution["processPolicy"];
  outcome?: CanonicalExecution["outcome"];
  exitCode?: number;
  affectedFileIds?: string[];
  affectedServiceIds?: string[];
  expectedRenderTargets?: CanonicalCommandRenderTarget[];
  sudoRuleId?: string;
  shellProcessId?: number;
  sudoProcessId?: number;
  environment?: Record<string, string>;
  constructionOrigin?: CanonicalExecution["constructionOrigin"];
  identityOrigin?: CanonicalExecution["identityOrigin"];
  authenticationOriginId?: string;
  identityTransitionId?: string;
};

type ExecutionLifecycleCollections = {
  executions: CanonicalExecution[];
  commands: CanonicalCommand[];
  processes: CanonicalProcess[];
  lifecycleRegistry: CanonicalLifecycleRegistry;
};

type AuthoritativeLifecycleLedgerRecord = {
  registrationId: string;
  registrationSequence: number;
  executionId: string;
  commandId?: string;
  processId?: string;
  hostProcessId?: string;
  integrityFingerprint: string;
  recordRef: CanonicalLifecycleRegistryRecord;
};

const authoritativeLifecycleLedgers = new WeakMap<CanonicalLifecycleRegistry, AuthoritativeLifecycleLedgerRecord[]>();

function stableLifecycleStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableLifecycleStringify(item)).join(",")}]`;
  const input = value as Record<string, unknown>;
  return `{${Object.keys(input)
    .filter((key) => input[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableLifecycleStringify(input[key])}`)
    .join(",")}}`;
}

function deterministicLifecycleHash(value: unknown): string {
  const text = stableLifecycleStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `lfp:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function lifecycleRecordFingerprint(record: CanonicalLifecycleRegistryRecord): string {
  return deterministicLifecycleHash({
    registrationId: record.registrationId,
    registrationSequence: record.registrationSequence,
    executionId: record.executionId,
    commandId: record.commandId,
    processId: record.processId,
    hostProcessId: record.hostProcessId,
    mode: record.mode,
    origin: record.origin,
    state: record.state,
    finalizedCount: record.finalizedCount,
    immutable: record.immutable,
  });
}

function authoritativeLedgerFor(registry: CanonicalLifecycleRegistry) {
  let ledger = authoritativeLifecycleLedgers.get(registry);
  if (!ledger) {
    ledger = [];
    authoritativeLifecycleLedgers.set(registry, ledger);
  }
  return ledger;
}

function sealLifecycleImmutableSnapshot(record: CanonicalLifecycleRegistryRecord) {
  Object.freeze(record.immutable.execution);
  if (record.immutable.command) Object.freeze(record.immutable.command);
  if (record.immutable.process) Object.freeze(record.immutable.process);
  Object.freeze(record.immutable);
}

export function createExecutionLifecycle(intent: CanonicalExecutionIntent, collections: ExecutionLifecycleCollections) {
  if (!intent.executionId || !intent.intentId) throw new Error("Linux simulation failed: execution intent missing id.");
  if (!intent.hostname || !intent.cwd || !intent.startTime) throw new Error(`Linux simulation failed: execution intent ${intent.intentId} missing context.`);
  if (!intent.effectiveIdentity) throw new Error(`Linux simulation failed: execution intent ${intent.intentId} missing effective identity.`);
  const pushedExecutions = collections.executions.length;
  const pushedCommands = collections.commands.length;
  const pushedProcesses = collections.processes.length;
  const ledger = authoritativeLedgerFor(collections.lifecycleRegistry);
  const registrationSequence = ledger.length + 1;
  const registrationId = `lifecycle:${registrationSequence}:${intent.executionId}`;
  const record: CanonicalLifecycleRegistryRecord = {
    registrationId,
    registrationSequence,
    executionId: intent.executionId,
    commandId: intent.commandId,
    processId: intent.processPolicy === "no_child_process" ? undefined : intent.processId,
    mode: intent.processPolicy,
    origin: intent.constructionOrigin || "execution_first",
    state: "pending",
    finalizedCount: 0,
    immutable: {
      execution: {
        identityId: intent.actorIdentity.id,
        effectiveIdentityId: intent.effectiveIdentity.id,
        identityOrigin: intent.identityOrigin,
        authenticationOriginId: intent.authenticationOriginId,
        identityTransitionId: intent.identityTransitionId,
        sessionId: intent.sessionId,
        cwd: intent.cwd,
        hostname: intent.hostname,
        startTime: intent.startTime,
        endTime: intent.endTime,
        commandId: intent.commandId,
      },
    },
    enrichedFileIds: [],
    mutationViolations: [],
    integrityFingerprint: "",
  };
  collections.lifecycleRegistry.records.push(record);

  try {
  const pending: CanonicalExecution = {
    id: intent.executionId,
    constructionOrigin: intent.constructionOrigin || "execution_first",
    intentId: intent.intentId,
    intentCreatedAt: intent.startTime,
    identityId: intent.actorIdentity.id,
    effectiveIdentityId: intent.effectiveIdentity.id,
    identityOrigin: intent.identityOrigin,
    authenticationOriginId: intent.authenticationOriginId,
    identityTransitionId: intent.identityTransitionId,
    sessionId: intent.sessionId,
    cwd: intent.cwd,
    hostname: intent.hostname,
    startTime: intent.startTime,
    endTime: intent.endTime,
    environment: intent.environment,
    reason: intent.reason,
    privilegeLevel: intent.privilegeLevel,
    openedFileIds: [...(intent.affectedFileIds || [])],
    affectedServiceIds: [...(intent.affectedServiceIds || [])],
    serviceTransitionIds: [],
    packageTransactionIds: [],
    maintenanceActivityIds: [],
    processPolicy: intent.processPolicy,
    outcome: intent.outcome || "unknown",
    exitCode: intent.exitCode,
  };
  collections.executions.push(pending);

  let command: CanonicalCommand | undefined;
  if (intent.commandId && intent.renderedCommand) {
    pending.commandProjectedAt = intent.startTime;
    command = {
      id: intent.commandId,
      kind: intent.commandKind || "supporting",
      executionId: pending.id,
      constructionOrigin: "execution_first",
      actorIdentityId: intent.actorIdentity.id,
      sessionId: intent.sessionId,
      timestamp: intent.startTime,
      tty: intent.tty,
      cwd: intent.cwd,
      executable: intent.executable,
      argv: [...intent.argv],
      renderedCommand: intent.renderedCommand,
      runAsIdentityId: intent.effectiveIdentity.id !== intent.actorIdentity.id ? intent.effectiveIdentity.id : undefined,
      sudoRuleId: intent.sudoRuleId,
      processId: intent.pid,
      sudoProcessId: intent.sudoProcessId,
      shellProcessId: intent.shellProcessId,
      affectedFileIds: [...(intent.affectedFileIds || [])],
      affectedServiceIds: [...(intent.affectedServiceIds || [])],
      expectedRenderTargets: [...(intent.expectedRenderTargets || [])],
    };
    collections.commands.push(command);
    pending.commandId = command.id;
  }

  pending.processProjectedAt = intent.startTime;
  let process = collections.processes.find((item) => item.pid === intent.parentPid && intent.processPolicy === "no_child_process");
  if (intent.processPolicy === "no_child_process") {
    if (!process) throw new Error(`Linux simulation failed: no-child execution ${intent.executionId} missing host process ${intent.parentPid}.`);
    pending.hostProcessId = process.id;
    pending.parentProcessId = process.id;
    if (!process.hostedExecutionIds) process.hostedExecutionIds = [];
    if (!process.hostedExecutionIds.includes(pending.id)) process.hostedExecutionIds.push(pending.id);
    record.hostProcessId = process.id;
  } else {
    process = {
      id: intent.processId,
      executionId: pending.id,
      lifecycleOrigin: pending.constructionOrigin === "system_origin" ? "system_origin" : "execution_first",
      pid: intent.pid,
      ppid: intent.parentPid,
      executable: intent.executable,
      argv: [...intent.argv],
      identityId: intent.actorIdentity.id,
      realUid: intent.actorIdentity.uid,
      effectiveUid: intent.effectiveIdentity.uid,
      realGid: intent.actorIdentity.gid,
      effectiveGid: intent.effectiveIdentity.gid,
      cwd: intent.cwd,
      tty: intent.tty,
      sessionId: intent.sessionId,
      commandId: command?.id,
      startedAt: intent.startTime,
      endedAt: intent.endTime,
      lifecycleKind: intent.lifecycleKind,
      childProcessIds: [],
      openFileIds: [...(intent.affectedFileIds || [])],
    };
    collections.processes.push(process);
    pending.processId = process.id;
    pending.parentProcessId = intent.parentPid === 0 || intent.parentPid === 1
      ? undefined
      : collections.processes.find((item) => item.pid === intent.parentPid)?.id;
  }
  pending.finalizedAt = intent.startTime;
  record.state = "completed";
  record.finalizedCount += 1;
  record.processId = pending.processId;
  record.hostProcessId = pending.hostProcessId;
  record.immutable.execution = {
    ...record.immutable.execution,
    commandId: pending.commandId,
    processId: pending.processId,
    hostProcessId: pending.hostProcessId,
    parentProcessId: pending.parentProcessId,
  };
  if (command) {
    record.immutable.command = {
      actorIdentityId: command.actorIdentityId,
      runAsIdentityId: command.runAsIdentityId,
      sessionId: command.sessionId,
      timestamp: command.timestamp,
      cwd: command.cwd,
      executable: command.executable,
      renderedCommand: command.renderedCommand,
      processId: command.processId,
      sudoRuleId: command.sudoRuleId,
      sudoProcessId: command.sudoProcessId,
    };
  }
  if (pending.processId && process) {
    record.immutable.process = {
      pid: process.pid,
      ppid: process.ppid,
      executable: process.executable,
      identityId: process.identityId,
      realUid: process.realUid,
      effectiveUid: process.effectiveUid,
      realGid: process.realGid,
      effectiveGid: process.effectiveGid,
      cwd: process.cwd,
      sessionId: process.sessionId,
      commandId: process.commandId,
      startedAt: process.startedAt,
      endedAt: process.endedAt,
    };
  }
  sealLifecycleImmutableSnapshot(record);
  record.integrityFingerprint = lifecycleRecordFingerprint(record);
  ledger.push({
    registrationId: record.registrationId,
    registrationSequence: record.registrationSequence,
    executionId: record.executionId,
    commandId: record.commandId,
    processId: record.processId,
    hostProcessId: record.hostProcessId,
    integrityFingerprint: record.integrityFingerprint,
    recordRef: record,
  });
  return { execution: pending, command, process };
  } catch (error) {
    collections.executions.splice(pushedExecutions);
    collections.commands.splice(pushedCommands);
    collections.processes.splice(pushedProcesses);
    record.state = "construction_failed";
    record.integrityFingerprint = lifecycleRecordFingerprint(record);
    ledger.push({
      registrationId: record.registrationId,
      registrationSequence: record.registrationSequence,
      executionId: record.executionId,
      commandId: record.commandId,
      processId: record.processId,
      hostProcessId: record.hostProcessId,
      integrityFingerprint: record.integrityFingerprint,
      recordRef: record,
    });
    collections.lifecycleRegistry.rolledBack.push(intent.executionId);
    throw error;
  }
}

function lifecycleRecord(registry: CanonicalLifecycleRegistry, executionId: string) {
  return registry.records.find((record) => record.executionId === executionId);
}

function enrichExecutionLifecycleFiles(args: {
  registry: CanonicalLifecycleRegistry;
  executions: CanonicalExecution[];
  commands: CanonicalCommand[];
  processes: CanonicalProcess[];
  executionId: string;
  fileIds: string[];
}) {
  const record = lifecycleRecord(args.registry, args.executionId);
  if (!record || record.state !== "completed") throw new Error(`Linux simulation failed: cannot enrich unregistered lifecycle ${args.executionId}.`);
  const execution = args.executions.find((item) => item.id === args.executionId);
  if (!execution) throw new Error(`Linux simulation failed: cannot enrich missing execution ${args.executionId}.`);
  const command = execution.commandId ? args.commands.find((item) => item.id === execution.commandId) : undefined;
  const process = execution.processId ? args.processes.find((item) => item.id === execution.processId) : undefined;
  for (const fileId of args.fileIds) {
    if (!record.enrichedFileIds.includes(fileId)) record.enrichedFileIds.push(fileId);
    if (!execution.openedFileIds.includes(fileId)) execution.openedFileIds.push(fileId);
    if (command && !command.affectedFileIds.includes(fileId)) command.affectedFileIds.push(fileId);
    if (process && !process.openFileIds.includes(fileId)) process.openFileIds.push(fileId);
  }
}

function timestampPlusSeconds(timestamp: string, seconds: number) {
  return formatUtcTimestamp(new Date(parseTimestamp(timestamp) + seconds * 1000));
}

function commandLifecycleKind(command: string): NonNullable<CanonicalProcess["lifecycleKind"]> {
  if (/\b(?:bash|sh|zsh)\b/.test(command)) return "interactive_shell";
  if (/\bdocker\s+run\b/i.test(command) && !/\s-d\b|--detach\b/i.test(command)) return "container_runtime";
  if (/\b(?:tar|rsync|scp|find|logrotate)\b/i.test(command)) return "bounded";
  if (/\b(?:truncate|journalctl|docker\s+inspect|cat|systemctl|chmod|chown|stat|grep|curl|apt\s+install)\b/i.test(command)) return "short_lived";
  return "bounded";
}

function commandDurationSeconds(command: string) {
  if (/\btruncate\b/i.test(command)) return 2;
  if (/\bjournalctl\b/i.test(command)) return 6;
  if (/\bdocker\s+inspect\b/i.test(command)) return 4;
  if (/\bdocker\s+run\b/i.test(command) && /\s-d\b|--detach\b/i.test(command)) return 8;
  if (/\bcat\b/i.test(command)) return 3;
  if (/\bsystemctl\b/i.test(command)) return 7;
  if (/\blogrotate\b/i.test(command)) return 35;
  if (/\brsync\b/i.test(command)) return 90;
  if (/\btar\b/i.test(command)) return 75;
  if (/\bapt\s+install\b/i.test(command)) return 17;
  if (/\b(?:chmod|chown|stat|grep|curl)\b/i.test(command)) return 5;
  return 30;
}

function finalizeLegacyExecutionLinks(args: {
  executions: CanonicalExecution[];
  commands: CanonicalCommand[];
  processes: CanonicalProcess[];
  lifecycleRegistry: CanonicalLifecycleRegistry;
  scheduledExecutions: CanonicalScheduledExecution[];
  serviceTransitions: CanonicalServiceTransition[];
  packageTransactions: CanonicalPackageTransaction[];
}) {
  const registeredCommandIds = new Set(args.lifecycleRegistry.records.map((record) => record.commandId).filter((id): id is string => Boolean(id)));
  const registeredProcessIds = new Set(args.lifecycleRegistry.records.map((record) => record.processId).filter((id): id is string => Boolean(id)));
  const executionByProcessId = new Map(args.executions.map((execution) => [execution.processId, execution]));
  const processByPid = new Map(args.processes.map((process) => [process.pid, process]));
  const processById = new Map(args.processes.map((process) => [process.id, process]));
  for (const process of args.processes) {
    if (registeredProcessIds.has(process.id) && process.lifecycleOrigin !== "execution_first" && process.lifecycleOrigin !== "system_origin") {
      throw new Error(`Linux simulation failed: legacy finalizer encountered registered process ${process.id}.`);
    }
    if (process.id === "process:package:dpkg" && !registeredProcessIds.has(process.id)) {
      throw new Error("Linux simulation failed: package dpkg process remained legacy.");
    }
    const execution = executionByProcessId.get(process.id);
    if (execution && !process.executionId) process.executionId = execution.id;
  }
  for (const command of args.commands) {
    if (registeredCommandIds.has(command.id)) continue;
    if (command.kind !== "background") {
      throw new Error(`Linux simulation failed: legacy finalizer encountered incident command ${command.id}.`);
    }
    if (!command.executionId) {
      const process = processByPid.get(command.processId);
      const execution = process ? executionByProcessId.get(process.id) : undefined;
      command.executionId = execution?.id;
      command.constructionOrigin = command.constructionOrigin || "legacy_derived";
      if (execution) {
        execution.commandId = command.id;
        execution.affectedServiceIds = command.affectedServiceIds || [];
      }
    }
  }
  const commandById = new Map(args.commands.map((command) => [command.id, command]));
  for (const scheduled of args.scheduledExecutions) {
    if (!scheduled.executionId) scheduled.executionId = executionByProcessId.get(scheduled.processId)?.id;
    const execution = scheduled.executionId ? args.executions.find((item) => item.id === scheduled.executionId) : undefined;
    if (execution) {
      execution.scheduledExecutionId = scheduled.id;
      execution.reason = scheduled.timerId ? "systemd_timer" : "cron";
      execution.outcome = scheduled.outcome;
      execution.exitCode = scheduled.exitCode;
      execution.affectedServiceIds = scheduled.affectedServiceIds;
    }
  }
  for (const transition of args.serviceTransitions) {
    if (!transition.executionId && transition.cause.type === "command") {
      transition.executionId = commandById.get(transition.cause.commandId)?.executionId;
    }
    const execution = transition.executionId ? args.executions.find((item) => item.id === transition.executionId) : undefined;
    if (execution && !execution.serviceTransitionIds.includes(transition.id)) execution.serviceTransitionIds.push(transition.id);
  }
  for (const transaction of args.packageTransactions) {
    transaction.executionIds = transaction.processIds
      .map((processId) => processById.get(processId)?.executionId)
      .filter((id): id is string => Boolean(id));
    for (const executionId of transaction.executionIds) {
      const execution = args.executions.find((item) => item.id === executionId);
      if (execution) {
        execution.reason = "package";
        if (!execution.packageTransactionIds.includes(transaction.id)) execution.packageTransactionIds.push(transaction.id);
      }
    }
  }
}

function buildExecutionMigrationDiagnostics(simulation: Pick<LinuxSimulationWorld, "commands" | "processes" | "executions" | "lifecycleRegistry">): CanonicalExecutionMigrationDiagnostics {
  const records = simulation.lifecycleRegistry.records;
  const ledger = authoritativeLifecycleLedgers.get(simulation.lifecycleRegistry) || [];
  const completed = records.filter((record) => record.state === "completed");
  const commandIds = new Set(completed.map((record) => record.commandId).filter((id): id is string => Boolean(id)));
  const processIds = new Set(completed.map((record) => record.processId).filter((id): id is string => Boolean(id)));
  const shellHosted = completed.filter((record) => record.mode === "no_child_process" && record.hostProcessId);
  const duplicateCount = (values: string[]) => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) duplicates.add(value);
      seen.add(value);
    }
    return duplicates.size;
  };
  const duplicateExecutionRegistrations = duplicateCount(records.map((record) => record.executionId).filter(Boolean));
  const duplicateCommandRegistrations = duplicateCount(records.map((record) => record.commandId).filter((id): id is string => Boolean(id)));
  const duplicateProcessRegistrations = duplicateCount(records.map((record) => record.processId).filter((id): id is string => Boolean(id)));
  const ledgerByRegistrationId = new Map(ledger.map((item) => [item.registrationId, item]));
  const invalidRegistrationFingerprints = records.filter((record) => {
    const authoritative = ledgerByRegistrationId.get(record.registrationId);
    return !authoritative || authoritative.recordRef !== record || authoritative.integrityFingerprint !== record.integrityFingerprint || lifecycleRecordFingerprint(record) !== record.integrityFingerprint;
  }).length;
  const replacedRegistryRecords = records.filter((record) => {
    const authoritative = ledgerByRegistrationId.get(record.registrationId);
    return Boolean(authoritative && authoritative.recordRef !== record);
  }).length;
  const authoritativeSerializedRegistryMismatches = ledger.length === records.length && invalidRegistrationFingerprints === 0 ? 0 : 1;
  const registryCardinalityViolations = duplicateExecutionRegistrations + duplicateCommandRegistrations + duplicateProcessRegistrations + authoritativeSerializedRegistryMismatches;
  const forgedCommands = simulation.commands.filter((command) => command.constructionOrigin === "execution_first" && !commandIds.has(command.id)).length;
  const forgedProcesses = simulation.processes.filter((process) => process.lifecycleOrigin === "execution_first" && !processIds.has(process.id)).length;
  const incidentRelevantLegacyCommands = simulation.commands.filter((command) => command.kind !== "background" && !commandIds.has(command.id)).length;
  const incidentRelevantLegacyProcesses = simulation.processes.filter((process) => {
    if (process.lifecycleOrigin !== "legacy_derived" && process.lifecycleOrigin) return false;
    const command = simulation.commands.find((item) => item.id === process.commandId);
    return (command ? command.kind !== "background" : false) || process.id === "process:package:dpkg";
  }).length;
  return {
    totalCommands: simulation.commands.length,
    executionFirstCommands: commandIds.size,
    legacyCommands: simulation.commands.filter((command) => !commandIds.has(command.id)).length,
    totalProcesses: simulation.processes.length,
    executionFirstProcesses: processIds.size,
    backgroundSystemProcesses: simulation.processes.filter((process) => process.lifecycleOrigin === "system_origin").length,
    legacyUnclassifiedProcesses: simulation.processes.filter((process) => !processIds.has(process.id) && process.lifecycleOrigin !== "system_origin").length,
    executionIntentsCreated: records.filter((record) => Boolean(record.executionId)).length,
    completedExecutions: completed.length,
    failedNoChildExecutions: simulation.executions.filter((execution) => execution.outcome === "failure" || execution.processPolicy === "no_child_process").length,
    builderRegisteredExecutions: records.length,
    pendingExecutions: records.filter((record) => record.state === "pending").length,
    constructionFailedExecutions: records.filter((record) => record.state === "construction_failed").length,
    builderRegisteredCommands: commandIds.size,
    builderRegisteredProcesses: processIds.size,
    shellHostedExecutions: shellHosted.length,
    backgroundStaticLegacyCommands: simulation.commands.filter((command) => command.kind === "background" && !commandIds.has(command.id)).length,
    backgroundStaticLegacyProcesses: simulation.processes.filter((process) => {
      const command = simulation.commands.find((item) => item.id === process.commandId);
      return !processIds.has(process.id) && (command?.kind === "background" || process.id === "process:cron:daemon");
    }).length,
    incidentRelevantLegacyCommands,
    incidentRelevantLegacyProcesses,
    forgedLabelObjects: forgedCommands + forgedProcesses,
    postFinalizationMutationViolations: records.reduce((total, record) => total + record.mutationViolations.length, 0),
    packageDpkgLegacyProcesses: simulation.processes.filter((process) => process.id === "process:package:dpkg" && !processIds.has(process.id)).length,
    duplicateExecutionRegistrations,
    duplicateCommandRegistrations,
    duplicateProcessRegistrations,
    invalidRegistrationFingerprints,
    replacedRegistryRecords,
    registryCardinalityViolations,
    frozenRecordMutationAttempts: 0,
    authoritativeLedgerRecords: ledger.length,
    serializedDiagnosticRecords: records.length,
    authoritativeSerializedRegistryMismatches,
  };
}

function parseTimestamp(value: string) {
  return Date.parse(value.replace(" ", "T") + "Z");
}

function identityId(username: string) {
  return `identity:${username}`;
}

function groupId(name: string) {
  return `group:${name}`;
}

function commandSlug(command: string, index: number) {
  const first = command.trim().split(/\s+/)[0] || "command";
  const base = first.split("/").pop() || first;
  const noun = /\brsync\b/.test(command)
    ? "rsync"
    : /\btar\b/.test(command)
      ? "archive"
      : /\bsystemctl\b/.test(command)
        ? "service"
        : /\bchmod\b/.test(command)
          ? "chmod"
          : /\bchown\b/.test(command)
            ? "chown"
            : /\bcurl\b/.test(command)
              ? "curl"
              : /\bwget\b/.test(command)
                ? "wget"
                : /\bstat\b/.test(command)
                  ? "stat"
                  : command.includes("authorized_keys")
                    ? "key-inspection"
                    : base.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return index === 0 ? "primary" : noun || `secondary-${index}`;
}

function commandExecutable(command: string) {
  const first = command.trim().split(/\s+/)[0] || "sh";
  if (first.includes("/")) return first;
  const usrBin = new Set([
    "journalctl",
    "grep",
    "stat",
    "systemctl",
    "apt",
    "apt-cache",
    "dpkg",
    "docker",
    "cat",
    "truncate",
    "logrotate",
    "rsync",
    "tar",
    "chmod",
    "chown",
    "curl",
    "wget",
    "ls",
  ]);
  return `${usrBin.has(first) ? "/usr/bin" : "/bin"}/${first}`;
}

function commandFiles(command: string, fallbackPath: string) {
  const paths: string[] = [...(command.match(/\/(?:etc|var|usr|srv|home|tmp|opt|run|dev|lib|mnt)\/[A-Za-z0-9._/@+-]+/g) || [])];
  if (/\bapt-cache\s+policy\b/i.test(command)) {
    paths.push("/var/lib/dpkg/status", "/var/lib/apt/lists");
  }
  if (/\bdpkg\s+-L\b/i.test(command)) {
    paths.push("/var/lib/dpkg/status", "/var/lib/dpkg/info");
  }
  if (/\bdocker\s+(?:run|inspect|ps|exec|cp)\b/i.test(command)) {
    paths.push("/var/run/docker.sock", "/var/lib/docker");
  }
  const systemdUnit = command.match(/\bsystemctl\s+\S+(?:\s+--[a-z0-9-]+)*\s+([a-z0-9@_.-]+)(?:\s|$)/i)?.[1];
  if (systemdUnit) {
    const unit = systemdUnit.endsWith(".service") ? systemdUnit : `${systemdUnit}.service`;
    paths.push(unit === "metrics-cache.service" || unit === "container-health.service" ? `/etc/systemd/system/${unit}` : `/lib/systemd/system/${unit}`);
  }
  return Array.from(new Set(paths.length > 0 ? paths : [fallbackPath]));
}

function commandCreatedPaths(command: string) {
  const created = new Set<string>();
  const tarOutput = command.match(/(?:^|\/)tar\b[^\n]*?\s-[a-z]*f[a-z]*\s+(\/\S+)/i)?.[1];
  if (tarOutput) created.add(tarOutput);
  const simple = command.match(/(?:^|\/)(?:cp|mv|install)\b[^\n]*\s+(\/\S+)\s*$/i)?.[1];
  if (simple) created.add(simple);
  const teeOutput = command.match(/(?:^|\/)tee\b(?:\s+-\S+)*\s+(\/\S+)/i)?.[1];
  if (teeOutput) created.add(teeOutput);
  const multi = command.match(/(?:^|\/)(?:touch|mkdir)\b([^\n]*)/i)?.[1] || "";
  for (const path of multi.match(/\/(?:etc|var|usr|srv|home|tmp|opt|run|dev|lib|mnt)\/[^\s;&|]+/g) || []) created.add(path);
  return created;
}

function fileMode(path: string, role: CanonicalFile["contentRole"]) {
  if (path === "/var/run/docker.sock" || path === "/run/containerd/containerd.sock") return 0o660;
  if (path.includes("/.ssh/authorized_keys")) return 0o600;
  if (path.endsWith("/.ssh")) return 0o700;
  if (path.includes("/etc/sudoers")) return 0o440;
  if (path === "/etc/ssh/sshd_config") return 0o644;
  if (path === "/etc/passwd") return 0o644;
  if (path === "/etc/group") return 0o644;
  if (path.includes("/etc/systemd/system/")) return 0o644;
  if (path.includes("/lib/systemd/system/")) return 0o644;
  if (/^\/usr\/(?:local\/)?s?bin\//.test(path)) return 0o755;
  if (path.endsWith(".sh")) return 0o750;
  if (path.startsWith("/var/log/")) return 0o640;
  if (path.endsWith("/") || path === "/srv/shared" || path === "/tmp/export" || path === "/var/lib/docker" || path.startsWith("/var/lib/docker/") || path.endsWith("/containers/portal-worker")) return 0o750;
  if (role === "incident_output") return 0o640;
  return 0o640;
}

function fileType(path: string): CanonicalFile["fileType"] {
  if (path === "/var/run/docker.sock" || path === "/run/containerd/containerd.sock" || path.endsWith(".sock")) return "socket";
  if (path.endsWith("/") || path === "/srv/shared" || path === "/srv/backups/current" || path === "/tmp/export" || path === "/var/lib/docker" || path.startsWith("/var/lib/docker/") || path.endsWith("/containers/portal-worker")) return "directory";
  return "regular";
}

function fileRole(path: string): CanonicalFile["contentRole"] {
  if (path.includes("authorized_keys")) return "credential";
  if (path.startsWith("/etc/")) return "configuration";
  if (path.startsWith("/var/log/")) return "log";
  if (path.endsWith(".sh")) return "script";
  if (path.startsWith("/tmp/")) return "incident_output";
  return "incident_target";
}

function modeString(mode: number, type: CanonicalFile["fileType"]) {
  const flags = [
    0o400,
    0o200,
    0o100,
    0o040,
    0o020,
    0o010,
    0o004,
    0o002,
    0o001,
  ].map((bit, index) => (mode & bit ? "rwx"[index % 3] : "-"));
  const prefix =
    type === "directory" ? "d" :
    type === "socket" ? "s" :
    type === "symlink" ? "l" :
    type === "device" ? "c" :
    "-";
  return `${prefix}${flags.join("")}`;
}

function serviceId(unitName: string) {
  return `service:${unitName.replace(/[^a-z0-9@_.-]+/gi, "-").toLowerCase()}`;
}

function canonicalPrimaryServiceUnit(incident: LinuxIncident) {
  return incident.affectedService.endsWith(".service") || incident.affectedService.endsWith(".timer")
    ? incident.affectedService
    : incident.id === "unauthorized_package_install"
      ? "apt-daily.service"
      : "ssh.service";
}

function serviceRoleRank(role: CanonicalService["role"]) {
  return role === "primary" ? 3 : role === "secondary" ? 2 : 1;
}

function promoteServiceRole(
  current: CanonicalService["role"] | undefined,
  next: CanonicalService["role"] | undefined
) {
  if (!current) return next || "background";
  if (!next) return current;
  return serviceRoleRank(next) > serviceRoleRank(current) ? next : current;
}

function inferCanonicalServiceRole(
  unitName: string,
  incident: LinuxIncident,
  explicit?: CanonicalService["role"]
): CanonicalService["role"] {
  if (explicit) return explicit;
  if (unitName === canonicalPrimaryServiceUnit(incident)) return "primary";
  if (/^(?:apt-daily|apt-daily-upgrade|logrotate|certbot|snapd|systemd-timesyncd|NetworkManager)/i.test(unitName)) {
    return "background";
  }
  if (/^(?:ssh|cron|rsyslog|auditd|ufw|docker|containerd|nginx|apache2|backup|backup-agent|rsync|metrics-cache|postgresql|prometheus|gitlab-runner|gitaly|bind9|postfix|opendkim|kubelet|squid)\.service$/i.test(unitName)) {
    return "secondary";
  }
  return "background";
}

export function canonicalPrimaryService(simulation: LinuxSimulationWorld) {
  const primary = simulation.services.filter((service) => service.role === "primary");
  if (primary.length !== 1) {
    throw new Error(`Linux simulation service model expected one primary service, found ${primary.length}.`);
  }
  return primary[0];
}

export function canonicalSecondaryServices(simulation: LinuxSimulationWorld) {
  return simulation.services.filter((service) => service.role === "secondary");
}

export function canonicalBackgroundServices(simulation: LinuxSimulationWorld) {
  return simulation.services.filter((service) => service.role === "background");
}

export function canonicalProcessRuntimeEndAt(process: CanonicalProcess) {
  return [process.endedAt, process.serviceRetiredAt].filter((value): value is string => Boolean(value)).sort()[0];
}

function isProcessAliveAtTimestamp(process: CanonicalProcess, timestamp: string) {
  const endedAt = canonicalProcessRuntimeEndAt(process);
  return process.startedAt <= timestamp && (!endedAt || endedAt > timestamp);
}

function serviceListenerSpec(unitName: string): { address?: string; port?: number; protocol?: "tcp" | "udp"; executable: string; argv?: string[]; pid: number } | undefined {
  const specs: Record<string, { address?: string; port?: number; protocol?: "tcp" | "udp"; executable: string; argv?: string[]; pid: number }> = {
    "ssh.service": { address: "0.0.0.0", port: 22, protocol: "tcp", executable: "/usr/sbin/sshd", argv: ["/usr/sbin/sshd", "-D"], pid: 812 },
    "nginx.service": { address: "0.0.0.0", port: 80, protocol: "tcp", executable: "/usr/sbin/nginx", argv: ["/usr/sbin/nginx", "-g", "daemon off;"], pid: 1210 },
    "apache2.service": { address: "0.0.0.0", port: 80, protocol: "tcp", executable: "/usr/sbin/apache2", argv: ["/usr/sbin/apache2", "-k", "start"], pid: 1216 },
    "backup-agent.service": { address: "127.0.0.1", port: 9898, protocol: "tcp", executable: "/usr/sbin/backup-agent", argv: ["/usr/sbin/backup-agent"], pid: 1511 },
    "rsync.service": { address: "0.0.0.0", port: 873, protocol: "tcp", executable: "/usr/bin/rsync", argv: ["/usr/bin/rsync", "--daemon"], pid: 1518 },
    "docker.service": { address: "127.0.0.1", port: 2375, protocol: "tcp", executable: "/usr/bin/dockerd", argv: ["/usr/bin/dockerd", "-H", "fd://", "-H", "tcp://127.0.0.1:2375"], pid: 1244 },
    "containerd.service": { executable: "/usr/bin/containerd", argv: ["/usr/bin/containerd", "--address", "/run/containerd/containerd.sock"], pid: 1201 },
    "kubelet.service": { address: "127.0.0.1", port: 10248, protocol: "tcp", executable: "/usr/bin/kubelet", argv: ["/usr/bin/kubelet", "--config=/var/lib/kubelet/config.yaml"], pid: 1260 },
    "gitlab-runner.service": { address: "127.0.0.1", port: 8080, protocol: "tcp", executable: "/usr/bin/gitlab-runner", argv: ["/usr/bin/gitlab-runner", "run"], pid: 1184 },
    "gitaly.service": { address: "127.0.0.1", port: 8075, protocol: "tcp", executable: "/usr/bin/gitaly", argv: ["/usr/bin/gitaly"], pid: 1170 },
    "bind9.service": { address: "0.0.0.0", port: 53, protocol: "udp", executable: "/usr/sbin/named", argv: ["/usr/sbin/named", "-f"], pid: 1064 },
    "postfix.service": { address: "0.0.0.0", port: 25, protocol: "tcp", executable: "/usr/sbin/postfix", argv: ["/usr/sbin/postfix", "start-fg"], pid: 1032 },
    "opendkim.service": { address: "127.0.0.1", port: 8891, protocol: "tcp", executable: "/usr/sbin/opendkim", argv: ["/usr/sbin/opendkim", "-f"], pid: 1077 },
    "prometheus.service": { address: "0.0.0.0", port: 9090, protocol: "tcp", executable: "/usr/bin/prometheus", argv: ["/usr/bin/prometheus"], pid: 1120 },
    "node_exporter.service": { address: "127.0.0.1", port: 9100, protocol: "tcp", executable: "/usr/bin/node_exporter", argv: ["/usr/bin/node_exporter"], pid: 1122 },
    "postgresql.service": { address: "127.0.0.1", port: 5432, protocol: "tcp", executable: "/usr/lib/postgresql/16/bin/postgres", argv: ["/usr/lib/postgresql/16/bin/postgres"], pid: 1044 },
    "pgbouncer.service": { address: "127.0.0.1", port: 6432, protocol: "tcp", executable: "/usr/sbin/pgbouncer", argv: ["/usr/sbin/pgbouncer"], pid: 1048 },
    "openvpn.service": { address: "0.0.0.0", port: 1194, protocol: "udp", executable: "/usr/sbin/openvpn", argv: ["/usr/sbin/openvpn", "--config", "/etc/openvpn/server.conf"], pid: 1144 },
    "squid.service": { address: "0.0.0.0", port: 3128, protocol: "tcp", executable: "/usr/sbin/squid", argv: ["/usr/sbin/squid", "-N", "-f", "/etc/squid/squid.conf"], pid: 1132 },
  };
  return specs[unitName];
}

function serviceProcessUser(unitName: string, world: InvestigationWorld) {
  if (/^(?:postgresql|pgbouncer)\.service$/.test(unitName)) return "postgres";
  if (unitName === "bind9.service") return "bind";
  if (/^(?:prometheus|node_exporter)\.service$/.test(unitName)) return "prometheus";
  if (/^(?:gitaly|gitlab-runner)\.service$/.test(unitName)) return unitName === "gitaly.service" ? "git" : "gitlab-runner";
  if (/^(?:backup-agent|rsync)\.service$/.test(unitName)) return world.serviceUser;
  if (unitName === "squid.service") return "proxy";
  return "root";
}

function descriptorTypeForFile(file: CanonicalFile): CanonicalOpenFileDescriptor["descriptorType"] {
  if (file.deletedAt) return "deleted_regular_file";
  if (file.path.startsWith("/var/log/")) return "log_file";
  if (file.path.startsWith("/etc/") || file.path.startsWith("/lib/systemd/") || file.path.startsWith("/usr/lib/systemd/")) {
    return "configuration_file";
  }
  return "regular_file";
}

function descriptorAccessMode(file: CanonicalFile): CanonicalOpenFileDescriptor["accessMode"] {
  if (file.path.startsWith("/var/log/") || file.contentRole === "incident_output") return "w";
  if (file.contentRole === "configuration" || file.contentRole === "credential") return "r";
  return "u";
}

function descriptorOpenTimestamp(process: CanonicalProcess, index: number, collection: CanonicalCollectionState) {
  const opened = timestampPlusSeconds(process.startedAt, Math.max(1, index + 1));
  return opened <= collection.windowEnd ? opened : process.startedAt;
}

export function buildCanonicalOpenFileDescriptors(simulation: Pick<
  LinuxSimulationWorld,
  "processes" | "files" | "services" | "collection" | "identities"
>): CanonicalOpenFileDescriptor[] {
  const descriptors: CanonicalOpenFileDescriptor[] = [];
  const fileById = new Map(simulation.files.map((file) => [file.id, file]));
  const captureAt = simulation.collection.windowEnd;
  const serviceByProcessId = new Map<string, CanonicalService>();
  for (const service of simulation.services) {
    if (service.mainProcessId) serviceByProcessId.set(service.mainProcessId, service);
  }

  for (const process of simulation.processes) {
    if (!isProcessAliveAtTimestamp(process, captureAt)) continue;
    const identityId = process.effectiveUid === 0 ? "identity:root" : process.identityId;
    const identity = simulation.identities.find((item) => item.id === identityId);
    const username = identity?.username || (process.effectiveUid === 0 ? "root" : process.identityId.replace(/^identity:/, ""));
    process.openFileIds.forEach((fileId, index) => {
      const file = fileById.get(fileId);
      if (!file) return;
      const openedAt = descriptorOpenTimestamp(process, index, simulation.collection);
      descriptors.push({
        id: `descriptor:${process.id.replace(/^process:/, "")}:${index + 3}`,
        processId: process.id,
        pid: process.pid,
        processStartedAt: process.startedAt,
        userIdentityId: identityId,
        username,
        fd: String(index + 3),
        descriptorType: descriptorTypeForFile(file),
        accessMode: descriptorAccessMode(file),
        targetKind: "file",
        targetId: file.id,
        targetPath: file.path,
        inode: file.inode,
        openedAt,
        state: "current",
        deleted: Boolean(file.deletedAt),
        eventIds: [],
        relatedServiceId: serviceByProcessId.get(process.id)?.id,
      });
    });
  }

  const sshService = simulation.services.find((service) => service.unitName === "ssh.service");
  const sshd = simulation.processes.find((process) => process.id === sshService?.mainProcessId && isProcessAliveAtTimestamp(process, captureAt));
  if (sshd && sshService?.activeState === "active" && sshService.subState === "running") {
    descriptors.push({
      id: "descriptor:sshd:listen:22",
      processId: sshd.id,
      pid: sshd.pid,
      processStartedAt: sshd.startedAt,
      userIdentityId: "identity:root",
      username: "root",
      fd: "6u",
      descriptorType: "listening_socket",
      accessMode: "u",
      targetKind: "socket",
      targetId: "socket:ssh:tcp:22",
      localAddress: "0.0.0.0",
      localPort: 22,
      protocol: "tcp",
      openedAt: timestampPlusSeconds(sshd.startedAt, 2),
      state: "current",
      deleted: false,
      eventIds: [],
      relatedServiceId: sshService.id,
    });
  }
  for (const service of simulation.services) {
    if (service.unitName === "ssh.service" || service.activeState !== "active" || service.subState !== "running" || !service.mainProcessId) continue;
    const spec = serviceListenerSpec(service.unitName);
    const process = simulation.processes.find((item) => item.id === service.mainProcessId);
    if (!spec?.port || !spec.protocol || !process || !isProcessAliveAtTimestamp(process, captureAt)) continue;
    descriptors.push({
      id: `descriptor:${service.id.replace(/^service:/, "")}:listen:${spec.port}`,
      processId: process.id,
      pid: process.pid,
      processStartedAt: process.startedAt,
      userIdentityId: process.effectiveUid === 0 ? "identity:root" : process.identityId,
      username: process.effectiveUid === 0 ? "root" : simulation.identities.find((identity) => identity.id === process.identityId)?.username || process.identityId.replace(/^identity:/, ""),
      fd: "6u",
      descriptorType: "listening_socket",
      accessMode: "u",
      targetKind: "socket",
      targetId: `socket:${service.unitName}:${spec.protocol}:${spec.port}`,
      localAddress: spec.address,
      localPort: spec.port,
      protocol: spec.protocol,
      openedAt: timestampPlusSeconds(process.startedAt, 2),
      state: "current",
      deleted: false,
      eventIds: [],
      relatedServiceId: service.id,
    });
  }

  return descriptors.sort((left, right) =>
    left.pid - right.pid ||
    String(left.fd).localeCompare(String(right.fd)) ||
    left.id.localeCompare(right.id)
  );
}

export function validateCanonicalOpenFileDescriptors(simulation: LinuxSimulationWorld) {
  const captureAt = simulation.collection.windowEnd;
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));
  const fileById = new Map(simulation.files.map((file) => [file.id, file]));
  const identityById = new Map(simulation.identities.map((identity) => [identity.id, identity]));
  const serviceById = new Map(simulation.services.map((service) => [service.id, service]));
  const fdByProcess = new Set<string>();
  const descriptors = simulation.openFileDescriptors || [];

  const listeners = descriptors.filter((item) => item.state === "current" && item.descriptorType === "listening_socket");
  for (const [index, listener] of listeners.entries()) {
    for (const other of listeners.slice(index + 1)) {
      const sameAddressFamily = Boolean(listener.localAddress?.includes(":")) === Boolean(other.localAddress?.includes(":"));
      const overlap = listener.localAddress === other.localAddress ||
        (sameAddressFamily && [listener.localAddress, other.localAddress].some((address) => address === "0.0.0.0" || address === "::"));
      if (listener.protocol === other.protocol && listener.localPort === other.localPort && overlap && listener.targetId !== other.targetId) {
        throw new Error(`Linux simulation validation failed: independent listener collision ${listener.protocol} ${listener.localAddress}:${listener.localPort} between ${listener.id} and ${other.id}.`);
      }
    }
  }

  for (const descriptor of descriptors) {
    const process = processById.get(descriptor.processId);
    if (!process) {
      throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} PID ${descriptor.pid} references missing process ${descriptor.processId}.`);
    }
    if (process && descriptor.pid !== process.pid) {
      throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} PID mismatch expected ${process.pid} actual ${descriptor.pid}.`);
    }
    if (process && descriptor.processStartedAt !== process.startedAt) {
      throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} process start mismatch for PID ${descriptor.pid}.`);
    }
    if (process && !isProcessAliveAtTimestamp(process, captureAt) && descriptor.state === "current") {
      throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} PID ${descriptor.pid} is current after process exit ${process.endedAt}.`);
    }
    if (process && descriptor.openedAt < process.startedAt) {
      throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} opened before process ${descriptor.pid} started.`);
    }
    if (descriptor.closedAt && descriptor.closedAt < descriptor.openedAt) {
      throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} closes before it opens.`);
    }
    if (descriptor.state === "current" && descriptor.closedAt && descriptor.closedAt <= captureAt) {
      throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} is current after close ${descriptor.closedAt}.`);
    }
    if (process) {
      const expectedIdentityId = process.effectiveUid === 0 ? "identity:root" : process.identityId;
      if (descriptor.userIdentityId !== expectedIdentityId) {
        throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} user identity mismatch for PID ${descriptor.pid}.`);
      }
      const expectedUser = identityById.get(expectedIdentityId)?.username;
      if (expectedUser && descriptor.username !== expectedUser) {
        throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} username mismatch expected ${expectedUser} actual ${descriptor.username}.`);
      }
    }
    const fdKey = `${descriptor.processId}:${descriptor.fd}`;
    if (descriptor.state === "current" && fdByProcess.has(fdKey)) {
      throw new Error(`Linux simulation validation failed: duplicate current descriptor FD ${descriptor.fd} for PID ${descriptor.pid}.`);
    }
    if (descriptor.state === "current") fdByProcess.add(fdKey);

    if (descriptor.targetKind === "file") {
      const file = fileById.get(descriptor.targetId);
      if (!file) {
        throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} target file missing ${descriptor.targetId}.`);
      }
      if (file && descriptor.targetPath !== file.path) {
        throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} target path mismatch expected ${file.path} actual ${descriptor.targetPath}.`);
      }
      if (file?.deletedAt && !descriptor.deleted) {
        throw new Error(`Linux simulation validation failed: deleted-but-open descriptor ${descriptor.id} is missing deleted state.`);
      }
      if (!file?.deletedAt && descriptor.deleted) {
        throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} marks existing file as deleted.`);
      }
      if (file?.deletedAt && descriptor.openedAt > file.deletedAt) {
        throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} opened after file deletion ${file.deletedAt}.`);
      }
    }

    if (descriptor.targetKind === "socket") {
      if (descriptor.descriptorType === "listening_socket" && (!descriptor.localPort || !descriptor.protocol)) {
        throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} listening socket lacks local endpoint.`);
      }
      if (descriptor.localPort === 22 && descriptor.relatedServiceId) {
        const service = serviceById.get(descriptor.relatedServiceId);
        if (!service || service.unitName !== "ssh.service" || service.activeState !== "active") {
          throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} listener service mismatch.`);
        }
      }
    }

    if (descriptor.relatedServiceId) {
      const service = serviceById.get(descriptor.relatedServiceId);
      if (!service) throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} service missing ${descriptor.relatedServiceId}.`);
      if (service && service.mainProcessId && service.mainProcessId !== descriptor.processId) {
        throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} service ${service.unitName} ownership mismatch.`);
      }
      if (service && (service.activeState !== "active" || service.subState !== "running") && descriptor.state === "current") {
        throw new Error(`Linux simulation validation failed: descriptor ${descriptor.id} service ${service.unitName} is not running.`);
      }
    }
  }
}

function serviceUnitPath(unitName: string, local = false) {
  if (local) return `/etc/systemd/system/${unitName}`;
  return unitName.endsWith(".timer")
    ? `/lib/systemd/system/${unitName}`
    : `/lib/systemd/system/${unitName}`;
}

function serviceUnitType(unitName: string): CanonicalService["unitType"] {
  if (unitName.endsWith(".timer")) return "timer";
  if (unitName.endsWith(".socket")) return "socket";
  if (unitName.endsWith(".target")) return "target";
  if (/apt-daily|logrotate|certbot|systemd-tmpfiles|metrics-cache|ufw\.service/.test(unitName)) return "oneshot";
  if (/postfix|apache2|nginx|cron|ssh|rsyslog|auditd|docker|containerd|kubelet|gitlab-runner|postgres|bind9|backup-agent|rsync|prometheus|grafana-agent|php8\.3-fpm/.test(unitName)) return "simple";
  return "simple";
}

function packageForUnit(unitName: string) {
  if (unitName.startsWith("ssh.")) return "openssh-server";
  if (unitName.startsWith("cron.")) return "cron";
  if (unitName.startsWith("apt-daily")) return "apt";
  if (unitName.startsWith("docker.")) return "docker.io";
  if (unitName.startsWith("containerd.")) return "containerd";
  if (unitName.startsWith("apache2.")) return "apache2";
  if (unitName.startsWith("nginx.")) return "nginx";
  if (unitName.startsWith("postfix.")) return "postfix";
  if (unitName.startsWith("metrics-cache.")) return undefined;
  return unitName.replace(/\.(service|timer|socket)$/, "");
}

function serviceProcessToken(unitName: string) {
  const unit = unitName.replace(/\.(?:service|timer|socket|target|path)$/, "").split("@")[0];
  const processTokens: Record<string, string> = {
    bind9: "named",
    postgresql: "postgres",
    ssh: "sshd",
    "php8.3-fpm": "php-fpm8.3",
  };
  return processTokens[unit] || unit;
}

function serviceRuntimeExecutable(unitName: string) {
  const executables: Record<string, string> = {
    "auditd.service": "/sbin/auditd",
    "cron.service": "/usr/sbin/cron",
    "grafana-agent.service": "/usr/bin/grafana-agent",
    "kube-proxy.service": "/usr/bin/kube-proxy",
    "php8.3-fpm.service": "/usr/sbin/php-fpm8.3",
    "rspamd.service": "/usr/bin/rspamd",
    "rsyslog.service": "/usr/sbin/rsyslogd",
    "systemd-resolved.service": "/lib/systemd/systemd-resolved",
  };
  return executables[unitName] || `/usr/sbin/${serviceProcessToken(unitName)}`;
}

function serviceTypeForUnit(unitName: string): CanonicalService["serviceType"] {
  return serviceUnitType(unitName) === "oneshot" ? "oneshot" : "long-running";
}

function activeSubState(unitName: string, activeState: CanonicalService["activeState"]) {
  if (activeState === "inactive") return serviceUnitType(unitName) === "oneshot" ? "dead" : "dead";
  if (activeState === "failed") return "failed";
  if (unitName.endsWith(".timer")) return "waiting";
  if (serviceUnitType(unitName) === "oneshot") return "exited";
  return "running";
}

function defaultServiceResult(activeState: CanonicalService["activeState"], subState: string): CanonicalService["result"] {
  if (activeState === "failed" || subState === "failed") return "exit-code";
  return activeState === "active" ? "success" : "none";
}

function serviceLoadedState(options: Partial<CanonicalService>) {
  if (options.unitPresent === false) return "not-found" as const;
  if (options.unitFileState === "masked") return "masked" as const;
  return options.loadState || "loaded";
}

function commandSystemdUnit(command: CanonicalCommand) {
  const unit = command.renderedCommand.match(/\bsystemctl\s+(?:enable\s+--now|restart|reload|start|stop|enable|disable|mask|unmask|status|is-active|is-enabled)\s+([a-z0-9@_.-]+)(?:\s|$)/i)?.[1];
  if (!unit) return undefined;
  return unit.endsWith(".service") || unit.endsWith(".timer") ? unit : `${unit}.service`;
}

function roleServiceUnits(role: string, primaryService = "apache2.service") {
  const lower = role.toLowerCase();
  if (lower.includes("ci") || lower.includes("git")) return ["gitlab-runner.service", "gitaly.service", "docker.service", "containerd.service"];
  if (lower.includes("web") || lower.includes("application")) return [primaryService === "nginx.service" ? "nginx.service" : "apache2.service", "certbot.timer", "php8.3-fpm.service"];
  if (lower.includes("backup")) return ["backup-agent.service", "rsync.service", "restic.timer"];
  if (lower.includes("docker") || lower.includes("container") || lower.includes("kubernetes")) return ["containerd.service", "docker.service", "kubelet.service", "kube-proxy.service"];
  if (lower.includes("dns")) return ["bind9.service", "systemd-resolved.service"];
  if (lower.includes("mail")) return ["postfix.service", "opendkim.service", "rspamd.service"];
  if (lower.includes("monitoring")) return ["prometheus.service", "grafana-agent.service", "node_exporter.service"];
  if (lower.includes("database")) return ["postgresql.service", "pgbouncer.service"];
  if (lower.includes("proxy")) return ["squid.service"];
  return [];
}

function roleFamily(role: string) {
  const lower = role.toLowerCase();
  if (lower.includes("ci") || lower.includes("git")) return "platform";
  if (lower.includes("web") || lower.includes("application")) return "web";
  if (lower.includes("backup")) return "backup";
  if (lower.includes("docker") || lower.includes("container") || lower.includes("kubernetes")) return "container";
  if (lower.includes("dns")) return "dns";
  if (lower.includes("mail")) return "mail";
  if (lower.includes("monitoring")) return "monitoring";
  if (lower.includes("database")) return "database";
  if (lower.includes("ssh") || lower.includes("jump") || lower.includes("bastion") || lower.includes("vpn")) return "access";
  return "general";
}

function assetId(path: string) {
  return `evidence:${path.replace(/^assets\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
}

function evidenceDisplayName(path: string) {
  return path.split("/").pop() || path;
}

function evidenceAsset(
  path: string,
  assetType: CanonicalEvidenceAsset["assetType"],
  capabilities: CanonicalEvidenceCapability[],
  canonicalObjectIds: string[],
  eventIds: string[],
  exactTimestampSupport: boolean,
  aliases: string[] = [],
  options: Partial<Pick<CanonicalEvidenceAsset, "relations" | "support" | "collectionTimestamp" | "timezone" | "timestampFormat" | "stateType">> = {}
): CanonicalEvidenceAsset {
  const uniqueObjectIds = Array.from(new Set(canonicalObjectIds));
  return {
    id: assetId(path),
    path,
    displayName: evidenceDisplayName(path),
    assetType,
    canonicalObjectIds: uniqueObjectIds,
    subjectRefs: uniqueObjectIds.map(linuxSubjectRef),
    relations: options.relations || [],
    eventIds: Array.from(new Set(eventIds)),
    capabilities: Array.from(new Set(capabilities)),
    support: options.support || (exactTimestampSupport ? "exact" : assetType.includes("document") || assetType === "policy_document" ? "context" : "static"),
    exactTimestampSupport,
    collectionTimestamp: options.collectionTimestamp,
    timezone: options.timezone || "UTC",
    timestampFormat: options.timestampFormat || (exactTimestampSupport ? "YYYY-MM-DD HH:mm:ss" : options.collectionTimestamp ? "collection-capture-instant" : undefined),
    stateType: options.stateType || (assetType === "process_snapshot" || assetType === "open_files" || assetType === "service_inventory" || assetType === "network_state" ? "collection_snapshot" : assetType.includes("document") ? "static_document" : undefined),
    aliases: Array.from(new Set([evidenceDisplayName(path), path.replace(/^assets\//, ""), ...aliases])),
  };
}

function parseRegistryCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function renderedGroupsCsvSubjects(simulation: LinuxSimulationWorld, assets?: Array<{ file_path: string; content?: string }>) {
  const groupsCsv = assets?.find((asset) => asset.file_path === "assets/csv/groups.csv" && asset.content);
  const subjects = new Set<string>();
  const addGroup = (name: string) => {
    const group = simulation.groups.find((item) => item.name === name);
    if (group) subjects.add(group.id);
  };
  const addIdentity = (username: string) => {
    const identity = simulation.identities.find((item) => item.username === username);
    if (identity) subjects.add(identity.id);
  };

  if (groupsCsv?.content) {
    for (const row of groupsCsv.content.replace(/\r\n/g, "\n").split("\n").slice(1)) {
      if (!row.trim()) continue;
      const [groupName, members = ""] = parseRegistryCsvLine(row);
      addGroup(groupName);
      members.split(",").map((member) => member.trim()).filter(Boolean).forEach(addIdentity);
    }
    return Array.from(subjects);
  }

  ["sudo", "adm", "www-data", "interns", "backup", "contractors", "disabled", "developers", "platform", "finance", "hr", "audit", "monitoring", "release", "support"].forEach(addGroup);
  [
    ...simulation.investigation.adminAccounts,
    ...simulation.investigation.serviceAccounts,
  ].forEach(addIdentity);
  return Array.from(subjects);
}

export function buildCanonicalEvidenceRegistry(simulation: LinuxSimulationWorld, assets?: Array<{ file_path: string; content?: string }>) {
  const relations = buildLinuxEvidenceRelations(simulation);
  const commandIds = simulation.commands.map((command) => command.id);
  const sessionIds = simulation.sshSessions.map((session) => session.id);
  const sessionIdentityIds = Array.from(new Set(simulation.sshSessions.map((session) => session.identityId)));
  const fileIds = simulation.files.map((file) => file.id);
  const currentFiles = simulation.files.filter((file) => !file.deletedAt);
  const currentFileIds = currentFiles.map((file) => file.id);
  const currentFileOwnerIds = Array.from(new Set(currentFiles.map((file) => file.ownerIdentityId)));
  const currentFileGroupIds = Array.from(new Set(currentFiles.map((file) => file.groupId)));
  const serviceIds = simulation.services.map((service) => service.id);
  const transitionIds = simulation.serviceTransitions.map((transition) => transition.id);
  const packageIds = simulation.packageTransactions.map((transaction) => transaction.id);
  const cronIds = simulation.cronDefinitions.map((definition) => definition.id);
  const scheduledIds = simulation.scheduledExecutions.map((execution) => execution.id);
  const maintenanceIds = simulation.maintenanceActivities.map((activity) => activity.id);
  const reviewSubjectIds = linuxLearnerReviewSubjectIds(simulation);
  const eventIds = simulation.events.map((event) => event.id);
  const identityIds = simulation.identities.map((identity) => identity.id);
  const groupIds = simulation.groups.map((group) => group.id);
  const groupIdsByName = (names: string[]) => {
    const wanted = new Set(names);
    return simulation.groups.filter((group) => wanted.has(group.name)).map((group) => group.id);
  };
  const identityIdsByName = (names: string[]) => {
    const wanted = new Set(names);
    return simulation.identities.filter((identity) => wanted.has(identity.username)).map((identity) => identity.id);
  };
  const affectedServiceIds = simulation.services
    .filter((service) => service.role === "primary")
    .map((service) => service.id);
  const configurationPackServiceIds = Array.from(new Set([
    ...affectedServiceIds,
    ...simulation.services
      .filter((service) => service.unitName === simulation.investigation.affectedService)
      .map((service) => service.id),
  ]));
  const authorizedKeyFiles = simulation.files.filter((file) => file.path === `/home/${simulation.investigation.primaryUser}/.ssh/authorized_keys`);
  const authorizedKeyFileSubjects = Array.from(new Set(authorizedKeyFiles.flatMap((file) => [
    file.id,
    file.ownerIdentityId,
    file.groupId,
    ...sessionIdentityIds,
  ]).filter(Boolean)));
  const commandsForTarget = (target: CanonicalCommandRenderTarget) => simulation.commands.filter((command) => command.expectedRenderTargets.includes(target));
  const commandIdsForTarget = (target: CanonicalCommandRenderTarget) => commandsForTarget(target).map((command) => command.id);
  const commandSubjectsForTarget = (target: CanonicalCommandRenderTarget) => {
    const commands = commandsForTarget(target);
    const processIds = commands
      .map((command) => simulation.processes.find((process) => process.pid === command.processId)?.id)
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set([
      ...commands.map((command) => command.id),
      ...commands.map((command) => command.actorIdentityId),
      ...commands.map((command) => command.runAsIdentityId).filter((id): id is string => Boolean(id)),
      ...processIds,
      ...commands.flatMap((command) => command.affectedFileIds || []),
    ]));
  };
  const commandIdentitySubjectsForTarget = (target: CanonicalCommandRenderTarget) => {
    const commands = commandsForTarget(target);
    return Array.from(new Set([
      ...commands.map((command) => command.actorIdentityId),
      ...commands.map((command) => command.runAsIdentityId).filter((id): id is string => Boolean(id)),
    ]));
  };
  const commandProcessSubjectsForTarget = (target: CanonicalCommandRenderTarget) => {
    const commands = commandsForTarget(target);
    const processIds = commands
      .map((command) => simulation.processes.find((process) => process.pid === command.processId)?.id)
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set([
      ...commands.map((command) => command.id),
      ...processIds,
    ]));
  };
  const commandActorSubjectsForTarget = (target: CanonicalCommandRenderTarget) => {
    const commands = commandsForTarget(target);
    const processIds = commands
      .map((command) => simulation.processes.find((process) => process.pid === command.processId)?.id)
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set([
      ...commands.map((command) => command.id),
      ...commands.map((command) => command.actorIdentityId),
      ...commands.map((command) => command.runAsIdentityId).filter((id): id is string => Boolean(id)),
      ...processIds,
    ]));
  };
  const runtimeCaptureAt = simulation.collection.windowEnd;
  const isAliveAtRuntimeCapture = (process: CanonicalProcess) =>
    isProcessAliveAtTimestamp(process, runtimeCaptureAt);
  const processSnapshotIds = simulation.processes
    .filter(isAliveAtRuntimeCapture)
    .flatMap((process) => [process.id, process.commandId, process.effectiveUid === 0 ? "identity:root" : process.identityId].filter((id): id is string => Boolean(id)));
  const openFileIds = simulation.openFileDescriptors
    .filter((descriptor) => descriptor.state === "current")
    .flatMap((descriptor) => [
      descriptor.id,
      descriptor.processId,
      descriptor.userIdentityId,
      descriptor.targetKind === "file" ? descriptor.targetId : undefined,
    ].filter((id): id is string => Boolean(id)));
  const processHistoryIds = simulation.processes
    .filter((process) => process.pid !== 1)
    .flatMap((process) => [
      process.id,
      process.commandId,
      process.effectiveUid === 0 ? "identity:root" : process.identityId,
    ].filter((id): id is string => Boolean(id)));
  const fileAccessHistoryIds = simulation.commands
    .filter((command) => command.affectedFileIds.length > 0)
    .flatMap((command) => [
      command.id,
      simulation.processes.find((process) => process.pid === command.processId)?.id,
      ...command.affectedFileIds,
    ].filter((id): id is string => Boolean(id)));
  const rootCrontabSubjects = simulation.cronDefinitions
    .filter((definition) => definition.source === "root_crontab" && definition.enabled && definition.persistenceState === "present")
    .flatMap((definition) => [definition.id, definition.commandId, definition.runAsIdentityId].filter((item): item is string => Boolean(item)));
  const scriptAssets = simulationScriptAssets(simulation);
  const scriptSampleSubjects = simulation.scheduledExecutions.slice(0, 1).flatMap((execution) => [
    execution.commandId,
  ].filter((id): id is string => Boolean(id)));
  const cronExecutionSubjects = simulation.scheduledExecutions.flatMap((execution) => [
    execution.id,
    execution.definitionId,
    execution.commandId,
    execution.processId,
  ].filter((id): id is string => Boolean(id)));
  const cronSyslogSubjects = simulation.scheduledExecutions.flatMap((execution) => [
    execution.id,
    execution.definitionId,
    execution.commandId,
    execution.processId,
  ].filter((id): id is string => Boolean(id)));
  const packageSubjects = simulation.packageTransactions.flatMap((transaction) => [
    transaction.id,
    transaction.commandId,
    transaction.actorIdentityId,
    ...transaction.processIds,
    ...transaction.packages.map((pkg) => `package-subject:${pkg.name}`),
    ...transaction.affectedFileIds,
    ...transaction.affectedServiceIds,
  ].filter((id): id is string => Boolean(id)));
  const packageAuditSubjects = simulation.packageTransactions.flatMap((transaction) => [
    transaction.id,
    transaction.commandId,
    transaction.actorIdentityId,
    ...transaction.packages.map((pkg) => `package-subject:${pkg.name}`),
    ...transaction.affectedFileIds,
  ].filter((id): id is string => Boolean(id)));
  const packageHistorySubjects = simulation.packageTransactions.flatMap((transaction) => [
    transaction.id,
    transaction.commandId,
    transaction.source === "manual" ? transaction.actorIdentityId : undefined,
    ...transaction.packages.map((pkg) => `package-subject:${pkg.name}`),
  ].filter((id): id is string => Boolean(id)));
  const packageInventorySubjects = simulation.packageTransactions.flatMap((transaction) =>
    transaction.packages.map((pkg) => `package-subject:${pkg.name}`)
  );
  const transitionedServiceIds = Array.from(new Set(simulation.serviceTransitions.map((transition) => transition.serviceId)));
  const relationSubset = (subjectIds: string[]) => {
    const subjects = new Set(subjectIds);
    return relations.filter((item) => item.subjectIds.every((id) => subjects.has(id)));
  };
  const documentSubjects = (documentType: CanonicalDocument["documentType"]) => {
    const document = simulation.documents.find((item) => item.documentType === documentType);
    if (!document) return [];
    return Array.from(new Set(document.factIds.flatMap((factId) =>
      simulation.documentFacts.find((fact) => fact.id === factId)?.canonicalObjectIds || []
    ).filter(Boolean)));
  };
  const groupsCsvSubjects = renderedGroupsCsvSubjects(simulation, assets);
  const registry = [
    evidenceAsset("assets/logs/auth.log", "timestamped_log", ["authentication", "session_lifecycle", "actor_attribution", "timeline_exact"], [...sessionIds, ...sessionIdentityIds, ...commandSubjectsForTarget("auth")], eventIds, true, ["auth.log"], { relations: relationSubset([...sessionIds, ...sessionIdentityIds, ...commandSubjectsForTarget("auth")]), support: "exact" }),
    evidenceAsset("assets/logs/sudo.log", "timestamped_log", ["sudo_authorisation", "command_execution", "actor_attribution", "timeline_exact"], commandActorSubjectsForTarget("sudo"), eventIds, true, ["sudo.log"], { relations: relationSubset(commandActorSubjectsForTarget("sudo")), support: "exact" }),
    evidenceAsset("assets/logs/audit.log", "timestamped_log", ["command_execution", "actor_attribution", "open_file_correlation", "service_transition", "package_transaction", "timeline_exact"], [...commandSubjectsForTarget("audit"), ...transitionIds, ...transitionedServiceIds, ...packageAuditSubjects], eventIds, true, ["audit.log"], { relations: relationSubset([...commandSubjectsForTarget("audit"), ...transitionIds, ...transitionedServiceIds, ...packageAuditSubjects]), support: "exact" }),
    evidenceAsset("assets/logs/syslog", "timestamped_log", ["command_execution", "cron_execution", "timeline_exact", "timeline_context"], [...commandProcessSubjectsForTarget("syslog"), ...transitionIds, ...cronSyslogSubjects], eventIds, true, ["syslog.log", "syslog"], { relations: relationSubset([...commandProcessSubjectsForTarget("syslog"), ...transitionIds, ...cronSyslogSubjects]), support: "exact" }),
    evidenceAsset("assets/logs/cron.log", "timestamped_log", ["cron_execution", "command_execution", "timeline_exact"], cronExecutionSubjects, scheduledIds, true, ["cron.log"], { relations: relationSubset(cronExecutionSubjects), support: "exact" }),
    evidenceAsset("assets/logs/apt_history.log", "package_history", ["package_transaction", "timeline_exact"], packageHistorySubjects, packageIds, true, ["apt_history.log"], { relations: relationSubset(packageHistorySubjects), support: "exact" }),
    evidenceAsset("assets/journal/journal_ssh.txt", "journal", ["authentication", "session_lifecycle", "actor_attribution", "timeline_exact"], [...sessionIds, ...sessionIdentityIds], eventIds, true, ["journal_ssh"], { relations: relationSubset([...sessionIds, ...sessionIdentityIds]), support: "exact" }),
    evidenceAsset("assets/journal/journal_systemd.txt", "journal", ["service_state", "service_transition", "timeline_exact"], [...transitionedServiceIds, ...transitionIds], transitionIds, true, ["journal_systemd"], { relations: relationSubset([...transitionedServiceIds, ...transitionIds]), support: "exact" }),
    evidenceAsset("assets/runtime/process_snapshot.txt", "process_snapshot", ["current_process_state", "timeline_static"], processSnapshotIds, [], false, ["process snapshot", "live process snapshot"], { relations: relationSubset(processSnapshotIds), support: "static", collectionTimestamp: simulation.collection.windowEnd, stateType: "incident_snapshot" }),
    evidenceAsset("assets/runtime/open_files.txt", "open_files", ["current_open_file_state", "current_file_state", "file_owner_group_mode", "timeline_static"], openFileIds, [], false, ["open files", "live open files", "file descriptor snapshot"], { relations: relationSubset(openFileIds), support: "static", collectionTimestamp: simulation.collection.windowEnd, stateType: "incident_snapshot" }),
    evidenceAsset("assets/runtime/process_execution_history.txt", "process_snapshot", ["process_ancestry", "command_execution", "timeline_context"], processHistoryIds, [], false, ["process execution history", "process correlation report"], { relations: relationSubset(processHistoryIds), support: "exact", stateType: "historical_reconstruction" }),
    evidenceAsset("assets/runtime/file_access_history.csv", "open_files", ["open_file_correlation", "command_execution", "timeline_context"], fileAccessHistoryIds, [], false, ["file access history", "process file correlation"], { relations: relationSubset(fileAccessHistoryIds), support: "exact", stateType: "historical_reconstruction" }),
    evidenceAsset("assets/reports/permissions_report.txt", "file_metadata", ["current_file_state", "file_owner_group_mode", "timeline_static"], [...currentFileIds, ...currentFileOwnerIds, ...currentFileGroupIds], [], false, ["permissions_report"], { relations: relationSubset([...currentFileIds, ...currentFileOwnerIds, ...currentFileGroupIds]), support: "exact", collectionTimestamp: simulation.collection.collectedAt, stateType: "collection_snapshot" }),
    evidenceAsset("assets/reports/service_inventory.txt", "service_inventory", ["current_service_state", "service_state", "timeline_static"], serviceIds, [], false, ["service inventory"], { relations: relationSubset(serviceIds), support: "exact", collectionTimestamp: simulation.collection.collectedAt, stateType: "collection_snapshot" }),
    evidenceAsset("assets/inventory/package_inventory.txt", "package_inventory", ["current_package_state", "timeline_static"], packageInventorySubjects, [], false, ["package_inventory"], { relations: relationSubset(packageInventorySubjects), support: "static", collectionTimestamp: simulation.collection.collectedAt, stateType: "collection_snapshot" }),
    evidenceAsset("assets/scheduled/root_crontab.txt", "scheduled_definition", ["current_persistence_state", "cron_definition", "actor_attribution", "configuration_baseline", "timeline_static"], rootCrontabSubjects, [], false, ["root_crontab"], { relations: relationSubset(rootCrontabSubjects), support: "exact" }),
    ...simulation.cronDefinitions.filter((definition) => definition.source === "cron_d" && definition.enabled && definition.persistenceState === "present").map((definition) =>
      evidenceAsset(`assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`, "scheduled_definition", ["current_persistence_state", "cron_definition", "actor_attribution", "configuration_baseline", "timeline_static"], [definition.id, definition.commandId, definition.runAsIdentityId], [], false, [definition.sourcePath.split("/").pop() || definition.id], { relations: relationSubset([definition.id, definition.commandId, definition.runAsIdentityId]), support: "exact" })
    ),
    evidenceAsset("assets/accounts/passwd.sample", "identity_inventory", ["current_identity_state", "actor_attribution", "timeline_static"], identityIds, [], false, ["passwd"], { relations: relationSubset(identityIds), support: "static", collectionTimestamp: simulation.collection.collectedAt, stateType: "collection_snapshot" }),
    evidenceAsset("assets/accounts/group.sample", "identity_inventory", ["current_identity_state", "actor_attribution", "timeline_static"], groupIdsByName(["sudo", "adm", "docker", "backup", "contractors"]), [], false, ["group"], { relations: relationSubset(groupIdsByName(["sudo", "adm", "docker", "backup", "contractors"])), support: "static", collectionTimestamp: simulation.collection.collectedAt, stateType: "collection_snapshot" }),
    evidenceAsset("assets/csv/users.csv", "identity_inventory", ["current_identity_state", "actor_attribution", "timeline_static"], identityIds, [], false, ["users.csv"], { relations: relationSubset(identityIds), support: "static", collectionTimestamp: simulation.collection.collectedAt, stateType: "collection_snapshot" }),
    evidenceAsset("assets/csv/groups.csv", "identity_inventory", ["current_identity_state", "actor_attribution", "timeline_static"], groupsCsvSubjects, [], false, ["groups.csv"], { relations: relationSubset(groupsCsvSubjects), support: "static", collectionTimestamp: simulation.collection.collectedAt, stateType: "collection_snapshot" }),
    evidenceAsset("assets/configs/ssh/sshd_config", "static_config", ["current_configuration_state", "configuration_baseline", "key_provenance", "timeline_static"], [...serviceIds.filter((id) => id.includes("ssh")), ...sessionIdentityIds], [], false, ["sshd", "sshd_config"], { support: "static" }),
    ...authorizedKeyFiles.map((file) =>
      evidenceAsset(`assets/ssh/${simulation.investigation.primaryUser}/authorized_keys`, "static_config", ["key_provenance", "actor_attribution", "timeline_static"], authorizedKeyFileSubjects, [], false, ["authorized_keys"], { relations: relationSubset(authorizedKeyFileSubjects), support: "static" })
    ),
    evidenceAsset("assets/configs/sudoers.d/platform", "static_config", ["current_policy_state", "sudo_authorisation", "configuration_baseline", "timeline_static"], commandActorSubjectsForTarget("sudo"), [], false, ["platform"], { relations: relationSubset(commandActorSubjectsForTarget("sudo")), support: "static" }),
    evidenceAsset("assets/configs/pam/sshd", "static_config", ["current_configuration_state", "configuration_baseline", "authentication", "timeline_static"], serviceIds.filter((id) => id.includes("ssh")), [], false, ["pam_sshd", "pam sshd"], { support: "static" }),
    evidenceAsset("assets/configs/linux_config_pack.txt", "static_config", ["current_configuration_state", "current_policy_state", "configuration_baseline", "sudo_authorisation", "service_state", "change_control", "timeline_static"], [
      ...configurationPackServiceIds,
      ...commandActorSubjectsForTarget("sudo"),
      ...identityIdsByName([
        ...simulation.investigation.adminAccounts,
        ...simulation.investigation.serviceAccounts,
      ]),
      simulation.investigation.changeId,
    ], [], false, ["linux_config_pack"], { relations: relationSubset([
      ...configurationPackServiceIds,
      ...commandActorSubjectsForTarget("sudo"),
      ...identityIdsByName([
        ...simulation.investigation.adminAccounts,
        ...simulation.investigation.serviceAccounts,
      ]),
      simulation.investigation.changeId,
    ]), support: "context" }),
    evidenceAsset("assets/docs/change_request.md", "change_document", ["change_control", "maintenance_scope", "timeline_context"], Array.from(new Set([...documentSubjects("change_request"), ...maintenanceIds, simulation.investigation.changeId])), [], false, ["change_request", simulation.investigation.changeId], { relations: relationSubset(Array.from(new Set([...documentSubjects("change_request"), ...maintenanceIds, simulation.investigation.changeId]))), support: "context" }),
    evidenceAsset("assets/docs/maintenance_ticket.md", "maintenance_document", ["maintenance_scope", "change_control", "timeline_context"], Array.from(new Set([...documentSubjects("maintenance_ticket"), ...maintenanceIds, simulation.investigation.changeId])), [], false, ["maintenance_ticket", simulation.investigation.ticketId], { relations: relationSubset(Array.from(new Set([...documentSubjects("maintenance_ticket"), ...maintenanceIds, simulation.investigation.changeId]))), support: "context" }),
    evidenceAsset("assets/docs/security_policy.md", "policy_document", ["configuration_baseline", "risk_context", "timeline_context"], serviceIds, [], false, ["security_policy"], { support: "context" }),
    evidenceAsset("assets/evidence/incident_brief.md", "analyst_document", ["risk_context", "timeline_context"], reviewSubjectIds, [], false, ["incident_brief"], { relations: relationSubset(reviewSubjectIds), support: "context" }),
    evidenceAsset("assets/evidence/timeline.csv", "other", ["timeline_context", "timeline_static"], [], eventIds, false, ["timeline.csv"], { support: "context", stateType: "historical_reconstruction" }),
    evidenceAsset("assets/evidence/audit_notes.md", "analyst_document", ["risk_context", "timeline_context"], reviewSubjectIds, [], false, ["audit_notes"], { relations: relationSubset(reviewSubjectIds), support: "context" }),
    evidenceAsset("assets/evidence/analyst_working_notes.md", "analyst_document", ["risk_context", "timeline_context", "evidence_integrity"], reviewSubjectIds, [], false, ["analyst_working_notes"], { relations: relationSubset(reviewSubjectIds), support: "context" }),
    evidenceAsset("assets/evidence/analyst_questions.md", "analyst_document", ["risk_context", "timeline_context"], reviewSubjectIds, [], false, ["analyst_questions"], { relations: relationSubset(reviewSubjectIds), support: "context" }),
    evidenceAsset("assets/evidence/risk_register.csv", "risk_document", ["risk_context", "timeline_context"], reviewSubjectIds, [], false, ["risk_register"], { relations: relationSubset(reviewSubjectIds), support: "context" }),
    evidenceAsset("assets/evidence/advanced_risk_register.csv", "risk_document", ["risk_context", "timeline_context"], reviewSubjectIds, [], false, ["advanced_risk_register"], { relations: relationSubset(reviewSubjectIds), support: "context" }),
    evidenceAsset("assets/reports/hardening_checklist.md", "risk_document", ["risk_context", "configuration_baseline"], [], [], false, ["hardening_checklist"], { support: "context" }),
    evidenceAsset("assets/network/ufw_status.txt", "network_state", ["current_listener_state", "network_source", "configuration_baseline", "timeline_static"], [], [], false, ["ufw_status"], { collectionTimestamp: simulation.collection.collectedAt, stateType: "collection_snapshot" }),
    evidenceAsset("assets/network/listening_ports.txt", "network_state", ["current_listener_state", "network_source", "timeline_static"], [], [], false, ["listening_ports"], { collectionTimestamp: simulation.collection.collectedAt, stateType: "collection_snapshot" }),
    evidenceAsset("assets/network/routing_table.txt", "network_state", ["network_source", "configuration_baseline", "timeline_static"], [], [], false, ["routing_table"], { collectionTimestamp: simulation.collection.collectedAt, stateType: "collection_snapshot" }),
    ...scriptAssets.map((script) =>
      evidenceAsset(script.filePath, "static_config", ["cron_definition", "command_execution", "configuration_baseline", "current_file_state", "file_owner_group_mode"], script.subjectIds, [], false, [script.fileName, script.sourcePath], { relations: relationSubset(script.subjectIds), support: "exact", stateType: "static_document" })
    ),
    evidenceAsset("assets/scripts/script_sample.sh", "other", ["cron_definition", "command_execution", "configuration_baseline"], scriptSampleSubjects, [], false, ["script_sample"], { relations: relationSubset(scriptSampleSubjects), support: "static" }),
  ];

  const byPath = new Map(registry.map((item) => [item.path, item]));
  if (assets) {
    const learnerAssets = assets.filter((item) => item.file_path.startsWith("assets/"));
    for (const asset of learnerAssets) {
      if (!byPath.has(asset.file_path)) {
        byPath.set(asset.file_path, evidenceAsset(asset.file_path, "other", ["timeline_context"], [], [], false));
      }
    }
    const renderedPaths = new Set(learnerAssets.map((asset) => asset.file_path));
    return [...byPath.values()]
      .filter((item) => renderedPaths.has(item.path))
      .sort((left, right) => left.path.localeCompare(right.path));
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function buildDocumentFacts(simulation: LinuxSimulationWorld): CanonicalDocumentFact[] {
  const primaryCommand = simulation.commands.find((command) => command.kind === "primary_incident") || simulation.commands[0];
  const primarySession = simulation.sshSessions[0];
  const primaryFileIds = primaryCommand?.affectedFileIds || [];
  const primaryServiceIds = simulation.services.filter((service) => service.role === "primary").map((service) => service.id);
  const facts: CanonicalDocumentFact[] = [
    { id: "fact:case", factType: "case_identity", canonicalObjectIds: [simulation.investigation.incidentId], certainty: "observed", allowedDocumentTypes: ["incident_brief", "audit_notes", "analyst_working_notes"], spoilerRisk: "none" },
    { id: "fact:host", factType: "host_identity", canonicalObjectIds: [simulation.investigation.hostname, simulation.investigation.hostIp], certainty: "observed", allowedDocumentTypes: ["incident_brief", "change_request", "maintenance_ticket", "audit_notes", "risk_register"], spoilerRisk: "none" },
    { id: "fact:window", factType: "incident_window", canonicalObjectIds: [simulation.collection.windowStart, simulation.collection.windowEnd], certainty: "observed", allowedDocumentTypes: ["incident_brief", "audit_notes", "analyst_working_notes", "risk_register"], spoilerRisk: "none" },
    { id: "fact:actor:candidate", factType: "actor", canonicalObjectIds: primaryCommand ? [primaryCommand.actorIdentityId] : [], certainty: "candidate", allowedDocumentTypes: ["audit_notes", "analyst_working_notes", "analyst_questions"], spoilerRisk: "high" },
    { id: "fact:source-network", factType: "source_network", canonicalObjectIds: primarySession ? [primarySession.sourceIp, primarySession.id] : [], certainty: "observed", allowedDocumentTypes: ["audit_notes", "analyst_working_notes", "analyst_questions"], spoilerRisk: "low" },
    { id: "fact:command", factType: "command", canonicalObjectIds: primaryCommand ? [primaryCommand.id] : [], certainty: "observed", allowedDocumentTypes: ["audit_notes", "analyst_working_notes"], spoilerRisk: "high" },
    { id: "fact:file", factType: "file", canonicalObjectIds: primaryFileIds, certainty: "observed", allowedDocumentTypes: ["audit_notes", "analyst_working_notes", "risk_register"], spoilerRisk: "low" },
    { id: "fact:service", factType: "service", canonicalObjectIds: primaryServiceIds, certainty: "observed", allowedDocumentTypes: ["incident_brief", "change_request", "maintenance_ticket", "audit_notes", "hardening_checklist"], spoilerRisk: "low" },
    { id: "fact:package", factType: "package", canonicalObjectIds: simulation.packageTransactions.map((transaction) => transaction.id), certainty: "observed", allowedDocumentTypes: ["audit_notes", "risk_register"], spoilerRisk: "low" },
    { id: "fact:change", factType: "change", canonicalObjectIds: [simulation.investigation.changeId], certainty: "policy", allowedDocumentTypes: ["change_request", "maintenance_ticket", "incident_brief", "audit_notes"], spoilerRisk: "none" },
    { id: "fact:maintenance", factType: "maintenance", canonicalObjectIds: simulation.maintenanceActivities.map((activity) => activity.id), certainty: "policy", allowedDocumentTypes: ["maintenance_ticket", "change_request", "incident_brief"], spoilerRisk: "none" },
    { id: "fact:policy", factType: "policy_expectation", canonicalObjectIds: simulation.services.map((service) => service.id), certainty: "policy", allowedDocumentTypes: ["change_request", "security_policy", "advanced_risk_register", "hardening_checklist"], spoilerRisk: "none" },
    { id: "fact:risk:hypothesis", factType: "risk_hypothesis", canonicalObjectIds: primaryCommand ? [primaryCommand.id] : [], certainty: "candidate", allowedDocumentTypes: ["incident_brief", "risk_register", "advanced_risk_register", "audit_notes", "analyst_working_notes", "analyst_questions"], spoilerRisk: "low" },
    { id: "fact:evidence-gap", factType: "evidence_gap", canonicalObjectIds: [simulation.investigation.ticketId], certainty: "unknown", allowedDocumentTypes: ["analyst_working_notes", "analyst_questions", "risk_register", "advanced_risk_register"], spoilerRisk: "none" },
    { id: "fact:containment:candidate", factType: "containment_option", canonicalObjectIds: primaryServiceIds, certainty: "candidate", allowedDocumentTypes: ["hardening_checklist", "risk_register", "advanced_risk_register"], spoilerRisk: "high" },
  ];
  return facts;
}

function pickStyle(seed: string, index: number): CanonicalDocument["styleArchetype"] {
  const styles: CanonicalDocument["styleArchetype"][] = ["formal_itil", "ticket_first", "terse_operations", "compliance_heavy", "engineering_runbook", "chat_derived", "msp_style", "startup_informal"];
  const value = [...seed].reduce((total, char) => total + char.charCodeAt(0), index * 17);
  return styles[value % styles.length];
}

function buildCanonicalDocuments(simulation: LinuxSimulationWorld, facts: CanonicalDocumentFact[]): CanonicalDocument[] {
  const specs: Array<[CanonicalDocument["documentType"], CanonicalDocumentFact["factType"][], string, string]> = [
    ["incident_brief", ["case_identity", "host_identity", "incident_window", "change", "maintenance", "risk_hypothesis"], "SOC lead", "Security Operations"],
    ["change_request", ["host_identity", "change", "maintenance", "service", "policy_expectation"], "Change coordinator", "Platform Operations"],
    ["maintenance_ticket", ["host_identity", "change", "maintenance"], "Service owner", "Infrastructure"],
    ["security_policy", ["policy_expectation"], "GRC analyst", "Security Governance"],
    ["audit_notes", ["host_identity", "actor", "source_network", "command", "file", "service", "package"], "Incident analyst", "Security Operations"],
    ["analyst_working_notes", ["case_identity", "incident_window", "evidence_gap", "risk_hypothesis"], "SOC analyst", "Security Operations"],
    ["analyst_questions", ["actor", "source_network", "evidence_gap"], "SOC analyst", "Security Operations"],
    ["risk_register", ["risk_hypothesis", "evidence_gap", "containment_option"], "Risk analyst", "Security Governance"],
    ["advanced_risk_register", ["risk_hypothesis", "evidence_gap", "containment_option", "policy_expectation"], "Risk analyst", "Security Governance"],
    ["hardening_checklist", ["policy_expectation", "containment_option", "service"], "Platform engineer", "Infrastructure"],
  ];
  return specs.map(([documentType, requiredFactTypes, authorRole, owningTeam], index) => {
    const factIds = facts
      .filter((fact) => requiredFactTypes.includes(fact.factType) && fact.allowedDocumentTypes.includes(documentType))
      .filter((fact) => !(fact.spoilerRisk === "high" && ["incident_brief", "change_request", "maintenance_ticket", "security_policy"].includes(documentType)))
      .map((fact) => fact.id);
    return {
      id: `document:${documentType}`,
      documentType,
      styleArchetype: pickStyle(simulation.seed, index),
      factIds,
      requiredFactTypes,
      forbiddenFactIds: facts.filter((fact) => fact.spoilerRisk === "high" && !factIds.includes(fact.id)).map((fact) => fact.id),
      createdAt: simulation.collection.windowEnd,
      authorRole,
      owningTeam,
    };
  });
}

function assetsWithCapabilities(registry: CanonicalEvidenceAsset[], capabilities: CanonicalEvidenceCapability[]) {
  return registry.filter((asset) => capabilities.every((capability) => asset.capabilities.includes(capability)));
}

function primaryIncidentCommand(simulation: LinuxSimulationWorld) {
  return simulation.commands.find((command) => command.kind === "primary_incident") || simulation.commands.find((command) => command.kind !== "background") || simulation.commands[0];
}

function processIdForCommand(simulation: LinuxSimulationWorld, commandId?: string) {
  const command = simulation.commands.find((item) => item.id === commandId);
  return command ? simulation.processes.find((process) => process.pid === command.processId)?.id : undefined;
}

function executionIdForProcess(process: CanonicalProcess) {
  return `execution:${process.id.replace(/^process:/, "")}`;
}

function inferExecutionReason(
  process: CanonicalProcess,
  simulation: Pick<LinuxSimulationWorld, "commands" | "scheduledExecutions" | "serviceTransitions" | "packageTransactions">
): CanonicalExecutionReason {
  if (!process.commandId) {
    if (/sshd/.test(process.executable) && process.sessionId) return "ssh_session";
    if (/bash|sh|zsh|fish/.test(process.executable) && process.sessionId) return "interactive_shell";
    return "daemon_startup";
  }
  const command = simulation.commands.find((item) => item.id === process.commandId);
  if (simulation.scheduledExecutions.some((item) => item.processId === process.id || item.commandId === process.commandId)) return "cron";
  if (simulation.packageTransactions.some((item) => item.processIds.includes(process.id) || item.commandId === process.commandId)) return "package";
  if (simulation.serviceTransitions.some((item) =>
    item.processId === process.id ||
    (item.cause.type === "command" && item.cause.commandId === process.commandId)
  )) return "service_action";
  if (/\/?sudo\b/.test(process.executable) || (command?.runAsIdentityId && command.runAsIdentityId !== command.actorIdentityId)) return "privilege_escalation";
  if (command?.kind === "background") return "maintenance";
  return "interactive_command";
}

function buildCanonicalExecutions(
  simulation: Pick<
    LinuxSimulationWorld,
    | "investigation"
    | "commands"
    | "processes"
    | "scheduledExecutions"
    | "serviceTransitions"
    | "packageTransactions"
    | "maintenanceActivities"
  >
): CanonicalExecution[] {
  const processByPid = new Map(simulation.processes.map((process) => [process.pid, process]));
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));
  const commandById = new Map(simulation.commands.map((command) => [command.id, command]));
  const scheduledByProcessId = new Map(simulation.scheduledExecutions.map((execution) => [execution.processId, execution]));
  const serviceTransitionIdsByExecution = new Map<string, string[]>();
  const packageTransactionIdsByExecution = new Map<string, string[]>();
  const maintenanceActivityIdsByExecution = new Map<string, string[]>();

  const pushMap = (map: Map<string, string[]>, key: string | undefined, value: string) => {
    if (!key) return;
    const values = map.get(key) || [];
    if (!values.includes(value)) values.push(value);
    map.set(key, values);
  };

  for (const command of simulation.commands) {
    const process = simulation.processes.find((item) => item.pid === command.processId);
    command.executionId = process ? executionIdForProcess(process) : undefined;
  }

  for (const execution of simulation.scheduledExecutions) {
    execution.executionId = executionIdForProcess(processById.get(execution.processId) || simulation.processes.find((process) => process.commandId === execution.commandId)!);
  }

  for (const transition of simulation.serviceTransitions) {
    if (transition.cause.type === "command") {
      transition.executionId = commandById.get(transition.cause.commandId)?.executionId;
    } else if (transition.processId) {
      transition.executionId = executionIdForProcess(processById.get(transition.processId)!);
    }
    pushMap(serviceTransitionIdsByExecution, transition.executionId, transition.id);
  }

  for (const transaction of simulation.packageTransactions) {
    transaction.executionIds = transaction.processIds
      .map((processId) => processById.get(processId))
      .filter((process): process is CanonicalProcess => Boolean(process))
      .map(executionIdForProcess);
    for (const executionId of transaction.executionIds) pushMap(packageTransactionIdsByExecution, executionId, transaction.id);
  }

  for (const activity of simulation.maintenanceActivities) {
    for (const commandId of activity.commandIds) {
      pushMap(maintenanceActivityIdsByExecution, commandById.get(commandId)?.executionId, activity.id);
    }
  }

  return simulation.processes.map((process) => {
    const command = process.commandId ? commandById.get(process.commandId) : undefined;
    const scheduled = scheduledByProcessId.get(process.id);
    const executionId = executionIdForProcess(process);
    const privilegeLevel: CanonicalExecution["privilegeLevel"] = process.effectiveUid === 0
      ? "root"
      : process.identityId.includes("service")
        ? "service"
        : "user";
    const outcome: CanonicalExecution["outcome"] = scheduled?.outcome || "unknown";
    process.executionId = executionId;
    const constructionOrigin: CanonicalExecution["constructionOrigin"] = "legacy_derived";
    const processPolicy: CanonicalExecution["processPolicy"] = "create_process";
    return {
      id: executionId,
      constructionOrigin,
      identityId: process.identityId,
      effectiveIdentityId: process.identityId,
      sessionId: process.sessionId,
      commandId: process.commandId,
      processId: process.id,
      parentProcessId: process.ppid === 0 || process.ppid === 1 ? undefined : processByPid.get(process.ppid)?.id,
      cwd: process.cwd,
      hostname: simulation.investigation.hostname,
      startTime: process.startedAt,
      endTime: process.endedAt,
      environment: scheduled?.definitionId ? { SHELL: "/bin/sh", PATH: "/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin" } : undefined,
      reason: inferExecutionReason(process, simulation),
      privilegeLevel,
      openedFileIds: [...process.openFileIds],
      affectedServiceIds: command?.affectedServiceIds || scheduled?.affectedServiceIds || [],
      scheduledExecutionId: scheduled?.id,
      serviceTransitionIds: serviceTransitionIdsByExecution.get(executionId) || [],
      packageTransactionIds: packageTransactionIdsByExecution.get(executionId) || [],
      maintenanceActivityIds: maintenanceActivityIdsByExecution.get(executionId) || [],
      processPolicy,
      outcome,
      exitCode: scheduled?.exitCode,
    };
  }).sort((left, right) => left.startTime.localeCompare(right.startTime) || left.id.localeCompare(right.id));
}

function primaryRequirementSubjects(simulation: LinuxSimulationWorld) {
  const command = primaryIncidentCommand(simulation);
  const session = command?.sessionId ? simulation.sshSessions.find((item) => item.id === command.sessionId) : simulation.sshSessions.find((item) => item.purpose === "incident");
  const processId = processIdForCommand(simulation, command?.id);
  const serviceTransition = simulation.serviceTransitions.find((transition) => transition.cause?.type === "command" && transition.cause.commandId === command?.id);
  const serviceId = serviceTransition?.serviceId || command?.affectedServiceIds?.[0] || simulation.services.find((service) => service.unitName === simulation.investigation.affectedService)?.id || simulation.services[0]?.id;
  const packageTransaction = simulation.packageTransactions.find((transaction) => transaction.commandId === command?.id) || simulation.packageTransactions[0];
  let cronExecution = command ? simulation.scheduledExecutions.find((execution) => execution.commandId === command.id) : undefined;
  const cronExecutionDefinitionId = cronExecution?.definitionId;
  const cronDefinition = cronExecutionDefinitionId
    ? simulation.cronDefinitions.find((definition) => definition.id === cronExecutionDefinitionId)
    : command
      ? simulation.cronDefinitions.find((definition) => definition.commandId === command.id) || simulation.cronDefinitions[0]
      : simulation.cronDefinitions[0];
  if (!cronExecution && cronDefinition) {
    cronExecution = simulation.scheduledExecutions.find((execution) => execution.definitionId === cronDefinition.id);
  }
  const maintenance = simulation.maintenanceActivities[0];
  const fileIds = command?.affectedFileIds || [];
  const primaryFileId = fileIds.find((fileId) => {
    const file = simulation.files.find((item) => item.id === fileId);
    return file ? !/^\/(?:usr\/bin|usr\/sbin|bin|sbin)\//.test(file.path) : false;
  }) || fileIds[0];
  return {
    command,
    commandId: command?.id,
    actorIdentityId: command?.actorIdentityId,
    runAsIdentityId: command?.runAsIdentityId || command?.actorIdentityId,
    sessionId: session?.id,
    sessionIdentityId: session?.identityId,
    processId,
    fileIds,
    primaryFileId,
    serviceId,
    serviceTransitionId: serviceTransition?.id,
    packageTransactionId: packageTransaction?.id,
    packageSubjectIds: packageTransaction?.packages.map((pkg) => `package-subject:${pkg.name}`) || [],
    cronDefinitionId: cronDefinition?.id,
    cronCommandId: cronDefinition?.commandId,
    cronRunAsIdentityId: cronDefinition?.runAsIdentityId,
    scheduledExecutionId: cronExecution?.id,
    maintenanceActivityId: maintenance?.id,
    changeId: simulation.investigation.changeId,
  };
}

function synthesisRequirementSubjects(simulation: LinuxSimulationWorld) {
  const primary = primaryRequirementSubjects(simulation);
  const command = simulation.commands.find((item) => item.kind === "secondary_incident" && item.id !== primary.commandId) ||
    simulation.commands.find((item) => item.kind === "supporting" && item.id !== primary.commandId) ||
    simulation.commands.find((item) => item.kind !== "background" && item.kind !== "analyst" && item.id !== primary.commandId);
  if (!command) return primary;
  return {
    ...primary,
    command,
    commandId: command.id,
    actorIdentityId: command.actorIdentityId,
    runAsIdentityId: command.runAsIdentityId || command.actorIdentityId,
    processId: processIdForCommand(simulation, command.id),
  };
}

function requirement(
  id: string,
  capability: CanonicalEvidenceCapability,
  subjectIds: Array<string | undefined>,
  minimumSupport: LinuxEvidenceSupportLevel,
  relationName?: CanonicalTaskRequirement["relation"],
  minimumAssetCount?: number
): CanonicalTaskRequirement {
  return {
    id,
    capability,
    subjectIds: Array.from(new Set(subjectIds.filter((item): item is string => Boolean(item)))),
    relation: relationName,
    minimumSupport,
    minimumAssetCount,
  };
}

function inquiryTypesForIntent(
  intent: CanonicalInvestigationTask["intent"],
  currentCapabilities: LinuxCurrentStateCapability[],
  requirements: CanonicalTaskRequirement[] = []
) {
  const types: CanonicalInvestigationTask["inquiryTypes"] = [];
  const add = (type: CanonicalInvestigationTask["inquiryTypes"][number]) => {
    if (!types.includes(type)) types.push(type);
  };
  const requiresServiceTransition = requirements.some((item) => item.capability === "service_transition");
  if (
    ["scope_timeline", "command_process", "package_transaction", "cron_analysis", "evidence_integrity", "impact_assessment"].includes(intent) ||
    (intent === "service_state" && requiresServiceTransition)
  ) {
    add("historical_reconstruction");
  }
  for (const capability of currentCapabilities) {
    add("current_state");
    if (capability === "current_service_state" || capability === "current_process_state") add("runtime_state");
    if (capability === "current_configuration_state") add("configuration_state");
    if (capability === "current_identity_state") add("identity_access_state");
    if (capability === "current_persistence_state") add("persistence_state");
    if (capability === "current_listener_state") add("network_listener_state");
    if (capability === "current_package_state") add("package_state");
    if (capability === "current_file_state") add("file_state");
    if (capability === "current_policy_state") add("policy_state");
  }
  if (intent === "risk_assessment") add("risk_assessment");
  if (intent === "containment_recommendation") add("remediation_or_containment");
  if (types.length > 0) return types;
  return ["historical_reconstruction"] satisfies CanonicalInvestigationTask["inquiryTypes"];
}

function currentStateSubjectIdsForCapability(
  subjects: ReturnType<typeof primaryRequirementSubjects>,
  capability: LinuxCurrentStateCapability
) {
  switch (capability) {
    case "current_service_state":
    case "current_configuration_state":
      return [subjects.serviceId];
    case "current_process_state":
      return [subjects.processId];
    case "current_package_state":
      return subjects.packageSubjectIds;
    case "current_persistence_state":
      return [subjects.cronDefinitionId];
    case "current_identity_state":
      return [subjects.actorIdentityId, subjects.runAsIdentityId, subjects.sessionIdentityId];
    case "current_file_state":
      return [subjects.primaryFileId];
    case "current_policy_state":
      return [subjects.commandId, subjects.actorIdentityId, subjects.runAsIdentityId];
    case "current_listener_state":
      return [];
    default:
      return [];
  }
}

function buildCurrentStateRequirementsForIntent(
  simulation: LinuxSimulationWorld,
  intent: CanonicalInvestigationTask["intent"]
) {
  const subjects = primaryRequirementSubjects(simulation);
  return currentStateCapabilitiesForIntent(intent)
    .map((capability) => requirement(
      `${intent}:${capability}`,
      capability,
      currentStateSubjectIdsForCapability(subjects, capability),
      "static",
      undefined,
      1
    ))
    .filter((item) => item.subjectIds.length > 0 || item.capability === "current_listener_state");
}

function supplementalTaskLocalEvidenceRequirements(
  simulation: LinuxSimulationWorld,
  intent: CanonicalInvestigationTask["intent"],
  difficulty: CanonicalInvestigationTask["difficulty"]
): CanonicalTaskRequirement[] {
  void difficulty;
  const subjects = primaryRequirementSubjects(simulation);
  if (intent === "sudo_policy") {
    return [
      requirement(
        "sudo_policy:observed_command_execution",
        "command_execution",
        [subjects.commandId, subjects.actorIdentityId],
        "exact"
      ),
    ];
  }
  if (intent === "ssh_authentication" && simulation.investigation.incidentFamily === "ssh_bruteforce") {
    return [
      requirement(
        "ssh_authentication:control_baseline",
        "configuration_baseline",
        [subjects.serviceId],
        "static"
      ),
    ];
  }
  if (
    intent === "actor_attribution" &&
    simulation.investigation.incidentFamily === "service_account_misuse" &&
    difficulty !== "Advanced"
  ) {
    return [
      requirement(
        "actor_attribution:observed_account_activity",
        "command_execution",
        [subjects.commandId, subjects.runAsIdentityId],
        "exact",
        "executed_by"
      ),
    ];
  }

  return [];
}

function supplementalTaskLocalEvidenceCapabilities(
  simulation: LinuxSimulationWorld,
  intent: CanonicalInvestigationTask["intent"],
  difficulty: CanonicalInvestigationTask["difficulty"]
): CanonicalEvidenceCapability[] {
  return Array.from(new Set(supplementalTaskLocalEvidenceRequirements(simulation, intent, difficulty).map((item) => item.capability)));
}
function buildCurrentStateRequirementsForPlanning(
  simulation: LinuxSimulationWorld,
  difficulty: CanonicalInvestigationTask["difficulty"],
  intent: CanonicalInvestigationTask["intent"]
) {
  const requirements = buildCurrentStateRequirementsForIntent(simulation, intent);
  if (difficulty === "Advanced") return requirements;
  const profile = linuxDifficultyProfile(difficulty);
  return requirements.filter((requirement) => capabilityClass(requirement.capability, profile) !== "prohibited");
}

function buildTaskRequirementsForIntent(
  simulation: LinuxSimulationWorld,
  intent: CanonicalInvestigationTask["intent"],
  requiredCapabilities: CanonicalEvidenceCapability[],
  difficulty?: CanonicalInvestigationTask["difficulty"]
) {
  const subjects = primaryRequirementSubjects(simulation);
  const requirements: CanonicalTaskRequirement[] = [];
  const addDefault = () => {
    for (const capability of requiredCapabilities) {
      requirements.push(requirement(`${intent}:${capability}`, capability, linuxCanonicalIncidentSubjectIds(simulation), capability.startsWith("timeline") ? "exact" : "context"));
    }
  };

  if (intent === "scope_timeline") {
    requirements.push(requirement("scope_timeline:session", "timeline_exact", [subjects.sessionId], "exact"));
    if (!(simulation.investigation.incidentFamily === "log_tampering" && difficulty !== "Advanced")) {
      requirements.push(requirement("scope_timeline:command", "timeline_exact", [subjects.commandId], "exact"));
    }
    if (subjects.serviceTransitionId) requirements.push(requirement("scope_timeline:transition", "timeline_exact", [subjects.serviceTransitionId], "exact"));
    if (simulation.investigation.incidentFamily === "log_tampering") {
      requirements.push(requirement(
        "scope_timeline:log_context",
        "timeline_context",
        [difficulty === "Advanced" ? subjects.commandId : subjects.maintenanceActivityId],
        "context"
      ));
    }
  } else if (intent === "ssh_authentication") {
    if (subjects.sessionId && subjects.sessionIdentityId) {
      requirements.push(requirement("ssh_authentication:session", "authentication", [subjects.sessionId, subjects.sessionIdentityId], "exact", "authenticated_as"));
    }
    if (simulation.investigation.incidentFamily === "ssh_key_compromise" && difficulty === "Advanced" && simulation.requestedDurationMinutes === 30) {
      for (const session of simulation.sshSessions.filter((item) => item.purpose === "incident")) {
        requirements.push(requirement(`ssh_authentication:session:${session.id}`, "authentication", [session.id, session.identityId], "exact", "authenticated_as"));
        const commands = simulation.commands.filter((command) => command.sessionId === session.id && command.id.startsWith("command:incident:"));
        if (commands.length === 0) throw new Error(`Advanced SSH key task has no command branch for ${session.id}.`);
        const command = commands[0];
        const process = simulation.processes.find((item) => item.pid === command.processId);
        if (!process) throw new Error(`Advanced SSH key task has no process for ${command.id}.`);
        requirements.push(requirement(`ssh_authentication:process:${command.id}`, "process_ancestry", [command.id, process.id], "exact", "spawned_process"));
      }
      requirements.push(requirement("ssh_authentication:captured_identity", "actor_attribution", [subjects.sessionIdentityId], "static"));
    }
  } else if (intent === "actor_attribution") {
    requirements.push(requirement("actor_attribution:identity", "actor_attribution", [subjects.actorIdentityId], "static"));
    if (subjects.sessionId && subjects.sessionIdentityId) requirements.push(requirement("actor_attribution:session", "authentication", [subjects.sessionId, subjects.sessionIdentityId], "exact", "authenticated_as"));
  } else if (intent === "key_provenance") {
    requirements.push(requirement("key_provenance:key_material", "key_provenance", [subjects.sessionIdentityId], "static"));
    if (subjects.sessionId && subjects.sessionIdentityId) requirements.push(requirement("key_provenance:session", "authentication", [subjects.sessionId, subjects.sessionIdentityId], "exact", "authenticated_as"));
    // Trust provenance concerns the authenticated account's key file, not the
    // operand of whichever incident command happens to be ordered first.
    const keyFile = simulation.files.find(file => file.ownerIdentityId === subjects.sessionIdentityId && /\/\.ssh\/authorized_keys$/.test(file.path));
    if (keyFile) requirements.push(requirement("key_provenance:file", "file_owner_group_mode", [keyFile.id], "exact"));
  } else if (intent === "command_process") {
    requirements.push(requirement("command_process:execution", "command_execution", [subjects.commandId, subjects.runAsIdentityId], "exact", "executed_by"));
    requirements.push(requirement("command_process:process", "process_ancestry", [subjects.commandId, subjects.processId], "exact", "spawned_process"));
    if (!(simulation.investigation.incidentFamily === "data_staging" && difficulty !== "Advanced") && subjects.primaryFileId && subjects.processId) {
      requirements.push(requirement("command_process:file", "open_file_correlation", [subjects.processId, subjects.primaryFileId], "exact", "opened_file"));
    }
  } else if (intent === "service_state") {
    requirements.push(requirement("service_state:service", "service_state", [subjects.serviceId], "exact"));
    if (simulation.investigation.incidentFamily === "systemd_persistence" && difficulty !== "Beginner" && subjects.serviceTransitionId && subjects.serviceId) {
      requirements.push(requirement("service_state:transition", "service_transition", [subjects.serviceTransitionId, subjects.serviceId], "exact", "transitioned_service"));
    }
  } else if (intent === "package_transaction") {
    requirements.push(requirement("package_transaction:transaction", "package_transaction", [subjects.packageTransactionId], "exact"));
    for (const packageSubjectId of subjects.packageSubjectIds) {
      requirements.push(requirement(`package_transaction:${packageSubjectId}`, "package_transaction", [subjects.packageTransactionId, packageSubjectId], "exact", "installed_package"));
    }
  } else if (intent === "cron_analysis") {
    requirements.push(requirement("cron_analysis:definition", "cron_definition", [subjects.cronDefinitionId, subjects.cronCommandId], "exact", "defines_schedule"));
    if (subjects.scheduledExecutionId && subjects.cronDefinitionId) {
      requirements.push(requirement("cron_analysis:execution", "cron_execution", [subjects.scheduledExecutionId, subjects.cronDefinitionId], "exact", "executed_schedule"));
    }
    if (subjects.cronRunAsIdentityId) requirements.push(requirement("cron_analysis:run_as", "actor_attribution", [subjects.cronRunAsIdentityId], "static"));
  } else if (intent === "change_control") {
    requirements.push(requirement("change_control:change", "change_control", [subjects.maintenanceActivityId, subjects.changeId], "context", "covered_by_change"));
    // Change correlation is inherently two-sided: a document proves scope, while
    // independent runtime evidence proves what actually happened.
    if (simulation.investigation.incidentFamily === "unauthorized_package_install") {
      requirements.push(requirement("change_control:observed_package", "package_transaction", [subjects.packageTransactionId], "exact"));
      requirements.push(requirement("change_control:maintenance", "maintenance_scope", [subjects.maintenanceActivityId], "context"));
    } else {
      requirements.push(requirement("change_control:observed_activity", "command_execution", [subjects.commandId], "exact"));
    }
  } else if (intent === "file_permissions") {
    requirements.push(requirement("file_permissions:file", "file_owner_group_mode", [subjects.primaryFileId], "exact"));
    if (simulation.investigation.incidentFamily === "docker_compromise" && difficulty === "Advanced") {
      for (const command of simulation.commands.filter((item) => /\bdocker\s+run\b/.test(item.renderedCommand))) {
        requirements.push(requirement("file_permissions:configured_mount", "command_execution", [command.id], "exact"));
      }
    }
  } else if (intent === "sudo_policy") {
    requirements.push(requirement("sudo_policy:command", "sudo_authorisation", [subjects.commandId, subjects.runAsIdentityId], "context", "executed_by"));
    requirements.push(requirement("sudo_policy:actor", "actor_attribution", [subjects.actorIdentityId], "static"));
    requirements.push(requirement("sudo_policy:configuration", "configuration_baseline", [subjects.actorIdentityId], "static"));
  } else if (intent === "network_source") {
    requirements.push(requirement("network_source:network_state", "network_source", [], "static"));
  } else if (intent === "impact_assessment" || intent === "risk_assessment" || intent === "containment_recommendation") {
    const synthesisSubjects = synthesisRequirementSubjects(simulation);
    requirements.push(requirement(`${intent}:risk_context`, "risk_context", linuxLearnerReviewSubjectIds(simulation), "context"));
    // Business impact is an inference from an observed action plus operational
    // context, not a second reading of the risk register or a duplicate of the
    // primary command/process question. Require a separately observed action.
    requirements.push(requirement(`${intent}:observed_action`, "command_execution", [synthesisSubjects.commandId, synthesisSubjects.runAsIdentityId], "exact", "executed_by"));
    if (requiredCapabilities.includes("timeline_context")) {
      requirements.push(requirement(`${intent}:timeline_command`, "timeline_context", [synthesisSubjects.commandId], "context"));
      requirements.push(requirement(`${intent}:timeline_maintenance`, "timeline_context", [subjects.maintenanceActivityId], "context"));
    }
    if (requiredCapabilities.includes("configuration_baseline")) requirements.push(requirement(`${intent}:configuration`, "configuration_baseline", [subjects.serviceId], "static"));
  } else if (intent === "evidence_integrity") {
    requirements.push(requirement("evidence_integrity:timeline", "timeline_context", [subjects.commandId, subjects.maintenanceActivityId], "context"));
  } else if (intent === "configuration_review") {
    const baselineSubject = simulation.investigation.incidentFamily === "unauthorized_package_install"
      ? (subjects.changeId || subjects.actorIdentityId || subjects.runAsIdentityId || subjects.serviceId)
      : (subjects.serviceId || subjects.changeId || subjects.actorIdentityId || subjects.runAsIdentityId);
    requirements.push(requirement("configuration_review:baseline", "configuration_baseline", [
      baselineSubject,
    ], "static"));
    if (difficulty === "Advanced" && simulation.investigation.incidentFamily === "unauthorized_package_install" && subjects.serviceId) {
      // The exported control baseline describes apt-daily.service, while the
      // primary package command may affect apt-daily-upgrade.service.
      const baselineServiceId = simulation.services.find((service) => service.unitName === "apt-daily.service")?.id;
      requirements.push(requirement("configuration_review:captured_service", "current_service_state", [baselineServiceId || subjects.serviceId], "exact"));
    }
    // The systemd learner question compares the baseline with observed state.
    // Keep the captured state local to this task, rather than relying on an
    // inventory that happens to exist elsewhere in the exported archive.
    if (difficulty === "Advanced" && simulation.investigation.incidentFamily === "systemd_persistence" && subjects.serviceId) {
      requirements.push(requirement("configuration_review:captured_service", "current_service_state", [subjects.serviceId], "exact"));
    }
  } else {
    addDefault();
  }
  return requirements.filter((item) => item.subjectIds.length > 0 || item.capability === "network_source");
}

function selectEvidenceForCapabilities(registry: CanonicalEvidenceAsset[], capabilities: CanonicalEvidenceCapability[], limit: number) {
  const selected: CanonicalEvidenceAsset[] = [];
  for (const capability of capabilities) {
    const asset = registry.find((item) => item.capabilities.includes(capability) && !selected.some((selectedAsset) => selectedAsset.id === item.id));
    if (asset) selected.push(asset);
  }
  for (const asset of registry) {
    if (selected.length >= limit) break;
    if (capabilities.some((capability) => asset.capabilities.includes(capability)) && !selected.some((selectedAsset) => selectedAsset.id === asset.id)) {
      selected.push(asset);
    }
  }
  return selected.slice(0, limit);
}

function selectEvidenceForRequirements(registry: CanonicalEvidenceAsset[], requirements: CanonicalTaskRequirement[], fallbackCapabilities: CanonicalEvidenceCapability[], limit: number) {
  const selected: CanonicalEvidenceAsset[] = [];
  const addAsset = (asset: CanonicalEvidenceAsset | undefined) => {
    if (asset && !selected.some((item) => item.id === asset.id)) selected.push(asset);
  };
  for (const requirement of requirements) {
    addAsset(registry.find((asset) => proveTaskRequirements({
      id: "selection",
      intent: "scope_timeline",
      requiredCapabilities: [requirement.capability],
      inquiryTypes: ["historical_reconstruction"],
      currentStateRequirements: [],
      selectedEvidenceAssetIds: [],
      canonicalObjectIds: requirement.subjectIds,
      primarySubjectIds: requirement.subjectIds,
      supportingSubjectIds: [],
      requirements: [requirement],
      expectedDeliverableType: "timeline",
      difficulty: "Advanced",
      order: 0,
    }, [asset])[0]?.feasible));
  }
  for (const asset of selectEvidenceForCapabilities(registry, fallbackCapabilities, limit)) addAsset(asset);
  return selected.slice(0, limit);
}

export type LinuxTaskEvidenceClosureResult = {
  satisfied: boolean;
  selectedEvidence: CanonicalEvidenceAsset[];
  requiredCapabilities: CanonicalEvidenceCapability[];
  satisfiedCapabilities: CanonicalEvidenceCapability[];
  missingCapabilities: CanonicalEvidenceCapability[];
  requiredCurrentStateCapabilities: CanonicalEvidenceCapability[];
  missingCurrentStateCapabilities: CanonicalEvidenceCapability[];
  requiredCanonicalSubjects: string[];
  groundedCanonicalSubjects: string[];
  missingCanonicalSubjects: string[];
  requiredRelationships: string[];
  groundedRelationships: string[];
  missingRelationships: string[];
  prohibitedEvidenceEncountered: string[];
  unrenderedEvidenceEncountered: string[];
  candidateEvidenceConsidered: string[];
  rejectedCandidates: Array<{ evidencePath: string; reason: string }>;
  selectionDiagnostics: LinuxTaskPlannerDiagnostic[];
  evidenceLimit: number;
  evidenceLimitExceeded: boolean;
  minimumEvidenceCount: number;
  minimumEvidenceCountMissing: number;
  requirementProofs: TaskRequirementProof[];
};

export type LinuxNarrativeClaimClass =
  | "observed"
  | "historical_state"
  | "current_state"
  | "bounded_inference"
  | "recommendation";

export type LinuxNarrativeRelationshipContract = {
  relation: string;
  subjectIds: string[];
  subjectLabels: string[];
};

export type LinuxNarrativeTaskContract = {
  taskId: string;
  order: number;
  intent: CanonicalInvestigationTask["intent"];
  objective: string;
  deliverableType: CanonicalInvestigationTask["expectedDeliverableType"];
  requiredCapabilities: CanonicalEvidenceCapability[];
  selectedEvidence: Array<{
    id: string;
    path: string;
    displayName: string;
    capabilities: CanonicalEvidenceCapability[];
    support: LinuxEvidenceSupportLevel;
    stateType?: CanonicalEvidenceAsset["stateType"];
  }>;
  groundedSubjects: Array<{
    id: string;
    label: string;
    type: LinuxCanonicalSubjectRef["type"];
  }>;
  groundedRelationships: LinuxNarrativeRelationshipContract[];
  allowedTimestamps: string[];
  allowedObservedFacts: string[];
  allowedCurrentStateFacts: string[];
  allowedHistoricalFacts: string[];
  allowedBoundedInferences: string[];
  allowedRecommendationCategories: string[];
  prohibitedClaims: string[];
  evidenceClosure: Pick<
    LinuxTaskEvidenceClosureResult,
    | "satisfied"
    | "requiredCapabilities"
    | "satisfiedCapabilities"
    | "requiredCurrentStateCapabilities"
    | "requiredCanonicalSubjects"
    | "groundedCanonicalSubjects"
    | "requiredRelationships"
    | "groundedRelationships"
  >;
};

export type LinuxNarrativeContract = {
  version: "linux-narrative-contract-v1";
  caseId: string;
  difficulty: CanonicalInvestigationTask["difficulty"];
  incidentFamily: string;
  scenarioFraming: {
    hostname: string;
    hostRole: string;
    hostIp: string;
    ticketId: string;
    changeId: string;
    incidentWindow: string;
    timezone: string;
    collectionTime: string;
    primaryService: string;
    supportingServices: string[];
  };
  globalRenderedEvidencePaths: string[];
  globalGroundedSubjects: Array<{
    id: string;
    label: string;
    type: LinuxCanonicalSubjectRef["type"];
  }>;
  globalGroundedRelationships: LinuxNarrativeRelationshipContract[];
  globalAllowedTimestamps: string[];
  canonicalTaskCount: number;
  taskContracts: LinuxNarrativeTaskContract[];
  prohibitedEvidencePaths: string[];
  prohibitedCapabilityClaims: CanonicalEvidenceCapability[];
  narrativeConstraints: {
    claimClasses: LinuxNarrativeClaimClass[];
    prohibitedClaimCategories: string[];
    lowerTierAdvancedLeakageRules: string[];
    recommendationScope: string[];
  };
};

const BEGINNER_SAFE_FALLBACK_INTENTS: CanonicalInvestigationTask["intent"][] = [
  "ssh_authentication",
  "actor_attribution",
  "scope_timeline",
  "file_permissions",
  "service_state",
  "configuration_review",
  "sudo_policy",
];

const FAMILY_SAFE_FALLBACK_INTENTS: Record<string, CanonicalInvestigationTask["intent"][]> = {
  ssh_bruteforce: ["ssh_authentication", "actor_attribution", "scope_timeline", "configuration_review", "file_permissions", "service_state"],
  ssh_key_compromise: ["ssh_authentication", "actor_attribution", "scope_timeline", "file_permissions", "configuration_review", "service_state"],
  misconfigured_sudoers: ["actor_attribution", "ssh_authentication", "scope_timeline", "configuration_review", "file_permissions", "service_state"],
  systemd_persistence: ["service_state", "configuration_review", "scope_timeline", "file_permissions", "sudo_policy", "actor_attribution", "ssh_authentication"],
  log_tampering: ["service_state", "configuration_review", "scope_timeline", "sudo_policy", "actor_attribution", "file_permissions", "ssh_authentication"],
  service_account_misuse: ["file_permissions", "actor_attribution", "scope_timeline", "service_state", "configuration_review", "ssh_authentication"],
  reverse_shell: ["actor_attribution", "file_permissions", "scope_timeline", "service_state", "configuration_review", "ssh_authentication"],
  data_staging: ["file_permissions", "actor_attribution", "scope_timeline", "service_state", "configuration_review", "ssh_authentication"],
  docker_compromise: ["file_permissions", "actor_attribution", "configuration_review", "scope_timeline", "service_state", "ssh_authentication"],
  unauthorized_package_install: ["package_transaction", "sudo_policy", "command_process", "scope_timeline", "service_state", "configuration_review", "actor_attribution", "file_permissions", "ssh_authentication"],
  cron_persistence: ["actor_attribution", "scope_timeline", "file_permissions", "service_state", "configuration_review", "ssh_authentication"],
};

const LOWER_TIER_RENDERED_TASK_EVIDENCE = new Set([
  "assets/logs/auth.log",
  "assets/logs/sudo.log",
  "assets/logs/syslog",
  "assets/configs/linux_config_pack.txt",
  "assets/csv/users.csv",
  "assets/csv/groups.csv",
  "assets/reports/permissions_report.txt",
  "assets/reports/service_inventory.txt",
  "assets/evidence/timeline.csv",
  "assets/evidence/incident_brief.md",
  "assets/docs/change_request.md",
  "assets/docs/maintenance_ticket.md",
]);

function plannerDiagnostic(args: {
  code: LinuxTaskPlannerDiagnostic["code"];
  difficulty: CanonicalInvestigationTask["difficulty"];
  intent?: string;
  family: string;
  blueprintId?: string;
  missingCapabilities?: string[];
  missingCurrentStateCapabilities?: string[];
  missingEvidence?: string[];
  missingCanonicalSubjects?: string[];
  missingRelationships?: string[];
  candidateEvidence?: string[];
  selectedEvidence?: string[];
  prohibited?: boolean;
  message: string;
}): LinuxTaskPlannerDiagnostic {
  return {
    code: args.code,
    difficulty: args.difficulty,
    intent: args.intent,
    family: args.family,
    blueprintId: args.blueprintId,
    missingCapabilities: args.missingCapabilities || [],
    missingCurrentStateCapabilities: args.missingCurrentStateCapabilities || [],
    missingEvidence: args.missingEvidence || [],
    missingCanonicalSubjects: args.missingCanonicalSubjects || [],
    missingRelationships: args.missingRelationships || [],
    candidateEvidence: args.candidateEvidence || [],
    selectedEvidence: args.selectedEvidence || [],
    prohibited: args.prohibited || false,
    message: args.message,
  };
}

function capabilityClass(
  capability: CanonicalEvidenceCapability,
  profile: ReturnType<typeof linuxDifficultyProfile>
) {
  if (profile.capabilities.guaranteed.includes(capability)) return "guaranteed";
  if (profile.capabilities.conditional.includes(capability)) return "conditional";
  if (profile.capabilities.prohibited.includes(capability)) return "prohibited";
  return "unclassified";
}

function intentClass(
  intent: CanonicalInvestigationTask["intent"],
  profile: ReturnType<typeof linuxDifficultyProfile>
) {
  if (profile.taskIntents.allowed.includes(intent)) return "allowed";
  if (profile.taskIntents.conditional.includes(intent)) return "conditional";
  if (profile.taskIntents.prohibited.includes(intent)) return "prohibited";
  return "unclassified";
}

function currentStateEvidenceIsGenuine(asset: CanonicalEvidenceAsset) {
  return !(
    asset.stateType === "historical_reconstruction" ||
    asset.assetType === "timestamped_log" ||
    asset.assetType === "journal" ||
    asset.assetType === "package_history"
  );
}

function lowerTierPathIsRendered(path: string) {
  if (/^assets\/ssh\/[^/]+\/authorized_keys$/i.test(path)) return true;
  if (path === "assets/scheduled/root_crontab.txt" || /^assets\/scheduled\/cron\.d\/[^/]+$/i.test(path)) return true;
  if (/^assets\/scripts\/[^/]+\.sh$/i.test(path)) return true;
  if (path === "assets/journal/journal_systemd.txt") return true;
  if (path === "assets/logs/apt_history.log" || path === "assets/inventory/package_inventory.txt") return true;
  return LOWER_TIER_RENDERED_TASK_EVIDENCE.has(path);
}

function lowerTierRenderedTaskEvidencePaths(simulation: LinuxSimulationWorld, difficulty: CanonicalInvestigationTask["difficulty"]) {
  const rendered = new Set(Array.from(LOWER_TIER_RENDERED_TASK_EVIDENCE).map(normalizeLinuxEvidencePath));
  if (difficulty !== "Intermediate") return rendered;
  const family = simulation.investigation.incidentFamily;
  if (family === "data_staging") {
    rendered.add(normalizeLinuxEvidencePath("assets/runtime/process_execution_history.txt"));
    rendered.add(normalizeLinuxEvidencePath("assets/runtime/file_access_history.csv"));
  }
  if (family === "reverse_shell") {
    rendered.add(normalizeLinuxEvidencePath("assets/runtime/process_execution_history.txt"));
    rendered.add(normalizeLinuxEvidencePath("assets/runtime/file_access_history.csv"));
    rendered.add(normalizeLinuxEvidencePath("assets/network/listening_ports.txt"));
    rendered.add(normalizeLinuxEvidencePath("assets/network/ufw_status.txt"));
  }
  if (family === "docker_compromise") {
    rendered.add(normalizeLinuxEvidencePath("assets/runtime/process_execution_history.txt"));
    rendered.add(normalizeLinuxEvidencePath("assets/runtime/file_access_history.csv"));
  }
  if (family === "cron_persistence") {
    rendered.add(normalizeLinuxEvidencePath("assets/scheduled/root_crontab.txt"));
    for (const definition of simulation.cronDefinitions.filter((item) => item.source === "cron_d" && item.enabled && item.persistenceState === "present")) {
      rendered.add(normalizeLinuxEvidencePath(`assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`));
    }
    for (const script of simulationScriptAssets(simulation)) {
      rendered.add(normalizeLinuxEvidencePath(script.filePath));
    }
  }
  return rendered;
}

const TASK_EVIDENCE_LIMIT = 3;

function requiredTaskEvidencePaths(simulation: LinuxSimulationWorld, intent: CanonicalInvestigationTask["intent"], difficulty: CanonicalInvestigationTask["difficulty"]) {
  if (simulation.investigation.incidentFamily === "unauthorized_package_install" &&
    intent === "change_control" && difficulty !== "Beginner") {
    // Compare the transaction with dated change scope using two independent sources.
    return ["assets/logs/apt_history.log", "assets/docs/change_request.md"];
  }
  if (simulation.investigation.incidentFamily === "unauthorized_package_install" &&
    intent === "configuration_review" && difficulty === "Advanced") {
    // Separate control-state analysis from the transaction/change comparison.
    return ["assets/configs/linux_config_pack.txt", "assets/reports/service_inventory.txt"];
  }
  if (simulation.investigation.incidentFamily === "ssh_key_compromise" && difficulty === "Advanced" && simulation.requestedDurationMinutes === 30) {
    if (intent === "change_control") return ["assets/docs/change_request.md", "assets/logs/audit.log"];
    if (intent === "key_provenance") return ["assets/journal/journal_ssh.txt", "assets/reports/permissions_report.txt", "assets/configs/ssh/sshd_config"];
    if (intent === "ssh_authentication") return ["assets/journal/journal_ssh.txt", "assets/accounts/passwd.sample", "assets/runtime/process_execution_history.txt"];
    if (intent === "impact_assessment") return ["assets/runtime/process_execution_history.txt", "assets/evidence/advanced_risk_register.csv"];
  }
  // The SSH chronology question asks for attempts and acceptance, not merely
  // two representations of the same session opening.
  return simulation.investigation.incidentFamily === "ssh_bruteforce" && intent === "scope_timeline"
    ? ["assets/logs/auth.log", ...(difficulty === "Advanced" ? ["assets/logs/audit.log"] : [])]
    : [];
}

const supportScore: Record<LinuxEvidenceSupportLevel, number> = {
  static: 1,
  context: 2,
  exact: 3,
};

function taskRequirementAssetProof(
  requirement: CanonicalTaskRequirement,
  asset: CanonicalEvidenceAsset
) {
  return proveTaskRequirements({
    id: "closure",
    intent: "scope_timeline",
    requiredCapabilities: [requirement.capability],
    inquiryTypes: ["historical_reconstruction"],
    currentStateRequirements: [],
    selectedEvidenceAssetIds: [asset.id],
    canonicalObjectIds: requirement.subjectIds,
    primarySubjectIds: requirement.subjectIds,
    supportingSubjectIds: [],
    requirements: [requirement],
    expectedDeliverableType: "timeline",
    difficulty: "Advanced",
    order: 0,
  }, [asset])[0];
}

function proofRelationshipKey(proof: TaskRequirementProof) {
  return proof.requiredRelation
    ? `${proof.requiredRelation}:${proof.requiredSubjectIds.join("|")}`
    : "";
}

function relationKeysFromAssets(assets: CanonicalEvidenceAsset[]) {
  return Array.from(new Set(assets.flatMap((asset) =>
    (asset.relations || []).map((relation) => `${relation.relation}:${relation.subjectIds.join("|")}`)
  )));
}

function requirementRelationKey(requirement: CanonicalTaskRequirement) {
  return requirement.relation ? `${requirement.relation}:${requirement.subjectIds.join("|")}` : "";
}

function relationRequirementCovered(requirement: CanonicalTaskRequirement, assets: CanonicalEvidenceAsset[]) {
  if (!requirement.relation) return false;
  return assets.some((asset) =>
    (asset.relations || []).some((relation) =>
      relation.relation === requirement.relation &&
      requirement.subjectIds.every((id) => relation.subjectIds.includes(id))
    )
  );
}

function pathAllowedByDifficulty(asset: CanonicalEvidenceAsset, difficulty: CanonicalInvestigationTask["difficulty"]) {
  const profile = linuxDifficultyProfile(difficulty);
  if (profile.difficulty === "Advanced") return true;
  const normalized = normalizeLinuxEvidencePath(asset.path);
  return !profile.evidencePaths.prohibited.some((pattern) => {
    const normalizedPattern = normalizeLinuxEvidencePath(pattern);
    if (normalizedPattern.endsWith("*")) return normalized.startsWith(normalizedPattern.slice(0, -1));
    return normalized === normalizedPattern;
  });
}

function closureDiagnostic(args: {
  code: LinuxTaskPlannerDiagnostic["code"];
  simulation: LinuxSimulationWorld;
  difficulty: CanonicalInvestigationTask["difficulty"];
  intent: CanonicalInvestigationTask["intent"];
  taskId?: string;
  missingCapabilities?: string[];
  missingCurrentStateCapabilities?: string[];
  missingEvidence?: string[];
  missingCanonicalSubjects?: string[];
  missingRelationships?: string[];
  candidateEvidence?: string[];
  selectedEvidence?: string[];
  message: string;
}) {
  return plannerDiagnostic({
    code: args.code,
    difficulty: args.difficulty,
    intent: args.intent,
    family: args.simulation.investigation.incidentFamily,
    blueprintId: args.taskId,
    missingCapabilities: args.missingCapabilities,
    missingCurrentStateCapabilities: args.missingCurrentStateCapabilities,
    missingEvidence: args.missingEvidence,
    missingCanonicalSubjects: args.missingCanonicalSubjects,
    missingRelationships: args.missingRelationships,
    candidateEvidence: args.candidateEvidence,
    selectedEvidence: args.selectedEvidence,
    message: args.message,
  });
}

function taskEvidenceClosureResult(args: {
  simulation: LinuxSimulationWorld;
  intent: CanonicalInvestigationTask["intent"];
  difficulty: CanonicalInvestigationTask["difficulty"];
  requiredCapabilities: CanonicalEvidenceCapability[];
  currentStateRequirements: CanonicalTaskRequirement[];
  requirements: CanonicalTaskRequirement[];
  registry: CanonicalEvidenceAsset[];
  selected: CanonicalEvidenceAsset[];
  renderedPaths?: Set<string>;
  limit: number;
  candidateEvidenceConsidered: string[];
  rejectedCandidates: Array<{ evidencePath: string; reason: string }>;
  minimumEvidenceCount?: number;
}) {
  const selectedIds = new Set(args.selected.map((asset) => asset.id));
  const selectedProofs = proveTaskRequirements({
    id: "closure",
    intent: args.intent,
    requiredCapabilities: args.requiredCapabilities,
    inquiryTypes: inquiryTypesForIntent(args.intent, args.currentStateRequirements.map((item) => item.capability as LinuxCurrentStateCapability), args.requirements),
    currentStateRequirements: args.currentStateRequirements,
    selectedEvidenceAssetIds: args.selected.map((asset) => asset.id),
    canonicalObjectIds: args.requirements.flatMap((item) => item.subjectIds),
    primarySubjectIds: args.requirements.flatMap((item) => item.subjectIds),
    supportingSubjectIds: [],
    requirements: args.requirements,
    expectedDeliverableType: "timeline",
    difficulty: args.difficulty,
    order: 0,
  }, args.selected);
  const satisfiedCapabilities = args.requiredCapabilities.filter((capability) =>
    args.selected.some((asset) => asset.capabilities.includes(capability))
  );
  const missingCapabilities = args.requiredCapabilities.filter((capability) => !satisfiedCapabilities.includes(capability));
  const requiredCurrentStateCapabilities = Array.from(new Set(args.currentStateRequirements.map((item) => item.capability)));
  const missingCurrentStateCapabilities = requiredCurrentStateCapabilities.filter((capability) =>
    !args.selected.some((asset) => asset.capabilities.includes(capability) && currentStateEvidenceIsGenuine(asset))
  );
  const requiredCanonicalSubjects = Array.from(new Set(args.requirements.flatMap((item) => item.subjectIds)));
  const groundedCanonicalSubjects = Array.from(new Set(args.selected.flatMap((asset) => asset.canonicalObjectIds)))
    .filter((id) => requiredCanonicalSubjects.includes(id));
  const missingCanonicalSubjects = Array.from(new Set([
    ...requiredCanonicalSubjects.filter((id) => !groundedCanonicalSubjects.includes(id)),
    ...selectedProofs.flatMap((proof) => proof.missingSubjectIds),
  ]));
  const requiredRelationships = Array.from(new Set(args.requirements
    .filter((item) => item.relation)
    .map(requirementRelationKey)
    .filter(Boolean)));
  const groundedRelationships = args.requirements
    .filter((item) => item.relation && relationRequirementCovered(item, args.selected))
    .map(requirementRelationKey)
    .filter(Boolean);
  const missingRelationships = Array.from(new Set([
    ...requiredRelationships.filter((key) => !groundedRelationships.includes(key)),
    ...selectedProofs.filter((proof) => proof.missingRelation).map(proofRelationshipKey).filter(Boolean),
  ]));
  const registryIds = new Set(args.registry.map((asset) => asset.id));
  const prohibitedEvidenceEncountered = args.selected
    .filter((asset) => !registryIds.has(asset.id) || !pathAllowedByDifficulty(asset, args.difficulty))
    .map((asset) => asset.path);
  const unrenderedEvidenceEncountered = args.renderedPaths
    ? args.selected.filter((asset) => !args.renderedPaths?.has(normalizeLinuxEvidencePath(asset.path)) && !lowerTierPathIsRendered(asset.path)).map((asset) => asset.path)
    : [];
  const evidenceLimitExceeded = args.selected.length > args.limit;
  const minimumEvidenceCount = args.minimumEvidenceCount || 1;
  const minimumEvidenceCountMissing = Math.max(0, minimumEvidenceCount - args.selected.length);
  const selectionDiagnostics: LinuxTaskPlannerDiagnostic[] = [];
  const selectedEvidence = args.selected.map((asset) => asset.path);
  const common = {
    simulation: args.simulation,
    difficulty: args.difficulty,
    intent: args.intent,
    candidateEvidence: args.candidateEvidenceConsidered,
    selectedEvidence,
  };
  if (missingCapabilities.length > 0) {
    selectionDiagnostics.push(closureDiagnostic({
      ...common,
      code: "LINUX_TASK_EVIDENCE_CAPABILITY_CLOSURE_FAILED",
      missingCapabilities,
      message: `Task intent ${args.intent} lacks capability closure for ${missingCapabilities.join(", ")}.`,
    }));
  }
  if (missingCurrentStateCapabilities.length > 0) {
    selectionDiagnostics.push(closureDiagnostic({
      ...common,
      code: "LINUX_TASK_EVIDENCE_CURRENT_STATE_CLOSURE_FAILED",
      missingCurrentStateCapabilities,
      message: `Task intent ${args.intent} lacks genuine current-state evidence for ${missingCurrentStateCapabilities.join(", ")}.`,
    }));
  }
  if (missingCanonicalSubjects.length > 0) {
    selectionDiagnostics.push(closureDiagnostic({
      ...common,
      code: "LINUX_TASK_EVIDENCE_SUBJECT_CLOSURE_FAILED",
      missingCanonicalSubjects,
      message: `Task intent ${args.intent} lacks canonical subject closure.`,
    }));
  }
  if (missingRelationships.length > 0) {
    selectionDiagnostics.push(closureDiagnostic({
      ...common,
      code: "LINUX_TASK_EVIDENCE_RELATIONSHIP_CLOSURE_FAILED",
      missingRelationships,
      message: `Task intent ${args.intent} lacks canonical relationship closure.`,
    }));
  }
  if (prohibitedEvidenceEncountered.length > 0 || unrenderedEvidenceEncountered.length > 0) {
    selectionDiagnostics.push(closureDiagnostic({
      ...common,
      code: prohibitedEvidenceEncountered.length > 0
        ? "LINUX_TASK_EVIDENCE_DIFFICULTY_CLOSURE_FAILED"
        : "LINUX_TASK_EVIDENCE_PATH_CLOSURE_FAILED",
      missingEvidence: [...prohibitedEvidenceEncountered, ...unrenderedEvidenceEncountered],
      message: `Task intent ${args.intent} selected evidence outside the closed planning/rendered surface.`,
    }));
  }
  if (evidenceLimitExceeded) {
    selectionDiagnostics.push(closureDiagnostic({
      ...common,
      code: "LINUX_TASK_EVIDENCE_LIMIT_EXCEEDED",
      missingEvidence: selectedEvidence,
      message: `Task intent ${args.intent} requires more than ${args.limit} evidence files for closure.`,
    }));
  }
  if (minimumEvidenceCountMissing > 0) {
    selectionDiagnostics.push(closureDiagnostic({
      ...common,
      code: "LINUX_TASK_EVIDENCE_SELECTION_UNSATISFIABLE",
      missingEvidence: [`${minimumEvidenceCountMissing} additional supporting evidence file(s)`],
      message: `Task intent ${args.intent} needs ${minimumEvidenceCount} selected evidence files for ${args.difficulty}.`,
    }));
  }
  return {
    satisfied: selectionDiagnostics.length === 0 && selectedProofs.every((proof) => proof.feasible),
    selectedEvidence: args.selected,
    requiredCapabilities: args.requiredCapabilities,
    satisfiedCapabilities,
    missingCapabilities,
    requiredCurrentStateCapabilities,
    missingCurrentStateCapabilities,
    requiredCanonicalSubjects,
    groundedCanonicalSubjects,
    missingCanonicalSubjects,
    requiredRelationships,
    groundedRelationships,
    missingRelationships,
    prohibitedEvidenceEncountered,
    unrenderedEvidenceEncountered,
    candidateEvidenceConsidered: args.candidateEvidenceConsidered,
    rejectedCandidates: args.rejectedCandidates,
    selectionDiagnostics,
    evidenceLimit: args.limit,
    evidenceLimitExceeded,
    minimumEvidenceCount,
    minimumEvidenceCountMissing,
    requirementProofs: selectedProofs,
  } satisfies LinuxTaskEvidenceClosureResult;
}

export function proveLinuxTaskEvidenceClosure(args: {
  simulation: LinuxSimulationWorld;
  intent: CanonicalInvestigationTask["intent"];
  difficulty: CanonicalInvestigationTask["difficulty"];
  registry: CanonicalEvidenceAsset[];
  requirements: CanonicalTaskRequirement[];
  requiredCapabilities: CanonicalEvidenceCapability[];
  currentStateRequirements: CanonicalTaskRequirement[];
  renderedPaths?: Set<string>;
  limit?: number;
  minimumEvidenceCount?: number;
  requiredEvidencePaths?: string[];
}): LinuxTaskEvidenceClosureResult {
  const limit = args.limit || TASK_EVIDENCE_LIMIT;
  const minimumEvidenceCount = args.minimumEvidenceCount || 1;
  const registryIds = new Set(args.registry.map((asset) => asset.id));
  const candidateEvidenceConsidered = args.registry.map((asset) => asset.path);
  const rejectedCandidates: Array<{ evidencePath: string; reason: string }> = [];
  const eligibleCandidates = args.registry
    .filter((asset) => {
      if (!registryIds.has(asset.id)) {
        rejectedCandidates.push({ evidencePath: asset.path, reason: "absent from planning registry" });
        return false;
      }
      if (!pathAllowedByDifficulty(asset, args.difficulty)) {
        rejectedCandidates.push({ evidencePath: asset.path, reason: "prohibited for difficulty" });
        return false;
      }
      if (args.renderedPaths && !args.renderedPaths.has(normalizeLinuxEvidencePath(asset.path))) {
        if (!lowerTierPathIsRendered(asset.path)) {
          rejectedCandidates.push({ evidencePath: asset.path, reason: "absent from rendered asset pack" });
          return false;
        }
      }
      return true;
    })
    .sort((left, right) => normalizeLinuxEvidencePath(left.path).localeCompare(normalizeLinuxEvidencePath(right.path)));
  const selected: CanonicalEvidenceAsset[] = [];
  const select = (asset: CanonicalEvidenceAsset) => {
    if (!selected.some((item) => item.id === asset.id)) selected.push(asset);
  };
  for (const path of args.requiredEvidencePaths || []) {
    const required = eligibleCandidates.find((asset) => normalizeLinuxEvidencePath(asset.path) === normalizeLinuxEvidencePath(path));
    if (!required) throw new Error(`Linux task evidence closure: required rendered source ${path} is unavailable.`);
    select(required);
  }
  const currentCapabilities = new Set(args.currentStateRequirements.map((item) => item.capability));

  const closureState = () => taskEvidenceClosureResult({
    simulation: args.simulation,
    intent: args.intent,
    difficulty: args.difficulty,
    requiredCapabilities: args.requiredCapabilities,
    currentStateRequirements: args.currentStateRequirements,
    requirements: args.requirements,
    registry: args.registry,
    selected,
    renderedPaths: args.renderedPaths,
      limit,
      candidateEvidenceConsidered,
      rejectedCandidates,
      minimumEvidenceCount,
    });

  for (let guard = 0; guard < limit; guard += 1) {
    const current = closureState();
    if (current.satisfied && selected.length >= minimumEvidenceCount) return current;
    const missingRequirementIds = new Set(current.requirementProofs.filter((proof) => !proof.feasible).map((proof) => proof.requirementId));
    const missingCapabilities = new Set(current.missingCapabilities);
    const missingCurrent = new Set(current.missingCurrentStateCapabilities);
    const missingSubjects = new Set(current.missingCanonicalSubjects);
    const missingRelations = new Set(current.missingRelationships);
    const scored = eligibleCandidates
      .filter((asset) => !selected.some((item) => item.id === asset.id))
      .map((asset) => {
        const proofs = args.requirements.map((requirement) => taskRequirementAssetProof(requirement, asset));
        const closedRequirements = proofs.filter((proof) => missingRequirementIds.has(proof.requirementId) && proof.feasible).length;
        const capabilityHits = args.requiredCapabilities.filter((capability) => missingCapabilities.has(capability) && asset.capabilities.includes(capability)).length;
        const currentHits = Array.from(currentCapabilities).filter((capability) =>
          missingCurrent.has(capability) && asset.capabilities.includes(capability) && currentStateEvidenceIsGenuine(asset)
        ).length;
        const subjectHits = asset.canonicalObjectIds.filter((id) => missingSubjects.has(id)).length;
        const relationshipHits = args.requirements.filter((requirement) =>
          requirement.relation &&
          (missingRelations.has(requirementRelationKey(requirement)) || !selected.some((selectedAsset) => relationRequirementCovered(requirement, [selectedAsset]))) &&
          relationRequirementCovered(requirement, [asset])
        ).length;
        const directRequirementHits = proofs.filter((proof) => proof.feasible).length;
        const fillerScore = current.satisfied && selected.length < minimumEvidenceCount
          ? args.requiredCapabilities.filter((capability) => asset.capabilities.includes(capability)).length * 20 +
            args.requirements.map((requirement) => taskRequirementAssetProof(requirement, asset)).filter((proof) => proof.feasible).length * 50
          : 0;
        const intentPriority =
          args.intent === "cron_analysis"
            ? (asset.capabilities.includes("cron_definition") ? 700 : 0) +
              (asset.capabilities.includes("cron_execution") ? 500 : 0)
            : args.intent === "change_control"
              ? (asset.capabilities.includes("maintenance_scope") ? 5000 : 0) +
                (asset.capabilities.includes("change_control") ? 300 : 0)
              : 0;
        return {
          asset,
          score:
            closedRequirements * 1000 +
            relationshipHits * 200 +
            currentHits * 150 +
            directRequirementHits * 100 +
            capabilityHits * 40 +
            subjectHits * 10 +
            supportScore[asset.support || "static"] +
            (asset.exactTimestampSupport ? 1 : 0) +
            intentPriority +
            fillerScore,
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        normalizeLinuxEvidencePath(left.asset.path).localeCompare(normalizeLinuxEvidencePath(right.asset.path))
      );
    const next = scored[0]?.asset;
    if (!next) break;
    select(next);
  }

  const result = closureState();
  if (!result.satisfied && selected.length >= limit) {
    if (!result.selectionDiagnostics.some((item) => item.code === "LINUX_TASK_EVIDENCE_LIMIT_EXCEEDED")) {
      result.selectionDiagnostics.push(closureDiagnostic({
        code: "LINUX_TASK_EVIDENCE_LIMIT_EXCEEDED",
        simulation: args.simulation,
        difficulty: args.difficulty,
        intent: args.intent,
        candidateEvidence: candidateEvidenceConsidered,
        selectedEvidence: selected.map((asset) => asset.path),
        missingCapabilities: result.missingCapabilities,
        missingCurrentStateCapabilities: result.missingCurrentStateCapabilities,
        missingCanonicalSubjects: result.missingCanonicalSubjects,
        missingRelationships: result.missingRelationships,
        message: `Task intent ${args.intent} exceeded the ${limit} evidence-file closure limit.`,
      }));
    }
  }
  if (!result.satisfied && selected.length >= limit && result.selectionDiagnostics.length === 0) {
    result.selectionDiagnostics.push(closureDiagnostic({
      code: "LINUX_TASK_EVIDENCE_SELECTION_UNSATISFIABLE",
      simulation: args.simulation,
      difficulty: args.difficulty,
      intent: args.intent,
      candidateEvidence: candidateEvidenceConsidered,
      selectedEvidence: selected.map((asset) => asset.path),
      missingCapabilities: result.missingCapabilities,
      missingCurrentStateCapabilities: result.missingCurrentStateCapabilities,
      missingCanonicalSubjects: result.missingCanonicalSubjects,
      missingRelationships: result.missingRelationships,
      message: `Task intent ${args.intent} cannot be closed within ${limit} evidence files.`,
    }));
  }
  return result;
}

function syntheticPlannerSpec(
  intent: CanonicalInvestigationTask["intent"],
  incidentFamily: string
) {
  const allFamilySpecs = linuxPlannerTaskSpecs(incidentFamily, true);
  const base = allFamilySpecs.find((spec) => spec.intent === intent);
  if (base) return base;
  const contract = linuxTaskContract(intent);
  const blueprintSource = allFamilySpecs[0];
  return {
    ...contract,
    blueprintId: blueprintSource.blueprintId,
    blueprintLabel: blueprintSource.blueprintLabel,
    stepLabel: contract.label,
    suggestedVerb: "Review",
    expectedDeliverableType: contract.expectedDeliverableType,
  };
}

function evaluateTaskSpecEligibility(
  simulation: LinuxSimulationWorld,
  spec: ReturnType<typeof linuxPlannerTaskSpecs>[number],
  registry: CanonicalEvidenceAsset[],
  difficulty: CanonicalInvestigationTask["difficulty"],
  requireRenderedLowerTierEvidence: boolean,
  options: { mandatoryIncidentIntent?: boolean } = {}
) {
  const family = simulation.investigation.incidentFamily;
  const profile = linuxDifficultyProfile(difficulty);
  const classification = intentClass(spec.intent, profile);
  const diagnostics: LinuxTaskPlannerDiagnostic[] = [];
  if (classification === "prohibited" && !options.mandatoryIncidentIntent) {
    diagnostics.push(plannerDiagnostic({
      code: "LINUX_TASK_INTENT_PROHIBITED_FOR_DIFFICULTY",
      difficulty,
      intent: spec.intent,
      family,
      blueprintId: spec.blueprintId,
      prohibited: true,
      message: `Task intent ${spec.intent} is prohibited for ${difficulty}.`,
    }));
    return { eligible: false, diagnostics, selected: [] as CanonicalEvidenceAsset[] };
  }
  if (classification === "unclassified") {
    diagnostics.push(plannerDiagnostic({
      code: "LINUX_TASK_INTENT_UNCLASSIFIED",
      difficulty,
      intent: spec.intent,
      family,
      blueprintId: spec.blueprintId,
      message: `Task intent ${spec.intent} is unclassified for ${difficulty}.`,
    }));
    return { eligible: false, diagnostics, selected: [] as CanonicalEvidenceAsset[] };
  }

  const currentStateRequirements = buildCurrentStateRequirementsForPlanning(simulation, difficulty, spec.intent);
  const requirements = [
    ...buildTaskRequirementsForIntent(simulation, spec.intent, spec.requiredCapabilities, difficulty),
    ...currentStateRequirements,
  ];
  const taskRequiredCapabilities = spec.requiredCapabilities
    .filter((capability) => !(spec.intent === "service_state" && capability === "service_transition" && !requirements.some((requirement) => requirement.capability === "service_transition")))
    .filter((capability) => !(spec.intent === "command_process" && family === "data_staging" && difficulty !== "Advanced" && capability === "open_file_correlation"));
  const evidenceSelectionRequirements = supplementalTaskLocalEvidenceRequirements(simulation, spec.intent, difficulty);
  const closureRequirements = [...requirements, ...evidenceSelectionRequirements];
  const plannedCapabilities = Array.from(new Set([
    ...taskRequiredCapabilities,
    ...closureRequirements.map((item) => item.capability),
    ...currentStateRequirements.map((item) => item.capability),
  ]));
  const evidenceSelectionCapabilities = Array.from(new Set([
    ...plannedCapabilities,
    ...supplementalTaskLocalEvidenceCapabilities(simulation, spec.intent, difficulty),
  ]));
  const missingCapabilities = evidenceSelectionCapabilities.filter((capability) => capabilityClass(capability, profile) === "prohibited" || capabilityClass(capability, profile) === "unclassified");
  if (missingCapabilities.length > 0) {
    diagnostics.push(plannerDiagnostic({
      code: "LINUX_TASK_CAPABILITY_UNAVAILABLE",
      difficulty,
      intent: spec.intent,
      family,
      blueprintId: spec.blueprintId,
      missingCapabilities,
      prohibited: missingCapabilities.some((capability) => capabilityClass(capability, profile) === "prohibited"),
      message: `Task intent ${spec.intent} requires capabilities unavailable for ${difficulty}: ${missingCapabilities.join(", ")}.`,
    }));
    return { eligible: false, diagnostics, selected: [] as CanonicalEvidenceAsset[] };
  }

  const renderedPaths = requireRenderedLowerTierEvidence
    ? lowerTierRenderedTaskEvidencePaths(simulation, difficulty)
    : undefined;
  const closure = proveLinuxTaskEvidenceClosure({
    simulation,
    intent: spec.intent,
    difficulty,
    registry,
    requirements: closureRequirements,
    requiredCapabilities: evidenceSelectionCapabilities,
    currentStateRequirements,
    renderedPaths,
    limit: TASK_EVIDENCE_LIMIT,
    minimumEvidenceCount: difficulty === "Advanced" ? 2 : 1,
    requiredEvidencePaths: requiredTaskEvidencePaths(simulation, spec.intent, difficulty),
  });
  const missingEvidence = closure.missingCapabilities;
  if (missingEvidence.length > 0) {
    diagnostics.push(plannerDiagnostic({
      code: classification === "conditional" ? "LINUX_TASK_INTENT_CONDITIONAL_SUPPORT_MISSING" : "LINUX_TASK_EVIDENCE_CAPABILITY_CLOSURE_FAILED",
      difficulty,
      intent: spec.intent,
      family,
      blueprintId: spec.blueprintId,
      missingCapabilities: missingEvidence,
      missingEvidence,
      message: `Task intent ${spec.intent} lacks eligible planning evidence for ${missingEvidence.join(", ")}.`,
    }));
    diagnostics.push(...closure.selectionDiagnostics);
    return { eligible: false, diagnostics, selected: closure.selectedEvidence };
  }

  const missingCurrentStateCapabilities = closure.missingCurrentStateCapabilities;
  if (missingCurrentStateCapabilities.length > 0) {
    diagnostics.push(plannerDiagnostic({
      code: "LINUX_TASK_EVIDENCE_CURRENT_STATE_CLOSURE_FAILED",
      difficulty,
      intent: spec.intent,
      family,
      blueprintId: spec.blueprintId,
      missingCurrentStateCapabilities,
      message: `Task intent ${spec.intent} lacks genuine current-state evidence for ${missingCurrentStateCapabilities.join(", ")}.`,
    }));
    diagnostics.push(...closure.selectionDiagnostics);
    return { eligible: false, diagnostics, selected: closure.selectedEvidence };
  }

  if (closure.missingCanonicalSubjects.length > 0 || closure.missingRelationships.length > 0) {
    diagnostics.push(plannerDiagnostic({
      code: closure.missingRelationships.length > 0
        ? "LINUX_TASK_EVIDENCE_RELATIONSHIP_CLOSURE_FAILED"
        : "LINUX_TASK_EVIDENCE_SUBJECT_CLOSURE_FAILED",
      difficulty,
      intent: spec.intent,
      family,
      blueprintId: spec.blueprintId,
      missingCanonicalSubjects: closure.missingCanonicalSubjects,
      missingRelationships: closure.missingRelationships,
      message: `Task intent ${spec.intent} lacks object grounding in eligible evidence.`,
    }));
    diagnostics.push(...closure.selectionDiagnostics);
    return { eligible: false, diagnostics, selected: closure.selectedEvidence };
  }

  if (!closure.satisfied) {
    diagnostics.push(...closure.selectionDiagnostics);
    if (closure.selectionDiagnostics.length === 0) {
      diagnostics.push(plannerDiagnostic({
        code: "LINUX_TASK_EVIDENCE_SELECTION_UNSATISFIABLE",
        difficulty,
        intent: spec.intent,
        family,
        blueprintId: spec.blueprintId,
        missingCapabilities: closure.missingCapabilities,
        missingCurrentStateCapabilities: closure.missingCurrentStateCapabilities,
        missingCanonicalSubjects: closure.missingCanonicalSubjects,
        missingRelationships: closure.missingRelationships,
        selectedEvidence: closure.selectedEvidence.map((asset) => asset.path),
        message: `Task intent ${spec.intent} cannot be closed by eligible planning evidence.`,
      }));
    }
    return { eligible: false, diagnostics, selected: closure.selectedEvidence };
  }

  return { eligible: true, diagnostics, selected: closure.selectedEvidence };
}

export function resolveEligibleLinuxTaskSpecs(
  simulation: LinuxSimulationWorld,
  registry: CanonicalEvidenceAsset[],
  difficulty: CanonicalInvestigationTask["difficulty"],
  options: { requireRenderedLowerTierEvidence?: boolean; requestedDurationMinutes?: number } = {}
) {
  const advanced = difficulty === "Advanced";
  const diagnostics: LinuxTaskPlannerDiagnostic[] = [];
  const family = simulation.investigation.incidentFamily;
  const taskVariant = simulation.diversityProfile?.taskVariant || 0;
  const diversifySpecs = <T extends { intent: CanonicalInvestigationTask["intent"] }>(items: T[]) => items
    .slice()
    .sort((left, right) =>
      linuxStableDiversityHash(`${taskVariant}:${family}:${left.intent}`) -
      linuxStableDiversityHash(`${taskVariant}:${family}:${right.intent}`)
    );
  const requestedDuration = Number(options.requestedDurationMinutes ?? simulation.requestedDurationMinutes);
  // Duration controls the number and depth of tasks, not whether every pack
  // receives the same reasoning graph. Mandatory family intents are added
  // below before optional eligible intents, so varying this order cannot drop
  // a protected incident question.
  const baseSpecs = diversifySpecs(linuxPlannerTaskSpecs(family, advanced));

  const profile = linuxDifficultyProfile(difficulty);
  const expectedTaskCount = linuxDurationTaskCountBounds(difficulty, options.requestedDurationMinutes ?? simulation.requestedDurationMinutes);
  const duration = requestedDuration;
  const shortDuration = Number.isFinite(duration) && duration <= 15;
  const advancedFollowups: CanonicalInvestigationTask["intent"][] = [
    "impact_assessment",
    "risk_assessment",
    "containment_recommendation",
  ];
  const advancedSshKeyThirty = family === "ssh_key_compromise" && advanced && requestedDuration === 30;
  const familyMandatoryIntents = advancedSshKeyThirty
    ? (["change_control", "key_provenance", "ssh_authentication", "impact_assessment"] as CanonicalInvestigationTask["intent"][])
    : mandatoryLinuxIncidentTaskIntents(simulation.investigation.incidentFamily, difficulty);
  // A short Advanced case must never trade away a protected family question
  // merely to add a generic risk/impact follow-up. When the family already
  // fills the task budget, synthesis is embedded in a mandatory task below.
  const advancedFollowup = advanced && !advancedSshKeyThirty && familyMandatoryIntents.length < expectedTaskCount.max
    ? advancedFollowups[taskVariant % advancedFollowups.length]
    : undefined;
  const mandatoryIntents = diversifySpecs(
    Array.from(new Set([
      ...familyMandatoryIntents,
      ...(advancedFollowup ? [advancedFollowup] : []),
    ])).map((intent) => ({ intent }))
  ).map((item) => item.intent);
  const targetCount = shortDuration
    ? Math.min(expectedTaskCount.max, Math.max(expectedTaskCount.min, mandatoryIntents.length))
    : difficulty === "Beginner" && simulation.investigation.incidentFamily === "ssh_key_compromise"
    ? expectedTaskCount.min
    : Math.min(expectedTaskCount.max, Math.max(expectedTaskCount.min, baseSpecs.length));
  const requireRenderedLowerTierEvidence = options.requireRenderedLowerTierEvidence ?? !advanced;
  const accepted: typeof baseSpecs = [];
  const acceptedIntents = new Set<CanonicalInvestigationTask["intent"]>();
  const mandatoryIntentSet = new Set(mandatoryIntents);
  const skippedIdentityOverlapSpecs: typeof baseSpecs = [];

  const consider = (spec: (typeof baseSpecs)[number], options: { allowIdentityOverlap?: boolean } = {}) => {
    if (acceptedIntents.has(spec.intent)) return;
    if (family === "unauthorized_package_install" && difficulty === "Intermediate" && requestedDuration === 30 &&
      (spec.intent === "configuration_review" || spec.intent === "sudo_policy")) return;
    if (
      advanced &&
      advancedFollowups.includes(spec.intent) &&
      advancedFollowups.some((intent) => acceptedIntents.has(intent))
    ) return;
    if (family === "ssh_key_compromise" && spec.intent === "file_permissions" && acceptedIntents.has("key_provenance")) return;
    if (family === "ssh_bruteforce" && spec.intent === "configuration_review" && acceptedIntents.has("ssh_authentication")) return;
    if (!options.allowIdentityOverlap && !mandatoryIntentSet.has(spec.intent)) {
      if (
        (spec.intent === "actor_attribution" && acceptedIntents.has("ssh_authentication") && !mandatoryIntentSet.has("actor_attribution")) ||
        (spec.intent === "ssh_authentication" && acceptedIntents.has("actor_attribution") && !mandatoryIntentSet.has("ssh_authentication"))
      ) {
        if (!skippedIdentityOverlapSpecs.some((item) => item.intent === spec.intent)) skippedIdentityOverlapSpecs.push(spec);
        return;
      }
    }
    const result = evaluateTaskSpecEligibility(simulation, spec, registry, difficulty, requireRenderedLowerTierEvidence);
    diagnostics.push(...result.diagnostics);
    if (result.eligible) {
      accepted.push(spec);
      acceptedIntents.add(spec.intent);
    }
  };

  const allFamilySpecs = diversifySpecs(linuxPlannerTaskSpecs(simulation.investigation.incidentFamily, true));
  for (const intent of mandatoryIntents) {
    if (accepted.length >= targetCount) break;
    if (acceptedIntents.has(intent)) continue;
    const spec = allFamilySpecs.find((item) => item.intent === intent) || syntheticPlannerSpec(intent, simulation.investigation.incidentFamily);
    const result = evaluateTaskSpecEligibility(simulation, spec, registry, difficulty, requireRenderedLowerTierEvidence, {
      mandatoryIncidentIntent: true,
    });
    diagnostics.push(...result.diagnostics);
    if (result.eligible) {
      accepted.push(spec);
      acceptedIntents.add(spec.intent);
    }
  }

  for (const spec of baseSpecs) {
    if (accepted.length >= targetCount) break;
    consider(spec);
  }

  if (family === "unauthorized_package_install" && difficulty === "Intermediate" && requestedDuration === 30 && accepted.length < targetCount) {
    // The dated change comparison replaces the heavier optional sudo-policy
    // analysis in a 30-minute plan. Package-source file state is a distinct,
    // bounded fifth question rather than another transaction reconstruction.
    consider(syntheticPlannerSpec("file_permissions", family));
  }

  const familyFallbacks = diversifySpecs(
    (FAMILY_SAFE_FALLBACK_INTENTS[simulation.investigation.incidentFamily] || BEGINNER_SAFE_FALLBACK_INTENTS).map((intent) => ({ intent }))
  ).map((item) => item.intent);
  for (const intent of familyFallbacks) {
    if (accepted.length >= targetCount) break;
    consider(syntheticPlannerSpec(intent, simulation.investigation.incidentFamily));
  }

  const variedBeginnerFallbacks = diversifySpecs(BEGINNER_SAFE_FALLBACK_INTENTS.map((intent) => ({ intent }))).map((item) => item.intent);
  for (const intent of variedBeginnerFallbacks) {
    if (accepted.length >= targetCount) break;
    consider(syntheticPlannerSpec(intent, simulation.investigation.incidentFamily));
  }

  for (const spec of skippedIdentityOverlapSpecs) {
    if (accepted.length >= expectedTaskCount.min && difficulty !== "Beginner") break;
    if (accepted.length >= targetCount) break;
    consider(spec, { allowIdentityOverlap: true });
  }

  if (accepted.length < expectedTaskCount.min) {
    diagnostics.push(plannerDiagnostic({
      code: "LINUX_TASK_COUNT_UNSATISFIABLE",
      difficulty,
      family: simulation.investigation.incidentFamily,
      missingEvidence: [],
      message: `Could not construct ${difficulty} task plan with ${expectedTaskCount.min}-${expectedTaskCount.max} valid tasks; produced ${accepted.length}.`,
    }));
    throw new Error(`Linux task planner failed for ${difficulty}: ${diagnostics[diagnostics.length - 1].message}`);
  }

  return { specs: accepted.slice(0, targetCount), diagnostics };
}

function minimizeTaskLocalEvidenceSelection(args: {
  simulation: LinuxSimulationWorld;
  intent: CanonicalInvestigationTask["intent"];
  difficulty: CanonicalInvestigationTask["difficulty"];
  selected: CanonicalEvidenceAsset[];
  registry: CanonicalEvidenceAsset[];
  requirements: CanonicalTaskRequirement[];
  requiredCapabilities: CanonicalEvidenceCapability[];
  currentStateRequirements: CanonicalTaskRequirement[];
  minimumEvidenceCount: number;
  requiredEvidencePaths?: string[];
}) {
  let selected = [...args.selected];
  for (const candidate of [...selected].reverse()) {
    if (args.requiredEvidencePaths?.some((path) => normalizeLinuxEvidencePath(path) === normalizeLinuxEvidencePath(candidate.path))) continue;
    if (selected.length <= args.minimumEvidenceCount) break;
    const trial = selected.filter((asset) => asset.id !== candidate.id);
    const closure = taskEvidenceClosureResult({
      simulation: args.simulation,
      intent: args.intent,
      difficulty: args.difficulty,
      requiredCapabilities: args.requiredCapabilities,
      currentStateRequirements: args.currentStateRequirements,
      requirements: args.requirements,
      registry: args.registry,
      selected: trial,
      limit: TASK_EVIDENCE_LIMIT,
      minimumEvidenceCount: args.minimumEvidenceCount,
      candidateEvidenceConsidered: args.registry.map((asset) => asset.path),
      rejectedCandidates: [],
    });
    if (closure.satisfied) selected = trial;
  }
  return selected;
}
function buildTaskPlan(simulation: LinuxSimulationWorld, registry: CanonicalEvidenceAsset[], difficultyInput: string) {
  const difficulty = (["Beginner", "Intermediate", "Advanced"].includes(difficultyInput) ? difficultyInput : "Advanced") as CanonicalInvestigationTask["difficulty"];
  const advanced = difficulty === "Advanced";
  const advancedSshKeyThirty = advanced && simulation.investigation.incidentFamily === "ssh_key_compromise" && simulation.requestedDurationMinutes === 30;
  const lowerTierRenderedPaths = lowerTierRenderedTaskEvidencePaths(simulation, difficulty);
  const taskSelectionRegistry = advanced
    ? registry
    : registry.filter((asset) => lowerTierRenderedPaths.has(normalizeLinuxEvidencePath(asset.path)) || lowerTierPathIsRendered(asset.path));
  const resolvedTaskSpecs = resolveEligibleLinuxTaskSpecs(simulation, taskSelectionRegistry, difficulty, {
    requestedDurationMinutes: simulation.requestedDurationMinutes,
  });
  simulation.taskPlannerDiagnostics = resolvedTaskSpecs.diagnostics;
  const taskSpecs = resolvedTaskSpecs.specs;
  const advancedFollowupIntents = new Set<CanonicalInvestigationTask["intent"]>([
    "impact_assessment",
    "risk_assessment",
    "containment_recommendation",
  ]);
  const hasExplicitAdvancedFollowup = taskSpecs.some((spec) => advancedFollowupIntents.has(spec.intent));
  const embeddedHypothesisTaskIndex = advanced && !hasExplicitAdvancedFollowup
    ? Math.max(0, taskSpecs.findIndex((spec) => spec.intent === "command_process"))
    : -1;
  const tasks = taskSpecs.map((contract, index) => {
    const { intent, requiredCapabilities, expectedDeliverableType } = contract;
    const currentStateRequirements = buildCurrentStateRequirementsForPlanning(simulation, difficulty, intent);
    const requirements = [
      ...buildTaskRequirementsForIntent(simulation, intent, requiredCapabilities, difficulty),
      ...currentStateRequirements,
    ];
    const embedsCompetingHypothesis = index === embeddedHypothesisTaskIndex;
    if (embedsCompetingHypothesis) {
      requirements.push(requirement(
        `${intent}:advanced_competing_hypothesis`,
        "risk_context",
        linuxLearnerReviewSubjectIds(simulation),
        "context"
      ));
    }
    const taskRequiredCapabilities = requiredCapabilities
      .filter((capability) => !(intent === "service_state" && capability === "service_transition" && !requirements.some((requirement) => requirement.capability === "service_transition")))
      .filter((capability) => !(intent === "command_process" && simulation.investigation.incidentFamily === "data_staging" && difficulty !== "Advanced" && capability === "open_file_correlation"));
    const evidenceSelectionRequirements = supplementalTaskLocalEvidenceRequirements(simulation, intent, difficulty);
    const closureRequirements = [...requirements, ...evidenceSelectionRequirements];
    const plannedCapabilities = Array.from(new Set([
      ...taskRequiredCapabilities,
      ...closureRequirements.map((item) => item.capability),
      ...currentStateRequirements.map((item) => item.capability),
    ]));
    const evidenceSelectionCapabilities = Array.from(new Set([
      ...plannedCapabilities,
      ...supplementalTaskLocalEvidenceCapabilities(simulation, intent, difficulty),
    ]));
    const closure = proveLinuxTaskEvidenceClosure({
      simulation,
      intent,
      difficulty,
      registry: taskSelectionRegistry,
      requirements: closureRequirements,
      requiredCapabilities: evidenceSelectionCapabilities,
      currentStateRequirements,
      limit: TASK_EVIDENCE_LIMIT,
      minimumEvidenceCount: advanced ? 2 : 1,
      requiredEvidencePaths: requiredTaskEvidencePaths(simulation, intent, difficulty),
    });
    if (!closure.satisfied) {
      simulation.taskPlannerDiagnostics.push(...closure.selectionDiagnostics);
      throw new Error(`Linux task evidence closure failed for ${difficulty} ${intent}: ${closure.selectionDiagnostics[0]?.message || "unsatisfied evidence closure"} selected=${closure.selectedEvidence.map((asset) => asset.path).join("|")} missingRelations=${closure.missingRelationships.join("|")} missingSubjects=${closure.missingCanonicalSubjects.join("|")}`);
    }
    const selected = minimizeTaskLocalEvidenceSelection({
      simulation,
      intent,
      difficulty,
      selected: closure.selectedEvidence,
      registry: taskSelectionRegistry,
      requirements: closureRequirements,
      requiredCapabilities: evidenceSelectionCapabilities,
      currentStateRequirements,
      minimumEvidenceCount: advanced ? 2 : 1,
      requiredEvidencePaths: requiredTaskEvidencePaths(simulation, intent, difficulty),
    });

    const requiredSubjectIds = Array.from(new Set(closureRequirements.flatMap((item) => item.subjectIds)));
    const supportingSubjectLimit = intent === "change_control" && !advanced ? 3 : 24;
    const supportingSubjectIds = Array.from(new Set(
      selected.flatMap((asset) => asset.canonicalObjectIds).filter((id) => !requiredSubjectIds.includes(id))
    )).slice(0, supportingSubjectLimit);
    return {
      id: `task:${index + 1}:${intent}`,
      intent,
      requiredCapabilities: plannedCapabilities,
      inquiryTypes: inquiryTypesForIntent(intent, currentStateRequirements.map((item) => item.capability as LinuxCurrentStateCapability), requirements),
      currentStateRequirements,
      selectedEvidenceAssetIds: selected.map((asset) => asset.id),
      canonicalObjectIds: Array.from(new Set([...requiredSubjectIds, ...supportingSubjectIds])),
      primarySubjectIds: requiredSubjectIds,
      supportingSubjectIds,
      requirements: closureRequirements,
      expectedDeliverableType,
      difficulty,
      order: index + 1,
      blueprintId: contract.blueprintId,
      blueprintLabel: embedsCompetingHypothesis ? "Competing-explanation synthesis" : contract.blueprintLabel,
      stepLabel: advancedSshKeyThirty && intent === "ssh_authentication"
        ? "Correlate SSH sessions with process branches and subsequent commands"
        : advancedSshKeyThirty && intent === "impact_assessment"
        ? "Bound observed activity and risk before escalation"
        : embedsCompetingHypothesis ? "Test the observed execution against a plausible alternative explanation" : contract.stepLabel,
      suggestedVerb: embedsCompetingHypothesis ? "Assess" : contract.suggestedVerb,
    };
  });
  const orderedTasks = orderLinuxTasksByInvestigationStage(
    tasks,
    advancedSshKeyThirty ? "ssh_key_rebalance" : simulation.diversityProfile?.taskPath,
    advancedSshKeyThirty ? 0 : simulation.diversityProfile?.taskVariant
  );

  const proofs = orderedTasks.map((task) => {
    const selectedAssets = taskSelectionRegistry.filter((asset) => task.selectedEvidenceAssetIds.includes(asset.id));
    const requirementProofs = proveTaskRequirements(task, selectedAssets);
    const satisfiedBy = task.requiredCapabilities.map((capability) => {
      const supporting = taskSelectionRegistry.filter((asset) => task.selectedEvidenceAssetIds.includes(asset.id) && asset.capabilities.includes(capability));
      return {
        capability,
        assetIds: supporting.map((asset) => asset.id),
        canonicalObjectIds: Array.from(new Set(supporting.flatMap((asset) => asset.canonicalObjectIds))),
      };
    });
    const missingCapabilities = satisfiedBy.filter((item) => item.assetIds.length === 0).map((item) => item.capability);
    return {
      taskId: task.id,
      requiredCapabilities: task.requiredCapabilities,
      requirementProofs,
      contract: linuxTaskContract(task.intent).label,
      satisfiedBy,
      missingCapabilities,
      feasible: missingCapabilities.length === 0 && requirementProofs.every((proof) => proof.feasible) && (!advanced || task.selectedEvidenceAssetIds.length >= 2),
    };
  });
  return { tasks: orderedTasks, proofs };
}

export function assertLinuxTaskEvidenceClosureInvariant(
  simulation: LinuxSimulationWorld,
  renderedAssetPaths?: string[]
) {
  const renderedPaths = renderedAssetPaths
    ? new Set(renderedAssetPaths.map(normalizeLinuxEvidencePath))
    : undefined;
  const planningById = new Map(simulation.planningEvidenceRegistry.map((asset) => [asset.id, asset]));
  const issues: string[] = [];
  for (const task of simulation.canonicalTasks) {
    const selectedAssets = task.selectedEvidenceAssetIds
      .map((id) => planningById.get(id))
      .filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset));
    const missingIds = task.selectedEvidenceAssetIds.filter((id) => !planningById.has(id));
    if (missingIds.length > 0) {
      issues.push(`${task.id} selected evidence outside planning registry: ${missingIds.join(", ")}`);
      continue;
    }
    const closure = taskEvidenceClosureResult({
      simulation,
      intent: task.intent,
      difficulty: task.difficulty,
      requiredCapabilities: task.requiredCapabilities,
      currentStateRequirements: task.currentStateRequirements,
      requirements: task.requirements,
      registry: simulation.planningEvidenceRegistry,
      selected: selectedAssets,
      renderedPaths,
      limit: TASK_EVIDENCE_LIMIT,
      minimumEvidenceCount: task.difficulty === "Advanced" ? 2 : 1,
      candidateEvidenceConsidered: simulation.planningEvidenceRegistry.map((asset) => asset.path),
      rejectedCandidates: [],
    });
    if (!closure.satisfied) {
      issues.push(`${task.id} evidence closure failed: ${closure.selectionDiagnostics.map((item) => item.code).join(", ") || "unsatisfied closure"}`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`Linux task evidence closure invariant failed: ${issues.join("; ")}`);
  }
}

type BackgroundJobTemplate = {
  purpose: CanonicalCronDefinition["purpose"];
  command: string;
  schedule: string;
  scriptPath: string;
  sourcePath?: string;
  runAs: "root" | "service" | "app" | "admin";
  files: string[];
  services: string[];
  stdout: string;
  daemon: string;
  scriptBody: string[];
};

function backgroundTemplates(family: string, world: InvestigationWorld): BackgroundJobTemplate[] {
  const commonMonitoring: BackgroundJobTemplate = {
    purpose: "monitoring",
    command: "/usr/local/sbin/node-exporter-target-check.sh",
    schedule: "17 */4 * * *",
    scriptPath: "/usr/local/sbin/node-exporter-target-check.sh",
    runAs: "root",
    files: ["/var/lib/node-exporter/textfile_collector/target-check.prom"],
    services: ["node_exporter.service"],
    stdout: "node exporter target file refreshed",
    daemon: "node_exporter",
    scriptBody: ["set -euo pipefail", "systemctl is-active --quiet node_exporter.service", "printf 'node_target_check 1\\n' > /var/lib/node-exporter/textfile_collector/target-check.prom"],
  };
  const byFamily: Record<string, BackgroundJobTemplate[]> = {
    platform: [
      {
        purpose: "cleanup",
        command: "/usr/local/sbin/gitlab-runner-cache-prune.sh",
        schedule: "12 */3 * * *",
        scriptPath: "/usr/local/sbin/gitlab-runner-cache-prune.sh",
        runAs: "service",
        files: ["/var/lib/gitlab-runner/cache/prune.log"],
        services: ["gitlab-runner.service"],
        stdout: "runner cache prune completed",
        daemon: "gitlab-runner",
        scriptBody: ["set -euo pipefail", "find /var/lib/gitlab-runner/cache -type f -mtime +7 -delete", "systemctl is-active --quiet gitlab-runner.service"],
      },
      {
        purpose: "monitoring",
        command: "/usr/local/sbin/repository-fsck-sample.sh",
        schedule: "41 2 * * *",
        scriptPath: "/usr/local/sbin/repository-fsck-sample.sh",
        runAs: "service",
        files: ["/var/log/gitlab/repository-fsck.log"],
        services: ["gitaly.service"],
        stdout: "repository fsck sample clean",
        daemon: "gitaly",
        scriptBody: ["set -euo pipefail", "git -C /srv/git/repositories fsck --connectivity-only", "logger -t gitaly repository fsck sample clean"],
      },
    ],
    web: [
      {
        purpose: "certificate",
        command: "/usr/bin/certbot renew --quiet --deploy-hook /usr/bin/systemctl reload nginx.service",
        schedule: "19 3 * * *",
        scriptPath: "/usr/local/sbin/web-certificate-renewal.sh",
        runAs: "root",
        files: ["/etc/letsencrypt/renewal/portal.conf", "/var/log/letsencrypt/letsencrypt.log", "/lib/systemd/system/nginx.service"],
        services: ["certbot.service", "nginx.service"],
        stdout: "certificate renewal check completed",
        daemon: "certbot",
        scriptBody: ["set -euo pipefail", "certbot renew --quiet --deploy-hook '/usr/bin/systemctl reload nginx.service'", "logger -t certbot renewal check completed"],
      },
      {
        purpose: "web",
        command: "/usr/local/sbin/nginx-config-probe.sh",
        schedule: "7 */6 * * *",
        scriptPath: "/usr/local/sbin/nginx-config-probe.sh",
        runAs: "root",
        files: ["/var/log/nginx/config-probe.log"],
        services: ["nginx.service"],
        stdout: "nginx configuration probe passed",
        daemon: "nginx",
        scriptBody: ["set -euo pipefail", "nginx -t", "logger -t nginx configuration probe passed"],
      },
    ],
    backup: [
      {
        purpose: "backup",
        command: "/usr/local/sbin/restic-repository-check.sh",
        schedule: "33 1 * * *",
        scriptPath: "/usr/local/sbin/restic-repository-check.sh",
        runAs: "service",
        files: ["/var/log/backup/restic-check.log"],
        services: ["backup-agent.service"],
        stdout: "restic repository check completed",
        daemon: "backup-agent",
        scriptBody: ["set -euo pipefail", "restic check --read-data-subset=1/20", "logger -t backup-agent restic repository check completed"],
      },
      {
        purpose: "backup",
        command: "/usr/local/sbin/backup-retention-prune.sh",
        schedule: "5 4 * * 0",
        scriptPath: "/usr/local/sbin/backup-retention-prune.sh",
        runAs: "service",
        files: ["/var/log/backup/retention-prune.log"],
        services: ["backup-agent.service"],
        stdout: "backup retention prune completed",
        daemon: "restic",
        scriptBody: ["set -euo pipefail", "restic forget --keep-daily 14 --keep-weekly 8 --prune", "logger -t restic retention prune completed"],
      },
    ],
    container: [
      {
        purpose: "container",
        command: "/usr/local/sbin/container-image-gc.sh",
        schedule: "28 */4 * * *",
        scriptPath: "/usr/local/sbin/container-image-gc.sh",
        runAs: "root",
        files: ["/var/log/containerd/image-gc.log"],
        services: ["containerd.service"],
        stdout: "container image garbage collection completed",
        daemon: "containerd",
        scriptBody: ["set -euo pipefail", "crictl rmi --prune", "logger -t containerd image garbage collection completed"],
      },
      {
        purpose: "container",
        command: "/usr/local/sbin/kubelet-certificate-check.sh",
        schedule: "16 */8 * * *",
        scriptPath: "/usr/local/sbin/kubelet-certificate-check.sh",
        runAs: "root",
        files: ["/var/lib/kubelet/pki/kubelet-client-current.pem"],
        services: ["kubelet.service"],
        stdout: "kubelet certificate check completed",
        daemon: "kubelet",
        scriptBody: ["set -euo pipefail", "test -r /var/lib/kubelet/pki/kubelet-client-current.pem", "logger -t kubelet certificate check completed"],
      },
    ],
    dns: [
      {
        purpose: "other",
        command: "/usr/local/sbin/bind-zone-serial-check.sh",
        schedule: "9 */6 * * *",
        scriptPath: "/usr/local/sbin/bind-zone-serial-check.sh",
        runAs: "root",
        files: [`/var/cache/bind/${world.domain}.serial`],
        services: ["bind9.service"],
        stdout: "zone serial check completed",
        daemon: "named",
        scriptBody: ["set -euo pipefail", `named-checkzone ${world.domain} /etc/bind/db.${world.domain}`, "logger -t named zone serial check completed"],
      },
      commonMonitoring,
    ],
    mail: [
      {
        purpose: "mail",
        command: "/usr/local/sbin/postfix-queue-sample.sh",
        schedule: "*/30 * * * *",
        scriptPath: "/usr/local/sbin/postfix-queue-sample.sh",
        runAs: "root",
        files: ["/var/log/mail-queue-sample.log"],
        services: ["postfix.service"],
        stdout: "postfix queue sample completed",
        daemon: "postfix/qmgr",
        scriptBody: ["set -euo pipefail", "postqueue -p | head -40 > /var/log/mail-queue-sample.log", "logger -t postfix/qmgr queue sample completed"],
      },
      {
        purpose: "security",
        command: "/usr/local/sbin/opendkim-key-table-check.sh",
        schedule: "23 2 * * *",
        scriptPath: "/usr/local/sbin/opendkim-key-table-check.sh",
        runAs: "root",
        files: ["/etc/opendkim/key.table"],
        services: ["opendkim.service"],
        stdout: "DKIM key table check completed",
        daemon: "opendkim",
        scriptBody: ["set -euo pipefail", "test -r /etc/opendkim/key.table", "logger -t opendkim key table check completed"],
      },
    ],
    monitoring: [
      {
        purpose: "monitoring",
        command: "/usr/local/sbin/prometheus-rule-check.sh",
        schedule: "11 */2 * * *",
        scriptPath: "/usr/local/sbin/prometheus-rule-check.sh",
        runAs: "root",
        files: ["/etc/prometheus/rules/linux.yml"],
        services: ["prometheus.service"],
        stdout: "prometheus rule validation completed",
        daemon: "prometheus",
        scriptBody: ["set -euo pipefail", "promtool check rules /etc/prometheus/rules/linux.yml", "logger -t prometheus rule validation completed"],
      },
      commonMonitoring,
    ],
    database: [
      {
        purpose: "database",
        command: "/usr/local/sbin/postgres-replication-lag-check.sh",
        schedule: "*/15 * * * *",
        scriptPath: "/usr/local/sbin/postgres-replication-lag-check.sh",
        runAs: "service",
        files: ["/var/log/postgresql/replication-lag-check.log"],
        services: ["postgresql.service"],
        stdout: "replication lag check completed",
        daemon: "postgresql",
        scriptBody: ["set -euo pipefail", "psql -Atc 'select now()' >/var/log/postgresql/replication-lag-check.log", "logger -t postgresql replication lag check completed"],
      },
      {
        purpose: "database",
        command: "/usr/local/sbin/pgbackrest-repository-check.sh",
        schedule: "37 1 * * *",
        scriptPath: "/usr/local/sbin/pgbackrest-repository-check.sh",
        runAs: "service",
        files: ["/var/log/postgresql/pgbackrest-check.log"],
        services: ["pgbackrest.service"],
        stdout: "pgbackrest repository check completed",
        daemon: "pgbackrest",
        scriptBody: ["set -euo pipefail", "pgbackrest check", "logger -t pgbackrest repository check completed"],
      },
    ],
    access: [
      {
        purpose: "security",
        command: "/usr/local/sbin/bastion-session-audit.sh",
        schedule: "*/20 * * * *",
        scriptPath: "/usr/local/sbin/bastion-session-audit.sh",
        runAs: "root",
        files: ["/var/log/session-audit/current.log"],
        services: ["ssh.service"],
        stdout: "bastion session audit snapshot completed",
        daemon: "sshd",
        scriptBody: ["set -euo pipefail", "who > /var/log/session-audit/current.log", "logger -t sshd bastion session audit snapshot completed"],
      },
      commonMonitoring,
    ],
    general: [
      {
        purpose: "cleanup",
        command: "/usr/local/sbin/log-retention-cleanup.sh",
        schedule: "52 3 * * *",
        scriptPath: "/usr/local/sbin/log-retention-cleanup.sh",
        runAs: "root",
        files: ["/var/log/retention-cleanup.log"],
        services: ["rsyslog.service"],
        stdout: "log retention cleanup completed",
        daemon: "rsyslogd",
        scriptBody: ["set -euo pipefail", "find /var/log -type f -name '*.gz' -mtime +30 -delete", "logger -t rsyslogd log retention cleanup completed"],
      },
      commonMonitoring,
    ],
  };
  return byFamily[family] || byFamily.general;
}

function backgroundDensity(world: InvestigationWorld): CanonicalBackgroundProfile["activityDensity"] {
  const family = roleFamily(world.serverRole);
  if (["platform", "container", "database", "backup"].includes(family)) return "high";
  if (["web", "mail", "monitoring"].includes(family)) return "moderate";
  return "low";
}

function executionMinute(schedule: string) {
  const first = schedule.split(/\s+/)[0] || "17";
  if (first.startsWith("*/")) return Number(first.slice(2)) || 10;
  return Number(first.replace(/\D/g, "")) || 17;
}

function cronFieldMatches(field: string, value: number) {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    if (/^\d+$/.test(part)) return Number(part) === value;
    const step = part.match(/^(\*|\d+-\d+)\/(\d+)$/);
    if (step) {
      const interval = Number(step[2]);
      if (!interval) return false;
      if (step[1] === "*") return value % interval === 0;
      const [start, end] = step[1].split("-").map(Number);
      return value >= start && value <= end && (value - start) % interval === 0;
    }
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    return false;
  });
}

function executionHour(schedule: string) {
  const hour = schedule.trim().split(/\s+/)[1] || "*";
  if (hour === "*") return 0;
  const first = hour.split(",")[0];
  if (first.startsWith("*/")) return 0;
  if (/^\d+-\d+(?:\/\d+)?$/.test(first)) return Number(first.split("-")[0]);
  return Number(first.replace(/\D/g, "")) || 0;
}

function formatUtcTimestamp(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function scheduledOccurrenceAt(
  schedule: string,
  collectionTime: string,
  preferredWindow?: { start: string; end: string }
) {
  if (preferredWindow) {
    const start = parseTimestamp(preferredWindow.start);
    const end = Math.min(parseTimestamp(preferredWindow.end), parseTimestamp(collectionTime));
    for (let candidate = end; candidate >= start; candidate -= 60 * 1000) {
      const rendered = formatUtcTimestamp(new Date(candidate));
      if (scheduleMatchesTimestamp(schedule, rendered)) {
        return `${rendered.slice(0, 17)}10`;
      }
    }
  }
  const minute = executionMinute(schedule);
  const hour = executionHour(schedule);
  const collection = new Date(`${collectionTime.replace(" ", "T")}Z`);
  for (let daysBack = 0; daysBack < 14; daysBack += 1) {
    const candidate = new Date(Date.UTC(collection.getUTCFullYear(), collection.getUTCMonth(), collection.getUTCDate(), hour, minute, 10));
    candidate.setUTCDate(candidate.getUTCDate() - daysBack);
    const rendered = formatUtcTimestamp(candidate);
    if (candidate.getTime() <= collection.getTime() && scheduleMatchesTimestamp(schedule, rendered)) {
      return rendered;
    }
  }
  const fallback = new Date(Date.UTC(collection.getUTCFullYear(), collection.getUTCMonth(), collection.getUTCDate(), hour, minute, 10));
  fallback.setUTCDate(fallback.getUTCDate() - 1);
  return formatUtcTimestamp(fallback);
}

export function scheduleMatchesTimestamp(schedule: string, timestamp: string) {
  const minute = Number(timestamp.slice(14, 16));
  const hour = Number(timestamp.slice(11, 13));
  const day = Number(timestamp.slice(8, 10));
  const month = Number(timestamp.slice(5, 7));
  const dow = new Date(`${timestamp.slice(0, 10)}T00:00:00Z`).getUTCDay();
  const [minuteField = "*", hourField = "*", dayField = "*", monthField = "*", dowField = "*"] = schedule.trim().split(/\s+/);
  return cronFieldMatches(minuteField, minute) &&
    cronFieldMatches(hourField, hour) &&
    cronFieldMatches(dayField, day) &&
    cronFieldMatches(monthField, month) &&
    cronFieldMatches(dowField, dow);
}

export function validCronSchedule(schedule: string) {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((part) => part === "*" || /^\*\/\d+$/.test(part) || /^\d{1,2}$/.test(part) || /^\d{1,2}-\d{1,2}(?:\/\d+)?$/.test(part) || /^(?:\d{1,2},)+\d{1,2}$/.test(part));
}

export function canonicalModeString(file: CanonicalFile) {
  return modeString(file.mode, file.fileType);
}

export function canonicalAuditMode(file: CanonicalFile) {
  const prefix =
    file.fileType === "directory" ? "04" :
    file.fileType === "socket" ? "014" :
    file.fileType === "symlink" ? "012" :
    file.fileType === "device" ? "06" :
    "010";
  return `${prefix}${file.mode.toString(8).padStart(4, "0")}`;
}

function addIdentity(
  identities: Map<string, CanonicalIdentity>,
  groups: Map<string, CanonicalGroup>,
  username: string,
  uid: number,
  gid: number
) {
  const id = identityId(username);
  const primaryGroupId = groupId(username);
  if (!groups.has(primaryGroupId)) groups.set(primaryGroupId, { id: primaryGroupId, name: username, gid });
  if (!identities.has(id)) {
    identities.set(id, { id, username, uid, gid, primaryGroupId });
  }
  return identities.get(id)!;
}

function fallbackSystemAccountIds(username: string) {
  const known: Record<string, number> = {
    "www-data": 33,
    git: 995,
    "gitlab-runner": 997,
    postgres: 26,
    bind: 53,
    postfix: 89,
    prometheus: 996,
  };
  if (known[username] !== undefined) return { uid: known[username], gid: known[username] };
  let hash = 0;
  for (const char of username) hash = (hash * 31 + char.charCodeAt(0)) % 700;
  const id = 200 + hash;
  return { uid: id, gid: id };
}

function builderInput(args: BuildArgs): LinuxAssetInput {
  return {
    input: { category: "Linux", difficulty: args.difficulty, duration: "30 mins", title: "CyberLab Asset Pack" },
    world: args.world,
    incident: args.incident,
    investigation: args.investigation,
    simulation: undefined as unknown as LinuxSimulationWorld,
    intermediate: args.difficulty === "Intermediate",
    advanced: args.difficulty === "Advanced",
    testOverrides: args.testOverrides,
  };
}

function identityForUser(
  args: BuildArgs,
  identities: Map<string, CanonicalIdentity>,
  groups: Map<string, CanonicalGroup>,
  username: string
) {
  const account = identityFor(builderInput(args), username);
  const fallback = fallbackSystemAccountIds(username);
  const primaryOverride =
    args.testOverrides?.primaryUsername === username
      ? {
          uid: args.testOverrides.uid,
          gid: args.testOverrides.gid,
        }
      : {};
  return addIdentity(
    identities,
    groups,
    username,
    primaryOverride.uid || account?.uid || fallback.uid,
    primaryOverride.gid || account?.gid || account?.uid || fallback.gid
  );
}

function cronRunAsIdentity(
  args: BuildArgs,
  identities: Map<string, CanonicalIdentity>,
  groups: Map<string, CanonicalGroup>,
  template: BackgroundJobTemplate
) {
  const { world } = args;
  const username =
    template.runAs === "root" ? "root" :
    template.runAs === "service" ? world.serviceUser :
    template.runAs === "app" ? world.appUser :
    world.adminUser;
  return username === "root"
    ? identities.get(identityId("root")) || addIdentity(identities, groups, "root", 0, 0)
    : identityForUser(args, identities, groups, username);
}

function roleRuntimeProcessSpecs(world: InvestigationWorld): Array<{ user: string; pid: number; ppid: number; command: string }> {
  const role = world.serverRole.toLowerCase();
  if (role.includes("web") || role.includes("application")) {
    return [
      { user: "root", pid: 1210, ppid: 1, command: "/usr/sbin/apache2 -k start" },
      { user: "www-data", pid: 1216, ppid: 1210, command: "/usr/sbin/apache2 -k start" },
      { user: "www-data", pid: 1217, ppid: 1210, command: "/usr/sbin/apache2 -k start" },
    ];
  }
  if (role.includes("backup")) {
    return [
      { user: world.serviceUser, pid: 1511, ppid: 1, command: "/usr/local/bin/backup-agent --config /etc/backup-agent.yml" },
      { user: world.serviceUser, pid: 1518, ppid: 1511, command: "/usr/bin/rsync --daemon --config=/etc/rsyncd.conf" },
    ];
  }
  if (role.includes("ci") || role.includes("git")) {
    return [
      { user: "git", pid: 1170, ppid: 1, command: "/usr/bin/gitaly /etc/gitlab/gitaly/config.toml" },
      { user: "gitlab-runner", pid: 1184, ppid: 1, command: "/usr/bin/gitlab-runner run --working-directory /var/lib/gitlab-runner" },
    ];
  }
  if (role.includes("docker") || role.includes("container") || role.includes("kubernetes")) {
    return [
      { user: "root", pid: 1201, ppid: 1, command: "/usr/bin/containerd" },
      { user: "root", pid: 1220, ppid: 1, command: "/usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:2375 --containerd=/run/containerd/containerd.sock" },
      { user: "root", pid: 1260, ppid: 1, command: "/usr/bin/kubelet --config=/var/lib/kubelet/config.yaml" },
    ];
  }
  if (role.includes("database")) {
    return [
      { user: "postgres", pid: 1035, ppid: 1, command: "/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main" },
      { user: "postgres", pid: 1040, ppid: 1035, command: "postgres: 16/main: checkpointer" },
      { user: "postgres", pid: 1041, ppid: 1035, command: "postgres: 16/main: background writer" },
      { user: "postgres", pid: 1088, ppid: 1035, command: "/usr/sbin/pgbouncer /etc/pgbouncer/pgbouncer.ini" },
    ];
  }
  if (role.includes("dns")) return [{ user: "bind", pid: 1064, ppid: 1, command: "/usr/sbin/named -f -u bind" }];
  if (role.includes("mail")) {
    return [
      { user: "root", pid: 1032, ppid: 1, command: "/usr/lib/postfix/sbin/master -w" },
      { user: "postfix", pid: 1041, ppid: 1032, command: "qmgr -l -t unix -u" },
    ];
  }
  if (role.includes("monitoring")) {
    return [
      { user: "prometheus", pid: 1102, ppid: 1, command: "/usr/bin/prometheus --config.file=/etc/prometheus/prometheus.yml" },
    ];
  }
  return [];
}

export function buildLinuxSimulationWorld(args: BuildArgs): LinuxSimulationWorld {
  const { world, incident, investigation, difficulty, seed } = args;
  const diversityProfile = buildLinuxDiversityProfile({ world, incidentFamily: incident.id, difficulty });
  const identities = new Map<string, CanonicalIdentity>();
  const groups = new Map<string, CanonicalGroup>();
  const root = addIdentity(identities, groups, "root", 0, 0);
  const interactive = !["reverse_shell", "docker_compromise"].includes(incident.id);
  const actorName = !interactive || ["ssh_bruteforce", "ssh_key_compromise"].includes(incident.id)
    ? world.analystUser
    : incident.primaryUser;
  const actor = identityForUser(args, identities, groups, actorName);
  const sessionUser = identityForUser(args, identities, groups, interactive ? actorName : incident.primaryUser);
  const analyst = identityForUser(args, identities, groups, world.analystUser);
  identityForUser(args, identities, groups, incident.primaryUser);
  identityForUser(args, identities, groups, world.serviceUser);
  identityForUser(args, identities, groups, world.appUser);

  const baseTime = { incidentDate: investigation.incidentDate, incidentTime: investigation.incidentTime, timezone: investigation.timezone };
  const localDayTimestamp = (clock: string) => linuxLocalCaseTimeToUtcTimestamp({ incidentDate: investigation.incidentDate, timezone: investigation.timezone }, clock);
  const openedAt = incidentTimestamp(baseTime, diversityProfile.timelineOffsets.auth);
  const closedAt = timestampPlusSeconds(
    incidentTimestamp(baseTime, diversityProfile.windowMinutes * 60),
    20 + (diversityProfile.taskVariant % 41)
  );
  const collectedAt = args.testOverrides?.collectionTime?.replace("T", " ") || incidentTimestamp(baseTime, (diversityProfile.windowMinutes + 3) * 60);
  const collection: CanonicalCollectionState = {
    collectedAt,
    windowStart: incidentTimestamp(baseTime, 0),
    windowEnd: incidentTimestamp(baseTime, diversityProfile.windowMinutes * 60),
    earliestAllowedEvent: localDayTimestamp("00:00:00"),
    latestAllowedEvent: collectedAt,
  };

  const session: CanonicalSshSession = {
    id: "session:ssh:incident-primary",
    identityId: interactive ? sessionUser.id : analyst.id,
    username: interactive ? sessionUser.username : analyst.username,
    uid: interactive ? sessionUser.uid : analyst.uid,
    gid: interactive ? sessionUser.gid : analyst.gid,
    sourceIp: interactive ? incident.suspiciousIp : world.adminIp,
    sourcePort: interactive ? 51891 : 51400,
    destinationPort: 22,
    authenticationMethod: incident.id === "ssh_bruteforce" ? "password" : "publickey",
    keyFingerprint: incident.id === "ssh_key_compromise"
      ? deterministicFingerprint("ssh-ed25519", `${world.caseId}:${incident.primaryUser}:primary`)
      : undefined,
    tty: diversityProfile.tty,
    monitorPid: 812,
    sessionPid: interactive ? 2136 : 2058,
    shellPid: interactive ? 2201 : incident.id === "reverse_shell" ? 1218 : 2221,
    openedAt,
    closedAt,
    purpose: "incident",
  };
  const sessionIdentity = identityForUser(args, identities, groups, session.username);
  const authenticationOrigin: CanonicalAuthenticationOrigin = {
    id: `auth-origin:ssh:${session.id.replace(/^session:ssh:/, "")}`,
    kind: "ssh",
    identityId: sessionIdentity.id,
    sessionId: session.id,
    sourceIp: session.sourceIp,
    sourcePort: session.sourcePort,
    destinationPort: session.destinationPort,
    authenticationMethod: session.authenticationMethod,
    keyFingerprint: session.keyFingerprint,
    authenticatedAt: session.openedAt,
  };

  const files = new Map<string, CanonicalFile>();
  const addFile = (path: string, commandId: string, owner = actor) => {
    const id = `file:${path.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "root"}`;
    const shouldRecordCommand = !commandId.startsWith("command:system:");
    const existing = files.get(id);
    if (existing) {
      if (shouldRecordCommand && !existing.relatedCommandIds.includes(commandId)) existing.relatedCommandIds.push(commandId);
      return existing;
    }
    const role = fileRole(path);
    const type = fileType(path);
    const fileOwner = path.startsWith("/etc/") || path.startsWith("/usr/") || path.startsWith("/lib/") || path.startsWith("/var/log/") || path.startsWith("/var/run/") || path.startsWith("/run/") || path.startsWith("/var/lib/docker")
      ? root
      : owner;
    const groupName =
      path === "/var/run/docker.sock" ? "docker" :
      path.startsWith("/var/log/") ? "adm" :
      fileOwner.username;
    const group = groups.get(groupId(groupName)) || {
      id: groupId(groupName),
      name: groupName,
      gid:
        groupName === "adm" ? 4 :
        groupName === "docker" ? 998 :
        groupName === "analysts" ? 1001 :
        fileOwner.gid,
    };
    groups.set(group.id, group);
    const file: CanonicalFile = {
      id,
      path,
      fileType: type,
      ownerIdentityId: fileOwner.id,
      ownerUid: fileOwner.uid,
      groupId: group.id,
      groupGid: group.gid,
      mode: fileMode(path, role),
      inode: 42000 + files.size * 17,
      size: type === "directory" ? 4096 : 2048 + files.size * 137,
      modifiedAt: incidentTimestamp(baseTime, 42 + files.size),
      contentRole: type === "directory" ? "background" : role,
      relatedCommandIds: shouldRecordCommand ? [commandId] : [],
    };
    files.set(id, file);
    return file;
  };

  const executions: CanonicalExecution[] = [];
  const processes: CanonicalProcess[] = [];
  const commands: CanonicalCommand[] = [];
  const events: CanonicalSimulationEvent[] = [];
  const lifecycleRegistry: CanonicalLifecycleRegistry = { records: [], rolledBack: [] };
  const lifecycleCollections = { executions, commands, processes, lifecycleRegistry };
  const commandBasePid = incident.id === "reverse_shell" ? 2204 : incident.id === "docker_compromise" ? 2223 : 2204;
  const shellPid = session.shellPid || 2201;

  const addProcess = (process: Omit<CanonicalProcess, "childProcessIds">): CanonicalProcess => {
    const executionId = process.executionId || `execution:legacy:${process.id.replace(/^process:/, "")}`;
    const full = { ...process, executionId, lifecycleOrigin: process.lifecycleOrigin || "legacy_derived", childProcessIds: [] };
    processes.push(full);
    executions.push({
      id: executionId,
      constructionOrigin: full.lifecycleOrigin === "system_origin" ? "system_origin" : "legacy_derived",
      identityId: full.identityId,
      effectiveIdentityId: full.identityId,
      sessionId: full.sessionId,
      commandId: full.commandId,
      processId: full.id,
      parentProcessId: full.ppid === 0 || full.ppid === 1 ? undefined : processes.find((item) => item.pid === full.ppid)?.id,
      cwd: full.cwd,
      hostname: investigation.hostname,
      startTime: full.startedAt,
      endTime: full.endedAt,
      reason: full.lifecycleOrigin === "system_origin" ? "daemon_startup" : "maintenance",
      privilegeLevel: full.effectiveUid === 0 ? "root" : "user",
      openedFileIds: [...full.openFileIds],
      affectedServiceIds: [],
      serviceTransitionIds: [],
      packageTransactionIds: [],
      maintenanceActivityIds: [],
      processPolicy: full.lifecycleOrigin === "system_origin" ? "system_process" : "create_process",
      outcome: "unknown",
    });
    return full;
  };

  createExecutionLifecycle({
    intentId: "intent:system:sshd-monitor",
    executionId: "execution:system:sshd-monitor",
    hostname: investigation.hostname,
    actorIdentity: root,
    effectiveIdentity: root,
    parentPid: 1,
    processId: "process:sshd:monitor",
    pid: session.monitorPid,
    executable: "/usr/sbin/sshd",
    argv: ["/usr/sbin/sshd", "-D"],
    cwd: "/",
    startTime: localDayTimestamp("00:00:00"),
    reason: "daemon_startup",
    privilegeLevel: "root",
    processPolicy: "system_process",
    constructionOrigin: "system_origin",
  }, lifecycleCollections);
  createExecutionLifecycle({
    intentId: "intent:ssh:incident-session",
    executionId: "execution:ssh:incident-session",
    hostname: investigation.hostname,
    actorIdentity: sessionIdentity,
    effectiveIdentity: sessionIdentity,
    sessionId: session.id,
    parentPid: session.monitorPid,
    processId: "process:ssh:incident-session",
    pid: session.sessionPid,
    executable: "/usr/sbin/sshd",
    argv: ["sshd:", session.username],
    cwd: homeDirectoryFor(builderInput(args), session.username),
    tty: session.tty,
    startTime: session.openedAt,
    endTime: session.closedAt,
    reason: "ssh_session",
    privilegeLevel: sessionIdentity.uid === 0 ? "root" : "user",
    processPolicy: "system_process",
    identityOrigin: "authenticated_session",
    authenticationOriginId: authenticationOrigin.id,
  }, lifecycleCollections);
  createExecutionLifecycle({
    intentId: "intent:shell:incident",
    executionId: "execution:shell:incident",
    hostname: investigation.hostname,
    actorIdentity: actor,
    effectiveIdentity: actor,
    sessionId: session.id,
    parentPid: session.sessionPid,
    processId: "process:incident:shell",
    pid: shellPid,
    executable: "/bin/bash",
    argv: ["/bin/bash"],
    cwd: homeDirectoryFor(builderInput(args), actor.username),
    tty: session.tty,
    startTime: incidentTimestamp(baseTime, Math.min(diversityProfile.timelineOffsets.auth + 1, diversityProfile.timelineOffsets.commands[0] - 3)),
    endTime: session.closedAt,
    reason: "interactive_shell",
    privilegeLevel: actor.uid === 0 ? "root" : "user",
    processPolicy: "system_process",
    identityOrigin: "authenticated_session",
    authenticationOriginId: authenticationOrigin.id,
  }, lifecycleCollections);
  createExecutionLifecycle({
    intentId: "intent:shell-hosted:pwd",
    executionId: "execution:shell-hosted:pwd",
    hostname: investigation.hostname,
    actorIdentity: actor,
    effectiveIdentity: actor,
    sessionId: session.id,
    parentPid: shellPid,
    commandId: "command:shell-hosted:pwd",
    processId: "process:shell-hosted:pwd-not-created",
    pid: shellPid,
    commandKind: "supporting",
    renderedCommand: "pwd",
    executable: "pwd",
    argv: ["pwd"],
    cwd: homeDirectoryFor(builderInput(args), actor.username),
    tty: session.tty,
    startTime: incidentTimestamp(baseTime, Math.min(diversityProfile.timelineOffsets.auth + 2, diversityProfile.timelineOffsets.commands[0] - 2)),
    endTime: incidentTimestamp(baseTime, Math.min(diversityProfile.timelineOffsets.auth + 2, diversityProfile.timelineOffsets.commands[0] - 2)),
    reason: "interactive_command",
    privilegeLevel: actor.uid === 0 ? "root" : "user",
    processPolicy: "no_child_process",
    outcome: "success",
    exitCode: 0,
    expectedRenderTargets: [],
    identityOrigin: "inherited",
    authenticationOriginId: authenticationOrigin.id,
  }, lifecycleCollections);
  createExecutionLifecycle({
    intentId: "intent:shell-hosted:command-not-found",
    executionId: "execution:shell-hosted:command-not-found",
    hostname: investigation.hostname,
    actorIdentity: actor,
    effectiveIdentity: actor,
    sessionId: session.id,
    parentPid: shellPid,
    commandId: "command:shell-hosted:command-not-found",
    processId: "process:shell-hosted:command-not-found-not-created",
    pid: shellPid,
    commandKind: "supporting",
    renderedCommand: diversityProfile.supportingProbe,
    executable: diversityProfile.supportingProbe,
    argv: [diversityProfile.supportingProbe],
    cwd: homeDirectoryFor(builderInput(args), actor.username),
    tty: session.tty,
    startTime: incidentTimestamp(baseTime, Math.min(diversityProfile.timelineOffsets.auth + 3, diversityProfile.timelineOffsets.commands[0] - 1)),
    endTime: incidentTimestamp(baseTime, Math.min(diversityProfile.timelineOffsets.auth + 3, diversityProfile.timelineOffsets.commands[0] - 1)),
    reason: "interactive_command",
    privilegeLevel: actor.uid === 0 ? "root" : "user",
    processPolicy: "no_child_process",
    outcome: "failure",
    exitCode: 127,
    expectedRenderTargets: [],
    identityOrigin: "inherited",
    authenticationOriginId: authenticationOrigin.id,
  }, lifecycleCollections);

  const incidentSessions = [session];
  const incidentAuthenticationOrigins = [authenticationOrigin];
  // Reconnecting the same authenticated account creates a genuinely different
  // attribution graph: each command must join its own session, shell and AUID.
  // Non-interactive incident families keep their existing service ancestry.
  const additionalSessions = interactive ? Math.min(investigation.suspiciousCommands.length - 1, diversityProfile.evidenceVariant % 3) : 0;
  for (let index = 0; index < additionalSessions; index += 1) {
    const slot = index + 1;
    const next: CanonicalSshSession = {
      ...session,
      id: `session:ssh:incident-reconnect-${slot}`,
      sourcePort: session.sourcePort + slot * 17,
      tty: `pts/${12 + slot}`,
      sessionPid: 8700 + slot * 10,
      shellPid: 8701 + slot * 10,
      openedAt: incidentTimestamp(baseTime, diversityProfile.timelineOffsets.commands[slot] - 7),
    };
    const origin: CanonicalAuthenticationOrigin = {
      ...authenticationOrigin,
      id: `auth-origin:ssh:${next.id.replace(/^session:ssh:/, "")}`,
      sessionId: next.id,
      sourcePort: next.sourcePort,
      authenticatedAt: next.openedAt,
    };
    incidentSessions.push(next);
    incidentAuthenticationOrigins.push(origin);
    for (const shell of [false, true]) {
      createExecutionLifecycle({
        intentId: `intent:reconnect:${slot}:${shell ? "shell" : "ssh"}`,
        executionId: `execution:reconnect:${slot}:${shell ? "shell" : "ssh"}`,
        hostname: investigation.hostname,
        actorIdentity: sessionIdentity,
        effectiveIdentity: sessionIdentity,
        sessionId: next.id,
        parentPid: shell ? next.sessionPid : next.monitorPid,
        processId: `process:reconnect:${slot}:${shell ? "shell" : "ssh"}`,
        pid: shell ? next.shellPid! : next.sessionPid,
        executable: shell ? "/bin/bash" : "/usr/sbin/sshd",
        argv: shell ? ["/bin/bash"] : ["sshd:", next.username],
        cwd: homeDirectoryFor(builderInput(args), next.username),
        tty: next.tty,
        startTime: timestampPlusSeconds(next.openedAt, shell ? 1 : 0),
        endTime: next.closedAt,
        reason: shell ? "interactive_shell" : "ssh_session",
        privilegeLevel: "user",
        processPolicy: "system_process",
        identityOrigin: "authenticated_session",
        authenticationOriginId: origin.id,
      }, lifecycleCollections);
    }
    events.push({
      id: `event:ssh:reconnect:${slot}:open`, timestamp: next.openedAt,
      kind: "ssh_session_open", summary: `SSH session opened for ${next.username}`, sessionId: next.id,
    });
  }
  const identityTransitions: CanonicalIdentityTransition[] = [];
  const usedIncidentCommandSlugs = new Set<string>();
  investigation.suspiciousCommands.forEach((rawCommand, index) => {
    const session = incidentSessions[Math.min(index, incidentSessions.length - 1)];
    const shellPid = session.shellPid!;
    const authenticationOrigin = incidentAuthenticationOrigins.find((origin) => origin.sessionId === session.id)!;
    const commandCwd = homeDirectoryFor(builderInput(args), actor.username);
    const resolvedCommand = resolveLinuxShellCommand(rawCommand, {
      invokingHomeDirectory: commandCwd,
      workingDirectory: commandCwd,
    });
    const renderedCommand = resolvedCommand.renderedCommand;
    const baseSlug = commandSlug(rawCommand, index);
    const slug = usedIncidentCommandSlugs.has(baseSlug) ? `${baseSlug}-${index + 1}` : baseSlug;
    usedIncidentCommandSlugs.add(slug);
    const timestamp = incidentTimestamp(
      baseTime,
      diversityProfile.timelineOffsets.commands[index] ||
        diversityProfile.timelineOffsets.commands.at(-1)! + (index - diversityProfile.timelineOffsets.commands.length + 1) * 17
    );
    const sudoPid = commandBasePid + index * 10 - 1;
    const processId = commandBasePid + index * 10;
    const executable = resolvedCommand.canonicalExecutable;
    const affectedFiles = commandFiles(renderedCommand, investigation.modifiedFiles[Math.min(index, investigation.modifiedFiles.length - 1)] || investigation.modifiedFiles[0]);
    const commandId = `command:incident:${slug}`;
    const canonicalFiles = affectedFiles.map((path) => addFile(path, commandId));
    const sudoersFile = addFile("/etc/sudoers.d/platform", commandId, root);
    const affectedFileIds = canonicalFiles.map((file) => file.id);
    const affectedServiceIds = renderedCommand.includes("systemctl") ? [serviceId(commandSystemdUnit({ renderedCommand } as CanonicalCommand) || canonicalPrimaryServiceUnit(incident))] : [];
    const privilegedExecutionId = `execution:incident:command:${slug}`;
    const sudoRuleId = "sudo-rule:platform";
    const identityTransitionId = sudoIdentityTransitionId(privilegedExecutionId);
    const lifecycleKind = commandLifecycleKind(renderedCommand);
    const endedAt = timestampPlusSeconds(timestamp, commandDurationSeconds(renderedCommand));
    const createdPaths = commandCreatedPaths(renderedCommand);
    for (const file of canonicalFiles) {
      if (file.modifiedAt < timestamp) {
        file.modifiedAt = timestampPlusSeconds(timestamp, 1);
      }
      if (createdPaths.has(file.path) && !renderedCommand.includes("authorized_keys")) {
        file.ownerIdentityId = root.id;
        file.ownerUid = root.uid;
        file.groupId = root.primaryGroupId;
        file.groupGid = root.gid;
        file.createdAt = timestamp;
      }
    }
    createExecutionLifecycle({
      intentId: `intent:incident:sudo:${slug}`,
      executionId: `execution:incident:sudo:${slug}`,
      hostname: investigation.hostname,
      actorIdentity: actor,
      effectiveIdentity: root,
      sessionId: session.id,
      parentPid: shellPid,
      processId: `process:incident:sudo:${slug}`,
      pid: sudoPid,
      executable: "/usr/bin/sudo",
      argv: ["sudo", ...resolvedCommand.shellExpandedArgv],
      cwd: commandCwd,
      tty: session.tty,
      startTime: timestamp,
      endTime: endedAt,
      lifecycleKind: "short_lived",
      reason: "privilege_escalation",
      privilegeLevel: "root",
      processPolicy: "create_process",
      affectedFileIds: [sudoersFile.id],
      outcome: "success",
      exitCode: 0,
    }, lifecycleCollections);
    const identityTransition: CanonicalIdentityTransition = {
      id: identityTransitionId,
      kind: "sudo",
      actorIdentityId: actor.id,
      targetIdentityId: root.id,
      sessionId: session.id,
      sudoRuleId,
      sudoProcessId: sudoPid,
      commandId,
      executionId: privilegedExecutionId,
      requestedAt: timestamp,
      completedAt: timestamp,
      outcome: "success",
    };
    identityTransitions.push(identityTransition);
    const lifecycle = createExecutionLifecycle({
      intentId: `intent:incident:command:${slug}`,
      executionId: privilegedExecutionId,
      hostname: investigation.hostname,
      actorIdentity: actor,
      effectiveIdentity: root,
      sessionId: session.id,
      parentPid: sudoPid,
      commandId,
      processId: `process:incident:${slug}`,
      pid: processId,
      commandKind: index === 0 ? "primary_incident" : "secondary_incident",
      renderedCommand,
      executable,
      argv: [resolvedCommand.canonicalExecutable, ...resolvedCommand.shellExpandedArgv.slice(1)],
      cwd: commandCwd,
      tty: session.tty,
      startTime: timestamp,
      endTime: endedAt,
      lifecycleKind,
      reason: renderedCommand.includes("systemctl") ? "service_action" : "privilege_escalation",
      privilegeLevel: "root",
      processPolicy: "create_process",
      affectedFileIds,
      affectedServiceIds,
      expectedRenderTargets: ["sudo", "audit", "timeline", "process", "open_files"],
      sudoRuleId,
      sudoProcessId: sudoPid,
      shellProcessId: shellPid,
      identityOrigin: "privilege_transition",
      authenticationOriginId: authenticationOrigin.id,
      identityTransitionId,
      outcome: "success",
      exitCode: 0,
    }, lifecycleCollections);
    const command = lifecycle.command!;
    events.push({
      id: `event:command:${slug}:exec`,
      timestamp,
      kind: "command_exec",
      summary: renderedCommand,
      commandId: command.id,
      sessionId: session.id,
      fileId: command.affectedFileIds[0],
    });
  });

  events.push({
    id: "event:ssh:incident-primary:open",
    timestamp: session.openedAt,
    kind: "ssh_session_open",
    summary: `SSH session opened for ${session.username}`,
    sessionId: session.id,
  });
  if (session.closedAt && session.closedAt <= collection.windowEnd) {
    events.push({
      id: "event:ssh:incident-primary:close",
      timestamp: session.closedAt || collectedAt,
      kind: "ssh_session_close",
      summary: `SSH session closed for ${session.username}`,
      sessionId: session.id,
    });
  }

  const services = new Map<string, CanonicalService>();
  const timers: CanonicalSystemdTimer[] = [];
  const addService = (
    unitName: string,
    options: Partial<CanonicalService> = {}
  ) => {
    const id = serviceId(unitName);
    const existing = services.get(id);
    if (existing) {
      existing.role = promoteServiceRole(existing.role, inferCanonicalServiceRole(unitName, incident, options.role));
      return existing;
    }
    const unitType = options.unitType || serviceUnitType(unitName);
    const activeState = options.activeState || (unitType === "timer" ? "active" : "active");
    const subState = options.subState || activeSubState(unitName, activeState);
    const unitPresent = options.unitPresent !== false;
    const unitFileState = options.unitFileState || (unitType === "timer" ? "enabled" : "enabled");
    const service: CanonicalService = {
      id,
      unitName,
      role: inferCanonicalServiceRole(unitName, incident, options.role),
      description: options.description || `${unitName} on ${world.serverRole}`,
      unitPresent,
      loadState: serviceLoadedState({ ...options, unitFileState, unitPresent }),
      unitType,
      unitPath: options.unitPath || serviceUnitPath(unitName, unitName === "metrics-cache.service"),
      unitFileState,
      activeState,
      subState,
      result: options.result || defaultServiceResult(activeState, subState),
      serviceType: options.serviceType || serviceTypeForUnit(unitName),
      mainProcessId: options.mainProcessId,
      execStart: options.execStart || (unitType === "timer" ? undefined : `/usr/sbin/${serviceProcessToken(unitName)}`),
      lastTransitionAt: options.lastTransitionAt,
      ownerTeam: options.ownerTeam || world.department,
      packageName: options.packageName === undefined ? packageForUnit(unitName) : options.packageName,
      localOverrideFileId: options.localOverrideFileId,
      relatedTimerId: options.relatedTimerId,
    };
    services.set(id, service);
    return service;
  };

  addService("ssh.service", { description: "remote access service", mainProcessId: "process:sshd:monitor" });
  addService("cron.service", { description: "scheduled jobs" });
  addService("ufw.service", {
    description: "host firewall",
    activeState: incident.id === "reverse_shell" ? "inactive" : "active",
    unitFileState: "enabled",
  });
  addService("rsyslog.service", { description: "system log collection" });
  addService("auditd.service", { description: "audit collection" });
  for (const unit of roleServiceUnits(world.serverRole, incident.affectedService)) addService(unit);
  if (incident.id === "unauthorized_package_install") {
    addService("apt-daily.service", { role: "primary", unitType: "oneshot", unitFileState: "static", activeState: "inactive", subState: "dead", description: "APT download service" });
    const aptTimer = addService("apt-daily.timer", { unitType: "timer", activeState: "active", subState: "waiting", description: "APT download schedule" });
    addService("apt-daily-upgrade.service", { unitType: "oneshot", unitFileState: "static", activeState: "inactive", subState: "dead", description: "APT upgrade service" });
    const upgradeTimer = addService("apt-daily-upgrade.timer", { unitType: "timer", activeState: "active", subState: "waiting", description: "APT upgrade schedule" });
    timers.push(
      {
        id: "timer:apt-daily",
        timerUnitName: aptTimer.unitName,
        serviceId: serviceId("apt-daily.service"),
        calendarExpression: "*-*-* 06,18:00",
        activeState: "active",
        subState: "waiting",
        lastTriggerAt: localDayTimestamp("00:05:00"),
        nextTriggerAt: localDayTimestamp("18:00:00"),
      },
      {
        id: "timer:apt-daily-upgrade",
        timerUnitName: upgradeTimer.unitName,
        serviceId: serviceId("apt-daily-upgrade.service"),
        calendarExpression: "*-*-* 06:00",
        activeState: "active",
        subState: "waiting",
        lastTriggerAt: localDayTimestamp("00:06:00"),
        nextTriggerAt: localDayTimestamp("18:45:00"),
      }
    );
  } else {
    addService(incident.affectedService, {
      role: "primary",
      description: "service relevant to current investigation scope",
      unitPath: serviceUnitPath(incident.affectedService, incident.affectedService === "metrics-cache.service"),
      packageName: incident.affectedService === "metrics-cache.service" ? undefined : packageForUnit(incident.affectedService),
    });
  }
  if (!services.has(serviceId("apt-daily.service"))) {
    addService("apt-daily.service", { role: "background", unitType: "oneshot", unitFileState: "static", activeState: "inactive", subState: "dead", description: "APT download service" });
    const aptTimer = addService("apt-daily.timer", { unitType: "timer", activeState: "active", subState: "waiting", description: "APT download schedule" });
    timers.push({
      id: "timer:apt-daily",
      timerUnitName: aptTimer.unitName,
      serviceId: serviceId("apt-daily.service"),
      calendarExpression: "*-*-* 06,18:00",
      activeState: "active",
      subState: "waiting",
      lastTriggerAt: localDayTimestamp("00:05:00"),
      nextTriggerAt: localDayTimestamp("18:00:00"),
    });
  }
  for (const unit of ["logrotate.service", "logrotate.timer", "certbot.timer"]) {
    const unitType = serviceUnitType(unit);
    addService(unit, {
      role: "background",
      unitType,
      unitFileState: unitType === "timer" ? "enabled" : "static",
      activeState: unitType === "timer" ? "active" : "inactive",
      subState: unitType === "timer" ? "waiting" : "dead",
      description: unit.endsWith(".timer") ? "systemd timer" : "timer-triggered oneshot service",
    });
  }
  for (const service of services.values()) {
    const spec = serviceListenerSpec(service.unitName);
    if (
      !spec ||
      service.unitName === "ssh.service" ||
      service.activeState !== "active" ||
      service.subState !== "running" ||
      service.mainProcessId
    ) {
      continue;
    }
    const pid = processes.some((process) => process.pid === spec.pid) ? spec.pid + services.size : spec.pid;
    const serviceUser = serviceProcessUser(service.unitName, world);
    const serviceIdentity = serviceUser === "root" ? root : identityForUser(args, identities, groups, serviceUser);
    const process = addProcess({
      id: `process:service:${service.unitName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`,
      pid,
      ppid: 1,
      executable: spec.executable,
      argv: spec.argv || [spec.executable],
      identityId: serviceIdentity.id,
      realUid: serviceIdentity.uid,
      effectiveUid: serviceIdentity.uid,
      realGid: serviceIdentity.gid,
      effectiveGid: serviceIdentity.gid,
      cwd: "/",
      startedAt: localDayTimestamp("00:00:00"),
      lifecycleKind: "daemon",
      lifecycleOrigin: "system_origin",
      openFileIds: [],
    });
    service.mainProcessId = process.id;
    service.execStart = spec.argv?.join(" ") || spec.executable;
  }

  const serviceTransitions: CanonicalServiceTransition[] = [];
  const addTransition = (
    service: CanonicalService,
    operation: CanonicalServiceTransition["operation"],
    cause: CanonicalServiceTransition["cause"],
    occurredAt: string,
    result: Partial<CanonicalServiceTransition["resultingState"]> = {},
    processId?: string,
    outcome: CanonicalServiceTransition["outcome"] = "success"
  ) => {
    const previousState = {
      unitPresent: service.unitPresent,
      loadState: service.loadState,
      unitFileState: service.unitFileState,
      activeState: service.activeState,
      subState: service.subState,
      result: service.result,
      mainProcessId: service.mainProcessId,
    };
    const nextActiveState = (result.activeState || service.activeState) as CanonicalService["activeState"];
    const nextSubState = result.subState || service.subState;
    const nextResult = (result.result || (
      outcome === "failure"
        ? "exit-code"
        : operation === "stop"
          ? "none"
          : defaultServiceResult(nextActiveState, nextSubState)
    )) as CanonicalService["result"];
    const resultingState = {
      unitPresent: result.unitPresent === undefined ? service.unitPresent : Boolean(result.unitPresent),
      loadState: result.loadState || service.loadState,
      unitFileState: result.unitFileState || service.unitFileState,
      activeState: nextActiveState,
      subState: nextSubState,
      result: nextResult,
      mainProcessId: result.mainProcessId === undefined ? service.mainProcessId : result.mainProcessId,
    };
    if (resultingState.unitFileState === "masked") resultingState.loadState = "masked";
    if (!resultingState.unitPresent) resultingState.loadState = "not-found";
    if (resultingState.activeState !== "active" || resultingState.subState !== "running") {
      resultingState.mainProcessId = undefined;
    }
    service.unitFileState = resultingState.unitFileState as CanonicalService["unitFileState"];
    service.unitPresent = resultingState.unitPresent;
    service.loadState = resultingState.loadState as CanonicalService["loadState"];
    service.activeState = resultingState.activeState as CanonicalService["activeState"];
    service.subState = resultingState.subState;
    service.result = resultingState.result as CanonicalService["result"];
    service.mainProcessId = resultingState.mainProcessId;
    service.lastTransitionAt = occurredAt;
    if (processId && !["oneshot", "timer"].includes(service.unitType)) {
      const transitionProcess = processes.find((process) => String(process.pid) === processId);
      if (
        transitionProcess &&
        !transitionProcess.executable.includes("systemctl") &&
        transitionProcess.executable.toLowerCase().includes(serviceProcessToken(service.unitName))
      ) {
        service.mainProcessId = transitionProcess.id;
      }
    }
    serviceTransitions.push({
      id: `transition:${service.unitName}:${operation}:${serviceTransitions.length + 1}`,
      executionId: cause.type === "command" ? commands.find((command) => command.id === cause.commandId)?.executionId : undefined,
      serviceId: service.id,
      operation,
      cause,
      occurredAt,
      previousState,
      resultingState,
      outcome,
      processId,
      expectedRenderTargets: ["audit", "journal_systemd", "syslog", "timeline", "service_inventory"],
    });
  };

  for (const command of commands) {
    const unitName = commandSystemdUnit(command);
    if (!unitName) continue;
    const service = addService(unitName, {
      role: unitName === canonicalPrimaryServiceUnit(incident) ? "primary" : "secondary",
      unitPath: serviceUnitPath(unitName, unitName === "metrics-cache.service"),
      packageName: unitName === "metrics-cache.service" ? undefined : packageForUnit(unitName),
    });
    const effectAt = timestampPlusSeconds(command.timestamp, 12);
    if (/\bsystemctl\s+enable\s+--now\b/i.test(command.renderedCommand)) {
      addTransition(service, "enable", { type: "command", commandId: command.id }, effectAt, { unitFileState: "enabled" }, String(command.processId));
      addTransition(service, "start", { type: "command", commandId: command.id }, timestampPlusSeconds(command.timestamp, 14), { activeState: "active", subState: activeSubState(service.unitName, "active") }, String(command.processId));
    } else if (/\bsystemctl\s+enable\b/i.test(command.renderedCommand)) {
      addTransition(service, "enable", { type: "command", commandId: command.id }, effectAt, { unitFileState: "enabled" }, String(command.processId));
    } else if (/\bsystemctl\s+disable\b/i.test(command.renderedCommand)) {
      addTransition(service, "disable", { type: "command", commandId: command.id }, effectAt, { unitFileState: "disabled" }, String(command.processId));
    } else if (/\bsystemctl\s+mask\b/i.test(command.renderedCommand)) {
      addTransition(service, "mask", { type: "command", commandId: command.id }, effectAt, { unitFileState: "masked", loadState: "masked", activeState: "inactive", subState: "dead", result: "none", mainProcessId: undefined }, String(command.processId));
    } else if (/\bsystemctl\s+unmask\b/i.test(command.renderedCommand)) {
      addTransition(service, "unmask", { type: "command", commandId: command.id }, effectAt, { unitFileState: "disabled", loadState: "loaded" }, String(command.processId));
    } else if (/\bsystemctl\s+reload\b/i.test(command.renderedCommand)) {
      addTransition(service, "reload", { type: "command", commandId: command.id }, effectAt, {}, String(command.processId));
    } else if (/\bsystemctl\s+restart\b/i.test(command.renderedCommand)) {
      addTransition(service, "restart", { type: "command", commandId: command.id }, effectAt, { activeState: "active", subState: activeSubState(service.unitName, "active") }, String(command.processId));
    } else if (/\bsystemctl\s+start\b/i.test(command.renderedCommand)) {
      addTransition(service, "start", { type: "command", commandId: command.id }, effectAt, { activeState: "active", subState: activeSubState(service.unitName, "active") }, String(command.processId));
    } else if (/\bsystemctl\s+stop\b/i.test(command.renderedCommand)) {
      addTransition(service, "stop", { type: "command", commandId: command.id }, effectAt, { activeState: "inactive", subState: "dead", result: "none", mainProcessId: undefined }, String(command.processId));
    }
  }

  const cronDefinitions: CanonicalCronDefinition[] = [];
  const scheduledExecutions: CanonicalScheduledExecution[] = [];
  const packageTransactions: CanonicalPackageTransaction[] = [];
  const maintenanceActivities: CanonicalMaintenanceActivity[] = [];
  const family = roleFamily(world.serverRole);
  const permittedJobFamilies = backgroundTemplates(family, world).map((template) => template.purpose);
  if (incident.id === "cron_persistence" && !permittedJobFamilies.includes("incident")) permittedJobFamilies.unshift("incident");
  const backgroundProfile: CanonicalBackgroundProfile = {
    hostRole: world.serverRole,
    industry: world.industry,
    organisationMaturity: world.securityMaturity,
    businessHours: world.businessHours,
    timezone: "UTC",
    permittedJobFamilies,
    permittedServiceFamilies: roleServiceUnits(world.serverRole),
    permittedPackageActivities: incident.id === "unauthorized_package_install"
      ? ["manual", "apt_daily"]
      : ["apt_daily", "unattended_upgrade"],
    activityDensity: backgroundDensity(world),
  };
  const cronDaemon = addProcess({
    id: "process:cron:daemon",
    pid: 644,
    ppid: 1,
    executable: "/usr/sbin/cron",
    argv: ["/usr/sbin/cron", "-f"],
    identityId: root.id,
    realUid: 0,
    effectiveUid: 0,
    realGid: 0,
    effectiveGid: 0,
    cwd: "/",
    startedAt: formatUtcTimestamp(new Date(parseTimestamp(collection.collectedAt) - 14 * 24 * 3600 * 1000)),
    openFileIds: [],
  });
  const cronService = services.get(serviceId("cron.service"));
  if (cronService && cronService.activeState === "active" && cronService.subState === "running") {
    cronService.mainProcessId = cronDaemon.id;
    cronService.execStart = "/usr/sbin/cron -f";
  }
  const incidentScheduleTime = new Date(
    parseTimestamp(collection.windowStart) + diversityProfile.timelineOffsets.commands[0] * 1000
  );
  const incidentCronSchedule = `${incidentScheduleTime.getUTCMinutes()} ${incidentScheduleTime.getUTCHours()} * * *`;
  const incidentCronTemplate: BackgroundJobTemplate | undefined = incident.id === "cron_persistence"
    ? {
        purpose: "incident",
        command: "/usr/local/sbin/platform-sync.sh",
        schedule: incidentCronSchedule,
        scriptPath: "/usr/local/sbin/platform-sync.sh",
        sourcePath: "/etc/cron.d/platform-sync",
        runAs: "service",
        files: ["/var/log/platform-sync.log", "/var/lib/platform/sync-state.json"],
        services: ["cron.service"],
        stdout: "platform sync job completed",
        daemon: "cron",
        scriptBody: [
          "set -euo pipefail",
          "rsync -a /srv/platform/cache/ /var/lib/platform/sync/",
          "logger -t platform-sync platform sync completed",
        ],
      }
    : undefined;
  const variedBackgroundTemplates = rotateLinuxDiversityList(
    backgroundTemplates(family, world),
    diversityProfile.noiseRotation
  );
  const templates = incidentCronTemplate
    ? [incidentCronTemplate, ...variedBackgroundTemplates]
    : variedBackgroundTemplates;
  const templateCount = backgroundProfile.activityDensity === "high" ? Math.min(2, templates.length) : 1;
  templates.slice(0, templateCount).forEach((template, index) => {
    const runAs = cronRunAsIdentity(args, identities, groups, template);
    const commandId = `command:background:${family}:${index + 1}`;
    const occurredAt = scheduledOccurrenceAt(
      template.schedule,
      collection.collectedAt,
      template.purpose === "incident"
        ? { start: collection.windowStart, end: collection.windowEnd }
        : undefined
    );
    const processId = 6300 + index * 10;
    const command: CanonicalCommand = {
      id: commandId,
      kind: "background",
      actorIdentityId: runAs.id,
      timestamp: occurredAt,
      cwd: runAs.username === "root" ? "/" : homeDirectoryFor(builderInput(args), runAs.username),
      executable: commandExecutable(template.command),
      argv: template.command.split(/\s+/),
      renderedCommand: template.command,
      runAsIdentityId: runAs.id,
      processId,
      shellProcessId: cronDaemon.pid,
      affectedFileIds: [],
      affectedServiceIds: template.services.map(serviceId),
      expectedRenderTargets: ["audit", "syslog", "timeline", "process", "open_files"],
    };
    commands.push(command);
    const script = addFile(template.scriptPath, commandId, root);
    const executableFile = command.executable !== template.scriptPath ? addFile(command.executable, commandId, root) : undefined;
    const affectedFiles = [
      script,
      ...(executableFile ? [executableFile] : []),
      ...template.files.map((path) => addFile(path, commandId, path.startsWith("/var/log/") ? root : runAs)),
    ];
    // The rendered generic script appends to its first log before calling
    // logger. A service-run cron job must own that log to complete under the
    // ordinary POSIX permissions represented in learner evidence. Keep adm's
    // read access and the existing 0640 mode; do not imply hidden elevation.
    const appendLogPath = /platform-sync\.sh$/i.test(template.scriptPath)
      ? undefined
      : template.files.find((path) => path.startsWith("/var/log/"));
    const appendLog = affectedFiles.find((file) => file.path === appendLogPath);
    if (appendLog && runAs.uid !== 0) {
      appendLog.ownerIdentityId = runAs.id;
      appendLog.ownerUid = runAs.uid;
    }
    for (const file of affectedFiles) {
      if (file.modifiedAt < occurredAt) file.modifiedAt = formatUtcTimestamp(new Date(parseTimestamp(occurredAt) + 1000));
    }
    command.affectedFileIds = affectedFiles.map((file) => file.id);
    for (const unit of template.services) {
      if (services.has(serviceId(unit))) {
        addService(unit, { role: "background" });
      } else {
        // A scheduled job referencing a unit does not prove that unit is a
        // running daemon at collection time. Preserve the reference without
        // inventing an independently active service or listener.
        addService(unit, {
          role: "background",
          unitFileState: "static",
          activeState: "inactive",
          subState: "dead",
          result: "none",
          description: "service referenced by background activity; not active at capture",
        });
      }
    }
    addProcess({
      id: `process:background:${family}:${index + 1}`,
      pid: processId,
      ppid: cronDaemon.pid,
      executable: command.executable,
      argv: command.argv,
      identityId: runAs.id,
      realUid: runAs.uid,
      effectiveUid: runAs.uid,
      realGid: runAs.gid,
      effectiveGid: runAs.gid,
      cwd: command.cwd,
      commandId,
      startedAt: occurredAt,
      endedAt: formatUtcTimestamp(new Date(parseTimestamp(occurredAt) + 45 * 1000)),
      openFileIds: command.affectedFileIds,
    });
    const source: CanonicalCronDefinition["source"] = runAs.username === "root" && index === 0 ? "root_crontab" : "cron_d";
    const sourcePath = template.sourcePath || (source === "root_crontab"
      ? "/var/spool/cron/crontabs/root"
      : `/etc/cron.d/${family}-${index + 1}-${template.purpose}`);
    const definition: CanonicalCronDefinition = {
      id: `cron:${family}:${index + 1}`,
      source,
      sourcePath,
      ownerIdentityId: root.id,
      runAsIdentityId: runAs.id,
      schedule: template.schedule,
      commandId,
      environment: { SHELL: "/bin/sh", PATH: "/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin" },
      enabled: true,
      persistenceState: "present",
      createdAt: formatUtcTimestamp(new Date(parseTimestamp(occurredAt) - 24 * 3600 * 1000)),
      modifiedAt: formatUtcTimestamp(new Date(parseTimestamp(occurredAt) - 3600 * 1000)),
      relatedChangeId: world.changeId,
      purpose: template.purpose,
      telemetryCoverage: template.purpose === "incident"
        ? { mode: "complete", start: collection.windowStart, end: collection.windowEnd }
        : { mode: "sampled", start: occurredAt, end: formatUtcTimestamp(new Date(parseTimestamp(occurredAt) + 45_000)), reason: "partial_logs" },
    };
    cronDefinitions.push(definition);
    scheduledExecutions.push({
      id: `scheduled:${family}:${index + 1}`,
      definitionId: definition.id,
      commandId,
      processId: `process:background:${family}:${index + 1}`,
      occurredAt,
      outcome: "success",
      exitCode: 0,
      stdoutSummary: template.stdout,
      affectedFileIds: command.affectedFileIds,
      affectedServiceIds: command.affectedServiceIds || [],
      expectedRenderTargets: ["cron_log", "audit", "syslog", "process", "open_files", "timeline"],
    });
  });

  const packageCommandId = incident.id === "unauthorized_package_install"
    ? commands.find((command) => /\bapt\s+install\b/i.test(command.renderedCommand))?.id
    : undefined;
  const packageTimer = timers.find((timer) => timer.id === "timer:apt-daily");
  if (incident.id === "unauthorized_package_install" || packageTimer) {
    const packageName = incident.id === "unauthorized_package_install" ? "ncat" : diversityProfile.packageNoise;
    const routinePackageVersions: Record<string, { previous: string; resulting: string }> = {
      openssl: { previous: "3.0.13", resulting: "3.0.13-0ubuntu3.4" },
      "ca-certificates": { previous: "20240203", resulting: "20240203ubuntu0.24.04.1" },
      systemd: { previous: "255.4-1ubuntu8.7", resulting: "255.4-1ubuntu8.8" },
      curl: { previous: "8.5.0-2ubuntu10.5", resulting: "8.5.0-2ubuntu10.6" },
    };
    const routineVersion = routinePackageVersions[packageName] || routinePackageVersions.openssl;
    const packageCommand = packageCommandId ? commands.find((command) => command.id === packageCommandId) : undefined;
    const packageActor = packageCommand?.actorIdentityId
      ? [...identities.values()].find((identity) => identity.id === packageCommand.actorIdentityId) || root
      : root;
    const manualPackageStartedAt = packageCommand?.timestamp || incidentTimestamp(
      baseTime,
      diversityProfile.timelineOffsets.commands[0]
    );
    const requestedAt = incident.id === "unauthorized_package_install"
      ? timestampPlusSeconds(manualPackageStartedAt, -2)
      : localDayTimestamp("00:05:00");
    const startedAt = incident.id === "unauthorized_package_install"
      ? manualPackageStartedAt
      : localDayTimestamp("00:05:15");
    const completedAt = incident.id === "unauthorized_package_install"
      ? timestampPlusSeconds(manualPackageStartedAt, 17)
      : localDayTimestamp("00:06:12");
    const packageCommandProcess = packageCommand ? processes.find((process) => process.pid === packageCommand.processId) : undefined;
    const packageCommandExecution = packageCommand?.executionId ? executions.find((execution) => execution.id === packageCommand.executionId) : undefined;
    const aptProcessId = packageCommand?.processId || 6900;
    const dpkgProcessId = 6901;
    const aptCommandId = packageCommandId || "command:package:apt-daily";
    const packageFiles = [
      addFile(packageCommandId ? "/usr/bin/apt" : "/usr/lib/apt/apt.systemd.daily", aptCommandId, root),
      addFile("/var/log/apt/history.log", aptCommandId, root),
      addFile("/var/lib/dpkg/status", aptCommandId, root),
    ];
    if (incident.id === "unauthorized_package_install") {
      for (const file of packageFiles.filter((item) => item.path.startsWith("/var/"))) {
        file.modifiedAt = completedAt;
      }
    }
    const packageFileIds = packageFiles.map((file) => file.id);
    if (!packageCommandId) {
      const command: CanonicalCommand = {
        id: aptCommandId,
        kind: "background",
        actorIdentityId: packageActor.id,
        timestamp: startedAt,
        cwd: "/",
        executable: "/usr/lib/apt/apt.systemd.daily",
        argv: ["/usr/lib/apt/apt.systemd.daily", "update"],
        renderedCommand: "/usr/lib/apt/apt.systemd.daily update",
        processId: aptProcessId,
        affectedFileIds: [],
        affectedServiceIds: [serviceId("apt-daily.service")],
        expectedRenderTargets: ["process", "open_files"],
      };
      commands.push(command);
      command.affectedFileIds = packageFileIds;
    } else if (packageCommand && packageCommandProcess) {
      enrichExecutionLifecycleFiles({
        registry: lifecycleRegistry,
        executions,
        commands,
        processes,
        executionId: packageCommand.executionId!,
        fileIds: packageFileIds,
      });
    }
    if (!packageCommandId) {
      addProcess({
        id: "process:package:apt",
        pid: aptProcessId,
        ppid: 1,
        executable: "/usr/lib/apt/apt.systemd.daily",
        argv: ["/usr/lib/apt/apt.systemd.daily", "update"],
        identityId: packageActor.id,
        realUid: packageActor.uid,
        effectiveUid: 0,
        realGid: packageActor.gid,
        effectiveGid: 0,
        cwd: "/",
        commandId: aptCommandId,
        startedAt,
        endedAt: completedAt,
        openFileIds: packageFileIds,
      });
    }
    const dpkgFileId = addFile("/var/lib/dpkg/status", aptCommandId, root).id;
    const dpkgLifecycle = createExecutionLifecycle({
      intentId: `intent:package:dpkg:${packageName}`,
      executionId: `execution:package:dpkg:${packageName}:${incident.id === "unauthorized_package_install" ? "manual" : "apt-daily"}`,
      hostname: investigation.hostname,
      actorIdentity: packageActor,
      effectiveIdentity: root,
      sessionId: packageCommand?.sessionId,
      parentPid: aptProcessId,
      processId: "process:package:dpkg",
      pid: dpkgProcessId,
      executable: "/usr/bin/dpkg",
      argv: ["dpkg", "--configure", packageName],
      cwd: "/",
      tty: packageCommand?.tty,
      startTime: incident.id === "unauthorized_package_install" ? timestampPlusSeconds(manualPackageStartedAt, 3) : localDayTimestamp("00:05:45"),
      endTime: completedAt,
      reason: "package",
      privilegeLevel: "root",
      processPolicy: "create_process",
      affectedFileIds: [dpkgFileId],
      identityOrigin: packageCommandExecution ? "inherited" : undefined,
      authenticationOriginId: packageCommandExecution?.authenticationOriginId,
      outcome: "success",
      exitCode: 0,
    }, lifecycleCollections);
    const transaction: CanonicalPackageTransaction = {
      id: `package:${packageName}:${incident.id === "unauthorized_package_install" ? "manual" : "apt-daily"}`,
      source: incident.id === "unauthorized_package_install" ? "manual" : "apt_daily",
      actorIdentityId: packageActor.id,
      commandId: aptCommandId,
      timerId: incident.id === "unauthorized_package_install" ? undefined : packageTimer?.id,
      processIds: [packageCommandProcess?.id || "process:package:apt", dpkgLifecycle.process.id],
      requestedAt,
      startedAt,
      completedAt,
      action: incident.id === "unauthorized_package_install" ? "install" : "upgrade",
      packages: [{
        name: packageName,
        previousVersion: incident.id === "unauthorized_package_install" ? undefined : routineVersion.previous,
        resultingVersion: incident.id === "unauthorized_package_install" ? "7.94+dfsg1-1build2" : routineVersion.resulting,
        repository: "ubuntu",
      }],
      changeId: world.changeId,
      outcome: "success",
      affectedFileIds: [addFile("/var/lib/dpkg/status", aptCommandId, root).id],
      affectedServiceIds: incident.id === "unauthorized_package_install" ? [] : [serviceId("apt-daily.service")],
    };
    packageTransactions.push(transaction);
    if (incident.id === "unauthorized_package_install") {
      const latestRelatedWrite = packageFiles
        .flatMap((file) => file.relatedCommandIds)
        .map((commandId) => commands.find((command) => command.id === commandId))
        .filter((command): command is CanonicalCommand => Boolean(command))
        .map((command) => processes.find((process) => process.pid === command.processId)?.endedAt || command.timestamp)
        .concat(completedAt)
        .sort()
        .at(-1)!;
      for (const file of packageFiles.filter((item) => item.path.startsWith("/var/"))) {
        file.modifiedAt = latestRelatedWrite;
      }
    }
  }

  maintenanceActivities.push({
    id: "maintenance:primary-window",
    title: `${world.serverRole} scheduled maintenance review`,
    owningTeam: world.department,
    actorIdentityId: identityForUser(args, identities, groups, world.adminUser).id,
    approved: false,
    approvalDecision: "unknown",
    approvalEvidenceAvailability: "partial",
    approvalSourceCompleteness: "partial",
    approvalSourcePaths: ["assets/docs/change_request.md", "assets/docs/maintenance_ticket.md"],
    changeId: world.changeId,
    ticketId: world.ticketId,
    windowStart: collection.windowStart,
    windowEnd: collection.windowEnd,
    recurringPolicyWindow: world.maintenanceWindow,
    timezone: investigation.timezone,
    commandIds: commands.filter((command) => command.kind !== "background").map((command) => command.id),
    serviceTransitionIds: serviceTransitions.map((transition) => transition.id),
    packageTransactionIds: packageTransactions.map((transaction) => transaction.id),
    cronDefinitionIds: cronDefinitions.map((definition) => definition.id),
    purpose: "change-reference scope represented canonically for document rendering; approval for observed activity requires exact host, activity, date, time, and window validation",
  });

  const cronConfigFile = addFile("/etc/crontab", "command:system:cron", root);
  if (!cronDaemon.openFileIds.includes(cronConfigFile.id)) cronDaemon.openFileIds.push(cronConfigFile.id);
  const rsyslogService = services.get(serviceId("rsyslog.service"));
  if (rsyslogService && rsyslogService.activeState === "active" && rsyslogService.subState === "running") {
    const rsyslogFiles = [addFile("/var/log/syslog", "command:system:rsyslog", root)];
    if (incident.id === "log_tampering") {
      const deletedAuthLog = addFile("/var/log/auth.log.1", "command:system:rsyslog", root);
      const relatedCommandTimes = commands
        .filter((command) => deletedAuthLog.relatedCommandIds.includes(command.id))
        .map((command) => timestampPlusSeconds(command.timestamp, 1))
        .sort();
      const deletedAt = relatedCommandTimes.at(-1) || incidentTimestamp(baseTime, 67);
      deletedAuthLog.modifiedAt = deletedAt;
      deletedAuthLog.deletedAt = timestampPlusSeconds(deletedAt, 1);
      rsyslogFiles.push(deletedAuthLog);
    }
    const rsyslogProcess = addProcess({
      id: "process:rsyslog:daemon",
      pid: 623,
      ppid: 1,
      executable: "/usr/sbin/rsyslogd",
      argv: ["/usr/sbin/rsyslogd", "-n"],
      identityId: root.id,
      realUid: 0,
      effectiveUid: 0,
      realGid: 0,
      effectiveGid: 0,
      cwd: "/",
      startedAt: formatUtcTimestamp(new Date(parseTimestamp(collection.collectedAt) - 14 * 24 * 3600 * 1000)),
      lifecycleKind: "daemon",
      openFileIds: rsyslogFiles.map((file) => file.id),
    });
    rsyslogService.mainProcessId = rsyslogProcess.id;
    rsyslogService.execStart = "/usr/sbin/rsyslogd -n";
  }

  addProcess({
    id: "process:systemd-journald",
    pid: 2320,
    ppid: 1,
    executable: "/usr/lib/systemd/systemd-journald",
    argv: ["/usr/lib/systemd/systemd-journald"],
    identityId: root.id,
    realUid: 0,
    effectiveUid: 0,
    realGid: 0,
    effectiveGid: 0,
    cwd: "/",
    startedAt: localDayTimestamp("00:00:00"),
    lifecycleKind: "daemon",
    openFileIds: [],
  });

  const roleParentPids = new Map<number, number>();
  for (const spec of roleRuntimeProcessSpecs(world)) {
    const argv = spec.command.split(/\s+/);
    const existingDaemon = processes.find((process) => process.executable === argv[0] && process.ppid === 1 && !process.endedAt);
    if (existingDaemon) {
      roleParentPids.set(spec.pid, existingDaemon.pid);
      continue;
    }
    if (argv[0] === "/usr/sbin/apache2" && !services.has(serviceId("apache2.service"))) continue;
    if (processes.some((process) => process.pid === spec.pid)) continue;
    const identity = spec.user === "root" ? root : identityForUser(args, identities, groups, spec.user);
    addProcess({
      id: `process:role:${spec.pid}`,
      pid: spec.pid,
      ppid: roleParentPids.get(spec.ppid) || spec.ppid,
      executable: argv[0],
      argv,
      identityId: identity.id,
      realUid: identity.uid,
      effectiveUid: identity.uid,
      realGid: identity.gid,
      effectiveGid: identity.gid,
      cwd: spec.user === "root" ? "/" : homeDirectoryFor(builderInput(args), spec.user),
      startedAt: localDayTimestamp("00:00:00"),
      lifecycleKind: "long_running",
      openFileIds: [],
    });
  }

  // A long-running service reported as active/running should expose a useful
  // MainPID. Timers, sockets and active/exited oneshot units correctly do not.
  let nextServicePid = 2700;
  for (const service of services.values()) {
    if (
      service.unitType !== "simple" ||
      service.serviceType !== "long-running" ||
      service.activeState !== "active" ||
      service.subState !== "running" ||
      service.mainProcessId
    ) {
      continue;
    }
    const token = serviceProcessToken(service.unitName).toLowerCase();
    const existing = processes.find((process) =>
      !process.endedAt && process.executable.toLowerCase().includes(token)
    );
    if (existing) {
      service.mainProcessId = existing.id;
      continue;
    }
    while (processes.some((process) => process.pid === nextServicePid)) nextServicePid += 1;
    const username = serviceProcessUser(service.unitName, world);
    const identity = username === "root" ? root : identityForUser(args, identities, groups, username);
    const executable = serviceRuntimeExecutable(service.unitName);
    const process = addProcess({
      id: `process:service-main:${service.unitName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`,
      pid: nextServicePid,
      ppid: 1,
      executable,
      argv: [executable],
      identityId: identity.id,
      realUid: identity.uid,
      effectiveUid: identity.uid,
      realGid: identity.gid,
      effectiveGid: identity.gid,
      cwd: "/",
      startedAt: localDayTimestamp("00:00:00"),
      lifecycleKind: "daemon",
      lifecycleOrigin: "system_origin",
      openFileIds: [],
    });
    service.mainProcessId = process.id;
    service.execStart = executable;
    nextServicePid += 1;
  }

  // A successful restart replaces the running daemon generation. Keep the
  // original process and its startup ledger intact as historical evidence;
  // the service transition retires it and points every current-state renderer
  // at the newly started process. Reload intentionally keeps the generation.
  const serviceRuntimeById = new Map([...services.values()].map((service) => [
    service.id,
    serviceTransitions.find((transition) => transition.serviceId === service.id)?.previousState.mainProcessId || service.mainProcessId,
  ]));
  let nextRestartPid = 10000;
  for (const transition of [...serviceTransitions].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))) {
    const service = services.get(transition.serviceId);
    if (!service || service.serviceType !== "long-running" || transition.outcome !== "success") continue;
    const currentId = serviceRuntimeById.get(service.id);
    const current = processes.find((process) => process.id === currentId);
    if (transition.operation === "reload") {
      transition.previousState.mainProcessId = current?.id;
      transition.resultingState.mainProcessId = current?.id;
      continue;
    }
    if (transition.operation !== "restart") continue;
    if (!current || !isProcessAliveAtTimestamp(current, transition.occurredAt)) {
      throw new Error(`Linux simulation failed: ${service.unitName} restart lacks a live pre-restart main process.`);
    }
    transition.previousState.mainProcessId = current.id;
    current.serviceRetiredAt = transition.occurredAt;
    for (const child of processes) {
      if (child.ppid === current.pid && isProcessAliveAtTimestamp(child, transition.occurredAt)) {
        child.currentPpid = 1;
      }
    }
    while (processes.some((process) => process.pid === nextRestartPid)) nextRestartPid += 1;
    const replacement = addProcess({
      id: `process:service-restart:${service.unitName}:${transition.id.replace(/[^a-z0-9]+/gi, "-")}`,
      pid: nextRestartPid++,
      ppid: 1,
      executable: current.executable,
      argv: [...current.argv],
      identityId: current.identityId,
      realUid: current.realUid,
      effectiveUid: current.effectiveUid,
      realGid: current.realGid,
      effectiveGid: current.effectiveGid,
      cwd: current.cwd,
      startedAt: transition.occurredAt,
      lifecycleKind: current.lifecycleKind || "daemon",
      lifecycleOrigin: "system_origin",
      openFileIds: [...current.openFileIds],
    });
    transition.resultingState.mainProcessId = replacement.id;
    serviceRuntimeById.set(service.id, replacement.id);
  }
  for (const service of services.values()) {
    if (!serviceTransitions.some((transition) => transition.serviceId === service.id && transition.operation === "restart" && transition.outcome === "success")) continue;
    if (service.activeState === "active" && service.subState === "running") {
      service.mainProcessId = serviceRuntimeById.get(service.id);
    }
  }
  const sshMain = processes.find((process) => process.id === services.get(serviceId("ssh.service"))?.mainProcessId);
  if (sshMain) {
    const authLogFile = addFile("/var/log/auth.log", "command:system:sshd", root);
    const sshdConfigFile = addFile("/etc/ssh/sshd_config", "command:system:sshd", root);
    for (const fileId of [authLogFile.id, sshdConfigFile.id]) {
      if (!sshMain.openFileIds.includes(fileId)) sshMain.openFileIds.push(fileId);
    }
  }

  for (const service of services.values()) {
    const transitionsForService = serviceTransitions.filter((transition) => transition.serviceId === service.id);
    const lastTransition = transitionsForService[transitionsForService.length - 1];
    if (
      lastTransition &&
      service.activeState === "active" &&
      service.subState === "running" &&
      service.mainProcessId &&
      lastTransition.resultingState.activeState === "active" &&
      lastTransition.resultingState.subState === "running"
    ) {
      lastTransition.resultingState.mainProcessId = service.mainProcessId;
    }
  }

  const processByPid = new Map<number, CanonicalProcess>();
  for (const process of processes) {
    if (processByPid.has(process.pid)) throw new Error(`Linux simulation failed: PID collision ${process.pid}.`);
    processByPid.set(process.pid, process);
  }
  for (const process of processes) {
    if (process.ppid !== 1) {
      const parent = processByPid.get(process.ppid);
      if (!parent) throw new Error(`Linux simulation failed: PPID ${process.ppid} missing for PID ${process.pid}.`);
      parent.childProcessIds.push(process.id);
      if (parseTimestamp(process.startedAt) < parseTimestamp(parent.startedAt)) {
        throw new Error(`Linux simulation failed: child process ${process.id} starts before parent.`);
      }
    }
  }
  const sessionById = new Map(incidentSessions.map((item) => [item.id, item]));
  for (const command of commands) {
    if (command.sessionId) {
      const ownerSession = sessionById.get(command.sessionId);
      if (!ownerSession) throw new Error(`Linux simulation failed: command ${command.id} references missing session.`);
      if (parseTimestamp(command.timestamp) < parseTimestamp(ownerSession.openedAt)) {
        throw new Error(`Linux simulation failed: command ${command.id} occurs before session open.`);
      }
      if (ownerSession.closedAt && parseTimestamp(command.timestamp) > parseTimestamp(ownerSession.closedAt)) {
        throw new Error(`Linux simulation failed: command ${command.id} occurs after session close.`);
      }
    }
    if (!processByPid.has(command.processId)) throw new Error(`Linux simulation failed: command ${command.id} missing process.`);
  }
  for (const event of events) {
    if (parseTimestamp(event.timestamp) > parseTimestamp(collection.collectedAt)) {
      throw new Error(`Linux simulation failed: event ${event.id} occurs after collection.`);
    }
  }
  finalizeLegacyExecutionLinks({
    executions,
    commands,
    processes,
    lifecycleRegistry,
    scheduledExecutions,
    serviceTransitions,
    packageTransactions,
  });

  // Every absolute program rendered through command, process, cron, package, or
  // daemon evidence must have plausible executable metadata. Background/noise
  // programs are learner-visible evidence too.
  for (const process of processes.filter((item) => item.executable.startsWith("/"))) {
    const executable = addFile(process.executable, "command:system:executable", root);
    executable.fileType = "regular";
    executable.mode |= 0o555;
  }

  const simulation: LinuxSimulationWorld = {
    version: 1,
    seed,
    diversityProfile,
    requestedDurationMinutes: args.requestedDurationMinutes,
    investigation,
    collection,
    identities: [...identities.values()],
    groups: [...groups.values()],
    sshSessions: incidentSessions,
    authenticationOrigins: incidentAuthenticationOrigins,
    identityTransitions,
    executions,
    lifecycleRegistry,
    commands,
    processes,
    files: [...files.values()],
    openFileDescriptors: [],
    events: events.sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    services: [...services.values()].sort((left, right) => left.unitName.localeCompare(right.unitName)),
    serviceTransitions: serviceTransitions.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    timers,
    cronDefinitions: cronDefinitions.sort((left, right) => left.id.localeCompare(right.id)),
    scheduledExecutions: scheduledExecutions.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    packageTransactions: packageTransactions.sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    maintenanceActivities,
    backgroundProfile,
    evidenceRegistry: [],
    planningEvidenceRegistry: [],
    documentFacts: [],
    documents: [],
    canonicalTasks: [],
    taskFeasibilityProofs: [],
    taskPlannerDiagnostics: [],
    difficultyDiagnostics: {
      difficulty: "Advanced",
      profile: {
        evidenceSurface: "full",
        expectedTaskCount: { min: 5, max: 8 },
      },
      issues: [],
    },
    executionMigrationDiagnostics: {
      totalCommands: 0,
      executionFirstCommands: 0,
      legacyCommands: 0,
      totalProcesses: 0,
      executionFirstProcesses: 0,
      backgroundSystemProcesses: 0,
      legacyUnclassifiedProcesses: 0,
      executionIntentsCreated: 0,
      completedExecutions: 0,
      failedNoChildExecutions: 0,
      builderRegisteredExecutions: 0,
      pendingExecutions: 0,
      constructionFailedExecutions: 0,
      builderRegisteredCommands: 0,
      builderRegisteredProcesses: 0,
      shellHostedExecutions: 0,
      backgroundStaticLegacyCommands: 0,
      backgroundStaticLegacyProcesses: 0,
      incidentRelevantLegacyCommands: 0,
      incidentRelevantLegacyProcesses: 0,
      forgedLabelObjects: 0,
      postFinalizationMutationViolations: 0,
      packageDpkgLegacyProcesses: 0,
      duplicateExecutionRegistrations: 0,
      duplicateCommandRegistrations: 0,
      duplicateProcessRegistrations: 0,
      invalidRegistrationFingerprints: 0,
      replacedRegistryRecords: 0,
      registryCardinalityViolations: 0,
      frozenRecordMutationAttempts: 0,
      authoritativeLedgerRecords: 0,
      serializedDiagnosticRecords: 0,
      authoritativeSerializedRegistryMismatches: 0,
    },
    legacy: {
      phase: 1,
      remainingLocalFactOrigins: [
        "final AI prose wording",
      ],
    },
  };
  simulation.openFileDescriptors = buildCanonicalOpenFileDescriptors(simulation);
  simulation.documentFacts = buildDocumentFacts(simulation);
  simulation.documents = buildCanonicalDocuments(simulation, simulation.documentFacts);
  simulation.evidenceRegistry = buildCanonicalEvidenceRegistry(simulation);
  simulation.planningEvidenceRegistry = filterEvidenceRegistryForDifficulty(simulation.evidenceRegistry, difficulty, simulation);
  const taskPlan = buildTaskPlan(simulation, simulation.planningEvidenceRegistry, difficulty);
  simulation.canonicalTasks = taskPlan.tasks;
  simulation.taskFeasibilityProofs = taskPlan.proofs;
  simulation.difficultyDiagnostics = validateLinuxTaskPlanAgainstDifficultyProfile({
    difficulty,
    requestedDurationMinutes: simulation.requestedDurationMinutes,
    tasks: simulation.canonicalTasks,
    fullEvidenceRegistry: simulation.evidenceRegistry,
    planningEvidenceRegistry: simulation.planningEvidenceRegistry,
  });
  simulation.executionMigrationDiagnostics = buildExecutionMigrationDiagnostics(simulation);
  return simulation;
}

export function simulationFromInput(input: LinuxAssetInput) {
  return input.simulation;
}

export function canonicalIdentity(simulation: LinuxSimulationWorld, id: string) {
  const identity = simulation.identities.find((item) => item.id === id);
  if (!identity) throw new Error(`Linux simulation missing identity ${id}.`);
  return identity;
}

export function canonicalFile(simulation: LinuxSimulationWorld, id: string) {
  const file = simulation.files.find((item) => item.id === id);
  if (!file) throw new Error(`Linux simulation missing file ${id}.`);
  return file;
}

export function canonicalProcess(simulation: LinuxSimulationWorld, pid: number) {
  const process = simulation.processes.find((item) => item.pid === pid);
  if (!process) throw new Error(`Linux simulation missing process ${pid}.`);
  return process;
}

export function renderCommandInvocation(command: CanonicalCommand) {
  if (command.renderedCommand.startsWith("/")) return command.renderedCommand;
  const [, ...rest] = command.argv;
  return [command.executable, ...rest].join(" ");
}

export function auditQuoted(value: string) {
  return value.replace(/"/g, '\\"');
}

export function linuxLearnerRelationLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    authenticated_as: "authenticated as",
    executed_by: "executed by",
    executed_in_session: "executed in the SSH session",
    spawned_process: "spawned process",
    opened_file: "accessed file",
    created_file: "created file",
    covered_by_change: "covered by the approved change",
    inside_maintenance_window: "occurred within the approved maintenance window",
    service_state: "current service status",
    service_transition: "service start, stop, restart, or reload activity",
    transitioned_service: "changed service state",
    changed_service: "changed service",
    defines_schedule: "defines scheduled execution",
    executed_schedule: "scheduled execution ran",
    installed_package: "package transaction installed software",
    member_of_group: "member of group",
    owned_by: "owned by",
  };
  if (!value) return "";
  return labels[value] || value.replace(/_/g, " ");
}

export function linuxLearnerCapabilityLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    authentication: "authentication evidence",
    session_lifecycle: "SSH session lifecycle",
    actor_attribution: "account attribution",
    command_execution: "command execution evidence",
    process_ancestry: "process lineage",
    open_file_correlation: "file access correlation",
    sudo_authorisation: "sudo policy comparison",
    service_state: "current service status",
    service_transition: "service activity",
    package_transaction: "package transaction evidence",
    cron_definition: "scheduled task definition",
    cron_execution: "scheduled task execution",
    change_control: "change-control evidence",
    maintenance_scope: "maintenance-window evidence",
    file_owner_group_mode: "file ownership and mode",
    configuration_baseline: "configuration baseline",
    timeline_exact: "timestamped evidence",
    timeline_context: "timeline context",
    timeline_static: "snapshot timing context",
    risk_context: "risk context",
    key_provenance: "SSH key provenance",
    network_source: "network source context",
    current_service_state: "current service status",
    current_process_state: "current process snapshot",
    current_listener_state: "current listener state",
    current_package_state: "current package inventory",
    current_persistence_state: "current scheduled or startup configuration",
    current_identity_state: "current account and group inventory",
    current_file_state: "current file or permission state",
    current_open_file_state: "current open-file descriptor state",
    current_policy_state: "current policy configuration",
    current_configuration_state: "current configuration state",
  };
  if (!value) return "";
  return labels[value] || value.replace(/_/g, " ");
}

export function linuxLearnerSubjectLabel(simulation: LinuxSimulationWorld, id: string) {
  const identity = simulation.identities.find((item) => item.id === id);
  if (identity) return `${identity.username} account`;
  const group = simulation.groups.find((item) => item.id === id);
  if (group) return `${group.name} group`;
  const session = simulation.sshSessions.find((item) => item.id === id);
  if (session) return `SSH session for ${session.username} from ${session.sourceIp} at ${session.openedAt}`;
  const command = simulation.commands.find((item) => item.id === id);
  if (command) {
    const execution = simulation.executions.find((item) => item.id === command.executionId);
    if (execution?.processPolicy === "no_child_process" && execution.exitCode === 127) {
      const actor = simulation.identities.find((item) => item.id === command.actorIdentityId)?.username || "unresolved actor";
      return `${command.renderedCommand}: command not found (exit 127), attempted by ${actor} at ${command.timestamp} UTC in shell PID ${command.shellProcessId || command.processId}; no child process was created`;
    }
    return command.renderedCommand;
  }
  const process = simulation.processes.find((item) => item.id === id);
  if (process) return `PID ${process.pid} ${process.argv.join(" ")}`;
  const descriptor = (simulation.openFileDescriptors || []).find((item) => item.id === id);
  if (descriptor) {
    const target = descriptor.targetKind === "socket"
      ? `${descriptor.protocol || "socket"} ${descriptor.localAddress || "local"}:${descriptor.localPort || ""}`
      : `${descriptor.targetPath || descriptor.targetId}${descriptor.deleted ? " (deleted)" : ""}`;
    return `FD ${descriptor.fd} for PID ${descriptor.pid} ${target}`;
  }
  const file = simulation.files.find((item) => item.id === id);
  if (file) return file.path;
  const service = simulation.services.find((item) => item.id === id);
  if (service) return service.unitName;
  const transition = simulation.serviceTransitions.find((item) => item.id === id);
  if (transition) {
    const transitionedService = simulation.services.find((item) => item.id === transition.serviceId);
    return `${transitionedService?.unitName || "service"} ${transition.operation} at ${transition.occurredAt}`;
  }
  const timer = simulation.timers.find((item) => item.id === id);
  if (timer) return timer.timerUnitName;
  const cron = simulation.cronDefinitions.find((item) => item.id === id);
  if (cron) return `${cron.sourcePath} schedule ${cron.schedule}`;
  const execution = simulation.scheduledExecutions.find((item) => item.id === id);
  if (execution) {
    const scheduledCommand = simulation.commands.find((item) => item.id === execution.commandId);
    return `${scheduledCommand?.renderedCommand || "scheduled command"} at ${execution.occurredAt}`;
  }
  const transaction = simulation.packageTransactions.find((item) => item.id === id);
  if (transaction) return `${transaction.source} ${transaction.action} for ${transaction.packages.map((pkg) => pkg.name).join(" ")}`;
  const activity = simulation.maintenanceActivities.find((item) => item.id === id);
  if (activity) return `${activity.changeId || simulation.investigation.changeId} ${activity.title}`;
  const event = simulation.events.find((item) => item.id === id);
  if (event) return `${event.summary} at ${event.timestamp}`;
  if (id === simulation.investigation.incidentId) return simulation.investigation.incidentId;
  if (id === simulation.investigation.changeId) return simulation.investigation.changeId;
  if (id === simulation.investigation.ticketId) return simulation.investigation.ticketId;
  if (id === simulation.investigation.hostname) return simulation.investigation.hostname;
  if (id === simulation.investigation.hostIp) return simulation.investigation.hostIp;
  if (id.startsWith("package-subject:")) return id.slice("package-subject:".length);
  return id.replace(/^[a-z-]+:/, "").replace(/:/g, " ").replace(/-/g, " ");
}

export function linuxLearnerSubjectList(simulation: LinuxSimulationWorld, ids: string[]) {
  return Array.from(new Set(ids.map((id) => linuxLearnerSubjectLabel(simulation, id)).filter(Boolean))).join("; ");
}

export function sanitizeLinuxLearnerText(value: string) {
  return value
    .replace(/\bidentity:([A-Za-z0-9._-]+)/g, "the $1 account")
    .replace(/\bsession:ssh:[A-Za-z0-9._:-]+/g, "the SSH session")
    .replace(/\bcommand:incident:[A-Za-z0-9._:-]+/g, "the observed command")
    .replace(/\bcommand:[A-Za-z0-9._:-]+/g, "the command")
    .replace(/\bprocess:incident:[A-Za-z0-9._:-]+/g, "the related process")
    .replace(/\bprocess:[A-Za-z0-9._:-]+/g, "the process")
    .replace(/\bdescriptor:[A-Za-z0-9._:-]+/g, "the open descriptor")
    .replace(/\bfile:([A-Za-z0-9._:-]+)/g, (_, slug: string) => `/${slug.replace(/-/g, "/")}`)
    .replace(/\bexecuted_by\b/g, "executed by")
    .replace(/\bspawned_process\b/g, "spawned process")
    .replace(/\bopened_file\b/g, "accessed file")
    .replace(/\bcovered_by_change\b/g, "covered by the approved change")
    .replace(/\binside_maintenance_window\b/g, "occurred within the approved maintenance window")
    .replace(/\bauthenticated_as\b/g, "authenticated as")
    .replace(/\bservice_state\b/g, "current service status")
    .replace(/\bservice_transition\b/g, "service activity")
    .replace(/\bprimary-window\b/g, "approved maintenance window")
    .replace(/\bincident-primary\b/g, "primary incident activity");
}

export function simulationTimelineCsv(simulation: LinuxSimulationWorld, options: { advanced?: boolean } = {}) {
  const advanced = options.advanced !== false;
  const lowerTierExcludedSources = new Set([
    "audit.log",
    "process_snapshot.txt",
    "open_files.txt",
    "process_execution_history.txt",
    "file_access_history.csv",
    "root_crontab.txt",
    "cron.log",
    "journal_ssh.txt",
    "journal_systemd.txt",
    "apt_history.log",
    "package_inventory.txt",
    "service_inventory.txt",
  ]);
  const sourceFor = (source: string) => {
    if (advanced) return source;
    return source
      .split(";")
      .filter((item) => !lowerTierExcludedSources.has(item))
      .join(";");
  };
  const exactFor = (source: string) => {
    const exact = sourceFor(source);
    return exact || "timeline.csv";
  };
  const csvRow = (values: Array<string | number>) => values.map((value) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",");
  const rows = [
    ...simulation.events
      .filter((event) => event.kind !== "file_touch")
      .map((event) => {
        const command = event.commandId
          ? simulation.commands.find((item) => item.id === event.commandId)
          : undefined;
        const source = command
          ? command.expectedRenderTargets
              .filter((target) => ["auth", "sudo", "audit", "journal", "process", "open_files"].includes(target))
              .map((target) =>
                target === "auth"
                  ? "auth.log"
                  : target === "journal"
                    ? "journal_ssh.txt"
                    : target === "process"
                      ? "process_execution_history.txt"
                      : target === "open_files"
                        ? "file_access_history.csv"
                        : `${target}.log`
              )
              .join(";")
          : event.kind === "ssh_session_open" || event.kind === "ssh_session_close"
            ? "auth.log;journal_ssh.txt"
            : "timeline.csv";
        const renderedSource = sourceFor(source) || "timeline.csv";
        const exactSources = exactFor(source);
        const contextSources = "";
        const staticSources = "";
        return {
          timestamp: event.timestamp,
          row: csvRow([
          event.timestamp,
          event.summary,
          "Observed",
          renderedSource,
          "high",
          event.commandId ? linuxLearnerSubjectLabel(simulation, event.commandId) : linuxLearnerSubjectLabel(simulation, event.id),
          event.kind,
          exactSources,
          contextSources,
          staticSources,
        ]),
        };
      }),
    ...simulation.serviceTransitions.map((transition) => {
      const service = canonicalService(simulation, transition.serviceId);
      const source = transition.expectedRenderTargets
        .filter((target) => target !== "service_inventory")
        .map((target) => target === "journal_systemd" ? "journal_systemd.txt" : target === "timeline" ? "timeline.csv" : target === "syslog" ? "syslog" : `${target}.log`)
        .join(";");
      const renderedSource = sourceFor(source) || "syslog";
      const exactSources = exactFor(source.split(";").filter((item) => !["service_inventory.txt", "timeline.csv"].includes(item)).join(";"));
      return {
        timestamp: transition.occurredAt,
        row: csvRow([
        transition.occurredAt,
        `${service.unitName} ${transition.operation} state ${transition.resultingState.activeState}/${transition.resultingState.subState}`,
        "Observed",
        renderedSource,
        "high",
        linuxLearnerSubjectLabel(simulation, transition.id),
        linuxLearnerRelationLabel("service_transition"),
        exactSources,
        sourceFor("service_inventory.txt"),
        sourceFor("service_inventory.txt"),
      ]),
      };
    }),
    ...simulation.scheduledExecutions
      .filter((execution) => execution.expectedRenderTargets.includes("timeline"))
      .map((execution) => {
        const command = simulation.commands.find((item) => item.id === execution.commandId);
        const definition = simulation.cronDefinitions.find((item) => item.id === execution.definitionId);
        const event = scheduledExecutionRenderedPhase(simulation, execution);
        const exactSources = exactFor("syslog");
        const contextSources = sourceFor(advanced ? "cron.log;audit.log;process_execution_history.txt;file_access_history.csv" : "");
        const phase = event.phase === "ended_unconfirmed" ? "ended with outcome unconfirmed" : event.phase;
        return {
          timestamp: event.timestamp,
          row: csvRow([
          event.timestamp,
          `${command?.renderedCommand || execution.commandId} ${phase} as scheduled background activity from ${definition?.id || "missing cron definition"}`,
          "Background",
          exactSources,
          "medium",
          linuxLearnerSubjectLabel(simulation, execution.id),
          "scheduled execution",
          exactSources,
          contextSources,
          sourceFor(definition ? definition.source === "root_crontab" ? "root_crontab.txt" : definition.sourcePath.split("/").pop() || "" : ""),
        ]),
        };
      }),
    ...simulation.packageTransactions.map((transaction) => ({
      timestamp: transaction.completedAt,
      row: csvRow([
        transaction.completedAt,
        `${transaction.source} package ${transaction.action} completed for ${transaction.packages.map((pkg) => pkg.name).join(" ")}`,
        "Background",
        advanced ? "apt_history.log" : "syslog",
        "medium",
        linuxLearnerSubjectLabel(simulation, transaction.id),
        "package transaction",
        advanced ? "apt_history.log" : "syslog",
        sourceFor("apt_history.log"),
        sourceFor("package_inventory.txt"),
      ]),
    })),
  ];
  return `timestamp,summary,evidence_type,source,confidence,activity_ref,activity_type,exact_sources,context_sources,static_sources\n${rows.sort((left, right) => left.timestamp.localeCompare(right.timestamp)).map((entry) => entry.row).join("\n")}\n`;
}

export function canonicalService(simulation: LinuxSimulationWorld, id: string) {
  const service = simulation.services.find((item) => item.id === id);
  if (!service) throw new Error(`Linux simulation missing service ${id}.`);
  return service;
}

function serviceStatus(service: CanonicalService) {
  if (service.unitType === "timer") return service.activeState === "active" ? "active" : service.activeState;
  if (service.unitType === "oneshot" && service.activeState === "inactive") return "inactive";
  return service.activeState === "active" ? "running" : service.activeState;
}

export function simulationServiceInventoryCsv(simulation: LinuxSimulationWorld) {
  const rows = ["service,status,startup,notes,load_state,active_state,sub_state,result,main_pid,unit_path,captured_at,state_type,host,window_start,window_end"];
  for (const service of simulation.services) {
    const mainProcess = service.mainProcessId ? simulation.processes.find((process) => process.id === service.mainProcessId) : undefined;
    rows.push([
      service.unitName,
      serviceStatus(service),
      service.unitFileState,
      `${service.description}; type=${service.unitType}; service_type=${service.serviceType}; sub=${service.subState}; path=${service.unitPath}`,
      service.loadState,
      service.activeState,
      service.subState,
      service.result,
      mainProcess?.pid || "",
      service.unitPath,
      simulation.collection.collectedAt,
      "collection_snapshot",
      simulation.investigation.hostname,
      simulation.collection.windowStart,
      simulation.collection.windowEnd,
    ].map((value) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function simulationJournalSystemd(simulation: LinuxSimulationWorld, hostname: string) {
  const entries = [
    `${simulation.collection.earliestAllowedEvent} ${hostname} systemd[1]: Started system boot target.`,
    ...simulation.serviceTransitions.map((transition) => {
      const service = canonicalService(simulation, transition.serviceId);
      const verb: Record<CanonicalServiceTransition["operation"], string> = {
        enable: "Enabled",
        disable: "Disabled",
        start: "Started",
        stop: "Stopped",
        restart: "Restarted",
        reload: "Reloaded",
        daemon_reload: "Reloaded manager configuration for",
        mask: "Masked",
        unmask: "Unmasked",
        activate: "Activated",
        complete: "Completed",
        fail: "Failed",
      };
      const state = `${transition.resultingState.loadState}/${transition.resultingState.activeState}/${transition.resultingState.subState}`;
      const result = transition.resultingState.result === "none" ? "" : ` result=${transition.resultingState.result}`;
      const mainPid = transition.resultingState.mainProcessId
        ? ` main_pid=${simulation.processes.find((process) => process.id === transition.resultingState.mainProcessId)?.pid || ""}`
        : "";
      return `${transition.occurredAt} ${hostname} systemd[1]: ${verb[transition.operation]} ${service.unitName}. state=${state}${result}${mainPid} activity_ref="${service.unitName} ${transition.operation} at ${transition.occurredAt}"`;
    }),
  ].sort();
  const earliest = entries[0]?.slice(0, 19) || simulation.collection.earliestAllowedEvent;
  return `-- Journal begins at ${earliest} UTC --\n${entries.join("\n")}\n`;
}

export function simulationServiceAuditLines(simulation: LinuxSimulationWorld) {
  return simulation.serviceTransitions.map((transition) => {
    const service = canonicalService(simulation, transition.serviceId);
    const auditType =
      transition.operation === "start" ? "SERVICE_START" :
      transition.operation === "stop" ? "SERVICE_STOP" :
      transition.operation === "reload" ? "SERVICE_RELOAD" :
      transition.operation === "restart" ? "SERVICE_RESTART" :
      transition.operation === "enable" || transition.operation === "disable" ? "SERVICE_CONFIG" :
      "SERVICE_STATE";
    const cause = transition.cause?.type === "command" ? ` cause="observed command"` : ` cause="${transition.cause?.type || "missing"}"`;
    const serial = 3000 + simulation.serviceTransitions.findIndex((item) => item.id === transition.id);
    return `type=${auditType} msg=audit(${transition.occurredAt}): serial=${serial} event="audit:${transition.id}" pid=${transition.processId || 1} unit="${service.unitName}" op="${transition.operation}" activity_ref="${service.unitName} ${transition.operation} at ${transition.occurredAt}" state="${transition.resultingState.loadState}/${transition.resultingState.unitFileState}/${transition.resultingState.activeState}/${transition.resultingState.subState}" result="${transition.resultingState.result}" res=${transition.outcome}${cause}`;
  }).join("\n");
}

export function simulationServiceSyslogLines(simulation: LinuxSimulationWorld, hostname: string) {
  return simulation.serviceTransitions.map((transition) => {
    const service = canonicalService(simulation, transition.serviceId);
    return `${transition.occurredAt} ${hostname} systemd[1]: ${service.unitName}: ${transition.operation} -> ${transition.resultingState.loadState}/${transition.resultingState.unitFileState}/${transition.resultingState.activeState}/${transition.resultingState.subState} result=${transition.resultingState.result} activity_ref="${service.unitName} ${transition.operation} at ${transition.occurredAt}"`;
  }).join("\n");
}

export function simulationCronLog(simulation: LinuxSimulationWorld, hostname: string) {
  return simulation.scheduledExecutions
    .filter((execution) => execution.definitionId)
    .map((execution) => {
      const definition = simulation.cronDefinitions.find((item) => item.id === execution.definitionId);
      const command = simulation.commands.find((item) => item.id === execution.commandId);
      const runAs = definition ? canonicalIdentity(simulation, definition.runAsIdentityId) : canonicalIdentity(simulation, command?.actorIdentityId || "identity:root");
      const process = simulation.processes.find((item) => item.id === execution.processId);
      return `${execution.occurredAt} ${hostname} CRON[${process?.pid || 1}]: (${runAs.username}) CMD (${command?.renderedCommand || execution.commandId}) job_ref="${linuxLearnerSubjectLabel(simulation, execution.id)}" def="${definition?.id || "missing"}" source_ref="${definition?.sourcePath || "missing"}"`;
    })
    .sort()
    .join("\n");
}

export function simulationRootCrontab(simulation: LinuxSimulationWorld) {
  const rows = [
    "SHELL=/bin/sh",
    "PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin",
    ...simulation.cronDefinitions
      .filter((definition) => definition.source === "root_crontab" && definition.enabled && definition.persistenceState === "present")
      .map((definition) => {
        const command = simulation.commands.find((item) => item.id === definition.commandId);
        return `${definition.schedule} ${command?.renderedCommand || definition.commandId} # ${definition.id} source=${definition.sourcePath}`;
      }),
  ];
  return `${rows.join("\n")}\n`;
}

export function simulationCronDAssets(simulation: LinuxSimulationWorld) {
  return simulation.cronDefinitions
    .filter((definition) => definition.source === "cron_d" && definition.enabled && definition.persistenceState === "present")
    .map((definition) => {
      const runAs = canonicalIdentity(simulation, definition.runAsIdentityId);
      const command = simulation.commands.find((item) => item.id === definition.commandId);
      const name = definition.sourcePath.split("/").pop() || definition.id.replace(/[^a-z0-9-]+/gi, "-");
      return {
        fileName: name,
        filePath: `assets/scheduled/cron.d/${name}`,
        content: `SHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin\n\n${definition.schedule} ${runAs.username} ${command?.renderedCommand || definition.commandId} # ${definition.id} source=${definition.sourcePath}\n`,
      };
    });
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `"'"`)}'`;
}

function scriptImplementationLines(scriptPath: string, command: CanonicalCommand, simulation: LinuxSimulationWorld) {
  const basename = scriptPath.split("/").pop()?.replace(/\.sh$/i, "") || "scheduled-job";
  const affectedFiles = command.affectedFileIds
    .map((fileId) => simulation.files.find((file) => file.id === fileId))
    .filter((file): file is CanonicalFile => Boolean(file))
    .filter((file) => file.path !== scriptPath);
  if (/platform-sync\.sh$/i.test(scriptPath)) {
    return [
      "set -euo pipefail",
      "rsync -a /srv/platform/cache/ /var/lib/platform/sync/",
      "logger -t platform-sync platform sync completed",
    ];
  }
  const logPath = affectedFiles.find((file) => file.path.startsWith("/var/log/"))?.path;
  const dataPath = affectedFiles.find((file) => !file.path.startsWith("/var/log/") && file.fileType === "regular")?.path;
  return [
    "set -euo pipefail",
    logPath ? `printf '%s\\n' ${shellQuote(`${basename} completed`)} >> ${shellQuote(logPath)}` : "true",
    dataPath ? `test -e ${shellQuote(dataPath)} || touch ${shellQuote(dataPath)}` : undefined,
    `logger -t ${basename} ${shellQuote(`${basename} completed`)}`,
  ].filter((line): line is string => Boolean(line));
}

function scriptInvokesItself(content: string, sourcePath: string) {
  const escapedPath = sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const basename = sourcePath.split("/").pop() || sourcePath;
  const escapedBase = basename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = new RegExp(`(?:^|[;&|()\\s])(?:sudo\\s+)?(?:bash\\s+|sh\\s+|exec\\s+|source\\s+|\\.\\s+)?${escapedPath}(?:\\s|$)`, "i");
  const indirect = new RegExp(`(?:^|[;&|()\\s])(?:bash\\s+|sh\\s+|exec\\s+|source\\s+|\\.\\s+)(?:\\./)?${escapedBase}(?:\\s|$)`, "i");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .some((line) => direct.test(line) || indirect.test(line));
}
export function simulationScriptAssets(simulation: LinuxSimulationWorld) {
  return simulation.scheduledExecutions
    .map((execution) => {
      const command = simulation.commands.find((item) => item.id === execution.commandId);
      const script = command?.affectedFileIds
        .map((fileId) => canonicalFile(simulation, fileId))
        .find((file) => file.contentRole === "script");
      if (!command || !script) return undefined;
      const fileName = script.path.split("/").pop() || "scheduled-job.sh";
      const filePath = `assets/scripts/${fileName}`;
      const definition = execution.definitionId
        ? simulation.cronDefinitions.find((item) => item.id === execution.definitionId)
        : undefined;
      const runAs = definition ? canonicalIdentity(simulation, definition.runAsIdentityId) : undefined;
      const body = [
        "#!/usr/bin/env bash",
        `# source_path=${script.path}`,
        definition ? `# cron_source=${definition.sourcePath}` : undefined,
        definition ? `# schedule=${definition.schedule}` : undefined,
        runAs ? `# run_as=${runAs.username}` : undefined,
        "",
        ...scriptImplementationLines(script.path, command, simulation),
      ].filter(Boolean).join("\n");
      return {
        fileName,
        filePath,
        sourcePath: script.path,
        content: `${body}\n`,
        subjectIds: Array.from(new Set([
          script.id,
          command.id,
          command.runAsIdentityId,
          command.actorIdentityId,
          execution.definitionId,
        ].filter((id): id is string => Boolean(id)))),
      };
    })
    .filter((item): item is {
      fileName: string;
      filePath: string;
      sourcePath: string;
      content: string;
      subjectIds: string[];
    } => Boolean(item))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

/** Only permissions represented by the learner-visible identity/file model
 * count here. In particular, adm membership with mode 0640 is read-only. */
export function canEffectiveIdentityWriteFile(
  effectiveUid: number,
  effectiveGroupGids: readonly number[],
  file: Pick<CanonicalFile, "ownerUid" | "groupGid" | "mode">
) {
  if (effectiveUid === 0) return true;
  if (effectiveUid === file.ownerUid) return (file.mode & 0o200) !== 0;
  if (effectiveGroupGids.includes(file.groupGid)) return (file.mode & 0o020) !== 0;
  return (file.mode & 0o002) !== 0;
}

export function validateScheduledScriptWriteFeasibility(
  simulation: LinuxSimulationWorld,
  assets: { file_path: string; content: string }[]
) {
  const groupSample = assetContent(assets, "assets/accounts/group.sample");
  const supplementaryGids = new Map<string, Set<number>>();
  for (const line of groupSample.split(/\r?\n/)) {
    const [, , gidText, members = ""] = line.split(":");
    const gid = Number(gidText);
    if (!Number.isInteger(gid) || gid < 0) continue;
    for (const username of members.split(",").map((value) => value.trim()).filter(Boolean)) {
      if (!supplementaryGids.has(username)) supplementaryGids.set(username, new Set());
      supplementaryGids.get(username)!.add(gid);
    }
  }
  const permissions = new Map(parseRenderedPermissionRows(assetContent(assets, "assets/reports/permissions_report.txt"))
    .map((row) => [row.path, row]));
  const scripts = simulationScriptAssets(simulation);
  for (const scheduled of simulation.scheduledExecutions) {
    const command = simulation.commands.find((item) => item.id === scheduled.commandId);
    const process = simulation.processes.find((item) => item.id === scheduled.processId);
    const script = scripts.find((item) => command?.affectedFileIds.some((id) =>
      simulation.files.find((file) => file.id === id)?.path === item.sourcePath));
    if (!command || !process || !script) continue;
    const identity = canonicalIdentity(simulation, process.identityId);
    const effectiveGids = [process.effectiveGid, ...(supplementaryGids.get(identity.username) || [])];
    const lines = script.content.split(/\r?\n/);
    const strictLine = lines.findIndex((line) => /^set\s+-[^\n]*e/.test(line.trim()));
    for (let index = 0; index < lines.length; index++) {
      const append = lines[index].match(/>>\s*'([^']+)'/);
      if (!append) continue;
      const file = simulation.files.find((item) => item.path === append[1] && command.affectedFileIds.includes(item.id));
      if (!file || file.fileType !== "regular") {
        throw new Error(`Linux scheduled script write feasibility failed: ${script.sourcePath} appends to unmodelled regular file ${append[1]}.`);
      }
      const group = simulation.groups.find((item) => item.id === file.groupId);
      const row = permissions.get(file.path);
      if (!group || !row || row.owner !== canonicalIdentity(simulation, file.ownerIdentityId).username ||
          row.group !== group.name || row.mode !== canonicalModeString(file)) {
        throw new Error(`Linux scheduled script write feasibility failed: ${file.path} metadata disagrees with learner permissions report.`);
      }
      if (canEffectiveIdentityWriteFile(process.effectiveUid, effectiveGids, file)) continue;
      const strictFailure = strictLine >= 0 && strictLine < index;
      const jobRef = linuxLearnerSubjectLabel(simulation, scheduled.id);
      const observedLogger = assetContent(assets, "assets/logs/syslog").split(/\r?\n/).some((line) =>
        line.includes(`job_ref="${jobRef}"`) && line.includes("logger_tag="));
      const completed = scheduledExecutionRenderedPhase(simulation, scheduled).phase === "completed";
      if (strictFailure && (observedLogger || completed)) {
        throw new Error(`Linux scheduled script write feasibility failed: ${identity.username} cannot append ${file.path} under set -e before logger/completion (${scheduled.id}).`);
      }
      if (scheduled.outcome === "success") {
        throw new Error(`Linux scheduled script write feasibility failed: successful ${scheduled.id} cannot append ${file.path}.`);
      }
    }
  }
}

export function simulationBackgroundAuditLines(simulation: LinuxSimulationWorld) {
  const accessByCommand = new Map<string, CanonicalHistoricalFileAccessRecord[]>();
  for (const record of canonicalHistoricalFileAccessRecords(simulation)) {
    accessByCommand.set(record.sourceCommandId, [...(accessByCommand.get(record.sourceCommandId) || []), record]);
  }
  const scheduled = simulation.scheduledExecutions.map((execution, executionIndex) => {
    const command = simulation.commands.find((item) => item.id === execution.commandId);
    const process = simulation.processes.find((item) => item.id === execution.processId);
    if (!command || !process) return "";
    const identity = canonicalIdentity(simulation, command.actorIdentityId);
    const serial = 2000 + executionIndex;
    const eventId = `audit:${execution.id}`;
    const fileLines = (accessByCommand.get(command.id) || []).map((record) => {
      const file = canonicalFile(simulation, record.fileId);
      return `type=PATH msg=audit(${record.timestamp}): serial=${serial} event="${eventId}" pid=${process.pid} ppid=${process.ppid} item=${record.operationIndex} name="${file.path}" inode=${file.inode} mode=${canonicalAuditMode(file)} ouid=${file.ownerUid} ogid=${file.groupGid}`;
    });
    return [
      `type=USER_CMD msg=audit(${execution.occurredAt}): serial=${serial} event="${eventId}" pid=${process.pid} ppid=${process.ppid} cwd="${auditQuoted(command.cwd)}" cmd="${auditQuoted(renderCommandInvocation(command))}" auid=${identity.uid} uid=${process.effectiveUid} res=success job_ref="${linuxLearnerSubjectLabel(simulation, execution.id)}" def="${execution.definitionId || "missing"}"`,
      ...fileLines,
    ].join("\n");
  }).filter(Boolean);
  const packages = simulation.packageTransactions.map((transaction, transactionIndex) => {
    const command = transaction.commandId ? simulation.commands.find((item) => item.id === transaction.commandId) : undefined;
    const process = simulation.processes.find((item) => item.id === transaction.processIds[0]);
    if (!command || !process) return "";
    const identity = canonicalIdentity(simulation, transaction.actorIdentityId);
    const serial = 2500 + transactionIndex;
    const eventId = `audit:${transaction.id}`;
    const fileLines = (accessByCommand.get(command.id) || []).map((record) => {
      const file = canonicalFile(simulation, record.fileId);
      return `type=PATH msg=audit(${record.timestamp}): serial=${serial} event="${eventId}" pid=${process.pid} ppid=${process.ppid} item=${record.operationIndex} name="${file.path}" inode=${file.inode} mode=${canonicalAuditMode(file)} ouid=${file.ownerUid} ogid=${file.groupGid}`;
    });
    return [
      `type=USER_CMD msg=audit(${transaction.startedAt}): serial=${serial} event="${eventId}" pid=${process.pid} ppid=${process.ppid} cwd="${auditQuoted(command.cwd)}" cmd="${auditQuoted(renderCommandInvocation(command))}" auid=${identity.uid} uid=${process.effectiveUid} res=success transaction_ref="${linuxLearnerSubjectLabel(simulation, transaction.id)}"`,
      ...fileLines,
    ].join("\n");
  }).filter(Boolean);
  return [...scheduled, ...packages].join("\n");
}

export function simulationBackgroundSyslogLines(simulation: LinuxSimulationWorld, hostname: string) {
  const scripts = simulationScriptAssets(simulation);
  return simulation.scheduledExecutions.map((execution) => {
    const command = simulation.commands.find((item) => item.id === execution.commandId);
    const process = simulation.processes.find((item) => item.id === execution.processId);
    const script = command?.affectedFileIds.map((fileId) => canonicalFile(simulation, fileId)).find((file) => file.contentRole === "script");
    const event = scheduledExecutionRenderedPhase(simulation, execution);
    const summary = event.phase === "completed" ? execution.stdoutSummary || "scheduled job completed" :
      event.phase === "started" ? "scheduled job started" :
      event.phase === "failed" ? "scheduled job failed" : "scheduled job ended; outcome unconfirmed";
    if (!process) return "";
    const processTag = process.executable.split("/").pop() || process.executable;
    const loggerTag = event.phase === "completed"
      ? scripts.find((item) => item.sourcePath === script?.path)?.content.match(/\blogger\s+-t\s+([^\s'";]+)/)?.[1]
      : undefined;
    return `${event.timestamp} ${hostname} ${processTag}[${process.pid}]: ${summary} job_ref="${linuxLearnerSubjectLabel(simulation, execution.id)}" def="${execution.definitionId || "missing"}"${loggerTag ? ` logger_tag="${loggerTag}"` : ""}`;
  }).filter(Boolean).sort().join("\n");
}

export function simulationPackageInventory(simulation: LinuxSimulationWorld) {
  const rows = [
    "Desired=Unknown/Install/Remove/Purge/Hold",
    "| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend",
    "|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)",
    "||/ Name                         Version                      Architecture Description",
    "+++-============================-============================-============-=================================",
    "ii  bash                         5.2.21-2ubuntu4             amd64        GNU Bourne Again SHell",
    "ii  cron                         3.0pl1-184ubuntu2           amd64        process scheduling daemon",
    "ii  openssh-server               1:9.6p1-3ubuntu13.5         amd64        secure shell server",
  ];
  for (const transaction of simulation.packageTransactions) {
    for (const pkg of transaction.packages) {
      rows.push(`ii  ${pkg.name.padEnd(28)} ${String(pkg.resultingVersion || "1.0").padEnd(28)} amd64        ${transaction.source} ${transaction.action} result`);
    }
  }
  return `${rows.join("\n")}\n`;
}

export function simulationAptHistory(simulation: LinuxSimulationWorld) {
  return simulation.packageTransactions.map((transaction) => {
    const actor = canonicalIdentity(simulation, transaction.actorIdentityId);
    const command = transaction.commandId ? simulation.commands.find((item) => item.id === transaction.commandId) : undefined;
    const actionLabel = transaction.action[0].toUpperCase() + transaction.action.slice(1);
    return [
      `Transaction-Ref: ${linuxLearnerSubjectLabel(simulation, transaction.id)}`,
      `Start-Date: ${transaction.startedAt.slice(0, 10)}  ${transaction.startedAt.slice(11, 19)}`,
      `Commandline: ${command?.renderedCommand || transaction.source}`,
      transaction.source === "manual" ? `Requested-By: ${actor.username} (${actor.uid})` : undefined,
      `${actionLabel}: ${transaction.packages.map((pkg) => `${pkg.name}:amd64 (${pkg.resultingVersion || "1.0"})`).join(", ")}`,
      `End-Date: ${transaction.completedAt.slice(0, 10)}  ${transaction.completedAt.slice(11, 19)}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n") + "\n";
}

export function simulationScriptSample(simulation: LinuxSimulationWorld) {
  const execution = simulation.scheduledExecutions[0];
  const command = execution ? simulation.commands.find((item) => item.id === execution.commandId) : undefined;
  const script = command?.affectedFileIds.map((fileId) => canonicalFile(simulation, fileId)).find((file) => file.contentRole === "script");
  const family = simulation.backgroundProfile.permittedJobFamilies[0] || "operations";
  return `#!/usr/bin/env bash
set -euo pipefail

# Operational ${family} job sample from ${simulation.backgroundProfile.hostRole}
${command?.renderedCommand || "systemctl is-active --quiet rsyslog.service"}
logger "${script?.path || "/usr/local/sbin/log-retention-cleanup.sh"} completed"
`;
}

function narrativeTimestampsForTask(simulation: LinuxSimulationWorld, selected: CanonicalEvidenceAsset[], task: CanonicalInvestigationTask) {
  const values = new Set<string>([
    simulation.collection.collectedAt,
    `${simulation.investigation.incidentDate} ${simulation.investigation.incidentWindowStart}`,
    `${simulation.investigation.incidentDate} ${simulation.investigation.incidentWindowEnd}`,
  ]);
  const selectedEventIds = new Set(selected.flatMap((asset) => asset.eventIds || []));
  for (const event of simulation.events) {
    if (selectedEventIds.has(event.id) || task.canonicalObjectIds.includes(event.id)) values.add(event.timestamp);
  }
  for (const session of simulation.sshSessions) {
    if (task.canonicalObjectIds.includes(session.id) || selected.some((asset) => asset.canonicalObjectIds.includes(session.id))) {
      values.add(session.openedAt);
      if (session.closedAt) values.add(session.closedAt);
    }
  }
  for (const execution of simulation.executions) {
    if (task.canonicalObjectIds.includes(execution.id) || selected.some((asset) => asset.canonicalObjectIds.includes(execution.id))) {
      values.add(execution.startTime);
      if (execution.endTime) values.add(execution.endTime);
    }
  }
  for (const scheduled of simulation.scheduledExecutions) {
    if (task.canonicalObjectIds.includes(scheduled.id) || selected.some((asset) => asset.canonicalObjectIds.includes(scheduled.id))) {
      values.add(scheduled.occurredAt);
    }
  }
  for (const transition of simulation.serviceTransitions) {
    if (task.canonicalObjectIds.includes(transition.id) || selected.some((asset) => asset.canonicalObjectIds.includes(transition.id))) {
      values.add(transition.occurredAt);
    }
  }
  for (const transaction of simulation.packageTransactions) {
    if (task.canonicalObjectIds.includes(transaction.id) || selected.some((asset) => asset.canonicalObjectIds.includes(transaction.id))) {
      values.add(transaction.startedAt);
      values.add(transaction.completedAt);
    }
  }
  return Array.from(values).filter(Boolean).sort();
}

function narrativeSubjectsForTask(simulation: LinuxSimulationWorld, task: CanonicalInvestigationTask, selected: CanonicalEvidenceAsset[]) {
  const subjectIds = Array.from(new Set([
    ...task.primarySubjectIds,
    ...task.requirements.flatMap((requirement) => requirement.subjectIds),
    ...selected.flatMap((asset) => asset.canonicalObjectIds).slice(0, 12),
  ])).slice(0, 24);
  return subjectIds.map((id) => ({
    id,
    label: linuxLearnerSubjectLabel(simulation, id),
    type: linuxSubjectRef(id).type,
  }));
}

function narrativeRelationshipsForTask(simulation: LinuxSimulationWorld, selected: CanonicalEvidenceAsset[], task: CanonicalInvestigationTask) {
  const requiredRelations = new Set(task.requirements.map((requirement) => requirement.relation).filter(Boolean));
  const subjectIds = new Set(task.canonicalObjectIds);
  return Array.from(new Map(
    selected
      .flatMap((asset) => asset.relations || [])
      .filter((relation) =>
        (!requiredRelations.size || requiredRelations.has(relation.relation)) &&
        relation.subjectIds.every((id) => subjectIds.has(id) || selected.some((asset) => asset.canonicalObjectIds.includes(id)))
      )
      .map((relation) => [
        `${relation.relation}:${relation.subjectIds.join("|")}`,
        {
          relation: relation.relation,
          subjectIds: relation.subjectIds,
          subjectLabels: [],
        },
      ])
  ).values()).slice(0, 16);
}

function narrativeFactList(prefix: string, values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).slice(0, 16).map((value) => `${prefix}: ${value}`);
}

export function buildLinuxNarrativeContract(
  simulation: LinuxSimulationWorld,
  renderedAssetPaths?: string[]
): LinuxNarrativeContract {
  assertLinuxTaskEvidenceClosureInvariant(simulation, renderedAssetPaths);
  const renderedPathSet = renderedAssetPaths
    ? new Set(renderedAssetPaths.map(normalizeLinuxEvidencePath))
    : undefined;
  const planningById = new Map(simulation.planningEvidenceRegistry.map((asset) => [asset.id, asset]));
  const tasks = simulation.canonicalTasks.slice().sort((left, right) => left.order - right.order);
  const taskContracts = tasks.map((task): LinuxNarrativeTaskContract => {
    const selected = task.selectedEvidenceAssetIds
      .map((id) => planningById.get(id))
      .filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset));
    const closure = taskEvidenceClosureResult({
      simulation,
      intent: task.intent,
      difficulty: task.difficulty,
      requiredCapabilities: task.requiredCapabilities,
      currentStateRequirements: task.currentStateRequirements,
      requirements: task.requirements,
      registry: simulation.planningEvidenceRegistry,
      selected,
      renderedPaths: renderedPathSet,
      limit: TASK_EVIDENCE_LIMIT,
      minimumEvidenceCount: task.difficulty === "Advanced" ? 2 : 1,
      candidateEvidenceConsidered: simulation.planningEvidenceRegistry.map((asset) => asset.path),
      rejectedCandidates: [],
    });
    if (!closure.satisfied) {
      throw new Error(`Linux narrative contract cannot be built for ${task.id}: evidence closure is unsatisfied.`);
    }
    const currentCapabilities = new Set(task.currentStateRequirements.map((requirement) => requirement.capability));
    const historicalCapabilities = task.requiredCapabilities.filter((capability) => !currentCapabilities.has(capability));
    return {
      taskId: task.id,
      order: task.order,
      intent: task.intent,
      objective: task.stepLabel || linuxTaskContract(task.intent).label,
      deliverableType: task.expectedDeliverableType,
      requiredCapabilities: task.requiredCapabilities,
      selectedEvidence: selected.map((asset) => ({
        id: asset.id,
        path: asset.path,
        displayName: asset.displayName,
        capabilities: asset.capabilities,
        support: asset.support,
        stateType: asset.stateType,
      })),
      groundedSubjects: narrativeSubjectsForTask(simulation, task, selected),
      groundedRelationships: narrativeRelationshipsForTask(simulation, selected, task),
      allowedTimestamps: narrativeTimestampsForTask(simulation, selected, task),
      allowedObservedFacts: narrativeFactList("selected evidence supports", task.requiredCapabilities.map(linuxLearnerCapabilityLabel)),
      allowedCurrentStateFacts: narrativeFactList("current-state evidence supports", Array.from(currentCapabilities).map(linuxLearnerCapabilityLabel)),
      allowedHistoricalFacts: narrativeFactList("historical evidence supports", historicalCapabilities.map(linuxLearnerCapabilityLabel)),
      allowedBoundedInferences: [
        "state uncertainty where selected evidence is incomplete",
        "consistency or inconsistency with rendered change and maintenance records",
        "additional evidence needed to confirm unresolved conclusions",
      ],
      allowedRecommendationCategories: task.intent === "containment_recommendation" || task.intent === "risk_assessment" || task.intent === "impact_assessment"
        ? ["evidence-preserving containment", "validation before action", "bounded escalation notes"]
        : ["evidence gaps and next validation step only"],
      prohibitedClaims: [
        "unsupported root cause",
        "attacker identity",
        "confirmed compromise unless selected evidence directly supports it",
        "current state inferred from historical evidence",
        "unrendered evidence",
        "local filesystem or source-code paths",
      ],
      evidenceClosure: {
        satisfied: closure.satisfied,
        requiredCapabilities: closure.requiredCapabilities,
        satisfiedCapabilities: closure.satisfiedCapabilities,
        requiredCurrentStateCapabilities: closure.requiredCurrentStateCapabilities,
        requiredCanonicalSubjects: closure.requiredCanonicalSubjects,
        groundedCanonicalSubjects: closure.groundedCanonicalSubjects,
        requiredRelationships: closure.requiredRelationships,
        groundedRelationships: closure.groundedRelationships,
      },
    };
  });
  const selectedPaths = new Set(taskContracts.flatMap((task) => task.selectedEvidence.map((asset) => normalizeLinuxEvidencePath(asset.path))));
  const globalSubjects = Array.from(new Map(taskContracts
    .flatMap((task) => task.groundedSubjects)
    .map((subject) => [subject.id, subject])).values()).slice(0, 20);
  const globalTimestamps = Array.from(new Set(taskContracts.flatMap((task) => task.allowedTimestamps))).sort();
  const selectedCapabilities = new Set(taskContracts.flatMap((task) => task.requiredCapabilities));
  const difficulty = (tasks[0]?.difficulty || "Advanced") as CanonicalInvestigationTask["difficulty"];
  return Object.freeze({
    version: "linux-narrative-contract-v1",
    caseId: simulation.investigation.incidentId,
    difficulty,
    incidentFamily: simulation.investigation.incidentFamily,
    scenarioFraming: {
      hostname: simulation.investigation.hostname,
      hostRole: simulation.investigation.hostRole,
      hostIp: simulation.investigation.hostIp,
      ticketId: simulation.investigation.ticketId,
      changeId: simulation.investigation.changeId,
      incidentWindow: `${simulation.investigation.incidentWindowStart}-${simulation.investigation.incidentWindowEnd}`,
      timezone: simulation.investigation.timezone,
      collectionTime: simulation.collection.collectedAt,
      primaryService: canonicalPrimaryService(simulation).unitName,
      supportingServices: canonicalSecondaryServices(simulation).map((service) => service.unitName).slice(0, 8),
    },
    globalRenderedEvidencePaths: Array.from(selectedPaths).sort(),
    globalGroundedSubjects: globalSubjects,
    globalGroundedRelationships: [],
    globalAllowedTimestamps: globalTimestamps,
    canonicalTaskCount: taskContracts.length,
    taskContracts,
    prohibitedEvidencePaths: [],
    prohibitedCapabilityClaims: Array.from(new Set(simulation.evidenceRegistry
      .filter((asset) => !selectedPaths.has(normalizeLinuxEvidencePath(asset.path)))
      .flatMap((asset) => asset.capabilities)
      .filter((capability) => !selectedCapabilities.has(capability)))).sort(),
    narrativeConstraints: {
      claimClasses: ["observed", "historical_state", "current_state", "bounded_inference", "recommendation"],
      prohibitedClaimCategories: [
        "root cause certainty",
        "attacker attribution",
        "data exfiltration",
        "malware declaration",
        "business impact not in rendered evidence",
        "current state without current-state evidence",
      ],
      lowerTierAdvancedLeakageRules: difficulty === "Advanced" ? [] : [
        "Do not mention Advanced-only runtime snapshots unless selected.",
        "Do not mention open-file, listener, package inventory, cron definition, current sudo policy, maintenance, or change evidence unless selected.",
      ],
      recommendationScope: Array.from(new Set(taskContracts.flatMap((task) => task.allowedRecommendationCategories))),
    },
  } satisfies LinuxNarrativeContract);
}

export function serializeLinuxNarrativeContract(contract: LinuxNarrativeContract) {
  return JSON.stringify(contract);
}

export function buildLinuxCanonicalNarrativeBrief(input: LinuxSimulationWorld | LinuxNarrativeContract) {
  const contract = "version" in input && input.version === "linux-narrative-contract-v1"
    ? input
    : buildLinuxNarrativeContract(input);
  return serializeLinuxNarrativeContract(contract);
}

function assetContent(assets: { file_path: string; content: string }[], filePath: string) {
  const asset = assets.find((item) => item.file_path === filePath);
  if (!asset) throw new Error(`Linux simulation validation failed: missing ${filePath}.`);
  return asset.content;
}

function includesAll(haystack: string, needles: string[], label: string) {
  for (const needle of needles) {
    if (!haystack.includes(needle)) {
      throw new Error(`Linux simulation validation failed: ${label} missing ${needle}.`);
    }
  }
}

function processAppearsInSnapshot(processSnapshot: string, pid: number) {
  return new RegExp(`\\s${pid}\\s+\\d+\\s+`).test(processSnapshot);
}

function validateCanonicalSystemdState(
  simulation: LinuxSimulationWorld,
  service: CanonicalService,
  processSnapshot: string,
) {
  const role = service.role;
  const label = `${service.unitName} (${role})`;
  if (!service.unitPresent) {
    if (service.loadState !== "not-found") throw new Error(`Linux simulation validation failed: ${label} absent unit has load state ${service.loadState}.`);
    if (service.activeState !== "inactive" || service.subState !== "dead") throw new Error(`Linux simulation validation failed: ${label} absent unit is ${service.activeState}/${service.subState}.`);
    if (service.mainProcessId) throw new Error(`Linux simulation validation failed: ${label} absent unit has main PID.`);
  }
  if (service.loadState === "not-found" && (service.activeState !== "inactive" || service.unitFileState === "enabled")) {
    throw new Error(`Linux simulation validation failed: ${label} not-found unit has contradictory state ${service.unitFileState}/${service.activeState}.`);
  }
  if (service.unitFileState === "masked" && service.loadState !== "masked") {
    throw new Error(`Linux simulation validation failed: ${label} masked unit has load state ${service.loadState}.`);
  }
  if (service.activeState === "active" && service.subState === "dead") {
    throw new Error(`Linux simulation validation failed: ${label} is active/dead.`);
  }
  if (service.activeState === "inactive" && service.subState === "running") {
    throw new Error(`Linux simulation validation failed: ${label} is inactive/running.`);
  }
  if (service.activeState === "failed" && service.result === "success") {
    throw new Error(`Linux simulation validation failed: ${label} failed with success result.`);
  }
  if (service.activeState !== "failed" && service.subState !== "failed" && service.result !== "none" && service.result !== "success") {
    throw new Error(`Linux simulation validation failed: ${label} has failure result ${service.result} without failed state.`);
  }
  if (service.unitFileState === "static" && simulation.serviceTransitions.some((transition) => transition.serviceId === service.id && transition.operation === "enable" && transition.outcome === "success")) {
    throw new Error(`Linux simulation validation failed: ${label} static unit has successful enable transition.`);
  }
  const mainProcess = service.mainProcessId ? simulation.processes.find((process) => process.id === service.mainProcessId) : undefined;
  if (service.activeState === "active" && service.subState === "running" && service.mainProcessId) {
    if (!mainProcess) throw new Error(`Linux simulation validation failed: ${label} main process ${service.mainProcessId} missing.`);
    if (processSnapshot && !processAppearsInSnapshot(processSnapshot, mainProcess.pid)) {
      throw new Error(`Linux simulation validation failed: ${label} main PID ${mainProcess.pid} missing from process_snapshot.txt.`);
    }
    if (service.lastTransitionAt && mainProcess.startedAt > service.lastTransitionAt) {
      throw new Error(`Linux simulation validation failed: ${label} main process starts after active transition.`);
    }
    if (mainProcess.endedAt && mainProcess.endedAt <= simulation.collection.windowEnd) {
      throw new Error(`Linux simulation validation failed: ${label} main process ended before collection.`);
    }
  }
  if (
    service.unitType === "simple" &&
    service.serviceType === "long-running" &&
    service.activeState === "active" &&
    service.subState === "running" &&
    !service.mainProcessId
  ) {
    throw new Error(`Linux simulation validation failed: ${label} is a running long-lived service without a main PID.`);
  }
  if ((service.activeState !== "active" || service.subState !== "running") && service.mainProcessId) {
    throw new Error(`Linux simulation validation failed: ${label} non-running unit has main PID ${service.mainProcessId}.`);
  }
}

function commandEvidenceText(command: CanonicalCommand) {
  return [command.renderedCommand, renderCommandInvocation(command)];
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (quoted && char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function parseCsvObjects(content: string) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = lines[0] ? parseCsvLine(lines[0]) : [];

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function isCanonicalTimestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value.replace(" ", "T")}Z`));
}

function canonicalTimestampMs(value: string) {
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function deterministicFileAccessTimestamp(
  process: CanonicalProcess,
  operationIndex: number,
  fallbackEnd: string
) {
  const startedMs = parseTimestamp(process.startedAt);
  const endedMs = parseTimestamp(process.endedAt || fallbackEnd);
  const maxOffsetSeconds = Math.max(0, Math.floor((endedMs - startedMs) / 1000));
  const offsetSeconds = Math.min(operationIndex, maxOffsetSeconds);

  return formatUtcTimestamp(new Date(startedMs + offsetSeconds * 1000));
}

export function canonicalHistoricalFileAccessRecords(
  simulation: LinuxSimulationWorld
): CanonicalHistoricalFileAccessRecord[] {
  const executionById = new Map(simulation.executions.map((execution) => [execution.id, execution]));
  const processByPid = new Map(simulation.processes.map((process) => [process.pid, process]));
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));
  const records: CanonicalHistoricalFileAccessRecord[] = [];
  const orderedCommands = simulation.commands
    .filter((command) => command.affectedFileIds.length > 0)
    .sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp) ||
      left.processId - right.processId ||
      left.id.localeCompare(right.id)
    );

  for (const command of orderedCommands) {
    if (!command.executionId) {
      throw new Error(
        `Linux simulation validation failed: file_access_history source command ${command.id} has no canonical execution reference.`
      );
    }

    const execution = executionById.get(command.executionId);
    if (!execution) {
      throw new Error(
        `Linux simulation validation failed: file_access_history source command ${command.id} references missing execution ${command.executionId}.`
      );
    }

    const process = processByPid.get(command.processId);
    const executionProcess = execution.processId
      ? processById.get(execution.processId)
      : execution.hostProcessId
        ? processById.get(execution.hostProcessId)
        : undefined;

    if (!process || !executionProcess || process.id !== executionProcess.id) {
      throw new Error(
        `Linux simulation validation failed: file_access_history source command ${command.id} process ${command.processId} does not resolve to execution ${execution.id}.`
      );
    }

    if (command.timestamp < process.startedAt || (process.endedAt && command.timestamp > process.endedAt)) {
      throw new Error(
        `Linux simulation validation failed: file_access_history source command ${command.id} timestamp ${command.timestamp} outside process ${process.id} lifetime ${process.startedAt}..${process.endedAt || simulation.collection.collectedAt}.`
      );
    }

    command.affectedFileIds.forEach((fileId, operationIndex) => {
      const file = canonicalFile(simulation, fileId);
      const timestamp = deterministicFileAccessTimestamp(
        process,
        operationIndex,
        process.endedAt || simulation.collection.collectedAt
      );

      records.push({
        sourceType: "execution",
        sourceExecutionId: execution.id,
        sourceCommandId: command.id,
        sourceProcessId: process.id,
        timestamp,
        allowedStart: process.startedAt,
        allowedEnd: process.endedAt || simulation.collection.collectedAt,
        operationIndex,
        pid: process.pid,
        userIdentityId: command.runAsIdentityId || command.actorIdentityId,
        renderedCommand: renderCommandInvocation(command),
        fileId,
        filePath: file.path,
      });
    });
  }

  return records;
}

function fileAccessKey(input: { pid: number | string; command: string; path: string }) {
  return `${input.pid}\u0000${input.command}\u0000${input.path}`;
}

function validateHistoricalFileAccessChronology(input: {
  simulation: LinuxSimulationWorld;
  fileAccessHistory: string;
  timeline: string;
}) {
  const expectedRecords = canonicalHistoricalFileAccessRecords(input.simulation);
  const rows = parseCsvObjects(input.fileAccessHistory);
  const rowsByKey = new Map(rows.map((row) => [fileAccessKey({ pid: row.pid, command: row.command, path: row.path }), row]));
  const expectedByKey = new Map(expectedRecords.map((record) => [fileAccessKey({ pid: record.pid, command: record.renderedCommand, path: record.filePath }), record]));

  for (const record of expectedRecords) {
    const row = rowsByKey.get(fileAccessKey({ pid: record.pid, command: record.renderedCommand, path: record.filePath }));
    if (!row) {
      throw new Error(
        `Linux simulation validation failed: assets/runtime/file_access_history.csv missing source execution ${record.sourceExecutionId} command ${record.sourceCommandId} pid ${record.pid} path ${record.filePath}; expected timestamp ${record.timestamp}.`
      );
    }

    const actual = row.timestamp;
    if (!isCanonicalTimestamp(actual)) {
      throw new Error(
        `Linux simulation validation failed: assets/runtime/file_access_history.csv source execution ${record.sourceExecutionId} command ${record.sourceCommandId} has invalid timestamp ${actual}.`
      );
    }
    if (actual.slice(0, 10) !== record.timestamp.slice(0, 10)) {
      throw new Error(
        `Linux simulation validation failed: assets/runtime/file_access_history.csv source execution ${record.sourceExecutionId} command ${record.sourceCommandId} wrong date; expected ${record.timestamp.slice(0, 10)}, actual ${actual}.`
      );
    }
    if (actual < record.allowedStart) {
      throw new Error(
        `Linux simulation validation failed: assets/runtime/file_access_history.csv source execution ${record.sourceExecutionId} command ${record.sourceCommandId} occurs before process lifetime; expected ${record.allowedStart}..${record.allowedEnd}, actual ${actual}.`
      );
    }
    if (actual > record.allowedEnd) {
      throw new Error(
        `Linux simulation validation failed: assets/runtime/file_access_history.csv source execution ${record.sourceExecutionId} command ${record.sourceCommandId} occurs after process lifetime; expected ${record.allowedStart}..${record.allowedEnd}, actual ${actual}.`
      );
    }
    if (actual !== record.timestamp) {
      throw new Error(
        `Linux simulation validation failed: assets/runtime/file_access_history.csv source execution ${record.sourceExecutionId} command ${record.sourceCommandId} materially inconsistent timestamp; expected ${record.timestamp}, actual ${actual}.`
      );
    }

    const command = input.simulation.commands.find((item) => item.id === record.sourceCommandId);
    if (
      command?.expectedRenderTargets.includes("timeline") &&
      input.timeline.includes(command.renderedCommand)
    ) {
      const deltaSeconds = Math.abs(canonicalTimestampMs(actual) - canonicalTimestampMs(command.timestamp)) / 1000;
      if (deltaSeconds > 60) {
        throw new Error(
          `Linux simulation validation failed: timeline.csv and file_access_history.csv disagree for source execution ${record.sourceExecutionId}; timeline ${command.timestamp}, file access ${actual}.`
        );
      }
    }
  }

  for (const row of rows) {
    if (row.evidence_type !== "historical_file_access") continue;
    const expected = expectedByKey.get(fileAccessKey({ pid: row.pid, command: row.command, path: row.path }));
    if (!expected) {
      throw new Error(
        `Linux simulation validation failed: assets/runtime/file_access_history.csv unresolved source reference for pid ${row.pid} command ${row.command || "<empty>"} path ${row.path || "<empty>"}.`
      );
    }
  }

  const rowsByProcessCommand = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.evidence_type !== "historical_file_access") continue;
    const key = `${row.pid}\u0000${row.command}`;
    rowsByProcessCommand.set(key, [...(rowsByProcessCommand.get(key) || []), row]);
  }
  for (const [key, groupedRows] of rowsByProcessCommand) {
    for (let index = 1; index < groupedRows.length; index += 1) {
      if (groupedRows[index].timestamp < groupedRows[index - 1].timestamp) {
        throw new Error(
          `Linux simulation validation failed: assets/runtime/file_access_history.csv file operation ordering contradicts source process ${key.replace(/\u0000/g, " ")}.`
        );
      }
    }
  }
}

type RenderedOpenFileRow = {
  command: string;
  pid: string;
  user: string;
  fd?: string;
  descriptorType?: string;
  accessMode?: string;
  openedAt?: string;
  name: string;
  line: string;
};

function parseRenderedOpenFileRows(openFiles: string): RenderedOpenFileRow[] {
  return openFiles.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || /^COMMAND\s+PID\s+/i.test(trimmed)) return [];
    const parts = trimmed.split(/\s+/);
    if (!/^\d+$/.test(parts[1] || "")) return [];
    if (parts.length >= 8 && /^\d{4}-\d{2}-\d{2}$/.test(parts[6] || "")) {
      return [{
        command: parts[0],
        pid: parts[1],
        user: parts[2],
        fd: parts[3],
        descriptorType: parts[4],
        accessMode: parts[5],
        openedAt: `${parts[6]} ${parts[7]}`,
        name: parts.slice(8).join(" "),
        line: trimmed,
      }];
    }
    return [{
      command: parts[0],
      pid: parts[1],
      user: parts[2],
      name: parts.slice(3).join(" "),
      line: trimmed,
    }];
  });
}

function validateRenderedOpenFileDescriptors(input: {
  simulation: LinuxSimulationWorld;
  openFiles: string;
  processSnapshot: string;
  permissions: string;
  listeningPorts: string;
}) {
  validateCanonicalOpenFileDescriptors(input.simulation);
  const captureAt = input.simulation.collection.windowEnd;
  const rows = parseRenderedOpenFileRows(input.openFiles);
  const rowByDescriptor = new Map(rows.map((row) => [`${row.pid}:${row.fd || ""}:${row.name.replace(/\s+\(deleted\)$/, "")}`, row]));
  const currentDescriptorRows = new Set(input.simulation.openFileDescriptors
    .filter((descriptor) => descriptor.state === "current")
    .map((descriptor) => {
      const name = descriptor.targetKind === "socket"
        ? `${descriptor.protocol || "socket"} ${descriptor.localAddress || "local"}:${descriptor.localPort || ""}${descriptor.remoteAddress ? `->${descriptor.remoteAddress}:${descriptor.remotePort || ""}` : ""}`
        : descriptor.targetPath || descriptor.targetId;
      return `${descriptor.pid}:${descriptor.fd}:${name}`;
    }));
  const fdKeys = new Set<string>();
  const liveProcessPids = new Set(input.simulation.processes
    .filter((process) => isProcessAliveAtTimestamp(process, captureAt))
    .map((process) => String(process.pid)));
  for (const row of rows) {
    if (!liveProcessPids.has(row.pid)) {
      throw new Error(`Linux simulation validation failed: open_files descriptor row PID ${row.pid} has no live process.`);
    }
    if (row.fd) {
      const key = `${row.pid}:${row.fd}`;
      if (fdKeys.has(key)) {
        throw new Error(`Linux simulation validation failed: duplicate rendered descriptor FD ${row.fd} for PID ${row.pid}.`);
      }
      fdKeys.add(key);
      const targetName = row.name.replace(/\s+\(deleted\)$/, "");
      if (!currentDescriptorRows.has(`${row.pid}:${row.fd}:${targetName}`)) {
        throw new Error(`Linux simulation validation failed: open_files row has no current canonical descriptor PID ${row.pid} FD ${row.fd} target ${targetName}.`);
      }
    }
  }

  for (const descriptor of input.simulation.openFileDescriptors.filter((item) => item.state === "current")) {
    const process = input.simulation.processes.find((item) => item.id === descriptor.processId);
    if (!process || !isProcessAliveAtTimestamp(process, captureAt)) continue;
    const expectedName = descriptor.targetKind === "socket"
      ? `${descriptor.protocol || "socket"} ${descriptor.localAddress || "local"}:${descriptor.localPort || ""}${descriptor.remoteAddress ? `->${descriptor.remoteAddress}:${descriptor.remotePort || ""}` : ""}`
      : descriptor.targetPath || descriptor.targetId;
    const row = rowByDescriptor.get(`${descriptor.pid}:${descriptor.fd}:${expectedName}`) ||
      rows.find((candidate) => candidate.pid === String(descriptor.pid) && candidate.user === descriptor.username && candidate.name.includes(expectedName));
    if (!row) {
      throw new Error(`Linux simulation validation failed: open_files descriptor ${descriptor.id} missing PID ${descriptor.pid} FD ${descriptor.fd} target ${expectedName}.`);
    }
    if (row.user !== descriptor.username) {
      throw new Error(`Linux simulation validation failed: open_files descriptor ${descriptor.id} user mismatch expected ${descriptor.username} actual ${row.user}.`);
    }
    if (row.fd && row.fd !== descriptor.fd) {
      throw new Error(`Linux simulation validation failed: open_files descriptor ${descriptor.id} FD mismatch expected ${descriptor.fd} actual ${row.fd}.`);
    }
    if (row.openedAt && row.openedAt !== descriptor.openedAt) {
      throw new Error(`Linux simulation validation failed: open_files descriptor ${descriptor.id} opened_at mismatch expected ${descriptor.openedAt} actual ${row.openedAt}.`);
    }
    if (descriptor.deleted && !/\(deleted\)/.test(row.name)) {
      throw new Error(`Linux simulation validation failed: deleted-but-open descriptor ${descriptor.id} missing deleted marker.`);
    }
    if (!descriptor.deleted && /\(deleted\)/.test(row.name)) {
      throw new Error(`Linux simulation validation failed: non-deleted descriptor ${descriptor.id} rendered with deleted marker.`);
    }
    if (descriptor.deleted && descriptor.targetPath && input.permissions.includes(`${descriptor.targetPath} `)) {
      throw new Error(`Linux simulation validation failed: deleted descriptor ${descriptor.id} is rendered as current filesystem metadata.`);
    }
    if (descriptor.targetKind === "socket" && descriptor.localPort === 22) {
      const pidPattern = new RegExp(`\\b${descriptor.localPort}\\b.*\\b${descriptor.pid}\\b|\\b${descriptor.pid}\\b.*\\b${descriptor.localPort}\\b`);
      if (!pidPattern.test(input.listeningPorts)) {
        throw new Error(`Linux simulation validation failed: listener descriptor ${descriptor.id} disagrees with listening_ports.txt.`);
      }
    }
    includesAll(input.processSnapshot, [String(descriptor.pid), descriptor.username], `process_snapshot descriptor ${descriptor.id}`);
  }
}

function parseRenderedPermissionRows(permissions: string) {
  return permissions.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4 || !/^[dlsc-][rwx-]{9}/.test(parts[1] || "")) return [];
    return [{
      path: parts[0],
      mode: parts[1],
      owner: parts[2],
      group: parts[3],
      line: trimmed,
    }];
  });
}

function renderedModePrefixForType(type: CanonicalFile["fileType"]) {
  if (type === "directory") return "d";
  if (type === "socket") return "s";
  if (type === "symlink") return "l";
  if (type === "device") return "c";
  return "-";
}

function assertCanonicalFileMetadataRealism(simulation: LinuxSimulationWorld, permissions: string) {
  const permissionRows = parseRenderedPermissionRows(permissions);
  const permissionByPath = new Map(permissionRows.map((row) => [row.path, row]));
  const inventoryGroups = new Set<string>([
    "root",
    "adm",
    "backup",
    "docker",
    "analysts",
    "utmp",
    "syslog",
    "www-data",
    "git",
    "gitlab-runner",
    "postgres",
    "bind",
    "postfix",
    "prometheus",
    "grafana-agent",
    ...simulation.groups.map((group) => group.name),
    ...simulation.identities.map((identity) => identity.username),
  ]);

  for (const file of simulation.files.filter((item) => !item.deletedAt)) {
    const row = permissionByPath.get(file.path);
    if (!row) continue;
    if (!inventoryGroups.has(row.group)) {
      throw new Error(`Linux simulation validation failed: permissions_report group ${row.group} is not resolved by identity inventory for ${row.path}.`);
    }
    const expectedPrefix = renderedModePrefixForType(file.fileType);
    if (!row.mode.startsWith(expectedPrefix)) {
      throw new Error(`Linux simulation validation failed: permissions_report renders ${file.path} as ${row.mode[0] || "unknown"} but canonical type is ${file.fileType}.`);
    }
    if ((file.fileType === "socket" || file.path.endsWith(".sock")) && !row.mode.startsWith("s")) {
      throw new Error(`Linux simulation validation failed: socket ${file.path} is rendered as a regular filesystem entry.`);
    }
    if ((file.path === "/var/lib/docker" || file.path.startsWith("/var/lib/docker/")) && file.fileType !== "directory") {
      throw new Error(`Linux simulation validation failed: Docker runtime path ${file.path} must be modeled as a directory boundary.`);
    }
    if ((file.contentRole === "script" || /^\/usr\/(?:local\/)?s?bin\//.test(file.path)) && file.fileType === "regular" && (file.mode & 0o111) === 0) {
      throw new Error(`Linux simulation validation failed: executable artifact ${file.path} lacks execute bits.`);
    }
  }
}

function assertUniqueCanonicalIds(label: string, values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Linux simulation validation failed: duplicate ${label} id ${value}.`);
    }
    seen.add(value);
  }
}

function sudoIdentityTransitionId(executionId: string) {
  return `identity-transition:sudo:${executionId.replace(/^execution:/, "")}`;
}

export function validateCanonicalExecutionLifecycle(simulation: LinuxSimulationWorld) {
  for (const process of simulation.processes.filter((item) => item.executable.startsWith("/"))) {
    const executable = simulation.files.find((file) => file.path === process.executable);
    if (!executable || executable.fileType !== "regular" || (executable.mode & 0o111) === 0) {
      throw new Error(`Linux simulation validation failed: executed binary ${process.executable} lacks plausible executable metadata.`);
    }
  }
  const identityIds = new Set(simulation.identities.map((identity) => identity.id));
  const identityById = new Map(simulation.identities.map((identity) => [identity.id, identity]));
  const sessionIds = new Set(simulation.sshSessions.map((session) => session.id));
  const commandIds = new Set(simulation.commands.map((command) => command.id));
  const fileIds = new Set(simulation.files.map((file) => file.id));
  const serviceIds = new Set(simulation.services.map((service) => service.id));
  const seenPids = new Set<number>();
  for (const process of simulation.processes) {
    if (seenPids.has(process.pid)) {
      throw new Error(`Linux simulation validation failed: duplicate PID ${process.pid}.`);
    }
    seenPids.add(process.pid);
  }
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));
  const processByPid = new Map(simulation.processes.map((process) => [process.pid, process]));
  const executionById = new Map(simulation.executions.map((execution) => [execution.id, execution]));
  const commandById = new Map(simulation.commands.map((command) => [command.id, command]));
  const sessionById = new Map(simulation.sshSessions.map((session) => [session.id, session]));
  const authenticationOrigins = simulation.authenticationOrigins || [];
  const identityTransitions = simulation.identityTransitions || [];
  assertUniqueCanonicalIds("authentication origin", authenticationOrigins.map((origin) => origin.id));
  assertUniqueCanonicalIds("identity transition", identityTransitions.map((transition) => transition.id));
  const authenticationOriginIds = new Set(authenticationOrigins.map((origin) => origin.id));
  const identityTransitionIds = new Set(identityTransitions.map((transition) => transition.id));
  const validAuthenticationMethods = new Set<CanonicalSshSession["authenticationMethod"]>([
    "publickey",
    "password",
    "keyboard-interactive",
  ]);
  for (const origin of authenticationOrigins) {
    if (origin.kind !== "ssh") {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} has invalid kind.`);
    }
    if (!identityIds.has(origin.identityId)) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} identity missing.`);
    }
    if (!sessionIds.has(origin.sessionId)) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} session missing.`);
    }
    if (!validAuthenticationMethods.has(origin.authenticationMethod)) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} authentication method invalid.`);
    }
    if (origin.keyFingerprint && origin.authenticationMethod !== "publickey") {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} key fingerprint is invalid for authentication method.`);
    }
    if (origin.keyFingerprint && !/^SHA256:[A-Za-z0-9+/=]+$/.test(origin.keyFingerprint)) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} key fingerprint invalid.`);
    }
    if (!Number.isInteger(origin.sourcePort) || origin.sourcePort <= 0 || origin.sourcePort > 65535) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} source port invalid.`);
    }
    if (!Number.isInteger(origin.destinationPort) || origin.destinationPort <= 0 || origin.destinationPort > 65535) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} destination port invalid.`);
    }
    if (!isCanonicalTimestamp(origin.authenticatedAt)) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} timestamp invalid.`);
    }
  }
  const originsBySessionId = new Map<string, CanonicalAuthenticationOrigin[]>();
  for (const origin of authenticationOrigins) {
    const existing = originsBySessionId.get(origin.sessionId) || [];
    existing.push(origin);
    originsBySessionId.set(origin.sessionId, existing);
  }
  for (const session of simulation.sshSessions) {
    const identity = identityById.get(session.identityId);
    if (!identity) {
      throw new Error(`Linux simulation validation failed: SSH session ${session.id} identity missing.`);
    }
    if (session.username !== identity.username) {
      throw new Error(`Linux simulation validation failed: SSH session ${session.id} username disagrees with canonical identity.`);
    }
    if (session.uid !== identity.uid) {
      throw new Error(`Linux simulation validation failed: SSH session ${session.id} UID disagrees with canonical identity.`);
    }
    if (session.gid !== identity.gid) {
      throw new Error(`Linux simulation validation failed: SSH session ${session.id} GID disagrees with canonical identity.`);
    }
    const origins = originsBySessionId.get(session.id) || [];
    if (origins.length !== 1) {
      throw new Error(`Linux simulation validation failed: SSH session ${session.id} must have exactly one authentication origin.`);
    }
    const origin = origins[0];
    const expectedOriginId = `auth-origin:ssh:${session.id.replace(/^session:ssh:/, "")}`;
    if (origin.id !== expectedOriginId) {
      throw new Error(`Linux simulation validation failed: CanonicalAuthenticationOrigin ${origin.id} deterministic id mismatch for SSH session ${session.id}; expected ${expectedOriginId}.`);
    }
    if (origin.identityId !== session.identityId) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} identity disagrees with SSH session ${session.id}.`);
    }
    if (origin.authenticationMethod !== session.authenticationMethod) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} method disagrees with SSH session ${session.id}.`);
    }
    if (origin.keyFingerprint !== session.keyFingerprint) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} key fingerprint disagrees with SSH session ${session.id}.`);
    }
    if (origin.sourceIp !== session.sourceIp) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} source IP disagrees with SSH session ${session.id}.`);
    }
    if (origin.sourcePort !== session.sourcePort || origin.destinationPort !== session.destinationPort) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} port disagrees with SSH session ${session.id}.`);
    }
    const authenticatedAt = canonicalTimestampMs(origin.authenticatedAt);
    const openedAt = canonicalTimestampMs(session.openedAt);
    if (authenticatedAt > openedAt || openedAt - authenticatedAt > 60_000) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} timestamp is outside SSH session opening window.`);
    }
    const firstSessionExecution = simulation.executions
      .filter((execution) => execution.sessionId === session.id)
      .sort((left, right) => left.startTime.localeCompare(right.startTime))[0];
    if (firstSessionExecution && authenticatedAt > canonicalTimestampMs(firstSessionExecution.startTime)) {
      throw new Error(`Linux simulation validation failed: authentication origin ${origin.id} occurs after first session execution.`);
    }
  }
  const earlyAuthoritativeLedger = simulation.lifecycleRegistry
    ? authoritativeLifecycleLedgers.get(simulation.lifecycleRegistry)
    : undefined;
  if (earlyAuthoritativeLedger) {
    for (const record of simulation.lifecycleRegistry.records.filter((item) => item.state === "completed")) {
      const execution = executionById.get(record.executionId);
      if (!execution) continue;
      const snapshot = record.immutable.execution;
      if (
        snapshot.identityId !== execution.identityId ||
        snapshot.effectiveIdentityId !== execution.effectiveIdentityId ||
        snapshot.identityOrigin !== execution.identityOrigin ||
        snapshot.authenticationOriginId !== execution.authenticationOriginId ||
        snapshot.identityTransitionId !== execution.identityTransitionId
      ) {
        throw new Error(`Linux simulation validation failed: CanonicalExecution ${execution.id} identity authority changed after lifecycle finalization.`);
      }
    }
  }
  const transitionsByExecutionId = new Map<string, CanonicalIdentityTransition[]>();
  for (const transition of identityTransitions) {
    if (transition.kind !== "sudo") {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} has invalid kind.`);
    }
    if (transition.outcome !== "success") {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} outcome invalid.`);
    }
    if (!identityIds.has(transition.actorIdentityId)) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} actor identity missing.`);
    }
    if (!identityIds.has(transition.targetIdentityId)) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} target identity missing.`);
    }
    if (transition.actorIdentityId === transition.targetIdentityId) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} actor and target identity are identical.`);
    }
    if (transition.sessionId && !sessionIds.has(transition.sessionId)) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} session missing.`);
    }
    if (!processByPid.has(transition.sudoProcessId)) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} sudo process missing.`);
    }
    if (!commandIds.has(transition.commandId)) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} command missing.`);
    }
    if (!executionById.has(transition.executionId)) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} execution missing.`);
    }
    if (transition.id !== sudoIdentityTransitionId(transition.executionId)) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} deterministic id mismatch.`);
    }
    if (!isCanonicalTimestamp(transition.requestedAt) || !isCanonicalTimestamp(transition.completedAt)) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} timestamp invalid.`);
    }
    if (transition.completedAt < transition.requestedAt) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} completed before it was requested.`);
    }
    const execution = executionById.get(transition.executionId)!;
    const command = commandById.get(transition.commandId)!;
    const process = processById.get(execution.processId || "");
    const sudoProcess = processByPid.get(transition.sudoProcessId)!;
    const actor = identityById.get(transition.actorIdentityId)!;
    const target = identityById.get(transition.targetIdentityId)!;
    const existing = transitionsByExecutionId.get(transition.executionId) || [];
    existing.push(transition);
    transitionsByExecutionId.set(transition.executionId, existing);
    if (!process) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} execution process missing.`);
    }
    if (execution.identityId !== transition.actorIdentityId) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} execution actor mismatch.`);
    }
    if ((execution.effectiveIdentityId || execution.identityId) !== transition.targetIdentityId) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} execution effective identity mismatch.`);
    }
    if (execution.identityOrigin !== "privilege_transition" || execution.identityTransitionId !== transition.id) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} execution provenance mismatch.`);
    }
    if (execution.commandId !== command.id || command.executionId !== execution.id) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} command/execution mismatch.`);
    }
    if (command.actorIdentityId !== transition.actorIdentityId) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} command actor mismatch.`);
    }
    if (command.runAsIdentityId !== transition.targetIdentityId) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} command run-as mismatch.`);
    }
    if (command.sudoProcessId !== transition.sudoProcessId) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} sudo process mismatch.`);
    }
    if (!command.sudoRuleId) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} command missing sudo rule reference.`);
    }
    if (transition.sudoRuleId && transition.sudoRuleId !== command.sudoRuleId) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} sudo rule mismatch.`);
    }
    if (!transition.sudoRuleId && command.sudoRuleId) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} sudo rule reference missing.`);
    }
    if (!sudoProcess.executable.endsWith("/sudo") && sudoProcess.executable !== "sudo") {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} sudo process is not sudo.`);
    }
    if (sudoProcess.sessionId !== transition.sessionId || execution.sessionId !== transition.sessionId || command.sessionId !== transition.sessionId) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} session mismatch.`);
    }
    if (process) {
      if (process.pid !== command.processId || process.ppid !== transition.sudoProcessId) {
        throw new Error(`Linux simulation validation failed: identity transition ${transition.id} command process lineage mismatch.`);
      }
      if (process.identityId !== actor.id || process.realUid !== actor.uid || process.realGid !== actor.gid) {
        throw new Error(`Linux simulation validation failed: identity transition ${transition.id} process actor UID/GID mismatch.`);
      }
      if (process.effectiveUid !== target.uid || process.effectiveGid !== target.gid) {
        throw new Error(`Linux simulation validation failed: identity transition ${transition.id} process effective UID/GID mismatch.`);
      }
    }
    const session = transition.sessionId ? sessionById.get(transition.sessionId) : undefined;
    if (session) {
      const origin = originsBySessionId.get(session.id)?.[0];
      if (!origin || origin.identityId !== transition.actorIdentityId) {
        throw new Error(`Linux simulation validation failed: identity transition ${transition.id} authentication actor mismatch.`);
      }
      if (transition.requestedAt < session.openedAt || (session.closedAt && transition.completedAt > session.closedAt)) {
        throw new Error(`Linux simulation validation failed: identity transition ${transition.id} outside SSH session lifetime.`);
      }
      if (canonicalTimestampMs(origin.authenticatedAt) > canonicalTimestampMs(transition.requestedAt)) {
        throw new Error(`Linux simulation validation failed: identity transition ${transition.id} requested before authentication.`);
      }
    }
    if (transition.requestedAt > execution.startTime) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} requested after execution start.`);
    }
    if (execution.endTime && transition.completedAt > execution.endTime) {
      throw new Error(`Linux simulation validation failed: identity transition ${transition.id} completed after execution end.`);
    }
  }
  for (const [executionId, transitions] of transitionsByExecutionId) {
    if (transitions.length !== 1) {
      throw new Error(`Linux simulation validation failed: execution ${executionId} has multiple identity transitions.`);
    }
  }
  const validIdentityOrigins = new Set<NonNullable<CanonicalExecution["identityOrigin"]>>([
    "authenticated_session",
    "inherited",
    "privilege_transition",
    "system_origin",
    "analyst_or_background",
  ]);
  for (const execution of simulation.executions) {
    if (execution.identityOrigin && !validIdentityOrigins.has(execution.identityOrigin)) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} identity origin invalid.`);
    }
    if (execution.authenticationOriginId && !authenticationOriginIds.has(execution.authenticationOriginId)) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} authentication origin missing.`);
    }
    if (execution.identityTransitionId && !identityTransitionIds.has(execution.identityTransitionId)) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} identity transition missing.`);
    }
    if (execution.identityOrigin === "authenticated_session" && !execution.authenticationOriginId) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} authenticated session origin missing authentication origin.`);
    }
    if (execution.identityOrigin === "privilege_transition" && !execution.identityTransitionId) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} privilege transition origin missing identity transition.`);
    }
    if (execution.identityOrigin === "privilege_transition" && execution.sessionId && !execution.authenticationOriginId) {
      throw new Error(`Linux simulation validation failed: CanonicalExecution ${execution.id} is session-backed privilege_transition but has no authenticationOriginId.`);
    }
    if (execution.identityOrigin === "inherited") {
      if (execution.identityTransitionId) {
        throw new Error(`Linux simulation validation failed: CanonicalExecution ${execution.id} is inherited but directly references sudo identity transition ${execution.identityTransitionId}.`);
      }
      const contextProcess = execution.processId
        ? processById.get(execution.processId)
        : execution.hostProcessId
          ? processById.get(execution.hostProcessId)
          : undefined;
      const inheritedFromProcess = contextProcess
        ? processByPid.get(contextProcess.ppid)
        : undefined;
      const actor = identityById.get(execution.identityId);
      const effective = identityById.get(execution.effectiveIdentityId || execution.identityId);
      const lineageMatches = contextProcess && actor && effective
        ? (
            (contextProcess.realUid === actor.uid && contextProcess.effectiveUid === effective.uid) ||
            Boolean(inheritedFromProcess && inheritedFromProcess.realUid === actor.uid && inheritedFromProcess.effectiveUid === effective.uid)
          )
        : false;
      if (!lineageMatches) {
        throw new Error(`Linux simulation validation failed: CanonicalExecution ${execution.id} claims inherited identity authority without matching process lineage.`);
      }
    }
    if (execution.identityTransitionId) {
      const transition = identityTransitions.find((item) => item.id === execution.identityTransitionId);
      if (transition) {
        if (execution.constructionOrigin === "system_origin" || execution.identityOrigin === "system_origin") {
          throw new Error(`Linux simulation validation failed: system-origin execution ${execution.id} cannot reference sudo identity transition.`);
        }
        if (execution.identityId === (execution.effectiveIdentityId || execution.identityId)) {
          throw new Error(`Linux simulation validation failed: execution ${execution.id} same-identity execution cannot claim sudo transition.`);
        }
        if (transition.executionId !== execution.id) {
          throw new Error(`Linux simulation validation failed: execution ${execution.id} identity transition execution mismatch.`);
        }
      }
    }
    if (execution.authenticationOriginId) {
      const origin = authenticationOrigins.find((item) => item.id === execution.authenticationOriginId);
      if (origin) {
        if (execution.constructionOrigin === "system_origin" || execution.identityOrigin === "system_origin") {
          throw new Error(`Linux simulation validation failed: system-origin execution ${execution.id} cannot reference SSH authentication origin.`);
        }
        if (!execution.sessionId || origin.sessionId !== execution.sessionId) {
          throw new Error(`Linux simulation validation failed: execution ${execution.id} authentication origin session mismatch.`);
        }
        if (origin.identityId !== execution.identityId) {
          throw new Error(`Linux simulation validation failed: execution ${execution.id} authentication origin identity mismatch.`);
        }
      }
    }
    const isMigratedSameIdentitySessionExecution =
      Boolean(execution.sessionId) &&
      execution.identityId === (execution.effectiveIdentityId || execution.identityId) &&
      ["ssh_session", "interactive_shell", "interactive_command"].includes(execution.reason);
    if (isMigratedSameIdentitySessionExecution) {
      if (!execution.identityOrigin) {
        throw new Error(`Linux simulation validation failed: execution ${execution.id} missing SSH identity origin.`);
      }
      if (!execution.authenticationOriginId) {
        throw new Error(`Linux simulation validation failed: execution ${execution.id} missing SSH authentication origin.`);
      }
      if (execution.identityOrigin !== "authenticated_session" && execution.identityOrigin !== "inherited") {
        throw new Error(`Linux simulation validation failed: execution ${execution.id} has invalid SSH identity origin.`);
      }
      if ((execution.reason === "ssh_session" || execution.reason === "interactive_shell") && execution.identityOrigin !== "authenticated_session") {
        throw new Error(`Linux simulation validation failed: execution ${execution.id} session-root identity origin is not authenticated_session.`);
      }
      if (execution.reason === "interactive_command" && execution.identityOrigin !== "inherited") {
        throw new Error(`Linux simulation validation failed: execution ${execution.id} inherited session identity origin is not inherited.`);
      }
    }
  }
  const transitionedExecutionIds = new Set(identityTransitions.map((transition) => transition.executionId));
  for (const command of simulation.commands.filter((item) => item.sudoProcessId && item.runAsIdentityId && item.runAsIdentityId !== item.actorIdentityId)) {
    if (!command.executionId || !transitionedExecutionIds.has(command.executionId)) {
      throw new Error(`Linux simulation validation failed: sudo-backed command ${command.id} missing identity transition.`);
    }
  }
  if (!simulation.lifecycleRegistry || !Array.isArray(simulation.lifecycleRegistry.records)) {
    throw new Error("Linux simulation validation failed: lifecycle registry missing.");
  }
  const authoritativeLedger = authoritativeLifecycleLedgers.get(simulation.lifecycleRegistry);
  if (!authoritativeLedger) {
    throw new Error("Linux simulation validation failed: authoritative lifecycle ledger missing.");
  }
  const assertUniqueRegistrations = (label: string, values: string[]) => {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) {
        throw new Error(`Linux simulation validation failed: duplicate ${label} registration ${value}.`);
      }
      seen.add(value);
    }
  };
  assertUniqueRegistrations("lifecycle", simulation.lifecycleRegistry.records.map((record) => record.registrationId));
  assertUniqueRegistrations("execution", simulation.lifecycleRegistry.records.map((record) => record.executionId));
  assertUniqueRegistrations("command", simulation.lifecycleRegistry.records.map((record) => record.commandId).filter((id): id is string => Boolean(id)));
  assertUniqueRegistrations("process", simulation.lifecycleRegistry.records.map((record) => record.processId).filter((id): id is string => Boolean(id)));
  if (authoritativeLedger.length !== simulation.lifecycleRegistry.records.length) {
    throw new Error("Linux simulation validation failed: authoritative/serialized lifecycle registry mismatch.");
  }
  const ledgerByRegistrationId = new Map(authoritativeLedger.map((record) => [record.registrationId, record]));
  for (const record of simulation.lifecycleRegistry.records) {
    const authoritative = ledgerByRegistrationId.get(record.registrationId);
    if (!authoritative) {
      throw new Error(`Linux simulation validation failed: unrecognized registration fingerprint for ${record.executionId}.`);
    }
    if (authoritative.recordRef !== record) {
      throw new Error(`Linux simulation validation failed: lifecycle ledger mismatch for ${record.executionId}.`);
    }
    if (authoritative.registrationSequence !== record.registrationSequence || authoritative.executionId !== record.executionId) {
      throw new Error(`Linux simulation validation failed: lifecycle ledger mismatch for ${record.executionId}.`);
    }
    if (
      authoritative.commandId !== record.commandId ||
      authoritative.processId !== record.processId ||
      authoritative.hostProcessId !== record.hostProcessId ||
      authoritative.integrityFingerprint !== record.integrityFingerprint ||
      lifecycleRecordFingerprint(record) !== record.integrityFingerprint
    ) {
      throw new Error(`Linux simulation validation failed: invalid registration fingerprint for ${record.executionId}.`);
    }
  }
  const registryByExecutionId = new Map(simulation.lifecycleRegistry.records.map((record) => [record.executionId, record]));
  const registeredCommandIds = new Set(simulation.lifecycleRegistry.records.map((record) => record.commandId).filter((id): id is string => Boolean(id)));
  const registeredProcessIds = new Set(simulation.lifecycleRegistry.records.map((record) => record.processId).filter((id): id is string => Boolean(id)));
  if (executionById.size !== simulation.executions.length) {
    throw new Error("Linux simulation validation failed: duplicate canonical execution id.");
  }
  const commandIdCounts = new Map<string, number>();
  for (const command of simulation.commands) commandIdCounts.set(command.id, (commandIdCounts.get(command.id) || 0) + 1);
  for (const [id, count] of commandIdCounts) {
    if (count !== 1) throw new Error(`Linux simulation validation failed: duplicate canonical command id ${id}.`);
  }
  const processIdCounts = new Map<string, number>();
  for (const process of simulation.processes) processIdCounts.set(process.id, (processIdCounts.get(process.id) || 0) + 1);
  for (const [id, count] of processIdCounts) {
    if (count !== 1) throw new Error(`Linux simulation validation failed: duplicate canonical process id ${id}.`);
  }
  const recordsForCommand = (commandId: string) => simulation.lifecycleRegistry.records.filter((record) => record.commandId === commandId);
  const recordsForProcess = (processId: string) => simulation.lifecycleRegistry.records.filter((record) => record.processId === processId);
  for (const record of simulation.lifecycleRegistry.records) {
    if (record.state === "pending") throw new Error(`Linux simulation validation failed: lifecycle ${record.executionId} is still pending.`);
    if (record.state === "construction_failed" && executionById.has(record.executionId)) {
      throw new Error(`Linux simulation validation failed: failed lifecycle ${record.executionId} entered production output.`);
    }
    if (record.state === "completed" && record.finalizedCount !== 1) {
      throw new Error(`Linux simulation validation failed: lifecycle ${record.executionId} finalized ${record.finalizedCount} times.`);
    }
    if (record.state === "completed") {
      const matchingExecutions = simulation.executions.filter((execution) => execution.id === record.executionId);
      if (matchingExecutions.length !== 1) {
        throw new Error(`Linux simulation validation failed: lifecycle ${record.executionId} cardinality violation.`);
      }
      const execution = matchingExecutions[0];
      if (execution.commandId !== record.commandId || execution.processId !== record.processId || execution.hostProcessId !== record.hostProcessId) {
        throw new Error(`Linux simulation validation failed: lifecycle ${record.executionId} ledger relationship mismatch.`);
      }
      if (record.commandId) {
        const matchingCommands = simulation.commands.filter((command) => command.id === record.commandId);
        if (matchingCommands.length !== 1 || matchingCommands[0].executionId !== record.executionId) {
          throw new Error(`Linux simulation validation failed: command ${record.commandId} registry cardinality violation.`);
        }
      }
      if (record.processId) {
        const matchingProcesses = simulation.processes.filter((process) => process.id === record.processId);
        if (matchingProcesses.length !== 1 || matchingProcesses[0].executionId !== record.executionId) {
          throw new Error(`Linux simulation validation failed: process ${record.processId} registry cardinality violation.`);
        }
      }
    }
  }

  for (const process of simulation.processes) {
    if (!process.executionId || !executionById.has(process.executionId)) {
      throw new Error(`Linux simulation validation failed: process ${process.id} has no canonical execution origin.`);
    }
    if (process.lifecycleOrigin === "execution_first" && !registeredProcessIds.has(process.id)) {
      throw new Error(`Linux simulation validation failed: process ${process.id} has forged execution-first provenance.`);
    }
    if (process.lifecycleOrigin === "execution_first" && recordsForProcess(process.id).length !== 1) {
      throw new Error(`Linux simulation validation failed: process ${process.id} ownership cardinality violation.`);
    }
  }

  for (const execution of simulation.executions) {
    if (!identityIds.has(execution.identityId)) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} identity missing.`);
    }
    if (execution.sessionId && !sessionIds.has(execution.sessionId)) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} session missing.`);
    }
    if (execution.commandId && !commandIds.has(execution.commandId)) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} command missing.`);
    }
    const process = execution.processId ? processById.get(execution.processId) : undefined;
    const hostProcess = execution.hostProcessId ? processById.get(execution.hostProcessId) : undefined;
    const record = registryByExecutionId.get(execution.id);
    if (execution.constructionOrigin === "execution_first" && (!record || record.state !== "completed")) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} lacks structural lifecycle registration.`);
    }
    if (execution.processPolicy === "no_child_process") {
      if (execution.processId) throw new Error(`Linux simulation validation failed: no-child execution ${execution.id} owns a process.`);
      if (!hostProcess) throw new Error(`Linux simulation validation failed: no-child execution ${execution.id} host process missing.`);
      if (!hostProcess.hostedExecutionIds?.includes(execution.id)) {
        throw new Error(`Linux simulation validation failed: no-child execution ${execution.id} is not hosted by shell process.`);
      }
    } else if (!process) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} process missing.`);
    }
    if (process && execution.processPolicy !== "no_child_process" && process.executionId !== execution.id) {
      throw new Error(`Linux simulation validation failed: process ${process.id} does not point back to execution ${execution.id}.`);
    }
    if (execution.parentProcessId && !processById.has(execution.parentProcessId)) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} parent process missing.`);
    }
    if (execution.commandId && process && process.commandId !== execution.commandId) {
      const noChildCommand = execution.processPolicy === "no_child_process" && process.id === execution.parentProcessId;
      if (!noChildCommand) throw new Error(`Linux simulation validation failed: execution ${execution.id} command/process disagreement.`);
    }
    const contextProcess = process || hostProcess;
    if (!contextProcess) throw new Error(`Linux simulation validation failed: execution ${execution.id} has no runtime process context.`);
    if (execution.processPolicy !== "no_child_process" && execution.cwd !== contextProcess.cwd) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} cwd disagrees with process.`);
    }
    if (execution.hostname !== simulation.investigation.hostname) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} hostname disagrees with investigation.`);
    }
    if (execution.processPolicy !== "no_child_process" && (execution.startTime !== contextProcess.startedAt || execution.endTime !== contextProcess.endedAt)) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} chronology disagrees with process.`);
    }
    const actor = identityById.get(execution.identityId);
    const effective = execution.effectiveIdentityId ? identityById.get(execution.effectiveIdentityId) : actor;
    if (!actor || !effective) throw new Error(`Linux simulation validation failed: execution ${execution.id} identity registry missing.`);
    if (process && execution.processPolicy !== "no_child_process") {
      if (process.identityId !== actor.id || process.realUid !== actor.uid || process.realGid !== actor.gid) {
        throw new Error(`Linux simulation validation failed: execution ${execution.id} actor UID/GID disagrees with process.`);
      }
      if (process.effectiveUid !== effective.uid || process.effectiveGid !== effective.gid) {
        throw new Error(`Linux simulation validation failed: execution ${execution.id} effective UID/GID disagrees with process.`);
      }
    }
    if (execution.endTime && execution.endTime < execution.startTime) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} ends before it starts.`);
    }
    for (const fileId of execution.openedFileIds) {
      if (!fileIds.has(fileId)) throw new Error(`Linux simulation validation failed: execution ${execution.id} open file missing ${fileId}.`);
      if (process && !process.openFileIds.includes(fileId)) throw new Error(`Linux simulation validation failed: execution ${execution.id} open file not owned by process.`);
    }
    for (const serviceId of execution.affectedServiceIds) {
      if (!serviceIds.has(serviceId)) throw new Error(`Linux simulation validation failed: execution ${execution.id} service missing ${serviceId}.`);
    }
  }

  for (const process of simulation.processes) {
    const visited = new Set<number>();
    let current: CanonicalProcess | undefined = process;
    while (current && current.ppid !== 0 && current.ppid !== 1) {
      if (visited.has(current.pid)) {
        throw new Error(`Linux simulation validation failed: process parent chain is cyclic at ${current.pid}.`);
      }
      visited.add(current.pid);
      const parent = processByPid.get(current.ppid);
      if (!parent) throw new Error(`Linux simulation validation failed: process ${current.id} parent missing.`);
      if (parent.ppid === current.pid) {
        throw new Error(`Linux simulation validation failed: process parent chain is cyclic at ${current.pid}.`);
      }
      if (parent.startedAt > current.startedAt) {
        throw new Error(`Linux simulation validation failed: process ${current.id} starts before parent execution.`);
      }
      current = parent;
    }
  }

  for (const command of simulation.commands) {
    if (!command.executionId || !executionById.has(command.executionId)) {
      throw new Error(`Linux simulation validation failed: command ${command.id} has no canonical execution.`);
    }
    const execution = executionById.get(command.executionId)!;
    const record = registryByExecutionId.get(command.executionId);
    if (command.constructionOrigin === "execution_first" && !registeredCommandIds.has(command.id)) {
      throw new Error(`Linux simulation validation failed: command ${command.id} has forged execution-first provenance.`);
    }
    if (command.constructionOrigin === "execution_first" && recordsForCommand(command.id).length !== 1) {
      throw new Error(`Linux simulation validation failed: command ${command.id} ownership cardinality violation.`);
    }
    if (execution.commandId !== command.id) {
      throw new Error(`Linux simulation validation failed: command ${command.id} execution does not reference command.`);
    }
    const process = processByPid.get(command.processId);
    const noChild = execution.processPolicy === "no_child_process";
    if (!process || (!noChild && execution.processId !== process.id) || (noChild && execution.hostProcessId !== process.id)) {
      throw new Error(`Linux simulation validation failed: command ${command.id} execution/process disagreement.`);
    }
    if (command.cwd !== execution.cwd || command.timestamp !== execution.startTime) {
      throw new Error(`Linux simulation validation failed: command ${command.id} execution context disagreement.`);
    }
    if (command.constructionOrigin !== "execution_first" && command.kind !== "background") {
      throw new Error(`Linux simulation validation failed: command ${command.id} lacks execution-first provenance.`);
    }
    if (execution.constructionOrigin !== "execution_first" && command.kind !== "background") {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} lacks execution-first provenance.`);
    }
    if (execution.intentCreatedAt && execution.commandProjectedAt && execution.intentCreatedAt > execution.commandProjectedAt) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} command was projected before intent.`);
    }
    if (execution.commandProjectedAt && execution.processProjectedAt && execution.commandProjectedAt > execution.processProjectedAt) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} process was projected before command.`);
    }
    if (command.kind !== "background" && command.runAsIdentityId && command.runAsIdentityId === command.actorIdentityId) {
      throw new Error(`Linux simulation validation failed: command ${command.id} conflates actor and effective identity.`);
    }
    if (command.sessionId && execution.sessionId !== command.sessionId) {
      throw new Error(`Linux simulation validation failed: command ${command.id} execution session disagreement.`);
    }
    if (record?.immutable.command) {
      const snapshot = record.immutable.command;
      if (
        snapshot.actorIdentityId !== command.actorIdentityId ||
        snapshot.runAsIdentityId !== command.runAsIdentityId ||
        snapshot.sessionId !== command.sessionId ||
        snapshot.timestamp !== command.timestamp ||
        snapshot.cwd !== command.cwd ||
        snapshot.executable !== command.executable ||
        snapshot.renderedCommand !== command.renderedCommand ||
        snapshot.processId !== command.processId ||
        snapshot.sudoRuleId !== command.sudoRuleId ||
        snapshot.sudoProcessId !== command.sudoProcessId
      ) {
        throw new Error(`Linux simulation validation failed: command ${command.id} changed after lifecycle finalization.`);
      }
    }
  }

  for (const record of simulation.lifecycleRegistry.records.filter((item) => item.state === "completed")) {
    const execution = executionById.get(record.executionId);
    if (!execution) throw new Error(`Linux simulation validation failed: registered execution ${record.executionId} missing.`);
    const snapshot = record.immutable.execution;
    if (
      snapshot.identityId !== execution.identityId ||
      snapshot.effectiveIdentityId !== execution.effectiveIdentityId ||
      snapshot.identityOrigin !== execution.identityOrigin ||
      snapshot.authenticationOriginId !== execution.authenticationOriginId ||
      snapshot.identityTransitionId !== execution.identityTransitionId ||
      snapshot.sessionId !== execution.sessionId ||
      snapshot.cwd !== execution.cwd ||
      snapshot.hostname !== execution.hostname ||
      snapshot.startTime !== execution.startTime ||
      snapshot.endTime !== execution.endTime ||
      snapshot.processId !== execution.processId ||
      snapshot.hostProcessId !== execution.hostProcessId ||
      snapshot.parentProcessId !== execution.parentProcessId ||
      snapshot.commandId !== execution.commandId
    ) {
      throw new Error(`Linux simulation validation failed: execution ${execution.id} changed after lifecycle finalization.`);
    }
    if (record.immutable.process && record.processId) {
      const process = processById.get(record.processId);
      if (!process) throw new Error(`Linux simulation validation failed: registered process ${record.processId} missing.`);
      const processSnapshot = record.immutable.process;
      if (
        processSnapshot.pid !== process.pid ||
        processSnapshot.ppid !== process.ppid ||
        processSnapshot.executable !== process.executable ||
        processSnapshot.identityId !== process.identityId ||
        processSnapshot.realUid !== process.realUid ||
        processSnapshot.effectiveUid !== process.effectiveUid ||
        processSnapshot.realGid !== process.realGid ||
        processSnapshot.effectiveGid !== process.effectiveGid ||
        processSnapshot.cwd !== process.cwd ||
        processSnapshot.sessionId !== process.sessionId ||
        processSnapshot.commandId !== process.commandId ||
        processSnapshot.startedAt !== process.startedAt ||
        processSnapshot.endedAt !== process.endedAt
      ) {
        throw new Error(`Linux simulation validation failed: process ${process.id} changed after lifecycle finalization.`);
      }
    }
  }

  for (const transition of simulation.serviceTransitions) {
    if (transition.cause.type === "command") {
      if (!transition.executionId || !executionById.has(transition.executionId)) {
        throw new Error(`Linux simulation validation failed: service transition ${transition.id} has no canonical execution.`);
      }
      const execution = executionById.get(transition.executionId)!;
      if (execution.commandId !== transition.cause.commandId || !execution.serviceTransitionIds.includes(transition.id)) {
        throw new Error(`Linux simulation validation failed: service transition ${transition.id} execution disagreement.`);
      }
    }
  }

  for (const scheduled of simulation.scheduledExecutions) {
    if (!scheduled.executionId || !executionById.has(scheduled.executionId)) {
      throw new Error(`Linux simulation validation failed: scheduled execution ${scheduled.id} has no canonical execution.`);
    }
    if (!processById.has(scheduled.processId)) {
      throw new Error(`Linux simulation validation failed: scheduled execution ${scheduled.id} process missing.`);
    }
    const execution = executionById.get(scheduled.executionId)!;
    if (execution.commandId !== scheduled.commandId || execution.processId !== scheduled.processId || execution.scheduledExecutionId !== scheduled.id) {
      throw new Error(`Linux simulation validation failed: scheduled execution ${scheduled.id} execution disagreement.`);
    }
    if (execution.reason !== "cron" && execution.reason !== "systemd_timer") {
      throw new Error(`Linux simulation validation failed: scheduled execution ${scheduled.id} has invalid execution reason.`);
    }
  }

  for (const transaction of simulation.packageTransactions) {
    if (!transaction.executionIds?.length) {
      throw new Error(`Linux simulation validation failed: package transaction ${transaction.id} has no canonical execution.`);
    }
    for (const executionId of transaction.executionIds) {
      const execution = executionById.get(executionId);
      if (!execution || !execution.packageTransactionIds.includes(transaction.id)) {
        throw new Error(`Linux simulation validation failed: package transaction ${transaction.id} execution disagreement.`);
      }
    }
  }
}

export function validateCanonicalServiceRestartLifecycle(simulation: LinuxSimulationWorld) {
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));
  const serviceById = new Map(simulation.services.map((service) => [service.id, service]));
  for (const transition of simulation.serviceTransitions) {
    const service = serviceById.get(transition.serviceId);
    if (!service || service.serviceType !== "long-running" || transition.outcome !== "success") continue;
    if (transition.operation === "reload") {
      if (transition.previousState.mainProcessId && transition.resultingState.mainProcessId !== transition.previousState.mainProcessId) {
        throw new Error(`Linux simulation validation failed: ${service.unitName} reload changed the main process generation.`);
      }
      continue;
    }
    if (transition.operation !== "restart" || transition.resultingState.activeState !== "active" || transition.resultingState.subState !== "running") continue;
    const before = processById.get(transition.previousState.mainProcessId || "");
    const after = processById.get(transition.resultingState.mainProcessId || "");
    if (!before || !after || before.id === after.id || before.pid === after.pid) {
      throw new Error(`Linux simulation validation failed: ${service.unitName} successful restart retained the old MainPID or lacks a new process.`);
    }
    if (canonicalProcessRuntimeEndAt(before) !== transition.occurredAt) {
      throw new Error(`Linux simulation validation failed: ${service.unitName} old main process was not retired at restart.`);
    }
    const causeCommandId = transition.cause.type === "command" ? transition.cause.commandId : undefined;
    const causeCommand = causeCommandId
      ? simulation.commands.find((command) => command.id === causeCommandId)
      : undefined;
    if (after.startedAt < (causeCommand?.timestamp || transition.occurredAt) || after.startedAt > transition.occurredAt) {
      throw new Error(`Linux simulation validation failed: ${service.unitName} new main process starts outside the restart interval.`);
    }
    if (simulation.processes.some((process) => process.id !== after.id && process.pid === after.pid &&
        isProcessAliveAtTimestamp(process, after.startedAt))) {
      throw new Error(`Linux simulation validation failed: ${service.unitName} restart MainPID collides with another live process.`);
    }
  }
}

export function validateLinuxSimulationEvidence(
  simulation: LinuxSimulationWorld,
  assets: { file_path: string; content: string }[]
) {
  validateCanonicalExecutionLifecycle(simulation);
  validateCanonicalServiceRestartLifecycle(simulation);
  const authLog = assetContent(assets, "assets/logs/auth.log");
  const sudoLog = assetContent(assets, "assets/logs/sudo.log");
  const auditLog = assetContent(assets, "assets/logs/audit.log");
  const timeline = assetContent(assets, "assets/evidence/timeline.csv");
  const processSnapshot = assetContent(assets, "assets/runtime/process_snapshot.txt");
  const openFiles = assetContent(assets, "assets/runtime/open_files.txt");
  const processHistory = assetContent(assets, "assets/runtime/process_execution_history.txt");
  const fileAccessHistory = assetContent(assets, "assets/runtime/file_access_history.csv");
  const permissions = assetContent(assets, "assets/reports/permissions_report.txt");
  const journalSsh = assetContent(assets, "assets/journal/journal_ssh.txt");
  const journalSystemd = assetContent(assets, "assets/journal/journal_systemd.txt");
  const serviceInventory = assetContent(assets, "assets/reports/service_inventory.txt");
  const syslog = assetContent(assets, "assets/logs/syslog");
  const cronLog = assetContent(assets, "assets/logs/cron.log");
  const rootCrontab = assetContent(assets, "assets/scheduled/root_crontab.txt");
  const listeningPorts = assetContent(assets, "assets/network/listening_ports.txt");
  const aptHistory = assetContent(assets, "assets/logs/apt_history.log");
  const packageInventory = assetContent(assets, "assets/inventory/package_inventory.txt");
  assertCanonicalFileMetadataRealism(simulation, permissions);
  validateScheduledScriptWriteFeasibility(simulation, assets);
  validateHistoricalFileAccessChronology({
    simulation,
    fileAccessHistory,
    timeline,
  });
  const generatedRegistry = buildCanonicalEvidenceRegistry(simulation, assets);
  const registeredPaths = new Set(generatedRegistry.map((item) => item.path));
  const existingAssetPaths = new Set(assets.filter((asset) => asset.file_path.startsWith("assets/")).map((asset) => asset.file_path));
  for (const registered of generatedRegistry) {
    if (!existingAssetPaths.has(registered.path)) {
      throw new Error(`Linux simulation validation failed: evidence registry asset missing ${registered.path}.`);
    }
  }
  for (const asset of assets.filter((item) => item.file_path.startsWith("assets/"))) {
    if (!registeredPaths.has(asset.file_path)) {
      throw new Error(`Linux simulation validation failed: learner-facing asset is not registered ${asset.file_path}.`);
    }
  }
  const evidenceById = new Map(generatedRegistry.map((item) => [item.id, item]));
  const currentStateCapabilities = new Set<CanonicalEvidenceCapability>([
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
  for (const asset of generatedRegistry) {
    if (
      asset.capabilities.some((capability) => currentStateCapabilities.has(capability)) &&
      (asset.stateType === "historical_reconstruction" || asset.assetType === "timestamped_log" || asset.assetType === "journal" || asset.assetType === "package_history")
    ) {
      throw new Error(`Linux simulation validation failed: ${asset.path} is historical evidence but declares a current-state capability.`);
    }
  }
  const serviceTransitionsHaveCauses = simulation.serviceTransitions.every((transition) => Boolean(transition.cause));
  const commandsHaveRenderTargets = simulation.commands.every((command) =>
    command.expectedRenderTargets.length > 0 ||
    simulation.executions.some((execution) => execution.commandId === command.id && execution.processPolicy === "no_child_process")
  );
  const objectGroundingReady = serviceTransitionsHaveCauses && commandsHaveRenderTargets;
  for (const proof of simulation.taskFeasibilityProofs) {
    if (objectGroundingReady && (!proof.feasible || proof.missingCapabilities.length > 0)) {
      const task = simulation.canonicalTasks.find((item) => item.id === proof.taskId);
      const selected = (task?.selectedEvidenceAssetIds || [])
        .map((id) => simulation.evidenceRegistry.find((asset) => asset.id === id)?.path || id)
        .join("|");
      throw new Error(`Linux simulation validation failed: task ${proof.taskId} has unsatisfied capability ${proof.missingCapabilities.join(", ")} selected=${selected}.`);
    }
    if (objectGroundingReady) {
      for (const requirementProof of proof.requirementProofs || []) {
        if (!requirementProof.feasible) {
          throw new Error(`Linux simulation validation failed: task ${proof.taskId} has unsatisfied object requirement ${requirementProof.requirementId}.`);
        }
      }
    }
  }
  for (const task of simulation.canonicalTasks) {
    const selected = task.selectedEvidenceAssetIds.map((id) => evidenceById.get(id));
    if (selected.some((item) => !item)) {
      throw new Error(`Linux simulation validation failed: task ${task.id} references missing evidence asset.`);
    }
    for (const capability of task.requiredCapabilities) {
      if (!selected.some((asset) => asset?.capabilities.includes(capability))) {
        throw new Error(`Linux simulation validation failed: task ${task.id} lacks capability ${capability}.`);
      }
    }
    if (task.difficulty === "Advanced" && selected.length < 2) {
      throw new Error(`Linux simulation validation failed: advanced task ${task.id} is supported by only one shallow asset.`);
    }
    if (objectGroundingReady) {
      const requirementProofs = proveTaskRequirements(task, selected.filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset)));
      for (const proof of requirementProofs) {
        if (!proof.feasible) {
          throw new Error(`Linux simulation validation failed: task ${task.id} lacks object grounding for ${proof.requirementId}.`);
        }
      }
    }
  }
  const factIds = new Set(simulation.documentFacts.map((fact) => fact.id));
  for (const document of simulation.documents) {
    if (document.createdAt > simulation.collection.collectedAt) {
      throw new Error(`Linux simulation validation failed: document ${document.id} timestamp after collection.`);
    }
    for (const factId of document.factIds) {
      if (!factIds.has(factId)) throw new Error(`Linux simulation validation failed: document ${document.id} missing fact ${factId}.`);
    }
    const facts = document.factIds.map((id) => simulation.documentFacts.find((fact) => fact.id === id)).filter((fact): fact is CanonicalDocumentFact => Boolean(fact));
    for (const required of document.requiredFactTypes) {
      if (!facts.some((fact) => fact.factType === required)) {
        throw new Error(`Linux simulation validation failed: document ${document.id} lacks required fact type ${required}.`);
      }
    }
    if (["incident_brief", "change_request", "maintenance_ticket", "security_policy"].includes(document.documentType) && facts.some((fact) => fact.spoilerRisk === "high")) {
      throw new Error(`Linux simulation validation failed: spoiler fact in inappropriate document ${document.id}.`);
    }
  }
  for (const line of timeline.split(/\r?\n/).slice(1).filter(Boolean)) {
    const row = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.replace(/^"|"$/g, "").replace(/""/g, '"'));
    const evidenceType = row[2] || "";
    const source = row[3] || "";
    const hasTypedTimelineSources = timeline.split(/\r?\n/)[0].includes("exact_sources");
    const exactSources = hasTypedTimelineSources ? row[7] || "" : source;
    if (!source.trim()) throw new Error("Linux simulation validation failed: timeline row has blank source.");
    if ((evidenceType === "Observed" || evidenceType === "Background") && !exactSources.trim()) {
      throw new Error("Linux simulation validation failed: timeline row lacks exact source support.");
    }
  }

  const processByPid = new Map<number, CanonicalProcess>();
  for (const process of simulation.processes) {
    const existing = processByPid.get(process.pid);
    if (existing) {
      throw new Error(`Linux simulation validation failed: duplicate PID ${process.pid}.`);
    }
    processByPid.set(process.pid, process);
  }
  validateRenderedOpenFileDescriptors({
    simulation,
    openFiles,
    processSnapshot,
    permissions,
    listeningPorts,
  });

  const sessionById = new Map(simulation.sshSessions.map((session) => [session.id, session]));
  for (const process of simulation.processes) {
    if (process.startedAt > simulation.collection.collectedAt) {
      throw new Error(`Linux simulation validation failed: process ${process.id} starts after collection.`);
    }
    if (process.endedAt && process.endedAt < process.startedAt) {
      throw new Error(`Linux simulation validation failed: process ${process.id} has invalid lifecycle interval.`);
    }
    if (process.ppid !== 1 && !processByPid.has(process.ppid)) {
      throw new Error(`Linux simulation validation failed: missing parent PID ${process.ppid} for ${process.pid}.`);
    }
    if (process.commandId && !simulation.commands.some((command) => command.id === process.commandId)) {
      throw new Error(`Linux simulation validation failed: process ${process.pid} references missing command ${process.commandId}.`);
    }
    for (const fileId of process.openFileIds) {
      if (!simulation.files.some((file) => file.id === fileId)) {
        throw new Error(`Linux simulation validation failed: process ${process.pid} references missing file ${fileId}.`);
      }
    }
  }

  for (const session of simulation.sshSessions) {
    const identity = canonicalIdentity(simulation, session.identityId);
    includesAll(authLog, [session.openedAt, session.sourceIp, String(session.sessionPid), identity.username], "auth.log SSH session");
    includesAll(journalSsh, [session.openedAt, session.sourceIp, String(session.sessionPid), identity.username], "journal_ssh SSH session");
    if (!session.closedAt || session.closedAt > simulation.collection.windowEnd) {
      const sessionProcess = simulation.processes.find((process) => process.pid === session.sessionPid);
      includesAll(processSnapshot, [String(session.sessionPid), String(sessionProcess?.currentPpid ?? session.monitorPid), identity.username], "process_snapshot SSH session");
    }
    if (session.closedAt && session.closedAt <= simulation.collection.windowEnd) {
      includesAll(authLog, [session.closedAt, String(session.sessionPid), identity.username], "auth.log SSH close");
      includesAll(journalSsh, [session.closedAt, String(session.sessionPid), identity.username], "journal_ssh SSH close");
    }
  }

  for (const command of simulation.commands) {
    const process = processByPid.get(command.processId);
    const sudoProcess = command.sudoProcessId ? processByPid.get(command.sudoProcessId) : undefined;
    if (!process) {
      throw new Error(`Linux simulation validation failed: command ${command.id} missing process ${command.processId}.`);
    }
    if (command.sudoProcessId && !sudoProcess) {
      throw new Error(`Linux simulation validation failed: command ${command.id} missing sudo process ${command.sudoProcessId}.`);
    }
    if (command.sessionId) {
      const session = sessionById.get(command.sessionId);
      if (!session) throw new Error(`Linux simulation validation failed: command ${command.id} missing SSH session ${command.sessionId}.`);
      if (command.timestamp < session.openedAt || (session.closedAt && command.timestamp > session.closedAt)) {
        throw new Error(`Linux simulation validation failed: command ${command.id} outside SSH session window.`);
      }
    }
    if (command.timestamp > simulation.collection.collectedAt) {
      throw new Error(`Linux simulation validation failed: command ${command.id} occurs after evidence collection.`);
    }

    const commandTexts = commandEvidenceText(command);
    if (command.expectedRenderTargets.includes("sudo")) {
      if (!commandTexts.some((text) => sudoLog.includes(`COMMAND=${text}`))) {
        throw new Error(`Linux simulation validation failed: sudo.log missing ${command.id}.`);
      }
      includesAll(sudoLog, [command.timestamp, command.cwd], `sudo.log ${command.id}`);
    }
    if (command.expectedRenderTargets.includes("audit")) {
      if (!commandTexts.some((text) => auditLog.includes(`cmd="${text}"`))) {
        throw new Error(`Linux simulation validation failed: audit.log missing ${command.id}.`);
      }
      includesAll(auditLog, [command.timestamp, `pid=${command.processId}`, `ppid=${command.sudoProcessId || command.shellProcessId || process.ppid}`, `cwd="${command.cwd}"`], `audit.log ${command.id}`);
    }
    if (command.expectedRenderTargets.includes("timeline") && command.kind !== "background") {
      includesAll(timeline, [command.timestamp, command.renderedCommand], `timeline ${command.id}`);
    }
    if (command.expectedRenderTargets.includes("process")) {
      includesAll(processHistory, [String(command.processId), command.argv[0]], `process_execution_history ${command.id}`);
      if (process.startedAt <= simulation.collection.windowEnd && (!process.endedAt || process.endedAt > simulation.collection.windowEnd)) {
        includesAll(processSnapshot, [String(command.processId), String(process.ppid), command.argv[0]], `process_snapshot ${command.id}`);
      }
    }
    if (command.expectedRenderTargets.includes("open_files")) {
      for (const fileId of command.affectedFileIds) {
        const file = canonicalFile(simulation, fileId);
        includesAll(fileAccessHistory, [String(command.processId), file.path], `file_access_history ${command.id}`);
      }
      if (process.startedAt <= simulation.collection.windowEnd && (!process.endedAt || process.endedAt > simulation.collection.windowEnd)) {
        includesAll(openFiles, [String(command.processId), command.argv[0]], `open_files ${command.id}`);
        for (const fileId of command.affectedFileIds) {
          const file = canonicalFile(simulation, fileId);
          includesAll(openFiles, [file.path], `open_files ${command.id}`);
        }
      }
    }
  }

  for (const file of simulation.files) {
    if (file.deletedAt) {
      if (permissions.includes(`${file.path} `)) {
        throw new Error(`Linux simulation validation failed: deleted file ${file.path} rendered as current permissions metadata.`);
      }
      continue;
    }
    const owner = canonicalIdentity(simulation, file.ownerIdentityId);
    const group = simulation.groups.find((item) => item.id === file.groupId);
    includesAll(permissions, [file.path, canonicalModeString(file), owner.username, group?.name || owner.username], `permissions_report ${file.path}`);
    if (simulation.commands.some((command) => command.affectedFileIds.includes(file.id))) {
      includesAll(auditLog, [file.path, canonicalAuditMode(file)], `audit PATH ${file.path}`);
    }
  }

  for (const event of simulation.events) {
    if (event.timestamp > simulation.collection.collectedAt) {
      throw new Error(`Linux simulation validation failed: event ${event.id} occurs after evidence collection.`);
    }
  }

  const commandById = new Map(simulation.commands.map((command) => [command.id, command]));
  for (const transition of simulation.serviceTransitions) {
    const service = canonicalService(simulation, transition.serviceId);
    if (!transition.cause) {
      throw new Error(`Linux simulation validation failed: service transition ${transition.id} lacks cause.`);
    }
    if (transition.occurredAt > simulation.collection.collectedAt) {
      throw new Error(`Linux simulation validation failed: service transition ${transition.id} occurs after collection.`);
    }
    if (transition.cause.type === "command") {
      const command = commandById.get(transition.cause.commandId);
      if (!command) throw new Error(`Linux simulation validation failed: transition ${transition.id} references missing command ${transition.cause.commandId}.`);
      if (transition.occurredAt < command.timestamp) {
        throw new Error(`Linux simulation validation failed: transition ${transition.id} occurs before command ${command.id}.`);
      }
      if (transition.operation === "start" && /\bsystemctl\s+enable\b/i.test(command.renderedCommand) && !/\bsystemctl\s+enable\s+--now\b/i.test(command.renderedCommand)) {
        throw new Error(`Linux simulation validation failed: plain enable command incorrectly starts ${service.unitName}.`);
      }
      if (transition.operation === "reload" && !/\bsystemctl\s+reload\b/i.test(command.renderedCommand)) {
        throw new Error(`Linux simulation validation failed: reload transition ${transition.id} lacks reload command.`);
      }
    }
    if (transition.previousState.unitFileState === "masked" && ["start", "restart"].includes(transition.operation) && transition.outcome === "success") {
      throw new Error(`Linux simulation validation failed: masked service ${service.unitName} was successfully ${transition.operation}ed.`);
    }
    if (transition.previousState.loadState === "not-found" && ["start", "restart", "enable"].includes(transition.operation) && transition.outcome === "success") {
      throw new Error(`Linux simulation validation failed: absent service ${service.unitName} has successful ${transition.operation}.`);
    }
    if (transition.operation === "stop" && transition.outcome === "success" && (transition.resultingState.activeState !== "inactive" || transition.resultingState.subState !== "dead")) {
      throw new Error(`Linux simulation validation failed: successful stop for ${service.unitName} did not produce inactive/dead.`);
    }
    if (["start", "restart"].includes(transition.operation) && transition.outcome === "success" && transition.resultingState.activeState !== "active") {
      throw new Error(`Linux simulation validation failed: successful ${transition.operation} for ${service.unitName} did not produce active state.`);
    }
    const renderedActivityRef = `${service.unitName} ${transition.operation} at ${transition.occurredAt}`;
    includesAll(auditLog, [renderedActivityRef, service.unitName, transition.operation], `audit service transition ${transition.id}`);
    includesAll(journalSystemd, [renderedActivityRef, service.unitName], `journal_systemd transition ${transition.id}`);
    const expectedJournalVerb =
      transition.operation === "start" ? "Started" :
      transition.operation === "stop" ? "Stopped" :
      transition.operation === "reload" ? "Reloaded" :
      transition.operation === "restart" ? "Restarted" :
      transition.operation === "enable" ? "Enabled" :
      transition.operation === "disable" ? "Disabled" :
      undefined;
    if (expectedJournalVerb) {
      includesAll(journalSystemd, [expectedJournalVerb, renderedActivityRef], `journal_systemd operation ${transition.id}`);
    }
    includesAll(syslog, [renderedActivityRef, service.unitName], `syslog transition ${transition.id}`);
    includesAll(timeline, [renderedActivityRef, service.unitName], `timeline transition ${transition.id}`);
  }

  const primaryServices = simulation.services.filter((service) => service.role === "primary");
  if (primaryServices.length !== 1) {
    throw new Error(`Linux simulation validation failed: expected exactly one primary service, found ${primaryServices.length}.`);
  }
  for (const service of simulation.services) {
    if (!["primary", "secondary", "background"].includes(service.role)) {
      throw new Error(`Linux simulation validation failed: service ${service.unitName} has invalid canonical role.`);
    }
    if (service.serviceType === "oneshot" && service.activeState === "active" && service.subState === "running") {
      throw new Error(`Linux simulation validation failed: oneshot ${service.unitName} is persistently running.`);
    }
    if (service.unitType === "timer" && /running/i.test(service.subState)) {
      throw new Error(`Linux simulation validation failed: timer ${service.unitName} is modeled as a daemon.`);
    }
    if (service.packageName && service.unitPath.startsWith("/etc/systemd/system/") && !service.localOverrideFileId) {
      throw new Error(`Linux simulation validation failed: packaged unit ${service.unitName} incorrectly uses ${service.unitPath}.`);
    }
    validateCanonicalSystemdState(simulation, service, processSnapshot);
    const serviceTransitions = simulation.serviceTransitions
      .filter((transition) => transition.serviceId === service.id)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const lastTransition = serviceTransitions[serviceTransitions.length - 1];
    if (lastTransition) {
      const expected = lastTransition.resultingState;
      const mismatches = [
        ["unitPresent", String(expected.unitPresent), String(service.unitPresent)],
        ["loadState", expected.loadState, service.loadState],
        ["unitFileState", expected.unitFileState, service.unitFileState],
        ["activeState", expected.activeState, service.activeState],
        ["subState", expected.subState, service.subState],
        ["result", expected.result, service.result],
        ["mainProcessId", expected.mainProcessId || "", service.mainProcessId || ""],
      ].filter(([, expectedValue, actualValue]) => expectedValue !== actualValue);
      if (mismatches.length > 0) {
        const first = mismatches[0];
        throw new Error(
          `Linux simulation validation failed: ${service.unitName} final state disagrees with transition ${lastTransition.id} ${first[0]} expected=${first[1]} actual=${first[2]}.`
        );
      }
    }
    includesAll(serviceInventory, [service.unitName, serviceStatus(service), service.unitFileState, service.unitPath], `service_inventory ${service.unitName}`);
    includesAll(serviceInventory, [service.loadState, service.activeState, service.subState, service.result], `service_inventory state ${service.unitName}`);
    if (service.mainProcessId) {
      const process = simulation.processes.find((item) => item.id === service.mainProcessId);
      if (!process) throw new Error(`Linux simulation validation failed: service ${service.unitName} missing main process ${service.mainProcessId}.`);
      if (!process.executable.toLowerCase().includes(serviceProcessToken(service.unitName))) {
        throw new Error(`Linux simulation validation failed: service ${service.unitName} main process executable mismatch.`);
      }
    }
  }

  const identityIds = new Set(simulation.identities.map((identity) => identity.id));
  const fileIds = new Set(simulation.files.map((file) => file.id));
  const serviceIds = new Set(simulation.services.map((service) => service.id));
  const commandIds = new Set(simulation.commands.map((command) => command.id));
  const processIds = new Set(simulation.processes.map((process) => process.id));
  const cronDefinitionById = new Map(simulation.cronDefinitions.map((definition) => [definition.id, definition]));
  const executionById = new Map(simulation.scheduledExecutions.map((execution) => [execution.id, execution]));

  for (const definition of simulation.cronDefinitions) {
    if (!identityIds.has(definition.ownerIdentityId)) {
      throw new Error(`Linux simulation validation failed: cron ${definition.id} owner missing.`);
    }
    if (!identityIds.has(definition.runAsIdentityId)) {
      throw new Error(`Linux simulation validation failed: cron ${definition.id} run-as user missing.`);
    }
    if (!commandIds.has(definition.commandId)) {
      throw new Error(`Linux simulation validation failed: cron ${definition.id} command missing.`);
    }
    if (definition.persistenceState === "present" && !definition.enabled) {
      throw new Error(`Linux simulation validation failed: cron ${definition.id} is present but disabled.`);
    }
    if (definition.persistenceState === "removed" && !definition.removedAt) {
      throw new Error(`Linux simulation validation failed: cron ${definition.id} is removed without removal timestamp.`);
    }
    if (definition.removedAt && definition.removedAt < definition.createdAt) {
      throw new Error(`Linux simulation validation failed: cron ${definition.id} removal predates creation.`);
    }
    if (!validCronSchedule(definition.schedule)) {
      throw new Error(`Linux simulation validation failed: cron ${definition.id} has invalid schedule.`);
    }
    const command = commandById.get(definition.commandId);
    const runAs = canonicalIdentity(simulation, definition.runAsIdentityId);
    if (command && command.runAsIdentityId !== definition.runAsIdentityId) {
      throw new Error(`Linux simulation validation failed: cron ${definition.id} command run-as ${command.runAsIdentityId} disagrees with definition ${definition.runAsIdentityId}.`);
    }
    if (definition.enabled && definition.persistenceState === "present") {
      const renderedSource = definition.source === "root_crontab"
        ? rootCrontab
        : assetContent(assets, `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`);
      includesAll(renderedSource, [definition.schedule, definition.id, definition.sourcePath], `cron source ${definition.id}`);
      if (definition.source === "cron_d") includesAll(renderedSource, [runAs.username], `cron source run-as ${definition.id}`);
      if (command) includesAll(renderedSource, [command.renderedCommand], `cron source command ${definition.id}`);
    } else {
      const renderedText = assets.map((asset) => `${asset.file_path}\n${asset.content}`).join("\n");
      if (renderedText.includes(definition.id) || (command && renderedText.includes(`${definition.schedule} ${command.renderedCommand}`))) {
        throw new Error(`Linux simulation validation failed: cron ${definition.id} is not current but appears in current cron definition evidence.`);
      }
    }
  }

  for (const scriptAsset of simulationScriptAssets(simulation)) {
    const renderedScript = assetContent(assets, scriptAsset.filePath);
    if (!renderedScript.trim()) {
      throw new Error(`Linux simulation validation failed: scheduled script ${scriptAsset.filePath} is empty.`);
    }
    includesAll(renderedScript, [scriptAsset.sourcePath], `scheduled script source ${scriptAsset.filePath}`);
    if (scriptInvokesItself(renderedScript, scriptAsset.sourcePath)) {
      throw new Error(`Linux simulation validation failed: scheduled script ${scriptAsset.filePath} invokes itself without bounded termination.`);
    }
  }
  for (const execution of simulation.scheduledExecutions) {
    if (execution.occurredAt > simulation.collection.collectedAt) {
      throw new Error(`Linux simulation validation failed: scheduled execution ${execution.id} occurs after collection.`);
    }
    if (!commandIds.has(execution.commandId)) {
      throw new Error(`Linux simulation validation failed: scheduled execution ${execution.id} command missing.`);
    }
    if (!processIds.has(execution.processId)) {
      throw new Error(`Linux simulation validation failed: scheduled execution ${execution.id} process missing.`);
    }
    if (execution.definitionId) {
      const definition = cronDefinitionById.get(execution.definitionId);
      if (!definition) {
        throw new Error(`Linux simulation validation failed: cron execution ${execution.id} has no canonical definition.`);
      }
      if (definition.modifiedAt > execution.occurredAt) {
        throw new Error(`Linux simulation validation failed: cron definition ${definition.id} is modified after execution ${execution.id}.`);
      }
      if (definition.createdAt > execution.occurredAt) {
        throw new Error(`Linux simulation validation failed: cron definition ${definition.id} is created after execution ${execution.id}.`);
      }
      if (definition.removedAt && execution.occurredAt > definition.removedAt) {
        throw new Error(`Linux simulation validation failed: cron execution ${execution.id} occurs after definition ${definition.id} was removed.`);
      }
      if (!scheduleMatchesTimestamp(definition.schedule, execution.occurredAt)) {
        throw new Error(`Linux simulation validation failed: cron execution ${execution.id} does not match schedule ${definition.schedule}.`);
      }
      const executionCommand = commandById.get(execution.commandId);
      const executionProcess = simulation.processes.find((process) => process.id === execution.processId);
      if (execution.commandId !== definition.commandId) {
        throw new Error(`Linux simulation validation failed: cron execution ${execution.id} command disagrees with definition ${definition.id}.`);
      }
      if (executionCommand?.runAsIdentityId !== definition.runAsIdentityId || executionProcess?.identityId !== definition.runAsIdentityId) {
        throw new Error(`Linux simulation validation failed: cron execution ${execution.id} run-as disagrees with definition ${definition.id}.`);
      }
      const runAs = canonicalIdentity(simulation, definition.runAsIdentityId);
      includesAll(cronLog, [linuxLearnerSubjectLabel(simulation, execution.id), definition.id, definition.sourcePath, execution.occurredAt, runAs.username], `cron.log execution ${execution.id}`);
    }
    const command = commandById.get(execution.commandId);
    if (command && !simulation.backgroundProfile.permittedJobFamilies.includes(simulation.cronDefinitions.find((definition) => definition.id === execution.definitionId)?.purpose || "other")) {
      throw new Error(`Linux simulation validation failed: background job ${execution.id} is incompatible with host role.`);
    }
    for (const fileId of execution.affectedFileIds) {
      if (!fileIds.has(fileId)) {
        throw new Error(`Linux simulation validation failed: scheduled execution ${execution.id} file missing ${fileId}.`);
      }
      const file = canonicalFile(simulation, fileId);
      const executionProcess = simulation.processes.find((process) => process.id === execution.processId);
      includesAll(fileAccessHistory, [String(executionProcess?.pid || ""), file.path], `scheduled file_access_history ${execution.id}`);
      if (executionProcess && executionProcess.startedAt <= simulation.collection.windowEnd && (!executionProcess.endedAt || executionProcess.endedAt > simulation.collection.windowEnd)) {
        includesAll(openFiles, [file.path], `scheduled open_files ${execution.id}`);
      }
      includesAll(permissions, [file.path, canonicalModeString(file)], `scheduled permissions ${execution.id}`);
    }
    for (const serviceId of execution.affectedServiceIds) {
      if (!serviceIds.has(serviceId)) {
        throw new Error(`Linux simulation validation failed: scheduled execution ${execution.id} service missing ${serviceId}.`);
      }
    }
    const executionProcess = simulation.processes.find((process) => process.id === execution.processId);
    includesAll(processHistory, [String(executionProcess?.pid || ""), executionProcess?.argv[0] || ""], `scheduled process_execution_history ${execution.id}`);
    if (executionProcess && executionProcess.startedAt <= simulation.collection.windowEnd && (!executionProcess.endedAt || executionProcess.endedAt > simulation.collection.windowEnd)) {
      includesAll(processSnapshot, [String(executionProcess?.pid || ""), executionProcess?.argv[0] || ""], `scheduled process ${execution.id}`);
    }
    const renderedExecutionRef = linuxLearnerSubjectLabel(simulation, execution.id);
    includesAll(auditLog, [renderedExecutionRef, execution.definitionId || "missing"], `scheduled audit ${execution.id}`);
    includesAll(syslog, [renderedExecutionRef, execution.definitionId || "missing"], `scheduled syslog ${execution.id}`);
    includesAll(timeline, [renderedExecutionRef, execution.definitionId || "", "Background"], `scheduled timeline ${execution.id}`);
  }

  for (const timer of simulation.timers) {
    if (timer.lastTriggerAt && timer.lastTriggerAt > simulation.collection.collectedAt) {
      throw new Error(`Linux simulation validation failed: timer ${timer.id} trigger occurs after collection.`);
    }
    if (timer.nextTriggerAt && timer.lastTriggerAt && timer.nextTriggerAt <= timer.lastTriggerAt) {
      throw new Error(`Linux simulation validation failed: timer ${timer.id} next trigger is not after last trigger.`);
    }
    if (!serviceIds.has(timer.serviceId)) {
      throw new Error(`Linux simulation validation failed: timer ${timer.id} service missing.`);
    }
  }

  for (const transaction of simulation.packageTransactions) {
    if (transaction.completedAt > simulation.collection.collectedAt) {
      throw new Error(`Linux simulation validation failed: package transaction ${transaction.id} completes after collection.`);
    }
    if (transaction.startedAt > transaction.completedAt || transaction.requestedAt > transaction.startedAt) {
      throw new Error(`Linux simulation validation failed: package transaction ${transaction.id} chronology invalid.`);
    }
    if (!identityIds.has(transaction.actorIdentityId)) {
      throw new Error(`Linux simulation validation failed: package transaction ${transaction.id} actor missing.`);
    }
    for (const processId of transaction.processIds) {
      if (!processIds.has(processId)) {
        throw new Error(`Linux simulation validation failed: package transaction ${transaction.id} process missing ${processId}.`);
      }
    }
    if (transaction.source === "manual" && transaction.timerId) {
      throw new Error(`Linux simulation validation failed: manual package transaction ${transaction.id} is conflated with timer.`);
    }
    if (transaction.source !== "manual" && transaction.timerId && !simulation.timers.some((timer) => timer.id === transaction.timerId)) {
      throw new Error(`Linux simulation validation failed: package transaction ${transaction.id} timer missing.`);
    }
    includesAll(aptHistory, [transaction.startedAt.slice(0, 10), transaction.startedAt.slice(11, 19), transaction.completedAt.slice(11, 19), transaction.packages[0]?.name || ""], `apt_history ${transaction.id}`);
    for (const pkg of transaction.packages) {
      includesAll(packageInventory, [pkg.name, pkg.resultingVersion || ""], `package_inventory ${transaction.id}`);
    }
  }

  for (const activity of simulation.maintenanceActivities) {
    if (!identityIds.has(activity.actorIdentityId)) {
      throw new Error(`Linux simulation validation failed: maintenance activity ${activity.id} actor missing.`);
    }
    for (const id of activity.commandIds) {
      const command = commandById.get(id);
      if (!command) throw new Error(`Linux simulation validation failed: maintenance activity ${activity.id} command missing ${id}.`);
      if ((command.timestamp < activity.windowStart || command.timestamp > activity.windowEnd) && activity.approved) {
        throw new Error(`Linux simulation validation failed: maintenance command ${id} outside approved window without flag.`);
      }
    }
    for (const id of activity.cronDefinitionIds) {
      if (!cronDefinitionById.has(id)) throw new Error(`Linux simulation validation failed: maintenance activity ${activity.id} cron missing ${id}.`);
    }
  }

  const allText = assets.map((asset) => `${asset.file_path}\n${asset.content}`).join("\n");
  if (/health-check\.sh|backup-check\.sh|sys-maint|Running operational task|operational task completed/i.test(allText)) {
    throw new Error("Linux simulation validation failed: generic legacy background artefact leaked into Phase 3 assets.");
  }
  const daemonVocabulary: Array<[RegExp, RegExp, string]> = [
    [/\b(apt-daily|dpkg|apt\.systemd\.daily|apt-get|\/usr\/bin\/apt|Commandline: apt)\b/i, /\b(pg_isready|certbot|crictl|cache-warm|backup validation)\b/i, "APT daemon vocabulary mismatch"],
    [/NetworkManager/i, /\b(cache-warm|pg_isready|certbot|crictl)\b/i, "NetworkManager daemon vocabulary mismatch"],
    [/postfix/i, /\b(pg_isready|ssh key|authorized_keys)\b/i, "Postfix daemon vocabulary mismatch"],
    [/\bpostgres(?:ql)?\[\d+\]:/i, /\b(?:wrote|modified|installed|accepted).*?(?:ssh key|authorized_keys)\b/i, "PostgreSQL daemon vocabulary mismatch"],
  ];
  const daemonVocabularyText = assets
    .filter((asset) => /assets\/(?:logs|journal|scheduled|runtime)\//.test(asset.file_path))
    .map((asset) => `${asset.file_path}\n${asset.content}`)
    .join("\n");
  for (const line of daemonVocabularyText.split(/\r?\n/)) {
    for (const [daemon, forbidden, label] of daemonVocabulary) {
      if (daemon.test(line) && forbidden.test(line)) {
        throw new Error(`Linux simulation validation failed: ${label}.`);
      }
    }
  }

  const journalLines = journalSystemd.split(/\r?\n/).filter(Boolean);
  const headerIndex = journalLines.findIndex((line) => line.startsWith("-- Journal begins at "));
  if (headerIndex !== 0) throw new Error("Linux simulation validation failed: journal_systemd header is missing or not first.");
  const headerTime = journalLines[0]?.match(/-- Journal begins at (.*?) UTC --/)?.[1];
  const entryTimes = journalLines.slice(1).map((line) => line.slice(0, 19)).filter((time) => /^\d{4}-\d{2}-\d{2} /.test(time));
  const sortedEntryTimes = [...entryTimes].sort();
  if (entryTimes.some((time, index) => time !== sortedEntryTimes[index])) {
    throw new Error("Linux simulation validation failed: journal_systemd entries are not chronological.");
  }
  if (headerTime && entryTimes[0] && headerTime > entryTimes[0]) {
    throw new Error("Linux simulation validation failed: journal_systemd header is later than first entry.");
  }

  const usersCsv = assets.find((asset) => asset.file_path === "assets/csv/users.csv");
  if (usersCsv) {
    for (const line of usersCsv.content.split(/\r?\n/).slice(1)) {
      const lastLogin = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1];
      if (lastLogin && `${lastLogin}:00` > simulation.collection.collectedAt) {
        throw new Error(`Linux simulation validation failed: users.csv login after collection ${lastLogin}.`);
      }
    }
  }

  if (objectGroundingReady) {
    const learnerGrounding = validateLinuxLearnerPackGrounding({ simulation, evidenceRegistry: generatedRegistry, finalAssets: assets });
    if (!learnerGrounding.passed) {
      throw new Error(`Linux simulation validation failed: learner pack grounding failed: ${learnerGrounding.issues.slice(0, 3).join("; ")}`);
    }
    const closure = validateLinuxProductionClosure({ simulation, evidenceRegistry: generatedRegistry, finalAssets: assets });
    if (!closure.passed) {
      throw new Error(`Linux simulation validation failed: production closure failed: ${closure.issues.slice(0, 3).join("; ")}`);
    }
    const semanticClosure = validateLinuxSemanticClosure({ simulation, finalAssets: assets });
    if (!semanticClosure.passed) {
      throw new Error(`Linux simulation validation failed: semantic closure failed: ${semanticClosure.issues.slice(0, 3).map((item) => item.message).join("; ")}`);
    }
  }
}
