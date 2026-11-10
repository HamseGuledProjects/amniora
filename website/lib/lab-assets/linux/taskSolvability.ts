import type { LabAsset } from "../types";
import { normalizeLinuxEvidencePath } from "./difficultyProfile";
import { proveTaskRequirements } from "./grounding";
import { linuxTaskContract } from "./taskContracts";
import { formatLinuxLearnerDocumentWindow } from "./time";
import { sourceRecordsCommand, sourceRecordsAuthentication, hasExplicitTelemetryLoss, evidenceCsvRows } from "./evidenceAuthority";
import { linuxMaintenanceApprovalDecision } from "./claimAuthority";
import type {
  CanonicalEvidenceAsset,
  CanonicalEvidenceCapability,
  CanonicalInvestigationTask,
  LinuxSimulationWorld,
} from "./simulation";

export type StudentSolvabilityStatus =
  | "solvable"
  | "solvable_with_required_uncertainty"
  | "partially_solvable"
  | "unsolvable";

export type LinuxTaskSolvabilityCode =
  | "LINUX_TASK_UNSOLVABLE"
  | "LINUX_TASK_PARTIALLY_SOLVABLE"
  | "LINUX_TASK_EVIDENCE_PATH_MISSING"
  | "LINUX_TASK_CAPABILITY_MISSING"
  | "LINUX_TASK_SUBJECT_MISSING"
  | "LINUX_TASK_RELATIONSHIP_MISSING"
  | "LINUX_TASK_TIMESTAMP_MISSING"
  | "LINUX_TASK_STATE_TYPE_MISMATCH"
  | "LINUX_TASK_DELIVERABLE_UNSUPPORTED"
  | "LINUX_TASK_CLAIM_STRENGTH_UNSUPPORTED"
  | "LINUX_TASK_REQUIRED_UNCERTAINTY_MISSING"
  | "LINUX_TASK_GLOBAL_ONLY_EVIDENCE"
  | "LINUX_TASK_RENDERED_CAPABILITY_MISMATCH"
  | "LINUX_TASK_IDENTITY_CLASSIFICATION_MISMATCH"
  | "LINUX_TASK_EXPECTED_STATE_BASELINE_MISSING"
  | "LINUX_TASK_RISK_PRIMARY_EVIDENCE_CONTRADICTION"
  | "LINUX_TASK_SUDO_ACTOR_OBSERVATION_MISSING"
  | "LINUX_TASK_KEY_LIFECYCLE_EVIDENCE_MISSING"
  | "LINUX_TASK_TELEMETRY_COMPLETENESS_UNSUPPORTED"
  | "LINUX_TASK_ATOMIC_SUPPORT_MISSING";

export type StudentSolvabilityIssue = {
  code: LinuxTaskSolvabilityCode;
  severity: "high" | "critical";
  taskId: string;
  taskIndex: number;
  intent: CanonicalInvestigationTask["intent"];
  requirement: string;
  selectedEvidence: string[];
  suggestedEvidence: string[];
  regenerationCanRepair: boolean;
  message: string;
};

export type StudentSolvabilityReport = {
  clauses: LinuxTaskClause[];
  taskId: string;
  intent: CanonicalInvestigationTask["intent"];
  status: StudentSolvabilityStatus;
  selectedEvidencePaths: string[];
  verifiedEvidencePaths: string[];
  requiredCapabilities: string[];
  satisfiedCapabilities: string[];
  missingCapabilities: string[];
  requiredSubjects: string[];
  satisfiedSubjects: string[];
  missingSubjects: string[];
  requiredRelationships: string[];
  satisfiedRelationships: string[];
  missingRelationships: string[];
  requiredTimestamps: string[];
  satisfiedTimestamps: string[];
  missingTimestamps: string[];
  requiredStateTypes: string[];
  satisfiedStateTypes: string[];
  missingStateTypes: string[];
  requiredDeliverableElements: string[];
  supportedDeliverableElements: string[];
  unsupportedDeliverableElements: string[];
  permittedUncertainty: string[];
  requiredUncertainty: string[];
  prohibitedClaims: string[];
  issues: StudentSolvabilityIssue[];
};

export type LinuxStudentTaskForSolvability = {
  phase?: string;
  title?: string;
  description?: string;
  evidence?: string[];
  deliverable?: string;
};

export type LinuxStudentNarrativeForSolvability = {
  tasks?: LinuxStudentTaskForSolvability[];
};

export type LinuxStudentSolvabilityResult = {
  passed: boolean;
  reports: StudentSolvabilityReport[];
  issues: StudentSolvabilityIssue[];
};

type ResolvedEvidence = {
  requested: string;
  path: string;
  finalAsset?: LabAsset;
  registryAsset?: CanonicalEvidenceAsset;
};

const timestampPattern = /\b(?:20\d\d-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?|\d\d:\d\d(?::\d\d)?)\b/;

const capabilityStateTypes: Partial<Record<CanonicalEvidenceCapability, Array<NonNullable<CanonicalEvidenceAsset["stateType"]>>>> = {
  authentication: ["historical_reconstruction"],
  actor_attribution: ["historical_reconstruction", "static_document", "collection_snapshot", "incident_snapshot"],
  sudo_authorisation: ["historical_reconstruction", "static_document"],
  command_execution: ["historical_reconstruction"],
  process_ancestry: ["historical_reconstruction", "collection_snapshot", "incident_snapshot"],
  open_file_correlation: ["historical_reconstruction", "incident_snapshot"],
  file_owner_group_mode: ["collection_snapshot", "incident_snapshot"],
  service_state: ["collection_snapshot", "incident_snapshot", "historical_reconstruction"],
  service_transition: ["historical_reconstruction"],
  package_transaction: ["historical_reconstruction"],
  cron_definition: ["collection_snapshot", "static_document"],
  cron_execution: ["historical_reconstruction"],
  key_provenance: ["static_document", "historical_reconstruction"],
  configuration_baseline: ["static_document", "collection_snapshot"],
  network_source: ["historical_reconstruction", "collection_snapshot", "incident_snapshot"],
  current_service_state: ["collection_snapshot", "incident_snapshot"],
  current_process_state: ["collection_snapshot", "incident_snapshot"],
  current_listener_state: ["collection_snapshot", "incident_snapshot"],
  current_package_state: ["collection_snapshot", "incident_snapshot"],
  current_persistence_state: ["collection_snapshot", "incident_snapshot", "static_document"],
  current_identity_state: ["collection_snapshot", "incident_snapshot", "static_document"],
  current_file_state: ["collection_snapshot", "incident_snapshot"],
  current_open_file_state: ["collection_snapshot", "incident_snapshot"],
  current_policy_state: ["static_document", "collection_snapshot"],
  current_configuration_state: ["static_document", "collection_snapshot"],
  change_control: ["static_document"],
  maintenance_scope: ["static_document"],
  risk_context: ["static_document"],
  evidence_integrity: ["historical_reconstruction", "static_document"],
  timeline_exact: ["historical_reconstruction"],
  timeline_context: ["historical_reconstruction", "static_document"],
  timeline_static: ["collection_snapshot", "incident_snapshot", "static_document"],
};

const deliverableElementsByIntent: Record<CanonicalInvestigationTask["intent"], string[]> = {
  scope_timeline: ["timestamp", "event", "evidence_path", "ordering"],
  actor_attribution: ["account", "identity_context", "evidence_path"],
  ssh_authentication: ["account", "source", "authentication_method", "timestamp", "evidence_path"],
  key_provenance: ["account", "key_identifier_or_gap", "evidence_path"],
  sudo_policy: ["command", "invoking_account", "effective_user", "applicable_sudo_rule", "authorization_result"],
  command_process: ["command", "process", "ancestry", "evidence_path"],
  file_permissions: ["file_path", "owner", "group", "mode"],
  service_state: ["service", "state", "transition", "timestamp"],
  package_transaction: ["package", "transaction", "timestamp", "actor_context"],
  cron_analysis: ["schedule", "command", "run_as_account", "execution_or_gap"],
  network_source: ["source_or_listener", "connection_context", "evidence_path"],
  configuration_review: ["configuration_or_policy_baseline", "affected_subject", "evidence_path"],
  change_control: ["change_id", "maintenance_window", "scope_alignment"],
  evidence_integrity: ["evidence_gap", "affected_evidence", "confidence"],
  impact_assessment: ["risk_context", "affected_subject", "bounded_impact"],
  risk_assessment: ["risk_context", "affected_subject", "confidence"],
  containment_recommendation: ["bounded_recommendation", "evidence_basis", "validation_step"],
};

const claimStrengthPatterns: Array<{ code: LinuxTaskSolvabilityCode; pattern: RegExp; capability: CanonicalEvidenceCapability; message: string }> = [
  {
    code: "LINUX_TASK_CLAIM_STRENGTH_UNSUPPORTED",
    pattern: /\b(?:exfiltrat(?:ed|ion)|data left|data was stolen)\b/i,
    capability: "network_source",
    message: "Task asks for exfiltration-strength conclusion without task-local network/source proof.",
  },
  {
    code: "LINUX_TASK_CLAIM_STRENGTH_UNSUPPORTED",
    pattern: /\b(?:attacker|malicious actor|threat actor|account owner performed)\b/i,
    capability: "actor_attribution",
    message: "Task asks for actor identity stronger than account-use attribution.",
  },
  {
    code: "LINUX_TASK_CLAIM_STRENGTH_UNSUPPORTED",
    pattern: /\b(?:unauthori[sz]ed|not authori[sz]ed|overly broad)\b/i,
    capability: "sudo_authorisation",
    message: "Task asks for sudo authorization conclusion without applicable task-local policy proof.",
  },
  {
    code: "LINUX_TASK_CLAIM_STRENGTH_UNSUPPORTED",
    pattern: /\b(?:restarted|restart)\b/i,
    capability: "service_transition",
    message: "Task asks for service restart/transition conclusion without historical transition proof.",
  },
  {
    code: "LINUX_TASK_CLAIM_STRENGTH_UNSUPPORTED",
    pattern: /\b(?:exact ssh key|which ssh key|key fingerprint|fingerprint used|key id)\b/i,
    capability: "key_provenance",
    message: "Task asks for exact SSH-key attribution without task-local key identifier proof.",
  },
];

function normalizePath(value: string) {
  return normalizeLinuxEvidencePath(String(value || "").trim());
}

function canonicalAssetPath(asset: CanonicalEvidenceAsset) {
  return normalizePath(asset.path);
}

function assetVisible(asset: CanonicalEvidenceAsset | undefined) {
  return Boolean(asset) && asset?.assetType !== "manifest";
}

function makeIssue(args: {
  code: LinuxTaskSolvabilityCode;
  task: CanonicalInvestigationTask;
  taskIndex: number;
  requirement: string;
  selectedEvidence: string[];
  suggestedEvidence?: string[];
  message: string;
  severity?: "high" | "critical";
  regenerationCanRepair?: boolean;
}): StudentSolvabilityIssue {
  return {
    code: args.code,
    severity: args.severity || "critical",
    taskId: args.task.id,
    taskIndex: args.taskIndex,
    intent: args.task.intent,
    requirement: args.requirement,
    selectedEvidence: args.selectedEvidence,
    suggestedEvidence: args.suggestedEvidence || [],
    regenerationCanRepair: args.regenerationCanRepair !== false,
    message: args.message,
  };
}

function finalAssetMap(finalAssets: LabAsset[]) {
  return new Map(finalAssets.map((asset) => [normalizePath(asset.file_path), asset]));
}

function registryPathMap(registry: CanonicalEvidenceAsset[]) {
  const map = new Map<string, CanonicalEvidenceAsset>();
  for (const asset of registry) {
    map.set(canonicalAssetPath(asset), asset);
    for (const alias of asset.aliases || []) map.set(normalizePath(alias), asset);
  }
  return map;
}

