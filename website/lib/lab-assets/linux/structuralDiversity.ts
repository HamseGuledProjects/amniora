import { linuxInvestigationStageForIntent } from "./taskDiversity";
import type {
  CanonicalCommand,
  CanonicalIdentity,
  LinuxSimulationWorld,
} from "./simulation";

export const LINUX_STRUCTURAL_DIVERSITY_VERSION = "linux-structural-diversity-v3" as const;

export type LinuxStructuralDimension =
  | "incidentConcept"
  | "taskSequence"
  | "evidenceTopology"
  | "chronology"
  | "commandsProcesses"
  | "identityHost"
  | "noise"
  | "reasoningPath"
  | "narrativeLanguage";

export type LinuxStructuralFingerprint = {
  version: typeof LINUX_STRUCTURAL_DIVERSITY_VERSION;
  dimensions: Record<LinuxStructuralDimension, string[]>;
  canonical: string;
};

export type LinuxStructuralPair = {
  leftIndex: number;
  rightIndex: number;
  dimensionScores: Record<LinuxStructuralDimension, number>;
  overallDistinctiveness: number;
};

export type LinuxStructuralDiversityReport = {
  version: typeof LINUX_STRUCTURAL_DIVERSITY_VERSION;
  passed: boolean;
  fingerprints: LinuxStructuralFingerprint[];
  pairs: LinuxStructuralPair[];
  minimumDistinctiveness: number;
  averageDistinctiveness: number;
  issues: Array<{ code: "LINUX_STRUCTURAL_RESKIN" | "LINUX_STRUCTURAL_BATCH_REPETITION"; message: string; pair?: [number, number] }>;
};

const DIMENSIONS: LinuxStructuralDimension[] = [
  "incidentConcept",
  "taskSequence",
  "evidenceTopology",
  "chronology",
  "commandsProcesses",
  "identityHost",
  "noise",
  "reasoningPath",
  "narrativeLanguage",
];

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function timestampMs(value?: string) {
  if (!value) return 0;
  return Date.parse(`${value.replace(" ", "T")}Z`) || 0;
}

function secondsBetween(left?: string, right?: string) {
  return Math.max(0, Math.round((timestampMs(right) - timestampMs(left)) / 1000));
}

function spacingBucket(seconds: number) {
  if (seconds <= 5) return "immediate";
  if (seconds <= 20) return "short";
  if (seconds <= 60) return "minute";
  if (seconds <= 180) return "multi-minute";
  return "long-gap";
}

function scheduleShape(schedule: string) {
  return schedule
    .trim()
    .split(/\s+/)
    .map((field) => field === "*" ? "any" : field.startsWith("*/") ? "step" : field.includes(",") ? "list" : field.includes("-") ? "range" : "fixed")
    .join("/");
}

