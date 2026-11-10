import type { LinuxAssetInput } from "./types";
import type { LabAsset } from "../types";
import { executedScriptHelpers } from "./evidenceAuthority";
import {
  buildPermissionRows,
  roleKind,
  buildServiceRows,
} from "./noise";
import { canonicalIdentity, canonicalModeString, linuxLearnerSubjectList, simulationServiceInventoryCsv } from "./simulation";

export function buildReportAssets(context: LinuxAssetInput): LabAsset[] {
  const { world, incident, advanced } = context;
  const hardeningDoc = context.simulation.documents.find((item) => item.documentType === "hardening_checklist");
  const assets: LabAsset[] = [
    {
      file_name: "permissions_report.txt",
      file_type: "text",
      file_path: "assets/reports/permissions_report.txt",
      content: buildPermissionsReport(context),
    },
    {
      file_name: "service_inventory.txt",
      file_type: "text",
      file_path: "assets/reports/service_inventory.txt",
      content: buildServiceInventory(context),
    },
  ];

  if (advanced) {
    const hardeningFacts = (hardeningDoc?.factIds || [])
      .map((factId) => context.simulation.documentFacts.find((fact) => fact.id === factId))
      .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));
    const factThemes = Array.from(new Set(hardeningFacts.map((fact) => fact.factType)));
    const objectIds = Array.from(new Set(hardeningFacts.flatMap((fact) => fact.canonicalObjectIds)));
    assets.push({
      file_name: "hardening_checklist.md",
      file_type: "markdown",
      file_path: "assets/reports/hardening_checklist.md",
      content: `${buildHardeningChecklist(world, incident)}
## Documentation Scope
Document style: ${hardeningDoc?.styleArchetype || "engineering_runbook"}
Fact themes: ${factThemes.join(", ") || "policy"}
${objectIds.length > 0 ? `Subjects: ${linuxLearnerSubjectList(context.simulation, objectIds)}\n` : ""}
`,
    });
  }

  return assets;
}

function buildPermissionsReport(context: LinuxAssetInput) {
  const { world, incident, investigation, advanced } = context;
  const deletedPaths = new Set(context.simulation.files.filter((file) => file.deletedAt).map((file) => file.path));
  const canonicalIncidentRows = context.simulation.files.filter((file) => !file.deletedAt).map((file) => {
    const owner = canonicalIdentity(context.simulation, file.ownerIdentityId);
    const group = context.simulation.groups.find((item) => item.id === file.groupId);
    return `${file.path} ${canonicalModeString(file)} ${owner.username} ${group?.name || owner.username}`;
  });
  const rows = [
    `/home/${world.analystUser}/report.txt -rw-r--r-- ${world.analystUser} ${world.analystUser}`,
    `/home/${world.adminUser}/change-notes.txt -rw-r----- ${world.adminUser} adm`,
    `/home/${world.internUser}/notes.txt -rw-rw-r-- ${world.internUser} ${world.internUser}`,
    `/srv/shared/incident_notes.txt -rw-rw-r-- ${world.analystUser} analysts`,
    "/etc/ssh/sshd_config -rw-r--r-- root root",
    "/etc/group -rw-r--r-- root root",
    "/etc/sudoers -r--r----- root root",
    ...rolePermissionLines(context),
  ];
  rows.push(...executedScriptHelpers(context.simulation).map(path => `${path} -rwxr-xr-x root root`));
  if (incident.id === "docker_compromise" || roleKind(world.serverRole) === "container" || roleKind(world.serverRole) === "platform") {
    rows.push("/var/run/docker.sock srw-rw---- root docker");
  }

  if (incident.id === "ssh_bruteforce") {
    rows.push(
      ...canonicalIncidentRows,
      ...investigationPermissionLines(context),
      "/var/log/auth.log -rw-r----- syslog adm",
      "/var/log/btmp -rw-r----- root utmp"
    );
    if (advanced) rows.push(...buildPermissionRows(context, 800).split("\n"));
    return `${dedupePermissionRows(rows, deletedPaths).join("\n")}\n`;
  }

  if (incident.id === "misconfigured_sudoers") {
    rows.push(
      `/home/${incident.primaryUser}/notes.txt -rw-rw-rw- ${incident.primaryUser} ${incident.primaryUser}`,
      `/srv/shared/old_admin_script.sh -rwxrwxrwx ${incident.primaryUser} ${incident.primaryUser}`,
      ...canonicalIncidentRows,
      ...investigationPermissionLines(context)
    );
    if (advanced) rows.push(...buildPermissionRows(context, 800).split("\n"));
    return `${dedupePermissionRows(rows, deletedPaths).join("\n")}\n`;
  }

  rows.push(
    ...canonicalIncidentRows,
    ...investigationPermissionLines(context),
    "/var/log/auth.log -rw-r----- syslog adm"
  );
  if (advanced) rows.push(...buildPermissionRows(context, 800).split("\n"));
  return `${dedupePermissionRows(rows, deletedPaths).join("\n")}\n`;
}

