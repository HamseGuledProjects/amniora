import type { LabAsset } from "../types";
import type { CanonicalMaintenanceActivity, LinuxSimulationWorld } from "./simulation";
import { evidenceCsvRows, hasExplicitTelemetryLoss, linuxLoggingQualityClaim, resolveExportedEvidence } from "./evidenceAuthority";
import { linuxLearnerSubjectLabel, simulationScriptAssets } from "./simulation";
import { assertAdvancedSshKeyTaskCorrelation } from "./sshKeyTaskCorrelation";

export type LinuxApprovalDecision = "unknown" | "approved" | "rejected";
export type LinuxEvidenceAvailability = "available" | "partial" | "unavailable";
export type LinuxSourceCompleteness = "complete" | "partial" | "unknown";

export type LinuxEvidenceBackedClaim = {
  subjectId: string;
  predicate: "approval_decision";
  value: LinuxApprovalDecision;
  evidenceAvailability: LinuxEvidenceAvailability;
  observation: "record_supplied" | "record_not_supplied";
  interpretation: "none" | "bounded";
  confidence: "unknown" | "supported" | "confirmed";
  sourceCompleteness: LinuxSourceCompleteness;
  support: Array<{
    sourcePath: string;
    relationship: "describes_approval_scope" | "records_approval_decision";
  }>;
};

type LinuxLearnerPackageLab = {
  title?: string;
  topic?: string;
  category?: string;
  objective?: string;
  scenario?: string;
  tasks?: Array<string | { phase?: string; title?: string; description?: string; deliverable?: string; evidence?: string[] }>;
  hints?: string[];
  outcomes?: string[];
  learningOutcomes?: string[];
};

const DEFAULT_APPROVAL_SOURCES = [
  "assets/docs/change_request.md",
  "assets/docs/maintenance_ticket.md",
];

export function linuxMaintenanceApprovalDecision(activity: CanonicalMaintenanceActivity): LinuxApprovalDecision {
  // `approved: false` was historically used for both explicit rejection and
  // unknown approval. It can no longer establish a negative decision.
  if (activity.approvalDecision === "rejected") return "rejected";
  if (activity.approved === true || activity.approvalDecision === "approved") return "approved";
  return "unknown";
}

export function linuxMaintenanceIsApproved(activity: CanonicalMaintenanceActivity) {
  return linuxMaintenanceApprovalDecision(activity) === "approved";
}

export function linuxApprovalAuthority(simulation: LinuxSimulationWorld): LinuxEvidenceBackedClaim {
  const activity = simulation.maintenanceActivities[0];
  if (!activity) {
    return {
      subjectId: "maintenance:unavailable",
      predicate: "approval_decision",
      value: "unknown",
      evidenceAvailability: "unavailable",
      observation: "record_not_supplied",
      interpretation: "bounded",
      confidence: "unknown",
      sourceCompleteness: "unknown",
      support: [],
    };
  }

  const decision = linuxMaintenanceApprovalDecision(activity);
  const evidenceAvailability = activity.approvalEvidenceAvailability || "partial";
  const sourcePaths = activity.approvalSourcePaths?.length
    ? activity.approvalSourcePaths
    : DEFAULT_APPROVAL_SOURCES;
  return {
    subjectId: activity.id,
    predicate: "approval_decision",
    value: decision,
    evidenceAvailability,
    observation: evidenceAvailability === "unavailable" ? "record_not_supplied" : "record_supplied",
    interpretation: decision === "unknown" ? "bounded" : "none",
    confidence: decision === "unknown" ? "unknown" : "confirmed",
    sourceCompleteness: activity.approvalSourceCompleteness || (decision === "unknown" ? "partial" : "complete"),
    support: sourcePaths.map((sourcePath) => ({
      sourcePath,
      relationship: decision === "unknown" ? "describes_approval_scope" : "records_approval_decision",
    })),
  };
}

