import type { LabAsset } from "../types";
import { normalizeLinuxEvidencePath, type LinuxDifficulty } from "./difficultyProfile";
import { proveTaskRequirements } from "./grounding";
import type { LinuxIncidentFamily } from "./incidents";
import type {
  CanonicalEvidenceAsset,
  CanonicalEvidenceCapability,
  CanonicalInvestigationTask,
  LinuxSimulationWorld,
} from "./simulation";

export type LinuxIncidentEvidenceRole =
  | "observed_authentication"
  | "observed_privileged_command"
  | "effective_sudo_policy"
  | "account_identity"
  | "service_transition"
  | "service_current_state"
  | "file_metadata"
  | "process_execution"
  | "process_ancestry"
  | "scheduled_task_definition"
  | "scheduled_task_execution"
  | "package_transaction"
  | "change_record"
  | "maintenance_window"
  | "network_connection"
  | "key_provenance"
  | "configuration_baseline"
  | "business_impact_context"
  | "timeline_sequence"
  | "evidence_integrity";

export type LinuxUncertaintyRequirement =
  | "account_use_not_human_operator"
  | "excessive_sudo_not_malicious_intent"
  | "exact_ssh_key_may_be_unavailable"
  | "local_staging_not_exfiltration"
  | "current_state_not_historical_transition"
  | "scheduled_execution_not_malicious_intent"
  | "package_install_not_repository_compromise"
  | "log_gap_limits_confidence"
  | "outbound_session_not_attacker_identity"
  | "container_mount_not_full_host_compromise";

export type LinuxProhibitedConclusion =
  | "malicious_intent_without_support"
  | "exact_key_without_identifier"
  | "exfiltration_from_local_staging"
  | "human_operator_from_account_use"
  | "historical_transition_from_current_state"
  | "repository_compromise_from_package_install"
  | "full_host_compromise_from_container_mount";

export type LinuxRemediationConcept =
  | "narrow_sudo_rule"
  | "rotate_or_restrict_ssh_key"
  | "validate_account_purpose"
  | "disable_scheduled_task_after_capture"
  | "preserve_and_disable_unit"
  | "verify_package_provenance_or_rollback"
  | "quarantine_staged_data_and_validate_transfer"
  | "restore_logging_and_preserve_secondary_sources"
  | "contain_process_and_review_egress"
  | "harden_container_runtime_boundary";

export type LinuxIncidentCoverageStatus = "covered" | "partially_covered" | "not_covered";

export type LinuxIncidentCoverageCode =
  | "LINUX_INCIDENT_COVERAGE_MISSING"
  | "LINUX_INCIDENT_QUESTION_MISSING"
  | "LINUX_INCIDENT_INTENT_MISSING"
  | "LINUX_INCIDENT_CAPABILITY_MISSING"
  | "LINUX_INCIDENT_EVIDENCE_ROLE_MISSING"
  | "LINUX_INCIDENT_UNCERTAINTY_BOUNDARY_MISSING"
  | "LINUX_INCIDENT_REMEDIATION_MISSING"
  | "LINUX_INCIDENT_PROHIBITED_CONCLUSION"
  | "LINUX_INCIDENT_CONTRACT_MISSING"
  | "LINUX_INCIDENT_CONTRACT_INVALID";

type CoverageRequirement = {
  id: string;
  taskIntents?: CanonicalInvestigationTask["intent"][];
  capabilities?: CanonicalEvidenceCapability[];
  evidenceRoles?: LinuxIncidentEvidenceRole[];
  uncertainty?: LinuxUncertaintyRequirement;
  remediation?: LinuxRemediationConcept;
};

export type LinuxIncidentDifficultyCoverage = {
  mandatoryQuestionIds: string[];
  mandatoryTaskIntents: CanonicalInvestigationTask["intent"][];
  mandatoryCapabilities: CanonicalEvidenceCapability[];
  mandatoryEvidenceRoles: LinuxIncidentEvidenceRole[];
  requiredUncertaintyBoundaries: LinuxUncertaintyRequirement[];
  requiredRemediationConcepts: LinuxRemediationConcept[];
};

export type LinuxIncidentInvestigationContract = {
  incidentFamily: LinuxIncidentFamily;
  version: string;
  definingMechanism: string;
  primarySubjectKinds: string[];
  requiredRelationshipKinds: string[];
  mandatoryQuestionIds: string[];
  mandatoryTaskIntents: CanonicalInvestigationTask["intent"][];
  mandatoryCapabilities: CanonicalEvidenceCapability[];
  mandatoryEvidenceRoles: LinuxIncidentEvidenceRole[];
  requiredUncertaintyBoundaries: LinuxUncertaintyRequirement[];
  prohibitedConclusions: LinuxProhibitedConclusion[];
  requiredRemediationConcepts: LinuxRemediationConcept[];
  questionRequirements: Record<string, CoverageRequirement>;
  difficultyRequirements: Record<Lowercase<LinuxDifficulty>, LinuxIncidentDifficultyCoverage>;
};

export type LinuxCoverageRequirementResult = {
  id: string;
  covered: boolean;
  coveredByTaskIds: string[];
  missing: string[];
};

export type LinuxIncidentCoverageIssue = {
  code: LinuxIncidentCoverageCode;
  severity: "critical";
  incidentFamily: string;
  difficulty: LinuxDifficulty;
  requirementId: string;
  finalTaskIds: string[];
  presentCapabilities: string[];
  presentEvidenceRoles: string[];
  suggestedTaskIntents: string[];
  regenerationCanRepair: boolean;
  message: string;
};

export type LinuxIncidentCoverageReport = {
  incidentFamily: LinuxIncidentFamily;
  contractVersion: string;
  difficulty: LinuxDifficulty;
  status: LinuxIncidentCoverageStatus;
  mandatoryQuestions: LinuxCoverageRequirementResult[];
  mandatoryTaskIntents: LinuxCoverageRequirementResult[];
  mandatoryCapabilities: LinuxCoverageRequirementResult[];
  mandatoryEvidenceRoles: LinuxCoverageRequirementResult[];
  uncertaintyBoundaries: LinuxCoverageRequirementResult[];
  remediationConcepts: LinuxCoverageRequirementResult[];
  coveredByTaskIds: Record<string, string[]>;
  missingRequirementIds: string[];
  issues: LinuxIncidentCoverageIssue[];
};

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

function coverage(
  mandatoryQuestionIds: string[],
  mandatoryTaskIntents: CanonicalInvestigationTask["intent"][],
  mandatoryCapabilities: CanonicalEvidenceCapability[],
  mandatoryEvidenceRoles: LinuxIncidentEvidenceRole[],
  requiredUncertaintyBoundaries: LinuxUncertaintyRequirement[],
  requiredRemediationConcepts: LinuxRemediationConcept[]
): LinuxIncidentDifficultyCoverage {
  return {
    mandatoryQuestionIds,
    mandatoryTaskIntents,
    mandatoryCapabilities,
    mandatoryEvidenceRoles,
    requiredUncertaintyBoundaries,
    requiredRemediationConcepts,
  };
}

function byDifficulty(
  beginner: LinuxIncidentDifficultyCoverage,
  intermediate: LinuxIncidentDifficultyCoverage,
  advanced: LinuxIncidentDifficultyCoverage = intermediate
) {
  return { beginner, intermediate, advanced };
}

function contract(args: Omit<LinuxIncidentInvestigationContract, "version">): LinuxIncidentInvestigationContract {
  return { version: "linux-incident-investigation-contract-v1", ...args };
}

