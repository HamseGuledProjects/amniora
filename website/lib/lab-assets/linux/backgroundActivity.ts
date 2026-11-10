import type { LabAsset } from "../types";
import type {
  CanonicalPackageTransaction,
  CanonicalScheduledExecution,
  CanonicalServiceTransition,
  CanonicalSshSession,
  LinuxSimulationWorld,
} from "./simulation";
import { scheduledExecutionRenderedPhase } from "./simulation";

export type LinuxBackgroundActivityType =
  | "authentication"
  | "scheduled_execution"
  | "service_transition"
  | "package_transaction"
  | "network_state"
  | "process_state";

export type LinuxBackgroundActivityCause =
  | "scheduled_maintenance"
  | "monitoring"
  | "backup"
  | "package_maintenance"
  | "human_administration"
  | "application_operation"
  | "ci_cd"
  | "security_control"
  | "log_rotation"
  | "certificate_renewal"
  | "database_operation"
  | "container_operation"
  | "network_management";

export type LinuxBackgroundActivity = {
  activityId: string;
  activityType: LinuxBackgroundActivityType;
  roleContext: string;
  departmentContext?: string;
  cause: LinuxBackgroundActivityCause;
  initiatingIdentityId?: string;
  serviceId?: string;
  scheduleId?: string;
  changeReference?: string;
  startedAt: string;
  endedAt?: string;
  processIds: string[];
  executionIds: string[];
  sessionIds: string[];
  fileAccessIds: string[];
  serviceTransitionIds: string[];
  networkConnectionIds: string[];
  packageTransactionIds: string[];
  expectedArtifacts: string[];
  relevance: "benign_context" | "plausible_distractor" | "operational_baseline";
  sourceActivityId: string;
};

export type LinuxNoiseQualityCode =
  | "LINUX_NOISE_ACTIVITY_UNGROUNDED"
  | "LINUX_NOISE_ROLE_MISMATCH"
  | "LINUX_NOISE_EVENT_RATE_EXCEEDED"
  | "LINUX_NOISE_AUTH_DENSITY_INVALID"
  | "LINUX_NOISE_SESSION_REPETITION_INVALID"
  | "LINUX_NOISE_PROCESS_COLLISION"
  | "LINUX_NOISE_CONNECTION_COLLISION"
  | "LINUX_NOISE_SCHEDULE_INCONSISTENT"
  | "LINUX_NOISE_TEMPLATE_REPETITION_EXCEEDED"
  | "LINUX_NOISE_UNIQUE_CAUSE_RATIO_LOW"
  | "LINUX_NOISE_SIGNAL_RATIO_INVALID"
  | "LINUX_NOISE_DISTRACTOR_TOO_SEVERE"
  | "LINUX_NOISE_SECONDARY_INCIDENT_CREATED"
  | "LINUX_NOISE_TEST_SENTINEL_LEAK";

export type LinuxNoiseQualityIssue = {
  code: LinuxNoiseQualityCode;
  severity: "medium" | "high" | "critical";
  message: string;
  artifact?: string;
  detail?: string;
};

export type LinuxAuthenticationNoiseMetrics = {
  acceptedAuthenticationLines: number;
  failedAuthenticationLines: number;
  sessionsPerAccount: Record<string, number>;
  sessionsPerSource: Record<string, number>;
  duplicateConnectionTuples: string[];
};

export type LinuxProcessNoiseMetrics = {
  duplicatePids: number[];
};

export type LinuxScheduleNoiseMetrics = {
  executionsPerSchedule: Record<string, number>;
  inconsistentExecutionIds: string[];
};

export type LinuxNetworkNoiseMetrics = {
  duplicateConnectionTuples: string[];
};

export type LinuxTemplateDiversityMetrics = {
  totalLines: number;
  uniqueTemplates: number;
  uniqueTemplateRatio: number;
  mostRepeatedTemplateCount: number;
  longestIdenticalTemplateRun: number;
};

export type LinuxTaskSignalQuality = {
  relevantEventCount: number;
  backgroundEventCount: number;
  relevantToNoiseRatio: number;
};

export type LinuxNoiseBudgetViolation = {
  code: LinuxNoiseQualityCode;
  metric: string;
  actual: number;
  limit: number;
};

