import type { LabAsset } from "../types";
import { scheduleMatchesTimestamp, scheduledExecutionRenderedPhase, validateCanonicalExecutionLifecycle, linuxLearnerSubjectLabel, type LinuxSimulationWorld } from "./simulation";
import { evidenceCsvRows, resolveExportedEvidence, scopeTimelineToExports, sourceSupportsTimeline, sourceSupportsHistoryRow, executedScriptDependencies, hasExplicitTelemetryLoss, linuxLoggingQualityClaim } from "./evidenceAuthority";
import { formatLinuxLearnerDocumentWindow } from "./time";

export const linuxReviewHypotheses = [
  "Unverified hypothesis: activity matches an authorised maintenance scope",
  "Unverified hypothesis: activity reflects an operational error or policy drift",
  "Unverified hypothesis: activity is unauthorised; actor and impact remain undetermined",
];

export const linuxIndependentReviewQuestions = [
  "Which observations can be established from the evidence assigned to this task?",
  "How do the activity times and scope compare with the approval record?",
  "Which competing explanations fit the observations, and what evidence would distinguish them?",
  "What remains unknown about intent, impact and attribution?",
  "What proportionate next step follows from your finding, and what must be checked before acting?",
];

export function linuxDifficultyReviewGuidance(difficulty: string) {
  if (difficulty === "Beginner") {
    return [
      "Record the actor, action, time and source before drawing a conclusion.",
      "Compare observed activity with the supplied approval or policy record.",
      "State one supported finding and one limit the evidence cannot resolve.",
    ];
  }
  if (difficulty === "Intermediate") {
    return [
      "Correlate the task-local sources before choosing between competing explanations.",
      "Separate observed events from policy, current configuration and approval evidence.",
      "Document the evidence gap that would change the finding or next step.",
    ];
  }
  return linuxIndependentReviewQuestions;
}

export const linuxContainerEvidenceBoundary = "A configured bind mount establishes path exposure and mount permissions. Possible access is not observed access. Observed access requires a file operation tied to a process and path; modification requires write evidence. A mount alone establishes neither container escape nor host compromise.";

// Add a column without disturbing quoted CSV records (including multiline cells).
function appendAuthorityColumn(content: string, authority: string) {
  const records: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '"') {
      if (quoted && content[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (content[index] === "\n" && !quoted) {
      records.push(content.slice(start, index).replace(/\r$/, ""));
      start = index + 1;
    }
  }
  if (start < content.length) records.push(content.slice(start).replace(/\r$/, ""));
  return records.filter((record) => record.trim()).map((record, index) =>
    `${record},${index === 0 ? "time_authority" : `"${authority.replace(/"/g, '""')}"`}`
  ).join("\n") + "\n";
}

export function labelLinuxEvidenceTimeAuthority(assets: LabAsset[], simulation: LinuxSimulationWorld) {
  const zone = simulation.investigation.timezone;
  const window = formatLinuxLearnerDocumentWindow(simulation.collection.windowStart, simulation.collection.windowEnd, zone, { includeOffset: true });
  for (const asset of assets) {
    const documentary = asset.file_type === "markdown";
    const authority = documentary
      ? `Local document times use ${zone}; review window ${window}. Raw log times use UTC (+00:00).`
      : "UTC (+00:00); explicit offsets override; static values have no event time.";
    if (/assets\/scheduled\/(?:root_crontab\.txt|cron\.d\/)/.test(asset.file_path)) {
      asset.content = `# Schedule timezone: UTC (+00:00)\n${asset.content}`;
    }
    if (asset.file_type === "json") {
      const value = JSON.parse(asset.content);
      asset.content = JSON.stringify({ ...value, time_authority: authority }, null, 2) + "\n";
    } else if (asset.file_type === "csv" || /^(?:service,status|evidence_type,state_type),/.test(asset.content)) {
      asset.content = appendAuthorityColumn(asset.content, "UTC (+00:00)");
    } else if (documentary) {
      asset.content += `\nTime authority: ${authority}\n`;
    } else if (/^-- Journal begins at .+ UTC --/.test(asset.content)) {
      // The journal header is itself the authority and must remain its first row.
      continue;
    } else {
      // Preserve shebangs and collection headers used by native-format readers.
      const firstNewline = asset.content.indexOf("\n");
      if (/^#/.test(asset.content) && firstNewline >= 0) {
        asset.content = asset.content.slice(0, firstNewline + 1) + `# Time authority: ${authority}\n` + asset.content.slice(firstNewline + 1);
      } else {
        asset.content = `# Time authority: ${authority}\n${asset.content}`;
      }
    }
  }
}

