import type {
  CanonicalCronDefinition,
  CanonicalPackageTransaction,
  CanonicalScheduledExecution,
  CanonicalService,
  CanonicalServiceTransition,
  LinuxSimulationWorld,
} from "./simulation";
import { canonicalIdentity, renderCommandInvocation } from "./simulation";
import { parseLinuxCsvLine } from "./csv";

export type LinuxServiceSchedulerPackageSemanticCheck = {
  code: string;
  message: string;
  passed: boolean;
};

export type LinuxServiceSchedulerPackageSemanticIssue = {
  code: string;
  severity: "critical" | "high" | "medium";
  category:
    | "systemd"
    | "scheduler"
    | "package"
    | "repository"
    | "change"
    | "timezone"
    | "artifact";
  message: string;
  filePath?: string;
  evidence?: string;
};

export type LinuxServiceSchedulerPackageSemanticReport = {
  status: "valid" | "invalid";
  unitChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  serviceTransitionChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  serviceSnapshotChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  scheduleDefinitionChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  scheduledExecutionChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  packageTransactionChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  packageInventoryChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  repositoryChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  changeAlignmentChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  timezoneChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  renderedArtifactChecks: LinuxServiceSchedulerPackageSemanticCheck[];
  issues: LinuxServiceSchedulerPackageSemanticIssue[];
};

type AssetLike = { file_path: string; content: string };

function assetText(assets: AssetLike[] | undefined, path: string) {
  return assets?.find((asset) => asset.file_path === path)?.content || "";
}

function ts(value: string | undefined) {
  if (!value) return Number.NaN;
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function addIssue(
  report: LinuxServiceSchedulerPackageSemanticReport,
  bucket: keyof Omit<LinuxServiceSchedulerPackageSemanticReport, "status" | "issues">,
  issue: LinuxServiceSchedulerPackageSemanticIssue
) {
  report.issues.push(issue);
  report[bucket].push({ code: issue.code, message: issue.message, passed: false });
}

function addPass(
  report: LinuxServiceSchedulerPackageSemanticReport,
  bucket: keyof Omit<LinuxServiceSchedulerPackageSemanticReport, "status" | "issues">,
  code: string,
  message: string
) {
  if (!report[bucket].some((check) => check.code === code && !check.passed)) {
    report[bucket].push({ code, message, passed: true });
  }
}

function parseHeaderedCsv(content: string) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  const header = parseLinuxCsvLine(lines[0] || "").values;
  return lines.slice(1).map((line) => {
    const values = parseLinuxCsvLine(line).values;
    return Object.fromEntries(header.map((key, index) => [key, values[index] || ""]));
  });
}

function serviceStatus(service: CanonicalService) {
  if (service.unitType === "timer") return service.activeState === "active" ? "active" : service.activeState;
  if (service.unitType === "oneshot" && service.activeState === "inactive") return "inactive";
  return service.activeState === "active" ? "running" : service.activeState;
}

function serviceRows(content: string) {
  return parseHeaderedCsv(content).map((row) => ({
    service: row.service || "",
    status: row.status || "",
    startup: row.startup || "",
    notes: row.notes || "",
    loadState: row.load_state || "",
    activeState: row.active_state || "",
    subState: row.sub_state || "",
    result: row.result || "",
    mainPid: row.main_pid || "",
    unitPath: row.unit_path || "",
  }));
}

type CronFieldMatcher = (value: number, date: Date) => boolean;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function normalizeCronToken(token: string, names: Record<string, number>) {
  return token.toLowerCase().replace(/[a-z]{3}/g, (name) => String(names[name] ?? name));
}

function parseCronField(field: string, min: number, max: number, names: Record<string, number> = {}): CronFieldMatcher | undefined {
  const normalized = normalizeCronToken(field, names);
  if (!normalized || normalized.includes("?")) return undefined;
  const matchers = normalized.split(",").map((part) => {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) return undefined;
    let start = min;
    let end = max;
    if (rangePart !== "*") {
      if (/^\d+$/.test(rangePart)) {
        start = Number(rangePart);
        end = Number(rangePart);
      } else {
        const range = rangePart.match(/^(\d+)-(\d+)$/);
        if (!range) return undefined;
        start = Number(range[1]);
        end = Number(range[2]);
      }
    }
    if (start < min || end > max || start > end) return undefined;
    return (value: number) => value >= start && value <= end && (value - start) % step === 0;
  });
  if (matchers.some((matcher) => !matcher)) return undefined;
  return (value) => matchers.some((matcher) => matcher?.(value));
}

