// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled lib/lab-assets output directory.");

const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
const {
  checkLinuxInvestigationQuality,
  checkLinuxFinalProductionQuality,
} = require(`${out}/linux/qualityChecker.js`);

console.info = () => {};

function cloneAssets(assets) {
  return assets.map((asset) => ({ ...asset }));
}

function asset(assets, path) {
  const found = assets.find((item) => item.file_path === path);
  if (!found) throw new Error(`missing fixture asset ${path}`);
  return found;
}

function replaceInAsset(assets, path, pattern, replacement) {
  const target = asset(assets, path);
  const next = target.content.replace(pattern, replacement);
  if (next === target.content) throw new Error(`mutation did not modify ${path}: ${pattern}`);
  target.content = next;
}

function removeLine(assets, path, pattern) {
  const target = asset(assets, path);
  const rows = target.content.split(/\r?\n/);
  const next = rows.filter((row) => !pattern.test(row)).join("\n");
  if (next === target.content) throw new Error(`mutation did not remove ${path}: ${pattern}`);
  target.content = next;
}

function firstSudoUser(candidate) {
  const sudo = candidate.assets.find((item) => item.file_path === "assets/logs/sudo.log");
  return sudo?.content.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+([a-z0-9._-]+)\s+:/im)?.[1] || candidate.investigation.primaryUser;
}

function addSeconds(timestamp, seconds) {
  const date = new Date(`${timestamp.replace(" ", "T")}Z`);
  date.setUTCSeconds(date.getUTCSeconds() + seconds);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function replaceFirstLine(assets, path, predicate, transform) {
  const target = asset(assets, path);
  const rows = target.content.split(/\r?\n/);
  const index = rows.findIndex(predicate);
  if (index === -1) throw new Error(`mutation target row missing in ${path}`);
  const original = rows[index];
  rows[index] = transform(rows[index]);
  if (rows[index] === original) throw new Error(`mutation did not modify target row in ${path}`);
  target.content = rows.join("\n");
}

function findAsset(assets, pattern) {
  const found = assets.find((item) => pattern.test(item.file_path));
  if (!found) throw new Error(`missing fixture asset matching ${pattern}`);
  return found;
}

const CRON_DEFINITION_LINE = /^\s*(?!#)(?:\S+\s+){5}\S+.*(?:\bcron:[a-z0-9:_-]+\b)?/i;

function isCronDefinitionLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || /^[A-Z_]+=/.test(trimmed)) return false;
  const fields = trimmed.split(/\s+/);
  if (fields.length < 6) return false;
  return fields.slice(0, 5).every((field) => /^[\d*/,\-?A-Za-z]+$/.test(field));
}

function hasRootCronScheduleDefinition(candidate) {
  const rootCrontab = candidate.assets.find((item) => item.file_path === "assets/scheduled/root_crontab.txt");
  return Boolean(rootCrontab && rootCrontab.content.split(/\r?\n/).some((line) =>
    isCronDefinitionLine(line)
  ));
}

function mutatePrimaryAuditPath(assets, transform) {
  const audit = asset(assets, "assets/logs/audit.log");
  const match = audit.content.match(/type=PATH .*?name="([^"]+)"/);
  if (!match) throw new Error("audit PATH row missing");
  const path = match[1];
  transform(path);
}

function csvEscapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mutateTimelineObservedExactSource(assets) {
  const target = asset(assets, "assets/evidence/timeline.csv");
  const rows = target.content.trim().split(/\r?\n/);
  const index = rows.findIndex((line, rowIndex) => rowIndex > 0 && /,Observed,/.test(line) && /sudo\.log|auth\.log|audit\.log/.test(line));
  if (index === -1) throw new Error("observed dynamic timeline row missing");
  const cols = rows[index].split(",");
  cols[3] = "process_snapshot.txt";
  cols[7] = "process_snapshot.txt";
  rows[index] = cols.join(",");
  target.content = `${rows.join("\n")}\n`;
}

