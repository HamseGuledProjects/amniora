import type {
  CanonicalEvidenceAsset,
  CanonicalEvidenceCapability,
  CanonicalInvestigationTask,
  LinuxSimulationWorld,
} from "./simulation";
import type { LinuxCurrentStateCapability } from "./currentStateEvidence";

export type LinuxDifficulty = CanonicalInvestigationTask["difficulty"];
export type LinuxTaskIntent = CanonicalInvestigationTask["intent"];

export type LinuxEvidenceSurface = "compact" | "enriched" | "full";

export type LinuxDifficultyProfile = {
  difficulty: LinuxDifficulty;
  taskIntents: {
    allowed: LinuxTaskIntent[];
    conditional: LinuxTaskIntent[];
    prohibited: LinuxTaskIntent[];
  };
  capabilities: {
    guaranteed: CanonicalEvidenceCapability[];
    conditional: CanonicalEvidenceCapability[];
    prohibited: CanonicalEvidenceCapability[];
  };
  currentStateCapabilities: {
    supported: LinuxCurrentStateCapability[];
    conditional: LinuxCurrentStateCapability[];
    prohibited: LinuxCurrentStateCapability[];
  };
  historicalStateCapabilities: {
    supported: CanonicalEvidenceCapability[];
    conditional: CanonicalEvidenceCapability[];
    prohibited: CanonicalEvidenceCapability[];
  };
  evidencePaths: {
    guaranteed: string[];
    conditional: string[];
    prohibited: string[];
  };
  expectedTaskCount: {
    min: number;
    max: number;
  };
  evidenceSurface: LinuxEvidenceSurface;
};

export type LinuxDifficultyDiagnosticCode =
  | "LINUX_DIFFICULTY_UNSUPPORTED_INTENT"
  | "LINUX_DIFFICULTY_CONDITIONAL_INTENT_UNSATISFIED"
  | "LINUX_DIFFICULTY_UNSUPPORTED_CAPABILITY"
  | "LINUX_DIFFICULTY_UNSUPPORTED_CURRENT_STATE"
  | "LINUX_DIFFICULTY_PROHIBITED_EVIDENCE"
  | "LINUX_DIFFICULTY_ADVANCED_ASSET_LEAK"
  | "LINUX_DIFFICULTY_UNRENDERED_SELECTED_EVIDENCE"
  | "LINUX_DIFFICULTY_UNCLASSIFIED_INTENT"
  | "LINUX_DIFFICULTY_UNCLASSIFIED_CAPABILITY";

export type LinuxDifficultyDiagnosticIssue = {
  code: LinuxDifficultyDiagnosticCode;
  severity: "info" | "low" | "medium" | "high" | "critical";
  difficulty: LinuxDifficulty;
  taskId?: string;
  intent?: string;
  capability?: string;
  evidencePath?: string;
  message: string;
};

export type LinuxDifficultyDiagnosticResult = {
  difficulty: LinuxDifficulty;
  profile: {
    evidenceSurface: LinuxEvidenceSurface;
    expectedTaskCount: LinuxDifficultyProfile["expectedTaskCount"];
  };
  issues: LinuxDifficultyDiagnosticIssue[];
};

export type LinuxTaskPlannerDiagnosticCode =
  | "LINUX_TASK_INTENT_PROHIBITED_FOR_DIFFICULTY"
  | "LINUX_TASK_INTENT_CONDITIONAL_SUPPORT_MISSING"
  | "LINUX_TASK_CAPABILITY_UNAVAILABLE"
  | "LINUX_TASK_CURRENT_STATE_UNAVAILABLE"
  | "LINUX_TASK_EVIDENCE_UNAVAILABLE"
  | "LINUX_TASK_OBJECT_GROUNDING_UNAVAILABLE"
  | "LINUX_TASK_COUNT_UNSATISFIABLE"
  | "LINUX_TASK_INTENT_UNCLASSIFIED"
  | "LINUX_TASK_EVIDENCE_CAPABILITY_CLOSURE_FAILED"
  | "LINUX_TASK_EVIDENCE_CURRENT_STATE_CLOSURE_FAILED"
  | "LINUX_TASK_EVIDENCE_SUBJECT_CLOSURE_FAILED"
  | "LINUX_TASK_EVIDENCE_RELATIONSHIP_CLOSURE_FAILED"
  | "LINUX_TASK_EVIDENCE_PATH_CLOSURE_FAILED"
  | "LINUX_TASK_EVIDENCE_DIFFICULTY_CLOSURE_FAILED"
  | "LINUX_TASK_EVIDENCE_LIMIT_EXCEEDED"
  | "LINUX_TASK_EVIDENCE_SELECTION_UNSATISFIABLE";

