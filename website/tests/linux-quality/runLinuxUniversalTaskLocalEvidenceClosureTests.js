#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { fullSubmission } = require("./linuxPhase10AssessmentTestUtils");

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
const SEEDS = ["task-local-a", "task-local-b"];

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-task-local-${Date.now()}`);
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

function buildCandidate(buildLinuxAssetCandidate, family, difficulty, seedSuffix = "base") {
  let lastError;
  const attempts = [];
  for (let attempt = 0; attempt < 420; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        seed: `phase13b:${family}:${difficulty}:${seedSuffix}:${attempt}`,
        generationTime: "2026-07-29T08:00:00.000Z",
        category: "Linux",
        difficulty,
        duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
        title: "Amniora Linux task-local closure",
      }, {
        incidentFamily: family,
        onAttempt: (event) => {
          if (!event.accepted) attempts.push({ attempt: event.attempt, reason: event.reason, issueCodes: event.issueCodes, score: event.score });
        },
      });
      if (candidate.assetQuality?.passed) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`could not build ${family} ${difficulty}: ${JSON.stringify(attempts.slice(-5))}; last=${lastError instanceof Error ? lastError.message : String(lastError || "none")}`);
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing asset ${filePath}`);
  return found;
}

function replaceAsset(assets, filePath, content) {
  return assets.map((item) => item.file_path === filePath ? { ...item, content } : item);
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
  return { candidate: copy, task: copy.simulation.canonicalTasks[taskIndex] };
}

function taskByIntent(candidate, intent) {
  const found = candidate.simulation.canonicalTasks.find((item) => item.intent === intent);
  if (!found) throw new Error(`missing task intent ${intent}`);
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
    title: `${task.suggestedVerb || "Review"} ${task.stepLabel || task.intent.replace(/_/g, " ")}.`,
    description: `Use only the listed evidence for ${candidate.investigation.hostname}.`,
    evidence,
    deliverable: deliverable || "Prepare an evidence-backed answer using only the listed task evidence and state any evidence gap.",
  };
}

function labFromCanonical(candidate, overrides = {}) {
  const tasks = candidate.simulation.canonicalTasks
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((task) => studentTask(candidate, task));
  for (const [index, taskOverride] of Object.entries(overrides)) {
    tasks[Number(index)] = { ...tasks[Number(index)], ...taskOverride };
  }
  return {
    id: `lab-${candidate.investigation.incidentId}`,
    title: `Linux investigation ${candidate.investigation.incidentId}`,
    topic: "Linux",
    objective: `Review ${candidate.investigation.hostname} using task-local evidence only.`,
    scenario: `${candidate.investigation.company} SOC is reviewing ${candidate.investigation.ticketId} for ${candidate.investigation.hostname}.`,
    tasks,
    hints: ["Use only the listed evidence for each task."],
    outcomes: ["Produce evidence-backed findings without overclaiming."],
    category: "Linux",
    difficulty: candidate.investigation.difficulty,
    duration: candidate.investigation.duration,
    estimated_time: candidate.investigation.duration,
  };
}

function savedLabRecord(lab) {
  return {
    id: lab.id,
    title: lab.title,
    topic: lab.category,
    difficulty: lab.difficulty,
    estimated_time: lab.duration,
    objective: lab.objective,
    scenario: lab.scenario,
    tasks: lab.tasks.map((task) => JSON.stringify(task)),
    hints: lab.hints,
    outcomes: lab.outcomes,
  };
}

function validateLab(validateLinuxStudentTaskSolvability, candidate, assets = candidate.assets, lab = labFromCanonical(candidate)) {
  return validateLinuxStudentTaskSolvability({ simulation: candidate.simulation, finalAssets: assets, lab });
}

function proveTask(proveLinuxStudentTaskSolvability, candidate, task, evidence, deliverable, assets = candidate.assets) {
  return proveLinuxStudentTaskSolvability({
    simulation: candidate.simulation,
    task,
    taskIndex: task.order - 1,
    studentTask: studentTask(candidate, task, evidence, deliverable),
    finalAssets: assets,
  });
}

function issueText(result) {
  return JSON.stringify(result.issues || []);
}

function assertFails(name, result, expectedPattern) {
  const text = issueText(result);
  assert(name, result.status !== "solvable" && new RegExp(expectedPattern, "i").test(text), text);
}

