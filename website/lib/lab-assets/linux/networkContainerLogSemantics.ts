import type { CanonicalOpenFileDescriptor, CanonicalProcess, LinuxSimulationWorld } from "./simulation";

export type LinuxNetworkContainerLogSemanticCheck = {
  code: string;
  message: string;
  passed: boolean;
};

export type LinuxNetworkContainerLogSemanticIssue = {
  code: string;
  severity: "critical" | "high" | "medium";
  category:
    | "network"
    | "firewall"
    | "reverse_shell"
    | "docker"
    | "log"
    | "kernel"
    | "role"
    | "cross_domain"
    | "artifact";
  message: string;
  filePath?: string;
  evidence?: string;
};

export type LinuxNetworkContainerLogSemanticReport = {
  status: "valid" | "invalid";
  interfaceChecks: LinuxNetworkContainerLogSemanticCheck[];
  routeChecks: LinuxNetworkContainerLogSemanticCheck[];
  socketChecks: LinuxNetworkContainerLogSemanticCheck[];
  listenerChecks: LinuxNetworkContainerLogSemanticCheck[];
  firewallChecks: LinuxNetworkContainerLogSemanticCheck[];
  reverseShellChecks: LinuxNetworkContainerLogSemanticCheck[];
  dockerDaemonChecks: LinuxNetworkContainerLogSemanticCheck[];
  containerLifecycleChecks: LinuxNetworkContainerLogSemanticCheck[];
  containerProcessChecks: LinuxNetworkContainerLogSemanticCheck[];
  containerMountChecks: LinuxNetworkContainerLogSemanticCheck[];
  logLifecycleChecks: LinuxNetworkContainerLogSemanticCheck[];
  logTamperingChecks: LinuxNetworkContainerLogSemanticCheck[];
  kernelTelemetryChecks: LinuxNetworkContainerLogSemanticCheck[];
  roleRealismChecks: LinuxNetworkContainerLogSemanticCheck[];
  crossDomainChecks: LinuxNetworkContainerLogSemanticCheck[];
  renderedArtifactChecks: LinuxNetworkContainerLogSemanticCheck[];
  issues: LinuxNetworkContainerLogSemanticIssue[];
};

type AssetLike = { file_path: string; content: string };
type Bucket = keyof Omit<LinuxNetworkContainerLogSemanticReport, "status" | "issues">;

export const LINUX_PHASE6D_STABLE_ISSUE_CODES = [
  "LINUX_NETWORK_INTERFACE_INVALID",
  "LINUX_NETWORK_ROUTE_INVALID",
  "LINUX_NETWORK_ENDPOINT_INVALID",
  "LINUX_NETWORK_CONNECTION_INCONSISTENT",
  "LINUX_NETWORK_SOCKET_PROCESS_MISMATCH",
  "LINUX_NETWORK_LISTENER_STATE_MISMATCH",
  "LINUX_FIREWALL_RULE_INVALID",
  "LINUX_FIREWALL_DECISION_MISMATCH",
  "LINUX_NETWORK_REACHABILITY_UNSUPPORTED",
  "LINUX_REVERSE_SHELL_PROCESS_MISSING",
  "LINUX_REVERSE_SHELL_CONNECTION_MISSING",
  "LINUX_REVERSE_SHELL_ENDPOINT_MISMATCH",
  "LINUX_REVERSE_SHELL_CLAIM_UNSUPPORTED",
  "LINUX_DOCKER_DAEMON_MISSING",
  "LINUX_DOCKER_SOCKET_ACCESS_INVALID",
  "LINUX_DOCKER_CONTAINER_LIFECYCLE_INVALID",
  "LINUX_DOCKER_PROCESS_MISMATCH",
  "LINUX_DOCKER_IMAGE_PROVENANCE_UNSUPPORTED",
  "LINUX_DOCKER_MOUNT_INVALID",
  "LINUX_DOCKER_PUBLISHED_PORT_MISMATCH",
  "LINUX_DOCKER_COMPROMISE_CLAIM_UNSUPPORTED",
  "LINUX_LOG_ROTATION_INVALID",
  "LINUX_LOG_TRUNCATION_UNSUPPORTED",
  "LINUX_LOG_DELETION_UNSUPPORTED",
  "LINUX_LOG_MODIFICATION_UNSUPPORTED",
  "LINUX_LOG_TAMPERING_CLAIM_UNSUPPORTED",
  "LINUX_LOG_GAP_UNEXPLAINED",
  "LINUX_KERNEL_EVENT_UNGROUNDED",
  "LINUX_SECURITY_CONTROL_EVENT_MISMATCH",
  "LINUX_ROLE_NETWORK_REALISM_MISMATCH",
  "LINUX_CROSS_DOMAIN_RELATIONSHIP_INVALID",
] as const;

