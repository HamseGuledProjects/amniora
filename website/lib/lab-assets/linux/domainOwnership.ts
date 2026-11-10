import type { LabAsset } from "../types";
import type { LinuxSimulationWorld } from "./simulation";

export type LinuxDomainKey =
  | "identities"
  | "groups"
  | "sshSessions"
  | "executions"
  | "commands"
  | "processes"
  | "files"
  | "permissions"
  | "services"
  | "serviceTransitions"
  | "cronDefinitions"
  | "scheduledExecutions"
  | "packages"
  | "maintenanceWindows"
  | "evidenceRegistry"
  | "tasks"
  | "riskRows"
  | "documents"
  | "networkSessions";

export type LinuxDomainOwnership = {
  ownershipStatus: "canonical" | "derived" | "mixed" | "legacy";
  declaredCanonicalOwner: string;
  derivedRepresentations: string[];
  declaredRendererConsumers: string[];
  declaredValidatorConsumers: string[];
  notes?: string;
  documentedMigrationCandidate?: string;
};

export type RenderedCanonicalIdRule = {
  prefix: string;
  minimumSegments: number;
  allowedCharacters: string;
  exampleValidId: string;
  renderedScanningSupported: boolean;
  pattern: RegExp;
};

export const LINUX_DOMAIN_OWNERSHIP: Record<LinuxDomainKey, LinuxDomainOwnership> = {
  identities: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.identities",
    derivedRepresentations: ["Investigation primary/service/analyst user fields", "passwd.sample", "users.csv", "auth/sudo/audit process usernames"],
    declaredRendererConsumers: ["users.ts", "authLog.ts", "sudoLog.ts", "syslog.ts", "reports.ts", "advancedArtifacts.ts", "evidence.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxLearnerPackGrounding", "validateLinuxProductionClosure", "validateLinuxSemanticClosure", "checkLinuxInvestigationQuality"],
    notes: "World and investigation choose seed identities, but renderer-facing identity facts should be read from the simulation once it exists.",
  },
  groups: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.groups",
    derivedRepresentations: ["group.sample", "groups.csv", "sudoers group specs", "file group ownership"],
    declaredRendererConsumers: ["users.ts", "configs.ts", "advancedArtifacts.ts", "reports.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "validateLinuxSemanticClosure", "checkLinuxInvestigationQuality"],
  },
  sshSessions: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.sshSessions",
    derivedRepresentations: ["auth.log", "journal_ssh.txt", "process_snapshot.txt", "users.csv last_login", "UFW source rules"],
    declaredRendererConsumers: ["authLog.ts", "advancedArtifacts.ts", "noise.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "validateLinuxSemanticClosure"],
  },
  executions: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.executions",
    derivedRepresentations: ["commands", "processes", "cron executions", "service transitions", "package transactions"],
    declaredRendererConsumers: ["simulation.ts"],
    declaredValidatorConsumers: ["validateCanonicalExecutionLifecycle", "validateLinuxSimulationEvidence", "checkLinuxInvestigationQuality"],
    notes: "Internal source of execution lifecycle context; not exposed as learner-facing evidence.",
  },
  commands: {
    ownershipStatus: "mixed",
    declaredCanonicalOwner: "LinuxSimulationWorld.commands",
    derivedRepresentations: ["sudo.log", "audit.log", "syslog", "timeline.csv", "process_snapshot.txt", "open_files.txt", "sudoers"],
    declaredRendererConsumers: ["authLog.ts", "sudoLog.ts", "syslog.ts", "configs.ts", "advancedArtifacts.ts", "simulation.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "validateLinuxSemanticClosure", "checkLinuxInvestigationQuality"],
    notes: "Investigation.suspiciousCommands remains an incident input; canonical rendered command identity is simulation.commands.",
  },
  processes: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.processes",
    derivedRepresentations: ["process_snapshot.txt", "open_files.txt", "audit PID/PPID fields", "service main PID"],
    declaredRendererConsumers: ["advancedArtifacts.ts", "simulation.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "validateLinuxSemanticClosure", "checkLinuxInvestigationQuality"],
  },
  files: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.files",
    derivedRepresentations: ["permissions_report.txt", "open_files.txt", "audit PATH records", "risk/document file mentions"],
    declaredRendererConsumers: ["reports.ts", "advancedArtifacts.ts", "simulation.ts", "evidence.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxLearnerPackGrounding", "validateLinuxProductionClosure", "validateLinuxSemanticClosure"],
  },
  permissions: {
    ownershipStatus: "derived",
    declaredCanonicalOwner: "LinuxSimulationWorld.files owner/group/mode fields",
    derivedRepresentations: ["permissions_report.txt", "audit PATH mode fields", "file-permission tasks"],
    declaredRendererConsumers: ["reports.ts", "advancedArtifacts.ts", "simulation.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "checkLinuxInvestigationQuality"],
  },
  services: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.services",
    derivedRepresentations: ["service_inventory.txt", "journal_systemd.txt", "syslog", "systemd unit files", "tasks"],
    declaredRendererConsumers: ["advancedArtifacts.ts", "reports.ts", "syslog.ts", "simulation.ts", "evidence.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "validateLinuxSemanticClosure", "checkLinuxInvestigationQuality"],
  },
  serviceTransitions: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.serviceTransitions",
    derivedRepresentations: ["journal_systemd.txt", "syslog", "audit.log", "timeline.csv", "service_inventory.txt"],
    declaredRendererConsumers: ["advancedArtifacts.ts", "syslog.ts", "simulation.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "checkLinuxInvestigationQuality"],
  },
  cronDefinitions: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.cronDefinitions",
    derivedRepresentations: ["cron.log", "cron.d assets", "root crontab assets", "timeline.csv"],
    declaredRendererConsumers: ["advancedArtifacts.ts", "simulation.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "validateLinuxSemanticClosure"],
  },
  scheduledExecutions: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.scheduledExecutions",
    derivedRepresentations: ["cron.log", "syslog", "process_snapshot/open_files historical rows", "timeline.csv"],
    declaredRendererConsumers: ["advancedArtifacts.ts", "syslog.ts", "simulation.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "validateLinuxSemanticClosure"],
  },
  packages: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.packageTransactions",
    derivedRepresentations: ["apt_history.log", "package_inventory.txt", "journal_systemd.txt", "timeline.csv"],
    declaredRendererConsumers: ["advancedArtifacts.ts", "simulation.ts", "evidence.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxLearnerPackGrounding", "validateLinuxProductionClosure", "validateLinuxSemanticClosure"],
  },
  maintenanceWindows: {
    ownershipStatus: "mixed",
    declaredCanonicalOwner: "LinuxSimulationWorld.maintenanceActivities",
    derivedRepresentations: ["Investigation window/change fields", "change_request.md", "maintenance_ticket.md", "timeline.csv"],
    declaredRendererConsumers: ["evidence.ts", "advancedArtifacts.ts", "simulation.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "checkLinuxFinalProductionQuality"],
    documentedMigrationCandidate: "Remaining investigation-window prose helpers still mirror maintenanceActivities.",
  },
  evidenceRegistry: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.evidenceRegistry from buildCanonicalEvidenceRegistry",
    derivedRepresentations: ["learner-facing asset list", "task selected evidence", "narrative brief"],
    declaredRendererConsumers: ["simulation.ts", "evidence.ts", "advancedArtifacts.ts"],
    declaredValidatorConsumers: ["validateLinuxLearnerPackGrounding", "validateLinuxProductionClosure", "checkLinuxFinalProductionQuality"],
  },
  tasks: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.canonicalTasks and taskFeasibilityProofs",
    derivedRepresentations: ["AI narrative task plan", "final quality task evidence checks"],
    declaredRendererConsumers: ["simulation.ts", "generate-lab route"],
    declaredValidatorConsumers: ["proveTaskRequirements", "validateLinuxLearnerPackGrounding", "validateLinuxProductionClosure", "checkLinuxFinalProductionQuality"],
  },
  riskRows: {
    ownershipStatus: "derived",
    declaredCanonicalOwner: "Derived risk-register rows; no first-class CanonicalRiskClaim object exists.",
    derivedRepresentations: ["risk_register.csv", "advanced_risk_register.csv", "risk tasks"],
    declaredRendererConsumers: ["evidence.ts", "advancedArtifacts.ts"],
    declaredValidatorConsumers: ["validateLinuxProductionClosure", "validateLinuxSemanticClosure", "checkLinuxInvestigationQuality"],
    notes: "Supporting inputs come from document facts, incident subjects, evidence capabilities, and renderer logic.",
    documentedMigrationCandidate: "Introduce a first-class CanonicalRiskClaim model before treating risk rows as canonical.",
  },
  documents: {
    ownershipStatus: "canonical",
    declaredCanonicalOwner: "LinuxSimulationWorld.documents and documentFacts",
    derivedRepresentations: ["incident_brief.md", "change_request.md", "maintenance_ticket.md", "audit_notes.md", "analyst docs"],
    declaredRendererConsumers: ["evidence.ts", "advancedArtifacts.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxLearnerPackGrounding", "validateLinuxProductionClosure", "checkLinuxFinalProductionQuality"],
  },
  networkSessions: {
    ownershipStatus: "mixed",
    declaredCanonicalOwner: "LinuxSimulationWorld.sshSessions for SSH; commands/processes for non-SSH network activity",
    derivedRepresentations: ["auth.log source IPs", "journal_ssh.txt", "ufw_status.txt", "listening_ports.txt", "netstat/ss evidence"],
    declaredRendererConsumers: ["authLog.ts", "advancedArtifacts.ts", "reports.ts"],
    declaredValidatorConsumers: ["validateLinuxSimulationEvidence", "validateLinuxProductionClosure", "validateLinuxSemanticClosure", "checkLinuxInvestigationQuality"],
    documentedMigrationCandidate: "Non-SSH outbound connections are still derived from command/process evidence instead of a dedicated network-session object.",
  },
};

