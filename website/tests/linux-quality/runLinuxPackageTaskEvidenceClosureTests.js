#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const BUILD = path.join(os.tmpdir(), `amniora-linux-package-task-closure-${process.pid}`);
if (!process.env.OUT) {
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--outDir", BUILD,
    "--noEmit", "false", "--incremental", "false", "--module", "commonjs",
    "--moduleResolution", "node", "--target", "es2020", "--jsx", "react-jsx"],
  { cwd: ROOT, stdio: "inherit" });
}
const OUT = process.env.OUT || path.join(BUILD, "lib", "lab-assets");
const { assertLinuxPackageMaintenanceTaskEvidence } = require(path.join(OUT, "linux", "claimAuthority.js"));

const asset = (file_path, content) => ({ file_path, file_name: path.basename(file_path), file_type: "text", content });
const assets = [
  asset("assets/logs/apt_history.log", [
    "Transaction-Ref: manual install for ncat",
    "Start-Date: 2026-07-06  23:33:48",
    "Commandline: /usr/bin/apt install ncat",
    "Requested-By: analyst (1398)",
    "Install: ncat:amd64 (7.94)",
    "End-Date: 2026-07-06  23:34:05",
  ].join("\n")),
  asset("assets/docs/change_request.md", [
    "# CHG-8458 Linux Control Change Record",
    "Host: db-audit-01",
    "Recurring maintenance policy: Friday 20:00-21:00 UTC",
    "Approval decision: not established by the supplied evidence.",
    "Requested or expected work:",
    "- Apply routine package updates",
    "Investigation window: 2026-07-06 23:31-23:59 UTC",
    "Activity scope: database host scheduled maintenance review",
  ].join("\n")),
  asset("assets/configs/linux_config_pack.txt", "# Undated illustrative configuration baseline\n"),
];
const compare = {
  title: "Assess configuration evidence",
  deliverable: "Check maintenance evidence against the package transaction.",
  evidence: assets.map((item) => item.file_path),
};
const check = (task, sources = assets) => assertLinuxPackageMaintenanceTaskEvidence({
  incidentFamily: "unauthorized_package_install",
  assets: sources,
  lab: JSON.parse(JSON.stringify({ tasks: [task] })), // final serialized learner shape
});

assert.throws(() => check({ ...compare, evidence: compare.evidence.filter((path) => !path.endsWith("apt_history.log")) }),
  /lacks task-local package transaction evidence/);
assert.throws(() => check({ ...compare, evidence: compare.evidence.filter((path) => !path.endsWith("change_request.md")) }),
  /lacks task-local dated change or maintenance authority/);
assert.doesNotThrow(() => check(compare));
assert.doesNotThrow(() => check({
  title: "Document maintenance evidence gaps",
  deliverable: "Identify what transaction records must be collected before comparing activity to maintenance scope.",
  evidence: ["assets/configs/linux_config_pack.txt"],
}));
const lateNarrative = {
  title: "Document maintenance evidence gaps",
  evidence: ["assets/configs/linux_config_pack.txt"],
  deliverable: "Identify missing transaction records. Check maintenance evidence against the package transaction.",
};
assert.throws(() => check(lateNarrative), /lacks task-local package transaction evidence/);
assert.throws(() => check(compare, assets.map((item) => item.file_path === "assets/docs/change_request.md"
  ? { ...item, content: item.content.replace("2026-07-06", "2026-07-05") }
  : item)), /lacks task-local dated change or maintenance authority/);
const crossMidnightAssets = assets.map((item) => item.file_path === "assets/logs/apt_history.log"
  ? { ...item, content: item.content.replaceAll("2026-07-06  23:33", "2026-07-05  23:48")
    .replaceAll("2026-07-06  23:34", "2026-07-05  23:49") }
  : item.file_path === "assets/docs/change_request.md"
  ? { ...item, content: item.content.replace("2026-07-06 23:31-23:59 UTC", "2026-07-06 00:41-01:01 Europe/Dublin") }
  : item);
assert.doesNotThrow(() => check(compare, crossMidnightAssets));
assert.doesNotThrow(() => check({
  title: "Package Installation",
  description: "Compare package provenance with the supplied log.",
  deliverable: "Identify which maintenance authority should be obtained before an approval comparison.",
  evidence: ["assets/configs/linux_config_pack.txt"],
}));
assert.doesNotThrow(() => check({
  title: "Compare package activity",
  description: "Review maintenance evidence that may need to be obtained.",
  deliverable: "Record the two separate evidence gaps without comparing the transaction to authority.",
  evidence: ["assets/configs/linux_config_pack.txt"],
}));
const configAssets = [
  ...assets,
  asset("assets/reports/service_inventory.txt", "service,captured_at,state_type\napt-daily.service,2026-07-07 00:02:00,collection_snapshot\n"),
];
configAssets.find((item) => item.file_path === "assets/configs/linux_config_pack.txt").content =
  "# Supplied SSH configuration sample: undated; incident-time effectiveness not established\n# Expected service baseline: apt-daily.service\n";
