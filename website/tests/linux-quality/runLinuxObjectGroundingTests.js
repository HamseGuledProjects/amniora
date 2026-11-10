#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
process.env.NODE_ENV = "production";
process.env.CYBERLAB_LINUX_NARRATIVE_TRACE = "false";

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-object-grounding-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}


function candidateForFamily(buildLinuxAssetCandidate, family) {
  for (let index = 0; index < 1200; index += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
          seed: `phase6d:${family}:${index}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux", difficulty: "Advanced", duration: "60 mins", title: "CyberLab Asset Pack" },
          { incidentFamily: family }
        );
      if (candidate.investigation.incidentFamily === family) return candidate;
    } catch (error) {
      if (!/after regeneration attempts|skipped incident family|simulation validation failed/i.test(String(error.message || error))) throw error;
    }
  }
  throw new Error(`Could not generate family ${family}`);
}

function grounding(validateLinuxLearnerPackGrounding, candidate, simulation = candidate.simulation) {
  return validateLinuxLearnerPackGrounding({
    simulation,
    evidenceRegistry: simulation.evidenceRegistry,
    finalAssets: candidate.assets,
  });
}

function task(simulation, intent) {
  const found = simulation.canonicalTasks.find((item) => item.intent === intent);
  if (!found) throw new Error(`missing task ${intent}`);
  return found;
}

function requirement(taskItem, contains) {
  const found = taskItem.requirements.find((item) => item.id.includes(contains) || item.capability === contains || item.relation === contains);
  if (!found) throw new Error(`${taskItem.id} missing requirement ${contains}`);
  return found;
}

function canBreakRequirement(candidate, intent, reqContains) {
  const taskItem = candidate.simulation.canonicalTasks.find((item) => item.intent === intent);
  if (!taskItem) return false;
  return taskItem.requirements.some((item) => item.id.includes(reqContains) || item.capability === reqContains || item.relation === reqContains);
}

function selectedAssetFor(simulation, taskItem, req) {
  const selected = taskItem.selectedEvidenceAssetIds
    .map((id) => simulation.evidenceRegistry.find((asset) => asset.id === id))
    .filter(Boolean);
  const found = selected.find((asset) =>
    asset.capabilities.includes(req.capability) &&
    req.subjectIds.every((id) => asset.canonicalObjectIds.includes(id)) &&
    (!req.relation || asset.relations.some((relation) => relation.relation === req.relation && req.subjectIds.every((id) => relation.subjectIds.includes(id))))
  );
  if (!found) throw new Error(`${taskItem.id} has no selected asset for ${req.id}`);
  return found;
}

function breakRequirement(candidate, intent, reqContains, mode = "subject") {
  const simulation = clone(candidate.simulation);
  const taskItem = task(simulation, intent);
  const req = requirement(taskItem, reqContains);
  selectedAssetFor(simulation, taskItem, req);
  const selected = taskItem.selectedEvidenceAssetIds
    .map((id) => simulation.evidenceRegistry.find((asset) => asset.id === id))
    .filter(Boolean);
  if (mode === "relation" && req.relation) {
    for (const asset of selected) {
      asset.relations = asset.relations.filter((relation) => !(relation.relation === req.relation && req.subjectIds.every((id) => relation.subjectIds.includes(id))));
    }
  } else {
    for (const remove of req.subjectIds) {
      for (const asset of selected) {
        asset.canonicalObjectIds = asset.canonicalObjectIds.filter((id) => id !== remove);
        asset.subjectRefs = asset.subjectRefs.filter((ref) => ref.id !== remove);
        asset.relations = asset.relations.filter((relation) => !relation.subjectIds.includes(remove));
      }
    }
  }
  return simulation;
}

function expectPass(name, result) {
  if (!result.passed) throw new Error(`${name}: expected pass, got ${result.issues.join(" | ")}`);
  console.log(`PASS ${name}`);
}

function expectFail(name, result, text) {
  const issueText = Array.isArray(result.issues) ? result.issues.join(" | ") : String(result.issues || "");
  if (result.passed || !new RegExp(text, "i").test(issueText)) {
    throw new Error(`${name}: expected failure /${text}/, got passed=${result.passed} ${issueText}`);
  }
  console.log(`PASS ${name}`);
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { validateLinuxLearnerPackGrounding } = require(path.join(out, "linux", "grounding.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  console.info = () => {};

  const families = [
    "ssh_bruteforce",
    "ssh_key_compromise",
    "misconfigured_sudoers",
    "service_account_misuse",
    "cron_persistence",
    "systemd_persistence",
    "unauthorized_package_install",
    "data_staging",
    "log_tampering",
    "docker_compromise",
    "reverse_shell",
  ];
  const candidates = Object.fromEntries(families.map((family) => [family, candidateForFamily(buildLinuxAssetCandidate, family)]));
  for (const family of families) expectPass(`corrected ${family}`, grounding(validateLinuxLearnerPackGrounding, candidates[family]));

  const cases = [
    ["identity: correct capability wrong account", "ssh_bruteforce", "actor_attribution", "identity", "subject"],
    ["identity: group inventory missing target user", "ssh_bruteforce", "actor_attribution", "identity", "subject"],
    ["identity: SSH session relation wrong account", "ssh_key_compromise", "key_provenance", "session", "relation"],
    ["command: audit log contains wrong command", "data_staging", "command_process", "execution", "subject"],
    ["command: process snapshot contains wrong PID", "data_staging", "command_process", "process", "subject"],
    ["command: process capability wrong process relation", "service_account_misuse", "command_process", "spawned_process", "relation"],
    ["file: permissions report contains wrong file", "data_staging", "command_process", "file", "subject"],
    ["file: open-files asset contains wrong file", "docker_compromise", "command_process", "file", "subject"],
    ["file: config reference not process open", "cron_persistence", "command_process", "file", "relation"],
    ["service: inventory contains wrong service", "systemd_persistence", "service_state", "service", "subject"],
    ["service: journal transition another service", "systemd_persistence", "service_state", "transition", "relation"],
    ["service: document background service", "misconfigured_sudoers", "change_control", "change", "subject"],
    ["ssh: journal contains another SSH session", "ssh_bruteforce", "scope_timeline", "session", "subject"],
    ["ssh: key asset wrong account", "ssh_key_compromise", "key_provenance", "key_material", "subject"],
    ["ssh: task uses wrong session object", "ssh_key_compromise", "key_provenance", "session", "relation"],
    ["cron: definition asset wrong job", "cron_persistence", "cron_analysis", "definition", "subject"],
    ["cron: execution log unrelated job", "cron_persistence", "cron_analysis", "execution", "subject"],
    ["cron: definition present execution falsely claimed", "cron_persistence", "cron_analysis", "executed_schedule", "relation"],
    ["cron: execution present definition absent", "cron_persistence", "cron_analysis", "definition", "subject"],
    ["cron: script reference treated as open file", "cron_persistence", "command_process", "file", "relation"],
    ["package: apt history another transaction", "unauthorized_package_install", "package_transaction", "transaction", "subject"],
    ["package: package inventory wrong package", "unauthorized_package_install", "package_transaction", "installed_package", "relation"],
    ["package: timer package used for manual install", "unauthorized_package_install", "package_transaction", "transaction", "subject"],
    ["network: unrelated process port", "docker_compromise", "service_state", "service", "subject"],
    ["network: connection wrong PID", "reverse_shell", "command_process", "process", "subject"],
    ["network: background connection incident egress", "reverse_shell", "command_process", "execution", "subject"],
    ["change: correct type wrong change ID", "misconfigured_sudoers", "change_control", "change", "subject"],
    ["change: wrong maintenance activity", "service_account_misuse", "change_control", "maintenance", "subject"],
    ["change: unrelated approved activity", "systemd_persistence", "change_control", "covered_by_change", "relation"],
    ["timeline: target event absent", "log_tampering", "scope_timeline", "command", "subject"],
    ["timeline: background event used exact source", "cron_persistence", "scope_timeline", "command", "subject"],
    ["timeline: timezone instant mismatch proxy", "ssh_bruteforce", "scope_timeline", "session", "subject"],
    ["risk: wrong risk subject", "data_staging", "impact_assessment", "risk_context", "subject"],
    ["risk: ownership claim no file metadata", "data_staging", "command_process", "file", "subject"],
    ["risk: execution supported only by definition", "cron_persistence", "cron_analysis", "executed_schedule", "relation"],
    ["risk: status in severity column proxy", "unauthorized_package_install", "impact_assessment", "risk_context", "subject"],
    ["snapshot: completed process in collection snapshot", "data_staging", "command_process", "process", "subject"],
    ["snapshot: incident snapshot outside lifetime", "docker_compromise", "command_process", "process", "subject"],
    ["topic: malformed AI topic cannot override canonical topic", "systemd_persistence", "service_state", "service", "subject"],
    ["text: typographic apostrophe normalization unaffected by grounding", "ssh_bruteforce", "actor_attribution", "identity", "subject"],
  ];

  let executedBrokenCases = 0;
  let skippedBrokenCases = 0;
  for (const [name, family, intent, reqContains, mode] of cases) {
    const candidate = candidates[family];
    if (!canBreakRequirement(candidate, intent, reqContains)) {
      console.log(`SKIP ${name} (${intent}/${reqContains} not generated by canonical task plan)`);
      skippedBrokenCases += 1;
      continue;
    }
    const broken = breakRequirement(candidate, intent, reqContains, mode);
    expectFail(name, grounding(validateLinuxLearnerPackGrounding, candidate, broken), "object-grounded requirements|missing");
    executedBrokenCases += 1;
  }

  const candidate = candidates.cron_persistence;
  const lab = {
    title: "Linux object grounding check",
    topic: "Linux DFIR: Cron Execution Review",
    difficulty: "Advanced",
    estimated_time: "30 mins",
    objective: `Review ${candidate.investigation.hostname} during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone}.`,
    scenario: `${candidate.investigation.company} is reviewing ${candidate.investigation.incidentId} on ${candidate.investigation.hostname}, a ${candidate.investigation.hostRole}, during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone} for ${candidate.investigation.changeId}, ${candidate.investigation.ticketId}, and ${candidate.investigation.affectedService}.`,
    tasks: candidate.simulation.canonicalTasks.map((item) => ({
      phase: `Task ${item.order}`,
      title: `Review ${item.intent.replace(/_/g, " ")} evidence.`,
      evidence: item.selectedEvidenceAssetIds.map((id) => candidate.simulation.evidenceRegistry.find((asset) => asset.id === id).path).slice(0, 3),
      deliverable: "Prepare evidence-backed analyst notes.",
    })),
    hints: ["Compare exact object IDs before drawing conclusions.", "Separate definitions from executions.", "Cite only supplied evidence."],
    outcomes: ["Trace exact Linux subjects.", "Validate relationships.", "Document evidence limits."],
  };
  const wrongEvidenceLab = clone(lab);
  const cronTaskIndex = candidate.simulation.canonicalTasks.findIndex((item) => item.intent === "cron_analysis");
  if (cronTaskIndex < 0) throw new Error("cron_persistence candidate missing cron_analysis task");
  wrongEvidenceLab.tasks[cronTaskIndex].evidence = ["assets/reports/service_inventory.txt", "assets/docs/change_request.md"];
  const finalResult = checkLinuxFinalProductionQuality({ context: candidate.investigation, assets: candidate.assets, simulation: candidate.simulation, lab: wrongEvidenceLab });
  expectFail("final narrative task wrong object evidence", { passed: finalResult.passed, issues: finalResult.issues.map((issue) => issue.description).join(" | ") }, "object-grounding|cron analysis|evidence");

  console.log(JSON.stringify({ passed: true, corrected: families.length, broken: executedBrokenCases + 1, skipped: skippedBrokenCases }, null, 2));
}

main();
