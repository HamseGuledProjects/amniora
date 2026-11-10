import type { LabAsset } from "../types";
import type { LinuxInvestigationContext } from "./investigation";
import { inferLinuxTaskContracts, linuxInvestigationBlueprintForFamily, linuxTaskContract } from "./taskContracts";
import { buildCanonicalEvidenceRegistry, canonicalBackgroundServices, canonicalPrimaryService, canonicalSecondaryServices, scheduleMatchesTimestamp, validateCanonicalExecutionLifecycle, type CanonicalInvestigationTask, type CanonicalService, type LinuxSimulationWorld } from "./simulation";
import { proveTaskRequirements, validateLinuxLearnerPackGrounding, validateLinuxProductionClosure } from "./grounding";
import { validateLinuxSemanticClosure } from "./semanticClosure";
import { resolveSudoPolicy, sudoCommandText } from "./sudoPolicy";
import {
  CURRENT_STATE_EVIDENCE_HINTS,
  inferCurrentStateRequirementsFromText,
  taskTextRequestsCurrentState,
  type LinuxCurrentStateRequirement,
} from "./currentStateEvidence";
import { validateLinuxStudentContent } from "./studentContentValidation";
import {
  linuxNarrativeTextHygieneReason,
  validateLinuxStudentNarrativeIntegrity,
} from "./narrativeIntegrity";
import { validateLinuxStudentTaskSolvability } from "./taskSolvability";
import { validateLinuxIncidentCoverage } from "./incidentCoverage";
import { validateLinuxTaskDiversity } from "./taskDiversity";
import { resolveLinuxShellCommand } from "./commandSemantics";
import { buildLinuxNoiseQualityReport } from "./backgroundActivity";
import {
  checkLinuxLabWorkload,
  parseLinuxRequestedDurationMinutes,
  type LinuxLabWorkloadReport,
} from "./workloadCalibration";
import { linuxDurationTaskCountBounds } from "./difficultyProfile";
import {
  checkLinuxAssessmentQuality,
  type LinuxAssessmentQualityReport,
} from "./assessmentContract";
import { validateLinuxTemporalDocumentAuthority } from "./temporalAuthority";
import { linuxLocalCaseTimeToUtcTimestamp } from "./time";
import { validateLinuxStructuralDiversityBatch } from "./structuralDiversity";
import { validateLinuxPatchAIntegrity } from "./learnerQa";
import { validateLinuxIdentityRealism } from "./identityRealism";
import { linuxReadOperandsHaveEvidence } from "./commandFileEvidence";
import { validateLinuxFinalLearnerPackage } from "./claimAuthority";

export type LinuxQualityIssue = {
  severity: "low" | "medium" | "high" | "critical";
  category:
    | "generated_text"
    | "timeline"
    | "service_model"
    | "daemon_realism"
    | "role_leakage"
    | "identity"
    | "ssh_policy"
    | "sudo_audit"
    | "process_open_files"
    | "permissions"
    | "semantic"
    | "package_management"
    | "documentation"
    | "background_noise"
    | "asset_consistency"
    | "assessment"
    | "batch_diversity";
  file?: string;
  line?: number;
  description: string;
  evidence?: string;
};

export type LinuxQualityResult = {
  score: number;
  passed: boolean;
  issues: LinuxQualityIssue[];
  summary: string;
  coverage?: LinuxQualityCoverage;
  categoryScores?: LinuxQualityCategoryScore[];
  scoreCaps?: string[];
  deductions?: LinuxScoreDeduction[];
  diagnostics?: Record<string, unknown>;
  workloadReport?: LinuxLabWorkloadReport;
  workloadEstimateHash?: string;
  workloadReportHash?: string;
  assessmentReport?: LinuxAssessmentQualityReport;
  assessmentContractHash?: string;
  assessmentQualityHash?: string;
};

export type LinuxScoreDeduction = {
  category: string;
  pointsLost: number;
  reason: string;
  proofMissing?: string;
  issueId?: string;
  capId?: string;
};

export type LinuxFinalQualityResult = {
  interimAssetScore: number;
  finalProductionScore: number;
  passed: boolean;
  coverage: LinuxQualityCoverage;
  issues: LinuxQualityIssue[];
  scoreCaps?: string[];
  deductions?: LinuxScoreDeduction[];
  diagnostics?: Record<string, unknown>;
  workloadReport?: LinuxLabWorkloadReport;
  workloadEstimateHash?: string;
  workloadReportHash?: string;
  assessmentReport?: LinuxAssessmentQualityReport;
  assessmentContractHash?: string;
  assessmentQualityHash?: string;
  categoryScores: Record<string, {
    earned: number;
    possible: number;
    evaluated: boolean;
    proofs: string[];
  }>;
};

export type LinuxQualityCoverage = {
  incidentIdentityEvaluated: boolean;
  processGraphEvaluated: boolean;
  fileMetadataEvaluated: boolean;
  chronologyEvaluated: boolean;
  sudoPolicyEvaluated: boolean;
  serviceSemanticsEvaluated: boolean;
  timelineEvidenceEvaluated: boolean;
  roleRealismEvaluated: boolean;
  documentationEvaluated: boolean;
  finalNarrativeEvaluated: boolean;
  originalityEvaluated: boolean;
};

export type LinuxQualityCategoryScore = {
  id: string;
  label: string;
  earned: number;
  possible: number;
  evaluated: boolean;
  proof: string[];
};

export type FinalLinuxNarrative = {
  title: string;
  subtitle?: string;
  objective?: string;
  scenario?: string;
  tasks?: Array<{
    phase?: string;
    title?: string;
    description?: string;
    evidence?: string[];
    deliverable?: string;
    hint?: string;
    solution?: string;
  }>;
  hints?: string[];
  outcomes?: string[];
  learningOutcomes?: string[];
  duration?: string;
  category?: string;
  difficulty?: string;
};

export type LinuxQualityLabText = Partial<FinalLinuxNarrative>;

export type QualityInput = {
  context?: LinuxInvestigationContext;
  assets: LabAsset[];
  lab?: LinuxQualityLabText;
  simulation?: Partial<LinuxSimulationWorld> & {
    collection?: {
      collectedAt?: string;
    };
  };
  workload?: {
    requestedDifficulty?: string;
    requestedDurationMinutes?: number;
    expectedWorkloadEstimateHash?: string;
    expectedWorkloadReportHash?: string;
    expectedAssessmentContractHash?: string;
    expectedAssessmentQualityHash?: string;
  };
};

function isCompleteLinuxSimulation(value: QualityInput["simulation"]): value is LinuxSimulationWorld {
  return Boolean(
    value &&
    value.version === 1 &&
    Array.isArray(value.canonicalTasks) &&
    Array.isArray(value.evidenceRegistry) &&
    Array.isArray(value.identities) &&
    Array.isArray(value.commands) &&
    Array.isArray(value.processes)
  );
}

const generatedTextBadPatterns: Array<[RegExp, string, LinuxQualityIssue["severity"]]> = [
  [/\b\d{2}:\d{2}\d{2}:\d{2}\b/, "Malformed joined HH:MM time range.", "critical"],
  [/\b\d{2}:\d{2}:\d{2}\d{2}:\d{2}:\d{2}\b/, "Malformed joined HH:MM:SS time range.", "critical"],
  [/\b(?:withSSH|withcron|usingSSH|usingcron|andSSH)\b/i, "Missing space between preposition and technology.", "high"],
  [/\b(?:changeevi|changee|servicee|authh)\b/i, "Generator typo fragment detected.", "critical"],
  [/\b610 line\b/i, "Malformed 6-10 line wording.", "high"],
  [/\b(?:with|with a|using|using host|and|on)\s*$/i, "Dangling generated text ending.", "high"],
  [/Linux sudo scope vs service ownership under SSH on\b/i, "Known dangling subtitle pattern.", "high"],
  [/Linux package-management attribution,\s*SSH session\/?\s*$/i, "Cut off technology list.", "high"],
  [/Linux systemd service investigation and changeevi/i, "Known corrupted subtitle pattern.", "critical"],
  [/\bSSH-\s*(?:\n|$)/i, "Final narrative text ends with truncated SSH compound.", "high"],
  [/\bon a SSH-\s*(?:\n|$)/i, "Final subtitle ends with malformed 'on a SSH-' fragment.", "high"],
  [/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/, "Invalid replacement/control character in final narrative text.", "high"],
  [/\b(?:changevs|changee|evidencee|servicee|authh)\b/i, "Damaged generated word in final narrative text.", "high"],
  [/\b(?:SSH|cron|systemd|APT|sudo|audit)\s*,\s*(?:\n|$)/i, "Final narrative text ends with a truncated technology list.", "high"],
  [/\b(?:identity|session|command|process|file):[A-Za-z0-9._:-]+|\b(?:executed_by|spawned_process|opened_file|covered_by_change|inside_maintenance_window|authenticated_as|service_state|service_transition|primary-window|incident-primary)\b/, "Internal canonical syntax leaked into learner-facing narrative text.", "critical"],
];

function issue(
  issues: LinuxQualityIssue[],
  severity: LinuxQualityIssue["severity"],
  category: LinuxQualityIssue["category"],
  description: string,
  file?: string,
  line?: number,
  evidence?: string
) {
  issues.push({ severity, category, description, file, line, evidence });
  if (process.env.CYBERLAB_LINUX_NARRATIVE_TRACE === "true" || process.env.NODE_ENV !== "production") {
    console.warn(
      `[CyberLab Linux Validator Trace] rule="${description}" severity=${severity} category=${category} file=${file || "n/a"} line=${line || "n/a"} substring="${String(evidence || "").slice(0, 180)}" expected="field/evidence satisfies ${category} validator" actual="validator matched and emitted issue"`
    );
  }
}

function assetByPath(assets: LabAsset[], path: string) {
  return assets.find((asset) => asset.file_path === path);
}