export type LinuxTaskPlannerDiagnostic = {
  code: LinuxTaskPlannerDiagnosticCode;
  difficulty: LinuxDifficulty;
  intent?: string;
  family: string;
  blueprintId?: string;
  missingCapabilities: string[];
  missingCurrentStateCapabilities: string[];
  missingEvidence: string[];
  missingCanonicalSubjects: string[];
  missingRelationships?: string[];
  candidateEvidence?: string[];
  selectedEvidence?: string[];
  prohibited: boolean;
  message: string;
};

export const ALL_LINUX_TASK_INTENTS = [
  "scope_timeline",
  "actor_attribution",
  "ssh_authentication",
  "key_provenance",
  "sudo_policy",
  "command_process",
  "file_permissions",
  "service_state",
  "package_transaction",
  "cron_analysis",
  "network_source",
  "configuration_review",
  "change_control",
  "evidence_integrity",
  "impact_assessment",
  "risk_assessment",
  "containment_recommendation",
] as const satisfies readonly LinuxTaskIntent[];

export const ALL_LINUX_EVIDENCE_CAPABILITIES = [
  "authentication",
  "session_lifecycle",
  "actor_attribution",
  "sudo_authorisation",
  "command_execution",
  "process_ancestry",
  "open_file_correlation",
  "file_owner_group_mode",
  "service_state",
  "service_transition",
  "package_transaction",
  "cron_definition",
  "cron_execution",
  "key_provenance",
  "configuration_baseline",
  "network_source",
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
  "change_control",
  "maintenance_scope",
  "risk_context",
  "evidence_integrity",
  "timeline_exact",
  "timeline_context",
  "timeline_static",
] as const satisfies readonly CanonicalEvidenceCapability[];

const BEGINNER_ALLOWED_INTENTS = [
  "scope_timeline",
  "ssh_authentication",
  "actor_attribution",
  "file_permissions",
  "service_state",
  "configuration_review",
] as const satisfies readonly LinuxTaskIntent[];

const BEGINNER_PROHIBITED_INTENTS = [
  "key_provenance",
  "command_process",
  "package_transaction",
  "cron_analysis",
  "network_source",
  "change_control",
  "evidence_integrity",
  "impact_assessment",
  "risk_assessment",
  "containment_recommendation",
] as const satisfies readonly LinuxTaskIntent[];

const BEGINNER_GUARANTEED_CAPABILITIES = [
  "authentication",
  "session_lifecycle",
  "actor_attribution",
  "current_identity_state",
  "timeline_exact",
  "timeline_context",
  "timeline_static",
  "file_owner_group_mode",
  "current_file_state",
  "service_state",
  "current_service_state",
  "configuration_baseline",
] as const satisfies readonly CanonicalEvidenceCapability[];

const BEGINNER_CONDITIONAL_CAPABILITIES = [
  "sudo_authorisation",
  "command_execution",
  "service_transition",
  "change_control",
  "risk_context",
  "current_configuration_state",
] as const satisfies readonly CanonicalEvidenceCapability[];

const BEGINNER_PROHIBITED_CAPABILITIES = [
  "process_ancestry",
  "open_file_correlation",
  "current_process_state",
  "current_open_file_state",
  "current_policy_state",
  "cron_definition",
  "cron_execution",
  "current_persistence_state",
  "package_transaction",
  "current_package_state",
  "network_source",
  "current_listener_state",
  "maintenance_scope",
  "key_provenance",
  "evidence_integrity",
] as const satisfies readonly CanonicalEvidenceCapability[];

const BEGINNER_GUARANTEED_EVIDENCE = [
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
];

