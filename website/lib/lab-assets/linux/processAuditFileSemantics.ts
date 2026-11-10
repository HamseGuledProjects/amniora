import type {
  CanonicalCommand,
  CanonicalFile,
  CanonicalHistoricalFileAccessRecord,
  CanonicalProcess,
  LinuxSimulationWorld,
} from "./simulation";
import {
  canonicalHistoricalFileAccessRecords,
  canonicalIdentity,
  canonicalProcessRuntimeEndAt,
  renderCommandInvocation,
} from "./simulation";
import { parseLinuxCsvLine } from "./csv";

export type LinuxProcessAuditFileSemanticCheck = {
  code: string;
  message: string;
  passed: boolean;
};

export type LinuxProcessAuditFileSemanticIssue = {
  code: string;
  severity: "critical" | "high" | "medium";
  category:
    | "process"
    | "execution"
    | "audit"
    | "file"
    | "snapshot"
    | "artifact";
  message: string;
  filePath?: string;
  evidence?: string;
};

export type LinuxProcessAuditFileSemanticReport = {
  status: "valid" | "invalid";
  processLifecycleChecks: LinuxProcessAuditFileSemanticCheck[];
  ancestryChecks: LinuxProcessAuditFileSemanticCheck[];
  executionChecks: LinuxProcessAuditFileSemanticCheck[];
  auditEventChecks: LinuxProcessAuditFileSemanticCheck[];
  fileObjectChecks: LinuxProcessAuditFileSemanticCheck[];
  fileAccessChecks: LinuxProcessAuditFileSemanticCheck[];
  processSnapshotChecks: LinuxProcessAuditFileSemanticCheck[];
  openFileSnapshotChecks: LinuxProcessAuditFileSemanticCheck[];
  renderedArtifactChecks: LinuxProcessAuditFileSemanticCheck[];
  issues: LinuxProcessAuditFileSemanticIssue[];
};

type AssetLike = { file_path: string; content: string };

function ts(value: string | undefined) {
  if (!value) return Number.NaN;
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function assetText(assets: AssetLike[] | undefined, path: string) {
  return assets?.find((asset) => asset.file_path === path)?.content || "";
}

function addIssue(
  report: LinuxProcessAuditFileSemanticReport,
  bucket: keyof Omit<LinuxProcessAuditFileSemanticReport, "status" | "issues">,
  issue: LinuxProcessAuditFileSemanticIssue
) {
  report.issues.push(issue);
  report[bucket].push({ code: issue.code, message: issue.message, passed: false });
}

function addPass(
  report: LinuxProcessAuditFileSemanticReport,
  bucket: keyof Omit<LinuxProcessAuditFileSemanticReport, "status" | "issues">,
  code: string,
  message: string
) {
  if (!report[bucket].some((check) => check.code === code && !check.passed)) {
    report[bucket].push({ code, message, passed: true });
  }
}

function processAliveAt(process: CanonicalProcess, timestamp: string) {
  const endedAt = canonicalProcessRuntimeEndAt(process);
  return process.startedAt <= timestamp && (!endedAt || endedAt > timestamp);
}

function finalState(process: CanonicalProcess, captureAt: string) {
  const endedAt = canonicalProcessRuntimeEndAt(process);
  if (!endedAt || endedAt > captureAt) return "running";
  return "completed";
}

function parseHeaderedCsv(content: string) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const header = parseLinuxCsvLine(lines[0] || "").values;
  return lines.slice(1).map((line) => {
    const values = parseLinuxCsvLine(line).values;
    return Object.fromEntries(header.map((key, index) => [key, values[index] || ""]));
  });
}

type AuditRecord = {
  type: string;
  timestamp: string;
  serial?: string;
  event?: string;
  pid?: number;
  ppid?: number;
  auid?: number;
  uid?: number;
  gid?: number;
  cwd?: string;
  cmd?: string;
  exe?: string;
  res?: string;
  item?: number;
  name?: string;
  line: string;
};