export const LINUX_INCIDENT_INVESTIGATION_CONTRACTS: Record<LinuxIncidentFamily, LinuxIncidentInvestigationContract> = {
  misconfigured_sudoers: contract({
    incidentFamily: "misconfigured_sudoers",
    definingMechanism: "An account executed a privileged command that must be compared with its effective sudo policy boundary.",
    primarySubjectKinds: ["identity", "command", "sudo_policy", "configuration"],
    requiredRelationshipKinds: ["executed_by", "authorized_by_policy"],
    mandatoryQuestionIds: ["sudo_actor", "sudo_command", "sudo_policy_rule", "sudo_business_need", "sudo_next_step"],
    mandatoryTaskIntents: ["sudo_policy", "actor_attribution"],
    mandatoryCapabilities: ["sudo_authorisation", "actor_attribution", "configuration_baseline"],
    mandatoryEvidenceRoles: ["account_identity", "observed_privileged_command", "effective_sudo_policy"],
    requiredUncertaintyBoundaries: ["excessive_sudo_not_malicious_intent"],
    prohibitedConclusions: ["malicious_intent_without_support"],
    requiredRemediationConcepts: ["narrow_sudo_rule"],
    questionRequirements: {
      sudo_actor: { id: "sudo_actor", capabilities: ["actor_attribution", "command_execution"], evidenceRoles: ["account_identity", "observed_privileged_command"], taskIntents: ["sudo_policy"] },
      sudo_command: { id: "sudo_command", capabilities: ["sudo_authorisation"], evidenceRoles: ["observed_privileged_command"], taskIntents: ["sudo_policy"] },
      sudo_policy_rule: { id: "sudo_policy_rule", capabilities: ["sudo_authorisation", "configuration_baseline"], evidenceRoles: ["effective_sudo_policy"], taskIntents: ["sudo_policy"] },
      sudo_business_need: { id: "sudo_business_need", capabilities: ["configuration_baseline"], evidenceRoles: ["effective_sudo_policy"], taskIntents: ["sudo_policy", "configuration_review"] },
      sudo_next_step: { id: "sudo_next_step", remediation: "narrow_sudo_rule", taskIntents: ["sudo_policy", "containment_recommendation", "risk_assessment"] },
    },
    difficultyRequirements: byDifficulty(
      coverage(["sudo_actor", "sudo_command", "sudo_policy_rule", "sudo_next_step"], ["sudo_policy"], ["sudo_authorisation", "actor_attribution", "configuration_baseline"], ["account_identity", "observed_privileged_command", "effective_sudo_policy"], ["excessive_sudo_not_malicious_intent"], ["narrow_sudo_rule"]),
      coverage(["sudo_actor", "sudo_command", "sudo_policy_rule", "sudo_business_need", "sudo_next_step"], ["sudo_policy", "actor_attribution"], ["sudo_authorisation", "actor_attribution", "configuration_baseline"], ["account_identity", "observed_privileged_command", "effective_sudo_policy"], ["excessive_sudo_not_malicious_intent"], ["narrow_sudo_rule"])
    ),
  }),
  ssh_bruteforce: contract({
    incidentFamily: "ssh_bruteforce",
    definingMechanism: "Repeated SSH failures were followed by a successful authentication that requires source and account validation.",
    primarySubjectKinds: ["ssh_session", "identity", "source_ip"],
    requiredRelationshipKinds: ["authenticated_as"],
    mandatoryQuestionIds: ["ssh_account", "ssh_source", "ssh_sequence", "ssh_control_gap", "ssh_next_step"],
    mandatoryTaskIntents: ["ssh_authentication", "actor_attribution", "scope_timeline"],
    mandatoryCapabilities: ["authentication", "actor_attribution", "timeline_exact", "configuration_baseline"],
    mandatoryEvidenceRoles: ["observed_authentication", "account_identity", "timeline_sequence", "configuration_baseline"],
    requiredUncertaintyBoundaries: ["account_use_not_human_operator"],
    prohibitedConclusions: ["human_operator_from_account_use"],
    requiredRemediationConcepts: ["validate_account_purpose"],
    questionRequirements: {
      ssh_account: { id: "ssh_account", capabilities: ["authentication", "actor_attribution"], evidenceRoles: ["observed_authentication", "account_identity"], taskIntents: ["ssh_authentication", "actor_attribution"] },
      ssh_source: { id: "ssh_source", capabilities: ["authentication"], evidenceRoles: ["observed_authentication"], taskIntents: ["ssh_authentication"] },
      ssh_sequence: { id: "ssh_sequence", capabilities: ["timeline_exact"], evidenceRoles: ["timeline_sequence"], taskIntents: ["scope_timeline", "ssh_authentication"] },
      ssh_control_gap: { id: "ssh_control_gap", capabilities: ["configuration_baseline"], evidenceRoles: ["configuration_baseline"], taskIntents: ["ssh_authentication", "configuration_review"] },
      ssh_next_step: { id: "ssh_next_step", remediation: "validate_account_purpose", taskIntents: ["actor_attribution", "containment_recommendation"] },
    },
    difficultyRequirements: byDifficulty(
      coverage(["ssh_account", "ssh_source", "ssh_sequence", "ssh_next_step"], ["ssh_authentication", "actor_attribution"], ["authentication", "actor_attribution", "timeline_exact"], ["observed_authentication", "account_identity", "timeline_sequence"], ["account_use_not_human_operator"], ["validate_account_purpose"]),
      coverage(["ssh_account", "ssh_source", "ssh_sequence", "ssh_control_gap", "ssh_next_step"], ["ssh_authentication", "actor_attribution", "scope_timeline"], ["authentication", "actor_attribution", "timeline_exact", "configuration_baseline"], ["observed_authentication", "account_identity", "timeline_sequence", "configuration_baseline"], ["account_use_not_human_operator"], ["validate_account_purpose"])
    ),
  }),
  service_account_misuse: contract({
    incidentFamily: "service_account_misuse",
    definingMechanism: "A service account shows interactive or privileged activity outside its expected automation role.",
    primarySubjectKinds: ["identity", "command", "file"],
    requiredRelationshipKinds: ["executed_by"],
    mandatoryQuestionIds: ["service_account_identity", "service_account_activity", "service_account_role_boundary", "service_account_next_step"],
    mandatoryTaskIntents: ["actor_attribution", "command_process", "file_permissions"],
    mandatoryCapabilities: ["actor_attribution", "command_execution", "file_owner_group_mode"],
    mandatoryEvidenceRoles: ["account_identity", "process_execution", "file_metadata"],
    requiredUncertaintyBoundaries: ["account_use_not_human_operator"],
    prohibitedConclusions: ["human_operator_from_account_use"],
    requiredRemediationConcepts: ["validate_account_purpose"],
    questionRequirements: {
      service_account_identity: { id: "service_account_identity", capabilities: ["actor_attribution"], evidenceRoles: ["account_identity"], taskIntents: ["actor_attribution"] },
      service_account_activity: { id: "service_account_activity", capabilities: ["command_execution"], evidenceRoles: ["process_execution"], taskIntents: ["actor_attribution", "scope_timeline", "command_process"] },
      service_account_role_boundary: { id: "service_account_role_boundary", capabilities: ["file_owner_group_mode"], evidenceRoles: ["file_metadata"], taskIntents: ["file_permissions"] },
      service_account_next_step: { id: "service_account_next_step", remediation: "validate_account_purpose", taskIntents: ["actor_attribution", "containment_recommendation"] },
    },
    difficultyRequirements: byDifficulty(
      coverage(["service_account_identity", "service_account_activity", "service_account_next_step"], ["actor_attribution", "file_permissions"], ["actor_attribution", "command_execution", "file_owner_group_mode"], ["account_identity", "process_execution", "file_metadata"], ["account_use_not_human_operator"], ["validate_account_purpose"]),
      coverage(["service_account_identity", "service_account_activity", "service_account_role_boundary", "service_account_next_step"], ["actor_attribution", "file_permissions"], ["actor_attribution", "command_execution", "file_owner_group_mode"], ["account_identity", "process_execution", "file_metadata"], ["account_use_not_human_operator"], ["validate_account_purpose"]),
      coverage(["service_account_identity", "service_account_activity", "service_account_role_boundary", "service_account_next_step"], ["actor_attribution", "command_process", "file_permissions"], ["actor_attribution", "command_execution", "file_owner_group_mode"], ["account_identity", "process_execution", "file_metadata"], ["account_use_not_human_operator"], ["validate_account_purpose"])
    ),
  }),
  ssh_key_compromise: contract({
    incidentFamily: "ssh_key_compromise",
    definingMechanism: "A valid SSH key-based authentication requires provenance, source, and lifecycle validation.",
    primarySubjectKinds: ["ssh_session", "identity", "key_material"],
    requiredRelationshipKinds: ["authenticated_as"],
    mandatoryQuestionIds: ["key_account", "key_source", "key_identifier_or_gap", "key_lifecycle", "key_next_step"],
    mandatoryTaskIntents: ["ssh_authentication", "key_provenance", "actor_attribution"],
    mandatoryCapabilities: ["authentication", "actor_attribution", "key_provenance"],
    mandatoryEvidenceRoles: ["observed_authentication", "account_identity", "key_provenance"],
    requiredUncertaintyBoundaries: ["exact_ssh_key_may_be_unavailable"],
    prohibitedConclusions: ["exact_key_without_identifier"],
    requiredRemediationConcepts: ["rotate_or_restrict_ssh_key"],
    questionRequirements: {
      key_account: { id: "key_account", capabilities: ["authentication", "actor_attribution"], evidenceRoles: ["observed_authentication", "account_identity"], taskIntents: ["ssh_authentication", "actor_attribution"] },
      key_source: { id: "key_source", capabilities: ["authentication"], evidenceRoles: ["observed_authentication"], taskIntents: ["ssh_authentication"] },
      key_identifier_or_gap: { id: "key_identifier_or_gap", capabilities: ["key_provenance"], evidenceRoles: ["key_provenance"], taskIntents: ["key_provenance"] },
      key_lifecycle: { id: "key_lifecycle", capabilities: ["key_provenance"], evidenceRoles: ["key_provenance"], taskIntents: ["key_provenance"] },
      key_next_step: { id: "key_next_step", remediation: "rotate_or_restrict_ssh_key", taskIntents: ["key_provenance", "containment_recommendation", "configuration_review", "actor_attribution", "ssh_authentication"] },
    },
    difficultyRequirements: byDifficulty(
      coverage(["key_account", "key_source", "key_next_step"], ["ssh_authentication", "actor_attribution"], ["authentication", "actor_attribution"], ["observed_authentication", "account_identity"], ["exact_ssh_key_may_be_unavailable"], ["rotate_or_restrict_ssh_key"]),
      coverage(["key_account", "key_source", "key_identifier_or_gap", "key_lifecycle", "key_next_step"], ["ssh_authentication", "key_provenance"], ["authentication", "actor_attribution", "key_provenance"], ["observed_authentication", "account_identity", "key_provenance"], ["exact_ssh_key_may_be_unavailable"], ["rotate_or_restrict_ssh_key"])
    ),
  }),
  cron_persistence: contract({
    incidentFamily: "cron_persistence",
    definingMechanism: "A scheduled task definition and execution require persistence and approval review.",
    primarySubjectKinds: ["cron_definition", "identity", "command"],
    requiredRelationshipKinds: ["defines_schedule", "executed_schedule"],
    mandatoryQuestionIds: ["cron_definition", "cron_owner", "cron_execution", "cron_approval", "cron_next_step"],
    mandatoryTaskIntents: ["cron_analysis", "actor_attribution", "change_control"],
    mandatoryCapabilities: ["cron_definition", "cron_execution", "actor_attribution", "change_control"],
    mandatoryEvidenceRoles: ["scheduled_task_definition", "scheduled_task_execution", "account_identity", "change_record"],
    requiredUncertaintyBoundaries: ["scheduled_execution_not_malicious_intent"],
    prohibitedConclusions: ["malicious_intent_without_support"],
    requiredRemediationConcepts: ["disable_scheduled_task_after_capture"],
    questionRequirements: {
      cron_definition: { id: "cron_definition", capabilities: ["cron_definition"], evidenceRoles: ["scheduled_task_definition"], taskIntents: ["cron_analysis"] },
      cron_owner: { id: "cron_owner", capabilities: ["actor_attribution"], evidenceRoles: ["account_identity"], taskIntents: ["cron_analysis"] },
      cron_execution: { id: "cron_execution", capabilities: ["cron_execution"], evidenceRoles: ["scheduled_task_execution"], taskIntents: ["cron_analysis", "scope_timeline"] },
      cron_approval: { id: "cron_approval", capabilities: ["change_control"], evidenceRoles: ["change_record"], taskIntents: ["change_control"] },
      cron_next_step: { id: "cron_next_step", remediation: "disable_scheduled_task_after_capture", taskIntents: ["cron_analysis"] },
    },
    difficultyRequirements: byDifficulty(
      coverage([], ["configuration_review", "actor_attribution"], ["configuration_baseline", "actor_attribution"], ["configuration_baseline", "account_identity"], ["scheduled_execution_not_malicious_intent"], ["disable_scheduled_task_after_capture"]),
      coverage(["cron_definition", "cron_owner", "cron_execution", "cron_approval", "cron_next_step"], ["cron_analysis", "change_control"], ["cron_definition", "cron_execution", "actor_attribution", "change_control"], ["scheduled_task_definition", "scheduled_task_execution", "account_identity", "change_record"], ["scheduled_execution_not_malicious_intent"], ["disable_scheduled_task_after_capture"])
    ),
  }),
  systemd_persistence: contract({
    incidentFamily: "systemd_persistence",
    definingMechanism: "A systemd unit definition or transition requires baseline and change-control validation.",
    primarySubjectKinds: ["service", "service_transition", "configuration"],
    requiredRelationshipKinds: ["transitioned_service"],
    mandatoryQuestionIds: ["systemd_unit", "systemd_transition", "systemd_baseline", "systemd_next_step"],
    mandatoryTaskIntents: ["service_state", "configuration_review"],
    mandatoryCapabilities: ["service_state", "service_transition", "configuration_baseline"],
    mandatoryEvidenceRoles: ["service_current_state", "service_transition", "configuration_baseline"],
    requiredUncertaintyBoundaries: ["current_state_not_historical_transition"],
    prohibitedConclusions: ["historical_transition_from_current_state"],
    requiredRemediationConcepts: ["preserve_and_disable_unit"],
    questionRequirements: {
      systemd_unit: { id: "systemd_unit", capabilities: ["service_state"], evidenceRoles: ["service_current_state"], taskIntents: ["service_state"] },
      systemd_transition: { id: "systemd_transition", capabilities: ["service_transition"], evidenceRoles: ["service_transition"], taskIntents: ["service_state", "scope_timeline"] },
      systemd_baseline: { id: "systemd_baseline", capabilities: ["configuration_baseline"], evidenceRoles: ["configuration_baseline"], taskIntents: ["configuration_review"] },
      systemd_next_step: { id: "systemd_next_step", remediation: "preserve_and_disable_unit", taskIntents: ["service_state", "containment_recommendation"] },
    },
    difficultyRequirements: byDifficulty(
      coverage(["systemd_unit", "systemd_baseline", "systemd_next_step"], ["service_state", "configuration_review"], ["service_state", "configuration_baseline"], ["service_current_state", "configuration_baseline"], ["current_state_not_historical_transition"], ["preserve_and_disable_unit"]),
      coverage(["systemd_unit", "systemd_transition", "systemd_baseline", "systemd_next_step"], ["service_state", "configuration_review"], ["service_state", "service_transition", "configuration_baseline"], ["service_current_state", "service_transition", "configuration_baseline"], ["current_state_not_historical_transition"], ["preserve_and_disable_unit"])
    ),
  }),
  unauthorized_package_install: contract({
    incidentFamily: "unauthorized_package_install",
    definingMechanism: "A package transaction must be reconciled with the actor, maintenance scope, and provenance or rollback decision.",
    primarySubjectKinds: ["package_transaction", "identity", "maintenance_activity"],
    requiredRelationshipKinds: ["installed_package", "covered_by_change"],
    mandatoryQuestionIds: ["package_transaction", "package_actor", "package_maintenance", "package_next_step"],
    mandatoryTaskIntents: ["package_transaction", "change_control"],
    mandatoryCapabilities: ["package_transaction", "actor_attribution", "change_control", "maintenance_scope"],
    mandatoryEvidenceRoles: ["package_transaction", "account_identity", "change_record", "maintenance_window"],
    requiredUncertaintyBoundaries: ["package_install_not_repository_compromise"],
    prohibitedConclusions: ["repository_compromise_from_package_install"],
    requiredRemediationConcepts: ["verify_package_provenance_or_rollback"],
    questionRequirements: {
      package_transaction: { id: "package_transaction", capabilities: ["package_transaction"], evidenceRoles: ["package_transaction"], taskIntents: ["package_transaction"] },
      package_actor: { id: "package_actor", capabilities: ["actor_attribution"], evidenceRoles: ["account_identity"], taskIntents: ["package_transaction", "actor_attribution"] },
      package_maintenance_gap: { id: "package_maintenance_gap", capabilities: ["configuration_baseline"], evidenceRoles: ["configuration_baseline"], taskIntents: ["configuration_review"] },
      package_maintenance: { id: "package_maintenance", capabilities: ["package_transaction", "maintenance_scope"], evidenceRoles: ["package_transaction", "change_record"], taskIntents: ["change_control"] },
      package_next_step: { id: "package_next_step", remediation: "verify_package_provenance_or_rollback", taskIntents: ["package_transaction", "containment_recommendation", "configuration_review", "actor_attribution"] },
    },
    difficultyRequirements: byDifficulty(
      coverage(["package_actor", "package_maintenance_gap", "package_next_step"], ["actor_attribution", "configuration_review"], ["actor_attribution", "configuration_baseline"], ["account_identity", "configuration_baseline"], ["package_install_not_repository_compromise"], ["verify_package_provenance_or_rollback"]),
      coverage(["package_transaction", "package_actor", "package_maintenance", "package_next_step"], ["package_transaction", "change_control"], ["package_transaction", "actor_attribution", "change_control", "maintenance_scope"], ["package_transaction", "account_identity", "change_record", "maintenance_window"], ["package_install_not_repository_compromise"], ["verify_package_provenance_or_rollback"]),
      coverage(["package_transaction", "package_actor", "package_maintenance", "package_next_step"], ["package_transaction", "change_control", "configuration_review"], ["package_transaction", "actor_attribution", "change_control", "maintenance_scope", "configuration_baseline"], ["package_transaction", "account_identity", "change_record", "maintenance_window", "configuration_baseline"], ["package_install_not_repository_compromise"], ["verify_package_provenance_or_rollback"])
    ),
  }),
  data_staging: contract({
    incidentFamily: "data_staging",
    definingMechanism: "Local archive or copy activity must be scoped as staging, transfer, or unresolved preparation.",
    primarySubjectKinds: ["file", "process", "identity"],
    requiredRelationshipKinds: ["opened_file", "executed_by"],
    mandatoryQuestionIds: ["staging_actor", "staging_paths", "staging_sequence", "staging_scope_boundary", "staging_next_step"],
    mandatoryTaskIntents: ["command_process", "file_permissions", "scope_timeline"],
    mandatoryCapabilities: ["command_execution", "file_owner_group_mode", "timeline_exact"],
    mandatoryEvidenceRoles: ["process_execution", "file_metadata", "timeline_sequence"],
    requiredUncertaintyBoundaries: ["local_staging_not_exfiltration"],
    prohibitedConclusions: ["exfiltration_from_local_staging"],
    requiredRemediationConcepts: ["quarantine_staged_data_and_validate_transfer"],
    questionRequirements: {
      staging_actor: { id: "staging_actor", capabilities: ["actor_attribution"], evidenceRoles: ["account_identity"], taskIntents: ["actor_attribution", "command_process"] },
      staging_paths: { id: "staging_paths", capabilities: ["file_owner_group_mode"], evidenceRoles: ["file_metadata"], taskIntents: ["file_permissions", "command_process"] },
      staging_sequence: { id: "staging_sequence", capabilities: ["timeline_exact"], evidenceRoles: ["timeline_sequence"], taskIntents: ["scope_timeline"] },
      staging_scope_boundary: { id: "staging_scope_boundary", capabilities: ["file_owner_group_mode"], evidenceRoles: ["file_metadata"], taskIntents: ["file_permissions", "impact_assessment"] },
      staging_next_step: { id: "staging_next_step", remediation: "quarantine_staged_data_and_validate_transfer", taskIntents: ["file_permissions", "containment_recommendation"] },
    },
    difficultyRequirements: byDifficulty(
      coverage(["staging_actor", "staging_paths", "staging_scope_boundary", "staging_next_step"], ["file_permissions", "actor_attribution"], ["actor_attribution", "file_owner_group_mode"], ["account_identity", "file_metadata"], ["local_staging_not_exfiltration"], ["quarantine_staged_data_and_validate_transfer"]),
      coverage(["staging_actor", "staging_paths", "staging_sequence", "staging_scope_boundary", "staging_next_step"], ["command_process", "file_permissions", "scope_timeline"], ["command_execution", "file_owner_group_mode", "timeline_exact"], ["process_execution", "file_metadata", "timeline_sequence"], ["local_staging_not_exfiltration"], ["quarantine_staged_data_and_validate_transfer"])
    ),
  }),
  log_tampering: contract({
    incidentFamily: "log_tampering",
    definingMechanism: "A log gap or rotation event must be correlated against secondary evidence before confidence is assigned.",
    primarySubjectKinds: ["timeline", "service", "evidence_source"],
    requiredRelationshipKinds: ["secondary_source_corroborates"],
    mandatoryQuestionIds: ["log_gap", "log_secondary_source", "log_confidence", "log_next_step"],
    mandatoryTaskIntents: ["evidence_integrity", "scope_timeline", "service_state"],
    mandatoryCapabilities: ["timeline_context", "service_state", "evidence_integrity"],
    mandatoryEvidenceRoles: ["timeline_sequence", "service_current_state", "evidence_integrity"],
    requiredUncertaintyBoundaries: ["log_gap_limits_confidence"],
    prohibitedConclusions: ["malicious_intent_without_support"],
    requiredRemediationConcepts: ["restore_logging_and_preserve_secondary_sources"],
    questionRequirements: {
      log_gap: { id: "log_gap", capabilities: ["timeline_context"], evidenceRoles: ["timeline_sequence"], taskIntents: ["scope_timeline", "evidence_integrity"] },
      log_secondary_source: { id: "log_secondary_source", capabilities: ["service_state"], evidenceRoles: ["service_current_state"], taskIntents: ["service_state", "evidence_integrity"] },
      log_confidence: { id: "log_confidence", uncertainty: "log_gap_limits_confidence", taskIntents: ["evidence_integrity", "scope_timeline", "service_state"] },
      log_next_step: { id: "log_next_step", remediation: "restore_logging_and_preserve_secondary_sources", taskIntents: ["evidence_integrity", "containment_recommendation", "scope_timeline", "service_state"] },
    },
    difficultyRequirements: byDifficulty(
      coverage(["log_gap", "log_confidence", "log_next_step"], ["scope_timeline", "service_state"], ["timeline_context", "service_state"], ["timeline_sequence", "service_current_state"], ["log_gap_limits_confidence"], ["restore_logging_and_preserve_secondary_sources"]),
      coverage(["log_gap", "log_secondary_source", "log_confidence", "log_next_step"], ["scope_timeline", "service_state"], ["timeline_context", "service_state"], ["timeline_sequence", "service_current_state"], ["log_gap_limits_confidence"], ["restore_logging_and_preserve_secondary_sources"])
    ),
  }),
  reverse_shell: contract({
    incidentFamily: "reverse_shell",
    definingMechanism: "A process and outbound network session must be correlated to application context and containment.",
    primarySubjectKinds: ["process", "network", "identity", "service"],
    requiredRelationshipKinds: ["spawned_process", "opened_connection"],
    mandatoryQuestionIds: ["reverse_process", "reverse_network", "reverse_actor_service", "reverse_next_step"],
    mandatoryTaskIntents: ["command_process", "network_source", "actor_attribution"],
    mandatoryCapabilities: ["command_execution", "process_ancestry", "network_source", "actor_attribution"],
    mandatoryEvidenceRoles: ["process_execution", "process_ancestry", "network_connection", "account_identity"],
    requiredUncertaintyBoundaries: ["outbound_session_not_attacker_identity"],
    prohibitedConclusions: ["human_operator_from_account_use", "malicious_intent_without_support"],
    requiredRemediationConcepts: ["contain_process_and_review_egress"],
    questionRequirements: {
      reverse_process: { id: "reverse_process", capabilities: ["command_execution", "process_ancestry"], evidenceRoles: ["process_execution", "process_ancestry"], taskIntents: ["command_process"] },
      reverse_network: { id: "reverse_network", capabilities: ["network_source"], evidenceRoles: ["network_connection"], taskIntents: ["network_source"] },
      reverse_actor_service: { id: "reverse_actor_service", capabilities: ["actor_attribution"], evidenceRoles: ["account_identity"], taskIntents: ["actor_attribution", "service_state"] },
      reverse_next_step: { id: "reverse_next_step", remediation: "contain_process_and_review_egress", taskIntents: ["network_source", "containment_recommendation", "actor_attribution", "service_state"] },
    },
    difficultyRequirements: byDifficulty(
      coverage(["reverse_actor_service", "reverse_next_step"], ["actor_attribution", "service_state"], ["actor_attribution", "service_state"], ["account_identity", "service_current_state"], ["outbound_session_not_attacker_identity"], ["contain_process_and_review_egress"]),
      coverage(["reverse_process", "reverse_network", "reverse_actor_service", "reverse_next_step"], ["command_process", "network_source", "actor_attribution"], ["command_execution", "process_ancestry", "network_source", "actor_attribution"], ["process_execution", "process_ancestry", "network_connection", "account_identity"], ["outbound_session_not_attacker_identity"], ["contain_process_and_review_egress"])
    ),
  }),
  docker_compromise: contract({
    incidentFamily: "docker_compromise",
    definingMechanism: "Container runtime activity and host-boundary exposure must be compared with mount, identity, and service configuration evidence.",
    primarySubjectKinds: ["process", "file", "identity", "service"],
    requiredRelationshipKinds: ["executed_by", "opened_file"],
    mandatoryQuestionIds: ["docker_runtime", "docker_mount_or_file", "docker_actor", "docker_boundary", "docker_next_step"],
    mandatoryTaskIntents: ["command_process", "file_permissions", "actor_attribution", "configuration_review"],
    mandatoryCapabilities: ["command_execution", "file_owner_group_mode", "actor_attribution", "configuration_baseline"],
    mandatoryEvidenceRoles: ["process_execution", "file_metadata", "account_identity", "configuration_baseline"],
    requiredUncertaintyBoundaries: ["container_mount_not_full_host_compromise"],
    prohibitedConclusions: ["full_host_compromise_from_container_mount"],
    requiredRemediationConcepts: ["harden_container_runtime_boundary"],
    questionRequirements: {
      docker_runtime: { id: "docker_runtime", capabilities: ["command_execution"], evidenceRoles: ["process_execution"], taskIntents: ["command_process"] },
      docker_mount_or_file: { id: "docker_mount_or_file", capabilities: ["file_owner_group_mode"], evidenceRoles: ["file_metadata"], taskIntents: ["file_permissions"] },
      docker_actor: { id: "docker_actor", capabilities: ["actor_attribution"], evidenceRoles: ["account_identity"], taskIntents: ["actor_attribution"] },
      docker_boundary: { id: "docker_boundary", capabilities: ["configuration_baseline"], evidenceRoles: ["configuration_baseline"], taskIntents: ["configuration_review"] },
      docker_next_step: { id: "docker_next_step", remediation: "harden_container_runtime_boundary", taskIntents: ["configuration_review", "containment_recommendation"] },
    },
    difficultyRequirements: byDifficulty(
      coverage(["docker_mount_or_file", "docker_actor", "docker_boundary", "docker_next_step"], ["file_permissions", "actor_attribution", "configuration_review"], ["file_owner_group_mode", "actor_attribution", "configuration_baseline"], ["file_metadata", "account_identity", "configuration_baseline"], ["container_mount_not_full_host_compromise"], ["harden_container_runtime_boundary"]),
      coverage(["docker_runtime", "docker_mount_or_file", "docker_actor", "docker_boundary", "docker_next_step"], ["command_process", "file_permissions", "actor_attribution", "configuration_review"], ["command_execution", "file_owner_group_mode", "actor_attribution", "configuration_baseline"], ["process_execution", "file_metadata", "account_identity", "configuration_baseline"], ["container_mount_not_full_host_compromise"], ["harden_container_runtime_boundary"])
    ),
  }),
};