export type LinuxNoiseQualityReport = {
  status: "valid" | "invalid";
  role: string;
  difficulty: string;
  investigationWindowMinutes: number;
  collectionWindowMinutes: number;
  activityCounts: Record<string, number>;
  artifactEventCounts: Record<string, number>;
  eventsPerMinute: Record<string, number>;
  authenticationMetrics: LinuxAuthenticationNoiseMetrics;
  processMetrics: LinuxProcessNoiseMetrics;
  scheduleMetrics: LinuxScheduleNoiseMetrics;
  networkMetrics: LinuxNetworkNoiseMetrics;
  templateDiversity: LinuxTemplateDiversityMetrics;
  signalQualityByTaskId: Record<string, LinuxTaskSignalQuality>;
  ungroundedActivityIds: string[];
  budgetViolations: LinuxNoiseBudgetViolation[];
  repetitionViolations: LinuxNoiseQualityIssue[];
  signalViolations: LinuxNoiseQualityIssue[];
  issues: LinuxNoiseQualityIssue[];
};

const PROHIBITED_FIXTURE_VOCABULARY = [
  "definitely-not-a-command",
  "not-a-command",
  "ghostuser",
  "fixture-only",
  "mutation-sentinel",
  "test-sentinel",
  "sentinel-leak",
];

const ROLE_CATALOG: Record<string, LinuxBackgroundActivityCause[]> = {
  platform: ["ci_cd", "monitoring", "log_rotation", "package_maintenance", "container_operation"],
  web: ["application_operation", "monitoring", "certificate_renewal", "log_rotation", "package_maintenance"],
  backup: ["backup", "monitoring", "log_rotation", "package_maintenance", "scheduled_maintenance"],
  container: ["container_operation", "monitoring", "log_rotation", "package_maintenance", "network_management"],
  dns: ["network_management", "monitoring", "log_rotation", "package_maintenance"],
  mail: ["application_operation", "monitoring", "log_rotation", "package_maintenance", "network_management"],
  access: ["human_administration", "security_control", "monitoring", "network_management", "log_rotation"],
  monitoring: ["monitoring", "security_control", "log_rotation", "package_maintenance"],
  database: ["database_operation", "backup", "monitoring", "log_rotation", "package_maintenance"],
  general: ["monitoring", "log_rotation", "package_maintenance", "human_administration"],
};

function roleKind(role: string) {
  const lower = role.toLowerCase();
  if (lower.includes("ci") || lower.includes("git")) return "platform";
  if (lower.includes("web") || lower.includes("application")) return "web";
  if (lower.includes("backup")) return "backup";
  if (lower.includes("docker") || lower.includes("container") || lower.includes("kubernetes")) return "container";
  if (lower.includes("dns")) return "dns";
  if (lower.includes("mail")) return "mail";
  if (lower.includes("proxy") || lower.includes("vpn") || lower.includes("ssh") || lower.includes("jump") || lower.includes("bastion")) return "access";
  if (lower.includes("monitoring")) return "monitoring";
  if (lower.includes("database")) return "database";
  return "general";
}

export function linuxRoleBackgroundActivityCatalogue(role: string) {
  return ROLE_CATALOG[roleKind(role)] || ROLE_CATALOG.general;
}

function activityBase(
  simulation: LinuxSimulationWorld,
  sourceActivityId: string,
  activityType: LinuxBackgroundActivityType,
  cause: LinuxBackgroundActivityCause,
  startedAt: string,
  expectedArtifacts: string[]
): LinuxBackgroundActivity {
  return {
    activityId: `background:${sourceActivityId}`,
    activityType,
    roleContext: simulation.investigation.hostRole,
    cause,
    startedAt,
    processIds: [],
    executionIds: [],
    sessionIds: [],
    fileAccessIds: [],
    serviceTransitionIds: [],
    networkConnectionIds: [],
    packageTransactionIds: [],
    expectedArtifacts,
    relevance: "operational_baseline",
    sourceActivityId,
  };
}

function scheduleCause(simulation: LinuxSimulationWorld, execution: CanonicalScheduledExecution): LinuxBackgroundActivityCause {
  const command = simulation.commands.find((item) => item.id === execution.commandId)?.renderedCommand || "";
  const role = roleKind(simulation.investigation.hostRole);
  if (/backup|restic|snapshot/i.test(command)) return "backup";
  if (/logrotate/i.test(command)) return "log_rotation";
  if (/certbot|certificate/i.test(command)) return "certificate_renewal";
  if (/apt|dpkg|unattended/i.test(command)) return "package_maintenance";
  if (/postgres|pg_|database|checkpoint/i.test(command)) return "database_operation";
  if (/docker|container|kube|crictl/i.test(command)) return "container_operation";
  if (/rndc|named|dns|proxy|vpn|route|ufw/i.test(command)) return "network_management";
  if (role === "platform") return "ci_cd";
  if (role === "web" || role === "mail") return "application_operation";
  return "monitoring";
}