export function parseLinuxCronExpression(expression: string) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return { valid: false, reason: "cron expression must contain five fields" };
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const minuteMatcher = parseCronField(minute, 0, 59);
  const hourMatcher = parseCronField(hour, 0, 23);
  const domMatcher = parseCronField(dayOfMonth, 1, 31);
  const monthMatcher = parseCronField(month, 1, 12, MONTHS);
  const dowMatcher = parseCronField(dayOfWeek.replace(/\b7\b/g, "0"), 0, 6, WEEKDAYS);
  if (!minuteMatcher || !hourMatcher || !domMatcher || !monthMatcher || !dowMatcher) {
    return { valid: false, reason: "cron field is out of range or malformed" };
  }
  return {
    valid: true,
    matches(timestamp: string) {
      const date = new Date(`${timestamp.replace(" ", "T")}Z`);
      return minuteMatcher(date.getUTCMinutes(), date) &&
        hourMatcher(date.getUTCHours(), date) &&
        domMatcher(date.getUTCDate(), date) &&
        monthMatcher(date.getUTCMonth() + 1, date) &&
        dowMatcher(date.getUTCDay(), date);
    },
  };
}

function renderedCronDefinition(definition: CanonicalCronDefinition, finalAssets?: AssetLike[]) {
  return definition.source === "root_crontab"
    ? assetText(finalAssets, "assets/scheduled/root_crontab.txt")
    : assetText(finalAssets, `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`);
}

function packageInventoryRows(content: string) {
  return content.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^ii\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    return match ? [{ name: match[1], version: match[2], architecture: match[3], description: match[4], raw: line }] : [];
  });
}

