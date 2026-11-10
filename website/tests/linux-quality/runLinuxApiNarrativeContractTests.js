#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const ENABLED = process.env.CYBERLAB_RUN_API_TESTS === "1";
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, "test-output", "linux-live-api-qa");
const DEFAULT_MATRIX = [
  ["Beginner", "ssh_bruteforce", "15 mins", "api-phase4-b-1"],
  ["Beginner", "service_account_misuse", "30 mins", "api-phase4-b-2"],
  ["Beginner", "misconfigured_sudoers", "60 mins", "api-phase4-b-3"],
  ["Beginner", "cron_persistence", "15 mins", "api-phase4-b-4"],
  ["Beginner", "log_tampering", "30 mins", "api-phase4-b-5"],
  ["Intermediate", "ssh_key_compromise", "15 mins", "api-phase4-i-1"],
  ["Intermediate", "systemd_persistence", "30 mins", "api-phase4-i-2"],
  ["Intermediate", "unauthorized_package_install", "60 mins", "api-phase4-i-3"],
  ["Intermediate", "data_staging", "15 mins", "api-phase4-i-4"],
  ["Intermediate", "reverse_shell", "30 mins", "api-phase4-i-5"],
  ["Advanced", "docker_compromise", "15 mins", "api-phase4-a-1"],
  ["Advanced", "cron_persistence", "30 mins", "api-phase4-a-2"],
  ["Advanced", "systemd_persistence", "60 mins", "api-phase4-a-3"],
  ["Advanced", "ssh_key_compromise", "15 mins", "api-phase4-a-4"],
  ["Advanced", "unauthorized_package_install", "30 mins", "api-phase4-a-5"],
];

