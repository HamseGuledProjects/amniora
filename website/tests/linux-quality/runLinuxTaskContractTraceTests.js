#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-contract-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function buildContractLab(candidate, contract, buildLinuxAssembledNarrative) {
  return buildLinuxAssembledNarrative({
    contract,
    context: candidate.investigation,
    difficulty: "Advanced",
    duration: "60 mins",
    tasks: contract.taskContracts.map((task) => ({
      task_id: task.taskId,
      task_intent: task.intent,
      evidence: task.selectedEvidence.map((item) => item.path),
    })),
  });
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxCanonicalNarrativeBrief } = require(path.join(out, "linux", "simulation.js"));
  const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));

  // The assertion below requires a timeline task. Advanced SSH-key 30-minute
  // plans now reserve four distinct change/key/session/risk objectives, so
  // exercise the existing timeline evidence contract at 60 minutes. Search a bounded,
  // deterministic sequence because the production planner intentionally
  // varies reasoning paths and may reject an over-volume seed.
  let candidate;
  let lastError;
  for (let attempt = 0; attempt < 80 && !candidate; attempt += 1) {
    try {
      const built = buildLinuxAssetCandidate({
        category: "Linux",
        difficulty: "Advanced",
        duration: "60 mins",
        title: "QA",
        seed: `patch-a:key:contract-trace:${attempt}`,
      }, { incidentFamily: "ssh_key_compromise" });
      if (built.simulation.canonicalTasks.some((task) => task.intent === "scope_timeline")) candidate = built;
    } catch (error) {
      lastError = error;
    }
  }
  if (!candidate) throw lastError || new Error("Contract trace could not build a valid timeline candidate.");
  const brief = JSON.parse(buildLinuxCanonicalNarrativeBrief(candidate.simulation));
  const assembledLab = buildContractLab(candidate, brief, buildLinuxAssembledNarrative);
  const lab = finalLinuxNarrativeFromAssembled({ lab: assembledLab });
  const result = checkLinuxFinalProductionQuality({
    context: candidate.investigation,
    assets: candidate.assets,
    simulation: candidate.simulation,
    lab,
  });

  if (!result.passed) {
    throw new Error(`Canonical contract lab failed: ${result.summary}\n${JSON.stringify(result.issues, null, 2)}`);
  }

  const timelineIndex = brief.taskContracts.findIndex((task) => task.intent === "scope_timeline");
  const timelineTask = timelineIndex >= 0 ? lab.tasks[timelineIndex] : undefined;
  if (!timelineTask) throw new Error("Contract trace missing timeline task.");
  if (timelineTask.evidence.includes("assets/evidence/timeline.csv")) {
    throw new Error("Contract trace did not exercise planner-selected non-timeline.csv evidence.");
  }

  const trace = brief.taskContracts.map((task) => ({
    canonicalTask: task.taskId,
    expectedIntent: task.intent,
    expectedEvidence: task.selectedEvidence.map((item) => item.path),
    expectedDeliverable: task.deliverableType,
    validatorExpectation: task.requiredCapabilities,
    passed: true,
  }));

  console.log(JSON.stringify({
    passed: true,
    caseId: candidate.investigation.incidentId,
    timezone: candidate.investigation.timezone,
    tasks: trace,
  }, null, 2));
}

main();
