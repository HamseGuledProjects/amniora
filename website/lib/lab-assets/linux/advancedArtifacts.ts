import type { LabAsset } from "../types";
import type { LinuxAssetInput } from "./types";
import { getLinuxIncidentProfile } from "./incidentProfiles";
import { csvRow, incidentClock, incidentTimestamp, sortLogLines } from "./investigation";
import { buildIncidentEventGraph } from "./eventGraph";
import {
  canonicalAuditMode,
  canonicalFile,
  canonicalIdentity,
  canonicalModeString,
  auditQuoted,
  renderCommandInvocation,
  simulationJournalSystemd,
  simulationServiceAuditLines,
  simulationBackgroundAuditLines,
  simulationBackgroundSyslogLines,
  simulationCronLog,
  simulationRootCrontab,
  simulationCronDAssets,
  simulationPackageInventory,
  simulationAptHistory,
  simulationScriptSample,
  simulationScriptAssets,
  linuxLearnerSubjectList,
  canonicalHistoricalFileAccessRecords,
  canonicalProcessRuntimeEndAt,
} from "./simulation";
import { deterministicFingerprint, deterministicPublicKey } from "./cryptographicEvidence";
import { renderedSudoPolicyText } from "./sudoPolicy";
import {
  renderBackgroundAuditLines,
  renderBackgroundJournalSshLines,
} from "./backgroundActivity";
import {
  buildEnterpriseHosts,
  identityFor,
  enterpriseIdentities,
  buildPackageRows,
  buildProcessRows,
  hostActivityProfile,
  roleKind,
  roleServices,
  roleTasks,
  timeAt,
} from "./noise";
import { linuxCanonicalIncidentSubjectIds, linuxLearnerReviewSubjectIds } from "./grounding";
import { formatLinuxLearnerDocumentDateTime, formatLinuxLearnerDocumentWindow } from "./time";
import { linuxIndependentReviewQuestions, linuxContainerEvidenceBoundary, linuxDifficultyReviewGuidance } from "./learnerQa";
import { linuxApprovalGapFinding, linuxApprovalStatusSentence } from "./claimAuthority";

function asset(
  file_name: string,
  file_type: string,
  file_path: string,
  content: string
): LabAsset {
  return { file_name, file_type, file_path, content };
}

function logAsset(
  file_name: string,
  file_type: string,
  file_path: string,
  content: string
): LabAsset {
  return asset(file_name, file_type, file_path, `${sortLogLines(content)}\n`);
}

function renderedTime(context: LinuxAssetInput, offsetSeconds: number) {
  return incidentTimestamp(context.investigation, offsetSeconds);
}

function suspiciousService({ incident }: LinuxAssetInput) {
  if (incident.id === "systemd_persistence") return "metrics-cache.service";
  if (incident.id === "docker_compromise") return "docker.service";
  if (incident.id === "reverse_shell") return "apache2.service";
  if (incident.id === "unauthorized_package_install") return "manual-package-transaction";
  if (incident.id === "cron_persistence") return "cron.service";
  return incident.affectedService;
}

function scriptPath({ incident, world }: LinuxAssetInput) {
  if (incident.id === "cron_persistence") {
    return `/usr/local/sbin/${world.department.toLowerCase().replace(/\s+/g, "-")}-sync.sh`;
  }

  if (incident.id === "data_staging") {
    return `/tmp/${world.caseId.toLowerCase()}-collect.sh`;
  }

  if (incident.id === "reverse_shell") {
    return "/var/www/html/assets/.cache/update.sh";
  }

  return "/usr/local/sbin/health-check.sh";
}

function hostIp(world: LinuxAssetInput["world"], hostOctet: number) {
  const parts = world.gatewayIp.split(".");
  return `${parts[0]}.${parts[1]}.${parts[2]}.${hostOctet}`;
}

function ticketObservation({ incident, world }: LinuxAssetInput) {
  const observations: Record<LinuxAssetInput["incident"]["id"], string> = {
    ssh_bruteforce: `Authentication telemetry on ${world.host} shows a source and account pattern that differs from normal ${world.serverRole} access.`,
    misconfigured_sudoers: `Privileged command evidence on ${world.host} needs to be compared with account role, group membership, and sudo policy.`,
    service_account_misuse: `Automation-account activity on ${world.host} appears interactive enough to require account-purpose validation.`,
    ssh_key_compromise: `Key-based SSH access on ${world.host} needs source, owner, and key-lifecycle review.`,
    cron_persistence: `Scheduled execution evidence on ${world.host} needs ownership and script-purpose validation.`,
    systemd_persistence: `A service state change on ${world.host} requires baseline comparison against systemd and inventory evidence.`,
    unauthorized_package_install: `Package activity on ${world.host} needs approval, source, and runtime-impact review.`,
    data_staging: `Temporary archive and file-handling evidence on ${world.host} needs scope and ownership review.`,
    log_tampering: `Log integrity signals on ${world.host} require comparison with journal and audit sources before confidence can be assigned.`,
    reverse_shell: `Web, process, and outbound session evidence on ${world.host} requires application-context correlation.`,
    docker_compromise: `Container runtime evidence on ${world.host} needs review against host mount, group, and service baseline records.`,
  };

  return observations[incident.id];
}

function approvedWork({ world }: LinuxAssetInput) {
  const role = world.serverRole.toLowerCase();
  if (role.includes("backup")) {
    return ["Verify backup job status", "Confirm restore-point health", "Review backup-agent telemetry"];
  }
  if (role.includes("ci") || role.includes("git")) {
    return ["Verify runner queue health", "Check artifact cache status", "Confirm source-control service health"];
  }
  if (role.includes("web") || role.includes("application")) {
    return ["Verify web service health", "Check certificate renewal status", "Confirm application log forwarding"];
  }
  if (role.includes("docker") || role.includes("container") || role.includes("kubernetes")) {
    return ["Verify container runtime health", "Check workload restart status", "Confirm node telemetry forwarding"];
  }
  if (role.includes("dns") || role.includes("mail") || role.includes("proxy") || role.includes("vpn")) {
    return ["Verify service listener health", "Check resolver or gateway telemetry", "Confirm access logging"];
  }

  return ["Apply routine package updates", "Verify SSH service health", "Confirm backup job status"];
}

function sudoExceptionRules(context: LinuxAssetInput) {
  return renderedSudoPolicyText(context);
}

function documentTone(world: LinuxAssetInput["world"]) {
  const industry = world.industry.toLowerCase();
  if (industry.includes("financial") || industry.includes("payments")) {
    return {
      changeTitle: "Linux Control Change Record",
      ticketTitle: "Control Alert Triage",
      approvedLabel: "Approved control work",
      ambiguityLabel: "Control evidence gaps",
      notesIntro: "Treat these as control observations until policy and artefacts agree.",
    };
  }
  if (industry.includes("health")) {
    return {
      changeTitle: "Linux Clinical Service Change Note",
      ticketTitle: "Safety-Oriented Linux Triage",
      approvedLabel: "Approved service work",
      ambiguityLabel: "Safety and compliance questions",
      notesIntro: "Preserve availability assumptions and validate data-handling evidence.",
    };
  }
  if (industry.includes("manufacturing") || industry.includes("energy")) {
    return {
      changeTitle: "Operational Linux Change Log",
      ticketTitle: "Operations Escalation Note",
      approvedLabel: "Approved operational work",
      ambiguityLabel: "Continuity questions",
      notesIntro: "Separate production-impact risk from security confidence.",
    };
  }
  if (industry.includes("education") || industry.includes("research")) {
    return {
      changeTitle: "Service Desk Linux Change Note",
      ticketTitle: "Campus Linux Triage",
      approvedLabel: "Expected support work",
      ambiguityLabel: "Ownership questions",
      notesIntro: "Expect mixed account ownership; verify before assigning intent.",
    };
  }
  if (industry.includes("saas") || industry.includes("hosting")) {
    return {
      changeTitle: "Runbook-Linked Linux Change",
      ticketTitle: "On-Call Linux Triage",
      approvedLabel: "Runbook-approved work",
      ambiguityLabel: "Runbook gaps",
      notesIntro: "Compare observed activity with automation and on-call handoff records.",
    };
  }

  return {
    changeTitle: "Linux Operational Change Record",
    ticketTitle: "Linux Alert Triage",
    approvedLabel: "Approved work",
    ambiguityLabel: "Ambiguity",
    notesIntro: "Correlation is required before classification.",
  };
}