function packageCause(transaction: CanonicalPackageTransaction): LinuxBackgroundActivityCause {
  return transaction.source === "manual" ? "scheduled_maintenance" : "package_maintenance";
}

function transitionCause(transition: CanonicalServiceTransition): LinuxBackgroundActivityCause {
  const cause = transition.cause.type;
  if (cause === "package") return "package_maintenance";
  if (cause === "timer") return "scheduled_maintenance";
  if (cause === "socket") return "network_management";
  return "monitoring";
}

export function buildLinuxBackgroundActivities(simulation: LinuxSimulationWorld): LinuxBackgroundActivity[] {
  const activities: LinuxBackgroundActivity[] = [];
  const allowed = linuxRoleBackgroundActivityCatalogue(simulation.investigation.hostRole);

  for (const session of simulation.sshSessions.filter((item) => item.purpose !== "incident")) {
    const activity = activityBase(simulation, session.id, "authentication", "human_administration", session.openedAt, [
      "assets/logs/auth.log",
      "assets/journal/journal_ssh.txt",
    ]);
    activity.endedAt = session.closedAt;
    activity.initiatingIdentityId = session.identityId;
    activity.processIds = [`process:sshd:${session.sessionPid}`];
    activity.sessionIds = [session.id];
    activity.relevance = session.purpose === "analyst" ? "plausible_distractor" : "benign_context";
    activities.push(activity);
  }

  for (const execution of simulation.scheduledExecutions) {
    const cause = scheduleCause(simulation, execution);
    const activity = activityBase(simulation, execution.id, "scheduled_execution", cause, execution.occurredAt, [
      "assets/logs/cron.log",
      "assets/logs/syslog",
      "assets/logs/audit.log",
      "assets/journal/journal_systemd.txt",
    ]);
    activity.scheduleId = execution.definitionId || execution.timerId;
    activity.processIds = [execution.processId];
    activity.executionIds = [execution.executionId || execution.commandId].filter(Boolean);
    activity.fileAccessIds = execution.affectedFileIds;
    activities.push(activity);
  }

  for (const transaction of simulation.packageTransactions) {
    const activity = activityBase(simulation, transaction.id, "package_transaction", packageCause(transaction), transaction.startedAt, [
      "assets/logs/apt_history.log",
      "assets/logs/audit.log",
      "assets/logs/syslog",
    ]);
    activity.endedAt = transaction.completedAt;
    activity.initiatingIdentityId = transaction.actorIdentityId;
    activity.processIds = transaction.processIds;
    activity.executionIds = transaction.executionIds || (transaction.commandId ? [transaction.commandId] : []);
    activity.fileAccessIds = transaction.affectedFileIds;
    activity.serviceTransitionIds = transaction.affectedServiceIds;
    activity.packageTransactionIds = [transaction.id];
    activity.changeReference = transaction.changeId;
    activities.push(activity);
  }

  for (const transition of simulation.serviceTransitions) {
    const activity = activityBase(simulation, transition.id, "service_transition", transitionCause(transition), transition.occurredAt, [
      "assets/logs/syslog",
      "assets/journal/journal_systemd.txt",
      "assets/logs/audit.log",
    ]);
    activity.serviceId = transition.serviceId;
    activity.serviceTransitionIds = [transition.id];
    activity.processIds = transition.processId ? [transition.processId] : [];
    activities.push(activity);
  }

  for (const descriptor of simulation.openFileDescriptors.filter((item) => item.targetKind === "socket")) {
    const activity = activityBase(simulation, descriptor.id, "network_state", "network_management", simulation.collection.collectedAt, [
      "assets/network/listening_ports.txt",
      "assets/network/ufw_status.txt",
    ]);
    activity.processIds = [descriptor.processId];
    activity.networkConnectionIds = [descriptor.id];
    activities.push(activity);
  }

  return activities.filter((activity) => allowed.includes(activity.cause) || activity.relevance === "plausible_distractor" || activity.cause === "scheduled_maintenance");
}