function aptHistoryBlocks(content: string) {
  return content.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

function validateServices(report: LinuxServiceSchedulerPackageSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  const inventory = assetText(finalAssets, "assets/reports/service_inventory.txt");
  const journal = assetText(finalAssets, "assets/journal/journal_systemd.txt");
  const audit = assetText(finalAssets, "assets/logs/audit.log");
  const syslog = assetText(finalAssets, "assets/logs/syslog");
  const timeline = assetText(finalAssets, "assets/evidence/timeline.csv");
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));
  const commandById = new Map(simulation.commands.map((command) => [command.id, command]));
  const rowsByName = new Map(serviceRows(inventory).map((row) => [row.service.toLowerCase(), row]));

  for (const service of simulation.services) {
    if (!service.unitName || !service.id || !service.unitPath) {
      addIssue(report, "unitChecks", {
        code: "LINUX_SYSTEMD_UNIT_INVALID",
        severity: "critical",
        category: "systemd",
        message: `${service.id || service.unitName} lacks required unit identity fields.`,
      });
    }
    if (!service.unitPresent && service.loadState !== "not-found") {
      addIssue(report, "unitChecks", {
        code: "LINUX_SYSTEMD_UNIT_STATE_CONTRADICTION",
        severity: "critical",
        category: "systemd",
        message: `${service.unitName} is absent but load state is ${service.loadState}.`,
      });
    }
    if (service.loadState === "not-found" && service.activeState !== "inactive") {
      addIssue(report, "unitChecks", {
        code: "LINUX_SYSTEMD_UNIT_STATE_CONTRADICTION",
        severity: "critical",
        category: "systemd",
        message: `${service.unitName} is not-found but ${service.activeState}.`,
      });
    }
    if (service.unitFileState === "masked" && service.loadState !== "masked") {
      addIssue(report, "unitChecks", {
        code: "LINUX_SYSTEMD_CONFIG_STATE_MISMATCH",
        severity: "critical",
        category: "systemd",
        message: `${service.unitName} is masked without masked load state.`,
      });
    }
    const process = service.mainProcessId ? processById.get(service.mainProcessId) : undefined;
    if (service.mainProcessId && !process) {
      addIssue(report, "serviceSnapshotChecks", {
        code: "LINUX_SYSTEMD_MAIN_PID_MISMATCH",
        severity: "critical",
        category: "systemd",
        message: `${service.unitName} references missing main process ${service.mainProcessId}.`,
      });
    } else if (service.mainProcessId && (service.activeState !== "active" || service.subState !== "running")) {
      addIssue(report, "serviceSnapshotChecks", {
        code: "LINUX_SYSTEMD_MAIN_PID_MISMATCH",
        severity: "critical",
        category: "systemd",
        message: `${service.unitName} is ${service.activeState}/${service.subState} but retains main process ${service.mainProcessId}.`,
      });
    }

    const row = rowsByName.get(service.unitName.toLowerCase());
    if (!row) {
      addIssue(report, "renderedArtifactChecks", {
        code: "LINUX_SYSTEMD_UNIT_INVALID",
        severity: "critical",
        category: "artifact",
        message: `${service.unitName} missing from service_inventory.txt.`,
        filePath: "assets/reports/service_inventory.txt",
      });
      continue;
    }
    const expectedMainPid = process ? String(process.pid) : "";
    const checks: Array<[string, string, string, string]> = [
      ["status", serviceStatus(service), row.status, "LINUX_SYSTEMD_UNIT_STATE_CONTRADICTION"],
      ["startup", service.unitFileState, row.startup, "LINUX_SYSTEMD_CONFIG_STATE_MISMATCH"],
      ["load_state", service.loadState, row.loadState, "LINUX_SYSTEMD_UNIT_STATE_CONTRADICTION"],
      ["active_state", service.activeState, row.activeState, "LINUX_SYSTEMD_UNIT_STATE_CONTRADICTION"],
      ["sub_state", service.subState, row.subState, "LINUX_SYSTEMD_UNIT_STATE_CONTRADICTION"],
      ["result", service.result, row.result, "LINUX_SYSTEMD_TRANSITION_RESULT_MISMATCH"],
      ["unit_path", service.unitPath, row.unitPath, "LINUX_SYSTEMD_UNIT_PATH_MISMATCH"],
    ];
    for (const [field, expected, actual, code] of checks) {
      if (expected !== actual) {
        addIssue(report, "renderedArtifactChecks", {
          code,
          severity: "critical",
          category: "artifact",
          message: `${service.unitName} service_inventory ${field} expected ${expected || "(blank)"} but rendered ${actual || "(blank)"}.`,
          filePath: "assets/reports/service_inventory.txt",
        });
      }
    }
    if (expectedMainPid && row.mainPid !== expectedMainPid) {
      addIssue(report, "renderedArtifactChecks", {
        code: "LINUX_SYSTEMD_MAIN_PID_MISMATCH",
        severity: "critical",
        category: "artifact",
        message: `${service.unitName} service_inventory main_pid expected ${expectedMainPid} but rendered ${row.mainPid || "(blank)"}.`,
        filePath: "assets/reports/service_inventory.txt",
      });
    } else if (!expectedMainPid && row.mainPid) {
      addIssue(report, "renderedArtifactChecks", {
        code: "LINUX_SYSTEMD_MAIN_PID_MISMATCH",
        severity: "critical",
        category: "artifact",
        message: `${service.unitName} service_inventory renders main_pid ${row.mainPid} without a canonical main process.`,
        filePath: "assets/reports/service_inventory.txt",
      });
    }
  }

  for (const transition of simulation.serviceTransitions) {
    const service = simulation.services.find((item) => item.id === transition.serviceId);
    if (!service) {
      addIssue(report, "serviceTransitionChecks", {
        code: "LINUX_SYSTEMD_TRANSITION_INVALID",
        severity: "critical",
        category: "systemd",
        message: `${transition.id} references missing service ${transition.serviceId}.`,
      });
      continue;
    }
    if (ts(transition.occurredAt) > ts(simulation.collection.collectedAt)) {
      addIssue(report, "serviceTransitionChecks", {
        code: "LINUX_SYSTEMD_TRANSITION_INVALID",
        severity: "critical",
        category: "systemd",
        message: `${transition.id} occurs after collection.`,
      });
    }
    if (transition.cause.type === "command") {
      const command = commandById.get(transition.cause.commandId);
      const execution = command?.executionId ? simulation.executions.find((item) => item.id === command.executionId) : undefined;
      if (!command || !execution || !transition.executionId) {
        addIssue(report, "serviceTransitionChecks", {
          code: "LINUX_SYSTEMD_TRANSITION_MISSING",
          severity: "critical",
          category: "systemd",
          message: `${transition.id} lacks command/execution cause closure.`,
        });
      } else if (transition.executionId !== execution.id) {
        addIssue(report, "serviceTransitionChecks", {
          code: "LINUX_SYSTEMD_TRANSITION_INVALID",
          severity: "critical",
          category: "systemd",
          message: `${transition.id} execution ${transition.executionId} disagrees with command execution ${execution.id}.`,
        });
      }
      if (command && ts(transition.occurredAt) < ts(command.timestamp)) {
        addIssue(report, "serviceTransitionChecks", {
          code: "LINUX_SYSTEMD_TRANSITION_INVALID",
          severity: "critical",
          category: "systemd",
          message: `${transition.id} occurs before causal command ${command.id}.`,
        });
      }
      if (command && transition.operation === "reload" && !/\bsystemctl\s+reload\b/i.test(command.renderedCommand)) {
        addIssue(report, "serviceTransitionChecks", {
          code: "LINUX_SYSTEMD_TRANSITION_INVALID",
          severity: "critical",
          category: "systemd",
          message: `${transition.id} is reload but command is ${command.renderedCommand}.`,
        });
      }
      if (command && transition.operation === "restart" && !/\bsystemctl\s+(?:restart|enable\s+--now)\b/i.test(command.renderedCommand)) {
        addIssue(report, "serviceTransitionChecks", {
          code: "LINUX_SYSTEMD_TRANSITION_INVALID",
          severity: "critical",
          category: "systemd",
          message: `${transition.id} is restart but command is ${command.renderedCommand}.`,
        });
      }
    }
    if (transition.outcome === "failure" && transition.resultingState.result === "none") {
      addIssue(report, "serviceTransitionChecks", {
        code: "LINUX_SYSTEMD_TRANSITION_RESULT_MISMATCH",
        severity: "critical",
        category: "systemd",
        message: `${transition.id} failed but resulting state reports no failure result.`,
      });
    }
    if (transition.operation === "stop" && transition.outcome === "success" && transition.resultingState.activeState !== "inactive") {
      addIssue(report, "serviceTransitionChecks", {
        code: "LINUX_SYSTEMD_TRANSITION_RESULT_MISMATCH",
        severity: "critical",
        category: "systemd",
        message: `${transition.id} stop succeeded without inactive resulting state.`,
      });
    }
    if (["start", "restart", "activate"].includes(transition.operation) && transition.previousState.loadState === "not-found" && transition.outcome === "success") {
      addIssue(report, "serviceTransitionChecks", {
        code: "LINUX_SYSTEMD_TRANSITION_INVALID",
        severity: "critical",
        category: "systemd",
        message: `${transition.id} successfully started an absent unit.`,
      });
    }
    if (["start", "restart", "activate"].includes(transition.operation) && transition.previousState.unitFileState === "masked" && transition.outcome === "success") {
      addIssue(report, "serviceTransitionChecks", {
        code: "LINUX_SYSTEMD_TRANSITION_INVALID",
        severity: "critical",
        category: "systemd",
        message: `${transition.id} successfully started a masked unit.`,
      });
    }
    const activityRef = `${service.unitName} ${transition.operation} at ${transition.occurredAt}`;
    const stateText = `state=${transition.resultingState.loadState}/${transition.resultingState.activeState}/${transition.resultingState.subState}`;
    const auditEvent = `event="audit:${transition.id}"`;
    if (!journal.includes(activityRef) || !journal.includes(stateText)) {
      addIssue(report, "serviceTransitionChecks", {
        code: "LINUX_SYSTEMD_TRANSITION_MISSING",
        severity: "critical",
        category: "systemd",
        message: `${transition.id} is missing matching journal_systemd transition evidence.`,
        filePath: "assets/journal/journal_systemd.txt",
      });
    }
    if (!audit.includes(auditEvent) || !audit.includes(`unit="${service.unitName}"`) || !audit.includes(`op="${transition.operation}"`)) {
      addIssue(report, "serviceTransitionChecks", {
        code: "LINUX_SYSTEMD_TRANSITION_MISSING",
        severity: "critical",
        category: "systemd",
        message: `${transition.id} is missing matching audit service event.`,
        filePath: "assets/logs/audit.log",
      });
    }
    if (!syslog.includes(activityRef) || !timeline.includes(activityRef)) {
      addIssue(report, "serviceTransitionChecks", {
        code: "LINUX_SYSTEMD_TRANSITION_MISSING",
        severity: "critical",
        category: "systemd",
        message: `${transition.id} is missing syslog or timeline transition evidence.`,
      });
    }
  }

  addPass(report, "unitChecks", "LINUX_SYSTEMD_UNITS_VALIDATED", "Canonical unit records were checked.");
  addPass(report, "serviceTransitionChecks", "LINUX_SYSTEMD_TRANSITIONS_VALIDATED", "Service transition records and evidence were checked.");
  addPass(report, "serviceSnapshotChecks", "LINUX_SYSTEMD_SNAPSHOTS_VALIDATED", "Service snapshot state was checked.");
}

