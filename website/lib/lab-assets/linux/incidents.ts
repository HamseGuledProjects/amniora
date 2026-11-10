import type { InvestigationWorld } from "../world";
import { buildLinuxGenerationContext, type LinuxGenerationContext } from "./generationContext";

export type LinuxIncidentFamily =
  | "misconfigured_sudoers"
  | "ssh_bruteforce"
  | "service_account_misuse"
  | "ssh_key_compromise"
  | "cron_persistence"
  | "systemd_persistence"
  | "unauthorized_package_install"
  | "data_staging"
  | "log_tampering"
  | "reverse_shell"
  | "docker_compromise";

export type LinuxIncident = {
  id: LinuxIncidentFamily;
  label: string;
  summary: string;
  primaryUser: string;
  suspiciousIp: string;
  affectedService: string;
  triggerTime: string;
  riskTheme: string;
  taskPhases: string[];
};

function pick<T>(items: T[], context: LinuxGenerationContext, namespace: string) {
  return context.random(namespace).pick(items);
}

function roleAwareService(role: string, options: string[]) {
  const lower = role.toLowerCase();
  const preferred =
    lower.includes("web") || lower.includes("application")
      ? "apache2.service"
      : lower.includes("backup")
        ? "backup.service"
        : lower.includes("cron")
          ? "cron.service"
          : "ssh.service";
  return options.includes(preferred) ? preferred : options[0];
}

function randomTime(context: LinuxGenerationContext) {
  return pick(["00:41", "01:13", "02:17", "03:08", "04:22", "22:46", "23:31"], context, "incident.timestamps.trigger");
}

function compatibleFamilies(role: string): LinuxIncidentFamily[] {
  const lower = role.toLowerCase();

  if (lower.includes("backup")) {
    return [
      "service_account_misuse",
      "data_staging",
      "cron_persistence",
      "log_tampering",
      "unauthorized_package_install",
      "misconfigured_sudoers",
    ];
  }

  if (lower.includes("web") || lower.includes("application")) {
    return [
      "reverse_shell",
      "systemd_persistence",
      "unauthorized_package_install",
      "service_account_misuse",
      "log_tampering",
      "misconfigured_sudoers",
    ];
  }

  if (lower.includes("docker") || lower.includes("container") || lower.includes("kubernetes")) {
    return [
      "docker_compromise",
      "systemd_persistence",
      "unauthorized_package_install",
      "cron_persistence",
      "service_account_misuse",
      "log_tampering",
    ];
  }

  if (lower.includes("ci") || lower.includes("git")) {
    return [
      "docker_compromise",
      "unauthorized_package_install",
      "service_account_misuse",
      "ssh_key_compromise",
      "misconfigured_sudoers",
      "systemd_persistence",
    ];
  }

  if (
    lower.includes("ssh") ||
    lower.includes("jump") ||
    lower.includes("bastion") ||
    lower.includes("vpn") ||
    lower.includes("proxy")
  ) {
    return [
      "ssh_bruteforce",
      "ssh_key_compromise",
      "misconfigured_sudoers",
      "log_tampering",
      "cron_persistence",
      "systemd_persistence",
    ];
  }

  if (lower.includes("database")) {
    return [
      "data_staging",
      "service_account_misuse",
      "ssh_key_compromise",
      "misconfigured_sudoers",
      "log_tampering",
      "unauthorized_package_install",
    ];
  }

  if (lower.includes("dns") || lower.includes("mail") || lower.includes("monitoring")) {
    return [
      "log_tampering",
      "systemd_persistence",
      "unauthorized_package_install",
      "ssh_key_compromise",
      "misconfigured_sudoers",
      "cron_persistence",
    ];
  }

  return [
    "ssh_bruteforce",
    "service_account_misuse",
    "ssh_key_compromise",
    "cron_persistence",
    "systemd_persistence",
    "unauthorized_package_install",
    "data_staging",
    "log_tampering",
    "reverse_shell",
    "docker_compromise",
    "misconfigured_sudoers",
  ];
}

