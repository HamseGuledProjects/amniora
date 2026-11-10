import type {
  CanonicalEvidenceAsset,
  CanonicalEvidenceCapability,
  CanonicalInvestigationTask,
  LinuxSimulationWorld,
} from "./simulation";
import { parseLinuxCsvLine } from "./csv";

export type LinuxCanonicalSubjectType =
  | "host"
  | "identity"
  | "group"
  | "ssh_session"
  | "ssh_key"
  | "command"
  | "process"
  | "open_descriptor"
  | "file"
  | "service"
  | "service_transition"
  | "timer"
  | "cron_definition"
  | "scheduled_execution"
  | "package_transaction"
  | "package"
  | "network_connection"
  | "change"
  | "maintenance_activity"
  | "policy"
  | "incident"
  | "timeline_event"
  | "risk"
  | "evidence_gap";

export type LinuxCanonicalSubjectRef = {
  id: string;
  type: LinuxCanonicalSubjectType;
};

export type LinuxEvidenceRelationName =
  | "authenticated_as"
  | "executed_by"
  | "executed_in_session"
  | "spawned_process"
  | "opened_file"
  | "created_file"
  | "changed_service"
  | "transitioned_service"
  | "defines_schedule"
  | "executed_schedule"
  | "installed_package"
  | "covered_by_change"
  | "inside_maintenance_window"
  | "connected_to"
  | "owned_by"
  | "member_of_group";

export type LinuxEvidenceRelation = {
  relation: LinuxEvidenceRelationName;
  subjectIds: string[];
};

export type LinuxEvidenceSupportLevel = "exact" | "context" | "static";

export type CanonicalTaskRequirement = {
  id: string;
  capability: CanonicalEvidenceCapability;
  subjectIds: string[];
  relation?: LinuxEvidenceRelationName;
  minimumSupport: LinuxEvidenceSupportLevel;
  minimumAssetCount?: number;
  alternatives?: CanonicalTaskRequirement[][];
};

export type TaskRequirementProof = {
  requirementId: string;
  capability: string;
  requiredSubjectIds: string[];
  requiredRelation?: string;
  minimumSupport: LinuxEvidenceSupportLevel;
  satisfiedBy: Array<{
    evidenceAssetId: string;
    matchedSubjectIds: string[];
    matchedRelations: string[];
    support: LinuxEvidenceSupportLevel;
  }>;
  missingSubjectIds: string[];
  missingRelation: boolean;
  feasible: boolean;
};

export type LinuxLearnerPackGroundingResult = {
  passed: boolean;
  taskProofs: Array<{
    taskId: string;
    intent: CanonicalInvestigationTask["intent"];
    requiredCapabilities: string[];
    requiredSubjectIds: string[];
    requiredRelationships: string[];
    selectedEvidence: string[];
    matchedCapabilities: string[];
    matchedSubjects: string[];
    matchedRelationships: string[];
    missingRequirements: string[];
  }>;
  coverage: {
    canonicalIncidentSubjects: number;
    learnerFacingIncidentSubjects: number;
    taskRequiredSubjects: number;
    taskCoveredSubjects: number;
    uncoveredIncidentSubjects: string[];
    unrelatedTaskEvidence: number;
    relationshipProofCoverage: number;
    documentGroundingCoverage: number;
    riskGroundingCoverage: number;
  };
  issues: string[];
};

export type LinuxProductionClosureResult = {
  passed: boolean;
  issues: string[];
  metrics: {
    duplicateCanonicalIds: number;
    missingCanonicalReferences: number;
    missingLearnerObjects: number;
    missingRenderedSubjects: number;
    invalidRelations: number;
    snapshotContradictions: number;
    timezoneContradictions: number;
    networkContradictions: number;
    invalidRiskRows: number;
    impossibleTasks: number;
  };
};

const supportRank: Record<LinuxEvidenceSupportLevel, number> = {
  static: 1,
  context: 2,
  exact: 3,
};

export function linuxSubjectRef(id: string): LinuxCanonicalSubjectRef {
  if (id.startsWith("identity:")) return { id, type: "identity" };
  if (id.startsWith("group:")) return { id, type: "group" };
  if (id.startsWith("session:")) return { id, type: "ssh_session" };
  if (id.startsWith("command:")) return { id, type: "command" };
  if (id.startsWith("process:")) return { id, type: "process" };
  if (id.startsWith("descriptor:")) return { id, type: "open_descriptor" };
  if (id.startsWith("file:")) return { id, type: "file" };
  if (id.startsWith("service:")) return { id, type: "service" };
  if (id.startsWith("transition:")) return { id, type: "service_transition" };
  if (id.startsWith("timer:")) return { id, type: "timer" };
  if (id.startsWith("cron:")) return { id, type: "cron_definition" };
  if (id.startsWith("scheduled:")) return { id, type: "scheduled_execution" };
  if (id.startsWith("package:")) return { id, type: "package_transaction" };
  if (id.startsWith("package-subject:")) return { id, type: "package" };
  if (id.startsWith("maintenance:")) return { id, type: "maintenance_activity" };
  if (id.startsWith("event:")) return { id, type: "timeline_event" };
  if (/^CHG-/i.test(id)) return { id, type: "change" };
  if (/^CL-LNX-/i.test(id)) return { id, type: "incident" };
  return { id, type: "policy" };
}

