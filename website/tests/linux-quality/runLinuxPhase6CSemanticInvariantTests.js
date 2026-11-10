#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase6c-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing ${filePath}`);
  return found;
}

function mutateAsset(candidate, filePath, replacer) {
  const found = asset(candidate, filePath);
  found.content = replacer(found.content);
}

function mutateServiceInventoryLine(candidate, serviceName, replacer) {
  mutateAsset(candidate, "assets/reports/service_inventory.txt", (content) => {
    const lines = content.split(/\r?\n/);
    const index = lines.findIndex((line, offset) => offset > 0 && line.startsWith(`${serviceName},`));
    if (index < 0) throw new Error(`missing service inventory row for ${serviceName}`);
    lines[index] = replacer(lines[index]);
    return lines.join("\n");
  });
}

function addSeconds(timestamp, seconds) {
  return new Date(Date.parse(`${timestamp.replace(" ", "T")}Z`) + seconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function expectPass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

function expectFail(name, expectedCode, fn) {
  try {
    fn();
    throw new Error("__NO_FAILURE__");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message === "__NO_FAILURE__") throw new Error(`${name}: expected ${expectedCode}`);
    if (!message.includes(expectedCode)) throw new Error(`${name}: expected ${expectedCode}, got ${message}`);
    console.log(`PASS ${name}: ${expectedCode}`);
  }
}

function reportOrThrow(report) {
  if (report.status !== "valid") {
    throw new Error(report.issues.map((issue) => `${issue.code}:${issue.message}`).join("; "));
  }
}

function buildCandidate(buildLinuxAssetCandidate, family) {
  let lastError;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `phase6c:${family}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty: "Advanced",
          duration: "60 mins",
          title: "Amniora Linux Asset Pack",
        }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family}`);
}

function validate(buildReport, candidate) {
  reportOrThrow(buildReport({ simulation: candidate.simulation, finalAssets: candidate.assets }));
}

function firstServiceWithPid(simulation) {
  const service = simulation.services.find((item) => item.mainProcessId);
  if (!service) throw new Error("missing service with main process");
  return service;
}

function firstServiceTransition(simulation) {
  const transition = simulation.serviceTransitions[0];
  if (!transition) throw new Error("missing service transition");
  return transition;
}

function firstCronExecution(simulation) {
  const execution = simulation.scheduledExecutions[0];
  if (!execution) throw new Error("missing scheduled execution");
  return execution;
}

function firstPackageTransaction(simulation) {
  const transaction = simulation.packageTransactions[0];
  if (!transaction) throw new Error("missing package transaction");
  return transaction;
}