function validateSchedules(report: LinuxServiceSchedulerPackageSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  const cronLog = assetText(finalAssets, "assets/logs/cron.log");
  const audit = assetText(finalAssets, "assets/logs/audit.log");
  const syslog = assetText(finalAssets, "assets/logs/syslog");
  const timeline = assetText(finalAssets, "assets/evidence/timeline.csv");
  const commandById = new Map(simulation.commands.map((command) => [command.id, command]));
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));

  for (const definition of simulation.cronDefinitions) {
    const parsed = parseLinuxCronExpression(definition.schedule);
    if (!parsed.valid) {
      addIssue(report, "scheduleDefinitionChecks", {
        code: "LINUX_CRON_EXPRESSION_INVALID",
        severity: "critical",
        category: "scheduler",
        message: `${definition.id} has invalid cron expression ${definition.schedule}: ${parsed.reason}.`,
      });
    }
    const command = commandById.get(definition.commandId);
    const rendered = renderedCronDefinition(definition, finalAssets);
    if (definition.enabled && definition.persistenceState === "present") {
      if (!rendered.includes(definition.id) || !rendered.includes(definition.schedule) || !rendered.includes(command?.renderedCommand || "")) {
        addIssue(report, "scheduleDefinitionChecks", {
          code: "LINUX_CRON_DEFINITION_INVALID",
          severity: "critical",
          category: "scheduler",
          message: `${definition.id} current definition evidence does not render schedule and command.`,
          filePath: definition.source === "root_crontab" ? "assets/scheduled/root_crontab.txt" : `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`,
        });
      }
      if (definition.source === "cron_d") {
        const runAs = canonicalIdentity(simulation, definition.runAsIdentityId);
        if (!rendered.includes(runAs.username)) {
          addIssue(report, "scheduleDefinitionChecks", {
            code: "LINUX_CRON_IDENTITY_MISMATCH",
            severity: "critical",
            category: "scheduler",
            message: `${definition.id} cron.d evidence does not render run-as ${runAs.username}.`,
          });
        }
      }
    } else if (rendered.includes(definition.id)) {
      addIssue(report, "scheduleDefinitionChecks", {
        code: "LINUX_CRON_STATE_TYPE_CONTRADICTION",
        severity: "critical",
        category: "scheduler",
        message: `${definition.id} is removed/disabled but appears in current schedule evidence.`,
      });
    }
  }

  for (const execution of simulation.scheduledExecutions) {
    const definition = execution.definitionId ? simulation.cronDefinitions.find((item) => item.id === execution.definitionId) : undefined;
    const command = commandById.get(execution.commandId);
    const process = processById.get(execution.processId);
    if (!definition) {
      addIssue(report, "scheduledExecutionChecks", {
        code: "LINUX_CRON_EXECUTION_WITHOUT_DEFINITION",
        severity: "critical",
        category: "scheduler",
        message: `${execution.id} has no canonical schedule definition.`,
      });
      continue;
    }
    const parsed = parseLinuxCronExpression(definition.schedule);
    if (parsed.valid && parsed.matches && !parsed.matches(execution.occurredAt)) {
      addIssue(report, "scheduledExecutionChecks", {
        code: "LINUX_CRON_EXECUTION_TIME_MISMATCH",
        severity: "critical",
        category: "scheduler",
        message: `${execution.id} at ${execution.occurredAt} does not satisfy ${definition.schedule}.`,
      });
    }
    if (!definition.enabled || definition.persistenceState !== "present" || execution.occurredAt < definition.createdAt || (definition.removedAt && execution.occurredAt > definition.removedAt)) {
      addIssue(report, "scheduledExecutionChecks", {
        code: "LINUX_CRON_STATE_TYPE_CONTRADICTION",
        severity: "critical",
        category: "scheduler",
        message: `${execution.id} runs outside enabled lifetime for ${definition.id}.`,
      });
    }
    if (definition.commandId !== execution.commandId) {
      addIssue(report, "scheduledExecutionChecks", {
        code: "LINUX_CRON_COMMAND_MISMATCH",
        severity: "critical",
        category: "scheduler",
        message: `${execution.id} command ${execution.commandId} disagrees with definition ${definition.commandId}.`,
      });
    }
    if (!process || process.identityId !== definition.runAsIdentityId) {
      addIssue(report, "scheduledExecutionChecks", {
        code: "LINUX_CRON_IDENTITY_MISMATCH",
        severity: "critical",
        category: "scheduler",
        message: `${execution.id} process identity disagrees with ${definition.id}.`,
      });
    }
    const runAs = canonicalIdentity(simulation, definition.runAsIdentityId);
    const label = execution.id;
    const learnerLabel = execution.id.replace(/^scheduled:/, "");
    const commandText = command?.renderedCommand || "";
    if (!cronLog.includes(definition.id) || !cronLog.includes(commandText) || !cronLog.includes(`(${runAs.username}) CMD`)) {
      addIssue(report, "scheduledExecutionChecks", {
        code: "LINUX_CRON_COMMAND_MISMATCH",
        severity: "critical",
        category: "scheduler",
        message: `${execution.id} cron.log does not match definition command/run-as.`,
        filePath: "assets/logs/cron.log",
      });
    }
    if (!audit.includes(`event="audit:${execution.id}"`) || !audit.includes(`def="${definition.id}"`)) {
      addIssue(report, "scheduledExecutionChecks", {
        code: "LINUX_CRON_EXECUTION_WITHOUT_DEFINITION",
        severity: "critical",
        category: "scheduler",
        message: `${execution.id} audit evidence lacks schedule reference.`,
        filePath: "assets/logs/audit.log",
      });
    }
    if (!syslog.includes(definition.id) || (!timeline.includes(label) && !timeline.includes(learnerLabel))) {
      addIssue(report, "scheduledExecutionChecks", {
        code: "LINUX_CRON_EXECUTION_WITHOUT_DEFINITION",
        severity: "critical",
        category: "scheduler",
        message: `${execution.id} syslog or timeline lacks schedule linkage.`,
      });
    }
  }

  addPass(report, "scheduleDefinitionChecks", "LINUX_CRON_DEFINITIONS_VALIDATED", "Cron definitions were parsed and checked.");
  addPass(report, "scheduledExecutionChecks", "LINUX_CRON_EXECUTIONS_VALIDATED", "Scheduled executions were checked against definitions.");
}

