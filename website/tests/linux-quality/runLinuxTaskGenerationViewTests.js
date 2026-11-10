#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const PHASE63_DIR = path.join(ROOT, "test-output", "linux-live-api-task-isolated-pilot", "2026-07-26T23-32-57-187Z");
const RELATIONSHIP_KEYS = [
  "authenticated_as",
  "executed_by",
  "spawned_process",
  "opened_file",
  "covered_by_change",
  "inside_maintenance_window",
  "transitioned_service",
  "defines_schedule",
  "installed_package",
];

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-task-generation-view-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function buildCandidate(buildLinuxAssetCandidate, difficulty, family, duration, seed) {
  let lastError;
  for (let draw = 0; draw < 100; draw += 1) {
    const generationSeed = `${seed}:draw:${draw}`;
    try {
      const candidate = buildLinuxAssetCandidate({
          seed: generationSeed,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration,
          title: "CyberLab Asset Pack",
          seed: generationSeed,
        }, { incidentFamily: family });
      if (candidate.investigation.incidentFamily === family) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${difficulty} ${family}`);
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function oldPromptLeakTokens(prompt) {
  const patterns = [
    /\b(?:identity|session|command|process|descriptor|file|service|transition|cron|scheduled|package|maintenance|event):[A-Za-z0-9._:@-]+/g,
    /\btask:\d+:[A-Za-z0-9_-]+\b/g,
    /\b(?:authenticated_as|executed_by|spawned_process|opened_file|covered_by_change|inside_maintenance_window|transitioned_service|defines_schedule|installed_package)\b/g,
    /\b(?:selectedEvidence|groundedSubjects|groundedRelationships|requiredCapabilities|evidenceClosure|prohibitedCapabilityClaims)\b/g,
  ];
  return [...new Set(patterns.flatMap((pattern) => Array.from(prompt.matchAll(pattern), (match) => match[0])))];
}

function syntheticTaskFromView(view) {
  const firstEvidence = view.allowedEvidence[0]?.path;
  const firstSubject = view.allowedSubjects[0]?.index;
  const firstRelationship = view.allowedRelationshipStatements[0];
  const firstTimestamp = view.allowedTimestamps[0]?.index;
  const allowsCurrent = view.allowedCurrentStateStatements.some((item) => !/^No current-state conclusion/i.test(item));
  return {
    task_number: view.taskNumber,
    learner_intent: view.learnerIntent,
    phase: `Task ${view.taskNumber}`,
    title: `${view.learnerIntent} using selected evidence`,
    evidence: view.allowedEvidence.slice(0, 3).map((asset) => asset.path),
    deliverable: view.learnerInstruction,
    claims: [
      {
        claim_class: allowsCurrent ? "current_state" : firstRelationship?.allowedClaimClass || "observed",
        text: firstRelationship
          ? firstRelationship.learnerStatement
          : view.allowedHistoricalStatements[0] || "The supplied evidence supports the task note.",
        supporting_evidence: firstEvidence ? [firstEvidence] : [],
        subject_indexes: firstSubject ? [firstSubject] : [],
        relationship_statement_indexes: firstRelationship ? [firstRelationship.index] : [],
        timestamp_indexes: firstTimestamp ? [firstTimestamp] : [],
      },
      {
        claim_class: "bounded_inference",
        text: "Any conclusion remains limited to the supplied evidence and may require additional validation.",
        supporting_evidence: firstEvidence ? [firstEvidence] : [],
        subject_indexes: firstSubject ? [firstSubject] : [],
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
  const {
    adaptLinuxGeneratedTaskFromView,
    buildLinuxTaskGenerationView,
    relationshipMappingsForTask,
    scanLinuxModelFacingPayload,
    serializeLinuxTaskGenerationPrompt,
  } = require(path.join(out, "linux", "narrativeGenerationView.js"));

  const matrix = [
    ["Beginner", "ssh_bruteforce", "30 mins"],
    ["Intermediate", "systemd_persistence", "30 mins"],
    ["Advanced", "cron_persistence", "60 mins"],
    ["Advanced", "unauthorized_package_install", "60 mins"],
    ["Advanced", "service_account_misuse", "60 mins"],
  ];
  const relationTypes = new Set();
  const promptSizes = [];

  for (const [difficulty, family, duration] of matrix) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, difficulty, family, duration, `phase64-${difficulty}-${family}`);
    assertLinuxTaskEvidenceClosureInvariant(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    const rendered = new Set(contract.globalRenderedEvidencePaths);
    for (const task of contract.taskContracts) {
      const view = buildLinuxTaskGenerationView({ contract, task });
      const prompt = serializeLinuxTaskGenerationPrompt({ view });
      const scan = scanLinuxModelFacingPayload(prompt, `${difficulty}:${task.intent}`);
      assert(`${difficulty} ${task.intent} sanitized prompt has no internal details`, scan.length === 0, JSON.stringify(scan.slice(0, 5)));
      assert(`${difficulty} ${task.intent} evidence paths are exact`, view.allowedEvidence.every((asset) => task.selectedEvidence.some((selected) => selected.path === asset.path)));
      assert(`${difficulty} ${task.intent} evidence paths are rendered`, view.allowedEvidence.every((asset) => rendered.has(asset.path)));
      assert(`${difficulty} ${task.intent} subjects use indexes`, view.allowedSubjects.every((subject, index) => subject.index === index + 1 && !String(subject.display).includes("identity:")));
      assert(`${difficulty} ${task.intent} capabilities are learner-facing`, view.allowedCapabilityDescriptions.every((item) => !/[a-z]+_[a-z_]+/.test(item)));
      assert(`${difficulty} ${task.intent} current-state boundary serialized`, view.allowedCurrentStateStatements.length > 0);
      assert(`${difficulty} ${task.intent} recommendation boundary serialized`, view.allowedRecommendationStatements.length > 0);
      assert(`${difficulty} ${task.intent} timestamp indexes are stable`, view.allowedTimestamps.every((timestamp, index) => timestamp.index === index + 1));
      assert(`${difficulty} ${task.intent} timestamp statements match indexes`, view.allowedTimestampStatements.length === view.allowedTimestamps.length);
      const mappings = relationshipMappingsForTask(task);
      for (const mapping of mappings) relationTypes.add(mapping.relation);
      assert(`${difficulty} ${task.intent} relationship indexes map one-to-one`, mappings.length === view.allowedRelationshipStatements.length);
      assert(`${difficulty} ${task.intent} relationship statements hide keys`, view.allowedRelationshipStatements.every((item) => !RELATIONSHIP_KEYS.some((key) => item.learnerStatement.includes(key))));
      const generated = syntheticTaskFromView(view);
      const adapted = adaptLinuxGeneratedTaskFromView({ task, generated });
      const oneTaskContract = {
        ...contract,
        canonicalTaskCount: 1,
        globalRenderedEvidencePaths: task.selectedEvidence.map((asset) => asset.path).sort(),
        globalGroundedSubjects: task.groundedSubjects,
        globalGroundedRelationships: task.groundedRelationships,
        globalAllowedTimestamps: task.allowedTimestamps,
        taskContracts: [task],
      };
      const result = validateLinuxGeneratedNarrativeAgainstContract(oneTaskContract, {
        title: "Linux task evidence review",
        objective: `Use selected evidence for ${contract.caseId} during ${contract.scenarioFraming.incidentWindow} ${contract.scenarioFraming.timezone}.`,
        scenario: `${contract.scenarioFraming.hostname} is reviewed as a ${contract.scenarioFraming.hostRole}.`,
        tasks: [adapted],
        hints: ["Use only selected task evidence.", "Keep the task-local scope.", "Separate observation from uncertainty."],
        outcomes: ["Task-local evidence review.", "Supported claim mapping.", "Bounded analyst notes."],
      });
      assert(`${difficulty} ${task.intent} adapted synthetic output passes frozen validator`, result.passed, result.issues.map((issue) => issue.code).join(", "));
      promptSizes.push({ difficulty, intent: task.intent, sanitized: Math.ceil(prompt.length / 4) });
    }
  }

  for (const relation of ["authenticated_as", "executed_by", "spawned_process", "opened_file", "defines_schedule", "installed_package"]) {
    assert(`representative relationship covered: ${relation}`, relationTypes.has(relation), Array.from(relationTypes).sort().join(", "));
  }
  const syntheticServiceTask = {
    groundedSubjects: [
      { id: "transition:synthetic", label: "sshd restart at 03:12:00", type: "service_transition" },
      { id: "service:ssh", label: "ssh.service", type: "service" },
    ],
    groundedRelationships: [
      { relation: "transitioned_service", subjectIds: ["transition:synthetic", "service:ssh"], subjectLabels: [] },
      { relation: "service_transition", subjectIds: ["transition:synthetic", "service:ssh"], subjectLabels: [] },
    ],
  };
  const syntheticServiceMappings = relationshipMappingsForTask(syntheticServiceTask);
  assert(
    "representative relationship covered: service transition family",
    syntheticServiceMappings.every((item) => /service evidence records/i.test(item.learnerStatement) && !RELATIONSHIP_KEYS.some((key) => item.learnerStatement.includes(key))),
    JSON.stringify(syntheticServiceMappings)
  );

  assert("scanner rejects known canonical ID", scanLinuxModelFacingPayload("identity:backup command:incident:primary task:2:actor_attribution").some((issue) => issue.category === "canonical_id"));
  assert("scanner rejects relationship key", scanLinuxModelFacingPayload("executed_by opened_file authenticated_as").some((issue) => issue.category === "relationship_key"));
  assert("scanner rejects validator code", scanLinuxModelFacingPayload("LINUX_NARRATIVE_INTERNAL_DETAIL_LEAK").some((issue) => issue.category === "validator_issue_code"));
  assert("scanner rejects local development path", scanLinuxModelFacingPayload("C:\\Users\\example\\Desktop\\cyberlab\\lib\\lab-assets\\linux\\simulation.ts").some((issue) => issue.category === "local_path"));

  if (fs.existsSync(path.join(PHASE63_DIR, "rejected-task-attempts.json"))) {
    const rejected = JSON.parse(fs.readFileSync(path.join(PHASE63_DIR, "rejected-task-attempts.json"), "utf8"));
    const internalLeakRows = rejected.filter((row) => (row.validationIssueCodes || []).includes("LINUX_NARRATIVE_INTERNAL_DETAIL_LEAK"));
    assert("Phase 6.3 replay has internal-detail leak rows", internalLeakRows.length > 0);
    const oldLeakRows = internalLeakRows.filter((row) => oldPromptLeakTokens(row.prompt || "").length > 0);
    assert("Phase 6.3 old prompts exposed internal contract fields", oldLeakRows.length > 0);
    const replayRow = oldLeakRows[0];
    const oneTaskContract = replayRow.oneTaskContract;
    const task = oneTaskContract.taskContracts[0];
    const view = buildLinuxTaskGenerationView({ contract: oneTaskContract, task });
    const newPrompt = serializeLinuxTaskGenerationPrompt({ view });
    const newScan = scanLinuxModelFacingPayload(newPrompt, "phase63 replay sanitized prompt");
    assert("Phase 6.3 replay sanitized prompt removes internal details", newScan.length === 0, JSON.stringify(newScan.slice(0, 5)));
    assert("Phase 6.3 replay keeps exact evidence paths", task.selectedEvidence.every((asset) => newPrompt.includes(asset.path)));
    assert("Phase 6.3 replay pre-serializes relationships", view.allowedRelationshipStatements.length === task.groundedRelationships.length);
    const oldPromptTokens = Math.ceil((replayRow.prompt || "").length / 4);
    const newPromptTokens = Math.ceil(newPrompt.length / 4);
    assert("Phase 6.3 replay sanitized prompt is smaller", newPromptTokens < oldPromptTokens, `${newPromptTokens} >= ${oldPromptTokens}`);
    promptSizes.push({ difficulty: replayRow.difficulty, intent: replayRow.taskIntent, oldPromptTokens, sanitized: newPromptTokens });
  }

  console.log("PROMPT_SIZE_SAMPLES", JSON.stringify(promptSizes.slice(0, 8), null, 2));
}

main();