function assetText(assets: AssetLike[] | undefined, path: string) {
  return assets?.find((asset) => asset.file_path === path)?.content || "";
}

function addIssue(report: LinuxNetworkContainerLogSemanticReport, bucket: Bucket, issue: LinuxNetworkContainerLogSemanticIssue) {
  report.issues.push(issue);
  report[bucket].push({ code: issue.code, message: issue.message, passed: false });
}

function addPass(report: LinuxNetworkContainerLogSemanticReport, bucket: Bucket, code: string, message: string) {
  if (!report[bucket].some((check) => check.code === code && !check.passed)) {
    report[bucket].push({ code, message, passed: true });
  }
}

function ts(value: string | undefined) {
  if (!value) return Number.NaN;
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function isAlive(process: CanonicalProcess | undefined, timestamp: string) {
  return Boolean(process && process.startedAt <= timestamp && (!process.endedAt || process.endedAt > timestamp));
}

function validPort(port: number | undefined) {
  return Number.isInteger(port) && port! >= 1 && port! <= 65535;
}

function ipv4ToNumber(value: string) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function isIpv4(value: string | undefined) {
  return value !== undefined && ipv4ToNumber(value) !== undefined;
}

function cidrContains(cidr: string | undefined, ip: string | undefined) {
  if (!cidr || !ip) return false;
  const [base, prefixText = "32"] = cidr.split("/");
  const baseNumber = ipv4ToNumber(base);
  const ipNumber = ipv4ToNumber(ip);
  const prefix = Number(prefixText);
  if (baseNumber === undefined || ipNumber === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (baseNumber & mask) === (ipNumber & mask);
}

function sameConnectedNetwork(left: string | undefined, right: string | undefined, prefix = 24) {
  if (!left || !right) return false;
  return cidrContains(`${left.split(".").slice(0, 3).join(".")}.0/${prefix}`, right);
}

function parseListenerRows(content: string) {
  return content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).slice(1).map((line) => {
    const match = line.match(/^(\S+)\s+(\S+)\s+(\S+):(\d+)\s+(.+?)(?:\s+pid=(\d+))?$/);
    return match ? {
      protocol: match[1].toLowerCase(),
      state: match[2].toLowerCase(),
      localAddress: match[3],
      localPort: Number(match[4]),
      processName: match[5].trim(),
      pid: match[6] ? Number(match[6]) : undefined,
      raw: line,
    } : { raw: line };
  });
}

function descriptorEndpoint(descriptor: CanonicalOpenFileDescriptor) {
  return `${descriptor.protocol || "tcp"}:${descriptor.localAddress || ""}:${descriptor.localPort || ""}:${descriptor.remoteAddress || ""}:${descriptor.remotePort || ""}`;
}

function renderedUfwAllows(ufw: string, sourceIp: string, port: number) {
  if (/^Status:\s+inactive/im.test(ufw)) return true;
  return ufw.split(/\r?\n/).some((line) => {
    if (!new RegExp(`\\b${port}/tcp\\b`).test(line) || !/\bALLOW\b/i.test(line)) return false;
    return line.includes(sourceIp) || line.includes("Anywhere") || line.includes("/24") || line.includes("/16");
  });
}

function validateNetwork(report: LinuxNetworkContainerLogSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  const routing = assetText(finalAssets, "assets/network/routing_table.txt");
  const listening = assetText(finalAssets, "assets/network/listening_ports.txt");
  const openFiles = assetText(finalAssets, "assets/runtime/open_files.txt");
  const ufw = assetText(finalAssets, "assets/network/ufw_status.txt");
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));
  const captureAt = simulation.collection.windowEnd;

  if (!isIpv4(simulation.investigation.hostIp)) {
    addIssue(report, "interfaceChecks", {
      code: "LINUX_NETWORK_INTERFACE_INVALID",
      severity: "critical",
      category: "network",
      message: `Host IP ${simulation.investigation.hostIp} is not a valid IPv4 address.`,
    });
  }
  if (routing && !routing.includes(`src ${simulation.investigation.hostIp}`)) {
    addIssue(report, "routeChecks", {
      code: "LINUX_NETWORK_ROUTE_INVALID",
      severity: "critical",
      category: "network",
      message: `routing_table.txt does not render preferred source ${simulation.investigation.hostIp}.`,
      filePath: "assets/network/routing_table.txt",
    });
  }
  if (routing && (!routing.includes(`default via ${simulation.investigation.gateway}`) || !sameConnectedNetwork(simulation.investigation.hostIp, simulation.investigation.gateway))) {
    addIssue(report, "routeChecks", {
      code: "LINUX_NETWORK_ROUTE_INVALID",
      severity: "critical",
      category: "network",
      message: `Default route gateway ${simulation.investigation.gateway} is missing or not on the host network.`,
      filePath: "assets/network/routing_table.txt",
    });
  }

  for (const descriptor of simulation.openFileDescriptors.filter((item) => item.targetKind === "socket")) {
    const process = processById.get(descriptor.processId);
    if (!process || descriptor.pid !== process.pid) {
      addIssue(report, "socketChecks", {
        code: "LINUX_NETWORK_SOCKET_PROCESS_MISMATCH",
        severity: "critical",
        category: "network",
        message: `${descriptor.id} references missing or mismatched process ${descriptor.processId}.`,
      });
      continue;
    }
    if (descriptor.state === "current" && !isAlive(process, captureAt)) {
      addIssue(report, "socketChecks", {
        code: "LINUX_NETWORK_SOCKET_PROCESS_MISMATCH",
        severity: "critical",
        category: "network",
        message: `${descriptor.id} remains current after process ${process.id} ended.`,
      });
    }
    if (descriptor.openedAt < process.startedAt || (descriptor.closedAt && descriptor.closedAt < descriptor.openedAt)) {
      addIssue(report, "socketChecks", {
        code: "LINUX_NETWORK_CONNECTION_INCONSISTENT",
        severity: "critical",
        category: "network",
        message: `${descriptor.id} socket chronology is outside owning process lifetime.`,
      });
    }
    if (!validPort(descriptor.localPort) || (descriptor.remotePort !== undefined && !validPort(descriptor.remotePort))) {
      addIssue(report, "socketChecks", {
        code: "LINUX_NETWORK_ENDPOINT_INVALID",
        severity: "critical",
        category: "network",
        message: `${descriptor.id} has invalid endpoint ${descriptorEndpoint(descriptor)}.`,
      });
    }
    if (openFiles && descriptor.descriptorType === "listening_socket" && descriptor.state === "current" && !openFiles.includes(`${descriptor.protocol || "tcp"} ${descriptor.localAddress || "local"}:${descriptor.localPort || ""}`)) {
      addIssue(report, "listenerChecks", {
        code: "LINUX_NETWORK_LISTENER_STATE_MISMATCH",
        severity: "critical",
        category: "network",
        message: `${descriptor.id} current listener is missing from open_files.txt.`,
        filePath: "assets/runtime/open_files.txt",
      });
    }
  }

  for (const row of listening ? parseListenerRows(listening) : []) {
    if (!("state" in row)) {
      addIssue(report, "listenerChecks", {
        code: "LINUX_NETWORK_ENDPOINT_INVALID",
        severity: "critical",
        category: "artifact",
        message: `Could not parse listener row: ${row.raw}`,
        filePath: "assets/network/listening_ports.txt",
      });
      continue;
    }
    const renderedState = row.state || "";
    if (!validPort(row.localPort) || !["listen", "estab"].includes(renderedState)) {
      addIssue(report, "listenerChecks", {
        code: "LINUX_NETWORK_ENDPOINT_INVALID",
        severity: "critical",
        category: "network",
        message: `Rendered listener row has invalid state or port: ${row.raw}`,
        filePath: "assets/network/listening_ports.txt",
      });
    }
    if (!row.pid) {
      addIssue(report, "listenerChecks", {
        code: "LINUX_NETWORK_LISTENER_STATE_MISMATCH",
        severity: "critical",
        category: "network",
        message: `Rendered listener row lacks owning PID: ${row.raw}`,
        filePath: "assets/network/listening_ports.txt",
      });
      continue;
    }
    const process = simulation.processes.find((item) => item.pid === row.pid);
    if (!isAlive(process, captureAt)) {
      addIssue(report, "listenerChecks", {
        code: "LINUX_NETWORK_LISTENER_STATE_MISMATCH",
        severity: "critical",
        category: "network",
        message: `Rendered listener PID ${row.pid} is not live at capture.`,
        filePath: "assets/network/listening_ports.txt",
      });
    }
    if (row.state === "listen") {
      const matchingDescriptor = simulation.openFileDescriptors.some((descriptor) =>
        descriptor.state === "current" &&
        descriptor.descriptorType === "listening_socket" &&
        descriptor.pid === row.pid &&
        descriptor.localPort === row.localPort
      );
      if (!matchingDescriptor) {
        addIssue(report, "listenerChecks", {
          code: "LINUX_NETWORK_LISTENER_STATE_MISMATCH",
          severity: "critical",
          category: "network",
          message: `Rendered listener ${row.raw} has no current canonical socket descriptor.`,
          filePath: "assets/network/listening_ports.txt",
        });
      }
    }
  }

  for (const session of ufw ? simulation.sshSessions : []) {
    if (!renderedUfwAllows(ufw, session.sourceIp, 22)) {
      addIssue(report, "firewallChecks", {
        code: "LINUX_FIREWALL_DECISION_MISMATCH",
        severity: "critical",
        category: "firewall",
        message: `Successful SSH session from ${session.sourceIp} is not allowed by rendered UFW policy.`,
        filePath: "assets/network/ufw_status.txt",
      });
    }
  }

  addPass(report, "interfaceChecks", "LINUX_NETWORK_INTERFACES_VALIDATED", "Host interface facts were checked.");
  addPass(report, "routeChecks", "LINUX_NETWORK_ROUTES_VALIDATED", "Routes were checked against host addressing.");
  addPass(report, "socketChecks", "LINUX_NETWORK_SOCKETS_VALIDATED", "Canonical sockets were checked.");
  addPass(report, "listenerChecks", "LINUX_NETWORK_LISTENERS_VALIDATED", "Rendered listeners were checked against canonical sockets.");
  addPass(report, "firewallChecks", "LINUX_FIREWALL_DECISIONS_VALIDATED", "Rendered UFW policy was checked against observed sessions.");
}

