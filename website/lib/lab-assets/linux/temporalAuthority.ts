import { createHash } from "crypto";
import type { LabAsset } from "../types";
import type { LinuxSimulationWorld } from "./simulation";
import { linuxMaintenanceApprovalDecision, linuxMaintenanceIsApproved } from "./claimAuthority";

export type LinuxTemporalAuthorityCode =
  | "LINUX_TEMPORAL_EVENT_WINDOW_CLASSIFICATION_INVALID"
  | "LINUX_TEMPORAL_INVALID_TIMEZONE"
  | "LINUX_TEMPORAL_MAINTENANCE_WEEKDAY_MISMATCH"
  | "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID"
  | "LINUX_TEMPORAL_WINDOW_LABEL_CONFLATION"
  | "LINUX_TEMPORAL_DOCUMENT_WINDOW_CONTRADICTION"
  | "LINUX_TEMPORAL_SESSION_CLOSE_OBSERVED_AFTER_COLLECTION"
  | "LINUX_TEMPORAL_GENERATED_AT_BEFORE_EVIDENCE"
  | "LINUX_TEMPORAL_TIMELINE_ORDER_INVALID"
  | "LINUX_TEMPORAL_RISK_HYPOTHESIS_OVERCLAIM";

export type LinuxTemporalAuthorityIssue = {
  code: LinuxTemporalAuthorityCode;
  severity: "high" | "critical";
  category: "timeline" | "documentation" | "asset_consistency";
  file?: string;
  evidence?: string;
};

export type LinuxTemporalAuthorityReport = {
  passed: boolean;
  issues: LinuxTemporalAuthorityIssue[];
  temporalModelHash: string;
  documentAuthorityHash: string;
};

const timestampPattern = /\b20\d\d-\d\d-\d\d \d\d:\d\d:\d\d\b/g;
const weekdayByName: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};
type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseTime(value: string | undefined) {
  if (!value) return Number.NaN;
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function parseLocalDateTime(value: string | undefined): LocalDateTimeParts | undefined {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };
}

