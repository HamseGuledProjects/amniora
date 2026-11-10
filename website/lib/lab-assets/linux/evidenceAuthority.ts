import type { LabAsset } from "../types";
import { linuxLearnerSubjectLabel, renderCommandInvocation, scheduledExecutionRenderedPhase, simulationScriptAssets, type LinuxSimulationWorld, type CanonicalCommand } from "./simulation";
import { splitShellCommand } from "./commandSemantics";

/** Native records remain records: commas, quoted newlines and comments must not mix fields. */
export function evidenceCsvRows(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i <= content.length; i++) {
    const c = content[i] || "\n";
    if (c === '"') {
      if (quoted && content[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(field); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(v => v.trim()) && !row[0].startsWith("#")) rows.push(row);
      row = []; field = "";
    } else field += c;
  }
  const header = rows.shift() || [];
  return rows.map(values => Object.fromEntries(header.map((name, i) => [name, values[i] || ""])));
}

export function evidenceCsvString(rows: Record<string, string>[]) {
  const header = Object.keys(rows[0] || {});
  const quote = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return [header.join(","), ...rows.map(row => header.map(key => quote(row[key] || "")).join(","))].join("\n") + "\n";
}

export function sourceSupportsHistoryRow(source: LabAsset, row: Record<string, string>) {
  if (source.file_path !== "assets/logs/audit.log") return false;
  const timestamp = row.timestamp || row.started_at;
  const records = nativeLines(source).filter(line => new RegExp(`\\bpid=${row.pid}\\b`).test(line));
  const pathRecord = row.path && records.find(line => line.startsWith("type=PATH ") && line.includes(`audit(${timestamp})`) && line.includes(`name="${row.path}"`));
  const serial = pathRecord ? pathRecord.match(/\bserial=(\d+)\b/)?.[1] : undefined;
  const commandRecord = records.find(line => /^type=(?:USER_CMD|EXECVE) /.test(line) && line.includes(`cmd="${row.command.replace(/"/g, '\\"')}"`) &&
    (row.path ? Boolean(serial && new RegExp(`\\bserial=${serial}\\b`).test(line) && (line.match(/audit\(([^)]+)\)/)?.[1] || "~") <= timestamp) : line.includes(`audit(${timestamp})`)));
  if (!commandRecord) return false;
  return !row.path || Boolean(pathRecord);
}

export function sourceRecordsAuthentication(simulation: LinuxSimulationWorld, source: LabAsset, sessionId: string) {
  const session = simulation.sshSessions.find(item => item.id === sessionId);
  if (!session || !["assets/logs/auth.log", "assets/journal/journal_ssh.txt"].includes(source.file_path)) return false;
  return nativeLines(source).some(line => line.startsWith(session.openedAt) &&
    (source.file_path === "assets/journal/journal_ssh.txt"
      ? line.includes(`sshd[${session.sessionPid}]: Session opened for ${session.username} from ${session.sourceIp}`) &&
        (!session.keyFingerprint || line.includes(`fingerprint ${session.keyFingerprint}`))
      : line.includes(` for ${session.username} from ${session.sourceIp} port ${session.sourcePort}`) && /Accepted (?:publickey|password)/.test(line)));
}

export function resolveExportedEvidence(assets: LabAsset[], reference: string) {
  const normalized = reference.replace(/\\/g, "/");
  const matches = assets.filter(a => a.file_path === normalized || (!normalized.includes("/") && a.file_path.split("/").pop() === normalized));
  return matches.length === 1 ? matches[0] : undefined;
}