export function renderBackgroundAuthLines(simulation: LinuxSimulationWorld, hostname: string) {
  return simulation.sshSessions
    .filter((session) => session.purpose !== "incident")
    .flatMap((session) => [
      `${session.openedAt} ${hostname} sshd[${session.sessionPid}]: Accepted ${session.authenticationMethod} for ${session.username} from ${session.sourceIp} port ${session.sourcePort} ssh2${session.keyFingerprint ? ` fingerprint ${session.keyFingerprint}` : ""} activity_ref="background:${session.id}"`,
      `${session.openedAt} ${hostname} sshd[${session.sessionPid}]: pam_unix(sshd:session): session opened for user ${session.username}(uid=${session.uid}) activity_ref="background:${session.id}"`,
      `${session.closedAt || simulation.collection.collectedAt} ${hostname} sshd[${session.sessionPid}]: pam_unix(sshd:session): session closed for user ${session.username} activity_ref="background:${session.id}"`,
    ])
    .join("\n");
}

export function renderBackgroundJournalSshLines(simulation: LinuxSimulationWorld, hostname: string) {
  return simulation.sshSessions
    .filter((session) => session.purpose !== "incident")
    .map((session) => `${session.openedAt} ${hostname} sshd[${session.sessionPid}]: Accepted ${session.authenticationMethod} for ${session.username} from ${session.sourceIp} port ${session.sourcePort} ssh2 activity_ref="background:${session.id}"`)
    .join("\n");
}

export function renderBackgroundAuditLines(simulation: LinuxSimulationWorld) {
  return simulation.sshSessions
    .filter((session) => session.purpose !== "incident")
    .map((session, index) => `type=USER_ACCT msg=audit(${session.openedAt}): serial=${800 + index} activity_ref="background:${session.id}" pid=${session.sessionPid} uid=0 auid=${session.uid} acct="${session.username}" exe="/usr/sbin/sshd" hostname=${session.sourceIp} res=success`)
    .join("\n");
}

export function renderBackgroundSyslogLines(simulation: LinuxSimulationWorld, hostname: string) {
  const lines: string[] = [];
  for (const execution of simulation.scheduledExecutions) {
    const process = simulation.processes.find((item) => item.id === execution.processId);
    const command = simulation.commands.find((item) => item.id === execution.commandId);
    if (!process || !command) continue;
    const event = scheduledExecutionRenderedPhase(simulation, execution);
    const verb = event.phase === "ended_unconfirmed" ? "ended (outcome unconfirmed)" : event.phase;
    lines.push(`${event.timestamp} ${hostname} ${process.executable.split("/").pop() || "cron"}[${process.pid}]: ${verb} scheduled execution ${command.renderedCommand} activity_ref="background:${execution.id}"`);
  }
  for (const transaction of simulation.packageTransactions) {
    const pid = transaction.processIds
      .map((id) => simulation.processes.find((process) => process.id === id)?.pid)
      .find((value): value is number => typeof value === "number");
    lines.push(`${transaction.completedAt} ${hostname} apt[${pid || 1}]: ${transaction.action} transaction ${transaction.packages.map((item) => item.name).join(",")} completed activity_ref="background:${transaction.id}"`);
  }
  return lines.join("\n");
}

function minutesBetween(start: string, end: string) {
  const startDate = new Date(`${start.replace(" ", "T")}Z`);
  const endDate = new Date(`${end.replace(" ", "T")}Z`);
  const minutes = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
  return Number.isFinite(minutes) ? minutes : 1;
}

function artifactLineCount(asset: LabAsset) {
  return asset.content.split(/\r?\n/).filter((line) => line.trim()).length;
}

function normalizedTemplate(line: string) {
  return line
    .replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/g, "{TS}")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "{IP}")
    .replace(/\bpid=\d+\b/gi, "pid={PID}")
    .replace(/\[\d+\]/g, "[{PID}]")
    .replace(/\bport\s+\d+\b/gi, "port {PORT}")
    .replace(/\bserial=\d+\b/gi, "serial={SERIAL}")
    .replace(/\buid=\d+\b/gi, "uid={UID}")
    .replace(/\bauid=\d+\b/gi, "auid={UID}")
    .replace(/\b\d+\b/g, "{N}")
    .trim();
}

