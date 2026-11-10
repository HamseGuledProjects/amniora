import type { InvestigationWorld } from "../world";

export type LinuxChronologyShape = "early_burst" | "staggered" | "split_phase" | "late_focus";
export type LinuxTaskPath = "identity_led" | "timeline_led" | "control_led" | "runtime_led";
export type LinuxIdentityLayout = "operations_core" | "service_segmented" | "contractor_edge" | "federated_admin";
export type LinuxNarrativeStyle = "case_brief" | "review_note" | "operations_handoff" | "evidence_memo";

export type LinuxDiversityProfile = {
  version: "linux-diversity-profile-v1";
  key: string;
  windowMinutes: number;
  chronologyShape: LinuxChronologyShape;
  timelineOffsets: {
    start: number;
    auth: number;
    commands: number[];
    file: number;
    service: number;
    close: number;
  };
  tty: string;
  supportingProbe: string;
  taskPath: LinuxTaskPath;
  taskVariant: number;
  evidenceVariant: number;
  identityLayout: LinuxIdentityLayout;
  uidBase: number;
  uidStride: number;
  identityOrder: string[];
  noiseRotation: number;
  packageNoise: "openssl" | "ca-certificates" | "systemd" | "curl";
  narrativeStyle: LinuxNarrativeStyle;
};

export function linuxStableDiversityHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(values: readonly T[], key: string, salt: string) {
  return values[linuxStableDiversityHash(`${key}:${salt}`) % values.length];
}

function integer(key: string, salt: string, modulo: number) {
  return linuxStableDiversityHash(`${key}:${salt}`) % modulo;
}

export function linuxDiversityKey(
  world: Pick<InvestigationWorld, "caseId" | "host" | "company" | "department">,
  incidentFamily: string,
  difficulty: string
) {
  return `${world.caseId}:${world.host}:${world.company}:${world.department}:${incidentFamily}:${difficulty}`;
}

function chronologyOffsets(shape: LinuxChronologyShape, windowMinutes: number) {
  const seconds = windowMinutes * 60;
  const ratios: Record<LinuxChronologyShape, number[]> = {
    early_burst: [0.025, 0.055, 0.10, 0.16, 0.25, 0.38, 0.56, 0.78],
    staggered: [0.035, 0.11, 0.20, 0.34, 0.50, 0.63, 0.77, 0.90],
    split_phase: [0.025, 0.075, 0.14, 0.22, 0.61, 0.70, 0.81, 0.92],
    late_focus: [0.08, 0.22, 0.36, 0.46, 0.58, 0.69, 0.82, 0.94],
  };
  const values = ratios[shape].map((ratio) => Math.max(2, Math.round(seconds * ratio)));
  return {
    start: values[0],
    auth: values[1],
    commands: values.slice(2, 5),
    file: values[5],
    service: values[6],
    close: Math.min(seconds - 5, values[7]),
  };
}

const IDENTITY_ORDERS: Record<LinuxIdentityLayout, string[]> = {
  operations_core: ["analyst", "admin", "service", "app", "contractor", "intern", "employee"],
  service_segmented: ["service", "app", "admin", "analyst", "employee", "contractor", "intern"],
  contractor_edge: ["contractor", "admin", "analyst", "service", "employee", "app", "intern"],
  federated_admin: ["admin", "employee", "analyst", "contractor", "app", "service", "intern"],
};

export function buildLinuxDiversityProfile(input: {
  world: Pick<InvestigationWorld, "caseId" | "host" | "company" | "department">;
  incidentFamily: string;
  difficulty: string;
}): LinuxDiversityProfile {
  const key = linuxDiversityKey(input.world, input.incidentFamily, input.difficulty);
  const difficulty = ["Beginner", "Intermediate", "Advanced"].includes(input.difficulty)
    ? input.difficulty
    : "Intermediate";
  const windows = difficulty === "Beginner"
    ? [9, 12, 15, 18]
    : difficulty === "Advanced"
      ? [16, 20, 24, 28]
      : [13, 16, 19, 23];
  const taskVariant = integer(key, "task-variant", 97);
  const evidenceVariant = integer(key, "evidence-variant", 97);
  const chronologyShapes: LinuxChronologyShape[] = ["early_burst", "staggered", "split_phase", "late_focus"];
  const identityLayouts: LinuxIdentityLayout[] = ["operations_core", "service_segmented", "contractor_edge", "federated_admin"];
  const taskPaths: LinuxTaskPath[] = ["identity_led", "timeline_led", "control_led", "runtime_led"];
  const narrativeStyles: LinuxNarrativeStyle[] = ["case_brief", "review_note", "operations_handoff", "evidence_memo"];
  const packageNoiseOptions: LinuxDiversityProfile["packageNoise"][] = ["openssl", "ca-certificates", "systemd", "curl"];
  const chronologyShape = chronologyShapes[(taskVariant + Math.floor(evidenceVariant / 4)) % chronologyShapes.length];
  const identityLayout = identityLayouts[(Math.floor(taskVariant / 4) + evidenceVariant) % identityLayouts.length];
  const uidBase = [1100, 1600, 2400, 3200][(taskVariant + Math.floor(evidenceVariant / 7)) % 4];
  const uidStride = [1, 3, 7, 11][(evidenceVariant + Math.floor(taskVariant / 5)) % 4];
  const windowMinutes = windows[(taskVariant + evidenceVariant) % windows.length];

  return {
    version: "linux-diversity-profile-v1",
    key: `ldp:${linuxStableDiversityHash(key).toString(16).padStart(8, "0")}`,
    windowMinutes,
    chronologyShape,
    timelineOffsets: chronologyOffsets(chronologyShape, windowMinutes),
    tty: ["pts/0", "pts/1", "pts/2", "pts/4", "pts/7"][evidenceVariant % 5],
    supportingProbe: ["ops-maintenance-check", "service-owner-query", "platform-health-summary", "runbook-status"][taskVariant % 4],
    taskPath: taskPaths[evidenceVariant % taskPaths.length],
    taskVariant,
    evidenceVariant,
    identityLayout,
    uidBase,
    uidStride,
    identityOrder: [...IDENTITY_ORDERS[identityLayout]].sort((a, b) =>
      linuxStableDiversityHash(`${key}:identity-order:${a}`) - linuxStableDiversityHash(`${key}:identity-order:${b}`)),
    noiseRotation: (taskVariant * 7 + evidenceVariant) % 17,
    packageNoise: packageNoiseOptions[(taskVariant + evidenceVariant * 3) % packageNoiseOptions.length],
    narrativeStyle: narrativeStyles[taskVariant % narrativeStyles.length],
  };
}

export function rotateLinuxDiversityList<T>(values: readonly T[], offset: number) {
  if (values.length < 2) return [...values];
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}