const methodology: Record<LinuxIncidentFamily, string[]> = {
  ssh_bruteforce: [
    "Authentication Pattern Analysis",
    "Source Attribution",
    "Timeline Reconstruction",
    "Service Exposure Review",
    "Root Cause Decision",
    "Remediation Plan",
  ],
  service_account_misuse: [
    "Account Validation",
    "Shell Policy Review",
    "Privilege Mapping",
    "Scheduled Tasks",
    "Business Impact",
    "Executive Brief",
  ],
  docker_compromise: [
    "Container Inventory",
    "Image Analysis",
    "Network Exposure",
    "Host Boundary Indicators",
    "Persistence Review",
    "Recovery Plan",
  ],
  systemd_persistence: [
    "Startup Services",
    "Unit File Review",
    "Timeline Reconstruction",
    "Parent Processes",
    "Evidence Correlation",
    "Disablement Plan",
  ],
  cron_persistence: [
    "Scheduled Jobs",
    "Script Analysis",
    "Timeline Reconstruction",
    "User Attribution",
    "Containment",
    "Monitoring Follow-up",
  ],
  ssh_key_compromise: [
    "Key Inventory",
    "Source Validation",
    "Maintenance Correlation",
    "Account Ownership",
    "Trust Decision",
    "Key Rotation",
  ],
  misconfigured_sudoers: [
    "Change Record Review",
    "Sudo Rule Analysis",
    "Command Attribution",
    "Policy Exception Review",
    "Privilege Boundary",
    "Cleanup Plan",
  ],
  unauthorized_package_install: [
    "Package Timeline",
    "Change Comparison",
    "Repository Validation",
    "Service Impact",
    "Rollback Decision",
    "Approval Follow-up",
  ],
  data_staging: [
    "File Discovery",
    "Archive Scope",
    "Account Purpose",
    "Transfer Evidence",
    "Business Impact",
    "Containment",
  ],
  log_tampering: [
    "Log Gap Analysis",
    "Secondary Sources",
    "Rotation Attribution",
    "Monitoring Confidence",
    "Evidence Preservation",
    "Detection Recovery",
  ],
  reverse_shell: [
    "Network Session Triage",
    "Process Ancestry",
    "Application Correlation",
    "Egress Control",
    "Containment",
    "Web Hardening",
  ],
};