function cronDefinitionAssetPath(definition) {
  return definition.source === "root_crontab"
    ? "assets/scheduled/root_crontab.txt"
    : `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`;
}

function scriptInvokesPath(content, sourcePath) {
  const escapedPath = sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = new RegExp(`(?:^|[;&|()\\s])(?:sudo\\s+)?(?:bash\\s+|sh\\s+|exec\\s+|source\\s+|\\.\\s+)?${escapedPath}(?:\\s|$)`, "i");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .some((line) => direct.test(line));
}

function mutateFirstEvidencePath(submission) {
  const mutated = clone(submission);
  for (const claim of mutated.claims || []) {
    for (const citation of claim.evidence || []) citation.path = "assets/logs/not-listed-for-task.log";
  }
  return mutated;
}

function runProductionCronRegression(modules) {
  const {
    buildLinuxAssetCandidate,
    proveLinuxStudentTaskSolvability,
    validateLinuxStudentTaskSolvability,
    buildLinuxAssessmentPackage,
    scoreLinuxStructuredAssessmentSubmission,
    buildLabPdf,
    extractPdfTextForValidation,
  } = modules;
  const candidate = buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Intermediate", "production-71ad1f28");
  const definition = candidate.simulation.cronDefinitions.find((item) => item.sourcePath === "/etc/cron.d/platform-sync") || candidate.simulation.cronDefinitions[0];
  const definitionPath = cronDefinitionAssetPath(definition);
  const scriptPath = "assets/scripts/platform-sync.sh";
  const changeTask = taskByIntent(candidate, "change_control");
  const actorTask = taskByIntent(candidate, "actor_attribution");
  const cronTask = taskByIntent(candidate, "cron_analysis");

  assert("production regression uses Intermediate cron_persistence", candidate.simulation.investigation.incidentFamily === "cron_persistence" && candidate.simulation.canonicalTasks.every((task) => task.difficulty === "Intermediate"));
  assert("platform-sync cron definition is rendered", asset(candidate, definitionPath).content.includes("/usr/local/sbin/platform-sync.sh"), definitionPath);
  assert("platform-sync script is rendered", asset(candidate, scriptPath).content.includes("# source_path=/usr/local/sbin/platform-sync.sh"), scriptPath);

  const changePaths = selectedPaths(candidate, changeTask);
  const actorPaths = selectedPaths(candidate, actorTask);
  assert("change-control task includes a scoped authority document", changePaths.some((item) => item === "assets/docs/change_request.md" || item === "assets/docs/maintenance_ticket.md"), changePaths.join("|"));
  assert("change-control task does not carry cron-definition work", !changePaths.includes(definitionPath), changePaths.join("|"));
  assert("actor-attribution task does not carry scheduled run-as work", !actorPaths.includes(definitionPath), actorPaths.join("|"));
  assert("cron-analysis task carries the scheduled definition authority", selectedPaths(candidate, cronTask).includes(definitionPath), selectedPaths(candidate, cronTask).join("|"));

  const valid = validateLab(validateLinuxStudentTaskSolvability, candidate);
  assert("production-shape Intermediate cron lab is task-local solvable", valid.passed, issueText(valid));

  const oldChangeShape = validateLab(validateLinuxStudentTaskSolvability, candidate, candidate.assets, labFromCanonical(candidate, {
    [changeTask.order - 1]: {
      evidence: ["assets/docs/change_request.md", "assets/docs/maintenance_ticket.md"],
      deliverable: "Identify the cron definition and map the change records to observed activity.",
    },
  }));
  assert("old docs-only change-control shape is rejected", !oldChangeShape.passed && /LINUX_TASK_ATOMIC_SUPPORT_MISSING|LINUX_TASK_GLOBAL_ONLY_EVIDENCE/.test(issueText(oldChangeShape)), issueText(oldChangeShape));

  const oldActorShape = proveTask(
    proveLinuxStudentTaskSolvability,
    candidate,
    actorTask,
    ["assets/logs/auth.log", "assets/csv/users.csv"],
    "Identify the scheduled task run-as account and distinguish it from the interactive SSH actor."
  );
  assertFails("old auth/users-only run-as shape is rejected", oldActorShape, "cron definition|cron run-as|LINUX_TASK_ATOMIC_SUPPORT_MISSING|LINUX_TASK_GLOBAL_ONLY_EVIDENCE");

  const interactiveConflation = proveTask(
    proveLinuxStudentTaskSolvability,
    candidate,
    actorTask,
    [definitionPath, "assets/logs/auth.log", "assets/csv/users.csv"],
    "Use the interactive SSH account as the scheduled task run-as account.",
    replaceAsset(candidate.assets, definitionPath, asset(candidate, definitionPath).content.replace(/svc-report/g, "vendorops"))
  );
  assertFails("interactive actor and cron run-as conflation is rejected", interactiveConflation, "cron definition|cron run-as|LINUX_TASK_ATOMIC_SUPPORT_MISSING|LINUX_TASK_GLOBAL_ONLY_EVIDENCE");

  const currentStateAsHistory = proveTask(
    proveLinuxStudentTaskSolvability,
    candidate,
    cronTask,
    [definitionPath, scriptPath],
    "Use the current cron definition and script to prove historical execution of platform-sync."
  );
  assertFails("current cron state cannot prove historical execution", currentStateAsHistory, "cron execution");

  const wrongApprovalScope = proveTask(
    proveLinuxStudentTaskSolvability,
    candidate,
    changeTask,
    selectedPaths(candidate, changeTask),
    "Map the cron definition to the approved change scope.",
    replaceAsset(
      replaceAsset(candidate.assets, "assets/docs/change_request.md", `# ${candidate.investigation.changeId}\nApproved maintenance window: ${candidate.simulation.collection.windowStart} to ${candidate.simulation.collection.windowEnd}\nApproved: generic Linux work on ${candidate.investigation.hostname}\n`),
      "assets/docs/maintenance_ticket.md",
      `# ${candidate.investigation.ticketId}\nMaintenance window: ${candidate.simulation.collection.windowStart} to ${candidate.simulation.collection.windowEnd}\nScope: unrelated package inventory check on ${candidate.investigation.hostname}\n`
    )
  );
  assertFails("generic approval scope without exact activity is rejected", wrongApprovalScope, "approval/change authority|cron definition|scope");

  const scriptContent = asset(candidate, scriptPath).content;
  assert("generated platform-sync script does not invoke itself", !scriptInvokesPath(scriptContent, "/usr/local/sbin/platform-sync.sh"), scriptContent);
  const cronWithScript = withTaskEvidence(candidate, cronTask, [definitionPath, "assets/logs/syslog", scriptPath]);
  const scriptTask = studentTask(candidate, cronWithScript.task, [definitionPath, "assets/logs/syslog", scriptPath], "Identify the cron definition, run-as account, execution evidence, and script behavior using only these records.");
  for (const [label, content] of [
    ["self-recursive script", `${scriptContent}\n/usr/local/sbin/platform-sync.sh\n`],
    ["empty script", ""],
    ["unrelated script", "#!/usr/bin/env bash\necho unrelated\n"],
    ["mismatched script command", scriptContent.replace(/\/usr\/local\/sbin\/platform-sync\.sh/g, "/usr/local/sbin/other-job.sh")],
  ]) {
    const proof = proveLinuxStudentTaskSolvability({
      simulation: cronWithScript.candidate.simulation,
      task: cronWithScript.task,
      taskIndex: cronWithScript.task.order - 1,
      studentTask: scriptTask,
      finalAssets: replaceAsset(candidate.assets, scriptPath, content),
    });
    assertFails(`script mutation rejected: ${label}`, proof, "cron script contents|LINUX_TASK_ATOMIC_SUPPORT_MISSING");
  }

  const assessmentPackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
  let gradedContracts = 0;
  for (const contract of assessmentPackage.contracts) {
    const task = candidate.simulation.canonicalTasks.find((item) => item.id === contract.taskId);
    assert(`contract task ${contract.taskId} exists`, Boolean(task));
    const taskPaths = new Set(selectedPaths(candidate, task));
    const submission = fullSubmission(contract);
    const allCitationPaths = new Set((submission.claims || []).flatMap((claim) => (claim.evidence || []).map((citation) => citation.path)));
    for (const citationPath of allCitationPaths) {
      assert(`contract ${contract.taskId} cites only task-local evidence`, taskPaths.has(citationPath), `${citationPath} not in ${Array.from(taskPaths).join("|")}`);
    }
    const fullScore = scoreLinuxStructuredAssessmentSubmission(contract, submission);
    assert(`contract ${contract.taskId} full task-local answer receives maximum points`, fullScore.score === contract.scoring.maximumPoints, JSON.stringify(fullScore));
    const mutated = mutateFirstEvidencePath(submission);
    const mutatedScore = scoreLinuxStructuredAssessmentSubmission(contract, mutated);
    assert(`contract ${contract.taskId} unsupported evidence mutation loses credit`, mutatedScore.score < fullScore.score || mutatedScore.penalties > fullScore.penalties, JSON.stringify({ fullScore, mutatedScore }));
    gradedContracts += 1;
  }

  const duplicateLab = labFromCanonical(candidate, {
    0: {
      description: "",
      phase: "Task 1",
      title: "Map change records to observed activity",
    },
  });
  const pdf = buildLabPdf(savedLabRecord(duplicateLab), candidate.assets);
  const pdfText = extractPdfTextForValidation(pdf);
  assert("PDF contains the task heading", /Task 1: Map change records to observed activity/.test(pdfText), pdfText);
  assert("PDF does not render a second standalone Task 1 label", (pdfText.match(/^Task 1$/gm) || []).length === 0, pdfText);

  return { taskCount: candidate.simulation.canonicalTasks.length, gradedContracts };
}

