import { buildLinuxGenerationContext, type LinuxGenerationContext } from "./linux/generationContext";

export type InvestigationWorld = {
  company: string;
  industry: string;
  department: string;
  location: string;
  domain: string;
  emailDomain: string;
  caseId: string;
  ticketId: string;
  changeId: string;
  host: string;
  serverRole: string;
  webHost: string;
  dbHost: string;
  analystUser: string;
  adminUser: string;
  internUser: string;
  contractorUser: string;
  employeeUser: string;
  serviceUser: string;
  appUser: string;
  namingConvention: string;
  cidr: string;
  gatewayIp: string;
  dnsIp: string;
  monitoringIp: string;
  suspiciousIp: string;
  adminIp: string;
  backupIp: string;
  incidentDate: string;
  incidentType: string;
  securityMaturity: string;
  ticketStyle: string;
  documentationStyle: string;
  businessApplication: string;
  maintenanceWindow: string;
  businessHours: string;
  timezone: string;
};

function pick<T>(items: T[], context: LinuxGenerationContext, namespace: string) {
  return context.random(namespace).pick(items);
}

export function buildInvestigationWorld(context = buildLinuxGenerationContext({
  category: "Linux",
  difficulty: "Intermediate",
  duration: "30 mins",
  title: "CyberLab Asset Pack",
})): InvestigationWorld {
  const companies = [
    {
      company: "Northstar Fabrication Ltd",
      industry: "manufacturing",
      domain: "northstar-fab.example",
    },
    {
      company: "BlueRiver Logistics",
      industry: "logistics",
      domain: "blueriver-logistics.example",
    },
    {
      company: "Apex Retail Systems",
      industry: "retail",
      domain: "apex-retail.example",
    },
    {
      company: "Greenline Energy",
      industry: "energy",
      domain: "greenline-energy.example",
    },
    {
      company: "MetroCare Clinics",
      industry: "healthcare",
      domain: "metrocare-clinics.example",
    },
    {
      company: "Atlas Education Group",
      industry: "education",
      domain: "atlasedu.example",
    },
    {
      company: "HarbourPoint Finance",
      industry: "financial services",
      domain: "harbourpoint.example",
    },
    {
      company: "CedarWorks Media",
      industry: "media",
      domain: "cedarworks-media.example",
    },
    {
      company: "Oakbridge Legal",
      industry: "legal services",
      domain: "oakbridge-legal.example",
    },
    {
      company: "Silvergate SaaS",
      industry: "SaaS",
      domain: "silvergate-saas.example",
    },
    {
      company: "Crownbridge Council Services",
      industry: "local government",
      domain: "crownbridge-gov.example",
    },
    {
      company: "Redwood BioResearch",
      industry: "life sciences",
      domain: "redwood-bio.example",
    },
    {
      company: "Mercury Payments",
      industry: "payments",
      domain: "mercury-payments.example",
    },
    {
      company: "VectorCloud Hosting",
      industry: "managed hosting",
      domain: "vectorcloud.example",
    },
  ];

  const chosen = pick(companies, context, "company");
  const networkRandom = context.random("network");
  const subnet = networkRandom.nextInt(20, 70);
  const cidr = `10.${subnet}.14.0/24`;
  const timezone = pick(["UTC", "Europe/London", "Europe/Dublin"], context, "world.timezone");

  const environments = [
    { host: "bastion-01", role: "SSH bastion", department: "Security Operations", app: "privileged access gateway" },
    { host: "edge-ssh-01", role: "edge SSH gateway", department: "Infrastructure Operations", app: "remote administration gateway" },
    { host: "jumpbox-lnx-01", role: "administrative jump host", department: "Security Operations", app: "administrator access tier" },
    { host: "ci-runner-03", role: "CI runner", department: "Platform Engineering", app: "build and deployment pipeline" },
    { host: "git-lnx-02", role: "Git server", department: "Platform Engineering", app: "source control platform" },
    { host: "backup-lnx-01", role: "backup server", department: "Infrastructure Operations", app: "backup orchestration service" },
    { host: "prod-app-lnx-02", role: "application server", department: "Customer Platforms", app: "customer portal" },
    { host: "web-front-04", role: "web server", department: "Digital Services", app: "public web front end" },
    { host: "db-audit-01", role: "database host", department: "Business Systems", app: "reporting database" },
    { host: "vpn-lnx-01", role: "VPN gateway", department: "Network Operations", app: "remote access VPN" },
    { host: "dns-lnx-01", role: "DNS resolver", department: "Infrastructure Operations", app: "internal DNS" },
    { host: "mailrelay-02", role: "mail relay", department: "Internal IT", app: "notification mail relay" },
    { host: "proxy-lnx-01", role: "egress proxy", department: "Network Operations", app: "outbound proxy tier" },
    { host: "mon-lnx-02", role: "monitoring server", department: "Security Operations", app: "telemetry collection" },
    { host: "kube-worker-07", role: "Kubernetes worker node", department: "Platform Engineering", app: "container workload platform" },
    { host: "container-host-02", role: "container host", department: "Platform Engineering", app: "container runtime platform" },
  ];
  const environment = pick(environments, context, "host");

  const incidentType = pick([
    "SSH brute-force triage",
    "service account misuse",
    "sudo policy abuse review",
    "weak SSH hardening audit",
    "dormant account access review",
    "privilege and permissions investigation",
  ], context, "incident.type");

  const identifiersRandom = context.random("case.identifiers");
  const caseNumber = identifiersRandom.nextInt(1000, 10000);
  const ticketNumber = identifiersRandom.nextInt(10000, 100000);
  const changeNumber = identifiersRandom.nextInt(2000, 10000);
  const namingConvention = pick([
    "role-site-sequence",
    "environment-service-number",
    "department-platform-number",
    "service-region-ordinal",
    "function-platform-zone",
  ], context, "company.naming");
  const securityMaturity = pick([
    "well-run with strong controls and high-volume telemetry",
    "early-stage with inconsistent control ownership",
    "moderate with documented policies but uneven enforcement",
    "mature with strong change control and noisy telemetry",
    "fast-moving with lightweight approvals and fragmented ownership",
    "compliance-led with careful records but slow operational handoff",
    "understaffed with partial logging coverage and tribal knowledge",
    "transitional after recent infrastructure consolidation",
  ], context, "company.security_maturity");
  const ticketStyle = pick([
    "formal ITIL change records",
    "short SOC escalation notes",
    "service desk tickets with engineer comments",
    "operations runbook annotations",
    "chat-led approvals copied into tickets",
    "vendor handoff notes with internal review",
    "minimal break-fix records",
  ], context, "company.ticket_style");
  const documentationStyle = pick([
    "policy-heavy compliance documentation",
    "brief operational notes",
    "change-led infrastructure records",
    "mixed vendor and internal documentation",
    "runbook-first documentation with stale exceptions",
    "well-maintained service ownership records",
    "fragmented wiki pages and handover notes",
  ], context, "company.documentation_style");

  return {
    company: chosen.company,
    industry: chosen.industry,
    department: environment.department,
    location: pick([
      "Birmingham",
      "Manchester",
      "Leeds",
      "London",
      "Bristol",
      "Glasgow",
      "Cardiff",
    ], context, "company.location"),
    domain: chosen.domain,
    emailDomain: chosen.domain,
    caseId: `CL-LNX-${caseNumber}`,
    ticketId: `INC-${ticketNumber}`,
    changeId: `CHG-${changeNumber}`,
    host: environment.host,
    serverRole: environment.role,
    webHost: pick(["web-01", "portal-lnx-01", "intranet-web-02", "shop-web-03", "api-edge-01"], context, "host.web"),
    dbHost: pick(["db-01", "postgres-lnx-01", "mysql-reporting-02", "ledger-db-02", "analytics-pg-01"], context, "host.db"),
    analystUser: pick(["analyst", "secops", "bluelead", "ir-analyst", "casey.soc", "nora.ir"], context, "identities.analyst"),
    adminUser: pick(["morgan.admin", "rpatel", "j.smith", "opslead", "c.evans", "a.murphy"], context, "identities.admin"),
    internUser: pick(["intern", "trainee", "junior", "temp-user", "it-apprentice"], context, "identities.intern"),
    contractorUser: pick(["contractor", "vendorops", "ext-maint", "build-temp", "fieldtech", "vendor.linux"], context, "identities.contractor"),
    employeeUser: pick(["akhan", "sjones", "mali", "tchen", "lwilson", "nwright", "rgreen"], context, "identities.employee"),
    serviceUser: pick(["backup", "svc-backup", "svc-sync", "maint", "svc-ci", "svc-monitor", "svc-report"], context, "identities.service"),
    appUser: pick(["svc-web", "svc-api", "www-data", "svc-deploy", "svc-runner", "svc-portal"], context, "identities.app"),
    namingConvention,
    cidr,
    gatewayIp: `10.${subnet}.14.1`,
    dnsIp: `10.${subnet}.14.10`,
    monitoringIp: `10.${subnet}.14.25`,
    suspiciousIp: `192.168.56.${networkRandom.nextInt(20, 60)}`,
    adminIp: `192.168.56.${networkRandom.nextInt(5, 15)}`,
    backupIp: `192.168.56.${networkRandom.nextInt(40, 60)}`,
    incidentDate: "2026-07-06",
    incidentType,
    securityMaturity,
    ticketStyle,
    documentationStyle,
    businessApplication: environment.app,
    maintenanceWindow: pick([
      "Sunday 08:00-09:00 UTC",
      "Monday 22:00-23:00 UTC",
      "Wednesday 06:00-07:00 UTC",
      "Friday 20:00-21:00 UTC",
      "Tuesday 01:00-02:00 UTC",
      "Thursday 19:30-20:15 UTC",
      "Saturday 05:00-06:30 UTC",
    ], context, "schedules.maintenance"),
    businessHours: pick([
      "08:00-18:00 local time",
      "07:00-19:00 local time",
      "24x5 operational coverage",
      "24x7 for customer-facing systems",
    ], context, "schedules.business_hours"),
    timezone,
  };
}