const remediationPatterns: Record<LinuxRemediationConcept, RegExp> = {
  narrow_sudo_rule: /\b(?:narrow|remove|least[- ]privilege|restrict)\b.*\b(?:sudo|sudoers|rule|privilege)\b/i,
  rotate_or_restrict_ssh_key: /\b(?:rotate|revoke|restrict)\b.*\b(?:ssh|key|authorized_keys|trust|source)\b/i,
  validate_account_purpose: /\b(?:validat\w*|confirm|disable|lock|restrict)\b.*\b(?:account|shell|credential|owner|purpose)\b/i,
  disable_scheduled_task_after_capture: /\b(?:preserve|capture|disable|remove|quarantine)\b.*\b(?:cron|scheduled|schedule|task)\b/i,
  preserve_and_disable_unit: /\b(?:preserve|capture|disable|mask|inspect)\b.*\b(?:systemd|unit|service)\b/i,
  verify_package_provenance_or_rollback: /(?:\b(?:rollback|roll back|remove\s+(?:the\s+)?package|restore\s+(?:the\s+)?package)\b|\b(?:propose|recommend|plan|steps?|response|remediat\w*)\b[^.!?\n]{0,120}\b(?:verif\w*|validat\w*|confirm|check)\b[^.!?\n]{0,120}\b(?:package|apt|dpkg)\s+provenance\b)/i,
  quarantine_staged_data_and_validate_transfer: /\b(?:quarantine|preserve|validate|scope|transfer|staging)\b.*\b(?:archive|data|file|copy|transfer)\b/i,
  restore_logging_and_preserve_secondary_sources: /\b(?:restore|preserve|validate|recover)\b.*\b(?:log|logging|journal|audit|secondary)\b/i,
  contain_process_and_review_egress: /\b(?:contain|kill|isolate|review|block)\b.*\b(?:process|egress|outbound|network|connection)\b/i,
  harden_container_runtime_boundary: /\b(?:harden|restrict|remove|limit)\b.*\b(?:container|docker|mount|runtime|group)\b/i,
};

