import type { LinuxAssetInput } from "./types";
import { csvRow } from "./investigation";
import { buildLinuxDiversityProfile, linuxStableDiversityHash } from "./diversityProfile";

export type EnterpriseIdentity = {
  username: string;
  role: string;
  department: string;
  manager: string;
  owner: string;
  uid: number;
  gid: number;
  email: string;
  homeDirectory: string;
  shell: string;
  status: "active" | "disabled" | "expired" | "service";
  kind: "human" | "service" | "contractor" | "temporary" | "disabled";
  sudo: "yes" | "no" | "limited";
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function hashedOffset(index: number, salt: number, spanSeconds: number) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return Math.floor((value - Math.floor(value)) * spanSeconds);
}

function pick<T>(items: T[], index: number) {
  return items[index % items.length];
}

export function timeAt(index: number, startHour = 6) {
  const clusters = [
    startHour * 3600 + 11 * 60,
    7 * 3600 + 48 * 60,
    8 * 3600 + 7 * 60,
    9 * 3600 + 26 * 60,
    11 * 3600 + 54 * 60,
    13 * 3600 + 17 * 60,
    15 * 3600 + 43 * 60,
    17 * 3600 + 8 * 60,
    21 * 3600 + 37 * 60,
  ];
  const cluster = clusters[hashedOffset(index, startHour, clusters.length)];
  const span = index % 9 === 0 ? 19 * 60 : index % 4 === 0 ? 41 * 60 : 73 * 60;
  const totalSeconds = (cluster + hashedOffset(index, startHour + 17, span)) % (24 * 3600);
  const hour = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${pad(hour)}:${pad(minutes)}:${pad(seconds)}`;
}

function hostIp(baseGateway: string, offset: number) {
  const parts = baseGateway.split(".");
  return `${parts[0]}.${parts[1]}.${parts[2]}.${offset}`;
}

function parseUtc(value: string) {
  return new Date(`${value.replace(" ", "T")}Z`);
}

function formatMinuteUtc(value: Date) {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}

function boundedLastLogin(context: LinuxAssetInput, index: number) {
  const collection = context.simulation?.collection?.collectedAt || `${context.world.incidentDate} 00:00:00`;
  const hash = linuxStableDiversityHash(`${context.world.caseId}:login:${index}`);
  // Historical logins are independent observations, not a sequence manufactured
  // by clipping future timestamps to successive minutes before collection.
  if (hash % 11 === 0) return "never";
  const days = [0, 1, 2, 7, 14, 35, 91][hash % 7];
  const offsetMinutes = 17 + days * 1440 + (Math.floor(hash / 7) % 1327);
  return formatMinuteUtc(new Date(parseUtc(collection).getTime() - offsetMinutes * 60000));
}

function slugName(value: string) {
  return value.replace(/[^a-z0-9._-]/gi, "").toLowerCase();
}

function identity(
  context: LinuxAssetInput,
  username: string,
  index: number,
  overrides: Partial<EnterpriseIdentity> = {}
): EnterpriseIdentity {
  const clean = slugName(username);
  const explicitInteractiveOverride =
    overrides.status === undefined &&
    overrides.shell === "/bin/bash" &&
    overrides.role === "operations engineer";
  const service =
    !explicitInteractiveOverride &&
    (overrides.status === "service" ||
      clean.startsWith("svc-") ||
      clean.includes("agent") ||
      clean.includes("runner") ||
      clean === "deploy" ||
      clean === "monitoring");
  const contractor = clean.includes("contractor") || clean.includes("vendor") || clean.includes("fieldtech") || clean.startsWith("ext-");
  const disabled = clean.startsWith("former-") || clean.startsWith("ex-") || clean.startsWith("old-") || clean.startsWith("expired-");
  const temporary = clean.includes("temp") || clean.includes("intern") || clean.includes("trainee") || clean.includes("junior") || clean.includes("apprentice");
  const kind = disabled ? "disabled" : service ? "service" : contractor ? "contractor" : temporary ? "temporary" : "human";
  const role =
    overrides.role ||
    (service
      ? serviceAccountRole(clean, context.world.serverRole)
      : contractor
      ? "external support engineer"
      : temporary
      ? "temporary IT support"
      : "operations engineer");
  const department =
    overrides.department ||
    (service
      ? "Platform Engineering"
      : contractor
      ? "Vendor"
      : temporary
      ? "Internal IT"
      : context.world.department);

  return {
    username: clean,
    role,
    department,
    manager: overrides.manager || (department === "Vendor" ? "vendor account manager" : "morgan.admin"),
    owner: overrides.owner || department,
    uid: overrides.uid ?? 1100 + index,
    gid: overrides.gid ?? 1100 + index,
    email: overrides.email || `${clean.replace(/[._]/g, ".")}@${context.world.emailDomain}`,
    homeDirectory:
      overrides.homeDirectory ||
      (service || overrides.status === "service"
        ? `/srv/${clean}`
        : disabled
        ? `/nonexistent/${clean}`
        : `/home/${clean}`),
    shell:
      overrides.shell ||
      (clean === slugName(context.world.serviceUser) &&
      ["service_account_misuse", "data_staging"].includes(context.incident.id)
        ? "/bin/bash"
        : service || overrides.status === "service" || disabled
        ? "/usr/sbin/nologin"
        : "/bin/bash"),
    status: overrides.status || (disabled ? "disabled" : service ? "service" : "active"),
    kind,
    sudo: overrides.sudo || (service ? "limited" : contractor ? "limited" : "no"),
  };
}

function serviceAccountRole(username: string, hostRole: string) {
  const lower = `${username} ${hostRole}`.toLowerCase();
  if (lower.includes("ci") || lower.includes("runner")) return "CI automation account";
  if (lower.includes("git")) return "source control service account";
  if (lower.includes("monitor")) return "monitoring service account";
  if (lower.includes("backup")) return "backup service account";
  if (lower.includes("deploy")) return "deployment service account";
  if (lower.includes("web") || lower.includes("api") || lower.includes("portal")) return "application runtime account";
  return "service account";
}

export function enterpriseIdentities(context: LinuxAssetInput) {
  const { world } = context;
  const diversity = context.simulation?.diversityProfile || buildLinuxDiversityProfile({
    world,
    incidentFamily: context.incident.id,
    difficulty: context.input.difficulty,
  });
  const humans = [
    "rpatel",
    "j.smith",
    "ahmed.khan",
    "nora.ir",
    "mclarke",
    "jwilliams",
    "aevans",
    "sarah.chen",
    "liam.oneill",
    "maria.garcia",
    "tom.baker",
    "priya.shah",
    "daniel.ross",
    "emma.wilson",
    "oliver.king",
    "megan.price",
    "hassan.ali",
    "lucy.morgan",
    "ben.carter",
    "zoe.hughes",
    "samir.nasser",
    "katie.brooks",
    "owen.reed",
    "claire.evans",
    "raj.menon",
    "amy.turner",
    "michael.scott",
    "george.hill",
    "laura.foster",
    "david.gray",
    "erin.murphy",
    "jack.collins",
  ];
  const service = [
    "svc-backup",
    "svc-monitoring",
    "svc-deploy",
    "svc-ci",
    "svc-git",
    "svc-report",
    "svc-api",
    "svc-web",
    "backup-agent",
    "deploy-runner",
  ];
  const contractors = [
    "contractor-lee",
    "vendor-netops",
    "vendor-linux",
    "fieldtech-mason",
    "contractor-patel",
    "ext-buildops",
  ];
  const disabled = [
    "former-admin",
    "ex-jturner",
    "old-migration",
    "temp-q3-rollout",
    "expired-vendor",
  ];

  const allocationKey = `${diversity.key}:${world.serverRole}`;
  // Disjoint provisioning slots guarantee uniqueness; irregular offsets and
  // mixed cohorts prevent a base-plus-stride inventory fingerprint.
  const uidForSlot = (slot: number) => 1200 + slot * 83
    + linuxStableDiversityHash(`${allocationKey}:uid:${slot}`) % 71;
  const coreByKey: Record<string, [string, Partial<EnterpriseIdentity>]> = {
    analyst: [world.analystUser, { role: "security analyst", department: "Security Operations", owner: "SOC", sudo: "yes" }],
    intern: [world.internUser, { role: "temporary IT support", department: "Internal IT" }],
    service: [world.serviceUser, { role: serviceAccountRole(world.serviceUser, world.serverRole), department: "Infrastructure", status: "service", sudo: "limited" }],
    admin: [world.adminUser, { role: "linux administrator", department: "Infrastructure", sudo: "yes" }],
    contractor: [world.contractorUser, { role: "maintenance contractor", department: "Vendor", sudo: "limited" }],
    app: [world.appUser, { role: serviceAccountRole(world.appUser, world.serverRole), department: "Web", status: "service" }],
    employee: [world.employeeUser, { role: "business user", department: world.department }],
  };
  const seeded: Array<[string, Partial<EnterpriseIdentity>]> = diversity.identityOrder.map((key, slot) => {
    const [username, overrides] = coreByKey[key];
    const uid = uidForSlot(slot);
    return [username, { ...overrides, uid, gid: uid }];
  });
  [
    ["former-admin", { role: "former administrator", department: "HR Offboarding", status: "disabled", sudo: "no" }],
    ["devops", { role: "platform engineer", department: "Platform Engineering", sudo: "yes" }],
    ["auditor", { role: "read-only audit account", department: "Compliance" }],
    ["deploy", { role: "deployment automation", department: "Platform Engineering", status: "service", sudo: "limited" }],
    ["monitoring", { role: "monitoring service", department: "Security Operations", status: "service" }],
  ].forEach(([username, overrides], index) => {
    const uid = uidForSlot(diversity.identityOrder.length + index);
    seeded.push([username as string, { ...(overrides as Partial<EnterpriseIdentity>), uid, gid: uid }]);
  });
  if (context.testOverrides?.primaryUsername) {
    const primary = context.testOverrides.primaryUsername;
    const uid = context.testOverrides.uid ?? 1012;
    const gid = context.testOverrides.gid ?? uid;
    seeded.unshift([
      primary,
      {
        role: "operations engineer",
        department: context.world.department,
        uid,
        gid,
        sudo: "limited",
        shell: "/bin/bash",
      },
    ]);
  }
  if (context.testOverrides?.serviceAccountUsername) {
    const service = context.testOverrides.serviceAccountUsername;
    seeded.unshift([
      service,
      {
        role: serviceAccountRole(service, context.world.serverRole),
        department: "Infrastructure",
        uid: context.testOverrides.primaryUsername === service ? 1013 : 1014,
        gid: context.testOverrides.primaryUsername === service ? 1013 : 1014,
        status: "service",
        sudo: "limited",
      },
    ]);
  }
  const seen = new Set<string>();
  const identities: EnterpriseIdentity[] = [];

  for (const [username, overrides] of seeded) {
    const clean = slugName(username);
    if (seen.has(clean)) continue;
    seen.add(clean);
    identities.push(identity(context, clean, identities.length, overrides));
  }

  const cohort = roleKind(world.serverRole);
  const humanRoles: Record<string, string[]> = {
    mail: ["messaging operator", "mail security analyst", "directory administrator"],
    access: ["access operations analyst", "network administrator", "identity support engineer"],
    database: ["database administrator", "data platform analyst", "reporting operator"],
    platform: ["release engineer", "build platform operator", "source control administrator"],
    container: ["container platform operator", "cluster reliability engineer", "release engineer"],
    backup: ["recovery operator", "storage administrator", "retention analyst"],
    web: ["application operator", "web platform engineer", "release coordinator"],
    dns: ["DNS administrator", "network operations analyst", "resolver service owner"],
    monitoring: ["observability engineer", "telemetry operator", "incident coordinator"],
    general: ["systems administrator", "endpoint operator", "support analyst"],
  };
  const roles = humanRoles[cohort] || humanRoles.general;
  const pool = [...humans, ...service, ...contractors, ...disabled].sort((a, b) =>
    linuxStableDiversityHash(`${allocationKey}:population:${a}`) - linuxStableDiversityHash(`${allocationKey}:population:${b}`));
  const populationLimit = ["access", "platform", "container"].includes(cohort) ? 34 : 22;
  for (const username of pool) {
    if (identities.length >= populationLimit) break;
    const clean = slugName(username);
    if (seen.has(clean)) continue;
    seen.add(clean);
    const uid = uidForSlot(32 + identities.length);
    const role = humans.includes(username) ? roles[linuxStableDiversityHash(`${allocationKey}:${username}:role`) % roles.length] : undefined;
    identities.push(identity(context, clean, identities.length, { uid, gid: uid, ...(role ? { role } : {}) }));
  }

  return identities.sort((a, b) => linuxStableDiversityHash(`${allocationKey}:row:${a.username}`)
    - linuxStableDiversityHash(`${allocationKey}:row:${b.username}`));
}

export function enterpriseUsernames(context: LinuxAssetInput) {
  return enterpriseIdentities(context).map((item) => item.username);
}

export function identityFor(context: LinuxAssetInput, username: string) {
  return enterpriseIdentities(context).find((item) => item.username === slugName(username));
}

export function homeDirectoryFor(context: LinuxAssetInput, username: string) {
  return identityFor(context, username)?.homeDirectory || `/home/${slugName(username)}`;
}

export function roleKind(role: string) {
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

export function roleServices(role: string) {
  const common = ["NetworkManager", "cron", "rsyslogd", "node_exporter", "apt-daily.service"];
  const byRole: Record<string, string[]> = {
    platform: ["gitlab-runner", "buildkite-agent", "containerd", "dockerd", "artifact-cache"],
    web: ["apache2", "nginx", "php-fpm", "certbot", "varnish"],
    backup: ["backup-agent", "restic", "rsync", "borgmatic", "snapshotd"],
    container: ["dockerd", "containerd", "kubelet", "calico-node", "metrics-sidecar"],
    dns: ["named", "systemd-resolved", "unbound", "bind9", "dnsdist"],
    mail: ["postfix", "postfix/qmgr", "opendkim", "rspamd", "dovecot"],
    access: ["sshd", "fail2ban", "openvpn", "wireguard", "pam-script"],
    monitoring: ["promtail", "grafana-agent", "telegraf", "alertmanager", "node_exporter"],
    database: ["postgresql", "mysql", "pgbouncer", "redis-server", "pgbackrest"],
    general: ["snapd", "dbus", "chronyd", "logrotate", "smartd"],
  };

  return [...common, ...byRole[roleKind(role)]];
}

export function roleTasks(role: string) {
  const byRole: Record<string, string[]> = {
    platform: ["/usr/local/bin/prune-build-cache", "/opt/runner/bin/healthcheck", "/usr/local/sbin/artifact-sync"],
    web: ["/usr/local/sbin/check-vhosts", "/usr/bin/certbot renew --quiet", "/opt/web/bin/cache-warm"],
    backup: ["/usr/local/sbin/restic-repository-check.sh", "/usr/local/bin/restic snapshots", "/usr/local/sbin/verify-backup-index"],
    container: ["/usr/local/sbin/container-health", "/usr/bin/crictl ps", "/opt/kube/bin/node-heartbeat"],
    dns: ["/usr/local/sbin/check-zones", "/usr/sbin/rndc status", "/usr/local/bin/dns-cache-report"],
    mail: ["/usr/local/sbin/check-mailq", "/usr/sbin/postqueue -p", "/usr/local/bin/dkim-key-check"],
    access: ["/usr/local/sbin/access-health", "/usr/bin/faillock --summary", "/usr/local/bin/session-audit"],
    monitoring: ["/usr/local/bin/telemetry-rollup", "/opt/monitoring/bin/probe-check", "/usr/local/sbin/promtail-health"],
    database: ["/usr/local/sbin/check-replication", "/usr/bin/pg_isready", "/usr/local/bin/db-backup-verify"],
    general: ["/usr/local/sbin/health-check.sh", "/usr/lib/apt/apt.systemd.daily", "/usr/sbin/logrotate /etc/logrotate.conf"],
  };

  return byRole[roleKind(role)];
}

export function hostActivityProfile(role: string, industry = "") {
  const kind = roleKind(role);
  const profiles: Record<string, { auth: number; syslog: number; journal: number; cron: number; audit: number; packages: number }> = {
    platform: { auth: 90, syslog: 190, journal: 95, cron: 48, audit: 80, packages: 34 },
    web: { auth: 38, syslog: 170, journal: 70, cron: 58, audit: 56, packages: 32 },
    backup: { auth: 24, syslog: 145, journal: 62, cron: 88, audit: 64, packages: 30 },
    container: { auth: 28, syslog: 185, journal: 105, cron: 42, audit: 66, packages: 34 },
    dns: { auth: 16, syslog: 155, journal: 42, cron: 28, audit: 34, packages: 24 },
    mail: { auth: 20, syslog: 175, journal: 54, cron: 45, audit: 42, packages: 28 },
    access: { auth: 120, syslog: 160, journal: 88, cron: 34, audit: 72, packages: 26 },
    monitoring: { auth: 18, syslog: 185, journal: 60, cron: 50, audit: 36, packages: 30 },
    database: { auth: 22, syslog: 150, journal: 58, cron: 96, audit: 62, packages: 30 },
    general: { auth: 36, syslog: 120, journal: 50, cron: 38, audit: 42, packages: 24 },
  };
  const profile = { ...(profiles[kind] || profiles.general) };
  const lowerIndustry = industry.toLowerCase();

  if (lowerIndustry.includes("finance") || lowerIndustry.includes("government") || lowerIndustry.includes("health")) {
    profile.audit += 24;
    profile.auth = Math.max(12, profile.auth - 8);
  }
  if (lowerIndustry.includes("education") || lowerIndustry.includes("research")) {
    profile.auth += 18;
    profile.packages += 4;
  }
  if (lowerIndustry.includes("saas") || lowerIndustry.includes("hosting")) {
    profile.syslog += 22;
    profile.journal += 12;
  }

  const lowerRole = role.toLowerCase();
  const jitterSeed = [...`${lowerRole}:${lowerIndustry}`].reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0
  );
  const jitter = (mod: number, spread: number) => (jitterSeed % mod) - spread;
  profile.auth = Math.max(12, profile.auth + jitter(17, 8));
  profile.syslog = Math.max(80, profile.syslog + jitter(23, 11));
  profile.journal = Math.max(36, profile.journal + jitter(19, 9));
  profile.cron = Math.max(20, profile.cron + jitter(13, 6));
  profile.audit = Math.max(28, profile.audit + jitter(15, 7));
  profile.packages = Math.max(18, profile.packages + jitter(9, 4));

  if (kind === "access") {
    if (lowerRole.includes("vpn") || lowerRole.includes("gateway")) {
      profile.auth += 28;
      profile.journal += 10;
      profile.audit = Math.max(36, profile.audit - 6);
      profile.cron = Math.max(22, profile.cron - 4);
    } else if (lowerRole.includes("jump") || lowerRole.includes("bastion")) {
      profile.auth += 10;
      profile.audit += 18;
      profile.cron += 5;
    } else if (lowerRole.includes("proxy")) {
      profile.syslog += 18;
      profile.auth = Math.max(20, profile.auth - 12);
    }
  }

  return profile;
}

export function buildEnterpriseHosts({ world, investigation }: LinuxAssetInput) {
  const kind = roleKind(world.serverRole);
  const roleSpecificHosts: Record<string, Array<{ host: string; role: string; owner: string; criticality: string; environment: string }>> = {
    platform: [
      { host: "runner-cache-01", role: "artifact cache", owner: "Platform Engineering", criticality: "medium", environment: "production" },
      { host: "registry-01", role: "container registry", owner: "Platform Engineering", criticality: "high", environment: "production" },
    ],
    web: [
      { host: "cdn-origin-01", role: "origin web node", owner: "Digital Services", criticality: "high", environment: "production" },
      { host: "waf-log-01", role: "web security logging", owner: "Security Operations", criticality: "medium", environment: "production" },
    ],
    backup: [
      { host: "vault-01", role: "backup vault", owner: "Infrastructure Operations", criticality: "critical", environment: "disaster recovery" },
      { host: "restore-test-01", role: "restore validation host", owner: "Infrastructure Operations", criticality: "medium", environment: "test" },
    ],
    container: [
      { host: "registry-01", role: "container registry", owner: "Platform Engineering", criticality: "high", environment: "production" },
      { host: "kube-api-01", role: "cluster control plane", owner: "Platform Engineering", criticality: "critical", environment: "production" },
    ],
    dns: [
      { host: "dns-secondary-01", role: "secondary resolver", owner: "Infrastructure Operations", criticality: "high", environment: "production" },
      { host: "dhcp-lnx-01", role: "DHCP service", owner: "Infrastructure Operations", criticality: "medium", environment: "production" },
    ],
    mail: [
      { host: "mailarchive-01", role: "mail archive", owner: "Internal IT", criticality: "high", environment: "production" },
      { host: "smtp-edge-01", role: "SMTP edge relay", owner: "Internal IT", criticality: "medium", environment: "production" },
    ],
    access: [
      { host: "pam-01", role: "privileged access management", owner: "Security Operations", criticality: "high", environment: "production" },
      { host: "vpn01", role: "remote access gateway", owner: "Network Operations", criticality: "high", environment: "production" },
    ],
    monitoring: [
      { host: "siem-forwarder-01", role: "SIEM forwarder", owner: "Security Operations", criticality: "high", environment: "production" },
      { host: "metrics-store-01", role: "metrics storage", owner: "Security Operations", criticality: "medium", environment: "production" },
    ],
    database: [
      { host: "db-replica-01", role: "database replica", owner: "Business Systems", criticality: "high", environment: "production" },
      { host: "reporting-etl-01", role: "ETL worker", owner: "Business Systems", criticality: "medium", environment: "production" },
    ],
    general: [],
  };
  const extraHosts = roleSpecificHosts[kind].map((host, index) => ({
    ...host,
    ip: hostIp(world.gatewayIp, 131 + index),
  }));

  return [
    { host: world.host, role: world.serverRole, ip: investigation.hostIp, owner: world.department, criticality: "high", environment: "production" },
    { host: world.webHost, role: "internal web server", ip: hostIp(world.gatewayIp, 51), owner: "Digital Services", criticality: "medium", environment: "production" },
    { host: world.dbHost, role: "database server", ip: hostIp(world.gatewayIp, 61), owner: "Business Systems", criticality: "high", environment: "production" },
    { host: "auth01", role: "identity services", ip: hostIp(world.gatewayIp, 11), owner: "Infrastructure Operations", criticality: "high", environment: "production" },
    { host: "backup01", role: "backup repository", ip: hostIp(world.gatewayIp, 72), owner: "Infrastructure Operations", criticality: "high", environment: "disaster recovery" },
    { host: "git01", role: "source control", ip: hostIp(world.gatewayIp, 81), owner: "Platform Engineering", criticality: "medium", environment: "production" },
    { host: "mail01", role: "mail relay", ip: hostIp(world.gatewayIp, 91), owner: "Internal IT", criticality: "medium", environment: "production" },
    { host: "proxy01", role: "egress proxy", ip: hostIp(world.gatewayIp, 101), owner: "Network Operations", criticality: "medium", environment: "production" },
    { host: "jump01", role: "administrative jump host", ip: hostIp(world.gatewayIp, 111), owner: "Security Operations", criticality: "high", environment: "production" },
    { host: "vpn01", role: "remote access gateway", ip: hostIp(world.gatewayIp, 121), owner: "Network Operations", criticality: "high", environment: "production" },
    { host: "monitor01", role: "monitoring server", ip: world.monitoringIp, owner: "Security Operations", criticality: "medium", environment: "production" },
    ...extraHosts,
  ];
}

function selectRenderedEnterpriseIdentities(context: LinuxAssetInput, count: number) {
  const population = enterpriseIdentities(context);
  const requiredNames = new Set([
    ...(context.simulation?.identities || []).map((item) => item.username),
    context.incident.primaryUser,
    context.world.analystUser,
    context.world.adminUser,
    context.world.employeeUser,
    context.world.contractorUser,
    context.world.internUser,
    context.world.serviceUser,
    context.world.appUser,
  ]);
  const requiredUsers = population.filter((user) => requiredNames.has(user.username));
  const optionalUsers = population.filter((user) => !requiredNames.has(user.username));
  const selectedNames = new Set(
    [...requiredUsers, ...optionalUsers.slice(0, Math.max(0, count - requiredUsers.length))]
      .map((user) => user.username)
  );

  return population.filter((user) => selectedNames.has(user.username));
}

export function buildCsvUsers(context: LinuxAssetInput, count: number) {
  const { world } = context;
  const sessionLastLogins = new Map((context.simulation?.sshSessions || []).map((session) => [
    session.username,
    session.openedAt.slice(0, 16),
  ]));
  const exceptionUsers = new Set<string>();
  if (
    [
      "misconfigured_sudoers",
      "service_account_misuse",
      "data_staging",
      "cron_persistence",
      "systemd_persistence",
      "reverse_shell",
      "docker_compromise",
    ].includes(context.incident.id)
  ) {
    exceptionUsers.add(context.incident.primaryUser);
  }
  const renderedUsers = selectRenderedEnterpriseIdentities(context, count);
  const rows = renderedUsers.map((user, i) =>
    csvRow([
      user.username,
      user.role,
      exceptionUsers.has(user.username) && user.sudo === "no" ? "limited" : user.sudo,
      user.status === "disabled" || user.status === "expired" || (user.shell.endsWith("nologin") && !sessionLastLogins.has(user.username))
        ? "never"
        : sessionLastLogins.get(user.username)
          ? sessionLastLogins.get(user.username)
        : boundedLastLogin(context, i),
      user.status,
      user.owner,
      user.uid,
      user.gid,
      user.email,
      user.manager,
      user.homeDirectory,
      user.shell,
      user.kind,
    ])
  );

  const renderedNames = new Set(renderedUsers.map((user) => user.username));
  for (const identity of context.simulation?.identities || []) {
    if (renderedNames.has(identity.username)) continue;
    const profile = systemIdentityProfile(identity.username);
    rows.push(csvRow([
      identity.username,
      profile.role,
      identity.username === "root" ? "yes" : "no",
      "never",
      "active",
      profile.owner,
      identity.uid,
      identity.gid,
      profile.email,
      profile.manager,
      profile.home,
      profile.shell,
      "system",
    ]));
    renderedNames.add(identity.username);
  }

  return rows.join("\n");
}

function systemIdentityProfile(username: string) {
  const profiles: Record<string, { role: string; owner: string; home: string; shell: string; email: string; manager: string }> = {
    root: { role: "Local Superuser", owner: "Platform Engineering", home: "/root", shell: "/bin/bash", email: "root@localhost", manager: "platform-lead" },
    "www-data": { role: "Web Runtime", owner: "Web Platform", home: "/var/www", shell: "/usr/sbin/nologin", email: "www-data@localhost", manager: "platform-lead" },
    git: { role: "Git Service", owner: "Platform Engineering", home: "/var/lib/git", shell: "/usr/sbin/nologin", email: "git@localhost", manager: "platform-lead" },
    "gitlab-runner": { role: "CI Runner", owner: "Platform Engineering", home: "/var/lib/gitlab-runner", shell: "/usr/sbin/nologin", email: "gitlab-runner@localhost", manager: "platform-lead" },
    postgres: { role: "Database Runtime", owner: "Database Operations", home: "/var/lib/postgresql", shell: "/usr/sbin/nologin", email: "postgres@localhost", manager: "db-ops" },
    bind: { role: "DNS Runtime", owner: "Infrastructure", home: "/var/cache/bind", shell: "/usr/sbin/nologin", email: "bind@localhost", manager: "infra-lead" },
    postfix: { role: "Mail Runtime", owner: "Messaging Operations", home: "/var/spool/postfix", shell: "/usr/sbin/nologin", email: "postfix@localhost", manager: "infra-lead" },
    prometheus: { role: "Monitoring Runtime", owner: "Observability", home: "/var/lib/prometheus", shell: "/usr/sbin/nologin", email: "prometheus@localhost", manager: "observability-lead" },
  };
  return profiles[username] || {
    role: "System Account",
    owner: "Platform Engineering",
    home: `/home/${username}`,
    shell: "/usr/sbin/nologin",
    email: `${username}@localhost`,
    manager: "platform-lead",
  };
}

export function buildCsvGroups(context: LinuxAssetInput, count: number, userLimit = Number.POSITIVE_INFINITY) {
  const names = ["developers", "platform", "finance", "hr", "audit", "monitoring", "release", "support"];
  const users = selectRenderedEnterpriseIdentities(context, userLimit)
    .filter((user) => user.status === "active")
    .map((user) => user.username);
  const rows = names.slice(0, Math.min(count, names.length)).map((name, i) =>
    csvRow([name, `${pick(users, i)},${pick(users, i + 7)}`])
  );

  return rows.join("\n");
}

export function buildServiceRows(context: LinuxAssetInput, count: number) {
  const base = [
    "apparmor.service",
    "auditd.service",
    "cron.service",
    "dbus.service",
    "logrotate.service",
    "NetworkManager.service",
    "node_exporter.service",
    "polkit.service",
    "rsyslog.service",
    "ssh.service",
    "systemd-journald.service",
    "systemd-logind.service",
    "systemd-networkd.service",
    "systemd-resolved.service",
    "systemd-timesyncd.service",
    "unattended-upgrades.service",
    "user@1000.service",
  ];
  const units = Array.from(new Set([...base, ...roleServices(context.world.serverRole).map((service) => {
    const unit = service.replace(/\//g, "-");
    return unit.endsWith(".service") ? unit : `${unit}.service`;
  })]));
  return units.slice(0, count).map((service, i) => {
    if (service === "apt-daily.service" || service === "apt-daily-upgrade.service") {
      return csvRow([service, "inactive", "static", "standard APT one-shot service"]);
    }
    if (service === "apt-daily.timer" || service === "apt-daily-upgrade.timer") {
      return csvRow([service, "active", "enabled", "standard APT timer"]);
    }
    const status = service.includes("fail2ban") && context.incident.id === "ssh_bruteforce" ? "not-found" : i % 11 === 0 ? "inactive" : "running";
    const startup = status === "not-found" ? "disabled" : i % 7 === 0 ? "disabled" : "enabled";
    return csvRow([service, status, startup, "observed systemd unit"]);
  }).join("\n");
}

export function buildProcessRows(context: LinuxAssetInput, count: number) {
  const { world } = context;
  const role = roleKind(world.serverRole);
  const baseline: Array<[string, number, number, string]> = [
    ["root", 2, 0, "[kthreadd]"],
    ["root", 3, 2, "[rcu_gp]"],
    ["root", 4, 2, "[rcu_par_gp]"],
    ["root", 15, 2, "[kworker/0:1-events]"],
    ["root", 16, 2, "[ksoftirqd/0]"],
    ["root", 301, 1, "/lib/systemd/systemd-journald"],
    ["root", 329, 1, "/lib/systemd/systemd-udevd"],
    ["systemd-resolve", 521, 1, "/lib/systemd/systemd-resolved"],
    ["messagebus", 544, 1, "/usr/bin/dbus-daemon --system --address=systemd: --nofork --nopidfile"],
    ["syslog", 612, 1, "/usr/sbin/rsyslogd -n -iNONE"],
    ["root", 644, 1, "/usr/sbin/cron -f"],
    ["root", 701, 1, "/usr/sbin/NetworkManager --no-daemon"],
    ["root", 812, 1, "/usr/sbin/sshd -D"],
    ["root", 833, 1, "/usr/sbin/auditd"],
    ["root", 899, 1, "/usr/libexec/polkitd --no-debug"],
  ];
  const byRole: Record<string, Array<[string, number, number, string]>> = {
    platform: [
      ["git", 1170, 1, "/usr/bin/gitaly /etc/gitlab/gitaly/config.toml"],
      ["gitlab-runner", 1184, 1, "/usr/bin/gitlab-runner run --working-directory /var/lib/gitlab-runner"],
      ["root", 1220, 1, "/usr/bin/containerd"],
      ["root", 1244, 1, "/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock"],
    ],
    web: [
      ["root", 1080, 1, "/usr/sbin/apache2 -k start"],
      ["www-data", 1088, 1080, "/usr/sbin/apache2 -k start"],
      ["www-data", 1091, 1080, "/usr/sbin/apache2 -k start"],
      ["www-data", 1125, 1, "nginx: worker process"],
    ],
    backup: [
      [world.serviceUser, 1150, 1, "/usr/local/bin/backup-agent --config /etc/backup-agent.yml"],
      [world.serviceUser, 1161, 1150, "/usr/bin/rsync --daemon --config=/etc/rsyncd.conf"],
      ["root", 1180, 1, "/usr/bin/restic unlock --repo /srv/backups"],
    ],
    container: [
      ["root", 1201, 1, "/usr/bin/containerd"],
      ["root", 1220, 1, "/usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:2375 --containerd=/run/containerd/containerd.sock"],
      ["root", 1260, 1, "/usr/bin/kubelet --config=/var/lib/kubelet/config.yaml"],
      ["root", 1290, 1201, "/usr/bin/containerd-shim-runc-v2 -namespace moby"],
    ],
    dns: [
      ["bind", 1064, 1, "/usr/sbin/named -f -u bind"],
      ["root", 1070, 1, "/usr/sbin/rndc -c /etc/bind/rndc.conf status"],
    ],
    mail: [
      ["root", 1032, 1, "/usr/lib/postfix/sbin/master -w"],
      ["postfix", 1041, 1032, "qmgr -l -t unix -u"],
      ["postfix", 1042, 1032, "pickup -l -t unix -u -c"],
    ],
    access: [
      ["root", 1009, 1, "/usr/sbin/sshd -D"],
      ["root", 1030, 1, "/usr/sbin/fail2ban-server -xf start"],
      ["root", 1054, 1, "/usr/sbin/openvpn --config /etc/openvpn/corp.conf"],
    ],
    monitoring: [
      ["prometheus", 1102, 1, "/usr/bin/prometheus --config.file=/etc/prometheus/prometheus.yml"],
      ["grafana-agent", 1110, 1, "/usr/bin/grafana-agent --config.file=/etc/grafana-agent.yaml"],
      ["root", 1122, 1, "/usr/bin/node_exporter"],
    ],
    database: [
      ["postgres", 1035, 1, "/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main"],
      ["postgres", 1040, 1035, "postgres: 16/main: checkpointer"],
      ["postgres", 1041, 1035, "postgres: 16/main: background writer"],
      ["mysql", 1080, 1, "/usr/sbin/mysqld"],
    ],
    general: [],
  };
  const rows = [...baseline, ...(byRole[role] || [])];
  const users = enterpriseIdentities(context)
    .filter((identity) => identity.kind === "human" || identity.kind === "contractor" || identity.kind === "temporary")
    .map((identity) => identity.username);
  const sessionRows = Array.from({ length: Math.max(0, Math.min(count, 4)) }, (_, i): [string, number, number, string] => {
    const user = pick(users, i);
    const pid = 3000 + i * 3;
    return [user, pid, 812, `sshd: ${user}@pts/${i % 5}`];
  });

  return [...rows, ...sessionRows]
    .map(([user, pid, ppid, command]) => `${user.padEnd(16)} ${String(pid).padStart(5)} ${String(ppid).padStart(5)}  ${command}`)
    .join("\n");
}

export function buildPermissionRows(context: LinuxAssetInput, count: number) {
  const { world, investigation, incident } = context;
  const role = roleKind(world.serverRole);
  const rows = [
    ["/etc/ssh/sshd_config", "-rw-r--r--", "root root"],
    ["/etc/sudoers", "-r--r-----", "root root"],
    ["/etc/sudoers.d/platform", "-r--r-----", "root root"],
    ["/var/log/auth.log", "-rw-r-----", "syslog adm"],
    ["/var/log/syslog", "-rw-r-----", "syslog adm"],
    ["/var/log/audit/audit.log", "-rw-------", "root root"],
    [`/home/${world.adminUser}/.ssh/authorized_keys`, "-rw-------", `${world.adminUser} ${world.adminUser}`],
    [`/home/${world.contractorUser}/.ssh/authorized_keys`, "-rw-------", `${world.contractorUser} ${world.contractorUser}`],
    ["/usr/local/sbin/restic-repository-check.sh", "-rwxr-x---", `root ${world.serviceUser}`],
    ["/srv/shared/incident_notes.txt", "-rw-rw-r--", `${world.analystUser} analysts`],
    ...investigation.modifiedFiles.map((file) => permissionTuple(file, incident.primaryUser)),
    ...investigation.modifiedConfigurations.map((file) => [file, "-rw-r-----", "root root"]),
  ];
  const roleRows: Record<string, string[][]> = {
    platform: [["/var/lib/gitlab-runner/config.toml", "-rw-------", "root gitlab-runner"], ["/srv/git/repositories", "drwxrws---", "git git"], ["/var/run/docker.sock", "srw-rw----", "root docker"]],
    web: [["/var/www/html", "drwxr-xr-x", "www-data www-data"], ["/etc/apache2/sites-enabled/000-default.conf", "-rw-r--r--", "root root"]],
    backup: [["/srv/backups/current", "drwxr-x---", `${world.serviceUser} backup`], ["/etc/backup-agent.yml", "-rw-r-----", `root ${world.serviceUser}`]],
    container: [["/etc/docker/daemon.json", "-rw-r--r--", "root root"], ["/var/lib/docker", "drwxr-x---", "root root"], ["/var/run/docker.sock", "srw-rw----", "root docker"]],
    dns: [["/etc/bind/named.conf.local", "-rw-r--r--", "root bind"], ["/var/cache/bind", "drwxrwx---", "bind bind"]],
    mail: [["/etc/postfix/main.cf", "-rw-r--r--", "root root"], ["/var/spool/postfix", "drwxr-xr-x", "root root"]],
    access: [["/etc/security/access.conf", "-rw-r--r--", "root root"], ["/var/log/faillog", "-rw-r--r--", "root root"]],
    monitoring: [["/etc/prometheus/prometheus.yml", "-rw-r-----", "root prometheus"], ["/etc/grafana-agent.yaml", "-rw-r-----", "root grafana-agent"]],
    database: [["/etc/postgresql/16/main/postgresql.conf", "-rw-r--r--", "postgres postgres"], ["/var/lib/postgresql/16/main", "drwx------", "postgres postgres"]],
    general: [],
  };

  return [...rows, ...(roleRows[role] || [])]
    .filter((row, index, all) => all.findIndex((candidate) => candidate[0] === row[0]) === index)
    .slice(0, count)
    .map(([path, mode, owner]) => `${path} ${mode} ${owner}`)
    .join("\n");
}

function permissionTuple(file: string, user: string): [string, string, string] {
  if (file.startsWith("/var/log/")) return [file, "-rw-r-----", "syslog adm"];
  if (file.includes("/etc/sudoers")) return [file, "-r--r-----", "root root"];
  if (file === "/etc/group") return [file, "-rw-r--r--", "root root"];
  if (file.startsWith("/etc/")) return [file, "-rw-r-----", "root root"];
  if (file.startsWith("/usr/bin/")) return [file, "-rwxr-xr-x", "root root"];
  if (file.startsWith("/var/lib/docker")) return [file, "drwx--x---", "root root"];
  if (file.startsWith("/srv/")) return [file, "drwxr-x---", `${user} ${user}`];
  if (file.endsWith(".sh")) return [file, "-rwxr-x---", `${user} ${user}`];
  if (file.includes("/.ssh/authorized_keys")) return [file, "-rw-------", `${user} ${user}`];
  return [file, "-rw-r-----", `${user} ${user}`];
}

export function buildPackageRows(count: number, role = "general", excludeNames: string[] = []) {
  const rolePackages: Record<string, string[][]> = {
    platform: [["gitlab-runner", "17.5.2-1"], ["gitlab-ce", "17.5.3-ce.0"], ["containerd", "1.7.24-0ubuntu1"]],
    web: [["nginx", "1.24.0-2ubuntu7.3"], ["apache2", "2.4.58-1ubuntu8.5"], ["php8.3-fpm", "8.3.6-0ubuntu0.24.04.3"], ["certbot", "2.9.0-1"]],
    backup: [["restic", "0.16.4-1"], ["borgbackup", "1.2.8-1"], ["rsync", "3.2.7-1ubuntu1.2"]],
    container: [["kubelet", "1.31.4-1.1"], ["containerd", "1.7.24-0ubuntu1"], ["containernetworking-plugins", "1.1.1+ds1-3build1"]],
    dns: [["bind9", "1:9.18.30-0ubuntu0.24.04.2"], ["dnsutils", "1:9.18.30-0ubuntu0.24.04.2"]],
    mail: [["postfix", "3.8.6-1build2"], ["rspamd", "3.8.4-1"], ["opendkim", "2.11.0~beta2-9build2"]],
    access: [["openvpn", "2.6.10-0ubuntu1"], ["fail2ban", "1.0.2-3"], ["openssh-server", "1:9.6p1-3ubuntu13.8"]],
    monitoring: [["prometheus", "2.45.3+ds-2"], ["grafana-agent", "0.40.4-1"], ["promtail", "2.9.8-1"]],
    database: [["postgresql-16", "16.6-0ubuntu0.24.04.1"], ["pgbouncer", "1.21.0-1"], ["postgresql-client-16", "16.6-0ubuntu0.24.04.1"]],
    general: [],
  };
  const packages = [
    ["acl", "2.3.2-1build1"],
    ["apparmor", "4.0.1really4.0.1-0ubuntu0.24.04.3"],
    ["auditd", "1:3.1.2-2.1build1"],
    ["bash", "5.2.21-2ubuntu4"],
    ["ca-certificates", "20240203"],
    ["curl", "8.5.0-2ubuntu10.6"],
    ["dpkg", "1.22.6ubuntu6.1"],
    ["git", "1:2.43.0-1ubuntu7.2"],
    ["libpam-modules", "1.5.3-5ubuntu5.1"],
    ["logrotate", "3.21.0-2build1"],
    ["openssh-server", "1:9.6p1-3ubuntu13.8"],
    ["python3", "3.12.3-0ubuntu2"],
    ["rsync", "3.2.7-1ubuntu1.2"],
    ["rsyslog", "8.2312.0-3ubuntu9.1"],
    ["sudo", "1.9.15p5-3ubuntu5"],
    ["tar", "1.35+dfsg-3build1"],
    ["ufw", "0.36.2-6"],
    ["unattended-upgrades", "2.9.1+nmu4ubuntu1"],
    ["vim", "2:9.1.0016-1ubuntu7.6"],
    ["systemd", "255.4-1ubuntu8.8"],
    ["netplan.io", "1.1.1-1~ubuntu24.04.1"],
    ["cron", "3.0pl1-184ubuntu2"],
    ["dbus", "1.14.10-4ubuntu4.1"],
    ["lsof", "4.95.0-1build3"],
    ["procps", "2:4.0.4-4ubuntu3.2"],
  ];
  const excluded = new Set(excludeNames);
  const seen = new Set<string>();
  return [...(rolePackages[roleKind(role)] || []), ...packages]
    .filter(([name]) => !excluded.has(name))
    .filter(([name]) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .slice(0, count)
    .map(([name, version]) => `ii  ${name.padEnd(28)} ${version.padEnd(28)} amd64        ${packageDescription(name)}`)
    .join("\n");
}

function packageDescription(name: string) {
  const descriptions: Record<string, string> = {
    acl: "access control list utilities",
    apparmor: "user-space parser utility for AppArmor",
    "openssh-server": "secure shell server",
    auditd: "user space tools for security auditing",
    bash: "GNU Bourne Again SHell",
    "ca-certificates": "common CA certificates",
    curl: "command line tool for transferring data with URL syntax",
    dpkg: "Debian package management system",
    git: "fast distributed version control system",
    "libpam-modules": "Pluggable Authentication Modules for PAM",
    logrotate: "log rotation utility",
    nginx: "small, powerful, scalable web/proxy server",
    rsyslog: "reliable system and kernel logging daemon",
    "docker.io": "Linux container runtime",
    "postgresql-client-16": "front-end programs for PostgreSQL 16",
    python3: "interactive high-level object-oriented language",
    rsync: "fast, versatile, remote file-copying tool",
    sudo: "provide limited super user privileges",
    tar: "GNU version of the tar archiving utility",
    ufw: "program for managing a Netfilter firewall",
    "unattended-upgrades": "automatic installation of security upgrades",
    vim: "Vi IMproved text editor",
    systemd: "system and service manager",
    "netplan.io": "YAML network configuration abstraction",
    cron: "process scheduling daemon",
    dbus: "simple interprocess messaging system",
    lsof: "utility to list open files",
    procps: "command-line tools for the proc filesystem",
  };

  return descriptions[name] || "Ubuntu package";
}