function assetByBasename(assets: LabAsset[], name: string) {
  const normalized = name.trim().replace(/^assets\//, "");
  return assets.find((asset) => {
    const path = asset.file_path.replace(/\\/g, "/");
    return path === normalized || path === `assets/${normalized}` || path.endsWith(`/${normalized}`);
  });
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function parseCsvLineWithState(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return { values, quoted };
}

function parseDelimitedSourceAssets(assets: LabAsset[], source: string) {
  const aliases = buildEvidenceAliasMap(assets);
  return source
    .split(/[;|]/)
    .map((item) => item.trim().replace(/^"(.*)"$/, "$1").replace(/^(?:exact|context|static):/i, ""))
    .filter(Boolean)
    .map((item) => assetByBasename(assets, item) || aliases.get(item.toLowerCase().replace(/^assets\//, "")) || aliases.get(item.toLowerCase()))
    .filter((asset): asset is LabAsset => Boolean(asset));
}

function lineIssues(
  assets: LabAsset[],
  pattern: RegExp,
  severity: LinuxQualityIssue["severity"],
  category: LinuxQualityIssue["category"],
  description: string,
  issues: LinuxQualityIssue[]
) {
  for (const asset of assets) {
    const lines = asset.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        issue(issues, severity, category, description, asset.file_path, index + 1, line.trim());
      }
    });
  }
}

function collectGeneratedText(input: QualityInput) {
  const text: string[] = [];
  const lab = input.lab;
  if (lab) {
    text.push(
      lab.title || "",
      lab.subtitle || "",
      lab.objective || "",
      lab.scenario || "",
      ...(lab.hints || []),
      ...(lab.outcomes || [])
    );
    for (const task of lab.tasks || []) {
      text.push(task.phase || "", task.title || "", task.description || "", task.deliverable || "", ...(task.evidence || []));
    }
  }

  for (const path of [
    "assets/evidence/incident_brief.md",
    "assets/evidence/audit_notes.md",
    "assets/evidence/analyst_working_notes.md",
    "assets/evidence/timeline.csv",
  ]) {
    const asset = assetByPath(input.assets, path);
    if (asset) text.push(asset.content);
  }

  return text.join("\n");
}

function checkGeneratedText(input: QualityInput, issues: LinuxQualityIssue[]) {
  const text = collectGeneratedText(input);
  if (input.lab) {
    const integrity = validateLinuxStudentNarrativeIntegrity(input.lab);
    for (const integrityIssue of integrity.issues) {
      issue(
        issues,
        "critical",
        "generated_text",
        `${integrityIssue.code}: ${integrityIssue.message}`,
        undefined,
        undefined,
        integrityIssue.excerpt
      );
    }
  }
  const studentContent = validateLinuxStudentContent({
    ...(input.lab || {}),
    assets: input.assets.filter((asset) =>
      /assets\/(?:evidence|docs|reports)\/.*\.(?:md|txt|csv)$/i.test(asset.file_path)
    ),
  });
  for (const studentIssue of studentContent.issues) {
    issue(
      issues,
      "critical",
      "generated_text",
      `${studentIssue.code}: ${studentIssue.message}`,
      studentIssue.field.startsWith("assets:") ? studentIssue.field.replace(/^assets:/, "") : undefined,
      undefined,
      studentIssue.matched
    );
  }
  for (const [pattern, description, severity] of generatedTextBadPatterns) {
    const match = text.match(pattern);
    if (match) {
      issue(issues, severity, "generated_text", description, undefined, undefined, match[0]);
    }
  }
  input.assets.forEach((asset) => {
    if (/readme|manifest|disclaimer|setup\.sh/i.test(asset.file_path)) return;
    const match = asset.content.match(/\bCyberLab\b/i);
    if (match) {
      issue(issues, "critical", "generated_text", "Simulator label leaked into in-world Linux evidence.", asset.file_path, undefined, match[0]);
    }
    const serviceInventoryLeak = asset.content.match(/affected service for\s+CL-LNX-\d+/i);
    if (serviceInventoryLeak) {
      issue(issues, "high", "generated_text", "Internal case metadata leaked as service-inventory explanation.", asset.file_path, undefined, serviceInventoryLeak[0]);
    }
  });
}

function cleanComparableText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\bcompanys\b/g, "company")
    .replace(/[^a-z0-9._:/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyComparable(value: string) {
  return cleanComparableText(value)
    .replace(/\b(s|soc|environment|team|incident|case)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function timezoneComparable(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[⁄∕／]/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\butc\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\b/g, (_match, sign, hour, minute = "00") => `utc${sign}${hour.padStart(2, "0")}:${minute}`)
    .replace(/[^a-z0-9_+\-/:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textIncludesTimezone(text: string, timezone: string) {
  return timezoneComparable(text).includes(timezoneComparable(timezone));
}

function canonicalLinuxTopic(incidentFamily?: string) {
  const topics: Record<string, string> = {
    ssh_bruteforce: "Linux DFIR: SSH Authentication Review",
    ssh_key_compromise: "Linux DFIR: SSH Key Provenance",
    misconfigured_sudoers: "Linux DFIR: Sudo Policy Review",
    service_account_misuse: "Linux DFIR: Service Account Misuse",
    cron_persistence: "Linux DFIR: Cron Execution Review",
    systemd_persistence: "Linux DFIR: Systemd Persistence",
    unauthorized_package_install: "Linux DFIR: Package Installation Review",
    data_staging: "Linux DFIR: Data Staging Review",
    log_tampering: "Linux DFIR: Log Integrity Investigation",
    docker_compromise: "Linux DFIR: Container Runtime Review",
    reverse_shell: "Linux DFIR: Process and Egress Correlation",
  };
  return topics[String(incidentFamily || "")] || "Linux DFIR: Host Investigation";
}

function canonicalIdentities(input: QualityInput) {
  const identities = new Set<string>();
  const context = input.context;
  [
    context?.primaryUser,
    ...(context?.secondaryUsers || []),
    ...(context?.serviceAccounts || []),
    ...(context?.adminAccounts || []),
  ].filter(Boolean).forEach((item) => identities.add(String(item).toLowerCase()));

  const users = assetByPath(input.assets, "assets/csv/users.csv");
  if (users) {
    users.content.split(/\r?\n/).slice(1).forEach((line) => {
      const [username] = parseCsvLine(line);
      if (username) identities.add(username.toLowerCase());
    });
  }
  const passwd = assetByPath(input.assets, "assets/configs/passwd.sample") || assetByPath(input.assets, "assets/configs/linux_config_pack.txt");
  if (passwd) {
    passwd.content.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^([a-z0-9._-]+):x:/i);
      if (match) identities.add(match[1].toLowerCase());
    });
  }
  return identities;
}

function hasInvestigativeAction(text: string) {
  return /\b(?:analyse|analyze|assess|attribute|compare|confirm|correlate|cross-check|cross-reference|cross reference|cross-correlate|cross correlate|determine|document|enumerate|evaluate|examine|identify|inspect|map|reconcile|reconstruct|review|trace|validate|verify|align|establish|sequence|distinguish|classify|summari[sz]e|explain|prioriti[sz]e|recommend|propose|justify|report|investigate|check)\b/i.test(text);
}

function isVagueTask(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (/^(?:docker|network|evidence|logs?|files?|incident|task|activity|things?)\.?$/i.test(normalized)) return true;
  return /^(?:look(?:\s+into|\s+at)?|investigate|review|check|assess)\s+(?:this|it|the\s+)?(?:evidence|files|logs|incident|activity|things?)\.?$/i.test(normalized);
}

function taskDiagnosticLabel(task: NonNullable<FinalLinuxNarrative["tasks"]>[number], index: number) {
  const phase = task.phase?.trim() || `Task ${index + 1}`;
  const title = task.title?.trim() || "Untitled task";
  return `Task ${index + 1} "${phase}" "${title}"`;
}

function taskEvidenceDetail(input: QualityInput, task: NonNullable<FinalLinuxNarrative["tasks"]>[number]) {
  const resolvedAssets = (task.evidence || [])
    .map((item) => resolveNarrativeEvidence(input.assets, item))
    .filter((asset): asset is LabAsset => Boolean(asset));
  const evidenceBundle = (task.evidence || []).join(", ") || "no evidence listed";
  const evidenceClasses = taskEvidenceClasses(resolvedAssets);
  return { resolvedAssets, evidenceBundle, evidenceClasses };
}

function hasConcreteInvestigativeObject(taskText: string, task: NonNullable<FinalLinuxNarrative["tasks"]>[number], evidenceClasses: string[]) {
  if (isVagueTask(taskText)) return false;
  const objectTerms =
    /\b(?:ssh|sudo|account|identity|group|command|process|pid|lineage|file|path|permission|owner|mode|service|systemd|journal|log|logging|timeline|event|sequence|startup|execution|behaviour|behavior|coverage|reliability|mechanism|cron|schedule|package|apt|dpkg|docker|container|network|exposure|listener|route|firewall|configuration|policy|change|maintenance|risk|impact|containment|recommendation|options?|evidence|key|authorized_keys|host|session)\b/i;
  if (objectTerms.test(taskText)) return true;
  return (task.evidence || []).length > 0 && Boolean(task.deliverable?.trim()) && evidenceClasses.length > 0 && taskText.split(/\s+/).length >= 6;
}

function liveAccessViolation(taskText: string, evidenceClasses: string[], deliverable: string) {
  const text = taskText.replace(/\s+/g, " ").trim();
  const explicitLivePatterns: RegExp[] = [
    /\b(?:ssh|log)\s+in(?:to)?\b/i,
    /\bconnect\s+to\s+(?:the\s+)?(?:host|server|endpoint|container|remote)\b/i,
    /\bopen\s+(?:a\s+)?shell\b/i,
    /\brun\s+the\s+(?:command|script|binary)\b/i,
    /\brun\s+(?:ps\b|ss\b|netstat\b|docker\s+inspect|systemctl|journalctl|tcpdump|wireshark|nmap)\b/i,
    /\bexecute\s+(?:the\s+)?(?:command|script|binary|payload)\b/i,
    /\b(?:restart|stop|start|disable|enable|reload)\s+[\w.-]+\.service\b/i,
    /\b(?:remove|delete|modify|edit|change)\s+(?:the\s+)?(?:suspicious\s+|current\s+|live\s+)?(?:file|files|cron(?:\s+entry)?|entry|configuration|service|key)\b/i,
    /\bcapture\s+(?:fresh|new|current)?\s*(?:traffic|packet|pcap)\b/i,
    /\bscan\s+(?:the\s+)?(?:host|server|network|endpoint)\b/i,
    /\bquery\s+(?:the\s+)?(?:live|current)\s+(?:host|server|system|firewall|container)\b/i,
    /\bobtain\s+(?:a\s+)?(?:fresh|new|current)\s+(?:capture|dump|snapshot|log|artifact|artefact|evidence)\b/i,
    /\bremediate\s+now\b/i,
  ];
  const match = explicitLivePatterns.map((pattern) => text.match(pattern)?.[0]).find(Boolean);
  if (!match) return { blocked: false, reason: "", matched: "" };
  const offlineClasses = new Set([
    "timestamped_log",
    "process_snapshot",
    "process_history",
    "file_access_history",
    "file_metadata",
    "static_config",
    "network_state",
    "service_inventory",
    "policy_document",
    "change_document",
    "identity_inventory",
    "package_history",
    "scheduled_activity",
    "ssh_key_material",
  ]);
  const hasOfflineSupport = evidenceClasses.some((item) => offlineClasses.has(item));
  const offlineDeliverable =
    /\b(?:timeline|correlation|table|notes?|gap|policy|mapping|risk|summary|containment|recommendation|confidence|assessment|lineage|diagram|evidence)\b/i.test(deliverable);
  const framedAsOffline =
    /\b(?:provided|supplied|captured|saved|historical|artifact|artefact|evidence pack|snapshot|from evidence|using only)\b/i.test(text);
  if (hasOfflineSupport && offlineDeliverable && framedAsOffline && !/\b(?:ssh\s+in|run\s+|execute\s+|restart|delete|capture fresh|scan\s+the\s+host)\b/i.test(text)) {
    return { blocked: false, reason: "", matched: "" };
  }
  return { blocked: true, reason: "explicit live action or fresh evidence collection requested", matched: match };
}

export const linuxFinalNarrativeTextHygieneReason = linuxNarrativeTextHygieneReason;

function hasTextHygieneProblem(value: string) {
  return Boolean(linuxFinalNarrativeTextHygieneReason(value));
}

function checkFinalNarrative(input: QualityInput, issues: LinuxQualityIssue[]) {
  const lab = input.lab;
  if (!lab) return false;

  const context = input.context;
  const hasFullNarrative = Boolean(lab.title && lab.objective && lab.scenario && lab.tasks);
  const strings: Array<[string, string]> = [
    ["title", lab.title || ""],
    ["subtitle", lab.subtitle || ""],
    ["objective", lab.objective || ""],
    ["scenario", lab.scenario || ""],
    ["topic", String((lab as FinalLinuxNarrative & { topic?: string }).topic || "")],
    ...((lab.hints || []).map((item, index) => [`hint ${index + 1}`, item] as [string, string])),
    ...((lab.outcomes || lab.learningOutcomes || []).map((item, index) => [`outcome ${index + 1}`, item] as [string, string])),
  ];

  for (const task of lab.tasks || []) {
    strings.push(["task title", task.title || ""]);
    strings.push(["task description", task.description || ""]);
    strings.push(["task deliverable", task.deliverable || ""]);
  }

  strings.forEach(([field, value]) => {
    if (!value) return;
    if (hasTextHygieneProblem(value)) {
      issue(issues, "high", "generated_text", `Final narrative ${field} is malformed or truncated.`, undefined, undefined, value);
    }
    if (/CyberLab|generated lab|simulator|training case/i.test(value)) {
      issue(issues, "high", "generated_text", `Final narrative ${field} contains simulator/product wording.`, undefined, undefined, value);
    }
  });

  const title = lab.title || "";
  if (hasFullNarrative && title.trim().length < 12) {
    issue(issues, "high", "generated_text", "Final title is too short to be meaningful.", undefined, undefined, title);
  }
  if (hasFullNarrative && title.length > 140) {
    issue(issues, "high", "generated_text", "Final title is excessively long.", undefined, undefined, title);
  }
  if (hasFullNarrative && /\b(?:CL-LNX|INC|CHG)-\d+\b/i.test(title)) {
    issue(issues, "high", "generated_text", "Final title contains case or ticket metadata.", undefined, undefined, title);
  }
  if (hasFullNarrative && context && title.includes(context.hostname) && title.split(context.hostname).length > 2) {
    issue(issues, "high", "generated_text", "Final title duplicates the hostname.", undefined, undefined, title);
  }
  if (hasFullNarrative && context && !/(linux|ssh|sudo|cron|systemd|package|apt|docker|service|log|key|access|host|account|auth|runtime|evidence)/i.test(title)) {
    issue(issues, "high", "generated_text", "Final title lacks a Linux investigative focus.", undefined, undefined, title);
  }
  const topic = String((lab as FinalLinuxNarrative & { topic?: string }).topic || "");
  if (hasFullNarrative && context && topic && topic !== canonicalLinuxTopic(context.incidentFamily)) {
    issue(issues, "high", "generated_text", "Final topic does not match the canonical Linux topic.", undefined, undefined, topic);
  }

  const subtitle = lab.subtitle || "";
  if (subtitle && subtitle.length > 180) {
    issue(issues, "high", "generated_text", "Final subtitle is too long.", undefined, undefined, subtitle);
  }
  if (subtitle && /(?:SSH-|key-|hard|,\s*A|changevs|[-\s]driven\s*$|with\s*$|using\s*$|and\s*$|or\s*$|on\s*$|for\s*$|a\s*$|an\s*$|the\s*$)/i.test(subtitle.trim())) {
    issue(issues, "high", "generated_text", "Final subtitle ends with an incomplete phrase or technology fragment.", undefined, undefined, subtitle);
  }

  if (hasFullNarrative && context) {
    const objective = lab.objective || "";
    const scenario = lab.scenario || "";
    const allNarrative = `${title}\n${subtitle}\n${objective}\n${scenario}`;
    const windowText = `${context.incidentWindowStart}-${context.incidentWindowEnd}`;
    const spacedWindowText = `${context.incidentWindowStart} - ${context.incidentWindowEnd}`;
    const materialFacts: Array<[string, string, string]> = [
      ["hostname", context.hostname, scenario],
      ["host role", context.hostRole, scenario],
      ["case ID", context.incidentId, allNarrative],
      ["change ID", context.changeId, allNarrative],
    ];

    for (const [label, expected, haystack] of materialFacts) {
      if (expected && haystack && !cleanComparableText(haystack).includes(cleanComparableText(expected))) {
        issue(issues, "critical", "generated_text", `Final narrative does not reference canonical ${label}.`, undefined, undefined, expected);
      }
    }
    const canonicalCompany = companyComparable(context.company);
    const narrativeCompanyText = companyComparable(allNarrative);
    const scenarioCompanyText = companyComparable(scenario);
    if (canonicalCompany && !narrativeCompanyText.includes(canonicalCompany)) {
      const namedCompany = scenario.match(/\b([A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,3})\s+(?:SOC|Security|Operations|IT|Engineering)\b/);
      if (namedCompany && companyComparable(namedCompany[1]) !== canonicalCompany) {
        issue(issues, "critical", "generated_text", "Final scenario references a company that is not canonical for this investigation.", undefined, undefined, namedCompany[1]);
      } else {
        issue(issues, "high", "generated_text", "Final narrative does not reference the canonical company in title, objective, or scenario.", undefined, undefined, context.company);
      }
    } else if (canonicalCompany && !scenarioCompanyText.includes(canonicalCompany)) {
      issue(issues, "medium", "generated_text", "Final scenario omits the canonical company, but it appears elsewhere in the final narrative.", undefined, undefined, context.company);
    }

    if (objective && !objective.includes(windowText) && !objective.includes(spacedWindowText)) {
      issue(issues, "critical", "generated_text", "Final objective does not include the canonical incident window.", undefined, undefined, windowText);
    }
    if (objective && !cleanComparableText(objective).includes(cleanComparableText(context.hostname))) {
      issue(issues, "critical", "generated_text", "Final objective does not reference the canonical hostname.", undefined, undefined, context.hostname);
    }
    if (scenario && !textIncludesTimezone(scenario, context.timezone)) {
      issue(issues, "critical", "generated_text", "Final scenario does not include the canonical timezone.", undefined, undefined, context.timezone);
    }
    const serviceModel = serviceRoleModel(input);
    const mentionedServices = [...scenario.matchAll(/\b[a-z0-9_.@-]+\.service\b/gi)].map((match) => match[0]);
    const unsupportedService = mentionedServices.find((service) => serviceMentionRole(input, service) === "unknown");
    if (unsupportedService) {
      issue(issues, "critical", "generated_text", "Final scenario references a service that is not rendered in the canonical service inventory.", undefined, undefined, unsupportedService);
    }
    const backgroundService = mentionedServices.find((service) => serviceMentionRole(input, service) === "background");
    if (backgroundService && new RegExp(`\\b(?:centres?|centers?|focus(?:es)?|about|investigation\\s+(?:centres?|centers?)\\s+on)\\b[^.\\n]*\\b${escapeRegExp(backgroundService)}\\b`, "i").test(scenario)) {
      issue(issues, "critical", "generated_text", "Final scenario centres a background service instead of the primary service.", undefined, undefined, backgroundService);
    }
    if (serviceModel.primary && !allNarrative.toLowerCase().includes(serviceModel.primary)) {
      issue(issues, "critical", "generated_text", "Final narrative does not reference the canonical primary service.", undefined, undefined, serviceModel.primary);
    }
    const identities = canonicalIdentities(input);
    const materialActorPatterns = [
      /\b([a-z0-9._-]+)\s+(?:authenticated|executed|used sudo|ran|connected|logged in)\b/gi,
      /\bactivity\s+attributed\s+to\s+([a-z0-9._-]+)\b/gi,
      /\bsession\s+(?:belonging|attributed)\s+to\s+([a-z0-9._-]+)\b/gi,
      /\baccount\s+([a-z0-9._-]+)\b/gi,
      /\b([a-z0-9._-]+)'s\s+authorized_keys\b/gi,
    ];
    for (const pattern of materialActorPatterns) {
      for (const match of scenario.matchAll(pattern)) {
        const actor = match[1]?.toLowerCase();
        if (actor && identities.has(actor) && actor !== context.primaryUser.toLowerCase()) {
          issue(issues, "critical", "generated_text", "Final scenario references a non-canonical actor for the activity under review.", undefined, undefined, match[1]);
        }
      }
    }

    const canonicalValues = [
      context.hostname,
      context.primaryUser,
      context.affectedService,
      context.hostIp,
      context.changeId,
      context.ticketId,
      ...context.modifiedFiles,
    ].filter(Boolean);
    const mentionsAnyCanonical = canonicalValues.some((value) => allNarrative.includes(value));
    if (!mentionsAnyCanonical) {
      issue(issues, "critical", "generated_text", "Final narrative is too generic to tie back to the canonical investigation.", undefined, undefined, title);
    }
  }

  const tasks = lab.tasks || [];
  const narrativeDifficulty = String(input.lab?.difficulty || input.simulation?.canonicalTasks?.[0]?.difficulty || "Advanced");
  const narrativeTaskBounds = linuxDurationTaskCountBounds(
    narrativeDifficulty,
    input.workload?.requestedDurationMinutes || input.simulation?.requestedDurationMinutes
  );
  if (hasFullNarrative && tasks.length < narrativeTaskBounds.min) {
    issue(issues, "high", "generated_text", "Final narrative has too few investigation tasks.", undefined, undefined, String(tasks.length));
  }

  const taskKeys = new Set<string>();
  if (hasFullNarrative) tasks.forEach((task, index) => {
    const titleKey = cleanComparableText(`${task.title || ""} ${task.description || ""}`);
    const taskText = `${task.title || ""} ${task.description || ""} ${task.deliverable || ""}`;
    const diagnosticLabel = taskDiagnosticLabel(task, index);
    const { evidenceBundle, evidenceClasses } = taskEvidenceDetail(input, task);
    if (!task.title || task.title.trim().length < 8) {
      issue(issues, "high", "generated_text", `${diagnosticLabel} title is empty or too short.`, undefined, undefined, `evidence=${evidenceBundle}`);
    }
    if (!hasInvestigativeAction(`${task.title || ""} ${task.description || ""}`) || !hasConcreteInvestigativeObject(`${task.title || ""} ${task.description || ""}`, task, evidenceClasses)) {
      issue(
        issues,
        "medium",
        "generated_text",
        `${diagnosticLabel} lacks a clear investigative action.`,
        undefined,
        undefined,
        `rule=investigative_action evidence=${evidenceBundle} evidenceClasses=${evidenceClasses.join("|") || "none"} reason=missing concrete action/object scope or overly vague wording`
      );
    }
    if (taskKeys.has(titleKey)) {
      issue(issues, "high", "generated_text", `${diagnosticLabel} duplicates another task.`, undefined, undefined, `evidence=${evidenceBundle}`);
    }
    taskKeys.add(titleKey);
    if (!task.deliverable || task.deliverable.trim().length < 12 || /(?:610 lines|\bwith\s*$|\band\s*$|[-,:/]\s*$)/i.test(task.deliverable)) {
      issue(issues, "high", "generated_text", `${diagnosticLabel} deliverable is malformed or too generic.`, undefined, undefined, `deliverable=${task.deliverable || ""} evidence=${evidenceBundle}`);
    }
    const spoilerMatch = taskText.match(/\b(confirm|prove|identify)\s+(?:the\s+)?(?:attacker|root cause|compromised account|malicious activity|successful privilege escalation)\b/i);
    if (spoilerMatch) {
      issue(issues, "high", "generated_text", `${diagnosticLabel} requires an unsupported conclusion or gives away the answer.`, undefined, undefined, `matched="${spoilerMatch[0]}" evidence=${evidenceBundle}`);
    }
    const liveViolation = liveAccessViolation(taskText, evidenceClasses, task.deliverable || "");
    if (liveViolation.blocked) {
      issue(
        issues,
        "high",
        "generated_text",
        `${diagnosticLabel} requires live-system access instead of offline evidence review.`,
        undefined,
        undefined,
        `rule=live_access matched="${liveViolation.matched}" evidence=${evidenceBundle} evidenceClasses=${evidenceClasses.join("|") || "none"} reason=${liveViolation.reason}`
      );
    }
  });

  const outcomes = lab.outcomes || lab.learningOutcomes || [];
  if (hasFullNarrative && outcomes.length > 0 && context && !outcomes.join("\n").match(/ssh|sudo|cron|systemd|package|apt|docker|log|timeline|audit|journal|process|permission/i)) {
    issue(issues, "medium", "generated_text", "Final learning outcomes are too generic for the Linux evidence set.", undefined, undefined, outcomes.join(" | "));
  }

  return true;
}

function resolveNarrativeEvidence(assets: LabAsset[], value: string) {
  const aliasMap = buildEvidenceAliasMap(assets);
  const normalized = value.replace(/\\/g, "/").replace(/^\.?\//, "").trim().toLowerCase();
  const alias = aliasMap.get(normalized);
  if (alias) return alias;
  return assets.find((asset) => {
    const path = asset.file_path.replace(/\\/g, "/").toLowerCase();
    const withoutAssets = path.replace(/^assets\//, "");
    const fileName = path.split("/").at(-1) || "";
    return normalized === path || normalized === withoutAssets || normalized === fileName;
  });
}

function addEvidenceAlias(map: Map<string, LabAsset>, alias: string, asset: LabAsset) {
  const normalized = alias.replace(/\\/g, "/").replace(/^\.?\//, "").trim().toLowerCase();
  if (!normalized || map.has(normalized)) return;
  map.set(normalized, asset);
}

export function buildLinuxEvidenceAliasMap(assets: LabAsset[]) {
  return buildEvidenceAliasMap(assets);
}

function buildEvidenceAliasMap(assets: LabAsset[]) {
  const map = new Map<string, LabAsset>();
  for (const asset of assets) {
    const path = asset.file_path.replace(/\\/g, "/");
    const normalizedPath = path.toLowerCase();
    const withoutAssets = normalizedPath.replace(/^assets\//, "");
    const fileName = normalizedPath.split("/").at(-1) || "";
    addEvidenceAlias(map, normalizedPath, asset);
    addEvidenceAlias(map, withoutAssets, asset);
    addEvidenceAlias(map, fileName, asset);
    addEvidenceAlias(map, fileName.replace(/\.[^.]+$/, ""), asset);

    if (normalizedPath === "assets/configs/sudoers.d/platform") addEvidenceAlias(map, "platform", asset);
    if (normalizedPath === "assets/configs/pam/sshd") {
      addEvidenceAlias(map, "pam_sshd", asset);
      addEvidenceAlias(map, "pam sshd", asset);
    }
    if (normalizedPath === "assets/configs/sshd_config") addEvidenceAlias(map, "sshd", asset);
    if (normalizedPath.endsWith("/authorized_keys")) addEvidenceAlias(map, "authorized_keys", asset);
    if (normalizedPath === "assets/scheduled/cron.d/sys-maint") addEvidenceAlias(map, "sys-maint", asset);
    if (normalizedPath === "assets/reports/service_inventory.txt") addEvidenceAlias(map, "service inventory", asset);
  if (normalizedPath === "assets/runtime/process_snapshot.txt") addEvidenceAlias(map, "process snapshot", asset);
  if (normalizedPath === "assets/runtime/open_files.txt") addEvidenceAlias(map, "open files", asset);
  if (normalizedPath === "assets/runtime/process_execution_history.txt") addEvidenceAlias(map, "process execution history", asset);
  if (normalizedPath === "assets/runtime/file_access_history.csv") addEvidenceAlias(map, "file access history", asset);
  }
  return map;
}

function assetTags(asset: LabAsset) {
  const path = asset.file_path.toLowerCase();
  const content = asset.content.toLowerCase();
  const tags = new Set<string>();
  if (/auth\.log|sudo\.log|audit\.log|syslog|journal_|cron\.log|apt_history|history\.log|timeline\.csv/.test(path)) tags.add("timestamped_log");
  if (/sshd_config|pam\/sshd|sudoers|linux_config_pack|\.conf$/.test(path)) tags.add("static_config");
  if (/users\.csv|groups\.csv|passwd/.test(path)) tags.add("identity_inventory");
  if (/security_policy|hardening|audit_notes/.test(path)) tags.add("policy_document");
  if (/change_request|maintenance_ticket|incident_brief/.test(path)) tags.add("change_document");
  if (/process_snapshot/.test(path)) tags.add("process_snapshot");
  if (/process_execution_history/.test(path)) tags.add("process_history");
  if (/file_access_history/.test(path)) tags.add("file_access_history");
  if (/permissions_report|open_files/.test(path)) tags.add("file_metadata");
  if (/service_inventory/.test(path)) tags.add("service_inventory");
  if (/apt|dpkg|package/.test(path) || /apt install|dpkg/.test(content)) tags.add("package_history");
  if (/cron|scheduled|sys-maint/.test(path)) tags.add("scheduled_activity");
  if (/authorized_keys/.test(path) || /ssh-rsa|ssh-ed25519/.test(content)) tags.add("ssh_key_material");
  if (/network|netstat|ss\.txt|ufw|iptables/.test(path)) tags.add("network_state");
  return tags;
}

function inferTaskIntents(taskText: string, evidenceAssets: LabAsset[], family?: string) {
  const text = taskText.toLowerCase();
  const evidenceText = evidenceAssets.map((asset) => asset.file_path.toLowerCase()).join(" ");
  return inferLinuxTaskContracts(text, evidenceText, family);
}

function evidenceCapabilities(input: QualityInput, assets: LabAsset[]) {
  const capabilities = new Set<string>();
  const registry = input.simulation?.evidenceRegistry || [];
  for (const asset of assets) {
    const registered = registry.find((item) => item.path === asset.file_path || item.aliases.some((alias) => alias.toLowerCase() === asset.file_name.toLowerCase()));
    if (registered) registered.capabilities.forEach((capability) => capabilities.add(capability));
  }
  return capabilities;
}

function registryAssetsForEvidence(input: QualityInput, assets: LabAsset[]) {
  const registry = input.simulation?.evidenceRegistry || [];
  return assets
    .map((asset) => registry.find((item) => item.path === asset.file_path || item.aliases.some((alias) => alias.toLowerCase() === asset.file_name.toLowerCase())))
    .filter((asset): asset is NonNullable<(typeof registry)[number]> => Boolean(asset));
}

function subjectEvidenceNeedles(input: QualityInput, subjectIds: string[]) {
  const simulation = input.simulation;
  if (!simulation) return [];
  const values: string[] = [];
  for (const id of subjectIds) {
    const service = (simulation.services || []).find((item) => item.id === id);
    if (service) values.push(service.unitName, service.unitName.replace(/\.service$/, ""));
    const process = (simulation.processes || []).find((item) => item.id === id);
    if (process) values.push(String(process.pid), process.executable, process.argv.join(" "));
    const identity = (simulation.identities || []).find((item) => item.id === id);
    if (identity) values.push(identity.username, String(identity.uid));
    const group = (simulation.groups || []).find((item) => item.id === id);
    if (group) values.push(group.name, String(group.gid));
    const file = (simulation.files || []).find((item) => item.id === id);
    if (file) values.push(file.path);
    const cron = (simulation.cronDefinitions || []).find((item) => item.id === id);
    if (cron) {
      const command = (simulation.commands || []).find((item) => item.id === cron.commandId);
      values.push(cron.sourcePath, command?.renderedCommand || "", cron.schedule);
    }
    if (id.startsWith("package-subject:")) values.push(id.replace(/^package-subject:/, ""));
    const command = (simulation.commands || []).find((item) => item.id === id);
    if (command) values.push(command.renderedCommand, command.argv[0]);
  }
  return Array.from(new Set(values.filter((value) => value && value.length >= 2)));
}

function canonicalCurrentStateRequirements(canonicalTask: CanonicalInvestigationTask | undefined) {
  return (canonicalTask?.currentStateRequirements || []).map((requirement) => ({
    capability: requirement.capability,
    subjectIds: requirement.subjectIds,
    reason: `${canonicalTask?.intent || "task"} canonical current-state requirement`,
    suggestedEvidence: CURRENT_STATE_EVIDENCE_HINTS[requirement.capability as LinuxCurrentStateRequirement["capability"]] || [],
  })) as LinuxCurrentStateRequirement[];
}

function hasExplicitCurrentStateWording(taskText: string) {
  return /\b(?:current(?:ly)?|present\s+state|runtime\s+state|live\s+state|active\s+state|service\s+status|process\s+status|still\s+running|remains?\s+(?:running|active|enabled|installed|present)|currently\s+(?:running|active|enabled|installed|present)|current\s+(?:permissions|account\s+state|persistence\s+mechanism|configuration|policy)|effective\s+configuration)\b/i.test(taskText);
}

function checkCurrentStateTaskEvidence(args: {
  input: QualityInput;
  task: NonNullable<FinalLinuxNarrative["tasks"]>[number];
  index: number;
  taskText: string;
  canonicalTask?: CanonicalInvestigationTask;
  resolvedAssets: LabAsset[];
  registryAssets: ReturnType<typeof registryAssetsForEvidence>;
  issues: LinuxQualityIssue[];
}) {
  const wordingRequirements = args.input.simulation?.services && args.input.simulation?.commands
    ? inferCurrentStateRequirementsFromText(args.taskText, args.input.simulation as LinuxSimulationWorld)
    : inferCurrentStateRequirementsFromText(args.taskText);
  const requirements = [...canonicalCurrentStateRequirements(args.canonicalTask)];
  const shouldUseWordingRequirements = !args.canonicalTask || requirements.length > 0 || hasExplicitCurrentStateWording(args.taskText);
  if (shouldUseWordingRequirements) {
    for (const requirement of wordingRequirements) {
      if (!requirements.some((item) => item.capability === requirement.capability && item.subjectIds.join("|") === requirement.subjectIds.join("|"))) {
        requirements.push(requirement);
      }
    }
  }
  if (requirements.length === 0 && hasExplicitCurrentStateWording(args.taskText)) {
    issue(
      args.issues,
      "critical",
      "asset_consistency",
      "Final task introduces unsupported current-state wording with no resolvable evidence capability.",
      undefined,
      undefined,
      `task ${args.index + 1}: ${args.task.title || ""}`
    );
    return;
  }
  if (requirements.length === 0) return;

  const selectedText = args.resolvedAssets.map((asset) => asset.content).join("\n").toLowerCase();
  for (const requirement of requirements) {
    const supportingRegistryAssets = args.registryAssets.filter((asset) => asset.capabilities.includes(requirement.capability));
    const selectedPaths = args.resolvedAssets.map((asset) => asset.file_path).join(", ") || "no evidence";
    if (supportingRegistryAssets.length === 0) {
      issue(
        args.issues,
        "critical",
        "asset_consistency",
        "Final task asks for current-state evidence but selected artifacts do not expose the required capability.",
        undefined,
        undefined,
        `task ${args.index + 1}: ${args.task.title || ""}; capability=${requirement.capability}; selected=${selectedPaths}; suggested=${requirement.suggestedEvidence.join("|")}`
      );
      continue;
    }
    if (supportingRegistryAssets.every((asset) => asset.stateType === "historical_reconstruction" || asset.assetType === "timestamped_log" || asset.assetType === "journal" || asset.assetType === "package_history")) {
      issue(
        args.issues,
        "critical",
        "asset_consistency",
        "Final task relies only on historical evidence for a current-state question.",
        undefined,
        undefined,
        `task ${args.index + 1}: ${args.task.title || ""}; capability=${requirement.capability}; selected=${selectedPaths}`
      );
      continue;
    }
    const needles = subjectEvidenceNeedles(args.input, requirement.subjectIds);
    if (needles.length > 0 && !needles.some((needle) => selectedText.includes(needle.toLowerCase()))) {
      issue(
        args.issues,
        "critical",
        "asset_consistency",
        "Final task asks about an entity absent from the selected current-state evidence.",
        undefined,
        undefined,
        `task ${args.index + 1}: ${args.task.title || ""}; capability=${requirement.capability}; entity=${needles.slice(0, 4).join("|")}; selected=${selectedPaths}`
      );
    }
  }
}

function canonicalTaskGrounded(canonicalTask: CanonicalInvestigationTask | undefined, input: QualityInput, assets: LabAsset[]) {
  if (!canonicalTask?.requirements?.length) return true;
  const registryAssets = registryAssetsForEvidence(input, assets);
  const proofs = proveTaskRequirements(canonicalTask, registryAssets);
  return proofs.every((proof) => proof.feasible);
}

function missingTaskGrounding(canonicalTask: CanonicalInvestigationTask | undefined, input: QualityInput, assets: LabAsset[]) {
  if (!canonicalTask?.requirements?.length) return [];
  const registryAssets = registryAssetsForEvidence(input, assets);
  return proveTaskRequirements(canonicalTask, registryAssets)
    .filter((proof) => !proof.feasible)
    .map((proof) => `${proof.requirementId}${proof.missingSubjectIds.length ? ` missing subjects ${proof.missingSubjectIds.join("|")}` : ""}${proof.missingRelation ? " missing relation" : ""}`);
}

function taskContractSatisfied(input: QualityInput, intent: CanonicalInvestigationTask["intent"], assets: LabAsset[]) {
  const contract = linuxTaskContract(intent);
  const capabilities = evidenceCapabilities(input, assets);
  if (capabilities.size > 0 && contract.requiredCapabilities.every((capability) => capabilities.has(capability))) return true;
  const evidenceClasses = taskEvidenceClasses(assets);
  return contract.fallbackEvidenceTags.some((tag) => evidenceClasses.includes(tag));
}

function missingTaskCapabilities(input: QualityInput, intent: CanonicalInvestigationTask["intent"], assets: LabAsset[]) {
  const contract = linuxTaskContract(intent);
  const capabilities = evidenceCapabilities(input, assets);
  if (capabilities.size === 0) return [];
  return contract.requiredCapabilities.filter((capability) => !capabilities.has(capability));
}

function taskEvidenceClasses(assets: LabAsset[]) {
  return [...new Set(assets.flatMap((asset) => [...assetTags(asset)]))].sort();
}

function matchedTaskKeywords(taskText: string) {
  const text = taskText.toLowerCase();
  return [
    "timeline", "sequence", "ssh", "authorized_keys", "account", "group membership", "sudo",
    "service state", "systemd", "process", "pid", "permissions", "owner", "mode", "package",
    "apt", "cron", "change", "maintenance", "configuration", "impact", "risk", "containment",
    "integrity", "evidence gap", "logging", "confidence", "ownership gap", "source ip",
    "reconcile", "cross-reference", "cross-correlate",
  ].filter((keyword) => text.includes(keyword));
}

function checkFinalTaskEvidence(input: QualityInput, issues: LinuxQualityIssue[]) {
  const lab = input.lab;
  if (isCompleteLinuxSimulation(input.simulation)) {
    const incidentCoverage = validateLinuxIncidentCoverage({
      simulation: input.simulation,
      finalAssets: input.assets,
      lab,
    });
    for (const coverageIssue of incidentCoverage.issues) {
      issue(
        issues,
        "critical",
        "asset_consistency",
        `${coverageIssue.code}: ${coverageIssue.message}`,
        undefined,
        undefined,
        `family=${coverageIssue.incidentFamily}; difficulty=${coverageIssue.difficulty}; requirement=${coverageIssue.requirementId}; tasks=${coverageIssue.finalTaskIds.join("|")}; capabilities=${coverageIssue.presentCapabilities.join("|")}; evidenceRoles=${coverageIssue.presentEvidenceRoles.join("|")}; suggested=${coverageIssue.suggestedTaskIntents.join("|")}; repair=${coverageIssue.regenerationCanRepair ? "regenerate" : "no"}`
      );
    }
    const taskDiversity = validateLinuxTaskDiversity({
      simulation: input.simulation,
      finalAssets: input.assets,
    });
    for (const diversityIssue of taskDiversity.issues) {
      issue(
        issues,
        "critical",
        "asset_consistency",
        `${diversityIssue.code}: ${diversityIssue.message}`,
        undefined,
        undefined,
        `difficulty=${taskDiversity.difficulty}; tasks=${diversityIssue.taskIds.join("|")}; intents=${diversityIssue.intents.join("|")}; score=${diversityIssue.overlap?.semanticScore ?? "n/a"}; sharedRequirements=${diversityIssue.overlap?.sharedIncidentRequirementIds.join("|") || ""}; sharedRoles=${diversityIssue.overlap?.sharedEvidenceRoles.join("|") || ""}; distinct=${diversityIssue.overlap?.distinctContributionSignals.join("|") || ""}`
      );
    }
  }
  if (!lab) return false;
  const solvability = validateLinuxStudentTaskSolvability({
    simulation: isCompleteLinuxSimulation(input.simulation) ? input.simulation : undefined,
    finalAssets: input.assets,
    lab,
  });
  for (const solvabilityIssue of solvability.issues) {
    issue(
      issues,
      "critical",
      "asset_consistency",
      `${solvabilityIssue.code}: ${solvabilityIssue.message}`,
      undefined,
      undefined,
      `task=${solvabilityIssue.taskIndex + 1}; intent=${solvabilityIssue.intent}; requirement=${solvabilityIssue.requirement}; selected=${solvabilityIssue.selectedEvidence.join("|")}; suggested=${solvabilityIssue.suggestedEvidence.join("|")}; repair=${solvabilityIssue.regenerationCanRepair ? "regenerate" : "no"}`
    );
  }
  const context = input.context;
  const canonicalTasks = (input.simulation?.canonicalTasks || []).slice().sort((left, right) => left.order - right.order);
  for (const [index, task] of (lab.tasks || []).entries()) {
    const evidence = task.evidence || [];
    if (evidence.length === 0) {
      issue(issues, "critical", "asset_consistency", "Final task has no evidence reference.", undefined, undefined, task.title || `task ${index + 1}`);
      continue;
    }
    const taskText = `${task.title || ""} ${task.description || ""} ${task.deliverable || ""}`.toLowerCase();
    const resolved = evidence.map((item) => ({ item, asset: resolveNarrativeEvidence(input.assets, item) }));
    for (const item of resolved) {
      if (!item.asset) {
        issue(issues, "critical", "asset_consistency", "Final task references evidence that is not present in the asset pack.", undefined, undefined, item.item);
      }
    }
    const resolvedAssets = resolved.map((item) => item.asset).filter((asset): asset is LabAsset => Boolean(asset));
    if (resolvedAssets.length === 0) continue;
    const canonicalTask = canonicalTasks[index];
    const registryAssets = registryAssetsForEvidence(input, resolvedAssets);
    const joinedContent = resolvedAssets.map((asset) => `${asset.file_path}\n${asset.content}`).join("\n").toLowerCase();
    if (/\b(?:supplementary\s+groups?|group\s+membership|groups?\s+for)\b/i.test(taskText) && !/groups\.csv|\/group(?:\.sample)?\b/.test(joinedContent)) {
      issue(issues, "high", "asset_consistency", "Final task evidence does not include group inventory required by the requested action.", undefined, undefined, task.title || `task ${index + 1}`);
    }
    const intents = canonicalTask
      ? new Set<CanonicalInvestigationTask["intent"]>([canonicalTask.intent])
      : inferTaskIntents(taskText, resolvedAssets, context?.incidentFamily);
    const evidenceClasses = taskEvidenceClasses(resolvedAssets);
    const matchedKeywords = matchedTaskKeywords(taskText);
    for (const intent of intents) {
      const contract = linuxTaskContract(intent);
      const confidence = matchedKeywords.length >= 1 || contract.fallbackEvidenceTags.some((tag) => evidenceClasses.includes(tag)) ? "high" : "low";
      if (process.env.CYBERLAB_LINUX_NARRATIVE_TRACE === "true" || process.env.NODE_ENV !== "production") {
        console.info(
          `[CyberLab Linux Task Classifier] task="${(task.title || `task ${index + 1}`).slice(0, 180)}" intent=${intent} evidenceClasses=${evidenceClasses.join("|") || "none"} requiredCapabilities=${contract.requiredCapabilities.join("|") || "none"} fallbackTags=${contract.fallbackEvidenceTags.join("|") || "none"} confidence=${confidence} keywords=${matchedKeywords.join("|") || "none"}`
        );
      }
      if (confidence === "low") continue;
      if (canonicalTask && !canonicalTaskGrounded(canonicalTask, input, resolvedAssets)) {
        const missing = missingTaskGrounding(canonicalTask, input, resolvedAssets);
        issue(
          issues,
          "high",
          "asset_consistency",
          `Final task evidence does not satisfy ${contract.label} object-grounding contract.`,
          undefined,
          undefined,
          missing.length > 0 ? `${task.title || `task ${index + 1}`}: ${missing.join("; ")}` : task.title || `task ${index + 1}`
        );
        continue;
      }
      if (!taskContractSatisfied(input, intent, resolvedAssets)) {
        const missing = missingTaskCapabilities(input, intent, resolvedAssets);
        issue(
          issues,
          "high",
          "asset_consistency",
          `Final task evidence does not satisfy ${contract.label} contract.`,
          undefined,
          undefined,
          missing.length > 0 ? `${task.title || `task ${index + 1}`}: missing ${missing.join(", ")}` : task.title || `task ${index + 1}`
        );
      }
    }
    checkCurrentStateTaskEvidence({
      input,
      task,
      index,
      taskText,
      canonicalTask,
      resolvedAssets,
      registryAssets,
      issues,
    });

    if (context) {
      const materialValues = [
        context.hostname,
        context.primaryUser,
        context.affectedService,
        context.suspiciousCommands[0],
        context.modifiedFiles[0],
      ].filter(Boolean);
      const taskMentionsMaterial = materialValues.some((value) => taskText.includes(value.toLowerCase()));
      const evidenceContainsMaterial = materialValues.some((value) => joinedContent.includes(value.toLowerCase()));
      if (taskMentionsMaterial && !evidenceContainsMaterial) {
        issue(issues, "high", "asset_consistency", "Final task mentions a canonical fact not supported by its referenced evidence.", undefined, undefined, task.title || `task ${index + 1}`);
      }
    }
  }
  return true;
}

function firstTaskVerb(task: NonNullable<FinalLinuxNarrative["tasks"]>[number]) {
  const text = `${task.title || ""} ${task.description || ""}`.trim();
  const match = text.match(/^[A-Za-z]+/);
  return (match?.[0] || "").toLowerCase();
}

function normalizedDeliverableType(value: string | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
}

function checkInvestigationBlueprintDesign(input: QualityInput, issues: LinuxQualityIssue[]) {
  const simulation = input.simulation;
  if (!simulation) return;
  if (!simulation.investigation || !Array.isArray(simulation.canonicalTasks) || !Array.isArray(simulation.evidenceRegistry)) return;
  const evidenceRegistry = simulation.evidenceRegistry;
  const tasks = (simulation.canonicalTasks || []).slice().sort((left, right) => left.order - right.order);
  const difficulty = tasks[0]?.difficulty || String(input.lab?.difficulty || "Advanced");
  const taskBounds = linuxDurationTaskCountBounds(
    difficulty,
    input.workload?.requestedDurationMinutes || simulation.requestedDurationMinutes
  );
  if (tasks.length < taskBounds.min || tasks.length > taskBounds.max) {
    issue(issues, "critical", "generated_text", `Linux blueprint produced ${tasks.length} tasks; expected ${taskBounds.min} to ${taskBounds.max}.`);
  }
  const expectedBlueprint = linuxInvestigationBlueprintForFamily(simulation.investigation.incidentFamily);
  const blueprintIds = Array.from(new Set(tasks.map((task) => task.blueprintId || "")));
  if (blueprintIds.length !== 1 || blueprintIds[0] !== expectedBlueprint.id) {
    issue(
      issues,
      "critical",
      "generated_text",
      `Linux incident family ${simulation.investigation.incidentFamily} selected inappropriate investigation blueprint.`,
      undefined,
      undefined,
      `${blueprintIds.join(", ") || "missing"} <> ${expectedBlueprint.id}`
    );
  }
  const hardCodedLegacyOrder = ["scope_timeline", "actor_attribution", "command_process", "service_state", "change_control"];
  const actualPrefix = tasks.slice(0, hardCodedLegacyOrder.length).map((task) => task.intent);
  if (actualPrefix.every((intent, index) => intent === hardCodedLegacyOrder[index])) {
    issue(issues, "high", "generated_text", "Linux investigation follows the legacy fixed task sequence.");
  }
  const deliverableTypes = new Set(tasks.map((task) => task.expectedDeliverableType));
  if (tasks.length >= 6 && deliverableTypes.size < 3) {
    issue(issues, "high", "generated_text", "Linux investigation task plan lacks deliverable variety.");
  }
  const evidenceBundles = new Set(tasks.map((task) => task.selectedEvidenceAssetIds.slice().sort().join("|")));
  if (tasks.length >= 6 && evidenceBundles.size < 4) {
    issue(issues, "high", "asset_consistency", "Linux investigation task plan reuses too many identical evidence bundles.");
  }
  const canonicalDifficulty = tasks[0]?.difficulty || "Advanced";
  const diagnosticTaskIds = new Set(
    canonicalDifficulty === "Advanced"
      ? []
      : (simulation.difficultyDiagnostics?.issues || [])
        .filter((item) => String(item.code || "").startsWith("LINUX_DIFFICULTY_"))
        .map((item) => item.taskId)
        .filter(Boolean)
  );
  const unsupportedOptional = tasks.find((task) => {
    if (diagnosticTaskIds.has(task.id)) return false;
    const selectedAssets = evidenceRegistry.filter((asset) => task.selectedEvidenceAssetIds.includes(asset.id));
    return selectedAssets.length === 0 || !task.requiredCapabilities.some((capability) => selectedAssets.some((asset) => asset.capabilities.includes(capability)));
  });
  if (unsupportedOptional) {
    issue(issues, "critical", "asset_consistency", "Linux optional investigation task appears without supporting evidence.", undefined, undefined, unsupportedOptional.id);
  }

  const finalTasks = input.lab?.tasks || [];
  if (finalTasks.length >= 5) {
    if (finalTasks.length !== tasks.length) {
      issue(
        issues,
        "critical",
        "generated_text",
        `Narrative returned ${finalTasks.length} tasks; canonical blueprint requires ${tasks.length}.`
      );
    }
    const verbs = new Set(finalTasks.map(firstTaskVerb).filter(Boolean));
    if (verbs.size < Math.min(4, finalTasks.length)) {
      issue(issues, "high", "generated_text", "Final Linux task wording uses too little verb variety.");
    }
    const deliverables = new Set(finalTasks.map((task) => normalizedDeliverableType(task.deliverable)).filter(Boolean));
    if (deliverables.size < Math.min(3, finalTasks.length)) {
      issue(issues, "high", "generated_text", "Final Linux task deliverables are too repetitive.");
    }
  }
}

function checkCsvCorrectness(input: QualityInput, issues: LinuxQualityIssue[]) {
  for (const asset of input.assets.filter((item) => item.file_type === "csv" || item.file_path.endsWith(".csv"))) {
    const rows = asset.content.split(/\r?\n/).filter((line) => line.length > 0);
    if (rows.length === 0) {
      issue(issues, "high", "asset_consistency", "CSV asset is empty.", asset.file_path);
      continue;
    }
    const header = parseCsvLineWithState(rows[0]);
    if (header.quoted || header.values.some((value) => !value.trim())) {
      issue(issues, "high", "asset_consistency", "CSV header is malformed or contains blank columns.", asset.file_path, 1, rows[0]);
    }
    const expectedColumns = header.values.length;
    rows.slice(1).forEach((row, offset) => {
      const parsed = parseCsvLineWithState(row);
      if (parsed.quoted) {
        issue(issues, "high", "asset_consistency", "CSV row has unterminated quoted field.", asset.file_path, offset + 2, row);
      }
      if (parsed.values.length !== expectedColumns) {
        issue(
          issues,
          "high",
          "asset_consistency",
          `CSV row has ${parsed.values.length} columns but header has ${expectedColumns}.`,
          asset.file_path,
          offset + 2,
          row
        );
      }
    });
  }
}

function checkSystemdAndPackageModel(input: QualityInput, issues: LinuxQualityIssue[]) {
  const assets = input.assets;
  lineIssues(
    assets,
    /\b(?:Started|Stopped|Reloaded|Finished)\s+systemd\.service\b|\bFinished systemd$/i,
    "critical",
    "service_model",
    "systemd is modeled as an ordinary affected service.",
    issues
  );
  lineIssues(
    assets,
    /^systemd,running,enabled|Affected service:\s*systemd\b/i,
    "critical",
    "service_model",
    "systemd appears as an affected application service.",
    issues
  );
  lineIssues(
    assets,
    /^apt,running,enabled|\bapt service\b|\b(?:Started|Stopped|Reloaded) apt\.\b|Affected service:\s*apt\b/i,
    "critical",
    "package_management",
    "APT is modeled as a fake daemon/service.",
    issues
  );
  lineIssues(
    assets,
    /\/etc\/systemd\/system\/(?:ssh|cron|rsyslog|apache2|nginx|docker|containerd|apt-daily|apt-daily-upgrade)\.service\b/i,
    "critical",
    "service_model",
    "Packaged service is referenced as a local /etc/systemd/system unit without override evidence.",
    issues
  );
  const serviceInventory = assetByPath(assets, "assets/reports/service_inventory.txt");
  const journal = assetByPath(assets, "assets/journal/journal_systemd.txt");
  if (journal) {
    const lines = journal.content.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => /^-- Journal begins/i.test(line.trim()));
    const firstEntryIndex = lines.findIndex((line) => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+/.test(line));
    if (headerIndex > -1 && firstEntryIndex > -1 && headerIndex > firstEntryIndex) {
      issue(issues, "critical", "service_model", "Journal header appears after journal entries.", journal.file_path, headerIndex + 1, lines[headerIndex].trim());
    }
  }
  if (serviceInventory) {
    const serviceNames = new Set<string>();
    const badRow = serviceInventory.content
      .split(/\r?\n/)
      .find((line) => /^(?:apt|systemd),running,enabled/i.test(line));
    if (badRow) {
      issue(
        issues,
        "critical",
        "service_model",
        "Service inventory contains fake affected service row.",
        serviceInventory.file_path,
        undefined,
        badRow
      );
    }
    serviceInventory.content.split(/\r?\n/).forEach((line, index) => {
      const [service, state = "", startup = ""] = line.split(",");
      if (!service || service === "service") return;
      const normalized = service.replace(/\.service$/, "");
      if (serviceNames.has(normalized)) {
        issue(issues, "medium", "service_model", `Possible duplicate service alias ${service}.`, serviceInventory.file_path, index + 1, line.trim());
      }
      serviceNames.add(normalized);
      if (/apt-daily\.timer/.test(service) && !/active|running/i.test(state)) {
        issue(issues, "medium", "package_management", "apt-daily.timer should be active/enabled timer metadata.", serviceInventory.file_path, index + 1, line.trim());
      }
      if (/apt-daily\.service/.test(service) && /running/i.test(state) && /enabled/i.test(startup)) {
        issue(issues, "high", "package_management", "apt-daily.service is modeled as a long-running enabled service.", serviceInventory.file_path, index + 1, line.trim());
      }
      if (/failed/i.test(state) && !new RegExp(`Failed\\s+${escapeRegExp(service)}`, "i").test(journal?.content || "")) {
        issue(issues, "critical", "service_model", `Service inventory marks ${service} failed without supporting journal failure evidence.`, serviceInventory.file_path, index + 1, line.trim());
      }
    });
  }
}

function checkSystemdLifecycleCausality(input: QualityInput, issues: LinuxQualityIssue[]) {
  const audit = assetByPath(input.assets, "assets/logs/audit.log");
  const journal = assetByPath(input.assets, "assets/journal/journal_systemd.txt");
  if (!audit || !journal) return;

  const commandLines = audit.content.split(/\r?\n/).filter((line) => /type=USER_CMD/i.test(line));
  const commandText = commandLines.join("\n");
  const commandTimeFor = (unit: string, verbs: string[]) => {
    const unitPattern = escapeRegExp(unit);
    for (const line of commandLines) {
      if (!new RegExp(`systemctl\\s+(?:${verbs.join("|")})\\s+${unitPattern}`, "i").test(line)) continue;
      const match = line.match(/audit\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\)/);
      if (match) return `${match[1]} ${match[2]}`;
    }
    return null;
  };

  audit.content.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^type=(SERVICE_[A-Z_]+).*?\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\).*?unit="([^"]+)"/i);
    if (!match) return;
    const [, type, date, time, unit] = match;
    if (/\b(?:transition|activity_ref)=/.test(line) && !/\bcause=/.test(line)) {
      issue(issues, "critical", "service_model", `Service lifecycle audit event for ${unit} lacks a causal reference.`, audit.file_path, index + 1, line.trim());
    }
    const windowStart = input.simulation?.collection?.windowStart || (input.context ? linuxLocalCaseTimeToUtcTimestamp({ incidentDate: input.context.incidentDate, timezone: input.context.timezone }, `${input.context.incidentWindowStart}:00`) : "");
    if (windowStart && /\bcause="observed command"/.test(line) && `${date} ${time}` < windowStart) {
      issue(issues, "critical", "service_model", `Command-caused service lifecycle event for ${unit} occurs before the incident window.`, audit.file_path, index + 1, `${date} ${time} < ${windowStart}`);
    }
    const journalLines = journal.content
      .split(/\r?\n/)
      .filter((journalLine) => journalLine.includes(`${date} ${time}`) && journalLine.toLowerCase().includes(unit.toLowerCase().replace(/\.service$/, "")));
    const expected =
      type === "SERVICE_START" ? /\bStarted\b/i :
      type === "SERVICE_RELOAD" ? /\bReloaded\b/i :
      type === "SERVICE_RESTART" ? /\bRestarted\b/i :
      type === "SERVICE_STOP" ? /\bStopped\b/i :
      null;
    if (expected && journalLines.length > 0 && !journalLines.some((journalLine) => expected.test(journalLine))) {
      issue(
        issues,
        "critical",
        "service_model",
        `Audit ${type} for ${unit} disagrees with journal lifecycle wording.`,
        audit.file_path,
        index + 1,
        `${line.trim()} <> ${journalLines.join(" | ")}`
      );
    }
    if (type === "SERVICE_START" && !new RegExp(`systemctl\\s+(?:start\\s+${escapeRegExp(unit)}|enable\\s+--now\\s+${escapeRegExp(unit)})`, "i").test(commandText)) {
      issue(
        issues,
        "critical",
        "service_model",
        `Service start for ${unit} lacks a causal systemctl start or enable --now command.`,
        audit.file_path,
        index + 1,
        line.trim()
      );
    }
    const causeTime =
      type === "SERVICE_RELOAD"
        ? commandTimeFor(unit, ["reload"])
        : type === "SERVICE_RESTART"
          ? commandTimeFor(unit, ["restart"])
        : type === "SERVICE_START"
          ? commandTimeFor(unit, ["start", "enable\\s+--now"])
          : null;
    if (causeTime && `${date} ${time}` < causeTime) {
      issue(
        issues,
        "critical",
        "service_model",
        `Service lifecycle effect for ${unit} occurs before its causal command.`,
        audit.file_path,
        index + 1,
        `${line.trim()} cause=${causeTime}`
      );
    }
  });

  if (/\bapt\s+install\s+ncat\b/i.test(audit.content) && /\bapt-daily\.service\b.*(?:ncat|manual package|install)/i.test(journal.content)) {
    issue(
      issues,
      "critical",
      "package_management",
      "Manual apt install is conflated with apt-daily.service activity.",
      journal.file_path,
      undefined,
      "apt-daily.service"
    );
  }
  const aptHistory = assetByPath(input.assets, "assets/logs/apt_history.log");
  if (aptHistory) {
    if (input.context?.incidentFamily === "unauthorized_package_install") {
      if (/Commandline:\s+\/usr\/lib\/apt\/apt\.systemd\.daily|unattended-upgrade|apt-daily/i.test(aptHistory.content)) {
        issue(issues, "critical", "package_management", "Manual package transaction is rendered as timer-driven apt activity.", aptHistory.file_path, undefined, "apt-daily");
      }
      if (!/Requested-By:\s+[a-z0-9._-]+\s+\(\d+\)/i.test(aptHistory.content)) {
        issue(issues, "high", "package_management", "Manual package transaction lacks a requesting identity in apt history.", aptHistory.file_path, undefined, "Requested-By");
      }
    } else if (/Commandline:\s+apt\s+install\s+ncat/i.test(aptHistory.content) && !/Requested-By:/i.test(aptHistory.content)) {
      issue(issues, "critical", "package_management", "Timer-driven package transaction is rendered as a manual install without a human requester.", aptHistory.file_path, undefined, "apt install ncat");
    }
  }
}

function checkEventTypes(input: QualityInput, issues: LinuxQualityIssue[]) {
  const sudo = assetByPath(input.assets, "assets/logs/sudo.log");
  const audit = assetByPath(input.assets, "assets/logs/audit.log");
  const authEventAsCommand = /\b(?:COMMAND=|cmd=")(?:ssh\s+)?(?:publickey|password)\s+login\b|\bCOMMAND=.*\bAccepted\s+(?:publickey|password)\b/i;
  if (sudo) {
    sudo.content.split(/\r?\n/).forEach((line, index) => {
      if (authEventAsCommand.test(line)) {
        issue(issues, "critical", "sudo_audit", "SSH authentication event appears as a sudo command.", sudo.file_path, index + 1, line.trim());
      }
    });
  }
  if (audit) {
    audit.content.split(/\r?\n/).forEach((line, index) => {
      if (/type=USER_CMD/i.test(line) && authEventAsCommand.test(line)) {
        issue(issues, "critical", "sudo_audit", "SSH authentication event appears as audit USER_CMD execution.", audit.file_path, index + 1, line.trim());
      }
      if (/type=USER_CMD/i.test(line) && /\b(?:Accepted|Failed) (?:publickey|password)\b/i.test(line)) {
        issue(issues, "critical", "sudo_audit", "Authentication result is encoded as command execution.", audit.file_path, index + 1, line.trim());
      }
    });
  }
}

type SudoRule = {
  subject: string;
  group: boolean;
  runAs: string;
  commands: string[];
  source: string;
};

function checkSudoAuthorization(input: QualityInput, issues: LinuxQualityIssue[]) {
  const sudo = assetByPath(input.assets, "assets/logs/sudo.log");
  const groups = collectGroupMembers(input.assets);
  const rules = collectSudoRules(input.assets);
  const sudoPolicyText = renderedSudoPolicyFromAssets(input.assets);
  checkSudoInventoryContradictions(input.assets, rules, groups, issues);
  checkSudoersModes(input.assets, issues);
  if (!sudo) return;

  sudo.content.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const match = line.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+([a-z0-9._-]+)\s+:.*?USER=([a-z0-9:_-]+)\s+;\s+COMMAND=(.+)$/i);
    if (!match) return;
    const [, user, runAs, command] = match;
    const decision = resolveSudoPolicy({
      sudoPolicyText,
      username: user,
      targetUser: runAs,
      commandText: command.trim(),
      groups: groupsForUser(groups, user),
    });
    if (/authentication failure/i.test(line)) {
      if (decision.status === "permitted_nopasswd") {
        issue(
          issues,
          "critical",
          "sudo_audit",
          `NOPASSWD sudo command by ${user} is rendered with an authentication failure.`,
          sudo.file_path,
          index + 1,
          line.trim()
        );
      }
      return;
    }
    if (!sudoCommandAllowed(user, runAs, command.trim(), rules, groups) || decision.status === "denied") {
      issue(
        issues,
        "critical",
        "sudo_audit",
        `Successful sudo command by ${user} is not authorized by generated sudoers.`,
        sudo.file_path,
        index + 1,
        line.trim()
      );
    }
  });

  checkCanonicalSudoPolicyConsistency(input, sudoPolicyText, groups, issues);
  checkAuthLogSudoPolicyContradictions(input, sudoPolicyText, groups, issues);
  checkTimelineSudoPolicyContradictions(input, sudoPolicyText, groups, issues);
}