export function buildLinuxIncident(
  world: InvestigationWorld,
  context = buildLinuxGenerationContext({
    category: "Linux",
    difficulty: "Intermediate",
    duration: "30 mins",
    title: "CyberLab Asset Pack",
  })
): LinuxIncident {
  const incidents: LinuxIncident[] = [
    {
      id: "ssh_bruteforce",
      label: "Bastion Host Password Spray Review",
      summary:
        "Multiple SSH failures from one source were followed by a successful password login to an account that requires validation.",
      primaryUser: pick([world.employeeUser, world.contractorUser, world.analystUser], context, "incident.objects.ssh_bruteforce.primary.1"),
      suspiciousIp: world.suspiciousIp,
      affectedService: "ssh.service",
      triggerTime: randomTime(context),
      riskTheme: "credential compromise through SSH authentication abuse",
      taskPhases: methodology.ssh_bruteforce,
    },
    {
      id: "ssh_bruteforce",
      label: "After-Hours SSH Authentication Spike",
      summary:
        "An unusual after-hours SSH spike occurred against several usernames before one account authenticated successfully.",
      primaryUser: pick([world.employeeUser, world.analystUser], context, "incident.objects.ssh_bruteforce.primary.2"),
      suspiciousIp: world.suspiciousIp,
      affectedService: "ssh.service",
      triggerTime: randomTime(context),
      riskTheme: "after-hours authentication anomaly",
      taskPhases: methodology.ssh_bruteforce,
    },
    {
      id: "ssh_bruteforce",
      label: "Dormant Account Login After Failed SSH Attempts",
      summary:
        "A rarely used account authenticated shortly after repeated failed SSH attempts from an unfamiliar source.",
      primaryUser: pick([world.contractorUser, world.employeeUser], context, "incident.objects.ssh_bruteforce.primary.3"),
      suspiciousIp: world.suspiciousIp,
      affectedService: "ssh.service",
      triggerTime: randomTime(context),
      riskTheme: "dormant account compromise risk",
      taskPhases: methodology.ssh_bruteforce,
    },
    {
      id: "ssh_bruteforce",
      label: "VPN Gateway Repeated Login Failure Investigation",
      summary:
        "Repeated SSH authentication failures against operational accounts preceded a short authenticated session requiring source and account validation.",
      primaryUser: pick([world.employeeUser, world.contractorUser], context, "incident.objects.ssh_bruteforce.primary.4"),
      suspiciousIp: world.suspiciousIp,
      affectedService: "ssh.service",
      triggerTime: randomTime(context),
      riskTheme: "authentication pressure against remote access infrastructure",
      taskPhases: methodology.ssh_bruteforce,
    },

    {
      id: "misconfigured_sudoers",
      label: "Sudo Privilege Boundary Investigation",
      summary:
        "A non-administrative user appears to have executed privileged commands through an overly broad sudo rule.",
      primaryUser: world.internUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: "ssh.service",
      triggerTime: randomTime(context),
      riskTheme: "privilege escalation through weak sudo policy",
      taskPhases: methodology.misconfigured_sudoers,
    },
    {
      id: "misconfigured_sudoers",
      label: "Temporary Sudo Exception Ownership Review",
      summary:
        "A temporary sudo exception appears to remain active after a maintenance window and may allow excessive privileged access.",
      primaryUser: world.internUser,
      suspiciousIp: world.adminIp,
      affectedService: "ssh.service",
      triggerTime: randomTime(context),
      riskTheme: "stale privileged access exception",
      taskPhases: methodology.misconfigured_sudoers,
    },
    {
      id: "misconfigured_sudoers",
      label: "Unauthorized Sensitive File Access Attempt",
      summary:
        "A user attempted to access sensitive system files using sudo, requiring validation of policy, intent, and access scope.",
      primaryUser: world.internUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: "ssh.service",
      triggerTime: randomTime(context),
      riskTheme: "sensitive file access through sudo misuse",
      taskPhases: methodology.misconfigured_sudoers,
    },
    {
      id: "misconfigured_sudoers",
      label: "Privileged Service Control by Non-Admin User",
      summary:
        "A non-admin user appears able to inspect or control system services through sudo, creating potential operational risk.",
      primaryUser: world.internUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: roleAwareService(world.serverRole, ["ssh.service", "apache2.service", "backup.service"]),
      triggerTime: randomTime(context),
      riskTheme: "privileged service control exposure",
      taskPhases: methodology.misconfigured_sudoers,
    },
    {
      id: "misconfigured_sudoers",
      label: "Unexpected Local User Privilege Review",
      summary:
        "A lower-trust local account appears in privileged command evidence and must be reconciled against group membership and policy.",
      primaryUser: world.internUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: pick(["ssh.service", "cron.service", "rsyslog.service"], context, "incident.objects.sudo.affected_service"),
      triggerTime: randomTime(context),
      riskTheme: "unexpected privileged command path for local user",
      taskPhases: methodology.misconfigured_sudoers,
    },

    {
      id: "service_account_misuse",
      label: "Unexpected Service Account Activity",
      summary:
        "A service account performed interactive SSH activity inconsistent with its expected automation role.",
      primaryUser: world.serviceUser,
      suspiciousIp: world.backupIp,
      affectedService: "backup.service",
      triggerTime: randomTime(context),
      riskTheme: "interactive misuse of a service account",
      taskPhases: methodology.service_account_misuse,
    },
    {
      id: "service_account_misuse",
      label: "Backup Service Integrity Investigation",
      summary:
        "A backup-related account authenticated interactively and executed archive commands outside normal automation patterns.",
      primaryUser: world.serviceUser,
      suspiciousIp: world.backupIp,
      affectedService: "backup.service",
      triggerTime: randomTime(context),
      riskTheme: "manual use of automation account",
      taskPhases: methodology.service_account_misuse,
    },
    {
      id: "service_account_misuse",
      label: "Service Account Shell Policy Violation",
      summary:
        "A service account appears to have an interactive shell and performed activity that violates baseline access policy.",
      primaryUser: world.serviceUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: "backup.service",
      triggerTime: randomTime(context),
      riskTheme: "service account shell policy violation",
      taskPhases: methodology.service_account_misuse,
    },
    {
      id: "service_account_misuse",
      label: "Suspicious Data Staging by Service Account",
      summary:
        "A service account used archive or sync commands in a way that could indicate data staging or misuse.",
      primaryUser: world.serviceUser,
      suspiciousIp: world.backupIp,
      affectedService: "backup.service",
      triggerTime: randomTime(context),
      riskTheme: "possible data staging through service account misuse",
      taskPhases: methodology.service_account_misuse,
    },
    {
      id: "service_account_misuse",
      label: "Automation Account Shell Use Review",
      summary:
        "An automation account shows interactive shell activity and file operations that need to be compared with expected service behaviour.",
      primaryUser: world.serviceUser,
      suspiciousIp: pick([world.backupIp, world.suspiciousIp], context, "incident.objects.service_account.source_ip"),
      affectedService: pick(["backup.service", "cron.service", "ssh.service"], context, "incident.objects.service_account.affected_service"),
      triggerTime: randomTime(context),
      riskTheme: "misconfigured automation or compromised service account",
      taskPhases: methodology.service_account_misuse,
    },

    {
      id: "ssh_key_compromise",
      label: "SSH Key Rotation Failure Investigation",
      summary:
        "A valid SSH key was used from an unfamiliar source shortly after a contractor maintenance window.",
      primaryUser: world.contractorUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: "ssh.service",
      triggerTime: randomTime(context),
      riskTheme: "unauthorised access through unmanaged SSH key material",
      taskPhases: methodology.ssh_key_compromise,
    },
    {
      id: "ssh_key_compromise",
      label: "Contractor SSH Key Source Review",
      summary:
        "A trusted key was accepted from a source that does not clearly match the expected contractor access pattern.",
      primaryUser: world.contractorUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: "ssh.service",
      triggerTime: randomTime(context),
      riskTheme: "contractor key reuse or stale key exposure",
      taskPhases: methodology.ssh_key_compromise,
    },
    {
      id: "ssh_key_compromise",
      label: "Expired Access Key Validation Case",
      summary:
        "A key-based SSH session occurred near an access expiry boundary and needs correlation with ownership and change records.",
      primaryUser: pick([world.contractorUser, world.adminUser], context, "incident.objects.ssh_key.primary"),
      suspiciousIp: world.suspiciousIp,
      affectedService: "ssh.service",
      triggerTime: randomTime(context),
      riskTheme: "expired or unmanaged SSH key trust",
      taskPhases: methodology.ssh_key_compromise,
    },
    {
      id: "cron_persistence",
      label: "Cron Persistence Investigation",
      summary:
        "A cron entry owned by a non-standard account executed a script outside the documented maintenance schedule.",
      primaryUser: pick([world.adminUser, world.contractorUser], context, "incident.objects.cron.primary.1"),
      suspiciousIp: world.suspiciousIp,
      affectedService: "cron.service",
      triggerTime: randomTime(context),
      riskTheme: "scheduled task persistence through cron",
      taskPhases: methodology.cron_persistence,
    },
    {
      id: "cron_persistence",
      label: "Undocumented Scheduled Script Review",
      summary:
        "A scheduled script executed from a local path that is not clearly represented in standard ownership records.",
      primaryUser: pick([world.adminUser, world.contractorUser], context, "incident.objects.cron.primary.2"),
      suspiciousIp: world.suspiciousIp,
      affectedService: "cron.service",
      triggerTime: randomTime(context),
      riskTheme: "undocumented scheduled execution path",
      taskPhases: methodology.cron_persistence,
    },
    {
      id: "cron_persistence",
      label: "Abandoned Automation Job Investigation",
      summary:
        "A recurring job appears to survive past its expected operational purpose and now executes during a sensitive review window.",
      primaryUser: world.contractorUser,
      suspiciousIp: world.backupIp,
      affectedService: "cron.service",
      triggerTime: randomTime(context),
      riskTheme: "abandoned automation with persistence characteristics",
      taskPhases: methodology.cron_persistence,
    },
    {
      id: "systemd_persistence",
      label: "Unexpected Daemon Execution Review",
      summary:
        "A recently enabled service unit does not appear in the approved baseline and requires ownership validation.",
      primaryUser: world.adminUser,
      suspiciousIp: world.adminIp,
      affectedService: "metrics-cache.service",
      triggerTime: randomTime(context),
      riskTheme: "persistence or unauthorised service execution through systemd",
      taskPhases: methodology.systemd_persistence,
    },
    {
      id: "systemd_persistence",
      label: "Systemd Service Persistence Investigation",
      summary:
        "A service unit starts during the review window and must be compared with approved service baselines and unit-file evidence.",
      primaryUser: world.adminUser,
      suspiciousIp: world.adminIp,
      affectedService: "metrics-cache.service",
      triggerTime: randomTime(context),
      riskTheme: "unauthorised daemon persistence through systemd",
      taskPhases: methodology.systemd_persistence,
    },
    {
      id: "systemd_persistence",
      label: "Service Failure Followed by New Unit Start",
      summary:
        "A background service state change overlaps with the appearance of a unit that does not clearly map to the host baseline.",
      primaryUser: world.adminUser,
      suspiciousIp: world.adminIp,
      affectedService: "metrics-cache.service",
      triggerTime: randomTime(context),
      riskTheme: "service recovery or persistence masquerading as operations",
      taskPhases: methodology.systemd_persistence,
    },
    {
      id: "unauthorized_package_install",
      label: "Package Tampering Investigation",
      summary:
        "Package manager logs show an installation outside the approved change record and maintenance window.",
      primaryUser: world.adminUser,
      suspiciousIp: world.adminIp,
      affectedService: "package-management activity",
      triggerTime: randomTime(context),
      riskTheme: "unauthorised software installation on production infrastructure",
      taskPhases: methodology.unauthorized_package_install,
    },
    {
      id: "unauthorized_package_install",
      label: "Unexpected Network Utility Installation",
      summary:
        "Package history shows a utility installation that needs reconciliation against package inventory, approval records, and runtime evidence.",
      primaryUser: world.adminUser,
      suspiciousIp: world.adminIp,
      affectedService: "package-management activity",
      triggerTime: randomTime(context),
      riskTheme: "unapproved network-capable tooling on a production host",
      taskPhases: methodology.unauthorized_package_install,
    },
    {
      id: "unauthorized_package_install",
      label: "Repository Change and Package Review",
      summary:
        "Package activity occurred alongside repository and service evidence that require approval and source validation.",
      primaryUser: world.adminUser,
      suspiciousIp: world.adminIp,
      affectedService: "package-management activity",
      triggerTime: randomTime(context),
      riskTheme: "package source or repository trust concern",
      taskPhases: methodology.unauthorized_package_install,
    },
    {
      id: "data_staging",
      label: "Backup Archive Staging Investigation",
      summary:
        "Several archive files appeared under temporary paths after an interactive session by an account with limited operational need.",
      primaryUser: world.serviceUser,
      suspiciousIp: world.backupIp,
      affectedService: "backup.service",
      triggerTime: randomTime(context),
      riskTheme: "possible data staging prior to exfiltration",
      taskPhases: methodology.data_staging,
    },
    {
      id: "data_staging",
      label: "Temporary Directory Data Handling Review",
      summary:
        "Temporary archive evidence appears after an interactive session and must be scoped against business data and backup paths.",
      primaryUser: world.serviceUser,
      suspiciousIp: world.backupIp,
      affectedService: "backup.service",
      triggerTime: randomTime(context),
      riskTheme: "unapproved staging of business files",
      taskPhases: methodology.data_staging,
    },
    {
      id: "log_tampering",
      label: "Audit Gap and Log Integrity Review",
      summary:
        "An authentication log gap occurred near suspicious access activity and must be compared with journal and audit evidence.",
      primaryUser: world.adminUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: "rsyslog.service",
      triggerTime: randomTime(context),
      riskTheme: "possible log tampering or improper manual log handling",
      taskPhases: methodology.log_tampering,
    },
    {
      id: "log_tampering",
      label: "Manual Log Rotation Investigation",
      summary:
        "A log handling event overlaps with access evidence and must be checked against secondary telemetry and rotation policy.",
      primaryUser: world.adminUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: "rsyslog.service",
      triggerTime: randomTime(context),
      riskTheme: "possible evidence quality loss through manual log handling",
      taskPhases: methodology.log_tampering,
    },
    {
      id: "reverse_shell",
      label: "Unexpected Apache Service Behaviour",
      summary:
        "A short-lived outbound connection from an application user coincided with unusual shell execution evidence.",
      primaryUser: world.appUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: "apache2.service",
      triggerTime: randomTime(context),
      riskTheme: "possible reverse shell or unauthorised interactive process",
      taskPhases: methodology.reverse_shell,
    },
    {
      id: "reverse_shell",
      label: "Web Server Outbound Session Review",
      summary:
        "Web access and runtime evidence show shell-like behaviour that needs process, network, and web-log correlation.",
      primaryUser: world.appUser,
      suspiciousIp: world.suspiciousIp,
      affectedService: "apache2.service",
      triggerTime: randomTime(context),
      riskTheme: "web service process anomaly with outbound session evidence",
      taskPhases: methodology.reverse_shell,
    },
    {
      id: "docker_compromise",
      label: "Docker Runtime Anomaly",
      summary:
        "A container workload used host-mounted paths that need runtime, group-membership, and access-evidence review.",
      primaryUser: world.appUser,
      suspiciousIp: world.adminIp,
      affectedService: "docker.service",
      triggerTime: randomTime(context),
      riskTheme: "container misconfiguration or host data exposure",
      taskPhases: methodology.docker_compromise,
    },
    {
      id: "docker_compromise",
      label: "Container Host Mount Exposure Review",
      summary:
        "Container runtime evidence suggests a host-mounted path should be compared with group membership and service inventory.",
      primaryUser: world.appUser,
      suspiciousIp: world.adminIp,
      affectedService: "docker.service",
      triggerTime: randomTime(context),
      riskTheme: "container boundary weakness or host data exposure",
      taskPhases: methodology.docker_compromise,
    },
  ];

  const compatible = compatibleFamilies(world.serverRole);
  const compatibleIncidents = incidents.filter((incident) =>
    compatible.includes(incident.id)
  );

  return pick(compatibleIncidents.length > 0 ? compatibleIncidents : incidents, context, "incident.family");
}