const nativeLines = (source: LabAsset) => source.content.split(/\r?\n/).filter(line => !/^\s*(?:#|--)/.test(line));
const compact = (s: string) => s.replace(/\s+/g, " ").trim();

/** An observed command needs a native execution record, including its own time and actor. */
export function sourceRecordsCommand(simulation: LinuxSimulationWorld, source: LabAsset, command: CanonicalCommand, sudoOnly = false) {
  const actor = simulation.identities.find(i => i.id === command.actorIdentityId);
  const process = simulation.processes.find(p => p.commandId === command.id);
  if (!actor || !process) return false;
  const invocation = renderCommandInvocation(command);
  if (source.file_path === "assets/logs/sudo.log") {
    return nativeLines(source).some(line => line.startsWith(`${command.timestamp} ${actor.username} : `) &&
      line.includes(`COMMAND=${invocation}`) && /TTY=\S+.*USER=\S+/.test(line));
  }
  if (source.file_path === "assets/logs/audit.log") {
    return nativeLines(source).some(line => /type=(?:USER_CMD|EXECVE)\b/.test(line) && line.includes(`audit(${command.timestamp})`) &&
      line.includes(`cmd="${invocation.replace(/"/g, '\\"')}"`) && new RegExp(`\\bauid=${actor.uid}\\b`).test(line) &&
      new RegExp(`\\bpid=${process.pid}\\b`).test(line) && /\bres=success\b/.test(line) &&
      (!sudoOnly || command.expectedRenderTargets.includes("sudo")));
  }
  if (source.file_path === "assets/runtime/process_execution_history.txt") {
    return evidenceCsvRows(source.content).some(row => row.started_at === command.timestamp && row.command === invocation &&
      row.pid === String(process.pid) && row.state_type === "historical_reconstruction" &&
      !sudoOnly); // This view exposes effective user, not originating audit identity.
  }
  if (!sudoOnly && source.file_path === "assets/runtime/file_access_history.csv") {
    return evidenceCsvRows(source.content).some(row => row.timestamp === command.timestamp && row.command === invocation &&
      row.pid === String(process.pid) && row.state_type === "historical_reconstruction" && Boolean(row.path));
  }
  if (!sudoOnly && source.file_path === "assets/logs/syslog") {
    return nativeLines(source).some(line => line.startsWith(command.timestamp) && line.includes(`audit[${process.pid}]: ${invocation}`));
  }
  return false;
}

export type TimelineSourceRole = "source" | "exact_sources" | "context_sources" | "static_sources";

/** Validate the role as well as the event: a snapshot may contextualise a unit, never prove its prior transition. */
export function sourceSupportsTimeline(simulation: LinuxSimulationWorld, source: LabAsset, row: Record<string, string>, role: TimelineSourceRole) {
  if (source.file_path === "assets/evidence/timeline.csv") return false;
  const timestamp = row.timestamp;
  if (!timestamp) return false;
  const packageEvent = simulation.packageTransactions.find(p => p.completedAt === timestamp && linuxLearnerSubjectLabel(simulation, p.id) === row.activity_ref);
  const scheduled = simulation.scheduledExecutions.find(e =>
    (scheduledExecutionRenderedPhase(simulation, e).timestamp === timestamp || e.occurredAt === timestamp) &&
    linuxLearnerSubjectLabel(simulation, e.id) === row.activity_ref);
  const transition = simulation.serviceTransitions.find(e => e.occurredAt === timestamp && linuxLearnerSubjectLabel(simulation, e.id) === row.activity_ref);
  const event = simulation.events.find(e => e.timestamp === timestamp && e.kind === row.activity_type &&
    linuxLearnerSubjectLabel(simulation, e.commandId || e.id) === row.activity_ref);
  if (role === "static_sources") {
    if (packageEvent && source.file_path === "assets/inventory/package_inventory.txt") {
      return packageEvent.packages.every(p => nativeLines(source).some(line => line.includes(p.name)));
    }
    if (transition && source.file_path === "assets/reports/service_inventory.txt") {
      const service = simulation.services.find(s => s.id === transition.serviceId);
      return evidenceCsvRows(source.content).some(r => r.service === service?.unitName && r.state_type === "collection_snapshot");
    }
    if (scheduled) {
      const definition = simulation.cronDefinitions.find(d => d.id === scheduled.definitionId);
      const command = simulation.commands.find(c => c.id === scheduled.commandId);
      const runAs = simulation.identities.find(i => i.id === definition?.runAsIdentityId);
      return Boolean(definition && command && source.file_path.startsWith("assets/scheduled/") && nativeLines(source).some(line =>
        line.startsWith(definition.schedule + " ") && line.includes(command.renderedCommand) &&
        (definition.source === "root_crontab" || line.includes(` ${runAs?.username} `))));
    }
    return false;
  }
  if (role === "context_sources" && /service_inventory|package_inventory/.test(source.file_path)) {
    return sourceSupportsTimeline(simulation, source, row, "static_sources");
  }
  if (packageEvent) {
    if (source.file_path === "assets/logs/apt_history.log") {
      const blocks = source.content.split(/(?=Transaction-Ref:)/);
      return blocks.some(block => block.includes(`Transaction-Ref: ${row.activity_ref}`) &&
        compact(block).includes(`Start-Date: ${packageEvent.startedAt}`) && compact(block).includes(`End-Date: ${timestamp}`) &&
        packageEvent.packages.every(p => new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=:|\\s)`).test(block)));
    }
    return source.file_path === "assets/logs/syslog" && nativeLines(source).some(line => line.startsWith(timestamp) &&
      packageEvent.packages.every(p => line.includes(p.name)) && /complet/i.test(line));
  }
  if (scheduled) {
    const command = simulation.commands.find(c => c.id === scheduled.commandId);
    const process = simulation.processes.find(p => p.id === scheduled.processId);
    const runAs = simulation.identities.find(i => i.id === command?.actorIdentityId);
    if (!command || !process || !runAs) return false;
    const phase = scheduledExecutionRenderedPhase(simulation, scheduled);
    const cronRecord = source.file_path === "assets/logs/cron.log" && nativeLines(source).some(line =>
      line.startsWith(scheduled.occurredAt) && line.includes(`CRON[${process.pid}]`) && line.includes(`(${runAs.username})`) &&
      line.includes(`CMD (${command.renderedCommand})`) && line.includes(`job_ref="${row.activity_ref}"`) && line.includes(`def="${scheduled.definitionId}"`));
    if (role === "context_sources") return cronRecord || sourceRecordsCommand(simulation, source, command);
    if (source.file_path === "assets/logs/audit.log") return timestamp === scheduled.occurredAt && sourceRecordsCommand(simulation, source, command) &&
      nativeLines(source).some(line => line.includes(`audit(${timestamp})`) && line.includes(`def="${scheduled.definitionId}"`));
    if (source.file_path === "assets/logs/syslog") return nativeLines(source).some(line => line.startsWith(timestamp) &&
      line.includes(`[${process.pid}]`) && line.includes(`job_ref="${row.activity_ref}"`) && line.includes(`def="${scheduled.definitionId}"`) &&
      line.includes(phase.phase === "completed" ? scheduled.stdoutSummary || "scheduled job completed" :
        phase.phase === "started" ? "scheduled job started" :
        phase.phase === "failed" ? "scheduled job failed" : "scheduled job ended; outcome unconfirmed"));
    return timestamp === scheduled.occurredAt && cronRecord;
  }
  if (transition) {
    const service = simulation.services.find(s => s.id === transition.serviceId);
    const operation = { start: "Started", stop: "Stopped", restart: "Restarted", reload: "Reloaded", enable: "Enabled", disable: "Disabled", mask: "Masked", unmask: "Unmasked", activate: "Activated", complete: "Completed", fail: "Failed", daemon_reload: "Reloaded manager configuration for" }[transition.operation];
    return ["assets/logs/audit.log", "assets/logs/syslog", "assets/journal/journal_systemd.txt"].includes(source.file_path) && nativeLines(source).some(line =>
      line.includes(timestamp) && line.includes(service?.unitName || "<missing>") &&
      (line.includes(`op="${transition.operation}"`) || line.includes(`: ${transition.operation} -> `) || Boolean(operation && line.includes(operation))));
  }
  if (!event) return false;
  if (event.commandId) {
    const command = simulation.commands.find(c => c.id === event.commandId);
    return Boolean(command && sourceRecordsCommand(simulation, source, command));
  }
  if (event.sessionId) {
    const session = simulation.sshSessions.find(s => s.id === event.sessionId);
    const actor = simulation.identities.find(i => i.id === session?.identityId);
    const action = event.kind === "ssh_session_close" ? /(?:session closed|Disconnected|Connection closed)/i : /(?:session opened|Accepted)/i;
    return Boolean(actor && ["assets/logs/auth.log", "assets/journal/journal_ssh.txt"].includes(source.file_path) && nativeLines(source).some(line =>
      line.startsWith(timestamp) && line.includes(actor.username) && action.test(line)));
  }
  return false;
}

/** Scope references once during assembly; final validation never repairs mutated evidence. */
export function scopeTimelineToExports(simulation: LinuxSimulationWorld, assets: LabAsset[]) {
  // Derived registers must not retain canonical references to files removed by tier scoping.
  for (const asset of assets) {
    if (!/^(?:id,finding,|risk_id,|evidence_type,state_type,)/.test(asset.content)) continue;
    const records = evidenceCsvRows(asset.content);
    for (const row of records) {
      if (row.evidence) row.evidence = row.evidence.split(";").filter(ref => resolveExportedEvidence(assets, ref)).join(";");
      if (row.source_telemetry && row.started_at) {
        const audit = resolveExportedEvidence(assets, "audit.log");
        row.source_telemetry = audit && sourceSupportsHistoryRow(audit, row) ? "audit.log" : "native process lifecycle telemetry";
      }
      if (row.source_telemetry && row.path && !resolveExportedEvidence(assets, "audit.log")) {
        row.source_telemetry = "file-access telemetry (original log outside exported scope)";
      }
    }
    asset.content = evidenceCsvString(records);
  }
  const timeline = assets.find(a => a.file_path === "assets/evidence/timeline.csv");
  if (!timeline) return;
  const rows = evidenceCsvRows(timeline.content);
  for (const row of rows) {
    for (const role of ["source", "exact_sources", "context_sources", "static_sources"] as const) {
      row[role] = (row[role] || "").split(";").filter(ref => {
        const source = resolveExportedEvidence(assets, ref);
        return source && sourceSupportsTimeline(simulation, source, row, role);
      }).join(";");
    }
    if (!row.exact_sources) throw new Error(`Linux Patch A QA: no exported event record supports ${row.activity_ref}.`);
    row.source = row.exact_sources;
  }
  timeline.content = evidenceCsvString(rows);
}

const shellBuiltins = new Set(["set", "printf", "echo", "true", "false", "test", "[", ":", "export", "local", "return", "exit", "cd"]);

/** Traverse only successfully invoked scripts and branches whose condition is known from the world. */
export function executedScriptDependencies(simulation: LinuxSimulationWorld, suppliedScripts = simulationScriptAssets(simulation)) {
  const byPath = new Map(suppliedScripts.map(s => [s.sourcePath, s]));
  const paths = new Map<string, Set<string>>(), visited = new Set<string>();
  const visit = (path: string, identityId: string) => {
    if (visited.has(path + ":" + identityId)) return;
    visited.add(path + ":" + identityId);
    const script = byPath.get(path);
    if (!script) return;
    for (const raw of script.content.split(/\r?\n/)) {
      if (!raw.trim() || raw.trim().startsWith("#")) continue;
      let line = raw.trim();
      const conditional = line.match(/^test -e (.+?) \|\| (.+)$/);
      if (conditional) {
        const target = splitShellCommand(conditional[1]).tokens[0];
        if (simulation.files.some(f => f.path === target && !f.deletedAt)) continue;
        line = conditional[2];
      } else if (/&&|\|\||\b(?:if|while|for)\b/.test(line)) {
        throw new Error(`Linux Patch A QA: executed script ${path} has an unmodelled control-flow dependency.`);
      }
      const tokens = splitShellCommand(line).tokens;
      let executable = tokens[0];
      if (shellBuiltins.has(executable)) continue;
      if (executable === "exec") executable = tokens[1];
      if (!executable || executable.includes("$") || executable.startsWith(".")) throw new Error(`Linux Patch A QA: unresolved executed helper in ${path}.`);
      const resolved = executable.startsWith("/") ? executable : `/usr/bin/${executable}`;
      if (!paths.has(resolved)) paths.set(resolved, new Set());
      paths.get(resolved)!.add(identityId);
      visit(resolved, identityId);
    }
  };
  for (const execution of simulation.scheduledExecutions.filter(e => e.outcome === "success" && e.exitCode === 0)) {
    const command = simulation.commands.find(c => c.id === execution.commandId);
    if (command) visit(command.renderedCommand.split(/\s+/)[0], command.runAsIdentityId || command.actorIdentityId);
  }
  return [...paths].sort(([left], [right]) => left.localeCompare(right)).map(([path, identities]) => ({ path, identityIds: [...identities] }));
}

export function executedScriptHelpers(simulation: LinuxSimulationWorld, suppliedScripts = simulationScriptAssets(simulation)) {
  return executedScriptDependencies(simulation, suppliedScripts).map(item => item.path);
}

export function hasExplicitTelemetryLoss(asset: LabAsset) {
  // Only native telemetry is authoritative here; advice about possible loss is not an observation.
  return /assets\/(?:logs|journal|runtime)\//.test(asset.file_path) &&
    /(?:\blost \d+ messages?\b|\bdropped \d+ (?:events?|messages?)\b|\bdue to rate[- ]limiting\b|telemetry_completeness=partial|coverage=partial|\bpartial (?:interval )?coverage\b|\bcollection gaps?\b|\btruncat(?:ed|ion)\b|\bmissing (?:\d+ )?(?:records?|events?|messages?)\b)/i.test(asset.content);
}

export function declaredCompleteTelemetrySources(assets: LabAsset[]) {
  return assets.filter((asset) => /assets\/(?:logs|journal|runtime)\//.test(asset.file_path) &&
    !hasExplicitTelemetryLoss(asset) &&
    /# telemetry_completeness=complete\b/.test(asset.content) &&
    asset.content.split(/\r?\n/).some((line) => line.trim() && !line.startsWith("#")));
}

export function linuxLoggingQualityClaim(assets: LabAsset[], noisy: boolean) {
  const partial = assets.filter(hasExplicitTelemetryLoss).map((asset) => asset.file_path);
  const complete = declaredCompleteTelemetrySources(assets).map((asset) => asset.file_path);
  if (partial.length) {
    return `partial coverage in ${partial.join(", ")}; ${complete.length
      ? `complete coverage is declared separately for ${complete.join(", ")} within its stated scope`
      : "other supplied sources must be assessed independently"}`;
  }
  if (complete.length) return `complete coverage declared for ${complete.join(", ")} within its stated scope; other source coverage is not established`;
  return noisy ? "noisy telemetry; completeness not established" : "telemetry completeness not established by supplied sources";
}
