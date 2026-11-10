import type {
  CanonicalEvidenceCapability,
  CanonicalInvestigationTask,
} from "./simulation";

export type LinuxTaskContract = {
  intent: CanonicalInvestigationTask["intent"];
  label: string;
  requiredCapabilities: CanonicalEvidenceCapability[];
  fallbackEvidenceTags: string[];
  expectedDeliverableType: CanonicalInvestigationTask["expectedDeliverableType"];
  textPatterns: RegExp[];
  evidencePatterns: RegExp[];
};

export type LinuxInvestigationBlueprintId =
  | "identity_access_review"
  | "service_config_review"
  | "process_file_review"
  | "container_runtime_review"
  | "package_drift_review"
  | "persistence_startup_review";

export type LinuxPlannerTaskSpec = LinuxTaskContract & {
  blueprintId: LinuxInvestigationBlueprintId;
  blueprintLabel: string;
  stepLabel: string;
  suggestedVerb: string;
  expectedDeliverableType: CanonicalInvestigationTask["expectedDeliverableType"];
};

type BlueprintStep = {
  intent: CanonicalInvestigationTask["intent"];
  stepLabel: string;
  suggestedVerb: string;
  deliverableType?: CanonicalInvestigationTask["expectedDeliverableType"];
};

export type LinuxInvestigationBlueprint = {
  id: LinuxInvestigationBlueprintId;
  label: string;
  incidentFamilies: string[];
  steps: BlueprintStep[];
};

