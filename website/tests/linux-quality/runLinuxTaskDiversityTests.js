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
  const build = path.join(os.tmpdir(), `cyberlab-linux-task-diversity-${Date.now()}`);
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

function buildCandidate(buildLinuxAssetCandidate, family, difficulty) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `phase5-diversity:${family}:${difficulty}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
          title: "Amniora Linux Asset Pack",
        }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function asset(id, pathName, capabilities, canonicalObjectIds = ["identity:alex"], relations = []) {
  return {
    id,
    path: pathName,
    aliases: [],
    displayName: path.basename(pathName),
    assetType: "timestamped_log",
    canonicalObjectIds,
    subjectRefs: canonicalObjectIds.map((idValue) => ({ id: idValue, type: idValue.split(":")[0] || "identity" })),
    relations,
    eventIds: [],
    capabilities,
    support: "exact",
    stateType: "historical_reconstruction",
  };
}

function task(id, order, intent, evidenceIds, capabilities, overrides = {}) {
  return {
    id,
    intent,
    requiredCapabilities: capabilities,
    inquiryTypes: ["historical_reconstruction"],
    currentStateRequirements: [],
    selectedEvidenceAssetIds: evidenceIds,
    canonicalObjectIds: overrides.canonicalObjectIds || ["identity:alex"],
    primarySubjectIds: overrides.primarySubjectIds || ["identity:alex"],
    supportingSubjectIds: [],
    requirements: overrides.requirements || [],
    expectedDeliverableType: overrides.expectedDeliverableType || "evidence_notes",
    difficulty: overrides.difficulty || "Advanced",
    order,
  };
}

function fixture(tasks, incidentFamily = "ssh_bruteforce") {
  const registry = [
    asset("auth", "assets/logs/auth.log", ["authentication", "timeline_exact"], ["ssh_session:1", "identity:alex"], [{ relation: "authenticated_as", subjectIds: ["ssh_session:1", "identity:alex"] }]),
    asset("users", "assets/csv/users.csv", ["actor_attribution"], ["identity:alex"]),
    asset("sudo", "assets/logs/sudo.log", ["sudo_authorisation", "command_execution"], ["identity:alex", "command:restart"], [{ relation: "executed_by", subjectIds: ["command:restart", "identity:alex"] }]),
    asset("configs", "assets/configs/linux_config_pack.txt", ["configuration_baseline", "sudo_authorisation"], ["policy:sudo"]),
  ];
  return {
    simulation: {
      investigation: { incidentFamily },
      canonicalTasks: tasks,
      planningEvidenceRegistry: registry,
      evidenceRegistry: registry,
    },
    registry,
  };
}

function hasIssue(report, code) {
  return report.issues.some((issue) => issue.code === code);
}

function syntheticTests(validateLinuxTaskDiversity, orderLinuxTasksByInvestigationStage) {
  const baseReq = { id: "r1", capability: "authentication", subjectIds: ["ssh_session:1", "identity:alex"], relation: "authenticated_as", minimumSupport: "exact" };
  const duplicate = fixture([
    task("task:1:ssh_authentication", 1, "ssh_authentication", ["auth", "users"], ["authentication", "actor_attribution"], { requirements: [baseReq] }),
    task("task:2:ssh_authentication", 2, "ssh_authentication", ["users", "auth"], ["actor_attribution", "authentication"], { requirements: [baseReq] }),
  ]);
  const exactReport = validateLinuxTaskDiversity(duplicate);
  assert("exact duplicate catches reordered evidence", hasIssue(exactReport, "LINUX_TASK_DUPLICATE_EXACT"), JSON.stringify(exactReport.issues));

  const semantic = fixture([
    task("task:1:ssh_authentication", 1, "ssh_authentication", ["auth", "users"], ["authentication", "actor_attribution"], { requirements: [baseReq] }),
    task("task:2:actor_attribution", 2, "actor_attribution", ["auth", "users"], ["authentication", "actor_attribution"], { requirements: [baseReq] }),
  ], "misconfigured_sudoers");
  const semanticReport = validateLinuxTaskDiversity({
    tasks: semantic.simulation.canonicalTasks,
    registry: semantic.registry,
    difficulty: "Advanced",
  });
  assert("semantic duplicate catches same account/session contribution", hasIssue(semanticReport, "LINUX_TASK_DUPLICATE_SEMANTIC"), JSON.stringify(semanticReport.issues));

  const progressive = fixture([
    task("task:1:ssh_authentication", 1, "ssh_authentication", ["auth"], ["authentication", "timeline_exact"], { requirements: [baseReq] }),
    task("task:2:sudo_policy", 2, "sudo_policy", ["sudo", "configs"], ["sudo_authorisation", "configuration_baseline"], {
      requirements: [{ id: "r2", capability: "sudo_authorisation", subjectIds: ["command:restart", "identity:alex"], relation: "executed_by", minimumSupport: "exact" }],
      expectedDeliverableType: "policy_mapping",
    }),
  ]);
  const progressiveReport = validateLinuxTaskDiversity(progressive);
  assert("progressive evidence reuse is allowed", progressiveReport.status === "diverse", JSON.stringify(progressiveReport.issues));

  const generic = fixture([
    task("task:1:actor_attribution", 1, "actor_attribution", ["users"], ["actor_attribution"], { primarySubjectIds: [], canonicalObjectIds: [], requirements: [] }),
  ]);
  const genericReport = validateLinuxTaskDiversity({
    tasks: generic.simulation.canonicalTasks,
    registry: generic.registry,
    difficulty: "Advanced",
  });
  assert("low-value generic task is rejected", hasIssue(genericReport, "LINUX_TASK_LOW_VALUE_GENERIC"), JSON.stringify(genericReport.issues));

  const backward = fixture([
    task("task:1:risk_assessment", 1, "risk_assessment", ["configs"], ["risk_context"], { expectedDeliverableType: "risk_summary" }),
    task("task:2:ssh_authentication", 2, "ssh_authentication", ["auth"], ["authentication"], { requirements: [baseReq] }),
  ]);
  const backwardReport = validateLinuxTaskDiversity(backward);
  assert("invalid progression is rejected", hasIssue(backwardReport, "LINUX_TASK_INVALID_PROGRESSION"), JSON.stringify(backwardReport.issues));

  const ordered = orderLinuxTasksByInvestigationStage(backward.simulation.canonicalTasks);
  assert("stage ordering moves identify before assess", ordered[0].intent === "ssh_authentication" && ordered[1].intent === "risk_assessment", ordered.map((item) => item.intent).join(","));
}

function generatedMatrix(validateLinuxTaskDiversity, buildLinuxAssetCandidate) {
  for (const family of FAMILIES) {
    for (const difficulty of DIFFICULTIES) {
      const candidate = buildCandidate(buildLinuxAssetCandidate, family, difficulty);
      const report = validateLinuxTaskDiversity({
        simulation: candidate.simulation,
        finalAssets: candidate.assets,
      });
      assert(`${family} ${difficulty} generated task set is diverse`, report.status === "diverse", JSON.stringify(report.issues, null, 2));
    }
  }
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    validateLinuxTaskDiversity,
    orderLinuxTasksByInvestigationStage,
  } = require(path.join(out, "linux", "taskDiversity.js"));
  syntheticTests(validateLinuxTaskDiversity, orderLinuxTasksByInvestigationStage);
  generatedMatrix(validateLinuxTaskDiversity, buildLinuxAssetCandidate);
}

main();
