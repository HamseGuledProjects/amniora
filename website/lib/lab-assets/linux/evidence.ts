import type { LinuxAssetInput } from "./types";
import type { LabAsset } from "../types";
import { getLinuxIncidentProfile } from "./incidentProfiles";
import { csvRow } from "./investigation";
import { linuxLearnerSubjectList, simulationTimelineCsv } from "./simulation";
import { linuxCanonicalIncidentSubjectIds, linuxLearnerReviewSubjectIds } from "./grounding";
import { formatLinuxLearnerDocumentDateTime, formatLinuxLearnerDocumentWindow } from "./time";
import { linuxReviewHypotheses, linuxIndependentReviewQuestions, linuxContainerEvidenceBoundary, linuxDifficultyReviewGuidance } from "./learnerQa";
import { linuxIndefiniteArticle } from "./grammar";
import { linuxApprovalGapFinding, linuxApprovalStatusSentence } from "./claimAuthority";

export function buildEvidenceAssets({
  input,
  world,
  incident,
  investigation,
  simulation,
  advanced,
}: LinuxAssetInput): LabAsset[] {
  const profile = getLinuxIncidentProfile(incident);
  const brief = investigationBrief(incident, world, investigation);
  const voice = documentVoice(world);
  const networkSources = Array.from(new Set(simulation.sshSessions
    .filter((session) => session.purpose === "incident")
    .map((session) => session.sourceIp)));
  const assets: LabAsset[] = [];
  const docMeta = (type: string) => {
    const doc = simulation.documents.find((item) => item.documentType === type);
    if (!doc) return "";
    const facts = doc.factIds
      .map((factId) => simulation.documentFacts.find((fact) => fact.id === factId))
      .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));
    const factThemes = Array.from(new Set(facts.map((fact) => fact.factType)));
    const objectIds = ["incident_brief", "audit_notes", "analyst_questions"].includes(type)
      ? linuxLearnerReviewSubjectIds(simulation)
      : Array.from(new Set(doc.factIds
          .flatMap((factId) => simulation.documentFacts.find((fact) => fact.id === factId)?.canonicalObjectIds || [])
          .filter(Boolean)));
    const approvalStatus = ["incident_brief", "audit_notes", "analyst_questions"].includes(type)
      ? `${linuxApprovalStatusSentence(simulation)}\n`
      : "";
    return `\n## Documentation Scope\nDocument style: ${doc.styleArchetype}\nFact themes: ${factThemes.join(", ")}\n${objectIds.length > 0 ? `Subjects: ${linuxLearnerSubjectList(simulation, objectIds)}\n` : ""}${approvalStatus}Certainty language: observed, candidate, policy, or unknown as indicated by the case record.\n`;
  };

  assets.push(
    {
      file_name: "timeline.csv",
      file_type: "csv",
      file_path: "assets/evidence/timeline.csv",
      content: simulationTimelineCsv(simulation, { advanced }),
    },
    {
      file_name: "incident_brief.md",
      file_type: "markdown",
      file_path: "assets/evidence/incident_brief.md",
      content: `# Incident Brief ${world.caseId}

Company: ${world.company}
Host: ${world.host}
Industry: ${world.industry}
Department: ${world.department}
Location: ${world.location}
Case: ${world.caseId}
Ticket: ${world.ticketId}
Change Reference: ${world.changeId}
Detection Source: ${voice.detectionSource}
Detection interval: ${formatLinuxLearnerDocumentWindow(simulation.collection.windowStart, simulation.collection.windowEnd, investigation.timezone)}
Evidence collection time: ${formatLinuxLearnerDocumentDateTime(simulation.collection.collectedAt, investigation.timezone)}
Business Application: ${world.businessApplication}
Security Maturity: ${world.securityMaturity}

## ${voice.summaryHeading}
${brief.summary}

## Scope
Review only the provided offline artifacts. Do not interact with live systems.

## ${voice.contextHeading}
- Business hours: ${world.businessHours}
- Recurring maintenance policy: ${world.maintenanceWindow}
- ${linuxApprovalStatusSentence(simulation)}
- Ticket style: ${world.ticketStyle}
- Documentation style: ${world.documentationStyle}
- Host IP: ${investigation.hostIp}
- Gateway: ${investigation.gateway}
- DNS: ${investigation.dns}
${networkSources.length > 0 ? `- Network sources observed in SSH session records: ${networkSources.join(", ")}` : "- Network sources: no SSH session source recorded in this package"}
- Affected service: ${investigation.affectedService}
- Investigation window: ${formatLinuxLearnerDocumentWindow(simulation.collection.windowStart, simulation.collection.windowEnd, investigation.timezone)}
- Business impact: ${investigation.businessImpact}
- Logging quality: ${brief.loggingQuality}
- Ownership context: ${brief.ownershipContext}
- Escalation reason: ${brief.escalationReason}
- Documentation note: ${voice.documentationNote}

## ${advanced ? "Unverified Competing Hypotheses" : voice.hypothesisHeading}
${advanced
  ? "- The open alternatives are recorded once in assets/evidence/risk_register.csv. They remain unverified and must be tested against task-local evidence."
  : linuxDifficultyReviewGuidance(input.difficulty).map((guidance) => `- ${guidance}`).join("\n")}

## ${voice.ambiguityHeading}
${brief.ambiguities.map((note) => `- ${note}`).join("\n")}

## ${voice.methodHeading}
${investigation.investigationMethodology.map((phase) => `- ${phase}`).join("\n")}
${docMeta("incident_brief")}
`,
    }
  );

  if (advanced) {
    assets.push(
      {
        file_name: "audit_notes.md",
        file_type: "markdown",
        file_path: "assets/evidence/audit_notes.md",
        content: `${buildAuditNotes(world, investigation, incident, profile, simulation)}${docMeta("audit_notes")}`,
      },
      {
        file_name: "risk_register.csv",
        file_type: "csv",
        file_path: "assets/evidence/risk_register.csv",
        content: buildRiskRegister(world, investigation, profile, simulation),
      },
      {
        file_name: "analyst_questions.md",
        file_type: "markdown",
        file_path: "assets/evidence/analyst_questions.md",
        content: `${buildAnalystQuestions(investigation, profile)}${docMeta("analyst_questions")}`,
      }
    );
  }

  return assets;
}