function validateReverseShell(report: LinuxNetworkContainerLogSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  if (simulation.investigation.incidentFamily !== "reverse_shell") {
    addPass(report, "reverseShellChecks", "LINUX_REVERSE_SHELL_NOT_APPLICABLE", "No reverse-shell incident selected.");
    return;
  }
  const listening = assetText(finalAssets, "assets/network/listening_ports.txt");
  const audit = assetText(finalAssets, "assets/logs/audit.log");
  const processHistory = assetText(finalAssets, "assets/runtime/process_execution_history.txt");
  const command = simulation.commands.find((item) => /\/dev\/tcp\/|nc\s|netcat|socat|python|perl|php/i.test(item.renderedCommand));
  const process = command ? simulation.processes.find((item) => item.pid === command.processId) : undefined;
  const remote = simulation.investigation.externalIps[0];
  if (!listening && !audit && !processHistory) {
    addPass(report, "reverseShellChecks", "LINUX_REVERSE_SHELL_NOT_RENDERED", "Reverse-shell advanced evidence was not rendered for this difficulty.");
    return;
  }
  if (!command || !process) {
    addIssue(report, "reverseShellChecks", {
      code: "LINUX_REVERSE_SHELL_PROCESS_MISSING",
      severity: "critical",
      category: "reverse_shell",
      message: "Reverse-shell investigation lacks a canonical command/process candidate.",
    });
    return;
  }
  if (!listening.includes(`${remote}:4444`) || !listening.includes("ESTAB")) {
    addIssue(report, "reverseShellChecks", {
      code: "LINUX_REVERSE_SHELL_CONNECTION_MISSING",
      severity: "critical",
      category: "reverse_shell",
      message: `Reverse-shell candidate lacks rendered established connection to ${remote}:4444.`,
      filePath: "assets/network/listening_ports.txt",
    });
  }
  if (!audit.includes(command.renderedCommand) || !processHistory.includes(String(process.pid))) {
    addIssue(report, "crossDomainChecks", {
      code: "LINUX_CROSS_DOMAIN_RELATIONSHIP_INVALID",
      severity: "critical",
      category: "cross_domain",
      message: `Reverse-shell command ${command.id} is not linked across audit and process evidence.`,
    });
  }
  if (!/\/dev\/tcp\/[^/]+\/4444|(?:nc|netcat|socat).*4444|python.*4444|perl.*4444|php.*4444/i.test(command.renderedCommand)) {
    addIssue(report, "reverseShellChecks", {
      code: "LINUX_REVERSE_SHELL_ENDPOINT_MISMATCH",
      severity: "critical",
      category: "reverse_shell",
      message: `Reverse-shell command form does not deterministically expose expected endpoint: ${command.renderedCommand}.`,
    });
  }
  addPass(report, "reverseShellChecks", "LINUX_REVERSE_SHELL_VALIDATED", "Reverse-shell process and connection evidence were checked.");
}

