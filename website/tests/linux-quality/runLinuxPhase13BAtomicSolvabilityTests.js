#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const FAMILIES = [
  "misconfigured_sudoers",
  "ssh_bruteforce",
  "service_account_misuse",
  "ssh_key_compromise",
  "cron_persistence",
  "systemd_persistence",
  "unauthorized_package_install",
  "data_staging",
  "log_tampering",
  "reverse_shell",
  "docker_compromise",
];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase13b-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCandidate(buildLinuxAssetCandidate, family, difficulty, duration = difficulty === "Advanced" ? "60 mins" : "30 mins", requiredIntents = []) {
  let lastError;
  for (let attempt = 0; attempt < 320; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        seed: `phase13b:${family}:${difficulty}:${attempt}`,
        generationTime: "2026-07-29T08:00:00.000Z",
        category: "Linux",
        difficulty,
        duration,
        title: "Amniora Linux Phase 13B",
      }, { incidentFamily: family });
      if (candidate.assetQuality?.passed && requiredIntents.every(intent => candidate.simulation.canonicalTasks.some(task => task.intent === intent))) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing asset ${filePath}`);
  return found;
}

function parseTs(value) {
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function replaceAsset(assets, filePath, content) {
  return assets.map((item) => item.file_path === filePath ? { ...item, content } : item);
}

function removeAsset(assets, filePath) {
  return assets.filter((item) => item.file_path !== filePath);
}

function registryAsset(candidate, filePath) {
  const found = candidate.simulation.evidenceRegistry.find((item) => item.path === filePath);
  if (!found) throw new Error(`missing registry asset ${filePath}`);
  return found;
}

function withTaskEvidence(candidate, task, evidencePaths) {
  const copy = clone(candidate);
  const taskIndex = copy.simulation.canonicalTasks.findIndex((item) => item.id === task.id);
  if (taskIndex < 0) throw new Error(`missing task ${task.id}`);
  copy.simulation.canonicalTasks[taskIndex].selectedEvidenceAssetIds = evidencePaths.map((evidencePath) => registryAsset(copy, evidencePath).id);
  return {
    candidate: copy,
    task: copy.simulation.canonicalTasks[taskIndex],
  };
}

function taskByIntent(candidate, intent) {
  const found = candidate.simulation.canonicalTasks.find((item) => item.intent === intent);
  if (!found) throw new Error(`missing task ${intent}`);
  return found;
}

function selectedPaths(candidate, task) {
  return task.selectedEvidenceAssetIds
    .map((id) => candidate.simulation.evidenceRegistry.find((item) => item.id === id)?.path)
    .filter(Boolean);
}

function studentTask(candidate, task, evidence = selectedPaths(candidate, task), deliverable) {
  return {
    phase: task.stepLabel || task.intent.replace(/_/g, " "),
    title: `${task.suggestedVerb || "Review"} ${task.stepLabel || task.intent.replace(/_/g, " ")} for ${candidate.investigation.hostname}.`,
    evidence,
    deliverable: deliverable || "Prepare evidence-backed notes, include any uncertainty, and use only the listed evidence.",
  };
}

function labFromCanonical(candidate, overrides = {}) {
  const tasks = candidate.simulation.canonicalTasks
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((task) => studentTask(candidate, task));
  Object.entries(overrides).forEach(([index, task]) => {
    tasks[Number(index)] = { ...tasks[Number(index)], ...task };
  });
  return {
    title: `Linux investigation ${candidate.investigation.incidentId}`,
    objective: `Review ${candidate.investigation.hostname} during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone}.`,
    scenario: `${candidate.investigation.company} SOC is reviewing ${candidate.investigation.ticketId} for ${candidate.investigation.hostname}, a ${candidate.investigation.hostRole}, in case ${candidate.investigation.incidentId} with ${candidate.investigation.changeId}.`,
    tasks,
    outcomes: ["Produce task-local, evidence-backed findings."],
    category: "Linux",
    difficulty: candidate.investigation.difficulty,
    duration: candidate.investigation.duration,
  };
}

function validateLab(validateLinuxStudentTaskSolvability, candidate, assets = candidate.assets, lab = labFromCanonical(candidate)) {
  return validateLinuxStudentTaskSolvability({
    simulation: candidate.simulation,
    finalAssets: assets,
    lab,
  });
}

function assertProofFails(name, proof, expectedPattern) {
  const text = JSON.stringify(proof.issues || []);
  assert(name, proof.status !== "solvable" && new RegExp(expectedPattern, "i").test(text), text);
}

function assertQualityFails(checkLinuxFinalProductionQuality, candidate, assets, expectedPattern, lab = labFromCanonical(candidate)) {
  const result = checkLinuxFinalProductionQuality({
    context: candidate.investigation,
    assets,
    simulation: candidate.simulation,
    lab,
  });
  const text = JSON.stringify(result.issues || []);
  assert(`quality rejects ${expectedPattern}`, !result.passed && new RegExp(expectedPattern, "i").test(text), text);
}

function cronDefinitionAssetPath(definition) {
  return definition.source === "root_crontab"
    ? "assets/scheduled/root_crontab.txt"
    : `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`;
}

function run() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    validateLinuxStudentTaskSolvability,
    proveLinuxStudentTaskSolvability,
  } = require(path.join(out, "linux", "taskSolvability.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));

  const matrix = [];
  for (const family of FAMILIES) {
    for (const difficulty of DIFFICULTIES) {
      const candidate = buildCandidate(buildLinuxAssetCandidate, family, difficulty);
      const result = validateLab(validateLinuxStudentTaskSolvability, candidate);
      assert(`${family} ${difficulty} task-local atomic solvability`, result.passed, JSON.stringify(result.issues));
      for (const session of candidate.simulation.sshSessions.filter((item) => item.closedAt)) {
        const renderedSshEvidence = ["assets/logs/auth.log", "assets/journal/journal_ssh.txt"]
          .filter((evidencePath) => candidate.assets.some((item) => item.file_path === evidencePath));
        assert(`${family} ${difficulty} renders SSH lifecycle evidence`, renderedSshEvidence.length > 0);
        const closeIsObserved = parseTs(session.closedAt) <= parseTs(candidate.simulation.collection.windowEnd);
        for (const evidencePath of renderedSshEvidence) {
          const content = asset(candidate, evidencePath).content;
          assert(
            `${family} ${difficulty} ${evidencePath} does not render unobserved SSH close`,
            closeIsObserved ? content.includes(session.closedAt) : !content.includes(session.closedAt),
            `${evidencePath} rendered an SSH close outside the collection window`
          );
        }
        if (!closeIsObserved && candidate.assets.some((item) => item.file_path === "assets/runtime/process_snapshot.txt")) {
          const processSnapshot = asset(candidate, "assets/runtime/process_snapshot.txt").content;
          assert(`${family} ${difficulty} live SSH process remains visible at capture`, processSnapshot.includes(String(session.sessionPid)));
        }
      }
      matrix.push({ family, difficulty, taskCount: candidate.simulation.canonicalTasks.length });
    }
  }

  // Task diversity intentionally varies intent selection; choose a fixture containing the clause under mutation.
  const beginnerSystemd = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", "Beginner", "30 mins", ["file_permissions"]);
  const configTask = taskByIntent(beginnerSystemd, "configuration_review");
  const configProof = proveLinuxStudentTaskSolvability({
    simulation: beginnerSystemd.simulation,
    task: configTask,
    taskIndex: configTask.order - 1,
    studentTask: studentTask(beginnerSystemd, configTask, selectedPaths(beginnerSystemd, configTask), "Compare the service baseline and unit-file details using the listed evidence."),
    finalAssets: beginnerSystemd.assets,
  });
  assert("Beginner systemd baseline has exact task-local support", configProof.status === "solvable", JSON.stringify(configProof.issues));

  const permissionTask = taskByIntent(beginnerSystemd, "file_permissions");
  const timelessPermissions = beginnerSystemd.assets.map(item => item.file_path === "assets/reports/permissions_report.txt"
    ? { ...item, content: item.content.replace(/^# capture_at=[^\n]*\n/m, "") } : item);
  const timestampRequest = proveLinuxStudentTaskSolvability({
    simulation: beginnerSystemd.simulation,
    task: permissionTask,
    taskIndex: permissionTask.order - 1,
    studentTask: studentTask(beginnerSystemd, permissionTask, ["assets/reports/permissions_report.txt"], "List owner, group, mode, and collection timestamp."),
    finalAssets: timelessPermissions,
  });
  assert("Beginner systemd rejects collection timestamp from timeless permissions report", timestampRequest.status !== "solvable" && timestampRequest.issues.some((issue) => issue.code === "LINUX_TASK_ATOMIC_SUPPORT_MISSING" || issue.code === "LINUX_TASK_TIMESTAMP_MISSING"), JSON.stringify(timestampRequest.issues));

  const intermediateCron = buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Intermediate", "30 mins");
  const cronTask = taskByIntent(intermediateCron, "cron_analysis");
  const definition = intermediateCron.simulation.cronDefinitions.find((item) => item.sourcePath === "/etc/cron.d/platform-sync") || intermediateCron.simulation.cronDefinitions[0];
  const definitionPath = cronDefinitionAssetPath(definition);
  const scriptPath = "assets/scripts/platform-sync.sh";
  assert("Intermediate cron renders platform-sync definition", Boolean(asset(intermediateCron, definitionPath).content.includes("/etc/cron.d/platform-sync")));
  assert("Intermediate cron renders platform-sync script", Boolean(asset(intermediateCron, scriptPath).content.includes("/usr/local/sbin/platform-sync.sh")));
  const cronProof = proveLinuxStudentTaskSolvability({
    simulation: intermediateCron.simulation,
    task: cronTask,
    taskIndex: cronTask.order - 1,
    studentTask: studentTask(intermediateCron, cronTask),
    finalAssets: intermediateCron.assets,
  });
  assert("Intermediate cron analysis uses exact platform-sync evidence", cronProof.status === "solvable", JSON.stringify(cronProof.issues));

  const cronScriptTask = studentTask(
    intermediateCron,
    cronTask,
    [definitionPath, "assets/logs/syslog", scriptPath],
    "Identify the platform-sync cron definition, run-as account, execution PID, and script contents using only these records."
  );
  const cronScriptFixture = withTaskEvidence(intermediateCron, cronTask, [definitionPath, "assets/logs/syslog", scriptPath]);
  const cronScriptProof = proveLinuxStudentTaskSolvability({
    simulation: cronScriptFixture.candidate.simulation,
    task: cronScriptFixture.task,
    taskIndex: cronScriptFixture.task.order - 1,
    studentTask: cronScriptTask,
    finalAssets: cronScriptFixture.candidate.assets,
  });
  assert("Intermediate platform-sync definition/run-as/PID/script task is solvable", cronScriptProof.status === "solvable", JSON.stringify(cronScriptProof.issues));

  const cronWithoutDefinition = removeAsset(intermediateCron.assets, definitionPath);
  assertQualityFails(checkLinuxFinalProductionQuality, intermediateCron, cronWithoutDefinition, "cron definition|cron_definition|LINUX_TASK_ATOMIC_SUPPORT_MISSING|missing");

  const cronWithoutScript = removeAsset(intermediateCron.assets, scriptPath);
  assertQualityFails(checkLinuxFinalProductionQuality, intermediateCron, cronWithoutScript, "registered evidence asset is missing|script|missing");

  const scriptContent = asset(intermediateCron, scriptPath).content;
  for (const [label, content] of [
    ["empty registered script", ""],
    ["unrelated registered script", "#!/usr/bin/env bash\necho unrelated-maintenance\n"],
    ["different canonical command script", scriptContent.replace(/\/usr\/local\/sbin\/platform-sync\.sh/g, "/usr/local/sbin/postfix-queue-cleanup.sh")],
    ["definition-inconsistent script", scriptContent.replace("# cron_source=/etc/cron.d/platform-sync", "# cron_source=/etc/cron.d/postfix-queue")],
  ]) {
    const proof = proveLinuxStudentTaskSolvability({
      simulation: cronScriptFixture.candidate.simulation,
      task: cronScriptFixture.task,
      taskIndex: cronScriptFixture.task.order - 1,
      studentTask: cronScriptTask,
      finalAssets: replaceAsset(intermediateCron.assets, scriptPath, content),
    });
    assertProofFails(`script analysis rejects ${label}`, proof, "cron script contents|LINUX_TASK_ATOMIC_SUPPORT_MISSING");
  }

  const definitionContent = asset(intermediateCron, definitionPath).content;
  assertQualityFails(
    checkLinuxFinalProductionQuality,
    intermediateCron,
    replaceAsset(intermediateCron.assets, definitionPath, definitionContent.replace(/\s+[a-z0-9._-]+\s+\/usr\/local\/sbin\/platform-sync\.sh/i, " ghostuser /usr/local/sbin/platform-sync.sh")),
    "run-as|identity|ghostuser"
  );

  const cronLogPath = "assets/logs/cron.log";
  if (intermediateCron.assets.some((item) => item.file_path === cronLogPath)) {
    assertQualityFails(
      checkLinuxFinalProductionQuality,
      intermediateCron,
      replaceAsset(intermediateCron.assets, cronLogPath, asset(intermediateCron, cronLogPath).content.replace(/\bCRON\[\d+\]/, "CRON[]")),
      "pid|process|cron"
    );
  }

  const originalIntermediateDefinition = validateLab(validateLinuxStudentTaskSolvability, intermediateCron, intermediateCron.assets, labFromCanonical(intermediateCron, {
    [cronTask.order - 1]: {
      evidence: ["assets/evidence/incident_brief.md"],
      deliverable: "Identify the /etc/cron.d/platform-sync definition and approval status from the brief.",
    },
  }));
  assert("original Intermediate brief-only cron definition shape is rejected", !originalIntermediateDefinition.passed && /LINUX_TASK_ATOMIC_SUPPORT_MISSING|LINUX_TASK_GLOBAL_ONLY_EVIDENCE/.test(JSON.stringify(originalIntermediateDefinition.issues)), JSON.stringify(originalIntermediateDefinition.issues));

  const originalIntermediateRunAs = proveLinuxStudentTaskSolvability({
    simulation: intermediateCron.simulation,
    task: cronTask,
    taskIndex: cronTask.order - 1,
    studentTask: studentTask(intermediateCron, cronTask, ["assets/logs/auth.log", "assets/csv/users.csv"], "Identify the run-as account and execution PID for /etc/cron.d/platform-sync."),
    finalAssets: intermediateCron.assets,
  });
  assertProofFails("original Intermediate auth/users run-as and PID shape is rejected", originalIntermediateRunAs, "cron definition|cron run-as|pid|cron execution");

  const originalIntermediatePid = proveLinuxStudentTaskSolvability({
    simulation: intermediateCron.simulation,
    task: cronTask,
    taskIndex: cronTask.order - 1,
    studentTask: studentTask(intermediateCron, cronTask, ["assets/logs/auth.log", "assets/logs/sudo.log"], "Identify the execution PID for /etc/cron.d/platform-sync."),
    finalAssets: intermediateCron.assets,
  });
  assertProofFails("original Intermediate auth/sudo PID shape is rejected", originalIntermediatePid, "pid|cron definition|cron execution");

  const changeTask = taskByIntent(intermediateCron, "change_control");
  const briefOnlyLab = labFromCanonical(intermediateCron, {
    [changeTask.order - 1]: {
      evidence: ["assets/evidence/incident_brief.md"],
      deliverable: "Determine whether the cron definition was approved by the change record.",
    },
  });
  const briefOnly = validateLab(validateLinuxStudentTaskSolvability, intermediateCron, intermediateCron.assets, briefOnlyLab);
  assert("incident brief cannot prove approval atom", !briefOnly.passed && briefOnly.issues.some((issue) => issue.code === "LINUX_TASK_ATOMIC_SUPPORT_MISSING" || issue.code === "LINUX_TASK_GLOBAL_ONLY_EVIDENCE"), JSON.stringify(briefOnly.issues));

  const advancedCron = buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Advanced", "60 mins");
  const advancedDefinition = advancedCron.simulation.cronDefinitions.find((item) => item.sourcePath === "/etc/cron.d/platform-sync") || advancedCron.simulation.cronDefinitions[0];
  const advancedDefinitionPath = cronDefinitionAssetPath(advancedDefinition);
  const advancedScriptPath = "assets/scripts/platform-sync.sh";
  const advancedCronTask = taskByIntent(advancedCron, "cron_analysis");
  assert("Advanced cron canonical object is platform-sync", advancedDefinition.sourcePath === "/etc/cron.d/platform-sync", advancedDefinition.sourcePath);
  assert("Advanced cron benign scheduled noise does not replace incident object", advancedCron.simulation.scheduledExecutions.some((execution) => execution.definitionId === advancedDefinition.id), JSON.stringify(advancedCron.simulation.scheduledExecutions));
  const advancedCronScriptFixture = withTaskEvidence(advancedCron, advancedCronTask, [advancedDefinitionPath, "assets/logs/cron.log", advancedScriptPath]);

  const advancedAccountTask = taskByIntent(advancedCron, "actor_attribution");
  const advancedAccountProof = proveLinuxStudentTaskSolvability({
    simulation: advancedCron.simulation,
    task: advancedAccountTask,
    taskIndex: advancedAccountTask.order - 1,
    studentTask: studentTask(advancedCron, advancedAccountTask),
    finalAssets: advancedCron.assets,
  });
  assert("Advanced account task corrected shape is solvable", advancedAccountProof.status === "solvable", JSON.stringify(advancedAccountProof.issues));

  const advancedCronScriptProof = proveLinuxStudentTaskSolvability({
    simulation: advancedCronScriptFixture.candidate.simulation,
    task: advancedCronScriptFixture.task,
    taskIndex: advancedCronScriptFixture.task.order - 1,
    studentTask: studentTask(advancedCron, advancedCronTask, [advancedDefinitionPath, "assets/logs/cron.log", advancedScriptPath], "Review the account, cron definition, script contents, and execution evidence; state any evidence gap instead of claiming unsupported execution."),
    finalAssets: advancedCron.assets,
  });
  assert("Advanced account/cron-definition corrected shape is solvable", advancedCronScriptProof.status === "solvable", JSON.stringify(advancedCronScriptProof.issues));

  const riskOnlyExecution = proveLinuxStudentTaskSolvability({
    simulation: advancedCron.simulation,
    task: advancedCronTask,
    taskIndex: advancedCronTask.order - 1,
    studentTask: studentTask(advancedCron, advancedCronTask, ["assets/evidence/advanced_risk_register.csv"], "Use the risk register to prove that /etc/cron.d/platform-sync executed."),
    finalAssets: advancedCron.assets,
  });
  assertProofFails("Advanced unsupported-execution-risk original shape is rejected", riskOnlyExecution, "cron definition|cron execution|LINUX_TASK_GLOBAL_ONLY_EVIDENCE|LINUX_TASK_ATOMIC_SUPPORT_MISSING");

  const currentCronOnly = proveLinuxStudentTaskSolvability({
    simulation: advancedCron.simulation,
    task: advancedCronTask,
    taskIndex: advancedCronTask.order - 1,
    studentTask: studentTask(advancedCron, advancedCronTask, [advancedDefinitionPath, advancedScriptPath], "Use current cron state to prove historical execution of /etc/cron.d/platform-sync."),
    finalAssets: advancedCron.assets,
  });
  assertProofFails("current/static cron state cannot prove historical execution", currentCronOnly, "cron execution");

  const riskRegisterPath = "assets/evidence/advanced_risk_register.csv";
  const riskRegisterProof = proveLinuxStudentTaskSolvability({
    simulation: advancedCron.simulation,
    task: advancedCronTask,
    taskIndex: advancedCronTask.order - 1,
    studentTask: studentTask(advancedCron, advancedCronTask, [riskRegisterPath], "Prove cron execution from the analyst risk register."),
    finalAssets: advancedCron.assets,
  });
  assertProofFails("risk register cannot prove cron execution", riskRegisterProof, "cron definition|cron execution|LINUX_TASK_GLOBAL_ONLY_EVIDENCE");

  const globalButUnassigned = clone(intermediateCron);
  const cronTaskIndex = globalButUnassigned.simulation.canonicalTasks.findIndex((task) => task.intent === "cron_analysis");
  const syslogAsset = registryAsset(globalButUnassigned, "assets/logs/syslog");
  globalButUnassigned.simulation.canonicalTasks[cronTaskIndex].selectedEvidenceAssetIds = [syslogAsset.id];
  const globalOnlyResult = validateLab(validateLinuxStudentTaskSolvability, globalButUnassigned, intermediateCron.assets, labFromCanonical(globalButUnassigned));
  assert("globally rendered but task-unassigned cron definition fails", !globalOnlyResult.passed && globalOnlyResult.issues.some((issue) => issue.code === "LINUX_TASK_GLOBAL_ONLY_EVIDENCE" || issue.code === "LINUX_TASK_ATOMIC_SUPPORT_MISSING"), JSON.stringify(globalOnlyResult.issues));

  const unrelatedCronContent = asset(intermediateCron, definitionPath).content.replace(/platform-sync/g, "postfix-queue-sample");
  assertQualityFails(
    checkLinuxFinalProductionQuality,
    intermediateCron,
    replaceAsset(intermediateCron.assets, definitionPath, unrelatedCronContent),
    "platform-sync|cron definition|command"
  );

  const relationlessDefinition = [
    "SHELL=/bin/sh",
    "PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin",
    `# source ${definition.sourcePath}`,
    `# schedule ${definition.schedule}`,
    "# run_as svc-report",
    "# command /usr/local/sbin/platform-sync.sh",
    `${definition.schedule} /usr/local/sbin/platform-sync.sh svc-report`,
  ].join("\n");
  const relationlessProof = proveLinuxStudentTaskSolvability({
    simulation: cronScriptFixture.candidate.simulation,
    task: cronScriptFixture.task,
    taskIndex: cronScriptFixture.task.order - 1,
    studentTask: cronScriptTask,
    finalAssets: replaceAsset(intermediateCron.assets, definitionPath, `${relationlessDefinition}\n`),
  });
  assertProofFails("cron relationship mutation with independent values but reversed relation fails", relationlessProof, "cron definition|cron run-as");

  const unrelatedExecutionDefinitionId = "cron:unrelated:job";
  const unrelatedExecutionProof = proveLinuxStudentTaskSolvability({
    simulation: intermediateCron.simulation,
    task: cronTask,
    taskIndex: cronTask.order - 1,
    studentTask: studentTask(intermediateCron, cronTask, [definitionPath, "assets/logs/syslog"], "Use timestamped execution evidence to prove execution of the canonical platform-sync definition."),
    finalAssets: replaceAsset(intermediateCron.assets, "assets/logs/syslog", asset(intermediateCron, "assets/logs/syslog").content.replace(definition.id, unrelatedExecutionDefinitionId)),
  });
  assertProofFails("unrelated timestamped execution cannot prove canonical incident definition execution", unrelatedExecutionProof, "cron execution");

  const systemdIntermediate = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", "Intermediate", "30 mins");
  const serviceTask = taskByIntent(systemdIntermediate, "service_state");
  const serviceStaticOnlyProof = proveLinuxStudentTaskSolvability({
    simulation: systemdIntermediate.simulation,
    task: serviceTask,
    taskIndex: serviceTask.order - 1,
    studentTask: studentTask(systemdIntermediate, serviceTask, ["assets/reports/service_inventory.txt"], "Use current service state to prove the historical service transition."),
    finalAssets: systemdIntermediate.assets,
  });
  assertProofFails("current service state cannot prove historical transition", serviceStaticOnlyProof, "service transition|LINUX_TASK_GLOBAL_ONLY_EVIDENCE");

  const advancedChangeTask = taskByIntent(advancedCron, "change_control");
  const approvedChangeProof = proveLinuxStudentTaskSolvability({
    simulation: advancedCron.simulation,
    task: advancedChangeTask,
    taskIndex: advancedChangeTask.order - 1,
    studentTask: studentTask(advancedCron, advancedChangeTask, selectedPaths(advancedCron, advancedChangeTask), "Reconcile the approved maintenance status and applicable window for the canonical activity."),
    finalAssets: advancedCron.assets,
  });
  assert("change document relates canonical activity to approval and window", approvedChangeProof.status === "solvable", JSON.stringify(approvedChangeProof.issues));

  const weakApprovalText = `# ${advancedCron.investigation.changeId}\nApproved maintenance window: ${advancedCron.simulation.collection.windowStart} to ${advancedCron.simulation.collection.windowEnd}\nApproved: generic unrelated work only\n`;
  const weakApprovalAssets = replaceAsset(
    replaceAsset(advancedCron.assets, "assets/docs/change_request.md", weakApprovalText),
    "assets/docs/maintenance_ticket.md",
    weakApprovalText
  );
  const weakApprovalProof = proveLinuxStudentTaskSolvability({
    simulation: advancedCron.simulation,
    task: advancedChangeTask,
    taskIndex: advancedChangeTask.order - 1,
    studentTask: studentTask(advancedCron, advancedChangeTask, selectedPaths(advancedCron, advancedChangeTask), "Reconcile the approved maintenance status and applicable window for the canonical activity."),
    finalAssets: weakApprovalAssets,
  });
  assertProofFails("generic approval words without canonical activity relationship fail", weakApprovalProof, "approval/change authority");

  console.log(JSON.stringify({ passed: true, matrixCases: matrix.length }, null, 2));
}

run();