function documentVoice(world: LinuxAssetInput["world"]) {
  const industry = world.industry.toLowerCase();
  if (industry.includes("financial") || industry.includes("payments")) {
    return {
      detectionSource: "control monitoring escalation",
      summaryHeading: "Control Summary",
      contextHeading: "Control Context",
      hypothesisHeading: "Candidate Control Findings",
      ambiguityHeading: "Control Gaps To Resolve",
      methodHeading: "Evidence Review Plan",
      documentationNote: "Use the change record and policy artefacts before assigning control failure.",
      riskStatus: "review",
    };
  }
  if (industry.includes("health")) {
    return {
      detectionSource: "SOC escalation with compliance review",
      summaryHeading: "Safety and Compliance Summary",
      contextHeading: "Operational Care Context",
      hypothesisHeading: "Working Compliance Hypotheses",
      ambiguityHeading: "Patient-Safety Relevant Unknowns",
      methodHeading: "Validation Steps",
      documentationNote: "Treat availability and data-handling assumptions conservatively.",
      riskStatus: "review",
    };
  }
  if (industry.includes("manufacturing") || industry.includes("energy")) {
    return {
      detectionSource: "operations monitoring handoff",
      summaryHeading: "Operational Summary",
      contextHeading: "Plant and Service Context",
      hypothesisHeading: "Working Operational Hypotheses",
      ambiguityHeading: "Production Continuity Questions",
      methodHeading: "Triage Run Order",
      documentationNote: "Prioritise service continuity while preserving evidence confidence.",
      riskStatus: "review",
    };
  }
  if (industry.includes("education") || industry.includes("research")) {
    return {
      detectionSource: "service desk and SOC handoff",
      summaryHeading: "Service Desk Summary",
      contextHeading: "Campus Service Context",
      hypothesisHeading: "Initial Working Theories",
      ambiguityHeading: "Open Service Questions",
      methodHeading: "Suggested Checks",
      documentationNote: "Expect mixed ownership and verify account purpose before escalation.",
      riskStatus: "review",
    };
  }
  if (industry.includes("saas") || industry.includes("hosting")) {
    return {
      detectionSource: "on-call telemetry escalation",
      summaryHeading: "On-Call Summary",
      contextHeading: "Runbook Context",
      hypothesisHeading: "Candidate Engineering Causes",
      ambiguityHeading: "Runbook Gaps",
      methodHeading: "Correlation Checklist",
      documentationNote: "Compare evidence against automation and deployment records.",
      riskStatus: "review",
    };
  }

  return {
    detectionSource: "SOC monitoring escalation",
    summaryHeading: "Summary",
    contextHeading: "Operational Context",
    hypothesisHeading: "Plausible Initial Hypotheses",
    ambiguityHeading: "Ambiguities To Resolve",
    methodHeading: "Suggested Method",
    documentationNote: "Validate against artefacts before assigning confidence.",
    riskStatus: "review",
  };
}

