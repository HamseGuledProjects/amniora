#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-narrative-contract-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function buildCandidate(buildLinuxAssetCandidate, difficulty, family, seed) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `${seed}:${difficulty}:${family}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
          title: "CyberLab Asset Pack",
        }, { incidentFamily: family });
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validNarrative(contract) {
  return {
    title: `${contract.scenarioFraming.hostname} evidence review`,
    objective: `Use the supplied evidence for ${contract.caseId} during ${contract.scenarioFraming.incidentWindow} ${contract.scenarioFraming.timezone}.`,
    scenario: `SOC analysts are reviewing ${contract.scenarioFraming.hostname}, a ${contract.scenarioFraming.hostRole}, using the rendered evidence pack for ticket ${contract.scenarioFraming.ticketId} and change ${contract.scenarioFraming.changeId}.`,
    tasks: contract.taskContracts.map((task) => {
      const evidence = task.selectedEvidence.slice(0, 3).map((asset) => asset.path);
      const firstSubject = task.groundedSubjects[0]?.id;
      const relation = task.groundedRelationships[0];
      const allowsCurrent = task.requiredCapabilities.some((capability) => capability.startsWith("current_"));
      return {
        task_id: task.taskId,
        task_intent: task.intent,
        phase: `Step ${task.order}`,
        title: `${task.objective} using the selected evidence.`,
        evidence,
        deliverable: `Prepare a ${task.deliverableType.replace(/_/g, " ")} with evidence references and uncertainty notes.`,
        claims: [
          {
            claim_class: allowsCurrent ? "current_state" : "observed",
            text: allowsCurrent
              ? `Current-state wording is limited to the selected evidence for ${task.objective}.`
              : `Observed evidence supports ${task.objective}.`,
            supporting_evidence: evidence.slice(0, 1),
            subjects: firstSubject ? [firstSubject] : [],
            relationships: relation ? [{ relation: relation.relation, subject_ids: relation.subjectIds }] : [],
            timestamps: task.allowedTimestamps.slice(0, 1),
          },
          {
            claim_class: "bounded_inference",
            text: "Any conclusion remains a bounded inference that requires validation against the selected artifacts.",
            supporting_evidence: evidence.slice(0, 1),
            subjects: firstSubject ? [firstSubject] : [],
            relationships: [],
            timestamps: [],
          },
        ],
      };
    }),
    hints: ["Start with the evidence listed for each task.", "Keep current state separate from historical logs.", "Use uncertainty where the artifacts do not prove a conclusion."],
    outcomes: ["Practice evidence-scoped Linux triage.", "Correlate canonical task evidence.", "Separate observation from inference."],
  };
}

