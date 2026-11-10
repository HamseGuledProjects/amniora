#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SAFE_MESSAGE = "We couldn’t generate this investigation safely. Please try again.";

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-generation-boundary-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function buildCandidate(buildLinuxAssetCandidate) {
  let lastError;
  for (let draw = 0; draw < 80; draw += 1) {
    const seed = `production-boundary-hotfix:beginner-30:draw:${draw}`;
    try {
      const candidate = buildLinuxAssetCandidate({
        seed,
        generationTime: "2026-07-31T10:00:00.000Z",
        category: "Linux",
        difficulty: "Beginner",
        duration: "30 mins",
        title: "Amniora Asset Pack",
      }, { incidentFamily: "ssh_bruteforce" });
      if (candidate.investigation.incidentFamily === "ssh_bruteforce") return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("could not build Beginner 30-minute ssh_bruteforce candidate");
}

function leakTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return [
    "capability_key",
    "subject_indexes",
    "relationship_statement_indexes",
    "approved statements",
    "accepted evidence contracts",
    "schema metadata",
    "metadata arrays",
    "requiredCapabilities",
    "identity:",
    "task:1:ssh_authentication",
  ].filter((token) => text.includes(token));
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxNarrativeContract } = require(path.join(out, "linux", "simulation.js"));
  const {
    buildLinuxTaskGenerationView,
    adaptLinuxGeneratedTaskFromView,
    linuxAtomicTaskRetryFeedback,
    linuxNarrativeContractIssueRetryFeedback,
    linuxSanitizedRetryFeedback,
    scanLinuxModelFacingPayload,
    serializeLinuxTaskGenerationPrompt,
    validateLinuxGeneratedTaskAtomicFields,
  } = require(path.join(out, "linux", "narrativeGenerationView.js"));
  const {
    buildLinuxSafeRetryFeedback,
    linuxRetryFeedbackCategoriesFromNarrativeIssueCodes,
    linuxRetryFeedbackCategoriesFromParseReason,
  } = require(path.join(out, "linux", "narrativeRetryFeedback.js"));
  const { validateLinuxGeneratedNarrativeAgainstContract } = require(path.join(out, "linux", "narrativeContract.js"));
  const {
    assertLinuxStudentContent,
    validateLinuxStudentContent,
  } = require(path.join(out, "linux", "studentContentValidation.js"));
  const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const {
    linuxNarrativeStructureDiagnostic,
    linuxNarrativeTextHygieneReason,
    validateLinuxNarrativeTextIntegrity,
  } = require(path.join(out, "linux", "narrativeIntegrity.js"));

  const candidate = buildCandidate(buildLinuxAssetCandidate);
  const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
  const authenticationTask = contract.taskContracts.find((task) => task.requiredCapabilities.includes("authentication"));
  assert("production path has internal authentication capability", Boolean(authenticationTask), contract.taskContracts.map((task) => task.requiredCapabilities.join("|")).join(","));

  const view = buildLinuxTaskGenerationView({ contract, task: authenticationTask });
  const prompt = serializeLinuxTaskGenerationPrompt({ view });
  assert("valid production prompt with internal authentication contract scans clean", scanLinuxModelFacingPayload(prompt, "production prompt").length === 0);
  assert("internal capability remains available for deterministic validation", authenticationTask.requiredCapabilities.includes("authentication"));

  const retryFeedback = linuxNarrativeContractIssueRetryFeedback(["LINUX_NARRATIVE_PROHIBITED_CAPABILITY"], "task");
  const retryPrompt = serializeLinuxTaskGenerationPrompt({ view, feedback: retryFeedback });
  assert("retry feedback redacts capability keys and schema fields", leakTokens(retryFeedback).length === 0, retryFeedback);
  assert("retry prompt with redacted validation feedback scans clean", scanLinuxModelFacingPayload(retryPrompt, "retry prompt").length === 0);

  const capitalizedCapabilityFeedback = linuxSanitizedRetryFeedback(["capability_scope"]);
  assert(
    "retry feedback redacts capitalized prohibited capability labels",
    scanLinuxModelFacingPayload(capitalizedCapabilityFeedback, "retry feedback").length === 0,
    capitalizedCapabilityFeedback
  );
  assert(
    "retry prompt with capitalized capability feedback scans clean",
    scanLinuxModelFacingPayload(serializeLinuxTaskGenerationPrompt({ view, feedback: capitalizedCapabilityFeedback }), "retry prompt").length === 0
  );
  const scannerFallbackFeedback = buildLinuxSafeRetryFeedback({ categories: ["capability_scope"], scope: "task" });
  assert(
    "retry feedback second-pass sanitizer removes scanner-detected internal tokens",
    scanLinuxModelFacingPayload(scannerFallbackFeedback, "retry feedback").length === 0,
    scannerFallbackFeedback
  );
  assert(
    "retry prompt with second-pass sanitized feedback scans clean",
    scanLinuxModelFacingPayload(serializeLinuxTaskGenerationPrompt({ view, feedback: scannerFallbackFeedback }), "retry prompt").length === 0
  );
  const allContractCodes = [
    "LINUX_NARRATIVE_TASK_COUNT_MISMATCH",
    "LINUX_NARRATIVE_TASK_MISSING",
    "LINUX_NARRATIVE_TASK_DUPLICATE",
    "LINUX_NARRATIVE_TASK_UNKNOWN",
    "LINUX_NARRATIVE_TASK_ORDER_MISMATCH",
    "LINUX_NARRATIVE_INTENT_MISMATCH",
    "LINUX_NARRATIVE_EVIDENCE_OUTSIDE_CONTRACT",
    "LINUX_NARRATIVE_UNRENDERED_EVIDENCE",
    "LINUX_NARRATIVE_UNKNOWN_SUBJECT",
    "LINUX_NARRATIVE_UNSUPPORTED_RELATIONSHIP",
    "LINUX_NARRATIVE_INVENTED_TIMESTAMP",
    "LINUX_NARRATIVE_UNSUPPORTED_CURRENT_STATE",
    "LINUX_NARRATIVE_UNSUPPORTED_HISTORICAL_STATE",
    "LINUX_NARRATIVE_UNBOUNDED_INFERENCE",
    "LINUX_NARRATIVE_UNSUPPORTED_RECOMMENDATION",
    "LINUX_NARRATIVE_PROHIBITED_CAPABILITY",
    "LINUX_NARRATIVE_ADVANCED_LEAK",
    "LINUX_NARRATIVE_INTERNAL_DETAIL_LEAK",
    "LINUX_NARRATIVE_LOCAL_PATH_LEAK",
  ];
  const allowlistedFeedback = linuxNarrativeContractIssueRetryFeedback(allContractCodes, "task");
  assert(
    "retry feedback for every contract issue code is allowlisted and scanner-safe",
    scanLinuxModelFacingPayload(allowlistedFeedback, "retry feedback").length === 0,
    allowlistedFeedback
  );
  for (const token of [
    "LINUX_NARRATIVE_",
    "AuthENTICation",
    "subject_indexes",
    "selectedEvidence",
    "identity:backup",
    "task:1:actor_attribution",
    "/tmp/cyberlab",
    "lib/lab-assets",
    "assets/logs/private",
    "capability_key",
    "relationship_statement_indexes",
  ]) {
    assert(`allowlisted retry feedback omits raw token ${token}`, !allowlistedFeedback.includes(token), allowlistedFeedback);
  }
  const unknownHostileFeedback = buildLinuxSafeRetryFeedback({ categories: ["general_contract_scope"], scope: "task" });
  assert(
    "unknown hostile retry text maps to generic allowlisted feedback",
    scanLinuxModelFacingPayload(unknownHostileFeedback, "retry feedback").length === 0,
    unknownHostileFeedback
  );
  assert(
    "unknown hostile retry feedback omits arbitrary raw text",
    !unknownHostileFeedback.includes("UNKNOWN_VALIDATOR") &&
      !unknownHostileFeedback.includes("authenticationAuthentication") &&
      !unknownHostileFeedback.includes("selectedEvidence"),
    unknownHostileFeedback
  );

  const unavailableEvidence = "assets/logs/not-selected-production.log";
  const evidenceRetryFeedback = linuxNarrativeContractIssueRetryFeedback(["LINUX_NARRATIVE_UNRENDERED_EVIDENCE"], "task");
  assert("retry feedback does not introduce unavailable evidence path", !evidenceRetryFeedback.includes(unavailableEvidence) && !/\bassets\//.test(evidenceRetryFeedback), evidenceRetryFeedback);
  assert("retry feedback does not introduce basename-only unavailable evidence", !evidenceRetryFeedback.includes("auth.log"), evidenceRetryFeedback);
  assert("retry prompt with unavailable evidence feedback omits that path", !serializeLinuxTaskGenerationPrompt({ view, feedback: evidenceRetryFeedback }).includes(unavailableEvidence));

  function oneTaskContract(task, renderedPaths) {
    return {
      ...contract,
      canonicalTaskCount: 1,
      globalRenderedEvidencePaths: renderedPaths,
      globalGroundedSubjects: task.groundedSubjects,
      globalGroundedRelationships: task.groundedRelationships,
      globalAllowedTimestamps: task.allowedTimestamps,
      taskContracts: [task],
    };
  }

  function minimalGeneratedTask(taskView, evidencePath) {
    const evidence = taskView.allowedEvidence.map((asset) => asset.path).slice(0, 3);
    return {
      task_number: taskView.taskNumber,
      learner_intent: taskView.learnerIntent,
      phase: `Task ${taskView.taskNumber}`,
      title: `${taskView.learnerIntent} using listed evidence`,
      evidence,
      deliverable: taskView.learnerInstruction,
      claims: [{
        claim_class: "observed",
        text: taskView.allowedHistoricalStatements[0] || "The listed evidence supports this task observation.",
        supporting_evidence: [evidencePath],
        subject_indexes: taskView.allowedSubjects[0] ? [taskView.allowedSubjects[0].index] : [],
        relationship_statement_indexes: [],
        timestamp_indexes: taskView.allowedTimestamps[0] ? [taskView.allowedTimestamps[0].index] : [],
      }],
    };
  }

  function atomicGeneratedTask(patch = {}) {
    const base = minimalGeneratedTask(view, view.allowedEvidence[0].path);
    return {
      ...base,
      ...patch,
      claims: patch.claims || base.claims,
    };
  }

  function atomicGeneratedTaskWithClaimText(text) {
    const base = atomicGeneratedTask();
    return {
      ...base,
      claims: [{ ...base.claims[0], text }],
    };
  }

  const atomicMalformedCases = [
    ["unmatched quote", 'Record why "the listed evidence needs validation.', "quote"],
    ["unmatched parenthesis", "Record the observed sign-in relationship (using the listed evidence.", "parenthesis"],
    ["unmatched bracket", "Record the observed sign-in relationship [using the listed evidence.", "bracket"],
    ["incomplete numbered list", "Record the finding in this order:\n1.", "numbered_list"],
    ["unfinished code fence", "Record the finding without adding facts.\n```", "code_fence"],
    ["corrupted suffix", "Record the finding with cited evidence.\uFFFD", "none"],
    ["nested model-generated Markdown", "## Finding\n- Use the listed evidence only.", "numbered_list"],
  ];
  for (const [name, claimText, expectedStructure] of atomicMalformedCases) {
    const atomic = validateLinuxGeneratedTaskAtomicFields({ view, generated: atomicGeneratedTaskWithClaimText(claimText) });
    assert(`atomic plain-text boundary rejects ${name}`, !atomic.passed, JSON.stringify(atomic));
    assert(
      `atomic diagnostic classifies ${name}`,
      atomic.issues.some((issue) =>
        issue.unmatchedStructureType === expectedStructure ||
        issue.failureCategory === "markdown_structure" ||
        issue.code === "LINUX_NARRATIVE_CORRUPTED_TEXT"
      ),
      JSON.stringify(atomic.issues)
    );
    assert(`atomic diagnostics hash ${name} without prose`, atomic.issues.every((issue) => /^[a-f0-9]{64}$/.test(issue.sha256) && !("excerpt" in issue)), JSON.stringify(atomic.issues));
  }

  const literalShell = validateLinuxGeneratedTaskAtomicFields({
    view,
    generated: atomicGeneratedTask({
      deliverable: 'Compare "/usr/bin/journalctl -u ssh" with the listed evidence and note any uncertainty.',
      claims: [{
        ...atomicGeneratedTask().claims[0],
        text: 'The command "/usr/bin/journalctl -u ssh" is a literal shell syntax example for the requested evidence review.',
      }],
    }),
  });
  assert("valid literal shell syntax is not falsely rejected", literalShell.passed, JSON.stringify(literalShell.issues));

  let intermediateSystemdCandidate = null;
  let intermediateSystemdContract = null;
  let intermediateChangeTask = null;
  let lastIntermediateError = null;
  for (let draw = 0; draw < 100 && !intermediateChangeTask; draw += 1) {
    try {
      const candidateForDraw = buildLinuxAssetCandidate({
        seed: `production-boundary-hotfix:intermediate-systemd-30:draw:${draw}`,
        generationTime: "2026-07-31T10:00:00.000Z",
        category: "Linux",
        difficulty: "Intermediate",
        duration: "30 mins",
        title: "Amniora Intermediate Asset Pack",
      }, { incidentFamily: "systemd_persistence" });
      const contractForDraw = buildLinuxNarrativeContract(candidateForDraw.simulation, candidateForDraw.assets.map((asset) => asset.file_path));
      const taskForDraw = contractForDraw.taskContracts.find((task) => task.intent === "change_control");
      if (candidateForDraw.assetQuality?.passed && taskForDraw) {
        intermediateSystemdCandidate = candidateForDraw;
        intermediateSystemdContract = contractForDraw;
        intermediateChangeTask = taskForDraw;
      }
    } catch (error) {
      lastIntermediateError = error;
    }
  }
  assert("production-shape Intermediate systemd fixture has change-control task", Boolean(intermediateSystemdCandidate && intermediateSystemdContract && intermediateChangeTask), lastIntermediateError?.message);
  const intermediateView = buildLinuxTaskGenerationView({ contract: intermediateSystemdContract, task: intermediateChangeTask });
  const intermediateDraft = minimalGeneratedTask(intermediateView, intermediateView.allowedEvidence[0].path);
  intermediateDraft.deliverable = "Compare command output for /usr";
  const intermediateAtomic = validateLinuxGeneratedTaskAtomicFields({ view: intermediateView, generated: intermediateDraft });
  assert("discarded model draft deliverable does not block Intermediate deterministic assembly", intermediateAtomic.passed, JSON.stringify(intermediateAtomic.issues));
  const intermediateAdaptedTasks = intermediateSystemdContract.taskContracts.map((task) => {
    const taskView = buildLinuxTaskGenerationView({ contract: intermediateSystemdContract, task });
    const generated = minimalGeneratedTask(taskView, taskView.allowedEvidence[0].path);
    if (task.taskId === intermediateChangeTask.taskId) generated.deliverable = "Compare command output for /usr";
    const atomic = validateLinuxGeneratedTaskAtomicFields({ view: taskView, generated });
    assert(`Intermediate deterministic fixture task ${task.taskId} atomic validation passes`, atomic.passed, JSON.stringify(atomic.issues));
    return adaptLinuxGeneratedTaskFromView({ task, generated });
  });
  const intermediateAssembled = buildLinuxAssembledNarrative({
    contract: intermediateSystemdContract,
    context: intermediateSystemdCandidate.investigation,
    difficulty: "Intermediate",
    duration: "30 mins",
    tasks: intermediateAdaptedTasks,
  });
  const intermediateLab = finalLinuxNarrativeFromAssembled({ lab: intermediateAssembled });
  assert("deterministic Intermediate deliverable removes truncated /usr draft", !JSON.stringify(intermediateLab.tasks).includes("command output for /usr"));

  const finalQualityCompletenessExamples = [
    ["malformed that-clause instruction", "Include a sentence that narrow sudo rule validation steps."],
    ["mechanical Also fragment", "Also identify account."],
    ["mechanical It should fragment", "It should check business need."],
    ["mechanical compare fragment", "Also compare privileged command."],
    ["mechanical where relevant describe", "Where relevant, include describe account activity."],
    ["mechanical include check", "Include check business need."],
    ["mechanical include map", "Include map sudo policy."],
    ["mechanical Also describe", "Also describe account activity."],
    ["technology compound", "Compare the selected Linux evidence and document the service-"],
    ["technology slash", "Compare the selected Linux evidence and document the service/"],
    ["joined time range", "Compare the selected Linux evidence across 03:0803:19."],
    ["missing technology space", "Compare the selected Linux evidence withSSH records."],
    ["damaged generated word", "Compare the selected Linux evidence and document the changee."],
  ];
  for (const [name, value] of finalQualityCompletenessExamples) {
    assert(`shared hygiene predicate classifies ${name}`, Boolean(linuxNarrativeTextHygieneReason(value)));
    const validation = validateLinuxGeneratedTaskAtomicFields({
      view,
      generated: atomicGeneratedTaskWithClaimText(value),
    });
    assert(
      `task atomic boundary rejects final-quality completeness defect: ${name}`,
      !validation.passed && validation.issues.some((issue) => issue.code === "LINUX_NARRATIVE_INCOMPLETE_TEXT"),
      JSON.stringify(validation.issues)
    );
  }

  const malformedRetryFeedback = linuxAtomicTaskRetryFeedback(validateLinuxGeneratedTaskAtomicFields({
    view,
    generated: atomicGeneratedTaskWithClaimText("## Finding\n1."),
  }).issues);
  assert("structure diagnostic reports unbalanced quote counts", (() => {
    const diagnostic = linuxNarrativeStructureDiagnostic('Record "unfinished evidence note.');
    return diagnostic.unmatchedStructureType === "quote" && diagnostic.openingCount === 1 && diagnostic.closingCount === 0;
  })());
  assert("atomic retry feedback is safe and does not include raw content", !malformedRetryFeedback.includes("## Finding") && !malformedRetryFeedback.includes("LINUX_") && !/\bassets\//.test(malformedRetryFeedback), malformedRetryFeedback);
  assert("atomic retry feedback scans clean", scanLinuxModelFacingPayload(malformedRetryFeedback, "atomic retry feedback").length === 0);

  function simulateAtomicFormatAttempts(values) {
    let feedbackForRetry = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const validation = validateLinuxGeneratedTaskAtomicFields({
        view,
        generated: atomicGeneratedTaskWithClaimText(values[attempt - 1]),
      });
      if (validation.passed) {
        return { accepted: true, narrativeAttempts: attempt, feedbackForRetry };
      }
      feedbackForRetry = linuxAtomicTaskRetryFeedback(validation.issues);
      if (attempt === 2) {
        return {
          accepted: false,
          narrativeAttempts: attempt,
          usageReservationOutcome: "released",
          persistenceOutcome: "not_started",
          validationCode: validation.issues[0].code,
          field: validation.issues[0].field,
          unmatchedStructureType: validation.issues[0].unmatchedStructureType,
          feedbackForRetry,
        };
      }
    }
    throw new Error("unreachable atomic attempt simulation");
  }

  const repairedAtomic = simulateAtomicFormatAttempts([
    'Record why "the listed evidence needs validation.',
    "Record why the listed evidence needs validation without adding unsupported conclusions.",
  ]);
  assert("malformed atomic attempt 1 is repaired on attempt 2", repairedAtomic.accepted && repairedAtomic.narrativeAttempts === 2, JSON.stringify(repairedAtomic));
  const exhaustedAtomic = simulateAtomicFormatAttempts([
    "Record the finding [with the listed evidence.",
    "Record the finding [with the listed evidence.",
  ]);
  assert(
    "malformed atomic attempt 2 is safely rejected",
    !exhaustedAtomic.accepted &&
      exhaustedAtomic.validationCode === "LINUX_NARRATIVE_UNBALANCED_STRUCTURE" &&
      exhaustedAtomic.unmatchedStructureType === "bracket" &&
      exhaustedAtomic.usageReservationOutcome === "released" &&
      exhaustedAtomic.persistenceOutcome === "not_started",
    JSON.stringify(exhaustedAtomic)
  );

  const validEvidence = view.allowedEvidence[0].path;
  const validAdapted = adaptLinuxGeneratedTaskFromView({ task: authenticationTask, generated: minimalGeneratedTask(view, validEvidence) });
  const validResult = validateLinuxGeneratedNarrativeAgainstContract(oneTaskContract(authenticationTask, authenticationTask.selectedEvidence.map((asset) => asset.path).sort()), {
    title: "Linux task evidence review",
    objective: `Use selected evidence for ${contract.caseId}.`,
    scenario: "Review only the task-local evidence.",
    tasks: [validAdapted],
    hints: ["Use only selected task evidence.", "Keep the task-local scope.", "Separate observation from uncertainty."],
    outcomes: ["Task-local evidence review.", "Supported claim mapping.", "Bounded analyst notes."],
  });
  assert("valid task-local rendered evidence succeeds", validResult.passed, JSON.stringify(validResult.issues));

  const inventedAdapted = adaptLinuxGeneratedTaskFromView({ task: authenticationTask, generated: minimalGeneratedTask(view, "assets/logs/not_real.log") });
  const inventedResult = validateLinuxGeneratedNarrativeAgainstContract(oneTaskContract(authenticationTask, authenticationTask.selectedEvidence.map((asset) => asset.path).sort()), {
    title: "Linux task evidence review",
    objective: `Use selected evidence for ${contract.caseId}.`,
    scenario: "Review only the task-local evidence.",
    tasks: [inventedAdapted],
    hints: ["Use only selected task evidence.", "Keep the task-local scope.", "Separate observation from uncertainty."],
    outcomes: ["Task-local evidence review.", "Supported claim mapping.", "Bounded analyst notes."],
  });
  assert("invented evidence still fails", inventedResult.issues.some((issue) => issue.code === "LINUX_NARRATIVE_UNRENDERED_EVIDENCE"), JSON.stringify(inventedResult.issues));

  const elsewhere = contract.taskContracts
    .flatMap((task) => task.selectedEvidence)
    .find((asset) => !authenticationTask.selectedEvidence.some((selected) => selected.path === asset.path));
  if (elsewhere) {
    const elsewhereAdapted = adaptLinuxGeneratedTaskFromView({ task: authenticationTask, generated: minimalGeneratedTask(view, elsewhere.path) });
    const globalNotTaskResult = validateLinuxGeneratedNarrativeAgainstContract(oneTaskContract(authenticationTask, contract.globalRenderedEvidencePaths), {
      title: "Linux task evidence review",
      objective: `Use selected evidence for ${contract.caseId}.`,
      scenario: "Review only the task-local evidence.",
      tasks: [elsewhereAdapted],
      hints: ["Use only selected task evidence.", "Keep the task-local scope.", "Separate observation from uncertainty."],
      outcomes: ["Task-local evidence review.", "Supported claim mapping.", "Bounded analyst notes."],
    });
    assert("globally rendered but task-ineligible evidence fails", globalNotTaskResult.issues.some((issue) => issue.code === "LINUX_NARRATIVE_EVIDENCE_OUTSIDE_CONTRACT"), JSON.stringify(globalNotTaskResult.issues));
  }

  const basename = validEvidence.split("/").pop();
  if (basename && authenticationTask.selectedEvidence.filter((asset) => asset.path.endsWith(`/${basename}`)).length === 1) {
    const aliasAdapted = adaptLinuxGeneratedTaskFromView({ task: authenticationTask, generated: minimalGeneratedTask(view, basename) });
    assert("unique valid evidence basename normalizes to selected path", aliasAdapted.evidence[0] === validEvidence && aliasAdapted.claims[0].supporting_evidence[0] === validEvidence, JSON.stringify(aliasAdapted));
    const aliasResult = validateLinuxGeneratedNarrativeAgainstContract(oneTaskContract(authenticationTask, authenticationTask.selectedEvidence.map((asset) => asset.path).sort()), {
      title: "Linux task evidence review",
      objective: `Use selected evidence for ${contract.caseId}.`,
      scenario: "Review only the task-local evidence.",
      tasks: [aliasAdapted],
      hints: ["Use only selected task evidence.", "Keep the task-local scope.", "Separate observation from uncertainty."],
      outcomes: ["Task-local evidence review.", "Supported claim mapping.", "Bounded analyst notes."],
    });
    assert("unique valid evidence alias validates after canonicalization", aliasResult.passed, JSON.stringify(aliasResult.issues));
  }

  const generatedTasks = contract.taskContracts.map((task) => {
    const taskView = buildLinuxTaskGenerationView({ contract, task });
    return {
      task_id: task.taskId,
      task_intent: task.intent,
      phase: `Task ${task.order}`,
      title: `${taskView.learnerIntent} using listed evidence`,
      evidence: taskView.allowedEvidence.slice(0, 3).map((asset) => asset.path),
      deliverable: taskView.learnerInstruction,
      claims: [],
    };
  });
  const assembled = buildLinuxAssembledNarrative({
    contract,
    context: candidate.investigation,
    difficulty: "Beginner",
    duration: "30 mins",
    tasks: generatedTasks,
  });
  const reassembled = buildLinuxAssembledNarrative({
    contract,
    context: candidate.investigation,
    difficulty: "Beginner",
    duration: "30 mins",
    tasks: generatedTasks,
  });
  assert("server deterministically renders task numbering", assembled.tasks.every((task, index) => task.phase === `Task ${index + 1}`), JSON.stringify(assembled.tasks.map((task) => task.phase)));
  assert("same-seed assembled narrative structure is stable", JSON.stringify(assembled.tasks.map((task) => ({ phase: task.phase, title: task.title, evidence: task.evidence }))) === JSON.stringify(reassembled.tasks.map((task) => ({ phase: task.phase, title: task.title, evidence: task.evidence }))));
  const learnerNarrative = finalLinuxNarrativeFromAssembled({ lab: assembled });
  assertLinuxStudentContent({ ...learnerNarrative, assets: candidate.assets });
  assert("learner narrative omits internal generation terms", leakTokens(learnerNarrative).length === 0, JSON.stringify(leakTokens(learnerNarrative)));
  assert("API response asset projection omits evidence content and internals", leakTokens(candidate.assets.map((asset) => ({
    file_name: asset.file_name,
    file_type: asset.file_type,
    file_path: asset.file_path,
  }))).length === 0);
  assert("rendered evidence omits task-contract internals", leakTokens(candidate.assets.map((asset) => asset.content).join("\n")).length === 0);

  for (const token of ["capability_key:authentication", "subject_indexes", "identity:backup", "approved statement metadata"]) {
    const result = validateLinuxStudentContent({
      ...learnerNarrative,
      tasks: [{ ...learnerNarrative.tasks[0], description: `Review ${token} before submitting.` }],
    });
    assert(`student-visible leak still fails: ${token}`, !result.passed, JSON.stringify(result.issues));
  }

  function simulateCapturedIncompleteTextPath(maxNarrativeAttempts) {
    const attempts = [
      {
        taskIndex: 0,
        field: "tasks[0].deliverable",
        value: "Create a concise evidence summary with",
        rawLength: 8775,
      },
      {
        taskIndex: 0,
        field: "tasks[0].deliverable",
        value: "Create a concise evidence summary with cited files and confidence boundaries.",
        rawLength: 8810,
      },
    ];
    let usageReservationOutcome = "reserved";
    let persistenceOutcome = "not_started";
    for (let attempt = 1; attempt <= maxNarrativeAttempts; attempt += 1) {
      const candidate = attempts[attempt - 1];
      const validation = validateLinuxNarrativeTextIntegrity(candidate.value, {
        field: candidate.field,
        taskIndex: candidate.taskIndex,
        kind: "deliverable",
        maxLength: 320,
      });
      if (validation.passed) {
        persistenceOutcome = "complete";
        usageReservationOutcome = "finalized";
        return {
          accepted: true,
          narrativeAttempts: attempt,
          usageReservationOutcome,
          persistenceOutcome,
          stableCode: null,
          reason: null,
        };
      }
      const issue = validation.issues.find((item) => item.code === "LINUX_NARRATIVE_INCOMPLETE_TEXT");
      if (!issue) throw new Error(`expected incomplete narrative issue: ${JSON.stringify(validation.issues)}`);
      if (attempt === maxNarrativeAttempts) {
        usageReservationOutcome = "released";
        return {
          accepted: false,
          narrativeAttempts: attempt,
          usageReservationOutcome,
          persistenceOutcome,
          reason: "schema_mismatch",
          stableCode: issue.code,
          fieldDiagnostics: [{
            field: candidate.field,
            taskIndex: candidate.taskIndex,
            failureCategory: issue.category,
            length: candidate.value.length,
            completionStatus: issue.category,
            rawLength: candidate.rawLength,
          }],
        };
      }
    }
    throw new Error("unreachable");
  }

  const preFixSingleAttempt = simulateCapturedIncompleteTextPath(1);
  assert(
    "captured schema_mismatch path fails before bounded retry",
    !preFixSingleAttempt.accepted &&
      preFixSingleAttempt.reason === "schema_mismatch" &&
      preFixSingleAttempt.stableCode === "LINUX_NARRATIVE_INCOMPLETE_TEXT" &&
      preFixSingleAttempt.usageReservationOutcome === "released" &&
      preFixSingleAttempt.persistenceOutcome === "not_started",
    JSON.stringify(preFixSingleAttempt)
  );
  const repairedSecondAttempt = simulateCapturedIncompleteTextPath(2);
  assert(
    "captured incomplete text path advances beyond narrative attempt 1 and accepts repaired text",
    repairedSecondAttempt.accepted &&
      repairedSecondAttempt.narrativeAttempts === 2 &&
      repairedSecondAttempt.usageReservationOutcome === "finalized" &&
      repairedSecondAttempt.persistenceOutcome === "complete",
    JSON.stringify(repairedSecondAttempt)
  );

  const route = read("app/api/ai/generate-lab/route.ts");
  const labsPage = read("app/dashboard/labs/page.tsx");
  assert("route contains stable learner-safe Linux generation message", route.includes(SAFE_MESSAGE));
  assert("route generic fallback does not expose raw Error.message", !/error\s*:\s*error instanceof Error\s*\?/.test(route));
  assert("route timeout response does not expose OpenAI timeout message", !/OpenAITimeoutError[\s\S]{0,120}error\.message/.test(route));
  assert("route uses safe diagnostics instead of raw console error", route.includes("safeGenerationDiagnostic") && !route.includes('console.error("AI LAB ROUTE ERROR:", error)'));
  assert("route classifies Linux validation stage without raw messages", route.includes("safeLinuxValidationCode") && route.includes("LINUX_MODEL_FACING_INTERNAL_DETAIL") && route.includes("safeLinuxGenerationStage"));
  assert("route diagnostics do not include raw narrative details", !/details:\s*error\.parseResult\.details/.test(route));
  assert("route emits safe production diagnostic request id", route.includes("diagnosticRequestId") && route.includes("requestId: diagnosticRequestId"));
  assert("route emits safe attempt and lifecycle diagnostics", route.includes("diagnosticAssetAttempt") && route.includes("usageReservationOutcome") && route.includes("persistenceOutcome"));
  assert("route permits bounded Linux narrative retry", route.includes('const maxNarrativeAttempts = category === "Linux" ? 2 : 1'));
  assert("route passes safe final-quality feedback into task-isolated Linux retry", route.includes("finalQualityFeedback?: string") && route.includes("finalQualityFeedback: feedback") && route.includes("let feedback = input.finalQualityFeedback || \"\""));
  assert("route carries field-level diagnostics for incomplete narrative text", route.includes("fieldDiagnostics") && route.includes("buildSafeNarrativeFieldDiagnostic") && route.includes("validateLinuxNarrativeTextIntegrity"));
  assert("route carries safe structure diagnostics for unbalanced narrative text", route.includes("unmatchedStructureType") && route.includes("openingCount") && route.includes("codeFenceCount") && route.includes("safeFieldDiagnosticsFromAtomicIssues"));
  assert("route carries safe evidence diagnostics for unrendered evidence", route.includes("evidenceDiagnostics") && route.includes("buildSafeNarrativeEvidenceDiagnostics") && route.includes("referencedPathHash"));
  assert("route imports one authoritative retry-feedback builder", route.includes("buildLinuxSafeRetryFeedback") && route.includes("linuxRetryFeedbackCategoriesFromParseReason") && route.includes("linuxRetryFeedbackCategoriesFromFinalQuality"));
  assert("route no longer imports legacy raw narrative contract retry helper", !route.includes("linuxNarrativeContractRetryFeedback,"));
  assert("task contract retry call site uses issue codes only", route.includes("linuxNarrativeContractIssueRetryFeedback(validation.issues.map((issue) => issue.code), \"task\")"));
  assert("outer task failure retry details use issue codes only", route.includes("linuxNarrativeContractIssueRetryFeedback(lastValidation.issues.map((issue) => issue.code), \"narrative\")"));
  assert("assembled narrative retry details use issue codes only", route.includes("linuxNarrativeContractIssueRetryFeedback(finalValidation.issues.map((issue) => issue.code), \"narrative\")"));
  const retryFeedbackBlock = route.slice(route.indexOf("function narrativeRetryFeedback"), route.indexOf("function logLinuxNarrativeResponse"));
  assert(
    "route retry feedback is parse-category-only",
    retryFeedbackBlock.includes("linuxRetryFeedbackCategoriesFromParseReason(reason)") &&
      retryFeedbackBlock.includes("void details") &&
      !retryFeedbackBlock.includes("${details}") &&
      !retryFeedbackBlock.includes("Regenerate the incomplete learner-facing field") &&
      !retryFeedbackBlock.includes("rawPrefix") &&
      !retryFeedbackBlock.includes("rawSuffix")
  );
  const finalQualityFeedbackBlock = route.slice(route.indexOf("function correctionFeedback"), route.indexOf("function logLinuxFinalQualityFailure"));
  assert(
    "final-quality retry feedback is safe category-only",
    finalQualityFeedbackBlock.includes("linuxRetryFeedbackCategoriesFromFinalQuality(result)") &&
      !finalQualityFeedbackBlock.includes("issue.description") &&
      !finalQualityFeedbackBlock.includes("issue.evidence") &&
      !/\bassets\//.test(finalQualityFeedbackBlock)
  );
  assert("route does not assign raw quoted retry feedback", !/feedback = "The optional AI quality review/.test(route));
  assert("route does not interpolate contract validation details into model feedback", !/Issues:\s*\$\{JSON\.stringify/.test(route) && !/schema-valid \(\$\{details\}\)/.test(route));
  assert("narrative contract helper is safe wrapper", read("lib/lab-assets/linux/narrativeContract.ts").includes("linuxRetryFeedbackCategoriesFromNarrativeIssueCodes(result.issues.map((item) => item.code))"));
  const allCategories = linuxRetryFeedbackCategoriesFromNarrativeIssueCodes(allContractCodes);
  const everyCategoryFeedback = buildLinuxSafeRetryFeedback({ categories: allCategories, scope: "narrative" });
  assert("outer narrative retry path is scanner-safe for every known contract code", scanLinuxModelFacingPayload(everyCategoryFeedback, "outer retry").length === 0, everyCategoryFeedback);
  const parseFeedback = buildLinuxSafeRetryFeedback({ categories: linuxRetryFeedbackCategoriesFromParseReason("schema_mismatch"), scope: "narrative" });
  assert("parse retry feedback is scanner-safe", scanLinuxModelFacingPayload(parseFeedback, "parse retry").length === 0, parseFeedback);
  const safeFailureLogStart = route.indexOf('console.error("[Amniora Generate Lab] safe failure"');
  const safeFailureLogBlock = route.slice(safeFailureLogStart, route.indexOf("if (error instanceof OpenAITimeoutError)", safeFailureLogStart));
  assert(
    "route emits sanitized request shape only",
    safeFailureLogBlock.includes("requestDifficulty") &&
      safeFailureLogBlock.includes("requestDuration") &&
      !safeFailureLogBlock.includes("prompt") &&
      !safeFailureLogBlock.includes("rawText")
  );
  assert("dashboard displays message field through sanitizing helper", labsPage.includes("learnerSafeLabGenerationError") && labsPage.includes("data.message"));
  assert("dashboard blocks internal validator text fallback", labsPage.includes("capability_key") && labsPage.includes("LINUX_") && labsPage.includes(SAFE_MESSAGE));
}

main();