function investigationBrief(
  incident: LinuxAssetInput["incident"],
  world: LinuxAssetInput["world"],
  investigation: LinuxAssetInput["investigation"]
) {
  const article = linuxIndefiniteArticle(world.serverRole);
  const base = {
    loggingQuality: world.securityMaturity.includes("partial")
      ? "partial coverage with important secondary sources"
      : world.securityMaturity.includes("noisy")
      ? "noisy telemetry; completeness not established"
      : "telemetry completeness not established by supplied sources",
    ownershipContext: `${world.department} owns ${world.host}, ${article} ${world.serverRole}, with ${world.documentationStyle}.`,
  };

  const byFamily: Record<
    LinuxAssetInput["incident"]["id"],
    {
      summary: string;
      escalationReason: string;
      hypotheses: string[];
      ambiguities: string[];
    }
  > = {
    ssh_bruteforce: {
      summary: `SOC monitoring flagged concentrated SSH authentication activity on ${world.host}. The review should establish whether the account activity fits expected access patterns or represents credential misuse.`,
      escalationReason: "authentication volume and source context differ from the host baseline",
      hypotheses: [
        "password authentication exception or legacy access path",
        "credential stuffing or password spray against remote access",
        "benign administrator testing with poor notes",
        "dormant or low-use account activity requiring owner confirmation",
      ],
      ambiguities: [
        `${world.ticketId} does not fully explain the authentication source pattern.`,
        `The service baseline should be compared with ${investigation.affectedService} configuration evidence.`,
      ],
    },
    service_account_misuse: {
      summary: `Telemetry shows automation-account activity on ${world.host} that looks more interactive than normal service execution. Analysts should compare account policy, shell use, and file activity before drawing conclusions.`,
      escalationReason: "service account behaviour overlaps with interactive shell and file-operation evidence",
      hypotheses: [
        "misconfigured automation account with an unnecessary shell",
        "operator used a service account during operational pressure",
        "compromised service credentials",
        "backup or sync job running outside its expected pattern",
      ],
      ambiguities: [
        `The expected automation owner is not fully clear from ${world.ticketStyle}.`,
        `File activity needs to be separated from normal ${world.businessApplication} operations.`,
      ],
    },
    docker_compromise: {
      summary: `Container runtime and host evidence on ${world.host} suggest a boundary or mount-path concern. The exercise requires correlation between runtime state, group membership, services, and file access.`,
      escalationReason: "container activity may have crossed expected host boundaries",
      hypotheses: [
        "approved container run with overly broad host mounts",
        "developer or automation mistake during deployment",
        "container escape or host data exposure path",
        "stale Docker group membership creating excessive access",
      ],
      ambiguities: [
        `The approved runtime profile is not fully described in ${world.changeId}.`,
        "Container evidence must be checked against process and inventory files.",
      ],
    },
    systemd_persistence: {
      summary: `A service state change on ${world.host} requires comparison with the systemd baseline and unit-file evidence. Analysts should avoid assuming intent until ownership and approval are established.`,
      escalationReason: "a recorded systemd state change requires owner and approved-scope review",
      hypotheses: [
        "legitimate service recovery with incomplete documentation",
        "a unit change outside approved scope, if the unit contents and ownership confirm it",
        "failed maintenance followed by an improvised service change",
        "persistence-like service creation requiring containment review",
      ],
      ambiguities: [
        "The unit ownership trail is incomplete in the provided records.",
        `The host role as ${world.serverRole} affects whether the service belongs there.`,
      ],
    },
    cron_persistence: {
      summary: `Scheduled execution evidence on ${world.host} points to a script or job that needs ownership, timing, and purpose validation. The key question is whether the job is expected automation or persistence-like activity.`,
      escalationReason: "cron execution occurred inside a sensitive review window",
      hypotheses: [
        "abandoned automation left behind after prior work",
        "approved scheduled task with incomplete owner metadata",
        "persistence mechanism using cron",
        "contractor or service account action outside normal process",
      ],
      ambiguities: [
        "The script path and account ownership need independent confirmation.",
        `${world.ticketId} provides context but does not fully describe scheduled execution.`,
      ],
    },
    ssh_key_compromise: {
      summary: `Key-based SSH access on ${world.host} requires review against account ownership, key provenance, and source network expectations. The available artifacts support several interpretations.`,
      escalationReason: "trusted key use does not cleanly match expected access records",
      hypotheses: [
        "stale contractor key still trusted after expiry",
        "approved key rotation with poor documentation",
        "shared or copied SSH key material",
        "administrator access from an unusual network location",
      ],
      ambiguities: [
        "The key owner and source network both require corroboration.",
        `The change record ${world.changeId} may not cover every key observed.`,
      ],
    },
    misconfigured_sudoers: {
      summary: `Privileged command evidence on ${world.host} needs to be reconciled with sudo policy, account role, and service ownership. Analysts should focus on whether privilege boundaries match business need.`,
      escalationReason: "sudo activity appears broader than the account role suggests",
      hypotheses: [
        "stale sudo exception from prior support activity",
        "operator error by a temporary or lower-trust account",
        "policy drift exposing privileged service control",
        "unauthorised use of a permissive sudo rule",
      ],
      ambiguities: [
        "Command intent cannot be inferred from sudo evidence alone.",
        `Policy and group evidence must be compared with ${world.ticketStyle}.`,
      ],
    },
    unauthorized_package_install: {
      summary: `Package manager activity on ${world.host} requires source, approval, and runtime-impact review. The exercise should distinguish routine package work from unapproved tooling or repository drift.`,
      escalationReason: "package history does not clearly map to approved service operations",
      hypotheses: [
        "approved package work with incomplete package listing",
        "administrator installed troubleshooting tooling ad hoc",
        "repository or package tampering",
        "unauthorised network-capable utility introduced to the host",
      ],
      ambiguities: [
        "Package history needs to be compared with inventory and change records.",
        `The relevance to ${world.businessApplication} is not established by one artifact.`,
      ],
    },
    data_staging: {
      summary: `Archive and temporary-file evidence on ${world.host} suggests data handling that must be scoped carefully. Analysts should compare file paths, account purpose, and backup expectations.`,
      escalationReason: "temporary archive activity may involve business data",
      hypotheses: [
        "normal backup troubleshooting with poor cleanup",
        "service account used for manual data collection",
        "staged business data requiring containment",
        "insider or contractor mistake during file handling",
      ],
      ambiguities: [
        "Archive contents are inferred from paths and commands, not directly inspected live.",
        `Backup ownership for ${world.businessApplication} needs validation.`,
      ],
    },
    log_tampering: {
      summary: `A log integrity concern on ${world.host} requires comparison across primary logs, journal exports, and audit data. The goal is to assess evidence confidence before making a finding.`,
      escalationReason: "authentication or audit evidence quality changed during the review window",
      hypotheses: [
        "manual rotation during troubleshooting",
        "monitoring gap caused by noisy telemetry",
        "intentional log clearing or evidence suppression",
        "misconfigured retention policy affecting investigation confidence",
      ],
      ambiguities: [
        "A log gap is not automatically malicious without secondary correlation.",
        "Journal and audit records should be used to test log completeness.",
      ],
    },
    reverse_shell: {
      summary: `Application-host evidence on ${world.host} shows web, process, and outbound network indicators that need correlation. Analysts should establish whether this is expected application behaviour or shell-like activity.`,
      escalationReason: "web service activity overlaps with shell and egress evidence",
      hypotheses: [
        "legitimate web maintenance task with unusual process ancestry",
        "application exploit leading to shell execution",
        "operator test from the web tier",
        "egress rule drift enabling unexpected outbound access",
      ],
      ambiguities: [
        "Web logs alone do not prove process intent.",
        `Firewall and process evidence must be interpreted against the ${world.serverRole} role.`,
      ],
    },
  };

  return { ...base, ...byFamily[incident.id] };
}

