#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const crypto = require("crypto");
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
  const build = path.join(os.tmpdir(), `amniora-linux-phase13d-${Date.now()}`);
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

function sha(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCandidate(buildLinuxAssetCandidate, family, difficulty) {
  let lastError;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        seed: `phase13d:${family}:${difficulty}:${attempt}`,
        generationTime: "2026-08-12T10:00:00.000Z",
        category: "Linux",
        difficulty,
        duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
        title: "Amniora Linux Phase 13D",
      }, { incidentFamily: family });
      if (candidate.assetQuality?.passed) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function assetByPath(assets, filePath) {
  return assets.find((asset) => asset.file_path === filePath);
}

function mutateAsset(assets, filePath, mutate) {
  const asset = assetByPath(assets, filePath);
  if (!asset) throw new Error(`missing ${filePath}`);
  asset.content = mutate(asset.content);
}

function modelTasks(contract) {
  return contract.taskContracts.map((task, index) => ({
    task_id: task.taskId,
    task_intent: task.intent,
    phase: `Task ${index + 1}`,
    title: `Model draft for ${task.intent.replace(/_/g, " ")}`,
    evidence: task.selectedEvidence.map((asset) => asset.path).slice(0, 3),
    deliverable: "The model supplied bounded wording; deterministic assembly owns required output.",
    claims: [{
      claim_class: "observed",
      text: task.allowedHistoricalFacts[0] || task.objective,
      supporting_evidence: task.selectedEvidence.map((asset) => asset.path).slice(0, 1),
      subjects: [],
      relationships: [],
      timestamps: [],
    }],
  }));
}

function assembledLab(modules, candidate, difficulty) {
  const contract = modules.buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
  const assembled = modules.buildLinuxAssembledNarrative({
    contract,
    context: candidate.investigation,
    difficulty,
    duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
    tasks: modelTasks(contract),
  });
  return modules.finalLinuxNarrativeFromAssembled({ lab: assembled });
}

function expectTemporalFail(name, code, candidate, modules, mutate) {
  const simulation = clone(candidate.simulation);
  const assets = clone(candidate.assets);
  mutate({ simulation, assets });
  const report = modules.validateLinuxTemporalDocumentAuthority({ simulation, assets });
  assert(name, !report.passed && report.issues.some((issue) => issue.code === code), JSON.stringify(report.issues));
}

function expectTemporalPass(name, candidate, modules, mutate) {
  const simulation = clone(candidate.simulation);
  const assets = clone(candidate.assets);
  mutate({ simulation, assets });
  // Positive fixtures represent an updated maintenance record, not a changed
  // canonical occurrence with an obsolete exported policy still attached.
  const policy = simulation.maintenanceActivities[0]?.recurringPolicyWindow;
  if (policy) for (const asset of assets) {
    asset.content = asset.content.replace(/^Recurring maintenance policy:\s*.+$/gm, `Recurring maintenance policy: ${policy}`);
  }
  const report = modules.validateLinuxTemporalDocumentAuthority({ simulation, assets });
  assert(name, report.passed, JSON.stringify(report.issues));
}

function claimApprovedChange(candidate, overrides = {}) {
  const activity = candidate.simulation.maintenanceActivities[0];
  return (content) => `${content}
Approval status: approved for observed activity
Approved change occurrence: ${overrides.windowStart || activity.windowStart} to ${overrides.windowEnd || activity.windowEnd}
Approved change scope: ${overrides.scope || `${candidate.investigation.affectedService} ${candidate.simulation.serviceTransitions[0]?.operation || "validation"}`}
`;
}