const CANONICAL_SEGMENT = "[A-Za-z0-9._-]+";
const CANONICAL_ID_END = "(?!:)";

function renderedCanonicalIdPattern(prefix: string, minimumSegments: number) {
  const requiredSegments = Array.from({ length: minimumSegments }, () => `:${CANONICAL_SEGMENT}`).join("");
  return new RegExp(`\\b${prefix}${requiredSegments}(?::${CANONICAL_SEGMENT})*${CANONICAL_ID_END}`, "g");
}

export const RENDERED_CANONICAL_ID_RULES: RenderedCanonicalIdRule[] = [
  { prefix: "identity", minimumSegments: 1, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "identity:root", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("identity", 1) },
  { prefix: "group", minimumSegments: 1, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "group:sudo", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("group", 1) },
  { prefix: "session", minimumSegments: 2, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "session:ssh:incident-primary", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("session", 2) },
  { prefix: "command", minimumSegments: 2, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "command:incident:primary", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("command", 2) },
  { prefix: "process", minimumSegments: 1, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "process:sshd-session", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("process", 1) },
  { prefix: "descriptor", minimumSegments: 2, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "descriptor:sshd:listen:22", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("descriptor", 2) },
  { prefix: "file", minimumSegments: 1, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "file:incident-target", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("file", 1) },
  { prefix: "service", minimumSegments: 1, allowedCharacters: "A-Z a-z 0-9 . _ - with .service suffix", exampleValidId: "service:ssh.service", renderedScanningSupported: true, pattern: new RegExp(`\\bservice:${CANONICAL_SEGMENT}\\.service${CANONICAL_ID_END}`, "g") },
  { prefix: "event", minimumSegments: 2, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "event:ssh:incident-primary:open", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("event", 2) },
  { prefix: "transition", minimumSegments: 2, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "transition:ssh.service:reload:1", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("transition", 2) },
  { prefix: "timer", minimumSegments: 1, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "timer:apt-daily", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("timer", 1) },
  { prefix: "cron", minimumSegments: 1, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "cron:access", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("cron", 1) },
  { prefix: "scheduled", minimumSegments: 2, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "scheduled:access:1", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("scheduled", 2) },
  { prefix: "package", minimumSegments: 2, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "package:openssl:manual", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("package", 2) },
  { prefix: "maintenance", minimumSegments: 1, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "maintenance:approved", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("maintenance", 1) },
  { prefix: "document", minimumSegments: 1, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "document:incident_brief", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("document", 1) },
  { prefix: "fact", minimumSegments: 1, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "fact:host_identity", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("fact", 1) },
  { prefix: "task", minimumSegments: 2, allowedCharacters: "A-Z a-z 0-9 . _ -", exampleValidId: "task:1:scope_timeline", renderedScanningSupported: true, pattern: renderedCanonicalIdPattern("task", 2) },
  { prefix: "execution", minimumSegments: 1, allowedCharacters: "Unsupported alias; generated simulations use scheduled:* IDs.", exampleValidId: "execution:unsupported", renderedScanningSupported: false, pattern: /\bexecution:unsupported\b/g },
];