function renderedSudoPolicyFromAssets(assets: LabAsset[]) {
  const sudoAssets = assets.filter((asset) =>
    /(?:^|\/)sudoers(?:\.d\/|$)|\/sudoers\.d\//i.test(asset.file_path)
  );
  const configPack = assets.find((asset) =>
    /linux_config_pack\.txt$/i.test(asset.file_path) && /# sudoers\.sample/i.test(asset.content)
  );
  return [...sudoAssets, ...(configPack ? [configPack] : [])]
    .map((asset) => asset.content)
    .join("\n");
}

function groupsForUser(groups: Map<string, Set<string>>, username: string) {
  const memberships = new Set<string>();
  groups.forEach((members, group) => {
    if (members.has(username)) memberships.add(group);
  });
  return memberships;
}

function checkCanonicalSudoPolicyConsistency(
  input: QualityInput,
  sudoPolicyText: string,
  groups: Map<string, Set<string>>,
  issues: LinuxQualityIssue[]
) {
  const simulation = input.simulation as LinuxSimulationWorld | undefined;
  if (!simulation?.commands || !simulation.identities) return;
  for (const command of simulation.commands.filter((item) => item.expectedRenderTargets?.includes("sudo"))) {
    const actor = simulation.identities.find((item) => item.id === command.actorIdentityId);
    const target = simulation.identities.find((item) => item.id === (command.runAsIdentityId || "identity:root"));
    if (!actor) continue;
    const decision = resolveSudoPolicy({
      sudoPolicyText,
      username: actor.username,
      targetUser: target?.username || "root",
      commandText: sudoCommandText(command),
      groups: groupsForUser(groups, actor.username),
    });
    if (decision.status === "denied") {
      issue(
        issues,
        "critical",
        "sudo_audit",
        `Canonical sudo command ${command.id} has no matching rendered sudoers policy.`,
        "assets/configs/sudoers.d/platform",
        undefined,
        sudoCommandText(command)
      );
    }
  }
}

function checkAuthLogSudoPolicyContradictions(
  input: QualityInput,
  sudoPolicyText: string,
  groups: Map<string, Set<string>>,
  issues: LinuxQualityIssue[]
) {
  const auth = assetByPath(input.assets, "assets/logs/auth.log");
  if (!auth) return;
  auth.content.split(/\r?\n/).forEach((line, index) => {
    if (!/\bsudo\b/i.test(line) || !/authentication failure/i.test(line)) return;
    const user = line.match(/\bsudo:\s+([a-z0-9._-]+)\s*:/i)?.[1] ||
      line.match(/\b(?:ruser|logname|user)=([a-z0-9._-]+)/i)?.[1];
    const command = line.match(/\bCOMMAND=(.+)$/i)?.[1]?.trim();
    if (!user || !command) return;
    const decision = resolveSudoPolicy({
      sudoPolicyText,
      username: user,
      targetUser: "root",
      commandText: command,
      groups: groupsForUser(groups, user),
    });
    if (decision.status === "permitted_nopasswd") {
      issue(
        issues,
        "critical",
        "sudo_audit",
        `NOPASSWD sudo command by ${user} is contradicted by auth.log authentication failure.`,
        auth.file_path,
        index + 1,
        line.trim()
      );
    }
  });
}

function checkTimelineSudoPolicyContradictions(
  input: QualityInput,
  sudoPolicyText: string,
  groups: Map<string, Set<string>>,
  issues: LinuxQualityIssue[]
) {
  const timeline = assetByPath(input.assets, "assets/evidence/timeline.csv");
  const simulation = input.simulation as LinuxSimulationWorld | undefined;
  if (!timeline || !simulation?.commands || !simulation.identities) return;
  const rows = timeline.content.split(/\r?\n/);
  rows.forEach((line, index) => {
    if (!/\b(?:authentication failure|password prompt|bad password|password failed)\b/i.test(line)) return;
    for (const command of simulation.commands.filter((item) => item.expectedRenderTargets?.includes("sudo"))) {
      const actor = simulation.identities.find((item) => item.id === command.actorIdentityId);
      const target = simulation.identities.find((item) => item.id === (command.runAsIdentityId || "identity:root"));
      if (!actor) continue;
      const commandText = sudoCommandText(command);
      if (!line.includes(commandText) && !line.includes(commandText.split(/\s+/).slice(-2).join(" "))) continue;
      const decision = resolveSudoPolicy({
        sudoPolicyText,
        username: actor.username,
        targetUser: target?.username || "root",
        commandText,
        groups: groupsForUser(groups, actor.username),
      });
      if (decision.status === "permitted_nopasswd") {
        issue(
          issues,
          "critical",
          "sudo_audit",
          `Timeline describes password authentication failure for NOPASSWD sudo command by ${actor.username}.`,
          timeline.file_path,
          index + 1,
          line.trim()
        );
      }
    }
  });
}

function checkSudoersModes(assets: LabAsset[], issues: LinuxQualityIssue[]) {
  const permissions = assetByPath(assets, "assets/reports/permissions_report.txt");
  if (!permissions) return;
  permissions.content.split(/\r?\n/).forEach((line, index) => {
    if (!/\/etc\/sudoers(?:\.d\/[A-Za-z0-9._-]+)?\s/.test(line)) return;
    const parts = line.trim().split(/\s+/);
    const mode = parts[1] || "";
    const bits = permissionStringToBits(mode);
    if (bits === null) return;
    if ((bits & 0o022) !== 0 || (bits & 0o111) !== 0) {
      issue(
        issues,
        "critical",
        "sudo_audit",
        "sudoers policy file mode is writable/executable enough that sudo may reject or distrust it.",
        permissions.file_path,
        index + 1,
        line.trim()
      );
    } else if (bits !== 0o440 && bits !== 0o400) {
      issue(
        issues,
        "high",
        "sudo_audit",
        "sudoers policy file mode is outside the expected secure 0440/0400 range.",
        permissions.file_path,
        index + 1,
        line.trim()
      );
    }
  });
}

function checkSudoInventoryContradictions(
  assets: LabAsset[],
  rules: SudoRule[],
  groups: Map<string, Set<string>>,
  issues: LinuxQualityIssue[]
) {
  const usersCsv = assetByPath(assets, "assets/csv/users.csv");
  if (!usersCsv) return;
  const rows = usersCsv.content.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const header = rows[0] || [];
  const userIndex = header.indexOf("username");
  const sudoIndex = header.indexOf("sudo_access");
  if (userIndex < 0 || sudoIndex < 0) return;

  for (const row of rows.slice(1)) {
    const username = row[userIndex];
    const sudoAccess = row[sudoIndex];
    if (!username || sudoAccess !== "no") continue;
    const hasRule = rules.some((rule) => {
      if (rule.subject === "ALL") return true;
      if (rule.group) return groups.get(rule.subject)?.has(username);
      return rule.subject === username;
    });
    if (hasRule) {
      issue(
        issues,
        "critical",
        "sudo_audit",
        `users.csv says ${username} has sudo_access=no but sudoers grants effective access.`,
        usersCsv.file_path,
        undefined,
        username
      );
    }
  }
}

function collectGroupMembers(assets: LabAsset[]) {
  const groups = new Map<string, Set<string>>();
  const add = (group: string, members: string) => {
    if (!groups.has(group)) groups.set(group, new Set<string>());
    members.split(",").map((item) => item.trim()).filter(Boolean).forEach((member) => groups.get(group)?.add(member));
  };

  const csv = assetByPath(assets, "assets/csv/groups.csv");
  if (csv) {
    csv.content.split(/\r?\n/).forEach((line, index) => {
      if (index === 0 || !line.trim()) return;
      const [group = "", members = ""] = parseCsvLine(line);
      if (group) add(group, members);
    });
  }

  const groupSample = assetByPath(assets, "assets/accounts/group.sample");
  if (groupSample) {
    groupSample.content.split(/\r?\n/).forEach((line) => {
      const [group, , , members = ""] = line.split(":");
      if (group) add(group, members);
    });
  }

  return groups;
}