function buildAuditNotes(
  world: LinuxAssetInput["world"],
  investigation: LinuxAssetInput["investigation"],
  incident: LinuxAssetInput["incident"],
  profile: ReturnType<typeof getLinuxIncidentProfile>,
  simulation: LinuxAssetInput["simulation"]
) {
  const voice = documentVoice(world);
  return `# ${voice.summaryHeading} - Linux Audit Notes

Incident ID: ${investigation.incidentId}
Review window: ${formatLinuxLearnerDocumentWindow(simulation.collection.windowStart, simulation.collection.windowEnd, investigation.timezone)}
Affected service: ${investigation.affectedService}
Reviewer stance: ${voice.documentationNote}

Unverified competing hypotheses; no cause or impact finding has been made:

- Use assets/evidence/risk_register.csv as the single list of open alternatives.
- Treat each alternative as unverified until the evidence assigned to the current task supports or excludes it.

Configuration focus:

${profile.configFocus.map((item) => `- ${item}`).join("\n")}

Permission focus:

${profile.permissionFocus.map((item) => `- ${item}`).join("\n")}

Service focus:

${profile.serviceFocus.map((item) => `- ${item}`).join("\n")}

Independent correlation:

Locate relevant activity in the evidence assigned to the task. Record the actor, action, time and scope before comparing it with policy. Configuration and current state do not by themselves establish historical execution.
${incident.id === "docker_compromise" ? `\n${linuxContainerEvidenceBoundary}\n` : ""}

Analyst objective:
Separate confirmed evidence from candidate hypotheses, document uncertainty, and recommend next handling steps.
`;
}