export function shouldRunLinuxEngineAssertions() {
  return process.env.CYBERLAB_LINUX_ENGINE_ASSERTIONS === "1" ||
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test";
}

function canonicalIds(simulation: LinuxSimulationWorld) {
  return new Set<string>([
    ...simulation.identities.map((item) => item.id),
    ...simulation.groups.map((item) => item.id),
    ...simulation.sshSessions.map((item) => item.id),
    ...(simulation.executions || []).map((item) => item.id),
    ...simulation.commands.map((item) => item.id),
    ...simulation.processes.map((item) => item.id),
    ...(simulation.openFileDescriptors || []).map((item) => item.id),
    ...simulation.files.map((item) => item.id),
    ...simulation.events.map((item) => item.id),
    ...simulation.services.map((item) => item.id),
    ...simulation.serviceTransitions.map((item) => item.id),
    ...simulation.timers.map((item) => item.id),
    ...simulation.cronDefinitions.map((item) => item.id),
    ...simulation.scheduledExecutions.map((item) => item.id),
    ...simulation.packageTransactions.map((item) => item.id),
    ...simulation.maintenanceActivities.map((item) => item.id),
    ...simulation.evidenceRegistry.map((item) => item.id),
    ...simulation.documentFacts.map((item) => item.id),
    ...simulation.documents.map((item) => item.id),
    ...simulation.canonicalTasks.map((item) => item.id),
  ]);
}