function semanticFileClass(path: string) {
  const normalized = path.toLowerCase();
  if (/authorized_keys|\.ssh\//.test(normalized)) return "ssh-trust";
  if (/shadow|passwd|group/.test(normalized)) return "identity-store";
  if (/sudoers/.test(normalized)) return "privilege-policy";
  if (/systemd|\.service/.test(normalized)) return "service-definition";
  if (/cron|crontab/.test(normalized)) return "schedule-definition";
  if (/docker/.test(normalized)) return "container-state";
  if (/log|journal/.test(normalized)) return "telemetry";
  if (/tmp|archive|export/.test(normalized)) return "staged-data";
  return "other-file";
}

function semanticServiceClass(unitName: string) {
  const normalized = unitName.toLowerCase();
  if (/ssh/.test(normalized)) return "remote-access";
  if (/cron/.test(normalized)) return "scheduler";
  if (/docker|container/.test(normalized)) return "container-runtime";
  if (/postfix|mail/.test(normalized)) return "mail";
  if (/nginx|apache|proxy/.test(normalized)) return "web-proxy";
  if (/postgres|mysql|database/.test(normalized)) return "database";
  if (/audit|security|edr/.test(normalized)) return "security-control";
  if (/backup/.test(normalized)) return "backup";
  if (/monitor|metric/.test(normalized)) return "monitoring";
  return "other-service";
}

function commandShape(command: CanonicalCommand, simulation: LinuxSimulationWorld) {
  const executable = command.executable.split("/").filter(Boolean).at(-1) || command.executable;
  const operations = new Set(["status", "start", "stop", "restart", "reload", "enable", "disable", "install", "remove", "run", "inspect", "policy"]);
  const operation = command.argv.slice(1).find((value) => operations.has(value)) || "none";
  // File names, account names, arbitrary failed command tokens and argument
  // values are not operations. In particular, a new path is not a new task.
  const serviceTargets = uniqueSorted((command.affectedServiceIds || []).map((id) =>
    semanticServiceClass(simulation.services.find((service) => service.id === id)?.unitName || "unknown")));
  const fileTargets = uniqueSorted(command.affectedFileIds.map((id) =>
    semanticFileClass(simulation.files.find((file) => file.id === id)?.path || "unknown")));
  return `${command.kind}:${executable}:${operation}:${command.runAsIdentityId ? "run-as" : "direct"}:services=${serviceTargets.join("+") || "none"}:files=${fileTargets.join("+") || "none"}`;
}

function identityRole(simulation: LinuxSimulationWorld, identity: CanonicalIdentity) {
  const investigation = simulation.investigation;
  if (identity.uid === 0 || identity.username === "root") return "root";
  if (identity.username === investigation.primaryUser) return "primary";
  if (investigation.serviceAccounts.includes(identity.username)) return "service";
  if (investigation.adminAccounts.includes(identity.username)) return "admin";
  if (investigation.secondaryUsers.includes(identity.username)) return "secondary";
  return identity.uid < 1000 ? "system" : "local";
}

function canonicalEvidenceClass(path: string) {
  const normalized = path.toLowerCase().replace(/\\/g, "/");
  const section = normalized.match(/^assets\/([^/]+)/)?.[1] || "other";
  const extension = normalized.match(/\.([a-z0-9]+)$/)?.[1] || "none";
  return `${section}:${extension}`;
}

export function buildLinuxStructuralFingerprint(simulation: LinuxSimulationWorld): LinuxStructuralFingerprint {
  const tasks = simulation.canonicalTasks.slice().sort((left, right) => left.order - right.order);
  const registry = new Map(simulation.planningEvidenceRegistry.map((asset) => [asset.id, asset]));
  const incidentCommands = simulation.commands
    .filter((command) => command.kind === "primary_incident" || command.kind === "secondary_incident")
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const incidentEvents = simulation.events
    .slice()
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const identityRows = simulation.identities
    .filter((identity) => identity.uid >= 1000)
    .map((identity) => ({ role: identityRole(simulation, identity), uid: identity.uid, gid: identity.gid }))
    .sort((left, right) => left.uid - right.uid);
  const processByPid = new Map(simulation.processes.map((process) => [process.pid, process]));
  const processDepth = (pid: number) => {
    const seen = new Set<number>();
    let depth = 0;
    let current = processByPid.get(pid);
    while (current && current.ppid > 1 && !seen.has(current.pid)) {
      seen.add(current.pid);
      depth += 1;
      current = processByPid.get(current.ppid);
    }
    return depth;
  };
  const taskReasoning = tasks.map((task) => [
    task.intent, task.expectedDeliverableType,
    uniqueSorted(task.requiredCapabilities).join("+"),
    uniqueSorted(task.requirements.map((requirement) => `${requirement.capability}:${requirement.relation || "none"}:${requirement.minimumSupport}`)).join("+"),
  ].join(":"));
  const taskGraph = taskReasoning.slice().sort().join(">");
  const evidenceAtoms = uniqueSorted(tasks.flatMap((task) => task.selectedEvidenceAssetIds.map((id) => {
    const asset = registry.get(id);
    return asset
      ? `${task.intent}:${canonicalEvidenceClass(asset.path)}:${asset.support || "static"}:${asset.capabilities.slice().sort().join("+")}`
      : `${task.intent}:missing`;
  })));
  const reasoningAtoms = uniqueSorted(tasks.flatMap((task) => task.requirements.map((requirement) =>
    `${linuxInvestigationStageForIntent(task.intent)}:${requirement.capability}:${requirement.relation || "none"}:${requirement.minimumSupport}`)));
  const commandShapes = incidentCommands.map((command) => commandShape(command, simulation));
  const chronologyAtoms = [
    `window:${Math.round(secondsBetween(simulation.collection.windowStart, simulation.collection.windowEnd) / 60)}`,
    ...incidentEvents.slice(1).map((event, index) => `event-edge:${incidentEvents[index].kind}>${event.kind}:${spacingBucket(secondsBetween(incidentEvents[index].timestamp, event.timestamp))}`),
    ...incidentCommands.slice(1).map((command, index) => `command-gap:${spacingBucket(secondsBetween(incidentCommands[index].timestamp, command.timestamp))}`),
  ];
  const roleCounts = identityRows.reduce<Record<string, number>>((counts, row) => {
    counts[row.role] = (counts[row.role] || 0) + 1;
    return counts;
  }, {});
  const noiseAtoms = uniqueSorted([
    `density:${simulation.backgroundProfile.activityDensity}`,
    `jobs:${simulation.cronDefinitions.filter((definition) => definition.purpose !== "incident").map((definition) => `${definition.purpose}:${scheduleShape(definition.schedule)}`).join(">")}`,
    `packages:${simulation.packageTransactions.filter((transaction) => transaction.source !== "manual").map((transaction) => `${transaction.source}:${transaction.action}`).join(">") || "none"}`,
    `services:${simulation.services.filter((service) => service.role === "background").map((service) => semanticServiceClass(service.unitName)).sort().join(",")}`,
  ]);

  const dimensions: Record<LinuxStructuralDimension, string[]> = {
    incidentConcept: uniqueSorted([
      `family:${simulation.investigation.incidentFamily}`,
      `service-class:${simulation.services.find((service) => service.role === "primary")?.unitType || "unknown"}`,
      `interactive:${simulation.sshSessions.some((session) => session.purpose === "incident")}`,
      `actors:${new Set(incidentCommands.map((command) => command.actorIdentityId)).size}`,
      `sessions:${simulation.sshSessions.filter((session) => session.purpose === "incident").length}`,
      `terminals:${new Set(incidentCommands.map((command) => command.tty).filter(Boolean)).size}`,
    ]),
    taskSequence: [`graph:${taskGraph}`, ...uniqueSorted(taskReasoning)],
    evidenceTopology: [`graph:${evidenceAtoms.join(">")}`, ...evidenceAtoms],
    chronology: [`graph:${chronologyAtoms.join(">")}`, ...chronologyAtoms],
    commandsProcesses: uniqueSorted([
      `graph:${commandShapes.map((shape, index) => `${shape}:depth=${processDepth(incidentCommands[index].processId)}`).join(">")}|controls=${simulation.identityTransitions.map((transition) => `${transition.kind}:${transition.outcome}`).sort().join(">")}`,
      ...commandShapes,
      `command-count:${incidentCommands.length}`,
      ...incidentCommands.map((command) => `process-depth:${processDepth(command.processId)}`),
      ...simulation.identityTransitions.map((transition) => `control:${transition.kind}:${transition.outcome}`),
    ]),
    identityHost: [
      `graph:${Object.entries(roleCounts).sort().map(([role, count]) => `${role}:${count}`).join(">")} shared-gids=${identityRows.length - new Set(identityRows.map((row) => row.gid)).size}`,
      ...uniqueSorted(identityRows.map((row) => row.role)),
      `shared-gids:${identityRows.length - new Set(identityRows.map((row) => row.gid)).size}`,
    ],
    noise: [`graph:${noiseAtoms.join(">")}`, ...noiseAtoms],
    reasoningPath: [`graph:${reasoningAtoms.join(">")}`, ...reasoningAtoms],
    // Style/profile labels are not evidence of a different learner experience.
    narrativeLanguage: [],
  };

  return {
    version: LINUX_STRUCTURAL_DIVERSITY_VERSION,
    dimensions,
    canonical: DIMENSIONS.map((dimension) => `${dimension}=${dimensions[dimension].join("|")}`).join("||"),
  };
}

function jaccard(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 1;
  let shared = 0;
  for (const value of leftSet) if (rightSet.has(value)) shared += 1;
  return shared / union.size;
}

function dimensionDistinctiveness(left: string[], right: string[]) {
  const setScore = (1 - jaccard(left, right)) * 10;
  const leftGraph = left.find((value) => value.startsWith("graph:"));
  const rightGraph = right.find((value) => value.startsWith("graph:"));
  // A graph signature is made only from learner-visible semantic nodes and
  // edges. Once that graph changes, shared mandatory nodes must not dilute the
  // structural difference back into a cosmetic-reskin score.
  if (leftGraph && rightGraph && leftGraph !== rightGraph) return 10;
  return setScore;
}

export function compareLinuxStructuralFingerprints(left: LinuxStructuralFingerprint, right: LinuxStructuralFingerprint) {
  const dimensionScores = Object.fromEntries(DIMENSIONS.map((dimension) => [
    dimension,
    Number(dimensionDistinctiveness(left.dimensions[dimension], right.dimensions[dimension]).toFixed(1)),
  ])) as Record<LinuxStructuralDimension, number>;
  const weights: Record<LinuxStructuralDimension, number> = {
    incidentConcept: 1, taskSequence: 2, evidenceTopology: 1, chronology: 0.5,
    commandsProcesses: 4, identityHost: 0.25, noise: 0.25, reasoningPath: 2, narrativeLanguage: 0,
  };
  let score = DIMENSIONS.reduce((total, dimension) => total + dimensionScores[dimension] * weights[dimension], 0) / 11;
  // Different chronology, background or role dressing cannot rescue the same
  // command exercise and answer path. Task/command reordering earns no credit.
  if (dimensionScores.commandsProcesses === 0 && dimensionScores.reasoningPath === 0) score = Math.min(score, 1.9);
  const overallDistinctiveness = Number(score.toFixed(1));
  return { dimensionScores, overallDistinctiveness };
}

export function validateLinuxStructuralDiversityBatch(
  simulations: LinuxSimulationWorld[],
  options: { minimumPairwiseDistinctiveness?: number; minimumAverageDistinctiveness?: number } = {}
): LinuxStructuralDiversityReport {
  const minimumPairwise = options.minimumPairwiseDistinctiveness ?? 4;
  const minimumAverage = options.minimumAverageDistinctiveness ?? 5.5;
  const fingerprints = simulations.map(buildLinuxStructuralFingerprint);
  const pairs: LinuxStructuralPair[] = [];
  for (let leftIndex = 0; leftIndex < fingerprints.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < fingerprints.length; rightIndex += 1) {
      const comparison = compareLinuxStructuralFingerprints(fingerprints[leftIndex], fingerprints[rightIndex]);
      pairs.push({ leftIndex, rightIndex, ...comparison });
    }
  }
  const minimumDistinctiveness = pairs.length ? Math.min(...pairs.map((pair) => pair.overallDistinctiveness)) : 10;
  const averageDistinctiveness = pairs.length
    ? Number((pairs.reduce((total, pair) => total + pair.overallDistinctiveness, 0) / pairs.length).toFixed(1))
    : 10;
  const issues: LinuxStructuralDiversityReport["issues"] = [];
  for (const pair of pairs.filter((item) => item.overallDistinctiveness < minimumPairwise)) {
    issues.push({
      code: "LINUX_STRUCTURAL_RESKIN",
      pair: [pair.leftIndex, pair.rightIndex],
      message: `Pair ${pair.leftIndex}/${pair.rightIndex} scored ${pair.overallDistinctiveness}/10; renamed values cannot substitute for structural variation.`,
    });
  }
  if (averageDistinctiveness < minimumAverage) {
    issues.push({
      code: "LINUX_STRUCTURAL_BATCH_REPETITION",
      message: `Batch average ${averageDistinctiveness}/10 is below ${minimumAverage}/10.`,
    });
  }
  return {
    version: LINUX_STRUCTURAL_DIVERSITY_VERSION,
    passed: issues.length === 0,
    fingerprints,
    pairs,
    minimumDistinctiveness,
    averageDistinctiveness,
    issues,
  };
}
