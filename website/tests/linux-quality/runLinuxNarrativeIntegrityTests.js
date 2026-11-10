#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-narrative-integrity-${Date.now()}`);
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

function syntheticTaskFromView(view) {
  const firstEvidence = view.allowedEvidence[0]?.path;
  const firstSubject = view.allowedSubjects[0]?.index;
  const firstRelationship = view.allowedRelationshipStatements[0];
  const firstTimestamp = view.allowedTimestamps[0]?.index;
  return {
    task_number: view.taskNumber,
    learner_intent: view.learnerIntent,
    phase: `Task ${view.taskNumber}`,
    title: `${view.learnerIntent} using listed evidence`,
    evidence: view.allowedEvidence.slice(0, 3).map((asset) => asset.path),
    deliverable: "Record a concise evidence-backed finding using only the listed evidence paths.",
    claims: [
      {
        claim_class: firstRelationship?.allowedClaimClass || "observed",
        text: firstRelationship?.learnerStatement || "The supplied evidence supports this task-local observation.",
        supporting_evidence: firstEvidence ? [firstEvidence] : [],
        subject_indexes: firstSubject ? [firstSubject] : [],
        relationship_statement_indexes: firstRelationship ? [firstRelationship.index] : [],
        timestamp_indexes: firstTimestamp ? [firstTimestamp] : [],
      },
    ],
  };
}