function investigationPermissionLines(context: LinuxAssetInput) {
  const { incident, investigation } = context;
  const paths = [...investigation.modifiedFiles, ...investigation.modifiedConfigurations];
  return paths.map((file) => {
    if (/^\/var\/log\/audit\/audit\.log$/.test(file)) return `${file} -rw------- root root`;
    if (/^\/var\/log\/(?:auth\.log|syslog)$/.test(file)) return `${file} -rw-r----- syslog adm`;
    if (/^\/var\/log\//.test(file)) return `${file} -rw-r----- root adm`;
    if (/^\/etc\/sudoers(?:\.d\/|$)/.test(file)) return `${file} -r--r----- root root`;
    if (/^\/etc\/shadow$/.test(file)) return `${file} -rw-r----- root root`;
    if (/^\/etc\//.test(file) || /^\/usr\//.test(file) || /^\/lib\//.test(file)) return `${file} -rw-r----- root root`;
    return `${file} -rw-rw-r-- ${incident.primaryUser} ${incident.primaryUser}`;
  });
}

function dedupePermissionRows(rows: string[], deletedPaths = new Set<string>()) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const path = row.trim().split(/\s+/)[0];
    if (!path || seen.has(path) || deletedPaths.has(path)) return false;
    seen.add(path);
    return true;
  });
}

function rolePermissionLines(context: LinuxAssetInput) {
  const { world } = context;
  const kind = roleKind(world.serverRole);
  const byRole: Record<string, string[]> = {
    platform: [
      "/var/lib/gitlab-runner/config.toml -rw------- root gitlab-runner",
      "/srv/git/repositories drwxrws--- git git",
      "/var/log/gitlab/gitaly/current -rw-r----- git adm",
    ],
    web: [
      `/var/www/html/index.html -rw-r--r-- ${world.appUser} ${world.appUser}`,
      "/etc/nginx/sites-enabled/default -rw-r--r-- root root",
      "/etc/letsencrypt/renewal/portal.conf -rw-r----- root root",
    ],
    backup: [
      `/srv/backups/current drwxr-x--- ${world.serviceUser} backup`,
      "/var/backups/system-state.tar.gz -rw-r----- root backup",
      `/etc/backup-agent.yml -rw-r----- root ${world.serviceUser}`,
      "/etc/cron.d/backup-verify -rw-r--r-- root root",
    ],
    container: [
      "/etc/containerd/config.toml -rw-r--r-- root root",
      "/var/lib/containerd drwx--x--- root root",
      "/etc/cni/net.d/10-overlay.conflist -rw-r--r-- root root",
      "/etc/systemd/system/container-health.service -rw-r--r-- root root",
    ],
    dns: [
      "/etc/bind/named.conf.local -rw-r--r-- root bind",
      "/var/cache/bind drwxrwx--- bind bind",
      "/var/log/named/query.log -rw-r----- bind adm",
    ],
    mail: [
      "/etc/postfix/main.cf -rw-r--r-- root root",
      "/var/spool/postfix drwxr-xr-x root root",
      "/var/log/mail.log -rw-r----- syslog adm",
    ],
    access: [
      "/etc/ssh/ssh_config -rw-r--r-- root root",
      `/home/${world.adminUser}/.ssh/known_hosts -rw------- ${world.adminUser} ${world.adminUser}`,
      "/var/log/auth.log -rw-r----- syslog adm",
      "/usr/local/sbin/session-audit -rwxr-x--- root adm",
    ],
    monitoring: [
      "/etc/prometheus/prometheus.yml -rw-r----- root prometheus",
      "/etc/grafana-agent.yaml -rw-r----- root grafana-agent",
      "/var/lib/prometheus drwxr-x--- prometheus prometheus",
    ],
    database: [
      "/etc/postgresql/16/main/postgresql.conf -rw-r--r-- postgres postgres",
      "/var/lib/postgresql/16/main drwx------ postgres postgres",
      "/srv/db-exports drwxr-x--- postgres backup",
    ],
    general: [],
  };

  return byRole[kind] || byRole.general;
}

function permissionLine(file: string, user: string) {
  if (file.startsWith("/var/log/")) return `${file} -rw-r----- syslog adm`;
  if (file.startsWith("/etc/")) return `${file} -rw-r----- root root`;
  if (file.startsWith("/usr/bin/")) return `${file} -rwxr-xr-x root root`;
  if (file.startsWith("/var/lib/docker")) return `${file} drwx--x--- root root`;
  if (file.startsWith("/srv/")) return `${file} drwxr-x--- ${user} ${user}`;
  if (file.endsWith(".sh")) return `${file} -rwxr-x--- ${user} ${user}`;
  if (file.includes("/.ssh/authorized_keys")) return `${file} -rw------- ${user} ${user}`;
  return `${file} -rw-r----- ${user} ${user}`;
}