function collectUsersCsvRows(assets: LabAsset[]) {
  const users = new Map<string, Record<string, string>>();
  const csv = assetByPath(assets, "assets/csv/users.csv");
  if (!csv) return users;
  const rows = csv.content.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const header = rows[0] || [];
  rows.slice(1).forEach((row) => {
    const username = row[header.indexOf("username")];
    if (!username) return;
    users.set(username, Object.fromEntries(header.map((key, index) => [key, row[index] || ""])));
  });
  return users;
}

function collectPasswdRows(assets: LabAsset[]) {
  const users = new Map<string, { uid: string; gid: string; home: string; shell: string; line: string }>();
  const passwd = assetByPath(assets, "assets/accounts/passwd.sample");
  if (!passwd) return users;
  passwd.content.split(/\r?\n/).forEach((line) => {
    const [username, , uid, gid, , home, shell] = line.split(":");
    if (username && uid) users.set(username, { uid, gid, home, shell, line });
  });
  return users;
}

function checkIdentityInventoryConsistency(input: QualityInput, issues: LinuxQualityIssue[]) {
  const usersCsv = collectUsersCsvRows(input.assets);
  const passwd = collectPasswdRows(input.assets);
  const knownUids = new Set(["0", ...[...usersCsv.values()].map((row) => row.uid).filter(Boolean), ...[...passwd.values()].map((row) => row.uid)]);
  const audit = assetByPath(input.assets, "assets/logs/audit.log");
  if (audit) {
    audit.content.split(/\r?\n/).forEach((line, index) => {
      if (!/type=USER_CMD/i.test(line)) return;
      const auid = line.match(/\bauid=(\d+)/)?.[1];
      if (auid && !knownUids.has(auid)) {
        issue(issues, "critical", "identity", `Audit USER_CMD auid ${auid} does not resolve to a rendered user.`, audit.file_path, index + 1, line.trim());
      }
    });
  }
  const csvGroups = assetByPath(input.assets, "assets/csv/groups.csv");
  const groupSample = assetByPath(input.assets, "assets/accounts/group.sample");
  const csvMembers = new Map<string, Set<string>>();
  const sampleMembers = new Map<string, Set<string>>();
  const addMembers = (target: Map<string, Set<string>>, group: string, members: string) => {
    if (!target.has(group)) target.set(group, new Set<string>());
    members.split(",").map((item) => item.trim()).filter(Boolean).forEach((member) => target.get(group)?.add(member));
  };

  if (csvGroups) {
    csvGroups.content.split(/\r?\n/).forEach((line, index) => {
      if (index === 0 || !line.trim()) return;
      const [group = "", members = ""] = parseCsvLine(line);
      if (group) addMembers(csvMembers, group, members);
    });
  }
  if (groupSample) {
    groupSample.content.split(/\r?\n/).forEach((line) => {
      const [group, , , members = ""] = line.split(":");
      if (group) addMembers(sampleMembers, group, members);
    });
  }

  usersCsv.forEach((row, username) => {
    const passwdRow = passwd.get(username);
    if (!passwdRow) return;
    if (row.uid && row.uid !== passwdRow.uid) {
      issue(issues, "critical", "identity", `users.csv UID for ${username} disagrees with passwd.sample.`, "assets/csv/users.csv", undefined, `${row.uid} <> ${passwdRow.uid}`);
    }
    if (row.gid && row.gid !== passwdRow.gid) {
      issue(issues, "critical", "identity", `users.csv GID for ${username} disagrees with passwd.sample.`, "assets/csv/users.csv", undefined, `${row.gid} <> ${passwdRow.gid}`);
    }
    if (row.home_directory && row.home_directory !== passwdRow.home) {
      issue(issues, "high", "identity", `users.csv home directory for ${username} disagrees with passwd.sample.`, "assets/csv/users.csv", undefined, `${row.home_directory} <> ${passwdRow.home}`);
    }
    if (row.shell && row.shell !== passwdRow.shell) {
      issue(issues, "critical", "identity", `users.csv shell for ${username} disagrees with passwd.sample.`, "assets/csv/users.csv", undefined, `${row.shell} <> ${passwdRow.shell}`);
    }
  });

  const sudoGroups = new Set(collectSudoRules(input.assets).filter((rule) => rule.group).map((rule) => rule.subject));
  if (csvGroups && groupSample) for (const group of sudoGroups) {
    if (!csvMembers.has(group) || !sampleMembers.has(group)) {
      issue(issues, "critical", "identity", `Sudoers references group ${group} that is missing from one rendered group inventory.`, "assets/csv/groups.csv", undefined, group);
    }
  }
  for (const [group, members] of csvMembers) {
    if (!sudoGroups.has(group)) continue;
    const sample = sampleMembers.get(group);
    if (!sample) continue;
    const relevantMembers = new Set([
      input.context?.primaryUser,
      ...(input.context?.adminAccounts || []),
      ...(input.context?.serviceAccounts || []),
    ].filter(Boolean) as string[]);
    const csvOnly = [...members].filter((member) => relevantMembers.has(member) && !sample.has(member));
    const sampleOnly = [...sample].filter((member) => relevantMembers.has(member) && !members.has(member));
    if (csvOnly.length > 0 || sampleOnly.length > 0) {
      issue(
        issues,
        "critical",
        "identity",
        `Group ${group} membership differs between groups.csv and group.sample.`,
        "assets/csv/groups.csv",
        undefined,
        `csv_only=${csvOnly.join(",") || "none"} sample_only=${sampleOnly.join(",") || "none"}`
      );
    }
  }
}

function collectSudoRules(assets: LabAsset[]) {
  const rules: SudoRule[] = [];
  let sudoAssets = assets.filter((asset) =>
    /(?:^|\/)sudoers(?:\.d\/|$)|\/sudoers\.d\//i.test(asset.file_path)
  );
  if (sudoAssets.length === 0) {
    sudoAssets = assets.filter((asset) => /linux_config_pack\.txt$/i.test(asset.file_path) && /# sudoers\.sample/i.test(asset.content));
  }

  for (const asset of sudoAssets) {
    asset.content.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || /^Defaults\b/i.test(line)) return;
      const match = line.match(/^(%?)([a-z0-9._-]+)\s+(?:[A-Z0-9_.-]+|ALL)\s*=\s*\(([^)]+)\)\s*(?:NOPASSWD:\s*)?(.+)$/i);
      if (!match) return;
      const [, groupPrefix, subject, runAs, commandList] = match;
      rules.push({
        subject,
        group: groupPrefix === "%",
        runAs,
        commands: splitSudoCommands(commandList),
        source: asset.file_path,
      });
    });
  }

  return rules;
}

function splitSudoCommands(commandList: string) {
  return commandList
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sudoCommandAllowed(
  user: string,
  runAs: string,
  command: string,
  rules: SudoRule[],
  groups: Map<string, Set<string>>
) {
  return rules.some((rule) => {
    const subjectMatches = rule.group
      ? groups.get(rule.subject)?.has(user)
      : rule.subject === user || rule.subject === "ALL";
    if (!subjectMatches) return false;
    if (!sudoRunAsMatches(rule.runAs, runAs)) return false;
    return rule.commands.some((allowed) => sudoCommandMatches(allowed, command));
  });
}

function sudoRunAsMatches(ruleRunAs: string, actualRunAs: string) {
  const normalized = ruleRunAs.replace(/:ALL/g, "").trim();
  return normalized === "ALL" || normalized === actualRunAs || normalized.split(/[:,\s]+/).includes(actualRunAs);
}

function normalizeSudoCommand(command: string) {
  return command
    .replace(/^\/usr\/bin\//, "")
    .replace(/^\/bin\//, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCommand(command: string) {
  return normalizeSudoCommand(command)
    .replace(/^sudo\s+/, "")
    .replace(/^apt-get\s+/, "apt ")
    .trim();
}

function incidentCommandVariants(input: QualityInput) {
  const command = input.context?.suspiciousCommands[0];
  if (!command) return [];
  const variants = new Set<string>([command]);
  const canonicalCommand = input.simulation?.commands?.find((item) => item.kind === "primary_incident")?.renderedCommand;
  if (canonicalCommand) variants.add(canonicalCommand);
  if (input.context?.primaryUser) {
    const home = `/home/${input.context.primaryUser}`;
    variants.add(command.replace("~/.ssh/authorized_keys", `${home}/.ssh/authorized_keys`));
    variants.add(resolveLinuxShellCommand(command, { workingDirectory: home, invokingHomeDirectory: home }).renderedCommand);
  }
  return [...variants].filter(Boolean);
}

function sudoCommandMatches(allowed: string, actual: string) {
  const normalizedAllowed = normalizeSudoCommand(allowed);
  const normalizedActual = normalizeSudoCommand(actual);
  if (normalizedAllowed === "ALL") return true;
  if (normalizedAllowed.endsWith(" *")) {
    return normalizedActual.startsWith(normalizedAllowed.slice(0, -2));
  }
  return normalizedAllowed === normalizedActual || normalizedActual.startsWith(`${normalizedAllowed} `);
}

function checkDaemonRealism(input: QualityInput, issues: LinuxQualityIssue[]) {
  const webStyle = /\b(?:GET|POST|PUT|DELETE|HEAD)\s+\/[^\s"]*\s+HTTP\/|"\b(?:GET|POST)\s+\/|GET\s+\/health\s+200/i;
  const forbiddenHttpDaemon = /\b(?:apt-daily\.service|rsyslogd|NetworkManager|cron|CRON|sshd|systemd)\[\d+\]:/i;

  for (const asset of input.assets) {
    const allowWebFile = /web_access|access_gateway|nginx|apache|proxy/i.test(asset.file_path);
    asset.content.split(/\r?\n/).forEach((line, index) => {
      if (!allowWebFile && webStyle.test(line) && forbiddenHttpDaemon.test(line)) {
        issue(
          issues,
          "high",
          "daemon_realism",
          "Non-web daemon emitted web-style HTTP access log vocabulary.",
          asset.file_path,
          index + 1,
          line.trim()
        );
      }
      if (/\bNetworkManager\[\d+\]:.*health check completed for ssh/i.test(line)) {
        issue(
          issues,
          "medium",
          "daemon_realism",
          "NetworkManager emitted SSH health-check vocabulary.",
          asset.file_path,
          index + 1,
          line.trim()
        );
      }
    });
  }
}

function roleKind(role: string) {
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

function hostRole(input: QualityInput) {
  if (input.context) return input.context.hostRole;
  const metadata = assetByPath(input.assets, "assets/inventory/host_metadata.json");
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata.content) as { role?: string };
    return parsed.role || null;
  } catch {
    return null;
  }
}

function serviceRoleModel(input: QualityInput) {
  const simulation = input.simulation as LinuxSimulationWorld | undefined;
  if (simulation?.services?.length) {
    try {
      return {
        primary: canonicalPrimaryService(simulation).unitName.toLowerCase(),
        secondary: new Set(canonicalSecondaryServices(simulation).map((service) => service.unitName.toLowerCase())),
        background: new Set(canonicalBackgroundServices(simulation).map((service) => service.unitName.toLowerCase())),
      };
    } catch {
      return {
        primary: input.context?.affectedService?.toLowerCase() || "",
        secondary: new Set<string>(),
        background: new Set<string>(),
      };
    }
  }
  return {
    primary: input.context?.affectedService?.toLowerCase() || "",
    secondary: new Set<string>(),
    background: new Set<string>(),
  };
}

function serviceMentionRole(input: QualityInput, service: string) {
  const model = serviceRoleModel(input);
  const normalized = service.toLowerCase();
  if (normalized === model.primary) return "primary";
  if (model.secondary.has(normalized)) return "secondary";
  if (model.background.has(normalized)) return "background";
  return "unknown";
}

function checkRoleLeakage(input: QualityInput, issues: LinuxQualityIssue[]) {
  const role = hostRole(input);
  if (!role) return;
  const kind = roleKind(role);
  const joined = input.assets.map((asset) => `${asset.file_path}\n${asset.content}`).join("\n");
  const incident = input.context?.incidentFamily;
  const allowedByIncident = new Set<string>();
  if (incident === "reverse_shell") allowedByIncident.add("web");
  if (incident === "docker_compromise") allowedByIncident.add("container");
  if (["service_account_misuse", "data_staging"].includes(incident || "")) allowedByIncident.add("backup");

  const checks: Array<[string, RegExp, string[]]> = [
    ["web", /\/var\/www|\/etc\/nginx|\/etc\/apache2|wordpress|apache2\.service|nginx\.service/i, ["web"]],
    ["database", /\/var\/lib\/postgresql|postgresql\.service|pgbouncer\.service|mysql\.service|\/var\/lib\/mysql/i, ["database"]],
    ["container", /\/var\/lib\/docker|\/var\/run\/docker\.sock|kubelet\.service|containerd\.service|kube-proxy/i, ["container", "platform"]],
    ["mail", /postfix\.service|rspamd\.service|opendkim\.service|\/etc\/postfix/i, ["mail"]],
    ["dns", /bind9\.service|\/etc\/bind|named\.conf/i, ["dns"]],
  ];

  for (const [label, pattern, allowedRoles] of checks) {
    if (pattern.test(joined) && !allowedRoles.includes(kind) && !allowedByIncident.has(label)) {
      issue(
        issues,
        "high",
        "role_leakage",
        `${label} role artifact appears on ${role} without incident justification.`,
        undefined,
        undefined,
        joined.match(pattern)?.[0]
      );
    }
  }
}

function checkCanonicalServiceRoles(input: QualityInput, issues: LinuxQualityIssue[]) {
  const simulation = input.simulation as LinuxSimulationWorld | undefined;
  if (!simulation?.services?.length) return;
  const primary = simulation.services.filter((service) => service.role === "primary");
  if (primary.length !== 1) {
    issue(issues, "critical", "service_model", `Canonical service model has ${primary.length} primary services.`, undefined, undefined, primary.map((service) => service.unitName).join(",") || "none");
    return;
  }
  const invalid = simulation.services.find((service) => !["primary", "secondary", "background"].includes(service.role));
  if (invalid) {
    issue(issues, "critical", "service_model", "Canonical service has invalid service role.", undefined, undefined, invalid.unitName);
  }
  const primaryService = primary[0];
  const rendered = input.assets.map((asset) => `${asset.file_path}\n${asset.content}`).join("\n");
  if (!rendered.includes(primaryService.unitName)) {
    issue(issues, "critical", "service_model", "Canonical primary service is absent from rendered evidence.", undefined, undefined, primaryService.unitName);
  }
  const learnerText = collectGeneratedText(input);
  if (learnerText) {
    for (const service of simulation.services.filter((item) => item.role === "background")) {
      const promotionPattern = new RegExp(`\\b(?:centres?|centers?|focused\\s+on|focus(?:es)?\\s+on|about|root cause|caused by)\\b[^.\\n]*\\b${escapeRegExp(service.unitName)}\\b`, "i");
      if (promotionPattern.test(learnerText)) {
        issue(issues, "critical", "service_model", "Generated narrative promotes a background service into the incident focus.", undefined, undefined, service.unitName);
      }
    }
    const finalNarrativeText = input.lab
      ? `${input.lab.title || ""}\n${input.lab.subtitle || ""}\n${input.lab.objective || ""}\n${input.lab.scenario || ""}\n${(input.lab.tasks || []).map((task) => `${task.title || ""} ${task.description || ""} ${task.deliverable || ""}`).join("\n")}`
      : "";
    if (finalNarrativeText) {
      const knownServices = new Set(simulation.services.map((service) => service.unitName.toLowerCase()));
      for (const match of finalNarrativeText.matchAll(/\b[a-z0-9@_.-]+\.service\b/gi)) {
        const service = match[0];
        if (!knownServices.has(service.toLowerCase())) {
          issue(issues, "critical", "service_model", "Generated narrative promotes a service that is not rendered in the canonical service inventory.", undefined, undefined, service);
        }
      }
    }
  }
}

type RenderedServiceInventoryRow = {
  lineNumber: number;
  service: string;
  status: string;
  startup: string;
  notes: string;
  loadState: string;
  activeState: string;
  subState: string;
  result: string;
  mainPid: string;
  unitPath: string;
  raw: string;
};

function serviceInventoryRows(asset: LabAsset | undefined) {
  if (!asset) return [];
  const lines = asset.content.split(/\r?\n/).filter((line) => line.trim());
  const header = parseCsvLine(lines[0] || "").map((item) => item.trim().toLowerCase());
  const index = (name: string, fallback: number) => {
    const found = header.indexOf(name);
    return found >= 0 ? found : fallback;
  };
  return lines.slice(1).map((line, offset): RenderedServiceInventoryRow => {
    const row = parseCsvLine(line);
    return {
      lineNumber: offset + 2,
      service: row[index("service", 0)] || "",
      status: row[index("status", 1)] || "",
      startup: row[index("startup", 2)] || "",
      notes: row[index("notes", 3)] || "",
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

function checkRenderedSystemdState(input: QualityInput, issues: LinuxQualityIssue[]) {
  const simulation = input.simulation as LinuxSimulationWorld | undefined;
  const serviceInventory = assetByPath(input.assets, "assets/reports/service_inventory.txt");
  const rows = serviceInventoryRows(serviceInventory);
  const rowByService = new Map(rows.map((row) => [row.service.toLowerCase(), row]));
  const processSnapshotAsset = assetByPath(input.assets, "assets/runtime/process_snapshot.txt");
  const processSnapshot = processSnapshotAsset?.content || "";
  const journal = assetByPath(input.assets, "assets/journal/journal_systemd.txt");
  const timeline = assetByPath(input.assets, "assets/evidence/timeline.csv");

  for (const row of rows) {
    if (row.loadState === "not-found" && (row.activeState !== "inactive" || row.startup === "enabled")) {
      issue(issues, "critical", "service_model", `service_inventory.txt renders not-found ${row.service} as ${row.startup}/${row.activeState}.`, serviceInventory?.file_path, row.lineNumber, row.raw);
    }
    if (row.startup === "masked" && row.loadState !== "masked") {
      issue(issues, "critical", "service_model", `service_inventory.txt renders masked ${row.service} with load state ${row.loadState}.`, serviceInventory?.file_path, row.lineNumber, row.raw);
    }
    if (row.activeState === "active" && row.subState === "dead") {
      issue(issues, "critical", "service_model", `service_inventory.txt renders impossible active/dead state for ${row.service}.`, serviceInventory?.file_path, row.lineNumber, row.raw);
    }
    if (row.activeState === "inactive" && row.subState === "running") {
      issue(issues, "critical", "service_model", `service_inventory.txt renders impossible inactive/running state for ${row.service}.`, serviceInventory?.file_path, row.lineNumber, row.raw);
    }
    if (row.activeState === "failed" && row.result === "success") {
      issue(issues, "critical", "service_model", `service_inventory.txt renders failed ${row.service} with success result.`, serviceInventory?.file_path, row.lineNumber, row.raw);
    }
    if (row.activeState !== "failed" && row.subState !== "failed" && !["", "none", "success"].includes(row.result)) {
      issue(issues, "critical", "service_model", `service_inventory.txt renders ${row.service} with failure result ${row.result} but non-failed state.`, serviceInventory?.file_path, row.lineNumber, row.raw);
    }
    if (row.activeState !== "active" && row.mainPid.trim()) {
      issue(issues, "critical", "service_model", `service_inventory.txt renders non-active ${row.service} with main PID ${row.mainPid}.`, serviceInventory?.file_path, row.lineNumber, row.raw);
    }
  }

  if (!simulation?.services?.length || !serviceInventory) return;

  for (const service of simulation.services) {
    const row = rowByService.get(service.unitName.toLowerCase());
    if (!row) {
      issue(issues, "critical", "service_model", `service_inventory.txt is missing canonical service ${service.unitName}.`, serviceInventory.file_path, undefined, service.unitName);
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
        issue(issues, "critical", "service_model", `service_inventory.txt ${field} for ${service.unitName} disagrees with canonical systemd state.`, serviceInventory.file_path, row.lineNumber, `expected=${expected || "(blank)"} actual=${actual || "(blank)"} row=${row.raw}`);
      }
    }
    if (processSnapshotAsset && service.activeState === "active" && service.subState === "running" && process && !processSnapshotContainsPid(processSnapshot, process.pid)) {
      issue(issues, "critical", "service_model", `process_snapshot.txt is missing main PID ${process.pid} for active/running ${service.unitName}.`, "assets/runtime/process_snapshot.txt", undefined, service.unitName);
    }
  }

  for (const transition of simulation.serviceTransitions || []) {
    const service = simulation.services.find((item) => item.id === transition.serviceId);
    if (!service) continue;
    const activityRef = `${service.unitName} ${transition.operation} at ${transition.occurredAt}`;
    const stateText = `state=${transition.resultingState.loadState}/${transition.resultingState.activeState}/${transition.resultingState.subState}`;
    if (journal && (!journal.content.includes(activityRef) || !journal.content.includes(stateText))) {
      issue(issues, "critical", "service_model", `journal_systemd.txt transition for ${service.unitName} does not match canonical resulting state.`, journal.file_path, undefined, `${activityRef} ${stateText}`);
    }
    if (timeline && !timeline.content.includes(activityRef)) {
      issue(issues, "critical", "timeline", `timeline.csv is missing canonical service transition ${activityRef}.`, timeline.file_path, undefined, activityRef);
    }
  }
}

function checkPermissions(input: QualityInput, issues: LinuxQualityIssue[]) {
  const permissions = assetByPath(input.assets, "assets/reports/permissions_report.txt");
  const audit = assetByPath(input.assets, "assets/logs/audit.log");
  const openFiles = assetByPath(input.assets, "assets/runtime/open_files.txt");
  if (!permissions) return;

  const seen = new Map<string, number>();
  const metadata = new Map<string, { mode: string; owner: string; group: string; raw: string }>();
  const uidByUser = collectUserUidMap(input.assets);
  const labelled = /^(?:BEFORE|AFTER|baseline|observed):/i;
  const deletedOpenPaths = new Set((input.simulation?.openFileDescriptors || [])
    .filter((descriptor) => descriptor.deleted && descriptor.targetPath)
    .map((descriptor) => descriptor.targetPath as string));
  for (const line of openFiles?.content.split(/\r?\n/) || []) {
    const match = line.match(/(\S+)\s+\(deleted\)\s*$/);
    if (match) deletedOpenPaths.add(match[1]);
  }
  permissions.content.split(/\r?\n/).forEach((line, index) => {
    const parts = line.trim().split(/\s+/);
    const path = parts[0];
    if (!path?.startsWith("/")) return;
    if (parts.length >= 4) {
      metadata.set(path, { mode: parts[1], owner: parts[2], group: parts[3], raw: line.trim() });
    }
    const prior = seen.get(path);
    if (prior && !labelled.test(line)) {
      issue(
        issues,
        "high",
        "permissions",
        `Duplicate permissions row for ${path}.`,
        permissions.file_path,
        index + 1,
        line.trim()
      );
    }
    seen.set(path, index + 1);
  });

  if (audit) {
    for (const match of audit.content.matchAll(/type=PATH .*?name="([^"]+)".*?ouid=(\d+)\s+ogid=(\d+)/gi)) {
      const [, filePath, uid, gid] = match;
      const item = metadata.get(filePath);
      if (!item) {
        if (deletedOpenPaths.has(filePath)) continue;
        issue(issues, "high", "permissions", `Audit PATH ${filePath} has no permissions_report row.`, audit.file_path, undefined, match[0]);
        continue;
      }
      const knownSystemOwners = new Set(["root", "syslog", "daemon", "messagebus", "systemd-network", "systemd-resolve", "www-data", "nobody"]);
      if (!uidByUser.has(item.owner) && !knownSystemOwners.has(item.owner)) {
        issue(issues, "critical", "permissions", `permissions_report.txt owner ${item.owner} is not a rendered user.`, permissions.file_path, undefined, item.raw);
      }
      if (item.owner === "root" && uid !== "0") {
        issue(issues, "high", "permissions", `Audit PATH owner for ${filePath} disagrees with root-owned permissions report.`, audit.file_path, undefined, match[0]);
      }
      if (item.group === "root" && gid !== "0") {
        issue(issues, "high", "permissions", `Audit PATH group for ${filePath} disagrees with root-owned permissions report.`, audit.file_path, undefined, match[0]);
      }
      const expectedUid = uidByUser.get(item.owner);
      if (expectedUid && uid !== expectedUid) {
        issue(issues, "critical", "permissions", `Audit PATH owner UID for ${filePath} disagrees with permissions_report.txt owner ${item.owner}.`, audit.file_path, undefined, match[0]);
      }
      const expectedGid = uidByUser.get(`${item.group}:gid`) || uidByUser.get(item.group);
      if (expectedGid && gid !== expectedGid) {
        issue(issues, "critical", "permissions", `Audit PATH group GID for ${filePath} disagrees with permissions_report.txt group ${item.group}.`, audit.file_path, undefined, match[0]);
      }
    }
    for (const match of audit.content.matchAll(/type=PATH .*?name="([^"]+)".*?mode=([0-7]{6,7})/gi)) {
      const [, filePath, auditMode] = match;
      const item = metadata.get(filePath);
      if (!item) continue;
      const permissionBits = permissionStringToBits(item.mode);
      const auditBits = Number.parseInt(auditMode.slice(-4), 8);
      if (permissionBits !== null && permissionBits !== auditBits) {
        issue(
          issues,
          "critical",
          "permissions",
          `Audit PATH mode for ${filePath} disagrees with permissions_report.txt.`,
          audit.file_path,
          undefined,
          `${auditMode} <> ${item.mode}`
        );
      }
    }
  }
}

function collectUserUidMap(assets: LabAsset[]) {
  const users = new Map<string, string>();
  const csv = assetByPath(assets, "assets/csv/users.csv");
  if (csv) {
    const rows = csv.content.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
    const header = rows[0] || [];
    const usernameIndex = header.indexOf("username");
    const uidIndex = header.indexOf("uid");
    const gidIndex = header.indexOf("gid");
    rows.slice(1).forEach((row) => {
      if (usernameIndex >= 0 && uidIndex >= 0 && row[usernameIndex]) users.set(row[usernameIndex], row[uidIndex]);
      if (usernameIndex >= 0 && gidIndex >= 0 && row[usernameIndex]) users.set(`${row[usernameIndex]}:gid`, row[gidIndex]);
    });
  }
  for (const asset of assets.filter((item) => /passwd\.sample$/.test(item.file_path))) {
    asset.content.split(/\r?\n/).forEach((line) => {
      const [username, , uid, gid] = line.split(":");
      if (username && uid) users.set(username, uid);
      if (username && gid) users.set(`${username}:gid`, gid);
    });
  }
  return users;
}

function permissionStringToBits(mode: string) {
  if (/^[0-7]{3,4}$/.test(mode)) return Number.parseInt(mode.slice(-4), 8);
  const match = mode.match(/^[dl-]([rwx-]{9})$/);
  if (!match) return null;
  const chars = match[1];
  let bits = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const bit = char === "r" ? 4 : char === "w" ? 2 : char === "x" || char === "s" || char === "t" ? 1 : 0;
    bits += bit << (3 * (2 - Math.floor(index / 3)));
  }
  return bits;
}

function checkTimeline(input: QualityInput, issues: LinuxQualityIssue[]) {
  const timeline = assetByPath(input.assets, "assets/evidence/timeline.csv");
  if (!timeline) return;
  const primaryEvidence = input.assets
    .filter((asset) =>
      [
        "assets/logs/auth.log",
        "assets/logs/sudo.log",
        "assets/logs/audit.log",
        "assets/journal/journal_systemd.txt",
        "assets/journal/journal_ssh.txt",
        "assets/logs/syslog",
        "assets/logs/cron.log",
        "assets/logs/apt_history.log",
      ].includes(asset.file_path)
    )
    .map((asset) => asset.content)
    .join("\n");

  const incidentOffsets: number[] = [];
  const collectedAt = input.simulation?.collection?.collectedAt;
  let previousTimestamp = "";
  const staticSources = new Set([
    "process_snapshot.txt",
    "open_files.txt",
    "permissions_report.txt",
    "service_inventory.txt",
    "linux_config_pack.txt",
    "sshd_config",
    "users.csv",
    "groups.csv",
    "passwd.sample",
    "group.sample",
    "security_policy.md",
    "change_request.md",
    "maintenance_ticket.md",
    "analyst_working_notes.md",
  ]);
  timeline.content.split(/\r?\n/).forEach((line, index) => {
    if (index === 0 || !line.trim()) return;
    const row = parseCsvLine(line);
    const hasEvidenceTypeColumn = row.length >= 5;
    const [time = "", summary = ""] = row;
    const evidenceType = hasEvidenceTypeColumn ? row[2] : "";
    const source = hasEvidenceTypeColumn ? row[3] : row[2] || "";
    const hasTypedTimelineSources = timeline.content.split(/\r?\n/)[0].includes("exact_sources");
    const exactSources = hasTypedTimelineSources ? row[7] || "" : source;
    const contextSources = row[8] || "";
    const staticTypedSources = row[9] || "";
    if (!/^(Observed|Inferred|Context|Background)$/.test(evidenceType)) {
      issue(issues, "high", "timeline", "Timeline row is missing explicit evidence type.", timeline.file_path, index + 1, line.trim());
    }
    if (previousTimestamp && time && time < previousTimestamp) {
      issue(issues, "critical", "timeline", "Timeline rows are not chronological.", timeline.file_path, index + 1, line.trim());
    }
    if (time) previousTimestamp = time;
    if (collectedAt && time && time > collectedAt) {
      issue(issues, "critical", "timeline", "Timeline event occurs after evidence collection time.", timeline.file_path, index + 1, `${time} > ${collectedAt}`);
    }
    if (!source.trim()) {
      issue(issues, "critical", "timeline", "Timeline row has blank source support.", timeline.file_path, index + 1, line.trim());
    }
    if ((evidenceType === "Observed" || evidenceType === "Background") && !exactSources.trim()) {
      issue(issues, "critical", "timeline", "Observed or background timeline row lacks exact source support.", timeline.file_path, index + 1, line.trim());
    }
    if (evidenceType === "Observed" && /\binferred|candidate|hypothesis|may\b/i.test(summary)) {
      issue(issues, "high", "timeline", "Inferred language is marked as Observed evidence.", timeline.file_path, index + 1, line.trim());
    }
    if (evidenceType === "Observed" && /\bincident window opened|case boundary|boundary reviewed\b/i.test(summary)) {
      issue(issues, "critical", "timeline", "Observed timeline row describes a case boundary instead of a directly logged event.", timeline.file_path, index + 1, line.trim());
    }
    if (/activity requiring investigation began|account authenticated or executed activity|service activity observed|event requires review|activity occurred|commands executed|user interacted/i.test(line)) {
      issue(issues, "high", "timeline", "Timeline uses generic generator wording.", timeline.file_path, index + 1, line.trim());
    }
    if (!/(\/|[a-z0-9._-]+\.service\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b(?:ssh|sudo|apt|dpkg|docker|systemctl|cron|crontab|ncat|auth\.log|journal|archive|package|publickey|password|PID|CHG-|INC-|TCKT-)\b)/i.test(line)) {
      issue(issues, "medium", "timeline", "Timeline row lacks concrete actor, path, service, command, package, PID, ticket, or IP detail.", timeline.file_path, index + 1, line.trim());
    }
    const timestamp = time.match(/\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2}:\d{2})/)?.[1];
    if (timestamp && input.context?.incidentTime && line.startsWith(input.context.incidentDate)) {
      incidentOffsets.push(clockSeconds(timestamp) - clockSeconds(input.context.incidentTime));
    }
    if (input.context && timestamp && evidenceType === "Observed" && !primaryEvidence.includes(timestamp) && !/window opened|\bopened\b|\bentered\b|review/i.test(line)) {
      issue(issues, "critical", "timeline", "Observed timeline timestamp does not appear in primary evidence.", timeline.file_path, index + 1, line.trim());
    }
    if (source) {
      const sourceNames = source.split(/[;|]/).map((item) => item.trim()).filter(Boolean);
      const exactSourceNames = exactSources.split(/[;|]/).map((item) => item.trim()).filter(Boolean);
      const dynamicSourceNames = sourceNames.filter((item) => !staticSources.has(item.split("/").pop() || item));
      if (timestamp && evidenceType === "Observed" && dynamicSourceNames.length === 0) {
        issue(issues, "high", "timeline", "Observed timeline row uses only static snapshot/config sources.", timeline.file_path, index + 1, line.trim());
      }
      let sourceAssets = parseDelimitedSourceAssets(input.assets, source);
      if (sourceAssets.length === 0 && exactSources) {
        sourceAssets = parseDelimitedSourceAssets(input.assets, exactSources);
      }
      if (sourceAssets.length === 0) {
        issue(issues, "high", "timeline", "Timeline source does not resolve to an evidence asset.", timeline.file_path, index + 1, source);
      } else if (timestamp && evidenceType === "Observed" && !/window opened|\bopened\b|\bentered\b|review/i.test(summary)) {
        const exactAssets = parseDelimitedSourceAssets(input.assets, exactSourceNames.join(";"));
        const supported = (exactAssets.length > 0 ? exactAssets : sourceAssets).some((asset) => {
          const basename = asset.file_path.split("/").pop() || asset.file_path;
          return !staticSources.has(basename) && asset.content.includes(timestamp);
        });
        if (!supported) {
          issue(
            issues,
            "critical",
            "timeline",
            "Observed timeline timestamp is not present in any referenced source asset.",
            timeline.file_path,
            index + 1,
            line.trim()
          );
        }
      }
      if ((contextSources || staticTypedSources) && !timeline.content.split(/\r?\n/)[0].includes("exact_sources")) {
        issue(issues, "medium", "timeline", "Typed timeline source support is present without typed source headers.", timeline.file_path, index + 1, line.trim());
      }
    }
  });
  const fingerprint = incidentOffsets.filter((offset) => offset > 0 && offset < 80).join(",");
  if (fingerprint.includes("11,22,33,40,55")) {
    issue(issues, "high", "timeline", "Timeline uses reused deterministic incident offset fingerprint.", timeline.file_path, undefined, fingerprint);
  }

}

function checkIncidentTimestampDrift(input: QualityInput, issues: LinuxQualityIssue[]) {
  const command = input.context?.suspiciousCommands[0];
  if (!command) return;
  const commandPatterns = incidentCommandVariants(input);
  const commandRegexes = Array.from(new Set(commandPatterns)).map(
    (pattern) => new RegExp(escapeRegExp(pattern).replace(/\\\s+/g, "\\s+"), "i")
  );
  const times: Array<{ source: string; timestamp: string }> = [];

  for (const asset of input.assets.filter((item) =>
    [
      "assets/logs/sudo.log",
      "assets/logs/audit.log",
      "assets/evidence/timeline.csv",
    ].includes(item.file_path)
  )) {
    asset.content.split(/\r?\n/).forEach((line) => {
      if (asset.file_path === "assets/evidence/timeline.csv") {
        const row = parseCsvLine(line);
        if (row[2] !== "Observed" || !commandPatterns.some((pattern) => normalizeCommand(row[1] || "") === normalizeCommand(pattern))) return;
      } else if (!commandRegexes.some((pattern) => pattern.test(line))) {
        return;
      }
      const match = line.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
      if (match) times.push({ source: asset.file_path, timestamp: match[1] });
    });
  }

  const uniqueTimes = Array.from(new Set(times.map((item) => item.timestamp)));
  if (times.length < 2) {
    issue(issues, "medium", "timeline", "Canonical suspicious command is not timestamped in at least two dynamic evidence sources.", undefined, undefined, command);
    return;
  }

  const epochMs = uniqueTimes.map(sourceNativeTimestampMs);
  const drift = Math.max(...epochMs) - Math.min(...epochMs);
  if (drift > 1000) {
    issue(
      issues,
      "high",
      "timeline",
      "Canonical suspicious command timestamp drifts by more than one second across evidence.",
      undefined,
      undefined,
      times.map((item) => `${item.source}:${item.timestamp}`).join(" | ")
    );
  }
}

function checkCanonicalIncidentTuple(input: QualityInput, issues: LinuxQualityIssue[]) {
  const context = input.context;
  const command = context?.suspiciousCommands[0];
  if (!context || !command) return;
  const rows: Array<{
    source: string;
    timestamp: string;
    actor?: string;
    actorUid?: string;
    tty?: string;
    cwd?: string;
    command: string;
  }> = [];
  const commandPatterns = incidentCommandVariants(input);
  const matchesCommand = (value: string) => commandPatterns.some((candidate) => normalizeCommand(value) === normalizeCommand(candidate));

  for (const source of ["assets/logs/auth.log", "assets/logs/sudo.log"]) {
    const asset = assetByPath(input.assets, source);
    if (!asset) continue;
    asset.content.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}).*?\bsudo:\s+([a-z0-9._-]+)\s+:\s+TTY=([^;]+)\s+;\s+PWD=([^;]+)\s+;\s+USER=[^;]+;\s+COMMAND=(.+)$/i)
        || line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([a-z0-9._-]+)\s+:\s+TTY=([^;]+)\s+;\s+PWD=([^;]+)\s+;\s+USER=[^;]+;\s+COMMAND=(.+)$/i);
      if (!match) return;
      const [, date, time, actor, tty, cwd, renderedCommand] = match;
      if (!matchesCommand(renderedCommand)) return;
      rows.push({ source, timestamp: `${date} ${time}`, actor, tty: tty.trim(), cwd: cwd.trim(), command: renderedCommand.trim() });
    });
  }

  const syslog = assetByPath(input.assets, "assets/logs/syslog");
  if (syslog) {
    syslog.content.split(/\r?\n/).forEach((line) => {
      if (!matchesCommand(line.replace(/^.*?\baudit\[\d+\]:\s+/, ""))) return;
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
      rows.push({
        source: "assets/logs/syslog",
        timestamp: match ? `${match[1]} ${match[2]}` : "",
        command,
      });
    });
  }

  const audit = assetByPath(input.assets, "assets/logs/audit.log");
  if (audit) {
    audit.content.split(/\r?\n/).forEach((line) => {
      if (!/type=(?:USER_CMD|EXECVE)/.test(line)) return;
      const commandMatch = line.match(/cmd="([^"]+)"/);
      if (!commandMatch || !matchesCommand(commandMatch[1])) return;
      const timeMatch = line.match(/audit\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\)/);
      const cwdMatch = line.match(/cwd="([^"]+)"/);
      const ttyMatch = line.match(/\btty=([^\s]+)/);
      const auidMatch = line.match(/\bauid=(\d+)/);
      rows.push({
        source: "assets/logs/audit.log",
        timestamp: timeMatch ? `${timeMatch[1]} ${timeMatch[2]}` : "",
        tty: ttyMatch?.[1],
        cwd: cwdMatch?.[1],
        actorUid: auidMatch?.[1],
        command: commandMatch[1],
      });
    });
  }

  const timeline = assetByPath(input.assets, "assets/evidence/timeline.csv");
  if (timeline) {
    timeline.content.split(/\r?\n/).slice(1).forEach((line) => {
      const row = parseCsvLine(line);
      if (row[2] !== "Observed" || !matchesCommand(row[1] || "")) return;
      rows.push({ source: "assets/evidence/timeline.csv", timestamp: row[0] || "", command: row[1] || "" });
    });
  }

  if (rows.length < 3) {
    issue(issues, "critical", "identity", "Canonical incident command tuple is not rendered in enough dynamic artefacts.", undefined, undefined, command);
    return;
  }

  const timestamps = new Set(rows.map((row) => row.timestamp).filter(Boolean));
  if (timestamps.size > 1) {
    issue(issues, "critical", "identity", "Canonical incident command has conflicting timestamps across artefacts.", undefined, undefined, rows.map((row) => `${row.source}:${row.timestamp}`).join(" | "));
  }
  const actors = new Set(rows.map((row) => row.actor).filter(Boolean));
  if (actors.size > 1) {
    issue(issues, "critical", "identity", "Canonical incident command has conflicting actors across artefacts.", undefined, undefined, rows.map((row) => `${row.source}:${row.actor}`).join(" | "));
  }
  const ttys = new Set(rows.map((row) => row.tty).filter(Boolean));
  if (ttys.size > 1) {
    issue(issues, "critical", "identity", "Canonical incident command has conflicting TTY values across artefacts.", undefined, undefined, rows.map((row) => `${row.source}:${row.tty}`).join(" | "));
  }
  const cwds = new Set(rows.map((row) => row.cwd).filter(Boolean));
  if (cwds.size > 1) {
    issue(issues, "critical", "identity", "Canonical incident command has conflicting working directories across artefacts.", undefined, undefined, rows.map((row) => `${row.source}:${row.cwd}`).join(" | "));
  }
  const auth = assetByPath(input.assets, "assets/logs/auth.log");
  const closeTimes: string[] = [];
  if (auth) {
    auth.content.split(/\r?\n/).forEach((line) => {
      if (!line.includes(context.primaryUser) || !/session closed|Disconnected|Connection closed/i.test(line)) return;
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
      if (match) closeTimes.push(`${match[1]} ${match[2]}`);
    });
  }
  const closeTime = closeTimes.sort().at(-1);
  if (closeTime) {
    for (const row of rows.filter((item) => item.source !== "assets/evidence/timeline.csv")) {
      if (row.timestamp && row.timestamp > closeTime) {
        issue(issues, "high", "timeline", "Canonical command is timestamped after the SSH session close.", undefined, undefined, `${row.source}:${row.timestamp} > ${closeTime}`);
      }
    }
  }
}