function assertKnownId(issues: string[], ids: Set<string>, id: string, label: string) {
  if (!ids.has(id)) issues.push(`${label} references non-canonical id ${id}`);
}

function strictCanonicalIdPattern() {
  const supported = RENDERED_CANONICAL_ID_RULES.filter((rule) => rule.renderedScanningSupported).map((rule) => rule.pattern.source);
  return new RegExp(supported.join("|"), "g");
}

function isStrictCanonicalId(value: string) {
  const matches = value.match(strictCanonicalIdPattern()) || [];
  return matches.length === 1 && matches[0] === value;
}

function scanRenderedCanonicalIds(assets: LabAsset[], ids: Set<string>) {
  const issues: string[] = [];
  for (const asset of assets) {
    const text = `${asset.file_path}\n${asset.content}`;
    for (const rule of RENDERED_CANONICAL_ID_RULES.filter((item) => item.renderedScanningSupported)) {
      const pattern = new RegExp(rule.pattern.source, "g");
      const matches = text.match(pattern) || [];
      for (const match of matches) {
        if (!ids.has(match)) issues.push(`${asset.file_path} renders unknown canonical id ${match}`);
      }
    }
  }
  return issues;
}

function serializationMarkerIssues(asset: LabAsset) {
  const issues: string[] = [];
  const lines = asset.content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const excerpt = line.trim().slice(0, 120);
    if (/Invalid Date/.test(line)) {
      issues.push(`${asset.file_path}:${lineNumber} Rendered asset contains Invalid Date serialization marker: ${excerpt}`);
    }
    if (/\[object Object\]/.test(line)) {
      issues.push(`${asset.file_path}:${lineNumber} Rendered asset contains [object Object] serialization marker: ${excerpt}`);
    }
    if (/(?:timestamp|time|date|pid|ppid|uid|gid|port|inode|size|mode|exit(?:_code)?)[\w -]*(?:=|:|,)\s*NaN\b/i.test(line)) {
      issues.push(`${asset.file_path}:${lineNumber} Rendered numeric or timestamp field contains NaN: ${excerpt}`);
    }
    if (/(?:id|user|group|service|host|ip|timestamp|time|date|command|file|path)[\w -]*(?:=|:|,)\s*undefined\b/i.test(line)) {
      issues.push(`${asset.file_path}:${lineNumber} Rendered required field contains undefined serialization marker: ${excerpt}`);
    }
  });
  return issues;
}