function field(line: string, name: string) {
  return line.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ||
    line.match(new RegExp(`\\b${name}=([^\\s]+)`, "i"))?.[1];
}

function parseAuditRecords(content: string): AuditRecord[] {
  return content.split(/\r?\n/).flatMap((line) => {
    const type = line.match(/^type=([A-Z_]+)/)?.[1];
    const time = line.match(/msg=audit\((\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\)/)?.[1];
    if (!type || !time) return [];
    return [{
      type,
      timestamp: time,
      serial: field(line, "serial"),
      event: field(line, "event"),
      pid: Number.parseInt(field(line, "pid") || "", 10) || undefined,
      ppid: Number.parseInt(field(line, "ppid") || "", 10) || undefined,
      auid: Number.parseInt(field(line, "auid") || "", 10) || undefined,
      uid: Number.parseInt(field(line, "uid") || "", 10) || undefined,
      gid: Number.parseInt(field(line, "gid") || "", 10) || undefined,
      cwd: field(line, "cwd"),
      cmd: field(line, "cmd"),
      exe: field(line, "exe"),
      res: field(line, "res"),
      item: Number.parseInt(field(line, "item") || "", 10),
      name: field(line, "name"),
      line,
    }];
  });
}

function operationFor(command: CanonicalCommand, file: CanonicalFile) {
  const rendered = renderCommandInvocation(command);
  const path = file.path;
  if (path === command.executable) return "execute/read";
  if (/\bcat\b/i.test(rendered)) return rendered.includes(path) ? "read" : "unrelated";
  if (/\bstat\b/i.test(rendered)) return rendered.includes(path) ? "stat" : "unrelated";
  if (/\bjournalctl\b/i.test(rendered)) {
    if (/authorized_keys|\/home\/[^/]+\/\.ssh/i.test(path)) return "unrelated";
    return /\/var\/log|journal|systemd|\/run\/log/i.test(path) ? "read" : "indirect";
  }
  if (/\btar\b/i.test(rendered)) {
    const output = rendered.match(/\s-[A-Za-z]*f\s+(\S+)/)?.[1];
    if (output && path === output) return "write";
    return rendered.includes(path) ? "read" : "indirect";
  }
  if (/\brsync\b/i.test(rendered)) {
    const argv = rendered.trim().split(/\s+/);
    const operands = argv.filter((item) => item.startsWith("/"));
    const destination = operands.at(-1);
    if (destination && path === destination) return "write";
    return rendered.includes(path) ? "read" : "indirect";
  }
  if (/\bchmod\b/i.test(rendered)) return rendered.includes(path) ? "write" : "unrelated";
  if (/\bchown\b/i.test(rendered)) return rendered.includes(path) ? "write" : "unrelated";
  if (/\bsystemctl\b/i.test(rendered)) {
    if (/authorized_keys|\/home\/[^/]+\/\.ssh/i.test(path)) return "unrelated";
    return /systemd|\/etc\/ssh|\/etc\/.+\.conf|\.service$/.test(path) ? "indirect" : "indirect";
  }
  if (/\bdocker\s+run\b/i.test(rendered)) return rendered.includes(path) || /docker\.sock|\/var\/lib\/docker/.test(path) ? "indirect" : "unrelated";
  if (/\bdocker\s+inspect\b/i.test(rendered)) return /docker\.sock|\/var\/lib\/docker/.test(path) ? "read" : "unrelated";
  return rendered.includes(path) ? "access" : "indirect";
}

function validateProcessLifecycle(report: LinuxProcessAuditFileSemanticReport, simulation: LinuxSimulationWorld) {
  const byId = new Map(simulation.processes.map((process) => [process.id, process]));
  const byPid = new Map<number, CanonicalProcess[]>();
  for (const process of simulation.processes) {
    if (!Number.isInteger(process.pid) || process.pid <= 0) {
      addIssue(report, "processLifecycleChecks", {
        code: "LINUX_PROCESS_CHRONOLOGY_INVALID",
        severity: "critical",
        category: "process",
        message: `${process.id} has invalid PID ${process.pid}.`,
      });
    }
    if (process.endedAt && process.endedAt < process.startedAt) {
      addIssue(report, "processLifecycleChecks", {
        code: "LINUX_PROCESS_CHRONOLOGY_INVALID",
        severity: "critical",
        category: "process",
        message: `${process.id} ends before it starts.`,
      });
    }
    byPid.set(process.pid, [...(byPid.get(process.pid) || []), process]);
  }

  for (const [pid, processes] of byPid) {
    const ordered = processes.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    for (let index = 0; index < ordered.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < ordered.length; nextIndex += 1) {
        const current = ordered[index];
        const next = ordered[nextIndex];
        if (!current.endedAt || current.endedAt > next.startedAt) {
          addIssue(report, "processLifecycleChecks", {
            code: "LINUX_PROCESS_PID_COLLISION",
            severity: "critical",
            category: "process",
            message: `PID ${pid} is live in overlapping processes ${current.id} and ${next.id}.`,
          });
        } else if (ts(next.startedAt) - ts(current.endedAt) < 1000) {
          addIssue(report, "processLifecycleChecks", {
            code: "LINUX_PROCESS_PID_REUSE_INVALID",
            severity: "high",
            category: "process",
            message: `PID ${pid} is reused without a lifecycle boundary between ${current.id} and ${next.id}.`,
          });
        }
      }
    }
  }

  for (const process of simulation.processes) {
    if (process.ppid === 0 || process.pid === 1) continue;
    if (process.ppid === 1) continue;
    const parent = simulation.processes.find((item) => item.pid === process.ppid);
    if (!parent) {
      addIssue(report, "ancestryChecks", {
        code: "LINUX_PROCESS_PARENT_MISSING",
        severity: "critical",
        category: "process",
        message: `${process.id} references missing parent PID ${process.ppid}.`,
      });
      continue;
    }
    if (!parent.childProcessIds.includes(process.id)) {
      addIssue(report, "ancestryChecks", {
        code: "LINUX_PROCESS_ANCESTRY_INVALID",
        severity: "critical",
        category: "process",
        message: `${process.id} parent ${parent.id} does not include the child link.`,
      });
    }
    if (parent.startedAt > process.startedAt) {
      addIssue(report, "ancestryChecks", {
        code: "LINUX_PROCESS_ANCESTRY_INVALID",
        severity: "critical",
        category: "process",
        message: `${process.id} starts before parent ${parent.id}.`,
      });
    }
    const parentEndAt = canonicalProcessRuntimeEndAt(parent);
    const childEndAt = canonicalProcessRuntimeEndAt(process);
    if (parentEndAt && (!childEndAt || childEndAt > parentEndAt) && process.currentPpid !== 1) {
      addIssue(report, "ancestryChecks", {
        code: "LINUX_PROCESS_ANCESTRY_INVALID",
        severity: "high",
        category: "process",
        message: `${process.id} outlives parent ${parent.id} without modeled reparenting.`,
      });
    }
  }

  for (const process of simulation.processes) {
    for (const childId of process.childProcessIds) {
      if (!byId.has(childId)) {
        addIssue(report, "ancestryChecks", {
          code: "LINUX_PROCESS_ANCESTRY_INVALID",
          severity: "critical",
          category: "process",
          message: `${process.id} references missing child ${childId}.`,
        });
      }
    }
  }

  addPass(report, "processLifecycleChecks", "LINUX_PROCESS_LIFECYCLE_VALIDATED", "Process PID and lifecycle intervals were checked.");
  addPass(report, "ancestryChecks", "LINUX_PROCESS_ANCESTRY_VALIDATED", "Process parent/child ancestry was checked.");
}