export function linuxApprovalStatusSentence(simulation: LinuxSimulationWorld) {
  const claim = linuxApprovalAuthority(simulation);
  if (claim.value === "approved") {
    return "Approval decision: explicitly approved by the supplied approval record.";
  }
  if (claim.value === "rejected") {
    return "Approval decision: explicitly rejected by the supplied approval record.";
  }
  if (claim.evidenceAvailability === "unavailable") {
    return "Approval decision: unknown because no approval record is supplied.";
  }
  return "Approval decision: not established by the supplied evidence; no explicit approval or rejection decision is present.";
}

export function linuxApprovalGapFinding(simulation: LinuxSimulationWorld) {
  const claim = linuxApprovalAuthority(simulation);
  if (claim.value === "approved") return "Approval record: the supplied record explicitly approves the documented scope";
  if (claim.value === "rejected") return "Approval record: the supplied record explicitly rejects the documented scope";
  return "Unverified hypothesis: the supplied evidence does not establish an approval or rejection decision for the observed activity";
}

function finalLabText(lab: LinuxLearnerPackageLab | undefined) {
  if (!lab) return "";
  const taskText = (lab.tasks || []).map((task) => {
    if (typeof task === "string") return task;
    return [task.phase, task.title, task.description, task.deliverable, ...(task.evidence || [])].filter(Boolean).join("\n");
  });
  return [
    lab.title,
    lab.topic,
    lab.category,
    lab.objective,
    lab.scenario,
    ...taskText,
    ...(lab.hints || []),
    ...(lab.outcomes || []),
    ...(lab.learningOutcomes || []),
  ].filter(Boolean).join("\n");
}

