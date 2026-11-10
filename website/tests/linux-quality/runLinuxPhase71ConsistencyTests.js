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
  const build = path.join(os.tmpdir(), `cyberlab-linux-phase71-${Date.now()}`);
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

function buildCandidate(buildLinuxAssetCandidate, lab) {
  if (lab.exactGenerationSeed) {
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
  let lastError;
  for (let draw = 0; draw < 20; draw += 1) {
    const generationSeed = `${lab.generationSeed}:retry:${draw}`;
    try {
      return buildLinuxAssetCandidate({
          seed: generationSeed,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty: lab.difficulty,
          duration: lab.duration,
          title: "CyberLab Asset Pack",
          seed: generationSeed,
        }, { incidentFamily: lab.family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${lab.difficulty} ${lab.family}`);
}

function buildExactCandidate(buildLinuxAssetCandidate, lab) {
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
  const { buildLinuxNarrativeContract } = require(path.join(out, "linux", "simulation.js"));
  const { validateLinuxGeneratedNarrativeAgainstContract } = require(path.join(out, "linux", "narrativeContract.js"));
  const { adaptLinuxGeneratedTaskFromView, buildLinuxTaskGenerationView } = require(path.join(out, "linux", "narrativeGenerationView.js"));
  const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const { linuxCapabilityEvidenceSemantics, LINUX_CAPABILITY_EVIDENCE_MATRIX } = require(path.join(out, "linux", "capabilityEvidenceMatrix.js"));

  assert("capability matrix has explicit semantics", LINUX_CAPABILITY_EVIDENCE_MATRIX.length >= 10);
  const serviceInventorySemantics = linuxCapabilityEvidenceSemantics("service_inventory");
  assert("service inventory supports current service state", serviceInventorySemantics.supportedCapabilities.includes("current_service_state"));
  assert("service inventory does not support static configuration", serviceInventorySemantics.supportsConfiguration === false);
  assert("service inventory does not advertise configuration baseline", !serviceInventorySemantics.supportedCapabilities.includes("configuration_baseline"));
  assert("service inventory does not support sudo policy state", serviceInventorySemantics.unsupportedCapabilities.includes("current_policy_state"));
  assert("service inventory does not support persistence execution", serviceInventorySemantics.supportsPersistenceExecution === false);
  assert("journal/syslog is historical not current", linuxCapabilityEvidenceSemantics("journal_or_syslog").supportsCurrentState === false);
  assert("cron file definition is not execution", linuxCapabilityEvidenceSemantics("cron_file").supportsPersistenceExecution === false);

  const lab = {
    labNumber: 2,
    difficulty: "Intermediate",
    family: "systemd_persistence",
    duration: "30 mins",
    generationSeed: "phase8-matrix:Intermediate:systemd_persistence:0",
  };
  const candidate = buildExactCandidate(buildLinuxAssetCandidate, lab);
  assert("exact replay family", candidate.investigation.incidentFamily === lab.family);
  const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
  const configTask = contract.taskContracts.find((task) => task.intent === "configuration_review");
  assert("contract includes configuration review", Boolean(configTask), contract.taskContracts.map((task) => task.intent).join("|"));
  assert("configuration task requires only baseline", configTask.requiredCapabilities.join("|") === "configuration_baseline", configTask.requiredCapabilities.join("|"));
  assert("configuration task has no canonical current-state requirements", configTask.evidenceClosure.requiredCurrentStateCapabilities.length === 0);
  assert("configuration task selects static config evidence", configTask.selectedEvidence.some((asset) => asset.path === "assets/configs/linux_config_pack.txt"), configTask.selectedEvidence.map((asset) => asset.path).join("|"));
  const registryAsset = candidate.simulation.evidenceRegistry.find((asset) => asset.path === "assets/reports/service_inventory.txt");
  assert("service inventory registry asset exists", Boolean(registryAsset));
  assert("service inventory metadata includes current service state", registryAsset.capabilities.includes("current_service_state"));
  assert("service inventory metadata excludes configuration baseline", !registryAsset.capabilities.includes("configuration_baseline"));
  assert("service inventory metadata excludes current policy state", !registryAsset.capabilities.includes("current_policy_state"));
  const serviceInventory = candidate.assets.find((asset) => asset.file_path === "assets/reports/service_inventory.txt");
  assert("service inventory rendered", Boolean(serviceInventory));
  assert("service inventory contains service state columns", /unit|load|active|sub|result|unit_file|path/i.test(serviceInventory.content.split(/\r?\n/)[0]), serviceInventory.content.split(/\r?\n/)[0]);
  assert("service inventory has collection snapshot metadata", registryAsset.stateType === "collection_snapshot", registryAsset.stateType);

  const view = buildLinuxTaskGenerationView({ contract, task: configTask });
  assert("sanitized config view does not permit current-state claim", view.allowedCurrentStateStatements.every((item) => /^No current-state conclusion/.test(item)));
  assert("sanitized config wording stays baseline scoped", view.allowedCapabilityDescriptions.join("\n").includes("configuration evidence"));

  const configTaskIndex = contract.taskContracts.indexOf(configTask);
  const tasks = contract.taskContracts.map((taskContract) =>
    adaptLinuxGeneratedTaskFromView({
      task: taskContract,
      generated: syntheticIndexedResponse(buildLinuxTaskGenerationView({ contract, task: taskContract }), contract.incidentFamily),
    })
  );
  const configOutput = tasks[configTaskIndex];
  assert("accepted config output stayed observed/historical", configOutput.claims.every((claim) => claim.claim_class !== "current_state"));
  assert("accepted config output cites only selected evidence", configOutput.evidence.every((assetPath) => configTask.selectedEvidence.some((asset) => asset.path === assetPath)));

  const assembled = buildLinuxAssembledNarrative({
    contract,
    context: candidate.investigation,
    difficulty: lab.difficulty,
    duration: lab.duration,
    tasks,
  });
  const contractResult = validateLinuxGeneratedNarrativeAgainstContract(contract, assembled);
  assert("exact replay assembled contract passes", contractResult.passed, contractResult.issues.map((issue) => issue.code).join(", "));
  const finalNarrative = finalLinuxNarrativeFromAssembled({ lab: assembled });
  const quality = checkLinuxFinalProductionQuality({
    context: candidate.investigation,
    assets: candidate.assets,
    simulation: candidate.simulation,
    lab: finalNarrative,
  });
  console.log(`PHASE71_REPLAY beforeScore=95 afterScore=${quality.finalProductionScore} passed=${quality.passed} issues=${quality.issues.length}`);
  assert("exact replay final quality ran", typeof quality.passed === "boolean");
  assert("exact replay has no current policy/config false positives", !quality.issues.some((issue) => /current-state evidence/.test(issue.description)));
  assert("exact replay has no generic learning outcome issue", !quality.issues.some((issue) => /learning outcomes are too generic/.test(issue.description)));

  for (const family of ["systemd_persistence", "cron_persistence", "ssh_bruteforce", "unauthorized_package_install", "service_account_misuse"]) {
    for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
      const scenario = {
        difficulty,
        family,
        duration: difficulty === "Advanced" ? "60 mins" : difficulty === "Intermediate" ? "45 mins" : "30 mins",
        generationSeed: `phase71-${difficulty}-${family}:draw:1`,
      };
      const generated = buildCandidate(buildLinuxAssetCandidate, scenario);
      const generatedContract = buildLinuxNarrativeContract(generated.simulation, generated.assets.map((asset) => asset.file_path));
      for (const task of generatedContract.taskContracts) {
        for (const capability of task.evidenceClosure.requiredCurrentStateCapabilities) {
          const selected = task.selectedEvidence.map((asset) => asset.path).join("|");
          assert(
            `${difficulty} ${family} ${task.intent} current ${capability} has selected support`,
            task.selectedEvidence.some((asset) => asset.capabilities.includes(capability)),
            `selected=${selected}`
          );
        }
      }
    }
  }
}

main();