function validateExecutions(report: LinuxProcessAuditFileSemanticReport, simulation: LinuxSimulationWorld) {
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));
  const commandById = new Map(simulation.commands.map((command) => [command.id, command]));
  for (const execution of simulation.executions) {
    const process = execution.processId ? processById.get(execution.processId) : execution.hostProcessId ? processById.get(execution.hostProcessId) : undefined;
    if (!process) continue;
    if (execution.processPolicy !== "no_child_process" && (execution.startTime !== process.startedAt || execution.endTime !== process.endedAt)) {
      addIssue(report, "executionChecks", {
        code: "LINUX_EXECUTION_OUTSIDE_PROCESS_LIFETIME",
        severity: "critical",
        category: "execution",
        message: `${execution.id} chronology disagrees with process ${process.id}.`,
      });
    }
    if (execution.commandId) {
      const command = commandById.get(execution.commandId);
      if (!command || command.processId !== process.pid || command.timestamp < process.startedAt || (process.endedAt && command.timestamp > process.endedAt)) {
        addIssue(report, "executionChecks", {
          code: "LINUX_EXECUTION_COMMAND_MISMATCH",
          severity: "critical",
          category: "execution",
          message: `${execution.id} command does not fit process lifetime or PID.`,
        });
      }
    }
    const actor = simulation.identities.find((item) => item.id === execution.identityId);
    if (actor && execution.processPolicy !== "no_child_process" && process.realUid !== actor.uid) {
      addIssue(report, "executionChecks", {
        code: "LINUX_EXECUTION_IDENTITY_MISMATCH",
        severity: "critical",
        category: "execution",
        message: `${execution.id} actor UID disagrees with process ${process.id}.`,
      });
    }
  }
  addPass(report, "executionChecks", "LINUX_EXECUTION_LIFECYCLE_VALIDATED", "Execution/process command lifecycle was checked.");
}