const INTERMEDIATE_ALLOWED_INTENTS = [
  ...BEGINNER_ALLOWED_INTENTS,
  "sudo_policy",
  "command_process",
  "change_control",
] as const satisfies readonly LinuxTaskIntent[];

const INTERMEDIATE_CONDITIONAL_INTENTS = [
  "key_provenance",
  "cron_analysis",
  "package_transaction",
  "network_source",
  "impact_assessment",
  "risk_assessment",
  "evidence_integrity",
] as const satisfies readonly LinuxTaskIntent[];

const INTERMEDIATE_PROHIBITED_INTENTS = [
  "containment_recommendation",
] as const satisfies readonly LinuxTaskIntent[];

const INTERMEDIATE_GUARANTEED_CAPABILITIES = [
  ...BEGINNER_GUARANTEED_CAPABILITIES,
  "sudo_authorisation",
  "current_policy_state",
  "command_execution",
  "process_ancestry",
  "open_file_correlation",
  "maintenance_scope",
] as const satisfies readonly CanonicalEvidenceCapability[];

const INTERMEDIATE_CONDITIONAL_CAPABILITIES = [
  "key_provenance",
  "service_transition",
  "change_control",
  "risk_context",
  "current_configuration_state",
  "cron_definition",
  "cron_execution",
  "current_persistence_state",
  "package_transaction",
  "current_package_state",
  "network_source",
  "current_listener_state",
  "evidence_integrity",
] as const satisfies readonly CanonicalEvidenceCapability[];

const INTERMEDIATE_PROHIBITED_CAPABILITIES = [
  "current_process_state",
  "current_open_file_state",
] as const satisfies readonly CanonicalEvidenceCapability[];

const INTERMEDIATE_GUARANTEED_EVIDENCE = [
  ...BEGINNER_GUARANTEED_EVIDENCE,
  "assets/configs/sudoers.d/platform",
  "assets/runtime/process_execution_history.txt",
  "assets/runtime/file_access_history.csv",
  "assets/docs/maintenance_ticket.md",
];

const INTERMEDIATE_CONDITIONAL_EVIDENCE = [
  "assets/ssh/*/authorized_keys",
  "assets/docs/change_request.md",
  "assets/docs/maintenance_ticket.md",
  "assets/scheduled/root_crontab.txt",
  "assets/scheduled/cron.d/*",
  "assets/scripts/*.sh",
  "assets/journal/journal_systemd.txt",
  "assets/logs/apt_history.log",
  "assets/inventory/package_inventory.txt",
  "assets/network/listening_ports.txt",
  "assets/network/ufw_status.txt",
  "assets/evidence/risk_register.csv",
  "assets/evidence/audit_notes.md",
];

const LOWER_TIER_PROHIBITED_EVIDENCE = [
  "assets/logs/audit.log",
  "assets/logs/cron.log",
  "assets/journal/journal_ssh.txt",
  "assets/runtime/process_snapshot.txt",
  "assets/runtime/open_files.txt",
  "assets/accounts/passwd.sample",
  "assets/accounts/group.sample",
  "assets/accounts/shadow.sample",
  "assets/configs/ssh/sshd_config",
  "assets/configs/pam/sshd",
  "assets/network/routing_table.txt",
  "assets/scripts/script_sample.sh",
  "assets/evidence/analyst_working_notes.md",
  "assets/evidence/analyst_questions.md",
  "assets/evidence/advanced_risk_register.csv",
  "assets/reports/hardening_checklist.md",
];

const BEGINNER_PROHIBITED_EVIDENCE = [
  ...LOWER_TIER_PROHIBITED_EVIDENCE,
  "assets/runtime/process_execution_history.txt",
  "assets/runtime/file_access_history.csv",
  "assets/docs/maintenance_ticket.md",
  "assets/docs/change_request.md",
  "assets/network/listening_ports.txt",
  "assets/network/ufw_status.txt",
  "assets/evidence/risk_register.csv",
  "assets/evidence/audit_notes.md",
];

function profile(
  difficulty: LinuxDifficulty,
  input: Omit<LinuxDifficultyProfile, "difficulty">
): LinuxDifficultyProfile {
  return {
    difficulty,
    ...input,
  };
}