const configurationTask = {
  title: "Compare the control baseline with captured state",
  deliverable: "Write a note comparing the configuration baseline with task-local runtime state evidence.",
  evidence: ["assets/configs/linux_config_pack.txt", "assets/reports/service_inventory.txt"],
};
assert.doesNotThrow(() => check(configurationTask, configAssets));
assert.throws(() => check({ ...configurationTask, evidence: ["assets/reports/service_inventory.txt"] }, configAssets),
  /lacks task-local labelled baseline or captured service evidence/);
assert.throws(() => check({ ...configurationTask, evidence: ["assets/configs/linux_config_pack.txt"] }, configAssets),
  /lacks task-local labelled baseline or captured service evidence/);
assert.throws(() => check({ ...compare, evidence: ["assets/logs/apt_history.log", "assets/docs/change_request.md"],
  deliverable: `${compare.deliverable} Compare the configuration baseline with captured service state.` }),
  /lacks task-local labelled baseline or captured service evidence/);

const { buildLinuxAssetCandidate } = require(path.join(OUT, "linux", "index.js"));
const { buildLinuxNarrativeContract } = require(path.join(OUT, "linux", "simulation.js"));
const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(OUT, "linux", "narrativeAssembly.js"));
const { checkLinuxLabWorkload } = require(path.join(OUT, "linux", "workloadCalibration.js"));
const { checkLinuxInvestigationQuality } = require(path.join(OUT, "linux", "qualityChecker.js"));
const { validateLinuxTaskDiversity } = require(path.join(OUT, "linux", "taskDiversity.js"));
const { inferCurrentStateRequirementsFromText } = require(path.join(OUT, "linux", "currentStateEvidence.js"));

const requiresPackageState = (wording) => inferCurrentStateRequirementsFromText(wording)
  .some((requirement) => requirement.capability === "current_package_state");
assert.equal(requiresPackageState("Compare the configuration baseline with captured service state. Propose steps to verify package provenance."), false);
assert.equal(requiresPackageState("Package Installation: compare the configuration baseline with captured service state."), false);
assert.equal(requiresPackageState("Compare the configuration baseline with captured service state. Determine the currently installed package and version."), true);
assert.equal(requiresPackageState("Compare the configuration baseline with captured service state. Also compare the current package inventory with the transaction."), true);

function finalQuality(candidate, lab, difficulty, minutes) {
  return checkLinuxInvestigationQuality({
    assets: candidate.assets, context: candidate.investigation,
    simulation: candidate.simulation, lab,
    workload: {
      requestedDifficulty: difficulty, requestedDurationMinutes: minutes,
      expectedWorkloadEstimateHash: candidate.deterministicHashes.workloadEstimateHash,
      expectedWorkloadReportHash: candidate.deterministicHashes.workloadReportHash,
      expectedAssessmentContractHash: candidate.deterministicHashes.assessmentContractHash,
      expectedAssessmentQualityHash: candidate.deterministicHashes.assessmentQualityHash,
    },
  });
}