function changeRequestAsset(context: LinuxAssetInput) {
  const { world } = context;
  const tone = documentTone(world);
  return asset(
    "change_request.md",
    "markdown",
    "assets/docs/change_request.md",
    `# ${world.changeId} ${tone.changeTitle}

Company: ${world.company}
Host: ${world.host}
Recurring maintenance policy: ${world.maintenanceWindow}
${linuxApprovalStatusSentence(context.simulation)}
Requesting engineer: ${world.adminUser}
Related incident ticket: ${world.ticketId}
Business application: ${world.businessApplication}
Documentation style: ${world.documentationStyle}

Requested or expected work:
${approvedWork(context).map((item) => `- ${item}`).join("\n")}

Not approved:
- New persistent services
- New contractor SSH keys
- New outbound firewall rules
- Manual archive creation outside backup tooling

${tone.ambiguityLabel}:
- Some evidence references ${world.changeId} outside the recurring maintenance policy or without exact activity scope.
- The request does not explicitly list every package, service, or account action observed in runtime evidence.
${canonicalDocumentScope(context, "change_request")}
`
  );
}

function maintenanceTicketAsset(context: LinuxAssetInput) {
  const { world, investigation } = context;
  const tone = documentTone(world);
  return asset(
    "maintenance_ticket.md",
    "markdown",
    "assets/docs/maintenance_ticket.md",
    `# ${world.ticketId} ${tone.ticketTitle}

Reported by: Security Operations
Department: ${world.department}
Location: ${world.location}
Escalation reference: ${world.changeId}
Security maturity: ${world.securityMaturity}
Business hours: ${world.businessHours}

Initial observation:
${ticketObservation(context)}

Business impact:
${investigation.businessImpact}

Known benign or routine activity to compare:
- Routine monitoring from ${world.monitoringIp}
- ${context.advanced || (context.intermediate && context.simulation.investigation.incidentFamily === "unauthorized_package_install")
  ? "Daily APT maintenance timing should be compared against apt_history.log and syslog entries in this evidence set."
  : "Daily APT maintenance is a possible alternative; compare supplied syslog entries and collect APT history if package timing matters."}
- Backup validation by ${world.serviceUser}
- SSH health check by ${world.adminUser}

Review approach:
${linuxDifficultyReviewGuidance(context.input.difficulty).map((guidance) => `- ${guidance}`).join("\n")}
${canonicalDocumentScope(context, "maintenance_ticket")}
`
  );
}

function roleProcessLines({ world }: LinuxAssetInput) {
  const role = world.serverRole.toLowerCase();
  if (role.includes("web") || role.includes("application")) {
    return [
      "root       1210     1  /usr/sbin/apache2 -k start",
      "www-data   1216  1210  /usr/sbin/apache2 -k start",
      "www-data   1217  1210  /usr/sbin/apache2 -k start",
    ];
  }
  if (role.includes("backup")) {
    return [
      `${world.serviceUser.padEnd(10)} 1511     1  /usr/local/bin/backup-agent --config /etc/backup-agent.yml`,
      `${world.serviceUser.padEnd(10)} 1518  1511  /usr/bin/rsync --daemon --config=/etc/rsyncd.conf`,
    ];
  }
  if (role.includes("ci") || role.includes("git")) {
    return [
      "git        1170     1  /usr/bin/gitaly /etc/gitlab/gitaly/config.toml",
      "gitlab-runner 1184     1  /usr/bin/gitlab-runner run --working-directory /var/lib/gitlab-runner",
    ];
  }
  if (role.includes("docker") || role.includes("container") || role.includes("kubernetes")) {
    return [
      "root       1201     1  /usr/bin/containerd",
      "root       1220     1  /usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:2375 --containerd=/run/containerd/containerd.sock",
      "root       1260     1  /usr/bin/kubelet --config=/var/lib/kubelet/config.yaml",
    ];
  }
  if (role.includes("database")) {
    return [
      "postgres   1035     1  /usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main",
      "postgres   1040  1035  postgres: 16/main: checkpointer",
      "postgres   1041  1035  postgres: 16/main: background writer",
      "postgres   1088  1035  /usr/sbin/pgbouncer /etc/pgbouncer/pgbouncer.ini",
    ];
  }
  if (role.includes("dns")) {
    return ["bind       1064     1  /usr/sbin/named -f -u bind"];
  }
  if (role.includes("mail")) {
    return [
      "root       1032     1  /usr/lib/postfix/sbin/master -w",
      "postfix    1041  1032  qmgr -l -t unix -u",
      "rspamd     1114     1  /usr/bin/rspamd -f -c /etc/rspamd/rspamd.conf",
    ];
  }
  if (roleKind(world.serverRole) === "access") {
    return [
      "root       1054     1  /usr/sbin/openvpn --config /etc/openvpn/corp.conf",
      "root       1030     1  /usr/sbin/fail2ban-server -xf start",
    ];
  }
  if (role.includes("monitoring")) {
    return [
      "prometheus 1102     1  /usr/bin/prometheus --config.file=/etc/prometheus/prometheus.yml",
      "grafana-agent 1110     1  /usr/bin/grafana-agent --config.file=/etc/grafana-agent.yaml",
    ];
  }

  return ["root       1030     1  /usr/sbin/fail2ban-server -xf start"];
}

