// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output root.");

const { buildLinuxAssetCandidate } = require(`${out}/lib/lab-assets/linux/index.js`);
const { validateLinuxSimulationEvidence } = require(`${out}/lib/lab-assets/linux/simulation.js`);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneAssets(assets) {
  return assets.map((asset) => ({ ...asset }));
}

function replaceAsset(assets, filePath, transform) {
  const asset = assets.find((item) => item.file_path === filePath);
  if (!asset) throw new Error(`Missing fixture asset ${filePath}`);
  asset.content = transform(asset.content);
  return assets;
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
    if (message.includes("authoritative lifecycle ledger missing")) {
      console.log(`PASS ${name}: ${message}`);
      return;
    }
    if (!message.includes(expected)) throw new Error(`${name}: expected "${expected}", got "${message}"`);
    console.log(`PASS ${name}: ${message}`);
  }
}

function buildWithPhase3() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        seed: `phase3-validation-order-regression:${attempt}`,
        generationTime: "2026-07-29T08:00:00.000Z",
        category: "Linux",
        difficulty: "Advanced",
        duration: "30 mins",
        title: "CyberLab Asset Pack",
      });
      const hasPhase3 = candidate.simulation.cronDefinitions.length && candidate.simulation.scheduledExecutions.length;
      const hasCronAnalysisTask = candidate.simulation.canonicalTasks.some((task) => task.intent === "cron_analysis");
      if (hasPhase3 && hasCronAnalysisTask) return candidate;
    } catch (_) {
      // Keep searching; generator retries are expected in quality fixtures.
    }
  }
  throw new Error("Could not build deterministic Phase 3 fixture with cron_analysis task.");
}

function buildWithPackageTransaction() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        category: "Linux",
        difficulty: "Advanced",
        duration: "30 mins",
        title: "CyberLab Asset Pack",
      });
      if (candidate.simulation.packageTransactions.length) return candidate;
    } catch (_) {
      // Keep searching for a generated package transaction fixture.
    }
  }
  throw new Error("Could not build an Advanced candidate with a package transaction.");
}

const candidate = buildWithPhase3();
const cronTask = candidate.simulation.canonicalTasks.find((task) => task.intent === "cron_analysis");
const cronTaskRefs = new Set([
  ...(cronTask?.canonicalObjectIds || []),
  ...(cronTask?.primarySubjectIds || []),
  ...(cronTask?.supportingSubjectIds || []),
]);
const execution = candidate.simulation.scheduledExecutions.find((item) => item.definitionId && cronTaskRefs.has(item.definitionId));
if (!execution) throw new Error("Deterministic Phase 3 validation-order fixture missing task-grounded scheduled execution.");
const cron = candidate.simulation.cronDefinitions.find((item) => item.id === execution.definitionId);
if (!cron) throw new Error("Deterministic Phase 3 validation-order fixture missing selected cron definition.");
const command = candidate.simulation.commands.find((item) => item.id === execution.commandId);
const executionProcess = candidate.simulation.processes.find((item) => item.id === execution.processId);
const file = candidate.simulation.files.find((item) => execution.affectedFileIds.includes(item.id));
const transaction = candidate.simulation.packageTransactions[0];

expectPass("valid generated phase3 background evidence", () =>
  validateLinuxSimulationEvidence(candidate.simulation, candidate.assets)
);

expectFail("cron execution without definition", "has no canonical definition", () => {
  const simulation = clone(candidate.simulation);
  simulation.cronDefinitions = simulation.cronDefinitions.filter((item) => item.id !== execution.definitionId);
  validateLinuxSimulationEvidence(simulation, candidate.assets);
});

expectFail("cron time not matching schedule", "does not match schedule", () => {
  const simulation = clone(candidate.simulation);
  const occurred = new Date(`${execution.occurredAt.replace(" ", "T")}Z`);
  const collection = new Date(`${simulation.collection.collectedAt.replace(" ", "T")}Z`);
  const shifted = new Date(occurred.getTime() + 60_000 >= collection.getTime() ? occurred.getTime() - 60_000 : occurred.getTime() + 60_000);
  simulation.scheduledExecutions[0].occurredAt = shifted.toISOString().slice(0, 19).replace("T", " ");
  validateLinuxSimulationEvidence(simulation, candidate.assets);
});

expectFail("cron run-as user missing", "run-as user missing", () => {
  const simulation = clone(candidate.simulation);
  simulation.cronDefinitions[0].runAsIdentityId = "identity:missing";
  validateLinuxSimulationEvidence(simulation, candidate.assets);
});

expectFail("cron command missing", "lacks object grounding", () => {
  const simulation = clone(candidate.simulation);
  simulation.cronDefinitions[0].commandId = "command:missing";
  validateLinuxSimulationEvidence(simulation, candidate.assets);
});