function changeWindowMatchesTransactionLocalDate(authority: string, transaction: string) {
  const start = transaction.match(/\bStart-Date:\s*(\d{4}-\d\d-\d\d)\s+(\d\d:\d\d)/)?.slice(1);
  if (!start) return false;
  const window = authority.match(/^Investigation window:\s*(\d{4}-\d\d-\d\d)\s+\d\d:\d\d-\d\d:\d\d\s+([A-Za-z_\/+:-]+)\b/mi);
  if (!window) return authority.includes(start[0]);
  const instant = Date.parse(`${start[0]}T${start[1]}:00Z`);
  if (!Number.isFinite(instant)) return false;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: window[2], year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}` === window[1];
  } catch {
    return false;
  }
}

/** Check the actual serialized task, not the planner's intended evidence set. */
export function assertLinuxPackageMaintenanceTaskEvidence(input: {
  incidentFamily: string;
  assets: LabAsset[];
  lab?: LinuxLearnerPackageLab;
}) {
  if (input.incidentFamily !== "unauthorized_package_install") return;
  for (const task of input.lab?.tasks || []) {
    const taskText = typeof task === "string"
      ? task
      : [task.title, task.description, task.deliverable].filter(Boolean).join("\n");
    const evidence = typeof task === "string" ? [] : task.evidence || [];
    const selected = input.assets.filter((asset) => evidence.includes(asset.file_path));
    const comparesConfigurationState = /\bcompar(?:e|ing)\b[^.!?\n]{0,120}\bconfiguration baseline\b[^.!?\n]{0,120}\b(?:runtime|observed|captured)\s+(?:service\s+)?state\b/i.test(taskText);
    if (comparesConfigurationState) {
      const baseline = selected.find((asset) => asset.file_path === "assets/configs/linux_config_pack.txt" &&
        /\bExpected service baseline\b/i.test(asset.content) && /\bincident-time effectiveness not established\b/i.test(asset.content));
      const captured = selected.find((asset) => asset.file_path === "assets/reports/service_inventory.txt" &&
        /\bcaptured_at\b/.test(asset.content) && /\bcollection_snapshot\b/.test(asset.content));
      if (!baseline || !captured) {
        throw new Error("Linux final learner package: package configuration-state comparison lacks task-local labelled baseline or captured service evidence.");
      }
    }
    const comparesMaintenanceToPackage = /\b(?:check|compare|reconcile|map|assess)\b[^.!?\n]{0,120}\b(?:maintenance|change (?:scope|authority|record))\b[^.!?\n]{0,120}\b(?:package transaction|package activity|package action)\b/i.test(taskText) ||
      /\b(?:check|compare|reconcile|map|assess)\b[^.!?\n]{0,120}\b(?:package transaction|package activity|package action)\b[^.!?\n]{0,120}\b(?:maintenance|change (?:scope|authority|record))\b/i.test(taskText);
    if (!comparesMaintenanceToPackage) continue;
    const transaction = selected.find((asset) => asset.file_path === "assets/logs/apt_history.log" &&
      /\bStart-Date:\s*\d{4}-\d\d-\d\d\s+\d\d:\d\d/.test(asset.content) &&
      /\bCommandline:\s*\S+/.test(asset.content) &&
      /\b(?:Install|Remove|Upgrade):\s*\S+/.test(asset.content));
    if (!transaction) {
      throw new Error("Linux final learner package: package-maintenance comparison lacks task-local package transaction evidence.");
    }
    const authority = selected.find((asset) => /^assets\/docs\/(?:change_request|maintenance_ticket)\.md$/.test(asset.file_path) &&
      /\b(?:CHG-\d+|change record)\b/i.test(asset.content) &&
      /\b(?:maintenance policy|maintenance window|maintenance scope):\s*[^\n]*\d\d:\d\d/i.test(asset.content) &&
      changeWindowMatchesTransactionLocalDate(asset.content, transaction.content) &&
      /\b(?:requested or expected work|activity scope):\s*[^\n]+/i.test(asset.content));
    if (!authority) {
      throw new Error("Linux final learner package: package-maintenance comparison lacks task-local dated change or maintenance authority.");
    }
  }
}

function derivedLearnerAssets(assets: LabAsset[]) {
  return assets.filter((asset) => /assets\/(?:evidence|docs|reports)\//.test(asset.file_path) &&
    !/assets\/docs\/(?:change_request|security_policy)\.md$/.test(asset.file_path));
}

function isQualifiedStatement(line: string) {
  return /\b(?:unverified|hypothesis|possible|suspected|candidate|alleged|may|might|could|whether|determine|compare|review|question|propose|recommend|assess|evaluate|evidence-supported|not established|unknown|not proven|does not prove|requires? validation)\b/i.test(line);
}

function isQualifiedApprovalNegative(line: string) {
  const negativeIndex = line.search(/\b(?:not approved|unapproved|unauthori[sz]ed|rejected|denied)\b/i);
  if (negativeIndex < 0) return false;
  const qualifyingContext = line.slice(Math.max(0, negativeIndex - 180), negativeIndex);
  return /\b(?:unverified hypothesis|possible|suspected|alleged|whether|determine if|assess whether|compare|distinguish|alternative|explanation|not established|unknown|not proven)\b/i.test(qualifyingContext);
}

function hasCompleteCorroboration(assets: LabAsset[]) {
  const partialSources = assets.filter(hasExplicitTelemetryLoss).map((asset) => asset.file_path);
  if (partialSources.length === 0) return true;
  return partialSources.every((partialPath) => assets.some((asset) => {
    if (!/telemetry_completeness=complete/.test(asset.content)) return false;
    if (!asset.content.includes(`covers_source=${partialPath}`)) return false;
    const nativeRows = asset.content.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
    return nativeRows.length > 0;
  }));
}

function assertApprovalClaim(simulation: LinuxSimulationWorld, assets: LabAsset[], lab: LinuxLearnerPackageLab | undefined) {
  const claim = linuxApprovalAuthority(simulation);
  const exportedSupport = claim.support.filter((source) => resolveExportedEvidence(assets, source.sourcePath));
  if (claim.value !== "unknown" && exportedSupport.length !== claim.support.length) {
    const missing = claim.support.find((source) => !resolveExportedEvidence(assets, source.sourcePath));
    throw new Error(`Linux Patch C QA: approval authority names non-exported evidence ${missing?.sourcePath || "unknown"}.`);
  }

  const derived = [
    ...derivedLearnerAssets(assets).map((asset) => ({ location: asset.file_path, text: asset.content })),
    { location: "saved learner narrative", text: finalLabText(lab) },
  ];
  if (claim.value === "unknown") {
    const unsupportedNegative = /\b(?:not approved|unapproved|unauthori[sz]ed|rejected|denied)\b/i;
    for (const item of derived) {
      for (const line of item.text.split(/\r?\n/)) {
        if (unsupportedNegative.test(line) && !isQualifiedApprovalNegative(line)) {
          throw new Error(`Linux Patch C QA: unknown approval was escalated to rejection in ${item.location}: ${line.trim()}`);
        }
      }
    }
  } else {
    if (claim.evidenceAvailability !== "available" || claim.sourceCompleteness !== "complete" || claim.support.length === 0) {
      throw new Error(`Linux Patch C QA: explicit ${claim.value} decision lacks complete approval authority.`);
    }
    const decisionPattern = claim.value === "approved" ? /\bexplicitly approved\b/i : /\bexplicitly (?:rejected|denied)\b/i;
    if (!claim.support.some((support) => decisionPattern.test(resolveExportedEvidence(assets, support.sourcePath)?.content || ""))) {
      throw new Error(`Linux Patch C QA: explicit ${claim.value} decision is not present in its named approval source.`);
    }
  }
}

function assertCrossDocumentClaimBoundaries(simulation: LinuxSimulationWorld, assets: LabAsset[], lab: LinuxLearnerPackageLab | undefined) {
  const derived = derivedLearnerAssets(assets).map((asset) => ({ location: asset.file_path, text: asset.content }));
  derived.push({ location: "saved learner narrative", text: finalLabText(lab) });
  const hasObservedWrite = simulation.openFileDescriptors.some((record) => record.accessMode === "w" || record.accessMode === "u");
  const hasKeyLifecycle = assets.some((asset) => /\b(?:KEY_CHANGE|key[_ -](?:rotation|replacement)|fingerprint[^\n]*(?:replaced|revoked))\b/i.test(asset.content));
  const incidentCronDefinitions = new Set(simulation.cronDefinitions.filter((definition) => definition.purpose === "incident").map((definition) => definition.id));
  const hasObservedIncidentCron = simulation.scheduledExecutions.some((execution) =>
    Boolean(execution.definitionId && incidentCronDefinitions.has(execution.definitionId))
  );
  const partialTelemetry = assets.some(hasExplicitTelemetryLoss) && !hasCompleteCorroboration(assets);

  for (const item of derived) {
    for (const line of item.text.split(/\r?\n/)) {
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        const runAsClaim = sentence.match(/\b([a-z][\w.-]*\.service)\s+(?:runs? as|runs? under|is run as)\s+([a-z_][\w.-]*)\b/i);
        if (runAsClaim && !isQualifiedStatement(sentence)) {
          const observedUnit = assets.some((asset) => /assets\/(?:configs|runtime)\//.test(asset.file_path) &&
            /\b(?:observed|captured)\b/i.test(asset.content) && asset.content.includes(runAsClaim[1]) &&
            new RegExp(`\\bUser=${runAsClaim[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(asset.content));
          if (!observedUnit) throw new Error(`Linux Patch C QA: service name was promoted to unsupported run-as authority in ${item.location}.`);
        }
        if (simulation.investigation.incidentFamily === "systemd_persistence" &&
          /\b(?:preserve|capture)[^.\n]{0,90}\bthen\s+(?:disable|mask)\b/i.test(sentence) && !isQualifiedStatement(sentence)) {
          throw new Error(`Linux Patch C QA: systemd containment was prescribed before ownership, approval and operational need were established in ${item.location}.`);
        }
        if (simulation.investigation.incidentFamily === "systemd_persistence" &&
          /\b(?:observed|captured|confirmed)\b[^.\n]{0,60}\b(?:ExecStart|unit (?:file )?contents?)\b/i.test(sentence) &&
          !isQualifiedStatement(sentence) &&
          !assets.some(asset => /assets\/configs\/systemd\//.test(asset.file_path) && /\bExecStart=/.test(asset.content))) {
          throw new Error(`Linux Patch C QA: expected unit baseline was promoted to observed unit contents in ${item.location}.`);
        }
        if (simulation.services.some(service => service.unitType === "oneshot" && sentence.includes(service.unitName) &&
          /\b(?:live|running) daemon\b/i.test(sentence)) && !isQualifiedStatement(sentence)) {
          throw new Error(`Linux Patch C QA: one-shot unit was presented as a live daemon in ${item.location}.`);
        }
      }
      if (!line.trim() || isQualifiedStatement(line)) continue;
      if (/(?:sudo|technical permission|configured capability)[^\n]{0,100}(?:therefore|proves?|establishes?)[^\n]{0,60}(?:business |change )?(?:approval|authori[sz]ation)/i.test(line)) {
        throw new Error(`Linux Patch C QA: technical capability was promoted to business approval in ${item.location}.`);
      }
      if (!hasObservedWrite && /\b(?:evidence (?:shows|proves|confirms)|observed)[^\n]{0,90}\b(?:modified|overwrote|deleted|compromised)\b/i.test(line)) {
        throw new Error(`Linux Patch C QA: read or capability evidence was promoted to modification in ${item.location}.`);
      }
      if (!hasKeyLifecycle && /\b(?:the )?(?:ssh )?key\s+(?:was|is)\s+(?:owned by|rotated|replaced|revoked)\b/i.test(line)) {
        throw new Error(`Linux Patch C QA: key identifier evidence was promoted to ownership or lifecycle in ${item.location}.`);
      }
      if (/\b(?:the )?(?:account|host|key|service)\s+was\s+compromised\b|\bconfirmed compromise\b/i.test(line)) {
        throw new Error(`Linux Patch C QA: suspected compromise was presented as established in ${item.location}.`);
      }
      if (!hasObservedIncidentCron && /\bcron[^\n]{0,80}\b(?:ran|executed)\b/i.test(line)) {
        throw new Error(`Linux Patch C QA: configured recurrence was promoted to observed execution in ${item.location}.`);
      }
      if (partialTelemetry && /\b(?:complete|exhaustive) (?:sequence|account|event)|\bno additional (?:events|activity)\b/i.test(line)) {
        throw new Error(`Linux Patch C QA: partial telemetry was used for an exhaustive claim in ${item.location}.`);
      }
    }
  }
}

