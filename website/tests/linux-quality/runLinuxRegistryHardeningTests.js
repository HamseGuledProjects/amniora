// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output root.");

const { execFileSync } = require("child_process");
const { buildLinuxAssetCandidate } = require(`${out}/lib/lab-assets/linux/index.js`);
const { validateCanonicalExecutionLifecycle, validateLinuxSimulationEvidence } = require(`${out}/lib/lab-assets/linux/simulation.js`);
const { checkLinuxInvestigationQuality } = require(`${out}/lib/lab-assets/linux/qualityChecker.js`);


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

function service(seed = "registry-service") {
  return buildCandidate(seed, {
    incidentFamily: "systemd_persistence",
    testOverrides: { command: "systemctl restart ssh.service" },
  });
}

function packageCandidate(seed = "registry-package") {
  return buildCandidate(seed, { incidentFamily: "unauthorized_package_install" });
}

function primaryRecord(simulation) {
  const command = simulation.commands.find((item) => item.kind === "primary_incident");
  const execution = simulation.executions.find((item) => item.id === command.executionId);
  const process = simulation.processes.find((item) => item.id === execution.processId);
  const record = simulation.lifecycleRegistry.records.find((item) => item.executionId === execution.id);
  return { command, execution, process, record };
}

pass("normal builder-generated lifecycle remains accepted", () => {
  const candidate = service("registry-normal");
  validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
});

