// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output root.");
const { execFileSync } = require("child_process");

const {
  buildLinuxAssetCandidate,
} = require(`${out}/lib/lab-assets/linux/index.js`);
const {
  createExecutionLifecycle,
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
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

const root = { id: "identity:root", username: "root", uid: 0, gid: 0, primaryGroupId: "group:root" };
const user = { id: "identity:analyst", username: "analyst", uid: 1000, gid: 1000, primaryGroupId: "group:analyst" };
const collections = {
  lifecycleRegistry: { records: [], rolledBack: [] },
  executions: [],
  commands: [],
  processes: [
    {
      id: "process:parent-shell",
      executionId: "execution:parent-shell",
      lifecycleOrigin: "system_origin",
      pid: 200,
      ppid: 1,
      executable: "/bin/bash",
      argv: ["/bin/bash"],
      identityId: user.id,
      realUid: user.uid,
      effectiveUid: user.uid,
      realGid: user.gid,
      effectiveGid: user.gid,
      cwd: "/home/analyst",
      sessionId: "session:ssh:1",
      startedAt: "2026-07-17 03:00:00",
      childProcessIds: [],
      openFileIds: [],
    },
  ],
};

expectPass("execution intent exists before command and process creation", () => {
  const beforeCommands = collections.commands.length;
  const beforeProcesses = collections.processes.length;
  const result = createExecutionLifecycle({
    intentId: "intent:test:stat",
    executionId: "execution:test:stat",
    hostname: "lnx-test-01",
    actorIdentity: user,
    effectiveIdentity: root,
    sessionId: "session:ssh:1",
    parentPid: 200,
    commandId: "command:test:stat",
    processId: "process:test:stat",
    pid: 201,
    commandKind: "primary_incident",
    renderedCommand: "stat /etc/shadow",
    executable: "/usr/bin/stat",
    argv: ["stat", "/etc/shadow"],
    cwd: "/home/analyst",
    tty: "pts/1",
    startTime: "2026-07-17 03:01:00",
    reason: "privilege_escalation",
    privilegeLevel: "root",
    processPolicy: "create_process",
    affectedFileIds: ["file:etc-shadow"],
    sudoRuleId: "sudo-rule:test",
    sudoProcessId: 199,
    shellProcessId: 200,
    expectedRenderTargets: ["audit", "sudo", "process"],
    outcome: "success",
    exitCode: 0,
  }, collections);
  if (collections.executions.at(-1).id !== "execution:test:stat") throw new Error("execution was not registered");
  if (collections.commands.length !== beforeCommands + 1) throw new Error("command was not projected from intent");
  if (collections.processes.length !== beforeProcesses + 1) throw new Error("process was not projected from intent");
  if (result.execution.commandId !== result.command.id || result.execution.processId !== result.process.id) throw new Error("execution was not finalized");
  if (result.command.executionId !== result.process.executionId) throw new Error("command/process execution IDs differ");
  if (result.command.actorIdentityId !== user.id || result.command.runAsIdentityId !== root.id) throw new Error("actor/effective identity was not preserved");
  if (result.command.cwd !== result.execution.cwd || result.process.cwd !== result.execution.cwd) throw new Error("cwd did not derive from intent");
  if (result.process.ppid !== 200 || result.process.startedAt !== result.execution.startTime) throw new Error("process parent/time did not derive from intent");
  if (result.execution.intentCreatedAt > result.execution.commandProjectedAt || result.execution.commandProjectedAt > result.execution.processProjectedAt) throw new Error("construction order markers invalid");
});

expectPass("failed no-child execution is created from intent", () => {
  const result = createExecutionLifecycle({
    intentId: "intent:test:denied",
    executionId: "execution:test:denied",
    hostname: "lnx-test-01",
    actorIdentity: user,
    effectiveIdentity: user,
    sessionId: "session:ssh:1",
    parentPid: 200,
    commandId: "command:test:denied",
    processId: "process:test:denied-not-created",
    pid: 200,
    commandKind: "supporting",
    renderedCommand: "cd /root",
    executable: "cd",
    argv: ["cd", "/root"],
    cwd: "/home/analyst",
    tty: "pts/1",
    startTime: "2026-07-17 03:02:00",
    reason: "interactive_command",
    privilegeLevel: "user",
    processPolicy: "no_child_process",
    outcome: "failure",
    exitCode: 1,
    expectedRenderTargets: [],
  }, collections);
  if (result.execution.processPolicy !== "no_child_process") throw new Error("no-child policy missing");
  if (result.execution.processId) throw new Error("no-child execution incorrectly owns a process");
  if (result.execution.hostProcessId !== "process:parent-shell") throw new Error("no-child execution did not bind to host process");
  if (result.execution.outcome !== "failure" || result.execution.exitCode !== 1) throw new Error("failure was not created at construction time");
});

const serviceCandidate = buildCandidate("phase2b-service", {
  incidentFamily: "systemd_persistence",
  testOverrides: { command: "systemctl restart ssh.service" },
});
const packageCandidate = buildCandidate("phase2b-package", {
  incidentFamily: "unauthorized_package_install",
});

expectPass("production incident commands are execution-first", () => {
  for (const command of serviceCandidate.simulation.commands.filter((item) => item.kind !== "background")) {
    if (command.constructionOrigin !== "execution_first") throw new Error(`${command.id} is not execution-first`);
    const execution = serviceCandidate.simulation.executions.find((item) => item.id === command.executionId);
    if (!execution || execution.constructionOrigin !== "execution_first" || !execution.intentId) throw new Error(`${command.id} lacks execution-first intent`);
  }
});

expectPass("service-control command/process uses execution-first construction", () => {
  const command = serviceCandidate.simulation.commands.find((item) => /systemctl restart/.test(item.renderedCommand));
  const process = serviceCandidate.simulation.processes.find((item) => item.pid === command.processId);
  if (command.constructionOrigin !== "execution_first" || process.lifecycleOrigin !== "execution_first") throw new Error("service command/process not execution-first");
  validateLinuxSimulationEvidence(serviceCandidate.simulation, serviceCandidate.assets);
});

expectPass("package incident command/process uses execution-first construction", () => {
  const command = packageCandidate.simulation.commands.find((item) => /\bapt\s+install\b/.test(item.renderedCommand));
  const process = packageCandidate.simulation.processes.find((item) => item.pid === command.processId);
  if (command.constructionOrigin !== "execution_first" || process.lifecycleOrigin !== "execution_first") throw new Error("package command/process not execution-first");
});

expectFail("missing parent rejected", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  simulation.processes.find((item) => item.ppid !== 1).ppid = 999999;
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("parent cycle rejected", "authoritative lifecycle ledger missing", () => {
  const simulation = clone(serviceCandidate.simulation);
  const child = simulation.processes.find((item) => item.ppid !== 1);
  const parent = simulation.processes.find((item) => item.pid === child.ppid);
  parent.ppid = child.pid;
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("duplicate PID rejected by documented global policy", "duplicate PID", () => {
  const simulation = clone(serviceCandidate.simulation);
  simulation.processes.push({ ...simulation.processes[0], id: "process:duplicate-pid" });
  validateCanonicalExecutionLifecycle(simulation);
});

expectFail("quality checker rejects advanced simulation without executions", "canonical executions", () => {
  const simulation = clone(serviceCandidate.simulation);
  delete simulation.executions;
  const result = checkLinuxInvestigationQuality({
    context: serviceCandidate.investigation,
    lab: { difficulty: "Advanced" },
    assets: serviceCandidate.assets,
    simulation,
  });
  if (result.passed) throw new Error("__NO_FAILURE__");
  throw new Error(result.issues.map((issue) => issue.description).join(" | "));
});

expectPass("renderer output stable for deterministic fixture", () => {
  const script = `
    const out = process.env.OUT;
    console.info = () => {};
    const { buildLinuxAssetCandidate } = require(out + "/lib/lab-assets/linux/index.js");
    try {
          return buildLinuxAssetCandidate(
            { category: "Linux", difficulty: "Advanced", duration: "30 mins", title: "CyberLab Asset Pack" },
            { incidentFamily: "systemd_persistence" }
          );
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("could not build deterministic renderer fixture");
    }
    try {
      const candidate = buildCandidate("phase2b-renderer-stability");
      process.stdout.write(candidate.assets
        .filter((asset) => asset.file_path.startsWith("assets/"))
        .map((asset) => asset.file_path + "\\n" + asset.content)
        .join("\\n---asset---\\n"));
  `;
  const run = () => execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, OUT: out },
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (run() !== run()) throw new Error("deterministic renderer fixture changed across identical seed");
});

expectPass("migration diagnostics distinguish execution-first and legacy paths", () => {
  const diagnostics = serviceCandidate.simulation.executionMigrationDiagnostics;
  if (diagnostics.executionFirstCommands < 1) throw new Error("no execution-first commands counted");
  if (diagnostics.legacyCommands < 1) throw new Error("legacy/background command count missing");
  if (diagnostics.backgroundSystemProcesses < 1) throw new Error("system/background process count missing");
  if (serviceCandidate.simulation.commands.filter((item) => item.kind !== "background" && item.constructionOrigin !== "execution_first").length) {
    throw new Error("incident command remained legacy");
  }
  console.log(JSON.stringify(diagnostics));
});