export const LINUX_DIFFICULTY_PROFILES: Record<LinuxDifficulty, LinuxDifficultyProfile> = {
  Beginner: profile("Beginner", {
    taskIntents: {
      allowed: [...BEGINNER_ALLOWED_INTENTS],
      conditional: ["sudo_policy"],
      prohibited: [...BEGINNER_PROHIBITED_INTENTS],
    },
    capabilities: {
      guaranteed: [...BEGINNER_GUARANTEED_CAPABILITIES],
      conditional: [...BEGINNER_CONDITIONAL_CAPABILITIES],
      prohibited: [...BEGINNER_PROHIBITED_CAPABILITIES],
    },
    currentStateCapabilities: {
      supported: ["current_identity_state", "current_file_state", "current_service_state", "current_configuration_state"],
      conditional: [],
      prohibited: ["current_process_state", "current_listener_state", "current_package_state", "current_persistence_state", "current_open_file_state", "current_policy_state"],
    },
    historicalStateCapabilities: {
      supported: ["authentication", "session_lifecycle", "actor_attribution", "timeline_exact", "timeline_context", "timeline_static", "file_owner_group_mode", "service_state", "configuration_baseline"],
      conditional: ["sudo_authorisation", "command_execution", "service_transition", "change_control", "risk_context"],
      prohibited: ["process_ancestry", "open_file_correlation", "cron_definition", "cron_execution", "package_transaction", "network_source", "maintenance_scope", "key_provenance", "evidence_integrity"],
    },
    evidencePaths: {
      guaranteed: [...BEGINNER_GUARANTEED_EVIDENCE],
      conditional: [],
      prohibited: [...BEGINNER_PROHIBITED_EVIDENCE],
    },
    expectedTaskCount: { min: 3, max: 4 },
    evidenceSurface: "compact",
  }),
  Intermediate: profile("Intermediate", {
    taskIntents: {
      allowed: [...INTERMEDIATE_ALLOWED_INTENTS],
      conditional: [...INTERMEDIATE_CONDITIONAL_INTENTS],
      prohibited: [...INTERMEDIATE_PROHIBITED_INTENTS],
    },
    capabilities: {
      guaranteed: [...INTERMEDIATE_GUARANTEED_CAPABILITIES],
      conditional: [...INTERMEDIATE_CONDITIONAL_CAPABILITIES],
      prohibited: [...INTERMEDIATE_PROHIBITED_CAPABILITIES],
    },
    currentStateCapabilities: {
      supported: ["current_identity_state", "current_file_state", "current_service_state", "current_configuration_state", "current_policy_state"],
      conditional: ["current_persistence_state", "current_package_state", "current_listener_state"],
      prohibited: ["current_process_state", "current_open_file_state"],
    },
    historicalStateCapabilities: {
      supported: ["authentication", "session_lifecycle", "actor_attribution", "sudo_authorisation", "command_execution", "process_ancestry", "open_file_correlation", "file_owner_group_mode", "service_state", "configuration_baseline", "change_control", "maintenance_scope", "timeline_exact", "timeline_context", "timeline_static"],
      conditional: ["service_transition", "key_provenance", "package_transaction", "cron_definition", "cron_execution", "network_source", "risk_context", "evidence_integrity"],
      prohibited: [],
    },
    evidencePaths: {
      guaranteed: [...INTERMEDIATE_GUARANTEED_EVIDENCE],
      conditional: [...INTERMEDIATE_CONDITIONAL_EVIDENCE],
      prohibited: [...LOWER_TIER_PROHIBITED_EVIDENCE],
    },
    expectedTaskCount: { min: 5, max: 5 },
    evidenceSurface: "enriched",
  }),
  Advanced: profile("Advanced", {
    taskIntents: {
      allowed: [...ALL_LINUX_TASK_INTENTS],
      conditional: [],
      prohibited: [],
    },
    capabilities: {
      guaranteed: [...ALL_LINUX_EVIDENCE_CAPABILITIES],
      conditional: [],
      prohibited: [],
    },
    currentStateCapabilities: {
      supported: ALL_LINUX_EVIDENCE_CAPABILITIES.filter((capability): capability is LinuxCurrentStateCapability => capability.startsWith("current_")),
      conditional: [],
      prohibited: [],
    },
    historicalStateCapabilities: {
      supported: ALL_LINUX_EVIDENCE_CAPABILITIES.filter((capability) => !capability.startsWith("current_")),
      conditional: [],
      prohibited: [],
    },
    evidencePaths: {
      guaranteed: [],
      conditional: ["assets/*"],
      prohibited: [],
    },
    expectedTaskCount: { min: 5, max: 8 },
    evidenceSurface: "full",
  }),
};

export function normalizeLinuxEvidencePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").toLowerCase();
}

function patternMatches(pattern: string, path: string) {
  const normalizedPattern = normalizeLinuxEvidencePath(pattern);
  const normalizedPath = normalizeLinuxEvidencePath(path);
  if (normalizedPattern.endsWith("*")) {
    return normalizedPath.startsWith(normalizedPattern.slice(0, -1));
  }
  if (normalizedPattern.includes("*")) {
    const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+");
    return new RegExp(`^${escaped}$`, "i").test(normalizedPath);
  }
  return normalizedPath === normalizedPattern;
}

function matchesAnyPattern(path: string, patterns: readonly string[]) {
  return patterns.some((pattern) => patternMatches(pattern, path));
}

export function linuxDifficultyProfile(difficultyInput: string): LinuxDifficultyProfile {
  const difficulty = (["Beginner", "Intermediate", "Advanced"].includes(difficultyInput) ? difficultyInput : "Advanced") as LinuxDifficulty;
  return LINUX_DIFFICULTY_PROFILES[difficulty];
}

export function linuxDurationTaskCountBounds(
  difficultyInput: string,
  requestedDurationMinutes?: number
): LinuxDifficultyProfile["expectedTaskCount"] {
  const profile = linuxDifficultyProfile(difficultyInput);
  const duration = Number(requestedDurationMinutes);
  if (!Number.isFinite(duration)) return profile.expectedTaskCount;
  if (duration <= 15) {
    if (profile.difficulty === "Beginner") return { min: 2, max: 3 };
    if (profile.difficulty === "Intermediate") return { min: 3, max: 3 };
    return { min: 4, max: 5 };
  }
  if (duration <= 30 && profile.difficulty === "Advanced") return { min: 4, max: 4 };
  return profile.expectedTaskCount;
}

function simulationSupportsConditionalEvidence(simulation: LinuxSimulationWorld | undefined, path: string) {
  if (!simulation) return false;
  const normalizedPath = normalizeLinuxEvidencePath(path);
  const family = simulation.investigation.incidentFamily;
  if (normalizedPath === "assets/configs/sudoers.d/platform") {
    return ["misconfigured_sudoers", "unauthorized_package_install", "service_account_misuse"].includes(family);
  }
  if (/^assets\/ssh\/[^/]+\/authorized_keys$/i.test(normalizedPath)) {
    return family === "ssh_key_compromise";
  }
  if (normalizedPath === "assets/docs/change_request.md") {
    return simulation.maintenanceActivities.some((activity) => Boolean(activity.changeId));
  }
  if (normalizedPath === "assets/docs/maintenance_ticket.md") {
    return simulation.maintenanceActivities.some((activity) => Boolean(activity.ticketId || activity.changeId));
  }
  if (normalizedPath === "assets/evidence/risk_register.csv" || normalizedPath === "assets/evidence/audit_notes.md") {
    return ["impact_assessment", "risk_assessment", "evidence_integrity"].some((intent) =>
      simulation.canonicalTasks.some((task) => task.intent === intent)
    ) || ["reverse_shell", "data_staging", "docker_compromise", "log_tampering"].includes(family);
  }
  if (normalizedPath === "assets/scheduled/root_crontab.txt" || normalizedPath.startsWith("assets/scheduled/cron.d/")) {
    return family === "cron_persistence" && simulation.cronDefinitions.some((definition) => definition.enabled && definition.persistenceState === "present");
  }
  if (/^assets\/scripts\/[^/]+\.sh$/i.test(normalizedPath)) {
    return family === "cron_persistence" && simulation.scheduledExecutions.some((execution) => Boolean(execution.definitionId));
  }
  if (normalizedPath === "assets/journal/journal_systemd.txt") {
    return family === "systemd_persistence" && simulation.serviceTransitions.length > 0;
  }
  if (normalizedPath === "assets/logs/apt_history.log" || normalizedPath === "assets/inventory/package_inventory.txt") {
    return family === "unauthorized_package_install" && simulation.packageTransactions.length > 0;
  }
  if (normalizedPath === "assets/network/listening_ports.txt" || normalizedPath === "assets/network/ufw_status.txt") {
    return ["reverse_shell", "data_staging", "docker_compromise"].includes(family);
  }
  return false;
}