function templateDiversity(assets: LabAsset[]): LinuxTemplateDiversityMetrics {
  const templates: string[] = [];
  for (const asset of assets) {
    if (!/assets\/(?:logs|journal|network)\//.test(asset.file_path)) continue;
    asset.content.split(/\r?\n/).forEach((line) => {
      if (line.trim()) templates.push(normalizedTemplate(line));
    });
  }
  const counts = new Map<string, number>();
  let longestRun = 0;
  let currentRun = 0;
  let previous = "";
  for (const template of templates) {
    counts.set(template, (counts.get(template) || 0) + 1);
    currentRun = template === previous ? currentRun + 1 : 1;
    longestRun = Math.max(longestRun, currentRun);
    previous = template;
  }
  const uniqueTemplates = counts.size;
  const mostRepeatedTemplateCount = Math.max(0, ...counts.values());
  return {
    totalLines: templates.length,
    uniqueTemplates,
    uniqueTemplateRatio: templates.length ? uniqueTemplates / templates.length : 1,
    mostRepeatedTemplateCount,
    longestIdenticalTemplateRun: longestRun,
  };
}

function repeatedLegacyBundleCount(assets: LabAsset[]) {
  let count = 0;
  for (const asset of assets) {
    const lines = asset.content.split(/\r?\n/);
    for (let index = 0; index <= lines.length - 5; index += 1) {
      const window = lines.slice(index, index + 5).join("\n");
      if (/CRON\[/i.test(window) && /systemd\[/i.test(window) && /dbus-daemon\[/i.test(window) && /NetworkManager\[/i.test(window) && /apparmor/i.test(window)) {
        count += 1;
      }
    }
  }
  return count;
}

function authMetrics(assets: LabAsset[], simulation?: LinuxSimulationWorld): LinuxAuthenticationNoiseMetrics {
  const authContent = assets
    .filter((asset) => /(?:auth\.log|journal_ssh\.txt)$/i.test(asset.file_path))
    .map((asset) => asset.content)
    .join("\n");
  const sessionsPerAccount: Record<string, number> = {};
  const sessionsPerSource: Record<string, number> = {};
  const duplicateConnectionTuples = new Set<string>();
  const renderedTupleCounts = new Map<string, number>();
  const acceptedAuthenticationLines = (authContent.match(/\bAccepted\s+(?:publickey|password|keyboard-interactive)\b/gi) || []).length;
  const failedAuthenticationLines = (authContent.match(/\bFailed\s+(?:publickey|password|keyboard-interactive|password)\b/gi) || []).length;

  authContent.split(/\r?\n/).forEach((line) => {
    const match = line.match(/\bAccepted\s+\S+\s+for\s+([a-z0-9._-]+)\s+from\s+(\d{1,3}(?:\.\d{1,3}){3})\s+port\s+(\d+)/i);
    if (!match) return;
    const [, account, source, port] = match;
    const tuple = `${account}|${source}|${port}`;
    renderedTupleCounts.set(tuple, (renderedTupleCounts.get(tuple) || 0) + 1);
  });

  for (const tuple of renderedTupleCounts.keys()) {
    const [account = "", source = ""] = tuple.split("|");
    sessionsPerAccount[account] = (sessionsPerAccount[account] || 0) + 1;
    sessionsPerSource[source] = (sessionsPerSource[source] || 0) + 1;
  }
  for (const [tuple, count] of renderedTupleCounts.entries()) {
    if (count > 2) duplicateConnectionTuples.add(tuple);
  }
  const simulationTupleCounts = new Map<string, number>();
  for (const session of simulation?.sshSessions || []) {
    const tuple = `${session.username}|${session.sourceIp}|${session.sourcePort}`;
    const count = (renderedTupleCounts.get(tuple) || 0) + 1;
    renderedTupleCounts.set(tuple, count);
    if (count > 3) duplicateConnectionTuples.add(tuple);
    const canonicalTuple = `${session.sourceIp}:${session.sourcePort}->${session.destinationPort}`;
    simulationTupleCounts.set(canonicalTuple, (simulationTupleCounts.get(canonicalTuple) || 0) + 1);
  }
  for (const [tuple, count] of simulationTupleCounts.entries()) {
    if (count > 1) duplicateConnectionTuples.add(tuple);
  }

  return {
    acceptedAuthenticationLines,
    failedAuthenticationLines,
    sessionsPerAccount,
    sessionsPerSource,
    duplicateConnectionTuples: [...duplicateConnectionTuples],
  };
}

function duplicatePids(simulation?: LinuxSimulationWorld) {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const process of simulation?.processes || []) {
    if (seen.has(process.pid)) duplicates.add(process.pid);
    seen.add(process.pid);
  }
  return [...duplicates];
}

function networkMetrics(simulation?: LinuxSimulationWorld): LinuxNetworkNoiseMetrics {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const descriptor of simulation?.openFileDescriptors || []) {
    if (descriptor.descriptorType !== "connected_socket") continue;
    const localAddress = descriptor.localAddress || "";
    const remoteAddress = descriptor.remoteAddress || "";
    const tuple = `${descriptor.protocol || "tcp"}|${localAddress}|${descriptor.localPort || ""}|${remoteAddress}|${descriptor.remotePort || ""}`;
    if (seen.has(tuple)) duplicates.add(tuple);
    seen.add(tuple);
  }
  return { duplicateConnectionTuples: [...duplicates] };
}

function scheduleMetrics(simulation?: LinuxSimulationWorld): LinuxScheduleNoiseMetrics {
  const executionsPerSchedule: Record<string, number> = {};
  const inconsistentExecutionIds: string[] = [];
  for (const execution of simulation?.scheduledExecutions || []) {
    const scheduleId = execution.definitionId || execution.timerId || "unspecified";
    executionsPerSchedule[scheduleId] = (executionsPerSchedule[scheduleId] || 0) + 1;
    if (!execution.definitionId && !execution.timerId) inconsistentExecutionIds.push(execution.id);
  }
  return { executionsPerSchedule, inconsistentExecutionIds };
}

function issue(
  issues: LinuxNoiseQualityIssue[],
  code: LinuxNoiseQualityCode,
  severity: LinuxNoiseQualityIssue["severity"],
  message: string,
  artifact?: string,
  detail?: string
) {
  issues.push({ code, severity, message, artifact, detail });
}

function difficultyLimits(difficulty: string) {
  const lower = difficulty.toLowerCase();
  if (lower === "beginner") {
    return { authLinesPerMinute: 4, totalLinesPerMinute: 45, sessionsPerAccount: 4, repeatedTemplate: 18, uniqueTemplateRatio: 0.13 };
  }
  if (lower === "intermediate") {
    return { authLinesPerMinute: 8, totalLinesPerMinute: 80, sessionsPerAccount: 8, repeatedTemplate: 28, uniqueTemplateRatio: 0.1 };
  }
  return { authLinesPerMinute: 14, totalLinesPerMinute: 140, sessionsPerAccount: 12, repeatedTemplate: 44, uniqueTemplateRatio: 0.08 };
}

function taskSignalQuality(assets: LabAsset[], simulation?: LinuxSimulationWorld) {
  const result: Record<string, LinuxTaskSignalQuality> = {};
  for (const task of simulation?.canonicalTasks || []) {
    const evidenceCapabilities = new Set(task.requirements.map((requirement) => requirement.capability));
    const selectedAssetIds = new Set(task.selectedEvidenceAssetIds);
    const taskAssets = assets.filter((asset) =>
      selectedAssetIds.has(asset.file_path) ||
      [...evidenceCapabilities].some((capability) => asset.file_path.includes(capability) || asset.file_type.includes(capability))
    );
    const relevantNeedles = new Set([...task.primarySubjectIds, ...task.supportingSubjectIds, ...task.canonicalObjectIds].flatMap((subject) => [subject, subject.split(":").pop() || subject]));
    const content = (taskAssets.length ? taskAssets : assets).map((asset) => asset.content).join("\n");
    let relevant = 0;
    let background = 0;
    content.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      if ([...relevantNeedles].some((needle) => needle && line.includes(needle))) relevant += 1;
      else background += 1;
    });
    result[task.id] = {
      relevantEventCount: relevant,
      backgroundEventCount: background,
      relevantToNoiseRatio: background ? relevant / background : relevant,
    };
  }
  return result;
}

export function buildLinuxNoiseQualityReport(args: {
  simulation?: LinuxSimulationWorld;
  assets: LabAsset[];
  difficulty?: string;
  activities?: LinuxBackgroundActivity[];
}): LinuxNoiseQualityReport {
  const { simulation, assets } = args;
  const difficulty = args.difficulty || simulation?.difficultyDiagnostics?.difficulty || "Advanced";
  const role = simulation?.investigation.hostRole || "unknown";
  const activities = args.activities || (simulation ? buildLinuxBackgroundActivities(simulation) : []);
  const collectionWindowMinutes = simulation ? minutesBetween(simulation.collection.windowStart, simulation.collection.collectedAt) : 1;
  const investigationWindowMinutes = simulation ? minutesBetween(simulation.investigation.incidentWindowStart, simulation.investigation.incidentWindowEnd) : 1;
  const artifactEventCounts = Object.fromEntries(assets.map((asset) => [asset.file_path, artifactLineCount(asset)]));
  const activityCounts = activities.reduce<Record<string, number>>((counts, activity) => {
    counts[activity.cause] = (counts[activity.cause] || 0) + 1;
    return counts;
  }, {});
  const totalEvents = Object.values(artifactEventCounts).reduce((sum, value) => sum + value, 0);
  const auth = authMetrics(assets, simulation);
  const process = { duplicatePids: duplicatePids(simulation) };
  const schedule = scheduleMetrics(simulation);
  const network = networkMetrics(simulation);
  const diversity = templateDiversity(assets);
  const legacyBundleCount = repeatedLegacyBundleCount(assets);
  const signalQualityByTaskId = taskSignalQuality(assets, simulation);
  const issues: LinuxNoiseQualityIssue[] = [];
  const limits = difficultyLimits(difficulty);
  const budgetViolations: LinuxNoiseBudgetViolation[] = [];
  const repetitionViolations: LinuxNoiseQualityIssue[] = [];
  const signalViolations: LinuxNoiseQualityIssue[] = [];

  const authLinesPerMinute = auth.acceptedAuthenticationLines / Math.max(1, investigationWindowMinutes);
  const totalLinesPerMinute = totalEvents / Math.max(1, collectionWindowMinutes);
  if (authLinesPerMinute > limits.authLinesPerMinute && simulation?.investigation.incidentFamily !== "ssh_bruteforce") {
    budgetViolations.push({ code: "LINUX_NOISE_AUTH_DENSITY_INVALID", metric: "auth_lines_per_minute", actual: authLinesPerMinute, limit: limits.authLinesPerMinute });
    issue(issues, "LINUX_NOISE_AUTH_DENSITY_INVALID", "critical", "Authentication event density exceeds the role and difficulty budget.", "assets/logs/auth.log", `${authLinesPerMinute.toFixed(2)} > ${limits.authLinesPerMinute}`);
  }
  if (totalLinesPerMinute > limits.totalLinesPerMinute) {
    budgetViolations.push({ code: "LINUX_NOISE_EVENT_RATE_EXCEEDED", metric: "artifact_lines_per_minute", actual: totalLinesPerMinute, limit: limits.totalLinesPerMinute });
    issue(issues, "LINUX_NOISE_EVENT_RATE_EXCEEDED", "high", "Rendered evidence event rate exceeds the difficulty budget.", undefined, `${totalLinesPerMinute.toFixed(2)} > ${limits.totalLinesPerMinute}`);
  }
  for (const [account, count] of Object.entries(auth.sessionsPerAccount)) {
    if (count > limits.sessionsPerAccount && simulation?.investigation.incidentFamily !== "ssh_bruteforce") {
      issue(issues, "LINUX_NOISE_SESSION_REPETITION_INVALID", "critical", "Too many authentication sessions are attributed to one account.", "assets/logs/auth.log", `${account}=${count}`);
    }
  }
  if (auth.duplicateConnectionTuples.length > 0) {
    issue(issues, "LINUX_NOISE_CONNECTION_COLLISION", "critical", "Authentication evidence reuses an active connection tuple.", "assets/logs/auth.log", auth.duplicateConnectionTuples.join(","));
  }
  if (network.duplicateConnectionTuples.length > 0) {
    issue(issues, "LINUX_NOISE_CONNECTION_COLLISION", "critical", "Network state reuses a canonical socket tuple.", "assets/network/listening_ports.txt", network.duplicateConnectionTuples.join(","));
  }
  if (process.duplicatePids.length > 0) {
    issue(issues, "LINUX_NOISE_PROCESS_COLLISION", "critical", "Canonical process registry contains duplicate PIDs.", undefined, process.duplicatePids.join(","));
  }
  if (schedule.inconsistentExecutionIds.length > 0) {
    issue(issues, "LINUX_NOISE_SCHEDULE_INCONSISTENT", "critical", "Scheduled executions lack a canonical cron definition or timer.", "assets/logs/cron.log", schedule.inconsistentExecutionIds.join(","));
  }
  if (diversity.mostRepeatedTemplateCount > limits.repeatedTemplate || diversity.longestIdenticalTemplateRun > Math.max(8, Math.floor(limits.repeatedTemplate / 2))) {
    const violation = { code: "LINUX_NOISE_TEMPLATE_REPETITION_EXCEEDED" as const, severity: "high" as const, message: "Repeated normalized log templates exceed the noise diversity budget.", detail: `count=${diversity.mostRepeatedTemplateCount}; run=${diversity.longestIdenticalTemplateRun}` };
    repetitionViolations.push(violation);
    issues.push(violation);
  }
  if (legacyBundleCount >= 3) {
    const violation = { code: "LINUX_NOISE_TEMPLATE_REPETITION_EXCEEDED" as const, severity: "high" as const, message: "Repeated legacy CRON/systemd/dbus/NetworkManager/AppArmor bundles exceed the causal-noise budget.", detail: `bundles=${legacyBundleCount}` };
    repetitionViolations.push(violation);
    issues.push(violation);
  }
  if (diversity.totalLines > 40 && diversity.uniqueTemplateRatio < limits.uniqueTemplateRatio) {
    const violation = { code: "LINUX_NOISE_UNIQUE_CAUSE_RATIO_LOW" as const, severity: "high" as const, message: "Rendered background evidence has too few unique normalized causes.", detail: diversity.uniqueTemplateRatio.toFixed(3) };
    repetitionViolations.push(violation);
    issues.push(violation);
  }

  const allowedCauses = linuxRoleBackgroundActivityCatalogue(role);
  const ungroundedActivityIds = activities.filter((activity) => (
    activity.processIds.length +
    activity.executionIds.length +
    activity.sessionIds.length +
    activity.fileAccessIds.length +
    activity.serviceTransitionIds.length +
    activity.networkConnectionIds.length +
    activity.packageTransactionIds.length
  ) === 0).map((activity) => activity.activityId);
  if (ungroundedActivityIds.length > 0) {
    issue(issues, "LINUX_NOISE_ACTIVITY_UNGROUNDED", "critical", "Background activity has no canonical identity, process, schedule, service, file, network, or package reference.", undefined, ungroundedActivityIds.join(","));
  }
  const roleMismatches = activities.filter((activity) => !allowedCauses.includes(activity.cause) && activity.relevance !== "plausible_distractor" && activity.cause !== "scheduled_maintenance");
  if (roleMismatches.length > 0) {
    issue(issues, "LINUX_NOISE_ROLE_MISMATCH", "high", "Background activity cause is not plausible for the canonical host role.", undefined, roleMismatches.map((activity) => `${activity.activityId}:${activity.cause}`).join(","));
  }

  for (const [taskId, signal] of Object.entries(signalQualityByTaskId)) {
    const tooMuchNoise = difficulty.toLowerCase() === "beginner" ? signal.backgroundEventCount > 900 : difficulty.toLowerCase() === "intermediate" ? signal.backgroundEventCount > 1800 : signal.backgroundEventCount > 3200;
    if (tooMuchNoise && signal.relevantEventCount < 2) {
      const violation = { code: "LINUX_NOISE_SIGNAL_RATIO_INVALID" as const, severity: "high" as const, message: "Task-local evidence is buried in unrelated rendered volume.", detail: `${taskId}: relevant=${signal.relevantEventCount}; background=${signal.backgroundEventCount}` };
      signalViolations.push(violation);
      issues.push(violation);
    }
  }

  for (const asset of assets) {
    const lower = asset.content.toLowerCase();
    for (const token of PROHIBITED_FIXTURE_VOCABULARY) {
      if (lower.includes(token)) {
        issue(issues, "LINUX_NOISE_TEST_SENTINEL_LEAK", "critical", "Rendered Linux evidence contains prohibited fixture vocabulary.", asset.file_path, token);
      }
    }
    if (/\b(?:critical|confirmed)\s+(?:compromise|exfiltration|malware|rootkit)\b/i.test(asset.content) && !/incident|timeline|brief|risk/i.test(asset.file_path)) {
      issue(issues, "LINUX_NOISE_SECONDARY_INCIDENT_CREATED", "high", "Background evidence appears to create an unresolved second severe incident.", asset.file_path);
    }
  }

  return {
    status: issues.some((item) => item.severity === "critical" || item.severity === "high") ? "invalid" : "valid",
    role,
    difficulty,
    investigationWindowMinutes,
    collectionWindowMinutes,
    activityCounts,
    artifactEventCounts,
    eventsPerMinute: {
      all_artifacts: totalLinesPerMinute,
      authentication: authLinesPerMinute,
    },
    authenticationMetrics: auth,
    processMetrics: process,
    scheduleMetrics: schedule,
    networkMetrics: network,
    templateDiversity: diversity,
    signalQualityByTaskId,
    ungroundedActivityIds,
    budgetViolations,
    repetitionViolations,
    signalViolations,
    issues,
  };
}