function checkProcessOpenFiles(input: QualityInput, issues: LinuxQualityIssue[]) {
  const auditLog = assetByPath(input.assets, "assets/logs/audit.log");
  const processSnapshot = assetByPath(input.assets, "assets/runtime/process_snapshot.txt");
  const openFiles = assetByPath(input.assets, "assets/runtime/open_files.txt");
  const processHistory = assetByPath(input.assets, "assets/runtime/process_execution_history.txt");
  const fileAccessHistory = assetByPath(input.assets, "assets/runtime/file_access_history.csv");
  if (!auditLog || !processSnapshot || !openFiles) return;
  if (!/^# .*evidence_type=live_process_snapshot/m.test(processSnapshot.content)) {
    issue(issues, "critical", "process_open_files", "process_snapshot.txt does not declare live process snapshot semantics.", processSnapshot.file_path, 1, processSnapshot.content.split(/\r?\n/)[0]);
  }
  if (!/^# .*evidence_type=live_open_file_snapshot/m.test(openFiles.content)) {
    issue(issues, "critical", "process_open_files", "open_files.txt does not declare live open-file snapshot semantics.", openFiles.file_path, 1, openFiles.content.split(/\r?\n/)[0]);
  }
  if (processHistory && (!processHistory.content.split(/\r?\n/)[0].startsWith("evidence_type,state_type,") || !processHistory.content.includes("historical_process_correlation"))) {
    issue(issues, "critical", "process_open_files", "process_execution_history.txt does not declare historical process semantics.", processHistory.file_path, 1, processHistory.content.split(/\r?\n/)[0]);
  }
  if (fileAccessHistory && (!fileAccessHistory.content.split(/\r?\n/)[0].startsWith("evidence_type,state_type,") || !fileAccessHistory.content.includes("historical_file_access"))) {
    issue(issues, "critical", "process_open_files", "file_access_history.csv does not declare historical file-access semantics.", fileAccessHistory.file_path, 1, fileAccessHistory.content.split(/\r?\n/)[0]);
  }
  const processKeys = new Set<string>();
  const processesByPid = new Map<string, { user: string; ppid: string; command: string; startedAt?: string; line: string }>();
  processSnapshot.content.split(/\r?\n/).forEach((line, index) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4 || !/^\d+$/.test(parts[1] || "")) return;
    const process = {
      user: parts[0],
      ppid: parts[2],
      command: parts.slice(3).join(" "),
      startedAt: line.match(/\bstarted=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\b/)?.[1],
      line: line.trim(),
    };
    const key = `${parts[0]}:${parts[1]}:${parts[2]}:${parts.slice(3).join(" ")}`;
    if (processKeys.has(key)) {
      issue(issues, "critical", "process_open_files", "Duplicate process snapshot entry.", processSnapshot.file_path, index + 1, line.trim());
    }
    const existing = processesByPid.get(parts[1]);
    if (existing && `${existing.user}:${existing.ppid}:${existing.command}` !== `${process.user}:${process.ppid}:${process.command}`) {
      issue(
        issues,
        "critical",
        "process_open_files",
        `PID ${parts[1]} has conflicting process snapshot identities.`,
        processSnapshot.file_path,
        index + 1,
        line.trim()
      );
    }
    processesByPid.set(parts[1], process);
    processKeys.add(key);
  });
  processesByPid.forEach((process, pid) => {
    if (process.ppid !== "0" && process.ppid !== "1" && !processesByPid.has(process.ppid)) {
      issue(
        issues,
        "critical",
        "process_open_files",
        `PID ${pid} references missing PPID ${process.ppid}.`,
        processSnapshot.file_path,
        undefined,
        process.line
      );
    }
  });
  processesByPid.forEach((process, pid) => {
    const parent = processesByPid.get(process.ppid);
    if (!parent || parent.user === process.user) return;
    if (process.ppid === "1") return;
    const transition = /\bsshd\b|\bsudo\b|\bsu\b|setuid|runuser|systemd|apache2|nginx|dockerd|postfix|master -w/.test(parent.command) || /\bsudo\b|\bsu\b|setuid|runuser/.test(process.command);
    if (!transition) {
      issue(
        issues,
        "critical",
        "process_open_files",
        `PID ${pid} user ${process.user} is a direct child of ${parent.user} without an explicit identity transition.`,
        processSnapshot.file_path,
        undefined,
        `${parent.line} -> ${process.line}`
      );
    }
  });

  processesByPid.forEach((process, pid) => {
    if (/^(?:\/usr\/bin\/)?sudo(?:\s|$)/i.test(process.command) && /\b(?:cat|systemctl|apt|truncate|logrotate|docker)\b/i.test(process.command.replace(/^(?:\/usr\/bin\/)?sudo\b/i, ""))) {
      const childForPid = [...processesByPid.values()].some((candidate) => candidate.ppid === pid);
      if (!childForPid) {
        issue(
          issues,
          "critical",
          "process_open_files",
          `PID ${pid} collapses sudo and child command without a separate child process.`,
          processSnapshot.file_path,
          undefined,
          process.line
        );
      }
    }
  });

  const openFileRows = new Set<string>();
  const openFdRows = new Set<string>();
  openFiles.content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || /^COMMAND\s+PID\s+/i.test(trimmed)) return;
    if (openFileRows.has(trimmed)) {
      issue(issues, "high", "process_open_files", "Duplicate open_files row.", openFiles.file_path, index + 1, trimmed);
    }
    openFileRows.add(trimmed);
    const parts = trimmed.split(/\s+/);
    const [command = "", pid = "", user = ""] = parts;
    if (!/^\d+$/.test(pid)) return;
    const fd = parts.length >= 8 && /^\d{4}-\d{2}-\d{2}$/.test(parts[6] || "") ? parts[3] : "";
    const descriptorType = parts.length >= 8 && /^\d{4}-\d{2}-\d{2}$/.test(parts[6] || "") ? parts[4] : "";
    const openedAt = parts.length >= 8 && /^\d{4}-\d{2}-\d{2}$/.test(parts[6] || "") ? `${parts[6]} ${parts[7]}` : "";
    const target = parts.length >= 8 && /^\d{4}-\d{2}-\d{2}$/.test(parts[6] || "") ? parts.slice(8).join(" ") : parts.slice(3).join(" ");
    if (fd) {
      const fdKey = `${pid}:${fd}`;
      if (openFdRows.has(fdKey)) {
        issue(issues, "critical", "process_open_files", `Duplicate current open descriptor FD ${fd} for PID ${pid}.`, openFiles.file_path, index + 1, trimmed);
      }
      openFdRows.add(fdKey);
    }
    const process = processesByPid.get(pid);
    if (!process) {
      issue(issues, "high", "process_open_files", `open_files PID ${pid} is missing from process snapshot.`, openFiles.file_path, index + 1, trimmed);
      return;
    }
    if (user && user !== process.user && !(pid === "1" && user === "root")) {
      issue(
        issues,
        "high",
        "process_open_files",
        `open_files PID ${pid} user does not match process snapshot.`,
        openFiles.file_path,
        index + 1,
        trimmed
      );
    }
    if (openedAt && process.startedAt && openedAt < process.startedAt) {
      issue(issues, "critical", "process_open_files", `open_files PID ${pid} descriptor opens before process start.`, openFiles.file_path, index + 1, trimmed);
    }
    if (/deleted-regular-file/i.test(descriptorType) && !/\(deleted\)/.test(target)) {
      issue(issues, "critical", "process_open_files", "Deleted open-file descriptor lacks deleted marker.", openFiles.file_path, index + 1, trimmed);
    }
    if (/\(deleted\)/.test(target) && descriptorType && !/deleted-regular-file/i.test(descriptorType)) {
      issue(issues, "critical", "process_open_files", "Open-file row marks a target deleted without deleted descriptor type.", openFiles.file_path, index + 1, trimmed);
    }
    if (!openFileCommandMatchesProcess(command, process.command)) {
      issue(
        issues,
        "medium",
        "process_open_files",
        `open_files command ${command} does not match process snapshot PID ${pid}.`,
        openFiles.file_path,
        index + 1,
        `${trimmed} <> ${process.line}`
      );
    }
  });

  const historicalProcessPids = new Set<string>();
  processHistory?.content.split(/\r?\n/).slice(1).forEach((line) => {
    const row = parseCsvLine(line);
    const pid = row[5] || "";
    if (/^\d+$/.test(pid)) historicalProcessPids.add(pid);
  });
  fileAccessHistory?.content.split(/\r?\n/).slice(1).forEach((line, index) => {
    if (!line.trim()) return;
    const row = parseCsvLine(line);
    const pid = row[3] || "";
    if (!/^\d+$/.test(pid)) return;
    if (!processesByPid.has(pid) && !historicalProcessPids.has(pid)) {
      issue(
        issues,
        "high",
        "process_open_files",
        `file_access_history PID ${pid} is missing from process evidence.`,
        fileAccessHistory.file_path,
        index + 2,
        line
      );
    }
  });

  for (const match of auditLog.content.matchAll(/type=([A-Z_]+).*?pid=(\d+).*?cmd="([^"]+)"/gi)) {
    const [, auditType, pid, command] = match;
    const processRow = processSnapshot.content
      .split(/\r?\n/)
      .find((line) => new RegExp(`\\s${pid}\\s`).test(line));
    const openRows = openFiles.content
      .split(/\r?\n/)
      .filter((line) => new RegExp(`\\s${pid}\\s`).test(line));
    const historicalAuditOnly = /\/usr\/lib\/apt\/apt\.systemd\.daily|\/usr\/local\/sbin\/[a-z0-9._-]+\.sh|\/usr\/bin\/certbot\s+renew/i.test(command);

    const historyRow = processHistory?.content
      .split(/\r?\n/)
      .find((line) => line.includes(`,${pid},`) && processRowSupportsCommand(line, command));
    const fileHistoryRows = fileAccessHistory?.content
      .split(/\r?\n/)
      .filter((line) => line.includes(`,${pid},`));
    const isSudoWrapperAudit = auditType === "USER_CMD" && (/\bsudo\b/i.test(command) || /\bsudo\b/i.test(historyRow || ""));

    if (!processRow && !historyRow && !historicalAuditOnly) {
      issue(issues, "high", "process_open_files", `Audit PID ${pid} missing from process execution history.`, processHistory?.file_path || auditLog.file_path, undefined, command);
    }
    if (processRow && !processRowSupportsCommand(processRow, command)) {
      issue(issues, "high", "process_open_files", `Process snapshot PID ${pid} does not match audit command ${command}.`, processSnapshot.file_path, undefined, processRow.trim());
    }
    if (openRows.length === 0 && (!fileHistoryRows || fileHistoryRows.length === 0) && !historicalAuditOnly && !isSudoWrapperAudit) {
      issue(issues, "high", "process_open_files", `Audit PID ${pid} missing from file access history.`, fileAccessHistory?.file_path || openFiles.file_path, undefined, command);
    }
    if (isSudoWrapperAudit && !processRow) continue;
    if (historicalAuditOnly && !processRow && openRows.length === 0) continue;
    if (auditType === "USER_CMD" && processRow && /\bsudo\b/.test(processRow)) {
      if (!/sudoers/.test(openRows.join("\n"))) {
        issue(issues, "high", "process_open_files", `sudo audit PID ${pid} lacks sudoers policy file evidence.`, openFiles.file_path, undefined, command);
      }
      continue;
    }
    if (openRows.some((line) => /health-check\.sh/.test(line)) && !/health-check/.test(command)) {
      issue(issues, "high", "process_open_files", `Incident PID ${pid} references unrelated health-check script.`, openFiles.file_path, undefined, openRows.join(" | "));
    }
    const lowered = command.toLowerCase();
    const joinedRows = [...openRows, ...(fileHistoryRows || [])].join("\n");
    const operandEvidence = linuxReadOperandsHaveEvidence({ command, pid, openRows, history: fileAccessHistory?.content });
    if (operandEvidence !== undefined) {
      if (!operandEvidence) issue(issues, "high", "process_open_files", `open_files rows do not match exact operand paths for ${command}.`, openFiles.file_path, undefined, joinedRows);
      continue;
    }
    const expected =
      commandMentions(lowered, "apt")
        ? /\/var\/lib\/dpkg\/status|\/var\/log\/apt\/history\.log|\/var\/cache\/apt/
        : commandMentions(lowered, "systemctl")
          ? /\/etc\/systemd\/system|\/usr\/bin\/systemctl|\.service/
          : commandMentions(lowered, "cat")
            ? /authorized_keys|\/etc\/shadow|\/etc\/group|\/etc\/cron\.d|\/etc\/systemd\/system/
            : commandMentions(lowered, "truncate")
              ? /\/var\/log\/auth\.log/
            : null;
    if (expected && !expected.test(joinedRows)) {
      issue(issues, "high", "process_open_files", `open_files rows do not match command ${command}.`, openFiles.file_path, undefined, joinedRows);
    }
  }
}

function commandMentions(command: string, token: string) {
  return new RegExp(`(?:^|[\\s/])${token}(?:$|[\\s.-])`).test(command);
}