function roleRoutineUnits({ world, incident }: LinuxAssetInput) {
  const base = [
    "logrotate.service",
    "logrotate.timer",
    "systemd-tmpfiles-clean.timer",
    "rsyslog.service",
    "NetworkManager.service",
    "unattended-upgrades.service",
    incident.affectedService,
  ];

  return Array.from(
    new Set([
      ...base,
      ...roleServices(world.serverRole).map((service) => {
        const unit = service.replace(/\//g, "-");
        return unit.endsWith(".service") || unit.endsWith(".timer") ? unit : `${unit}.service`;
      }),
    ])
  ).filter((unit) => !/^(?:ssh|cron|apt-daily|apt-daily-upgrade)\.service$/.test(unit));
}

function roleStartupLines(context: LinuxAssetInput) {
  const kind = roleKind(context.world.serverRole);
  const roleLines: Record<string, string[]> = {
    platform: [
      "Started GitLab Runner.",
      "Started build artifact cache service.",
    ],
    web: [
      "Started nginx reverse proxy.",
      "Started Apache HTTP Server.",
    ],
    backup: [
      "Started backup orchestration agent.",
      "Started restic repository timer.",
    ],
    container: [
      "Started containerd container runtime.",
      "Started Docker Application Container Engine.",
    ],
    dns: [
      "Started BIND Domain Name Server.",
      "Started local resolver service.",
    ],
    mail: [
      "Started Postfix Mail Transport Agent.",
      "Started rspamd mail filter.",
    ],
    access: [
      "Started OpenVPN service.",
      "Started Fail2Ban Service.",
    ],
    monitoring: [
      "Started Prometheus metrics collection.",
      "Started Grafana Agent telemetry forwarder.",
    ],
    database: [
      "Started PostgreSQL database server.",
      "Started PgBouncer connection pool.",
    ],
    general: ["Started host health monitoring service."],
  };

  return roleLines[kind] || roleLines.general;
}

function roleKernelLines(context: LinuxAssetInput) {
  const kind = roleKind(context.world.serverRole);
  const profile = kind === "container" || context.incident.id === "docker_compromise"
    ? "docker-default"
    : "usr.sbin.sshd";

  return [
    `${renderedTime(context, 20)} ${context.world.host} kernel: Linux version 6.8.0-36-generic`,
    `${renderedTime(context, 48)} ${context.world.host} kernel: audit: type=1400 apparmor="STATUS" operation="profile_load" profile="${profile}"`,
    `${renderedTime(context, 96)} ${context.world.host} kernel: EXT4-fs (sda2): re-mounted. Opts: errors=remount-ro`,
    `${renderedTime(context, 176)} ${context.world.host} kernel: audit: backlog limit exceeded, 2 callbacks suppressed`,
    `${renderedTime(context, 260)} ${context.world.host} kernel: audit: type=1300 msg=audit: arch=c000003e syscall=59 comm="bash" exe="/usr/bin/bash"`,
  ];
}

function incidentServiceJournalLine(context: LinuxAssetInput, service: string) {
  const { world, incident, investigation } = context;
  const timestamp = canonicalServiceEffectTimestamp(context);
  if (incident.id === "ssh_bruteforce" || incident.id === "ssh_key_compromise") {
    return `${timestamp} ${world.host} systemd[1]: Reloaded OpenSSH server daemon.`;
  }
  if (incident.id === "unauthorized_package_install") {
    const primaryCommand = context.simulation.commands.find((command) => command.kind === "primary_incident") || context.simulation.commands.find((command) => command.id.startsWith("command:incident:"));
    return `${timestamp} ${world.host} apt[${primaryCommand?.processId || buildIncidentEventGraph(context).command.pid}]: manual package transaction completed for ncat.`;
  }
  const action = incident.id === "systemd_persistence" ? "Started" : "Reloaded";
  return `${timestamp} ${world.host} systemd[1]: ${action} ${service}.`;
}

function canonicalServiceEffectTimestamp(context: LinuxAssetInput) {
  const latestCommand = context.simulation.commands
    .map((command) => command.timestamp)
    .sort()
    .at(-1);
  const source = latestCommand || `${context.world.incidentDate} ${buildIncidentEventGraph(context).service.timestamp}`;
  const parsed = new Date(`${source.replace(" ", "T")}Z`);
  parsed.setUTCSeconds(parsed.getUTCSeconds() + 12);
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function serviceAuditType(context: LinuxAssetInput) {
  if (context.incident.id === "systemd_persistence") return "SERVICE_START";
  if (context.incident.id === "unauthorized_package_install") return "SOFTWARE_UPDATE";
  return "SERVICE_RELOAD";
}

function clusteredTime(index: number, clusters: number[]) {
  const raw = Math.sin((index + 1) * 19.913 + clusters.length * 7.177) * 10000;
  const clusterIndex = Math.floor((raw - Math.floor(raw)) * clusters.length);
  const wave = Math.floor(index / Math.max(1, clusters.length));
  const jitterRaw = Math.sin((index + 3) * 43.219 + wave * 11.31) * 10000;
  const jitter = Math.floor((jitterRaw - Math.floor(jitterRaw)) * (index % 5 === 0 ? 900 : 2600));
  const total = clusters[clusterIndex] + jitter + wave * (index % 7 === 0 ? 11 : 5);
  const hour = Math.floor(total / 3600) % 24;
  const minute = Math.floor((total % 3600) / 60);
  const second = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function interactiveSshIncident(context: LinuxAssetInput) {
  return !["reverse_shell", "docker_compromise"].includes(context.incident.id);
}

function primaryProcessLines(context: LinuxAssetInput) {
  const { incident } = context;
  const graph = buildIncidentEventGraph(context);
  if (incident.id === "reverse_shell") {
    return [
      "www-data  1216  1210  /usr/sbin/apache2 -k start",
      processLine(graph.processes.shell),
      processLine(graph.processes.sudo),
      processLine(graph.processes.command),
    ];
  }

  if (incident.id === "docker_compromise") {
    return [
      "root      1244     1  /usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:2375 --containerd=/run/containerd/containerd.sock",
      processLine(graph.processes.shell),
      processLine(graph.processes.sudo),
      processLine(graph.processes.command),
    ];
  }

  return [
    `root      ${graph.auth.pid}   812  sshd: ${graph.auth.user} [priv]`,
    processLine(graph.processes.shell),
    processLine(graph.processes.sudo),
    processLine(graph.processes.command),
  ];
}

function processLine(process: ReturnType<typeof buildIncidentEventGraph>["processes"]["command"]) {
  return `${process.user.padEnd(9)} ${String(process.pid).padStart(5)} ${String(process.ppid).padStart(5)}  ${process.argv.join(" ")}`;
}

function canonicalProcessLine(context: LinuxAssetInput, process: LinuxAssetInput["simulation"]["processes"][number]) {
  const identity = process.effectiveUid === 0
    ? canonicalIdentity(context.simulation, "identity:root")
    : canonicalIdentity(context.simulation, process.identityId);
  return `${identity.username.padEnd(9)} ${String(process.pid).padStart(5)} ${String(process.currentPpid ?? process.ppid).padStart(5)}  ${process.argv.join(" ")} started=${process.startedAt} state=running kind=${process.lifecycleKind || "long_running"}`;
}

function runtimeCaptureAt(context: LinuxAssetInput) {
  return context.simulation.collection.windowEnd;
}

function isProcessAliveAt(process: LinuxAssetInput["simulation"]["processes"][number], captureAt: string) {
  const endedAt = canonicalProcessRuntimeEndAt(process);
  return process.startedAt <= captureAt && (!endedAt || endedAt > captureAt);
}

function canonicalProcessLines(context: LinuxAssetInput) {
  const liveProcessIds = new Set<number>();
  const processByPid = new Map(context.simulation.processes.map((process) => [process.pid, process]));
  const captureAt = runtimeCaptureAt(context);
  for (const process of context.simulation.processes) {
    if (process.pid === 1 || !isProcessAliveAt(process, captureAt)) continue;
    let current: typeof process | undefined = process;
    while (current && current.pid !== 1 && !liveProcessIds.has(current.pid)) {
      if (!isProcessAliveAt(current, captureAt)) break;
      liveProcessIds.add(current.pid);
      current = processByPid.get(current.ppid);
    }
  }
  return context.simulation.processes
    .filter((process) => process.pid !== 1)
    .filter((process) => liveProcessIds.has(process.pid))
    .map((process) => canonicalProcessLine(context, process));
}

function canonicalOpenFileLines(context: LinuxAssetInput) {
  const { simulation } = context;
  const rows = ["COMMAND     PID USER             FD   TYPE       MODE OPENED_AT           NAME"];
  for (const descriptor of (simulation.openFileDescriptors || []).filter((item) => item.state === "current")) {
    const process = simulation.processes.find((item) => item.id === descriptor.processId);
    if (!process || !isProcessAliveAt(process, runtimeCaptureAt(context))) continue;
    const command = process.executable.split("/").pop() || "process";
    const target = descriptor.targetKind === "socket"
      ? `${descriptor.protocol || "socket"} ${descriptor.localAddress || "local"}:${descriptor.localPort || ""}${descriptor.remoteAddress ? `->${descriptor.remoteAddress}:${descriptor.remotePort || ""}` : ""}`
      : `${descriptor.targetPath || descriptor.targetId}${descriptor.deleted ? " (deleted)" : ""}`;
    rows.push([
      command.padEnd(11),
      String(descriptor.pid).padEnd(3),
      descriptor.username.padEnd(16),
      descriptor.fd.padEnd(4),
      descriptor.descriptorType.replace(/_/g, "-").padEnd(10),
      descriptor.accessMode.padEnd(4),
      descriptor.openedAt.padEnd(19),
      target,
    ].join(" "));
  }
  return dedupeLines(rows).join("\n");
}

function canonicalProcessHistoryLines(context: LinuxAssetInput) {
  const { simulation } = context;
  const rows = [
    csvRow(["evidence_type", "state_type", "started_at", "ended_at", "state", "pid", "ppid", "user", "lifecycle_kind", "command", "source_telemetry"]),
  ];
  for (const process of simulation.processes.filter((item) => item.pid !== 1).sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.pid - right.pid)) {
    const identity = process.effectiveUid === 0
      ? canonicalIdentity(simulation, "identity:root")
      : canonicalIdentity(simulation, process.identityId);
    const endedAt = canonicalProcessRuntimeEndAt(process);
    rows.push(csvRow([
      "historical_process_correlation",
      "historical_reconstruction",
      process.startedAt,
      endedAt || "",
      endedAt ? "completed" : "running",
      process.pid,
      process.ppid,
      identity.username,
      process.lifecycleKind || (endedAt ? "bounded" : "long_running"),
      process.argv.join(" "),
      process.commandId ? "audit.log;sudo.log;timeline.csv" : "process collection",
    ]));
  }
  return `${rows.join("\n")}\n`;
}

export function fileAccessOperation(command: string, path: string, executable?: string) {
  if (executable && path === executable) return "execution_load";
  if (/\btruncate\b/i.test(command)) return "truncate/write";
  if (/\btar\b/i.test(command)) return /\s-[A-Za-z]*f\s+\S+/.test(command) && command.includes(path) ? "archive_write" : "read";
  if (/\brsync\b/i.test(command)) return command.trim().endsWith(path) || /\/tmp\/export/.test(path) ? "write/sync_target" : "read/sync_source";
  if (/\bcat\b/i.test(command)) return "read";
  if (/\bsystemctl\b/i.test(command)) return "service_config_read";
  if (/\bdocker\s+run\b/i.test(command) && command.includes(path)) return "mount_reference";
  if (/\bdocker\s+inspect\b/i.test(command)) return "metadata_read";
  return "access";
}

function canonicalFileAccessHistoryLines(context: LinuxAssetInput) {
  const { simulation } = context;
  const rows = [
    csvRow(["evidence_type", "state_type", "timestamp", "pid", "user", "command", "operation", "path", "access_type", "source_telemetry", "confidence"]),
  ];
  for (const record of canonicalHistoricalFileAccessRecords(simulation)) {
    const process = simulation.processes.find((item) => item.id === record.sourceProcessId);
    const identity = canonicalIdentity(simulation, record.userIdentityId);
    rows.push(csvRow([
      "historical_file_access",
      "historical_reconstruction",
      record.timestamp,
      record.pid,
      identity.username,
      record.renderedCommand,
      fileAccessOperation(record.renderedCommand, record.filePath, process?.executable),
      record.filePath,
      process && isProcessAliveAt(process, runtimeCaptureAt(context)) ? "live_or_historical" : "historical",
      "audit.log",
      "high",
    ]));
  }
  return `${rows.join("\n")}\n`;
}

function canonicalAuditLines(context: LinuxAssetInput) {
  const { world, simulation } = context;
  const session = simulation.sshSessions[0];
  const accessByCommand = new Map<string, ReturnType<typeof canonicalHistoricalFileAccessRecords>>();
  for (const record of canonicalHistoricalFileAccessRecords(simulation)) {
    accessByCommand.set(record.sourceCommandId, [...(accessByCommand.get(record.sourceCommandId) || []), record]);
  }
  const lines = [
    `type=LOGIN msg=audit(${session.openedAt}): serial=900 event="audit:ssh:incident-primary:login" pid=${session.sessionPid} uid=0 auid=${session.uid} acct="${session.username}" exe="/usr/sbin/sshd" hostname=${session.sourceIp} res=success`,
  ];
  for (const [commandIndex, command] of simulation.commands.filter((item) => item.kind !== "background" && item.expectedRenderTargets.includes("audit")).entries()) {
    const actor = canonicalIdentity(simulation, command.actorIdentityId);
    const rendered = renderCommandInvocation(command);
    const serial = 1000 + commandIndex;
    const eventId = `audit:${command.id}`;
    const process = simulation.processes.find((item) => item.pid === command.processId);
    lines.push(
      `type=USER_CMD msg=audit(${command.timestamp}): serial=${serial} event="${eventId}" pid=${command.sudoProcessId} ppid=${command.shellProcessId || process?.ppid || 1} cwd="${auditQuoted(command.cwd)}" cmd="${auditQuoted(rendered)}" auid=${actor.uid} uid=0 tty=${command.tty || "notty"} res=success`,
      `type=EXECVE msg=audit(${command.timestamp}): serial=${serial} event="${eventId}" pid=${command.processId} ppid=${command.sudoProcessId} cwd="${auditQuoted(command.cwd)}" cmd="${auditQuoted(rendered)}" auid=${actor.uid} uid=0 gid=0 tty=${command.tty || "notty"} res=success`
    );
    for (const record of accessByCommand.get(command.id) || []) {
      const file = canonicalFile(simulation, record.fileId);
      lines.push(
        `type=PATH msg=audit(${record.timestamp}): serial=${serial} event="${eventId}" pid=${command.processId} ppid=${command.sudoProcessId} item=${record.operationIndex} name="${file.path}" inode=${file.inode} mode=${canonicalAuditMode(file)} ouid=${file.ownerUid} ogid=${file.groupGid}`
      );
    }
  }
  return lines.join("\n");
}

function canonicalJournalSshLines(context: LinuxAssetInput) {
  const { world, simulation } = context;
  return simulation.sshSessions.map((session) => [
    `${session.openedAt} ${world.host} sshd[${session.sessionPid}]: Session opened for ${session.username} from ${session.sourceIp}${session.keyFingerprint ? ` fingerprint ${session.keyFingerprint}` : ""}`,
    session.closedAt && session.closedAt <= simulation.collection.windowEnd
      ? `${session.closedAt} ${world.host} sshd[${session.sessionPid}]: Session closed for ${session.username}`
      : undefined,
  ].filter(Boolean).join("\n")).join("\n");
}

function canonicalDocumentScope(context: LinuxAssetInput, documentType: string) {
  const document = context.simulation.documents.find((item) => item.documentType === documentType);
  if (!document) return "";
  const facts = document.factIds
    .map((factId) => context.simulation.documentFacts.find((fact) => fact.id === factId))
    .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));
  const factThemes = Array.from(new Set(facts.map((fact) => fact.factType)));
  const objectIds = documentType === "analyst_working_notes"
    ? linuxLearnerReviewSubjectIds(context.simulation)
    : Array.from(new Set(document.factIds
        .flatMap((factId) => context.simulation.documentFacts.find((fact) => fact.id === factId)?.canonicalObjectIds || [])
        .filter(Boolean)));
  const maintenance = context.simulation.maintenanceActivities[0];
  const approvalScope = maintenance && ["change_request", "maintenance_ticket"].includes(documentType)
    ? `Activity scope: ${maintenance.title}; ${formatLinuxLearnerDocumentWindow(maintenance.windowStart, maintenance.windowEnd, context.simulation.investigation.timezone)}. ${linuxApprovalStatusSentence(context.simulation)}
`
    : "";
  const reviewApprovalStatus = documentType === "analyst_working_notes"
    ? `${linuxApprovalStatusSentence(context.simulation)}\n`
    : "";
  return `\n## Documentation Scope\nDocument style: ${document.styleArchetype}
Fact themes: ${factThemes.join(", ")}
Host: ${context.simulation.investigation.hostname}
Affected service: ${context.simulation.investigation.affectedService}
Investigation window: ${formatLinuxLearnerDocumentWindow(context.simulation.collection.windowStart, context.simulation.collection.windowEnd, context.simulation.investigation.timezone)}; evidence collection: ${formatLinuxLearnerDocumentDateTime(context.simulation.collection.collectedAt, context.simulation.investigation.timezone)}
${approvalScope}
${reviewApprovalStatus}
Timezone: ${context.simulation.investigation.timezone}
${objectIds.length > 0 ? `Subjects: ${linuxLearnerSubjectList(context.simulation, objectIds)}\n` : ""}`;
}

