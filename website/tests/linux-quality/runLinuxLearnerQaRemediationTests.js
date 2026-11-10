#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "../..");
const OUT = process.env.OUT || path.join(os.tmpdir(), "cyberlab-linux-learner-qa-current/lib/lab-assets");
if (!process.env.OUT) {
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--outDir", path.resolve(OUT, "../.."), "--noEmit", "false", "--module", "commonjs", "--moduleResolution", "node", "--target", "es2020", "--jsx", "react-jsx"], { cwd: ROOT, stdio: "inherit" });
}
const load = (name) => require(path.join(OUT, "linux", name));
const { buildLinuxAssetCandidate } = load("index.js");
const sim = load("simulation.js");
const { validateLinuxSemanticClosure } = load("semanticClosure.js");
const { proveLinuxStudentTaskSolvability, validateLinuxStudentTaskSolvability } = load("taskSolvability.js");
const { buildLinuxAssembledNarrative } = load("narrativeAssembly.js");
const { validateLinuxStudentContent } = load("studentContentValidation.js");
const qa = load("learnerQa.js");
const { parseLinuxCsvLine } = load("csv.js");
const FAMILIES = ["ssh_bruteforce", "misconfigured_sudoers", "service_account_misuse", "ssh_key_compromise", "cron_persistence", "systemd_persistence", "unauthorized_package_install", "data_staging", "log_tampering", "reverse_shell", "docker_compromise"];
const MATRIX = require("./linuxPhase9AuditUtils").MATRIX;
const report = { matrix: [], exactTasks: [], representatives: [], mutations: [] };
const destination = process.env.LINUX_LEARNER_QA_OUTPUT || path.join(ROOT, ".tmp", "linux-learner-qa-remediation");
fs.mkdirSync(destination, { recursive: true });
const asset = (c, name) => { const a = c.assets.find((a) => a.file_path === name); assert.ok(a, `missing ${name}`); return a; };
const quiet = (fn) => { const info = console.info; console.info = () => {}; try { return fn(); } finally { console.info = info; } };

function build(family, difficulty = "Advanced", season = "BST", hostPattern) {
  const date = season === "BST" ? "2026-07-06" : "2026-01-06";
  const fixtureSeed = MATRIX.find(([level, incident]) => level === difficulty && incident === family)?.[2];
  let last;
  for (let draw = -1; draw < 420; draw += 1) {
    const input = { category: "Linux", difficulty, duration: "30 mins", title: "Linux learner QA", seed: draw < 0 && fixtureSeed ? fixtureSeed : `learner-qa:${family}:${difficulty}:${draw}`, generationTime: `${date}T08:00:00.000Z` };
    try {
      const c = quiet(() => buildLinuxAssetCandidate(input, { incidentFamily: family, testOverrides: { incidentStart: `${date} 03:08:00`, timezone: "Europe/London" } }));
      if (hostPattern && !hostPattern.test(c.investigation.hostRole)) continue;
      c.qaInput = input;
      return c;
    } catch (error) { last = error.message; }
  }
  throw new Error(`Cannot build ${family}/${difficulty}/${season}/${hostPattern || "any role"}: ${last}`);
}

function narrative(c, difficulty = "Advanced") {
  const contract = sim.buildLinuxNarrativeContract(c.simulation, c.assets.map((a) => a.file_path));
  return buildLinuxAssembledNarrative({ contract, context: c.investigation, difficulty, duration: "30 mins", tasks: contract.taskContracts.map((t) => ({ task_id: t.taskId, task_intent: t.intent, evidence: t.selectedEvidence.map((a) => a.path) })) });
}