function validateDocker(report: LinuxNetworkContainerLogSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  const dockerRelevant = simulation.investigation.incidentFamily === "docker_compromise" || simulation.services.some((service) => service.unitName === "docker.service");
  if (!dockerRelevant) {
    addPass(report, "dockerDaemonChecks", "LINUX_DOCKER_NOT_APPLICABLE", "No Docker domain selected.");
    return;
  }
  const serviceInventory = assetText(finalAssets, "assets/reports/service_inventory.txt");
  const openFiles = assetText(finalAssets, "assets/runtime/open_files.txt");
  const fileAccess = assetText(finalAssets, "assets/runtime/file_access_history.csv");
  const group = `${assetText(finalAssets, "assets/accounts/group.sample")}\n${assetText(finalAssets, "assets/csv/groups.csv")}`;
  const dockerService = simulation.services.find((service) => service.unitName === "docker.service");
  const dockerProcess = dockerService?.mainProcessId ? simulation.processes.find((process) => process.id === dockerService.mainProcessId) : undefined;
  if (dockerService?.activeState === "active" && !dockerProcess) {
    addIssue(report, "dockerDaemonChecks", {
      code: "LINUX_DOCKER_DAEMON_MISSING",
      severity: "critical",
      category: "docker",
      message: "docker.service is active without a canonical daemon process.",
    });
  }
  if (serviceInventory && dockerService && !serviceInventory.includes("docker.service")) {
    addIssue(report, "dockerDaemonChecks", {
      code: "LINUX_DOCKER_DAEMON_MISSING",
      severity: "critical",
      category: "docker",
      message: "docker.service is missing from service inventory.",
      filePath: "assets/reports/service_inventory.txt",
    });
  }
  const dockerCommands = simulation.commands.filter((command) => /\bdocker\s+(?:run|inspect|ps|exec|cp)\b/i.test(command.renderedCommand));
  for (const command of dockerCommands) {
    const process = simulation.processes.find((item) => item.pid === command.processId);
    if (!process) {
      addIssue(report, "containerLifecycleChecks", {
        code: "LINUX_DOCKER_PROCESS_MISMATCH",
        severity: "critical",
        category: "docker",
        message: `${command.id} has no owning Docker CLI process.`,
      });
    }
    if (fileAccess && (!command.affectedFileIds.some((fileId) => simulation.files.find((file) => file.id === fileId)?.path === "/var/run/docker.sock") || !fileAccess.includes("/var/run/docker.sock"))) {
      addIssue(report, "dockerDaemonChecks", {
        code: "LINUX_DOCKER_SOCKET_ACCESS_INVALID",
        severity: "critical",
        category: "docker",
        message: `${command.id} does not close against canonical Docker socket file access.`,
      });
    }
    if (/\bdocker\s+run\b/i.test(command.renderedCommand)) {
      if (!/--name\s+\S+/.test(command.renderedCommand) || !/:\d{4}\.\d{2}|sha256:|registry\.local/.test(command.renderedCommand)) {
        addIssue(report, "containerLifecycleChecks", {
          code: "LINUX_DOCKER_IMAGE_PROVENANCE_UNSUPPORTED",
          severity: "high",
          category: "docker",
          message: `${command.id} Docker run lacks image provenance support.`,
        });
      }
      const mount = command.renderedCommand.match(/-v\s+([^:\s]+):([^:\s]+):?(ro|rw)?/);
      if (mount && !simulation.files.some((file) => file.path === mount[1])) {
        addIssue(report, "containerMountChecks", {
          code: "LINUX_DOCKER_MOUNT_INVALID",
          severity: "critical",
          category: "docker",
          message: `${command.id} bind mount source ${mount[1]} is not a canonical host file or directory.`,
        });
      }
    }
  }
  if (/\bdocker:x:\d+:/i.test(group) && simulation.investigation.incidentFamily === "docker_compromise" && !/\bdocker:x:\d+:.*\w/.test(group)) {
    addIssue(report, "dockerDaemonChecks", {
      code: "LINUX_DOCKER_SOCKET_ACCESS_INVALID",
      severity: "critical",
      category: "docker",
      message: "Docker-compromise investigation lacks rendered docker group access context.",
    });
  }
  if (openFiles.includes("/var/run/docker.sock") && dockerCommands.length === 0 && simulation.investigation.incidentFamily === "docker_compromise") {
    addIssue(report, "crossDomainChecks", {
      code: "LINUX_CROSS_DOMAIN_RELATIONSHIP_INVALID",
      severity: "critical",
      category: "cross_domain",
      message: "Docker socket evidence is present without a canonical Docker command.",
    });
  }
  addPass(report, "dockerDaemonChecks", "LINUX_DOCKER_DAEMON_VALIDATED", "Docker daemon and socket access were checked.");
  addPass(report, "containerLifecycleChecks", "LINUX_DOCKER_CONTAINER_LIFECYCLE_VALIDATED", "Docker command/container lifecycle evidence was checked.");
  addPass(report, "containerMountChecks", "LINUX_DOCKER_MOUNTS_VALIDATED", "Docker mount evidence was checked.");
  addPass(report, "containerProcessChecks", "LINUX_DOCKER_PROCESSES_VALIDATED", "Docker process evidence was checked.");
}

