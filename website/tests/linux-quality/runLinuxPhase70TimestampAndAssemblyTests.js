#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const PHASE65_DIR = path.join(ROOT, "test-output", "linux-live-api-sanitized-task-pilot", "2026-07-27T00-37-01-656Z");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-phase70-${Date.now()}`);
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function taskIsolatedContract(contract, task) {
  return {
    ...contract,
    canonicalTaskCount: 1,
    globalRenderedEvidencePaths: task.selectedEvidence.map((asset) => asset.path).sort(),
    globalGroundedSubjects: task.groundedSubjects,
    globalGroundedRelationships: task.groundedRelationships,
    globalAllowedTimestamps: task.allowedTimestamps,
    taskContracts: [task],
  };
}

function buildCandidate(buildLinuxAssetCandidate, lab) {
  return buildLinuxAssetCandidate({
          seed: lab.generationSeed,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
      difficulty: lab.difficulty,
      duration: lab.duration,
      title: "CyberLab Asset Pack",
      seed: lab.generationSeed,
    }, { incidentFamily: lab.family });
}

function syntheticIndexedResponse(view, incidentFamily) {
  const firstEvidence = view.allowedEvidence[0]?.path;
  const secondEvidence = view.allowedEvidence[1]?.path || firstEvidence;
  const firstSubject = view.allowedSubjects[0]?.index;
  const firstRelationship = view.allowedRelationshipStatements[0];
  const firstTimestamp = view.allowedTimestamps[0]?.index;
  const remediationTextByFamily = {
    ssh_bruteforce: "Review and validate the account purpose, shell, credential owner, and current access need before changing access.",
    systemd_persistence: "Preserve the systemd unit and journal evidence, then disable or mask the service after capture if the unit is unsupported.",
  };
  const remediationText = remediationTextByFamily[incidentFamily];
  return {
    task_number: view.taskNumber,
    learner_intent: view.learnerIntent,
    phase: `Task ${view.taskNumber}`,
    title: `${view.learnerIntent} using selected evidence`,
    evidence: view.allowedEvidence.slice(0, 3).map((asset) => asset.path),
    deliverable: view.learnerInstruction,
    claims: [
      {
        claim_class: firstRelationship?.allowedClaimClass || "observed",
        text: firstRelationship?.learnerStatement || "The supplied evidence supports this task-local observation.",
        supporting_evidence: [firstEvidence].filter(Boolean),
        subject_indexes: firstSubject ? [firstSubject] : [],
        relationship_statement_indexes: firstRelationship ? [firstRelationship.index] : [],
        timestamp_indexes: firstTimestamp ? [firstTimestamp] : [],
      },
      {
        claim_class: "bounded_inference",
        text: remediationText || "Any unresolved finding remains limited to evidence gaps and the next validation step.",
        supporting_evidence: [secondEvidence].filter(Boolean),
        subject_indexes: [],
        relationship_statement_indexes: [],
        timestamp_indexes: [],
      },
    ],
  };
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxNarrativeContract, assertLinuxTaskEvidenceClosureInvariant } = require(path.join(out, "linux", "simulation.js"));
  const { validateLinuxGeneratedNarrativeAgainstContract } = require(path.join(out, "linux", "narrativeContract.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const {
    adaptLinuxGeneratedTaskFromView,
    buildLinuxTaskGenerationView,
    linuxSanitizedRetryFeedback,
    scanLinuxModelFacingPayload,
    serializeLinuxTaskGenerationPrompt,
  } = require(path.join(out, "linux", "narrativeGenerationView.js"));
  const {
    buildLinuxAssembledNarrative,
    finalLinuxNarrativeFromAssembled,
  } = require(path.join(out, "linux", "narrativeAssembly.js"));

  const advancedLab = {
    difficulty: "Advanced",
    family: "cron_persistence",
    duration: "60 mins",
    generationSeed: "phase8-matrix:Advanced:cron_persistence:0",
  };
  const advancedCandidate = buildCandidate(buildLinuxAssetCandidate, advancedLab);
  assert("advanced replay family is cron_persistence", advancedCandidate.investigation.incidentFamily === "cron_persistence");
  assertLinuxTaskEvidenceClosureInvariant(advancedCandidate.simulation, advancedCandidate.assets.map((asset) => asset.file_path));
  const advancedContract = buildLinuxNarrativeContract(advancedCandidate.simulation, advancedCandidate.assets.map((asset) => asset.file_path));
  const cronTask = advancedContract.taskContracts.find((task) => task.intent === "cron_analysis");
  assert("advanced contract includes cron_analysis", Boolean(cronTask), advancedContract.taskContracts.map((task) => task.intent).join("|"));
  const cronView = buildLinuxTaskGenerationView({ contract: advancedContract, task: cronTask });
  const prompt = serializeLinuxTaskGenerationPrompt({ view: cronView });
  assert("cron sanitized prompt scans clean", scanLinuxModelFacingPayload(prompt, "cron prompt").length === 0);
  assert("cron view exposes approved timestamp indexes", cronView.allowedTimestamps.length >= 4, JSON.stringify(cronView.allowedTimestamps));
  assert(
    "cron scheduled execution timestamp is approved",
    cronView.allowedTimestamps.some((timestamp) => timestamp.exactDisplayValue === "2026-07-06 00:55:00"),
    JSON.stringify(cronView.allowedTimestamps)
  );
  assert("cron timestamp indexes are unique", new Set(cronView.allowedTimestamps.map((timestamp) => timestamp.index)).size === cronView.allowedTimestamps.length);
  const indexed = syntheticIndexedResponse(cronView, advancedContract.incidentFamily);
  const adapted = adaptLinuxGeneratedTaskFromView({ task: cronTask, generated: indexed });
  const oneTaskResult = validateLinuxGeneratedNarrativeAgainstContract(taskIsolatedContract(advancedContract, cronTask), {
    title: "Linux task evidence review",
    objective: `Use selected evidence for ${advancedContract.caseId}.`,
    scenario: `${advancedContract.scenarioFraming.hostname} task-local evidence review.`,
    tasks: [adapted],
    hints: ["Use selected task evidence."],
    outcomes: ["Task-local evidence review."],
  });
  assert("synthetic timestamp-index cron response passes frozen validator", oneTaskResult.passed, oneTaskResult.issues.map((issue) => issue.code).join(", "));

  const oldRejected = readJson(path.join(PHASE65_DIR, "rejected-task-attempts.json")).filter((row) => row.taskIntent === "cron_analysis");
  assert("Phase 6.5 rejected cron attempts retained", oldRejected.length === 3, String(oldRejected.length));
  for (const row of oldRejected) {
    assert(
      `Phase 6.5 attempt ${row.attemptNumber} legacy timestamp strings fail at adapter`,
      (() => {
        try {
          adaptLinuxGeneratedTaskFromView({ task: cronTask, generated: row.parsedSanitizedOutput });
          return false;
        } catch (error) {
          return /free-form timestamp strings/.test(String(error instanceof Error ? error.message : error));
        }
      })()
    );
  }

  const retry = linuxSanitizedRetryFeedback([
    "Claim references timestamp 2026-07-06 00:20:10, which is outside the contract.",
    "LINUX_NARRATIVE_INVENTED_TIMESTAMP",
    "task:1:cron_analysis",
  ]);
  assert("retry feedback hides validator code", !/\bLINUX_[A-Z0-9_]+\b/.test(retry), retry);
  assert("retry feedback hides canonical IDs", !/\btask:\d+:[A-Za-z0-9_-]+\b/.test(retry), retry);
  assert("retry feedback does not echo rejected timestamp", !retry.includes("2026-07-06 00:20:10"), retry);
  assert("retry feedback instructs allowed timestamp metadata selection", /allowed-timestamps list/i.test(retry), retry);

  const acceptedRows = readJson(path.join(PHASE65_DIR, "accepted-tasks.json"));
  for (const lab of [
    { labNumber: 1, difficulty: "Beginner", family: "ssh_bruteforce", duration: "30 mins", generationSeed: "phase8-matrix:Beginner:ssh_bruteforce:0" },
    { labNumber: 2, difficulty: "Intermediate", family: "systemd_persistence", duration: "30 mins", generationSeed: "phase8-matrix:Intermediate:systemd_persistence:0" },
  ]) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, lab);
    const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    const legacyTasks = acceptedRows
      .filter((row) => row.labNumber === lab.labNumber)
      .sort((left, right) => left.taskNumber - right.taskNumber)
      .map((row) => row.canonicalAdaptedOutput);
    assert(`lab ${lab.labNumber} accepted task count replayed`, legacyTasks.length === lab.labNumber + 4, String(legacyTasks.length));
    const tasks = contract.taskContracts.map((taskContract) =>
      adaptLinuxGeneratedTaskFromView({
        task: taskContract,
        generated: syntheticIndexedResponse(buildLinuxTaskGenerationView({ contract, task: taskContract }), contract.incidentFamily),
      })
    );
    const assembled = buildLinuxAssembledNarrative({
      contract,
      context: candidate.investigation,
      difficulty: lab.difficulty,
      duration: lab.duration,
      tasks,
    });
    const contractResult = validateLinuxGeneratedNarrativeAgainstContract(contract, assembled);
    assert(`lab ${lab.labNumber} assembled contract passes`, contractResult.passed, contractResult.issues.map((issue) => issue.code).join(", "));
    const finalNarrative = finalLinuxNarrativeFromAssembled({ lab: assembled });
    assert(`lab ${lab.labNumber} no untitled final tasks`, finalNarrative.tasks.every((task) => task.title && !/^untitled task$/i.test(task.title)));
    assert(`lab ${lab.labNumber} final tasks keep evidence`, finalNarrative.tasks.every((task) => Array.isArray(task.evidence) && task.evidence.length > 0));
    const selectedEvidence = new Set(tasks.flatMap((task) => task.evidence || []));
    const finalEvidence = new Set(finalNarrative.tasks.flatMap((task) => task.evidence || []));
    assert(`lab ${lab.labNumber} assembly adds no unselected evidence`, Array.from(finalEvidence).every((item) => selectedEvidence.has(item)));
    const quality = checkLinuxFinalProductionQuality({
      context: candidate.investigation,
      assets: candidate.assets,
      simulation: candidate.simulation,
      lab: finalNarrative,
    });
    console.log(`PHASE70_REPLAY lab=${lab.labNumber} beforeScore=93 afterScore=${quality.finalProductionScore} passed=${quality.passed} issues=${quality.issues.length}`);
    assert(`lab ${lab.labNumber} final quality no untitled task issue`, !quality.issues.some((issue) => /Untitled task/i.test(issue.description)));
    assert(`lab ${lab.labNumber} final quality no missing evidence reference issue`, !quality.issues.some((issue) => /no evidence reference/i.test(issue.description)));
  }
}

main();