export function filterEvidenceRegistryForDifficulty(
  registry: CanonicalEvidenceAsset[],
  difficultyInput: string,
  simulation?: LinuxSimulationWorld
) {
  const profile = linuxDifficultyProfile(difficultyInput);
  if (profile.difficulty === "Advanced") return registry.slice();

  return registry.filter((asset) => {
    const path = normalizeLinuxEvidencePath(asset.path);
    if (matchesAnyPattern(path, profile.evidencePaths.prohibited)) return false;
    if (matchesAnyPattern(path, profile.evidencePaths.guaranteed)) return true;
    if (matchesAnyPattern(path, profile.evidencePaths.conditional)) {
      return simulationSupportsConditionalEvidence(simulation, path);
    }
    return false;
  });
}

function classificationFor<T extends string>(value: string, categories: {
  allowed?: readonly T[];
  guaranteed?: readonly T[];
  supported?: readonly T[];
  conditional: readonly T[];
  prohibited: readonly T[];
}) {
  if ((categories.allowed || categories.guaranteed || categories.supported || []).includes(value as T)) return "supported";
  if (categories.conditional.includes(value as T)) return "conditional";
  if (categories.prohibited.includes(value as T)) return "prohibited";
  return "unclassified";
}

function diagnosticIssue(
  issues: LinuxDifficultyDiagnosticIssue[],
  issue: Omit<LinuxDifficultyDiagnosticIssue, "severity"> & { severity?: LinuxDifficultyDiagnosticIssue["severity"] }
) {
  issues.push({
    severity: issue.severity || "high",
    ...issue,
  });
}