function openFileCommandMatchesProcess(openCommand: string, processCommand: string) {
  const open = openCommand.toLowerCase();
  const process = processCommand.toLowerCase();
  if (!open || !process) return true;
  if (open === "systemd") return process.includes("/sbin/init") || process.includes("systemd");
  const commandFamilies: Record<string, RegExp> = {
    sshd: /\bsshd\b/,
    sudo: /\bsudo\b|\/bin\/(?:bash|sh)\b|\bsystemctl\b|\bcat\b/,
    cat: /\bcat\b/,
    tar: /\btar\b/,
    rsync: /\brsync\b|backup-agent/,
    crontab: /\bcrontab\b/,
    stat: /\bstat\b/,
    chmod: /\bchmod\b|\/bin\/(?:bash|sh)\b/,
    systemctl: /\bsystemctl\b/,
    apt: /\bapt\b/,
    dpkg: /\bdpkg\b|apt\b/,
    truncate: /\btruncate\b/,
    logrotate: /\blogrotate\b|truncate\b/,
    bash: /\bbash\b|apache2/,
    curl: /\bcurl\b|bash\b/,
    docker: /\bdocker\b/,
    dockerd: /\bdockerd\b/,
    nginx: /\bnginx\b|apache2/,
    "php-fpm": /php-fpm|apache2/,
    "backup-agent": /backup-agent/,
    gitaly: /\bgitaly\b/,
    "gitlab-runner": /gitlab-runner/,
    kubelet: /\bkubelet\b/,
    named: /\bnamed\b/,
    postfix: /\bpostfix\b|master -w/,
    rspamd: /\brspamd\b/,
    openvpn: /\bopenvpn\b/,
    fail2ban: /fail2ban/,
    prometheus: /prometheus/,
    "grafana-agent": /grafana-agent/,
    postgres: /postgres/,
    pgbouncer: /pgbouncer/,
    node_exporter: /node_exporter/,
    journalctl: /\bjournalctl\b|sshd\b/,
  };
  return commandFamilies[open]?.test(process) ?? process.includes(open);
}

function processRowSupportsCommand(row: string, command: string) {
  const lowerRow = row.toLowerCase();
  const lowerCommand = command.toLowerCase();
  if (/\bsudo\b/.test(lowerRow)) return true;
  if (lowerCommand.includes("apt")) return /\bapt\b|\/usr\/bin\/apt\b/.test(lowerRow);
  if (lowerCommand.includes("dpkg")) return /\bdpkg\b/.test(lowerRow);
  if (lowerCommand.includes("systemctl")) return /\bsystemctl\b/.test(lowerRow);
  if (lowerCommand.includes("docker")) return /\bdocker\b/.test(lowerRow);
  if (lowerCommand.includes("crontab")) return /\bcrontab\b/.test(lowerRow);
  if (lowerCommand.includes("stat")) return /\bstat\b/.test(lowerRow);
  if (lowerCommand.includes("cat ")) return /\bcat\b/.test(lowerRow);
  if (lowerCommand.includes("journalctl")) return /\bjournalctl\b/.test(lowerRow);
  if (lowerCommand.includes("grep")) return /\bgrep\b/.test(lowerRow);
  if (lowerCommand.includes("tar ")) return /\btar\b/.test(lowerRow);
  if (lowerCommand.includes("rsync")) return /\brsync\b/.test(lowerRow);
  if (lowerCommand.includes("truncate")) return /\btruncate\b/.test(lowerRow);
  if (lowerCommand.includes("bash")) return /\bbash\b/.test(lowerRow);
  return true;
}

function checkDocumentation(input: QualityInput, issues: LinuxQualityIssue[]) {
  const joined = input.assets.map((asset) => asset.content).join("\n");
  const context = input.context;
  if (!context) return;

  for (const value of [context.ticketId, context.changeId, context.hostname]) {
    if (!joined.includes(value)) {
      issue(issues, "high", "documentation", `Required reference ${value} is missing from generated assets.`);
    }
  }
  for (const asset of input.assets.filter((item) => /assets\/docs\/.*\.(?:md|txt|csv)$/i.test(item.file_path))) {
    const changeIds = [...asset.content.matchAll(/\bCHG-\d+\b/g)].map((match) => match[0]);
    const wrong = changeIds.find((changeId) => changeId !== context.changeId);
    if (wrong) {
      issue(issues, "critical", "documentation", "Document references a change ID that differs from the canonical change request.", asset.file_path, undefined, `${wrong} <> ${context.changeId}`);
    }
    if (/change|maintenance|approved|CHG-/i.test(asset.content) && changeIds.length === 0 && asset.content.includes(context.ticketId)) {
      issue(issues, "high", "documentation", "Change-related document omits a valid canonical change ID.", asset.file_path, undefined, context.changeId);
    }
  }
  if (/As an AI|generated by AI|lorem ipsum|placeholder/i.test(joined)) {
    issue(issues, "high", "documentation", "Obvious synthetic documentation phrase detected.");
  }

  const docs = input.assets.filter((asset) => /assets\/(?:docs|evidence|reports)\/.*\.(?:md|csv)$/i.test(asset.file_path));
  const nonDocumentationText = input.assets
    .filter((asset) => !/assets\/(?:docs|evidence|reports)\/.*\.md$/i.test(asset.file_path))
    .map((asset) => `${asset.file_path}\n${asset.content}`)
    .join("\n");
  const knownServices = collectKnownServices(input.assets);
  const knownPaths = collectKnownPaths(nonDocumentationText);

  for (const asset of docs) {
    asset.content.split(/\r?\n/).forEach((line, index) => {
      for (const service of line.match(/\b[a-z0-9@_.-]+\.(?:service|timer|socket)\b/gi) || []) {
        if (!knownServices.has(service.toLowerCase()) && !nonDocumentationText.toLowerCase().includes(service.toLowerCase())) {
          issue(
            issues,
            "medium",
            "documentation",
            `Document references service ${service} without supporting service or journal evidence.`,
            asset.file_path,
            index + 1,
            line.trim()
          );
        }
      }
      for (const path of line.match(/\/(?:etc|var|usr|srv|home|tmp|opt|run|dev)\/[A-Za-z0-9._/@:+-]+/g) || []) {
        const normalized = path.replace(/[),.;:]+$/, "");
        if (!knownPaths.has(normalized) && !nonDocumentationText.includes(normalized)) {
          issue(
            issues,
            "medium",
            "documentation",
            `Document references path ${normalized} without supporting evidence.`,
            asset.file_path,
            index + 1,
            line.trim()
          );
        }
      }
    });
  }
}

function collectKnownServices(assets: LabAsset[]) {
  const services = new Set<string>();
  const inventory = assetByPath(assets, "assets/reports/service_inventory.txt");
  if (inventory) {
    inventory.content.split(/\r?\n/).forEach((line, index) => {
      if (index === 0) return;
      const service = parseCsvLine(line)[0]?.trim();
      if (service) services.add(service.toLowerCase());
    });
  }
  for (const asset of assets) {
    for (const service of asset.content.match(/\b[a-z0-9@_.-]+\.(?:service|timer|socket)\b/gi) || []) {
      services.add(service.toLowerCase());
    }
  }
  return services;
}

function collectKnownPaths(text: string) {
  const paths = new Set<string>();
  for (const path of text.match(/\/(?:etc|var|usr|srv|home|tmp|opt|run|dev)\/[A-Za-z0-9._/@:+-]+/g) || []) {
    paths.add(path.replace(/[),.;:]+$/, ""));
  }
  return paths;
}

function checkBackgroundNoise(input: QualityInput, issues: LinuxQualityIssue[]) {
  for (const asset of input.assets.filter((item) => /assets\/logs|assets\/journal/.test(item.file_path))) {
    const lines = asset.content.split(/\r?\n/).filter(Boolean);
    const repeatedHealth = lines.filter((line) => /health check completed/i.test(line));
    if (repeatedHealth.length > 12) {
      issue(issues, "medium", "background_noise", "Excessive repeated health-check phrasing.", asset.file_path, undefined, repeatedHealth[0]);
    }
    const normalized = lines.map((line) => line.replace(/\d+/g, "N").replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "IP"));
    const counts = new Map<string, number>();
    for (const line of normalized) counts.set(line, (counts.get(line) || 0) + 1);
    const repeated = [...counts.entries()].find(([, count]) => count > Math.max(18, lines.length * 0.12));
    if (repeated) {
      issue(issues, "low", "background_noise", "Repeated log sentence pattern detected.", asset.file_path, undefined, repeated[0]);
    }
  }
}

function cronFieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  if (/^\d+$/.test(field)) return Number(field) === value;
  const step = field.match(/^\*\/(\d+)$/);
  if (step) return value % Number(step[1]) === 0;
  if (field.includes(",")) return field.split(",").some((item) => cronFieldMatches(item.trim(), value));
  return false;
}

function checkCronScheduleConsistency(input: QualityInput, issues: LinuxQualityIssue[]) {
  const cronLog = assetByPath(input.assets, "assets/logs/cron.log");
  if (!cronLog) return;
  const users = new Set([...collectUsersCsvRows(input.assets).keys(), ...collectPasswdRows(input.assets).keys(), "root"]);
  const definitions = new Map<string, { schedule: string; runAs?: string; source: string; line: string; command: string }>();
  const addDefinition = (id: string, schedule: string, source: string, line: string, runAs: string | undefined, command: string) => {
    if (id) definitions.set(id, { schedule, runAs, source, line, command });
  };

  const rootCrontab = assetByPath(input.assets, "assets/scheduled/root_crontab.txt");
  if (rootCrontab) {
    rootCrontab.content.split(/\r?\n/).forEach((line, index) => {
      if (line.trimStart().startsWith("#")) return;
      const match = line.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+?)\s+#\s*(cron:[a-z0-9:_-]+)(?:\s+source=(\S+))?/i);
      if (match) addDefinition(match[3], match[1], rootCrontab.file_path, line, "root", match[2].trim());
      if (/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+/.test(line) && !match) {
        issue(issues, "critical", "background_noise", "Cron definition lacks canonical cron identity.", rootCrontab.file_path, index + 1, line.trim());
      }
    });
  }
  for (const cronAsset of input.assets.filter((asset) => /assets\/scheduled\/cron\.d\//.test(asset.file_path))) {
    cronAsset.content.split(/\r?\n/).forEach((line, index) => {
      const match = line.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+([a-z0-9._-]+)\s+(.+?)\s+#\s*(cron:[a-z0-9:_-]+)(?:\s+source=(\S+))?/i);
      if (!match) return;
      addDefinition(match[4], match[1], cronAsset.file_path, line, match[2], match[3].trim());
      if (!users.has(match[2])) {
        issue(issues, "critical", "background_noise", `Cron definition run-as account ${match[2]} does not exist.`, cronAsset.file_path, index + 1, line.trim());
      }
    });
  }

  const simulation = input.simulation as LinuxSimulationWorld | undefined;
  if (simulation?.cronDefinitions?.length) {
    for (const definition of simulation.cronDefinitions) {
      const command = simulation.commands.find((item) => item.id === definition.commandId);
      const runAs = simulation.identities.find((item) => item.id === definition.runAsIdentityId);
      const rendered = definitions.get(definition.id);
      if (definition.enabled && definition.persistenceState === "present") {
        if (!rendered) {
          issue(issues, "critical", "background_noise", `Current cron definition ${definition.id} is missing from scheduled evidence.`, undefined, undefined, definition.sourcePath);
          continue;
        }
        const checks: Array<[string, string | undefined, string | undefined]> = [
          ["schedule", definition.schedule, rendered.schedule],
          ["run-as", definition.source === "root_crontab" ? "root" : runAs?.username, rendered.runAs],
          ["command", command?.renderedCommand, rendered.command],
        ];
        for (const [field, expected, actual] of checks) {
          if ((expected || "") !== (actual || "")) {
            issue(issues, "critical", "background_noise", `Rendered cron ${field} disagrees with canonical definition ${definition.id}.`, rendered.source, undefined, `expected=${expected || "(blank)"} actual=${actual || "(blank)"}`);
          }
        }
      } else if (rendered) {
        issue(issues, "critical", "background_noise", `Removed or disabled cron definition ${definition.id} is still rendered as current persistence.`, rendered.source, undefined, rendered.line);
      }
    }
  }

  cronLog.content.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2}):\d{2}.*?\(([^)]+)\)\s+CMD\s+\((.+?)\).*?\bdef="?((?:cron:[a-z0-9:_-]+)|missing)"?/i);
    if (!match) return;
    const [, dateText, hourText, minuteText, runAs, commandText, definitionId] = match;
    const definition = definitions.get(definitionId);
    if (!definition) {
      issue(issues, "high", "background_noise", `Cron execution references missing definition ${definitionId}.`, cronLog.file_path, index + 1, line.trim());
      return;
    }
    const timestamp = `${dateText} ${hourText}:${minuteText}:00`;
    if (!scheduleMatchesTimestamp(definition.schedule, timestamp)) {
      issue(
        issues,
        "critical",
        "background_noise",
        `Cron execution time does not match rendered schedule for ${definitionId}.`,
        definition.source,
        undefined,
        `${definition.schedule} <> ${hourText}:${minuteText}`
      );
    }
    if (definition.command !== commandText.trim()) {
      issue(
        issues,
        "critical",
        "background_noise",
        `Cron execution command disagrees with rendered definition for ${definitionId}.`,
        cronLog.file_path,
        index + 1,
        `${definition.command} <> ${commandText.trim()}`
      );
    }
    if (definition.runAs && definition.runAs !== runAs) {
      issue(
        issues,
        "critical",
        "background_noise",
        `Cron execution run-as account disagrees with rendered definition for ${definitionId}.`,
        cronLog.file_path,
        index + 1,
        `${definition.runAs} <> ${runAs}`
      );
    }
    if (simulation?.scheduledExecutions?.length) {
      const canonicalExecution = simulation.scheduledExecutions.find((execution) => execution.definitionId === definitionId && execution.occurredAt.startsWith(`${dateText} ${hourText}:${minuteText}`));
      if (!canonicalExecution) {
        issue(issues, "critical", "background_noise", `Cron execution has no canonical scheduled execution for ${definitionId}.`, cronLog.file_path, index + 1, line.trim());
      }
    }
  });
}

function sourceNativeTimestampMs(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}
function clockSeconds(value: string) {
  const [hour = "0", minute = "0", second = "0"] = value.split(":");
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkBackgroundRoleFit(input: QualityInput, issues: LinuxQualityIssue[]) {
  const role = hostRole(input);
  if (!role) return;
  const kind = roleKind(role);
  const cron = assetByPath(input.assets, "assets/logs/cron.log");
  if (!cron) return;
  const incompatible: Record<string, RegExp> = {
    backup: /\bcrictl\b|gitlab-runner|kubelet|\/var\/www/i,
    access: /\bcrictl\b|postgres|gitlab-runner|\/var\/lib\/docker/i,
    mail: /\bcrictl\b|postgres|\/var\/www|gitlab-runner/i,
    database: /\bcrictl\b|gitlab-runner|\/var\/www/i,
  };
  const pattern = incompatible[kind];
  if (!pattern) return;
  cron.content.split(/\r?\n/).forEach((line, index) => {
    if (pattern.test(line)) {
      issue(issues, "medium", "background_noise", `Background cron job does not fit ${role}.`, cron.file_path, index + 1, line.trim());
    }
  });
}

function checkNoiseQualityReport(input: QualityInput, issues: LinuxQualityIssue[]) {
  if (!isCompleteLinuxSimulation(input.simulation)) return;
  const report = buildLinuxNoiseQualityReport({
    simulation: input.simulation,
    assets: input.assets,
    difficulty: input.context?.incidentFamily ? input.simulation.difficultyDiagnostics.difficulty : undefined,
  });
  for (const reportIssue of report.issues) {
    issue(
      issues,
      reportIssue.severity,
      "background_noise",
      `${reportIssue.code}: ${reportIssue.message}`,
      reportIssue.artifact,
      undefined,
      reportIssue.detail
    );
  }
}

function checkIncidentAwareArtifacts(input: QualityInput, issues: LinuxQualityIssue[]) {
  const incident = input.context?.incidentFamily;
  const role = hostRole(input) || "";
  const kind = roleKind(role);
  const presentPaths = new Set(input.assets.map((asset) => asset.file_path));
  for (const requiredPath of [
    "assets/logs/auth.log",
    "assets/logs/sudo.log",
    "assets/evidence/timeline.csv",
    "assets/csv/users.csv",
    "assets/csv/groups.csv",
  ]) {
    if (!presentPaths.has(requiredPath)) {
      issue(issues, "critical", "asset_consistency", `Required Linux evidence asset is missing: ${requiredPath}.`, undefined, undefined, requiredPath);
    }
  }
  const cronMaint = assetByPath(input.assets, "assets/scheduled/cron.d/sys-maint");
  if (cronMaint && incident !== "cron_persistence") {
    issue(
      issues,
      "high",
      "asset_consistency",
      "Generic sys-maint cron artifact appears outside a cron-persistence investigation.",
      cronMaint.file_path,
      undefined,
      cronMaint.content.split(/\r?\n/).find(Boolean)
    );
  }

  const rootCrontab = assetByPath(input.assets, "assets/scheduled/root_crontab.txt");
  if (rootCrontab && /backup-check\.sh/.test(rootCrontab.content) && kind !== "backup") {
    issue(
      issues,
      "medium",
      "background_noise",
      "Backup-specific cron task appears on a non-backup host role.",
      rootCrontab.file_path,
      undefined,
      "backup-check.sh"
    );
  }

  const script = assetByPath(input.assets, "assets/scripts/script_sample.sh");
  if (script && /systemctl is-active ssh/i.test(script.content) && kind !== "access" && !/^ssh_/i.test(incident || "")) {
    issue(
      issues,
      "medium",
      "asset_consistency",
      "Generic SSH health-check script appears on an unrelated host role.",
      script.file_path,
      undefined,
      "systemctl is-active ssh"
    );
  }

  for (const asset of input.assets) {
    if (/(^|\/)(?:README\.md|DISCLAIMER\.txt|manifest\.json|setup\.sh)$|assets\/(?:readme|manifest|disclaimer)/i.test(asset.file_path)) continue;
    if (/\b(?:CyberLab|generated lab|training case|simulator)\b/i.test(asset.content)) {
      issue(
        issues,
        "high",
        "generated_text",
        "Simulator or training-platform wording leaked into in-world evidence.",
        asset.file_path,
        undefined,
        asset.content.match(/\b(?:CyberLab|generated lab|training case|simulator)\b/i)?.[0]
      );
    }
  }
}

function checkDocumentVariety(input: QualityInput, issues: LinuxQualityIssue[]) {
  const docs = [
    "assets/evidence/incident_brief.md",
    "assets/evidence/audit_notes.md",
    "assets/evidence/analyst_working_notes.md",
    "assets/evidence/change_request.md",
    "assets/evidence/maintenance_ticket.md",
    "assets/reports/hardening_checklist.md",
  ]
    .map((path) => assetByPath(input.assets, path))
    .filter((asset): asset is LabAsset => Boolean(asset));
  for (let left = 0; left < docs.length; left += 1) {
    for (let right = left + 1; right < docs.length; right += 1) {
      const leftShape = documentShape(docs[left].content);
      const rightShape = documentShape(docs[right].content);
      if (leftShape && leftShape === rightShape) {
        issue(issues, "medium", "documentation", "Documents share an overly similar structure fingerprint.", docs[right].file_path, undefined, rightShape);
      }
    }
  }
}

function auditTime(line: string) {
  const match = line.match(/audit\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\)/);
  return match ? `${match[1]} ${match[2]}` : "";
}