function assertSpoilerSafety(simulation: LinuxSimulationWorld, assets: LabAsset[], lab: LinuxLearnerPackageLab | undefined) {
  const reviewAssets = derivedLearnerAssets(assets).filter((asset) =>
    /(?:incident_brief|maintenance_ticket|risk_register|audit_notes|analyst_questions|analyst_working_notes|hardening_checklist)/.test(asset.file_path)
  );
  const reviewItems = [
    ...reviewAssets.map((asset) => ({ location: asset.file_path, text: asset.content })),
    { location: "saved learner narrative", text: finalLabText(lab) },
  ];
  const reviewText = reviewItems.map((item) => `${item.location}\n${item.text}`).join("\n");
  for (const hypothesis of simulation.investigation.plausibleHypotheses) {
    if (reviewText.toLowerCase().includes(hypothesis.toLowerCase())) {
      throw new Error(`Linux Patch C QA: learner review material preselects a case-specific hypothesis: ${hypothesis}`);
    }
  }

  const answerPattern = /\b(?:root cause|final finding|conclusion)\s*(?:is|:)\s*(?!unknown|not established|unverified)|\b(?:rotate|revoke|disable|remove|block|quarantine|rollback)\b[^\n]{0,80}\b(?:key|account|service|rule|source|package)\b/i;
  const repeatedAnswerLocations = new Map<string, Set<string>>();
  for (const item of reviewItems) {
    for (const line of item.text.split(/\r?\n/)) {
      if (answerPattern.test(line) && !isQualifiedStatement(line)) {
        throw new Error(`Linux Patch C QA: learner document supplies a case-specific answer in ${item.location}: ${line.trim()}`);
      }
      if (isQualifiedStatement(line) && answerPattern.test(line)) {
        const normalized = line.toLowerCase()
          .replace(/^\s*(?:[-*]\s*)?(?:unverified\s+)?hypothesis\s*:\s*/i, "")
          .replace(/\s+/g, " ")
          .trim();
        if (normalized.length >= 24) {
          const locations = repeatedAnswerLocations.get(normalized) || new Set<string>();
          locations.add(item.location);
          repeatedAnswerLocations.set(normalized, locations);
        }
      }
    }
  }
  const repeatedAnswer = [...repeatedAnswerLocations.entries()].find(([, locations]) => locations.size > 1);
  if (repeatedAnswer) {
    throw new Error(`Linux Patch C QA: an unverified answer chain is repeated across learner documents (${[...repeatedAnswer[1]].join(", ")}): ${repeatedAnswer[0]}`);
  }

  if (/Linux DFIR:\s*Unauthorized Package Installation/i.test(finalLabText(lab))) {
    throw new Error("Linux Patch C QA: learner metadata pre-states that the package activity was unauthorized.");
  }
}

