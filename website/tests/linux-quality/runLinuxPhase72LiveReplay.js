#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const ENABLED = process.env.CYBERLAB_RUN_API_TESTS === "1";
const OUTPUT_ROOT = path.join(ROOT, "test-output", "linux-live-api-phase72-replay");

const MATRIX = [
  { difficulty: "Beginner", family: "ssh_bruteforce", duration: "15 mins", seed: "api-phase4-b-1", generationSeed: "api-phase4-b-1:draw:1" },
  { difficulty: "Intermediate", family: "systemd_persistence", duration: "30 mins", seed: "api-phase4-i-2", generationSeed: "api-phase4-i-2:draw:1" },
  { difficulty: "Advanced", family: "cron_persistence", duration: "30 mins", seed: "api-phase4-a-2", generationSeed: "api-phase4-a-2:draw:3" },
];

const BASELINE_63 = {
  plannedTasks: 18,
  apiCalls: 21,
  retries: 9,
  acceptedTaskAttempts: 9,
  rejectedTaskAttempts: 12,
  finalAcceptedTasks: 9,
  assembledLabs: 0,
  fullyAcceptedLabs: 0,
  internalDetailLeaks: 10,
  unsupportedRelationships: 4,
  unrenderedEvidence: 1,
  advancedLeakage: 1,
  prohibitedCapabilityIssues: 1,
  totalTokens: 77065,
  estimatedCostUsd: 0.040361,
};

const BASELINE_65 = {
  plannedTasks: 18,
  reachedTasks: 12,
  apiCalls: 14,
  retries: 2,
  firstAttemptAcceptedTasks: 11,
  finalAcceptedTasks: 11,
  assembledLabs: 2,
  narrativeContractPasses: 2,
  fullyAcceptedLabs: 0,
  inventedTimestampFindings: 12,
  internalDetailLeaks: 0,
  unsupportedRelationships: 0,
  advancedLeakage: 0,
  prohibitedCapabilityIssues: 0,
  unrenderedEvidenceIssues: 0,
  totalTokens: 27992,
  estimatedCostUsd: 0.01837,
};

function loadEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-phase72-live-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function tokenUsage(attempts) {
  return attempts.reduce((sum, attempt) => ({
    input: sum.input + (attempt.usage?.input_tokens || 0),
    output: sum.output + (attempt.usage?.output_tokens || 0),
    total: sum.total + (attempt.usage?.total_tokens || 0),
    cached: sum.cached + (attempt.usage?.input_tokens_details?.cached_tokens || 0),
    reasoning: sum.reasoning + (attempt.usage?.output_tokens_details?.reasoning_tokens || 0),
  }), { input: 0, output: 0, total: 0, cached: 0, reasoning: 0 });
}

function pricingForModel(model) {
  const inputOverride = Number(process.env.CYBERLAB_API_TEST_INPUT_COST_PER_MILLION || "");
  const outputOverride = Number(process.env.CYBERLAB_API_TEST_OUTPUT_COST_PER_MILLION || "");
  if (Number.isFinite(inputOverride) && inputOverride > 0 && Number.isFinite(outputOverride) && outputOverride > 0) {
    return { inputPerMillion: inputOverride, outputPerMillion: outputOverride, source: "env_override" };
  }
  const normalized = model.toLowerCase();
  if (normalized.includes("gpt-5-mini")) return { inputPerMillion: 0.25, outputPerMillion: 2.0, source: "default_gpt_5_mini_estimate" };
  if (normalized.includes("gpt-5-nano")) return { inputPerMillion: 0.05, outputPerMillion: 0.4, source: "default_gpt_5_nano_estimate" };
  if (normalized.includes("gpt-5")) return { inputPerMillion: 1.25, outputPerMillion: 10.0, source: "default_gpt_5_estimate" };
  return { inputPerMillion: 1.0, outputPerMillion: 4.0, source: "generic_estimate" };
}

function estimatedCost(tokens, model) {
  const pricing = pricingForModel(model);
  return {
    ...pricing,
    estimatedUsd: (tokens.input / 1_000_000) * pricing.inputPerMillion + (tokens.output / 1_000_000) * pricing.outputPerMillion,
  };
}