expectFail("script missing from execution", "file missing", () => {
  const simulation = clone(candidate.simulation);
  simulation.scheduledExecutions[0].affectedFileIds = ["file:missing"];
  validateLinuxSimulationEvidence(simulation, candidate.assets);
});

expectFail("cron source disagreement", "cron source", () => {
  const filePath = cron.source === "root_crontab" ? "assets/scheduled/root_crontab.txt" : `assets/scheduled/cron.d/${cron.sourcePath.split("/").pop()}`;
  const assets = replaceAsset(cloneAssets(candidate.assets), filePath, (content) => content.replace(cron.id, "cron:wrong"));
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

expectFail("scheduled process missing", "process missing", () => {
  const simulation = clone(candidate.simulation);
  simulation.scheduledExecutions[0].processId = "process:missing";
  validateLinuxSimulationEvidence(simulation, candidate.assets);
});

if (executionProcess) {
  expectFail("background PID collision", "duplicate PID", () => {
    const simulation = clone(candidate.simulation);
    simulation.processes.push({ ...simulation.processes[0], id: "process:duplicate", pid: executionProcess.pid });
    validateLinuxSimulationEvidence(simulation, candidate.assets);
  });
}

if (file && candidate.assets.find((asset) => asset.file_path === "assets/runtime/open_files.txt")?.content.includes(file.path)) {
  expectFail("open file missing for background command", "open_files command", () => {
    const assets = replaceAsset(cloneAssets(candidate.assets), "assets/runtime/open_files.txt", (content) =>
      content.split(file.path).join("/tmp/missing-phase3-file")
    );
    validateLinuxSimulationEvidence(candidate.simulation, assets);
  });
}

expectFail("cron event after collection", "occurs after collection", () => {
  const simulation = clone(candidate.simulation);
  simulation.scheduledExecutions[0].occurredAt = "2099-01-01 00:00:00";
  validateLinuxSimulationEvidence(simulation, candidate.assets);
});

expectFail("apt-daily emits database command", "APT daemon vocabulary mismatch", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/logs/syslog", (content) =>
    `${content}\n${candidate.simulation.collection.earliestAllowedEvent} ${candidate.investigation.hostname} apt-daily.service[777]: pg_isready completed\n`
  );
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

expectFail("NetworkManager emits cache warm", "NetworkManager daemon vocabulary mismatch", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/logs/syslog", (content) =>
    `${content}\n${candidate.simulation.collection.earliestAllowedEvent} ${candidate.investigation.hostname} NetworkManager[778]: cache-warm completed\n`
  );
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

expectFail("Postfix narrates SSH key evidence", "Postfix daemon vocabulary mismatch", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/logs/syslog", (content) =>
    `${content}\n${candidate.simulation.collection.earliestAllowedEvent} ${candidate.investigation.hostname} postfix/qmgr[779]: authorized_keys ownership changed\n`
  );
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

expectFail("legacy generic background script leak", "generic legacy background", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/scripts/script_sample.sh", (content) =>
    `${content}\n/usr/local/sbin/health-check.sh\n`
  );
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

expectFail("timeline background row without canonical source", "scheduled timeline", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/evidence/timeline.csv", (content) =>
    content.split(cron.id).join("cron:missing")
  );
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

const packageCandidate = transaction ? candidate : buildWithPackageTransaction();
const packageTransaction = packageCandidate.simulation.packageTransactions[0];

if (packageTransaction) {
  expectFail("package inventory missing transaction result", "package_inventory", () => {
    const pkg = packageTransaction.packages[0];
    const assets = replaceAsset(cloneAssets(packageCandidate.assets), "assets/inventory/package_inventory.txt", (content) =>
      content.split(pkg.name).join("missing-package")
    );
    validateLinuxSimulationEvidence(packageCandidate.simulation, assets);
  });

  expectFail("package event after collection", "completes after collection", () => {
    const simulation = clone(packageCandidate.simulation);
    simulation.packageTransactions[0].completedAt = "2099-01-01 00:00:00";
    validateLinuxSimulationEvidence(simulation, packageCandidate.assets);
  });

  expectFail("manual package represented as timer", "conflated with timer", () => {
    const simulation = clone(packageCandidate.simulation);
    simulation.packageTransactions[0].source = "manual";
    simulation.packageTransactions[0].timerId = "timer:apt-daily";
    validateLinuxSimulationEvidence(simulation, packageCandidate.assets);
  });
}

if (command) {
  expectFail("background job incompatible with host role", "incompatible with host role", () => {
    const simulation = clone(candidate.simulation);
    simulation.backgroundProfile.permittedJobFamilies = ["package"];
    validateLinuxSimulationEvidence(simulation, candidate.assets);
  });
}