function runCase(c, season, difficulty = "Advanced") {
  const lab = narrative(c, difficulty);
  const row = { family: c.investigation.incidentFamily, difficulty, season, host: c.investigation.hostRole, invariants: {} };
  const check = (name, fn) => { try { fn(); row.invariants[name] = "PASS"; } catch (error) { row.invariants[name] = `FAIL: ${error.message}`; } };
  check("task_local", () => {
    const result = validateLinuxStudentTaskSolvability({ simulation: c.simulation, finalAssets: c.assets, lab });
    assert.ok(result.passed, JSON.stringify(result.issues));
    sim.assertLinuxTaskEvidenceClosureInvariant(c.simulation, c.assets.map((a) => a.file_path));
  });
  check("executable_modes", () => {
    sim.validateCanonicalExecutionLifecycle(c.simulation);
    const permissions = asset(c, "assets/reports/permissions_report.txt").content;
    for (const p of c.simulation.processes.filter((p) => p.executable.startsWith("/"))) {
      const f = c.simulation.files.find((f) => f.path === p.executable);
      assert.ok(f && f.fileType === "regular" && (f.mode & 0o111), p.executable);
      assert.ok(permissions.includes(`${f.path} ${sim.canonicalModeString(f)}`), `rendered executable ${f.path}`);
    }
  });
  check("objects", () => {
    for (const f of c.simulation.files) {
      if (f.path.endsWith(".sock")) assert.equal(f.fileType, "socket", f.path);
      if (f.fileType === "directory") assert.ok(f.mode & 0o111, f.path);
    }
  });
  check("identity_groups", () => {
    for (const identity of c.simulation.identities) assert.ok(c.simulation.groups.some((g) => g.gid === identity.gid), `primary GID ${identity.username}`);
    for (const f of c.simulation.files) assert.ok(c.simulation.groups.some((g) => g.id === f.groupId && g.gid === f.groupGid), `file group ${f.path}`);
  });
  check("process_listeners", () => {
    sim.validateCanonicalOpenFileDescriptors(c.simulation);
    sim.validateLinuxSimulationEvidence(c.simulation, c.assets);
    const daemons = c.simulation.processes.filter((p) => p.ppid === 1 && /\/(?:dockerd|containerd|kubelet)$/.test(p.executable));
    assert.equal(new Set(daemons.map((p) => p.executable)).size, daemons.length, "duplicate runtime daemon");
    for (const d of c.simulation.openFileDescriptors.filter((d) => d.descriptorType === "listening_socket")) {
      const p = c.simulation.processes.find((p) => p.id === d.processId);
      assert.ok(p && asset(c, "assets/network/listening_ports.txt").content.includes(`pid=${p.pid}`));
      assert.ok(asset(c, "assets/runtime/open_files.txt").content.includes(`${d.localAddress}:${d.localPort}`));
      assert.ok(asset(c, "assets/runtime/process_execution_history.txt").content.includes(String(p.pid)));
    }
  });
  check("timezone", () => {
    qa.validateLinuxLearnerPackBoundaries(c.assets);
    const expected = season === "BST" ? "02:08:00" : "03:08:00";
    assert.ok(c.simulation.collection.windowStart.endsWith(expected));
    const doc = asset(c, "assets/evidence/incident_brief.md").content;
    assert.ok(doc.includes(season === "BST" ? "Europe/London +0100" : "Europe/London +0000"), "explicit document offset");
    for (const a of c.assets) assert.match(a.content, /Time authority:|time_authority|^-- Journal begins at .+ UTC --/m, a.file_path);
  });
  check("bounded_conclusions", () => {
    const result = validateLinuxSemanticClosure({ simulation: c.simulation, finalAssets: c.assets });
    assert.ok(result.passed, JSON.stringify(result.issues));
    if (c.investigation.incidentFamily === "docker_compromise") {
      assert.ok(asset(c, "assets/evidence/audit_notes.md").content.includes(qa.linuxContainerEvidenceBoundary));
      const csv = asset(c, "assets/runtime/file_access_history.csv").content.trim().split(/\r?\n/).map((l) => parseLinuxCsvLine(l).values);
      const header = csv.shift();
      for (const row of csv.filter((r) => /\bdocker run\b/.test(r[header.indexOf("command")]) && r[header.indexOf("path")] === "/srv/shared")) {
        assert.equal(row[header.indexOf("operation")], "mount_reference");
      }
    }
  });
  check("spoiler_safety", () => {
    const result = validateLinuxStudentContent({ ...lab, assets: c.assets });
    assert.ok(result.passed, JSON.stringify(result.issues));
    const riskRegister = c.assets.find((a) => a.file_name === "risk_register.csv").content;
    for (const hypothesis of qa.linuxReviewHypotheses) assert.ok(riskRegister.includes(hypothesis));
    const advancedRiskRegister = c.assets.find((a) => a.file_name === "advanced_risk_register.csv").content;
    assert.match(advancedRiskRegister, /unverified/i);
    for (const text of [riskRegister, advancedRiskRegister]) assert.doesNotMatch(text, /,(?:high|critical),/i);
    const notes = asset(c, "assets/evidence/audit_notes.md").content;
    assert.doesNotMatch(notes, /Commands and activity patterns to correlate/);
    const hardening = asset(c, "assets/reports/hardening_checklist.md").content;
    assert.doesNotMatch(hardening, /Remove broad host mounts|Rotate contractor SSH keys|Remove temporary maintenance rules|Disable unapproved systemd units/);
    const brief = asset(c, "assets/evidence/incident_brief.md").content;
    assert.ok(brief.includes("## Unverified Competing Hypotheses"));
    assert.ok(brief.includes("risk_register.csv"));
    const reviewFiles = ["incident_brief.md", "advanced_risk_register.csv", "risk_register.csv", "analyst_questions.md", "analyst_working_notes.md", "audit_notes.md", "hardening_checklist.md"]
      .map((name) => c.assets.find((a) => a.file_name === name)).filter(Boolean);
    for (const hypothesis of qa.linuxReviewHypotheses) {
      const occurrences = reviewFiles.reduce((count, review) => count + review.content.split(hypothesis).length - 1, 0);
      assert.equal(occurrences, 1, `hypothesis appears once across learner review documents: ${hypothesis}`);
    }
    for (const command of c.simulation.commands.filter((command) => command.kind !== "background")) {
      for (const review of reviewFiles) assert.ok(!review.content.includes(command.renderedCommand), `${review.file_path} leaks ${command.renderedCommand}`);
    }
  });
  check("difficulty", () => {
    assert.equal(c.simulation.difficultyDiagnostics.issues.length, 0, JSON.stringify(c.simulation.difficultyDiagnostics));
    assert.ok(lab.tasks.length >= 4 && lab.tasks.every((t) => t.deliverable && t.evidence.length));
  });
  report.matrix.push(row);
  console.log(`${row.family}/${season}: ${Object.entries(row.invariants).map(([k,v]) => `${k}=${v === "PASS" ? v : "FAIL"}`).join(" ")}`);
  const failed = Object.entries(row.invariants).filter(([,v]) => v !== "PASS");
  assert.equal(failed.length, 0, JSON.stringify(failed));
  return lab;
}