export function assertLinuxEngineBoundaries(args: {
  simulation: LinuxSimulationWorld;
  assets?: LabAsset[];
}) {
  if (!shouldRunLinuxEngineAssertions()) return;
  const { simulation, assets = [] } = args;
  const issues: string[] = [];
  const ids = canonicalIds(simulation);
  const processesByPid = new Map(simulation.processes.map((process) => [process.pid, process]));

  for (const domain of Object.keys(LINUX_DOMAIN_OWNERSHIP) as LinuxDomainKey[]) {
    if (!LINUX_DOMAIN_OWNERSHIP[domain].declaredCanonicalOwner) issues.push(`${domain} has no declared canonical owner`);
  }

  for (const session of simulation.sshSessions) {
    assertKnownId(issues, ids, session.identityId, `${session.id}.identityId`);
    if (!simulation.identities.some((identity) => identity.id === session.identityId && identity.username === session.username)) {
      issues.push(`${session.id} duplicates username outside its canonical identity`);
    }
  }

  for (const command of simulation.commands) {
    if (command.executionId) assertKnownId(issues, ids, command.executionId, `${command.id}.executionId`);
    assertKnownId(issues, ids, command.actorIdentityId, `${command.id}.actorIdentityId`);
    if (command.runAsIdentityId) assertKnownId(issues, ids, command.runAsIdentityId, `${command.id}.runAsIdentityId`);
    if (command.sessionId) assertKnownId(issues, ids, command.sessionId, `${command.id}.sessionId`);
    if (!processesByPid.has(command.processId)) issues.push(`${command.id}.processId references non-canonical PID ${command.processId}`);
    if (command.sudoProcessId && !processesByPid.has(command.sudoProcessId)) issues.push(`${command.id}.sudoProcessId references non-canonical PID ${command.sudoProcessId}`);
    if (command.shellProcessId && !processesByPid.has(command.shellProcessId)) issues.push(`${command.id}.shellProcessId references non-canonical PID ${command.shellProcessId}`);
    for (const fileId of command.affectedFileIds) assertKnownId(issues, ids, fileId, `${command.id}.affectedFileIds`);
    for (const serviceId of command.affectedServiceIds || []) assertKnownId(issues, ids, serviceId, `${command.id}.affectedServiceIds`);
  }

  for (const process of simulation.processes) {
    if (process.executionId) assertKnownId(issues, ids, process.executionId, `${process.id}.executionId`);
    assertKnownId(issues, ids, process.identityId, `${process.id}.identityId`);
    if (process.ppid !== 0 && process.ppid !== 1 && !processesByPid.has(process.ppid)) issues.push(`${process.id}.ppid references non-canonical parent PID ${process.ppid}`);
    if (process.sessionId) assertKnownId(issues, ids, process.sessionId, `${process.id}.sessionId`);
    if (process.commandId) assertKnownId(issues, ids, process.commandId, `${process.id}.commandId`);
    for (const fileId of process.openFileIds) assertKnownId(issues, ids, fileId, `${process.id}.openFileIds`);
  }

  for (const file of simulation.files) {
    assertKnownId(issues, ids, file.ownerIdentityId, `${file.id}.ownerIdentityId`);
    assertKnownId(issues, ids, file.groupId, `${file.id}.groupId`);
    for (const commandId of file.relatedCommandIds) assertKnownId(issues, ids, commandId, `${file.id}.relatedCommandIds`);
  }

  for (const execution of simulation.scheduledExecutions) {
    if (execution.executionId) assertKnownId(issues, ids, execution.executionId, `${execution.id}.executionId`);
    if (execution.definitionId) assertKnownId(issues, ids, execution.definitionId, `${execution.id}.definitionId`);
    if (execution.timerId) assertKnownId(issues, ids, execution.timerId, `${execution.id}.timerId`);
    assertKnownId(issues, ids, execution.commandId, `${execution.id}.commandId`);
    assertKnownId(issues, ids, execution.processId, `${execution.id}.processId`);
  }

  for (const transition of simulation.serviceTransitions) {
    if (transition.executionId) assertKnownId(issues, ids, transition.executionId, `${transition.id}.executionId`);
    assertKnownId(issues, ids, transition.serviceId, `${transition.id}.serviceId`);
  }

  for (const task of simulation.canonicalTasks) {
    for (const id of [...task.canonicalObjectIds, ...task.primarySubjectIds, ...task.supportingSubjectIds]) {
      if (isStrictCanonicalId(id)) assertKnownId(issues, ids, id, `${task.id}.canonicalSubjectIds`);
    }
  }

  issues.push(...scanRenderedCanonicalIds(assets, ids));
  for (const asset of assets) issues.push(...serializationMarkerIssues(asset));

  if (issues.length > 0) {
    throw new Error(`Linux engine boundary assertion failed: ${issues.slice(0, 8).join("; ")}`);
  }
}

