import type {
  CanonicalCommand,
  CanonicalOpenFileDescriptor,
  CanonicalProcess,
  CanonicalService,
  LinuxSimulationWorld,
} from "./simulation";
import { canonicalPrimaryService, linuxLearnerSubjectLabel } from "./simulation";
import { parseLinuxCommand, parseDockerMount } from "./commandSemantics";
import { validatePublicKeyLine } from "./cryptographicEvidence";
import { parseLinuxCsvLine } from "./csv";
import {
  resolveCanonicalCommandSudoPolicy,
  resolveSudoPolicy,
  splitSudoCommandSpecs,
  sudoCommandText,
} from "./sudoPolicy";
import { CURRENT_STATE_EVIDENCE_HINTS, type LinuxCurrentStateCapability } from "./currentStateEvidence";
import { buildLinuxIdentitySshSudoSemanticReport } from "./identitySshSudoSemantics";
import { buildLinuxProcessAuditFileSemanticReport } from "./processAuditFileSemantics";
import { buildLinuxServiceSchedulerPackageSemanticReport } from "./serviceSchedulerPackageSemantics";
import { buildLinuxNetworkContainerLogSemanticReport } from "./networkContainerLogSemantics";

export type LinuxSemanticIssue = {
  severity: "critical" | "high" | "medium";
  category:
    | "command"
    | "identity"
    | "process"
    | "filesystem"
    | "container"
    | "scheduler"
    | "network"
    | "service"
    | "sudo"
    | "provenance"
    | "risk"
    | "crypto"
    | "task";
  message: string;
};

export type LinuxSemanticClosureResult = {
  passed: boolean;
  issues: LinuxSemanticIssue[];
  metrics: Record<LinuxSemanticIssue["category"], number> & {
    commandKinds: Record<string, number>;
  };
};

function issue(issues: LinuxSemanticIssue[], severity: LinuxSemanticIssue["severity"], category: LinuxSemanticIssue["category"], message: string) {
  issues.push({ severity, category, message });
}

function parseTime(value: string) {
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function assetText(assets: Array<{ file_path: string; content: string }> | undefined, path: string) {
  return assets?.find((asset) => asset.file_path === path)?.content || "";
}

function allText(assets: Array<{ file_path: string; content: string }> | undefined) {
  return (assets || []).map((asset) => `${asset.file_path}\n${asset.content}`).join("\n");
}

function serviceInventoryRows(content: string) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const header = parseLinuxCsvLine(lines[0] || "").values.map((item) => item.trim().toLowerCase());
  const index = (name: string, fallback: number) => {
    const found = header.indexOf(name);
    return found >= 0 ? found : fallback;
  };
  return lines.slice(1).map((line, offset) => {
    const row = parseLinuxCsvLine(line).values;
    return {
      lineNumber: offset + 2,
      service: row[index("service", 0)] || "",
      status: row[index("status", 1)] || "",
      startup: row[index("startup", 2)] || "",
      loadState: row[index("load_state", 4)] || "",
      activeState: row[index("active_state", 5)] || "",
      subState: row[index("sub_state", 6)] || "",
      result: row[index("result", 7)] || "",
      mainPid: row[index("main_pid", 8)] || "",
      unitPath: row[index("unit_path", 9)] || "",
      raw: line,
    };
  });
}

function expectedServiceStatus(service: CanonicalService) {
  if (service.unitType === "timer") return service.activeState === "active" ? "active" : service.activeState;
  if (service.unitType === "oneshot" && service.activeState === "inactive") return "inactive";
  return service.activeState === "active" ? "running" : service.activeState;
}

function processSnapshotContainsPid(processSnapshot: string, pid: number) {
  return new RegExp(`\\s${pid}\\s+\\d+\\s+`).test(processSnapshot);
}

function openFileRowFor(openFiles: string, descriptor: CanonicalOpenFileDescriptor) {
  const target = descriptor.targetKind === "socket"
    ? `${descriptor.protocol || "socket"} ${descriptor.localAddress || "local"}:${descriptor.localPort || ""}`
    : descriptor.targetPath || descriptor.targetId;
  return openFiles.split(/\r?\n/).find((line) =>
    new RegExp(`\\s${descriptor.pid}\\s+${descriptor.username}\\s+`).test(line) &&
    line.includes(descriptor.fd) &&
    line.includes(target)
  );
}