function run() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxServiceSchedulerPackageSemanticReport } = require(path.join(out, "linux", "serviceSchedulerPackageSemantics.js"));

  const systemd = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence");
  const cron = buildCandidate(buildLinuxAssetCandidate, "cron_persistence");
  const packageCandidate = buildCandidate(buildLinuxAssetCandidate, "unauthorized_package_install");

  expectPass("valid systemd semantic report", () => validate(buildLinuxServiceSchedulerPackageSemanticReport, systemd));
  expectPass("valid cron semantic report", () => validate(buildLinuxServiceSchedulerPackageSemanticReport, cron));
  expectPass("valid package semantic report", () => validate(buildLinuxServiceSchedulerPackageSemanticReport, packageCandidate));

  expectFail("systemd unit path mismatch", "LINUX_SYSTEMD_UNIT_PATH_MISMATCH", () => {
    const candidate = clone(systemd);
    const service = candidate.simulation.services.find((item) => item.unitPath && asset(candidate, "assets/reports/service_inventory.txt").content.includes(`${item.unitName},`));
    if (!service) throw new Error("missing service unit path");
    mutateServiceInventoryLine(candidate, service.unitName, (line) => line.replace(/,[^,]*$/, ",/etc/systemd/system/unrelated.service"));
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("systemd main PID mismatch", "LINUX_SYSTEMD_MAIN_PID_MISMATCH", () => {
    const candidate = clone(systemd);
    const service = firstServiceWithPid(candidate.simulation);
    const process = candidate.simulation.processes.find((item) => item.id === service.mainProcessId);
    if (!process) throw new Error("missing main process");
    mutateAsset(candidate, "assets/reports/service_inventory.txt", (content) =>
      content.replace(new RegExp(`,${process.pid},`), `,${process.pid + 9000},`)
    );
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("systemd transition missing", "LINUX_SYSTEMD_TRANSITION_MISSING", () => {
    const candidate = clone(systemd);
    const transition = firstServiceTransition(candidate.simulation);
    const service = candidate.simulation.services.find((item) => item.id === transition.serviceId);
    if (!service) throw new Error("missing transition service");
    const activityRef = `${service.unitName} ${transition.operation} at ${transition.occurredAt}`;
    mutateAsset(candidate, "assets/journal/journal_systemd.txt", (content) =>
      content.split(/\r?\n/).filter((line) => !line.includes(activityRef)).join("\n")
    );
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("systemd transition operation mismatch", "LINUX_SYSTEMD_TRANSITION_INVALID", () => {
    const candidate = clone(systemd);
    const transition = firstServiceTransition(candidate.simulation);
    transition.operation = transition.operation === "reload" ? "restart" : "reload";
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("cron expression invalid", "LINUX_CRON_EXPRESSION_INVALID", () => {
    const candidate = clone(cron);
    candidate.simulation.cronDefinitions[0].schedule = "99 * * * *";
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("cron execution time mismatch", "LINUX_CRON_EXECUTION_TIME_MISMATCH", () => {
    const candidate = clone(cron);
    firstCronExecution(candidate.simulation).occurredAt = addSeconds(firstCronExecution(candidate.simulation).occurredAt, 60);
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("cron identity mismatch", "LINUX_CRON_IDENTITY_MISMATCH", () => {
    const candidate = clone(cron);
    const execution = firstCronExecution(candidate.simulation);
    const process = candidate.simulation.processes.find((item) => item.id === execution.processId);
    const alternate = candidate.simulation.identities.find((item) => item.id !== process.identityId);
    if (!process || !alternate) throw new Error("missing alternate identity");
    process.identityId = alternate.id;
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("cron command mismatch", "LINUX_CRON_COMMAND_MISMATCH", () => {
    const candidate = clone(cron);
    const definition = candidate.simulation.cronDefinitions[0];
    const alternate = candidate.simulation.commands.find((item) => item.id !== definition.commandId);
    if (!alternate) throw new Error("missing alternate command");
    definition.commandId = alternate.id;
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("package inventory mismatch", "LINUX_PACKAGE_INVENTORY_MISMATCH", () => {
    const candidate = clone(packageCandidate);
    const transaction = firstPackageTransaction(candidate.simulation);
    const pkg = transaction.packages.find((item) => item.resultingVersion);
    if (!pkg) throw new Error("missing resulting package version");
    mutateAsset(candidate, "assets/inventory/package_inventory.txt", (content) =>
      content.replace(pkg.resultingVersion, "0.0.0-contradiction")
    );
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("package version contradiction", "LINUX_PACKAGE_VERSION_CONTRADICTION", () => {
    const candidate = clone(packageCandidate);
    const transaction = firstPackageTransaction(candidate.simulation);
    transaction.action = "upgrade";
    transaction.packages[0].previousVersion = undefined;
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("package command mismatch", "LINUX_PACKAGE_COMMAND_MISMATCH", () => {
    const candidate = clone(packageCandidate);
    const transaction = firstPackageTransaction(candidate.simulation);
    const command = candidate.simulation.commands.find((item) => item.id === transaction.commandId);
    if (!command) throw new Error("missing package command");
    command.renderedCommand = command.renderedCommand.replace(/\binstall\b|\bupgrade\b|\bremove\b|\breconfigure\b/, "remove");
    if (!/\bremove\b/.test(command.renderedCommand)) command.renderedCommand = "/usr/bin/apt-get remove ncat";
    transaction.action = "install";
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("package repository missing", "LINUX_PACKAGE_REPOSITORY_MISSING", () => {
    const candidate = clone(packageCandidate);
    delete firstPackageTransaction(candidate.simulation).packages[0].repository;
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("change scope mismatch", "LINUX_CHANGE_SCOPE_MISMATCH", () => {
    const candidate = clone(systemd);
    for (const filePath of ["assets/docs/change_request.md", "assets/docs/maintenance_ticket.md"]) {
      mutateAsset(candidate, filePath, (content) =>
        content.replace(new RegExp(candidate.simulation.investigation.hostname, "g"), "unrelated-host")
      );
    }
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });

  expectFail("timezone semantic mismatch", "LINUX_TIMEZONE_SEMANTIC_MISMATCH", () => {
    const candidate = clone(systemd);
    const timezone = candidate.simulation.investigation.timezone || candidate.simulation.backgroundProfile.timezone;
    for (const filePath of ["assets/docs/change_request.md", "assets/docs/maintenance_ticket.md"]) {
      mutateAsset(candidate, filePath, (content) => content.replace(new RegExp(timezone, "g"), "LOCAL"));
    }
    validate(buildLinuxServiceSchedulerPackageSemanticReport, candidate);
  });
}

run();