function relation(relationName: LinuxEvidenceRelationName, subjectIds: string[]): LinuxEvidenceRelation {
  return { relation: relationName, subjectIds };
}

export function linuxCanonicalIncidentSubjectIds(simulation: LinuxSimulationWorld) {
  const primaryCommands = simulation.commands.filter((command) => command.kind !== "background");
  const commandIds = primaryCommands.map((command) => command.id);
  const processIds = primaryCommands
    .map((command) => simulation.processes.find((process) => process.pid === command.processId)?.id)
    .filter((id): id is string => Boolean(id));
  const fileIds = primaryCommands.flatMap((command) => command.affectedFileIds || []);
  const serviceIds = primaryCommands.flatMap((command) => command.affectedServiceIds || []);
  const transitionIds = simulation.serviceTransitions
    .filter((transition) => transition.cause?.type === "command" && commandIds.includes(transition.cause.commandId))
    .map((transition) => transition.id);
  const packageIds = simulation.packageTransactions
    .filter((transaction) => transaction.commandId && commandIds.includes(transaction.commandId))
    .map((transaction) => transaction.id);
  return Array.from(new Set([
    simulation.investigation.incidentId,
    simulation.investigation.changeId,
    ...simulation.sshSessions.filter((session) => session.purpose === "incident").map((session) => session.id),
    ...primaryCommands.map((command) => command.actorIdentityId),
    ...commandIds,
    ...processIds,
    ...fileIds,
    ...serviceIds,
    ...transitionIds,
    ...packageIds,
    ...simulation.maintenanceActivities.map((activity) => activity.id),
  ]));
}

export function linuxLearnerReviewSubjectIds(simulation: LinuxSimulationWorld) {
  return Array.from(new Set([
    simulation.investigation.incidentId,
    simulation.investigation.changeId,
    ...simulation.maintenanceActivities.map((activity) => activity.id),
  ]));
}

export function buildLinuxEvidenceRelations(simulation: LinuxSimulationWorld) {
  const relations: LinuxEvidenceRelation[] = [];
  const processByPid = new Map(simulation.processes.map((process) => [process.pid, process]));
  for (const session of simulation.sshSessions) {
    relations.push(relation("authenticated_as", [session.id, session.identityId]));
  }
  for (const identity of simulation.identities) {
    relations.push(relation("member_of_group", [identity.id, identity.primaryGroupId]));
  }
  for (const file of simulation.files) {
    relations.push(relation("owned_by", [file.id, file.ownerIdentityId]));
  }
  for (const descriptor of simulation.openFileDescriptors || []) {
    relations.push(relation("opened_file", [descriptor.processId, descriptor.id]));
    if (descriptor.targetKind === "file") relations.push(relation("opened_file", [descriptor.id, descriptor.targetId]));
    relations.push(relation("owned_by", [descriptor.id, descriptor.userIdentityId]));
    if (descriptor.relatedServiceId) relations.push(relation("connected_to", [descriptor.id, descriptor.relatedServiceId]));
  }
  for (const command of simulation.commands) {
    const process = processByPid.get(command.processId);
    relations.push(relation("executed_by", [command.id, command.runAsIdentityId || command.actorIdentityId]));
    if (command.sessionId) relations.push(relation("executed_in_session", [command.id, command.sessionId]));
    if (process) relations.push(relation("spawned_process", [command.id, process.id]));
    for (const fileId of command.affectedFileIds || []) {
      relations.push(relation("created_file", [command.id, fileId]));
      if (process?.openFileIds.includes(fileId)) relations.push(relation("opened_file", [process.id, fileId]));
    }
  }
  for (const transition of simulation.serviceTransitions) {
    relations.push(relation("transitioned_service", [transition.id, transition.serviceId]));
    if (transition.cause?.type === "command") relations.push(relation("changed_service", [transition.cause.commandId, transition.id]));
  }
  for (const definition of simulation.cronDefinitions) {
    relations.push(relation("defines_schedule", [definition.id, definition.commandId]));
  }
  for (const execution of simulation.scheduledExecutions) {
    if (execution.definitionId) relations.push(relation("executed_schedule", [execution.id, execution.definitionId]));
  }
  for (const transaction of simulation.packageTransactions) {
    for (const pkg of transaction.packages) {
      relations.push(relation("installed_package", [transaction.id, `package-subject:${pkg.name}`]));
    }
  }
  for (const activity of simulation.maintenanceActivities) {
    if (activity.changeId) relations.push(relation("covered_by_change", [activity.id, activity.changeId]));
    relations.push(relation("inside_maintenance_window", [activity.id, activity.id]));
  }
  return uniqueRelations(relations);
}