function packageActionMatchesCommand(transaction: CanonicalPackageTransaction, commandText: string) {
  if (transaction.source !== "manual") return /apt\.systemd\.daily|unattended|apt/i.test(commandText);
  if (transaction.action === "install") return /\bapt(?:-get)?\s+install\b/i.test(commandText);
  if (transaction.action === "upgrade") return /\bapt(?:-get)?\s+(?:upgrade|install)\b/i.test(commandText);
  if (transaction.action === "remove") return /\bapt(?:-get)?\s+(?:remove|purge)\b/i.test(commandText);
  if (transaction.action === "reconfigure") return /\bdpkg\b|\bapt\b/i.test(commandText);
  return true;
}

function validatePackages(report: LinuxServiceSchedulerPackageSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  const inventory = assetText(finalAssets, "assets/inventory/package_inventory.txt");
  const aptHistory = assetText(finalAssets, "assets/logs/apt_history.log");
  const inventoryByName = new Map(packageInventoryRows(inventory).map((row) => [row.name, row]));
  const historyBlocks = aptHistoryBlocks(aptHistory);
  const commandById = new Map(simulation.commands.map((command) => [command.id, command]));
  const executionById = new Map(simulation.executions.map((execution) => [execution.id, execution]));
  const processById = new Map(simulation.processes.map((process) => [process.id, process]));

  for (const transaction of simulation.packageTransactions) {
    if (transaction.startedAt > transaction.completedAt) {
      addIssue(report, "packageTransactionChecks", {
        code: "LINUX_PACKAGE_TRANSACTION_CHRONOLOGY_INVALID",
        severity: "critical",
        category: "package",
        message: `${transaction.id} starts after completion.`,
      });
    }
    if (!transaction.packages.length) {
      addIssue(report, "packageTransactionChecks", {
        code: "LINUX_PACKAGE_TRANSACTION_INVALID",
        severity: "critical",
        category: "package",
        message: `${transaction.id} has no package changes.`,
      });
    }
    const command = transaction.commandId ? commandById.get(transaction.commandId) : undefined;
    if (transaction.commandId && !command) {
      addIssue(report, "packageTransactionChecks", {
        code: "LINUX_PACKAGE_TRANSACTION_INVALID",
        severity: "critical",
        category: "package",
        message: `${transaction.id} references missing command ${transaction.commandId}.`,
      });
    }
    if (command && !packageActionMatchesCommand(transaction, renderCommandInvocation(command))) {
      addIssue(report, "packageTransactionChecks", {
        code: "LINUX_PACKAGE_COMMAND_MISMATCH",
        severity: "critical",
        category: "package",
        message: `${transaction.id} action ${transaction.action} disagrees with command ${command.renderedCommand}.`,
      });
    }
    for (const executionId of transaction.executionIds || (command?.executionId ? [command.executionId] : [])) {
      if (!executionById.has(executionId)) {
        addIssue(report, "packageTransactionChecks", {
          code: "LINUX_PACKAGE_TRANSACTION_INVALID",
          severity: "critical",
          category: "package",
          message: `${transaction.id} references missing execution ${executionId}.`,
        });
      }
    }
    for (const processId of transaction.processIds) {
      const process = processById.get(processId);
      if (!process) {
        addIssue(report, "packageTransactionChecks", {
          code: "LINUX_PACKAGE_TRANSACTION_INVALID",
          severity: "critical",
          category: "package",
          message: `${transaction.id} references missing process ${processId}.`,
        });
      } else if (transaction.completedAt < process.startedAt || transaction.startedAt > (process.endedAt || simulation.collection.collectedAt)) {
        addIssue(report, "packageTransactionChecks", {
          code: "LINUX_PACKAGE_TRANSACTION_CHRONOLOGY_INVALID",
          severity: "critical",
          category: "package",
          message: `${transaction.id} transaction window is outside process ${process.id} lifetime.`,
        });
      }
    }
    const block = historyBlocks.find((item) => item.includes(transaction.id) || transaction.packages.every((pkg) => item.includes(pkg.name)));
    if (!block || !block.includes(transaction.startedAt.slice(0, 10)) || !block.includes(transaction.completedAt.slice(11, 19))) {
      addIssue(report, "packageTransactionChecks", {
        code: "LINUX_PACKAGE_TRANSACTION_INVALID",
        severity: "critical",
        category: "package",
        message: `${transaction.id} is missing coherent apt history block.`,
        filePath: "assets/logs/apt_history.log",
      });
    }
    for (const pkg of transaction.packages) {
      if (transaction.action === "upgrade" && (!pkg.previousVersion || !pkg.resultingVersion)) {
        addIssue(report, "packageTransactionChecks", {
          code: "LINUX_PACKAGE_VERSION_CONTRADICTION",
          severity: "critical",
          category: "package",
          message: `${transaction.id} upgrade for ${pkg.name} lacks previous or resulting version.`,
        });
      }
      const inventoryRow = inventoryByName.get(pkg.name);
      if (transaction.outcome === "success" && transaction.action !== "remove") {
        if (!inventoryRow || inventoryRow.version !== pkg.resultingVersion) {
          addIssue(report, "packageInventoryChecks", {
            code: "LINUX_PACKAGE_INVENTORY_MISMATCH",
            severity: "critical",
            category: "package",
            message: `${pkg.name} inventory does not reflect successful ${transaction.id}.`,
            filePath: "assets/inventory/package_inventory.txt",
          });
        }
      }
      if (transaction.action === "remove" && inventoryRow) {
        addIssue(report, "packageInventoryChecks", {
          code: "LINUX_PACKAGE_INVENTORY_MISMATCH",
          severity: "critical",
          category: "package",
          message: `${pkg.name} remains installed after remove transaction ${transaction.id}.`,
        });
      }
      if (transaction.outcome === "failure" && inventoryRow?.version === pkg.resultingVersion) {
        addIssue(report, "packageInventoryChecks", {
          code: "LINUX_PACKAGE_RESULT_CONTRADICTION",
          severity: "critical",
          category: "package",
          message: `${pkg.name} failed transaction updated installed inventory.`,
        });
      }
      if (!pkg.repository) {
        addIssue(report, "repositoryChecks", {
          code: "LINUX_PACKAGE_REPOSITORY_MISSING",
          severity: "high",
          category: "repository",
          message: `${transaction.id} package ${pkg.name} lacks canonical repository provenance.`,
        });
      } else if (!["ubuntu", "security", "updates"].some((source) => pkg.repository?.includes(source))) {
        addIssue(report, "repositoryChecks", {
          code: "LINUX_PACKAGE_PROVENANCE_UNSUPPORTED",
          severity: "high",
          category: "repository",
          message: `${transaction.id} repository ${pkg.repository} is unsupported by rendered local evidence.`,
        });
      }
    }
  }

  addPass(report, "packageTransactionChecks", "LINUX_PACKAGE_TRANSACTIONS_VALIDATED", "Package transactions were checked.");
  addPass(report, "packageInventoryChecks", "LINUX_PACKAGE_INVENTORY_VALIDATED", "Package inventory was checked against transactions.");
  addPass(report, "repositoryChecks", "LINUX_PACKAGE_REPOSITORIES_VALIDATED", "Package repository provenance was checked.");
}