function resolveTaskEvidence(
  evidence: string[],
  registry: CanonicalEvidenceAsset[],
  finalAssets: LabAsset[]
) {
  const byFinalPath = finalAssetMap(finalAssets);
  const byRegistryPath = registryPathMap(registry);
  return evidence.map((requested): ResolvedEvidence => {
    const normalized = normalizePath(requested);
    const registryAsset = byRegistryPath.get(normalized);
    const path = registryAsset ? canonicalAssetPath(registryAsset) : normalized;
    return {
      requested,
      path,
      finalAsset: byFinalPath.get(path),
      registryAsset,
    };
  });
}

function contentFor(asset: LabAsset | undefined) {
  return String(asset?.content || "");
}

function hasServiceTransition(content: string) {
  return timestampPattern.test(content) &&
    (/\b(?:Started|Stopped|Reloaded|Restarted|Starting|Stopping|Reloading|Enabled|Disabled|Failed)\b/i.test(content) ||
      /\bsystemctl\s+(?:enable|disable|start|stop|restart|reload|daemon-reload|mask|unmask)\b/i.test(content)) &&
    /\.service\b/i.test(content);
}

function hasConfigurationBaseline(path: string, content: string) {
  if (/service_inventory|permissions_report|package_inventory|open_files|process_snapshot|listening_ports/i.test(path)) return false;
  const configPattern = /\b(?:Defaults\b|NOPASSWD|ALL=\([^)]*\)|PermitRootLogin|PasswordAuthentication|AuthorizedKeysFile|pam_[a-z]+|^\s*\[[A-Za-z]+\]|^\s*(?:\*|@reboot)\s+\S+|baseline|policy|hardening|Permit|Deny|AllowUsers)\b/im;
  if (/linux_config_pack|sudoers|sshd_config|pam\/sshd|security_policy|hardening|root_crontab|\.service$|unit/i.test(path)) {
    return configPattern.test(content);
  }
  return configPattern.test(content);
}

function hasFileOwnerGroupMode(content: string) {
  return /(?:^|\n)\/\S+\s+(?:-|d|l)?r?[wxstST-]{2,9}|(?:^|\n)\/\S+\s+\d{3,4}\s+\S+\s+\S+|(?:^|\n)\/\S+\s+\S+\s+\S+\s+0?[0-7]{3,4}/m.test(content);
}

function hasSudoObservation(content: string) {
  return /\bsudo\b|COMMAND=|TTY=|USER=root|PWD=|sudo:/i.test(content);
}

function hasSudoPolicy(content: string) {
  return /\b(?:Defaults|NOPASSWD|PASSWD)\b|(?:^|\n)\s*[%@]?[A-Za-z0-9._-]+\s+ALL\s*=\s*\([^)]*\)/m.test(content);
}

function hasKeyIdentifier(content: string) {
  return /\b(?:SHA256:[A-Za-z0-9+/=:-]+|MD5:[a-f0-9:]+|fingerprint|key id|cert(?:ificate)? serial|ssh-(?:rsa|ed25519|ecdsa)\s+[A-Za-z0-9+/=]{24,})\b/i.test(content);
}