function buildCandidate(buildLinuxAssetCandidate, difficulty, family, duration) {
  let lastError;
  for (let draw = 0; draw < 80; draw += 1) {
    const seed = `phase2-integrity-${difficulty}-${family}:draw:${draw}`;
    try {
      const candidate = buildLinuxAssetCandidate({
          seed: seed,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration,
          title: "CyberLab Asset Pack",
          seed,
        }, { incidentFamily: family });
      if (candidate.investigation.incidentFamily === family) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${difficulty} ${family}`);
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxNarrativeContract } = require(path.join(out, "linux", "simulation.js"));
  const { validateLinuxGeneratedNarrativeAgainstContract } = require(path.join(out, "linux", "narrativeContract.js"));
  const {
    adaptLinuxGeneratedTaskFromView,
    buildLinuxTaskGenerationView,
  } = require(path.join(out, "linux", "narrativeGenerationView.js"));
  const {
    buildLinuxAssembledNarrative,
    finalLinuxNarrativeFromAssembled,
  } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const { assertLinuxStudentContent } = require(path.join(out, "linux", "studentContentValidation.js"));
  const {
    assertLinuxNarrativeHashUnchanged,
    assertLinuxStudentNarrativeIntegrity,
    finalizeLinuxNarrativeText,
    hashLinuxStudentNarrativeObject,
    linuxNarrativeStructureDiagnostic,
    validateLinuxNarrativeTextIntegrity,
    validateLinuxStudentNarrativeIntegrity,
  } = require(path.join(out, "linux", "narrativeIntegrity.js"));

  const failing = [
    ["Create a risk summary with evidence-preserving", "LINUX_NARRATIVE_INCOMPLETE_TEXT"],
    ["Create a risk summary with evidence-preserving and", "LINUX_NARRATIVE_INCOMPLETE_TEXT"],
    ["Include only entries supported by the supplied,c", "LINUX_NARRATIVE_CORRUPTED_TEXT"],
    ["Document the account, source IP,", "LINUX_NARRATIVE_INCOMPLETE_TEXT"],
    ["Include:", "LINUX_NARRATIVE_INCOMPLETE_TEXT"],
    ["Use evidence from", "LINUX_NARRATIVE_INCOMPLETE_TEXT"],
    ["Compare the policy (", "LINUX_NARRATIVE_UNBALANCED_STRUCTURE"],
    ["Reference [the supplied evidence", "LINUX_NARRATIVE_UNBALANCED_STRUCTURE"],
    ["Use \"the approved evidence", "LINUX_NARRATIVE_UNBALANCED_STRUCTURE"],
    ["Use the supplied evidence.\n```bash\njournalctl -u ssh", "LINUX_NARRATIVE_UNBALANCED_STRUCTURE"],
    ["Create rows for:\n1. Account\n2.", "LINUX_NARRATIVE_UNBALANCED_STRUCTURE"],
    ["Use the supplied_", "LINUX_NARRATIVE_INCOMPLETE_TEXT"],
    ["Use the evidence \uFFFD", "LINUX_NARRATIVE_CORRUPTED_TEXT"],
    ["recommendations constrained to evidence-preserving", "LINUX_NARRATIVE_INCOMPLETE_TEXT"],
    ["supported by the supplied,c", "LINUX_NARRATIVE_CORRUPTED_TEXT"],
  ];
  for (const [text, code] of failing) {
    const result = validateLinuxNarrativeTextIntegrity(text, {
      field: "task.deliverable",
      kind: "deliverable",
      maxLength: 320,
      mutationStage: "test",
    });
    assert(`rejects ${text}`, !result.passed && result.issues.some((issue) => issue.code === code), JSON.stringify(result.issues));
  }

  const structureCases = [
    ['Use "the approved evidence', "quote", 1, 0],
    ["Compare the policy (using listed evidence.", "parenthesis", 1, 0],
    ["Reference [the supplied evidence.", "bracket", 1, 0],
    ["Use the supplied evidence.\n```bash\njournalctl -u ssh", "code_fence", 1, 0],
    ["Create rows for:\n1. Account\n2.", "numbered_list", 1, 0],
  ];
  for (const [text, structure, opening, closing] of structureCases) {
    const diagnostic = linuxNarrativeStructureDiagnostic(text);
    assert(
      `structure diagnostic reports ${structure}`,
      diagnostic.unmatchedStructureType === structure &&
        diagnostic.openingCount === opening &&
        diagnostic.closingCount === closing,
      JSON.stringify(diagnostic)
    );
  }

  const passing = [
    ["Review SSH sign-in records", "title"],
    ["Investigation", "label"],
    ["List three findings.", "deliverable"],
    ["At 04:22:20, the intern account opened an SSH session.", "deliverable"],
    ["Compare the observed command with the supplied policy.", "deliverable"],
    ["Document whether the exact SSH key can be identified from the evidence.", "deliverable"],
    ["Use evidence from `assets/logs/auth.log`.", "deliverable"],
  ];
  for (const [text, kind] of passing) {
    const result = validateLinuxNarrativeTextIntegrity(text, {
      field: "field",
      kind,
      maxLength: 320,
    });
    assert(`passes ${text}`, result.passed, JSON.stringify(result.issues));
  }

  const maxLength = `${"Document whether the supplied evidence supports the observed account activity".padEnd(319, "x")}.`;
  const maxResult = validateLinuxNarrativeTextIntegrity(maxLength, {
    field: "task.deliverable",
    kind: "deliverable",
    maxLength: 320,
  });
  assert("deliverable exactly at max length passes when complete", maxResult.passed, JSON.stringify(maxResult.issues));

  const numberedLost = validateLinuxNarrativeTextIntegrity("Include:\n1. Account\n2. Source IP", {
    field: "task.deliverable",
    kind: "deliverable",
    beforeMutation: "Include:\n1. Account\n2. Source IP\n3. Timestamp",
    mutationStage: "shortening",
  });
  assert("numbered list losing last item is rejected", !numberedLost.passed && numberedLost.issues.some((issue) => issue.code === "LINUX_NARRATIVE_REQUIRED_CONTENT_LOST"), JSON.stringify(numberedLost.issues));

  const removedRestriction = validateLinuxNarrativeTextIntegrity("Create a concise finding table.", {
    field: "task.deliverable",
    kind: "deliverable",
    beforeMutation: "Create a concise finding table using only the listed evidence paths.",
    mutationStage: "shortening",
  });
  assert("required evidence restriction removed during shortening is rejected", !removedRestriction.passed && removedRestriction.issues.some((issue) => issue.code === "LINUX_NARRATIVE_REQUIRED_CONTENT_LOST"), JSON.stringify(removedRestriction.issues));

  assert(
    "cleanup removing final word is rejected",
    (() => {
      try {
        finalizeLinuxNarrativeText("Compare the policy and", {
          field: "task.deliverable",
          kind: "deliverable",
          maxLength: 320,
          mutationStage: "cleanup",
        });
        return false;
      } catch (error) {
        return /LINUX_NARRATIVE_INCOMPLETE_TEXT/.test(String(error));
      }
    })()
  );

  assert(
    "fallback containing incomplete text is rejected",
    (() => {
      try {
        finalizeLinuxNarrativeText("x".repeat(400), {
          field: "task.deliverable",
          kind: "deliverable",
          maxLength: 80,
          fallback: "Use evidence from",
          mutationStage: "fallback",
        });
        return false;
      } catch (error) {
        return /LINUX_NARRATIVE_INCOMPLETE_TEXT/.test(String(error));
      }
    })()
  );

  const emptyAfterSanitization = validateLinuxNarrativeTextIntegrity("   ", {
    field: "task.deliverable",
    kind: "deliverable",
  });
  assert("task that becomes empty is rejected", !emptyAfterSanitization.passed);

  const goodObject = {
    title: "Linux evidence review on app-lnx-01",
    topic: "Linux",
    difficulty: "Beginner",
    estimated_time: "30 mins",
    objective: "Use the supplied evidence to document host activity during the review window.",
    scenario: "Analysts are reviewing app-lnx-01 with the supplied evidence pack.",
    tasks: [
      JSON.stringify({
        phase: "Task 1",
        title: "Review SSH sign-in records",
        evidence: ["assets/logs/auth.log"],
        deliverable: "List three findings using only the listed evidence paths.",
      }),
    ],
    hints: ["Start with the timestamped sign-in record."],
    outcomes: ["Document evidence-backed findings."],
  };
  const hash = hashLinuxStudentNarrativeObject(goodObject);
  assert("student narrative hash is stable", hash === hashLinuxStudentNarrativeObject(JSON.parse(JSON.stringify(goodObject))));
  assert(
    "valid field changed after validation is detected",
    (() => {
      try {
        assertLinuxNarrativeHashUnchanged({
          before: goodObject,
          after: { ...goodObject, scenario: `${goodObject.scenario} Extra post-validation text.` },
          stage: "test mutation",
        });
        return false;
      } catch (error) {
        return /LINUX_NARRATIVE_MUTATED_AFTER_VALIDATION/.test(String(error));
      }
    })()
  );

  const badQuality = checkLinuxFinalProductionQuality({
    assets: [],
    lab: {
      ...goodObject,
      tasks: [{ phase: "Task 1", title: "Review SSH sign-in records", evidence: ["assets/logs/auth.log"], deliverable: "Include only entries supported by the supplied,c" }],
    },
  });
  assert("final quality blocks corrupted narrative text", !badQuality.passed && badQuality.issues.some((issue) => /LINUX_NARRATIVE_CORRUPTED_TEXT/.test(issue.description)), JSON.stringify(badQuality.issues));

  const matrix = [
    ["Beginner", "ssh_bruteforce", "30 mins"],
    ["Intermediate", "systemd_persistence", "30 mins"],
    ["Advanced", "cron_persistence", "60 mins"],
  ];
  for (const [difficulty, family, duration] of matrix) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, difficulty, family, duration);
    const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    const tasks = contract.taskContracts.map((task) => {
      const view = buildLinuxTaskGenerationView({ contract, task });
      return adaptLinuxGeneratedTaskFromView({ task, generated: syntheticTaskFromView(view) });
    });
    for (const [index, task] of tasks.entries()) {
      const result = validateLinuxGeneratedNarrativeAgainstContract(taskIsolatedContract(contract, contract.taskContracts[index]), {
        title: "Linux task evidence review",
        objective: `Use selected evidence for ${contract.caseId}.`,
        scenario: `${contract.scenarioFraming.hostname} task-local evidence review.`,
        tasks: [task],
        hints: ["Use selected task evidence."],
        outcomes: ["Task-local evidence review."],
      });
      assert(`${difficulty} task ${index + 1} internal grounding still runs`, result.passed, result.issues.map((issue) => issue.code).join(", "));
    }
    const assembled = buildLinuxAssembledNarrative({
      contract,
      context: candidate.investigation,
      difficulty,
      duration,
      tasks,
    });
    const finalNarrative = finalLinuxNarrativeFromAssembled({ lab: assembled });
    assert(`${difficulty} final narrative integrity passes`, validateLinuxStudentNarrativeIntegrity(finalNarrative).passed);
    assertLinuxStudentContent({ ...finalNarrative, assets: candidate.assets });
    const savedTasks = finalNarrative.tasks.map((task) => JSON.stringify({
      phase: task.phase,
      title: task.title,
      evidence: task.evidence,
      deliverable: task.deliverable,
    }));
    const savedObject = {
      title: finalNarrative.title,
      topic: finalNarrative.category,
      difficulty: finalNarrative.difficulty,
      estimated_time: finalNarrative.duration,
      objective: finalNarrative.objective,
      scenario: finalNarrative.scenario,
      tasks: savedTasks,
      hints: finalNarrative.hints,
      outcomes: finalNarrative.outcomes,
    };
    assert(`${difficulty} saved task shape remains compatible`, savedTasks.every((item) => {
      const parsed = JSON.parse(item);
      return Object.keys(parsed).sort().join("|") === "deliverable|evidence|phase|title";
    }));
    assert(`${difficulty} final integrity hash matches pre-save object`, hashLinuxStudentNarrativeObject(savedObject) === hashLinuxStudentNarrativeObject(JSON.parse(JSON.stringify(savedObject))));
  }
}

main();