function processByPid(simulation: LinuxSimulationWorld) {
  return new Map(simulation.processes.map((process) => [process.pid, process]));
}

function processForCommand(simulation: LinuxSimulationWorld, command: CanonicalCommand) {
  return simulation.processes.find((process) => process.pid === command.processId);
}

function commandIsOneShot(parsedKind: string) {
  return ["cat", "docker_inspect", "systemctl", "journalctl", "cp", "mv", "chmod", "chown", "apt_install", "apt_remove"].includes(parsedKind);
}

function captureTimeFrom(content: string, fallback: string) {
  return content.match(/capture_at=([0-9-]{10} [0-9:]{8})/)?.[1] || fallback;
}

function cronFieldMatches(field: string, value: number) {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    if (/^\d+$/.test(part)) return Number(part) === value;
    const step = part.match(/^(\*|\d+-\d+)\/(\d+)$/);
    if (step) {
      const interval = Number(step[2]);
      if (!interval) return false;
      if (step[1] === "*") return value % interval === 0;
      const [start, end] = step[1].split("-").map(Number);
      return value >= start && value <= end && (value - start) % interval === 0;
    }
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    return false;
  });
}

function cronMatches(schedule: string, timestamp: string) {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const date = new Date(`${timestamp.slice(0, 10)}T00:00:00Z`);
  return cronFieldMatches(fields[0], Number(timestamp.slice(14, 16))) &&
    cronFieldMatches(fields[1], Number(timestamp.slice(11, 13))) &&
    cronFieldMatches(fields[2], Number(timestamp.slice(8, 10))) &&
    cronFieldMatches(fields[3], Number(timestamp.slice(5, 7))) &&
    cronFieldMatches(fields[4], date.getUTCDay());
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
    const from = line.trim().split(/\s+/).pop() || "";
    return ipInCidr(sourceIp, from);
  });
}

function parsePasswdShells(passwd: string) {
  const shells = new Map<string, string>();
  for (const line of passwd.split(/\r?\n/)) {
    const parts = line.split(":");
    if (parts.length >= 7) shells.set(parts[0], parts[6]);
  }
  return shells;
}

function parseGroupsCsv(groups: string) {
  const memberships = new Map<string, Set<string>>();
  for (const line of groups.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [group, members = ""] = parseLinuxCsvLine(line).values;
    for (const member of members.split(",").map((item) => item.trim()).filter(Boolean)) {
      if (!memberships.has(member)) memberships.set(member, new Set());
      memberships.get(member)!.add(group);
    }
  }
  return memberships;
}

function subjectNeedles(simulation: LinuxSimulationWorld, subjectIds: string[]) {
  const values: string[] = [];
  for (const id of subjectIds) {
    const service = simulation.services.find((item) => item.id === id);
    if (service) values.push(service.unitName, service.unitName.replace(/\.service$/, ""));
    const process = simulation.processes.find((item) => item.id === id);
    if (process) values.push(String(process.pid), process.executable, process.argv.join(" "));
    const identity = simulation.identities.find((item) => item.id === id);
    if (identity) values.push(identity.username, String(identity.uid));
    const group = simulation.groups.find((item) => item.id === id);
    if (group) values.push(group.name, String(group.gid));
    const file = simulation.files.find((item) => item.id === id);
    if (file) values.push(file.path);
    const cron = simulation.cronDefinitions.find((item) => item.id === id);
    if (cron) {
      const command = simulation.commands.find((item) => item.id === cron.commandId);
      values.push(cron.sourcePath, command?.renderedCommand || "", cron.schedule);
    }
    if (id.startsWith("package-subject:")) values.push(id.replace(/^package-subject:/, ""));
    const command = simulation.commands.find((item) => item.id === id);
    if (command) values.push(command.renderedCommand, command.argv[0]);
  }
  return Array.from(new Set(values.filter((value) => value && value.length >= 2)));
}