const uncertaintyPatterns: Record<LinuxUncertaintyRequirement, RegExp> = {
  account_use_not_human_operator: /\b(?:account use|account activity|login|session)\b.*\b(?:does not|cannot|not enough|requires)\b.*\b(?:human|operator|person|owner|intent)\b/i,
  excessive_sudo_not_malicious_intent: /(?:\b(?:sudo|privilege|authorization|authorisation)\b.*\b(?:does not|cannot|not enough|requires)\b.*\b(?:malicious|intent|attacker)\b|\bthe listed evidence\b.*\bdoes not\b.*\b(?:malicious|intent)\b.*\b(?:validation gaps?|facts)\b)/i,
  exact_ssh_key_may_be_unavailable: /\b(?:key|fingerprint|authorized_keys)\b.*\b(?:may contain a gap|does not|cannot|not enough|if absent|unavailable|requires|separate observed facts)\b/i,
  local_staging_not_exfiltration: /\b(?:staging|archive|local)\b.*\b(?:does not|cannot|not enough|requires)\b.*\b(?:exfiltration|transfer|left the host)\b/i,
  current_state_not_historical_transition: /\b(?:current state|inventory|snapshot)\b.*\b(?:does not|cannot|not enough|requires)\b.*\b(?:restart|transition|historical)\b/i,
  scheduled_execution_not_malicious_intent: /\b(?:cron|scheduled|schedule)\b.*\b(?:does not|cannot|not enough|requires)\b.*\b(?:malicious|intent|persistence)\b/i,
  package_install_not_repository_compromise: /\b(?:package|install|apt|dpkg)\b.*\b(?:does not|cannot|not enough|requires)\b.*\b(?:repository compromise|repo compromise|provenance)\b/i,
  log_gap_limits_confidence: /\b(?:log gap|logging gap|missing log|secondary)\b.*\b(?:confidence|limits|cannot|requires|gap)\b/i,
  outbound_session_not_attacker_identity: /\b(?:outbound|connection|process|session)\b.*\b(?:does not|cannot|not enough|requires)\b.*\b(?:attacker|human|operator|identity)\b/i,
  container_mount_not_full_host_compromise: /\b(?:container|docker|mount)\b.*\b(?:does not|cannot|not enough|requires)\b.*\b(?:full host compromise|host compromise|scope)\b/i,
};