function validateFileObjects(report: LinuxProcessAuditFileSemanticReport, simulation: LinuxSimulationWorld) {
  const byPath = new Map<string, CanonicalFile[]>();
  for (const file of simulation.files) {
    byPath.set(file.path, [...(byPath.get(file.path) || []), file]);
    if (file.createdAt && file.deletedAt && file.createdAt > file.deletedAt) {
      addIssue(report, "fileObjectChecks", {
        code: "LINUX_FILE_LIFECYCLE_INVALID",
        severity: "critical",
        category: "file",
        message: `${file.id} is deleted before creation.`,
      });
    }
    if (file.deletedAt && file.modifiedAt > file.deletedAt) {
      addIssue(report, "fileObjectChecks", {
        code: "LINUX_FILE_LIFECYCLE_INVALID",
        severity: "critical",
        category: "file",
        message: `${file.id} is modified after deletion.`,
      });
    }
  }
  for (const [path, files] of byPath) {
    const signatures = new Set(files.map((file) => `${file.ownerUid}:${file.groupGid}:${file.mode}:${file.fileType}`));
    if (signatures.size > 1) {
      addIssue(report, "fileObjectChecks", {
        code: "LINUX_FILE_IDENTITY_CONTRADICTION",
        severity: "critical",
        category: "file",
        message: `${path} has contradictory canonical file metadata.`,
      });
    }
  }
  addPass(report, "fileObjectChecks", "LINUX_FILE_OBJECTS_VALIDATED", "Canonical file identity and lifecycle were checked.");
}