function exactTask(c, intent, difficulty) {
  const lab = narrative(c, difficulty);
  const index = c.simulation.canonicalTasks.findIndex((t) => t.intent === intent);
  assert.ok(index >= 0, `${intent} generated`);
  const task = lab.tasks[index];
  const sources = task.evidence.map((p) => asset(c, p));
  const proof = { family: c.investigation.incidentFamily, difficulty, task, excerpts: sources.map((a) => ({ path: a.file_path, lines: a.content.split(/\r?\n/).filter((l) => /\/srv\/shared|docker run|Approval|Requested|systemctl|cron|sudo|COMMAND|platform-sync/i.test(l)).slice(0, 8) })) };
  if (intent === "change_control") {
    assert.ok(task.evidence.some((p) => /change_request/.test(p)));
    assert.ok(task.evidence.some((p) => /logs\/|process_execution_history/.test(p)), "change correlation includes observed activity");
  } else {
    assert.ok(sources.some((a) => a.content.includes("/srv/shared:/mnt/shared:ro")), "task-local mount relationship");
  }
  report.exactTasks.push(proof);
  return lab;
}

function mutation(name, fn, pattern) { assert.throws(fn, pattern); report.mutations.push(name); console.log(`PASS mutation ${name}`); }

try {
  const familyFilter = process.argv.find((a) => a.startsWith("--family="))?.split("=")[1];
  for (const family of familyFilter ? [familyFilter] : FAMILIES) {
    for (const season of ["BST", "GMT"]) runCase(build(family, "Advanced", season), season);
  }
  const docker = build("docker_compromise");
  exactTask(docker, "file_permissions", "Advanced");
  exactTask(build("cron_persistence", "Intermediate"), "change_control", "Intermediate");

  const serviceAccount = build("service_account_misuse", "Beginner");
  const serviceLab = narrative(serviceAccount, "Beginner");
  const fileTaskIndex = serviceAccount.simulation.canonicalTasks.findIndex((task) => task.intent === "file_permissions");
  const staticActivity = proveLinuxStudentTaskSolvability({
    simulation: serviceAccount.simulation,
    task: serviceAccount.simulation.canonicalTasks[fileTaskIndex],
    taskIndex: fileTaskIndex,
    studentTask: {
      ...serviceLab.tasks[fileTaskIndex],
      evidence: ["assets/reports/permissions_report.txt"],
      deliverable: "Describe the observed account activity and who created the archive.",
    },
    finalAssets: serviceAccount.assets,
  });
  assert.ok(staticActivity.issues.some((issue) => issue.requirement === "historical activity evidence"), JSON.stringify(staticActivity.issues));
  report.mutations.push("static metadata cannot prove historical activity or creation");

  const changeCase = build("cron_persistence", "Intermediate");
  const changeTask = changeCase.simulation.canonicalTasks.find((task) => task.intent === "change_control");
  assert.ok(changeTask, "change-control task generated");
  assert.ok(changeTask.requirements.some((requirement) => requirement.capability === "change_control"));
  assert.ok(changeTask.requirements.some((requirement) => requirement.capability === "command_execution"));
  assert.ok(changeTask.selectedEvidenceAssetIds.some((id) => {
    const evidence = changeCase.simulation.evidenceRegistry.find((item) => item.id === id);
    return evidence?.stateType === "historical_reconstruction" || ["timestamped_log", "journal", "package_history"].includes(evidence?.assetType);
  }));
  report.mutations.push("change correlation contains approval and runtime sides");

  const cron = build("cron_persistence");
  const definingExecution = cron.simulation.scheduledExecutions.find((execution) =>
    cron.simulation.cronDefinitions.some((definition) => definition.id === execution.definitionId && definition.purpose === "incident")
  );
  assert.ok(definingExecution && definingExecution.occurredAt >= cron.simulation.collection.windowStart && definingExecution.occurredAt <= cron.simulation.collection.windowEnd);
  const outsideWindow = structuredClone(cron.simulation);
  outsideWindow.scheduledExecutions.find((execution) => execution.id === definingExecution.id).occurredAt = `${cron.simulation.collection.windowStart.slice(0, 11)}00:10:10`;
  mutation("central cron event outside investigation window", () => qa.validateLinuxPatch1Integrity(outsideWindow, cron.assets), /central incident event is outside/);
  const missingRecurrence = structuredClone(cron.simulation);
  missingRecurrence.cronDefinitions.find((definition) => definition.purpose === "incident").schedule = "*/5 * * * *";
  mutation("missing recurring in-window occurrence", () => qa.validateLinuxPatch1Integrity(missingRecurrence, cron.assets), /lacks expected in-window occurrence/);

  const packageCase = cron;
  const aptDaily = packageCase.simulation.files.find((file) => file.path === "/usr/lib/apt/apt.systemd.daily");
  assert.ok(aptDaily, "apt.systemd.daily metadata rendered");
  aptDaily.mode = 0o640;
  mutation("background package program without execute bits", () => qa.validateLinuxPatch1Integrity(packageCase.simulation, packageCase.assets), /executed binary .* lacks plausible executable metadata/);

  const ownedOutputCase = build("service_account_misuse", "Beginner");
  const createdOutput = ownedOutputCase.simulation.files.find((file) => file.createdAt && file.contentRole === "incident_output");
  assert.ok(createdOutput, "process-created incident output modeled");
  createdOutput.ownerUid += 1;
  mutation("process-created output ownership contradicts effective uid", () => qa.validateLinuxPatch1Integrity(ownedOutputCase.simulation, ownedOutputCase.assets), /ownership does not follow effective identity/);

  const noServiceCapture = structuredClone(cron.assets);
  const serviceInventory = noServiceCapture.find((item) => item.file_path === "assets/reports/service_inventory.txt");
  serviceInventory.content = serviceInventory.content.replaceAll(cron.simulation.collection.collectedAt, "missing-capture").replaceAll("collection_snapshot", "missing-state-type");
  mutation("service state without capture authority", () => qa.validateLinuxPatch1Integrity(cron.simulation, noServiceCapture), /service-state evidence lacks incident-relative capture authority/);
  const badListener = structuredClone(docker.simulation);
  const listener = badListener.openFileDescriptors.find((d) => d.descriptorType === "listening_socket");
  badListener.openFileDescriptors.push({ ...listener, id: "injected-listener", targetId: "independent-socket", fd: "99u" });
  mutation("independent duplicate listener", () => sim.validateCanonicalOpenFileDescriptors(badListener), /listener collision/);
  for (const family of ["misconfigured_sudoers", "ssh_bruteforce", "docker_compromise"]) {
    const c = build(family);
    const evidenced = new Set(c.simulation.executions.filter((e) => e.outcome === "success" && ["interactive_command", "privilege_escalation", "package"].includes(e.reason)).map((e) => e.id));
    const binary = c.simulation.files.find((f) => c.simulation.processes.some((p) => evidenced.has(p.executionId) && p.executable === f.path));
    binary.mode = 0o640;
    mutation(`non-executable binary ${family}`, () => sim.validateCanonicalExecutionLifecycle(c.simulation), /executable metadata/);
  }
  const missingZone = structuredClone(docker.assets);
  missingZone[0].content = "missing authority";
  mutation("missing source timezone", () => qa.validateLinuxLearnerPackBoundaries(missingZone), /time authority/);
  const leaking = structuredClone(docker.assets);
  leaking.find((a) => a.file_name === "audit_notes.md").content += "Container process accessed files outside expected scope.";
  mutation("unsupported mounted-file access conclusion", () => qa.validateLinuxLearnerPackBoundaries(leaking), /unsupported/);
  for (const [family, role] of [["misconfigured_sudoers", /administrative jump host/i], ["ssh_bruteforce", /VPN gateway/i], ["docker_compromise", /Kubernetes worker/i]]) {
    const c = build(family, "Advanced", "BST", role);
    const lab = narrative(c);
    const dir = path.join(destination, family);
    fs.mkdirSync(dir, { recursive: true });
    for (const a of c.assets) {
      const target = path.join(dir, a.file_path);
      assert.ok(target.startsWith(dir + path.sep));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, a.content);
    }
    fs.writeFileSync(path.join(dir, "learner-lab.json"), JSON.stringify(lab, null, 2));
    report.representatives.push({ family, hostRole: c.investigation.hostRole, seed: c.qaInput.seed, directory: dir, tasks: lab.tasks, utcWindow: c.simulation.collection, localWindow: asset(c, "assets/evidence/incident_brief.md").content.split("Time authority:").pop().trim() });
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Report: ${path.join(destination, "report.json")}`);
}