function validateLogsAndKernel(report: LinuxNetworkContainerLogSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  const audit = assetText(finalAssets, "assets/logs/audit.log");
  const fileHistory = assetText(finalAssets, "assets/runtime/file_access_history.csv");
  const kern = assetText(finalAssets, "assets/logs/kern.log");
  const risk = assetText(finalAssets, "assets/evidence/advanced_risk_register.csv");
  if (simulation.investigation.incidentFamily === "log_tampering" && audit && fileHistory) {
    const truncCommand = simulation.commands.find((command) => /\btruncate\b.*\/var\/log\//i.test(command.renderedCommand));
    const logrotateCommand = simulation.commands.find((command) => /\blogrotate\b/i.test(command.renderedCommand));
    if (!truncCommand || !audit.includes(truncCommand.renderedCommand) || !fileHistory.includes("/var/log/auth.log")) {
      addIssue(report, "logTamperingChecks", {
        code: "LINUX_LOG_TRUNCATION_UNSUPPORTED",
        severity: "critical",
        category: "log",
        message: "Log-tampering investigation lacks truncation command plus audit/file lifecycle support.",
      });
    }
    if (risk && /confirmed (?:tampering|truncation|deletion)|tampering confirmed/i.test(risk) && !truncCommand) {
      addIssue(report, "logTamperingChecks", {
        code: "LINUX_LOG_TAMPERING_CLAIM_UNSUPPORTED",
        severity: "critical",
        category: "log",
        message: "Rendered risk evidence asserts confirmed tampering without canonical truncation evidence.",
      });
    }
    if (logrotateCommand && /tampering/i.test(assetText(finalAssets, "assets/logs/cron.log"))) {
      addIssue(report, "logLifecycleChecks", {
        code: "LINUX_LOG_ROTATION_INVALID",
        severity: "high",
        category: "log",
        message: "Normal logrotate activity is labeled as tampering.",
      });
    }
  }
  for (const line of kern.split(/\r?\n/).filter(Boolean)) {
    if (/apparmor=/i.test(line) && /profile="/.test(line) && !/profile="(?:usr\.sbin\.sshd|usr\.sbin\.rsyslogd|snap-update-ns\.firefox|docker-default)"/.test(line)) {
      addIssue(report, "kernelTelemetryChecks", {
        code: "LINUX_SECURITY_CONTROL_EVENT_MISMATCH",
        severity: "critical",
        category: "kernel",
        message: `Kernel AppArmor line references unsupported profile: ${line}`,
        filePath: "assets/logs/kern.log",
      });
    }
    if (/DROP|DENIED|REJECT/i.test(line) && !simulation.openFileDescriptors.some((descriptor) => descriptor.targetKind === "socket")) {
      addIssue(report, "kernelTelemetryChecks", {
        code: "LINUX_KERNEL_EVENT_UNGROUNDED",
        severity: "critical",
        category: "kernel",
        message: `Kernel network/security line is ungrounded: ${line}`,
        filePath: "assets/logs/kern.log",
      });
    }
  }
  addPass(report, "logLifecycleChecks", "LINUX_LOG_LIFECYCLE_VALIDATED", "Log lifecycle evidence was checked.");
  addPass(report, "logTamperingChecks", "LINUX_LOG_TAMPERING_VALIDATED", "Log tampering claims were checked.");
  addPass(report, "kernelTelemetryChecks", "LINUX_KERNEL_TELEMETRY_VALIDATED", "Kernel/security-control telemetry was checked.");
}

function validateRoleAndCrossDomain(report: LinuxNetworkContainerLogSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  const listening = assetText(finalAssets, "assets/network/listening_ports.txt");
  const role = simulation.investigation.hostRole.toLowerCase();
  if (listening && ((role.includes("database") && /\b0\.0\.0\.0:5432\b/.test(listening)) || (role.includes("proxy") && !/:(?:80|443|3128|8080)\b/.test(listening)))) {
    addIssue(report, "roleRealismChecks", {
      code: "LINUX_ROLE_NETWORK_REALISM_MISMATCH",
      severity: "high",
      category: "role",
      message: `${simulation.investigation.hostRole} listener posture contradicts role expectations.`,
      filePath: "assets/network/listening_ports.txt",
    });
  }
  for (const transition of simulation.serviceTransitions) {
    const service = simulation.services.find((item) => item.id === transition.serviceId);
    if (!service || service.activeState !== "active" || service.subState !== "running") continue;
    const listener = simulation.openFileDescriptors.find((descriptor) => descriptor.relatedServiceId === service.id && descriptor.descriptorType === "listening_socket");
    if (/^(?:ssh|nginx|apache2|docker|containerd|bind9|postfix|postgresql|prometheus|rsync|backup-agent)\.service$/.test(service.unitName) && !listener) {
      addIssue(report, "crossDomainChecks", {
        code: "LINUX_CROSS_DOMAIN_RELATIONSHIP_INVALID",
        severity: "critical",
        category: "cross_domain",
        message: `${service.unitName} is active/running but lacks canonical listener relationship.`,
      });
    }
  }
  addPass(report, "roleRealismChecks", "LINUX_ROLE_NETWORK_REALISM_VALIDATED", "Role/listener realism was checked.");
  addPass(report, "crossDomainChecks", "LINUX_CROSS_DOMAIN_RELATIONSHIPS_VALIDATED", "Cross-domain relationships were checked.");
  addPass(report, "renderedArtifactChecks", "LINUX_PHASE6D_RENDERED_ARTIFACTS_VALIDATED", "Rendered network/container/log artifacts were checked.");
}

export function buildLinuxNetworkContainerLogSemanticReport(input: {
  simulation: LinuxSimulationWorld;
  finalAssets?: AssetLike[];
}): LinuxNetworkContainerLogSemanticReport {
  const report: LinuxNetworkContainerLogSemanticReport = {
    status: "valid",
    interfaceChecks: [],
    routeChecks: [],
    socketChecks: [],
    listenerChecks: [],
    firewallChecks: [],
    reverseShellChecks: [],
    dockerDaemonChecks: [],
    containerLifecycleChecks: [],
    containerProcessChecks: [],
    containerMountChecks: [],
    logLifecycleChecks: [],
    logTamperingChecks: [],
    kernelTelemetryChecks: [],
    roleRealismChecks: [],
    crossDomainChecks: [],
    renderedArtifactChecks: [],
    issues: [],
  };
  validateNetwork(report, input.simulation, input.finalAssets);
  validateReverseShell(report, input.simulation, input.finalAssets);
  validateDocker(report, input.simulation, input.finalAssets);
  validateLogsAndKernel(report, input.simulation, input.finalAssets);
  validateRoleAndCrossDomain(report, input.simulation, input.finalAssets);
  report.status = report.issues.length ? "invalid" : "valid";
  return report;
}
