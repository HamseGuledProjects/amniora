#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const out = path.join(os.tmpdir(), `amniora-linux-new-qa-patch-a-${Date.now()}`);
  execSync(`npx tsc --outDir "${out}" --noEmit false --incremental false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, { cwd: ROOT, stdio: "inherit" });
  return path.join(out, "lib", "lab-assets");
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing asset ${filePath}`);
  return found;
}

function taskByIntent(candidate, intent) {
  const found = candidate.simulation.canonicalTasks.find((item) => item.intent === intent);
  if (!found) throw new Error(`missing task ${intent}`);
  return found;
}

function registryAsset(candidate, filePath) {
  const found = candidate.simulation.evidenceRegistry.find((item) => item.path === filePath);
  if (!found) throw new Error(`missing registry asset ${filePath}`);
  return found;
}

function build(buildLinuxAssetCandidate, input, family) {
  let lastError;
  const rootSeed = String(input.seed || `patch-a:${family}`);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
        generationTime: "2026-07-29T08:00:00.000Z",
        category: "Linux",
        title: "Amniora new QA Bible Patch A",
        ...input,
        seed: attempt === 0 ? rootSeed : `${rootSeed}:valid:${attempt}`,
      }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Patch A candidate pool exhausted for ${family}`);
}

function expectThrow(name, run, pattern) {
  let error;
  try { run(); } catch (caught) { error = caught; }
  assert(name, error && pattern.test(String(error.message || error)), String(error?.message || "did not throw"));
}

function taskProof(prove, candidate, task, evidence, title, deliverable = "Write an evidence-backed finding using only the listed evidence.") {
  const copy = clone(candidate);
  const copiedTask = copy.simulation.canonicalTasks.find((item) => item.id === task.id);
  copiedTask.selectedEvidenceAssetIds = evidence.map((filePath) => registryAsset(copy, filePath).id);
  return prove({
    simulation: copy.simulation,
    task: copiedTask,
    taskIndex: copy.simulation.canonicalTasks.indexOf(copiedTask),
    studentTask: { title, evidence, deliverable },
    finalAssets: copy.assets,
  });
}

function run() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { validateLinuxPatchAIntegrity } = require(path.join(out, "linux", "learnerQa.js"));
  const { proveLinuxStudentTaskSolvability } = require(path.join(out, "linux", "taskSolvability.js"));
  const { evidenceCsvRows, evidenceCsvString, executedScriptHelpers } = require(path.join(out, "linux", "evidenceAuthority.js"));
  const { buildLinuxCanonicalNarrativeBrief, linuxLearnerSubjectLabel, scheduledExecutionRenderedPhase } = require(path.join(out, "linux", "simulation.js"));
  const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const mutateTimeline = (candidate, change) => {
    const timeline = asset(candidate, "assets/evidence/timeline.csv");
    const rows = evidenceCsvRows(timeline.content); change(rows); timeline.content = evidenceCsvString(rows);
  };
  const solvable = proof => ["solvable", "solvable_with_required_uncertainty"].includes(proof.status);

  const sudo = build(buildLinuxAssetCandidate, { seed: "patch-a:debug:1", difficulty: "Beginner", duration: "30 mins" }, "misconfigured_sudoers");
  const key = build(buildLinuxAssetCandidate, { seed: "patch-a:key:0", difficulty: "Advanced", duration: "30 mins" }, "ssh_key_compromise");
  const cron = build(buildLinuxAssetCandidate, { seed: "patch-a:cron_persistence:2", difficulty: "Advanced", duration: "30 mins" }, "cron_persistence");
  const systemd = build(buildLinuxAssetCandidate, { seed: "patch-a:systemd-closure:0", difficulty: "Advanced", duration: "30 mins" }, "systemd_persistence");
  const serviceAccount = build(buildLinuxAssetCandidate, { seed: "closure:service-account:0", difficulty: "Intermediate", duration: "30 mins" }, "service_account_misuse");

  [sudo, key, cron].forEach((candidate) => validateLinuxPatchAIntegrity(candidate.simulation, candidate.assets));
  assert("baseline cross-family Patch A candidates pass", true);

  const systemdConfiguration = taskByIntent(systemd, "configuration_review");
  const systemdConfigurationEvidence = systemdConfiguration.selectedEvidenceAssetIds
    .map((id) => systemd.simulation.evidenceRegistry.find((item) => item.id === id)?.path)
    .filter(Boolean);
  const unsupportedObservedComparison = taskProof(
    proveLinuxStudentTaskSolvability,
    systemd,
    systemdConfiguration,
    systemdConfigurationEvidence.filter((item) => item !== "assets/reports/service_inventory.txt"),
    "Review the control baseline",
    "Document the configuration baseline and any missing task-local runtime-state evidence. Compare baseline to observed service state."
  );
  assert("final rendered observed-state comparison cannot be waived by a separate gap clause", !solvable(unsupportedObservedComparison), JSON.stringify(unsupportedObservedComparison.issues));
  assert("systemd configuration task selects captured state locally", systemdConfigurationEvidence.includes("assets/reports/service_inventory.txt"), systemdConfigurationEvidence.join(", "));
  const captureComparison = "Compare the expected service baseline with observed service state at the inventory capture time.";
  const captureProof = taskProof(proveLinuxStudentTaskSolvability, systemd, systemdConfiguration, systemdConfigurationEvidence, "Compare configuration", captureComparison);
  assert("same-host unit snapshot supports capture-time comparison", solvable(captureProof), JSON.stringify(captureProof.issues));
  const wrongServiceHost = clone(systemd);
  asset(wrongServiceHost, "assets/reports/service_inventory.txt").content = asset(wrongServiceHost, "assets/reports/service_inventory.txt").content.replaceAll(systemd.simulation.investigation.hostname, "unrelated-host");
  assert("wrong-host snapshot does not support observed comparison", !solvable(taskProof(proveLinuxStudentTaskSolvability, wrongServiceHost, systemdConfiguration, systemdConfigurationEvidence, "Compare configuration", captureComparison)));
  const wrongCapture = clone(systemd);
  asset(wrongCapture, "assets/reports/service_inventory.txt").content = asset(wrongCapture, "assets/reports/service_inventory.txt").content.replaceAll(systemd.simulation.collection.collectedAt, "2025-01-01 00:00:00");
  assert("wrong capture instant does not support observed comparison", !solvable(taskProof(proveLinuxStudentTaskSolvability, wrongCapture, systemdConfiguration, systemdConfigurationEvidence, "Compare configuration", captureComparison)));
  assert("historical journal cannot substitute for capture-time inventory", !solvable(taskProof(proveLinuxStudentTaskSolvability, systemd, systemdConfiguration, ["assets/configs/linux_config_pack.txt", "assets/journal/journal_systemd.txt"], "Compare configuration", captureComparison)));
  assert("later snapshot cannot establish state throughout incident", !solvable(taskProof(proveLinuxStudentTaskSolvability, systemd, systemdConfiguration, systemdConfigurationEvidence, "Compare configuration", "Compare expected baseline with observed service state throughout the incident.")));

  const systemdContract = JSON.parse(buildLinuxCanonicalNarrativeBrief(systemd.simulation));
  const systemdLab = finalLinuxNarrativeFromAssembled({ lab: buildLinuxAssembledNarrative({
    contract: systemdContract, context: systemd.investigation, difficulty: "Advanced", duration: "30 mins",
    tasks: systemdContract.taskContracts.map(task => ({ task_id: task.taskId, task_intent: task.intent, evidence: task.selectedEvidence.map(e => e.path) })),
  }) });
  const finalSystemdCheck = lab => checkLinuxFinalProductionQuality({ context: systemd.investigation, simulation: systemd.simulation, assets: systemd.assets, lab });
  const systemdFinal = finalSystemdCheck(systemdLab);
  assert("assembled systemd package passes final production check", systemdFinal.passed, JSON.stringify(systemdFinal.issues).slice(0, 2500));
  assert("systemd response asks for ownership, approval and need before conditional disablement",
    systemdLab.tasks.some(task => /verify ownership, approval and operational need/i.test(task.deliverable) &&
      /when disabling or masking is justified/i.test(task.deliverable)));
  const unconditional = clone(systemdLab);
  unconditional.tasks[0].deliverable += " Preserve systemd evidence then disable or mask the unit.";
  assert("final package rejects unconditional systemd containment", !finalSystemdCheck(unconditional).passed);
  const lateUnsupported = clone(systemdLab);
  const lateTask = lateUnsupported.tasks.find(task => task.evidence?.includes("assets/configs/linux_config_pack.txt") && task.evidence?.includes("assets/reports/service_inventory.txt"));
  assert("assembled configuration task exists", Boolean(lateTask));
  console.log("SYSTEMD_CONFIGURATION_TASK " + JSON.stringify({ title: lateTask.title, deliverable: lateTask.deliverable, evidence: lateTask.evidence }));
  lateTask.evidence = lateTask.evidence.filter(path => path !== "assets/reports/service_inventory.txt");
  lateTask.deliverable += " Compare baseline with observed service state.";
  assert("late narrative change is rejected at real final-package gate", !finalSystemdCheck(lateUnsupported).passed);
  const namedRunAs = clone(systemdLab);
  namedRunAs.scenario += " backup.service runs as backup.";
  assert("final package rejects service/account name as run-as proof", !finalSystemdCheck(namedRunAs).passed);
  const inventedUnitContents = clone(systemdLab);
  inventedUnitContents.scenario += " The observed unit contents confirm ExecStart runs the payload.";
  assert("final package does not promote expected ExecStart to observed unit contents", !finalSystemdCheck(inventedUnitContents).passed);
  const oneShot = systemd.simulation.services.find(service => service.unitType === "oneshot");
  if (oneShot) {
    const inventedDaemon = clone(systemdLab);
    inventedDaemon.scenario += ` ${oneShot.unitName} is a live daemon.`;
    assert("one-shot service cannot be described as a live daemon", !finalSystemdCheck(inventedDaemon).passed);
  }

  assert("Intermediate maintenance note does not promise excluded APT history",
    !/apt_history\.log[^.\n]*in this evidence set/i.test(asset(serviceAccount, "assets/docs/maintenance_ticket.md").content));
  const falsePromise = clone(serviceAccount);
  asset(falsePromise, "assets/docs/maintenance_ticket.md").content += "\nCompare apt_history.log in this evidence set.\n";
  expectThrow("explicit evidence-set promise must be exported", () => validateLinuxPatchAIntegrity(falsePromise.simulation, falsePromise.assets), /promises non-exported evidence apt_history\.log/);
  const collectionOnly = clone(serviceAccount);
  asset(collectionOnly, "assets/docs/maintenance_ticket.md").content += "\nCollect apt_history.log if package timing becomes material.\n";
  validateLinuxPatchAIntegrity(collectionOnly.simulation, collectionOnly.assets);
  assert("future collection target is not a package promise", true);
  assert("sudoers sample is explicitly illustrative, not host-effective",
    /sudoers\.sample[^\n]*illustrative[^\n]*not a captured effective/i.test(asset(serviceAccount, "assets/configs/linux_config_pack.txt").content));
  const mislabeledSample = clone(serviceAccount);
  asset(mislabeledSample, "assets/configs/linux_config_pack.txt").content = asset(mislabeledSample, "assets/configs/linux_config_pack.txt").content.replace("sudoers.sample \u2014 illustrative policy summary, not a captured effective sudoers file.", "sudoers.sample \u2014 observed effective policy.");
  expectThrow("sample cannot be mislabeled effective", () => validateLinuxPatchAIntegrity(mislabeledSample.simulation, mislabeledSample.assets), /sudoers sample is not explicitly distinguished/);
  const serviceUserRows = evidenceCsvRows(asset(serviceAccount, "assets/csv/users.csv").content);
  const externalManagers = [...new Set(serviceUserRows.map(row => row.manager).filter(name => name && !serviceUserRows.some(row => row.username === name) && /^[a-z_][\w.-]*$/i.test(name)))];
  assert("manager references are included in the partial inventory declaration",
    externalManagers.every(name => asset(serviceAccount, "assets/configs/linux_config_pack.txt").content.includes(`"${name}"`)), externalManagers.join(", "));
  if (externalManagers.length) {
    const missingManager = clone(serviceAccount);
    const scopeAsset = asset(missingManager, "assets/configs/linux_config_pack.txt");
    scopeAsset.content = scopeAsset.content.replace(/^# Identity inventory scope: (.+)$/m, (_, value) => {
      const scope = JSON.parse(value);
      scope.outside_scope_users = scope.outside_scope_users.filter(name => name !== externalManagers[0]);
      return "# Identity inventory scope: " + JSON.stringify(scope);
    });
    expectThrow("missing manager scope declaration fails", () => validateLinuxPatchAIntegrity(missingManager.simulation, missingManager.assets), /undeclared identity users:/);
  }

  const sudoTask = taskByIntent(sudo, "sudo_policy");
  const sudoProof = taskProof(proveLinuxStudentTaskSolvability, sudo, sudoTask, ["assets/csv/users.csv"], "Identify the sudo account that executed the privileged command.");
  assert("001 identity-only evidence cannot satisfy observed sudo actor", sudoProof.issues.some((issue) => issue.code === "LINUX_TASK_SUDO_ACTOR_OBSERVATION_MISSING"), JSON.stringify(sudoProof.issues));
  const sudoEvidence = sudoTask.selectedEvidenceAssetIds.map((id) => sudo.simulation.evidenceRegistry.find((item) => item.id === id)?.path).filter(Boolean);
  const observedSudoProof = taskProof(proveLinuxStudentTaskSolvability, sudo, sudoTask, sudoEvidence, "Identify the sudo account that executed the privileged command.");
  assert("001 observed sudo event satisfies the whole task", solvable(observedSudoProof), JSON.stringify(observedSudoProof.issues));
  const unrelatedSudo = clone(sudo);
  const firstSudo = asset(unrelatedSudo, "assets/logs/sudo.log");
  firstSudo.content = firstSudo.content.replace(/\b2026-\d\d-\d\d \d\d:\d\d:\d\d/g, "2025-01-01 00:00:00");
  const wrongTimeProof = taskProof(proveLinuxStudentTaskSolvability, unrelatedSudo, sudoTask, sudoEvidence, "Identify the sudo account that executed the privileged command.");
  assert("001 unrelated timestamp cannot satisfy the sudo actor clause", wrongTimeProof.issues.some(i => i.code === "LINUX_TASK_SUDO_ACTOR_OBSERVATION_MISSING"));

  const keyTask = taskByIntent(key, "key_provenance");
  const keySubjectFiles = key.simulation.files.filter(file => keyTask.requirements.some(requirement => requirement.subjectIds.includes(file.id)));
  assert("002 key provenance stays bound to authorized keys despite command variants", keySubjectFiles.some(file => /\/\.ssh\/authorized_keys$/.test(file.path)));
  const keyEvidence = keyTask.selectedEvidenceAssetIds
    .map((id) => key.simulation.evidenceRegistry.find((item) => item.id === id)?.path)
    .filter(Boolean);
  const keyProof = taskProof(proveLinuxStudentTaskSolvability, key, keyTask, keyEvidence, "Identify the SSH key lifecycle and trust change.");
  assert("002 static key evidence cannot satisfy definitive lifecycle wording", keyProof.issues.some((issue) => issue.code === "LINUX_TASK_KEY_LIFECYCLE_EVIDENCE_MISSING"), JSON.stringify(keyProof.issues));
  const boundedKeyProof = taskProof(proveLinuxStudentTaskSolvability, key, keyTask, keyEvidence, "Document the unavailable key lifecycle history and key-to-file mapping.");
  assert("002 explicit unavailability contract is wholly solvable", solvable(boundedKeyProof), JSON.stringify(boundedKeyProof.issues));
  const falseWaiver = taskProof(proveLinuxStudentTaskSolvability, key, keyTask, keyEvidence, "Identify the key replacement. Document the unavailable key lifecycle history.");
  assert("002 a gap sentence cannot waive another unsupported clause", falseWaiver.issues.some(i => i.code === "LINUX_TASK_KEY_LIFECYCLE_EVIDENCE_MISSING"));
  const oldConditional = taskProof(proveLinuxStudentTaskSolvability, key, keyTask, keyEvidence, "Determine whether the evidence establishes a key lifecycle trust change; if it does not, record that lifecycle history is unavailable.");
  assert("002 conditional cannot-determine fallback is not proof of lifecycle", !solvable(oldConditional));
  const lifecycle = clone(key);
  const keyFile = lifecycle.simulation.files.find(f => /authorized_keys$/.test(f.path));
  const session = lifecycle.simulation.sshSessions.find(s => s.keyFingerprint);
  const keyRecord = `type=KEY_CHANGE msg=audit(${session.openedAt}): path="${keyFile.path}" fingerprint=${session.keyFingerprint} action=replace actor=${session.username} res=success`;
  asset(lifecycle, "assets/logs/audit.log").content += `\n${keyRecord}\n`;
  const lifecycleTask = taskByIntent(lifecycle, "key_provenance");
  const lifecycleProof = taskProof(proveLinuxStudentTaskSolvability, lifecycle, lifecycleTask, [...keyEvidence, "assets/logs/audit.log"], "Identify the SSH key lifecycle and trust change.");
  assert("002 bound historical lifecycle record satisfies the whole task", solvable(lifecycleProof), JSON.stringify(lifecycleProof.issues));
  const wrongKeyFile = clone(lifecycle);
  asset(wrongKeyFile, "assets/logs/audit.log").content = asset(wrongKeyFile, "assets/logs/audit.log").content.replace(keyRecord, keyRecord.replace(keyFile.path, "/home/unrelated/.ssh/authorized_keys"));
  const wrongKeyProof = taskProof(proveLinuxStudentTaskSolvability, wrongKeyFile, keyTask, [...keyEvidence, "assets/logs/audit.log"], "Identify the key replacement and key-to-file mapping.");
  assert("002 another account's key record cannot support this key clause", !solvable(wrongKeyProof));
  const wrongFingerprint = clone(lifecycle);
  asset(wrongFingerprint, "assets/logs/audit.log").content = asset(wrongFingerprint, "assets/logs/audit.log").content.replace(keyRecord, keyRecord.replace(session.keyFingerprint, "SHA256:unrelatedkey"));
  assert("002 unrelated fingerprint cannot satisfy observed-key lifecycle", !solvable(taskProof(proveLinuxStudentTaskSolvability, wrongFingerprint, keyTask, [...keyEvidence, "assets/logs/audit.log"], "Identify the key replacement.")));
  const clauseProof = taskProof(proveLinuxStudentTaskSolvability, key, keyTask, keyEvidence, "Identify the key replacement and key-to-file mapping.");
  assert("atomic secondary clauses retain separate unsupported history and mapping requirements", ["KEY_LIFECYCLE_HISTORY", "KEY_TO_FILE_LINK"].every(action => clauseProof.clauses.some(clause => clause.action === action && clause.supported === false)));

  const missingReference = clone(key);
  asset(missingReference, "assets/evidence/timeline.csv").content = asset(missingReference, "assets/evidence/timeline.csv").content.replace(/apt_history\.log/, "not_exported.log");
  expectThrow("006 non-exported timeline references fail", () => validateLinuxPatchAIntegrity(missingReference.simulation, missingReference.assets), /non-exported evidence not_exported\.log/i);

  const falseProvenance = clone(key);
  asset(falseProvenance, "assets/evidence/timeline.csv").content = asset(falseProvenance, "assets/evidence/timeline.csv").content
    .split(/\r?\n/)
    .map((line) => {
      if (!line.includes(",package transaction,")) return line;
      const columns = line.split(",");
      columns[7] = "process_snapshot.txt";
      return columns.join(",");
    })
    .join("\n");
  expectThrow("007 live snapshot cannot prove a completed event", () => validateLinuxPatchAIntegrity(falseProvenance.simulation, falseProvenance.assets), /exact_sources source process_snapshot\.txt does not support/i);
  const eventRemoved = clone(key);
  const packageName = eventRemoved.simulation.packageTransactions[0].packages[0].name;
  asset(eventRemoved, "assets/logs/apt_history.log").content = asset(eventRemoved, "assets/logs/apt_history.log").content.split(packageName).join("removed-package");
  expectThrow("007 existing source with claimed event removed fails", () => validateLinuxPatchAIntegrity(eventRemoved.simulation, eventRemoved.assets), /source apt_history\.log does not support/i);
  const falseContext = clone(key);
  mutateTimeline(falseContext, rows => { rows.find(r => r.activity_type === "package transaction").context_sources = "sudo.log"; });
  expectThrow("007 wrong context source fails even with valid exact evidence", () => validateLinuxPatchAIntegrity(falseContext.simulation, falseContext.assets), /context_sources source sudo.log does not support/);
  const selfProof = clone(key);
  mutateTimeline(selfProof, rows => { rows[0].exact_sources = "timeline.csv"; });
  expectThrow("007 timeline cannot prove itself", () => validateLinuxPatchAIntegrity(selfProof.simulation, selfProof.assets), /source timeline.csv does not support/);
  const proseReference = clone(key);
  asset(proseReference, "assets/configs/linux_config_pack.txt").content += "\n# Review assets/logs/not-exported.log\n";
  expectThrow("006 references outside timeline also close against exports", () => validateLinuxPatchAIntegrity(proseReference.simulation, proseReference.assets), /non-exported evidence assets\/logs\/not-exported.log/);
  const historySource = clone(key);
  const historyAsset = asset(historySource, "assets/runtime/process_execution_history.txt");
  const historyRows = evidenceCsvRows(historyAsset.content);
  historyRows[0].source_telemetry = "sudo.log";
  historyAsset.content = evidenceCsvString(historyRows);
  expectThrow("007 derived history cannot name unrelated sudo telemetry", () => validateLinuxPatchAIntegrity(historySource.simulation, historySource.assets), /historical source sudo.log does not support/);

  const missingCapture = clone(key);
  asset(missingCapture, "assets/inventory/package_inventory.txt").content = asset(missingCapture, "assets/inventory/package_inventory.txt").content.replace(/^# capture_at=.*\r?\n/m, "");
  expectThrow("008 mutable state without capture authority fails", () => validateLinuxPatchAIntegrity(missingCapture.simulation, missingCapture.assets), /package_inventory\.txt lacks consistent capture authority/i);
  assert("008 captured mutable state passes", /capture_at=.*state_type=collection_snapshot.*host=/m.test(asset(key, "assets/inventory/package_inventory.txt").content));
  const wrongHost = clone(key);
  const users = asset(wrongHost, "assets/csv/users.csv");
  const userRows = evidenceCsvRows(users.content); userRows[0].host = "another-host"; users.content = evidenceCsvString(userRows);
  expectThrow("008 each mutable row must carry the correct capture host", () => validateLinuxPatchAIntegrity(wrongHost.simulation, wrongHost.assets), /users.csv lacks consistent capture/);
  for (const path of ["assets/accounts/passwd.sample", "assets/accounts/group.sample", "assets/reports/permissions_report.txt"]) {
    const missing = clone(key);
    asset(missing, path).content = asset(missing, path).content.replace(/^# capture_at=[^\n]*\n/m, "");
    expectThrow(`008 registry-declared snapshot ${path} requires capture authority`, () => validateLinuxPatchAIntegrity(missing.simulation, missing.assets), /lacks consistent capture/);
  }

  const recurrence = clone(key);
  const definition = recurrence.simulation.cronDefinitions.find((item) => item.purpose !== "incident" && item.enabled && item.persistenceState === "present" && recurrence.simulation.scheduledExecutions.some((execution) => execution.definitionId === item.id));
  assert("recurrence test definition exists", Boolean(definition));
  const recurrencePath = definition.source === "root_crontab" ? "assets/scheduled/root_crontab.txt" : `assets/scheduled/cron.d/${definition.sourcePath.split("/").pop()}`;
  const occurrence = recurrence.simulation.scheduledExecutions.find(e => e.definitionId === definition.id);
  // Remove the cron source claim from this one timeline row so the recurrence
  // check independently detects the missing native cron observation.
  const occurrenceRef = linuxLearnerSubjectLabel(recurrence.simulation, occurrence.id);
  const renderedAt = scheduledExecutionRenderedPhase(recurrence.simulation, occurrence).timestamp;
  mutateTimeline(recurrence, rows => {
    const index = rows.findIndex(r => r.timestamp === renderedAt && r.activity_ref === occurrenceRef);
    assert("recurrence fixture finds exact rendered occurrence", index >= 0);
    rows[index].context_sources = rows[index].context_sources.split(";").filter(ref => ref !== "cron.log").join(";");
  });
  asset(recurrence, "assets/logs/cron.log").content = asset(recurrence, "assets/logs/cron.log").content.split("\n").filter(line => !line.startsWith(occurrence.occurredAt)).join("\n");
  expectThrow("009 rendered background occurrence removed fails independently", () => validateLinuxPatchAIntegrity(recurrence.simulation, recurrence.assets), /missing execution record/i);
  asset(recurrence, "assets/logs/cron.log").content = asset(key, "assets/logs/cron.log").content;
  validateLinuxPatchAIntegrity(recurrence.simulation, recurrence.assets);
  assert("009 explicit modelled partial-log scope passes", /telemetry_coverage=sampled.*gap_reason=partial_logs/.test(asset(recurrence, recurrencePath).content));
  const fakeGap = clone(recurrence);
  asset(fakeGap, recurrencePath).content = asset(fakeGap, recurrencePath).content.replace("gap_reason=partial_logs", "gap_reason=retention_boundary");
  expectThrow("009 invented retention excuse fails", () => validateLinuxPatchAIntegrity(fakeGap.simulation, fakeGap.assets), /modelled collection scope/);
  assert("009 full recurrence series passes", cron.assets.some((item) => /telemetry_coverage=complete.*gap_reason=none/.test(item.content)));
  const completeBackground = clone(key);
  const completeDefinition = completeBackground.simulation.cronDefinitions.find(d => d.id === definition.id);
  completeDefinition.telemetryCoverage.mode = "complete";
  delete completeDefinition.telemetryCoverage.reason;
  asset(completeBackground, recurrencePath).content = asset(completeBackground, recurrencePath).content.replace("telemetry_coverage=sampled", "telemetry_coverage=complete").replace("gap_reason=partial_logs", "gap_reason=none");
  validateLinuxPatchAIntegrity(completeBackground.simulation, completeBackground.assets);
  assert("009 all occurrences in a complete background collection interval pass", true);

  const helper = clone(cron);
  asset(helper, "assets/reports/permissions_report.txt").content = asset(helper, "assets/reports/permissions_report.txt").content.replace(/^\/usr\/bin\/logger .*\r?\n/m, "");
  expectThrow("011 executed helper without metadata fails", () => validateLinuxPatchAIntegrity(helper.simulation, helper.assets), /logger lacks executable metadata/i);
  assert("011 executed helper metadata passes", /^\/usr\/bin\/logger\s+-rwxr-xr-x\s+root\s+root$/m.test(asset(cron, "assets/reports/permissions_report.txt").content));
  const script = cron.assets.find(a => a.file_path.startsWith("assets/scripts/") && a.content.includes("logger"));
  const sourcePath = script.content.match(/^# source_path=(\S+)/m)[1];
  const nestedHelpers = executedScriptHelpers(cron.simulation, [
    {sourcePath, content:"/opt/qa-helper.sh", filePath:script.file_path, fileName:script.file_name, subjectIds:[]},
    {sourcePath:"/opt/qa-helper.sh", content:"logger -t qa done", filePath:"assets/scripts/qa-helper.sh", fileName:"qa-helper.sh", subjectIds:[]},
  ]);
  assert("011 executed helper traversal is transitive", nestedHelpers.includes("/opt/qa-helper.sh") && nestedHelpers.includes("/usr/bin/logger"));
  const knownPath = cron.simulation.files.find(f => !f.deletedAt).path;
  const unexecuted = executedScriptHelpers(cron.simulation, [{sourcePath, content:`test -e ${knownPath} || touch ${knownPath}`, filePath:script.file_path, fileName:script.file_name, subjectIds:[]}]);
  assert("011 unexecuted conditional helper is not fabricated", !unexecuted.includes("/usr/bin/touch"));

  const identity = clone(sudo);
  const groupRows = evidenceCsvRows(asset(identity, "assets/csv/groups.csv").content);
  groupRows[0].members += ",undeclared-user";
  asset(identity, "assets/csv/groups.csv").content = evidenceCsvString(groupRows);
  expectThrow("015 unresolved group member fails", () => validateLinuxPatchAIntegrity(identity.simulation, identity.assets), /undeclared identity users:undeclared-user/i);
  const scopeConfig = asset(identity, "assets/configs/linux_config_pack.txt");
  scopeConfig.content = scopeConfig.content.replace(/^# Identity inventory scope: (.+)$/m, (_, text) => { const scope = JSON.parse(text); scope.outside_scope_users.push("undeclared-user"); return "# Identity inventory scope: " + JSON.stringify(scope); });
  validateLinuxPatchAIntegrity(identity.simulation, identity.assets);
  assert("015 explicit partial-scope identity relationship passes", true);

  const configAuthority = clone(key);
  asset(configAuthority, "assets/configs/linux_config_pack.txt").content = asset(configAuthority, "assets/configs/linux_config_pack.txt").content.replace("# Supplied SSH configuration sample:", "# Configuration:").replace("# Expected policy:", "# Policy:");
  expectThrow("016 ambiguous observed-versus-expected config fails", () => validateLinuxPatchAIntegrity(configAuthority.simulation, configAuthority.assets), /not explicitly separated/i);
  const standalone = clone(key);
  asset(standalone, "assets/configs/ssh/sshd_config").content = asset(standalone, "assets/configs/ssh/sshd_config").content.replace("# Supplied SSH configuration sample:", "# Baseline:");
  expectThrow("016 standalone SSH configuration also retains authority", () => validateLinuxPatchAIntegrity(standalone.simulation, standalone.assets), /standalone configuration authority/);

  const telemetry = clone(sudo);
  const telemetryTask = taskByIntent(telemetry, "ssh_authentication");
  asset(telemetry, "assets/logs/auth.log").content = `# telemetry_completeness=partial reason=rate_limited\n${asset(telemetry, "assets/logs/auth.log").content}`;
  const telemetryProof = taskProof(proveLinuxStudentTaskSolvability, telemetry, telemetryTask, ["assets/logs/auth.log"], "Reconstruct the complete sequence and state that no additional authentication events occurred.");
  assert("022 exhaustive telemetry claim with rate-limit gap fails", telemetryProof.issues.some((issue) => issue.code === "LINUX_TASK_TELEMETRY_COMPLETENESS_UNSUPPORTED"), JSON.stringify(telemetryProof.issues));
  const boundedTelemetryProof = taskProof(proveLinuxStudentTaskSolvability, telemetry, telemetryTask, ["assets/logs/auth.log"], "Describe the observed authentication events and bound confidence because the source is rate limited.");
  assert("022 bounded telemetry-gap semantics pass", !boundedTelemetryProof.issues.some((issue) => issue.code === "LINUX_TASK_TELEMETRY_COMPLETENESS_UNSUPPORTED"), JSON.stringify(boundedTelemetryProof.issues));

  const authTask = taskByIntent(key, "ssh_authentication");
  const staticLogin = taskProof(proveLinuxStudentTaskSolvability, key, authTask, ["assets/csv/users.csv"], "Identify the account that logged in.");
  assert("observed authentication cannot be proved by account capability", staticLogin.issues.some(issue => issue.requirement === "observed authentication"));
  const authEvidence = authTask.selectedEvidenceAssetIds.map(id => key.simulation.evidenceRegistry.find(a => a.id === id).path);
  assert("actual task-local authentication supports account attribution", solvable(taskProof(proveLinuxStudentTaskSolvability, key, authTask, authEvidence, "Identify the account that logged in.")));
  const fileCreation = taskProof(proveLinuxStudentTaskSolvability, key, keyTask, keyEvidence, "Identify who created the file.");
  assert("ownership plus login is not historical file creation", fileCreation.clauses.some(c => c.action === "HISTORICAL_FILE_MUTATION" && !c.supported));

  const alternate = clone(key), collection = alternate.simulation.collection;
  // Probe the authentication telemetry contract independently of the new
  // Advanced SSH-key process-correlation clauses: journal is an alternate
  // authentication source, not a substitute for process history.
  taskByIntent(alternate, "ssh_authentication").requirements = taskByIntent(alternate, "ssh_authentication").requirements
    .filter((requirement) => requirement.capability === "authentication");
  const scope = `host=${alternate.investigation.hostname} interval_start=${collection.windowStart} interval_end=${collection.windowEnd}`;
  asset(alternate, "assets/logs/auth.log").content += `\n# telemetry_completeness=partial source=assets/logs/auth.log ${scope} reason=observed_log_loss\n`;
  asset(alternate, "assets/journal/journal_ssh.txt").content += `\n# telemetry_completeness=complete covers_source=assets/logs/auth.log ${scope}\n`;
  // This telemetry probe is source-specific; the rebalanced Advanced key task
  // already fills its three task-local slots with journal, identity and process history.
  const completeEvidence = ["assets/logs/auth.log", "assets/journal/journal_ssh.txt"];
  const completeProof = taskProof(proveLinuxStudentTaskSolvability, alternate, authTask, completeEvidence, "Reconstruct the complete sequence of authentication events.");
  assert("022 same-scope complete alternate authentication evidence is accepted", !completeProof.issues.some(i => i.code === "LINUX_TASK_TELEMETRY_COMPLETENESS_UNSUPPORTED"), JSON.stringify(completeProof.issues));
  asset(alternate, "assets/journal/journal_ssh.txt").content = `# telemetry_completeness=complete covers_source=assets/logs/auth.log ${scope}\n`;
  assert("022 empty complete-source label cannot replace native observations", taskProof(proveLinuxStudentTaskSolvability, alternate, authTask, completeEvidence, "Reconstruct the complete sequence of authentication events.").issues.some(i => i.code === "LINUX_TASK_TELEMETRY_COMPLETENESS_UNSUPPORTED"));

  const contract = JSON.parse(buildLinuxCanonicalNarrativeBrief(key.simulation));
  const lab = finalLinuxNarrativeFromAssembled({lab:buildLinuxAssembledNarrative({contract, context:key.investigation, difficulty:"Advanced", duration:"30 mins", tasks:contract.taskContracts.map(task=>({task_id:task.taskId, task_intent:task.intent, evidence:task.selectedEvidence.map(e=>e.path)}))})});
  const finalCheck = assets => checkLinuxFinalProductionQuality({context:key.investigation,simulation:key.simulation,assets,lab});
  const finalPositive = finalCheck(key.assets);
  assert("real final-production gate accepts valid Patch A pack", finalPositive.passed, JSON.stringify(finalPositive.issues));
  for (const [name, broken] of [["capture", missingCapture], ["reference", missingReference], ["semantic provenance", falseContext], ["historical provenance", historySource], ["authority", standalone]]) {
    const result = finalCheck(broken.assets);
    assert(`real final-production gate rejects ${name} mutation`, !result.passed && result.issues.some(issue=>JSON.stringify(issue).includes("Linux Patch A QA")));
  }

  console.log("Amniora new QA Bible Patch A tests passed.");
}

run();