function validLab(candidate, overrides = {}) {
  const context = candidate.investigation;
  const paths = candidate.assets.map((item) => item.file_path);
  const pick = (...wanted) => wanted.filter((item) => paths.includes(item)).slice(0, 3);
  return {
    title: `Linux evidence review for ${context.hostname}`,
    subtitle: "Linux investigation using timeline and host evidence",
    objective: `Reconstruct activity on ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} for ${context.company}.`,
    scenario: `${context.company} SOC is reviewing case ${context.incidentId} for ${context.hostname}, a ${context.hostRole}, during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}. The evidence covers ${context.primaryUser}, ${context.affectedService}, ${context.ticketId}, and ${context.changeId}.`,
    tasks: [
      {
        phase: "Scope",
        title: "Reconstruct the investigation timeline",
        evidence: pick("assets/evidence/timeline.csv", "assets/logs/sudo.log", "assets/logs/syslog"),
        deliverable: "Prepare a timeline table with timestamp, source, and confidence notes.",
      },
      {
        phase: "Identity",
        title: "Correlate account and authentication evidence",
        evidence: pick("assets/logs/auth.log", "assets/csv/users.csv", "assets/accounts/passwd.sample", "assets/configs/linux_config_pack.txt"),
        deliverable: "Document account context and unresolved evidence gaps.",
      },
      {
        phase: "Policy",
        title: "Compare sudo policy and observed command evidence",
        evidence: pick("assets/configs/linux_config_pack.txt", "assets/csv/groups.csv", "assets/accounts/group.sample", "assets/logs/sudo.log"),
        deliverable: "Summarize whether policy evidence explains the observed command path.",
      },
      {
        phase: "Service",
        title: "Map change documentation to service evidence",
        evidence: pick("assets/docs/change_request.md", "assets/reports/service_inventory.txt", "assets/journal/journal_systemd.txt"),
        deliverable: "Describe service-state evidence and any assumptions.",
      },
      {
        phase: "Closure",
        title: "Evaluate file and permission evidence",
        evidence: pick("assets/reports/permissions_report.txt", "assets/logs/audit.log", "assets/evidence/audit_notes.md"),
        deliverable: "List evidence-backed risks and follow-up validation steps.",
      },
    ],
    outcomes: [
      `Correlate ${context.hostname} Linux evidence across logs, runtime snapshots, and documentation.`,
      `Separate observed facts for ${context.ticketId} from hypotheses that still require validation.`,
      `Prepare a defensible SOC handoff for ${context.hostRole} evidence reviewed during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}.`,
    ],
    category: "Linux",
    difficulty: "Advanced",
    duration: "30 mins",
    ...overrides,
  };
}

function checkAssetMutation(candidate, mutate, expectedCategory, expectedSeverity) {
  const assets = cloneAssets(candidate.assets);
  mutate(assets, candidate);
  const result = checkLinuxInvestigationQuality({ context: candidate.investigation, assets, simulation: candidate.simulation });
  if (result.passed) throw new Error("broken mutation unexpectedly passed");
  const matched = result.issues.some((issue) =>
    issue.category === expectedCategory &&
    (expectedSeverity ? issue.severity === expectedSeverity : true)
  );
  if (!matched) {
    throw new Error(`expected ${expectedSeverity || "*"} ${expectedCategory}, got ${result.issues.map((issue) => `${issue.severity}/${issue.category}:${issue.description}`).join(" | ")}`);
  }
}

function checkFinalMutation(candidate, mutate, expectedCategory, expectedSeverity) {
  const lab = validLab(candidate);
  mutate(lab, candidate);
  const result = checkLinuxFinalProductionQuality({
    context: candidate.investigation,
    assets: candidate.assets,
    lab,
  });
  if (result.passed) throw new Error("broken final mutation unexpectedly passed");
  const matched = result.issues.some((issue) =>
    issue.category === expectedCategory &&
    (expectedSeverity ? issue.severity === expectedSeverity : true)
  );
  if (!matched) {
    throw new Error(`expected ${expectedSeverity || "*"} ${expectedCategory}, got ${result.issues.map((issue) => `${issue.severity}/${issue.category}:${issue.description}`).join(" | ")}`);
  }
}