function expectIssue(label, validate, contract, narrative, code) {
  const result = validate(contract, narrative);
  assert(label, !result.passed && result.issues.some((issue) => issue.code === code), result.issues.map((issue) => issue.code).join(", "));
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    buildLinuxNarrativeContract,
    buildLinuxCanonicalNarrativeBrief,
    assertLinuxTaskEvidenceClosureInvariant,
  } = require(path.join(out, "linux", "simulation.js"));
  const { validateLinuxGeneratedNarrativeAgainstContract } = require(path.join(out, "linux", "narrativeContract.js"));

  for (const [difficulty, family] of [
    ["Beginner", "ssh_bruteforce"],
    ["Intermediate", "service_account_misuse"],
    ["Advanced", "cron_persistence"],
  ]) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, difficulty, family, "phase4-contract");
    assertLinuxTaskEvidenceClosureInvariant(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    const again = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    assert(`${difficulty} contract task count`, contract.canonicalTaskCount === candidate.simulation.canonicalTasks.length);
    assert(`${difficulty} contract deterministic`, JSON.stringify(contract) === JSON.stringify(again));
    assert(`${difficulty} brief is serialized contract`, JSON.stringify(JSON.parse(buildLinuxCanonicalNarrativeBrief(contract))) === JSON.stringify(contract));
    assert(`${difficulty} evidence closure carried into contract`, contract.taskContracts.every((task) => task.evidenceClosure.satisfied));
    assert(`${difficulty} selected evidence only`, contract.taskContracts.every((task) => task.selectedEvidence.length >= 1 && task.selectedEvidence.length <= 3));
    const valid = validNarrative(contract);
    const validResult = validateLinuxGeneratedNarrativeAgainstContract(contract, valid);
    assert(`${difficulty} valid synthetic narrative`, validResult.passed, validResult.issues.map((issue) => issue.code).join(", "));

    const missing = clone(valid);
    missing.tasks.pop();
    expectIssue(`${difficulty} missing task rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, missing, "LINUX_NARRATIVE_TASK_COUNT_MISMATCH");

    const duplicate = clone(valid);
    duplicate.tasks[1].task_id = duplicate.tasks[0].task_id;
    expectIssue(`${difficulty} duplicate task rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, duplicate, "LINUX_NARRATIVE_TASK_DUPLICATE");

    const reordered = clone(valid);
    reordered.tasks.reverse();
    expectIssue(`${difficulty} reordered task rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, reordered, "LINUX_NARRATIVE_TASK_ORDER_MISMATCH");

    const wrongIntent = clone(valid);
    wrongIntent.tasks[0].task_intent = "risk_assessment";
    expectIssue(`${difficulty} altered intent rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, wrongIntent, "LINUX_NARRATIVE_INTENT_MISMATCH");

    const inventedEvidence = clone(valid);
    inventedEvidence.tasks[0].evidence[0] = "assets/logs/not_real.log";
    expectIssue(`${difficulty} invented evidence rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, inventedEvidence, "LINUX_NARRATIVE_UNRENDERED_EVIDENCE");

    const firstTaskEvidence = new Set(contract.taskContracts[0].selectedEvidence.map((item) => item.path));
    const selectedElsewhere = contract.taskContracts
      .flatMap((task) => task.selectedEvidence)
      .find((asset) => !firstTaskEvidence.has(asset.path));
    if (selectedElsewhere) {
      const wrongTaskEvidence = clone(valid);
      wrongTaskEvidence.tasks[0].evidence[0] = selectedElsewhere.path;
      expectIssue(`${difficulty} other-task evidence rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, wrongTaskEvidence, "LINUX_NARRATIVE_EVIDENCE_OUTSIDE_CONTRACT");
    }

    const wrongSubject = clone(valid);
    wrongSubject.tasks[0].claims[0].subjects = ["identity:not-a-real-user"];
    expectIssue(`${difficulty} invented subject rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, wrongSubject, "LINUX_NARRATIVE_UNKNOWN_SUBJECT");

    const wrongRelation = clone(valid);
    wrongRelation.tasks[0].claims[0].relationships = [{ relation: "opened_file", subject_ids: ["identity:not-a-real-user", "file:not-real"] }];
    expectIssue(`${difficulty} invented relationship rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, wrongRelation, "LINUX_NARRATIVE_UNSUPPORTED_RELATIONSHIP");

    const wrongTime = clone(valid);
    wrongTime.tasks[0].claims[0].text += " It occurred at 2099-01-01 00:00:00.";
    expectIssue(`${difficulty} invented timestamp rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, wrongTime, "LINUX_NARRATIVE_INVENTED_TIMESTAMP");

    const unsupportedCurrent = clone(valid);
    const noCurrentIndex = contract.taskContracts.findIndex((task) => !task.requiredCapabilities.some((capability) => capability.startsWith("current_")));
    if (noCurrentIndex >= 0) {
      unsupportedCurrent.tasks[noCurrentIndex].claims[0].claim_class = "current_state";
      unsupportedCurrent.tasks[noCurrentIndex].claims[0].text = "The process is currently running.";
      expectIssue(`${difficulty} unsupported current-state rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, unsupportedCurrent, "LINUX_NARRATIVE_UNSUPPORTED_CURRENT_STATE");
    }

    if (difficulty !== "Advanced") {
      const leak = clone(valid);
      leak.scenario += " Analysts should use assets/runtime/open_files.txt for proof.";
      expectIssue(`${difficulty} lower-tier advanced leakage rejected`, validateLinuxGeneratedNarrativeAgainstContract, contract, leak, "LINUX_NARRATIVE_ADVANCED_LEAK");
    }
  }
}

main();