export function validateLinuxSemanticClosure(args: {
  simulation: LinuxSimulationWorld;
  finalAssets?: Array<{ file_path: string; content: string }>;
}) {
  const { simulation } = args;
  const finalAssets = args.finalAssets || [];
  const issues: LinuxSemanticIssue[] = [];
  const commandKinds: Record<string, number> = {};
  const byPid = processByPid(simulation);
  const rendered = allText(finalAssets);
  const registryById = new Map(simulation.evidenceRegistry.map((asset) => [asset.id, asset]));
  const renderedAssetByPath = new Map(finalAssets.map((asset) => [asset.file_path, asset]));
  const identitySshSudoReport = buildLinuxIdentitySshSudoSemanticReport({ simulation, finalAssets });
  for (const detail of identitySshSudoReport.issues) {
    const category =
      detail.code.includes("_SUDO_") ? "sudo" :
      detail.code.includes("_SSH_KEY_") ? "crypto" :
      detail.code.includes("_SSH_") ? "provenance" :
      detail.code.includes("_SHELL_") ? "command" :
      "identity";
    issue(issues, detail.severity, category, `${detail.code}: ${detail.message}`);
  }
  const processAuditFileReport = buildLinuxProcessAuditFileSemanticReport({ simulation, finalAssets });
  for (const detail of processAuditFileReport.issues) {
    const category =
      detail.category === "process" || detail.category === "execution" || detail.category === "snapshot" ? "process" :
      detail.category === "audit" ? "command" :
      detail.category === "file" || detail.category === "artifact" ? "filesystem" :
      "command";
    issue(issues, detail.severity, category, `${detail.code}: ${detail.message}`);
  }
  const serviceSchedulerPackageReport = buildLinuxServiceSchedulerPackageSemanticReport({ simulation, finalAssets });
  for (const detail of serviceSchedulerPackageReport.issues) {
    const category =
      detail.category === "systemd" ? "service" :
      detail.category === "scheduler" ? "scheduler" :
      detail.category === "package" || detail.category === "repository" ? "risk" :
      detail.category === "change" || detail.category === "timezone" || detail.category === "artifact" ? "provenance" :
      "service";
    issue(issues, detail.severity, category, `${detail.code}: ${detail.message}`);
  }
  const networkContainerLogReport = buildLinuxNetworkContainerLogSemanticReport({ simulation, finalAssets });
  for (const detail of networkContainerLogReport.issues) {
    const category =
      detail.category === "network" || detail.category === "firewall" ? "network" :
      detail.category === "reverse_shell" || detail.category === "docker" || detail.category === "cross_domain" ? "process" :
      detail.category === "log" ? "filesystem" :
      detail.category === "kernel" ? "provenance" :
      detail.category === "role" ? "service" :
      "provenance";
    issue(issues, detail.severity, category, `${detail.code}: ${detail.message}`);
  }

  for (const task of simulation.canonicalTasks || []) {
    for (const requirement of task.currentStateRequirements || []) {
      const selectedRegistryAssets = task.selectedEvidenceAssetIds
        .map((id) => registryById.get(id))
        .filter((asset): asset is NonNullable<ReturnType<typeof registryById.get>> => Boolean(asset));
      const capableAssets = selectedRegistryAssets.filter((asset) => asset.capabilities.includes(requirement.capability));
      if (capableAssets.length === 0) {
        issue(
          issues,
          "critical",
          "task",
          `${task.id} lacks selected current-state evidence for ${requirement.capability}; expected ${CURRENT_STATE_EVIDENCE_HINTS[requirement.capability as LinuxCurrentStateCapability]?.join("|") || "state artifact"}`
        );
        continue;
      }
      for (const asset of capableAssets) {
        if (!renderedAssetByPath.has(asset.path)) {
          issue(issues, "critical", "task", `${task.id} selected current-state evidence ${asset.path} is missing from rendered assets`);
        }
      }
      const selectedContent = capableAssets
        .map((asset) => renderedAssetByPath.get(asset.path)?.content || "")
        .join("\n")
        .toLowerCase();
      const needles = subjectNeedles(simulation, requirement.subjectIds);
      if (needles.length > 0 && !needles.some((needle) => selectedContent.includes(needle.toLowerCase()))) {
        issue(issues, "critical", "task", `${task.id} selected current-state evidence for ${requirement.capability} does not contain ${needles.slice(0, 4).join("|")}`);
      }
    }
  }

  const dockerRuns = new Map<string, ReturnType<typeof parseLinuxCommand>>();
  for (const command of simulation.commands) {
    const parsed = parseLinuxCommand(command.renderedCommand);
    commandKinds[parsed.kind] = (commandKinds[parsed.kind] || 0) + 1;
    for (const detail of parsed.issues) issue(issues, "critical", "command", `${command.id}: ${detail}`);
    if (parsed.kind === "docker_run") {
      if (parsed.containerName) dockerRuns.set(parsed.containerName, parsed);
      for (const mount of parsed.mounts || []) {
        if (mount.sourcePath && simulation.files.some((file) => file.path === `${mount.sourcePath}:${mount.destinationPath}`)) {
          issue(issues, "critical", "filesystem", `mount expression was modeled as a file for ${command.id}`);
        }
      }
    }
    if (parsed.kind === "docker_inspect" && parsed.target && !dockerRuns.has(parsed.target) && !rendered.includes(`--name ${parsed.target}`)) {
      issue(issues, "high", "container", `${command.id} inspects nonexistent container ${parsed.target}`);
    }
    if (parsed.kind === "journalctl") {
      const unit = parsed.unit;
      const systemdJournal = assetText(finalAssets, "assets/journal/journal_systemd.txt");
      const sshJournal = assetText(finalAssets, "assets/journal/journal_ssh.txt");
      if (unit && !systemdJournal.includes(unit.replace(/\.service$/, "")) && !(unit.replace(/\.service$/, "") === "ssh" && sshJournal.includes("sshd"))) {
        issue(issues, "high", "task", `${command.id} runs journalctl for ${unit} without matching journal export`);
      }
    }
    const process = processForCommand(simulation, command);
    if (!process) issue(issues, "critical", "process", `${command.id} has no process`);
    if (process && commandIsOneShot(parsed.kind) && process.endedAt && parseTime(process.endedAt) - parseTime(process.startedAt) > 10 * 60 * 1000) {
      issue(issues, "high", "process", `${command.id} one-shot command has implausible long duration`);
    }
  }

  for (const file of simulation.files) {
    if (/^\/[^:\s]+:\/[^:\s]+/.test(file.path)) {
      issue(issues, "critical", "filesystem", `${file.path} is a mount specification, not a filesystem object`);
    }
  }

  for (const process of simulation.processes) {
    const parent = byPid.get(process.ppid);
    if (process.ppid !== 1 && !parent) issue(issues, "critical", "process", `${process.id} parent ${process.ppid} missing`);
    if (parent && parseTime(process.startedAt) < parseTime(parent.startedAt)) {
      issue(issues, "critical", "process", `${process.id} starts before parent`);
    }
    if (parent?.endedAt && parseTime(parent.endedAt) < parseTime(process.startedAt)) {
      issue(issues, "critical", "process", `${process.id} starts after parent exited without reparenting`);
    }
    if (parent && parent.identityId !== process.identityId) {
      const allowed =
        process.executable.includes("sshd") ||
        process.executable.includes("sudo") ||
        process.executable.includes("cron") ||
        process.executable.includes("systemd") ||
        process.effectiveUid === 0 ||
        parent.effectiveUid === 0;
      if (!allowed) issue(issues, "critical", "identity", `${process.id} changes identity without explicit privileged transition`);
    }
  }

  const hasProcessSnapshot = finalAssets.some((asset) => asset.file_path === "assets/runtime/process_snapshot.txt");
  const processSnapshot = assetText(finalAssets, "assets/runtime/process_snapshot.txt");
  const processCapture = captureTimeFrom(processSnapshot, simulation.collection.windowEnd);
  for (const process of simulation.processes) {
    const appears = new RegExp(`\\s${process.pid}\\s+${process.ppid}\\s+`).test(processSnapshot);
    if (!appears) continue;
    if (parseTime(process.startedAt) > parseTime(processCapture)) {
      issue(issues, "critical", "process", `${process.id} appears in snapshot before start`);
    }
    if (process.endedAt && parseTime(process.endedAt) <= parseTime(processCapture)) {
      issue(issues, "critical", "process", `${process.id} appears in snapshot after exit`);
    }
  }

  const openFiles = assetText(finalAssets, "assets/runtime/open_files.txt");
  const permissions = assetText(finalAssets, "assets/reports/permissions_report.txt");
  const listeningPorts = assetText(finalAssets, "assets/network/listening_ports.txt");
  for (const descriptor of simulation.openFileDescriptors || []) {
    const process = simulation.processes.find((item) => item.id === descriptor.processId);
    if (!process) {
      issue(issues, "critical", "process", `${descriptor.id} references missing process ${descriptor.processId}`);
      continue;
    }
    if (descriptor.pid !== process.pid) issue(issues, "critical", "process", `${descriptor.id} PID disagrees with owning process`);
    if (parseTime(descriptor.openedAt) < parseTime(process.startedAt)) {
      issue(issues, "critical", "process", `${descriptor.id} opens before owning process starts`);
    }
    if (descriptor.closedAt && parseTime(descriptor.closedAt) < parseTime(descriptor.openedAt)) {
      issue(issues, "critical", "process", `${descriptor.id} closes before open`);
    }
    if (descriptor.state === "current" && process.endedAt && parseTime(process.endedAt) <= parseTime(processCapture)) {
      issue(issues, "critical", "process", `${descriptor.id} remains current after process exit`);
    }
    const row = descriptor.state === "current" ? openFileRowFor(openFiles, descriptor) : undefined;
    if (descriptor.state === "current" && !row) {
      issue(issues, "critical", "process", `${descriptor.id} current descriptor missing from open_files.txt`);
    }
    if (descriptor.deleted) {
      if (row && !/\(deleted\)/.test(row)) issue(issues, "critical", "filesystem", `${descriptor.id} deleted descriptor lacks deleted marker`);
      if (descriptor.targetPath && permissions.includes(`${descriptor.targetPath} `)) {
        issue(issues, "critical", "filesystem", `${descriptor.id} deleted target appears in current permissions metadata`);
      }
    }
    if (descriptor.targetKind === "socket" && descriptor.localPort === 22 && !/\b0\.0\.0\.0:22\b.*\bsshd\b/i.test(listeningPorts)) {
      issue(issues, "critical", "network", `${descriptor.id} listening socket missing from listener evidence`);
    }
  }

  const serviceInventory = assetText(finalAssets, "assets/reports/service_inventory.txt");
  const serviceRows = serviceInventoryRows(serviceInventory);
  const serviceRowByName = new Map(serviceRows.map((row) => [row.service.toLowerCase(), row]));
  const journalSystemd = assetText(finalAssets, "assets/journal/journal_systemd.txt");
  const timeline = assetText(finalAssets, "assets/evidence/timeline.csv");
  for (const row of serviceRows) {
    if (row.loadState === "not-found" && (row.activeState !== "inactive" || row.startup === "enabled")) {
      issue(issues, "critical", "service", `${row.service} service inventory renders not-found as ${row.startup}/${row.activeState}`);
    }
    if (row.startup === "masked" && row.loadState !== "masked") {
      issue(issues, "critical", "service", `${row.service} service inventory renders masked with load state ${row.loadState}`);
    }
    if (row.activeState === "active" && row.subState === "dead") {
      issue(issues, "critical", "service", `${row.service} service inventory renders active/dead`);
    }
    if (row.activeState === "inactive" && row.subState === "running") {
      issue(issues, "critical", "service", `${row.service} service inventory renders inactive/running`);
    }
    if (row.activeState === "failed" && row.result === "success") {
      issue(issues, "critical", "service", `${row.service} service inventory renders failed with success result`);
    }
    if (row.activeState !== "failed" && row.subState !== "failed" && !["", "none", "success"].includes(row.result)) {
      issue(issues, "critical", "service", `${row.service} service inventory renders failure result ${row.result} without failed state`);
    }
  }
  for (const service of simulation.services) {
    const row = serviceRowByName.get(service.unitName.toLowerCase());
    if (!row) {
      issue(issues, "critical", "service", `${service.unitName} missing from service_inventory.txt`);
      continue;
    }
    const process = service.mainProcessId ? simulation.processes.find((item) => item.id === service.mainProcessId) : undefined;
    const expectedMainPid = process ? String(process.pid) : "";
    const checks: Array<[string, string, string]> = [
      ["status", expectedServiceStatus(service), row.status],
      ["startup", service.unitFileState, row.startup],
      ["load_state", service.loadState, row.loadState],
      ["active_state", service.activeState, row.activeState],
      ["sub_state", service.subState, row.subState],
      ["result", service.result, row.result],
      ["main_pid", expectedMainPid, row.mainPid],
      ["unit_path", service.unitPath, row.unitPath],
    ];
    for (const [field, expected, actual] of checks) {
      if (expected !== actual) {
        issue(issues, "critical", "service", `${service.unitName} service_inventory.txt ${field} expected ${expected || "(blank)"} but rendered ${actual || "(blank)"}`);
      }
    }
    if (hasProcessSnapshot && service.activeState === "active" && service.subState === "running" && process && !processSnapshotContainsPid(processSnapshot, process.pid)) {
      issue(issues, "critical", "service", `${service.unitName} active/running main PID ${process.pid} missing from process_snapshot.txt`);
    }
  }
  for (const transition of simulation.serviceTransitions || []) {
    const service = simulation.services.find((item) => item.id === transition.serviceId);
    if (!service) continue;
    const activityRef = `${service.unitName} ${transition.operation} at ${transition.occurredAt}`;
    const stateText = `state=${transition.resultingState.loadState}/${transition.resultingState.activeState}/${transition.resultingState.subState}`;
    if (!journalSystemd.includes(activityRef) || !journalSystemd.includes(stateText)) {
      issue(issues, "critical", "service", `${service.unitName} journal_systemd transition does not close against ${stateText}`);
    }
    if (!timeline.includes(activityRef)) {
      issue(issues, "critical", "service", `${service.unitName} timeline missing service transition ${activityRef}`);
    }
  }

  const passwdShells = parsePasswdShells(`${assetText(finalAssets, "assets/accounts/passwd.sample")}\n${assetText(finalAssets, "assets/configs/linux_config_pack.txt")}`);
  for (const process of simulation.processes) {
    const identity = simulation.identities.find((item) => item.id === process.identityId);
    const shell = identity ? passwdShells.get(identity.username) : undefined;
    const interactiveShell = /(?:^|\/)(?:bash|sh)$/.test(process.executable) && Boolean(process.tty);
    if (identity && interactiveShell && ["/usr/sbin/nologin", "/bin/false"].includes(shell || "")) {
      issue(issues, "critical", "identity", `${identity.username} has ${shell} but owns interactive shell process ${process.id}`);
    }
  }

  for (const execution of simulation.scheduledExecutions) {
    const definition = simulation.cronDefinitions.find((item) => item.id === execution.definitionId);
    if (definition && !cronMatches(definition.schedule, execution.occurredAt)) {
      issue(issues, "critical", "scheduler", `${execution.id} at ${execution.occurredAt} does not match ${definition.schedule}`);
    }
    if (!definition) {
      issue(issues, "critical", "scheduler", `${execution.id} has no canonical cron definition`);
      continue;
    }
    const command = simulation.commands.find((item) => item.id === execution.commandId);
    const process = simulation.processes.find((item) => item.id === execution.processId);
    const runAs = simulation.identities.find((item) => item.id === definition.runAsIdentityId);
    const cronLog = assetText(finalAssets, "assets/logs/cron.log");
    const syslog = assetText(finalAssets, "assets/logs/syslog");
    const audit = assetText(finalAssets, "assets/logs/audit.log");
    const sourceText = definition.source === "root_crontab"
      ? assetText(finalAssets, "assets/scheduled/root_crontab.txt")
      : assetText(finalAssets, `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`);
    if (definition.enabled && definition.persistenceState === "present") {
      if (!sourceText.includes(definition.id) || !sourceText.includes(definition.schedule) || !sourceText.includes(command?.renderedCommand || "")) {
        issue(issues, "critical", "scheduler", `${definition.id} current cron definition is not rendered with schedule and command`);
      }
      if (definition.source === "cron_d" && runAs && !sourceText.includes(runAs.username)) {
        issue(issues, "critical", "scheduler", `${definition.id} current cron definition lacks run-as ${runAs.username}`);
      }
    } else if (sourceText.includes(definition.id)) {
      issue(issues, "critical", "scheduler", `${definition.id} removed or disabled cron definition is rendered as current persistence`);
    }
    if (definition.createdAt > execution.occurredAt) {
      issue(issues, "critical", "scheduler", `${execution.id} occurs before cron definition ${definition.id} was created`);
    }
    if (definition.removedAt && execution.occurredAt > definition.removedAt) {
      issue(issues, "critical", "scheduler", `${execution.id} occurs after cron definition ${definition.id} was removed`);
    }
    if (execution.commandId !== definition.commandId || command?.runAsIdentityId !== definition.runAsIdentityId || process?.identityId !== definition.runAsIdentityId) {
      issue(issues, "critical", "scheduler", `${execution.id} disagrees with cron definition ${definition.id} command or run-as`);
    }
    const label = linuxLearnerSubjectLabel(simulation, execution.id);
    if (!cronLog.includes(definition.id) || !cronLog.includes(label) || (runAs && !cronLog.includes(`(${runAs.username}) CMD`))) {
      issue(issues, "critical", "scheduler", `${execution.id} cron.log does not close against ${definition.id}`);
    }
    if (!syslog.includes(label) || !syslog.includes(definition.id)) {
      issue(issues, "critical", "scheduler", `${execution.id} syslog does not close against ${definition.id}`);
    }
    if (audit && (!audit.includes(label) || !audit.includes(definition.id))) {
      issue(issues, "critical", "scheduler", `${execution.id} audit.log does not close against ${definition.id}`);
    }
    if (!timeline.includes(label) || !timeline.includes(definition.id)) {
      issue(issues, "critical", "scheduler", `${execution.id} timeline does not close against ${definition.id}`);
    }
  }

  const ufw = assetText(finalAssets, "assets/network/ufw_status.txt");
  const ports = assetText(finalAssets, "assets/network/listening_ports.txt");
  const sshService = simulation.services.find((service) => service.unitName === "ssh.service");
  try {
    const primaryService = canonicalPrimaryService(simulation);
    if (!rendered.includes(primaryService.unitName)) {
      issue(issues, "critical", "service", `primary service ${primaryService.unitName} is absent from rendered evidence`);
    }
  } catch (error) {
    issue(issues, "critical", "service", error instanceof Error ? error.message : "service role model has no primary service");
  }
  for (const session of simulation.sshSessions) {
    if (!ufwAllowsSource(ufw, session.sourceIp, 22)) {
      issue(issues, "critical", "network", `SSH source ${session.sourceIp} is not allowed by firewall evidence`);
    }
    if (!/(?:0\.0\.0\.0|::|\d+\.\d+\.\d+\.\d+):22\b.*\bsshd\b/i.test(ports)) {
      issue(issues, "critical", "network", "SSH session has no active listener evidence");
    }
    if (sshService && sshService.activeState !== "active") {
      issue(issues, "critical", "network", "SSH session succeeds while ssh.service is inactive");
    }
  }

  const groups = parseGroupsCsv(assetText(finalAssets, "assets/csv/groups.csv"));
  const sudoText = `${assetText(finalAssets, "assets/configs/sudoers.d/platform")}\n${assetText(finalAssets, "assets/configs/linux_config_pack.txt")}`;
  for (const line of sudoText.split(/\r?\n/)) {
    if (line.includes("NOPASSWD:")) {
      const specs = splitSudoCommandSpecs(line.split("NOPASSWD:")[1]);
      for (const spec of specs) {
        if (spec && !spec.startsWith("/") && !spec.startsWith("ALL")) {
          issue(issues, "critical", "sudo", `sudoers command spec is not absolute: ${spec}`);
        }
      }
    }
  }
  for (const command of simulation.commands.filter((item) => item.expectedRenderTargets.includes("sudo"))) {
    const actor = simulation.identities.find((item) => item.id === command.actorIdentityId);
    if (!actor) continue;
    const commandText = sudoCommandText(command);
    const actorGroups = groups.get(actor.username) || new Set<string>();
    const decision = resolveCanonicalCommandSudoPolicy({
      simulation,
      sudoPolicyText: sudoText,
      command,
      groups: actorGroups,
    });
    if (decision.status !== "permitted_nopasswd") {
      issue(issues, "critical", "sudo", `${command.id} has successful sudo without matching NOPASSWD effective rule`);
    }
  }

  for (const asset of finalAssets.filter((item) => item.file_path === "assets/logs/sudo.log" || item.file_path === "assets/logs/auth.log")) {
    asset.content.split(/\r?\n/).forEach((line) => {
      if (!/authentication failure/i.test(line)) return;
      const match = line.match(/\b([a-z0-9._-]+)\s+:.*?USER=([a-z0-9:_-]+)\s+;\s+COMMAND=(.+)$/i);
      if (!match) return;
      const [, username, targetUser, commandText] = match;
      const decision = resolveSudoPolicy({
        sudoPolicyText: sudoText,
        username,
        targetUser,
        commandText: commandText.trim(),
        groups: groups.get(username) || new Set<string>(),
      });
      if (decision.status === "permitted_nopasswd") {
        issue(issues, "critical", "sudo", `${asset.file_path} renders authentication failure for NOPASSWD command ${commandText.trim()}`);
      }
    });
  }

  const exactSshd = assetText(finalAssets, "assets/configs/ssh/sshd_config");
  const configPack = assetText(finalAssets, "assets/configs/linux_config_pack.txt");
  for (const directive of ["PasswordAuthentication", "PermitRootLogin", "PubkeyAuthentication"]) {
    const exact = exactSshd.match(new RegExp(`^${directive}\\s+(\\S+)`, "im"))?.[1];
    const summary = configPack.match(new RegExp(`^${directive}\\s+(\\S+)`, "im"))?.[1];
    if (exact && summary && exact !== summary) issue(issues, "high", "provenance", `linux_config_pack contradicts sshd_config for ${directive}`);
  }

  const authLog = assetText(finalAssets, "assets/logs/auth.log");
  const usersCsv = assetText(finalAssets, "assets/csv/users.csv");
  for (const session of simulation.sshSessions) {
    const latestAuth = authLog.match(new RegExp(`(20\\d\\d-\\d\\d-\\d\\d \\d\\d:\\d\\d):\\d\\d .*Accepted \\S+ for ${session.username}\\b`))?.[1];
    const row = usersCsv.split(/\r?\n/).find((line) => line.startsWith(`${session.username},`));
    const lastLogin = row?.match(/(20\d\d-\d\d-\d\d \d\d:\d\d)/)?.[1];
    if (latestAuth && lastLogin && lastLogin < latestAuth) {
      issue(issues, "high", "provenance", `${session.username} users.csv last_login predates successful auth`);
    }
  }

  for (const asset of finalAssets.filter((item) => /authorized_keys|known_hosts|host_.*key/i.test(item.file_path))) {
    for (const line of asset.content.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const keyPart = asset.file_path.includes("known_hosts") ? line.replace(/^\S+\s+/, "") : line;
      if (!validatePublicKeyLine(keyPart)) {
        issue(issues, "critical", "crypto", `${asset.file_path} contains implausible or placeholder public key material`);
      }
    }
  }

  for (const asset of finalAssets.filter((item) => item.file_path.endsWith("risk_register.csv"))) {
    const rows = asset.content.trim().split(/\r?\n/);
    const header = parseLinuxCsvLine(rows[0] || "").values;
    const evidenceIndex = header.indexOf("evidence");
    const subjectIndex = header.indexOf("subject_refs") >= 0
      ? header.indexOf("subject_refs")
      : header.indexOf("subject_ids");
    for (const [index, rowText] of rows.slice(1).entries()) {
      const row = parseLinuxCsvLine(rowText).values;
      const evidence = evidenceIndex >= 0 ? row[evidenceIndex] || "" : "";
      const subjects = subjectIndex >= 0 ? row[subjectIndex] || "" : "";
      if (!evidence.trim()) issue(issues, "high", "risk", `${asset.file_path}:${index + 2} lacks evidence citation`);
      if (subjectIndex >= 0 && !subjects.trim()) issue(issues, "high", "risk", `${asset.file_path}:${index + 2} lacks subject references`);
      if (/restricted/i.test(rowText) && !/security_policy|classification|policy/i.test(evidence)) {
        issue(issues, "high", "risk", `${asset.file_path}:${index + 2} makes sensitivity claim without classification evidence`);
      }
      if (/image provenance/i.test(rowText) && !/docker|image|evidence_gap|gap/i.test(rowText)) {
        issue(issues, "high", "risk", `${asset.file_path}:${index + 2} image provenance claim lacks image or gap context`);
      }
    }
  }

  for (const task of simulation.canonicalTasks) {
    const selectedPaths = task.selectedEvidenceAssetIds.map((id) => simulation.evidenceRegistry.find((asset) => asset.id === id)?.path || id);
    if (task.intent === "service_state" && !selectedPaths.some((path) => /journal_systemd|service_inventory|syslog/.test(path))) {
      issue(issues, "high", "task", `${task.id} lacks scoped service-state evidence`);
    }
    if (task.intent === "actor_attribution" && !authLog.includes("Accepted")) {
      issue(issues, "high", "task", `${task.id} lacks authentication evidence`);
    }
  }

  const metrics = {
    command: 0,
    identity: 0,
    process: 0,
    filesystem: 0,
    container: 0,
    scheduler: 0,
    network: 0,
    service: 0,
    sudo: 0,
    provenance: 0,
    risk: 0,
    crypto: 0,
    task: 0,
    commandKinds,
  };
  for (const item of issues) metrics[item.category] += 1;

  return {
    passed: !issues.some((item) => item.severity === "critical" || item.severity === "high"),
    issues,
    metrics,
  } satisfies LinuxSemanticClosureResult;
}

export { parseLinuxCommand, parseDockerMount };