function exactActivityScope(candidate, simulation = candidate.simulation) {
  const activity = simulation.maintenanceActivities[0];
  const cron = simulation.cronDefinitions.find((definition) => activity.cronDefinitionIds.includes(definition.id));
  if (cron) return cron.sourcePath;
  const command = simulation.commands.find((item) => activity.commandIds.includes(item.id));
  if (command) return command.renderedCommand;
  const transition = simulation.serviceTransitions.find((item) => activity.serviceTransitionIds.includes(item.id));
  if (transition) {
    const service = simulation.services.find((item) => item.id === transition.serviceId);
    return `${service.unitName} ${transition.operation}`;
  }
  const transaction = simulation.packageTransactions.find((item) => activity.packageTransactionIds.includes(item.id));
  if (transaction) return `${transaction.action} ${transaction.packages.map((pkg) => pkg.name).join(" ")}`;
  return candidate.investigation.affectedService;
}

function approveActivity(simulation, patch = {}) {
  const activity = simulation.maintenanceActivities[0];
  Object.assign(activity, {
    approved: true,
    changeId: simulation.investigation.changeId,
    ticketId: simulation.investigation.ticketId,
    ...patch,
  });
}

function appendApprovalClaim(content, candidate, simulation, scope) {
  const activity = simulation.maintenanceActivities[0];
  return `${content}
Approval status: approved for observed activity
Approved change occurrence: ${activity.windowStart} to ${activity.windowEnd}
Approved change scope: ${scope}
`;
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxNarrativeContract } = require(path.join(out, "linux", "simulation.js"));
  const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const { validateLinuxTemporalDocumentAuthority, buildLinuxCanonicalTemporalModel } = require(path.join(out, "linux", "temporalAuthority.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const modules = { buildLinuxNarrativeContract, buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled, validateLinuxTemporalDocumentAuthority };

  const base = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", "Advanced");
  const baselineReport = validateLinuxTemporalDocumentAuthority({ simulation: base.simulation, assets: base.assets });
  assert("baseline temporal authority passes", baselineReport.passed, JSON.stringify(baselineReport.issues));

  expectTemporalPass("UTC policy and UTC occurrence accepted", base, modules, ({ simulation }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 UTC",
      timezone: "UTC",
      windowStart: "2026-07-08 06:00:00",
      windowEnd: "2026-07-08 07:00:00",
    });
  });
  expectTemporalPass("Europe/London summer BST occurrence accepted", base, modules, ({ simulation }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 Europe/London",
      timezone: "Europe/London",
      windowStart: "2026-07-08 06:00:00",
      windowEnd: "2026-07-08 07:00:00",
    });
  });
  expectTemporalPass("Europe/London winter GMT occurrence accepted", base, modules, ({ simulation }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 Europe/London",
      timezone: "Europe/London",
      windowStart: "2026-01-07 06:00:00",
      windowEnd: "2026-01-07 07:00:00",
    });
  });
  expectTemporalPass("UTC occurrence crossing midnight into policy-local weekday accepted", base, modules, ({ simulation }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 00:30-01:30 Europe/London",
      timezone: "UTC",
      windowStart: "2026-07-07 23:30:00",
      windowEnd: "2026-07-08 00:30:00",
    });
  });
  expectTemporalPass("DST boundary converted window accepted", base, modules, ({ simulation }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Sunday 00:30-02:30 Europe/London",
      timezone: "UTC",
      windowStart: "2026-03-29 00:30:00",
      windowEnd: "2026-03-29 01:30:00",
    });
  });
  expectTemporalFail("UTC weekday differing from policy-local weekday rejects raw weekday comparison", "LINUX_TEMPORAL_MAINTENANCE_WEEKDAY_MISMATCH", base, modules, ({ simulation }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Tuesday 23:30-00:30 Europe/London",
      timezone: "UTC",
      windowStart: "2026-07-07 23:30:00",
      windowEnd: "2026-07-08 00:30:00",
    });
  });
  expectTemporalFail("invalid policy timezone rejected", "LINUX_TEMPORAL_INVALID_TIMEZONE", base, modules, ({ simulation }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 Mars/Olympus",
      timezone: "UTC",
      windowStart: "2026-07-08 06:00:00",
      windowEnd: "2026-07-08 07:00:00",
    });
  });
  expectTemporalFail("raw UTC-looking time with incorrect local policy time rejected", "LINUX_TEMPORAL_MAINTENANCE_WEEKDAY_MISMATCH", base, modules, ({ simulation }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 23:30-00:30 Europe/London",
      timezone: "UTC",
      windowStart: "2026-07-08 23:30:00",
      windowEnd: "2026-07-09 00:30:00",
    });
  });

  expectTemporalPass("exact canonical activity and occurrence approval accepted", base, modules, ({ simulation, assets }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 UTC",
      timezone: "UTC",
      windowStart: "2026-07-08 06:00:00",
      windowEnd: "2026-07-08 07:00:00",
    });
    mutateAsset(assets, "assets/docs/change_request.md", (content) =>
      appendApprovalClaim(content, base, simulation, exactActivityScope(base, simulation))
    );
    mutateAsset(assets, "manifest.json", (content) => content.replace(/"generated_at":\s*"[^"]+"/, '"generated_at": "2026-12-31T00:00:00Z"'));
  });
  expectTemporalFail("correct change ID but unrelated activity in scope rejected", "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", base, modules, ({ simulation, assets }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 UTC",
      timezone: "UTC",
      windowStart: "2026-07-08 06:00:00",
      windowEnd: "2026-07-08 07:00:00",
    });
    mutateAsset(assets, "assets/docs/change_request.md", (content) => appendApprovalClaim(content, base, simulation, "database vacuum only"));
    mutateAsset(assets, "manifest.json", (content) => content.replace(/"generated_at":\s*"[^"]+"/, '"generated_at": "2026-12-31T00:00:00Z"'));
  });
  expectTemporalFail("correct host change and ticket but no activity rejected", "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", base, modules, ({ simulation, assets }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 UTC",
      timezone: "UTC",
      windowStart: "2026-07-08 06:00:00",
      windowEnd: "2026-07-08 07:00:00",
    });
    mutateAsset(assets, "assets/docs/change_request.md", (content) => appendApprovalClaim(content, base, simulation, "maintenance"));
    mutateAsset(assets, "manifest.json", (content) => content.replace(/"generated_at":\s*"[^"]+"/, '"generated_at": "2026-12-31T00:00:00Z"'));
  });
  expectTemporalFail("correct activity but wrong host rejected", "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", base, modules, ({ simulation, assets }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 UTC",
      timezone: "UTC",
      windowStart: "2026-07-08 06:00:00",
      windowEnd: "2026-07-08 07:00:00",
    });
    mutateAsset(assets, "assets/docs/change_request.md", (content) =>
      appendApprovalClaim(content.replace(new RegExp(`Host: ${base.investigation.hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"), "Host: wrong-host-01"), base, simulation, exactActivityScope(base, simulation))
    );
    mutateAsset(assets, "manifest.json", (content) => content.replace(/"generated_at":\s*"[^"]+"/, '"generated_at": "2026-12-31T00:00:00Z"'));
  });
  expectTemporalFail("correct activity but wrong date and window rejected", "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", base, modules, ({ simulation, assets }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 UTC",
      timezone: "UTC",
      windowStart: "2026-07-08 06:00:00",
      windowEnd: "2026-07-08 07:00:00",
    });
    mutateAsset(assets, "assets/docs/change_request.md", (content) => `${content}
Approval status: approved for observed activity
Approved change occurrence: 2026-07-09 06:00:00 to 2026-07-09 07:00:00
Approved change scope: ${exactActivityScope(base, simulation)}
`);
    mutateAsset(assets, "manifest.json", (content) => content.replace(/"generated_at":\s*"[^"]+"/, '"generated_at": "2026-12-31T00:00:00Z"'));
  });
  expectTemporalFail("partial command path match rejected", "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", base, modules, ({ simulation, assets }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 UTC",
      timezone: "UTC",
      windowStart: "2026-07-08 06:00:00",
      windowEnd: "2026-07-08 07:00:00",
    });
    const command = simulation.commands.find((item) => simulation.maintenanceActivities[0].commandIds.includes(item.id));
    const partial = command?.renderedCommand.split(/\s+/)[0] || "/usr";
    mutateAsset(assets, "assets/docs/change_request.md", (content) => appendApprovalClaim(content, base, simulation, partial));
    mutateAsset(assets, "manifest.json", (content) => content.replace(/"generated_at":\s*"[^"]+"/, '"generated_at": "2026-12-31T00:00:00Z"'));
  });
  expectTemporalFail("related service name with wrong operation rejected", "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", base, modules, ({ simulation, assets }) => {
    approveActivity(simulation, {
      recurringPolicyWindow: "Wednesday 06:00-07:00 UTC",
      timezone: "UTC",
      windowStart: "2026-07-08 06:00:00",
      windowEnd: "2026-07-08 07:00:00",
    });
    const transition = simulation.serviceTransitions.find((item) => simulation.maintenanceActivities[0].serviceTransitionIds.includes(item.id)) || simulation.serviceTransitions[0];
    const service = simulation.services.find((item) => item.id === transition.serviceId);
    const wrongOperation = transition.operation === "stop" ? "start" : "stop";
    mutateAsset(assets, "assets/docs/change_request.md", (content) => appendApprovalClaim(content, base, simulation, `${service.unitName} ${wrongOperation}`));
    mutateAsset(assets, "manifest.json", (content) => content.replace(/"generated_at":\s*"[^"]+"/, '"generated_at": "2026-12-31T00:00:00Z"'));
  });

  expectTemporalFail("wrong maintenance weekday rejected", "LINUX_TEMPORAL_MAINTENANCE_WEEKDAY_MISMATCH", base, modules, ({ simulation }) => {
    simulation.maintenanceActivities[0].approved = true;
  });
  expectTemporalFail("correct time but wrong date rejected", "LINUX_TEMPORAL_MAINTENANCE_WEEKDAY_MISMATCH", base, modules, ({ simulation }) => {
    const policy = simulation.maintenanceActivities[0].recurringPolicyWindow.match(/(\d\d:\d\d)-(\d\d:\d\d)/);
    simulation.maintenanceActivities[0].approved = true;
    simulation.maintenanceActivities[0].windowStart = `${simulation.investigation.incidentDate} ${policy[1]}:00`;
    simulation.maintenanceActivities[0].windowEnd = `${simulation.investigation.incidentDate} ${policy[2]}:00`;
  });
  expectTemporalFail("correct change ID but wrong host rejected", "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", base, modules, ({ assets }) => {
    mutateAsset(assets, "assets/docs/change_request.md", (content) => claimApprovedChange(base)(content.replace(`Host: ${base.investigation.hostname}`, "Host: wrong-host-01")));
  });
  expectTemporalFail("correct change ID but wrong activity rejected", "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", base, modules, ({ assets }) => {
    mutateAsset(assets, "assets/docs/change_request.md", claimApprovedChange(base, { scope: "database vacuum only" }));
  });
  expectTemporalFail("correct host and activity but non-overlapping window rejected", "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", base, modules, ({ assets }) => {
    mutateAsset(assets, "assets/docs/change_request.md", claimApprovedChange(base, { windowStart: "2026-07-06 06:00:00", windowEnd: "2026-07-06 07:00:00" }));
  });
  expectTemporalFail("timezone crossing midnight weekday mismatch rejected", "LINUX_TEMPORAL_MAINTENANCE_WEEKDAY_MISMATCH", base, modules, ({ simulation }) => {
    simulation.maintenanceActivities[0].recurringPolicyWindow = "Wednesday 00:30-01:30 Europe/London";
    simulation.maintenanceActivities[0].timezone = "UTC";
    simulation.maintenanceActivities[0].windowStart = "2026-07-06 23:30:00";
    simulation.maintenanceActivities[0].windowEnd = "2026-07-07 00:30:00";
    simulation.maintenanceActivities[0].approved = true;
  });
  expectTemporalFail("incident window mislabeled as maintenance window rejected", "LINUX_TEMPORAL_WINDOW_LABEL_CONFLATION", base, modules, ({ assets, simulation }) => {
    mutateAsset(assets, "assets/docs/change_request.md", (content) => `${content}\nMaintenance window: ${simulation.collection.windowStart} to ${simulation.collection.windowEnd}\n`);
  });
  expectTemporalFail("contradictory maintenance windows in one document rejected", "LINUX_TEMPORAL_DOCUMENT_WINDOW_CONTRADICTION", base, modules, ({ assets }) => {
    mutateAsset(assets, "assets/docs/change_request.md", (content) => `${content}\nRecurring maintenance policy: Wednesday 06:00-07:00 UTC\n`);
  });
  expectTemporalFail("event outside investigation window marked inside rejected", "LINUX_TEMPORAL_EVENT_WINDOW_CLASSIFICATION_INVALID", base, modules, ({ assets, simulation }) => {
    const outside = `${simulation.investigation.incidentDate} 06:30:00`;
    mutateAsset(assets, "assets/evidence/timeline.csv", (content) => {
      const lines = content.split(/\r?\n/);
      const index = lines.findIndex((line) => line.includes(",Observed,"));
      if (index < 1) throw new Error("fixture lacks observed timeline row");
      lines[index] = lines[index].replace(/^\d{4}-\d{2}-\d{2} \d\d:\d\d:\d\d/, outside);
      return lines.join("\n");
    });
  });
  expectTemporalFail("session close outside collection marked observed rejected", "LINUX_TEMPORAL_SESSION_CLOSE_OBSERVED_AFTER_COLLECTION", base, modules, ({ assets, simulation }) => {
    const session = simulation.sshSessions.find((item) => item.closedAt && item.closedAt > simulation.collection.windowEnd);
    if (!session) throw new Error("fixture lacks post-collection session close");
    const identity = simulation.identities.find((item) => item.id === session.identityId);
    mutateAsset(assets, "assets/logs/auth.log", (content) => `${content}${session.closedAt} ${simulation.investigation.hostname} sshd[${session.sessionPid}]: pam_unix(sshd:session): session closed for user ${identity.username}\n`);
  });
  expectTemporalFail("generated-at before observed evidence rejected", "LINUX_TEMPORAL_GENERATED_AT_BEFORE_EVIDENCE", base, modules, ({ assets }) => {
    mutateAsset(assets, "manifest.json", (content) => content.replace(/"generated_at":\s*"[^"]+"/, '"generated_at": "2026-07-06T00:00:00Z"'));
  });
  expectTemporalFail("reordered timeline timestamps rejected", "LINUX_TEMPORAL_TIMELINE_ORDER_INVALID", base, modules, ({ assets }) => {
    mutateAsset(assets, "assets/evidence/timeline.csv", (content) => {
      const lines = content.trimEnd().split(/\r?\n/);
      return [lines[0], lines[2], lines[1], ...lines.slice(3)].join("\n") + "\n";
    });
  });
  expectTemporalFail("duplicated timeline timestamps rejected", "LINUX_TEMPORAL_TIMELINE_ORDER_INVALID", base, modules, ({ assets }) => {
    mutateAsset(assets, "assets/evidence/timeline.csv", (content) => {
      const lines = content.trimEnd().split(/\r?\n/);
      return `${content}${lines[1]}\n`;
    });
  });
  expectTemporalFail("risk-register hypothesis rendered as confirmed execution rejected", "LINUX_TEMPORAL_RISK_HYPOTHESIS_OVERCLAIM", base, modules, ({ assets }) => {
    mutateAsset(assets, "assets/evidence/risk_register.csv", (content) => content.replace("Unverified hypothesis:", "confirmed execution:"));
  });
  expectTemporalFail("change reference without matching scope cannot prove approval", "LINUX_TEMPORAL_CHANGE_SCOPE_INVALID", base, modules, ({ assets }) => {
    mutateAsset(assets, "assets/docs/change_request.md", (content) => `${content}\nApproval status: approved for ${base.investigation.changeId}\nApproved change occurrence: ${base.simulation.collection.windowStart} to ${base.simulation.collection.windowEnd}\nApproved change scope: referenced ticket only\n`);
  });

  const reviewedShapes = [
    ["Beginner systemd production shape", buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", "Beginner"), "Beginner"],
    ["Intermediate cron production shape", buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Intermediate"), "Intermediate"],
    ["Advanced cron mail-relay production shape", buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Advanced"), "Advanced"],
  ];
  for (const [name, candidate, difficulty] of reviewedShapes) {
    const lab = assembledLab(modules, candidate, difficulty);
    const quality = checkLinuxFinalProductionQuality({ context: candidate.investigation, assets: candidate.assets, simulation: candidate.simulation, lab });
    assert(`${name} final quality passes`, quality.passed, JSON.stringify(quality.issues));
    const docs = candidate.assets.filter((asset) => /assets\/(?:docs|evidence)\/.*\.(?:md|csv)$/i.test(asset.file_path)).map((asset) => asset.content).join("\n");
    assert(`${name} labels recurring policy explicitly`, /Recurring maintenance policy:/i.test(docs), name);
    assert(`${name} keeps approval as validation gap`, /Approved change occurrence: not established|approval.*requires validation|Approval decision: (?:not established by the supplied evidence|unknown because no approval record is supplied)/i.test(docs), name);
    assert(`${name} does not render incident window as maintenance authority`, !new RegExp(`Maintenance window:\\s*${candidate.simulation.collection.windowStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(docs), name);
    if (candidate.investigation.incidentFamily === "cron_persistence") {
      assert(`${name} risk hypothesis does not prove execution`, !/\b(?:confirmed execution|confirmed compromise|executed successfully)\b/i.test(docs), name);
      assert(`${name} renders cron approval as exact authority or explicit gap`, /Approved change occurrence: not established|approval.*requires validation|Approved change scope:|Approval decision: (?:not established by the supplied evidence|unknown because no approval record is supplied)/i.test(docs), name);
    }
  }

  const matrixRows = [];
  for (const family of FAMILIES) {
    for (const difficulty of DIFFICULTIES) {
      const candidate = buildCandidate(buildLinuxAssetCandidate, family, difficulty);
      const lab = assembledLab(modules, candidate, difficulty);
      const report = validateLinuxTemporalDocumentAuthority({ simulation: candidate.simulation, assets: candidate.assets });
      assert(`${family}/${difficulty} temporal document authority passes`, report.passed, JSON.stringify(report.issues));
      const model = buildLinuxCanonicalTemporalModel(candidate.simulation);
      matrixRows.push({
        family,
        difficulty,
        temporalModelHash: report.temporalModelHash,
        documentAuthorityHash: report.documentAuthorityHash,
        assembledHash: sha(lab),
        modelHash: sha(model),
      });
    }
  }
  const matrixHash = sha(matrixRows.slice().sort((left, right) => `${left.family}:${left.difficulty}`.localeCompare(`${right.family}:${right.difficulty}`)));
  assert("matrix hash is deterministic", matrixHash === sha(matrixRows.slice().reverse().sort((left, right) => `${left.family}:${left.difficulty}`.localeCompare(`${right.family}:${right.difficulty}`))), matrixHash);
  console.log(JSON.stringify({ passed: true, matrixCases: matrixRows.length, mutationCases: 29, matrixHash }, null, 2));
}

main();