function buildRiskRegister(
  world: LinuxAssetInput["world"],
  investigation: LinuxAssetInput["investigation"],
  profile: ReturnType<typeof getLinuxIncidentProfile>,
  simulation: LinuxAssetInput["simulation"]
) {
  const subjectRefs = linuxLearnerSubjectList(simulation, linuxLearnerReviewSubjectIds(simulation));
  const evidenceForRisk = (risk: string, index: number) => {
    if (/\b(?:archive|data staging|staging|export|tar|temporary archive)\b/i.test(risk)) return "audit.log;sudo.log;process_execution_history.txt;file_access_history.csv;timeline.csv";
    if (/\b(?:interactive shell|interactive login|login shell|group membership|account)\b/i.test(risk)) return "passwd.sample;groups.csv;auth.log";
    if (/\b(?:package|apt|dpkg|install)\b/i.test(risk)) return "apt_history.log;audit.log;sudo.log;timeline.csv";
    if (/\b(?:service|systemd|unit)\b/i.test(risk)) return "journal_systemd.txt;service_inventory.txt;timeline.csv";
    return index === 0
      ? "auth.log;timeline.csv;audit.log"
      : index === 1
      ? "sudo.log;audit.log;timeline.csv"
      : "process_execution_history.txt;file_access_history.csv;permissions_report.txt";
  };
  const rows = linuxReviewHypotheses.map((risk, index) => {
    const id = `R-${String(index + 1).padStart(3, "0")}`;
    const severity = "unassessed";
    const evidence = evidenceForRisk(risk, index);
    return csvRow([id, risk, severity, evidence, "unverified", subjectRefs]);
  });

  return `id,finding,severity,evidence,status,subject_refs
${csvRow(["R-000", linuxApprovalGapFinding(simulation), "unassessed", "change_request.md;maintenance_ticket.md", "unverified", subjectRefs])}
${rows.join("\n")}
`;
}

function buildAnalystQuestions(
  investigation: LinuxAssetInput["investigation"],
  profile: ReturnType<typeof getLinuxIncidentProfile>
) {
  return `# Analyst Questions

Case: ${investigation.incidentId}
Host: ${investigation.hostname}

These are review questions, not established findings. Use only the evidence assigned to the current task.

${linuxIndependentReviewQuestions.map((q, index) => `${index + 1}. ${q}`).join("\n")}

For each open alternative in risk_register.csv, identify evidence for and against it and leave it unresolved when the assigned evidence is insufficient.
`;
}