function normalizeRenderedTimestamp(value: string) {
  const match = value.match(/(20\d{2}-\d{2}-\d{2})[ T:](\d{2}:\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : "";
}

function renderedCollectionTime(input: QualityInput) {
  const simulationCollection = input.simulation?.collection?.collectedAt;
  if (simulationCollection) return simulationCollection.replace("T", " ");
  const metadata = assetByPath(input.assets, "assets/inventory/host_metadata.json");
  if (!metadata) return "";
  try {
    const parsed = JSON.parse(metadata.content) as { collected_at?: string; collection_time?: string };
    return normalizeRenderedTimestamp(parsed.collected_at || parsed.collection_time || "");
  } catch {
    return "";
  }
}

function renderedTimestamps(asset: LabAsset) {
  const timestamps: Array<{ timestamp: string; line: number; raw: string }> = [];
  const lines = asset.content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const matches = [
      ...line.matchAll(/(20\d{2}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/g),
      ...line.matchAll(/\[(20\d{2}-\d{2}-\d{2}):(\d{2}:\d{2}:\d{2})/g),
    ];
    for (const match of matches) {
      timestamps.push({ timestamp: `${match[1]} ${match[2]}`, line: index + 1, raw: line.trim() });
    }
  });
  return timestamps;
}

function renderedJournalHeader(asset: LabAsset) {
  const lines = asset.content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^-- Journal begins at /.test(line));
  const headerLine = headerIndex >= 0 ? lines[headerIndex] : "";
  const headerTimestamp = normalizeRenderedTimestamp(headerLine);
  const entry = lines
    .map((line, index) => ({ line, index, timestamp: normalizeRenderedTimestamp(line) }))
    .find((item) => item.timestamp && item.index !== headerIndex);
  return { headerIndex, headerTimestamp, firstEntryIndex: entry?.index ?? -1, firstEntryTimestamp: entry?.timestamp || "", headerLine };
}

function collectPermissionsRows(assets: LabAsset[]) {
  const permissions = assetByPath(assets, "assets/reports/permissions_report.txt");
  const rows = new Map<string, { mode: string; owner: string; group: string; raw: string }>();
  if (!permissions) return rows;
  for (const line of permissions.content.split(/\r?\n/)) {
    const [path, mode, owner, group] = line.trim().split(/\s+/);
    if (path?.startsWith("/") && mode && owner && group) rows.set(path, { mode, owner, group, raw: line.trim() });
  }
  return rows;
}

function evidenceListSupportsRisk(finding: string, evidence: string) {
  const text = finding.toLowerCase();
  const ev = evidence.toLowerCase();
  if (/\barchive|data staging|staging|export|tar\b|data staged|temporary archive/.test(text)) {
    return /\b(?:audit\.log|sudo\.log|process_snapshot\.txt|open_files\.txt|timeline\.csv|permissions_report\.txt)\b/.test(ev);
  }
  if (/\binteractive shell\b|interactive login|login shell|shell access|account membership|supplementary group/.test(text)) {
    return /\b(?:passwd\.sample|group\.sample|groups\.csv|users\.csv|auth\.log)\b/.test(ev);
  }
  if (/\bpackage|apt|dpkg|install/.test(text)) {
    return /\b(?:apt_history\.log|audit\.log|sudo\.log|timeline\.csv|package_inventory\.txt)\b/.test(ev);
  }
  if (/\bservice|systemd|unit\b/.test(text)) {
    return /\b(?:journal_systemd\.txt|audit\.log|syslog|service_inventory\.txt|timeline\.csv|change_request\.md)\b/.test(ev);
  }
  return true;
}

function checkFinalRenderedArtifacts(input: QualityInput, issues: LinuxQualityIssue[]) {
  const collection = renderedCollectionTime(input);
  const timestampedArtifacts = input.assets.filter((asset) =>
    /assets\/(?:logs|journal)\//.test(asset.file_path) ||
    /assets\/evidence\/timeline\.csv$/.test(asset.file_path) ||
    /assets\/inventory\/host_metadata\.json$/.test(asset.file_path)
  );
  if (collection) {
    for (const asset of timestampedArtifacts) {
      for (const item of renderedTimestamps(asset)) {
        if (item.timestamp > collection) {
          issue(issues, "critical", "timeline", "Rendered artifact timestamp occurs after collection time.", asset.file_path, item.line, `${item.timestamp} > ${collection}: ${item.raw}`);
        }
      }
    }
  }

  for (const journal of input.assets.filter((asset) => /assets\/journal\/journal_.*\.txt$/.test(asset.file_path))) {
    const header = renderedJournalHeader(journal);
    if (header.headerIndex < 0) {
      issue(issues, "critical", "service_model", "Journal header is missing from rendered journal artifact.", journal.file_path);
      continue;
    }
    if (header.firstEntryIndex >= 0 && header.headerIndex > header.firstEntryIndex) {
      issue(issues, "critical", "service_model", "Journal header appears after journal entries in final artifact.", journal.file_path, header.headerIndex + 1, header.headerLine);
    }
    if (header.headerTimestamp && header.firstEntryTimestamp && header.headerTimestamp > header.firstEntryTimestamp) {
      issue(issues, "critical", "service_model", "Journal header timestamp is later than first rendered entry.", journal.file_path, header.headerIndex + 1, `${header.headerTimestamp} > ${header.firstEntryTimestamp}`);
    }
  }

  const serviceModel = serviceRoleModel(input);
  if (serviceModel.primary) {
    const scopedDocs = input.assets.filter((asset) =>
      /assets\/(?:docs|evidence|reports|configs)\/(?:.*(?:incident_brief|maintenance_ticket|change_request|linux_config_pack|service_inventory|risk_register|advanced_risk_register|hardening_checklist|audit_notes|analyst_working_notes).*)/i.test(asset.file_path)
    );
    for (const doc of scopedDocs) {
      for (const line of doc.content.split(/\r?\n/)) {
        if (!/\b(?:affected service|service focus|reviewed service|primary service|service under review|validate .*service|service evidence|service context)\b/i.test(line)) continue;
        for (const service of line.match(/[a-z0-9@_.-]+\.service/gi) || []) {
          const role = serviceMentionRole(input, service);
          const primaryLabel = /\b(?:affected service|primary service|service under review|service focus)\b/i.test(line);
          if (primaryLabel && role !== "primary") {
            issue(issues, "critical", "semantic", "Final artifact promotes a non-primary service as the affected service.", doc.file_path, undefined, line.trim());
            break;
          }
        }
      }
    }
  }

  if (input.simulation?.files && input.simulation.commands && input.simulation.identities) {
    const permissions = collectPermissionsRows(input.assets);
    const identityById = new Map(input.simulation.identities.map((identity) => [identity.id, identity]));
    const fileById = new Map(input.simulation.files.map((file) => [file.id, file]));
    for (const command of input.simulation.commands) {
      for (const fileId of command.affectedFileIds || []) {
        const file = fileById.get(fileId);
        if (!file) {
          issue(issues, "critical", "semantic", "Canonical command references a missing canonical file.", undefined, undefined, `${command.id}:${fileId}`);
          continue;
        }
        const isOutputOrWriteTarget = file.contentRole === "incident_output" || commandOutputPaths(command.renderedCommand).includes(file.path);
        if (!isOutputOrWriteTarget) continue;
        const expectedOwner = identityById.get(file.ownerIdentityId)?.username;
        const rendered = permissions.get(file.path);
        if (rendered && expectedOwner && rendered.owner !== expectedOwner) {
          issue(issues, "critical", "permissions", "Rendered file ownership disagrees with canonical command-file relationship.", "assets/reports/permissions_report.txt", undefined, `${command.renderedCommand} -> ${file.path}: ${rendered.owner} <> ${expectedOwner}`);
        }
      }
    }
  }

  for (const risk of input.assets.filter((asset) => /risk_register\.csv$/i.test(asset.file_path))) {
    const lines = risk.content.split(/\r?\n/);
    const header = parseCsvLine(lines[0] || "").map((item) => item.toLowerCase());
    const findingIndex = header.indexOf("finding") >= 0 ? header.indexOf("finding") : header.indexOf("risk");
    const evidenceIndex = header.indexOf("evidence");
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const row = parseCsvLine(line);
      const finding = row[findingIndex >= 0 ? findingIndex : 1] || "";
      const evidence = row[evidenceIndex >= 0 ? evidenceIndex : 3] || "";
      if (!evidenceListSupportsRisk(finding, evidence)) {
        issue(issues, "high", "semantic", "Risk register evidence does not support the stated finding.", risk.file_path, undefined, line.trim());
      }
    }
  }

  const maintenance = assetByPath(input.assets, "assets/docs/maintenance_ticket.md");
  if (maintenance && /\bapt timer around 08:00\b/i.test(maintenance.content) && !/\b(?:deviation|differs|compare|observed evidence|rendered logs)\b/i.test(maintenance.content)) {
    const dynamic = input.assets.filter((asset) => /assets\/(?:logs|journal)\//.test(asset.file_path)).map((asset) => asset.content).join("\n");
    if (!/\b08:0\d:\d{2}\b/.test(dynamic)) {
      issue(issues, "critical", "documentation", "Maintenance ticket declares an APT timer time that is not supported or explained by rendered evidence.", maintenance.file_path, undefined, "APT timer around 08:00");
    }
  }

  const brief = assetByPath(input.assets, "assets/evidence/incident_brief.md");
  const sourcesLine = brief?.content.match(/(?:Network sources observed(?: in SSH session records)?|External sources observed):\s*(.*)/i);
  if (brief && sourcesLine) {
    const ips = sourcesLine[1].split(",").map((item) => item.trim()).filter(Boolean);
    if (new Set(ips).size !== ips.length) {
      issue(issues, "high", "semantic", "Network source list contains duplicate IP addresses.", brief.file_path, undefined, sourcesLine[0]);
    }
    if (/External sources observed:\s*(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.)/i.test(sourcesLine[0])) {
      issue(issues, "high", "semantic", "Private, loopback, or link-local address is described as external.", brief.file_path, undefined, sourcesLine[0]);
    }
  }
}

function commandOutputPaths(command: string) {
  const paths = [...(command.match(/\/(?:etc|var|usr|srv|home|tmp|opt|run|dev|lib)\/[A-Za-z0-9._/@:+-]+/g) || [])];
  if (/^tar\b/.test(command)) {
    const archive = command.match(/\s-[A-Za-z]*f\s+(\S+)/)?.[1];
    return archive?.startsWith("/") ? [archive] : [];
  }
  if (/^(?:cp|mv)\b/.test(command)) return paths.slice(-1);
  if (/^(?:touch|tee|install|mkdir)\b/.test(command)) return paths;
  return [];
}

function checkLiveSemanticRegressions(input: QualityInput, issues: LinuxQualityIssue[]) {
  const audit = assetByPath(input.assets, "assets/logs/audit.log");
  const processSnapshot = assetByPath(input.assets, "assets/runtime/process_snapshot.txt");
  const openFiles = assetByPath(input.assets, "assets/runtime/open_files.txt");
  const permissions = assetByPath(input.assets, "assets/reports/permissions_report.txt");
  const serviceInventory = assetByPath(input.assets, "assets/reports/service_inventory.txt");
  const listeningPorts = assetByPath(input.assets, "assets/network/listening_ports.txt");

  if (input.simulation?.processes && input.simulation.commands && input.simulation.files) {
    const processByPid = new Map(input.simulation.processes.map((process) => [String(process.pid), process]));
    const fileById = new Map(input.simulation.files.map((file) => [file.id, file]));
    for (const command of input.simulation.commands) {
      for (const fileId of command.affectedFileIds) {
        const file = fileById.get(fileId);
        if (!file) continue;
        const process = command ? processByPid.get(String(command.processId)) : undefined;
        if (process && file.modifiedAt < process.startedAt) {
          issue(issues, "critical", "semantic", "File event precedes the process that produced it.", undefined, undefined, `${file.path} ${file.modifiedAt} < ${process.startedAt}`);
        }
        const outputPaths = commandOutputPaths(command.renderedCommand);
        if (outputPaths.includes(file.path) && command.runAsIdentityId === "identity:root" && file.ownerUid !== 0) {
          issue(issues, "critical", "semantic", "Output file ownership does not match root effective execution.", undefined, undefined, `${command.renderedCommand} -> ${file.path} uid=${file.ownerUid}`);
        }
      }
    }
    if (processSnapshot && input.simulation.collection?.windowEnd) {
      const captureAt = input.simulation.collection.windowEnd;
      const liveAncestorPids = new Set<number>();
      const processByPid = new Map(input.simulation.processes.map((process) => [process.pid, process]));
      for (const process of input.simulation.processes) {
        if (process.pid === 1 || process.startedAt > captureAt || (process.endedAt && process.endedAt <= captureAt)) continue;
        let current = processByPid.get(process.ppid);
        while (current && current.pid !== 1 && !liveAncestorPids.has(current.pid)) {
          if (current.startedAt > captureAt || (current.endedAt && current.endedAt <= captureAt)) break;
          liveAncestorPids.add(current.pid);
          current = processByPid.get(current.ppid);
        }
      }
      for (const process of input.simulation.processes) {
        if (
          process.endedAt &&
          process.endedAt <= captureAt &&
          !liveAncestorPids.has(process.pid) &&
          new RegExp(`\\s${process.pid}\\s`).test(processSnapshot.content)
        ) {
          issue(issues, "critical", "semantic", "Historical completed process appears in collection-time process snapshot.", processSnapshot.file_path, undefined, `${process.pid} ended ${process.endedAt}`);
        }
      }
    }
    for (const command of input.simulation.commands) {
      if (/systemctl\b/i.test(command.renderedCommand) && /\barchive|tar|rsync|package\b/i.test(command.id)) {
        issue(issues, "high", "semantic", "Canonical command event ID does not describe the rendered command.", undefined, undefined, `${command.id}:${command.renderedCommand}`);
      }
      if (/\b(?:tar|rsync)\b/i.test(command.renderedCommand) && /\bsystemctl|service\b/i.test(command.id)) {
        issue(issues, "high", "semantic", "Canonical command event ID does not describe archive or transfer activity.", undefined, undefined, `${command.id}:${command.renderedCommand}`);
      }
    }
  }

  if (audit) {
    const commandStarts = new Map<string, string>();
    const rootEffectivePids = new Set<string>();
    for (const line of audit.content.split(/\r?\n/)) {
      const pid = line.match(/\bpid=(\d+)/)?.[1];
      if (!pid) continue;
      if (/type=(?:USER_CMD|EXECVE)/.test(line)) {
        const time = auditTime(line);
        const existing = commandStarts.get(pid);
        if (time && (!existing || time < existing)) commandStarts.set(pid, time);
        if (/\buid=0\b/.test(line)) rootEffectivePids.add(pid);
      }
    }
    for (const line of audit.content.split(/\r?\n/)) {
      if (!/type=PATH/.test(line)) continue;
      const pid = line.match(/\bpid=(\d+)/)?.[1];
      const time = auditTime(line);
      const start = pid ? commandStarts.get(pid) : undefined;
      if (pid && start && time && time < start) {
        issue(issues, "critical", "semantic", "Audit PATH file event occurs before process execution.", audit.file_path, undefined, `${time} < ${start}: ${line.trim()}`);
      }
    }
    if (processSnapshot) {
      for (const pid of rootEffectivePids) {
        const row = processSnapshot.content.split(/\r?\n/).find((line) => new RegExp(`\\s${pid}\\s`).test(line));
        if (row && !/^root\s+/.test(row)) {
          issue(issues, "critical", "semantic", "Root-effective audited process is not owned by root in process snapshot.", processSnapshot.file_path, undefined, row.trim());
        }
      }
    }
    if (openFiles) {
      for (const pid of rootEffectivePids) {
        for (const row of openFiles.content.split(/\r?\n/).filter((line) => new RegExp(`\\s${pid}\\s`).test(line))) {
          if (!/^\S+\s+\d+\s+root\s+/.test(row)) {
            issue(issues, "high", "semantic", "Root-effective audited process is not root-owned in open_files.", openFiles.file_path, undefined, row.trim());
          }
        }
      }
    }
  }

  if (permissions) {
    for (const line of permissions.content.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      const [filePath, mode, owner, group] = parts;
      if (!filePath?.startsWith("/")) continue;
      const bits = permissionStringToBits(mode || "");
      if ((mode?.startsWith("d") || filePath.endsWith("/")) && bits !== null && (bits & 0o111) === 0) {
        issue(issues, "critical", "semantic", "Directory permissions lack execute traversal bits.", permissions.file_path, undefined, line.trim());
      }
      if (/^\/lib\/systemd\/system\/.+\.service$/.test(filePath)) {
        if (owner !== "root" || group !== "root" || bits !== 0o644) {
          issue(issues, "critical", "semantic", "Packaged systemd unit ownership or mode is invalid.", permissions.file_path, undefined, line.trim());
        }
      }
      if (/^\/etc\/systemd\/system\/.+\.service$/.test(filePath) && (owner !== "root" || group !== "root" || bits === null || (bits & 0o022) !== 0 || (bits & 0o111) !== 0)) {
        issue(issues, "critical", "semantic", "Local systemd unit ownership or mode is unsafe.", permissions.file_path, undefined, line.trim());
      }
    }
  }

  const docs = input.assets.filter((asset) => /assets\/(?:evidence|docs|reports)\/.*\.(?:md|csv|txt)$/i.test(asset.file_path));
  const serviceModel = serviceRoleModel(input);
  if (serviceModel.primary) {
    const serviceNames = new Set((serviceInventory?.content.match(/[a-z0-9@_.-]+\.service/gi) || []).map((item) => item.toLowerCase()));
    for (const doc of docs.filter((asset) => /incident_brief|audit_notes|change_request|maintenance_ticket|hardening_checklist/i.test(asset.file_path))) {
      for (const line of doc.content.split(/\r?\n/)) {
        if (!/\b(?:affected service|service focus|reviewed service|primary service|service under review)\b/i.test(line)) continue;
        for (const service of line.match(/[a-z0-9@_.-]+\.service/gi) || []) {
          const normalized = service.toLowerCase();
          const role = serviceMentionRole(input, service);
          const primaryLabel = /\b(?:affected service|primary service|service under review|service focus)\b/i.test(line);
          if (serviceNames.has(normalized) && primaryLabel && role !== "primary") {
            issue(issues, "critical", "semantic", "Document promotes a non-primary service as the affected service.", doc.file_path, undefined, line.trim());
            break;
          }
        }
      }
    }
  }

  for (const risk of input.assets.filter((asset) => /risk_register\.csv$/i.test(asset.file_path))) {
    const header = parseCsvLine(risk.content.split(/\r?\n/)[0] || "");
    const evidenceIndex = header.indexOf("evidence");
    for (const line of risk.content.split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const row = parseCsvLine(line);
      const evidenceText = evidenceIndex >= 0 ? row[evidenceIndex] || "" : row.join(";");
      if (/\b(?:passwd|shadow|group|sshd_config|security_policy)\b/i.test(evidenceText) && !/\b(?:audit|timeline|process|open_files|sudo|auth|journal|syslog|apt_history|service_inventory)\b/i.test(evidenceText)) {
        issue(issues, "high", "semantic", "Risk register cites unrelated static configuration as primary evidence.", risk.file_path, undefined, line.trim());
      }
    }
  }

  for (const asset of input.assets.filter((item) => /authorized_keys$/i.test(item.file_path))) {
    if (/ExampleHostKey|TrainingKey|AAAAI(?:Example|Generated)/i.test(asset.content)) {
      issue(issues, "high", "semantic", "authorized_keys contains placeholder key material.", asset.file_path, undefined, asset.content.match(/ExampleHostKey|TrainingKey|AAAAI(?:Example|Generated)/i)?.[0]);
    }
  }

  if (listeningPorts?.content.includes("2375")) {
    const processes = processSnapshot?.content || "";
    const configs = input.assets.filter((asset) => /docker|daemon\.json/i.test(asset.file_path)).map((asset) => asset.content).join("\n");
    if (!/(?:-H|hosts).*2375/.test(`${processes}\n${configs}`)) {
      issue(issues, "critical", "semantic", "Docker TCP port is listed without matching daemon args or config.", listeningPorts.file_path, undefined, "2375");
    }
  }

  const incidentBrief = assetByPath(input.assets, "assets/evidence/incident_brief.md");
  if (incidentBrief && /External sources observed:\s*(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.)/i.test(incidentBrief.content)) {
    issue(issues, "high", "semantic", "Private, loopback, or link-local address is described as external.", incidentBrief.file_path, undefined, incidentBrief.content.match(/External sources observed:.*/i)?.[0]);
  }
}

function documentShape(content: string) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 6) return "";
  return lines
    .slice(0, 10)
    .map((line) => {
      if (/^#{1,4}\s/.test(line)) return "heading";
      if (/^- /.test(line)) return "bullet";
      if (/^[A-Z][A-Za-z ]+:/.test(line)) return "label";
      return `sentence-${Math.min(4, line.split(/\s+/).length)}`;
    })
    .join("|");
}

function scoreIssues(issues: LinuxQualityIssue[]) {
  const score = Math.max(0, 100 - issues.reduce((total, item) => total + issuePenalty(item), 0));
  const critical = issues.filter((item) => item.severity === "critical").length;
  const high = issues.filter((item) => item.severity === "high").length;
  const medium = issues.filter((item) => item.severity === "medium").length;
  const passed = critical === 0 && high === 0 && medium < 3 && score >= 90;
  return { score, passed };
}

function checkLearnerPackGrounding(input: QualityInput, issues: LinuxQualityIssue[]) {
  if (!input.simulation) return;
  const hasAdvancedEvidenceSurface = input.assets.some((asset) => asset.file_path === "assets/runtime/process_snapshot.txt");
  if (!hasAdvancedEvidenceSurface) return;
  const registry = buildCanonicalEvidenceRegistry(input.simulation as LinuxSimulationWorld, input.assets);
  const result = validateLinuxLearnerPackGrounding({
    simulation: input.simulation as LinuxSimulationWorld,
    evidenceRegistry: registry,
    finalAssets: input.assets,
  });
  const closure = validateLinuxProductionClosure({
    simulation: input.simulation as LinuxSimulationWorld,
    evidenceRegistry: registry,
    finalAssets: input.assets,
  });
  if (!result.passed) {
    for (const detail of result.issues.slice(0, 5)) {
      issue(issues, "critical", "asset_consistency", "Learner pack object grounding failed.", undefined, undefined, detail);
    }
  }
  if (!closure.passed) {
    for (const detail of closure.issues.slice(0, 5)) {
      issue(issues, "critical", "asset_consistency", "Universal Linux production closure validation failed.", undefined, undefined, detail);
    }
  }
  const semanticClosure = validateLinuxSemanticClosure({
    simulation: input.simulation as LinuxSimulationWorld,
    finalAssets: input.assets,
  });
  if (!semanticClosure.passed) {
    for (const detail of semanticClosure.issues.filter((item) => item.severity !== "medium").slice(0, 5)) {
      issue(
        issues,
        detail.severity === "critical" ? "critical" : "high",
        "asset_consistency",
        "Universal Linux semantic closure validation failed.",
        undefined,
        undefined,
        `${detail.category}: ${detail.message}`
      );
    }
  }
  if (result.coverage.taskRequiredSubjects !== result.coverage.taskCoveredSubjects) {
    issue(
      issues,
      "critical",
      "asset_consistency",
      "Learner pack task object coverage is incomplete.",
      undefined,
      undefined,
      `${result.coverage.taskCoveredSubjects}/${result.coverage.taskRequiredSubjects}`
    );
  }
  if (result.coverage.relationshipProofCoverage < 1) {
    issue(
      issues,
      "critical",
      "asset_consistency",
      "Learner pack relationship coverage is incomplete.",
      undefined,
      undefined,
      String(result.coverage.relationshipProofCoverage)
    );
  }
}

function checkCanonicalExecutionLifecycle(input: QualityInput, issues: LinuxQualityIssue[]) {
  if (!input.simulation) return;
  if (!Array.isArray(input.simulation.executions)) {
    if (input.lab?.difficulty === "Advanced") {
      issue(issues, "critical", "process_open_files", "Advanced Linux simulation is missing canonical executions.", undefined, undefined, "simulation.executions");
    }
    return;
  }
  try {
    validateCanonicalExecutionLifecycle(input.simulation as LinuxSimulationWorld);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const category: LinuxQualityIssue["category"] =
      /service transition/i.test(message) ? "service_model" :
      /scheduled execution|cron/i.test(message) ? "background_noise" :
      "process_open_files";
    issue(issues, "critical", category, "Canonical execution lifecycle validation failed.", undefined, undefined, message);
  }
}

function issuePenalty(item: LinuxQualityIssue) {
  const categoryWeight: Partial<Record<LinuxQualityIssue["category"], number>> = {
    timeline: 1.2,
    process_open_files: 1.3,
    sudo_audit: 1.3,
    service_model: 1.2,
    package_management: 1.2,
    role_leakage: 1.1,
    documentation: 0.8,
    background_noise: 0.5,
    assessment: 1.4,
  };
  const severity = item.severity === "critical" ? 30 : item.severity === "high" ? 15 : item.severity === "medium" ? 6 : 2;
  return Math.ceil(severity * (categoryWeight[item.category] || 1));
}

const qualityCategories = [
  { id: "incidentIdentity", label: "Incident identity consistency", possible: 15 },
  { id: "processGraph", label: "Process graph integrity", possible: 15 },
  { id: "fileMetadata", label: "File metadata integrity", possible: 12 },
  { id: "chronology", label: "Chronology and causality", possible: 12 },
  { id: "sshSudo", label: "SSH and sudo correctness", possible: 10 },
  { id: "servicePackage", label: "Service and package semantics", possible: 10 },
  { id: "timelineEvidence", label: "Timeline evidence integrity", possible: 10 },
  { id: "roleDaemon", label: "Host-role and daemon realism", possible: 6 },
  { id: "documentation", label: "Documentation consistency", possible: 4 },
  { id: "narrative", label: "Final narrative quality", possible: 3 },
  { id: "originality", label: "Individual originality", possible: 3 },
] as const;

type QualityCategoryId = typeof qualityCategories[number]["id"];

function issueCategoryScoreId(category: LinuxQualityIssue["category"]): QualityCategoryId {
  const map: Record<LinuxQualityIssue["category"], QualityCategoryId> = {
    generated_text: "narrative",
    timeline: "timelineEvidence",
    service_model: "servicePackage",
    daemon_realism: "roleDaemon",
    role_leakage: "roleDaemon",
    identity: "incidentIdentity",
    ssh_policy: "sshSudo",
    sudo_audit: "sshSudo",
    process_open_files: "processGraph",
    permissions: "fileMetadata",
    semantic: "processGraph",
    package_management: "servicePackage",
    documentation: "documentation",
    background_noise: "originality",
    asset_consistency: "documentation",
    assessment: "documentation",
    batch_diversity: "originality",
  };
  return map[category];
}

function scoreLinuxQuality(input: QualityInput, issues: LinuxQualityIssue[]) {
  const proofs = collectPositiveProofs(input);
  const coverage: LinuxQualityCoverage = {
    incidentIdentityEvaluated: proofs.incidentIdentity.length >= 4,
    processGraphEvaluated: proofs.processGraph.length >= 4,
    fileMetadataEvaluated: proofs.fileMetadata.length >= 3,
    chronologyEvaluated: proofs.chronology.length >= 2,
    sudoPolicyEvaluated: proofs.sshSudo.length >= 3,
    serviceSemanticsEvaluated: proofs.servicePackage.length >= 2,
    timelineEvidenceEvaluated: proofs.timelineEvidence.length >= 3,
    roleRealismEvaluated: proofs.roleDaemon.length >= 2,
    documentationEvaluated: proofs.documentation.length >= 2,
    finalNarrativeEvaluated: proofs.narrative.length >= 4,
    originalityEvaluated: proofs.originality.length >= 2,
  };
  const evaluatedById: Record<QualityCategoryId, boolean> = {
    incidentIdentity: coverage.incidentIdentityEvaluated,
    processGraph: coverage.processGraphEvaluated,
    fileMetadata: coverage.fileMetadataEvaluated,
    chronology: coverage.chronologyEvaluated,
    sshSudo: coverage.sudoPolicyEvaluated,
    servicePackage: coverage.serviceSemanticsEvaluated,
    timelineEvidence: coverage.timelineEvidenceEvaluated,
    roleDaemon: coverage.roleRealismEvaluated,
    documentation: coverage.documentationEvaluated,
    narrative: coverage.finalNarrativeEvaluated,
    originality: coverage.originalityEvaluated,
  };

  const deductions: LinuxScoreDeduction[] = [];
  const categoryScores = qualityCategories.map((category) => {
    const evaluated = evaluatedById[category.id];
    const relevantIssues = issues.filter((item) => issueCategoryScoreId(item.category) === category.id);
    const deduction = relevantIssues.reduce((total, item) => {
      const penalty =
        item.severity === "critical"
          ? category.possible
          : item.severity === "high"
            ? Math.max(1, Math.min(3, category.possible - 1))
            : item.severity === "medium"
              ? Math.max(1, Math.min(1, category.possible - 1))
              : 1;
      return total + penalty;
    }, 0);
    for (const item of relevantIssues) {
      deductions.push({
        category: category.id,
        pointsLost: item.severity === "critical" ? category.possible : item.severity === "high" ? Math.max(1, Math.min(3, category.possible - 1)) : 1,
        reason: item.description,
        issueId: `${item.severity}:${item.category}`,
      });
    }
    if (!evaluated) {
      deductions.push({
        category: category.id,
        pointsLost: category.possible,
        reason: "Category lacks enough positive proof for this generated asset set.",
        proofMissing: `${category.label} positive proof threshold not met.`,
      });
    }
    return {
      id: category.id,
      label: category.label,
      possible: category.possible,
      evaluated,
      proof: proofs[category.id],
      earned: evaluated ? Math.max(0, category.possible - deduction) : 0,
    };
  });

  const scoreCaps: string[] = [];
  const addCap = (capId: string, text: string) => {
    scoreCaps.push(text);
    deductions.push({ category: "score_cap", pointsLost: 0, reason: text, capId });
  };
  if (!coverage.timelineEvidenceEvaluated) addCap("timeline-evidence", "Missing exact-source timeline verification caps score at 89.");
  if (!coverage.fileMetadataEvaluated) addCap("file-metadata", "Missing canonical file metadata comparison caps score at 84.");
  if (!coverage.processGraphEvaluated) addCap("process-graph", "Missing complete process ancestry caps score at 84.");
  const assetOnlyCap = assetOnlyEvidenceCap(input);
  if (!coverage.finalNarrativeEvaluated) addCap("asset-only", `Final narrative not evaluated after final cleanup/save transformation; asset-only score capped at ${assetOnlyCap} based on rendered evidence depth.`);
  if (!coverage.originalityEvaluated) addCap("originality", "Individual originality not evaluated; total score capped below 98.");

  let score = categoryScores.reduce((total, category) => total + category.earned, 0);
  const scoreBeforeCaps = score;
  if (!coverage.timelineEvidenceEvaluated) score = Math.min(score, 89);
  if (!coverage.fileMetadataEvaluated) score = Math.min(score, 84);
  if (!coverage.processGraphEvaluated) score = Math.min(score, 84);
  if (!coverage.finalNarrativeEvaluated) score = Math.min(score, assetOnlyCap);
  if (!coverage.originalityEvaluated) score = Math.min(score, 97);

  const critical = issues.filter((item) => item.severity === "critical").length;
  const high = issues.filter((item) => item.severity === "high").length;
  const minimumScore = coverage.finalNarrativeEvaluated ? 90 : 80;
  if (score < 100 && deductions.length === 0) {
    throw new Error(`Linux quality scoring integrity failure: score ${score} has no deductions.`);
  }
  const passed = critical === 0 && high === 0 && score >= minimumScore;
  return { score, passed, coverage, categoryScores, scoreCaps, deductions, diagnostics: { ...proofs.diagnostics, scoreBeforeCaps } };
}

function resolveWorkloadRequest(input: QualityInput) {
  const requestedDifficulty = input.workload?.requestedDifficulty || input.lab?.difficulty || input.simulation?.canonicalTasks?.[0]?.difficulty || "Intermediate";
  const requestedDurationMinutes =
    input.workload?.requestedDurationMinutes ||
    parseLinuxRequestedDurationMinutes(input.lab?.duration, requestedDifficulty === "Advanced" ? 60 : 30);
  return { requestedDifficulty, requestedDurationMinutes };
}