function buildServiceInventory(context: LinuxAssetInput) {
  if (context.simulation?.services?.length) return simulationServiceInventoryCsv(context.simulation);
  const { world, incident, advanced } = context;
  const kind = roleKind(world.serverRole);
  const services = new Map<string, string>();
  const addService = (
    name: string,
    status: string,
    startup: string,
    notes: string
  ) => {
    services.set(name, `${name},${status},${startup},${notes}`);
  };

  addService("ssh.service", "running", "enabled", "remote access service");
  addService("cron.service", "running", "enabled", "scheduled jobs");
  addService(
    "ufw.service",
    incident.id === "reverse_shell" ? "inactive" : "running",
    "enabled",
    "host firewall state requires review"
  );
  addService("rsyslog.service", "running", "enabled", "system log collection");
  if (incident.id === "unauthorized_package_install") {
    addService(
      "apt-daily.service",
      "inactive",
      "static",
      `package-management timer observed near ${world.changeId}`
    );
    addService(
      "apt-daily.timer",
      "active",
      "enabled",
      "standard APT download schedule"
    );
    addService(
      "apt-daily-upgrade.service",
      "inactive",
      "static",
      "standard APT maintenance timer"
    );
    addService(
      "apt-daily-upgrade.timer",
      "active",
      "enabled",
      "standard APT upgrade schedule"
    );
  } else {
    addService(
      incident.affectedService,
      "running",
      "enabled",
      "service relevant to current investigation scope"
    );
  }

  if (incident.id === "ssh_bruteforce") {
    addService(
      "fail2ban.service",
      "not-found",
      "disabled",
      "expected brute-force protection missing"
    );
  }

  if (advanced) {
    addService("auditd.service", "running", "enabled", "audit collection active");
    for (const [name, notes] of roleInventory(kind)) {
      addService(name, "running", "enabled", notes);
    }

    for (const row of buildServiceRows(context, 115).split("\n")) {
      const [name, status, startup, notes] = row.split(",");
      if (!name || services.has(name)) continue;
      if (name === "sshd.service" && services.has("ssh.service")) continue;
      if (name === "rsyslogd.service" && services.has("rsyslog.service")) continue;
      addService(name, status || "running", startup || "enabled", notes || "enterprise background service");
    }
  }

  return `service,status,startup,notes\n${Array.from(services.values()).join("\n")}\n`;
}

function roleInventory(kind: string): Array<[string, string]> {
  const profiles: Record<string, Array<[string, string]>> = {
    platform: [
      ["gitlab-runner.service", "CI runner"],
      ["gitaly.service", "Git storage service"],
      ["docker.service", "build container runtime"],
      ["containerd.service", "container runtime"],
    ],
    web: [
      ["apache2.service", "web service"],
      ["nginx.service", "reverse proxy"],
      ["certbot.timer", "certificate renewal"],
      ["php8.3-fpm.service", "application worker pool"],
    ],
    backup: [
      ["backup-agent.service", "backup orchestration"],
      ["rsync.service", "backup transfer daemon"],
      ["restic.timer", "snapshot schedule"],
    ],
    container: [
      ["containerd.service", "container runtime"],
      ["docker.service", "container engine"],
      ["kubelet.service", "Kubernetes node agent"],
      ["kube-proxy.service", "Kubernetes service proxy"],
    ],
    dns: [
      ["bind9.service", "authoritative DNS service"],
      ["systemd-resolved.service", "local resolver"],
    ],
    mail: [
      ["postfix.service", "mail transfer agent"],
      ["opendkim.service", "DKIM signing service"],
      ["rspamd.service", "mail filtering"],
    ],
    access: [
      ["fail2ban.service", "authentication protection"],
      ["openvpn.service", "remote access VPN"],
      ["ssh.service", "remote access service"],
    ],
    monitoring: [
      ["prometheus.service", "metrics collection"],
      ["grafana-agent.service", "telemetry forwarder"],
      ["node_exporter.service", "host metrics exporter"],
      ["promtail.service", "log shipper"],
    ],
    database: [
      ["postgresql.service", "database engine"],
      ["pgbouncer.service", "database connection pool"],
      ["pgbackrest.service", "database backup orchestration"],
    ],
    general: [],
  };

  return profiles[kind] || profiles.general;
}

function buildHardeningChecklist(
  world: LinuxAssetInput["world"],
  incident: LinuxAssetInput["incident"]
) {
  return `# Linux Hardening Checklist

Case: ${world.caseId}
Host: ${world.host}
Review status: unverified; no remediation decision has been made

Decision checklist

- Establish the finding from the evidence assigned to the task, with an explicit confidence limit.
- Compare authorised maintenance, operational error and unauthorised activity before selecting an explanation.
- Identify what additional observation could change the finding.
- Propose a proportionate action only after establishing its evidence basis, operational impact, approval and rollback conditions.
- Preserve evidence needed to review the decision.
`;
}