function schemaForTask(view) {
  const evidencePaths = view.allowedEvidence.map((asset) => asset.path);
  const subjectIndexes = view.allowedSubjects.map((subject) => subject.index);
  const relationshipIndexes = view.allowedRelationshipStatements.map((relationship) => relationship.index);
  const timestampIndexes = view.allowedTimestamps.map((timestamp) => timestamp.index);
  const enumOrNumber = (values) => values.length > 0 ? { type: "integer", enum: values } : { type: "integer" };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      task_number: { type: "integer", enum: [view.taskNumber] },
      learner_intent: { type: "string", enum: [view.learnerIntent] },
      phase: { type: "string", maxLength: 40 },
      title: { type: "string", maxLength: 240 },
      evidence: { type: "array", minItems: 1, maxItems: Math.min(3, evidencePaths.length), items: { type: "string", enum: evidencePaths } },
      deliverable: { type: "string", maxLength: 320 },
      claims: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claim_class: { type: "string", enum: ["observed", "historical_state", "current_state", "bounded_inference", "recommendation"] },
            text: { type: "string", maxLength: 360 },
            supporting_evidence: { type: "array", minItems: 0, maxItems: Math.min(3, evidencePaths.length), items: { type: "string", enum: evidencePaths } },
            subject_indexes: { type: "array", minItems: 0, maxItems: Math.min(8, subjectIndexes.length), items: enumOrNumber(subjectIndexes) },
            relationship_statement_indexes: { type: "array", minItems: 0, maxItems: Math.min(6, relationshipIndexes.length), items: enumOrNumber(relationshipIndexes) },
            timestamp_indexes: { type: "array", minItems: 0, maxItems: Math.min(8, timestampIndexes.length), items: enumOrNumber(timestampIndexes) },
          },
          required: ["claim_class", "text", "supporting_evidence", "subject_indexes", "relationship_statement_indexes", "timestamp_indexes"],
        },
      },
    },
    required: ["task_number", "learner_intent", "phase", "title", "evidence", "deliverable", "claims"],
  };
}