export const LINUX_TASK_CONTRACTS: Record<CanonicalInvestigationTask["intent"], LinuxTaskContract> = {
  scope_timeline: {
    intent: "scope_timeline",
    label: "timeline reconstruction",
    requiredCapabilities: ["timeline_exact"],
    fallbackEvidenceTags: ["timestamped_log"],
    expectedDeliverableType: "timeline",
    textPatterns: [/\b(?:timeline|sequence|reconstruct|event order)\b/i],
    evidencePatterns: [/timeline\.csv/i, /auth\.log|sudo\.log|audit\.log|syslog|journal_|cron\.log|apt_history/i],
  },
  actor_attribution: {
    intent: "actor_attribution",
    label: "account identity",
    requiredCapabilities: ["actor_attribution"],
    fallbackEvidenceTags: ["identity_inventory", "timestamped_log"],
    expectedDeliverableType: "correlation_table",
    textPatterns: [/\b(?:account|group membership|identity|administrator-tier|service account|actor|attribution)\b/i],
    evidencePatterns: [/users\.csv|groups\.csv|passwd|group\.sample|auth\.log|sudo\.log|audit\.log/i],
  },
  ssh_authentication: {
    intent: "ssh_authentication",
    label: "SSH authentication",
    requiredCapabilities: ["authentication"],
    fallbackEvidenceTags: ["timestamped_log", "identity_inventory", "static_config"],
    expectedDeliverableType: "correlation_table",
    textPatterns: [/\b(?:ssh authentication|key-based session|ssh session|authenticat|login|session window)\b/i],
    evidencePatterns: [/auth\.log|journal_ssh|sshd_config|pam\/sshd|users\.csv/i],
  },
  key_provenance: {
    intent: "key_provenance",
    label: "key provenance",
    requiredCapabilities: ["key_provenance", "actor_attribution", "file_owner_group_mode"],
    fallbackEvidenceTags: ["ssh_key_material", "file_metadata", "identity_inventory", "static_config", "timestamped_log"],
    expectedDeliverableType: "correlation_table",
    textPatterns: [/\b(?:authorized_keys|key provenance|key option|ssh key)\b/i],
    evidencePatterns: [/authorized_keys|sshd_config|permissions_report|users\.csv|groups\.csv|auth\.log/i],
  },
  sudo_policy: {
    intent: "sudo_policy",
    label: "sudo policy",
    requiredCapabilities: ["sudo_authorisation", "actor_attribution", "configuration_baseline"],
    fallbackEvidenceTags: ["static_config", "timestamped_log", "identity_inventory"],
    expectedDeliverableType: "policy_mapping",
    textPatterns: [/\b(?:sudo rule|sudo policy|used sudo|command authorised|command authorized|privileged command)\b/i],
    evidencePatterns: [/sudo\.log|sudoers|users\.csv|groups\.csv|audit\.log/i],
  },
  command_process: {
    intent: "command_process",
    label: "command and process correlation",
    requiredCapabilities: ["command_execution", "process_ancestry", "open_file_correlation"],
    fallbackEvidenceTags: ["timestamped_log", "process_history", "file_access_history", "file_metadata"],
    expectedDeliverableType: "correlation_table",
    textPatterns: [/\b(?:process|pid|open file|runtime|command process|process correlation|historical file-access|execution lineage)\b/i],
    evidencePatterns: [/process_execution_history|file_access_history|process_snapshot|open_files|audit\.log|sudo\.log|syslog/i],
  },
  file_permissions: {
    intent: "file_permissions",
    label: "file permissions",
    requiredCapabilities: ["file_owner_group_mode"],
    fallbackEvidenceTags: ["file_metadata"],
    expectedDeliverableType: "evidence_notes",
    textPatterns: [/\b(?:file permissions?|rendered permissions?|file ownership|owner\s*\/\s*group|owner,?\s+group|owner\s+and\s+group|uid|gid|chmod|chown|mode|stat|ls\s+-l|inode|writable|executable bit|world-writable|root-owned|user-owned file|file metadata)\b/i],
    evidencePatterns: [/permissions_report|file_access_history|open_files|audit\.log/i],
  },
  service_state: {
    intent: "service_state",
    label: "service state",
    requiredCapabilities: ["service_state", "service_transition"],
    fallbackEvidenceTags: ["service_inventory", "timestamped_log"],
    expectedDeliverableType: "evidence_notes",
    textPatterns: [/\b(?:service state|systemd|daemon|service activity|unit state|service baseline)\b/i],
    evidencePatterns: [/service_inventory|journal_systemd|syslog|audit\.log/i],
  },
  package_transaction: {
    intent: "package_transaction",
    label: "package transaction",
    requiredCapabilities: ["package_transaction", "actor_attribution"],
    fallbackEvidenceTags: ["package_history", "timestamped_log", "identity_inventory"],
    expectedDeliverableType: "evidence_notes",
    textPatterns: [/\b(?:package|apt|dpkg|ncat)\b/i],
    evidencePatterns: [/apt_history|package_inventory|audit\.log|sudo\.log/i],
  },
  cron_analysis: {
    intent: "cron_analysis",
    label: "cron analysis",
    requiredCapabilities: ["cron_definition", "cron_execution"],
    fallbackEvidenceTags: ["scheduled_activity", "timestamped_log"],
    expectedDeliverableType: "evidence_notes",
    textPatterns: [/\b(?:cron|scheduled|crontab|sys-maint)\b/i],
    evidencePatterns: [/cron|scheduled|root_crontab|syslog/i],
  },
  network_source: {
    intent: "network_source",
    label: "network source",
    requiredCapabilities: ["network_source"],
    fallbackEvidenceTags: ["network_state", "timestamped_log"],
    expectedDeliverableType: "evidence_notes",
    textPatterns: [/\b(?:source ip|network source|egress|outbound)\b/i],
    evidencePatterns: [/network|ufw|listening_ports|auth\.log|syslog/i],
  },
  configuration_review: {
    intent: "configuration_review",
    label: "configuration review",
    requiredCapabilities: ["configuration_baseline"],
    fallbackEvidenceTags: ["static_config", "policy_document", "service_inventory"],
    expectedDeliverableType: "policy_mapping",
    textPatterns: [/\b(?:sshd configuration|configuration|pam|hardening checklist|key option)\b/i],
    evidencePatterns: [/sshd_config|pam\/sshd|linux_config_pack|service_inventory|security_policy/i],
  },
  change_control: {
    intent: "change_control",
    label: "change control",
    requiredCapabilities: ["change_control"],
    fallbackEvidenceTags: ["change_document"],
    expectedDeliverableType: "policy_mapping",
    textPatterns: [/\bchg-\d+\b|\bchange(?:-control)?\b|\bmaintenance\s+(?:records|window|ticket)\b|\bticket\b|\breconcile\b/i],
    evidencePatterns: [/change_request|maintenance_ticket/i],
  },
  evidence_integrity: {
    intent: "evidence_integrity",
    label: "evidence integrity",
    requiredCapabilities: ["timeline_context"],
    fallbackEvidenceTags: ["timestamped_log", "change_document", "policy_document", "service_inventory", "static_config"],
    expectedDeliverableType: "gap_assessment",
    textPatterns: [/\b(?:integrity|evidence gaps?|logging gaps?|ownership gaps?|log quality|logging|evidence quality|confidence|conclusions?)\b/i],
    evidencePatterns: [/auth\.log|audit\.log|journal_|change_request|security_policy|service_inventory|linux_config_pack/i],
  },
  impact_assessment: {
    intent: "impact_assessment",
    label: "impact assessment",
    requiredCapabilities: ["risk_context", "timeline_context"],
    fallbackEvidenceTags: ["change_document", "policy_document", "service_inventory", "file_metadata", "timestamped_log"],
    expectedDeliverableType: "risk_summary",
    textPatterns: [/\b(?:impact|risk|exposure)\b/i],
    evidencePatterns: [/risk_register|incident_brief|timeline\.csv|change_request|security_policy|permissions_report/i],
  },
  risk_assessment: {
    intent: "risk_assessment",
    label: "risk assessment",
    requiredCapabilities: ["risk_context"],
    fallbackEvidenceTags: ["change_document", "policy_document", "file_metadata", "timestamped_log"],
    expectedDeliverableType: "risk_summary",
    textPatterns: [/\b(?:risk assessment|risk summary|risk register)\b/i],
    evidencePatterns: [/risk_register|incident_brief|permissions_report|audit\.log/i],
  },
  containment_recommendation: {
    intent: "containment_recommendation",
    label: "containment recommendation",
    requiredCapabilities: ["risk_context", "configuration_baseline"],
    fallbackEvidenceTags: ["change_document", "policy_document", "service_inventory", "timestamped_log"],
    expectedDeliverableType: "containment_plan",
    textPatterns: [/\b(?:containment|hardening|recommend|prioriti[sz]e|remediation)\b/i],
    evidencePatterns: [/hardening|security_policy|change_request|service_inventory|timeline\.csv/i],
  },
};

