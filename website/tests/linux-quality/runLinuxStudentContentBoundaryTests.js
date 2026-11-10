#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-student-boundary-${Date.now()}`);
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

function validStudentLab() {
  return {
    title: "Linux evidence review on jump-lnx-01",
    topic: "Linux",
    objective: "Identify the SSH account and source IP using auth.log and journal evidence.",
    scenario: "Analysts are reviewing jump-lnx-01 during 04:20-04:30 UTC.",
    tasks: [
      {
        phase: "Task 1",
        title: "Identify SSH account and source IP",
        description: "Use auth.log to connect the observed sign-in to a readable account and source address.",
        deliverable: "List the account, source IP, evidence path, and confidence boundary.",
      },
      {
        phase: "Task 2",
        title: "Reconstruct ordered timeline",
        description: "At 04:22:20, compare the event with the next timestamped log entry.",
        deliverable: "List three findings in timestamp order.",
      },
    ],
    hints: ["Use the first evidence file before comparing Port 22 listener state."],
    outcomes: ["Correlate PID 2204 with its command and file evidence."],
  };
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
    deliverable: view.learnerInstruction,
    claims: [
      {
        claim_class: firstRelationship?.allowedClaimClass || "observed",
        text: firstRelationship?.learnerStatement || "The supplied evidence supports the task-local observation.",
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

function buildCandidate(buildLinuxAssetCandidate, difficulty, family, duration, seed) {
  let lastError;
  for (let draw = 0; draw < 80; draw += 1) {
    const generationSeed = `${seed}:draw:${draw}`;
    try {
      return buildLinuxAssetCandidate({
          seed: generationSeed,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
        difficulty,
        duration,
        title: "CyberLab Asset Pack",
        seed: generationSeed,
      }, { incidentFamily: family });
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
    serializeLinuxTaskGenerationPrompt,
  } = require(path.join(out, "linux", "narrativeGenerationView.js"));
  const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const {
    validateLinuxStudentContent,
    assertLinuxStudentContent,
  } = require(path.join(out, "linux", "studentContentValidation.js"));

  assert("positive student content passes", validateLinuxStudentContent(validStudentLab()).passed);

  const leakTerms = [
    "capability_key",
    "subject_indexes",
    "Subject Index",
    "timestamp_indexes",
    "Timestamp Index(es)",
    "relationship_statement_indexes",
    "Relationship Statement Index",
    "approved statements",
    "accepted evidence contracts",
    "canonical subject",
    "canonical relationship",
    "evidence registry",
    "planning registry",
    "internal capability",
    "identity:backup",
    "subject 1",
    "subject #2",
    "the approved subject",
    "subject-indexes",
    "ReLaTioNship, statement; index",
  ];
  const fieldMutations = [
    ["title", (lab, value) => { lab.title = value; }],
    ["topic", (lab, value) => { lab.topic = value; }],
    ["objective", (lab, value) => { lab.objective = value; }],
    ["scenario", (lab, value) => { lab.scenario = value; }],
    ["task phase", (lab, value) => { lab.tasks[0].phase = value; }],
    ["task title", (lab, value) => { lab.tasks[0].title = value; }],
    ["task description", (lab, value) => { lab.tasks[0].description = value; }],
    ["task deliverable", (lab, value) => { lab.tasks[0].deliverable = value; }],
    ["hint", (lab, value) => { lab.hints[0] = value; }],
    ["outcome", (lab, value) => { lab.outcomes[0] = value; }],
    ["asset prose", (lab, value) => { lab.assets = [{ file_path: "assets/evidence/incident_brief.md", content: value }]; }],
  ];
  for (const term of leakTerms) {
    for (const [field, mutate] of fieldMutations) {
      const lab = validStudentLab();
      mutate(lab, `Review ${term} before writing notes.`);
      const result = validateLinuxStudentContent(lab);
      assert(`leak rejected in ${field}: ${term}`, !result.passed, JSON.stringify(result.issues));
    }
  }

  const falsePositiveLab = validStudentLab();
  falsePositiveLab.objective = [
    "Task 1",
    "Step 2",
    "Port 22",
    "PID 2204",
    "List three findings",
    "Use the first evidence file",
    "At 04:22:20, the account logged in",
  ].join(". ");
  assert("false-positive examples pass", validateLinuxStudentContent(falsePositiveLab).passed);

  const matrix = [
    ["Beginner", "ssh_bruteforce", "30 mins"],
    ["Intermediate", "systemd_persistence", "45 mins"],
    ["Advanced", "cron_persistence", "60 mins"],
  ];
  for (const [difficulty, family, duration] of matrix) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, difficulty, family, duration, `student-boundary-${difficulty}-${family}`);
    const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    const generatedTasks = [];
    for (const task of contract.taskContracts) {
      const view = buildLinuxTaskGenerationView({ contract, task });
      assert(`${difficulty} ${task.intent} keeps internal subject references`, view.allowedSubjects.every((subject, index) => subject.index === index + 1));
      const prompt = serializeLinuxTaskGenerationPrompt({ view });
      assert(`${difficulty} ${task.intent} prompt does not present old internal terms as usable prose`, !/(Use only .*subject indexes|Use only .*timestamp indexes|Use only .*relationship statement indexes|using only .*approved statements|limited to .*accepted evidence contracts)/i.test(prompt));
      assert(`${difficulty} ${task.intent} prompt forbids learner-facing internal terms`, /Do not mention .*approved statements.*accepted evidence contracts.*undefined numbered subjects/i.test(prompt.replace(/\s+/g, " ")));
      assert(`${difficulty} ${task.intent} exposes readable subjects`, view.studentReadableContext.subjects.every((subject) => /: /.test(subject)));
      const adapted = adaptLinuxGeneratedTaskFromView({ task, generated: syntheticTaskFromView(view) });
      if (view.allowedSubjects.length > 0) {
        const allowedSubjectIds = new Set(task.groundedSubjects.map((subject) => subject.id));
        assert(`${difficulty} ${task.intent} adapter restores canonical IDs`, (adapted.claims || []).some((claim) => (claim.subjects || []).some((subject) => allowedSubjectIds.has(subject))));
      }
      const isolated = validateLinuxGeneratedNarrativeAgainstContract(taskIsolatedContract(contract, task), {
        title: "Linux task evidence review",
        objective: `Use selected evidence for ${contract.caseId}.`,
        scenario: `${contract.scenarioFraming.hostname} task-local evidence review.`,
        tasks: [adapted],
        hints: ["Use selected task evidence."],
        outcomes: ["Task-local evidence review."],
      });
      assert(`${difficulty} ${task.intent} internal grounding still passes`, isolated.passed, isolated.issues.map((issue) => issue.code).join(", "));
      generatedTasks.push(adapted);
    }
    const assembled = buildLinuxAssembledNarrative({
      contract,
      context: candidate.investigation,
      difficulty,
      duration,
      tasks: generatedTasks,
    });
    const finalContract = validateLinuxGeneratedNarrativeAgainstContract(contract, assembled);
    assert(`${difficulty} assembled narrative passes contract`, finalContract.passed, finalContract.issues.map((issue) => issue.code).join(", "));
    const finalNarrative = finalLinuxNarrativeFromAssembled({ lab: assembled });
    assertLinuxStudentContent({ ...finalNarrative, assets: candidate.assets });
    const savedTasks = finalNarrative.tasks.map((task) => JSON.stringify({
      phase: task.phase,
      title: task.title,
      evidence: task.evidence,
      deliverable: task.deliverable,
    }));
    assertLinuxStudentContent({
      title: finalNarrative.title,
      topic: finalNarrative.category,
      objective: finalNarrative.objective,
      scenario: finalNarrative.scenario,
      tasks: savedTasks,
      hints: finalNarrative.hints,
      outcomes: finalNarrative.outcomes,
      assets: candidate.assets,
    });
    assert(
      `${difficulty} readable task labels are present`,
      finalNarrative.tasks.every((task) =>
        task.title.trim().split(/\s+/).length >= 3 &&
        task.deliverable.trim().split(/\s+/).length >= 4 &&
        !/[a-z]+_[a-z]+|(?:capability|subject|relationship)[-_:]/i.test(`${task.title} ${task.deliverable}`)
      )
    );
  }
}

main();