const prohibitedPatterns: Record<LinuxProhibitedConclusion, RegExp> = {
  malicious_intent_without_support: /\b(?:confirm(?:ed)? malicious|confirmed attacker|malicious actor|threat actor)\b/i,
  exact_key_without_identifier: /\b(?:exact ssh key|exact key|fingerprint used|key fingerprint used)\b/i,
  exfiltration_from_local_staging: /\b(?:data (?:was )?exfiltrated|confirmed exfiltration)\b/i,
  human_operator_from_account_use: /\b(?:the user performed|is the human operator|human operator performed|account owner performed)\b/i,
  historical_transition_from_current_state: /\b(?:current state proves|inventory proves).*\b(?:restart|historical transition)\b/i,
  repository_compromise_from_package_install: /\b(?:repository (?:was )?compromised|repo (?:was )?compromised)\b/i,
  full_host_compromise_from_container_mount: /\b(?:confirmed full host compromise|host was fully compromised)\b/i,
};

function normalizePath(value: string) {
  return normalizeLinuxEvidencePath(value);
}

function contractForFamily(family: string | undefined) {
  if (!family) return undefined;
  return LINUX_INCIDENT_INVESTIGATION_CONTRACTS[family as LinuxIncidentFamily];
}

export function linuxIncidentCoverageContract(family: string | undefined) {
  return contractForFamily(family);
}