function roleListeningPorts(context: LinuxAssetInput) {
  const { simulation, incident, investigation } = context;
  const rows = ["Netid State  Local Address:Port  Process"];
  for (const descriptor of (simulation.openFileDescriptors || []).filter((item) => item.state === "current" && item.targetKind === "socket")) {
    const process = simulation.processes.find((item) => item.id === descriptor.processId);
    if (!process || !isProcessAliveAt(process, runtimeCaptureAt(context))) continue;
    const command = process.executable.split("/").pop() || "process";
    if (descriptor.descriptorType === "listening_socket") {
      rows.push(`${descriptor.protocol || "tcp"}   LISTEN ${descriptor.localAddress || "0.0.0.0"}:${descriptor.localPort || ""}          ${command} pid=${process.pid}`);
    } else if (descriptor.descriptorType === "connected_socket" && descriptor.remoteAddress) {
      rows.push(`${descriptor.protocol || "tcp"}   ESTAB  ${descriptor.localAddress || investigation.hostIp}:${descriptor.localPort || ""}  ${descriptor.remoteAddress}:${descriptor.remotePort || ""}  ${command} pid=${process.pid}`);
    }
  }
  if (incident.id === "reverse_shell" && !rows.some((line) => line.includes(`${incident.suspiciousIp}:4444`))) {
    const process = simulation.processes.find((item) => item.executable.endsWith("/bash") && isProcessAliveAt(item, runtimeCaptureAt(context)));
    if (process) rows.push(`tcp   ESTAB  ${investigation.hostIp}:48222  ${incident.suspiciousIp}:4444  bash pid=${process.pid}`);
  }
  return dedupeLines(rows).join("\n");
}

