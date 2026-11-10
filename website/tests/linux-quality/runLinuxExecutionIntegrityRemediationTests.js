// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output root.");

const { buildLinuxAssetCandidate } = require(`${out}/lib/lab-assets/linux/index.js`);
const { validateCanonicalExecutionLifecycle, validateLinuxSimulationEvidence } = require(`${out}/lib/lab-assets/linux/simulation.js`);
const { checkLinuxInvestigationQuality } = require(`${out}/lib/lab-assets/linux/qualityChecker.js`);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}


function buildCandidate(seed, diagnostics = {}) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
  throw lastError || new Error(`Could not build ${seed}`);
}

function pass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

function fail(name, expected, fn) {
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

const serviceCandidate = buildCandidate("phase2br-service", {
  incidentFamily: "systemd_persistence",
  testOverrides: { command: "systemctl restart ssh.service" },
});
const packageCandidate = buildCandidate("phase2br-package", {
  incidentFamily: "unauthorized_package_install",
});

pass("builder-created lifecycle is accepted through structural registry", () => {
  validateLinuxSimulationEvidence(serviceCandidate.simulation, serviceCandidate.assets);
  const command = serviceCandidate.simulation.commands.find((item) => item.kind !== "background");
  const record = serviceCandidate.simulation.lifecycleRegistry.records.find((item) => item.commandId === command.id);
  if (!record || record.state !== "completed") throw new Error("missing completed structural record");
});

fail("manual execution-first label forgery is rejected", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  const command = simulation.commands.find((item) => item.id.startsWith("command:incident:"));
  simulation.lifecycleRegistry.records = simulation.lifecycleRegistry.records.filter((record) => record.commandId !== command.id);
  command.constructionOrigin = "execution_first";
  validateCanonicalExecutionLifecycle(simulation);
});

fail("pending lifecycle is rejected", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  simulation.lifecycleRegistry.records[0].state = "pending";
  validateCanonicalExecutionLifecycle(simulation);
});

fail("duplicate finalization is rejected", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  simulation.lifecycleRegistry.records[0].finalizedCount = 2;
  validateCanonicalExecutionLifecycle(simulation);
});

fail("post-finalization identity mutation is rejected", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(packageCandidate.simulation);
  const process = simulation.processes.find((item) => item.id === "process:package:dpkg");
  process.identityId = "identity:root";
  process.realUid = 0;
  process.realGid = 0;
  validateCanonicalExecutionLifecycle(simulation);
});

fail("post-finalization UID mutation is rejected", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(packageCandidate.simulation);
  const process = simulation.processes.find((item) => item.id === "process:package:dpkg");
  process.effectiveUid = 1000;
  validateCanonicalExecutionLifecycle(simulation);
});

pass("permitted file enrichment remains accepted", () => {
  const command = packageCandidate.simulation.commands.find((item) => /\bapt\s+install\b/.test(item.renderedCommand));
  const execution = packageCandidate.simulation.executions.find((item) => item.id === command.executionId);
  if (!execution.openedFileIds.some((id) => /apt|dpkg/.test(id))) throw new Error("package files were not lifecycle-enriched");
  validateCanonicalExecutionLifecycle(packageCandidate.simulation);
});

pass("apt and dpkg package chain is execution-first", () => {
  const apt = packageCandidate.simulation.commands.find((item) => /\bapt\s+install\b/.test(item.renderedCommand));
  const aptProcess = packageCandidate.simulation.processes.find((item) => item.pid === apt.processId);
  const dpkg = packageCandidate.simulation.processes.find((item) => item.id === "process:package:dpkg");
  const dpkgRecord = packageCandidate.simulation.lifecycleRegistry.records.find((item) => item.processId === dpkg.id);
  if (apt.constructionOrigin !== "execution_first" || aptProcess.lifecycleOrigin !== "execution_first") throw new Error("apt is not execution-first");
  if (dpkg.lifecycleOrigin !== "execution_first" || !dpkgRecord) throw new Error("dpkg is not structurally execution-first");
  if (dpkg.ppid !== apt.processId) throw new Error("dpkg parent is not apt process");
  if (dpkg.effectiveUid !== 0) throw new Error("dpkg is not root-effective");
});