export function linuxIncidentDifficultyCoverage(family: string | undefined, difficultyInput: string | undefined) {
  const contract = contractForFamily(family);
  if (!contract) return undefined;
  const difficulty = (["Beginner", "Intermediate", "Advanced"].includes(String(difficultyInput)) ? difficultyInput : "Advanced") as LinuxDifficulty;
  return contract.difficultyRequirements[difficulty.toLowerCase() as Lowercase<LinuxDifficulty>];
}

export function mandatoryLinuxIncidentTaskIntents(family: string | undefined, difficulty: string | undefined) {
  return linuxIncidentDifficultyCoverage(family, difficulty)?.mandatoryTaskIntents || [];
}

export type LinuxLearnerIncidentRequirement =
  | { kind: "incident_question"; id: string }
  | { kind: "uncertainty_boundary"; id: LinuxUncertaintyRequirement }
  | { kind: "remediation_concept"; id: LinuxRemediationConcept };

const learnerUncertaintyText: Record<LinuxUncertaintyRequirement, string> = {
  account_use_not_human_operator: "Account use does not prove a human operator or intent; separate observed facts and owner gaps.",
  excessive_sudo_not_malicious_intent: "The listed evidence does not prove malicious intent; separate observed facts and validation gaps.",
  exact_ssh_key_may_be_unavailable: "SSH key evidence may contain a gap; separate observed facts and key-validation gaps.",
  local_staging_not_exfiltration: "Local staging evidence does not prove transfer; separate observed facts and transfer gaps.",
  current_state_not_historical_transition: "Current state does not prove a historical transition; separate observed facts and transition gaps.",
  scheduled_execution_not_malicious_intent: "Cron evidence does not prove malicious intent or persistence; separate observed facts and approval gaps.",
  package_install_not_repository_compromise: "Package install evidence does not prove repository compromise or provenance; separate observed facts and gaps.",
  log_gap_limits_confidence: "A log gap limits confidence; separate observed facts and secondary-source gaps.",
  outbound_session_not_attacker_identity: "Outbound connection evidence cannot identify an operator; separate observed facts and identity gaps.",
  container_mount_not_full_host_compromise: "Container mount evidence does not prove full host compromise; separate observed facts and scope gaps.",
};

const learnerRemediationText: Record<LinuxRemediationConcept, string> = {
  narrow_sudo_rule: "Propose evidence-supported steps to narrow the sudo rule and validate least privilege.",
  rotate_or_restrict_ssh_key: "Propose evidence-supported steps to rotate or restrict SSH key trust and validate source scope.",
  validate_account_purpose: "Propose evidence-supported steps to validate account purpose/owner and restrict access if justified.",
  disable_scheduled_task_after_capture: "Propose evidence-supported steps to capture cron evidence, then disable or remove the task with validation.",
  preserve_and_disable_unit: "Propose evidence-supported steps to preserve systemd evidence, establish ownership and operational need, and disable or mask the unit only if the supported finding justifies it, with validation.",
  verify_package_provenance_or_rollback: "Propose evidence-supported steps to verify package provenance and approve rollback/removal.",
  quarantine_staged_data_and_validate_transfer: "Propose evidence-supported steps to quarantine staged data and validate transfer scope.",
  restore_logging_and_preserve_secondary_sources: "Propose evidence-supported steps to restore logging and preserve secondary sources.",
  contain_process_and_review_egress: "Propose evidence-supported steps to contain the process and review egress controls.",
  harden_container_runtime_boundary: "Propose evidence-supported steps to harden container runtime boundaries and validate mount exposure.",
};

const learnerUncertaintyPreferredIntents: Record<LinuxUncertaintyRequirement, CanonicalInvestigationTask["intent"][]> = {
  account_use_not_human_operator: ["actor_attribution", "ssh_authentication"],
  excessive_sudo_not_malicious_intent: ["sudo_policy", "actor_attribution"],
  exact_ssh_key_may_be_unavailable: ["key_provenance", "ssh_authentication"],
  local_staging_not_exfiltration: ["command_process", "scope_timeline", "file_permissions"],
  current_state_not_historical_transition: ["service_state"],
  scheduled_execution_not_malicious_intent: ["cron_analysis", "evidence_integrity", "change_control"],
  package_install_not_repository_compromise: ["package_transaction", "change_control"],
  log_gap_limits_confidence: ["evidence_integrity", "service_state", "scope_timeline"],
  outbound_session_not_attacker_identity: ["network_source", "command_process", "actor_attribution"],
  container_mount_not_full_host_compromise: ["file_permissions", "configuration_review", "command_process"],
};

function firstMatchingTaskId(
  tasks: Array<{ taskId: string; intent: CanonicalInvestigationTask["intent"]; requiredCapabilities?: CanonicalEvidenceCapability[] }>,
  predicate: (task: { taskId: string; intent: CanonicalInvestigationTask["intent"]; requiredCapabilities?: CanonicalEvidenceCapability[] }) => boolean
) {
  return tasks.find(predicate)?.taskId;
}

function firstTaskIdForIntentPreference(
  tasks: Array<{ taskId: string; intent: CanonicalInvestigationTask["intent"]; requiredCapabilities?: CanonicalEvidenceCapability[] }>,
  preferredIntents: CanonicalInvestigationTask["intent"][]
) {
  for (const intent of preferredIntents) {
    const match = tasks.find((task) => task.intent === intent);
    if (match) return match.taskId;
  }
  return undefined;
}

export function linuxLearnerIncidentCoverageRequirements(input: {
  family: string | undefined;
  difficulty: string | undefined;
  tasks: Array<{ taskId: string; intent: CanonicalInvestigationTask["intent"]; requiredCapabilities?: CanonicalEvidenceCapability[] }>;
}) {
  const contract = contractForFamily(input.family);
  const difficultyCoverage = linuxIncidentDifficultyCoverage(input.family, input.difficulty);
  if (!contract || !difficultyCoverage || input.tasks.length === 0) return new Map<string, LinuxLearnerIncidentRequirement[]>();
  const byTask = new Map<string, LinuxLearnerIncidentRequirement[]>();
  const requirementKey = (requirement: LinuxLearnerIncidentRequirement) => `${requirement.kind}:${requirement.id}`;
  const add = (taskId: string | undefined, requirement: LinuxLearnerIncidentRequirement | undefined) => {
    if (!taskId || !requirement) return;
    const existing = byTask.get(taskId) || [];
    if (existing.some((item) => requirementKey(item) === requirementKey(requirement))) return;
    byTask.set(taskId, [...existing, requirement]);
  };
  const currentPhraseLoad = (taskId: string | undefined) =>
    taskId ? (byTask.get(taskId) || []).length : Number.MAX_SAFE_INTEGER;
  const leastLoadedTaskId = (taskIds: Array<string | undefined>) =>
    taskIds
      .filter((taskId): taskId is string => Boolean(taskId))
      .sort((left, right) => currentPhraseLoad(left) - currentPhraseLoad(right))[0];
  const firstTaskId = (taskIds: Array<string | undefined>) => taskIds.find((taskId): taskId is string => Boolean(taskId));

  for (const questionId of difficultyCoverage.mandatoryQuestionIds) {
    const requirement = contract.questionRequirements[questionId];
    const matchingTaskIds = requirement
      ? input.tasks.filter((task) => {
          if (requirement.taskIntents?.length && !requirement.taskIntents.includes(task.intent)) return false;
          const requiredCapabilities = requirement.capabilities || [];
          return requiredCapabilities.length === 0 || requiredCapabilities.some((capability) => (task.requiredCapabilities || []).includes(capability));
        }).map((task) => task.taskId)
      : [];
    const fallbackTaskIds = matchingTaskIds.length > 0
      ? []
      : input.tasks
          .filter((task) => ["configuration_review", "evidence_integrity", "scope_timeline", "service_state", "change_control"].includes(task.intent))
          .map((task) => task.taskId);
    const sshAccountActorTaskId = input.family === "ssh_bruteforce" && questionId === "ssh_account"
      ? input.tasks.find((task) => task.intent === "actor_attribution" && matchingTaskIds.includes(task.taskId))?.taskId
      : undefined;
    const matchingTaskId = matchingTaskIds.length > 0
      ? sshAccountActorTaskId || firstTaskId(matchingTaskIds)
      : leastLoadedTaskId(fallbackTaskIds);
    add(matchingTaskId || input.tasks[0]?.taskId, { kind: "incident_question", id: questionId });
  }

  for (const boundary of difficultyCoverage.requiredUncertaintyBoundaries) {
    const requirement = Object.values(contract.questionRequirements).find((item) => item.uncertainty === boundary);
    const preferredIntents = learnerUncertaintyPreferredIntents[boundary] || [];
    const requirementTaskIds = requirement?.taskIntents
      ? input.tasks.filter((task) => requirement.taskIntents?.includes(task.intent) || false).map((task) => task.taskId)
      : [];
    const preferredTaskIds = input.tasks.filter((task) => preferredIntents.includes(task.intent)).map((task) => task.taskId);
    const fallbackTaskIds = input.tasks
      .filter((task) => ["evidence_integrity", "scope_timeline", "ssh_authentication", "actor_attribution", "impact_assessment", "risk_assessment", "configuration_review"].includes(task.intent))
      .map((task) => task.taskId);
    const matchingTaskId = preferredTaskIds.length > 0
      ? leastLoadedTaskId(preferredTaskIds)
      : leastLoadedTaskId([...requirementTaskIds, ...fallbackTaskIds]);
    add(matchingTaskId || input.tasks[input.tasks.length - 1]?.taskId, { kind: "uncertainty_boundary", id: boundary });
  }

  for (const concept of difficultyCoverage.requiredRemediationConcepts) {
    const requirement = Object.values(contract.questionRequirements).find((item) => item.remediation === concept);
    const requirementTaskIds = requirement?.taskIntents
      ? input.tasks.filter((task) => requirement.taskIntents?.includes(task.intent)).map((task) => task.taskId)
      : [];
    const fallbackTaskIds = input.tasks
      .filter((task) => ["containment_recommendation", "configuration_review", "risk_assessment", "impact_assessment", "evidence_integrity", "actor_attribution", "service_state", "change_control"].includes(task.intent))
      .map((task) => task.taskId);
    const matchingTaskId = requirementTaskIds.length > 0
      ? leastLoadedTaskId(requirementTaskIds)
      : leastLoadedTaskId(fallbackTaskIds);
    add(matchingTaskId || input.tasks[input.tasks.length - 1]?.taskId, { kind: "remediation_concept", id: concept });
  }

  return byTask;
}