export function linuxTaskContract(intent: CanonicalInvestigationTask["intent"]) {
  return LINUX_TASK_CONTRACTS[intent];
}

export const LINUX_INVESTIGATION_BLUEPRINTS: LinuxInvestigationBlueprint[] = [
  {
    id: "identity_access_review",
    label: "identity and access review",
    incidentFamilies: ["ssh_bruteforce", "ssh_key_compromise", "misconfigured_sudoers"],
    steps: [
      { intent: "ssh_authentication", stepLabel: "Authentication entry point", suggestedVerb: "Establish", deliverableType: "evidence_notes" },
      { intent: "actor_attribution", stepLabel: "Account and group context", suggestedVerb: "Map", deliverableType: "correlation_table" },
      { intent: "sudo_policy", stepLabel: "Privilege boundary", suggestedVerb: "Compare", deliverableType: "policy_mapping" },
      { intent: "command_process", stepLabel: "Privileged activity", suggestedVerb: "Trace", deliverableType: "correlation_table" },
      { intent: "scope_timeline", stepLabel: "Window reconstruction", suggestedVerb: "Reconstruct", deliverableType: "timeline" },
      { intent: "change_control", stepLabel: "Maintenance coverage", suggestedVerb: "Evaluate", deliverableType: "gap_assessment" },
      { intent: "impact_assessment", stepLabel: "Business impact", suggestedVerb: "Prioritize", deliverableType: "risk_summary" },
    ],
  },
  {
    id: "service_config_review",
    label: "service behaviour and configuration review",
    incidentFamilies: ["systemd_persistence", "log_tampering"],
    steps: [
      { intent: "service_state", stepLabel: "Service behaviour", suggestedVerb: "Verify", deliverableType: "evidence_notes" },
      { intent: "configuration_review", stepLabel: "Configuration baseline", suggestedVerb: "Compare", deliverableType: "policy_mapping" },
      { intent: "scope_timeline", stepLabel: "Event sequence", suggestedVerb: "Sequence", deliverableType: "timeline" },
      { intent: "command_process", stepLabel: "Execution chain", suggestedVerb: "Trace", deliverableType: "correlation_table" },
      { intent: "evidence_integrity", stepLabel: "Log reliability", suggestedVerb: "Document", deliverableType: "gap_assessment" },
      { intent: "change_control", stepLabel: "Change coverage", suggestedVerb: "Reconcile", deliverableType: "policy_mapping" },
      { intent: "risk_assessment", stepLabel: "Operational risk", suggestedVerb: "Summarize", deliverableType: "risk_summary" },
    ],
  },
  {
    id: "process_file_review",
    label: "process and file access review",
    incidentFamilies: ["service_account_misuse", "reverse_shell", "data_staging"],
    steps: [
      { intent: "command_process", stepLabel: "Process lineage", suggestedVerb: "Trace", deliverableType: "correlation_table" },
      { intent: "file_permissions", stepLabel: "File access and ownership", suggestedVerb: "Review", deliverableType: "evidence_notes" },
      { intent: "actor_attribution", stepLabel: "Account context", suggestedVerb: "Attribute", deliverableType: "correlation_table" },
      { intent: "network_source", stepLabel: "Exposure context", suggestedVerb: "Identify", deliverableType: "gap_assessment" },
      { intent: "scope_timeline", stepLabel: "Activity sequence", suggestedVerb: "Reconstruct", deliverableType: "timeline" },
      { intent: "impact_assessment", stepLabel: "Impact assessment", suggestedVerb: "Evaluate", deliverableType: "risk_summary" },
    ],
  },
  {
    id: "container_runtime_review",
    label: "container runtime review",
    incidentFamilies: ["docker_compromise"],
    steps: [
      { intent: "command_process", stepLabel: "Container command lineage", suggestedVerb: "Trace", deliverableType: "correlation_table" },
      { intent: "file_permissions", stepLabel: "Mount and file access", suggestedVerb: "Map", deliverableType: "evidence_notes" },
      { intent: "actor_attribution", stepLabel: "Runtime account context", suggestedVerb: "Attribute", deliverableType: "correlation_table" },
      { intent: "network_source", stepLabel: "Runtime exposure", suggestedVerb: "Check", deliverableType: "gap_assessment" },
      { intent: "configuration_review", stepLabel: "Host configuration context", suggestedVerb: "Compare", deliverableType: "policy_mapping" },
      { intent: "risk_assessment", stepLabel: "Container risk", suggestedVerb: "Prioritize", deliverableType: "risk_summary" },
    ],
  },
  {
    id: "package_drift_review",
    label: "package and configuration drift review",
    incidentFamilies: ["unauthorized_package_install"],
    steps: [
      { intent: "package_transaction", stepLabel: "Package transaction", suggestedVerb: "Verify", deliverableType: "evidence_notes" },
      { intent: "sudo_policy", stepLabel: "Installer authority", suggestedVerb: "Compare", deliverableType: "policy_mapping" },
      { intent: "scope_timeline", stepLabel: "Install sequence", suggestedVerb: "Reconstruct", deliverableType: "timeline" },
      { intent: "service_state", stepLabel: "Service side effects", suggestedVerb: "Check", deliverableType: "evidence_notes" },
      { intent: "configuration_review", stepLabel: "Configuration drift", suggestedVerb: "Review", deliverableType: "gap_assessment" },
      { intent: "impact_assessment", stepLabel: "Exposure and impact", suggestedVerb: "Evaluate", deliverableType: "risk_summary" },
    ],
  },
  {
    id: "persistence_startup_review",
    label: "persistence and startup review",
    incidentFamilies: ["cron_persistence"],
    steps: [
      { intent: "cron_analysis", stepLabel: "Scheduled mechanism", suggestedVerb: "Inspect", deliverableType: "evidence_notes" },
      { intent: "command_process", stepLabel: "Scheduled execution chain", suggestedVerb: "Trace", deliverableType: "correlation_table" },
      { intent: "actor_attribution", stepLabel: "Account context", suggestedVerb: "Attribute", deliverableType: "correlation_table" },
      { intent: "scope_timeline", stepLabel: "Startup and execution sequence", suggestedVerb: "Sequence", deliverableType: "timeline" },
      { intent: "change_control", stepLabel: "Approved maintenance coverage", suggestedVerb: "Reconcile", deliverableType: "policy_mapping" },
      { intent: "evidence_integrity", stepLabel: "Logging coverage", suggestedVerb: "Document", deliverableType: "gap_assessment" },
      { intent: "containment_recommendation", stepLabel: "Containment options", suggestedVerb: "Recommend", deliverableType: "containment_plan" },
    ],
  },
];