function validateChangeAndTimezone(report: LinuxServiceSchedulerPackageSemanticReport, simulation: LinuxSimulationWorld, finalAssets?: AssetLike[]) {
  const change = assetText(finalAssets, "assets/docs/change_request.md");
  const maintenance = assetText(finalAssets, "assets/docs/maintenance_ticket.md");
  const allDocs = `${change}\n${maintenance}`;
  for (const activity of simulation.maintenanceActivities) {
    const renderedActivityScope =
      Boolean(allDocs.trim()) &&
      ([activity.changeId, activity.ticketId].filter(Boolean) as string[]).some((id) => allDocs.includes(id)) ||
      allDocs.includes(activity.windowStart.slice(0, 16)) ||
      allDocs.includes(activity.windowEnd.slice(0, 16));
    if (activity.windowStart > activity.windowEnd) {
      addIssue(report, "changeAlignmentChecks", {
        code: "LINUX_MAINTENANCE_WINDOW_MISMATCH",
        severity: "critical",
        category: "change",
        message: `${activity.id} maintenance window starts after it ends.`,
      });
    }
    if (activity.changeId && !allDocs.includes(activity.changeId)) {
      addIssue(report, "changeAlignmentChecks", {
        code: "LINUX_CHANGE_SCOPE_MISMATCH",
        severity: "critical",
        category: "change",
        message: `${activity.id} change ${activity.changeId} is not rendered in change/maintenance docs.`,
      });
    }
    if (activity.ticketId && !allDocs.includes(activity.ticketId)) {
      addIssue(report, "changeAlignmentChecks", {
        code: "LINUX_CHANGE_SCOPE_MISMATCH",
        severity: "critical",
        category: "change",
        message: `${activity.id} ticket ${activity.ticketId} is not rendered in change/maintenance docs.`,
      });
    }
    if (renderedActivityScope && (!allDocs.includes(simulation.investigation.hostname) || !allDocs.includes(simulation.investigation.affectedService))) {
      addIssue(report, "changeAlignmentChecks", {
        code: "LINUX_CHANGE_SCOPE_MISMATCH",
        severity: "critical",
        category: "change",
        message: `${activity.id} rendered scope does not include host and affected service.`,
      });
    }
    const observedIds = [...activity.commandIds, ...activity.serviceTransitionIds, ...activity.packageTransactionIds, ...activity.cronDefinitionIds];
    if (!observedIds.length && /observed|completed|executed/i.test(allDocs)) {
      addIssue(report, "changeAlignmentChecks", {
        code: "LINUX_CHANGE_SCOPE_MISMATCH",
        severity: "high",
        category: "change",
        message: `${activity.id} documentation implies observed activity without canonical observed IDs.`,
      });
    }
  }

  const timezone = simulation.investigation.timezone || simulation.backgroundProfile.timezone;
  const rendersTimedWindow =
    Boolean(allDocs.trim()) &&
    (simulation.maintenanceActivities.some((activity) =>
      allDocs.includes(activity.windowStart.slice(0, 16)) ||
      allDocs.includes(activity.windowEnd.slice(0, 16))
    ) || /\b(?:UTC|Europe\/London|America\/|Asia\/|Australia\/|Africa\/)\b/.test(allDocs));
  if (rendersTimedWindow && (!timezone || !allDocs.includes(timezone))) {
    addIssue(report, "timezoneChecks", {
      code: "LINUX_TIMEZONE_SEMANTIC_MISMATCH",
      severity: "critical",
      category: "timezone",
      message: `Rendered change/maintenance documents do not preserve timezone ${timezone}.`,
    });
  }
  if (simulation.backgroundProfile.timezone !== "UTC" && simulation.backgroundProfile.timezone !== timezone) {
    addIssue(report, "timezoneChecks", {
      code: "LINUX_TIMEZONE_SEMANTIC_MISMATCH",
      severity: "high",
      category: "timezone",
      message: `Background scheduler timezone ${simulation.backgroundProfile.timezone} differs from investigation timezone ${timezone}.`,
    });
  }

  addPass(report, "changeAlignmentChecks", "LINUX_CHANGE_ALIGNMENT_VALIDATED", "Change and maintenance scope were checked as context.");
  addPass(report, "timezoneChecks", "LINUX_TIMEZONE_VALIDATED", "Timezone scope was checked.");
}

export function buildLinuxServiceSchedulerPackageSemanticReport(input: {
  simulation: LinuxSimulationWorld;
  finalAssets?: AssetLike[];
}): LinuxServiceSchedulerPackageSemanticReport {
  const report: LinuxServiceSchedulerPackageSemanticReport = {
    status: "valid",
    unitChecks: [],
    serviceTransitionChecks: [],
    serviceSnapshotChecks: [],
    scheduleDefinitionChecks: [],
    scheduledExecutionChecks: [],
    packageTransactionChecks: [],
    packageInventoryChecks: [],
    repositoryChecks: [],
    changeAlignmentChecks: [],
    timezoneChecks: [],
    renderedArtifactChecks: [],
    issues: [],
  };

  validateServices(report, input.simulation, input.finalAssets);
  validateSchedules(report, input.simulation, input.finalAssets);
  validatePackages(report, input.simulation, input.finalAssets);
  validateChangeAndTimezone(report, input.simulation, input.finalAssets);
  addPass(report, "renderedArtifactChecks", "LINUX_PHASE6C_RENDERED_ARTIFACTS_VALIDATED", "Rendered service, schedule, package and change artifacts were checked.");
  report.status = report.issues.length > 0 ? "invalid" : "valid";
  return report;
}