function taskAssets(task: CanonicalInvestigationTask, registry: CanonicalEvidenceAsset[], finalAssets?: LabAsset[]) {
  const byId = new Map(registry.map((asset) => [asset.id, asset]));
  const rendered = finalAssets
    ? new Set(finalAssets.map((asset) => normalizePath(asset.file_path)))
    : undefined;
  return task.selectedEvidenceAssetIds
    .map((id) => byId.get(id))
    .filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset))
    .filter((asset) => !rendered || rendered.has(normalizePath(asset.path)));
}

function taskCapabilities(task: CanonicalInvestigationTask, assets: CanonicalEvidenceAsset[]) {
  const proven = proveTaskRequirements(task, assets);
  const feasibleCapabilities = new Set(
    proven
      .filter((proof) => proof.feasible)
      .map((proof) => proof.capability)
  );
  for (const capability of task.requiredCapabilities) {
    if (assets.some((asset) => asset.capabilities.includes(capability))) feasibleCapabilities.add(capability);
  }
  for (const capability of assets.flatMap((asset) => asset.capabilities)) {
    feasibleCapabilities.add(capability);
  }
  return Array.from(feasibleCapabilities);
}

function roleCoveredByTask(role: LinuxIncidentEvidenceRole, capabilities: string[]) {
  const required = roleCapabilities[role] || [];
  return required.some((capability) => capabilities.includes(capability));
}

function taskTextByIndex(lab: { tasks?: Array<{ title?: string; description?: string; deliverable?: string }> } | undefined, index: number) {
  const task = lab?.tasks?.[index];
  return [task?.title, task?.description, task?.deliverable].filter(Boolean).join("\n");
}

export function linuxTaskTextHasRemediationConcept(concept: LinuxRemediationConcept, text: string) {
  return text.split(/(?:[.!?;]\s+|\r?\n+)/).some((clause) => remediationPatterns[concept].test(clause));
}

function matchingTasksForRequirement(args: {
  requirement: CoverageRequirement;
  taskFacts: Array<{ task: CanonicalInvestigationTask; capabilities: string[]; roles: LinuxIncidentEvidenceRole[]; text: string }>;
  requireTextAssertions: boolean;
}) {
  return args.taskFacts
    .filter(({ task, capabilities, roles, text }) => {
      const textOnlyRequirement = Boolean(args.requirement.uncertainty || args.requirement.remediation) &&
        !args.requirement.capabilities?.length &&
        !args.requirement.evidenceRoles?.length;
      if (args.requirement.taskIntents?.length && !args.requirement.taskIntents.includes(task.intent) && (args.requireTextAssertions || !textOnlyRequirement)) return false;
      if (args.requirement.capabilities?.length && !args.requirement.capabilities.every((capability) => capabilities.includes(capability))) return false;
      if (args.requirement.evidenceRoles?.length && !args.requirement.evidenceRoles.every((role) => roles.includes(role))) return false;
      if (args.requireTextAssertions && args.requirement.uncertainty && !uncertaintyPatterns[args.requirement.uncertainty].test(text)) return false;
      if (args.requireTextAssertions && args.requirement.remediation && !remediationPatterns[args.requirement.remediation].test(text)) return false;
      return true;
    })
    .map(({ task }) => task.id);
}

function requirementResult(
  id: string,
  coveredByTaskIds: string[],
  missing: string[] = []
): LinuxCoverageRequirementResult {
  return {
    id,
    covered: coveredByTaskIds.length > 0 && missing.length === 0,
    coveredByTaskIds,
    missing,
  };
}

function issueFor(args: {
  code: LinuxIncidentCoverageCode;
  contract: LinuxIncidentInvestigationContract;
  difficulty: LinuxDifficulty;
  requirementId: string;
  finalTaskIds: string[];
  presentCapabilities: string[];
  presentEvidenceRoles: string[];
  suggestedTaskIntents?: string[];
  message: string;
}): LinuxIncidentCoverageIssue {
  return {
    code: args.code,
    severity: "critical",
    incidentFamily: args.contract.incidentFamily,
    difficulty: args.difficulty,
    requirementId: args.requirementId,
    finalTaskIds: args.finalTaskIds,
    presentCapabilities: args.presentCapabilities,
    presentEvidenceRoles: args.presentEvidenceRoles,
    suggestedTaskIntents: args.suggestedTaskIntents || [],
    regenerationCanRepair: true,
    message: args.message,
  };
}

