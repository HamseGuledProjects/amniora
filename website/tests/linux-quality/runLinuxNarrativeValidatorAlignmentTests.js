#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-narrative-alignment-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function responseWithTasks(count) {
  const tasks = Array.from({ length: count }, (_, index) => ({
    phase: `Task ${index + 1}`,
    title: `Trace evidence object ${index + 1} using supplied artifacts.`,
    evidence: ["assets/logs/audit.log"],
    deliverable: "A short evidence note with source references.",
  }));
  return {
    status: "completed",
    output_text: JSON.stringify({
      title: "Linux investigation",
      topic: "Linux DFIR",
      difficulty: "Advanced",
      estimated_time: "60 mins",
      objective: "Review the supplied Linux evidence.",
      scenario: "A SOC analyst is reviewing supplied Linux artifacts.",
      tasks,
      hints: ["Use supplied evidence only.", "Compare independent sources.", "Keep conclusions qualified."],
      outcomes: ["Correlate evidence.", "Explain uncertainty.", "Prepare a defensible summary."],
    }),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildFamily(buildLinuxAssetCandidate, family) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        category: "Linux",
        difficulty: "Advanced",
        duration: "60 mins",
        title: "CyberLab Asset Pack",
        seed: `narrative-validator-alignment:${family}:${attempt}`,
        generationTime: "2026-07-31T10:00:00.000Z",
      }, { incidentFamily: family });
      if (candidate.simulation.investigation.incidentFamily === family) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to generate family ${family}`);
}

function narrativeForTasks(tasks, taskOverrides = {}) {
  return {
    title: "Container runtime evidence review",
    objective: "Use supplied evidence to review host activity.",
    scenario: "The SOC is reviewing captured Linux artifacts for a host investigation.",
    tasks: tasks.map((task, index) => ({
      phase: taskOverrides.phase || `Task ${index + 1}`,
      title: task.title,
      evidence: task.evidence,
      deliverable: task.deliverable || "Produce a concise evidence-backed analyst note.",
    })),
    hints: ["Use supplied artifacts only.", "Correlate independent evidence.", "Keep conclusions qualified."],
    outcomes: ["Correlate Linux evidence.", "Explain uncertainty.", "Document supportable findings."],
  };
}

function generatedTextIssues(checkLinuxInvestigationQuality, lab) {
  return checkLinuxInvestigationQuality({
    assets: [
      { file_name: "audit.log", file_path: "assets/logs/audit.log", file_type: "log", content: "2026-07-06 01:00:00 audit docker run\n" },
      { file_name: "process_execution_history.txt", file_path: "assets/runtime/process_execution_history.txt", file_type: "txt", content: "evidence_type,state_type,timestamp,user,pid,ppid,command\nhistorical_process_correlation,historical_reconstruction,2026-07-06 01:00:00,root,2204,2203,/usr/bin/docker run\n" },
      { file_name: "file_access_history.csv", file_path: "assets/runtime/file_access_history.csv", file_type: "csv", content: "evidence_type,state_type,timestamp,pid,user,command,access,path,state,source,confidence\nhistorical_file_access,historical_reconstruction,2026-07-06 01:00:01,2204,root,/usr/bin/docker run,access,/srv/app,historical,audit.log,high\n" },
      { file_name: "listening_ports.txt", file_path: "assets/network/listening_ports.txt", file_type: "txt", content: "tcp 0 0 0.0.0.0:8080 LISTEN docker-proxy\n" },
      { file_name: "routing_table.txt", file_path: "assets/network/routing_table.txt", file_type: "txt", content: "default via 10.0.0.1 dev eth0\n" },
      { file_name: "ufw_status.txt", file_path: "assets/network/ufw_status.txt", file_type: "txt", content: "Status: active\n" },
      { file_name: "advanced_risk_register.csv", file_path: "assets/evidence/advanced_risk_register.csv", file_type: "csv", content: "risk_id,description,severity,evidence\nR1,container path exposure,high,audit.log\n" },
      { file_name: "security_policy.md", file_path: "assets/docs/security_policy.md", file_type: "md", content: "Container risks require evidence-backed review.\n" },
      { file_name: "analyst_questions.md", file_path: "assets/evidence/analyst_questions.md", file_type: "md", content: "Which paths and exposure conditions are evidenced?\n" },
      { file_name: "journal_systemd.txt", file_path: "assets/journal/journal_systemd.txt", file_type: "txt", content: "2026-07-06 01:02:00 docker.service restart activity captured\n" },
      { file_name: "permissions_report.txt", file_path: "assets/reports/permissions_report.txt", file_type: "txt", content: "/srv/app -rwxr-x--- root docker\n/etc/docker/daemon.json -rw-r----- root root\n/var/lib/docker -rwx--x--x root root\n" },
      { file_name: "open_files.txt", file_path: "assets/runtime/open_files.txt", file_type: "txt", content: "# evidence_type=live_open_file_snapshot state_type=collection_snapshot\nCOMMAND PID USER FILE\ndockerd 812 root /var/lib/docker\n" },
    ],
    lab,
  }).issues.filter((issue) => issue.category === "generated_text");
}

function main() {
  const out = compileIfNeeded();
  const { parseGeneratedLabResponse } = require(`${out}/linux/narrativeResponse.js`);
  const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
  const { checkLinuxInvestigationQuality } = require(`${out}/linux/qualityChecker.js`);

  for (const count of [5, 6, 7, 8]) {
    const parsed = parseGeneratedLabResponse(responseWithTasks(count));
    assert(parsed.ok, `${count} tasks should parse: ${parsed.details}`);
  }
  for (const count of [4, 9]) {
    const parsed = parseGeneratedLabResponse(responseWithTasks(count));
    assert(!parsed.ok && parsed.details.includes("tasks must contain 5 to 8 items"), `${count} tasks should fail with 5 to 8 message`);
  }
  const exact = parseGeneratedLabResponse(responseWithTasks(6), { expectedTaskCount: 7 });
  assert(!exact.ok && exact.details === "Narrative returned 6 tasks; canonical blueprint requires 7.", "exact count mismatch should be precise");

  const expectedCounts = {
    identity_access_review: 7,
    service_config_review: 7,
    process_file_review: 6,
    container_runtime_review: 6,
    package_drift_review: 6,
    persistence_startup_review: 7,
  };
  const families = [
    "ssh_bruteforce",
    "ssh_key_compromise",
    "misconfigured_sudoers",
    "service_account_misuse",
    "reverse_shell",
    "data_staging",
    "docker_compromise",
    "unauthorized_package_install",
    "cron_persistence",
    "systemd_persistence",
    "log_tampering",
  ];
  for (const family of families) {
    const candidate = buildFamily(buildLinuxAssetCandidate, family);
    const tasks = candidate.simulation.canonicalTasks;
    const blueprint = tasks[0].blueprintId;
    assert(tasks.length === expectedCounts[blueprint], `${family} ${blueprint} expected ${expectedCounts[blueprint]} tasks, got ${tasks.length}`);
  }

  const offlineTasks = [
    {
      title: "Trace the docker run command to its executor, child process, and host path touches.",
      evidence: ["assets/logs/audit.log", "assets/runtime/process_execution_history.txt", "assets/runtime/file_access_history.csv"],
      deliverable: "Correlation table covering executor, child process, and touched host paths.",
    },
    {
      title: "Check viable network exposure paths relevant to the container activity on the host.",
      evidence: ["assets/network/listening_ports.txt", "assets/network/routing_table.txt", "assets/network/ufw_status.txt"],
      deliverable: "Gap assessment summarising captured exposure paths.",
    },
    {
      title: "Prioritize container-related risks using policy and risk registers against the observed activity.",
      evidence: ["assets/evidence/advanced_risk_register.csv", "assets/docs/security_policy.md", "assets/evidence/analyst_questions.md"],
      deliverable: "Risk summary with evidence-backed priorities.",
    },
    {
      title: "Inspect the captured service journal for restart activity.",
      evidence: ["assets/journal/journal_systemd.txt"],
      deliverable: "Evidence note listing relevant captured journal entries.",
    },
    {
      title: "Map process lineage from the historical process evidence.",
      evidence: ["assets/runtime/process_execution_history.txt"],
      deliverable: "Process lineage diagram from supplied evidence.",
    },
    {
      title: "Attribute the observed activity to the rendered account context.",
      evidence: ["assets/logs/audit.log"],
      deliverable: "Account attribution notes with confidence.",
    },
    {
      title: "Reconcile service evidence with the captured configuration snapshot.",
      evidence: ["assets/journal/journal_systemd.txt", "assets/reports/permissions_report.txt"],
      deliverable: "Policy mapping of observed service evidence.",
    },
  ];
  const offlineIssues = generatedTextIssues(checkLinuxInvestigationQuality, narrativeForTasks(offlineTasks));
  assert(!offlineIssues.some((issue) => /live-system access|lacks a clear investigative action/i.test(issue.description)), `offline tasks should not be blocked: ${offlineIssues.map((issue) => issue.description).join(" | ")}`);

  const liveTasks = [
    "SSH into the host and run ps aux.",
    "Restart docker.service and confirm recovery.",
    "Run ss -lntp on the server.",
    "Capture fresh traffic from the interface.",
    "Delete the suspicious cron entry.",
  ].map((title) => ({ title, evidence: ["assets/logs/audit.log"], deliverable: "Document the live action result." }));
  const liveIssues = generatedTextIssues(checkLinuxInvestigationQuality, narrativeForTasks(liveTasks));
  assert(liveIssues.filter((issue) => /requires live-system access/i.test(issue.description)).length >= 5, "genuine live actions should be blocked");
  assert(liveIssues.some((issue) => issue.description.startsWith("Task 1 ")), "Task 1 live-access diagnostic should identify Task 1");

  const vagueTasks = ["Docker.", "Network.", "Look into this.", "Review evidence.", "Investigate the incident."].map((title) => ({
    title,
    evidence: ["assets/logs/audit.log"],
    deliverable: "Notes.",
  }));
  const vagueIssues = generatedTextIssues(checkLinuxInvestigationQuality, narrativeForTasks(vagueTasks));
  assert(vagueIssues.filter((issue) => /lacks a clear investigative action/i.test(issue.description)).length >= 5, "vague tasks should be rejected");

  const classIssues = generatedTextIssues(checkLinuxInvestigationQuality, narrativeForTasks([
    {
      title: "Review file ownership and access history from captured metadata.",
      evidence: ["assets/reports/permissions_report.txt", "assets/runtime/file_access_history.csv", "assets/runtime/open_files.txt"],
      deliverable: "Evidence notes covering file metadata and historical access.",
    },
    {
      title: "Trace command lineage from captured process history.",
      evidence: ["assets/runtime/process_execution_history.txt"],
      deliverable: "Correlation table from process history.",
    },
    ...offlineTasks.slice(0, 3),
  ]));
  assert(!classIssues.some((issue) => /live-system access|lacks a clear investigative action/i.test(issue.description)), "metadata/process-history evidence classes should support offline tasks");

  console.log(JSON.stringify({ passed: true, parserCounts: [5, 6, 7, 8], rejectedCounts: [4, 9], families: families.length }, null, 2));
}

main();