pass("package transaction references execution-first chain", () => {
  const transaction = packageCandidate.simulation.packageTransactions.find((item) => item.source === "manual");
  if (!transaction) throw new Error("missing manual package transaction");
  const executionIds = new Set(transaction.executionIds || []);
  const dpkg = packageCandidate.simulation.processes.find((item) => item.id === "process:package:dpkg");
  if (!transaction.processIds.includes(dpkg.id)) throw new Error("transaction missing dpkg process");
  if (!executionIds.has(dpkg.executionId)) throw new Error("transaction missing dpkg execution");
});

pass("two shell-hosted executions share one host shell safely", () => {
  const shell = packageCandidate.simulation.processes.find((item) => item.id === "process:incident:shell");
  const hosted = packageCandidate.simulation.executions.filter((item) => item.processPolicy === "no_child_process");
  if (hosted.length < 2) throw new Error("missing hosted executions");
  if (new Set(hosted.map((item) => item.hostProcessId)).size !== 1) throw new Error("hosted executions do not share host shell");
  if (shell.executionId !== "execution:shell:incident") throw new Error("shell executionId was overwritten");
  if (!hosted.every((item) => shell.hostedExecutionIds.includes(item.id) && item.startTime !== shell.startedAt)) {
    throw new Error("hosted execution relationship/timing invalid");
  }
});

fail("shell-hosted execution rejects invalid host process", "claims inherited identity authority without matching process lineage", () => {
  const simulation = clone(packageCandidate.simulation);
  const hosted = simulation.executions.find((item) => item.processPolicy === "no_child_process");
  hosted.hostProcessId = "process:missing-host";
  validateCanonicalExecutionLifecycle(simulation);
});

pass("real production failed execution is generated without downstream effects", () => {
  const failed = packageCandidate.simulation.executions.find((item) => item.id === "execution:shell-hosted:command-not-found");
  if (!failed || failed.outcome !== "failure" || failed.exitCode !== 127) throw new Error("missing command-not-found failure");
  if (failed.processId || !failed.hostProcessId) throw new Error("failed no-child process policy incoherent");
  if (failed.serviceTransitionIds.length || failed.packageTransactionIds.length || failed.openedFileIds.length) {
    throw new Error("failed command produced downstream side effects");
  }
});

pass("incident-relevant legacy counts are zero and background legacy remains classified", () => {
  const diag = packageCandidate.simulation.executionMigrationDiagnostics;
  if (diag.incidentRelevantLegacyCommands !== 0) throw new Error("incident legacy commands remain");
  if (diag.incidentRelevantLegacyProcesses !== 0) throw new Error("incident legacy processes remain");
  if (diag.packageDpkgLegacyProcesses !== 0) throw new Error("dpkg remains legacy");
  if (diag.backgroundStaticLegacyCommands < 1 || diag.backgroundStaticLegacyProcesses < 1) throw new Error("background legacy not classified");
});

fail("quality checker rejects forged provenance", "Canonical execution lifecycle validation failed", () => {
  const simulation = clone(serviceCandidate.simulation);
  const command = simulation.commands.find((item) => item.id.startsWith("command:incident:"));
  simulation.lifecycleRegistry.records = simulation.lifecycleRegistry.records.filter((record) => record.commandId !== command.id);
  const result = checkLinuxInvestigationQuality({
    context: serviceCandidate.investigation,
    lab: { difficulty: "Advanced" },
    assets: serviceCandidate.assets,
    simulation,
  });
  if (result.passed) throw new Error("__NO_FAILURE__");
  throw new Error(result.issues.map((issue) => issue.description).join(" | "));
});

fail("quality checker rejects incomplete lifecycle", "Canonical execution lifecycle validation failed", () => {
  const simulation = clone(serviceCandidate.simulation);
  simulation.lifecycleRegistry.records[0].state = "pending";
  const result = checkLinuxInvestigationQuality({
    context: serviceCandidate.investigation,
    lab: { difficulty: "Advanced" },
    assets: serviceCandidate.assets,
    simulation,
  });
  if (result.passed) throw new Error("__NO_FAILURE__");
  throw new Error(result.issues.map((issue) => issue.description).join(" | "));
});