export function validateLinuxLearnerPackBoundaries(assets: LabAsset[]) {
  for (const asset of assets) {
    if (!/Time authority:|time_authority|^-- Journal begins at .+ UTC --/m.test(asset.content)) {
      throw new Error(`Linux learner QA: missing time authority in ${asset.file_path}.`);
    }
    if (/Container process accessed files outside expected scope|appears to have accessed host-mounted paths|ops-maintenance-chek/i.test(asset.content)) {
      throw new Error(`Linux learner QA: unsupported or invalid learner content in ${asset.file_path}.`);
    }
    if (/(?:advanced_risk_register|risk_register)\.csv$/.test(asset.file_path) &&
        (!/unverified/i.test(asset.content) || /,(?:high|critical),/i.test(asset.content))) {
      throw new Error(`Linux learner QA: risk register supplies a predetermined finding in ${asset.file_path}.`);
    }
  }
}

function timestampInWindow(timestamp: string, start: string, end: string) {
  return timestamp >= start && timestamp <= end;
}

function expectedCronOccurrences(schedule: string, start: string, end: string) {
  const occurrences: string[] = [];
  const startMs = Date.parse(`${start.replace(" ", "T")}Z`);
  const endMs = Date.parse(`${end.replace(" ", "T")}Z`);
  for (let current = Math.ceil(startMs / 60_000) * 60_000; current <= endMs; current += 60_000) {
    const timestamp = new Date(current).toISOString().slice(0, 19).replace("T", " ");
    if (scheduleMatchesTimestamp(schedule, timestamp)) occurrences.push(timestamp.slice(0, 16));
  }
  return occurrences;
}

function assetByPath(assets: LabAsset[], path: string) {
  return assets.find((asset) => asset.file_path === path);
}

function cronAssetPath(definition: LinuxSimulationWorld["cronDefinitions"][number]) {
  return definition.source === "root_crontab"
    ? "assets/scheduled/root_crontab.txt"
    : `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`;
}