export function linuxInvestigationBlueprintForFamily(incidentFamily: string) {
  return LINUX_INVESTIGATION_BLUEPRINTS.find((blueprint) => blueprint.incidentFamilies.includes(incidentFamily)) ||
    LINUX_INVESTIGATION_BLUEPRINTS[0];
}

export function linuxPlannerTaskSpecs(incidentFamily: string, advanced: boolean): LinuxPlannerTaskSpec[] {
  const blueprint = linuxInvestigationBlueprintForFamily(incidentFamily);
  const baseSteps = incidentFamily === "ssh_bruteforce"
    ? blueprint.steps.map((step) => step.intent === "sudo_policy"
      ? { intent: "configuration_review" as const, stepLabel: "SSH control baseline", suggestedVerb: "Compare", deliverableType: "policy_mapping" as const }
      : step)
    : incidentFamily === "ssh_key_compromise"
      ? blueprint.steps.map((step) => step.intent === "sudo_policy"
        ? { intent: "key_provenance" as const, stepLabel: "SSH key provenance", suggestedVerb: "Trace", deliverableType: "evidence_notes" as const }
        : step)
    : blueprint.steps;
  const advancedOnlyIntents = new Set<CanonicalInvestigationTask["intent"]>([
    "impact_assessment",
    "risk_assessment",
    "containment_recommendation",
  ]);
  const steps = advanced
    ? baseSteps
    : baseSteps.filter((step) => !advancedOnlyIntents.has(step.intent)).slice(0, 6);
  return steps.map((step) => {
    const contract = LINUX_TASK_CONTRACTS[step.intent];
    return {
      ...contract,
      expectedDeliverableType: step.deliverableType || contract.expectedDeliverableType,
      blueprintId: blueprint.id,
      blueprintLabel: blueprint.label,
      stepLabel: step.stepLabel,
      suggestedVerb: step.suggestedVerb,
    };
  });
}

export function inferLinuxTaskContracts(taskText: string, evidenceText: string, family?: string) {
  const matched = new Set<CanonicalInvestigationTask["intent"]>();
  for (const contract of Object.values(LINUX_TASK_CONTRACTS)) {
    if (contract.textPatterns.some((pattern) => pattern.test(taskText))) {
      matched.add(contract.intent);
    }
  }
  if (family === "ssh_key_compromise" && /\b(?:key|authorized_keys|authorized)\b/i.test(taskText)) matched.add("key_provenance");
  if (matched.has("change_control") && /\b(?:map|reconcile|compare)\b.*\b(?:change|maintenance|ticket|chg-\d+)/i.test(taskText)) {
    ["key_provenance", "cron_analysis", "package_transaction", "sudo_policy", "scope_timeline"].forEach((intent) => matched.delete(intent as CanonicalInvestigationTask["intent"]));
  }
  return matched;
}