export function validateLinuxIncidentCoverage(input: {
  simulation?: LinuxSimulationWorld;
  finalAssets?: LabAsset[];
  lab?: { tasks?: Array<{ title?: string; description?: string; deliverable?: string }> };
}): LinuxIncidentCoverageReport {
  const family = input.simulation?.investigation.incidentFamily;
  const difficulty = (input.simulation?.canonicalTasks[0]?.difficulty || "Advanced") as LinuxDifficulty;
  const fallbackFamily = (family || "ssh_bruteforce") as LinuxIncidentFamily;
  const missingContractReport = (code: LinuxIncidentCoverageCode, message: string): LinuxIncidentCoverageReport => ({
    incidentFamily: fallbackFamily,
    contractVersion: "missing",
    difficulty,
    status: "not_covered",
    mandatoryQuestions: [],
    mandatoryTaskIntents: [],
    mandatoryCapabilities: [],
    mandatoryEvidenceRoles: [],
    uncertaintyBoundaries: [],
    remediationConcepts: [],
    coveredByTaskIds: {},
    missingRequirementIds: ["contract"],
    issues: [{
      code,
      severity: "critical",
      incidentFamily: family || "unknown",
      difficulty,
      requirementId: "contract",
      finalTaskIds: [],
      presentCapabilities: [],
      presentEvidenceRoles: [],
      suggestedTaskIntents: [],
      regenerationCanRepair: false,
      message,
    }],
  });

  if (!input.simulation) return missingContractReport("LINUX_INCIDENT_CONTRACT_MISSING", "Linux incident coverage requires a complete simulation.");
  const contract = contractForFamily(family);
  if (!contract) return missingContractReport("LINUX_INCIDENT_CONTRACT_MISSING", `No Linux incident investigation contract exists for ${family || "unknown"}.`);
  const difficultyCoverage = contract.difficultyRequirements[difficulty.toLowerCase() as Lowercase<LinuxDifficulty>];
  if (!difficultyCoverage) return missingContractReport("LINUX_INCIDENT_CONTRACT_INVALID", `No ${difficulty} coverage contract exists for ${contract.incidentFamily}.`);

  const registry = input.simulation.planningEvidenceRegistry.length > 0
    ? input.simulation.planningEvidenceRegistry
    : input.simulation.evidenceRegistry;
  const tasks = input.simulation.canonicalTasks.slice().sort((left, right) => left.order - right.order);
  const taskFacts = tasks.map((task, index) => {
    const assets = taskAssets(task, registry, input.finalAssets);
    const capabilities = taskCapabilities(task, assets);
    const roles = (Object.keys(roleCapabilities) as LinuxIncidentEvidenceRole[])
      .filter((role) => roleCoveredByTask(role, capabilities));
    return { task, capabilities, roles, text: taskTextByIndex(input.lab, index) };
  });
  const presentCapabilities = Array.from(new Set(taskFacts.flatMap((item) => item.capabilities))).sort();
  const presentEvidenceRoles = Array.from(new Set(taskFacts.flatMap((item) => item.roles))).sort();
  const finalTaskIds = tasks.map((task) => task.id);
  const issues: LinuxIncidentCoverageIssue[] = [];
  const coveredByTaskIds: Record<string, string[]> = {};

  const requireTextAssertions = Boolean(input.lab);
  const mandatoryQuestions = difficultyCoverage.mandatoryQuestionIds.map((questionId) => {
    const requirement = contract.questionRequirements[questionId];
    const covered = requirement ? matchingTasksForRequirement({ requirement, taskFacts, requireTextAssertions }) : [];
    coveredByTaskIds[questionId] = covered;
    const missing = requirement ? [] : ["question requirement is not defined"];
    if (covered.length === 0 || missing.length > 0) {
      issues.push(issueFor({
        code: "LINUX_INCIDENT_QUESTION_MISSING",
        contract,
        difficulty,
        requirementId: questionId,
        finalTaskIds,
        presentCapabilities,
        presentEvidenceRoles,
        suggestedTaskIntents: requirement?.taskIntents || [],
        message: `Mandatory incident question ${questionId} is not covered by the final task set.`,
      }));
    }
    return requirementResult(questionId, covered, missing);
  });

  const mandatoryTaskIntents = difficultyCoverage.mandatoryTaskIntents.map((intent) => {
    const covered = taskFacts.filter((item) => item.task.intent === intent).map((item) => item.task.id);
    coveredByTaskIds[`intent:${intent}`] = covered;
    if (covered.length === 0) {
      issues.push(issueFor({
        code: "LINUX_INCIDENT_INTENT_MISSING",
        contract,
        difficulty,
        requirementId: `intent:${intent}`,
        finalTaskIds,
        presentCapabilities,
        presentEvidenceRoles,
        suggestedTaskIntents: [intent],
        message: `Mandatory incident task intent ${intent} is missing.`,
      }));
    }
    return requirementResult(`intent:${intent}`, covered);
  });

  const mandatoryCapabilities = difficultyCoverage.mandatoryCapabilities.map((capability) => {
    const covered = taskFacts.filter((item) => item.capabilities.includes(capability)).map((item) => item.task.id);
    coveredByTaskIds[`capability:${capability}`] = covered;
    if (covered.length === 0) {
      issues.push(issueFor({
        code: "LINUX_INCIDENT_CAPABILITY_MISSING",
        contract,
        difficulty,
        requirementId: `capability:${capability}`,
        finalTaskIds,
        presentCapabilities,
        presentEvidenceRoles,
        message: `Mandatory incident capability ${capability} is not verified in task-local evidence.`,
      }));
    }
    return requirementResult(`capability:${capability}`, covered);
  });

  const mandatoryEvidenceRoles = difficultyCoverage.mandatoryEvidenceRoles.map((role) => {
    const covered = taskFacts.filter((item) => item.roles.includes(role)).map((item) => item.task.id);
    coveredByTaskIds[`evidence_role:${role}`] = covered;
    if (covered.length === 0) {
      issues.push(issueFor({
        code: "LINUX_INCIDENT_EVIDENCE_ROLE_MISSING",
        contract,
        difficulty,
        requirementId: `evidence_role:${role}`,
        finalTaskIds,
        presentCapabilities,
        presentEvidenceRoles,
        message: `Mandatory incident evidence role ${role} is not covered by rendered task evidence.`,
      }));
    }
    return requirementResult(`evidence_role:${role}`, covered);
  });

  const uncertaintyBoundaries = difficultyCoverage.requiredUncertaintyBoundaries.map((boundary) => {
    const covered = taskFacts.filter((item) => uncertaintyPatterns[boundary].test(item.text)).map((item) => item.task.id);
    coveredByTaskIds[`uncertainty:${boundary}`] = covered;
    if (covered.length === 0 && input.lab) {
      issues.push(issueFor({
        code: "LINUX_INCIDENT_UNCERTAINTY_BOUNDARY_MISSING",
        contract,
        difficulty,
        requirementId: `uncertainty:${boundary}`,
        finalTaskIds,
        presentCapabilities,
        presentEvidenceRoles,
        message: `Mandatory uncertainty boundary ${boundary} is not present in the student task set.`,
      }));
    }
    return requirementResult(`uncertainty:${boundary}`, covered, input.lab || covered.length > 0 ? [] : ["student task text not supplied"]);
  });

  const remediationConcepts = difficultyCoverage.requiredRemediationConcepts.map((concept) => {
    const covered = taskFacts.filter((item) => linuxTaskTextHasRemediationConcept(concept, item.text)).map((item) => item.task.id);
    coveredByTaskIds[`remediation:${concept}`] = covered;
    if (covered.length === 0 && input.lab) {
      issues.push(issueFor({
        code: "LINUX_INCIDENT_REMEDIATION_MISSING",
        contract,
        difficulty,
        requirementId: `remediation:${concept}`,
        finalTaskIds,
        presentCapabilities,
        presentEvidenceRoles,
        message: `Mandatory remediation concept ${concept} is not present in the student task set.`,
      }));
    }
    return requirementResult(`remediation:${concept}`, covered, input.lab || covered.length > 0 ? [] : ["student task text not supplied"]);
  });

  if (input.lab) {
    for (const prohibited of contract.prohibitedConclusions) {
      for (const [index, task] of taskFacts.entries()) {
        if (prohibitedPatterns[prohibited].test(task.text)) {
          issues.push(issueFor({
            code: "LINUX_INCIDENT_PROHIBITED_CONCLUSION",
            contract,
            difficulty,
            requirementId: `prohibited:${prohibited}`,
            finalTaskIds,
            presentCapabilities,
            presentEvidenceRoles,
            message: `Student task ${index + 1} requires or asserts prohibited incident conclusion ${prohibited}.`,
          }));
        }
      }
    }
  }

  const missingRequirementIds = Array.from(new Set(issues.map((item) => item.requirementId)));
  const structuralFailures = issues.filter((item) =>
    item.code !== "LINUX_INCIDENT_UNCERTAINTY_BOUNDARY_MISSING" &&
    item.code !== "LINUX_INCIDENT_REMEDIATION_MISSING" &&
    item.code !== "LINUX_INCIDENT_PROHIBITED_CONCLUSION"
  );
  const status: LinuxIncidentCoverageStatus =
    issues.length === 0
      ? "covered"
      : structuralFailures.length === issues.length
        ? "not_covered"
        : "partially_covered";

  if (status !== "covered" && issues.length === 0) {
    issues.push(issueFor({
      code: "LINUX_INCIDENT_COVERAGE_MISSING",
      contract,
      difficulty,
      requirementId: "coverage",
      finalTaskIds,
      presentCapabilities,
      presentEvidenceRoles,
      message: `Incident family ${contract.incidentFamily} is not covered by the final task set.`,
    }));
  }

  return {
    incidentFamily: contract.incidentFamily,
    contractVersion: contract.version,
    difficulty,
    status,
    mandatoryQuestions,
    mandatoryTaskIntents,
    mandatoryCapabilities,
    mandatoryEvidenceRoles,
    uncertaintyBoundaries,
    remediationConcepts,
    coveredByTaskIds,
    missingRequirementIds,
    issues,
  };
}

export function assertLinuxIncidentCoverage(input: {
  simulation?: LinuxSimulationWorld;
  finalAssets?: LabAsset[];
  lab?: { tasks?: Array<{ title?: string; description?: string; deliverable?: string }> };
}) {
  const report = validateLinuxIncidentCoverage(input);
  if (report.status !== "covered") {
    const first = report.issues[0];
    throw new Error(
      `${first?.code || "LINUX_INCIDENT_COVERAGE_MISSING"}: ${first?.message || "Linux incident coverage is incomplete."} family=${report.incidentFamily} difficulty=${report.difficulty} missing=${report.missingRequirementIds.join(",")}`
    );
  }
  return report;
}