function tierCandidate(difficulty, minutes, seedIndex) {
  const candidate = buildLinuxAssetCandidate({
    seed: `package-workload-check:${difficulty}:${seedIndex}`,
    generationTime: "2026-08-09T21:30:00.000Z",
    category: "Linux", difficulty, duration: `${minutes} mins`,
    title: "Amniora Linux Asset Pack",
  }, { incidentFamily: "unauthorized_package_install" });
  const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((item) => item.file_path));
  const assembled = buildLinuxAssembledNarrative({
    contract, context: candidate.investigation, difficulty, duration: `${minutes} mins`,
    tasks: contract.taskContracts.map((task, index) => ({
      task_id: task.taskId, task_intent: task.intent, phase: `Task ${index + 1}`,
      title: "Review the task-local evidence",
      evidence: task.selectedEvidence.map((item) => item.path),
      deliverable: "Record an evidence-backed finding.",
    })),
  });
  const lab = finalLinuxNarrativeFromAssembled({ lab: assembled });
  const workload = checkLinuxLabWorkload({
    simulation: candidate.simulation, assets: candidate.assets,
    requestedDifficulty: difficulty, requestedDurationMinutes: minutes,
  });
  assert.equal(workload.passed, true, `${difficulty}/${minutes} workload: ${JSON.stringify(workload.issues)}`);
  assert.doesNotThrow(() => assertLinuxPackageMaintenanceTaskEvidence({
    incidentFamily: "unauthorized_package_install", assets: candidate.assets, lab,
  }));
  const quality = finalQuality(candidate, lab, difficulty, minutes);
  assert.equal(quality.passed, true, `${difficulty}/${minutes} final quality: ${JSON.stringify(quality.issues.slice(0, 5))}`);
  const maintenanceIndex = contract.taskContracts.findIndex((task) => task.intent === (difficulty === "Beginner" ? "configuration_review" : "change_control"));
  const maintenance = lab.tasks[maintenanceIndex];
  assert.ok(maintenance, `${difficulty}/${minutes} maintenance task`);
  const maintenanceText = `${maintenance.title} ${maintenance.deliverable}`;
  if (difficulty === "Beginner") {
    assert.match(maintenanceText, /missing|unavailable|needed|required|collect/i);
    assert.doesNotMatch(maintenanceText, /check maintenance evidence against the package transaction/i);
  } else {
    assert.deepEqual(new Set(maintenance.evidence), new Set(["assets/logs/apt_history.log", "assets/docs/change_request.md"]));
    assert.match(maintenanceText, /maintenance evidence against the package transaction/i);
    if (difficulty === "Advanced") {
      const control = lab.tasks[contract.taskContracts.findIndex((task) => task.intent === "configuration_review")];
      assert.ok(control, "Advanced retains a distinct control-state task");
      assert.deepEqual(new Set(control.evidence), new Set(["assets/configs/linux_config_pack.txt", "assets/reports/service_inventory.txt"]));
    }
  }
  const report = workload.report;
  console.log(JSON.stringify({ tier: `${difficulty}/${minutes}`, seedIndex,
    estimate: report?.estimatedDurationMinutes, range: report?.acceptableDurationRange,
    tasks: report?.taskEstimates?.map((task) => ({ intent: task.intent, minutes: task.estimatedMinutes,
      evidenceCount: task.relevantEvidencePaths.length })),
    renderedAssets: report?.metrics?.renderedEvidenceAssetCount,
    totalFiles: report?.metrics?.totalPackFileCount,
  }));
  return { candidate, lab, contract, workload };
}

tierCandidate("Beginner", 15, 1);
tierCandidate("Beginner", 30, 1);
tierCandidate("Intermediate", 30, 0);
tierCandidate("Intermediate", 30, 1);
const advanced = tierCandidate("Advanced", 30, 0);
tierCandidate("Advanced", 30, 1);

const controlIndex = advanced.contract.taskContracts.findIndex((task) => task.intent === "configuration_review");
const control = advanced.lab.tasks[controlIndex];
assert.equal(requiresPackageState(`${control.title}\n${control.description || ""}\n${control.deliverable}`), false);
assert.deepEqual(new Set(control.evidence), new Set(["assets/configs/linux_config_pack.txt", "assets/reports/service_inventory.txt"]));
const explicitPackageState = structuredClone(advanced.lab);
explicitPackageState.tasks[controlIndex].deliverable += " Determine the currently installed package and version.";
const unsupportedPackageState = finalQuality(advanced.candidate, explicitPackageState, "Advanced", 30);
assert.ok(unsupportedPackageState.issues.some((issue) => /capability=current_package_state/.test(issue.evidence || "")));
const supportedPackageState = structuredClone(explicitPackageState);
supportedPackageState.tasks[controlIndex].evidence.push("assets/inventory/package_inventory.txt");
assert.ok(advanced.candidate.assets.some((item) => item.file_path === "assets/inventory/package_inventory.txt"));
const withInventory = finalQuality(advanced.candidate, supportedPackageState, "Advanced", 30);
assert.ok(!withInventory.issues.some((issue) => /capability=current_package_state/.test(issue.evidence || "")),
  JSON.stringify(withInventory.issues));

const duplicated = advanced.candidate.simulation.canonicalTasks.map((task) => ({ ...task }));
duplicated[duplicated.length - 1] = { ...duplicated[0], id: "task:duplicate", order: duplicated.length };
assert.ok(validateLinuxTaskDiversity({ simulation: advanced.candidate.simulation, tasks: duplicated,
  finalAssets: advanced.candidate.assets }).issues.some((issue) => issue.code === "LINUX_TASK_DUPLICATE_EXACT"));
const inflatedAssets = [...advanced.candidate.assets, ...[1, 2, 3].map((number) => asset(`assets/qa-extra-${number}.txt`, `Distinct unused extra ${number}`))];
assert.ok(checkLinuxLabWorkload({ simulation: advanced.candidate.simulation, assets: inflatedAssets,
  requestedDifficulty: "Advanced", requestedDurationMinutes: 30 }).issues
  .some((issue) => issue.code === "LINUX_WORKLOAD_FILE_COUNT_INFLATION"));

console.log("PASS package tier evidence/workload closure and negative authority, duplicate-reasoning, file-inflation checks");
