import type { CanonicalEvidenceCapability } from "./simulation";

export type LinuxEvidenceClass =
  | "service_inventory"
  | "systemctl_status"
  | "systemd_unit_file"
  | "journal_or_syslog"
  | "process_listing"
  | "package_inventory"
  | "cron_file"
  | "authentication_log"
  | "command_history"
  | "file_metadata";

export type LinuxCapabilityEvidenceSemantics = {
  evidenceClass: LinuxEvidenceClass;
  supportedCapabilities: CanonicalEvidenceCapability[];
  unsupportedCapabilities: CanonicalEvidenceCapability[];
  supportsCurrentState: boolean;
  supportsHistoricalState: boolean;
  supportsConfiguration: boolean;
  supportsAttribution: boolean;
  supportsTimeline: boolean;
  supportsPersistenceDefinition: boolean;
  supportsPersistenceExecution: boolean;
  notes: string;
};

export const LINUX_CAPABILITY_EVIDENCE_MATRIX: LinuxCapabilityEvidenceSemantics[] = [
  {
    evidenceClass: "service_inventory",
    supportedCapabilities: ["current_service_state", "service_state", "timeline_static"],
    unsupportedCapabilities: ["current_policy_state", "current_persistence_state", "cron_execution", "command_execution", "process_ancestry"],
    supportsCurrentState: true,
    supportsHistoricalState: false,
    supportsConfiguration: false,
    supportsAttribution: false,
    supportsTimeline: true,
    supportsPersistenceDefinition: false,
    supportsPersistenceExecution: false,
    notes: "Collection-time service-manager inventory. It proves service existence and rendered unit state fields, not unit-file contents or sudo policy.",
  },
  {
    evidenceClass: "systemctl_status",
    supportedCapabilities: ["current_service_state", "service_state", "timeline_static"],
    unsupportedCapabilities: ["current_policy_state", "configuration_baseline", "cron_execution", "process_ancestry"],
    supportsCurrentState: true,
    supportsHistoricalState: false,
    supportsConfiguration: false,
    supportsAttribution: false,
    supportsTimeline: true,
    supportsPersistenceDefinition: false,
    supportsPersistenceExecution: false,
    notes: "Collection-time service status output supports current service state only where rendered.",
  },
  {
    evidenceClass: "systemd_unit_file",
    supportedCapabilities: ["current_configuration_state", "configuration_baseline", "current_persistence_state", "timeline_static"],
    unsupportedCapabilities: ["service_transition", "cron_execution", "command_execution", "process_ancestry"],
    supportsCurrentState: true,
    supportsHistoricalState: false,
    supportsConfiguration: true,
    supportsAttribution: false,
    supportsTimeline: true,
    supportsPersistenceDefinition: true,
    supportsPersistenceExecution: false,
    notes: "Static unit file content supports current configuration and configured startup/persistence, not execution.",
  },
  {
    evidenceClass: "journal_or_syslog",
    supportedCapabilities: ["timeline_exact", "timeline_context", "command_execution", "service_transition", "service_state", "cron_execution"],
    unsupportedCapabilities: ["current_configuration_state", "current_policy_state", "current_file_state", "current_package_state"],
    supportsCurrentState: false,
    supportsHistoricalState: true,
    supportsConfiguration: false,
    supportsAttribution: true,
    supportsTimeline: true,
    supportsPersistenceDefinition: false,
    supportsPersistenceExecution: true,
    notes: "Timestamped event stream. It supports historical observations, not collection-time state.",
  },
  {
    evidenceClass: "process_listing",
    supportedCapabilities: ["current_process_state", "process_ancestry", "current_open_file_state"],
    unsupportedCapabilities: ["configuration_baseline", "current_policy_state", "cron_definition"],
    supportsCurrentState: true,
    supportsHistoricalState: false,
    supportsConfiguration: false,
    supportsAttribution: true,
    supportsTimeline: true,
    supportsPersistenceDefinition: false,
    supportsPersistenceExecution: false,
    notes: "Collection-time runtime snapshot. It cannot prove completed historical execution unless paired with history evidence.",
  },
  {
    evidenceClass: "package_inventory",
    supportedCapabilities: ["current_package_state", "timeline_static"],
    unsupportedCapabilities: ["package_transaction", "command_execution", "current_policy_state"],
    supportsCurrentState: true,
    supportsHistoricalState: false,
    supportsConfiguration: true,
    supportsAttribution: false,
    supportsTimeline: true,
    supportsPersistenceDefinition: false,
    supportsPersistenceExecution: false,
    notes: "Installed package inventory supports current installed state, not transaction history.",
  },
  {
    evidenceClass: "cron_file",
    supportedCapabilities: ["current_persistence_state", "cron_definition", "configuration_baseline", "timeline_static"],
    unsupportedCapabilities: ["cron_execution", "command_execution", "process_ancestry"],
    supportsCurrentState: true,
    supportsHistoricalState: false,
    supportsConfiguration: true,
    supportsAttribution: true,
    supportsTimeline: true,
    supportsPersistenceDefinition: true,
    supportsPersistenceExecution: false,
    notes: "Current scheduled-task definition. It does not prove the job ran.",
  },
  {
    evidenceClass: "authentication_log",
    supportedCapabilities: ["authentication", "session_lifecycle", "actor_attribution", "timeline_exact"],
    unsupportedCapabilities: ["current_identity_state", "current_policy_state", "current_configuration_state"],
    supportsCurrentState: false,
    supportsHistoricalState: true,
    supportsConfiguration: false,
    supportsAttribution: true,
    supportsTimeline: true,
    supportsPersistenceDefinition: false,
    supportsPersistenceExecution: false,
    notes: "Historical sign-in evidence.",
  },
  {
    evidenceClass: "command_history",
    supportedCapabilities: ["command_execution", "process_ancestry", "timeline_exact", "actor_attribution"],
    unsupportedCapabilities: ["current_process_state", "current_configuration_state", "current_policy_state"],
    supportsCurrentState: false,
    supportsHistoricalState: true,
    supportsConfiguration: false,
    supportsAttribution: true,
    supportsTimeline: true,
    supportsPersistenceDefinition: false,
    supportsPersistenceExecution: false,
    notes: "Historical command/process record.",
  },
  {
    evidenceClass: "file_metadata",
    supportedCapabilities: ["current_file_state", "file_owner_group_mode", "timeline_static"],
    unsupportedCapabilities: ["command_execution", "process_ancestry", "current_policy_state"],
    supportsCurrentState: true,
    supportsHistoricalState: false,
    supportsConfiguration: false,
    supportsAttribution: true,
    supportsTimeline: true,
    supportsPersistenceDefinition: false,
    supportsPersistenceExecution: false,
    notes: "Collection-time file metadata, not file contents.",
  },
];

export function linuxCapabilityEvidenceSemantics(evidenceClass: LinuxEvidenceClass) {
  return LINUX_CAPABILITY_EVIDENCE_MATRIX.find((item) => item.evidenceClass === evidenceClass);
}