function validateFileAccess(report: LinuxProcessAuditFileSemanticReport, simulation: LinuxSimulationWorld) {
  let records: CanonicalHistoricalFileAccessRecord[] = [];
  try {
    records = canonicalHistoricalFileAccessRecords(simulation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Canonical file access records could not be constructed.";
    addIssue(report, "fileAccessChecks", {
      code: /outside process .* lifetime/i.test(message)
        ? "LINUX_FILE_ACCESS_OUTSIDE_PROCESS_LIFETIME"
        : "LINUX_FILE_ACCESS_PATH_MISMATCH",
      severity: "critical",
      category: "file",
      message,
    });
    return;
  }
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));
  const commandById = new Map(simulation.commands.map((command) => [command.id, command]));
  const fileById = new Map(simulation.files.map((file) => [file.id, file]));
  for (const record of records) {
    const process = processById.get(record.sourceProcessId);
    const command = commandById.get(record.sourceCommandId);
    const file = fileById.get(record.fileId);
    if (!process || !command || !file) continue;
    if (!processAliveAt(process, record.timestamp)) {
      addIssue(report, "fileAccessChecks", {
        code: "LINUX_FILE_ACCESS_OUTSIDE_PROCESS_LIFETIME",
        severity: "critical",
        category: "file",
        message: `${record.sourceCommandId} accesses ${record.filePath} at ${record.timestamp} outside process ${process.id} lifetime.`,
      });
    }
    if (file.createdAt && record.timestamp < file.createdAt && !["create", "write"].includes(operationFor(command, file))) {
      addIssue(report, "fileAccessChecks", {
        code: "LINUX_FILE_LIFECYCLE_INVALID",
        severity: "critical",
        category: "file",
        message: `${record.sourceCommandId} reads ${record.filePath} before file creation.`,
      });
    }
    if (file.deletedAt && record.timestamp > file.deletedAt) {
      addIssue(report, "fileAccessChecks", {
        code: "LINUX_FILE_LIFECYCLE_INVALID",
        severity: "critical",
        category: "file",
        message: `${record.sourceCommandId} accesses ${record.filePath} after deletion.`,
      });
    }
    const operation = operationFor(command, file);
    if (operation === "unrelated") {
      addIssue(report, "fileAccessChecks", {
        code: "LINUX_FILE_ACCESS_PATH_MISMATCH",
        severity: "critical",
        category: "file",
        message: `${record.sourceCommandId} ${command.renderedCommand} has unrelated file access ${file.path}.`,
      });
    }
    if (/\bcat\b/i.test(command.renderedCommand) && /write|create|truncate/i.test(operation)) {
      addIssue(report, "fileAccessChecks", {
        code: "LINUX_FILE_ACCESS_OPERATION_INVALID",
        severity: "critical",
        category: "file",
        message: `${record.sourceCommandId} cat operation is rendered as write.`,
      });
    }
    if (/\bstat\b/i.test(command.renderedCommand) && /write|create|truncate/i.test(operation)) {
      addIssue(report, "fileAccessChecks", {
        code: "LINUX_FILE_ACCESS_OPERATION_INVALID",
        severity: "critical",
        category: "file",
        message: `${record.sourceCommandId} stat operation is rendered as modification.`,
      });
    }
  }
  addPass(report, "fileAccessChecks", "LINUX_FILE_ACCESS_VALIDATED", "Canonical file access lifetimes and command semantics were checked.");
}