export function uniqueRelations(relations: LinuxEvidenceRelation[]) {
  const seen = new Set<string>();
  return relations.filter((item) => {
    const key = `${item.relation}:${item.subjectIds.join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function relationCovered(asset: CanonicalEvidenceAsset, required: LinuxEvidenceRelation) {
  return (asset.relations || []).some((candidate) =>
    candidate.relation === required.relation &&
    required.subjectIds.every((id) => candidate.subjectIds.includes(id))
  );
}

function supportMeets(actual: LinuxEvidenceSupportLevel | undefined, minimum: LinuxEvidenceSupportLevel) {
  return supportRank[actual || "static"] >= supportRank[minimum];
}

export function proveTaskRequirement(requirement: CanonicalTaskRequirement, assets: CanonicalEvidenceAsset[]): TaskRequirementProof {
  const satisfiedBy = assets
    .filter((asset) => asset.capabilities.includes(requirement.capability))
    .filter((asset) => requirement.subjectIds.every((id) => asset.canonicalObjectIds.includes(id)))
    .filter((asset) => supportMeets(asset.support, requirement.minimumSupport))
    .filter((asset) => !requirement.relation || relationCovered(asset, { relation: requirement.relation, subjectIds: requirement.subjectIds }))
    .map((asset) => ({
      evidenceAssetId: asset.id,
      matchedSubjectIds: requirement.subjectIds.filter((id) => asset.canonicalObjectIds.includes(id)),
      matchedRelations: requirement.relation ? [requirement.relation] : [],
      support: asset.support || "static",
    }));
  const matchedSubjects = new Set(satisfiedBy.flatMap((item) => item.matchedSubjectIds));
  const missingSubjectIds = requirement.subjectIds.filter((id) => !matchedSubjects.has(id));
  const missingRelation = Boolean(requirement.relation && satisfiedBy.length === 0);
  const minimumAssetCount = requirement.minimumAssetCount || 1;
  return {
    requirementId: requirement.id,
    capability: requirement.capability,
    requiredSubjectIds: requirement.subjectIds,
    requiredRelation: requirement.relation,
    minimumSupport: requirement.minimumSupport,
    satisfiedBy,
    missingSubjectIds,
    missingRelation,
    feasible: satisfiedBy.length >= minimumAssetCount && missingSubjectIds.length === 0 && !missingRelation,
  };
}

export function proveTaskRequirements(task: CanonicalInvestigationTask, assets: CanonicalEvidenceAsset[]) {
  return (task.requirements || []).map((requirement) => proveTaskRequirement(requirement, assets));
}

export function validateLinuxLearnerPackGrounding(args: {
  simulation: LinuxSimulationWorld;
  evidenceRegistry?: CanonicalEvidenceAsset[];
  finalAssets?: Array<{ file_path: string; content: string }>;
}) {
  const registry = args.evidenceRegistry || args.simulation.evidenceRegistry;
  const registryById = new Map(registry.map((asset) => [asset.id, asset]));
  const issues: string[] = [];
  const taskProofs = args.simulation.canonicalTasks.map((task) => {
    const selected = task.selectedEvidenceAssetIds.map((id) => registryById.get(id)).filter((asset): asset is CanonicalEvidenceAsset => Boolean(asset));
    const proofs = proveTaskRequirements(task, selected);
    const missingRequirements = proofs.filter((proof) => !proof.feasible).map((proof) => proof.requirementId);
    if (missingRequirements.length > 0) {
      issues.push(`${task.id} missing object-grounded requirements: ${missingRequirements.join(", ")}`);
    }
    return {
      taskId: task.id,
      intent: task.intent,
      requiredCapabilities: Array.from(new Set((task.requirements || []).map((item) => item.capability))),
      requiredSubjectIds: Array.from(new Set((task.requirements || []).flatMap((item) => item.subjectIds))),
      requiredRelationships: Array.from(new Set((task.requirements || []).flatMap((item) => item.relation ? [item.relation] : []))),
      selectedEvidence: selected.map((asset) => asset.path),
      matchedCapabilities: Array.from(new Set(selected.flatMap((asset) => asset.capabilities))),
      matchedSubjects: Array.from(new Set(selected.flatMap((asset) => asset.canonicalObjectIds))),
      matchedRelationships: Array.from(new Set(selected.flatMap((asset) => (asset.relations || []).map((item) => item.relation)))),
      missingRequirements,
    };
  });
  const incidentSubjects = linuxCanonicalIncidentSubjectIds(args.simulation);
  const learnerFacingSubjects = new Set(registry.flatMap((asset) => asset.canonicalObjectIds));
  const taskRequiredSubjects = new Set(taskProofs.flatMap((proof) => proof.requiredSubjectIds));
  const taskCoveredSubjects = new Set(taskProofs.flatMap((proof) => proof.matchedSubjects).filter((id) => taskRequiredSubjects.has(id)));
  const requiredRelations = Array.from(new Set(taskProofs.flatMap((proof) => proof.requiredRelationships)));
  const coveredRelations = new Set(taskProofs.flatMap((proof) => proof.matchedRelationships).filter((relationName) => requiredRelations.includes(relationName)));
  return {
    passed: issues.length === 0,
    taskProofs,
    coverage: {
      canonicalIncidentSubjects: incidentSubjects.length,
      learnerFacingIncidentSubjects: incidentSubjects.filter((id) => learnerFacingSubjects.has(id)).length,
      taskRequiredSubjects: taskRequiredSubjects.size,
      taskCoveredSubjects: taskCoveredSubjects.size,
      uncoveredIncidentSubjects: incidentSubjects.filter((id) => !learnerFacingSubjects.has(id)),
      unrelatedTaskEvidence: taskProofs.filter((proof) => proof.requiredSubjectIds.length > 0 && !proof.requiredSubjectIds.some((id) => proof.matchedSubjects.includes(id))).length,
      relationshipProofCoverage: requiredRelations.length === 0 ? 1 : coveredRelations.size / requiredRelations.length,
      documentGroundingCoverage: 1,
      riskGroundingCoverage: 1,
    },
    issues,
  } satisfies LinuxLearnerPackGroundingResult;
}

function addUnique(map: Map<string, string>, issues: string[], id: string | undefined, label: string) {
  if (!id) return;
  const previous = map.get(id);
  if (previous) {
    issues.push(`duplicate canonical id ${id} used by ${previous} and ${label}`);
    return;
  }
  map.set(id, label);
}

function assetText(finalAssets: Array<{ file_path: string; content: string }> | undefined, path: string) {
  return finalAssets?.find((asset) => asset.file_path === path)?.content || "";
}

function includesAny(text: string, values: string[]) {
  const comparable = text.toLowerCase();
  return values.some((value) => value && comparable.includes(value.toLowerCase()));
}

function allAssetText(finalAssets: Array<{ file_path: string; content: string }> | undefined) {
  return (finalAssets || []).map((asset) => `${asset.file_path}\n${asset.content}`).join("\n");
}

function subjectTokens(simulation: LinuxSimulationWorld, id: string) {
  const tokens = new Set<string>([id]);
  const identity = simulation.identities.find((item) => item.id === id);
  if (identity) tokens.add(identity.username).add(String(identity.uid)).add(String(identity.gid));
  const group = simulation.groups.find((item) => item.id === id);
  if (group) tokens.add(group.name).add(String(group.gid));
  const session = simulation.sshSessions.find((item) => item.id === id);
  if (session) tokens.add(session.username).add(session.sourceIp).add(String(session.sessionPid)).add(String(session.monitorPid)).add(session.openedAt);
  const command = simulation.commands.find((item) => item.id === id);
  if (command) tokens.add(command.renderedCommand).add(command.executable).add(String(command.processId)).add(command.timestamp);
  const process = simulation.processes.find((item) => item.id === id);
  if (process) tokens.add(String(process.pid)).add(process.executable).add(process.argv.join(" "));
  const descriptor = (simulation.openFileDescriptors || []).find((item) => item.id === id);
  if (descriptor) {
    tokens.add(String(descriptor.pid)).add(descriptor.username).add(descriptor.fd).add(descriptor.targetPath || "").add(descriptor.openedAt);
    if (descriptor.localPort) tokens.add(String(descriptor.localPort));
    if (descriptor.localAddress) tokens.add(descriptor.localAddress);
    if (descriptor.deleted) tokens.add("(deleted)").add("deleted");
  }
  const file = simulation.files.find((item) => item.id === id);
  if (file) tokens.add(file.path).add(String(file.inode)).add(String(file.ownerUid));
  const service = simulation.services.find((item) => item.id === id);
  if (service) {
    tokens.add(service.unitName).add(service.unitPath);
    if (service.unitName === "ssh.service") tokens.add("sshd").add("ssh");
  }
  const transition = simulation.serviceTransitions.find((item) => item.id === id);
  if (transition) tokens.add(transition.id).add(transition.operation).add(transition.occurredAt);
  const timer = simulation.timers.find((item) => item.id === id);
  if (timer) tokens.add(timer.timerUnitName);
  const cron = simulation.cronDefinitions.find((item) => item.id === id);
  if (cron) tokens.add(cron.id).add(cron.sourcePath).add(cron.schedule);
  const execution = simulation.scheduledExecutions.find((item) => item.id === id);
  if (execution) tokens.add(execution.id).add(execution.occurredAt);
  const transaction = simulation.packageTransactions.find((item) => item.id === id);
  if (transaction) {
    tokens.add(transaction.id).add(transaction.startedAt).add(transaction.completedAt);
    transaction.packages.forEach((pkg) => tokens.add(pkg.name).add(pkg.resultingVersion || ""));
  }
  const activity = simulation.maintenanceActivities.find((item) => item.id === id);
  if (activity) tokens.add(activity.id).add(activity.title).add(activity.changeId || "").add(activity.ticketId || "");
  const event = simulation.events.find((item) => item.id === id);
  if (event) tokens.add(event.id).add(event.timestamp).add(event.summary);
  if (id === simulation.investigation.incidentId) tokens.add(simulation.investigation.incidentId);
  if (id === simulation.investigation.changeId) tokens.add(simulation.investigation.changeId);
  if (id === simulation.investigation.ticketId) tokens.add(simulation.investigation.ticketId);
  if (id === simulation.investigation.hostname) tokens.add(simulation.investigation.hostname);
  if (id === simulation.investigation.hostIp) tokens.add(simulation.investigation.hostIp);
  if (id.startsWith("package-subject:")) tokens.add(id.slice("package-subject:".length));
  return [...tokens].filter((token) => token.length > 0);
}

function shouldRenderSubject(id: string) {
  if (/^\d{4}-\d{2}-\d{2} /.test(id)) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(id)) return true;
  return /^(?:identity|group|session|command|process|descriptor|file|service|transition|timer|cron|scheduled|package|package-subject|maintenance|event):/.test(id) ||
    /^CHG-/i.test(id) ||
    /^CL-LNX-/i.test(id);
}

function relationKey(item: LinuxEvidenceRelation) {
  return `${item.relation}:${item.subjectIds.join("|")}`;
}

function riskRows(finalAssets: Array<{ file_path: string; content: string }> | undefined) {
  return (finalAssets || [])
    .filter((asset) => /risk_register\.csv$/i.test(asset.file_path))
    .flatMap((asset) => {
      const lines = asset.content.trim().split(/\r?\n/).filter(Boolean);
      const header = parseLinuxCsvLine(lines[0] || "").values.map((item) => item.toLowerCase());
      return lines.slice(1).map((line, index) => ({ asset, line, lineNumber: index + 2, header, row: parseLinuxCsvLine(line).values }));
    });
}

function ipToNumber(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function ipInCidr(ip: string, cidr: string) {
  if (cidr === "Anywhere" || cidr === "0.0.0.0/0") return true;
  if (!cidr.includes("/")) return ip === cidr;
  const [network, prefixText] = cidr.split("/");
  const ipNumber = ipToNumber(ip);
  const networkNumber = ipToNumber(network);
  const prefix = Number(prefixText);
  if (ipNumber === undefined || networkNumber === undefined || !Number.isInteger(prefix)) return false;
  const mask = prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (networkNumber & mask);
}

function ufwAllowsSource(ufw: string, sourceIp: string, port: number) {
  if (/Status:\s+inactive/i.test(ufw)) return true;
  return ufw.split(/\r?\n/).some((line) => {
    if (!line.includes(`${port}/tcp`) || !/\bALLOW\b/i.test(line)) return false;
    return ipInCidr(sourceIp, line.trim().split(/\s+/).pop() || "");
  });
}

function snapshotContainsPid(content: string, pid: number) {
  return content.split(/\r?\n/).some((line) => {
    const fields = line.trim().split(/\s+/);
    return fields.length >= 3 && fields[1] === String(pid);
  });
}

function validateCanonicalReferences(simulation: LinuxSimulationWorld, objectIds: Set<string>, issues: string[]) {
  const requireId = (owner: string, id: string | undefined) => {
    if (id && !objectIds.has(id)) issues.push(`${owner} references missing canonical object ${id}`);
  };
  for (const identity of simulation.identities) requireId(identity.id, identity.primaryGroupId);
  for (const session of simulation.sshSessions) requireId(session.id, session.identityId);
  for (const command of simulation.commands) {
    requireId(command.id, command.actorIdentityId);
    requireId(command.id, command.runAsIdentityId);
    requireId(command.id, command.sessionId);
    requireId(command.id, command.parentCommandId);
    command.affectedFileIds.forEach((id) => requireId(command.id, id));
    (command.affectedServiceIds || []).forEach((id) => requireId(command.id, id));
  }
  for (const process of simulation.processes) {
    requireId(process.id, process.identityId);
    requireId(process.id, process.commandId);
    requireId(process.id, process.sessionId);
    process.openFileIds.forEach((id) => requireId(process.id, id));
    process.childProcessIds.forEach((id) => requireId(process.id, id));
  }
  for (const descriptor of simulation.openFileDescriptors || []) {
    requireId(descriptor.id, descriptor.processId);
    requireId(descriptor.id, descriptor.userIdentityId);
    if (descriptor.targetKind === "file") requireId(descriptor.id, descriptor.targetId);
    requireId(descriptor.id, descriptor.relatedServiceId);
  }
  for (const file of simulation.files) {
    requireId(file.id, file.ownerIdentityId);
    requireId(file.id, file.groupId);
    file.relatedCommandIds.forEach((id) => requireId(file.id, id));
  }
  for (const service of simulation.services) {
    requireId(service.id, service.mainProcessId);
    requireId(service.id, service.localOverrideFileId);
    requireId(service.id, service.relatedTimerId);
  }
  for (const transition of simulation.serviceTransitions) {
    requireId(transition.id, transition.serviceId);
    if (transition.cause?.type === "command") requireId(transition.id, transition.cause.commandId);
    if (transition.cause?.type === "package") requireId(transition.id, transition.cause.packageTransactionId);
    if (transition.cause?.type === "signal") requireId(transition.id, transition.cause.processId);
  }
  for (const definition of simulation.cronDefinitions) {
    requireId(definition.id, definition.ownerIdentityId);
    requireId(definition.id, definition.runAsIdentityId);
    requireId(definition.id, definition.commandId);
  }
  for (const execution of simulation.scheduledExecutions) {
    requireId(execution.id, execution.definitionId);
    requireId(execution.id, execution.timerId);
    requireId(execution.id, execution.commandId);
    requireId(execution.id, execution.processId);
    execution.affectedFileIds.forEach((id) => requireId(execution.id, id));
    execution.affectedServiceIds.forEach((id) => requireId(execution.id, id));
  }
  for (const transaction of simulation.packageTransactions) {
    requireId(transaction.id, transaction.actorIdentityId);
    requireId(transaction.id, transaction.commandId);
    requireId(transaction.id, transaction.timerId);
    transaction.processIds.forEach((id) => requireId(transaction.id, id));
    transaction.affectedFileIds.forEach((id) => requireId(transaction.id, id));
    transaction.affectedServiceIds.forEach((id) => requireId(transaction.id, id));
  }
  for (const activity of simulation.maintenanceActivities) {
    requireId(activity.id, activity.actorIdentityId);
    activity.commandIds.forEach((id) => requireId(activity.id, id));
    activity.serviceTransitionIds.forEach((id) => requireId(activity.id, id));
    activity.packageTransactionIds.forEach((id) => requireId(activity.id, id));
    activity.cronDefinitionIds.forEach((id) => requireId(activity.id, id));
  }
}

export function validateLinuxProductionClosure(args: {
  simulation: LinuxSimulationWorld;
  evidenceRegistry?: CanonicalEvidenceAsset[];
  finalAssets?: Array<{ file_path: string; content: string }>;
}) {
  const simulation = args.simulation;
  const registry = args.evidenceRegistry || simulation.evidenceRegistry;
  const finalAssets = args.finalAssets || [];
  const issues: string[] = [];
  const metrics: LinuxProductionClosureResult["metrics"] = {
    duplicateCanonicalIds: 0,
    missingCanonicalReferences: 0,
    missingLearnerObjects: 0,
    missingRenderedSubjects: 0,
    invalidRelations: 0,
    snapshotContradictions: 0,
    timezoneContradictions: 0,
    networkContradictions: 0,
    invalidRiskRows: 0,
    impossibleTasks: 0,
  };

  const canonicalIds = new Map<string, string>();
  addUnique(canonicalIds, issues, simulation.investigation.incidentId, "incident");
  addUnique(canonicalIds, issues, simulation.investigation.changeId, "change");
  addUnique(canonicalIds, issues, simulation.investigation.ticketId, "ticket");
  simulation.identities.forEach((item) => addUnique(canonicalIds, issues, item.id, "identity"));
  simulation.groups.forEach((item) => addUnique(canonicalIds, issues, item.id, "group"));
  simulation.sshSessions.forEach((item) => addUnique(canonicalIds, issues, item.id, "ssh session"));
  simulation.commands.forEach((item) => addUnique(canonicalIds, issues, item.id, "command"));
  simulation.processes.forEach((item) => addUnique(canonicalIds, issues, item.id, "process"));
  (simulation.openFileDescriptors || []).forEach((item) => addUnique(canonicalIds, issues, item.id, "open descriptor"));
  simulation.files.forEach((item) => addUnique(canonicalIds, issues, item.id, "file"));
  simulation.events.forEach((item) => addUnique(canonicalIds, issues, item.id, "event"));
  simulation.services.forEach((item) => addUnique(canonicalIds, issues, item.id, "service"));
  simulation.serviceTransitions.forEach((item) => addUnique(canonicalIds, issues, item.id, "service transition"));
  simulation.timers.forEach((item) => addUnique(canonicalIds, issues, item.id, "timer"));
  simulation.cronDefinitions.forEach((item) => addUnique(canonicalIds, issues, item.id, "cron definition"));
  simulation.scheduledExecutions.forEach((item) => addUnique(canonicalIds, issues, item.id, "scheduled execution"));
  simulation.packageTransactions.forEach((item) => addUnique(canonicalIds, issues, item.id, "package transaction"));
  simulation.packageTransactions.forEach((transaction) => transaction.packages.forEach((pkg) => addUnique(canonicalIds, issues, `package-subject:${pkg.name}`, "package")));
  simulation.maintenanceActivities.forEach((item) => addUnique(canonicalIds, issues, item.id, "maintenance activity"));
  metrics.duplicateCanonicalIds = issues.filter((item) => item.includes("duplicate canonical id")).length;

  const referenceIssuesBefore = issues.length;
  validateCanonicalReferences(simulation, new Set(canonicalIds.keys()), issues);
  metrics.missingCanonicalReferences = issues.length - referenceIssuesBefore;

  const paths = new Set(finalAssets.map((asset) => asset.file_path));
  for (const asset of registry) {
    if (!paths.has(asset.path)) issues.push(`registered evidence asset is missing from learner pack ${asset.path}`);
  }
  for (const asset of finalAssets.filter((item) => item.file_path.startsWith("assets/"))) {
    if (!registry.some((item) => item.path === asset.file_path)) issues.push(`learner-facing asset is not registered ${asset.file_path}`);
  }
  metrics.missingLearnerObjects = issues.filter((item) => item.includes("evidence asset is missing") || item.includes("not registered")).length;

  const allText = allAssetText(finalAssets);
  for (const id of linuxCanonicalIncidentSubjectIds(simulation).filter(shouldRenderSubject)) {
    if (!includesAny(allText, subjectTokens(simulation, id))) {
      issues.push(`incident subject is not rendered in learner-facing assets ${id}`);
    }
  }

  const renderedIssuesBefore = issues.length;
  for (const asset of registry) {
    const content = `${asset.path}\n${assetText(finalAssets, asset.path)}`;
    if (!content) continue;
    for (const id of asset.canonicalObjectIds.filter(shouldRenderSubject)) {
      if (!includesAny(content, subjectTokens(simulation, id))) {
        issues.push(`registry declares ${id} for ${asset.path}, but rendered asset does not contain that object`);
      }
    }
  }
  metrics.missingRenderedSubjects = issues.length - renderedIssuesBefore;

  const knownRelations = new Set(buildLinuxEvidenceRelations(simulation).map(relationKey));
  const relationIssuesBefore = issues.length;
  for (const asset of registry) {
    for (const item of asset.relations || []) {
      if (!item.subjectIds.every((id) => canonicalIds.has(id) || id.startsWith("package-subject:"))) {
        issues.push(`relation ${item.relation} on ${asset.path} references missing subject`);
      }
      if (!knownRelations.has(relationKey(item))) {
        issues.push(`relation ${item.relation} on ${asset.path} is not a canonical relationship`);
      }
    }
  }
  metrics.invalidRelations = issues.length - relationIssuesBefore;

  const snapshotIssuesBefore = issues.length;
  for (const asset of registry.filter((item) => item.stateType === "collection_snapshot")) {
    if (!asset.collectionTimestamp) issues.push(`collection snapshot ${asset.path} lacks capture timestamp`);
    const collection = asset.collectionTimestamp || simulation.collection.collectedAt;
    const content = assetText(finalAssets, asset.path);
    const ids = new Set(asset.canonicalObjectIds);
    for (const process of simulation.processes) {
      if (process.endedAt && process.endedAt <= collection && (ids.has(process.id) || snapshotContainsPid(content, process.pid))) {
        issues.push(`collection snapshot ${asset.path} contains terminated process ${process.id}`);
      }
    }
  }
  metrics.snapshotContradictions = issues.length - snapshotIssuesBefore;

  const timezoneIssuesBefore = issues.length;
  for (const asset of registry.filter((item) => item.exactTimestampSupport || item.collectionTimestamp)) {
    if (!asset.timezone) issues.push(`timestamped asset ${asset.path} lacks timezone metadata`);
    if ((asset.exactTimestampSupport || asset.collectionTimestamp) && !asset.timestampFormat) {
      issues.push(`timestamped asset ${asset.path} lacks timestamp format metadata`);
    }
  }
  if (!simulation.investigation.timezone) issues.push("investigation lacks canonical timezone");
  metrics.timezoneContradictions = issues.length - timezoneIssuesBefore;

  const networkIssuesBefore = issues.length;
  const ufw = assetText(finalAssets, "assets/network/ufw_status.txt");
  const ports = assetText(finalAssets, "assets/network/listening_ports.txt");
  const hasSshSuccess = simulation.sshSessions.some((session) => session.purpose === "incident" || session.purpose === "maintenance");
  if (hasSshSuccess) {
    for (const session of simulation.sshSessions.filter((item) => item.purpose === "incident" || item.purpose === "maintenance")) {
      if (!ufwAllowsSource(ufw, session.sourceIp, 22)) issues.push(`SSH session succeeds but firewall evidence does not allow SSH source ${session.sourceIp}`);
    }
    if (!/(?:0\.0\.0\.0|::|\d+\.\d+\.\d+\.\d+):22\b.*\bsshd\b/i.test(ports)) issues.push("SSH session succeeds but listening_ports lacks sshd on port 22");
    if (!assetText(finalAssets, "assets/network/routing_table.txt").includes("default via")) issues.push("SSH session succeeds but routing table lacks a default route");
  }
  metrics.networkContradictions = issues.length - networkIssuesBefore;

  const riskIssuesBefore = issues.length;
  const severities = new Set(["low", "medium", "high", "critical"]);
  const statuses = new Set(["open", "review", "monitoring", "accepted", "mitigated", "closed"]);
  for (const item of riskRows(finalAssets)) {
    const severityIndex = item.header.indexOf("severity");
    const statusIndex = item.header.indexOf("status");
    const evidenceIndex = item.header.indexOf("evidence");
    const severity = String(item.row[severityIndex] || "").toLowerCase();
    const status = String(item.row[statusIndex] || "").toLowerCase();
    const evidence = String(item.row[evidenceIndex] || "");
    const finding = String(item.row[item.header.indexOf("finding") >= 0 ? item.header.indexOf("finding") : item.header.indexOf("risk")] || "");
    const unverifiedHypothesis = /^Unverified hypothesis: /i.test(finding);
    if (severityIndex < 0) issues.push(`${item.asset.file_path} missing severity column`);
    else if (!severities.has(severity) && !(unverifiedHypothesis && severity === "unassessed" && status === "unverified")) issues.push(`${item.asset.file_path}:${item.lineNumber} invalid risk severity ${severity}`);
    if (statusIndex < 0) issues.push(`${item.asset.file_path} missing status column`);
    else if (!statuses.has(status) && !(unverifiedHypothesis && status === "unverified" && severity === "unassessed")) issues.push(`${item.asset.file_path}:${item.lineNumber} invalid risk status ${status}`);
    if (unverifiedHypothesis && (status !== "unverified" || severity !== "unassessed")) issues.push(`${item.asset.file_path}:${item.lineNumber} unverified hypothesis must remain unassessed`);
    if (evidenceIndex < 0 || !evidence.trim()) issues.push(`${item.asset.file_path}:${item.lineNumber} risk row lacks evidence`);
    for (const source of evidence.split(/[;|]/).map((part) => part.trim()).filter(Boolean)) {
      const normalized = source.replace(/^assets\//, "");
      if (!finalAssets.some((asset) => asset.file_path === source || asset.file_path === `assets/${normalized}` || asset.file_path.endsWith(`/${normalized}`))) {
        issues.push(`${item.asset.file_path}:${item.lineNumber} risk cites missing evidence ${source}`);
      }
    }
  }
  metrics.invalidRiskRows = issues.length - riskIssuesBefore;

  const taskIssuesBefore = issues.length;
  const packGrounding = validateLinuxLearnerPackGrounding({ simulation, evidenceRegistry: registry, finalAssets });
  if (!packGrounding.passed) issues.push(...packGrounding.issues);
  for (const proof of packGrounding.taskProofs) {
    if (proof.missingRequirements.length > 0) issues.push(`task ${proof.taskId} is not fully answerable`);
  }
  metrics.impossibleTasks = issues.length - taskIssuesBefore;

  return {
    passed: issues.length === 0,
    issues,
    metrics,
  } satisfies LinuxProductionClosureResult;
}