/** Validate the serialized learner assets and narrative together immediately before persistence. */
export function validateLinuxFinalLearnerPackage(input: {
  simulation: LinuxSimulationWorld;
  assets: LabAsset[];
  lab?: LinuxLearnerPackageLab;
}) {
  assertLinuxPackageMaintenanceTaskEvidence({
    incidentFamily: input.simulation.investigation.incidentFamily,
    assets: input.assets,
    lab: input.lab,
  });
  assertRenderedTelemetryAndProvenance(input.simulation, input.assets, input.lab);
  assertApprovalClaim(input.simulation, input.assets, input.lab);
  assertCrossDocumentClaimBoundaries(input.simulation, input.assets, input.lab);
  assertSpoilerSafety(input.simulation, input.assets, input.lab);
  assertSshLearnerEvidenceAuthority(input);
  assertAdvancedSshKeyTaskCorrelation({ simulation: input.simulation, assets: input.assets, tasks: input.lab?.tasks });
}

export function assertRenderedTelemetryAndProvenance(
  simulation: LinuxSimulationWorld,
  assets: LabAsset[],
  lab?: LinuxLearnerPackageLab
) {
  const find = (path: string) => assets.find((asset) => asset.file_path === path)?.content || "";
  const brief = find("assets/evidence/incident_brief.md");
  const renderedQuality = brief.match(/^- Logging quality: (.*)$/m)?.[1];
  if (renderedQuality !== undefined) {
    const expectedQuality = linuxLoggingQualityClaim(assets, /\bnoisy\b/i.test(renderedQuality));
    if (renderedQuality !== expectedQuality) {
      throw new Error(`Linux final learner package: logging quality conflicts with source-scoped telemetry completeness (${renderedQuality}).`);
    }
  }

  const syslog = find("assets/logs/syslog");
  const renderedScripts = simulationScriptAssets(simulation);
  for (const execution of simulation.scheduledExecutions) {
    const process = simulation.processes.find((item) => item.id === execution.processId);
    if (!process) continue;
    const reference = linuxLearnerSubjectLabel(simulation, execution.id);
    const row = syslog.split(/\r?\n/).find((line) => line.includes(`job_ref="${reference}"`));
    if (!row) continue; // Missing events are checked by the scheduled-event integrity validator.
    const rendered = row.match(/^\S+ \S+ \S+ (\S+)\[(\d+)\]:/);
    const expectedTag = process.executable.split("/").pop() || process.executable;
    if (!rendered || rendered[1] !== expectedTag || Number(rendered[2]) !== process.pid) {
      throw new Error(`Linux final learner package: background process provenance mismatch for ${reference}.`);
    }
    const command = simulation.commands.find((item) => item.id === execution.commandId);
    const script = command?.affectedFileIds
      .map((id) => simulation.files.find((file) => file.id === id))
      .find((file) => file?.contentRole === "script");
    const renderedScript = renderedScripts.find((item) => item.sourcePath === script?.path);
    const expectedLogger = renderedScript?.content.match(/\blogger\s+-t\s+([^\s'";]+)/)?.[1];
    const renderedLogger = row.match(/\blogger_tag="([^"]+)"/)?.[1];
    if (renderedLogger !== expectedLogger) {
      throw new Error(`Linux final learner package: background logger tag conflicts with canonical event provenance for ${reference}.`);
    }
    const exportedScript = renderedScript ? find(renderedScript.filePath) : "";
    if (exportedScript && exportedScript.match(/\blogger\s+-t\s+([^\s'";]+)/)?.[1] !== expectedLogger) {
      throw new Error(`Linux final learner package: exported script logger tag conflicts with canonical event provenance for ${reference}.`);
    }
  }

  // A syslog tag is metadata, not a promise that its script is included. Only
  // explicit learner-facing evidence references require an exported script.
  const learnerText = [
    ...assets.map((asset) => asset.content),
    finalLabText(lab),
  ].join("\n");
  for (const reference of learnerText.match(/(?<![A-Za-z0-9_./-])assets\/scripts\/[A-Za-z0-9_.-]+\.sh\b/g) || []) {
    if (!resolveExportedEvidence(assets, reference)) {
      throw new Error(`Linux final learner package: learner-facing claim names non-exported script evidence ${reference}.`);
    }
  }
  for (const sentence of learnerText.split(/(?<=[.!?])\s+|\n+/)) {
    if (!/\b(?:in this evidence set|in the evidence set|in the supplied (?:evidence|package)|included in this package)\b/i.test(sentence)) continue;
    for (const reference of sentence.match(/\b[a-z][\w.-]*\.sh\b/gi) || []) {
      const exported = resolveExportedEvidence(assets, reference);
      if (!exported || !/^assets\/scripts\//.test(exported.file_path)) {
        throw new Error(`Linux final learner package: learner-facing claim promises non-exported script evidence ${reference}.`);
      }
    }
  }

  const history = find("assets/runtime/file_access_history.csv");
  if (history) {
    for (const row of evidenceCsvRows(history)) {
      if (row.evidence_type !== "historical_file_access") continue;
      const process = simulation.processes.find((item) => item.pid === Number(row.pid));
      if (process && row.path === process.executable && row.operation !== "execution_load") {
        throw new Error(`Linux final learner package: executable path was assigned a data-object file-access operation (pid ${row.pid}).`);
      }
    }
  }
}

function assertSshLearnerEvidenceAuthority(input: { simulation: LinuxSimulationWorld; assets: LabAsset[]; lab?: LinuxLearnerPackageLab }) {
  const { simulation, assets, lab } = input;
  const find = (path: string) => assets.find((asset) => asset.file_path === path)?.content || "";
  const host = simulation.investigation.hostname;
  const windowStart = simulation.collection.windowStart;
  const windowEnd = simulation.collection.windowEnd;
  const auth = find("assets/logs/auth.log");
  const authRows = auth.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (\S+) sshd\[(\d+)\]: (.*)$/);
    return match ? { timestamp: match[1], host: match[2], pid: match[3], message: match[4] } : null;
  }).filter((row): row is { timestamp: string; host: string; pid: string; message: string } => Boolean(row));
  const inWindow = (time: string) => time >= windowStart && time <= windowEnd;

  const brief = find("assets/evidence/incident_brief.md");
  const observed = brief.match(/^- Network sources observed(?: in SSH session records)?:\s*(.*)$/mi);
  if (observed) {
    const ips = observed[1].split(",").map((value) => value.trim()).filter(Boolean);
    const sessionClaim = /observed in SSH session records/i.test(observed[0]);
    for (const ip of ips) {
      const supported = authRows.some((row) => row.host === host && inWindow(row.timestamp) &&
        new RegExp(`\\bfrom ${ip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(row.message) &&
        (sessionClaim ? /^Accepted (?:password|publickey) for /.test(row.message) : /^(?:Failed|Accepted) (?:password|publickey) for /.test(row.message)));
      if (!supported) throw new Error(`Linux final learner package: observed network source ${ip} has no matching host/time SSH log observation.`);
    }
  }

  for (const path of ["assets/configs/linux_config_pack.txt", "assets/configs/ssh/sshd_config"]) {
    const content = find(path);
    if (!content) continue;
    const heading = content.split(/\r?\n/)[0];
    if (!/^# Supplied SSH configuration sample:/.test(heading) ||
        !/capture time|undated/.test(heading) || !/incident-time effectiveness not established/.test(heading) ||
        /observed|effective runtime|historically effective/i.test(heading)) {
      throw new Error(`Linux final learner package: SSH configuration label exceeds undated sample authority in ${path}.`);
    }
  }

  for (const task of lab?.tasks || []) {
    if (typeof task === "string") continue;
    const deliverable = task.deliverable || "";
    if (!/Sequence SSH events using task-local timestamps|Order the (?:failed|supported) SSH attempts, accepted method, and session opening/i.test(deliverable)) continue;
    const evidence = task.evidence || [];
    const requiresAudit = /relate later audit activity/i.test(deliverable);
    if (!evidence.includes("assets/logs/auth.log") || (requiresAudit && !evidence.includes("assets/logs/audit.log"))) {
      throw new Error("Linux final learner package: SSH authentication chronology lacks task-local auth or required audit sources.");
    }
    const sessions = simulation.sshSessions.filter((session) => session.purpose === "incident");
    const supported = sessions.some((session) => {
      const accepted = authRows.find((row) => row.host === host && row.timestamp === session.openedAt &&
        row.pid === String(session.sessionPid) && row.message.startsWith(`Accepted ${session.authenticationMethod} for ${session.username} from ${session.sourceIp} `));
      if (!accepted || !inWindow(accepted.timestamp)) return false;
      const opened = authRows.some((row) => row.host === host && row.timestamp === session.openedAt &&
        row.pid === String(session.sessionPid) && row.message.startsWith(`pam_unix(sshd:session): session opened for user ${session.username}(`));
      const failures = new Set(authRows.filter((row) => row.host === host && inWindow(row.timestamp) && row.timestamp < accepted.timestamp &&
        /^Failed (?:password|publickey) for (?:invalid user )?\S+ from \S+ /.test(row.message) &&
        row.message.includes(` from ${session.sourceIp} `))
        .map((row) => `${row.timestamp}|${row.host}|${row.pid}|${row.message}`));
      const audit = !requiresAudit || find("assets/logs/audit.log").split(/\r?\n/).some((line) => {
        const match = line.match(/^type=USER_CMD msg=audit\((\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\):/);
        return match && match[1] > accepted.timestamp && inWindow(match[1]) && line.includes(` auid=${session.uid} `);
      });
      return opened && failures.size >= 2 && audit;
    });
    if (!supported) throw new Error("Linux final learner package: SSH authentication chronology lacks distinct matched failures, accepted method, session opening, or later audit activity for the same host, source, account, and window.");
  }
  const tasks = (lab?.tasks || []).filter((task): task is Exclude<typeof task, string> => typeof task !== "string");
  for (let index = 0; index < tasks.length; index += 1) {
    for (const other of tasks.slice(index + 1)) {
      const sameEvidence = (tasks[index].evidence || []).slice().sort().join("|") === (other.evidence || []).slice().sort().join("|");
      const sameOutcome = (tasks[index].deliverable || "").toLowerCase().replace(/\s+/g, " ").trim() ===
        (other.deliverable || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (sameEvidence && sameOutcome && (tasks[index].deliverable || "").length >= 40) {
        throw new Error("Linux final learner package: semantically redundant tasks have the same evidence and deliverable despite different titles.");
      }
    }
  }
}