pass("package apt and dpkg lifecycle remains accepted", () => {
  const candidate = packageCandidate("registry-package-valid");
  const dpkg = candidate.simulation.processes.find((item) => item.id === "process:package:dpkg");
  const record = candidate.simulation.lifecycleRegistry.records.find((item) => item.processId === dpkg.id);
  if (!record || dpkg.lifecycleOrigin !== "execution_first") throw new Error("dpkg is not ledger registered");
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

pass("shell-hosted failure lifecycle remains accepted", () => {
  const candidate = service("registry-failure-valid");
  const failed = candidate.simulation.executions.find((item) => item.id === "execution:shell-hosted:command-not-found");
  if (!failed || failed.outcome !== "failure" || failed.exitCode !== 127 || failed.processId) throw new Error("missing shell-hosted failure");
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

pass("many shell-hosted executions sharing one host shell remain accepted", () => {
  const candidate = service("registry-hosted-valid");
  const hosted = candidate.simulation.executions.filter((item) => item.processPolicy === "no_child_process");
  if (hosted.length < 2 || new Set(hosted.map((item) => item.hostProcessId)).size !== 1) throw new Error("hosted multiplicity missing");
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("duplicate identical execution registry record is rejected", "duplicate lifecycle registration", () => {
  const candidate = service("registry-duplicate-identical");
  candidate.simulation.lifecycleRegistry.records.push(candidate.simulation.lifecycleRegistry.records[0]);
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("duplicate commandId registration is rejected", "duplicate command registration", () => {
  const candidate = service("registry-duplicate-command");
  const source = candidate.simulation.lifecycleRegistry.records.find((record) => record.commandId);
  const duplicate = { ...source, registrationId: "lifecycle:test:duplicate-command", executionId: "execution:test:duplicate-command", processId: undefined };
  candidate.simulation.lifecycleRegistry.records.push(duplicate);
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("duplicate processId registration is rejected", "duplicate process registration", () => {
  const candidate = service("registry-duplicate-process");
  const source = candidate.simulation.lifecycleRegistry.records.find((record) => record.processId);
  const duplicate = { ...source, registrationId: "lifecycle:test:duplicate-process", executionId: "execution:test:duplicate-process", commandId: undefined };
  candidate.simulation.lifecycleRegistry.records.push(duplicate);
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("one command linked to two executions is rejected", "duplicate command registration", () => {
  const candidate = service("registry-command-two-executions");
  const { command } = primaryRecord(candidate.simulation);
  const other = candidate.simulation.lifecycleRegistry.records.find((item) => item.commandId && item.commandId !== command.id);
  other.commandId = command.id;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("one owned process linked to two executions is rejected", "duplicate process registration", () => {
  const candidate = service("registry-process-two-executions");
  const { process } = primaryRecord(candidate.simulation);
  const other = candidate.simulation.lifecycleRegistry.records.find((item) => item.processId && item.processId !== process.id);
  other.processId = process.id;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("fabricated equivalent registry replacement is rejected", "lifecycle ledger mismatch", () => {
  const candidate = service("registry-fabricated-replacement");
  const { record } = primaryRecord(candidate.simulation);
  const index = candidate.simulation.lifecycleRegistry.records.indexOf(record);
  candidate.simulation.lifecycleRegistry.records[index] = JSON.parse(JSON.stringify(record));
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("coordinated command process execution snapshot mutation is rejected", "invalid registration fingerprint", () => {
  const candidate = service("registry-coordinated-mutation");
  const { command, execution, process, record } = primaryRecord(candidate.simulation);
  command.cwd = "/tmp";
  execution.cwd = "/tmp";
  process.cwd = "/tmp";
  record.immutable = JSON.parse(JSON.stringify(record.immutable));
  record.immutable.execution.cwd = "/tmp";
  record.immutable.command.cwd = "/tmp";
  record.immutable.process.cwd = "/tmp";
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("commandId reassignment across visible objects is rejected", "command missing", () => {
  const candidate = service("registry-command-reassignment");
  const { command, execution, process, record } = primaryRecord(candidate.simulation);
  command.id = "command:incident:reassigned";
  execution.commandId = command.id;
  process.commandId = command.id;
  record.commandId = command.id;
  record.immutable = JSON.parse(JSON.stringify(record.immutable));
  record.immutable.execution.commandId = command.id;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("processId reassignment across visible objects is rejected", "invalid registration fingerprint", () => {
  const candidate = service("registry-process-reassignment");
  const { execution, process, record } = primaryRecord(candidate.simulation);
  process.id = "process:incident:reassigned";
  execution.processId = process.id;
  record.processId = process.id;
  record.immutable = JSON.parse(JSON.stringify(record.immutable));
  record.immutable.execution.processId = process.id;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("copied registration record attached to another execution is rejected", "identity authority changed after lifecycle finalization", () => {
  const candidate = service("registry-copied-record");
  const copy = JSON.parse(JSON.stringify(candidate.simulation.lifecycleRegistry.records[0]));
  copy.executionId = candidate.simulation.lifecycleRegistry.records[1].executionId;
  candidate.simulation.lifecycleRegistry.records.push(copy);
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("registry state changed after finalization is rejected", "invalid registration fingerprint", () => {
  const candidate = service("registry-state-change");
  candidate.simulation.lifecycleRegistry.records[0].state = "pending";
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("hosted execution changed into owned-process execution is rejected", "duplicate process registration", () => {
  const candidate = service("registry-hosted-to-owned");
  const execution = candidate.simulation.executions.find((item) => item.processPolicy === "no_child_process");
  const record = candidate.simulation.lifecycleRegistry.records.find((item) => item.executionId === execution.id);
  const host = candidate.simulation.processes.find((item) => item.id === execution.hostProcessId);
  execution.processPolicy = "create_process";
  execution.processId = host.id;
  delete execution.hostProcessId;
  record.mode = "create_process";
  record.processId = host.id;
  delete record.hostProcessId;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

pass("diagnostics report duplicate and invalid registration counts", () => {
  const candidate = service("registry-diagnostics");
  const record = candidate.simulation.lifecycleRegistry.records[0];
  candidate.simulation.lifecycleRegistry.records.push(record);
  const diagnostics = candidate.simulation.executionMigrationDiagnostics;
  if (diagnostics.duplicateExecutionRegistrations !== 0) throw new Error("baseline diagnostics were mutated unexpectedly");
  try {
    validateCanonicalExecutionLifecycle(candidate.simulation);
  } catch (_) {
    const values = candidate.simulation.lifecycleRegistry.records.map((item) => item.executionId);
    if (new Set(values).size === values.length) throw new Error("duplicate fixture failed to create duplicate");
    return;
  }
  throw new Error("duplicate registration was not rejected");
});

fail("quality checker rejects registry replacement", "Canonical execution lifecycle validation failed", () => {
  const candidate = service("registry-quality-replacement");
  const { record } = primaryRecord(candidate.simulation);
  const index = candidate.simulation.lifecycleRegistry.records.indexOf(record);
  candidate.simulation.lifecycleRegistry.records[index] = JSON.parse(JSON.stringify(record));
  const result = checkLinuxInvestigationQuality({
    context: candidate.investigation,
    lab: { difficulty: "Advanced" },
    assets: candidate.assets,
    simulation: candidate.simulation,
  });
  if (result.passed) throw new Error("__NO_FAILURE__");
  throw new Error(result.issues.map((issue) => issue.description).join(" | "));
});

pass("deterministic output remains stable", () => {
  const script = `
    const out = process.env.OUT;
    console.info = () => {};
    console.log = () => {};
    const { buildLinuxAssetCandidate } = require(out + "/lib/lab-assets/linux/index.js");
    function buildCandidate(seed) {
      let lastError;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
          return buildLinuxAssetCandidate({
            seed: seed + ":" + attempt,
            generationTime: "2026-07-29T08:00:00.000Z",
            category: "Linux", difficulty: "Advanced", duration: "30 mins",
            title: "CyberLab Asset Pack",
          }, { incidentFamily: "systemd_persistence" });
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("could not build deterministic fixture");
    }
    const candidate = buildCandidate("registry-stability");
    process.stdout.write(JSON.stringify(candidate.simulation.lifecycleRegistry.records.map((record) => ({
      registrationId: record.registrationId,
      registrationSequence: record.registrationSequence,
      executionId: record.executionId,
      commandId: record.commandId,
      processId: record.processId,
      hostProcessId: record.hostProcessId,
      integrityFingerprint: record.integrityFingerprint,
    }))));
  `;
  const run = () => execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, OUT: out },
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (run() !== run()) throw new Error("deterministic registry metadata changed");
});