function roleOpenFiles(context: LinuxAssetInput, path: string, service: string) {
  const { world, incident } = context;
  const graph = buildIncidentEventGraph(context);
  const kind = roleKind(world.serverRole);
  const roleFiles: Record<string, string[]> = {
    platform: [
      "gitlab-runner 1184 gitlab-runner /var/lib/gitlab-runner/config.toml",
      "gitaly     1170 git              /var/log/gitlab/gitaly/current",
    ],
    web: [
      "apache2    1210 root             /var/log/apache2/access.log",
      "apache2    1216 www-data         /var/www/html/index.php",
    ],
    backup: [
      `backup-agent 1511 ${world.serviceUser} /srv/backups/current`,
      `rsync      1518 ${world.serviceUser} /etc/rsyncd.conf`,
    ],
    container: [
      "dockerd    1220 root             /var/lib/docker/containers",
      "kubelet    1260 root             /var/lib/kubelet/config.yaml",
    ],
    dns: [
      "named      1064 bind             /etc/bind/named.conf.local",
      "named      1064 bind             /var/cache/bind",
    ],
    mail: [
      "postfix    1032 root             /etc/postfix/main.cf",
      "rspamd     1114 rspamd           /var/log/rspamd/rspamd.log",
    ],
    access: [
      "openvpn    1054 root             /etc/openvpn/corp.conf",
      "fail2ban   1030 root             /var/log/auth.log",
    ],
    monitoring: [
      "prometheus 1102 prometheus       /etc/prometheus/prometheus.yml",
      "grafana-agent 1110 grafana-agent /etc/grafana-agent.yaml",
    ],
    database: [
      "postgres   1035 postgres         /var/lib/postgresql/16/main",
      "pgbouncer  1088 postgres         /etc/pgbouncer/pgbouncer.ini",
    ],
    general: ["node_exporter 1122 root       /proc/stat"],
  };

  const unitPath = service === "metrics-cache.service" || service === "container-health.service"
    ? `/etc/systemd/system/${service}`
    : `/lib/systemd/system/${service}`;

  return dedupeLines([
    "COMMAND     PID USER             NAME",
    "sshd        812 root             /var/log/auth.log",
    ...(roleFiles[kind] || roleFiles.general),
    service.endsWith(".service") ? `systemd    1 root               ${unitPath}` : "",
  ].filter(Boolean)).join("\n");
}