const LINUX_NARRATIVE_SERIALIZER_RULES = `
Linux serializer mode:
- You are not investigating the Linux incident. The deterministic investigation is already complete.
- Your only job is to serialize the supplied Linux narrative contract into learner-facing English and the required JSON fields.
- The Linux narrative contract is the complete investigation universe. Treat everything outside it as false.
- Use only contract values. Do not use cybersecurity knowledge, common Linux knowledge, assumptions, substitutions, or gap filling.
- If a fact is absent from the contract, omit it completely. Do not create replacement content.
- Never invent filenames, users, services, processes, packages, commands, evidence, timestamps, relationships, capabilities, recommendations, task steps, root cause, attacker identity, compromise status, or business impact.
- Every learner-facing sentence must be traceable to the supplied contract.
- Every task is task-local. A value allowed for one task is forbidden for every other task unless it also appears in that other task contract.
- For task.evidence and claim.supporting_evidence, use exact selectedEvidence[].path values from that same task only. Never use selectedEvidence[].id, displayName, evidence: aliases, globalRenderedEvidencePaths, or an evidence path selected for another task.
- For claim.subjects, use exact groundedSubjects[].id values from that same task only. If no relevant subject appears in that task, use an empty subjects array.
- Each claim.subjects array item must be one exact groundedSubjects[].id string. Do not combine multiple subject IDs into one comma-separated string.
- For claim.relationships, use only exact groundedRelationships[].relation and subjectIds from that same task. If no exact relationship appears, use an empty relationships array.
- Each relationship subject_ids array item must be one exact subjectIds value. Do not combine multiple IDs into one string.
- For claim.timestamps, use only allowedTimestamps from that same task or the global incident window values. If no exact timestamp is needed, use an empty timestamps array.
- Use current_state only when that same task has allowedCurrentStateFacts or a current-state capability in requiredCapabilities. Otherwise use observed, historical_state, bounded_inference, or recommendation as supported.
- Use bounded_inference only for uncertainty, consistency with rendered change/maintenance records, or additional evidence needed. Do not turn two supported facts into a new unsupported conclusion.
- Use recommendation only within that task's allowedRecommendationCategories. If no concrete recommendation is supplied, limit it to evidence gaps or next validation.
- Do not mention any capability unless it appears in that task's requiredCapabilities or allowed fact lists.
- Do not copy raw capability labels such as authentication, command execution, process ancestry, service transition, evidence integrity, change control, or current policy state into learner-facing prose unless the same capability is expressly allowed for that exact task.
- Capability arrays are machine constraints, not wording suggestions.
- Task titles and deliverables must be concrete analyst actions using supplied scenario and evidence terms. Do not use only the contract objective label, a number, or a generic word such as timeline, analysis, collection, inventory, context, or review.
- Put case ID, ticket ID, change ID, host, host role, primary service, incident window, timezone, and company in objective or scenario when supplied. Do not put case or ticket metadata in the title.
- Before finalizing internally remove any sentence, evidence item, subject, relationship, timestamp, or recommendation that is not explicitly present in the relevant task contract. Do not output this self-check.
`.trim();

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
  const build = path.join(os.tmpdir(), `cyberlab-linux-api-narrative-contract-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function buildCandidateForRequestedFamily(buildLinuxAssetCandidate, input, family, seed) {
  const attempts = [];
  let lastError;
  for (let draw = 0; draw < 80; draw += 1) {
    const generationSeed = `${seed}:draw:${draw}`;
    try {
      const candidate = buildLinuxAssetCandidate({ ...input, seed: generationSeed, generationTime: "2026-07-29T08:00:00.000Z" }, { incidentFamily: family });
      attempts.push({
        draw,
        generationSeed,
        accepted: candidate.investigation.incidentFamily === family,
        incidentFamily: candidate.investigation.incidentFamily,
        hostRole: candidate.investigation.hostRole,
      });
      if (candidate.investigation.incidentFamily === family) {
        return { candidate, generationSeed, assetAttempts: attempts };
      }
    } catch (error) {
      lastError = error;
      attempts.push({
        draw,
        generationSeed,
        accepted: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const error = new Error(`Linux asset validation failed for requested family ${family}: ${lastError instanceof Error ? lastError.message : String(lastError || "no candidate")}`);
  error.assetAttempts = attempts;
  throw error;
}

function schemaForContract(contract) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", maxLength: 140 },
      topic: { type: "string", enum: ["Linux"] },
      objective: { type: "string", maxLength: 500 },
      scenario: { type: "string", maxLength: 1200 },
      tasks: {
        type: "array",
        minItems: contract.canonicalTaskCount,
        maxItems: contract.canonicalTaskCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            task_id: { type: "string", enum: contract.taskContracts.map((task) => task.taskId) },
            task_intent: { type: "string", enum: contract.taskContracts.map((task) => task.intent) },
            phase: { type: "string", maxLength: 40 },
            title: { type: "string", maxLength: 240 },
            evidence: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: { type: "string", maxLength: 120 },
            },
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
                  supporting_evidence: { type: "array", minItems: 0, maxItems: 3, items: { type: "string", maxLength: 120 } },
                  subjects: { type: "array", minItems: 0, maxItems: 8, items: { type: "string", maxLength: 120 } },
                  relationships: {
                    type: "array",
                    minItems: 0,
                    maxItems: 6,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        relation: { type: "string", maxLength: 80 },
                        subject_ids: { type: "array", minItems: 0, maxItems: 8, items: { type: "string", maxLength: 120 } },
                      },
                      required: ["relation", "subject_ids"],
                    },
                  },
                  timestamps: { type: "array", minItems: 0, maxItems: 8, items: { type: "string", maxLength: 40 } },
                },
                required: ["claim_class", "text", "supporting_evidence", "subjects", "relationships", "timestamps"],
              },
            },
          },
          required: ["task_id", "task_intent", "phase", "title", "evidence", "deliverable", "claims"],
        },
      },
      hints: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", maxLength: 260 } },
      outcomes: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", maxLength: 220 } },
    },
    required: ["title", "topic", "objective", "scenario", "tasks", "hints", "outcomes"],
  };
}

function enumItems(values, maxLength = 120) {
  return values.length > 0 ? { type: "string", enum: values, maxLength } : { type: "string", maxLength };
}

function schemaForTask(task) {
  const evidencePaths = task.selectedEvidence.map((asset) => asset.path);
  const subjectIds = task.groundedSubjects.map((subject) => subject.id);
  const relationNames = [...new Set(task.groundedRelationships.map((relationship) => relationship.relation))];
  const relationSubjectIds = [...new Set(task.groundedRelationships.flatMap((relationship) => relationship.subjectIds))];
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      task_id: { type: "string", enum: [task.taskId] },
      task_intent: { type: "string", enum: [task.intent] },
      phase: { type: "string", maxLength: 40 },
      title: { type: "string", maxLength: 240 },
      evidence: {
        type: "array",
        minItems: 1,
        maxItems: Math.min(3, evidencePaths.length),
        items: { type: "string", enum: evidencePaths, maxLength: 120 },
      },
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
            supporting_evidence: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(3, evidencePaths.length),
              items: { type: "string", enum: evidencePaths, maxLength: 120 },
            },
            subjects: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(8, subjectIds.length),
              items: enumItems(subjectIds),
            },
            relationships: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(6, task.groundedRelationships.length),
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  relation: enumItems(relationNames, 80),
                  subject_ids: {
                    type: "array",
                    minItems: 0,
                    maxItems: Math.min(8, relationSubjectIds.length),
                    items: enumItems(relationSubjectIds),
                  },
                },
                required: ["relation", "subject_ids"],
              },
            },
            timestamps: {
              type: "array",
              minItems: 0,
              maxItems: Math.min(8, task.allowedTimestamps.length),
              items: enumItems(task.allowedTimestamps, 40),
            },
          },
          required: ["claim_class", "text", "supporting_evidence", "subjects", "relationships", "timestamps"],
        },
      },
    },
    required: ["task_id", "task_intent", "phase", "title", "evidence", "deliverable", "claims"],
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

function taskPrompt(contract, task, feedback = "") {
  return [
    "Serialize exactly one Linux investigation task.",
    LINUX_NARRATIVE_SERIALIZER_RULES,
    "This call is task-isolated. The task contract below is the complete universe for this task.",
    "Do not reference any other task, any global evidence not listed in selectedEvidence, or any relationship/capability not listed in this task contract.",
    "Return one JSON object for this task only. Do not return title, scenario, hints, outcomes, or other tasks.",
    "Use exact selectedEvidence[].path values in evidence and supporting_evidence.",
    "Use exact groundedSubjects[].id values only when needed; otherwise use an empty subjects array.",
    "Use exact groundedRelationships only when the full relation and subject_ids match; otherwise use an empty relationships array.",
    feedback ? `Task retry feedback:\n${feedback}` : "",
    JSON.stringify({
      version: contract.version,
      caseId: contract.caseId,
      difficulty: contract.difficulty,
      scenarioFraming: contract.scenarioFraming,
      taskContract: task,
      narrativeConstraints: contract.narrativeConstraints,
      prohibitedCapabilityClaims: contract.prohibitedCapabilityClaims,
    }, null, 2),
  ].filter(Boolean).join("\n\n");
}

function assembledNarrative(contract, investigation, difficulty, duration, tasks) {
  const window = `${investigation.incidentWindowStart}-${investigation.incidentWindowEnd}`;
  return {
    title: `Linux ${contract.scenarioFraming.primaryService} evidence review on ${investigation.hostname}`,
    topic: "Linux",
    objective: `Use the supplied Linux evidence for ${investigation.incidentId} to document ${investigation.hostname} activity during ${window} ${investigation.timezone}.`,
    scenario: `${investigation.company} analysts are reviewing ${investigation.hostname}, a ${investigation.hostRole}, for ticket ${investigation.ticketId} and change ${investigation.changeId}. The evidence pack focuses on ${contract.scenarioFraming.primaryService} during ${window} ${investigation.timezone}; each task is limited to its listed evidence paths.`,
    tasks,
    hints: [
      `Keep each note tied to the evidence listed for that task on ${investigation.hostname}.`,
      `Use the ${window} ${investigation.timezone} window as the boundary for timestamped activity.`,
      "Separate observed evidence from uncertainty or recommended validation steps.",
    ],
    outcomes: [
      "Build task-local Linux findings without using evidence from unrelated tasks.",
      "Trace each claim to selected evidence paths, subjects, relationships, and timestamps.",
      `Summarize evidence for ${investigation.hostname} without adding unsupported conclusions.`,
    ],
  };
}

async function callOpenAIAttempt({ model, contract, prompt, feedback, attempt }) {
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
          "You are a deterministic serializer for the supplied Linux narrative contract.",
          "Treat everything outside the contract as false.",
          "Use no cybersecurity or Linux knowledge beyond the contract.",
          "Keep every narrative claim inside the exact task-local evidence, subject, relationship, timestamp, and capability boundaries supplied in the contract.",
        ].join(" "),
        input: `${prompt}\n${feedback || ""}`,
        max_output_tokens: 5200,
        reasoning: { effort: "minimal" },
        text: {
          format: {
            type: "json_schema",
            name: "cyberlab_linux_narrative_contract_test",
            strict: true,
            schema: schemaForContract(contract),
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
    runtimeError: response.ok ? null : JSON.stringify(data.error || data).slice(0, 600),
    rawText,
    responseId: data.id,
  };
}

async function callOpenAITaskAttempt({ model, prompt, schema, feedback, attempt }) {
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
        input: `${prompt}\n${feedback || ""}`,
        max_output_tokens: 1600,
        reasoning: { effort: "minimal" },
        text: {
          format: {
            type: "json_schema",
            name: "cyberlab_linux_task_narrative_contract_test",
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
    runtimeError: response.ok ? null : JSON.stringify(data.error || data).slice(0, 600),
    rawText,
    responseId: data.id,
  };
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

function classifyFailure(record) {
  const classes = new Set();
  const codes = record.narrativeContractIssueCodes || [];
  if (codes.some((code) => /COUNT|MISSING|DUPLICATE|UNKNOWN|INTENT|ORDER|PROHIBITED|INTERNAL_DETAIL|LOCAL_PATH|UNBOUNDED|UNSUPPORTED/.test(code))) classes.add("CONTRACT_VIOLATION");
  if (codes.some((code) => /EVIDENCE_OUTSIDE|UNRENDERED_EVIDENCE/.test(code))) classes.add("HALLUCINATED_EVIDENCE");
  if (codes.some((code) => /UNKNOWN_SUBJECT/.test(code))) classes.add("UNKNOWN_SUBJECT");
  if (codes.some((code) => /UNSUPPORTED_RELATIONSHIP/.test(code))) classes.add("UNKNOWN_RELATIONSHIP");
  if (codes.some((code) => /UNSUPPORTED_CURRENT_STATE/.test(code))) classes.add("UNSUPPORTED_CURRENT_STATE");
  if (codes.some((code) => /UNSUPPORTED_HISTORICAL_STATE/.test(code))) classes.add("UNSUPPORTED_HISTORICAL_STATE");
  if (codes.some((code) => /UNSUPPORTED_RECOMMENDATION/.test(code))) classes.add("UNSUPPORTED_RECOMMENDATION");
  if (codes.some((code) => /TIMESTAMP/.test(code))) classes.add("TIMESTAMP_ERROR");
  if (codes.some((code) => /ORDER/.test(code))) classes.add("TASK_ORDER_ERROR");
  if ((record.finalQualityIssueCategories || []).length > 0) classes.add("QUALITY_FAILURE");
  if ((record.schemaIssues || []).length > 0) classes.add("SCHEMA_ERROR");
  if ((record.parserIssues || []).length > 0) classes.add("PARSER_ERROR");
  if ((record.apiRuntimeIssues || []).some((item) => /rate/i.test(item))) classes.add("RATE_LIMIT");
  if ((record.apiRuntimeIssues || []).some((item) => /timeout/i.test(item))) classes.add("TIMEOUT");
  if ((record.apiRuntimeIssues || []).length > 0) classes.add("API_ERROR");
  if (!record.accepted && classes.size === 0) classes.add("OTHER");
  return Array.from(classes);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeMarkdownSummary(file, summary) {
  const lines = [
    "# CyberLab Linux Phase 6 Live API Narrative Validation",
    "",
    `Run ID: ${summary.runId}`,
    `Model: ${summary.model}`,
    `Status: ${summary.status}`,
    "",
    "## Results",
    "",
    `- Requested generations: ${summary.requested}`,
    `- Completed generations: ${summary.completed}`,
    `- Accepted: ${summary.accepted}`,
    `- Failed: ${summary.failed}`,
    `- First-attempt accepted: ${summary.firstAttemptAccepted}`,
    `- Total API calls: ${summary.totalApiCalls}`,
    `- Total retries: ${summary.totalRetries}`,
    `- Prompt tokens: ${summary.totalPromptTokens}`,
    `- Completion tokens: ${summary.totalCompletionTokens}`,
    `- Cached tokens: ${summary.totalCachedTokens}`,
    `- Reasoning tokens: ${summary.totalReasoningTokens}`,
    `- Total tokens: ${summary.totalTokens}`,
    `- Average retries: ${summary.averageRetries.toFixed(2)}`,
    `- Average latency ms: ${summary.averageLatencyMs.toFixed(0)}`,
    `- Average quality score: ${summary.averageQualityScore === null ? "n/a" : summary.averageQualityScore.toFixed(2)}`,
    `- Estimated cost USD: ${summary.cost.estimatedUsd.toFixed(6)}`,
    "",
    "## Failure Classification",
    "",
    ...Object.entries(summary.failureClassification).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Generation Results",
    "",
    ...summary.results.map((item) => `- ${item.accepted ? "PASS" : "FAIL"} ${item.difficulty} ${item.incidentFamily} ${item.duration} seed=${item.seed} attempts=${item.attempts} score=${item.finalScore ?? "n/a"}`),
    "",
  ];
  fs.writeFileSync(file, lines.join("\n"));
}

function buildFinalLab(investigation, narrative, difficulty, duration) {
  return {
    title: narrative.title,
    topic: "Linux",
    difficulty,
    estimated_time: duration,
    objective: narrative.objective,
    scenario: narrative.scenario,
    tasks: narrative.tasks.map((task) => ({
      phase: task.phase,
      title: task.title,
      evidence: task.evidence,
      deliverable: task.deliverable,
    })),
    hints: narrative.hints,
    outcomes: narrative.outcomes,
  };
}

async function main() {
  if (!ENABLED) {
    console.log("SKIP Linux API narrative contract tests: set CYBERLAB_RUN_API_TESTS=1 to enable.");
    return;
  }
  loadEnvLocal();
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("CYBERLAB_RUN_API_TESTS=1 was set but OPENAI_API_KEY is missing.");
  }
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxNarrativeContract, buildLinuxCanonicalNarrativeBrief, assertLinuxTaskEvidenceClosureInvariant } = require(path.join(out, "linux", "simulation.js"));
  const { validateLinuxGeneratedNarrativeAgainstContract, linuxNarrativeContractRetryFeedback } = require(path.join(out, "linux", "narrativeContract.js"));
  const {
    adaptLinuxGeneratedTaskFromView,
    buildLinuxTaskGenerationView,
    linuxSanitizedRetryFeedback,
    linuxTaskGenerationSchema,
    serializeLinuxTaskGenerationPrompt,
  } = require(path.join(out, "linux", "narrativeGenerationView.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const model = process.env.CYBERLAB_API_TEST_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
  const maxRetries = Number(process.env.CYBERLAB_API_TEST_MAX_RETRIES || 2);
  const requested = Number(process.env.CYBERLAB_API_TEST_COUNT || DEFAULT_MATRIX.length);
  const maxCalls = Number(process.env.CYBERLAB_API_TEST_MAX_CALLS || requested * 8 * (maxRetries + 1));
  const startIndex = Number(process.env.CYBERLAB_API_TEST_START_INDEX || 0);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.resolve(process.env.CYBERLAB_API_TEST_OUT || path.join(DEFAULT_OUTPUT_ROOT, runId));
  fs.mkdirSync(reportDir, { recursive: true });
  const results = [];
  const acceptedNarratives = [];
  const rejectedNarratives = [];
  const retryReport = [];
    const tokenReport = [];
  const latencyReport = [];
  let calls = 0;

  for (const [difficulty, family, duration, seed] of DEFAULT_MATRIX.slice(startIndex, startIndex + requested)) {
    if (calls >= maxCalls) break;
    const { candidate, generationSeed, assetAttempts } = buildCandidateForRequestedFamily(
      buildLinuxAssetCandidate,
      { category: "Linux", difficulty, duration, title: "CyberLab Asset Pack" },
      family,
      seed
    );
    assertLinuxTaskEvidenceClosureInvariant(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
    let accepted = false;
    let contractResult = null;
    let finalQuality = null;
    let finalNarrative = null;
    let retryReason = "";
    const attempts = [];
    const parserIssues = [];
    const apiRuntimeIssues = [];

    const acceptedTasks = [];
    for (const task of contract.taskContracts) {
      let taskAccepted = false;
      let feedback = "";
      for (let taskAttempt = 1; taskAttempt <= maxRetries + 1; taskAttempt += 1) {
        if (calls >= maxCalls) break;
        const generationView = buildLinuxTaskGenerationView({ contract, task });
        const apiAttempt = await callOpenAITaskAttempt({
          model,
          prompt: serializeLinuxTaskGenerationPrompt({ view: generationView, feedback }),
          schema: linuxTaskGenerationSchema(generationView),
          feedback,
          attempt: attempts.length + 1,
        });
        attempts.push({ ...apiAttempt, taskId: task.taskId });
        calls += 1;
        if (!apiAttempt.ok) {
          apiRuntimeIssues.push(apiAttempt.runtimeError || `HTTP ${apiAttempt.status}`);
          retryReason = `task ${task.taskId} API/runtime issue`;
          feedback = "The previous API call failed. Return one complete JSON object matching the one-task schema.";
          continue;
        }
        if (!apiAttempt.parsed) {
          parserIssues.push(apiAttempt.parseError || `Task ${task.taskId} response did not parse as JSON.`);
          retryReason = `task ${task.taskId} parser/schema issue`;
          feedback = "The previous response was not parseable JSON. Return one complete JSON object matching the one-task schema.";
          continue;
        }

        const adaptedTask = adaptLinuxGeneratedTaskFromView({ task, generated: apiAttempt.parsed });
        const isolatedContract = taskIsolatedContract(contract, task);
        const taskValidation = validateLinuxGeneratedNarrativeAgainstContract(isolatedContract, {
          title: "Linux task evidence review",
          objective: `Use selected evidence for ${contract.caseId} during ${contract.scenarioFraming.incidentWindow} ${contract.scenarioFraming.timezone}.`,
          scenario: `${contract.scenarioFraming.hostname} is reviewed as a ${contract.scenarioFraming.hostRole}.`,
          tasks: [adaptedTask],
          hints: ["Use only selected task evidence.", "Keep the task-local scope.", "Separate observation from uncertainty."],
          outcomes: ["Task-local evidence review.", "Supported claim mapping.", "Bounded analyst notes."],
        });
        if (!taskValidation.passed) {
          contractResult = taskValidation;
          retryReason = `task ${task.taskId} contract violation: ${taskValidation.issues.map((issue) => issue.code).join("|")}`;
          feedback = linuxSanitizedRetryFeedback(taskValidation.issues.map((issue) => issue.message));
          continue;
        }

        acceptedTasks.push(adaptedTask);
        taskAccepted = true;
        break;
      }
      if (!taskAccepted) break;
    }

    if (acceptedTasks.length === contract.taskContracts.length) {
      finalNarrative = assembledNarrative(contract, candidate.investigation, difficulty, duration, acceptedTasks);
      contractResult = validateLinuxGeneratedNarrativeAgainstContract(contract, finalNarrative);
      if (!contractResult.passed) {
        retryReason = `assembled contract violation: ${contractResult.issues.map((issue) => issue.code).join("|")}`;
      } else {
        finalQuality = checkLinuxFinalProductionQuality({
          context: candidate.investigation,
          assets: candidate.assets,
          simulation: candidate.simulation,
          lab: buildFinalLab(candidate.investigation, finalNarrative, difficulty, duration),
        });
        if (!finalQuality.passed || finalQuality.issues.length > 0) {
          retryReason = `quality failure: ${finalQuality.issues.map((issue) => `${issue.category}:${issue.description}`).join(" | ") || "score threshold"}`;
        } else {
          accepted = true;
          retryReason = "";
        }
      }
    }

    const usage = tokenUsage(attempts);
    const cost = estimatedCost(usage, model);
    const record = {
      seed,
      generationSeed,
      difficulty,
      duration,
      incidentFamily: family,
      incidentType: candidate.investigation.incidentType,
      model,
      attempts: attempts.length,
      retries: Math.max(0, attempts.length - 1),
      firstAttemptAccepted: accepted && attempts.length === 1,
      accepted,
      narrativeContractIssueCodes: contractResult ? contractResult.issues.map((issue) => issue.code) : ["NO_MODEL_RESPONSE"],
      contractViolations: contractResult ? contractResult.issues : [],
      finalQualityIssueCategories: finalQuality ? finalQuality.issues.map((issue) => issue.category) : [],
      qualityFailures: finalQuality ? finalQuality.issues : [],
      parserIssues,
      apiRuntimeIssues,
      retryReason,
      promptTokens: usage.input,
      completionTokens: usage.output,
      cachedTokens: usage.cached,
      reasoningTokens: usage.reasoning,
      totalTokens: usage.total,
      latencyMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
      estimatedCostUsd: cost.estimatedUsd,
      finalScore: finalQuality ? finalQuality.finalProductionScore : null,
      taskCount: contract.canonicalTaskCount,
      renderedAssetCount: candidate.assets.length,
      assetAttempts,
      selectedEvidenceCount: contract.taskContracts.reduce((sum, task) => sum + task.selectedEvidence.length, 0),
      unknownSubjectCount: contractResult?.metrics.unknownSubjectCount || 0,
      unsupportedRelationshipCount: contractResult?.metrics.unsupportedRelationshipCount || 0,
      inventedTimestampCount: contractResult?.metrics.inventedTimestampCount || 0,
      unsupportedCurrentStateCount: contractResult?.metrics.unsupportedCurrentStateCount || 0,
      unrenderedEvidenceCount: contractResult?.metrics.unrenderedEvidenceCount || 0,
    };
    record.failureClasses = accepted ? [] : classifyFailure(record);
    results.push(record);

    const narrativeRecord = {
      record,
      narrative: finalNarrative,
      contractSummary: {
        caseId: contract.caseId,
        taskCount: contract.canonicalTaskCount,
        taskIntents: contract.taskContracts.map((task) => task.intent),
      },
      attempts: attempts.map((attempt) => ({
        attempt: attempt.attempt,
        ok: attempt.ok,
        status: attempt.status,
        durationMs: attempt.durationMs,
        usage: attempt.usage,
        parseError: attempt.parseError,
        runtimeError: attempt.runtimeError,
        responseId: attempt.responseId,
      })),
    };
    attempts.forEach((attempt) => {
      writeJson(path.join(reportDir, "raw-api-responses", `${seed}-attempt-${attempt.attempt}.json`), {
        seed,
        difficulty,
        incidentFamily: family,
        attempt: attempt.attempt,
        ok: attempt.ok,
        status: attempt.status,
        durationMs: attempt.durationMs,
        usage: attempt.usage,
        responseId: attempt.responseId,
        rawText: attempt.rawText,
        parseError: attempt.parseError,
        runtimeError: attempt.runtimeError,
      });
    });
    writeJson(path.join(reportDir, "validation-results", `${seed}.json`), {
      seed,
      difficulty,
      incidentFamily: family,
      duration,
      accepted,
      contractValidation: contractResult,
      finalQuality,
      parserIssues,
      apiRuntimeIssues,
      finalScore: finalQuality ? finalQuality.finalProductionScore : null,
    });
    if (accepted) {
      acceptedNarratives.push(narrativeRecord);
    } else {
      rejectedNarratives.push(narrativeRecord);
      if (process.env.CYBERLAB_API_TEST_RETAIN_FAILURES === "1") {
        writeJson(path.join(reportDir, "rejected", `${seed}-failure.json`), {
          ...narrativeRecord,
          contract,
        });
      }
    }
    retryReport.push({
      seed,
      difficulty,
      incidentFamily: family,
      accepted,
      attempts: attempts.length,
      retries: Math.max(0, attempts.length - 1),
      retryReason,
      attemptStatuses: attempts.map((attempt) => ({ attempt: attempt.attempt, ok: attempt.ok, status: attempt.status, durationMs: attempt.durationMs })),
    });
    tokenReport.push({
      seed,
      difficulty,
      incidentFamily: family,
      promptTokens: usage.input,
      completionTokens: usage.output,
      cachedTokens: usage.cached,
      reasoningTokens: usage.reasoning,
      totalTokens: usage.total,
      estimatedCostUsd: cost.estimatedUsd,
      latencyMs: record.latencyMs,
    });
    latencyReport.push({
      seed,
      difficulty,
      incidentFamily: family,
      attempts: attempts.length,
      latencyMs: record.latencyMs,
      attemptLatencies: attempts.map((attempt) => ({ attempt: attempt.attempt, durationMs: attempt.durationMs })),
    });
    console.log(`${accepted ? "PASS" : "FAIL"} ${difficulty} ${family} seed=${seed} attempts=${attempts.length} issues=${record.narrativeContractIssueCodes.join("|")}`);
  }

  const issueCounts = {};
  for (const result of results) {
    for (const code of result.narrativeContractIssueCodes) issueCounts[code] = (issueCounts[code] || 0) + 1;
  }
  const failureClassification = {};
  for (const result of results.filter((item) => !item.accepted)) {
    for (const failureClass of result.failureClasses) {
      failureClassification[failureClass] = (failureClassification[failureClass] || 0) + 1;
    }
  }
  const totalUsage = results.reduce((sum, result) => ({
    input: sum.input + result.promptTokens,
    output: sum.output + result.completionTokens,
    cached: sum.cached + result.cachedTokens,
    reasoning: sum.reasoning + result.reasoningTokens,
    total: sum.total + result.totalTokens,
  }), { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 });
  const totalCost = estimatedCost(totalUsage, model);
  const acceptedResults = results.filter((result) => result.accepted);
  const failuresByDifficulty = {};
  const failuresByFamily = {};
  const retryReasons = {};
  for (const result of results.filter((item) => !item.accepted)) {
    failuresByDifficulty[result.difficulty] = (failuresByDifficulty[result.difficulty] || 0) + 1;
    failuresByFamily[result.incidentFamily] = (failuresByFamily[result.incidentFamily] || 0) + 1;
  }
  for (const result of results.filter((item) => item.retryReason)) {
    retryReasons[result.retryReason] = (retryReasons[result.retryReason] || 0) + 1;
  }
  const failedResults = results.filter((result) => !result.accepted);
  const finalStatus = results.length === requested && failedResults.length === 0
    ? "READY_FOR_EXPANDED_API_QA"
    : failedResults.some((result) => (result.apiRuntimeIssues || []).length > 0)
      ? "NOT_READY"
      : failedResults.some((result) => (result.narrativeContractIssueCodes || []).length > 0)
        ? "PROMPT_ALIGNMENT_REQUIRED"
        : failedResults.some((result) => (result.qualityFailures || []).length > 0)
          ? "READY_WITH_MINOR_PROMPT_REFINEMENTS"
          : "PROMPT_ALIGNMENT_REQUIRED";
  const summary = {
    runId,
    status: finalStatus,
    reportDir,
    model,
    maxRetries,
    requested,
    completed: results.length,
    accepted: results.filter((result) => result.accepted).length,
    failed: results.filter((result) => !result.accepted).length,
    acceptanceRate: results.length ? results.filter((result) => result.accepted).length / results.length : 0,
    firstAttemptAccepted: results.filter((result) => result.firstAttemptAccepted).length,
    firstAttemptAcceptanceRate: results.length ? results.filter((result) => result.firstAttemptAccepted).length / results.length : 0,
    totalApiCalls: calls,
    totalRetries: results.reduce((sum, result) => sum + Math.max(0, result.attempts - 1), 0),
    totalPromptTokens: totalUsage.input,
    totalCompletionTokens: totalUsage.output,
    totalCachedTokens: totalUsage.cached,
    totalReasoningTokens: totalUsage.reasoning,
    totalTokens: totalUsage.total,
    averageRetries: results.length ? results.reduce((sum, result) => sum + result.retries, 0) / results.length : 0,
    averagePromptTokens: results.length ? totalUsage.input / results.length : 0,
    averageCompletionTokens: results.length ? totalUsage.output / results.length : 0,
    averageTotalTokens: results.length ? totalUsage.total / results.length : 0,
    averageLatencyMs: results.length ? results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length : 0,
    averageEstimatedCostUsd: results.length ? results.reduce((sum, result) => sum + result.estimatedCostUsd, 0) / results.length : 0,
    averageQualityScore: acceptedResults.length ? acceptedResults.reduce((sum, result) => sum + (result.finalScore || 0), 0) / acceptedResults.length : null,
    cost: totalCost,
    failuresByIssueCode: issueCounts,
    failureClassification,
    failuresByDifficulty,
    failuresByFamily,
    retryReasons,
    contractViolations: results.reduce((sum, result) => sum + (result.contractViolations || []).length, 0),
    hallucinatedEvidence: failureClassification.HALLUCINATED_EVIDENCE || 0,
    unsupportedClaims: (failureClassification.UNSUPPORTED_CURRENT_STATE || 0) + (failureClassification.UNSUPPORTED_HISTORICAL_STATE || 0) + (failureClassification.UNSUPPORTED_RECOMMENDATION || 0),
    parserFailures: failureClassification.PARSER_ERROR || 0,
    qualityFailures: failureClassification.QUALITY_FAILURE || 0,
    results,
  };
  writeJson(path.join(reportDir, "summary.json"), summary);
  writeMarkdownSummary(path.join(reportDir, "summary.md"), summary);
  writeJson(path.join(reportDir, "accepted-generations.json"), acceptedNarratives);
  writeJson(path.join(reportDir, "rejected-generations.json"), rejectedNarratives);
  writeJson(path.join(reportDir, "retry-report.json"), retryReport);
  writeJson(path.join(reportDir, "token-usage.json"), tokenReport);
  writeJson(path.join(reportDir, "latency-report.json"), latencyReport);
  writeJson(path.join(reportDir, "cost-report.json"), {
    model,
    pricing: pricingForModel(model),
    promptTokens: totalUsage.input,
    completionTokens: totalUsage.output,
    cachedTokens: totalUsage.cached,
    reasoningTokens: totalUsage.reasoning,
    totalTokens: totalUsage.total,
    estimatedCostUsd: totalCost.estimatedUsd,
  });
  writeJson(path.join(reportDir, "failure-classification.json"), {
    failuresByCategory: failureClassification,
    failuresByIssueCode: issueCounts,
    failuresByDifficulty,
    failuresByFamily,
    retryReasons,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