function contentSupportsCapability(
  capability: CanonicalEvidenceCapability,
  registryAsset: CanonicalEvidenceAsset,
  finalAsset: LabAsset
) {
  const path = canonicalAssetPath(registryAsset);
  const content = contentFor(finalAsset);
  switch (capability) {
    case "authentication":
      return /Accepted|session opened|authentication|publickey|password/i.test(content) && timestampPattern.test(content);
    case "actor_attribution":
      return /\b(?:user|uid|gid|account|session|COMMAND=|USER=|Accepted|auid=|uid=)\b/i.test(content) || /root_crontab|cron\.d/i.test(path);
    case "sudo_authorisation":
      return hasSudoObservation(content) || hasSudoPolicy(content);
    case "command_execution":
      return /(?:\bCOMMAND\s*=|\bcmd\s*=|\bexecve\b|\bprocess\b|\bpid\s*=|\bCommandline:|\bCMD \(|\bsudo:)/i.test(content) && timestampPattern.test(content);
    case "process_ancestry":
      return /\b(?:pid|ppid|PID|PPID|process|parent)\b/.test(content);
    case "open_file_correlation":
      return /\b(?:open|fd|file_access|process|pid|path)\b/i.test(content) && /\//.test(content);
    case "file_owner_group_mode":
      return hasFileOwnerGroupMode(content);
    case "service_state":
    case "current_service_state":
      return /\.service\b/i.test(content) && /\b(?:active|inactive|running|failed|loaded|enabled|disabled|substate|load_state|active_state|Started|Stopped|Reloaded|Restarted)\b/i.test(content);
    case "service_transition":
      return hasServiceTransition(content);
    case "package_transaction":
      return /\b(?:Start-Date|Commandline:|Install:|Upgrade:|Remove:|dpkg|apt(?:-get)?)\b/i.test(content) && (timestampPattern.test(content) || /Start-Date:/i.test(content));
    case "cron_definition":
      return /\b(?:cron|crontab|@reboot)\b/i.test(`${path}\n${content}`) && /(?:^|\n)\s*(?:\*|\d+|@reboot)/m.test(content);
    case "cron_execution":
      return timestampPattern.test(content) && /\b(?:CRON|CMD \(|cron)\b/i.test(content);
    case "key_provenance":
      return hasKeyIdentifier(content);
    case "configuration_baseline":
    case "current_configuration_state":
      return hasConfigurationBaseline(path, content);
    case "network_source":
    case "current_listener_state":
      return /\b(?:src=|source|Accepted|rhost=|LISTEN|ESTAB|tcp|udp|ufw|iptables|\d{1,3}(?:\.\d{1,3}){3})\b/i.test(content);
    case "current_process_state":
      return /\b(?:PID|PPID|COMMAND|CMD|process)\b/.test(content) && !timestampPattern.test(content);
    case "current_package_state":
      return /\b(?:installed|package|version|ii\s+\S+)\b/i.test(content);
    case "current_persistence_state":
      return /\b(?:enabled|timer|cron|crontab|WantedBy|@reboot)\b/i.test(content);
    case "current_identity_state":
      return /\b(?:uid|gid|username|user,|group,|passwd|nologin|bash)\b/i.test(content);
    case "current_file_state":
      return hasFileOwnerGroupMode(content);
    case "current_open_file_state":
      return /\b(?:COMMAND|PID|FD|TYPE|NAME|open)\b/.test(content);
    case "current_policy_state":
      return hasSudoPolicy(content) || /\b(?:policy|allowed|required|baseline)\b/i.test(content);
    case "change_control":
      return /\bCHG-\d+\b|change request|approved change/i.test(content);
    case "maintenance_scope":
      return /\b(?:maintenance window|approved window|CHG-\d+|ticket)\b/i.test(content);
    case "risk_context":
      return /\b(?:risk|impact|severity|business|exposure|containment)\b/i.test(content);
    case "evidence_integrity":
      return /\b(?:gap|integrity|evidence|confidence|logging)\b/i.test(content);
    case "timeline_exact":
      return timestampPattern.test(content) && /(?:Observed|Accepted|COMMAND=|audit|Started|Stopped|CRON|Start-Date|event)/i.test(content);
    case "timeline_context":
      return timestampPattern.test(content) || /\b(?:window|timeline|change|maintenance|evidence)\b/i.test(content);
    case "timeline_static":
      return Boolean(registryAsset.collectionTimestamp) || /\b(?:collected|snapshot|generated|window)\b/i.test(content);
    case "session_lifecycle":
      return /\b(?:session opened|session closed|Accepted)\b/i.test(content) && timestampPattern.test(content);
    default:
      return false;
  }
}

function subjectNeedles(simulation: LinuxSimulationWorld, subjectId: string) {
  const values: string[] = [subjectId];
  const identity = simulation.identities.find((item) => item.id === subjectId);
  if (identity) values.push(identity.username, String(identity.uid));
  const group = simulation.groups.find((item) => item.id === subjectId);
  if (group) values.push(group.name, String(group.gid));
  const session = simulation.sshSessions.find((item) => item.id === subjectId);
  if (session) values.push(session.username, session.sourceIp, String(session.sourcePort), String(session.monitorPid), String(session.sessionPid));
  const command = simulation.commands.find((item) => item.id === subjectId);
  if (command) values.push(command.renderedCommand, command.executable, String(command.processId), ...command.argv);
  const process = simulation.processes.find((item) => item.id === subjectId);
  if (process) values.push(String(process.pid), String(process.ppid), process.executable, ...process.argv);
  const file = simulation.files.find((item) => item.id === subjectId);
  if (file) values.push(file.path);
  const service = simulation.services.find((item) => item.id === subjectId);
  if (service) values.push(service.unitName, service.unitName.replace(/\.service$/, ""));
  const transition = simulation.serviceTransitions.find((item) => item.id === subjectId);
  if (transition) values.push(transition.operation, transition.serviceId, transition.occurredAt);
  const cron = simulation.cronDefinitions.find((item) => item.id === subjectId);
  if (cron) values.push(cron.sourcePath, cron.schedule);
  const scheduled = simulation.scheduledExecutions.find((item) => item.id === subjectId);
  if (scheduled) values.push(scheduled.occurredAt, scheduled.definitionId || "");
  const pkg = simulation.packageTransactions.find((item) => item.id === subjectId);
  if (pkg) values.push(pkg.startedAt, ...pkg.packages.map((item) => item.name));
  const maintenance = simulation.maintenanceActivities.find((item) => item.id === subjectId);
  if (maintenance) values.push(maintenance.changeId || "", maintenance.windowStart, maintenance.windowEnd);
  if (subjectId.startsWith("package-subject:")) values.push(subjectId.replace(/^package-subject:/, ""));
  if (/^CHG-/i.test(subjectId)) values.push(subjectId);
  return Array.from(new Set(values.filter((value) => value && value.length >= 2)));
}

function relationKey(relation: string | undefined, subjectIds: string[]) {
  return relation ? `${relation}:${subjectIds.join("|")}` : "";
}

function verifiedCapabilitiesFor(resolved: ResolvedEvidence[]) {
  const renderedMismatch: Array<{ path: string; capability: CanonicalEvidenceCapability }> = [];
  const byCapability = new Map<CanonicalEvidenceCapability, string[]>();
  for (const item of resolved) {
    if (!item.registryAsset || !item.finalAsset) continue;
    for (const capability of item.registryAsset.capabilities) {
      if (contentSupportsCapability(capability, item.registryAsset, item.finalAsset)) {
        const current = byCapability.get(capability) || [];
        current.push(item.path);
        byCapability.set(capability, current);
      } else {
        renderedMismatch.push({ path: item.path, capability });
      }
    }
  }
  return { byCapability, renderedMismatch };
}

function hasTaskLocalSudoPolicy(resolved: ResolvedEvidence[]) {
  const contents = resolved.map((item) => contentFor(item.finalAsset));
  return contents.some(hasSudoObservation) && contents.some(hasSudoPolicy);
}

function hasTaskLocalKeyIdentifier(resolved: ResolvedEvidence[]) {
  return resolved.some((item) => hasKeyIdentifier(contentFor(item.finalAsset)));
}

function textAllowsKeyUncertainty(text: string) {
  return /\b(?:cannot|can't|unable|not enough|gap|unknown|whether|cannot determine|can be determined|attribution gap|evidence gap)\b/i.test(text) &&
    /\b(?:key|fingerprint|identifier|attribution)\b/i.test(text);
}

function textDemandsDefinitiveKey(text: string) {
  return /\b(?:which|exact|identify the|fingerprint used|key used|key id)\b/i.test(text) &&
    !textAllowsKeyUncertainty(text);
}

export type LinuxAtomicCapability =
  | "STATIC_IDENTITY" | "ACCOUNT_CAPABILITY" | "OBSERVED_AUTHENTICATION" | "OBSERVED_SUDO_EXECUTION"
  | "OBSERVED_PROCESS_EXECUTION" | "HISTORICAL_FILE_ACCESS" | "HISTORICAL_FILE_MUTATION"
  | "KEY_IDENTIFIER" | "KEY_TO_FILE_LINK" | "KEY_LIFECYCLE_HISTORY" | "CONFIGURED_STATE"
  | "OBSERVED_RUNTIME_STATE" | "CHANGE_AUTHORITY" | "CAPTURED_MUTABLE_STATE" | "TELEMETRY_COMPLETENESS";

export type LinuxTaskClause = {
  id: string;
  text: string;
  subjects: string[];
  action: LinuxAtomicCapability;
  relationship?: string;
  state: string[];
  historical: boolean;
  temporalRequirement: string;
  attributionRequired: boolean;
  sourceClasses: string[];
  uncertainty: "none" | "explicit_evidence_unavailability";
  supported?: boolean;
};

const atomicCapability: Partial<Record<CanonicalEvidenceCapability, LinuxAtomicCapability>> = {
  actor_attribution: "STATIC_IDENTITY", sudo_authorisation: "ACCOUNT_CAPABILITY",
  authentication: "OBSERVED_AUTHENTICATION", command_execution: "OBSERVED_PROCESS_EXECUTION",
  open_file_correlation: "HISTORICAL_FILE_ACCESS", file_owner_group_mode: "CAPTURED_MUTABLE_STATE",
  key_provenance: "KEY_IDENTIFIER", configuration_baseline: "CONFIGURED_STATE",
  service_state: "OBSERVED_RUNTIME_STATE", service_transition: "OBSERVED_RUNTIME_STATE",
  change_control: "CHANGE_AUTHORITY", current_identity_state: "CAPTURED_MUTABLE_STATE",
  current_process_state: "CAPTURED_MUTABLE_STATE", current_file_state: "CAPTURED_MUTABLE_STATE",
  current_open_file_state: "CAPTURED_MUTABLE_STATE", current_service_state: "CAPTURED_MUTABLE_STATE",
  current_listener_state: "CAPTURED_MUTABLE_STATE", current_package_state: "CAPTURED_MUTABLE_STATE",
  current_persistence_state: "CONFIGURED_STATE", current_policy_state: "CONFIGURED_STATE", current_configuration_state: "CONFIGURED_STATE",
  session_lifecycle: "OBSERVED_AUTHENTICATION", process_ancestry: "OBSERVED_PROCESS_EXECUTION",
  timeline_exact: "OBSERVED_PROCESS_EXECUTION", timeline_context: "CONFIGURED_STATE", timeline_static: "CONFIGURED_STATE",
  cron_definition: "CONFIGURED_STATE", cron_execution: "OBSERVED_PROCESS_EXECUTION", package_transaction: "OBSERVED_PROCESS_EXECUTION",
  network_source: "OBSERVED_RUNTIME_STATE", maintenance_scope: "CHANGE_AUTHORITY", evidence_integrity: "TELEMETRY_COMPLETENESS",
};

/** Secondary sentences retain their own requirements: a gap sentence cannot waive another demand. */
function semanticSentences(text: string) {
  return text.split(/(?<=[.!?;])\s+|\n+/).map(sentence => sentence.trim()).filter(Boolean);
}

function asksForObservedSudoActor(text: string) {
  return semanticSentences(text).some(sentence =>
    /\bsudo\b/i.test(sentence) && /\b(?:identify|correlate|name|attribute|determine|who|invoking|performed|executed)\b/i.test(sentence) &&
    /\b(?:account|actor|who|invoking|performed|executed)\b/i.test(sentence) &&
    !/\b(?:validation steps|follow-up|business need|least privilege|policy rule)\b/i.test(sentence));
}

function taskLocalObservedSudoActor(args: { simulation: LinuxSimulationWorld; task: CanonicalInvestigationTask; resolved: ResolvedEvidence[]; text?: string }) {
  const subjectIds = new Set(args.task.requirements.flatMap(requirement => requirement.subjectIds));
  const namedActors = args.simulation.identities.filter(identity => new RegExp(`\\b${identity.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(args.text || ""));
  return args.simulation.commands.filter(command => command.expectedRenderTargets.includes("sudo") &&
    (subjectIds.has(command.id) || subjectIds.has(command.actorIdentityId)) &&
    (!namedActors.length || namedActors.some(actor => actor.id === command.actorIdentityId))).some(command =>
    args.resolved.some(item => item.finalAsset && sourceRecordsCommand(args.simulation, item.finalAsset, command, true)));
}

function asksForObservedAuthentication(sentence: string) {
  return /\b(?:who|account|user)\b[^.;]{0,65}\b(?:logged in|authenticated|signed in)\b|\b(?:identify|attribute) (?:the )?login actor\b/i.test(sentence) &&
    !/^(?:do not|avoid|describe follow-up)\b/i.test(sentence);
}

function taskLocalAuthentication(args: { simulation: LinuxSimulationWorld; task: CanonicalInvestigationTask; resolved: ResolvedEvidence[] }) {
  const subjects = new Set(args.task.requirements.flatMap(r => r.subjectIds));
  const sessions = args.simulation.sshSessions.filter(s => subjects.has(s.id) || subjects.has(s.identityId));
  return sessions.length > 0 && sessions.every(session => args.resolved.some(item => item.finalAsset &&
    sourceRecordsAuthentication(args.simulation, item.finalAsset, session.id)));
}

function asksForKeyLifecycle(text: string) {
  return /\b(?:key(?:s)?[\s\S]{0,65}(?:lifecycle|addition|removal|replacement|copying|rotation|revocation|added|removed|replaced|copied|rotated|revoked)|trust change|(?:added|removed|replaced|copied|rotated|revoked)[\s\S]{0,40}key)\b/i.test(text);
}

function explicitlyRequiresKeyLifecycleGap(text: string) {
  return /^(?:document|record|explain|state|identify)\b[^.;]*\b(?:unavailable|missing|absence of|lack of)\b[^.;]*\b(?:key|lifecycle|history|mapping)\b/i.test(text) ||
    /^(?:document|record|explain|state|identify)\b[^.;]*\b(?:lifecycle|key-to-file)\b[^.;]*\b(?:unavailable|missing|not supplied)\b/i.test(text);
}

function keyClaimSentences(text: string) {
  return semanticSentences(text).filter(sentence => (asksForKeyLifecycle(sentence) || /key-to-file|key.{0,30}(?:mapping|file identity)/i.test(sentence)) &&
    !/^(?:distinguish|do not|don't|avoid|include validation|describe follow-up)\b/i.test(sentence));
}

function keyClauseSupported(args: { simulation: LinuxSimulationWorld; task: CanonicalInvestigationTask; resolved: ResolvedEvidence[] }, sentence: string) {
  const subjects = new Set(args.task.requirements.flatMap(r => r.subjectIds));
  const paths = args.simulation.files.filter(file => subjects.has(file.id) && /authorized_keys|\.pub$/.test(file.path)).map(file => file.path);
  if (!paths.length) return false;
  const requestedFingerprint = sentence.match(/SHA256:[A-Za-z0-9+/=]+/)?.[0];
  const allowedFingerprints = new Set(args.resolved.flatMap(item => contentFor(item.finalAsset).split(/\r?\n/)
    .filter(line => !/^type=KEY_(CHANGE|MAP) /.test(line)).join("\n").match(/SHA256:[A-Za-z0-9+/=]+/g) || []));
  const demandsHistory = asksForKeyLifecycle(sentence);
  const actionWords: Array<[RegExp, string]> = [
    [/\b(?:addition|added|add)\b/i, "add"], [/\b(?:removal|removed|remove)\b/i, "remove"],
    [/\b(?:replacement|replaced|replace)\b/i, "replace"], [/\b(?:copying|copied|copy)\b/i, "copy"],
    [/\b(?:rotation|rotated|rotate)\b/i, "rotate"], [/\b(?:revocation|revoked|revoke)\b/i, "revoke"],
  ];
  const requiredActions = actionWords.filter(([pattern]) => pattern.test(sentence)).map(([,action]) => action);
  const proofs = args.resolved.flatMap(item => {
    if (!item.registryAsset || !item.finalAsset || (demandsHistory && effectiveStateType(item.registryAsset) !== "historical_reconstruction")) return [];
    return item.finalAsset.content.split(/\r?\n/).flatMap(line => {
      // A single native record must bind identifier, object and action. Words scattered across the file do not qualify.
      const record = line.match(/^type=KEY_(CHANGE|MAP) msg=audit\((\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\):/);
      const path = line.match(/\bpath="([^"]+)"/)?.[1];
      const fingerprint = line.match(/\bfingerprint=(SHA256:[A-Za-z0-9+/=]+)/)?.[1];
      const action = line.match(/\baction=(add|remove|replace|copy|rotate|revoke|map)\b/)?.[1];
      const actor = line.match(/\bactor=([a-z_][\w.-]*)\b/)?.[1];
      return record && path && paths.includes(path) && fingerprint && (!allowedFingerprints.size || allowedFingerprints.has(fingerprint)) &&
        (!requestedFingerprint || fingerprint === requestedFingerprint) && action &&
        actor && args.simulation.identities.some(i => i.username === actor) && /\bres=success\b/.test(line) &&
        record[2] <= args.simulation.collection.collectedAt &&
        (!demandsHistory || record[1] === "CHANGE") ? [action] : [];
    });
  });
  return requiredActions.length ? requiredActions.every(action => proofs.includes(action)) : proofs.length > 0;
}

function asksForExhaustiveTelemetryConclusion(text: string) {
  return /\b(?:all events?|complete (?:sequence|history|record)|no (?:other|additional|further) (?:events?|attempts?|activity)|every (?:event|attempt)|exhaustive)\b/i.test(text) &&
    !/\b(?:observed events|recorded events|within the supplied|available evidence only)\b/i.test(text);
}

function taskEvidenceHasDeclaredTelemetryGap(resolved: ResolvedEvidence[]) {
  return resolved.some(item => item.finalAsset && hasExplicitTelemetryLoss(item.finalAsset));
}

function taskEvidenceHasCompleteTelemetryAuthority(args: { resolved: ResolvedEvidence[]; simulation: LinuxSimulationWorld; task: CanonicalInvestigationTask }) {
  const { resolved, simulation, task } = args;
  const partial = resolved.filter(item => item.finalAsset && hasExplicitTelemetryLoss(item.finalAsset));
  // A complete-source label must name the same affected source and cover its interval and host.
  return partial.every(gap => {
    const content = contentFor(gap.finalAsset);
    const host = content.match(/\bhost=(\S+)/)?.[1];
    const start = content.match(/\binterval_start=(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/)?.[1];
    const end = content.match(/\binterval_end=(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/)?.[1];
    if (!host || !start || !end) return false;
    const commandSubjects = simulation.commands.filter(command => task.requirements.some(r => r.subjectIds.includes(command.id)));
    const sessions = simulation.sshSessions.filter(session => task.requirements.some(r => r.subjectIds.includes(session.id) || r.subjectIds.includes(session.identityId)));
    return resolved.some(item => item.path !== gap.path && item.registryAsset && effectiveStateType(item.registryAsset) === "historical_reconstruction" && item.finalAsset &&
      !hasExplicitTelemetryLoss(item.finalAsset) && (commandSubjects.length + sessions.length > 0) &&
      commandSubjects.every(command => item.finalAsset && sourceRecordsCommand(simulation, item.finalAsset, command)) &&
      sessions.every(session => item.finalAsset && sourceRecordsAuthentication(simulation, item.finalAsset, session.id)) &&
      contentFor(item.finalAsset).split(/\r?\n/).some(line => line.startsWith("# telemetry_completeness=complete ") &&
        line.includes("covers_source=" + gap.path + " ") && line.includes("host=" + host + " ") &&
        line.includes("interval_start=" + start) && line.includes("interval_end=" + end)));
  });
}

function requestedFileOperation(sentence: string) {
  if (/\b(?:who created|identify (?:the )?creator|establish (?:the )?file creation|prove.{0,30}created)\b/i.test(sentence)) return "create";
  if (/\b(?:who accessed|prove.{0,30}accessed|establish.{0,30}observed file access)\b/i.test(sentence)) return "access";
}

function taskLocalFileOperation(args: { simulation: LinuxSimulationWorld; task: CanonicalInvestigationTask; resolved: ResolvedEvidence[] }, sentence: string) {
  const operation = requestedFileOperation(sentence);
  const subjects = new Set(args.task.requirements.flatMap(r => r.subjectIds));
  const paths = args.simulation.files.filter(f => subjects.has(f.id)).map(f => f.path);
  return args.resolved.some(item => item.path === "assets/runtime/file_access_history.csv" && evidenceCsvRows(contentFor(item.finalAsset)).some(row =>
    paths.includes(row.path) && (operation === "create" ? row.operation === "create" : /^(?:access|read|write)$/.test(row.operation)) &&
    row.state_type === "historical_reconstruction" && Boolean(row.timestamp && row.pid && row.user) &&
    args.simulation.commands.some(command => command.renderedCommand === row.command && command.timestamp === row.timestamp &&
      args.simulation.processes.some(process => process.commandId === command.id && String(process.pid) === row.pid))));
}

function taskClauseContracts(task: CanonicalInvestigationTask, text: string, resolved: ResolvedEvidence[]): LinuxTaskClause[] {
  const clauses: LinuxTaskClause[] = task.requirements.map((requirement, index) => ({
    id: task.id + ":requirement:" + index, text: requirement.capability, subjects: requirement.subjectIds,
    action: atomicCapability[requirement.capability] || "CONFIGURED_STATE",
    relationship: requirement.relation, state: capabilityStateTypes[requirement.capability] || [],
    historical: (capabilityStateTypes[requirement.capability] || []).every(state => state === "historical_reconstruction"),
    temporalRequirement: "task subject event or declared snapshot time", attributionRequired: requirement.capability === "actor_attribution",
    sourceClasses: resolved.filter(item => item.registryAsset?.capabilities.includes(requirement.capability)).map(item => item.registryAsset!.assetType),
    uncertainty: "none",
  }));
  const subjects = [...new Set(task.requirements.flatMap(r => r.subjectIds))];
  for (const [index, sentence] of semanticSentences(text).entries()) {
    const actions: LinuxAtomicCapability[] = [];
    if (asksForObservedSudoActor(sentence)) actions.push("OBSERVED_SUDO_EXECUTION");
    if (asksForObservedAuthentication(sentence)) actions.push("OBSERVED_AUTHENTICATION");
    if (keyClaimSentences(sentence).length) {
      if (asksForKeyLifecycle(sentence)) actions.push("KEY_LIFECYCLE_HISTORY");
      if (/key-to-file|mapping/i.test(sentence)) actions.push("KEY_TO_FILE_LINK");
    }
    if (requestedFileOperation(sentence)) actions.push(requestedFileOperation(sentence) === "create" ? "HISTORICAL_FILE_MUTATION" : "HISTORICAL_FILE_ACCESS");
    if (asksForExhaustiveTelemetryConclusion(sentence)) actions.push("TELEMETRY_COMPLETENESS");
    for (const action of actions) clauses.push({
      id: task.id + ":clause:" + index + ":" + action, text: sentence, subjects, action, relationship: action.toLowerCase(),
      state: ["historical_reconstruction"], historical: true, temporalRequirement: "same record and subject; complete interval for exhaustive claims",
      attributionRequired: action === "OBSERVED_SUDO_EXECUTION", sourceClasses: ["timestamped_log", "journal", "historical_reconstruction"],
      uncertainty: explicitlyRequiresKeyLifecycleGap(sentence) ? "explicit_evidence_unavailability" : "none",
    });
  }
  return clauses;
}

function requiredStateTypes(task: CanonicalInvestigationTask) {
  return Array.from(new Set(task.requiredCapabilities.flatMap((capability) => capabilityStateTypes[capability] || [])));
}

function selectedStateTypes(resolved: ResolvedEvidence[]) {
  return Array.from(new Set(resolved
    .map((item) => item.registryAsset ? effectiveStateType(item.registryAsset) : undefined)
    .filter((value): value is NonNullable<CanonicalEvidenceAsset["stateType"]> => Boolean(value))));
}

function effectiveStateType(asset: CanonicalEvidenceAsset): NonNullable<CanonicalEvidenceAsset["stateType"]> | undefined {
  if (asset.stateType) return asset.stateType;
  if (asset.assetType === "static_config" || asset.assetType === "policy_document" || asset.assetType === "change_document" || asset.assetType === "maintenance_document" || asset.assetType === "risk_document" || asset.assetType === "analyst_document") return "static_document";
  if (asset.assetType === "timestamped_log" || asset.assetType === "journal" || asset.assetType === "package_history") return "historical_reconstruction";
  if (asset.assetType === "scheduled_definition" || asset.assetType === "key_material") return "static_document";
  if (asset.assetType === "identity_inventory" || asset.assetType === "package_inventory" || asset.assetType === "file_metadata" || asset.assetType === "service_inventory" || asset.assetType === "network_state") return "collection_snapshot";
  if (asset.assetType === "process_snapshot" || asset.assetType === "open_files") return "incident_snapshot";
  return undefined;
}

function taskText(task: LinuxStudentTaskForSolvability | undefined) {
  return `${task?.phase || ""}\n${task?.title || ""}\n${task?.description || ""}\n${task?.deliverable || ""}`.trim();
}

function supportsDeliverableElement(element: string, satisfiedCapabilities: Set<string>, text: string, resolved: ResolvedEvidence[]) {
  const hasAny = (...capabilities: CanonicalEvidenceCapability[]) => capabilities.some((capability) => satisfiedCapabilities.has(capability));
  if (element === "timestamp") return (hasAny("timeline_exact", "authentication", "service_transition", "command_execution", "cron_execution", "package_transaction") && resolved.some((item) => timestampPattern.test(contentFor(item.finalAsset)))) ||
    (hasAny("current_service_state") && resolved.some((item) => item.path === "assets/reports/service_inventory.txt" &&
      item.registryAsset?.collectionTimestamp && evidenceCsvRows(contentFor(item.finalAsset)).some((row) =>
        row.captured_at === item.registryAsset?.collectionTimestamp && row.state_type === "collection_snapshot" && Boolean(row.host))));
  if (element === "event" || element === "ordering") return hasAny("timeline_exact", "command_execution", "cron_execution", "service_transition", "package_transaction");
  if (element === "evidence_path") return resolved.some((item) => Boolean(item.finalAsset && item.registryAsset));
  if (element === "account") return hasAny("actor_attribution", "authentication");
  if (element === "identity_context") return hasAny("actor_attribution", "current_identity_state");
  if (element === "source" || element === "source_or_listener" || element === "connection_context") return hasAny("authentication", "network_source", "current_listener_state");
  if (element === "authentication_method") return satisfiedCapabilities.has("authentication");
  if (element === "command") return hasAny("command_execution", "cron_definition", "sudo_authorisation");
  if (element === "invoking_account" || element === "effective_user") return hasAny("sudo_authorisation", "actor_attribution", "command_execution");
  if (element === "applicable_sudo_rule" || element === "authorization_result") return hasTaskLocalSudoPolicy(resolved);
  if (element === "key_identifier_or_gap") return hasTaskLocalKeyIdentifier(resolved) || textAllowsKeyUncertainty(text);
  if (element === "process" || element === "ancestry") return satisfiedCapabilities.has("process_ancestry");
  if (element === "transition") return satisfiedCapabilities.has("service_transition");
  if (element === "service" || element === "state") return hasAny("service_state", "current_service_state", "service_transition");
  if (element === "package" || element === "transaction") return satisfiedCapabilities.has("package_transaction");
  if (element === "actor_context") return hasAny("actor_attribution", "package_transaction");
  if (element === "schedule") return satisfiedCapabilities.has("cron_definition");
  if (element === "run_as_account") return hasAny("cron_definition", "actor_attribution");
  if (element === "execution_or_gap") return satisfiedCapabilities.has("cron_execution") || /\b(?:gap|not established|not available|missing)\b/i.test(text);
  if (element === "configuration_or_policy_baseline") return satisfiedCapabilities.has("configuration_baseline");
  if (element === "owner" || element === "group" || element === "mode" || element === "file_path") return satisfiedCapabilities.has("file_owner_group_mode");
  if (element === "change_id" || element === "maintenance_window") return hasAny("change_control", "maintenance_scope");
  if (element === "scope_alignment") return hasAny("change_control", "maintenance_scope") && hasAny("command_execution", "authentication", "cron_execution", "package_transaction", "service_transition");
  if (element === "evidence_gap" || element === "affected_evidence" || element === "confidence") return hasAny("evidence_integrity", "timeline_context", "risk_context");
  if (element === "risk_context" || element === "bounded_impact") return satisfiedCapabilities.has("risk_context");
  if (element === "affected_subject") return resolved.some((item) => (item.registryAsset?.canonicalObjectIds.length || 0) > 0);
  if (element === "bounded_recommendation") return satisfiedCapabilities.has("risk_context") && (satisfiedCapabilities.has("configuration_baseline") || /\bvalidation|gap|evidence\b/i.test(text));
  if (element === "evidence_basis") return resolved.some((item) => Boolean(item.finalAsset && item.registryAsset));
  if (element === "validation_step") return hasAny("configuration_baseline", "risk_context", "change_control", "maintenance_scope");
  return false;
}

function evidenceText(resolved: ResolvedEvidence[]) {
  return resolved.map((item) => `${item.path}\n${contentFor(item.finalAsset)}`).join("\n");
}

function hasPidEvidence(content: string) {
  return /\b(?:pid|PID|CRON\[|audit\([^)]*\):[^\n]*\bpid=|\bPPID\b)\b/.test(content) && /\b\d{2,6}\b/.test(content);
}

function hasCollectionTimestampEvidence(content: string) {
  return /\b(?:capture_at|collected_at|collection|snapshot|generated_at|state_type)\b/i.test(content) && timestampPattern.test(content);
}

function hasLineContaining(content: string, values: string[]) {
  const required = values.filter(Boolean);
  return content.split(/\r?\n/).some((line) => required.every((value) => line.includes(value)));
}

function canonicalSubjectTokens(simulation: LinuxSimulationWorld, subjectIds: string[]) {
  const tokens: string[] = [];
  for (const subjectId of subjectIds) {
    const command = simulation.commands.find((item) => item.id === subjectId);
    if (command) tokens.push(command.renderedCommand, command.executable);
    const service = simulation.services.find((item) => item.id === subjectId);
    if (service) tokens.push(service.unitName, service.unitPath);
    const cron = simulation.cronDefinitions.find((item) => item.id === subjectId);
    if (cron) tokens.push(cron.sourcePath, cron.schedule);
    const scheduled = simulation.scheduledExecutions.find((item) => item.id === subjectId);
    if (scheduled) tokens.push(scheduled.occurredAt, scheduled.definitionId || "");
    const identity = simulation.identities.find((item) => item.id === subjectId);
    if (identity) tokens.push(identity.username);
    const file = simulation.files.find((item) => item.id === subjectId);
    if (file) tokens.push(file.path);
    const transaction = simulation.packageTransactions.find((item) => item.id === subjectId);
    if (transaction) tokens.push(...transaction.packages.map((pkg) => pkg.name));
    const maintenance = simulation.maintenanceActivities.find((item) => item.id === subjectId);
    if (maintenance) tokens.push(maintenance.title, maintenance.changeId || "", maintenance.ticketId || "");
  }
  return Array.from(new Set(tokens.filter((token) => token && token.length > 1)));
}

function hasAuthoritativeApprovalEvidence(resolved: ResolvedEvidence[], simulation: LinuxSimulationWorld, task: CanonicalInvestigationTask) {
  const subjectIds = Array.from(new Set(task.requirements.flatMap((requirement) => requirement.subjectIds)));
  const taskSubjectTokens = canonicalSubjectTokens(simulation, subjectIds);
  return resolved.some((item) => {
    if (!/assets\/docs\/(?:change_request|maintenance_ticket)\.md$/i.test(item.path)) return false;
    const content = contentFor(item.finalAsset);
    return simulation.maintenanceActivities.some((activity) => {
      const activitySubjectIds = new Set([
        activity.id,
        activity.changeId || "",
        activity.ticketId || "",
        ...activity.commandIds,
        ...activity.serviceTransitionIds,
        ...activity.packageTransactionIds,
        ...activity.cronDefinitionIds,
      ].filter(Boolean));
      const taskTargetsActivity = subjectIds.some((subjectId) => activitySubjectIds.has(subjectId));
      if (!taskTargetsActivity && !subjectIds.includes(activity.changeId || "") && !subjectIds.includes(activity.ticketId || "")) return false;
      const decision = linuxMaintenanceApprovalDecision(activity);
      const hasApprovalState = decision === "approved"
        ? /\b(?:explicitly )?approved\b/i.test(content)
        : decision === "rejected"
          ? /\b(?:explicitly )?(?:rejected|denied|not approved)\b/i.test(content)
          : /\b(?:not established|unknown|no explicit approval or rejection|requires validation)\b/i.test(content);
      const learnerWindow = formatLinuxLearnerDocumentWindow(activity.windowStart, activity.windowEnd, activity.timezone || simulation.investigation.timezone);
      const hasWindow = (content.includes(activity.windowStart) && content.includes(activity.windowEnd)) || content.includes(learnerWindow);
      const hasChangeOrTicket = Boolean((activity.changeId && content.includes(activity.changeId)) || (activity.ticketId && content.includes(activity.ticketId)));
      return hasApprovalState && hasWindow && hasChangeOrTicket && content.includes(activity.title);
    });
  });
}

function contentHasAll(content: string, values: string[]) {
  return values.filter(Boolean).every((value) => content.includes(value));
}

function canonicalCommandForId(simulation: LinuxSimulationWorld, id: string | undefined) {
  return id ? simulation.commands.find((item) => item.id === id) : undefined;
}

function canonicalIdentityForId(simulation: LinuxSimulationWorld, id: string | undefined) {
  return id ? simulation.identities.find((item) => item.id === id) : undefined;
}

type AccountClassification = "service" | "human" | "unknown" | "conflict";

type IdentityEvidenceClassification = {
  source: string;
  classification: AccountClassification;
  reason: string;
};

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (quoted && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
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

function parseCsvRows(content: string) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
}

function classifyAccountText(value: string): AccountClassification {
  const text = value.toLowerCase();
  const service = /\b(?:service account|automation account|application runtime|runtime account|backup service|deployment automation|monitoring service|account_type\s*[:=,]\s*service|status\s*[:=,]\s*service|role\s*[:=,][^\n]*(?:service|automation|runtime)|svc-[a-z0-9._-]+)\b/i.test(text);
  const human = /\b(?:business user|operations engineer|linux administrator|security analyst|temporary user|contractor|human user|account_type\s*[:=,]\s*(?:human|contractor|temporary)|status\s*[:=,]\s*active|role\s*[:=,][^\n]*(?:business|engineer|administrator|analyst|contractor))\b/i.test(text);
  if (service && human) return "conflict";
  if (service) return "service";
  if (human) return "human";
  return "unknown";
}

function mergeAccountClassifications(classifications: IdentityEvidenceClassification[]): AccountClassification {
  const values = new Set(classifications.map((item) => item.classification).filter((value) => value !== "unknown"));
  if (values.has("conflict") || (values.has("service") && values.has("human"))) return "conflict";
  if (values.has("service")) return "service";
  if (values.has("human")) return "human";
  return "unknown";
}

function identityClassificationsFromEvidence(resolved: ResolvedEvidence[], username: string) {
  const classifications: IdentityEvidenceClassification[] = [];
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const passwdPattern = new RegExp(`(?:^|\\n)${escaped}:[^\\n]*`, "i");
  for (const item of resolved) {
    const content = contentFor(item.finalAsset);
    if (!content.includes(username)) continue;
    if (/users\.csv$/i.test(item.path)) {
      for (const row of parseCsvRows(content)) {
        if (row.username !== username) continue;
        const line = Object.entries(row).map(([key, value]) => `${key}: ${value}`).join(", ");
        classifications.push({ source: item.path, classification: classifyAccountText(line), reason: line });
      }
      continue;
    }
    const passwdMatch = content.match(passwdPattern);
    if (passwdMatch) {
      const parts = passwdMatch[0].replace(/^\n/, "").split(":");
      const gecos = parts[4] || "";
      const shell = parts[6] || "";
      classifications.push({
        source: item.path,
        classification: classifyAccountText(`${username} ${gecos} ${shell}`),
        reason: `${gecos} ${shell}`.trim(),
      });
    }
    if (/linux_config_pack|groups\.csv|security_policy/i.test(item.path)) {
      const matchingLines = content.split(/\r?\n/).filter((line) => line.includes(username));
      for (const line of matchingLines) {
        const classification = classifyAccountText(line);
        if (classification !== "unknown") classifications.push({ source: item.path, classification, reason: line });
      }
    }
  }
  return classifications;
}

function taskAsksForServiceAccountUse(text: string) {
  return /\b(?:service[- ]account|automation account|expected service behaviour|expected service behavior|expected service-account use|service-account use)\b/i.test(text);
}

function taskAsksForExpectedAccountBaseline(text: string) {
  return /\b(?:expected|baseline|normal|approved|business need|least[- ]privilege|purpose|role boundary)\b/i.test(text) &&
    /\b(?:service[- ]account|automation account|account|use|activity|behaviour|behavior)\b/i.test(text);
}

function hasTaskLocalExpectedAccountAuthority(resolved: ResolvedEvidence[], username: string) {
  const authoritativeIdentity = identityClassificationsFromEvidence(resolved, username)
    .some((item) => ["service", "human", "conflict"].includes(item.classification));
  const policyOrBaseline = resolved.some((item) => {
    const content = contentFor(item.finalAsset);
    if (!content.includes(username)) return false;
    if (!/users\.csv|passwd\.sample|linux_config_pack|security_policy|change_request|maintenance_ticket|hardening/i.test(item.path)) return false;
    return /\b(?:role|account_type|status|service account|automation account|business user|expected|baseline|approved|purpose|business need|least[- ]privilege|allowed|policy)\b/i.test(content);
  });
  return authoritativeIdentity && policyOrBaseline;
}

function riskEvidenceContradictsIdentity(resolved: ResolvedEvidence[], username: string, classification: AccountClassification) {
  if (classification !== "human" && classification !== "service") return false;
  const opposingPattern = classification === "human"
    ? /\b(?:service[- ]account|automation account|service role|run-as account)\b/i
    : /\b(?:business user|human user|interactive user|employee|contractor)\b/i;
  return resolved.some((item) =>
    /risk_register|advanced_risk_register|analyst|hypothesis/i.test(item.path) &&
    contentFor(item.finalAsset).includes(username) &&
    opposingPattern.test(contentFor(item.finalAsset))
  );
}

function canonicalCronForTask(simulation: LinuxSimulationWorld, task: CanonicalInvestigationTask) {
  const requiredIds = new Set(task.requirements.flatMap((requirement) => requirement.subjectIds));
  return simulation.cronDefinitions.find((definition) => requiredIds.has(definition.id)) ||
    simulation.cronDefinitions.find((definition) => definition.sourcePath === "/etc/cron.d/platform-sync") ||
    simulation.cronDefinitions[0];
}

function canonicalScheduledExecutionForTask(simulation: LinuxSimulationWorld, task: CanonicalInvestigationTask, definitionId?: string) {
  const requiredIds = new Set(task.requirements.flatMap((requirement) => requirement.subjectIds));
  return simulation.scheduledExecutions.find((execution) => requiredIds.has(execution.id)) ||
    simulation.scheduledExecutions.find((execution) => execution.definitionId === definitionId);
}

function cronDefinitionEvidenceMatches(content: string, definition: NonNullable<ReturnType<typeof canonicalCronForTask>>, command: NonNullable<ReturnType<typeof canonicalCommandForId>>, runAs?: ReturnType<typeof canonicalIdentityForId>) {
  if (!content.includes(definition.sourcePath)) return false;
  const schedulePrefix = `${definition.schedule} `;
  const expectedCronD = runAs ? `${schedulePrefix}${runAs.username} ${command.renderedCommand}` : undefined;
  const expectedRoot = `${schedulePrefix}${command.renderedCommand}`;
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .some((line) => {
      const withoutComment = line.split(/\s+#/)[0]?.trim() || line;
      if (definition.source === "cron_d") return Boolean(expectedCronD && withoutComment === expectedCronD);
      return withoutComment === expectedRoot;
    });
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

function scriptEvidenceMatchesCronDefinition(content: string, definition: NonNullable<ReturnType<typeof canonicalCronForTask>>, command: NonNullable<ReturnType<typeof canonicalCommandForId>>, runAs?: ReturnType<typeof canonicalIdentityForId>) {
  return content.trim().length > 0 &&
    content.includes(`# cron_source=${definition.sourcePath}`) &&
    content.includes(`# schedule=${definition.schedule}`) &&
    (!runAs || content.includes(`# run_as=${runAs.username}`)) &&
    content.includes(command.renderedCommand) &&
    !scriptInvokesItself(content, command.renderedCommand);
}

function atomicSupportIssues(args: {
  simulation: LinuxSimulationWorld;
  task: CanonicalInvestigationTask;
  taskIndex: number;
  text: string;
  resolved: ResolvedEvidence[];
  selectedPaths: string[];
}): StudentSolvabilityIssue[] {
  const issues: StudentSolvabilityIssue[] = [];
  const allText = evidenceText(args.resolved);
  const add = (
    requirement: string,
    message: string,
    suggestedEvidence: string[] = [],
    code: LinuxTaskSolvabilityCode = "LINUX_TASK_ATOMIC_SUPPORT_MISSING"
  ) => {
    issues.push(makeIssue({
      code,
      task: args.task,
      taskIndex: args.taskIndex,
      requirement,
      selectedEvidence: args.selectedPaths,
      suggestedEvidence,
      message,
    }));
  };

  if (/\b(?:pid|process id)\b/i.test(args.text) && !hasPidEvidence(allText)) {
    add("pid/process relationship", "Task asks for a PID or process relationship, but selected task-local evidence contains no PID-bearing observation.");
  }

  if (/\b(?:collection timestamp|collection time|capture time|snapshot time|collected at|capture_at)\b/i.test(args.text) && !hasCollectionTimestampEvidence(allText)) {
    add("collection timestamp", "Task asks for collection timing, but selected task-local evidence does not expose a collection/capture timestamp.");
  }

  for (const sentence of semanticSentences(args.text).filter(asksForObservedSudoActor)) {
    if (taskLocalObservedSudoActor({ ...args, text: sentence })) continue;
    add(
      "observed sudo actor",
      "Identifying the account that performed a sudo action requires task-local observed sudo execution showing the invoking account and exact command together; identity inventory alone is insufficient.",
      ["assets/logs/sudo.log", "assets/logs/audit.log"],
      "LINUX_TASK_SUDO_ACTOR_OBSERVATION_MISSING"
    );
  }
  if ((args.task.requirements.some(requirement => requirement.capability === "authentication") ||
    semanticSentences(args.text).some(asksForObservedAuthentication)) && !taskLocalAuthentication(args)) {
    add("observed authentication", "Account capability and unrelated login records cannot prove the requested login. Supply an authentication record binding the task's account, source, port and event time.");
  }

  for (const sentence of keyClaimSentences(args.text).filter(sentence => explicitlyRequiresKeyLifecycleGap(sentence) ? keyClauseSupported(args, sentence) : !keyClauseSupported(args, sentence))) {
    add(
      "SSH key clause: " + sentence,
      "Static key material can identify current trust but cannot establish addition, removal, rotation, revocation, replacement, or another lifecycle event. Supply historical key-change evidence or require the learner to record that lifecycle history is unavailable.",
      ["assets/logs/audit.log", "assets/runtime/file_access_history.csv", "assets/ssh/<account>/authorized_keys"],
      "LINUX_TASK_KEY_LIFECYCLE_EVIDENCE_MISSING"
    );
  }

  if (semanticSentences(args.text).some(asksForExhaustiveTelemetryConclusion) && taskEvidenceHasDeclaredTelemetryGap(args.resolved) && !taskEvidenceHasCompleteTelemetryAuthority(args)) {
    add(
      "telemetry completeness",
      "The task asks for an exhaustive conclusion even though selected evidence declares rate limiting, missing intervals, truncation, or partial coverage and no complete alternate source is supplied.",
      [],
      "LINUX_TASK_TELEMETRY_COMPLETENESS_UNSUPPORTED"
    );
  }

  const asksForHistoricalActivity = /\b(?:observed account activity|observed activity|who created|created (?:the )?(?:file|archive|object)|historical activity|performed (?:the )?action|session activity|runtime event)\b/i.test(args.text);
  const hasHistoricalActivity = args.resolved.some((item) => {
    const asset = item.registryAsset;
    if (!asset) return false;
    return effectiveStateType(asset) === "historical_reconstruction" &&
      asset.capabilities.some((capability) => ["command_execution", "open_file_correlation", "authentication", "cron_execution", "package_transaction", "service_transition"].includes(capability));
  });
  if (asksForHistoricalActivity && !hasHistoricalActivity) {
    add(
      "historical activity evidence",
      "Static or snapshot evidence can describe object state, but cannot prove historical activity, creation, process action, or session action without task-local event evidence.",
      ["assets/logs/audit.log", "assets/process_execution_history.txt", "assets/runtime/file_access_history.csv", "assets/logs/sudo.log"]
    );
  }

  for (const sentence of semanticSentences(args.text)) {
    const operation = requestedFileOperation(sentence);
    if (operation && !taskLocalFileOperation(args, sentence)) add(operation === "create" ? "historical file mutation" : "historical file access", "Ownership, permission and login records cannot establish the requested file operation. Supply a task-local event binding the object, action, process, actor and time.");
  }

  if ((args.task.intent === "change_control" || /\b(?:approv|change record|change request|maintenance window|maintenance scope|CHG-\d+)\b/i.test(args.text)) && !hasAuthoritativeApprovalEvidence(args.resolved, args.simulation, args.task)) {
    add("approval/change authority", "Task asks for approval or maintenance-scope findings without task-local change_request.md or maintenance_ticket.md authority.", ["assets/docs/change_request.md", "assets/docs/maintenance_ticket.md"]);
  }
  if (args.task.intent === "change_control") {
    const hasRuntimeSide = args.resolved.some((item) => {
      const asset = item.registryAsset;
      return !/assets\/docs\/(?:change_request|maintenance_ticket)\.md$/i.test(item.path) &&
        Boolean(asset && effectiveStateType(asset) === "historical_reconstruction" &&
          asset.capabilities.some((capability) => ["command_execution", "authentication", "cron_execution", "package_transaction", "service_transition"].includes(capability)));
    });
    if (!hasRuntimeSide) {
      add(
        "observed runtime side of change correlation",
        "Mapping change scope to observed activity requires independent task-local runtime evidence as well as the approval record.",
        ["assets/logs/audit.log", "assets/logs/auth.log", "assets/logs/sudo.log", "assets/process_execution_history.txt"]
      );
    }
  }

  if (args.task.intent === "service_state" && !args.resolved.some((item) =>
    item.registryAsset?.collectionTimestamp &&
    contentFor(item.finalAsset).includes(item.registryAsset.collectionTimestamp) &&
    /\b(?:collection_snapshot|incident_snapshot)\b/.test(contentFor(item.finalAsset))
  )) {
    add(
      "service-state capture authority",
      "Time-sensitive service state requires a task-local capture instant and snapshot type; a timezone label alone is not incident-relative authority.",
      ["assets/reports/service_inventory.txt"]
    );
  }

  const requiredIdentities = new Map<string, NonNullable<ReturnType<typeof canonicalIdentityForId>>>();
  for (const identityId of Array.from(new Set(args.task.requirements
    .flatMap((requirement) => requirement.subjectIds)
    .filter((subjectId) => subjectId.startsWith("identity:"))))) {
    const identity = canonicalIdentityForId(args.simulation, identityId);
    if (identity) requiredIdentities.set(identity.username, identity);
  }
  for (const identity of requiredIdentities.values()) {
    if (identity.username === "root") continue;
    const classifications = identityClassificationsFromEvidence(args.resolved, identity.username);
    const classification = mergeAccountClassifications(classifications);
    const serviceAccountClaim = taskAsksForServiceAccountUse(args.text);
    if (serviceAccountClaim && (classification === "human" || classification === "conflict")) {
      add(
        "identity classification",
        "Task asks for service-account or automation-account analysis, but task-local identity evidence classifies the account as human/business or conflicting.",
        ["assets/accounts/passwd.sample", "assets/csv/users.csv", "assets/configs/linux_config_pack.txt"],
        "LINUX_TASK_IDENTITY_CLASSIFICATION_MISMATCH"
      );
    } else if (serviceAccountClaim && classification === "unknown") {
      add(
        "identity classification",
        "Task asks for service-account or automation-account analysis, but task-local evidence does not expose authoritative account classification.",
        ["assets/accounts/passwd.sample", "assets/csv/users.csv", "assets/configs/linux_config_pack.txt"],
        "LINUX_TASK_EXPECTED_STATE_BASELINE_MISSING"
      );
    }
    if (taskAsksForExpectedAccountBaseline(args.text) && !hasTaskLocalExpectedAccountAuthority(args.resolved, identity.username)) {
      add(
        "expected account-use baseline",
        "Expected account-use comparisons require task-local identity, policy, or baseline evidence for the same account.",
        ["assets/accounts/passwd.sample", "assets/csv/users.csv", "assets/configs/linux_config_pack.txt", "assets/docs/security_policy.md"],
        "LINUX_TASK_EXPECTED_STATE_BASELINE_MISSING"
      );
    }
    if (riskEvidenceContradictsIdentity(args.resolved, identity.username, classification)) {
      add(
        "risk context versus primary identity evidence",
        "Task-local risk context labels the account differently from authoritative identity evidence and cannot override the identity inventory.",
        ["assets/accounts/passwd.sample", "assets/csv/users.csv"],
        "LINUX_TASK_RISK_PRIMARY_EVIDENCE_CONTRADICTION"
      );
    }
  }

  const asksForCronDefinition = /\b(?:cron definition|scheduled-task definition|scheduled task definition|cron source|cron\.d|crontab|run-as account|run as account|cron run-as|cron owner|scheduled command|scheduled task run-as|scheduled-task run-as)\b/i.test(args.text);
  const asksForCronExecution = /\b(?:cron execution|historical execution|prove execution|execution pid|execution evidence|executed|ran)\b/i.test(args.text) && /\b(?:cron|scheduled|platform-sync|task)\b/i.test(args.text);
  if (args.task.intent === "cron_analysis" || asksForCronDefinition || asksForCronExecution) {
    const definition = canonicalCronForTask(args.simulation, args.task);
    const command = canonicalCommandForId(args.simulation, definition?.commandId);
    const runAs = canonicalIdentityForId(args.simulation, definition?.runAsIdentityId);
    const execution = canonicalScheduledExecutionForTask(args.simulation, args.task, definition?.id);
    const definitionEvidence = args.resolved.find((item) =>
      item.registryAsset?.capabilities.includes("cron_definition") &&
      Boolean(definition && command && cronDefinitionEvidenceMatches(contentFor(item.finalAsset), definition, command, runAs))
    );
    if (!definition || !command || !definitionEvidence) {
      add("cron definition", "Cron-definition work requires the exact scheduled source path, schedule, and command in selected task-local evidence.", definition ? [
        definition.source === "cron_d" ? `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}` : "assets/scheduled/root_crontab.txt",
      ] : []);
    }
    if (runAs && !args.resolved.some((item) =>
      item.registryAsset?.capabilities.includes("cron_definition") &&
      contentFor(item.finalAsset).includes(runAs.username) &&
      (definition ? contentFor(item.finalAsset).includes(definition.sourcePath) : true)
    )) {
      add("cron run-as account", "Cron run-as account must come from the selected cron definition evidence, not from identity inventory alone.", definition ? [
        definition.source === "cron_d" ? `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}` : "assets/scheduled/root_crontab.txt",
      ] : []);
    }
    if (execution && args.task.requiredCapabilities.includes("cron_execution") && !args.resolved.some((item) =>
      item.registryAsset?.capabilities.includes("cron_execution") &&
      contentHasAll(contentFor(item.finalAsset), [execution.occurredAt, definition?.id || ""])
    )) {
      add("cron execution event", "Cron execution claims require task-local historical execution evidence for the same cron definition and timestamp.", ["assets/logs/cron.log", "assets/logs/syslog", "assets/logs/audit.log"]);
    }
    const asksForScript = /\b(?:script|contents?|body|logic|command file)\b/i.test(args.text) ||
      args.resolved.some((item) => /^assets\/scripts\/[^/]+\.sh$/i.test(item.path));
    if (asksForScript && definition && command && !args.resolved.some((item) =>
      /^assets\/scripts\/[^/]+\.sh$/i.test(item.path) &&
      scriptEvidenceMatchesCronDefinition(contentFor(item.finalAsset), definition, command, runAs)
    )) {
      add("cron script contents", "Script analysis requires the selected script evidence to match the same cron source, schedule, run-as account, and canonical command as the cron definition.", ["assets/scripts/platform-sync.sh"]);
    }
  }

  if (args.task.intent === "service_state" && args.task.requiredCapabilities.includes("service_transition")) {
    const transition = args.simulation.serviceTransitions.find((item) => args.task.requirements.some((requirement) => requirement.subjectIds.includes(item.id)));
    const service = transition ? args.simulation.services.find((item) => item.id === transition.serviceId) : undefined;
    if (transition && service && !args.resolved.some((item) =>
      item.registryAsset?.capabilities.includes("service_transition") &&
      contentHasAll(contentFor(item.finalAsset), [transition.occurredAt, service.unitName, transition.operation])
    )) {
      add("service transition", "Service transition findings require task-local historical systemd/audit/syslog evidence for the exact unit, operation, and timestamp.", ["assets/journal/journal_systemd.txt", "assets/logs/syslog", "assets/logs/audit.log"]);
    }
  }

  if (args.task.intent === "configuration_review" && /\b(?:baseline|unit file|expected service|service baseline)\b/i.test(args.text)) {
    const serviceId = args.task.requirements.flatMap((requirement) => requirement.subjectIds).find((id) => id.startsWith("service:"));
    const service = args.simulation.services.find((item) => item.id === serviceId);
    if (service && !args.resolved.some((item) =>
      item.registryAsset?.capabilities.includes("configuration_baseline") &&
      contentHasAll(contentFor(item.finalAsset), [service.unitName, service.unitPath]) &&
      /\b(?:Expected service baseline|\[Unit\]|\[Service\]|ExecStart=|UnitFileState=)\b/i.test(contentFor(item.finalAsset))
    )) {
      add("service configuration baseline", "Service baseline comparison requires task-local configuration evidence with the exact service unit and baseline fields.", ["assets/configs/linux_config_pack.txt"]);
    }
    for (const sentence of semanticSentences(args.text)) {
      const asksForObservedRuntimeState = /\b(?:observed|runtime|current|active|running|enabled|disabled|transition)\b/i.test(sentence) &&
        /\b(?:service|unit|state|baseline|configuration)\b/i.test(sentence) &&
        !(/\b(?:missing|unavailable|not supplied|cannot determine)\b[^.;]*\b(?:runtime-state|service-state|service state|observed state)\b/i.test(sentence) ||
          /\bobserved service state\b[^.;]*\b(?:unverified|unavailable|not established)\b/i.test(sentence));
      if (!service || !asksForObservedRuntimeState) continue;
      const asksForHistoricalState = /\b(?:during|throughout|at the time of|at incident time|historical|transition)\b/i.test(sentence);
      const asksForCaptureTime = /\b(?:capture time|snapshot|inventory)\b/i.test(sentence);
      const hasCapturedState = args.resolved.some((item) => {
        if (item.path !== "assets/reports/service_inventory.txt" ||
          !item.registryAsset?.capabilities.includes("current_service_state") ||
          item.registryAsset.collectionTimestamp !== args.simulation.collection.collectedAt) return false;
        return evidenceCsvRows(contentFor(item.finalAsset)).some((row) =>
          row.service === service.unitName && row.unit_path === service.unitPath &&
          row.host === args.simulation.investigation.hostname &&
          row.captured_at === args.simulation.collection.collectedAt &&
          row.state_type === "collection_snapshot" && Boolean(row.active_state));
      });
      const hasHistoricalTransition = args.resolved.some((item) =>
        item.registryAsset?.capabilities.includes("service_transition") &&
        item.registryAsset.canonicalObjectIds.includes(service.id) &&
        /^(?:assets\/(?:logs|journal)\/)/i.test(item.path) &&
        contentFor(item.finalAsset).includes(service.unitName));
      if ((asksForHistoricalState && !hasHistoricalTransition) ||
        (asksForCaptureTime && !hasCapturedState) ||
        (!asksForHistoricalState && !asksForCaptureTime && !hasCapturedState && !hasHistoricalTransition)) {
        add(
          "observed service runtime state: " + sentence,
          "Observed service-state comparisons require task-local evidence for the same host and unit. A collection snapshot supports only its capture time; incident-time claims require historical transition evidence. A separate evidence-gap sentence does not waive this clause.",
          ["assets/reports/service_inventory.txt", "assets/journal/journal_systemd.txt"]
        );
      }
    }
  }

  return issues;
}

function selectedEvidenceExactlyMatchesCanonical(resolved: ResolvedEvidence[], canonicalSelected: CanonicalEvidenceAsset[]) {
  const finalSet = new Set(resolved.map((item) => item.path));
  const canonicalSet = new Set(canonicalSelected.map(canonicalAssetPath));
  return {
    extra: Array.from(finalSet).filter((path) => !canonicalSet.has(path)),
    missing: Array.from(canonicalSet).filter((path) => !finalSet.has(path)),
  };
}

function suggestedEvidenceForCapability(registry: CanonicalEvidenceAsset[], capability: CanonicalEvidenceCapability) {
  return registry
    .filter((asset) => asset.capabilities.includes(capability))
    .map((asset) => asset.path)
    .slice(0, 4);
}

export function proveLinuxStudentTaskSolvability(args: {
  simulation: LinuxSimulationWorld;
  task: CanonicalInvestigationTask;
  taskIndex: number;
  studentTask?: LinuxStudentTaskForSolvability;
  finalAssets: LabAsset[];
  evidenceRegistry?: CanonicalEvidenceAsset[];
}): StudentSolvabilityReport {
  const registry = args.evidenceRegistry || args.simulation.evidenceRegistry;
  const registryById = new Map(registry.map((asset) => [asset.id, asset]));
  const canonicalSelected = args.task.selectedEvidenceAssetIds
    .map((id) => registryById.get(id))
    .filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset));
  const requestedEvidence = args.studentTask?.evidence || canonicalSelected.map((asset) => asset.path);
  const resolved = resolveTaskEvidence(requestedEvidence, registry, args.finalAssets);
  const selectedPaths = resolved.map((item) => item.path);
  const issues: StudentSolvabilityIssue[] = [];
  const contract = linuxTaskContract(args.task.intent);
  const text = taskText(args.studentTask);
  const selectedText = resolved.map((item) => `${item.path}\n${contentFor(item.finalAsset)}`).join("\n");

  for (const item of resolved) {
    if (!item.finalAsset) {
      issues.push(makeIssue({
        code: "LINUX_TASK_EVIDENCE_PATH_MISSING",
        task: args.task,
        taskIndex: args.taskIndex,
        requirement: item.requested,
        selectedEvidence: selectedPaths,
        suggestedEvidence: canonicalSelected.map((asset) => asset.path),
        message: `Task evidence path ${item.requested} is not present in the final rendered asset pack.`,
      }));
    }
    if (!assetVisible(item.registryAsset)) {
      issues.push(makeIssue({
        code: "LINUX_TASK_EVIDENCE_PATH_MISSING",
        task: args.task,
        taskIndex: args.taskIndex,
        requirement: item.requested,
        selectedEvidence: selectedPaths,
        suggestedEvidence: canonicalSelected.map((asset) => asset.path),
        message: `Task evidence path ${item.requested} is not a student-visible canonical evidence asset.`,
      }));
    }
  }

  const aliasCounts = new Map<string, number>();
  selectedPaths.forEach((path) => aliasCounts.set(path, (aliasCounts.get(path) || 0) + 1));
  for (const [path, count] of aliasCounts) {
    if (count > 1) {
      issues.push(makeIssue({
        code: "LINUX_TASK_EVIDENCE_PATH_MISSING",
        task: args.task,
        taskIndex: args.taskIndex,
        requirement: path,
        selectedEvidence: selectedPaths,
        message: `Task references duplicate aliases for the same evidence path ${path}.`,
        regenerationCanRepair: false,
      }));
    }
  }

  const pathClosure = selectedEvidenceExactlyMatchesCanonical(resolved, canonicalSelected);
  for (const path of pathClosure.extra) {
    issues.push(makeIssue({
      code: "LINUX_TASK_GLOBAL_ONLY_EVIDENCE",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: path,
      selectedEvidence: selectedPaths,
      suggestedEvidence: canonicalSelected.map((asset) => asset.path),
      message: `Task evidence ${path} is available globally or by alias but is not selected by the canonical task-local contract.`,
    }));
  }
  for (const path of pathClosure.missing) {
    issues.push(makeIssue({
      code: "LINUX_TASK_GLOBAL_ONLY_EVIDENCE",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: path,
      selectedEvidence: selectedPaths,
      suggestedEvidence: canonicalSelected.map((asset) => asset.path),
      message: `Canonical task-local evidence ${path} is not listed for the student task.`,
    }));
  }

  const { byCapability, renderedMismatch } = verifiedCapabilitiesFor(resolved);
  const satisfiedCapabilities = new Set(Array.from(byCapability.keys()));
  if (args.task.intent === "sudo_policy" && hasTaskLocalSudoPolicy(resolved)) satisfiedCapabilities.add("sudo_authorisation");
  if (args.task.intent === "key_provenance" && hasTaskLocalKeyIdentifier(resolved)) satisfiedCapabilities.add("key_provenance");

  const missingCapabilities = args.task.requiredCapabilities.filter((capability) => !satisfiedCapabilities.has(capability));
  for (const mismatch of renderedMismatch) {
    if (missingCapabilities.includes(mismatch.capability)) {
      issues.push(makeIssue({
        code: "LINUX_TASK_RENDERED_CAPABILITY_MISMATCH",
        task: args.task,
        taskIndex: args.taskIndex,
        requirement: mismatch.capability,
        selectedEvidence: selectedPaths,
        suggestedEvidence: suggestedEvidenceForCapability(registry, mismatch.capability),
        message: `Evidence ${mismatch.path} is registered with ${mismatch.capability}, but the rendered content does not expose that capability.`,
      }));
    }
  }
  for (const capability of missingCapabilities) {
    const uncertaintyOk = args.task.intent === "key_provenance" && capability === "key_provenance" && textAllowsKeyUncertainty(text);
    if (uncertaintyOk) continue;
    issues.push(makeIssue({
      code: "LINUX_TASK_CAPABILITY_MISSING",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: capability,
      selectedEvidence: selectedPaths,
      suggestedEvidence: suggestedEvidenceForCapability(registry, capability),
      message: `Task intent ${args.task.intent} requires ${capability}, but no selected rendered evidence proves it.`,
    }));
  }

  if (args.task.intent === "sudo_policy" && !hasTaskLocalSudoPolicy(resolved)) {
    issues.push(makeIssue({
      code: "LINUX_TASK_DELIVERABLE_UNSUPPORTED",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: "sudo observation + applicable policy",
      selectedEvidence: selectedPaths,
      suggestedEvidence: suggestedEvidenceForCapability(registry, "sudo_authorisation"),
      message: "Sudo policy comparison requires both observed sudo activity and applicable sudo policy in the task-local evidence list.",
    }));
  }
  if (args.task.requirements.some((requirement) => requirement.capability === "command_execution")) {
    for (const requirement of args.task.requirements.filter((item) => item.capability === "command_execution")) {
      const commandId = requirement.subjectIds.find((id) => id.startsWith("command:"));
      const identityId = requirement.subjectIds.find((id) => id.startsWith("identity:"));
      const command = canonicalCommandForId(args.simulation, commandId);
      const identity = canonicalIdentityForId(args.simulation, identityId);
      if (!command || !identity) continue;
      const renderedExecution = (command.actorIdentityId === identity.id || (args.task.intent !== "sudo_policy" && command.runAsIdentityId === identity.id)) && resolved.some(item =>
        item.finalAsset && sourceRecordsCommand(args.simulation, item.finalAsset, command, args.task.intent === "sudo_policy"));
      if (!renderedExecution) {
        issues.push(makeIssue({
          code: "LINUX_TASK_ATOMIC_SUPPORT_MISSING",
          task: args.task,
          taskIndex: args.taskIndex,
          requirement: "command_execution relationship",
          selectedEvidence: selectedPaths,
          suggestedEvidence: ["assets/logs/sudo.log", "assets/logs/audit.log", "assets/process_execution_history.txt"],
          message: "Command-execution findings require task-local rendered evidence showing the exact canonical command and invoking account together in timestamped execution evidence.",
        }));
      }
    }
  }

  const registryAssets = resolved
    .map((item) => item.registryAsset)
    .filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset));
  const requirementProofs = proveTaskRequirements(args.task, registryAssets);
  const missingSubjects = Array.from(new Set(requirementProofs.flatMap((proof) => proof.missingSubjectIds)));
  const contentVerifiedRequirementIds = new Set(args.task.requirements
    .filter((requirement) => satisfiedCapabilities.has(requirement.capability))
    .map((requirement) => requirement.id));
  const satisfiedSubjects = Array.from(new Set(args.task.requirements
    .filter((requirement) =>
      contentVerifiedRequirementIds.has(requirement.id) &&
      requirementProofs.some((proof) => proof.requirementId === requirement.id && proof.feasible)
    )
    .flatMap((requirement) => requirement.subjectIds)))
    .filter((subjectId) => !missingSubjects.includes(subjectId));
  const requiredSubjects = Array.from(new Set(args.task.requirements.flatMap((requirement) => requirement.subjectIds)));
  const renderedMissingSubjects = requiredSubjects.filter((subjectId) => !satisfiedSubjects.includes(subjectId));
  for (const subjectId of renderedMissingSubjects) {
    issues.push(makeIssue({
      code: "LINUX_TASK_SUBJECT_MISSING",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: subjectId,
      selectedEvidence: selectedPaths,
      suggestedEvidence: registry.filter((asset) => asset.canonicalObjectIds.includes(subjectId)).map((asset) => asset.path).slice(0, 4),
      message: `Required canonical subject ${subjectId} is not readable in the task-local rendered evidence.`,
    }));
  }

  const requiredRelationships = Array.from(new Set(args.task.requirements.map((requirement) => relationKey(requirement.relation, requirement.subjectIds)).filter(Boolean)));
  const satisfiedRelationships = Array.from(new Set(args.task.requirements
    .filter((requirement) => requirement.relation && registryAssets.some((asset) => (asset.relations || []).some((relation) =>
      relation.relation === requirement.relation &&
      requirement.subjectIds.every((subjectId) => relation.subjectIds.includes(subjectId))
    )))
    .map((requirement) => relationKey(requirement.relation, requirement.subjectIds))
    .filter(Boolean)));
  const missingRelationships = requiredRelationships.filter((key) => !satisfiedRelationships.includes(key));
  for (const relationship of missingRelationships) {
    issues.push(makeIssue({
      code: "LINUX_TASK_RELATIONSHIP_MISSING",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: relationship,
      selectedEvidence: selectedPaths,
      suggestedEvidence: registry.filter((asset) => (asset.relations || []).some((relation) => relationship.startsWith(`${relation.relation}:`))).map((asset) => asset.path).slice(0, 4),
      message: `Required relationship ${relationship} is not supported by task-local evidence.`,
    }));
  }

  const selectedStates = selectedStateTypes(resolved);
  const requiredStates = requiredStateTypes(args.task);
  const missingStates = Array.from(new Set(args.task.requiredCapabilities
    .filter((capability) => {
      const allowed = capabilityStateTypes[capability] || [];
      return allowed.length > 0 && !selectedStates.some((state) => allowed.includes(state));
    })
    .map((capability) => `${capability}:${(capabilityStateTypes[capability] || []).join("|")}`)));
  for (const state of missingStates) {
    issues.push(makeIssue({
      code: "LINUX_TASK_STATE_TYPE_MISMATCH",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: state,
      selectedEvidence: selectedPaths,
      suggestedEvidence: registry.filter((asset) => asset.stateType === state).map((asset) => asset.path).slice(0, 4),
      message: `Task requires ${state} evidence semantics but selected task evidence exposes ${selectedStates.join(", ") || "no state type"}.`,
    }));
  }

  const requiredTimestamps = args.task.requirements
    .filter((requirement) =>
      requirement.capability === "timeline_exact" ||
      requirement.capability === "service_transition" ||
      requirement.capability === "authentication" ||
      (requirement.minimumSupport === "exact" && !(args.task.intent === "service_state" && requirement.capability === "service_state"))
    )
    .map((requirement) => requirement.id);
  const satisfiedTimestamps = requiredTimestamps.filter(() => resolved.some((item) => timestampPattern.test(contentFor(item.finalAsset))));
  const missingTimestamps = requiredTimestamps.filter((item) => !satisfiedTimestamps.includes(item));
  if (/\b(?:timestamp|time|when|chronolog|sequence)\b/i.test(text) && !supportsDeliverableElement("timestamp", satisfiedCapabilities, text, resolved)) {
    issues.push(makeIssue({
      code: "LINUX_TASK_TIMESTAMP_MISSING",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: "timestamp",
      selectedEvidence: selectedPaths,
      suggestedEvidence: registry.filter((asset) => asset.exactTimestampSupport).map((asset) => asset.path).slice(0, 4),
      message: "Task requests timestamped output, but selected rendered evidence does not establish a timestamp for the requested event or state.",
    }));
  }

  const requiredDeliverableElements = (deliverableElementsByIntent[args.task.intent] || contract.requiredCapabilities)
    .filter((element) => !(element === "transition" && !args.task.requiredCapabilities.includes("service_transition")))
    .filter((element) => !(element === "timestamp" && args.task.intent === "service_state" && !args.task.requiredCapabilities.includes("service_transition")));
  const supportedDeliverableElements = requiredDeliverableElements.filter((element) => supportsDeliverableElement(element, satisfiedCapabilities, text, resolved));
  const unsupportedDeliverableElements = requiredDeliverableElements.filter((element) => !supportedDeliverableElements.includes(element));
  for (const element of unsupportedDeliverableElements) {
    issues.push(makeIssue({
      code: "LINUX_TASK_DELIVERABLE_UNSUPPORTED",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: element,
      selectedEvidence: selectedPaths,
      suggestedEvidence: canonicalSelected.map((asset) => asset.path),
      message: `Mandatory deliverable element ${element} is not supported by task-local evidence.`,
    }));
  }

  for (const claim of claimStrengthPatterns) {
    if (!claim.pattern.test(text)) continue;
    if (claim.capability === "key_provenance" && textAllowsKeyUncertainty(text)) continue;
    const supported = claim.capability === "sudo_authorisation"
      ? hasTaskLocalSudoPolicy(resolved)
      : claim.capability === "key_provenance"
        ? hasTaskLocalKeyIdentifier(resolved)
        : satisfiedCapabilities.has(claim.capability);
    if (!supported) {
      issues.push(makeIssue({
        code: claim.code,
        task: args.task,
        taskIndex: args.taskIndex,
        requirement: claim.capability,
        selectedEvidence: selectedPaths,
        suggestedEvidence: suggestedEvidenceForCapability(registry, claim.capability),
        message: claim.message,
      }));
    }
  }

  issues.push(...atomicSupportIssues({
    simulation: args.simulation,
    task: args.task,
    taskIndex: args.taskIndex,
    text,
    resolved,
    selectedPaths,
  }));

  const requiredUncertainty: string[] = [];
  const permittedUncertainty: string[] = [];
  if (keyClaimSentences(text).some(explicitlyRequiresKeyLifecycleGap)) {
    requiredUncertainty.push("document unavailable key lifecycle history and mapping without inferring a change");
  }
  if (args.task.intent === "key_provenance" && !hasTaskLocalKeyIdentifier(resolved)) {
    permittedUncertainty.push("exact SSH key identity may be unknown from supplied evidence");
    if (textAllowsKeyUncertainty(text)) {
      requiredUncertainty.push("document exact SSH-key attribution gap");
    } else if (textDemandsDefinitiveKey(text)) {
      issues.push(makeIssue({
        code: "LINUX_TASK_REQUIRED_UNCERTAINTY_MISSING",
        task: args.task,
        taskIndex: args.taskIndex,
        requirement: "key attribution uncertainty",
        selectedEvidence: selectedPaths,
        suggestedEvidence: suggestedEvidenceForCapability(registry, "key_provenance"),
        message: "Evidence requires uncertainty about exact SSH-key identity, but the task asks for definitive attribution.",
      }));
    }
  }

  const blockingIssues = issues.filter((issue) => issue.severity === "critical");
  const unsolvableIssueCodes: LinuxTaskSolvabilityCode[] = [
    "LINUX_TASK_CAPABILITY_MISSING",
    "LINUX_TASK_DELIVERABLE_UNSUPPORTED",
    "LINUX_TASK_CLAIM_STRENGTH_UNSUPPORTED",
    "LINUX_TASK_ATOMIC_SUPPORT_MISSING",
    "LINUX_TASK_IDENTITY_CLASSIFICATION_MISMATCH",
    "LINUX_TASK_EXPECTED_STATE_BASELINE_MISSING",
    "LINUX_TASK_RISK_PRIMARY_EVIDENCE_CONTRADICTION",
    "LINUX_TASK_SUDO_ACTOR_OBSERVATION_MISSING",
    "LINUX_TASK_KEY_LIFECYCLE_EVIDENCE_MISSING",
    "LINUX_TASK_TELEMETRY_COMPLETENESS_UNSUPPORTED",
  ];
  const status: StudentSolvabilityStatus = blockingIssues.length === 0
    ? requiredUncertainty.length > 0
      ? "solvable_with_required_uncertainty"
      : "solvable"
    : blockingIssues.some((issue) => unsolvableIssueCodes.includes(issue.code))
      ? "unsolvable"
      : "partially_solvable";

  if (status === "unsolvable") {
    issues.unshift(makeIssue({
      code: "LINUX_TASK_UNSOLVABLE",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: args.task.intent,
      selectedEvidence: selectedPaths,
      suggestedEvidence: canonicalSelected.map((asset) => asset.path),
      message: `Task ${args.task.id} is not solvable using only its student-facing evidence.`,
    }));
  } else if (status === "partially_solvable") {
    issues.unshift(makeIssue({
      code: "LINUX_TASK_PARTIALLY_SOLVABLE",
      task: args.task,
      taskIndex: args.taskIndex,
      requirement: args.task.intent,
      selectedEvidence: selectedPaths,
      suggestedEvidence: canonicalSelected.map((asset) => asset.path),
      message: `Task ${args.task.id} is only partially solvable using its student-facing evidence.`,
    }));
  }

  return {
    taskId: args.task.id,
    clauses: taskClauseContracts(args.task, text, resolved).map((clause, index) => ({
      ...clause,
      supported: index < args.task.requirements.length
        ? Boolean(requirementProofs.find(proof => proof.requirementId === args.task.requirements[index].id)?.feasible && satisfiedCapabilities.has(args.task.requirements[index].capability))
        : clause.action === "OBSERVED_SUDO_EXECUTION" ? taskLocalObservedSudoActor({ ...args, resolved, text: clause.text })
        : clause.action === "OBSERVED_AUTHENTICATION" ? taskLocalAuthentication({ ...args, resolved })
        : clause.action === "KEY_LIFECYCLE_HISTORY" || clause.action === "KEY_TO_FILE_LINK"
          ? clause.uncertainty === "explicit_evidence_unavailability" ? !keyClauseSupported({ ...args, resolved }, clause.text) : keyClauseSupported({ ...args, resolved }, clause.text)
          : clause.action === "HISTORICAL_FILE_ACCESS" || clause.action === "HISTORICAL_FILE_MUTATION" ? taskLocalFileOperation({ ...args, resolved }, clause.text)
          : !taskEvidenceHasDeclaredTelemetryGap(resolved) || taskEvidenceHasCompleteTelemetryAuthority({ ...args, resolved }),
    })),
    intent: args.task.intent,
    status,
    selectedEvidencePaths: selectedPaths,
    verifiedEvidencePaths: resolved.filter((item) => item.finalAsset && item.registryAsset).map((item) => item.path),
    requiredCapabilities: args.task.requiredCapabilities,
    satisfiedCapabilities: Array.from(satisfiedCapabilities).filter((capability) => args.task.requiredCapabilities.includes(capability as CanonicalEvidenceCapability)),
    missingCapabilities: missingCapabilities.filter((capability) => !(args.task.intent === "key_provenance" && capability === "key_provenance" && textAllowsKeyUncertainty(text))),
    requiredSubjects,
    satisfiedSubjects,
    missingSubjects: renderedMissingSubjects,
    requiredRelationships,
    satisfiedRelationships,
    missingRelationships,
    requiredTimestamps,
    satisfiedTimestamps,
    missingTimestamps,
    requiredStateTypes: requiredStates,
    satisfiedStateTypes: selectedStates.filter((state) => requiredStates.includes(state)),
    missingStateTypes: missingStates,
    requiredDeliverableElements,
    supportedDeliverableElements,
    unsupportedDeliverableElements,
    permittedUncertainty,
    requiredUncertainty,
    prohibitedClaims: claimStrengthPatterns.filter((claim) => claim.pattern.test(text)).map((claim) => claim.message),
    issues,
  };
}

export function validateLinuxStudentTaskSolvability(args: {
  simulation?: LinuxSimulationWorld;
  finalAssets: LabAsset[];
  lab?: LinuxStudentNarrativeForSolvability;
  evidenceRegistry?: CanonicalEvidenceAsset[];
}): LinuxStudentSolvabilityResult {
  if (!args.simulation) return { passed: true, reports: [], issues: [] };
  const tasks = args.simulation.canonicalTasks.slice().sort((left, right) => left.order - right.order);
  const reports = tasks.map((task, index) => proveLinuxStudentTaskSolvability({
    simulation: args.simulation as LinuxSimulationWorld,
    task,
    taskIndex: index,
    studentTask: args.lab?.tasks?.[index],
    finalAssets: args.finalAssets,
    evidenceRegistry: args.evidenceRegistry,
  }));
  const issues = reports.flatMap((report) => report.issues);
  return {
    passed: reports.every((report) => report.status === "solvable" || report.status === "solvable_with_required_uncertainty"),
    reports,
    issues,
  };
}

export function assertLinuxStudentTaskSolvability(args: {
  simulation?: LinuxSimulationWorld;
  finalAssets: LabAsset[];
  lab?: LinuxStudentNarrativeForSolvability;
  evidenceRegistry?: CanonicalEvidenceAsset[];
}) {
  const result = validateLinuxStudentTaskSolvability(args);
  if (!result.passed) {
    const first = result.issues[0];
    throw new Error(first
      ? `${first.code}: task ${first.taskIndex + 1} ${first.intent} ${first.message} selected=${first.selectedEvidence.join("|")}`
      : "LINUX_TASK_UNSOLVABLE: Linux task solvability validation failed.");
  }
  return result;
}