function dedupeLines(lines: string[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = line.trim().replace(/\s+/g, " ");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fileMetadataIds(context: LinuxAssetInput, filePath: string) {
  const graph = buildIncidentEventGraph(context);
  if (filePath === "/var/run/docker.sock" || filePath === "/run/containerd/containerd.sock" || filePath.endsWith(".sock")) {
    return { uid: 0, gid: 998, mode: "0140660" };
  }
  if (filePath.startsWith("/lib/systemd/system/")) {
    return { uid: 0, gid: 0, mode: "0100644" };
  }
  if (filePath === "/var/lib/docker" || filePath.startsWith("/var/lib/docker/")) {
    return { uid: 0, gid: 0, mode: "0040750" };
  }
  if (filePath.startsWith("/etc/") || filePath.startsWith("/usr/bin/")) {
    return { uid: 0, gid: 0, mode: filePath.startsWith("/usr/bin/") ? "0100755" : "0100640" };
  }
  if (filePath.startsWith("/var/log/")) {
    return { uid: 104, gid: 4, mode: "0100640" };
  }
  if (filePath.startsWith("/srv/")) {
    return { uid: graph.command.uid, gid: graph.command.gid, mode: "0040750" };
  }
  if (filePath.includes("/.ssh/authorized_keys")) {
    const owner = identityFor(context, context.incident.primaryUser);
    return { uid: owner?.uid || graph.command.uid, gid: owner?.gid || graph.command.gid, mode: "0100600" };
  }
  return { uid: graph.command.uid, gid: graph.command.gid, mode: filePath.endsWith(".sh") ? "0100750" : "0100640" };
}

function authorizedKeysMetadataComment(context: LinuxAssetInput) {
  const filePath = `/home/${context.incident.primaryUser}/.ssh/authorized_keys`;
  const file = context.simulation.files.find((item) => item.path === filePath);
  const owner = file ? context.simulation.identities.find((item) => item.id === file.ownerIdentityId) : undefined;
  const group = file ? context.simulation.groups.find((item) => item.id === file.groupId) : undefined;
  return `file=${filePath} owner=${owner?.username || context.incident.primaryUser} group=${group?.name || owner?.username || context.incident.primaryUser} mode=${file ? canonicalModeString(file) : "0600"}`;
}

function authorizedKeysContent(context: LinuxAssetInput) {
  const { world, incident } = context;
  const metadata = authorizedKeysMetadataComment(context);
  return `${deterministicPublicKey("ssh-ed25519", `${world.caseId}:${incident.primaryUser}:primary`, `${incident.primaryUser}@${world.domain} fingerprint=${deterministicFingerprint("ssh-ed25519", `${world.caseId}:${incident.primaryUser}:primary`)} ${metadata}`)}
${incident.id === "ssh_key_compromise" ? deterministicPublicKey("ssh-rsa", `${world.caseId}:${world.contractorUser}:vendor-maint`, `${world.contractorUser}@vendor-maint fingerprint=${deterministicFingerprint("ssh-rsa", `${world.caseId}:${world.contractorUser}:vendor-maint`)}`) : ""}
`;
}

function riskEvidenceFor(risk: string, fallback: string) {
  if (/\b(?:archive|data staging|staging|export|tar|temporary archive)\b/i.test(risk)) return "audit.log;sudo.log;process_execution_history.txt;file_access_history.csv;timeline.csv";
  if (/\b(?:interactive shell|interactive login|login shell|group membership|account)\b/i.test(risk)) return "passwd.sample;groups.csv;auth.log";
  if (/\b(?:package|apt|dpkg|install)\b/i.test(risk)) return "apt_history.log;audit.log;sudo.log;timeline.csv";
  if (/\b(?:service|systemd|unit)\b/i.test(risk)) return "journal_systemd.txt;service_inventory.txt;timeline.csv";
  return fallback;
}

function advancedRiskSubjectRefs(context: LinuxAssetInput) {
  return linuxLearnerSubjectList(context.simulation, linuxLearnerReviewSubjectIds(context.simulation));
}

function roleActivityLog(context: LinuxAssetInput) {
  const { world, incident, investigation } = context;
  const kind = roleKind(world.serverRole);
  if (kind === "web" || incident.id === "reverse_shell") {
    return asset(
      "web_access.log",
      "log",
      "assets/logs/web_access.log",
      `${sortLogLines(`${hostIp(world, 30)} - - [${renderedTime(context, 22).replace(" ", ":")} +0000] "GET /health HTTP/1.1" 200 42
${world.monitoringIp} - - [${renderedTime(context, 54).replace(" ", ":")} +0000] "GET /metrics HTTP/1.1" 200 812
${incident.id === "reverse_shell" ? `${incident.suspiciousIp} - - [${renderedTime(context, 18).replace(" ", ":")} +0000] "POST /upload HTTP/1.1" 200 118` : `${world.adminIp} - - [${renderedTime(context, 118).replace(" ", ":")} +0000] "GET /admin/status HTTP/1.1" 200 312`}
${hostIp(world, 34)} - - [${renderedTime(context, 206).replace(" ", ":")} +0000] "GET / HTTP/1.1" 200 1042`) }
`
    );
  }

  const logs: Record<string, [string, string]> = {
    platform: [
      "git_platform_activity.log",
      `${renderedTime(context, 34)} ${world.host} gitlab-workhorse[1188]: ${world.adminIp} GET /-/readiness 200
${renderedTime(context, 92)} ${world.host} gitlab-runner[1184]: runner queue depth=3 project=platform/build
${renderedTime(context, 33)} ${world.host} gitlab-shell[1176]: command review required for ${incident.primaryUser}
${renderedTime(context, 208)} ${world.host} gitaly[1170]: repository health check completed`,
    ],
    backup: [
      "backup_activity.log",
      `${renderedTime(context, 36)} ${world.host} backup-agent[1511]: catalog check started
${renderedTime(context, 94)} ${world.host} restic[1180]: repository lock cleared
${renderedTime(context, 40)} ${world.host} backup-agent[1511]: archive path review queued for ${incident.primaryUser}
${renderedTime(context, 214)} ${world.host} backup-agent[1511]: verification completed with warnings=0`,
    ],
    container: [
      "container_activity.log",
      `${renderedTime(context, 32)} ${world.host} kubelet[1260]: node condition Ready=True
${renderedTime(context, 88)} ${world.host} containerd[1201]: image garbage collection completed
${renderedTime(context, 33)} ${world.host} dockerd[1220]: runtime action requires review for ${incident.primaryUser}
${renderedTime(context, 216)} ${world.host} kubelet[1260]: pod status sync completed`,
    ],
    dns: [
      "dns_activity.log",
      `${renderedTime(context, 30)} ${world.host} named[1064]: zone ${world.domain}/IN loaded serial 2026070601
${renderedTime(context, 90)} ${world.host} named[1064]: resolver query summary clients=42
${renderedTime(context, 40)} ${world.host} named[1064]: config-related event queued for review
${renderedTime(context, 202)} ${world.host} rndc[1070]: status check completed`,
    ],
    mail: [
      "mail_activity.log",
      `${renderedTime(context, 28)} ${world.host} postfix/qmgr[1041]: queue active count=3
${renderedTime(context, 86)} ${world.host} rspamd[1114]: scanned internal relay message
${renderedTime(context, 40)} ${world.host} postfix/master[1032]: ${incident.affectedService} evidence queued for ${incident.primaryUser}
${renderedTime(context, 198)} ${world.host} opendkim[1077]: key table check completed`,
    ],
    access: [
      "access_gateway_activity.log",
      `${renderedTime(context, 24)} ${world.host} sshd[1512]: bastion session opened for ${world.analystUser}
${renderedTime(context, 82)} ${world.host} sshd[1880]: admin jump session opened for ${world.adminUser}
${renderedTime(context, 22)} ${world.host} sshd[2136]: source ${incident.suspiciousIp} requires review
${renderedTime(context, 192)} ${world.host} fail2ban-server[1030]: sshd jail idle`,
    ],
    monitoring: [
      "monitoring_activity.log",
      `${renderedTime(context, 26)} ${world.host} prometheus[1102]: scrape manager synced targets
${renderedTime(context, 84)} ${world.host} grafana-agent[1110]: telemetry batch sent to ${world.monitoringIp}
${renderedTime(context, 40)} ${world.host} promtail[1124]: log stream requires review
${renderedTime(context, 204)} ${world.host} alertmanager[1131]: notification queue empty`,
    ],
    database: [
      "database_activity.log",
      `${renderedTime(context, 26)} ${world.host} postgresql[1035]: checkpoint starting
${renderedTime(context, 92)} ${world.host} pgbouncer[1088]: pool report active=7 waiting=0
${renderedTime(context, 40)} ${world.host} postgresql[1035]: ${investigation.modifiedFiles[0]} referenced by ${incident.primaryUser}
${renderedTime(context, 218)} ${world.host} postgresql[1035]: checkpoint complete`,
    ],
    general: [
      "host_activity.log",
      `${renderedTime(context, 22)} ${world.host} systemd[1]: routine host checks started
${renderedTime(context, 88)} ${world.host} node_exporter[1122]: metrics scrape completed
${renderedTime(context, 40)} ${world.host} rsyslogd: investigation event forwarded
${renderedTime(context, 200)} ${world.host} logrotate[2210]: status check completed`,
    ],
  };
  const [fileName, content] = logs[kind] || logs.general;
  return asset(fileName, "log", `assets/logs/${fileName}`, `${sortLogLines(content)}\n`);
}

function accountLine(context: LinuxAssetInput, username: string, shell: string) {
  const account = identityFor(context, username);
  const canonical = context.simulation?.identities.find((identity) => identity.username === username);
  const role = account?.role || "Linux User";
  const uid = account?.uid || canonical?.uid || 1000;
  const gid = account?.gid || canonical?.gid || uid;
  const home = account?.homeDirectory || systemAccountHome(username);

  return `${username}:x:${uid}:${gid}:${role}:${home}:${shell}`;
}

function systemAccountHome(username: string) {
  const homes: Record<string, string> = {
    root: "/root",
    "www-data": "/var/www",
    git: "/var/lib/git",
    "gitlab-runner": "/var/lib/gitlab-runner",
    postgres: "/var/lib/postgresql",
    bind: "/var/cache/bind",
    postfix: "/var/spool/postfix",
    prometheus: "/var/lib/prometheus",
  };
  return homes[username] || `/home/${username}`;
}

function systemAccountShell(username: string) {
  if (username === "root") return "/bin/bash";
  return "/usr/sbin/nologin";
}

export function buildAdvancedLinuxArtifacts(context: LinuxAssetInput): LabAsset[] {
  const { world, incident, investigation } = context;
  if (!context.advanced) {
    const intermediateDocs = context.intermediate ? [changeRequestAsset(context), maintenanceTicketAsset(context)] : [];
    if (context.intermediate && incident.id === "cron_persistence") {
      return [
        ...intermediateDocs,
        asset(
          "root_crontab.txt",
          "text",
          "assets/scheduled/root_crontab.txt",
          simulationRootCrontab(context.simulation)
        ),
        ...simulationCronDAssets(context.simulation).map((cronAsset) => asset(cronAsset.fileName, "config", cronAsset.filePath, cronAsset.content)),
        ...simulationScriptAssets(context.simulation).map((scriptAsset) => asset(scriptAsset.fileName, "shell", scriptAsset.filePath, scriptAsset.content)),
      ];
    }
    if (context.intermediate && incident.id === "systemd_persistence") {
      return [
        ...intermediateDocs,
        logAsset(
          "journal_systemd.txt",
          "text",
          "assets/journal/journal_systemd.txt",
          simulationJournalSystemd(context.simulation, world.host)
        ),
      ];
    }
    if (context.intermediate && incident.id === "unauthorized_package_install") {
      return [
        ...intermediateDocs,
        logAsset(
          "apt_history.log",
          "log",
          "assets/logs/apt_history.log",
          simulationAptHistory(context.simulation)
        ),
        asset(
          "package_inventory.txt",
          "text",
          "assets/inventory/package_inventory.txt",
          simulationPackageInventory(context.simulation)
        ),
      ];
    }
    if (context.intermediate && incident.id === "data_staging") {
      return [
        ...intermediateDocs,
        asset(
          "process_execution_history.txt",
          "csv",
          "assets/runtime/process_execution_history.txt",
          canonicalProcessHistoryLines(context)
        ),
        asset(
          "file_access_history.csv",
          "csv",
          "assets/runtime/file_access_history.csv",
          canonicalFileAccessHistoryLines(context)
        ),
      ];
    }
    if (context.intermediate && incident.id === "docker_compromise") {
      return [
        ...intermediateDocs,
        asset(
          "process_execution_history.txt",
          "csv",
          "assets/runtime/process_execution_history.txt",
          canonicalProcessHistoryLines(context)
        ),
        asset(
          "file_access_history.csv",
          "csv",
          "assets/runtime/file_access_history.csv",
          canonicalFileAccessHistoryLines(context)
        ),
      ];
    }
    if (context.intermediate && incident.id === "reverse_shell") {
      return [
        ...intermediateDocs,
        asset(
          "process_execution_history.txt",
          "csv",
          "assets/runtime/process_execution_history.txt",
          canonicalProcessHistoryLines(context)
        ),
        asset(
          "file_access_history.csv",
          "csv",
          "assets/runtime/file_access_history.csv",
          canonicalFileAccessHistoryLines(context)
        ),
        asset(
          "listening_ports.txt",
          "text",
          "assets/network/listening_ports.txt",
          `${roleListeningPorts(context)}\n`
        ),
        asset(
          "ufw_status.txt",
          "text",
          "assets/network/ufw_status.txt",
          `Status: inactive\n\nTo                         Action      From\n22/tcp                     ALLOW       ${world.cidr}\n4444/tcp                   ALLOW OUT   Anywhere\n`
        ),
      ];
    }
    if (context.intermediate && incident.id === "ssh_key_compromise") {
      return [
        ...intermediateDocs,
        asset(
          "authorized_keys_primary_user",
          "text",
          `assets/ssh/${incident.primaryUser}/authorized_keys`,
          authorizedKeysContent(context)
        ),
      ];
    }
    return intermediateDocs;
  }

  const profile = getLinuxIncidentProfile(incident);
  const service = suspiciousService(context);
  const path = scriptPath(context);
  const routineTask = roleTasks(world.serverRole)[0] || "/usr/local/sbin/health-check.sh";
  const routineTag = roleKind(world.serverRole);
  const enterpriseHosts = buildEnterpriseHosts(context);
  const sshUsers = enterpriseIdentities(context)
    .filter((identity) => ["human", "contractor", "temporary"].includes(identity.kind))
    .map((identity) => identity.username);
  const allowedSshUsers = Array.from(
    new Set([
      world.analystUser,
      world.adminUser,
      world.contractorUser,
      ...(interactiveSshIncident(context) ? [incident.primaryUser] : []),
      ...sshUsers,
    ])
  );
  const routineUnits = roleRoutineUnits(context);
  const unitActions = ["Started", "Stopped", "Reloaded", "Finished"];
  const activityProfile = hostActivityProfile(world.serverRole, world.industry);
  const graph = buildIncidentEventGraph(context);
  const fileIds = fileMetadataIds(context, graph.file.path);
  const tone = documentTone(world);
  const installedPackage = incident.id === "unauthorized_package_install" ? "ncat" : "curl";
  const packageRows = buildPackageRows(activityProfile.packages, world.serverRole, [installedPackage]);
  const passwdUsers = Array.from(new Set([
    world.analystUser,
    world.internUser,
    world.serviceUser,
    world.adminUser,
    world.contractorUser,
    world.appUser,
    incident.primaryUser,
    ...(context.simulation?.identities || []).map((identity) => identity.username).filter((username) => username !== "root"),
  ]));
  const passwdShell = (username: string) => identityFor(context, username)?.shell || systemAccountShell(username);

  const advancedArtifacts = [
    asset(
      "host_metadata.json",
      "json",
      "assets/inventory/host_metadata.json",
      JSON.stringify(
        {
          case_id: world.caseId,
          hostname: world.host,
          company: world.company,
          department: world.department,
          location: world.location,
          industry: world.industry,
          role: world.serverRole,
          operating_system: investigation.operatingSystem,
          host_ip: investigation.hostIp,
          domain: world.domain,
          naming_convention: world.namingConvention,
          primary_cidr: world.cidr,
          collected_at: `${context.simulation.collection.collectedAt.replace(" ", "T")}Z`,
        },
        null,
        2
      )
    ),
    asset(
      "asset_inventory.csv",
      "csv",
      "assets/inventory/asset_inventory.csv",
      `hostname,role,ip,owner,criticality
${enterpriseHosts.map((host) => csvRow([host.host, host.role, host.ip, host.owner, host.criticality])).join("\n")}
`
    ),
    logAsset(
      "audit.log",
      "log",
      "assets/logs/audit.log",
      `${canonicalAuditLines(context)}
${simulationServiceAuditLines(context.simulation)}
${simulationBackgroundAuditLines(context.simulation)}
${renderBackgroundAuditLines(context.simulation)}
`
    ),
    logAsset(
      "kern.log",
      "log",
      "assets/logs/kern.log",
      `${roleKernelLines(context).join("\n")}
`
    ),
    logAsset(
      "cron.log",
      "log",
      "assets/logs/cron.log",
      simulationCronLog(context.simulation, world.host)
    ),
    logAsset(
      "journal_ssh.txt",
      "text",
      "assets/journal/journal_ssh.txt",
      `-- Journal begins at ${renderedTime(context, 0)} UTC --
${canonicalJournalSshLines(context)}
${renderBackgroundJournalSshLines(context.simulation, world.host)}
`
    ),
    logAsset(
      "journal_systemd.txt",
      "text",
      "assets/journal/journal_systemd.txt",
      simulationJournalSystemd(context.simulation, world.host)
    ),
    asset(
      "sshd_config",
      "config",
      "assets/configs/ssh/sshd_config",
      `# Supplied SSH configuration sample: capture time and incident-time effectiveness not established; not expected policy or proposed remediation.
Port 22
Protocol 2
PermitRootLogin ${incident.id === "ssh_bruteforce" ? "yes" : "no"}
PasswordAuthentication ${incident.id === "ssh_bruteforce" ? "yes" : "no"}
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
AllowUsers ${allowedSshUsers.join(" ")}
MaxAuthTries 6
LogLevel VERBOSE
`
    ),
    asset(
      "authorized_keys_primary_user",
      "text",
      `assets/ssh/${incident.primaryUser}/authorized_keys`,
      authorizedKeysContent(context)
    ),
    asset(
      "known_hosts",
      "text",
      `assets/ssh/${incident.primaryUser}/known_hosts`,
      `${world.webHost},${hostIp(world, 51)} ${deterministicPublicKey("ssh-ed25519", `${world.caseId}:known:${world.webHost}`, `${world.webHost}@hostkey`)}
${world.dbHost},${hostIp(world, 61)} ${deterministicPublicKey("ssh-ed25519", `${world.caseId}:known:${world.dbHost}`, `${world.dbHost}@hostkey`)}
backup-lnx-01,${world.backupIp} ${deterministicPublicKey("ssh-ed25519", `${world.caseId}:known:backup`, "backup-lnx-01@hostkey")}
`
    ),
    asset(
      "passwd.sample",
      "text",
      "assets/accounts/passwd.sample",
      `# scope: partial incident-focused local passwd snapshot
root:x:0:0:root:/root:/bin/bash
${passwdUsers.map((username) => accountLine(context, username, passwdShell(username))).join("\n")}
`
    ),
    asset(
      "group.sample",
      "text",
      "assets/accounts/group.sample",
      `# scope: partial incident-focused local group snapshot
sudo:x:27:${world.analystUser},${world.adminUser}
adm:x:4:${world.analystUser},${world.adminUser}
docker:x:998:${incident.id === "docker_compromise" ? `${world.appUser},${world.adminUser}` : world.adminUser}
analysts:x:1001:${world.analystUser},auditor
backup:x:1002:${world.serviceUser}
contractors:x:1004:${world.contractorUser}
`
    ),
    asset(
      "shadow.sample",
      "text",
      "assets/accounts/shadow.sample",
      `root:*:19852:0:99999:7:::
${world.analystUser}:!:19845:0:99999:7:::
${world.internUser}:!:19820:0:99999:7:::
${world.serviceUser}:!:19833:0:99999:7:::
${world.adminUser}:!:19840:0:99999:7:::
${world.contractorUser}:!:19817:0:99999:7:::
${world.appUser}:!:19800:0:99999:7:::
`
    ),
    asset(
      "sudoers.d-platform",
      "config",
      "assets/configs/sudoers.d/platform",
`%sudo ALL=(ALL:ALL) ALL
${world.analystUser} ALL=(root) NOPASSWD: /usr/bin/journalctl *, /usr/bin/systemctl *, /usr/bin/stat *, /usr/bin/grep *, /usr/bin/apt *
${sudoExceptionRules(context)}
`
    ),
    asset(
      "pam_sshd",
      "config",
      "assets/configs/pam/sshd",
      `auth       required     pam_env.so
auth       required     pam_faildelay.so delay=2000000
auth       include      common-auth
account    required     pam_nologin.so
account    include      common-account
session    include      common-session
session    optional     pam_motd.so motd=/run/motd.dynamic
`
    ),
    asset(
      "ufw_status.txt",
      "text",
      "assets/network/ufw_status.txt",
      `Status: ${incident.id === "reverse_shell" ? "inactive" : "active"}

To                         Action      From
22/tcp                     ALLOW       ${world.cidr}
${context.simulation.sshSessions.map((session) => `22/tcp                     ALLOW       ${session.sourceIp}`).join("\n")}
80/tcp                     ALLOW       ${world.cidr}
443/tcp                    ALLOW       ${world.cidr}
9100/tcp                   ALLOW       ${world.monitoringIp}
${incident.id === "reverse_shell" ? "4444/tcp                   ALLOW OUT   Anywhere" : ""}
`
    ),
    asset(
      "listening_ports.txt",
      "text",
      "assets/network/listening_ports.txt",
      `${roleListeningPorts(context)}\n`
    ),
    asset(
      "routing_table.txt",
      "text",
      "assets/network/routing_table.txt",
      `default via ${world.gatewayIp} dev ens160 proto dhcp
${world.cidr} dev ens160 proto kernel scope link src ${investigation.hostIp}
192.168.56.0/24 via ${world.gatewayIp} dev ens160
`
    ),
    asset(
      "process_snapshot.txt",
      "text",
      "assets/runtime/process_snapshot.txt",
      `${dedupeLines([
        `# capture_at=${runtimeCaptureAt(context)} evidence_type=live_process_snapshot state_type=incident_snapshot host=${world.host}`,
        "USER       PID  PPID  CMD STARTED_AT STATE KIND",
        "root         1     0  /sbin/init",
        ...canonicalProcessLines(context),
      ]).join("\n")}\n`
    ),
    asset(
      "open_files.txt",
      "text",
      "assets/runtime/open_files.txt",
      `${dedupeLines([
        `# capture_at=${runtimeCaptureAt(context)} evidence_type=live_open_file_snapshot state_type=incident_snapshot host=${world.host}`,
        ...canonicalOpenFileLines(context).split("\n"),
      ]).join("\n")}\n`
    ),
    asset(
      "process_execution_history.txt",
      "csv",
      "assets/runtime/process_execution_history.txt",
      canonicalProcessHistoryLines(context)
    ),
    asset(
      "file_access_history.csv",
      "csv",
      "assets/runtime/file_access_history.csv",
      canonicalFileAccessHistoryLines(context)
    ),
    asset(
      "package_inventory.txt",
      "text",
      "assets/inventory/package_inventory.txt",
      simulationPackageInventory(context.simulation)
    ),
    asset(
      "apt_history.log",
      "log",
      "assets/logs/apt_history.log",
      simulationAptHistory(context.simulation)
    ),
    asset(
      "root_crontab.txt",
      "text",
      "assets/scheduled/root_crontab.txt",
      simulationRootCrontab(context.simulation)
    ),
    ...simulationCronDAssets(context.simulation).map((cronAsset) => asset(cronAsset.fileName, "config", cronAsset.filePath, cronAsset.content)),
    ...simulationScriptAssets(context.simulation).map((scriptAsset) => asset(scriptAsset.fileName, "shell", scriptAsset.filePath, scriptAsset.content)),
    asset(
      "script_sample.sh",
      "shell",
      "assets/scripts/script_sample.sh",
      simulationScriptSample(context.simulation)
    ),
    roleActivityLog(context),
    asset(
      "change_request.md",
      "markdown",
      "assets/docs/change_request.md",
      `# ${world.changeId} ${tone.changeTitle}

Company: ${world.company}
Host: ${world.host}
Recurring maintenance policy: ${world.maintenanceWindow}
${linuxApprovalStatusSentence(context.simulation)}
Requesting engineer: ${world.adminUser}
Related incident ticket: ${world.ticketId}
Business application: ${world.businessApplication}
Documentation style: ${world.documentationStyle}

Requested or expected work:
${approvedWork(context).map((item) => `- ${item}`).join("\n")}

Not approved:
- New persistent services
- New contractor SSH keys
- New outbound firewall rules
- Manual archive creation outside backup tooling

${tone.ambiguityLabel}:
- Some evidence references ${world.changeId} outside the recurring maintenance policy or without exact activity scope.
- The request does not explicitly list every package, service, or account action observed in runtime evidence.
${canonicalDocumentScope(context, "change_request")}
`
    ),
    asset(
      "maintenance_ticket.md",
      "markdown",
      "assets/docs/maintenance_ticket.md",
      `# ${world.ticketId} ${tone.ticketTitle}

Reported by: Security Operations
Department: ${world.department}
Location: ${world.location}
Escalation reference: ${world.changeId}
Security maturity: ${world.securityMaturity}
Business hours: ${world.businessHours}

Initial observation:
${ticketObservation(context)}

Business impact:
${investigation.businessImpact}

Known benign or routine activity to compare:
- Routine monitoring from ${world.monitoringIp}
- Daily APT maintenance timing should be compared against apt_history.log and syslog entries in this evidence set.
- Backup validation by ${world.serviceUser}
- SSH health check by ${world.adminUser}

Review approach:
${linuxDifficultyReviewGuidance(context.input.difficulty).map((guidance) => `- ${guidance}`).join("\n")}
${canonicalDocumentScope(context, "maintenance_ticket")}
`
    ),
    asset(
      "security_policy.md",
      "markdown",
      "assets/docs/security_policy.md",
      `# Linux Access and Change Policy

Authority: expected policy, not observed host configuration or a completed remediation.

- Production access must use named accounts.
- Service accounts must not be used interactively unless an exception is approved.
- SSH keys for contractors must expire at the end of the change window.
- Persistent scheduled tasks must be documented in a change request.
- New packages require an approved change record.
- Temporary archives containing business data must be stored only in approved backup paths.
- Logs must not be manually rotated during active security investigations.
- Maintenance records must cite a valid ticket such as ${world.ticketId} and a matching change record such as ${world.changeId}.
- Password authentication should remain disabled unless a temporary exception is explicitly approved.
${canonicalDocumentScope(context, "security_policy")}
`
    ),
    asset(
      "advanced_risk_register.csv",
      "csv",
      "assets/evidence/advanced_risk_register.csv",
      `id,risk,evidence,severity,status,subject_refs
${csvRow(["R-000", linuxApprovalGapFinding(context.simulation), "change_request.md;maintenance_ticket.md", "unassessed", "unverified", advancedRiskSubjectRefs(context)])}
${[
  ["R-001", "Unverified hypothesis: approval scope has not yet been reconciled with runtime activity", "change_request.md;process_execution_history.txt;timeline.csv"],
  ["R-002", "Unverified hypothesis: account identity has not yet been reconciled with session and process provenance", "auth.log;process_execution_history.txt;timeline.csv"],
  ["R-003", "Unverified hypothesis: current service state must not be treated as proof of historical execution", "service_inventory.txt;journal_systemd.txt;timeline.csv"],
].map(([id, risk, evidence]) => csvRow([id, risk, evidence, "unassessed", "unverified", advancedRiskSubjectRefs(context)])).join("\n")}
`
    ),
    asset(
      "analyst_working_notes.md",
      "markdown",
      "assets/evidence/analyst_working_notes.md",
      `# Analyst Working Notes

Case: ${world.caseId}
Host: ${world.host}

Unverified competing hypotheses:
The alternatives are maintained in risk_register.csv rather than repeated here. ${tone.notesIntro}

Correlation points:
- Compare ${world.ticketId} and ${world.changeId} before treating activity as malicious.
- Confirm whether each observed account's activity is consistent with policy.
- Use auth.log, audit.log, journal exports, and service/process snapshots together.
- Do not assume the first anomaly is malicious; expected maintenance and policy drift are both plausible.

Open questions:
${linuxIndependentReviewQuestions.map((question) => `- ${question}`).join("\n")}
${incident.id === "docker_compromise" ? `\n${linuxContainerEvidenceBoundary}\n` : ""}
${canonicalDocumentScope(context, "analyst_working_notes")}
`
    ),
  ];

  const requestedMinutes = Number.parseInt(context.input.duration, 10);
  if (context.input.difficulty !== "Advanced" || !Number.isFinite(requestedMinutes) || requestedMinutes > 30) {
    return advancedArtifacts;
  }

  // A focused 30-minute case should be difficult because the learner must
  // correlate evidence, not because every renderer contributes a file. Keep
  // the canonical runtime views needed to prove the case plus any file that
  // the selected tasks explicitly cite; omit unrelated reference renderers.
  const selectedEvidencePaths = new Set(
    context.simulation.canonicalTasks.flatMap((task) =>
      task.selectedEvidenceAssetIds
        .map((id) => context.simulation.evidenceRegistry.find((evidence) => evidence.id === id)?.path)
        .filter((path): path is string => Boolean(path))
    )
  );
  const canonicalRuntimePaths = new Set([
    "assets/inventory/host_metadata.json",
    "assets/logs/audit.log",
    "assets/logs/cron.log",
    "assets/journal/journal_ssh.txt",
    "assets/journal/journal_systemd.txt",
    "assets/accounts/passwd.sample",
    "assets/accounts/group.sample",
    "assets/configs/sudoers.d/platform",
    "assets/network/ufw_status.txt",
    "assets/network/listening_ports.txt",
    "assets/network/routing_table.txt",
    "assets/runtime/process_snapshot.txt",
    "assets/runtime/open_files.txt",
    "assets/runtime/process_execution_history.txt",
    "assets/runtime/file_access_history.csv",
    "assets/inventory/package_inventory.txt",
    "assets/logs/apt_history.log",
    "assets/scheduled/root_crontab.txt",
    "assets/docs/change_request.md",
    "assets/docs/maintenance_ticket.md",
    "assets/evidence/advanced_risk_register.csv",
  ]);

  return advancedArtifacts.filter((artifact) =>
    canonicalRuntimePaths.has(artifact.file_path) ||
    selectedEvidencePaths.has(artifact.file_path) ||
    artifact.file_path.startsWith("assets/scheduled/cron.d/") ||
    artifact.file_path.startsWith("assets/scripts/")
  );
}