const assetMutations = [
  ["change incident actor in sudo.log", "sudo_audit", "critical", (assets, c) => replaceInAsset(assets, "assets/logs/sudo.log", new RegExp(`\\b${firstSudoUser(c).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), "unknown.actor")],
  ["change actor UID in audit.log", "identity", "critical", (assets) => replaceInAsset(assets, "assets/logs/audit.log", /auid=\d+/, "auid=9999")],
  ["remove effective sudo rule", "sudo_audit", "critical", (assets) => {
    for (const target of assets.filter((item) => /linux_config_pack|sudoers/i.test(item.file_path) || /NOPASSWD/i.test(item.content))) {
      target.content = target.content.split(/\r?\n/).filter((line) => !/\bALL\s*=\s*\([^)]*\)|NOPASSWD/i.test(line)).join("\n");
    }
  }, (candidate) => /COMMAND=/.test(asset(candidate.assets, "assets/logs/sudo.log").content)],
  ["change group membership", "identity", "critical", (assets) => replaceInAsset(assets, "assets/csv/groups.csv", /^sudo,/m, "nosudo,")],
  ["change service-account shell", "identity", "critical", (assets) => replaceInAsset(assets, "assets/accounts/passwd.sample", /\/usr\/sbin\/nologin|\/bin\/false/, "/bin/bash")],
  ["move command after SSH session close", "timeline", "critical", (assets) => replaceInAsset(assets, "assets/logs/sudo.log", /(20\d\d-\d\d-\d\d )\d\d:\d\d:\d\d/, "$123:59:59")],
  ["move event after collection", "timeline", "critical", (assets, c) => replaceInAsset(assets, "assets/evidence/timeline.csv", /20\d\d-\d\d-\d\d \d\d:\d\d:\d\d/, addSeconds(c.simulation.collection.collectedAt, 1))],
  ["reverse parent child process time", "semantic", "critical", (assets) => replaceInAsset(assets, "assets/runtime/process_snapshot.txt", /\b2201\b/, "2204")],
  ["move service effect before cause", "service_model", "critical", (assets) => replaceInAsset(assets, "assets/logs/audit.log", /(type=SERVICE_\w+ msg=audit\(20\d\d-\d\d-\d\d )\d\d:\d\d:\d\d/, "$100:00:01"), "systemd_persistence"],
  ["reorder timeline rows", "timeline", "critical", (assets) => {
    const target = asset(assets, "assets/evidence/timeline.csv");
    const rows = target.content.trim().split(/\r?\n/);
    target.content = [rows[0], ...rows.slice(1).reverse()].join("\n") + "\n";
  }],
  ["reuse PID for another executable", "process_open_files", "critical", (assets) => replaceInAsset(assets, "assets/runtime/process_snapshot.txt", /\b812\b/, "644")],
  ["remove PPID", "process_open_files", "critical", (assets) => replaceFirstLine(assets, "assets/runtime/process_snapshot.txt", (line) => /^\S+\s+\d+\s+\d+\s+/.test(line) && !/\s(?:0|1)\s+/.test(line), (line) => line.replace(/^(\S+\s+\d+\s+)\d+(\s+)/, "$1missing$2"))],
  ["remove command process from history", "process_open_files", "high", (assets) => removeLine(assets, "assets/runtime/process_execution_history.txt", /cat |systemctl |apt |ssh |tar |chmod |chown |docker |truncate |logrotate |journalctl |rsync /)],
  ["change process effective UID", "process_open_files", "high", (assets) => replaceFirstLine(assets, "assets/runtime/open_files.txt", (line) => /^\S+\s+\d+\s+\S+\s+/.test(line) && !/^COMMAND/.test(line), (line) => line.replace(/^(\S+\s+\d+\s+)\S+/, "$1nobody"))],
  ["change file mode in audit only", "permissions", "critical", (assets) => replaceInAsset(assets, "assets/logs/audit.log", /mode=0100\d+/, "mode=0100777")],
  ["change owner in permissions only", "permissions", "critical", (assets) => mutatePrimaryAuditPath(assets, (path) => replaceFirstLine(assets, "assets/reports/permissions_report.txt", (line) => line.startsWith(`${path} `), (line) => line.replace(/\s+\S+\s+\S+$/, " ghostowner ghostgroup")))],
  ["remove canonical file", "permissions", "high", (assets) => mutatePrimaryAuditPath(assets, (path) => removeLine(assets, "assets/reports/permissions_report.txt", new RegExp(`^${csvEscapeRegex(path)}\\s`)))],
  ["point historical file access to unknown PID", "process_open_files", "high", (assets) => replaceInAsset(assets, "assets/runtime/file_access_history.csv", /,\d{4},/, ",9999,")],
  ["make sudoers file executable", "sudo_audit", "critical", (assets) => replaceFirstLine(assets, "assets/reports/permissions_report.txt", (line) => /\/etc\/sudoers/.test(line), (line) => line.replace(/-r[-w]?-r-----|-r--r-----|-rw-r-----/, "-rwxr-xr-x"))],
  ["convert reload to start in one artifact", "service_model", "critical", (assets) => replaceFirstLine(assets, "assets/journal/journal_systemd.txt", (line) => /\b(?:Reloaded|Started|Restarted|Stopped)\s+[a-z0-9_.@-]+\.service/i.test(line), (line) => line.replace(/\b(?:Reloaded|Started|Restarted|Stopped)\b/, "Stopped")), "systemd_persistence"],
  ["remove service cause", "service_model", "critical", (assets) => replaceInAsset(assets, "assets/logs/audit.log", / cause=[^ \n]+/, ""), "systemd_persistence"],
  ["change final inventory state", "service_model", "critical", (assets) => replaceFirstLine(assets, "assets/reports/service_inventory.txt", (line) => /\.service,/.test(line) && !/^service,/.test(line), (line) => line.replace(/,(?:running|active|inactive),/, ",failed,"))],
  ["assign wrong main PID", "service_model", "critical", (assets) => replaceFirstLine(assets, "assets/reports/service_inventory.txt", (line) => /\.service,/.test(line) && !/^service,/.test(line), (line) => line.replace(/,(?:running|active|inactive),/, ",failed,"))],
  ["move packaged unit into local unit path", "service_model", "critical", (assets) => replaceInAsset(assets, "assets/reports/service_inventory.txt", /\/lib\/systemd\/system\//, "/etc/systemd/system/")],
  ["remove cron definition", "background_noise", "high", (assets) => replaceFirstLine(assets, "assets/scheduled/root_crontab.txt", isCronDefinitionLine, () => ""), hasRootCronScheduleDefinition],
  ["alter cron schedule", "background_noise", "critical", (assets) => replaceFirstLine(assets, "assets/scheduled/root_crontab.txt", isCronDefinitionLine, (line) => line.replace(/^\s*\S+/, "59")), hasRootCronScheduleDefinition],
  ["assign incompatible run-as account", "background_noise", "critical", (assets) => replaceInAsset(assets, "assets/logs/cron.log", /\([a-z0-9._-]+\)\s+CMD/, "(ghostuser) CMD")],
  ["conflate manual APT with apt-daily", "package_management", "critical", (assets) => replaceInAsset(assets, "assets/logs/apt_history.log", /Commandline: .+/, "Commandline: /usr/lib/apt/apt.systemd.daily"), "unauthorized_package_install"],
  ["remove task evidence asset", "asset_consistency", "critical", (assets) => { const index = assets.findIndex((item) => item.file_path === "assets/logs/auth.log"); if (index === -1) throw new Error("auth log missing"); assets.splice(index, 1); }],
  ["replace exact timeline source with static source", "timeline", "high", (assets) => mutateTimelineObservedExactSource(assets)],
  ["change change ID in one document", "documentation", "critical", (assets) => replaceInAsset(assets, "assets/docs/change_request.md", /CHG-\d+/, "CHG-0000")],
  ["insert simulator wording", "generated_text", "high", (assets) => { asset(assets, "assets/reports/service_inventory.txt").content += "\nGenerated lab simulator metadata.\n"; }],
];

const finalMutations = [
  ["add unsupported task", "generated_text", "high", (lab) => { lab.tasks[0].title = "Prove the attacker and root cause from the evidence"; }],
  ["mutate final evidence list after validation", "asset_consistency", "critical", (lab) => { lab.tasks[0].evidence = ["assets/logs/missing.log"]; }],
  ["add spoiler conclusion", "generated_text", "high", (lab) => { lab.tasks[1].title = "Prove the attacker and root cause from the evidence"; }],
  ["truncate subtitle", "generated_text", "high", (lab) => { lab.subtitle = "Linux privilege boundary reconciliation on a SSH-"; }],
  ["insert malformed hint", "generated_text", "high", (lab) => { lab.hints = ["APT provenance requires both apt_history.log timing and repository context from linux_config_pack.txt. Reconcile it with package_inventory.txt before drawing conclusions to"]; }],
  ["change canonical host in scenario", "generated_text", "critical", (lab) => { lab.scenario = lab.scenario.replace(/for \S+,/, "for wrong-host-99,"); }],
];

function buildAdvancedCandidate(family, predicate) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate(
        {
          seed: `production-mutation:${family || "any"}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty: "Advanced",
          duration: "60 mins",
          title: "CyberLab Asset Pack",
        },
        family ? { incidentFamily: family } : {}
      );
      const quality = checkLinuxInvestigationQuality({
        context: candidate.investigation,
        assets: candidate.assets,
        workload: {
          requestedDifficulty: candidate.provenance.difficulty,
          requestedDurationMinutes: candidate.provenance.durationMinutes,
        },
      });
      if (
        candidate.assetQuality.passed &&
        quality.passed &&
        (!family || candidate.investigation.incidentFamily === family) &&
        (!predicate || predicate(candidate))
      ) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build valid Advanced candidate${family ? ` for ${family}` : ""}`);
}

let detected = 0;
let total = 0;
const failures = [];

for (const mutation of assetMutations) {
  total += 1;
  const candidate = buildAdvancedCandidate(typeof mutation[4] === "string" ? mutation[4] : undefined, typeof mutation[4] === "function" ? mutation[4] : mutation[5]);
  try {
    checkAssetMutation(candidate, mutation[3], mutation[1], mutation[2]);
    const original = checkLinuxInvestigationQuality({ context: candidate.investigation, assets: candidate.assets });
    if (!original.passed) throw new Error("original no longer passes");
    detected += 1;
    console.log(`PASS ${mutation[0]}`);
  } catch (error) {
    failures.push(`${mutation[0]}: ${error.message}`);
    console.log(`FAIL ${mutation[0]}: ${error.message}`);
  }
}

for (const mutation of finalMutations) {
  total += 1;
  const candidate = buildAdvancedCandidate(mutation[4]);
  try {
    checkFinalMutation(candidate, mutation[3], mutation[1], mutation[2]);
    const original = checkLinuxFinalProductionQuality({
      context: candidate.investigation,
      assets: candidate.assets,
      lab: validLab(candidate),
    });
    if (!original.passed) throw new Error("original final narrative no longer passes");
    detected += 1;
    console.log(`PASS ${mutation[0]}`);
  } catch (error) {
    failures.push(`${mutation[0]}: ${error.message}`);
    console.log(`FAIL ${mutation[0]}: ${error.message}`);
  }
}

console.log(JSON.stringify({ detected, total, mutationScore: detected / total, failures }, null, 2));
if (failures.length > 0 && process.argv.includes("--strict")) process.exit(1);
