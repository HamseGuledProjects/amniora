import type {
  CanonicalEvidenceCapability,
  CanonicalInvestigationTask,
  LinuxSimulationWorld,
} from "./simulation";

export type LinuxCurrentStateCapability = Extract<
  CanonicalEvidenceCapability,
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
>;

export type LinuxCurrentStateRequirement = {
  capability: LinuxCurrentStateCapability;
  subjectIds: string[];
  reason: string;
  suggestedEvidence: string[];
};

export const CURRENT_STATE_EVIDENCE_HINTS: Record<LinuxCurrentStateCapability, string[]> = {
  current_service_state: ["assets/reports/service_inventory.txt"],
  current_process_state: ["assets/runtime/process_snapshot.txt"],
  current_listener_state: ["assets/network/listening_ports.txt"],
  current_package_state: ["assets/inventory/package_inventory.txt"],
  current_persistence_state: ["assets/scheduled/root_crontab.txt", "assets/scheduled/cron.d/"],
  current_identity_state: ["assets/csv/users.csv", "assets/csv/groups.csv", "assets/accounts/passwd.sample", "assets/accounts/group.sample"],
  current_file_state: ["assets/reports/permissions_report.txt", "assets/runtime/open_files.txt"],
  current_open_file_state: ["assets/runtime/open_files.txt", "assets/runtime/process_snapshot.txt"],
  current_policy_state: ["assets/configs/sudoers.d/platform"],
  current_configuration_state: ["assets/configs/linux_config_pack.txt", "assets/configs/ssh/sshd_config", "assets/reports/service_inventory.txt"],
};

const CURRENT_STATE_WORDING =
  /\b(?:current(?:ly)?|present(?:\s+state)?|runtime\s+state|live\s+state|active\s+state|service\s+status|process\s+status|still\s+running|remains?\s+(?:running|active|enabled|installed|present)|running|enabled|disabled|listening|open|mounted|installed|configured|effective\s+configuration|current\s+permissions|current\s+account\s+state|current\s+persistence\s+mechanism)\b/i;

export function taskTextRequestsCurrentState(taskText: string) {
  return CURRENT_STATE_WORDING.test(taskText);
}

function taskTextRequestsCurrentPackageState(taskText: string) {
  // A task can compare captured service state in one sentence and discuss
  // package provenance in another. Neither clause asks for package inventory.
  return taskText.split(/(?:[.!?;]\s+|\r?\n+)/).some((clause) =>
    /\b(?:current(?:ly)?|captured|capture-time|live|runtime)\s+(?:installed\s+)?(?:packages?|package\s+(?:inventory|state|status|presence|version)|apt|dpkg)\b/i.test(clause) ||
    /\b(?:package|apt|dpkg)\s+(?:inventory|state|status|presence|version)\b/i.test(clause) &&
      !/\b(?:historical|prior|previous|incident-time)\s+(?:package|apt|dpkg)\b/i.test(clause) ||
    /\b(?:currently|still|remains?)\s+(?:installed|removed|present)\b/i.test(clause)
  );
}

export function currentStateCapabilitiesForIntent(intent: CanonicalInvestigationTask["intent"]): LinuxCurrentStateCapability[] {
  switch (intent) {
    case "actor_attribution":
    case "ssh_authentication":
      return ["current_identity_state"];
    case "key_provenance":
      return [];
    case "sudo_policy":
      return ["current_policy_state", "current_identity_state"];
    case "file_permissions":
      return ["current_file_state"];
    case "service_state":
      return ["current_service_state"];
    default:
      return [];
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function inferCurrentStateRequirementsFromText(
  taskText: string,
  simulation?: LinuxSimulationWorld
): LinuxCurrentStateRequirement[] {
  const text = taskText.toLowerCase();
  const requirements: LinuxCurrentStateRequirement[] = [];
  const add = (capability: LinuxCurrentStateCapability, subjectIds: string[], reason: string) => {
    if (!requirements.some((item) => item.capability === capability && item.subjectIds.join("|") === unique(subjectIds).join("|"))) {
      requirements.push({
        capability,
        subjectIds: unique(subjectIds),
        reason,
        suggestedEvidence: CURRENT_STATE_EVIDENCE_HINTS[capability],
      });
    }
  };

  const currentRequested = taskTextRequestsCurrentState(taskText);
  const serviceSubjects = unique((simulation?.services || [])
    .filter((service) => text.includes(service.unitName.toLowerCase()) || text.includes(service.unitName.replace(/\.service$/, "").toLowerCase()))
    .map((service) => service.id));
  const packageSubjects = unique((simulation?.packageTransactions || [])
    .flatMap((transaction) => transaction.packages)
    .filter((pkg) => text.includes(pkg.name.toLowerCase()))
    .map((pkg) => `package-subject:${pkg.name}`));
  const identitySubjects = unique((simulation?.identities || [])
    .filter((identity) => text.includes(identity.username.toLowerCase()))
    .map((identity) => identity.id));
  const fileSubjects = unique((simulation?.files || [])
    .filter((file) => text.includes(file.path.toLowerCase()))
    .map((file) => file.id));
  const cronSubjects = unique((simulation?.cronDefinitions || [])
    .filter((definition) => text.includes(definition.sourcePath.toLowerCase()) || text.includes("cron") || text.includes("crontab"))
    .map((definition) => definition.id));

  if (currentRequested && /\b(?:service|systemd|unit|daemon|enabled|disabled|failed|inactive|service\s+status)\b/i.test(taskText)) {
    add("current_service_state", serviceSubjects, "current service status wording");
  }
  if (currentRequested && /\b(?:process|pid|still\s+running|process\s+status|running)\b/i.test(taskText)) {
    add("current_process_state", [], "current process status wording");
  }
  if (currentRequested && /\b(?:listening|listener|socket|port|network|exposure)\b/i.test(taskText)) {
    add("current_listener_state", [], "current listener wording");
  }
  if (taskTextRequestsCurrentPackageState(taskText)) {
    add("current_package_state", packageSubjects, "current package inventory wording");
  }
  if (currentRequested && /\b(?:cron|crontab|timer|persistence|startup|mechanism)\b/i.test(taskText)) {
    add("current_persistence_state", cronSubjects, "current persistence wording");
  }
  if (currentRequested && /\b(?:account|group|membership|shell|user|identity)\b/i.test(taskText)) {
    add("current_identity_state", identitySubjects, "current account or group wording");
  }
  if (currentRequested && /\b(?:open\s+file|currently\s+open|still\s+open|held\s+open|file\s+descriptor|descriptor|lsof|deleted\s+file|socket\s+descriptor)\b/i.test(taskText)) {
    add("current_open_file_state", fileSubjects, "current open-file descriptor wording");
  }
  if (currentRequested && /\b(?:permission|owner|group|mode|file\s+state|current\s+file|open)\b/i.test(taskText)) {
    add("current_file_state", fileSubjects, "current file or permission wording");
  }
  if (currentRequested && /\b(?:sudo|policy|sudoers|authori[sz]ation)\b/i.test(taskText)) {
    add("current_policy_state", identitySubjects, "current sudo policy wording");
  }
  if (currentRequested && /\b(?:configured|configuration|effective\s+configuration|baseline|setting)\b/i.test(taskText)) {
    add("current_configuration_state", serviceSubjects, "current configuration wording");
  }

  return requirements;
}