export function buildLinuxEngineHealthReport(simulation?: LinuxSimulationWorld) {
  const domains = Object.entries(LINUX_DOMAIN_OWNERSHIP).map(([domain, ownership]) => ({
    domain,
    ...ownership,
  }));
  const documentedOwnershipConcerns = domains
    .filter((domain) => domain.notes || domain.documentedMigrationCandidate || domain.ownershipStatus !== "canonical")
    .map((domain) => ({
      domain: domain.domain,
      ownershipStatus: domain.ownershipStatus,
      note: domain.documentedMigrationCandidate || domain.notes,
    }));
  const ownershipStatusCounts = domains.reduce<Record<LinuxDomainOwnership["ownershipStatus"], number>>((counts, domain) => {
    counts[domain.ownershipStatus] += 1;
    return counts;
  }, { canonical: 0, derived: 0, mixed: 0, legacy: 0 });
  return {
    metadataMode: "declared" as const,
    metadataLimitations: [
      "Domain ownership, renderer consumers, and validator consumers are manually maintained declarations.",
      "This report does not perform import analysis, AST discovery, or renderer fact extraction.",
    ],
    scannerGrammarVersion: 2,
    declaredDomains: domains,
    totals: {
      declaredDomainCount: domains.length,
      declaredRendererConsumerCount: new Set(domains.flatMap((domain) => domain.declaredRendererConsumers)).size,
      declaredValidatorConsumerCount: new Set(domains.flatMap((domain) => domain.declaredValidatorConsumers)).size,
      ownershipStatusCounts,
      canonicalObjects: simulation
        ? {
            identities: simulation.identities.length,
            groups: simulation.groups.length,
            sshSessions: simulation.sshSessions.length,
            commands: simulation.commands.length,
            processes: simulation.processes.length,
            files: simulation.files.length,
            services: simulation.services.length,
            serviceTransitions: simulation.serviceTransitions.length,
            cronDefinitions: simulation.cronDefinitions.length,
            scheduledExecutions: simulation.scheduledExecutions.length,
            packages: simulation.packageTransactions.length,
            maintenanceActivities: simulation.maintenanceActivities.length,
            evidenceAssets: simulation.evidenceRegistry.length,
            documents: simulation.documents.length,
            tasks: simulation.canonicalTasks.length,
          }
        : undefined,
    },
    assertionCapabilities: [
      "Canonical object references inside LinuxSimulationWorld resolve for selected relation fields.",
      "Explicit rendered canonical IDs using the strict generated ID grammar resolve.",
      "Selected invalid serialization markers are rejected in rendered assets.",
    ],
    assertionLimitations: [
      "Assertions do not parse arbitrary prose for invented usernames, services, IPs, tickets, or change IDs.",
      "Assertions do not verify declared renderer/validator consumers against source imports.",
      "The canonical-ID scanner intentionally ignores generic colon prose and unsupported prefixes.",
    ],
    assertionIntegrationMode: "index.ts post-render pre-validation hook gated by shouldRunLinuxEngineAssertions",
    supportedRenderedCanonicalPrefixes: RENDERED_CANONICAL_ID_RULES.filter((rule) => rule.renderedScanningSupported).map((rule) => rule.prefix),
    unsupportedRenderedCanonicalPrefixes: RENDERED_CANONICAL_ID_RULES.filter((rule) => !rule.renderedScanningSupported).map((rule) => rule.prefix),
    renderedCanonicalIdGrammar: RENDERED_CANONICAL_ID_RULES.map(({ pattern, ...rule }) => ({ ...rule, pattern: pattern.source })),
    documentedOwnershipConcerns,
    documentedMigrationCandidates: domains
      .filter((domain) => domain.documentedMigrationCandidate)
      .map((domain) => ({ domain: domain.domain, candidate: domain.documentedMigrationCandidate })),
  };
}