/** Render authority from the collection model, never infer an excuse from missing output. */
export function prepareLinuxPatchAEvidence(simulation: LinuxSimulationWorld, assets: LabAsset[]) {
  scopeTimelineToExports(simulation, assets);
  for (const path of mutablePaths(simulation)) {
    const asset = assetByPath(assets, path);
    if (!asset) continue;
    const registry = simulation.evidenceRegistry.find(item => item.path === path);
    const snapshot = registry?.stateType === "incident_snapshot" ? "incident_snapshot" : "collection_snapshot";
    const capture = snapshot === "incident_snapshot" ? simulation.collection.windowEnd : simulation.collection.collectedAt;
    if (/^(?:username,|group,|service,status,)/.test(asset.content)) continue; // Native CSV authority is rendered with each row.
    const nativeType = asset.content.match(/^# capture_at=[^\n]*\bevidence_type=(\S+)/)?.[1];
    const declaration = '# capture_at=' + capture + (nativeType ? ' evidence_type=' + nativeType : '') + ' timezone=UTC(+00:00) state_type=' + snapshot +
      ' host=' + simulation.investigation.hostname + ' window_start=' + simulation.collection.windowStart + ' window_end=' + simulation.collection.windowEnd;
    asset.content = declaration + "\n" + asset.content.replace(/^# capture_at=[^\n]*\n/, "");
  }
  for (const definition of simulation.cronDefinitions.filter(item => item.enabled && item.persistenceState === "present")) {
    const asset = assetByPath(assets, cronAssetPath(definition));
    if (!asset) continue;
    const coverage = definition.telemetryCoverage;
    if (!coverage) throw new Error('Linux Patch A QA: schedule collection policy missing for ' + definition.id);
    asset.content += '# recurrence_definition=' + definition.id + ' telemetry_coverage=' + coverage.mode +
      ' interval_start=' + coverage.start + ' interval_end=' + coverage.end + ' gap_reason=' + (coverage.reason || "none") + "\n";
    if (coverage.mode === "sampled") {
      asset.content += "# Partial logs: only the declared execution interval was collected for this definition. Occurrences outside that interval are not represented; absence from this sample does not establish non-execution.\n";
    }
  }
  for (const asset of assets.filter(hasExplicitTelemetryLoss)) {
    // Logs remain logs; never prepend comments to CSV, JSON or learner prose.
    if (!asset.content.includes("# telemetry_completeness=partial")) {
      asset.content += "\n# telemetry_completeness=partial source=" + asset.file_path +
        ' host=' + simulation.investigation.hostname + ' interval_start=' + simulation.collection.windowStart +
        ' interval_end=' + simulation.collection.windowEnd + ' reason=observed_log_loss\n';
    }
  }
  const brief = assetByPath(assets, "assets/evidence/incident_brief.md");
  if (brief) {
    brief.content = brief.content.replace(
      /^- Logging quality: .*$/m,
      `- Logging quality: ${linuxLoggingQualityClaim(assets, /^- Logging quality:.*\bnoisy\b/im.test(brief.content))}`
    );
  }
  const refs = identityReferences(assets);
  const identities = identityInventory(assets);
  const scope = {
    inventory_scope: "partial",
    description: "Incident-focused identity inventories. Named identities below are referenced by supplied files but not included in these inventories; no role or activity is inferred for them.",
    outside_scope_users: [...refs.users].filter(name => !identities.users.has(name)).sort(),
    outside_scope_groups: [...refs.groups].filter(name => !identities.groups.has(name)).sort(),
  };
  const config = assetByPath(assets, "assets/configs/linux_config_pack.txt");
  if (config) config.content += "\n# Identity inventory scope: " + JSON.stringify(scope) + "\n";
}

function mutablePaths(simulation: LinuxSimulationWorld) {
  return simulation.evidenceRegistry.filter(asset => asset.stateType === "collection_snapshot" || asset.stateType === "incident_snapshot").map(asset => asset.path);
}

function identityInventory(assets: LabAsset[]) {
  return {
    users: new Set(evidenceCsvRows(assetByPath(assets, "assets/csv/users.csv")?.content || "").map(row => row.username).filter(Boolean)),
    groups: new Set(evidenceCsvRows(assetByPath(assets, "assets/csv/groups.csv")?.content || "").map(row => row.group).filter(Boolean)),
  };
}

function identityReferences(assets: LabAsset[]) {
  const users = new Set<string>(), groups = new Set<string>();
  for (const row of evidenceCsvRows(assetByPath(assets, "assets/csv/users.csv")?.content || "")) {
    if (row.manager && /^[a-z_][\w.-]*$/i.test(row.manager)) users.add(row.manager);
  }
  for (const row of evidenceCsvRows(assetByPath(assets, "assets/csv/groups.csv")?.content || "")) {
    row.members?.split(",").map(name => name.trim()).filter(Boolean).forEach(name => users.add(name));
  }
  for (const asset of assets) {
    if (/permissions_report\.txt$/.test(asset.file_path)) {
      for (const line of asset.content.split(/\r?\n/)) {
        const match = line.match(/^\/\S+\s+[bcdlps-][rwxStTs-]{9}\s+(\S+)\s+(\S+)/);
        if (match) { users.add(match[1]); groups.add(match[2]); }
      }
    }
    if (/passwd|linux_config_pack/.test(asset.file_path)) {
      for (const line of asset.content.split(/\r?\n/)) {
        const passwd = line.match(/^([a-z_][\w.-]*):x:\d+:\d+:/i);
        if (passwd) users.add(passwd[1]);
        const sudo = line.match(/^(%?[a-z_][\w.-]*)\s+ALL\s*=/i);
        if (sudo) (sudo[1].startsWith("%") ? groups : users).add(sudo[1].replace(/^%/, ""));
        if (/^AllowUsers /.test(line)) line.slice(11).split(/\s+/).filter(Boolean).forEach(name => users.add(name));
      }
    }
    if (/runtime\/(?:process|open_files)|journal|logs/.test(asset.file_path)) {
      for (const row of evidenceCsvRows(asset.content)) if (row.user) users.add(row.user);
      for (const line of asset.content.split(/\r?\n/)) {
        const sudo = line.match(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d (\S+) : TTY=/);
        if (sudo) users.add(sudo[1]);
        const runAs = line.match(/\bCRON\[\d+\]: \(([^)]+)\) CMD/);
        if (runAs) users.add(runAs[1]);
      }
    }
  }
  return { users, groups };
}

/** Strict final-package validation. This function does not repair or mutate its inputs. */
export function validateLinuxPatchAIntegrity(simulation: LinuxSimulationWorld, assets: LabAsset[]) {
  const timeline = assetByPath(assets, "assets/evidence/timeline.csv");
  if (!timeline) throw new Error("Linux Patch A QA: timeline.csv is missing.");
  const syslog = assetByPath(assets, "assets/logs/syslog");
  if (simulation.scheduledExecutions.length && !syslog) throw new Error("Linux Patch A QA: scheduled syslog is missing.");
  const timelineRows = evidenceCsvRows(timeline.content);
  const syslogLines = syslog?.content.split(/\r?\n/) || [];
  for (const scheduled of simulation.scheduledExecutions) {
    const phase = scheduledExecutionRenderedPhase(simulation, scheduled);
    const ref = linuxLearnerSubjectLabel(simulation, scheduled.id);
    const rowMatches = timelineRows.filter(row => row.activity_type === "scheduled execution" && row.activity_ref === ref);
    const jobLines = syslogLines.filter(line => line.includes(`job_ref="${ref}"`) && line.includes(`def="${scheduled.definitionId || "missing"}"`));
    const activityLines = syslogLines.filter(line => line.includes(`activity_ref="background:${scheduled.id}"`));
    const phaseText = phase.phase === "ended_unconfirmed" ? "ended" : phase.phase;
    if (rowMatches.length !== 1 || jobLines.length !== 1 || activityLines.length !== 1 ||
        rowMatches[0]?.timestamp !== phase.timestamp || !rowMatches[0]?.summary.includes(phaseText) ||
        !jobLines[0]?.startsWith(phase.timestamp) || !activityLines[0]?.startsWith(phase.timestamp) ||
        !activityLines[0]?.includes(`${phase.phase === "ended_unconfirmed" ? "ended (outcome unconfirmed)" : phase.phase} scheduled execution`) ||
        !jobLines[0]?.includes(phase.phase === "completed" ? scheduled.stdoutSummary || "scheduled job completed" :
          phase.phase === "started" ? "scheduled job started" :
          phase.phase === "failed" ? "scheduled job failed" : "scheduled job ended; outcome unconfirmed") ||
        (phase.phase !== "completed" && [...jobLines, ...activityLines].some(line => /completed(?: successfully)?/i.test(line)))) {
      throw new Error(`Linux Patch A QA: scheduled phase/timestamp mismatch for ${scheduled.id}.`);
    }
  }
  for (const row of timelineRows) {
    if (!row.exact_sources) throw new Error("Linux Patch A QA: timeline event lacks an exact source.");
    for (const role of ["source", "exact_sources", "context_sources", "static_sources"] as const) {
      for (const ref of (row[role] || "").split(";").filter(Boolean)) {
        const source = resolveExportedEvidence(assets, ref);
        if (!source) throw new Error('Linux Patch A QA: timeline ' + role + ' names non-exported evidence ' + ref + '.');
        if (!sourceSupportsTimeline(simulation, source, row, role)) {
          throw new Error('Linux Patch A QA: ' + role + ' source ' + ref + ' does not support timeline event ' + row.activity_ref + '.');
        }
      }
    }
  }
  for (const asset of assets) {
    // Explicit exported paths in README, task markdown, notes, manifests and CSV cells are all package references.
    for (const reference of asset.content.match(/(?<![A-Za-z0-9_./-])assets\/[A-Za-z0-9_./-]+/g) || []) {
      const path = reference.replace(/[.]+$/, "");
      if (!resolveExportedEvidence(assets, path)) throw new Error('Linux Patch A QA: ' + asset.file_path + ' names non-exported evidence ' + path + '.');
    }
    // A source explicitly described as being in this package is a promise,
    // unlike a host path or a recommendation to collect it later.
    for (const sentence of asset.content.split(/(?<=[.!?])\s+|\n+/)) {
      if (!/\b(?:in this evidence set|in the supplied (?:evidence|package)|included in this package)\b/i.test(sentence)) continue;
      for (const reference of sentence.match(/\b[a-z][\w.-]*\.(?:log|txt|csv|md)\b/gi) || []) {
        if (!resolveExportedEvidence(assets, reference)) {
          throw new Error('Linux Patch A QA: ' + asset.file_path + ' promises non-exported evidence ' + reference + '.');
        }
      }
    }
    if (/source_telemetry/.test(asset.content.split(/\r?\n/)[0])) {
      for (const row of evidenceCsvRows(asset.content)) {
        for (const ref of (row.source_telemetry || "").split(/[;]/).filter(v => /\.(?:log|txt|csv|json)$/.test(v))) {
          const source = resolveExportedEvidence(assets, ref);
          if (!source) throw new Error('Linux Patch A QA: historical source names non-exported evidence ' + ref + '.');
          if (!sourceSupportsHistoryRow(source, row)) throw new Error('Linux Patch A QA: historical source ' + ref + ' does not support the recorded process or file event.');
        }
      }
    }
    if (asset.file_type === "csv") {
      for (const row of evidenceCsvRows(asset.content)) {
        for (const ref of (row.evidence || "").split(";").filter(Boolean)) {
          if (!resolveExportedEvidence(assets, ref)) throw new Error('Linux Patch A QA: ' + asset.file_path + ' names non-exported evidence ' + ref + '.');
        }
      }
    }
  }
  for (const path of mutablePaths(simulation)) {
    const asset = assetByPath(assets, path);
    if (!asset) continue;
    const registry = simulation.evidenceRegistry.find(item => item.path === path);
    const state = registry?.stateType === "incident_snapshot" ? "incident_snapshot" : "collection_snapshot";
    const capture = state === "incident_snapshot" ? simulation.collection.windowEnd : simulation.collection.collectedAt;
    if (/^(?:username,|group,|service,status,)/.test(asset.content)) {
      const rows = evidenceCsvRows(asset.content);
      if (!rows.length || rows.some(row => row.captured_at !== capture || row.state_type !== state ||
        row.host !== simulation.investigation.hostname || row.window_start !== simulation.collection.windowStart ||
        row.window_end !== simulation.collection.windowEnd || row.time_authority !== "UTC (+00:00)")) {
        throw new Error('Linux Patch A QA: mutable evidence ' + path + ' lacks consistent capture authority.');
      }
    } else {
      const header = asset.content.split(/\r?\n/).find(line => line.startsWith("# capture_at=")) || "";
      if (!header.startsWith("# capture_at=" + capture + " ") || !header.includes("state_type=" + state) ||
        !header.includes("host=" + simulation.investigation.hostname + " ") || !header.includes("timezone=UTC(+00:00)") ||
        !header.includes("window_start=" + simulation.collection.windowStart) || !header.includes("window_end=" + simulation.collection.windowEnd)) {
        throw new Error('Linux Patch A QA: mutable evidence ' + path + ' lacks consistent capture authority.');
      }
    }
  }
  for (const definition of simulation.cronDefinitions.filter(item => item.enabled && item.persistenceState === "present")) {
    const source = assetByPath(assets, cronAssetPath(definition));
    if (!source) continue;
    const coverage = definition.telemetryCoverage;
    const declaration = source.content.split(/\r?\n/).find(line => line.startsWith("# recurrence_definition=" + definition.id + " "));
    if (!coverage || !declaration || !declaration.includes("telemetry_coverage=" + coverage.mode) ||
      !declaration.includes("interval_start=" + coverage.start) || !declaration.includes("interval_end=" + coverage.end) ||
      !declaration.includes("gap_reason=" + (coverage.reason || "none")) ||
      (coverage.mode === "sampled" && (coverage.reason !== "partial_logs" || !source.content.includes("Partial logs:")))) {
      throw new Error('Linux Patch A QA: recurring schedule ' + definition.id + ' lacks its modelled collection scope.');
    }
    // Cron dispatch may be seconds after the minute boundary. Include that minute in coverage.
    const expected = expectedCronOccurrences(definition.schedule, coverage.start.slice(0, 16) + ":00", coverage.end)
      .filter(time => time >= definition.createdAt.slice(0, 16) && (!definition.removedAt || time <= definition.removedAt.slice(0, 16)));
    for (const time of expected) {
      const executions = simulation.scheduledExecutions.filter(e => e.definitionId === definition.id && e.occurredAt.slice(0, 16) === time);
      if (!executions.length) throw new Error('Linux Patch A QA: recurring schedule ' + definition.id + ' has unexplained missing occurrence ' + time + '.');
      for (const execution of executions) {
        const row = { timestamp: execution.occurredAt, activity_ref: linuxLearnerSubjectLabel(simulation, execution.id) };
        for (const path of ["assets/logs/syslog", "assets/logs/cron.log", "assets/logs/audit.log"]) {
          const log = assetByPath(assets, path);
          const sourceRow = path === "assets/logs/syslog"
            ? { ...row, timestamp: scheduledExecutionRenderedPhase(simulation, execution).timestamp }
            : row;
          if (log && !sourceSupportsTimeline(simulation, log, sourceRow, "exact_sources")) {
            throw new Error('Linux Patch A QA: recurring schedule ' + definition.id + ' has a missing execution record in ' + path + '.');
          }
        }
      }
    }
  }
  const scripts = assets.filter(a => /^assets\/scripts\/.*\.sh$/.test(a.file_path)).map(a => ({
    fileName: a.file_name, filePath: a.file_path, content: a.content, subjectIds: [],
    sourcePath: a.content.match(/^# source_path=(\S+)/m)?.[1] || "",
  })).filter(a => a.sourcePath);
  const permissions = assetByPath(assets, "assets/reports/permissions_report.txt");
  for (const { path, identityIds } of executedScriptDependencies(simulation, scripts)) {
    const row = permissions?.content.split(/\r?\n/).find(line => line.startsWith(path + " "));
    const [, mode = "", owner, group] = row?.split(/\s+/) || [];
    const executable = /^-[rwxStTs-]{9}$/.test(mode) && identityIds.every(id => {
      const actor = simulation.identities.find(identity => identity.id === id);
      if (!actor) return false;
      if (actor.uid === 0) return [mode[3], mode[6], mode[9]].some(bit => /[xst]/.test(bit));
      const groups = evidenceCsvRows(assetByPath(assets, "assets/csv/groups.csv")?.content || "");
      const inGroup = simulation.groups.some(item => item.id === actor.primaryGroupId && item.name === group) ||
        groups.some(item => item.group === group && item.members.split(",").includes(actor.username));
      return /[xst]/.test(mode[owner === actor.username ? 3 : inGroup ? 6 : 9]);
    });
    if (!executable) {
      throw new Error('Linux Patch A QA: executed helper ' + path + ' lacks executable metadata.');
    }
  }
  const inventory = identityInventory(assets), refs = identityReferences(assets);
  const scopeText = assetByPath(assets, "assets/configs/linux_config_pack.txt")?.content.match(/^# Identity inventory scope: (.+)$/m)?.[1];
  const scope = scopeText ? JSON.parse(scopeText) : {};
  for (const [kind, names, known] of [["users", refs.users, inventory.users], ["groups", refs.groups, inventory.groups]] as const) {
    const outside = scope.inventory_scope === "partial" && Array.isArray(scope["outside_scope_" + kind]) ? scope["outside_scope_" + kind] : [];
    for (const name of names) if (!known.has(name) && !outside.includes(name)) throw new Error('Linux Patch A QA: undeclared identity ' + kind + ':' + name + '.');
  }
  const config = assetByPath(assets, "assets/configs/linux_config_pack.txt");
  const observed = config?.content.match(/# Supplied SSH configuration sample: sshd_config\.sample \(undated; incident-time effectiveness not established\)\n([\s\S]*?)(?=\n#)/)?.[1];
  const policy = config?.content.match(/# Expected policy: policy_notes\.md\n([\s\S]*?)(?=\n#)/)?.[1];
  if (!observed || !policy || !/^PermitRootLogin (yes|no)\s*$/m.test(observed) ||
    !/Root SSH login disabled\./.test(policy) || /Root SSH login disabled\.|should|recommended/i.test(observed) ||
    /^PermitRootLogin /m.test(policy)) {
    throw new Error("Linux Patch A QA: observed SSH configuration and expected policy are not explicitly separated.");
  }
  const ssh = assetByPath(assets, "assets/configs/ssh/sshd_config");
  const securityPolicy = assetByPath(assets, "assets/docs/security_policy.md");
  if ((ssh && !ssh.content.startsWith("# Supplied SSH configuration sample: capture time and incident-time effectiveness not established")) ||
    (securityPolicy && !securityPolicy.content.includes("Authority: expected policy, not observed host configuration"))) {
    throw new Error("Linux Patch A QA: standalone configuration authority is not explicitly separated.");
  }
  if (config && !/^# sudoers\.sample[^\n]*illustrative[^\n]*not a captured effective sudoers file\./m.test(config.content)) {
    throw new Error("Linux Patch A QA: sudoers sample is not explicitly distinguished from effective host policy.");
  }
  for (const asset of assets.filter(hasExplicitTelemetryLoss)) {
    if (!/# telemetry_completeness=partial source=assets\/\S+ host=\S+ interval_start=\d{4}-\d\d-\d\d \d\d:\d\d:\d\d interval_end=\d{4}-\d\d-\d\d \d\d:\d\d:\d\d reason=\S+/.test(asset.content)) {
      throw new Error('Linux Patch A QA: telemetry gap in ' + asset.file_path + ' lacks an explicit completeness boundary.');
    }
  }
}

/** Patch 1 trust boundary: reject technically impossible or temporally misleading packs. */
export function validateLinuxPatch1Integrity(simulation: LinuxSimulationWorld, assets: LabAsset[]) {
  const windowStart = simulation.collection.windowStart;
  const windowEnd = simulation.collection.windowEnd;
  const centralEvents = simulation.investigation.incidentFamily === "cron_persistence"
    ? simulation.scheduledExecutions.filter((execution) =>
        simulation.cronDefinitions.some((definition) => definition.id === execution.definitionId && definition.purpose === "incident")
      ).map((execution) => execution.occurredAt)
    : simulation.investigation.incidentFamily === "unauthorized_package_install"
      ? simulation.packageTransactions.filter((transaction) => transaction.source === "manual").map((transaction) => transaction.startedAt)
      : simulation.commands.filter((command) => command.kind === "primary_incident").map((command) => command.timestamp);
  if (centralEvents.length === 0 || !centralEvents.some((timestamp) => timestampInWindow(timestamp, windowStart, windowEnd))) {
    throw new Error(`Linux learner QA: central incident event is outside the investigation window ${windowStart}..${windowEnd}.`);
  }

  for (const definition of simulation.cronDefinitions.filter((item) => item.purpose === "incident" && item.enabled && item.persistenceState === "present")) {
    const expected = expectedCronOccurrences(definition.schedule, windowStart, windowEnd)
      .filter((timestamp) => `${timestamp}:00` >= definition.createdAt)
      .filter((timestamp) => !definition.removedAt || `${timestamp}:00` <= definition.removedAt);
    const observed = new Set(simulation.scheduledExecutions
      .filter((execution) => execution.definitionId === definition.id)
      .map((execution) => execution.occurredAt.slice(0, 16)));
    const missing = expected.filter((timestamp) => !observed.has(timestamp));
    if (missing.length > 0) {
      throw new Error(`Linux learner QA: recurring schedule ${definition.id} lacks expected in-window occurrence(s): ${missing.join(", ")}.`);
    }
  }

  for (const process of simulation.processes) {
    const command = process.commandId ? simulation.commands.find((item) => item.id === process.commandId) : undefined;
    if (!command) continue;
    for (const file of simulation.files.filter((item) =>
      item.createdAt && item.relatedCommandIds.includes(command.id) &&
      item.createdAt >= process.startedAt && (!process.endedAt || item.createdAt <= process.endedAt)
    )) {
      if (file.ownerUid !== process.effectiveUid || file.groupGid !== process.effectiveGid) {
        throw new Error(`Linux learner QA: process-created object ${file.path} ownership does not follow effective identity for ${process.id}.`);
      }
    }
  }

  const serviceInventory = assets.find((asset) => asset.file_path === "assets/reports/service_inventory.txt");
  if (!serviceInventory || !serviceInventory.content.includes(simulation.collection.collectedAt) || !serviceInventory.content.includes("collection_snapshot")) {
    throw new Error("Linux learner QA: service-state evidence lacks incident-relative capture authority.");
  }

  for (const task of simulation.canonicalTasks) {
    if (task.intent === "change_control") {
      const capabilities = new Set(task.requirements.map((requirement) => requirement.capability));
      const runtimeSide = ["command_execution", "authentication", "cron_execution", "package_transaction", "service_transition"]
        .some((capability) => capabilities.has(capability as never));
      if (!capabilities.has("change_control") || !runtimeSide) {
        throw new Error(`Linux learner QA: change-correlation task ${task.id} lacks approval or runtime side.`);
      }
    }
  }

  validateCanonicalExecutionLifecycle(simulation);
}
