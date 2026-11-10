// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output root.");

const { buildLinuxAssetCandidate } = require(`${out}/lib/lab-assets/linux/index.js`);
const {
  validateCanonicalExecutionLifecycle,
  validateLinuxSimulationEvidence,
} = require(`${out}/lib/lab-assets/linux/simulation.js`);
const { checkLinuxInvestigationQuality } = require(`${out}/lib/lab-assets/linux/qualityChecker.js`);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}


function expectPass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

function expectFail(name, expected, fn) {
  try {
    fn();
    throw new Error("__NO_FAILURE__");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message === "__NO_FAILURE__") throw new Error(`${name}: expected failure`);
    if (!message.includes(expected)) throw new Error(`${name}: expected "${expected}", got "${message}"`);
    console.log(`PASS ${name}: ${message}`);
  }
}

function buildCandidate(seed, diagnostics = {}) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `${seed}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
        difficulty: "Advanced",
        duration: "30 mins",
        title: "CyberLab Asset Pack",
      }, diagnostics);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Could not build deterministic candidate ${seed}`);
}

function assertReason(simulation, reason) {
  if (!simulation.executions.some((execution) => execution.reason === reason)) {
    throw new Error(`missing execution reason ${reason}`);
  }
}

function assertLinked(candidate) {
  const { simulation } = candidate;
  const executionIds = new Set(simulation.executions.map((execution) => execution.id));
  for (const command of simulation.commands) {
    if (!command.executionId || !executionIds.has(command.executionId)) throw new Error(`command ${command.id} lacks execution`);
  }
  for (const process of simulation.processes) {
    if (!process.executionId || !executionIds.has(process.executionId)) throw new Error(`process ${process.id} lacks execution`);
  }
  for (const scheduled of simulation.scheduledExecutions) {
    if (!scheduled.executionId || !executionIds.has(scheduled.executionId)) throw new Error(`scheduled ${scheduled.id} lacks execution`);
  }
  for (const transition of simulation.serviceTransitions.filter((item) => item.cause.type === "command")) {
    if (!transition.executionId || !executionIds.has(transition.executionId)) throw new Error(`transition ${transition.id} lacks execution`);
  }
}

const serviceCandidate = buildCandidate("phase2-execution-service", {
  incidentFamily: "systemd_persistence",
  testOverrides: {
    command: "systemctl restart ssh.service",
  },
});
const cronCandidate = buildCandidate("phase2-execution-cron", {
  incidentFamily: "cron_persistence",
});
const packageCandidate = buildCandidate("phase2-execution-package", {
  incidentFamily: "unauthorized_package_install",
});

expectPass("valid service execution lifecycle", () => validateCanonicalExecutionLifecycle(serviceCandidate.simulation));
expectPass("valid cron execution lifecycle", () => validateCanonicalExecutionLifecycle(cronCandidate.simulation));
expectPass("valid package execution lifecycle", () => validateCanonicalExecutionLifecycle(packageCandidate.simulation));
expectPass("valid service evidence remains unchanged", () => validateLinuxSimulationEvidence(serviceCandidate.simulation, serviceCandidate.assets));
expectPass("valid cron evidence remains unchanged", () => validateLinuxSimulationEvidence(cronCandidate.simulation, cronCandidate.assets));
expectPass("valid package evidence remains unchanged", () => validateLinuxSimulationEvidence(packageCandidate.simulation, packageCandidate.assets));

expectPass("interactive shell and SSH lifecycles exist", () => {
  assertReason(serviceCandidate.simulation, "ssh_session");
  assertReason(serviceCandidate.simulation, "interactive_shell");
});

expectPass("cron, service, package, daemon and privilege lifecycles exist", () => {
  assertReason(cronCandidate.simulation, "cron");
  assertReason(serviceCandidate.simulation, "service_action");
  assertReason(packageCandidate.simulation, "package");
  assertReason(serviceCandidate.simulation, "daemon_startup");
  assertReason(serviceCandidate.simulation, "privilege_escalation");
});

expectPass("commands processes schedules and transitions are execution-linked", () => {
  assertLinked(serviceCandidate);
  assertLinked(cronCandidate);
  assertLinked(packageCandidate);
});

expectPass("failed execution is represented naturally", () => {
  const simulation = serviceCandidate.simulation;
  const execution = simulation.executions.find((item) => item.commandId);
  execution.outcome = "failure";
  execution.exitCode = 1;
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("floating process", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  delete simulation.processes[0].executionId;
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("floating command", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  delete simulation.commands[0].executionId;
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("orphan execution", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  simulation.executions[0].processId = "process:missing";
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("broken parent chain", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  const child = simulation.processes.find((process) => process.ppid !== 1);
  child.ppid = 999999;
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("cyclic parent chain", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  const child = simulation.processes.find((process) => process.ppid !== 1);
  const parent = simulation.processes.find((process) => process.pid === child.ppid);
  parent.ppid = child.pid;
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("impossible cwd transition", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  const incidentCommand = simulation.commands.find((command) => command.id.startsWith("command:incident:"));
  simulation.executions.find((execution) => execution.commandId === incidentCommand.id).cwd = "/tmp/not-the-process-cwd";
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("service transition without execution", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  delete simulation.serviceTransitions.find((transition) => transition.cause.type === "command").executionId;
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("cron action without execution", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(cronCandidate.simulation);
  delete simulation.scheduledExecutions[0].executionId;
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("command process disagreement", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  const command = simulation.commands[0];
  const other = simulation.processes.find((process) => process.pid !== command.processId);
  command.processId = other.pid;
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("open file lifecycle disagreement", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  const execution = simulation.executions.find((item) => item.openedFileIds.length > 0);
  const file = simulation.files.find((item) => !execution.openedFileIds.includes(item.id));
  execution.openedFileIds.push(file.id);
  validateCanonicalExecutionLifecycle(simulation);
});

expectPass("quality checker reports lifecycle failures", () => {
  const simulation = clone(serviceCandidate.simulation);
  delete simulation.commands[0].executionId;
  const result = checkLinuxInvestigationQuality({
    context: serviceCandidate.investigation,
    assets: serviceCandidate.assets,
    simulation,
  });
  if (result.passed || !result.issues.some((issue) => /Canonical execution lifecycle/.test(issue.description))) {
    throw new Error("quality checker did not report lifecycle failure");
  }
});