export function validateLinuxTaskPlanAgainstDifficultyProfile(input: {
  difficulty: string;
  requestedDurationMinutes?: number;
  tasks: Array<Pick<CanonicalInvestigationTask, "id" | "intent" | "requiredCapabilities" | "currentStateRequirements" | "selectedEvidenceAssetIds">>;
  fullEvidenceRegistry: CanonicalEvidenceAsset[];
  planningEvidenceRegistry: CanonicalEvidenceAsset[];
  renderedAssetPaths?: string[];
}): LinuxDifficultyDiagnosticResult {
  const profile = linuxDifficultyProfile(input.difficulty);
  const issues: LinuxDifficultyDiagnosticIssue[] = [];
  const fullById = new Map(input.fullEvidenceRegistry.map((asset) => [asset.id, asset]));
  const planningById = new Map(input.planningEvidenceRegistry.map((asset) => [asset.id, asset]));
  const renderedPaths = input.renderedAssetPaths
    ? new Set(input.renderedAssetPaths.map(normalizeLinuxEvidencePath))
    : undefined;

  for (const task of input.tasks) {
    const intentClass = classificationFor(String(task.intent), {
      allowed: profile.taskIntents.allowed,
      conditional: profile.taskIntents.conditional,
      prohibited: profile.taskIntents.prohibited,
    });
    if (intentClass === "unclassified") {
      diagnosticIssue(issues, {
        code: "LINUX_DIFFICULTY_UNCLASSIFIED_INTENT",
        difficulty: profile.difficulty,
        taskId: task.id,
        intent: String(task.intent),
        message: `Task intent ${String(task.intent)} is not classified for ${profile.difficulty}.`,
      });
    } else if (intentClass === "prohibited") {
      diagnosticIssue(issues, {
        code: "LINUX_DIFFICULTY_UNSUPPORTED_INTENT",
        difficulty: profile.difficulty,
        taskId: task.id,
        intent: String(task.intent),
        message: `Task intent ${String(task.intent)} is prohibited for ${profile.difficulty}.`,
      });
    } else if (intentClass === "conditional") {
      const selectedAssets = task.selectedEvidenceAssetIds.map((id) => planningById.get(id)).filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset));
      if (selectedAssets.length === 0) {
        diagnosticIssue(issues, {
          code: "LINUX_DIFFICULTY_CONDITIONAL_INTENT_UNSATISFIED",
          difficulty: profile.difficulty,
          taskId: task.id,
          intent: String(task.intent),
          message: `Conditional task intent ${String(task.intent)} has no eligible planning evidence for ${profile.difficulty}.`,
        });
      }
    }

    for (const capability of task.requiredCapabilities || []) {
      const capabilityClass = classificationFor(String(capability), {
        guaranteed: profile.capabilities.guaranteed,
        conditional: profile.capabilities.conditional,
        prohibited: profile.capabilities.prohibited,
      });
      if (capabilityClass === "unclassified") {
        diagnosticIssue(issues, {
          code: "LINUX_DIFFICULTY_UNCLASSIFIED_CAPABILITY",
          difficulty: profile.difficulty,
          taskId: task.id,
          intent: String(task.intent),
          capability: String(capability),
          message: `Capability ${String(capability)} is not classified for ${profile.difficulty}.`,
        });
      } else if (capabilityClass === "prohibited") {
        diagnosticIssue(issues, {
          code: "LINUX_DIFFICULTY_UNSUPPORTED_CAPABILITY",
          difficulty: profile.difficulty,
          taskId: task.id,
          intent: String(task.intent),
          capability: String(capability),
          message: `Capability ${String(capability)} is prohibited for ${profile.difficulty}.`,
        });
      }
    }

    for (const requirement of task.currentStateRequirements || []) {
      const capabilityClass = classificationFor(String(requirement.capability), {
        supported: profile.currentStateCapabilities.supported,
        conditional: profile.currentStateCapabilities.conditional,
        prohibited: profile.currentStateCapabilities.prohibited,
      });
      if (capabilityClass === "unclassified") {
        diagnosticIssue(issues, {
          code: "LINUX_DIFFICULTY_UNCLASSIFIED_CAPABILITY",
          difficulty: profile.difficulty,
          taskId: task.id,
          intent: String(task.intent),
          capability: String(requirement.capability),
          message: `Current-state capability ${String(requirement.capability)} is not classified for ${profile.difficulty}.`,
        });
      } else if (capabilityClass === "prohibited") {
        diagnosticIssue(issues, {
          code: "LINUX_DIFFICULTY_UNSUPPORTED_CURRENT_STATE",
          difficulty: profile.difficulty,
          taskId: task.id,
          intent: String(task.intent),
          capability: String(requirement.capability),
          message: `Current-state capability ${String(requirement.capability)} is prohibited for ${profile.difficulty}.`,
        });
      }
    }

    for (const assetId of task.selectedEvidenceAssetIds || []) {
      const fullAsset = fullById.get(assetId);
      const planningAsset = planningById.get(assetId);
      const path = fullAsset?.path || assetId;
      if (fullAsset && !planningAsset) {
        diagnosticIssue(issues, {
          code: matchesAnyPattern(path, profile.evidencePaths.prohibited)
            ? "LINUX_DIFFICULTY_PROHIBITED_EVIDENCE"
            : "LINUX_DIFFICULTY_ADVANCED_ASSET_LEAK",
          difficulty: profile.difficulty,
          taskId: task.id,
          intent: String(task.intent),
          evidencePath: path,
          message: `Task selected evidence ${path} outside the ${profile.difficulty} planning registry.`,
        });
      }
      if (fullAsset && renderedPaths && !renderedPaths.has(normalizeLinuxEvidencePath(fullAsset.path))) {
        diagnosticIssue(issues, {
          code: "LINUX_DIFFICULTY_UNRENDERED_SELECTED_EVIDENCE",
          difficulty: profile.difficulty,
          taskId: task.id,
          intent: String(task.intent),
          evidencePath: fullAsset.path,
          message: `Task selected evidence ${fullAsset.path} is not present in rendered assets.`,
        });
      }
    }
  }

  return {
    difficulty: profile.difficulty,
    profile: {
      evidenceSurface: profile.evidenceSurface,
      expectedTaskCount: linuxDurationTaskCountBounds(input.difficulty, input.requestedDurationMinutes),
    },
    issues,
  };
}
