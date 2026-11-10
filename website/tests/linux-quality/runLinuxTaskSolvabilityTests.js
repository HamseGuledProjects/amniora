// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled lib/lab-assets output directory.");

const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
const {
  proveLinuxStudentTaskSolvability,
  validateLinuxStudentTaskSolvability,
} = require(`${out}/linux/taskSolvability.js`);
const {
  checkLinuxFinalProductionQuality,
} = require(`${out}/linux/qualityChecker.js`);

console.info = () => {};

function assert(name, condition, detail = "") {
  if (!condition) {
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${name}`);
}

function buildCandidate(predicate) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const candidate = buildLinuxAssetCandidate({ category: "Linux", difficulty: "Advanced", duration: "60 mins", title: "Phase 3 solvability" });
    if (candidate.assetQuality.passed && (!predicate || predicate(candidate))) return candidate;
  }
  throw new Error("could not build candidate matching predicate");
}

function assetByPath(candidate, pattern) {
  const asset = candidate.simulation.evidenceRegistry.find((item) => pattern.test(item.path));
  if (!asset) throw new Error(`missing registry asset ${pattern}`);
  return asset;
}

function taskByIntent(candidate, intent) {
  const task = candidate.simulation.canonicalTasks.find((item) => item.intent === intent);
  if (!task) throw new Error(`missing canonical task ${intent}`);
  return task;
}

function selectedPaths(candidate, task) {
  return task.selectedEvidenceAssetIds
    .map((id) => candidate.simulation.evidenceRegistry.find((asset) => asset.id === id)?.path)
    .filter(Boolean);
}

function studentTaskFor(candidate, task, evidencePaths = selectedPaths(candidate, task), deliverable = "Prepare evidence notes using only the listed evidence paths.") {
  return {
    phase: task.stepLabel || "Investigation",
    title: task.stepLabel || task.intent.replace(/_/g, " "),
    evidence: evidencePaths,
    deliverable,
  };
}

function prove(candidate, task, evidencePaths, deliverable) {
  return proveLinuxStudentTaskSolvability({
    simulation: candidate.simulation,
    task,
    taskIndex: task.order - 1,
    studentTask: studentTaskFor(candidate, task, evidencePaths, deliverable),
    finalAssets: candidate.assets,
  });
}

function validLab(candidate) {
  const tasks = candidate.simulation.canonicalTasks
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((task) => studentTaskFor(candidate, task, selectedPaths(candidate, task), "Document the evidence-backed result and any evidence gap using only the listed evidence paths."));
  return {
    title: `Linux task solvability for ${candidate.investigation.hostname}`,
    objective: `Review task-local Linux evidence for ${candidate.investigation.hostname} during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone}.`,
    scenario: `${candidate.investigation.company} SOC is reviewing ${candidate.investigation.ticketId} for ${candidate.investigation.hostname}. The task evidence lists are authoritative for this learner investigation.`,
    tasks,
    outcomes: ["Use only task-local evidence to produce bounded findings."],
    category: "Linux",
    difficulty: "Advanced",
    duration: "60 mins",
  };
}

const configCandidate = buildCandidate((candidate) => candidate.simulation.canonicalTasks.some((task) => task.intent === "configuration_review"));
const configTask = taskByIntent(configCandidate, "configuration_review");
const serviceInventory = assetByPath(configCandidate, /service_inventory\.txt$/);
const configPack = assetByPath(configCandidate, /linux_config_pack\.txt$/);

const configFail = prove(configCandidate, configTask, [serviceInventory.path], "Review configuration baseline evidence.");
assert("configuration baseline fails with service inventory only", configFail.status !== "solvable", JSON.stringify(configFail.issues));
assert("configuration baseline failure uses rendered capability mismatch or missing capability", configFail.issues.some((issue) => ["LINUX_TASK_RENDERED_CAPABILITY_MISMATCH", "LINUX_TASK_CAPABILITY_MISSING", "LINUX_TASK_GLOBAL_ONLY_EVIDENCE"].includes(issue.code)), JSON.stringify(configFail.issues));

const configPassTask = configTask;
const configPass = prove(configCandidate, configPassTask, selectedPaths(configCandidate, configPassTask), "Compare the supplied configuration baseline with the affected service context.");
assert("configuration baseline passes with rendered config content", configPass.status === "solvable", JSON.stringify(configPass.issues));

const configParaphrase = prove(configCandidate, configTask, [serviceInventory.path], "Create a concise baseline comparison note from the selected artifact.");
assert("configuration paraphrase cannot bypass canonical intent closure", configParaphrase.status !== "solvable", JSON.stringify(configParaphrase.issues));

const serviceCandidate = buildCandidate((candidate) => candidate.investigation.incidentFamily === "systemd_persistence" && candidate.simulation.canonicalTasks.some((task) => task.intent === "service_state"));
const serviceTask = taskByIntent(serviceCandidate, "service_state");
const serviceOnly = assetByPath(serviceCandidate, /service_inventory\.txt$/);
const serviceJournal = assetByPath(serviceCandidate, /journal_systemd\.txt$/);
const serviceFail = prove(serviceCandidate, serviceTask, [serviceOnly.path], "Describe the service transition and resulting state.");
assert("service transition fails with current inventory only", serviceFail.status !== "solvable", JSON.stringify(serviceFail.issues));
assert("service transition reports state mismatch or missing transition", serviceFail.issues.some((issue) => ["LINUX_TASK_STATE_TYPE_MISMATCH", "LINUX_TASK_CAPABILITY_MISSING", "LINUX_TASK_DELIVERABLE_UNSUPPORTED"].includes(issue.code)), JSON.stringify(serviceFail.issues));

const servicePass = prove(serviceCandidate, serviceTask, selectedPaths(serviceCandidate, serviceTask), "Describe the service transition, timestamp, and resulting state.");
assert("service transition passes with current inventory and transition log", servicePass.status === "solvable", JSON.stringify(servicePass.issues));

const sudoCandidate = buildCandidate((candidate) => candidate.simulation.canonicalTasks.some((task) => task.intent === "sudo_policy"));
const sudoTask = taskByIntent(sudoCandidate, "sudo_policy");
const sudoLog = assetByPath(sudoCandidate, /sudo\.log$/);
const sudoConfig = assetByPath(sudoCandidate, /linux_config_pack\.txt$/);
const users = assetByPath(sudoCandidate, /users\.csv$/);
const sudoFail = prove(sudoCandidate, sudoTask, [sudoLog.path], "Compare whether the sudo command was authorized by policy.");
assert("sudo policy fails with sudo log only", sudoFail.status !== "solvable", JSON.stringify(sudoFail.issues));
assert("sudo policy failure requires policy evidence", sudoFail.issues.some((issue) => issue.code === "LINUX_TASK_DELIVERABLE_UNSUPPORTED" || issue.code === "LINUX_TASK_CAPABILITY_MISSING"), JSON.stringify(sudoFail.issues));

const sudoPass = prove(sudoCandidate, sudoTask, selectedPaths(sudoCandidate, sudoTask), "Compare the observed sudo command with the applicable sudo rule and authorization result.");
assert("sudo policy passes with command, policy, and identity evidence", sudoPass.status === "solvable", JSON.stringify(sudoPass.issues));

const keyCandidate = buildCandidate((candidate) => candidate.investigation.incidentFamily === "ssh_key_compromise");
const keyBaseTask = keyCandidate.simulation.canonicalTasks[0];
const keyTask = {
  ...keyBaseTask,
  id: "task:test:key_provenance",
  intent: "key_provenance",
  requiredCapabilities: ["key_provenance"],
  requirements: [],
  currentStateRequirements: [],
  selectedEvidenceAssetIds: [],
};
const authLog = assetByPath(keyCandidate, /auth\.log$/);
const keyUncertaintyTask = { ...keyTask, selectedEvidenceAssetIds: [authLog.id] };
const authWithoutKeyId = keyCandidate.assets.map((asset) => asset.file_path === authLog.path
  ? { ...asset, content: asset.content.replace(/SHA256:[A-Za-z0-9+/=:-]+/g, "publickey").replace(/\bfingerprint\b/gi, "publickey") }
  : asset);
const keyUncertain = proveLinuxStudentTaskSolvability({
  simulation: keyCandidate.simulation,
  task: keyUncertaintyTask,
  taskIndex: 0,
  studentTask: studentTaskFor(keyCandidate, keyUncertaintyTask, [authLog.path], "Document whether the exact SSH key can be identified, including any attribution gap."),
  finalAssets: authWithoutKeyId,
});
assert("SSH key attribution gap is solvable with required uncertainty", keyUncertain.status === "solvable_with_required_uncertainty", JSON.stringify(keyUncertain.issues));

const keyDefinitive = proveLinuxStudentTaskSolvability({
  simulation: keyCandidate.simulation,
  task: keyUncertaintyTask,
  taskIndex: 0,
  studentTask: studentTaskFor(keyCandidate, keyUncertaintyTask, [authLog.path], "Identify the exact SSH key fingerprint used for the login."),
  finalAssets: authWithoutKeyId,
});
assert("SSH key definitive attribution fails without fingerprint", keyDefinitive.status !== "solvable", JSON.stringify(keyDefinitive.issues));
assert("SSH key definitive failure uses required uncertainty code", keyDefinitive.issues.some((issue) => issue.code === "LINUX_TASK_REQUIRED_UNCERTAINTY_MISSING" || issue.code === "LINUX_TASK_CLAIM_STRENGTH_UNSUPPORTED"), JSON.stringify(keyDefinitive.issues));

const fileCandidate = buildCandidate((candidate) => candidate.simulation.canonicalTasks.some((task) => task.intent === "file_permissions"));
const fileTask = taskByIntent(fileCandidate, "file_permissions");
const permissions = assetByPath(fileCandidate, /permissions_report\.txt$/);
const fileTimestampFail = prove(fileCandidate, fileTask, [permissions.path], "List the file path, owner, group, mode, and exact timestamp for the permission state.");
assert("file permissions fail when timeless report is asked for exact timestamp", fileTimestampFail.status !== "solvable", JSON.stringify(fileTimestampFail.issues));
assert("file permissions timestamp failure uses timestamp code", fileTimestampFail.issues.some((issue) => issue.code === "LINUX_TASK_TIMESTAMP_MISSING"), JSON.stringify(fileTimestampFail.issues));

const filePassTask = { ...fileTask, selectedEvidenceAssetIds: [permissions.id] };
const filePass = prove(fileCandidate, filePassTask, [permissions.path], "List the file path, owner, group, and mode from the selected report.");
assert("file permissions pass for owner group mode only", filePass.status === "solvable", JSON.stringify(filePass.issues));

const globalOnly = prove(configCandidate, configTask, [serviceInventory.path], "Use the selected artifact to compare the configuration baseline.");
assert("global evidence cannot satisfy task-local closure", globalOnly.issues.some((issue) => issue.code === "LINUX_TASK_GLOBAL_ONLY_EVIDENCE"), JSON.stringify(globalOnly.issues));

const renderedMismatchAssets = configCandidate.assets.map((asset) => asset.file_path === configPack.path ? { ...asset, content: "service,load_state,active_state,substate\nssh.service,loaded,active,running\n" } : asset);
const renderedMismatch = proveLinuxStudentTaskSolvability({
  simulation: configCandidate.simulation,
  task: configPassTask,
  taskIndex: configTask.order - 1,
  studentTask: studentTaskFor(configCandidate, configPassTask, [configPack.path, serviceInventory.path], "Compare the supplied configuration baseline."),
  finalAssets: renderedMismatchAssets,
});
assert("rendered capability mismatch fails despite registry capability", renderedMismatch.status !== "solvable" && renderedMismatch.issues.some((issue) => issue.code === "LINUX_TASK_RENDERED_CAPABILITY_MISMATCH"), JSON.stringify(renderedMismatch.issues));

const exfiltration = prove(fileCandidate, filePassTask, [permissions.path], "State whether data was exfiltrated from this host.");
assert("claim strength blocks exfiltration from staging-only/static evidence", exfiltration.issues.some((issue) => issue.code === "LINUX_TASK_CLAIM_STRENGTH_UNSUPPORTED"), JSON.stringify(exfiltration.issues));

const finalLab = validLab(sudoCandidate);
const finalSolvability = validateLinuxStudentTaskSolvability({
  simulation: sudoCandidate.simulation,
  finalAssets: sudoCandidate.assets,
  lab: finalLab,
});
assert("every generated task has a solvability report", finalSolvability.reports.length === sudoCandidate.simulation.canonicalTasks.length, JSON.stringify(finalSolvability));
assert("valid generated task set passes solvability", finalSolvability.passed, JSON.stringify(finalSolvability.issues));

const brokenLab = validLab(configCandidate);
const configIndex = configCandidate.simulation.canonicalTasks.findIndex((task) => task.intent === "configuration_review");
brokenLab.tasks[configIndex].evidence = [serviceInventory.path];
brokenLab.tasks[configIndex].deliverable = "Review configuration baseline evidence.";
const finalQuality = checkLinuxFinalProductionQuality({
  context: configCandidate.investigation,
  assets: configCandidate.assets,
  simulation: configCandidate.simulation,
  lab: brokenLab,
});
assert("final production quality blocks unsolvable task", !finalQuality.passed && finalQuality.issues.some((issue) => /LINUX_TASK_(?:UNSOLVABLE|GLOBAL_ONLY_EVIDENCE|CAPABILITY_MISSING|RENDERED_CAPABILITY_MISMATCH)/.test(issue.description)), JSON.stringify(finalQuality.issues));

for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
  const candidate = buildLinuxAssetCandidate({ category: "Linux", difficulty, duration: difficulty === "Advanced" ? "60 mins" : "30 mins", title: `Phase 3 ${difficulty}` });
  const lab = validLab(candidate);
  lab.difficulty = difficulty;
  const result = validateLinuxStudentTaskSolvability({
    simulation: candidate.simulation,
    finalAssets: candidate.assets,
    lab,
  });
  assert(`${difficulty} representative tasks produce reports`, result.reports.length === candidate.simulation.canonicalTasks.length, JSON.stringify(result));
  assert(`${difficulty} representative tasks only use acceptable statuses`, result.reports.every((report) => report.status === "solvable" || report.status === "solvable_with_required_uncertainty"), JSON.stringify(result.issues));
  assert(`${difficulty} saved task shape remains unchanged`, lab.tasks.every((task) => Object.keys(task).sort().join("|") === "deliverable|evidence|phase|title"), JSON.stringify(lab.tasks));
}

if (process.exitCode) process.exit(process.exitCode);