async function callOpenAITaskAttempt({ model, prompt, schema, attempt }) {
  const started = Date.now();
  let response;
  let data;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: [
          "Return only the requested JSON.",
          "You are a deterministic serializer for one supplied Linux task contract.",
          "Treat everything outside the task contract as false.",
          "Use no cybersecurity or Linux knowledge beyond the task contract.",
        ].join(" "),
        input: prompt,
        max_output_tokens: 1600,
        reasoning: { effort: "minimal" },
        text: {
          format: {
            type: "json_schema",
            name: "cyberlab_linux_phase72_task",
            strict: true,
            schema,
          },
        },
      }),
    });
    data = await response.json().catch(async () => ({ error: await response.text() }));
  } catch (error) {
    return {
      attempt,
      ok: false,
      status: 0,
      durationMs: Date.now() - started,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      parsed: null,
      parseError: null,
      runtimeError: error instanceof Error ? error.message : String(error),
      rawText: "",
    };
  }
  const rawText = data.output_text || (data.output || []).flatMap((item) => item.content || []).map((item) => item.text || "").join("");
  let parsed = null;
  let parseError = null;
  if (response.ok) {
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    attempt,
    ok: response.ok,
    status: response.status,
    durationMs: Date.now() - started,
    usage: data.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    parsed,
    parseError,
    runtimeError: response.ok ? null : JSON.stringify(data.error || data).slice(0, 800),
    rawText,
    responseId: data.id,
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

function classifyFailure(record) {
  if (record.preCallFailures.length) return "PRE_CALL_ASSERTION_FAILURE";
  if (record.apiRuntimeIssues.length) {
    if (record.apiRuntimeIssues.some((item) => /rate/i.test(item))) return "API_RATE_LIMIT";
    return "API_TRANSPORT_FAILURE";
  }
  if (record.parserIssues.length || record.schemaIssues.length) return "MODEL_SCHEMA_FAILURE";
  const codes = record.narrativeContractIssueCodes || [];
  if (codes.some((code) => /INTERNAL_DETAIL/.test(code))) return "INTERNAL_DETAIL_LEAK";
  if (codes.some((code) => /UNKNOWN_SUBJECT/.test(code))) return "UNKNOWN_SUBJECT";
  if (codes.some((code) => /UNSUPPORTED_RELATIONSHIP/.test(code))) return "UNSUPPORTED_RELATIONSHIP";
  if (codes.some((code) => /PROHIBITED_CAPABILITY|UNSUPPORTED_CURRENT_STATE|UNSUPPORTED_HISTORICAL_STATE|UNSUPPORTED_RECOMMENDATION/.test(code))) return "UNSUPPORTED_CAPABILITY";
  if (codes.some((code) => /UNRENDERED_EVIDENCE|EVIDENCE_OUTSIDE/.test(code))) return "UNRENDERED_EVIDENCE";
  if (codes.some((code) => /TIMESTAMP/.test(code))) return "INVENTED_TIMESTAMP";
  if (record.assemblyIssues.length) return "ASSEMBLY_DEFECT";
  if (record.finalArtifactIssues.length) return "FINAL_ARTIFACT_FAILURE";
  if (record.finalQualityIssues.length) return record.hasFalseCurrentStateQualityIssue ? "FINAL_QUALITY_FALSE_POSITIVE" : "FINAL_QUALITY_GENUINE_FAILURE";
  if (!record.accepted) return "MODEL_ALIGNMENT_FAILURE";
  return "";
}

function compareNumber(current, baseline) {
  return {
    current,
    baseline,
    delta: current - baseline,
    percentChange: baseline ? ((current - baseline) / baseline) * 100 : null,
  };
}

function writeMarkdownSummary(file, summary) {
  const lines = [
    "# CyberLab Linux Phase 7.2 Live Same-Seed Replay",
    "",
    `Output directory: ${summary.outputDirectory}`,
    `Status: ${summary.status}`,
    `Final recommendation: ${summary.recommendation}`,
    `Model: ${summary.model}`,
    "",
    "## Matrix",
    "",
    ...summary.matrix.map((lab) => `- ${lab.difficulty} ${lab.family} ${lab.duration} seed=${lab.seed} generationSeed=${lab.generationSeed}`),
    "",
    "## Results",
    "",
    `- Planned tasks: ${summary.plannedTasks}`,
    `- Reached tasks: ${summary.reachedTasks}`,
    `- First-attempt accepted tasks: ${summary.firstAttemptAcceptedTasks}`,
    `- Final accepted tasks: ${summary.finalAcceptedTasks}`,
    `- API calls: ${summary.totalApiCalls}`,
    `- Retries: ${summary.totalRetries}`,
    `- Labs assembled: ${summary.assembledLabs}`,
    `- Narrative-contract passes: ${summary.narrativeContractPasses}`,
    `- Final artifact passes: ${summary.finalArtifactPasses}`,
    `- Final quality passes: ${summary.finalQualityPasses}`,
    `- Fully accepted labs: ${summary.fullyAcceptedLabs}`,
    `- Total tokens: ${summary.tokens.total}`,
    `- Estimated cost USD: ${summary.cost.estimatedUsd.toFixed(6)}`,
    `- Runtime ms: ${summary.runtimeMs}`,
    "",
    "## Lab Results",
    "",
    ...summary.labResults.map((lab) => `- ${lab.accepted ? "PASS" : "FAIL"} ${lab.difficulty} ${lab.family}: tasks=${lab.acceptedTaskCount}/${lab.plannedTaskCount}, calls=${lab.apiCalls}, retries=${lab.retries}, score=${lab.finalScore ?? "n/a"}, failure=${lab.failureClass || "none"}`),
    "",
    "## Failure Classification",
    "",
    ...Object.entries(summary.failureClassification).map(([key, value]) => `- ${key}: ${value}`),
    "",
  ];
  fs.writeFileSync(file, lines.join("\n"));
}

async function main() {
  if (!ENABLED) {
    console.log("SKIP Phase 7.2 live replay: set CYBERLAB_RUN_API_TESTS=1 to enable.");
    return;
  }
  loadEnvLocal();
  if (!process.env.OPENAI_API_KEY) throw new Error("CYBERLAB_RUN_API_TESTS=1 was set but OPENAI_API_KEY is missing.");

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.resolve(process.env.CYBERLAB_PHASE72_OUT || path.join(OUTPUT_ROOT, runId));
  fs.mkdirSync(reportDir, { recursive: true });

  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxNarrativeContract, assertLinuxTaskEvidenceClosureInvariant } = require(path.join(out, "linux", "simulation.js"));
  const { validateLinuxGeneratedNarrativeAgainstContract } = require(path.join(out, "linux", "narrativeContract.js"));
  const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const {
    adaptLinuxGeneratedTaskFromView,
    buildLinuxTaskGenerationView,
    linuxSanitizedRetryFeedback,
    scanLinuxModelFacingPayload,
    serializeLinuxTaskGenerationPrompt,
  } = require(path.join(out, "linux", "narrativeGenerationView.js"));
  const { checkLinuxInvestigationQuality, checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));

  const model = process.env.CYBERLAB_API_TEST_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
  const maxRetries = Number(process.env.CYBERLAB_API_TEST_MAX_RETRIES || 2);
  const runStarted = Date.now();
  const gitIdentifier = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
  const gitStatus = execSync("git status --short -- lib/lab-assets/linux tests/linux-quality app/api/ai/generate-lab/route.ts", { cwd: ROOT }).toString();

  writeJson(path.join(reportDir, "matrix.json"), MATRIX);
  writeJson(path.join(reportDir, "run-metadata.json"), {
    runId,
    startedAt: new Date(runStarted).toISOString(),
    gitIdentifier,
    gitStatus,
    model,
    maxRetries,
    maxOutputTokens: 1600,
    reasoning: { effort: "minimal" },
    pricing: pricingForModel(model),
    outputDirectory: reportDir,
  });

  const labResults = [];
  const taskResults = [];
  const taskAttempts = [];
  const acceptedTaskAttempts = [];
  const rejectedTaskAttempts = [];
  const scannerReport = [];
  const adapterReport = [];
  const assemblyReport = [];
  const narrativeContractReport = [];
  const finalArtifactReport = [];
  const finalQualityReport = [];
  const retryReport = [];
  const failureRows = [];
  let totalCalls = 0;

  for (const labSpec of MATRIX) {
    const candidate = buildLinuxAssetCandidate({
          seed: labSpec.generationSeed,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux", difficulty: labSpec.difficulty, duration: labSpec.duration, title: "CyberLab Asset Pack", seed: labSpec.generationSeed },
        { incidentFamily: labSpec.family }
      );
    if (candidate.investigation.incidentFamily !== labSpec.family) {
      throw new Error(`Frozen generation seed ${labSpec.generationSeed} produced ${candidate.investigation.incidentFamily}, expected ${labSpec.family}.`);
    }
    assertLinuxTaskEvidenceClosureInvariant(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    const assetQuality = checkLinuxInvestigationQuality({
      context: candidate.investigation,
      assets: candidate.assets,
      simulation: candidate.simulation,
    });
    const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    const acceptedTasks = [];
    const labAttempts = [];
    const labPreCallFailures = [];
    const parserIssues = [];
    const schemaIssues = [];
    const apiRuntimeIssues = [];
    let stopReason = "";

    for (const [taskIndex, task] of contract.taskContracts.entries()) {
      let taskAccepted = false;
      let feedback = "";
      const taskAttemptRows = [];
      for (let attemptNumber = 1; attemptNumber <= maxRetries + 1; attemptNumber += 1) {
        const view = buildLinuxTaskGenerationView({ contract, task });
        const prompt = serializeLinuxTaskGenerationPrompt({ view, feedback });
        const scan = scanLinuxModelFacingPayload(prompt, `${labSpec.seed}:${task.taskId}:attempt:${attemptNumber}`);
        const retryScan = feedback ? scanLinuxModelFacingPayload(feedback, `${labSpec.seed}:${task.taskId}:retry:${attemptNumber}`) : [];
        const preCallFailures = [...scan, ...retryScan];
        const scannerEntry = {
          lab: labSpec,
          taskId: task.taskId,
          intent: task.intent,
          attemptNumber,
          passed: preCallFailures.length === 0,
          issues: preCallFailures,
          evidencePaths: view.allowedEvidence.map((asset) => asset.path),
          subjectIndexCount: view.allowedSubjects.length,
          relationshipIndexCount: view.allowedRelationshipStatements.length,
          timestampIndexCount: view.allowedTimestamps.length,
        };
        scannerReport.push(scannerEntry);
        if (preCallFailures.length > 0) {
          labPreCallFailures.push(scannerEntry);
          stopReason = `pre-call scanner failed for ${task.taskId}`;
          break;
        }

        const apiAttempt = await callOpenAITaskAttempt({
          model,
          prompt,
          schema: schemaForTask(view),
          attempt: attemptNumber,
        });
        totalCalls += 1;
        labAttempts.push(apiAttempt);
        const attemptRecord = {
          lab: labSpec,
          taskId: task.taskId,
          taskNumber: taskIndex + 1,
          intent: task.intent,
          taskTitle: task.title,
          attemptNumber,
          prompt,
          sanitizedGenerationView: view,
          scannerResult: scannerEntry,
          rawApiResponse: {
            ok: apiAttempt.ok,
            status: apiAttempt.status,
            durationMs: apiAttempt.durationMs,
            usage: apiAttempt.usage,
            responseId: apiAttempt.responseId,
            rawText: apiAttempt.rawText,
            parseError: apiAttempt.parseError,
            runtimeError: apiAttempt.runtimeError,
          },
          parsedSanitizedOutput: apiAttempt.parsed,
          adaptedCanonicalOutput: null,
          adapterResult: { passed: false, issues: [] },
          narrativeValidationResult: null,
          retryFeedback: "",
          accepted: false,
        };

        if (!apiAttempt.ok) {
          apiRuntimeIssues.push(apiAttempt.runtimeError || `HTTP ${apiAttempt.status}`);
          feedback = "The previous API call failed. Return one complete JSON object matching the one-task schema.";
          attemptRecord.retryFeedback = feedback;
          taskAttemptRows.push(attemptRecord);
          taskAttempts.push(attemptRecord);
          continue;
        }
        if (!apiAttempt.parsed) {
          parserIssues.push(apiAttempt.parseError || `Task ${task.taskId} response did not parse as JSON.`);
          feedback = "The previous response was not parseable JSON. Return one complete JSON object matching the one-task schema.";
          attemptRecord.retryFeedback = feedback;
          taskAttemptRows.push(attemptRecord);
          taskAttempts.push(attemptRecord);
          continue;
        }

        let adaptedTask = null;
        try {
          adaptedTask = adaptLinuxGeneratedTaskFromView({ task, generated: apiAttempt.parsed });
          attemptRecord.adaptedCanonicalOutput = adaptedTask;
          attemptRecord.adapterResult = {
            passed: true,
            subjectIndexes: (apiAttempt.parsed.claims || []).flatMap((claim) => claim.subject_indexes || []),
            relationshipStatementIndexes: (apiAttempt.parsed.claims || []).flatMap((claim) => claim.relationship_statement_indexes || []),
            timestampIndexes: (apiAttempt.parsed.claims || []).flatMap((claim) => claim.timestamp_indexes || []),
          };
        } catch (error) {
          attemptRecord.adapterResult = { passed: false, issues: [error instanceof Error ? error.message : String(error)] };
          feedback = "Use only the listed schema metadata arrays and allowed timestamp entries from the task view.";
          attemptRecord.retryFeedback = feedback;
          taskAttemptRows.push(attemptRecord);
          taskAttempts.push(attemptRecord);
          continue;
        }

        const isolatedContract = taskIsolatedContract(contract, task);
        const validationNarrative = {
          title: "Linux task evidence review",
          objective: `Use selected evidence for ${contract.caseId} during ${contract.scenarioFraming.incidentWindow} ${contract.scenarioFraming.timezone}.`,
          scenario: `${contract.scenarioFraming.hostname} is reviewed as a ${contract.scenarioFraming.hostRole}.`,
          tasks: [adaptedTask],
          hints: ["Use only selected task evidence.", "Keep the task-local scope.", "Separate observation from uncertainty."],
          outcomes: ["Task-local evidence review.", "Supported claim mapping.", "Bounded analyst notes."],
        };
        const taskValidation = validateLinuxGeneratedNarrativeAgainstContract(isolatedContract, validationNarrative);
        attemptRecord.narrativeValidationResult = taskValidation;
        if (!taskValidation.passed) {
          feedback = linuxSanitizedRetryFeedback(taskValidation.issues.map((issue) => issue.message));
          attemptRecord.retryFeedback = feedback;
          taskAttemptRows.push(attemptRecord);
          taskAttempts.push(attemptRecord);
          continue;
        }

        attemptRecord.accepted = true;
        acceptedTasks.push(adaptedTask);
        taskAccepted = true;
        taskAttemptRows.push(attemptRecord);
        taskAttempts.push(attemptRecord);
        acceptedTaskAttempts.push(attemptRecord);
        break;
      }

      for (const row of taskAttemptRows.filter((row) => !row.accepted)) rejectedTaskAttempts.push(row);
      const taskResult = {
        lab: labSpec,
        taskId: task.taskId,
        taskNumber: taskIndex + 1,
        intent: task.intent,
        title: task.title,
        accepted: taskAccepted,
        attempts: taskAttemptRows.length,
        firstAttemptAccepted: taskAccepted && taskAttemptRows.length === 1,
        issueCodes: taskAttemptRows.flatMap((row) => row.narrativeValidationResult?.issues?.map((issue) => issue.code) || []),
        selectedEvidence: task.selectedEvidence.map((asset) => asset.path),
        requiredCapabilities: task.requiredCapabilities,
        allowedTimestamps: task.allowedTimestamps,
        selectedTimestampIndexes: taskAttemptRows.flatMap((row) => row.adapterResult?.timestampIndexes || []),
      };
      taskResults.push(taskResult);
      retryReport.push({
        lab: labSpec,
        taskId: task.taskId,
        accepted: taskAccepted,
        attempts: taskAttemptRows.length,
        retries: Math.max(0, taskAttemptRows.length - 1),
        retryReasons: taskAttemptRows.filter((row) => !row.accepted).map((row) => ({
          attemptNumber: row.attemptNumber,
          apiRuntimeIssue: row.rawApiResponse.runtimeError,
          parseError: row.rawApiResponse.parseError,
          adapterIssues: row.adapterResult.issues || [],
          narrativeIssueCodes: row.narrativeValidationResult?.issues?.map((issue) => issue.code) || [],
          retryFeedback: row.retryFeedback,
        })),
      });
      if (!taskAccepted) {
        stopReason ||= `task ${task.taskId} exhausted attempts`;
        break;
      }
    }

    let finalNarrative = null;
    let fullContractResult = null;
    let finalQuality = null;
    let accepted = false;
    if (acceptedTasks.length === contract.taskContracts.length) {
      finalNarrative = buildLinuxAssembledNarrative({
        contract,
        context: candidate.investigation,
        difficulty: labSpec.difficulty,
        duration: labSpec.duration,
        tasks: acceptedTasks,
      });
      fullContractResult = validateLinuxGeneratedNarrativeAgainstContract(contract, finalNarrative);
      narrativeContractReport.push({ lab: labSpec, passed: fullContractResult.passed, result: fullContractResult });
      assemblyReport.push({
        lab: labSpec,
        passed: true,
        taskCount: finalNarrative.tasks.length,
        titles: finalNarrative.tasks.map((task) => task.title),
        evidence: finalNarrative.tasks.map((task) => task.evidence),
        outcomes: finalNarrative.outcomes,
      });
      if (fullContractResult.passed) {
        finalQuality = checkLinuxFinalProductionQuality({
          context: candidate.investigation,
          assets: candidate.assets,
          simulation: candidate.simulation,
          lab: finalLinuxNarrativeFromAssembled({ lab: finalNarrative }),
        });
        accepted = finalQuality.passed && finalQuality.issues.length === 0;
      }
    } else {
      assemblyReport.push({ lab: labSpec, passed: false, reason: stopReason, acceptedTaskCount: acceptedTasks.length });
    }
    finalArtifactReport.push({
      lab: labSpec,
      passed: Boolean(fullContractResult?.passed),
      issues: fullContractResult?.issues || [],
    });
    finalQualityReport.push({
      lab: labSpec,
      passed: Boolean(finalQuality?.passed && finalQuality.issues.length === 0),
      score: finalQuality?.finalProductionScore ?? null,
      issues: finalQuality?.issues || [],
    });

    const usage = tokenUsage(labAttempts);
    const finalRecord = {
      ...labSpec,
      accepted,
      plannedTaskCount: contract.canonicalTaskCount,
      acceptedTaskCount: acceptedTasks.length,
      reachedTaskCount: Math.min(contract.canonicalTaskCount, taskResults.filter((row) => row.lab.seed === labSpec.seed).length),
      apiCalls: labAttempts.length,
      retries: taskResults.filter((row) => row.lab.seed === labSpec.seed).reduce((sum, row) => sum + Math.max(0, row.attempts - 1), 0),
      firstAttemptAcceptedTasks: taskResults.filter((row) => row.lab.seed === labSpec.seed && row.firstAttemptAccepted).length,
      assembled: Boolean(finalNarrative),
      narrativeContractPassed: Boolean(fullContractResult?.passed),
      finalArtifactPassed: Boolean(fullContractResult?.passed),
      finalQualityPassed: Boolean(finalQuality?.passed && finalQuality.issues.length === 0),
      finalScore: finalQuality?.finalProductionScore ?? null,
      preCallFailures: labPreCallFailures,
      parserIssues,
      schemaIssues,
      apiRuntimeIssues,
      narrativeContractIssueCodes: fullContractResult?.issues?.map((issue) => issue.code) || [],
      finalQualityIssues: finalQuality?.issues || [],
      finalArtifactIssues: fullContractResult?.issues || [],
      assemblyIssues: finalNarrative ? [] : [stopReason],
      hasFalseCurrentStateQualityIssue: Boolean(finalQuality?.issues?.some((issue) => /current-state/i.test(issue.description || "") && /service_inventory\.txt/.test(issue.detail || ""))),
      tokenUsage: usage,
      cost: estimatedCost(usage, model),
      latencyMs: labAttempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
      incident: {
        incidentId: candidate.investigation.incidentId,
        hostname: candidate.investigation.hostname,
        hostRole: candidate.investigation.hostRole,
        primaryService: contract.scenarioFraming.primaryService,
        incidentWindow: contract.scenarioFraming.incidentWindow,
        timezone: candidate.investigation.timezone,
      },
      assetQuality: {
        passed: assetQuality.passed,
        score: assetQuality.finalProductionScore,
        issues: assetQuality.issues,
      },
      taskIntents: contract.taskContracts.map((task) => task.intent),
      renderedEvidencePaths: candidate.assets.map((asset) => asset.file_path),
      finalNarrative,
    };
    finalRecord.failureClass = finalRecord.accepted ? "" : classifyFailure(finalRecord);
    if (finalRecord.failureClass) failureRows.push({
      lab: labSpec,
      failureClass: finalRecord.failureClass,
      firstStage: finalRecord.preCallFailures.length ? "pre-call scanner" :
        finalRecord.apiRuntimeIssues.length ? "api runtime" :
          finalRecord.parserIssues.length ? "parser/schema" :
            finalRecord.narrativeContractIssueCodes.length ? "narrative contract" :
              finalRecord.finalQualityIssues.length ? "final quality" :
                finalRecord.assemblyIssues.length ? "assembly" : "unknown",
      evidence: {
        narrativeContractIssueCodes: finalRecord.narrativeContractIssueCodes,
        finalQualityIssues: finalRecord.finalQualityIssues,
        assemblyIssues: finalRecord.assemblyIssues,
      },
      existedInPhase65: false,
      newRegression: false,
      productionChangeJustified: false,
    });
    labResults.push(finalRecord);
    console.log(`${accepted ? "PASS" : "FAIL"} ${labSpec.difficulty} ${labSpec.family} seed=${labSpec.seed} generationSeed=${labSpec.generationSeed} tasks=${acceptedTasks.length}/${contract.canonicalTaskCount} calls=${labAttempts.length} score=${finalRecord.finalScore ?? "n/a"} failure=${finalRecord.failureClass || "none"}`);
  }

  const allAttempts = taskAttempts.map((row) => row.rawApiResponse);
  const totalTokens = tokenUsage(allAttempts);
  const totalCost = estimatedCost(totalTokens, model);
  const failureClassification = {};
  for (const row of failureRows) failureClassification[row.failureClass] = (failureClassification[row.failureClass] || 0) + 1;
  const fullyAcceptedLabs = labResults.filter((row) => row.accepted).length;
  const plannedTasks = labResults.reduce((sum, row) => sum + row.plannedTaskCount, 0);
  const finalAcceptedTasks = taskResults.filter((row) => row.accepted).length;
  const totalRetries = taskResults.reduce((sum, row) => sum + Math.max(0, row.attempts - 1), 0);
  const recommendation = fullyAcceptedLabs === MATRIX.length
    ? totalRetries > 0
      ? "READY_WITH_MINOR_LIVE_VARIANCE"
      : "READY_FOR_BROAD_LINUX_LIVE_MATRIX"
    : "TARGETED_LIVE_ALIGNMENT_FIX_REQUIRED";
  const summary = {
    runId,
    outputDirectory: reportDir,
    status: fullyAcceptedLabs === MATRIX.length ? "ALL_PHASE72_LABS_ACCEPTED" : "PHASE72_FAILURES_RETAINED",
    recommendation,
    matrix: MATRIX,
    gitIdentifier,
    gitStatus,
    model,
    maxRetries,
    apiSettings: { endpoint: "responses", maxOutputTokens: 1600, reasoning: { effort: "minimal" } },
    pricing: pricingForModel(model),
    startedAt: new Date(runStarted).toISOString(),
    completedAt: new Date().toISOString(),
    runtimeMs: Date.now() - runStarted,
    plannedTasks,
    reachedTasks: taskResults.length,
    firstAttemptAcceptedTasks: taskResults.filter((row) => row.firstAttemptAccepted).length,
    finalAcceptedTasks,
    totalApiCalls: totalCalls,
    totalRetries,
    assembledLabs: labResults.filter((row) => row.assembled).length,
    narrativeContractPasses: labResults.filter((row) => row.narrativeContractPassed).length,
    finalArtifactPasses: labResults.filter((row) => row.finalArtifactPassed).length,
    finalQualityPasses: labResults.filter((row) => row.finalQualityPassed).length,
    fullyAcceptedLabs,
    tokens: totalTokens,
    cost: totalCost,
    labResults: labResults.map((row) => ({
      difficulty: row.difficulty,
      family: row.family,
      duration: row.duration,
      seed: row.seed,
      generationSeed: row.generationSeed,
      accepted: row.accepted,
      plannedTaskCount: row.plannedTaskCount,
      acceptedTaskCount: row.acceptedTaskCount,
      firstAttemptAcceptedTasks: row.firstAttemptAcceptedTasks,
      apiCalls: row.apiCalls,
      retries: row.retries,
      assembled: row.assembled,
      narrativeContractPassed: row.narrativeContractPassed,
      finalArtifactPassed: row.finalArtifactPassed,
      finalQualityPassed: row.finalQualityPassed,
      finalScore: row.finalScore,
      failureClass: row.failureClass,
      tokenUsage: row.tokenUsage,
      cost: row.cost,
      latencyMs: row.latencyMs,
      taskIntents: row.taskIntents,
    })),
    failureClassification,
    failures: failureRows,
    phase70: {
      confirmedLive: labResults.some((row) => row.difficulty === "Advanced" && row.family === "cron_persistence" && row.accepted),
      timestampIndexFailures: taskResults.filter((row) => row.issueCodes.some((code) => /TIMESTAMP/.test(code))).length,
    },
    phase71: {
      confirmedLive: labResults.some((row) => row.difficulty === "Intermediate" && row.family === "systemd_persistence" && row.accepted && row.finalScore === 100),
      falseCurrentStateQualityDeductions: labResults.filter((row) => row.hasFalseCurrentStateQualityIssue).length,
    },
    comparison: {
      phase63: {
        apiCalls: compareNumber(totalCalls, BASELINE_63.apiCalls),
        retries: compareNumber(totalRetries, BASELINE_63.retries),
        finalAcceptedTasks: compareNumber(finalAcceptedTasks, BASELINE_63.finalAcceptedTasks),
        fullyAcceptedLabs: compareNumber(fullyAcceptedLabs, BASELINE_63.fullyAcceptedLabs),
        totalTokens: compareNumber(totalTokens.total, BASELINE_63.totalTokens),
        estimatedCostUsd: compareNumber(totalCost.estimatedUsd, BASELINE_63.estimatedCostUsd),
      },
      phase65: {
        apiCalls: compareNumber(totalCalls, BASELINE_65.apiCalls),
        retries: compareNumber(totalRetries, BASELINE_65.retries),
        firstAttemptAcceptedTasks: compareNumber(taskResults.filter((row) => row.firstAttemptAccepted).length, BASELINE_65.firstAttemptAcceptedTasks),
        finalAcceptedTasks: compareNumber(finalAcceptedTasks, BASELINE_65.finalAcceptedTasks),
        fullyAcceptedLabs: compareNumber(fullyAcceptedLabs, BASELINE_65.fullyAcceptedLabs),
        totalTokens: compareNumber(totalTokens.total, BASELINE_65.totalTokens),
        estimatedCostUsd: compareNumber(totalCost.estimatedUsd, BASELINE_65.estimatedCostUsd),
      },
    },
  };

  writeJson(path.join(reportDir, "summary.json"), summary);
  writeMarkdownSummary(path.join(reportDir, "summary.md"), summary);
  writeJson(path.join(reportDir, "lab-results.json"), labResults);
  writeJson(path.join(reportDir, "task-results.json"), taskResults);
  writeJson(path.join(reportDir, "task-attempts.json"), taskAttempts);
  writeJson(path.join(reportDir, "accepted-task-attempts.json"), acceptedTaskAttempts);
  writeJson(path.join(reportDir, "rejected-task-attempts.json"), rejectedTaskAttempts);
  writeJson(path.join(reportDir, "retry-report.json"), retryReport);
  writeJson(path.join(reportDir, "failure-classification.json"), { failuresByCategory: failureClassification, failures: failureRows });
  writeJson(path.join(reportDir, "token-cost-report.json"), { model, pricing: pricingForModel(model), tokens: totalTokens, cost: totalCost, labs: labResults.map((row) => ({ seed: row.seed, tokenUsage: row.tokenUsage, cost: row.cost })) });
  writeJson(path.join(reportDir, "scanner-report.json"), scannerReport);
  writeJson(path.join(reportDir, "adapter-report.json"), adapterReport.concat(taskAttempts.map((row) => ({ lab: row.lab, taskId: row.taskId, attemptNumber: row.attemptNumber, adapterResult: row.adapterResult }))));
  writeJson(path.join(reportDir, "assembly-report.json"), assemblyReport);
  writeJson(path.join(reportDir, "narrative-contract-report.json"), narrativeContractReport);
  writeJson(path.join(reportDir, "final-artifact-report.json"), finalArtifactReport);
  writeJson(path.join(reportDir, "final-quality-report.json"), finalQualityReport);
  writeJson(path.join(reportDir, "comparison-report.json"), summary.comparison);
  console.log(JSON.stringify(summary, null, 2));
  if (fullyAcceptedLabs !== MATRIX.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