function isValidTimeZone(timezone: string | undefined) {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function localFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLocalParts(date: Date, timezone: string) {
  const parts = Object.fromEntries(localFormatter(timezone).formatToParts(date).map((part) => [part.type, part.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    weekday: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
    full: `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`,
  };
}

function localTimeToUtcMs(value: string, timezone: string) {
  if (!isValidTimeZone(timezone)) return Number.NaN;
  const parsed = parseLocalDateTime(value);
  if (!parsed) return Number.NaN;
  const targetDate = `${String(parsed.year).padStart(4, "0")}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
  const targetTime = `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}:${String(parsed.second).padStart(2, "0")}`;
  const approximate = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, parsed.second);
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = approximate - offsetMinutes * 60_000;
    const local = formatLocalParts(new Date(candidate), timezone);
    if (local.date === targetDate && local.full.slice(11) === targetTime) return candidate;
  }
  return Number.NaN;
}

function assetByPath(assets: LabAsset[], path: string) {
  return assets.find((asset) => asset.file_path === path);
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseRecurringPolicy(value: string | undefined) {
  const match = String(value || "").match(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(\d\d:\d\d)-(\d\d:\d\d)\s+([A-Za-z/_+-]+)\b/);
  if (!match) return undefined;
  return {
    weekday: match[1],
    weekdayIndex: weekdayByName[match[1]],
    start: match[2],
    end: match[3],
    timezone: match[4],
  };
}

function occurrenceMatchesPolicy(activity: { windowStart: string; windowEnd: string; timezone?: string }, policy: ReturnType<typeof parseRecurringPolicy>) {
  if (!policy) return false;
  if (!isValidTimeZone(policy.timezone)) return false;
  const canonicalTimezone = activity.timezone || policy.timezone;
  if (!isValidTimeZone(canonicalTimezone)) return false;
  const startMs = localTimeToUtcMs(activity.windowStart, canonicalTimezone);
  const endMs = localTimeToUtcMs(activity.windowEnd, canonicalTimezone);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return false;
  const policyStart = formatLocalParts(new Date(startMs), policy.timezone);
  const policyEnd = formatLocalParts(new Date(endMs), policy.timezone);
  return policyStart.weekday === policy.weekday &&
    policyStart.time === policy.start &&
    policyEnd.time === policy.end;
}

function recurringPoliciesEquivalent(left: ReturnType<typeof parseRecurringPolicy>, right: ReturnType<typeof parseRecurringPolicy>) {
  if (!left || !right) return false;
  return left.weekday === right.weekday &&
    left.start === right.start &&
    left.end === right.end &&
    left.timezone === right.timezone;
}

function lineValue(content: string, label: string) {
  const regex = new RegExp(`^${label}:\\s*(.+)$`, "gim");
  const matches = Array.from(content.matchAll(regex)).map((match) => match[1]?.trim()).filter(Boolean);
  return matches.at(-1);
}

function allLineValues(content: string, labelPattern: RegExp) {
  return content
    .split(/\r?\n/)
    .map((line) => line.match(labelPattern)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function canonicalApprovedActivityScopes(simulation: LinuxSimulationWorld, activityIds?: {
  commandIds?: string[];
  serviceTransitionIds?: string[];
  packageTransactionIds?: string[];
  cronDefinitionIds?: string[];
}) {
  const commandIds = new Set(activityIds?.commandIds || simulation.commands.map((item) => item.id));
  const transitionIds = new Set(activityIds?.serviceTransitionIds || simulation.serviceTransitions.map((item) => item.id));
  const transactionIds = new Set(activityIds?.packageTransactionIds || simulation.packageTransactions.map((item) => item.id));
  const cronIds = new Set(activityIds?.cronDefinitionIds || simulation.cronDefinitions.map((item) => item.id));
  const scopes = [
    ...simulation.commands.filter((command) => commandIds.has(command.id)).flatMap((command) => [
      command.renderedCommand,
      `${command.executable} ${command.argv.slice(1).join(" ")}`.trim(),
    ]),
    ...simulation.serviceTransitions.filter((transition) => transitionIds.has(transition.id)).map((transition) => {
      const service = simulation.services.find((item) => item.id === transition.serviceId)?.unitName || "";
      return `${service} ${transition.operation}`.trim();
    }),
    ...simulation.cronDefinitions.filter((definition) => cronIds.has(definition.id)).flatMap((definition) => {
      const command = simulation.commands.find((item) => item.id === definition.commandId);
      return [definition.sourcePath, command?.renderedCommand, `${definition.schedule} ${command?.renderedCommand || ""}`.trim()];
    }),
    ...simulation.packageTransactions.filter((transaction) => transactionIds.has(transaction.id)).flatMap((transaction) => {
      const command = simulation.commands.find((item) => item.id === transaction.commandId);
      return [
        command?.renderedCommand,
        `${transaction.action} ${transaction.packages.map((pkg) => pkg.name).join(" ")}`.trim(),
      ];
    }),
  ].filter((value): value is string => Boolean(value && value.length >= 4));
  return Array.from(new Set(scopes));
}

function renderedGeneratedAt(assets: LabAsset[]) {
  const manifest = assetByPath(assets, "manifest.json");
  if (!manifest) return undefined;
  try {
    const parsed = JSON.parse(manifest.content);
    return typeof parsed.generated_at === "string" ? parsed.generated_at.replace("T", " ").replace(/Z$/, "") : undefined;
  } catch {
    return undefined;
  }
}

function latestRenderedEvidenceTimestamp(assets: LabAsset[]) {
  let latest = "";
  for (const asset of assets) {
    for (const match of asset.content.matchAll(timestampPattern)) {
      const timestamp = match[0];
      if (!latest || timestamp > latest) latest = timestamp;
    }
  }
  return latest || undefined;
}

function timelineRows(assets: LabAsset[]) {
  const timeline = assetByPath(assets, "assets/evidence/timeline.csv");
  if (!timeline) return [];
  return timeline.content.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const row = parseCsvLine(line);
    return { timestamp: row[0] || "", summary: row[1] || "", evidenceType: row[2] || "", activityRef: row[5] || "", activityType: row[6] || "" };
  });
}

function add(issues: LinuxTemporalAuthorityIssue[], issue: LinuxTemporalAuthorityIssue) {
  issues.push(issue);
}

export function buildLinuxCanonicalTemporalModel(simulation: LinuxSimulationWorld) {
  const policy = parseRecurringPolicy(simulation.maintenanceActivities[0]?.recurringPolicyWindow);
  return {
    evidenceCollectionTime: simulation.collection.collectedAt,
    investigationWindow: {
      start: simulation.collection.windowStart,
      end: simulation.collection.windowEnd,
      timezone: simulation.investigation.timezone,
    },
    detectionTime: `${simulation.investigation.incidentDate} ${simulation.investigation.incidentWindowStart}-${simulation.investigation.incidentWindowEnd} ${simulation.investigation.timezone}`,
    recurringMaintenancePolicy: policy,
    approvedChangeOccurrences: simulation.maintenanceActivities.map((activity) => ({
      id: activity.id,
      approved: linuxMaintenanceIsApproved(activity),
      approvalDecision: linuxMaintenanceApprovalDecision(activity),
      changeId: activity.changeId,
      ticketId: activity.ticketId,
      host: simulation.investigation.hostname,
      windowStart: activity.windowStart,
      windowEnd: activity.windowEnd,
      commandIds: activity.commandIds.slice().sort(),
      serviceTransitionIds: activity.serviceTransitionIds.slice().sort(),
      packageTransactionIds: activity.packageTransactionIds.slice().sort(),
      cronDefinitionIds: activity.cronDefinitionIds.slice().sort(),
    })),
    documentTimes: simulation.documents.map((document) => ({ id: document.id, type: document.documentType, createdAt: document.createdAt })),
  };
}

export function validateLinuxTemporalDocumentAuthority(input: {
  simulation?: LinuxSimulationWorld;
  assets: LabAsset[];
}): LinuxTemporalAuthorityReport {
  const issues: LinuxTemporalAuthorityIssue[] = [];
  const simulation = input.simulation;
  if (!simulation) {
    return { passed: true, issues, temporalModelHash: hash("missing-simulation"), documentAuthorityHash: hash([]) };
  }
  const model = buildLinuxCanonicalTemporalModel(simulation);
  const policy = parseRecurringPolicy(simulation.maintenanceActivities[0]?.recurringPolicyWindow);
  const incidentWindowLabel = `${simulation.investigation.incidentWindowStart}-${simulation.investigation.incidentWindowEnd}`;
  const windowStartMs = parseTime(simulation.collection.windowStart);
  const windowEndMs = parseTime(simulation.collection.windowEnd);

  if ((simulation.maintenanceActivities[0]?.recurringPolicyWindow && !policy) || (policy && !isValidTimeZone(policy.timezone))) {
    add(issues, {
      code: "LINUX_TEMPORAL_INVALID_TIMEZONE",
      severity: "critical",
      category: "documentation",
      evidence: hash(simulation.maintenanceActivities[0]?.recurringPolicyWindow || "").slice(0, 16),
    });
  }
  for (const activity of simulation.maintenanceActivities) {
    if (activity.timezone && !isValidTimeZone(activity.timezone)) {
      add(issues, {
        code: "LINUX_TEMPORAL_INVALID_TIMEZONE",
        severity: "critical",
        category: "documentation",
        evidence: hash({ id: activity.id, timezone: activity.timezone }).slice(0, 16),
      });
    }
  }

  for (const event of simulation.events.filter((item) => item.kind !== "file_touch")) {
    const occurred = parseTime(event.timestamp);
    const inside = occurred >= windowStartMs && occurred <= windowEndMs;
    if (event.timestamp > simulation.collection.collectedAt || !inside) {
      add(issues, {
        code: "LINUX_TEMPORAL_EVENT_WINDOW_CLASSIFICATION_INVALID",
        severity: "critical",
        category: "timeline",
        evidence: `${event.id}:${inside ? "inside" : "outside"}`,
      });
    }
  }

  for (const activity of simulation.maintenanceActivities) {
    if (linuxMaintenanceIsApproved(activity) && !occurrenceMatchesPolicy(activity, policy)) {
      add(issues, {
        code: "LINUX_TEMPORAL_MAINTENANCE_WEEKDAY_MISMATCH",
        severity: "critical",
        category: "documentation",
        evidence: activity.id,
      });
    }
  }

  const rows = timelineRows(input.assets);
  const seenTimeline = new Set<string>();
  let previous = "";
  for (const row of rows) {
    if (previous && row.timestamp < previous) {
      add(issues, { code: "LINUX_TEMPORAL_TIMELINE_ORDER_INVALID", severity: "critical", category: "timeline", file: "assets/evidence/timeline.csv", evidence: row.activityType });
    }
    previous = row.timestamp;
    const key = `${row.timestamp}|${row.summary}|${row.activityType}`;
    if (seenTimeline.has(key)) {
      add(issues, { code: "LINUX_TEMPORAL_TIMELINE_ORDER_INVALID", severity: "critical", category: "timeline", file: "assets/evidence/timeline.csv", evidence: row.activityType });
    }
    seenTimeline.add(key);
    if (row.evidenceType === "Observed") {
      const occurred = parseTime(row.timestamp);
      if (occurred < windowStartMs || occurred > windowEndMs) {
        add(issues, { code: "LINUX_TEMPORAL_EVENT_WINDOW_CLASSIFICATION_INVALID", severity: "critical", category: "timeline", file: "assets/evidence/timeline.csv", evidence: row.activityType });
      }
    }
  }

  const generatedAt = renderedGeneratedAt(input.assets);
  const latestEvidence = latestRenderedEvidenceTimestamp(input.assets);
  if (generatedAt && latestEvidence && generatedAt < latestEvidence) {
    add(issues, {
      code: "LINUX_TEMPORAL_GENERATED_AT_BEFORE_EVIDENCE",
      severity: "critical",
      category: "timeline",
      file: "manifest.json",
      evidence: hash({ generatedAt, latestEvidence }).slice(0, 16),
    });
  }

  const auth = assetByPath(input.assets, "assets/logs/auth.log");
  if (auth) {
    for (const session of simulation.sshSessions) {
      if (session.closedAt && session.closedAt > simulation.collection.windowEnd) {
        const identity = simulation.identities.find((item) => item.id === session.identityId);
        if (identity && auth.content.includes(`${session.closedAt} ${simulation.investigation.hostname} sshd[${session.sessionPid}]`)) {
          add(issues, { code: "LINUX_TEMPORAL_SESSION_CLOSE_OBSERVED_AFTER_COLLECTION", severity: "critical", category: "timeline", file: "assets/logs/auth.log", evidence: session.id });
        }
      }
    }
  }

  const docs = input.assets.filter((asset) => /assets\/(?:docs|evidence)\/.*\.(?:md|csv)$/i.test(asset.file_path));
  for (const doc of docs) {
    const content = doc.content;
    const maintenanceValues = allLineValues(content, /^\s*(?:Maintenance window|Window):\s*(.+)$/i);
    if (maintenanceValues.some((value) => value.includes(simulation.collection.windowStart) || value.includes(incidentWindowLabel))) {
      add(issues, { code: "LINUX_TEMPORAL_WINDOW_LABEL_CONFLATION", severity: "critical", category: "documentation", file: doc.file_path, evidence: hash(maintenanceValues).slice(0, 16) });
    }
    if (/approved maintenance window/i.test(content) && !/Recurring maintenance policy:/i.test(content)) {
      add(issues, { code: "LINUX_TEMPORAL_WINDOW_LABEL_CONFLATION", severity: "critical", category: "documentation", file: doc.file_path, evidence: "approved-maintenance-window" });
    }
    const recurring = allLineValues(content, /^\s*Recurring maintenance policy:\s*(.+)$/i);
    if (new Set(recurring).size > 1) {
      add(issues, { code: "LINUX_TEMPORAL_DOCUMENT_WINDOW_CONTRADICTION", severity: "critical", category: "documentation", file: doc.file_path, evidence: hash(recurring).slice(0, 16) });
    }
    if (recurring.some((value) => !recurringPoliciesEquivalent(parseRecurringPolicy(value), policy))) {
      add(issues, { code: "LINUX_TEMPORAL_DOCUMENT_WINDOW_CONTRADICTION", severity: "critical", category: "documentation", file: doc.file_path, evidence: hash(recurring).slice(0, 16) });
    }
    const occurrence = lineValue(content, "Approved change occurrence");
    if (occurrence && !/not established|requires validation|unavailable/i.test(occurrence) && /approved|covered/i.test(content)) {
      const host = lineValue(content, "Host");
      const changeIdentity = lineValue(content, "Change Reference") || lineValue(content, "Change ID") || lineValue(content, "Change") || "";
      const ticketIdentity = lineValue(content, "Ticket") || lineValue(content, "Incident Ticket") || lineValue(content, "Related incident ticket") || "";
      const scope = lineValue(content, "Approved change scope") || "";
      const matchesHost = host === simulation.investigation.hostname;
      const matchesChangeId = changeIdentity.includes(simulation.investigation.changeId) || content.includes(simulation.investigation.changeId);
      const matchesTicketId = ticketIdentity.includes(simulation.investigation.ticketId) || content.includes(simulation.investigation.ticketId);
      const matchingActivity = simulation.maintenanceActivities.find((activity) => {
        const activityScopes = canonicalApprovedActivityScopes(simulation, activity);
        const matchesActivityScope = activityScopes.some((token) => scope.includes(token));
        return linuxMaintenanceIsApproved(activity) &&
          activity.changeId === simulation.investigation.changeId &&
          (!activity.ticketId || activity.ticketId === simulation.investigation.ticketId) &&
          occurrence.includes(activity.windowStart) &&
          occurrence.includes(activity.windowEnd) &&
          occurrenceMatchesPolicy(activity, policy) &&
          matchesActivityScope;
      });
      const matchesWindowAndScope = Boolean(matchingActivity);
      if (!matchesHost || !matchesChangeId || !matchesTicketId || !matchesWindowAndScope) {
        add(issues, { code: "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", severity: "critical", category: "documentation", file: doc.file_path, evidence: hash({ matchesHost, matchesChangeId, matchesTicketId, matchesWindowAndScope }).slice(0, 16) });
      }
    }
    if (/risk_register\.csv$/i.test(doc.file_path) && /\b(?:confirmed execution|confirmed compromise|executed successfully)\b/i.test(content)) {
      add(issues, { code: "LINUX_TEMPORAL_RISK_HYPOTHESIS_OVERCLAIM", severity: "critical", category: "documentation", file: doc.file_path, evidence: "risk-overclaim" });
    }
  }

  const authority = {
    docs: docs.map((doc) => ({
      path: doc.file_path,
      recurring: allLineValues(doc.content, /^\s*Recurring maintenance policy:\s*(.+)$/i),
      occurrence: lineValue(doc.content, "Approved change occurrence") || "",
      status: lineValue(doc.content, "Approval status") || "",
    })).sort((left, right) => left.path.localeCompare(right.path)),
  };
  return {
    passed: issues.length === 0,
    issues,
    temporalModelHash: hash(model),
    documentAuthorityHash: hash(authority),
  };
}