function runProductionSudoRegression(modules) {
  const {
    buildLinuxAssetCandidate,
    proveLinuxStudentTaskSolvability,
    validateLinuxStudentTaskSolvability,
    buildLinuxNarrativeContract,
    buildLinuxAssembledNarrative,
    renderLinuxLearnerRequirementSentence,
  } = modules;
  const candidate = buildCandidate(buildLinuxAssetCandidate, "misconfigured_sudoers", "Intermediate", "production-5a7cc143");
  const sudoTask = taskByIntent(candidate, "sudo_policy");
  const configTask = taskByIntent(candidate, "configuration_review");
  const actorTask = taskByIntent(candidate, "actor_attribution");
  const sudoPaths = selectedPaths(candidate, sudoTask);
  const configPaths = selectedPaths(candidate, configTask);

  assert("production regression uses Intermediate misconfigured_sudoers", candidate.investigation.incidentFamily === "misconfigured_sudoers" && candidate.simulation.canonicalTasks.every((task) => task.difficulty === "Intermediate"));
  assert("sudo policy task includes policy evidence", sudoPaths.includes("assets/configs/linux_config_pack.txt"), sudoPaths.join("|"));
  assert("sudo policy task includes observed sudo execution evidence", sudoPaths.includes("assets/logs/sudo.log"), sudoPaths.join("|"));
  assert("sudo policy task includes account identity evidence", sudoPaths.some((item) => item === "assets/csv/users.csv" || item === "assets/accounts/passwd.sample"), sudoPaths.join("|"));
  assert("configuration review remains task-local and static-only", configPaths.length === 1 && configPaths[0] === "assets/configs/linux_config_pack.txt", configPaths.join("|"));

  const valid = validateLab(validateLinuxStudentTaskSolvability, candidate);
  assert("production-shape Intermediate sudo lab is task-local solvable", valid.passed, issueText(valid));

  const oldSudoShape = proveTask(
    proveLinuxStudentTaskSolvability,
    candidate,
    sudoTask,
    ["assets/configs/linux_config_pack.txt", "assets/csv/users.csv"],
    "Compare the command with sudo policy."
  );
  assertFails("old static-only sudo policy shape is rejected", oldSudoShape, "command_execution|LINUX_TASK_ATOMIC_SUPPORT_MISSING|LINUX_TASK_GLOBAL_ONLY_EVIDENCE");

  const correctedSudoShape = proveTask(
    proveLinuxStudentTaskSolvability,
    candidate,
    sudoTask,
    ["assets/configs/linux_config_pack.txt", "assets/logs/sudo.log", "assets/csv/users.csv"],
    "Compare the observed command with the sudo policy and account context."
  );
  assert("corrected sudo policy shape is solvable", correctedSudoShape.status === "solvable", issueText(correctedSudoShape));

  for (const replacement of ["assets/docs/change_request.md", "assets/evidence/incident_brief.md", "assets/csv/users.csv"]) {
    const proof = proveTask(
      proveLinuxStudentTaskSolvability,
      candidate,
      sudoTask,
      Array.from(new Set(["assets/configs/linux_config_pack.txt", replacement, "assets/csv/users.csv"])),
      "Compare the observed command with the sudo policy and account context."
    );
    assertFails(`non-execution evidence cannot replace sudo.log: ${replacement}`, proof, "command_execution|LINUX_TASK_ATOMIC_SUPPORT_MISSING|LINUX_TASK_GLOBAL_ONLY_EVIDENCE");
  }

  const primaryCommand = candidate.simulation.commands.find((item) => item.id === "command:incident:primary");
  assert("primary sudo command exists", Boolean(primaryCommand));
  const sudoLog = asset(candidate, "assets/logs/sudo.log").content;
  const wrongCommandAssets = replaceAsset(candidate.assets, "assets/logs/sudo.log", sudoLog.split(primaryCommand.renderedCommand).join("/usr/bin/id"));
  const wrongCommandProof = proveTask(
    proveLinuxStudentTaskSolvability,
    candidate,
    sudoTask,
    sudoPaths,
    "Compare the observed command with the sudo policy and account context.",
    wrongCommandAssets
  );
  assertFails("sudo log with wrong command is rejected", wrongCommandProof, "command_execution|LINUX_TASK_ATOMIC_SUPPORT_MISSING");

  const wrongUserAssets = replaceAsset(candidate.assets, "assets/logs/sudo.log", sudoLog.replace(new RegExp(`\\b${candidate.investigation.primaryUser}\\b`, "g"), "bluelead"));
  const wrongUserProof = proveTask(
    proveLinuxStudentTaskSolvability,
    candidate,
    sudoTask,
    sudoPaths,
    "Compare the observed command with the sudo policy and account context.",
    wrongUserAssets
  );
  assertFails("sudo log with wrong invoking user is rejected", wrongUserProof, "command_execution|LINUX_TASK_ATOMIC_SUPPORT_MISSING");

  const staticOnlyRuntimeClaim = proveTask(
    proveLinuxStudentTaskSolvability,
    candidate,
    configTask,
    configPaths,
    "Compare the configuration baseline with observed service runtime state."
  );
  assertFails("static configuration evidence cannot prove observed runtime state", staticOnlyRuntimeClaim, "observed service runtime state|LINUX_TASK_ATOMIC_SUPPORT_MISSING");

  const staticOnlyGap = proveTask(
    proveLinuxStudentTaskSolvability,
    candidate,
    configTask,
    configPaths,
    "Document the configuration baseline and any missing task-local runtime-state evidence."
  );
  assert("static configuration evidence can support an explicit runtime evidence gap", staticOnlyGap.status === "solvable", issueText(staticOnlyGap));

  const serviceInventory = candidate.assets.some((item) => item.file_path === "assets/reports/service_inventory.txt");
  if (serviceInventory) {
    const runtimeConfig = withTaskEvidence(candidate, configTask, ["assets/configs/linux_config_pack.txt", "assets/reports/service_inventory.txt"]);
    const runtimeProof = proveLinuxStudentTaskSolvability({
      simulation: runtimeConfig.candidate.simulation,
      task: runtimeConfig.task,
      taskIndex: runtimeConfig.task.order - 1,
      studentTask: studentTask(runtimeConfig.candidate, runtimeConfig.task, ["assets/configs/linux_config_pack.txt", "assets/reports/service_inventory.txt"], "Compare the configuration baseline with task-local runtime state evidence."),
      finalAssets: runtimeConfig.candidate.assets,
    });
    assert("configuration review can compare runtime state when runtime evidence is task-local", runtimeProof.status === "solvable", issueText(runtimeProof));
  }

  const genericUncertainty = renderLinuxLearnerRequirementSentence({ kind: "uncertainty_boundary", id: "excessive_sudo_not_malicious_intent" });
  assert("sudo uncertainty sentence is evidence-neutral", genericUncertainty.includes("The listed evidence") && !genericUncertainty.includes("Sudo evidence"), genericUncertainty);

  const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((item) => item.file_path));
  const assembled = buildLinuxAssembledNarrative({
    contract,
    context: candidate.investigation,
    difficulty: "Intermediate",
    duration: "30 mins",
    tasks: contract.taskContracts.map((task) => ({
      task_id: task.taskId,
      task_intent: task.intent,
      evidence: task.selectedEvidence.map((item) => item.path),
      deliverable: "placeholder",
    })),
  });
  const assembledActorTask = assembled.tasks[actorTask.order - 1];
  const assembledConfigTask = assembled.tasks[configTask.order - 1];
  const assembledSudoTask = assembled.tasks[sudoTask.order - 1];
  assert("actor uncertainty does not mention unavailable sudo evidence", !/Sudo evidence does not prove malicious intent/i.test(assembledActorTask.deliverable), assembledActorTask.deliverable);
  assert("configuration task renders an explicit runtime evidence gap", /missing task-local runtime-state evidence/i.test(assembledConfigTask.deliverable), assembledConfigTask.deliverable);
  assert("sudo task asks for observed policy comparison with sudo.log task-local", /observed activity|observed command/i.test(assembledSudoTask.deliverable) && assembledSudoTask.evidence.includes("assets/logs/sudo.log"), assembledSudoTask.deliverable);
  assert("configuration and sudo tasks remain distinct", assembledConfigTask.deliverable !== assembledSudoTask.deliverable, JSON.stringify({ config: assembledConfigTask.deliverable, sudo: assembledSudoTask.deliverable }));

  const lab = labFromCanonical(candidate, {
    [configTask.order - 1]: {
      deliverable: assembledConfigTask.deliverable,
    },
    [sudoTask.order - 1]: {
      deliverable: assembledSudoTask.deliverable,
    },
  });
  const assembledValidation = validateLab(validateLinuxStudentTaskSolvability, candidate, candidate.assets, lab);
  assert("assembled production sudo learner text remains task-local solvable", assembledValidation.passed, issueText(assembledValidation));

  return { taskCount: candidate.simulation.canonicalTasks.length, sudoEvidenceCount: sudoPaths.length };
}
function runMatrix(modules) {
  const { buildLinuxAssetCandidate, validateLinuxStudentTaskSolvability, assertLinuxTaskEvidenceClosureInvariant } = modules;
  const totals = { labs: 0, tasks: 0 };
  for (const family of FAMILIES) {
    for (const difficulty of DIFFICULTIES) {
      for (const seed of SEEDS) {
        const candidate = buildCandidate(buildLinuxAssetCandidate, family, difficulty, seed);
        const result = validateLab(validateLinuxStudentTaskSolvability, candidate);
        assert(`${family}/${difficulty}/${seed} task-local solvability`, result.passed, issueText(result));
        assertLinuxTaskEvidenceClosureInvariant(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
        totals.labs += 1;
        totals.tasks += candidate.simulation.canonicalTasks.length;
      }
    }
  }
  assert("matrix covers 11 families x 3 difficulties x 2 seeds", totals.labs === 66, JSON.stringify(totals));
  return totals;
}

function run() {
  const out = compileIfNeeded();
  const linuxOut = path.join(out, "linux");
  const { buildLinuxAssetCandidate } = require(path.join(linuxOut, "index.js"));
  const {
    validateLinuxStudentTaskSolvability,
    proveLinuxStudentTaskSolvability,
  } = require(path.join(linuxOut, "taskSolvability.js"));
  const { buildLinuxAssessmentPackage, scoreLinuxStructuredAssessmentSubmission } = require(path.join(linuxOut, "assessmentContract.js"));
  const { assertLinuxTaskEvidenceClosureInvariant, buildLinuxNarrativeContract } = require(path.join(linuxOut, "simulation.js"));
  const { buildLinuxAssembledNarrative, renderLinuxLearnerRequirementSentence } = require(path.join(linuxOut, "narrativeAssembly.js"));
  const { buildLabPdf, extractPdfTextForValidation } = require(path.join(out, "..", "lab-export.js"));

  const cronProduction = runProductionCronRegression({
    buildLinuxAssetCandidate,
    proveLinuxStudentTaskSolvability,
    validateLinuxStudentTaskSolvability,
    buildLinuxAssessmentPackage,
    scoreLinuxStructuredAssessmentSubmission,
    buildLabPdf,
    extractPdfTextForValidation,
  });
  const sudoProduction = runProductionSudoRegression({
    buildLinuxAssetCandidate,
    proveLinuxStudentTaskSolvability,
    validateLinuxStudentTaskSolvability,
    buildLinuxNarrativeContract,
    buildLinuxAssembledNarrative,
    renderLinuxLearnerRequirementSentence,
  });
  const matrix = runMatrix({ buildLinuxAssetCandidate, validateLinuxStudentTaskSolvability, assertLinuxTaskEvidenceClosureInvariant });

  console.log(JSON.stringify({ passed: true, production: { cron: cronProduction, sudo: sudoProduction }, matrix }, null, 2));
}

run();