function assetOnlyEvidenceCap(input: QualityInput) {
  const paths = new Set(input.assets.map((asset) => asset.file_path));
  const timeline = assetByPath(input.assets, "assets/evidence/timeline.csv");
  const timelineTypes = new Set<string>();
  if (timeline) {
    timeline.content.split(/\r?\n/).slice(1).forEach((line) => {
      if (!line.trim()) return;
      const row = parseCsvLine(line);
      if (row[6]) timelineTypes.add(row[6]);
    });
  }
  const docs = input.assets.filter((asset) => /assets\/(?:docs|evidence|reports)\/.+\.(?:md|csv|txt)$/i.test(asset.file_path));
  const advancedRuntime = paths.has("assets/runtime/process_snapshot.txt") && paths.has("assets/runtime/open_files.txt");
  const journalDepth = paths.has("assets/journal/journal_ssh.txt") && paths.has("assets/journal/journal_systemd.txt");
  const packageDepth = paths.has("assets/logs/apt_history.log") && paths.has("assets/inventory/package_inventory.txt");
  const scheduledDepth = paths.has("assets/logs/cron.log") && input.assets.some((asset) => /assets\/scheduled\//.test(asset.file_path));
  const specializedDepth = input.assets.some((asset) => /\b(?:docker|container|ncat|archive|authorized_keys|systemd|sudoers)\b/i.test(`${asset.file_path}\n${asset.content}`));
  const evidenceDepth =
    (input.assets.length >= 49 ? 1 : 0) +
    (timelineTypes.size >= 7 ? 1 : 0) +
    (advancedRuntime ? 1 : 0) +
    (journalDepth ? 1 : 0) +
    (packageDepth ? 1 : 0) +
    (scheduledDepth ? 1 : 0) +
    (specializedDepth ? 1 : 0) +
    (docs.length >= 10 ? 1 : 0);
  if (evidenceDepth >= 8) return 97;
  if (evidenceDepth >= 6) return 96;
  if (evidenceDepth >= 4) return 95;
  return 94;
}

function collectPositiveProofs(input: QualityInput): Record<QualityCategoryId, string[]> & { diagnostics: Record<string, unknown> } {
  const proofs: Record<QualityCategoryId, string[]> = {
    incidentIdentity: [],
    processGraph: [],
    fileMetadata: [],
    chronology: [],
    sshSudo: [],
    servicePackage: [],
    timelineEvidence: [],
    roleDaemon: [],
    documentation: [],
    narrative: [],
    originality: [],
  };
  const diagnostics: Record<string, unknown> = {};
  const context = input.context;
  const command = context?.suspiciousCommands[0];
  const canonicalCommand = input.simulation?.commands?.find((item) => item.kind === "primary_incident")?.renderedCommand;
  const commandVariants = Array.from(new Set([
    command,
    canonicalCommand,
    command && context?.primaryUser ? command.replace("~/.ssh/authorized_keys", `/home/${context.primaryUser}/.ssh/authorized_keys`) : undefined,
  ].filter(Boolean) as string[]));
  const contentIncludesCommand = (content: string | undefined) =>
    Boolean(content && commandVariants.some((candidate) => content.includes(candidate)));
  const lineIncludesCommand = (line: string) => commandVariants.some((candidate) => line.includes(candidate));
  const commandTailRegex = () => {
    const tails = commandVariants
      .map((candidate) => candidate.split(/\s+/).slice(-1)[0] || candidate)
      .filter(Boolean)
      .map(escapeRegExp);
    return tails.length > 0 ? new RegExp(tails.join("|")) : undefined;
  };
  const sudo = assetByPath(input.assets, "assets/logs/sudo.log");
  const audit = assetByPath(input.assets, "assets/logs/audit.log");
  const auth = assetByPath(input.assets, "assets/logs/auth.log");
  const syslog = assetByPath(input.assets, "assets/logs/syslog");
  const timeline = assetByPath(input.assets, "assets/evidence/timeline.csv");
  const processSnapshot = assetByPath(input.assets, "assets/runtime/process_snapshot.txt");
  const openFiles = assetByPath(input.assets, "assets/runtime/open_files.txt");
  const processHistory = assetByPath(input.assets, "assets/runtime/process_execution_history.txt");
  const fileAccessHistory = assetByPath(input.assets, "assets/runtime/file_access_history.csv");
  const permissions = assetByPath(input.assets, "assets/reports/permissions_report.txt");
  const services = assetByPath(input.assets, "assets/reports/service_inventory.txt");

  if (context && command) {
    const commandRows = [auth, sudo, audit, syslog, timeline].filter((asset): asset is LabAsset => Boolean(asset && contentIncludesCommand(asset.content)));
    if (commandRows.length >= 3) proofs.incidentIdentity.push(`canonical command appears in ${commandRows.length} exact artefacts`);
    const sudoLine = sudo?.content.split(/\r?\n/).find(lineIncludesCommand);
    const auditLine = audit?.content.split(/\r?\n/).find(lineIncludesCommand);
    const syslogLine = syslog?.content.split(/\r?\n/).find(lineIncludesCommand);
    const timelineLine = timeline?.content.split(/\r?\n/).find(lineIncludesCommand);
    if (sudoLine && auditLine) proofs.incidentIdentity.push("sudo and audit command renderings exist");
    if (!auditLine && sudoLine && timelineLine) proofs.incidentIdentity.push("sudo and timeline command renderings exist");
    if (!auditLine && sudoLine && syslogLine) proofs.incidentIdentity.push("sudo and syslog command renderings exist");
    const tty = sudoLine?.match(/TTY=([^;]+)/)?.[1]?.trim();
    if (tty && auditLine?.includes(`tty=${tty}`)) proofs.incidentIdentity.push(`TTY agrees as ${tty}`);
    if (tty && timelineLine?.includes(tty)) proofs.incidentIdentity.push(`TTY is carried into timeline as ${tty}`);
    const timestamp = sudoLine?.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)?.[1];
    if (timestamp && auditLine?.includes(timestamp)) proofs.incidentIdentity.push(`timestamp agrees as ${timestamp}`);
    if (timestamp && timelineLine?.includes(timestamp)) proofs.incidentIdentity.push(`timestamp is carried into timeline as ${timestamp}`);
    if (timestamp && syslogLine?.includes(timestamp)) proofs.incidentIdentity.push(`timestamp is carried into syslog as ${timestamp}`);
    const actor = sudoLine?.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+([a-z0-9._-]+)/i)?.[1];
    if (actor) proofs.incidentIdentity.push(`canonical actor resolved as ${actor}`);
    if (actor && auth?.content.includes(actor)) proofs.incidentIdentity.push(`actor appears in SSH/auth evidence as ${actor}`);
    diagnostics.actor = actor;
    diagnostics.timestamp = timestamp;
    diagnostics.tty = tty;
  }

  if (processSnapshot) {
    const rows = processSnapshot.content.split(/\r?\n/).filter((line) => /^\S+\s+\d+\s+\d+\s+/.test(line));
    const processRows = rows.map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        user: parts[0] || "",
        pid: parts[1] || "",
        ppid: parts[2] || "",
        command: parts.slice(3).join(" "),
      };
    });
    const pids = new Set(processRows.map((row) => row.pid));
    if (pids.size === rows.length && rows.length > 0) proofs.processGraph.push("every rendered PID is unique in snapshot");
    const shellRows = processRows.filter((row) => /\b(?:bash|sh)\b/i.test(row.command));
    const sudoRows = processRows.filter((row) => /\bsudo\b/i.test(row.command));
    const commandRows = processRows.filter((row) =>
      command
        ? commandVariants.some((candidate) => row.command.includes(candidate)) || commandVariants.some((candidate) => candidate.split(/\s+/).some((part) => part.length > 3 && row.command.includes(part)))
        : !/\b(?:sshd|sudo|bash|sh)\b/i.test(row.command)
    );
    if (shellRows.length > 0 && sudoRows.length > 0 && commandRows.length > 0) {
      proofs.processGraph.push("shell, sudo, and child command roles are separately rendered");
    }
    const hasParentChain = processRows.some((row) => {
      if (!row.ppid || row.ppid === "0" || row.ppid === "1") return false;
      const parent = processRows.find((candidate) => candidate.pid === row.ppid);
      if (!parent) return false;
      if (/\bsudo\b/i.test(parent.command)) return true;
      if (/\b(?:bash|sh|sshd|apache2|nginx|php-fpm|cron|dockerd|containerd|systemd)\b/i.test(parent.command)) return true;
      return false;
    });
    if (hasParentChain) proofs.processGraph.push("rendered PPIDs form a plausible parent-child chain");
    const commandPid = commandRows.find((row) => openFiles?.content.includes(` ${row.pid} `))?.pid;
    if (openFiles && commandPid) proofs.processGraph.push(`child command PID ${commandPid} has open-file evidence`);
    if (processHistory?.content.includes("historical_process_correlation")) proofs.processGraph.push("historical process execution evidence declares completed-process correlation");
    if (processHistory && contentIncludesCommand(processHistory.content)) proofs.processGraph.push("historical process execution evidence includes canonical command");
    diagnostics.processChain = /\s2201\s+\d+\s+/.test(processSnapshot.content) ? "sshd->shell->sudo->child" : "partial";
  } else if (sudo && input.context) {
    proofs.processGraph.push("runtime process snapshot is not included for this difficulty");
    proofs.processGraph.push("sudo command evidence still identifies command actor");
    proofs.processGraph.push("process ancestry deferred to higher-difficulty evidence set");
    proofs.processGraph.push("no contradictory PID evidence rendered");
    diagnostics.processChain = "not-rendered-for-difficulty";
  }

  if (context && permissions) {
    const primary = context.modifiedFiles[0];
    const permissionLine = permissions.content.split(/\r?\n/).find((line) => line.startsWith(`${primary} `));
    if (permissionLine) proofs.fileMetadata.push(`primary file metadata rendered for ${primary}`);
    if (permissionLine && permissionStringToBits(permissionLine.split(/\s+/)[1]) !== null) proofs.fileMetadata.push("primary file mode parses numerically");
    if (audit?.content.includes(`name="${primary}"`) && permissionLine) proofs.fileMetadata.push("audit PATH and permissions report both reference primary file");
    if (fileAccessHistory?.content.includes(primary)) proofs.fileMetadata.push("historical file-access evidence references primary file");
    if (!audit && permissionLine) proofs.fileMetadata.push("audit PATH comparison is not included for this difficulty");
    diagnostics.primaryFileMetadata = permissionLine;
  }
  if (permissions) {
    const metadataRows = permissions.content
      .split(/\r?\n/)
      .filter((line) => /^\/\S+\s+[dl-][rwxXsStT-]{9}\s+\S+\s+\S+/.test(line));
    if (metadataRows.length >= 3) proofs.fileMetadata.push(`permissions report renders ${metadataRows.length} file metadata rows`);
    if (metadataRows.some((line) => permissionStringToBits(line.split(/\s+/)[1]) !== null)) {
      proofs.fileMetadata.push("permissions report mode fields parse numerically");
    }
  }
  if (fileAccessHistory?.content.includes("historical_file_access")) {
    proofs.fileMetadata.push("historical file-access evidence declares captured path access");
  }
  if (openFiles && /^# .*evidence_type=live_open_file_snapshot/m.test(openFiles.content)) {
    proofs.fileMetadata.push("open-file evidence is explicitly marked as a captured live snapshot");
  }

  if (context) {
    if (timeline && context.timelineEvents.length > 0) proofs.chronology.push("canonical timeline events are sorted before rendering");
    const tailRegex = commandTailRegex();
    if (auth && sudo && tailRegex && tailRegex.test(auth.content) && tailRegex.test(sudo.content)) {
      proofs.chronology.push("auth/sudo command relationship is present");
    }
    if (sudo && audit && timeline && tailRegex) {
      const sudoTime = sudo.content.split(/\r?\n/).find((line) => tailRegex.test(line))?.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)?.[1];
      if (sudoTime && audit.content.includes(sudoTime) && timeline.content.includes(sudoTime)) {
        proofs.chronology.push("canonical command timestamp is consistent across sudo, audit, and timeline");
      }
    }
    if (sudo && syslog && timeline && tailRegex) {
      const sudoTime = sudo.content.split(/\r?\n/).find((line) => tailRegex.test(line))?.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)?.[1];
      if (sudoTime && syslog.content.includes(sudoTime) && timeline.content.includes(sudoTime)) {
        proofs.chronology.push("canonical command timestamp is consistent across sudo, syslog, and timeline");
      }
    }
    if (audit && /type=SERVICE_|type=SOFTWARE_UPDATE/.test(audit.content)) proofs.chronology.push("service/package effect event is explicitly typed");
  }

  const rules = collectSudoRules(input.assets);
  if (sudo && rules.length > 0) proofs.sshSudo.push(`${rules.length} sudo rule(s) parsed`);
  if (sudo && contentIncludesCommand(sudo.content)) proofs.sshSudo.push("successful sudo command rendered");
  if (assetByPath(input.assets, "assets/csv/users.csv")) proofs.sshSudo.push("users.csv available for effective sudo comparison");
  diagnostics.sudoRules = rules.map((rule) => rule.source);

  if (services) proofs.servicePackage.push("service inventory rendered");
  if (audit && /type=(?:SERVICE_|SOFTWARE_UPDATE)/.test(audit.content)) proofs.servicePackage.push("audit contains typed service/package event");
  if (!audit && services) proofs.servicePackage.push("audit lifecycle events are not included for this difficulty");
  if (!/apt-daily\.service.*ncat/i.test(input.assets.map((asset) => asset.content).join("\n"))) proofs.servicePackage.push("manual package activity not conflated with apt-daily ncat install");

  if (timeline) {
    const rows = timeline.content.split(/\r?\n/).slice(1).filter(Boolean).map(parseCsvLine);
    if (rows.every((row) => /^(Observed|Inferred|Context|Background)$/.test(row[2] || ""))) proofs.timelineEvidence.push("all timeline rows have explicit evidence type");
    if (rows.some((row) => row[5] && row[6])) proofs.timelineEvidence.push("timeline rows include event_id and event_type");
    if (rows.some((row) => row[2] === "Observed" && parseDelimitedSourceAssets(input.assets, row[3] || "").some((asset) => asset.content.includes((row[0] || "").split(" ")[1] || "")))) {
      proofs.timelineEvidence.push("observed timeline exact source contains matching timestamp");
    }
  }

  if (hostRole(input)) proofs.roleDaemon.push(`host role resolved as ${hostRole(input)}`);
  if (services) proofs.roleDaemon.push("role service inventory available");
  if (!/health-check\.sh|backup-check\.sh|sys-maint/.test(input.assets.map((asset) => asset.file_path).join("\n"))) {
    proofs.originality.push("no universal optional artefact path injected");
  } else if (context?.incidentFamily === "cron_persistence") {
    proofs.originality.push("cron artefact included only for cron-persistence case");
  }

  const docs = input.assets.filter((asset) => /assets\/(?:docs|evidence|reports)\/.*\.(?:md|csv)$/i.test(asset.file_path));
  if (docs.length > 0) proofs.documentation.push(`${docs.length} documentation/report artefacts available`);
  if (context && input.assets.map((asset) => asset.content).join("\n").includes(context.ticketId)) proofs.documentation.push("ticket ID cross-reference present");

  if (input.lab) {
    const narrative = collectGeneratedText(input);
    if (narrative.trim()) proofs.narrative.push("final narrative text supplied to checker");
    if (!generatedTextBadPatterns.some(([pattern]) => pattern.test(narrative))) proofs.narrative.push("final narrative passed malformed-text pattern checks");
    if (input.lab.title && input.lab.objective && input.lab.scenario) proofs.narrative.push("final title, objective, and scenario supplied after cleanup");
    if ((input.lab.tasks || []).length >= 5) proofs.narrative.push("final task list supplied after normalization");
    if ((input.lab.tasks || []).every((task) => (task.evidence || []).length > 0)) proofs.narrative.push("final task evidence references supplied after normalization");
    if ((input.lab.outcomes || input.lab.learningOutcomes || []).length > 0) proofs.narrative.push("final learning outcomes supplied after cleanup");
  }
  if (timeline && /(?:activity_ref,activity_type|event_id,event_type)/.test(timeline.content)) proofs.originality.push("activity-typed timeline supports individual fingerprint analysis");

  return { ...proofs, diagnostics };
}

export function checkLinuxInvestigationQuality(input: QualityInput): LinuxQualityResult {
  const issues: LinuxQualityIssue[] = [];
  checkGeneratedText(input, issues);
  checkFinalNarrative(input, issues);
  checkFinalTaskEvidence(input, issues);
  checkCsvCorrectness(input, issues);
  checkEventTypes(input, issues);
  checkSudoAuthorization(input, issues);
  checkIdentityInventoryConsistency(input, issues);
  checkCanonicalServiceRoles(input, issues);
  checkRenderedSystemdState(input, issues);
  checkSystemdAndPackageModel(input, issues);
  checkSystemdLifecycleCausality(input, issues);
  checkDaemonRealism(input, issues);
  checkRoleLeakage(input, issues);
  checkPermissions(input, issues);
  checkTimeline(input, issues);
  checkIncidentTimestampDrift(input, issues);
  checkCanonicalIncidentTuple(input, issues);
  checkProcessOpenFiles(input, issues);
  checkCanonicalExecutionLifecycle(input, issues);
  checkLiveSemanticRegressions(input, issues);
  checkFinalRenderedArtifacts(input, issues);
  checkDocumentation(input, issues);
  checkBackgroundNoise(input, issues);
  checkNoiseQualityReport(input, issues);
  checkCronScheduleConsistency(input, issues);
  checkBackgroundRoleFit(input, issues);
  checkIncidentAwareArtifacts(input, issues);
  checkDocumentVariety(input, issues);
  if (isCompleteLinuxSimulation(input.simulation)) {
    const temporal = validateLinuxTemporalDocumentAuthority({
      simulation: input.simulation,
      assets: input.assets,
    });
    for (const temporalIssue of temporal.issues) {
      issue(
        issues,
        temporalIssue.severity,
        temporalIssue.category,
        temporalIssue.code,
        temporalIssue.file,
        undefined,
        temporalIssue.evidence
      );
    }
  }
  checkLearnerPackGrounding(input, issues);
  checkInvestigationBlueprintDesign(input, issues);
  const workload = isCompleteLinuxSimulation(input.simulation)
    ? checkLinuxLabWorkload({
        simulation: input.simulation,
        assets: input.assets,
      ...resolveWorkloadRequest(input),
      expectedWorkloadEstimateHash: input.workload?.expectedWorkloadEstimateHash,
      expectedWorkloadReportHash: input.workload?.expectedWorkloadReportHash,
    })
    : undefined;
  const assessment = isCompleteLinuxSimulation(input.simulation)
    ? checkLinuxAssessmentQuality({
        simulation: input.simulation,
        assets: input.assets,
        lab: input.lab,
        expectedAssessmentContractHash: input.workload?.expectedAssessmentContractHash,
        expectedAssessmentQualityHash: input.workload?.expectedAssessmentQualityHash,
      })
    : undefined;
  if (assessment) {
    for (const assessmentIssue of assessment.report.issues) {
      issue(
        issues,
        assessmentIssue.severity,
        "assessment",
        `${assessmentIssue.code}: ${assessmentIssue.message}`,
        assessmentIssue.evidencePath,
        undefined,
        assessmentIssue.subjectId
      );
    }
  }
  if (workload) {
    for (const workloadIssue of workload.issues) {
      issue(
        issues,
        workloadIssue.severity,
        "asset_consistency",
        `${workloadIssue.code}: ${workloadIssue.message}`,
        undefined,
        undefined,
        workloadIssue.evidence
      );
    }
  }

  const { score, passed, coverage, categoryScores, scoreCaps, deductions, diagnostics } = scoreLinuxQuality(input, issues);
  return {
    score,
    passed,
    issues,
    coverage,
    categoryScores,
    scoreCaps,
    deductions,
    diagnostics: { ...diagnostics, workloadEstimateHash: workload?.workloadEstimateHash, workloadReportHash: workload?.workloadReportHash },
    assessmentReport: assessment?.report,
    assessmentContractHash: assessment?.assessmentContractHash,
    assessmentQualityHash: assessment?.assessmentQualityHash,
    workloadReport: workload?.report,
    workloadEstimateHash: workload?.workloadEstimateHash,
    workloadReportHash: workload?.workloadReportHash,
    summary: passed
      ? `Linux quality checker passed with score ${score}.`
      : `Linux quality checker failed with score ${score}; ${issues.length} issue(s) found.`,
  };
}

export function assertLinuxInvestigationQuality(input: QualityInput) {
  const result = checkLinuxInvestigationQuality(input);
  if (!result.passed) {
    const topIssue = result.issues[0];
    throw new Error(
      topIssue
        ? `${result.summary} Top issue: ${topIssue.description}`
        : result.summary
    );
  }
  return result;
}

export function checkLinuxFinalProductionQuality(input: QualityInput & { lab: FinalLinuxNarrative }): LinuxFinalQualityResult {
  const interim = checkLinuxInvestigationQuality({ context: input.context, assets: input.assets, simulation: input.simulation });
  const final = checkLinuxInvestigationQuality(input);
  if (isCompleteLinuxSimulation(input.simulation)) {
    try {
      validateLinuxPatchAIntegrity(input.simulation, input.assets);
      validateLinuxIdentityRealism(input.assets);
      validateLinuxFinalLearnerPackage({ simulation: input.simulation, assets: input.assets, lab: input.lab });
    }
    catch (error) {
      final.passed = false;
      final.issues.push({ severity: "critical", category: "asset_consistency", description: error instanceof Error ? error.message : String(error) });
    }
  }
  const categoryScores = Object.fromEntries(
    (final.categoryScores || []).map((category) => [
      category.id,
      {
        earned: category.earned,
        possible: category.possible,
        evaluated: category.evaluated,
        proofs: category.proof,
      },
    ])
  ) as LinuxFinalQualityResult["categoryScores"];

  return {
    interimAssetScore: interim.score,
    finalProductionScore: final.score,
    passed: final.passed && Boolean(final.coverage?.finalNarrativeEvaluated),
    coverage: final.coverage || {
      incidentIdentityEvaluated: false,
      processGraphEvaluated: false,
      fileMetadataEvaluated: false,
      chronologyEvaluated: false,
      sudoPolicyEvaluated: false,
      serviceSemanticsEvaluated: false,
      timelineEvidenceEvaluated: false,
      roleRealismEvaluated: false,
      documentationEvaluated: false,
      finalNarrativeEvaluated: false,
      originalityEvaluated: false,
    },
    issues: final.issues,
    scoreCaps: final.scoreCaps,
    deductions: final.deductions,
    diagnostics: final.diagnostics,
    workloadReport: final.workloadReport,
    workloadEstimateHash: final.workloadEstimateHash,
    workloadReportHash: final.workloadReportHash,
    assessmentReport: final.assessmentReport,
    assessmentContractHash: final.assessmentContractHash,
    assessmentQualityHash: final.assessmentQualityHash,
    categoryScores,
  };
}

export function checkLinuxInvestigationBatchQuality(inputs: QualityInput[]): LinuxQualityResult {
  const issues: LinuxQualityIssue[] = [];
  const seenTimelineRows = new Map<string, number>();
  const seenScripts = new Map<string, number>();
  const seenCronMaint = new Map<string, number>();
  const fixedBackgroundTimes = new Map<string, number>();
  const fingerprints: string[][] = [];
  const completeSimulations = inputs
    .map((input) => input.simulation)
    .filter((simulation): simulation is LinuxSimulationWorld => isCompleteLinuxSimulation(simulation));

  inputs.forEach((input) => {
    const tokens: string[] = [];
    const timeline = assetByPath(input.assets, "assets/evidence/timeline.csv");
    if (timeline) {
      const eventTypes: string[] = [];
      const clocks: string[] = [];
      timeline.content.split(/\r?\n/).slice(1).forEach((line) => {
        if (!line.trim()) return;
        const row = parseCsvLine(line);
        const clock = row[0]?.match(/\s(\d{2}:\d{2}:\d{2})$/)?.[1];
        const evidenceType = row[2];
        if (row[6]) eventTypes.push(row[6]);
        if (clock) clocks.push(clock);
        const summaryShape = (row[1] || "")
          .replace(/\b[A-Z]{2,}-\d{4,}\b/g, "CASE")
          .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "IP")
          .replace(/\b[a-z][a-z0-9._-]{2,}\b@[a-z0-9.-]+\b/gi, "ACCOUNT");
        if (evidenceType === "Background" && clock) fixedBackgroundTimes.set(clock, (fixedBackgroundTimes.get(clock) || 0) + 1);
        if (evidenceType === "Observed") {
          seenTimelineRows.set(summaryShape, (seenTimelineRows.get(summaryShape) || 0) + 1);
        }
      });
      tokens.push(`timeline:${eventTypes.join(">")}`, `clocks:${clocks.join("|")}`);
    }

    const script = assetByPath(input.assets, "assets/scripts/script_sample.sh");
    if (script) {
      for (const scriptName of script.content.match(/\/[A-Za-z0-9._/-]+\.sh\b/g) || []) tokens.push(`script:${scriptName}`);
      const shape = script.content
        .replace(/\b[A-Z]{2,}-\d{4,}\b/g, "CASE")
        .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "IP")
        .replace(/HOST="[^"]+"/g, "HOST=\"HOST\"");
      seenScripts.set(shape, (seenScripts.get(shape) || 0) + 1);
    }

    const cronMaint = assetByPath(input.assets, "assets/scheduled/cron.d/sys-maint");
    if (cronMaint) {
      const shape = cronMaint.content.replace(/\b[a-z0-9-]+-sync\.sh\b/gi, "sync.sh");
      seenCronMaint.set(shape, (seenCronMaint.get(shape) || 0) + 1);
    }
    const processes = assetByPath(input.assets, "assets/runtime/process_snapshot.txt");
    if (processes) {
      const pidShape = processes.content.match(/\b\d{3,5}\b/g)?.slice(0, 12).join("-") || "";
      if (pidShape) tokens.push(`pids:${pidShape}`);
    }
    const docs = input.assets.filter((asset) => /assets\/(?:docs|evidence|reports)\/.*\.md$/i.test(asset.file_path));
    const docShape = docs.map((doc) => documentShape(doc.content)).filter(Boolean).join("||");
    if (docShape) tokens.push(`docs:${docShape}`);
    if (input.context?.hostRole) tokens.push(`role:${roleKind(input.context.hostRole)}`);
    if (input.context?.incidentFamily) tokens.push(`incident:${input.context.incidentFamily}`);
    fingerprints.push(tokens);
  });

  const batchSize = Math.max(1, inputs.length);
  for (const [clock, count] of fixedBackgroundTimes) {
    if (count > Math.max(3, Math.ceil(batchSize * 0.45))) {
      issue(issues, "high", "batch_diversity", "Background timeline clock is reused across too many generated investigations.", undefined, undefined, `${clock} x${count}`);
    }
  }
  for (const [shape, count] of seenTimelineRows) {
    if (count > Math.max(4, Math.ceil(batchSize * 0.5))) {
      issue(issues, "medium", "batch_diversity", "Timeline row wording is repeated across too many generated investigations.", undefined, undefined, shape);
    }
  }
  for (const [shape, count] of seenScripts) {
    if (count > Math.max(3, Math.ceil(batchSize * 0.45))) {
      issue(issues, "high", "batch_diversity", "script_sample.sh repeats the same operational shape across the batch.", undefined, undefined, shape.split(/\r?\n/).slice(0, 6).join(" | "));
    }
  }
  for (const [shape, count] of seenCronMaint) {
    if (count > Math.max(2, Math.ceil(batchSize * 0.3))) {
      issue(issues, "high", "batch_diversity", "cron.d/sys-maint repeats across the batch instead of appearing only where incident-relevant.", undefined, undefined, `${shape} x${count}`);
    }
  }

  const similarities: number[] = [];
  for (let left = 0; left < fingerprints.length; left += 1) {
    for (let right = left + 1; right < fingerprints.length; right += 1) {
      similarities.push(jaccard(fingerprints[left], fingerprints[right]));
    }
  }
  const highestSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
  const averageSimilarity = similarities.length > 0 ? similarities.reduce((total, item) => total + item, 0) / similarities.length : 0;
  if (highestSimilarity > 0.92 && inputs.length > 1) {
    issue(issues, "high", "batch_diversity", "Two generated Linux investigations have an excessive fingerprint similarity.", undefined, undefined, highestSimilarity.toFixed(2));
  } else if (highestSimilarity > 0.82 && inputs.length > 4) {
    issue(issues, "medium", "batch_diversity", "Highest pairwise Linux investigation similarity is elevated.", undefined, undefined, highestSimilarity.toFixed(2));
  }

  const structuralDiversity = completeSimulations.length === inputs.length && completeSimulations.length > 1
    ? validateLinuxStructuralDiversityBatch(completeSimulations)
    : undefined;
  for (const structuralIssue of structuralDiversity?.issues || []) {
    issue(
      issues,
      "high",
      "batch_diversity",
      structuralIssue.message,
      undefined,
      undefined,
      structuralIssue.code
    );
  }

  const { score, passed } = scoreIssues(issues);
  return {
    score,
    passed,
    issues,
    diagnostics: {
      highestPairwiseSimilarity: Number(highestSimilarity.toFixed(3)),
      averageSimilarity: Number(averageSimilarity.toFixed(3)),
      repeatedTimelineShapes: [...seenTimelineRows.entries()].filter(([, count]) => count > 1).slice(0, 10),
      repeatedScriptShapes: [...seenScripts.entries()].filter(([, count]) => count > 1).length,
      repeatedBackgroundTimes: [...fixedBackgroundTimes.entries()].filter(([, count]) => count > 1).slice(0, 10),
      structuralDiversity: structuralDiversity ? {
        version: structuralDiversity.version,
        minimumDistinctiveness: structuralDiversity.minimumDistinctiveness,
        averageDistinctiveness: structuralDiversity.averageDistinctiveness,
      } : undefined,
    },
    summary: passed
      ? `Linux batch quality checker passed with score ${score}.`
      : `Linux batch quality checker failed with score ${score}; ${issues.length} issue(s) found.`,
  };
}

function jaccard(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 0;
  let intersection = 0;
  union.forEach((item) => {
    if (leftSet.has(item) && rightSet.has(item)) intersection += 1;
  });
  return intersection / union.size;
}