function validateAudit(report: LinuxProcessAuditFileSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  const audit = assetText(finalAssets, "assets/logs/audit.log");
  if (!audit) return;
  const records = parseAuditRecords(audit);
  const processByPid = new Map(simulation.processes.map((process) => [process.pid, process]));
  const fileByPath = new Map(simulation.files.map((file) => [file.path, file]));
  const commandByRendered = new Map(simulation.commands.map((command) => [renderCommandInvocation(command), command]));
  let expectedAccess: CanonicalHistoricalFileAccessRecord[] = [];
  try {
    expectedAccess = canonicalHistoricalFileAccessRecords(simulation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Canonical audit file access records could not be constructed.";
    addIssue(report, "auditEventChecks", {
      code: /outside process .* lifetime/i.test(message)
        ? "LINUX_FILE_ACCESS_OUTSIDE_PROCESS_LIFETIME"
        : "LINUX_AUDIT_PATH_UNRELATED",
      severity: "critical",
      category: "audit",
      message,
      filePath: "assets/logs/audit.log",
    });
  }
  const expectedAccessKeys = new Set(expectedAccess.map((record) => `${record.pid}\u0000${record.filePath}`));
  const groups = new Map<string, AuditRecord[]>();
  for (const record of records.filter((item) => ["USER_CMD", "EXECVE", "PATH"].includes(item.type))) {
    if (!record.serial || !record.event) {
      addIssue(report, "auditEventChecks", {
        code: "LINUX_AUDIT_EVENT_ID_MISSING",
        severity: "critical",
        category: "audit",
        message: `${record.type} audit record lacks serial or event identifier.`,
        filePath: "assets/logs/audit.log",
        evidence: record.line,
      });
    }
    const key = record.serial || `missing:${record.timestamp}:${record.pid || ""}:${record.type}`;
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  for (const [serial, group] of groups) {
    const events = new Set(group.map((record) => record.event).filter(Boolean));
    if (events.size > 1) {
      addIssue(report, "auditEventChecks", {
        code: "LINUX_AUDIT_SERIAL_MISMATCH",
        severity: "critical",
        category: "audit",
        message: `Audit serial ${serial} spans multiple event identifiers.`,
        filePath: "assets/logs/audit.log",
      });
    }
    const userCommand = group.find((record) => record.type === "USER_CMD");
    const execve = group.find((record) => record.type === "EXECVE") || userCommand;
    const context = execve || userCommand || group[0];
    const isNoiseEvent = [...events].some((event) => event?.startsWith("audit:noise:"));
    const process = context.pid ? processByPid.get(context.pid) : undefined;
    if (context.pid && !process && !isNoiseEvent) {
      addIssue(report, "auditEventChecks", {
        code: "LINUX_AUDIT_RECORD_COHESION_INVALID",
        severity: "critical",
        category: "audit",
        message: `Audit serial ${serial} references unknown PID ${context.pid}.`,
        filePath: "assets/logs/audit.log",
      });
    }
    if (process && !processAliveAt(process, context.timestamp)) {
      addIssue(report, "auditEventChecks", {
        code: "LINUX_EXECUTION_OUTSIDE_PROCESS_LIFETIME",
        severity: "critical",
        category: "audit",
        message: `Audit serial ${serial} occurs outside PID ${process.pid} lifetime.`,
        filePath: "assets/logs/audit.log",
      });
    }
    if (process && context.auid !== undefined && context.auid !== process.realUid && context.auid !== canonicalIdentity(simulation, process.identityId).uid) {
      addIssue(report, "auditEventChecks", {
        code: "LINUX_AUDIT_IDENTITY_MISMATCH",
        severity: "critical",
        category: "audit",
        message: `Audit serial ${serial} AUID ${context.auid} disagrees with PID ${process.pid}.`,
        filePath: "assets/logs/audit.log",
      });
    }
    if (process && context.cwd && context.cwd !== process.cwd) {
      addIssue(report, "auditEventChecks", {
        code: "LINUX_AUDIT_RECORD_COHESION_INVALID",
        severity: "critical",
        category: "audit",
        message: `Audit serial ${serial} cwd ${context.cwd} disagrees with process ${process.cwd}.`,
        filePath: "assets/logs/audit.log",
      });
    }
    if (context.cmd && !commandByRendered.has(context.cmd) && !isNoiseEvent) {
      addIssue(report, "auditEventChecks", {
        code: "LINUX_AUDIT_COMMAND_MISMATCH",
        severity: "critical",
        category: "audit",
        message: `Audit serial ${serial} command ${context.cmd} is not canonical.`,
        filePath: "assets/logs/audit.log",
      });
    }
    const seenItems = new Set<number>();
    for (const pathRecord of group.filter((record) => record.type === "PATH")) {
      if (pathRecord.item !== undefined && !Number.isNaN(pathRecord.item)) {
        if (seenItems.has(pathRecord.item)) {
          addIssue(report, "auditEventChecks", {
            code: "LINUX_AUDIT_RECORD_COHESION_INVALID",
            severity: "critical",
            category: "audit",
            message: `Audit serial ${serial} duplicates PATH item ${pathRecord.item}.`,
            filePath: "assets/logs/audit.log",
          });
        }
        seenItems.add(pathRecord.item);
      }
      const pathProcess = pathRecord.pid ? processByPid.get(pathRecord.pid) : process;
      if (pathProcess && !processAliveAt(pathProcess, pathRecord.timestamp)) {
        addIssue(report, "auditEventChecks", {
          code: "LINUX_AUDIT_PATH_AFTER_PROCESS_END",
          severity: "critical",
          category: "audit",
          message: `PATH ${pathRecord.name || ""} occurs after PID ${pathProcess.pid} ended.`,
          filePath: "assets/logs/audit.log",
          evidence: pathRecord.line,
        });
      }
      if (pathRecord.pid && pathRecord.name && !expectedAccessKeys.has(`${pathRecord.pid}\u0000${pathRecord.name}`)) {
        addIssue(report, "auditEventChecks", {
          code: "LINUX_AUDIT_PATH_UNRELATED",
          severity: "critical",
          category: "audit",
          message: `PATH ${pathRecord.name} is not attached to canonical PID ${pathRecord.pid} file access.`,
          filePath: "assets/logs/audit.log",
          evidence: pathRecord.line,
        });
      }
      if (pathRecord.name && !fileByPath.has(pathRecord.name)) {
        addIssue(report, "auditEventChecks", {
          code: "LINUX_AUDIT_PATH_UNRELATED",
          severity: "critical",
          category: "audit",
          message: `PATH ${pathRecord.name} does not resolve to a canonical file object.`,
          filePath: "assets/logs/audit.log",
          evidence: pathRecord.line,
        });
      }
    }
  }
  addPass(report, "auditEventChecks", "LINUX_AUDIT_EVENTS_VALIDATED", "Rendered audit record groups were checked.");
}

function validateSnapshots(report: LinuxProcessAuditFileSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  const snapshot = assetText(finalAssets, "assets/runtime/process_snapshot.txt");
  const openFiles = assetText(finalAssets, "assets/runtime/open_files.txt");
  const captureAt = simulation.collection.windowEnd;
  if (snapshot) {
    if (!/^# capture_at=\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/m.test(snapshot)) {
      addIssue(report, "processSnapshotChecks", {
        code: "LINUX_PROCESS_SNAPSHOT_INVALID",
        severity: "critical",
        category: "snapshot",
        message: "process_snapshot.txt lacks explicit capture time.",
        filePath: "assets/runtime/process_snapshot.txt",
      });
    }
    const liveByPid = new Map(simulation.processes.filter((process) => processAliveAt(process, captureAt)).map((process) => [String(process.pid), process]));
    for (const line of snapshot.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#") || /^USER\s+PID\s+/i.test(line) || /\s1\s+0\s+\/sbin\/init/.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[1];
      const ppid = parts[2];
      if (!/^\d+$/.test(pid || "")) continue;
      const process = liveByPid.get(pid);
      if (!process) {
        addIssue(report, "processSnapshotChecks", {
          code: "LINUX_PROCESS_SNAPSHOT_INVALID",
          severity: "critical",
          category: "snapshot",
          message: `process_snapshot.txt renders non-live or unknown PID ${pid}.`,
          filePath: "assets/runtime/process_snapshot.txt",
          evidence: line.trim(),
        });
      } else if (String(process.currentPpid ?? process.ppid) !== ppid) {
        addIssue(report, "processSnapshotChecks", {
          code: "LINUX_PROCESS_SNAPSHOT_INVALID",
          severity: "critical",
          category: "snapshot",
          message: `process_snapshot.txt PID ${pid} PPID disagrees with canonical lifecycle.`,
          filePath: "assets/runtime/process_snapshot.txt",
          evidence: line.trim(),
        });
      }
    }
  }
  if (openFiles) {
    if (!/^# capture_at=\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/m.test(openFiles)) {
      addIssue(report, "openFileSnapshotChecks", {
        code: "LINUX_OPEN_FILE_STATE_INVALID",
        severity: "critical",
        category: "snapshot",
        message: "open_files.txt lacks explicit capture time.",
        filePath: "assets/runtime/open_files.txt",
      });
    }
    const livePids = new Set(simulation.processes.filter((process) => processAliveAt(process, captureAt)).map((process) => String(process.pid)));
    const descriptorKeys = new Set((simulation.openFileDescriptors || [])
      .filter((descriptor) => descriptor.state === "current")
      .map((descriptor) => `${descriptor.pid}:${descriptor.fd}:${descriptor.targetPath || descriptor.targetId}`));
    for (const line of openFiles.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#") || /^COMMAND\s+PID\s+/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[1];
      const fd = parts[3];
      const path = parts.slice(8).join(" ").replace(/\s+\(deleted\)$/, "");
      if (!/^\d+$/.test(pid || "")) continue;
      if (!livePids.has(pid)) {
        addIssue(report, "openFileSnapshotChecks", {
          code: "LINUX_OPEN_FILE_PROCESS_NOT_LIVE",
          severity: "critical",
          category: "snapshot",
          message: `open_files.txt renders descriptor for non-live PID ${pid}.`,
          filePath: "assets/runtime/open_files.txt",
          evidence: line.trim(),
        });
      }
      if (fd && path && !descriptorKeys.has(`${pid}:${fd}:${path}`) && !/^socket|tcp|udp|unix/i.test(path)) {
        addIssue(report, "openFileSnapshotChecks", {
          code: "LINUX_OPEN_FILE_STATE_INVALID",
          severity: "critical",
          category: "snapshot",
          message: `open_files.txt descriptor PID ${pid} FD ${fd} target ${path} is not canonical current state.`,
          filePath: "assets/runtime/open_files.txt",
          evidence: line.trim(),
        });
      }
    }
  }
  const historyRows = parseHeaderedCsv(assetText(finalAssets, "assets/runtime/process_execution_history.txt"));
  for (const row of historyRows) {
    if (row.state_type === "current" || row.evidence_type === "live_process_snapshot") {
      addIssue(report, "renderedArtifactChecks", {
        code: "LINUX_EVIDENCE_STATE_TYPE_CONTRADICTION",
        severity: "critical",
        category: "artifact",
        message: "process_execution_history.txt is historical evidence but renders current-state labels.",
        filePath: "assets/runtime/process_execution_history.txt",
      });
    }
  }
  for (const process of simulation.processes) {
    if (canonicalProcessRuntimeEndAt(process) && finalState(process, captureAt) !== "running" && snapshot.includes(` ${process.pid} `)) {
      addIssue(report, "processSnapshotChecks", {
        code: "LINUX_PROCESS_STATE_CONTRADICTION",
        severity: "critical",
        category: "snapshot",
        message: `Ended process ${process.id} appears in current process snapshot.`,
        filePath: "assets/runtime/process_snapshot.txt",
      });
    }
  }
  addPass(report, "processSnapshotChecks", "LINUX_PROCESS_SNAPSHOT_VALIDATED", "Process snapshot capture semantics were checked.");
  addPass(report, "openFileSnapshotChecks", "LINUX_OPEN_FILE_SNAPSHOT_VALIDATED", "Open-file snapshot capture semantics were checked.");
  addPass(report, "renderedArtifactChecks", "LINUX_RENDERED_ARTIFACTS_VALIDATED", "Rendered process state-type evidence was checked.");
}

export function buildLinuxProcessAuditFileSemanticReport(input: {
  simulation: LinuxSimulationWorld;
  finalAssets?: AssetLike[];
}): LinuxProcessAuditFileSemanticReport {
  const report: LinuxProcessAuditFileSemanticReport = {
    status: "valid",
    processLifecycleChecks: [],
    ancestryChecks: [],
    executionChecks: [],
    auditEventChecks: [],
    fileObjectChecks: [],
    fileAccessChecks: [],
    processSnapshotChecks: [],
    openFileSnapshotChecks: [],
    renderedArtifactChecks: [],
    issues: [],
  };

  validateProcessLifecycle(report, input.simulation);
  validateExecutions(report, input.simulation);
  validateFileObjects(report, input.simulation);
  validateFileAccess(report, input.simulation);
  validateAudit(report, input.simulation, input.finalAssets);
  validateSnapshots(report, input.simulation, input.finalAssets);
  report.status = report.issues.length > 0 ? "invalid" : "valid";
  return report;
}
