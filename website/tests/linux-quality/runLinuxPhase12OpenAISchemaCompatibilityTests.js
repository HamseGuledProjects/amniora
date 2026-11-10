#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function compile() {
  const build = path.join(os.tmpdir(), `amniora-linux-phase12-openai-schema-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return build;
}

function installResolver(build) {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function resolvePhase12Schema(request, parent, isMain, options) {
    if (request === "server-only") {
      return path.join(ROOT, "node_modules", "next", "dist", "compiled", "server-only", "empty.js");
    }
    if (request.startsWith("@/")) {
      const compiledRequest = path.join(build, request.slice(2));
      for (const candidate of [`${compiledRequest}.js`, path.join(compiledRequest, "index.js")]) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return originalResolve.call(this, request, parent, isMain, options);
  };
}

const unsupportedKeywords = new Set([
  "allOf",
  "oneOf",
  "not",
  "$ref",
  "$defs",
  "definitions",
  "patternProperties",
  "unevaluatedProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "unevaluatedItems",
  "contains",
  "minContains",
  "maxContains",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "multipleOf",
]);

const supportedTypes = new Set(["string", "number", "boolean", "integer", "object", "array", "null"]);

function typeSet(schema) {
  if (typeof schema.type === "string") return new Set([schema.type]);
  if (Array.isArray(schema.type)) return new Set(schema.type);
  return new Set();
}

function validateOpenAISchemaNode(schema, pathLabel = "$", issues = []) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    issues.push(`${pathLabel}: schema node must be an object`);
    return issues;
  }
  for (const key of Object.keys(schema)) {
    if (unsupportedKeywords.has(key)) issues.push(`${pathLabel}: unsupported keyword ${key}`);
  }
  if (schema.const !== undefined && schema.type === undefined) issues.push(`${pathLabel}: const requires explicit type`);
  if (schema.enum !== undefined && schema.type === undefined) issues.push(`${pathLabel}: enum requires explicit type`);
  if (schema.type !== undefined) {
    const values = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!values.length) issues.push(`${pathLabel}: empty type`);
    for (const value of values) {
      if (!supportedTypes.has(value)) issues.push(`${pathLabel}: unsupported type ${value}`);
    }
  }
  if (schema.const !== undefined && schema.type !== undefined) {
    const types = typeSet(schema);
    if (!types.has(typeof schema.const)) issues.push(`${pathLabel}: const type does not match declared type`);
  }
  if (Array.isArray(schema.enum) && schema.type !== undefined) {
    const types = typeSet(schema);
    for (const value of schema.enum) {
      const valueType = value === null ? "null" : typeof value;
      if (!types.has(valueType)) issues.push(`${pathLabel}: enum value ${JSON.stringify(value)} does not match declared type`);
    }
  }
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
      issues.push(`${pathLabel}: anyOf must be a non-empty array`);
    } else {
      schema.anyOf.forEach((branch, index) => {
        if (!branch || typeof branch !== "object" || Array.isArray(branch)) {
          issues.push(`${pathLabel}.anyOf[${index}]: anyOf branch must be a typed schema object`);
          return;
        }
        if (branch.type === undefined && branch.anyOf === undefined) issues.push(`${pathLabel}.anyOf[${index}]: anyOf branch must declare type or nested anyOf`);
        validateOpenAISchemaNode(branch, `${pathLabel}.anyOf[${index}]`, issues);
      });
    }
  }
  const types = typeSet(schema);
  if (types.has("object")) {
    if (schema.additionalProperties !== false) issues.push(`${pathLabel}: object must set additionalProperties false`);
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) issues.push(`${pathLabel}: object must define properties`);
    const keys = Object.keys(schema.properties || {});
    if (!Array.isArray(schema.required)) issues.push(`${pathLabel}: object must define required`);
    else {
      const required = new Set(schema.required);
      for (const key of keys) {
        if (!required.has(key)) issues.push(`${pathLabel}: property ${key} is missing from required`);
      }
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      validateOpenAISchemaNode(child, `${pathLabel}.properties.${key}`, issues);
    }
  }
  if (types.has("array")) {
    if (!schema.items || typeof schema.items !== "object" || Array.isArray(schema.items)) issues.push(`${pathLabel}: array must define typed items`);
    else validateOpenAISchemaNode(schema.items, `${pathLabel}.items`, issues);
  }
  return issues;
}

function apiExtraction(schemaRuntime, overrides = {}) {
  return {
    version: schemaRuntime.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION,
    taskId: "task:1:scope_timeline",
    candidateRegistryHash: "registry-hash",
    candidateSelections: null,
    atomicClaims: null,
    claims: null,
    uncertaintyAssertions: null,
    remediationActions: null,
    unparsedStatements: null,
    ...overrides,
  };
}

function responseJson(body, status = 200, requestId = "req_schema_test") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
    },
  });
}

function textResponse(schemaRuntime, extraction = apiExtraction(schemaRuntime), extras = {}) {
  return responseJson({
    id: "resp_schema_test",
    status: "completed",
    output_text: JSON.stringify(extraction),
    usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    ...extras,
  });
}

async function runAdapterParsingAssertions(adapter, schemaRuntime) {
  const extraction = apiExtraction(schemaRuntime);
  const extractor = (responseFactory, attempts = []) => adapter.createOpenAIResponsesLinuxAssessmentExtractor({
    model: "gpt-5-mini",
    fetcher: async () => responseFactory(),
    onAttempt: (attempt) => attempts.push(attempt),
  });

  const textAttempts = [];
  const textResult = await extractor(() => textResponse(schemaRuntime), textAttempts)({ prompt: "prompt", schemaVersion: schemaRuntime.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION, modelConfigurationId: "test" });
  assert("adapter parses output_text JSON fallback", textResult.ok && textResult.parsed.taskId === extraction.taskId);
  assert("adapter records usage tokens and request id", textAttempts[0].promptTokens === 11 && textAttempts[0].completionTokens === 7 && textAttempts[0].totalTokens === 18 && textAttempts[0].requestId === "req_schema_test");

  const parsedAttempts = [];
  const parsedResult = await extractor(() => responseJson({
    id: "resp_schema_test",
    status: "completed",
    output: [{ content: [{ type: "output_text", parsed: extraction }] }],
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
  }), parsedAttempts)({ prompt: "prompt", schemaVersion: schemaRuntime.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION, modelConfigurationId: "test" });
  assert("adapter parses structured parsed output when available", parsedResult.ok && parsedResult.parsed.version === schemaRuntime.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION);

  const multiText = JSON.stringify(extraction);
  const multiResult = await extractor(() => responseJson({
    id: "resp_schema_test",
    status: "completed",
    output: [
      { content: [{ type: "output_text", text: multiText.slice(0, Math.ceil(multiText.length / 2)) }] },
      { content: [{ type: "output_text", text: multiText.slice(Math.ceil(multiText.length / 2)) }] },
    ],
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
  }))({ prompt: "prompt", schemaVersion: schemaRuntime.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION, modelConfigurationId: "test" });
  assert("adapter handles multiple output text items", multiResult.ok && multiResult.parsed.taskId === extraction.taskId);

  const emptyAttempts = [];
  const empty = await extractor(() => responseJson({ id: "resp_empty", status: "completed", output_text: "", usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } }), emptyAttempts)({ prompt: "prompt", schemaVersion: schemaRuntime.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION, modelConfigurationId: "test" });
  assert("adapter classifies empty response", !empty.ok && emptyAttempts[0].safeFailureCategory === "empty_response");

  const refusalAttempts = [];
  const refusal = await extractor(() => responseJson({ id: "resp_refusal", status: "completed", output: [{ content: [{ type: "refusal", refusal: "no" }] }], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } }), refusalAttempts)({ prompt: "prompt", schemaVersion: schemaRuntime.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION, modelConfigurationId: "test" });
  assert("adapter treats refusal without text as empty extraction", !refusal.ok && refusalAttempts[0].safeFailureCategory === "empty_response");

  const incompleteAttempts = [];
  const incomplete = await extractor(() => responseJson({ id: "resp_incomplete", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "", usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } }), incompleteAttempts)({ prompt: "prompt", schemaVersion: schemaRuntime.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION, modelConfigurationId: "test" });
  assert("adapter reports incomplete/truncated empty output safely", !incomplete.ok && incompleteAttempts[0].safeFailureCategory === "empty_response");

  const invalidAttempts = [];
  const invalid = await extractor(() => responseJson({ id: "resp_invalid", status: "completed", output_text: "{not-json", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), invalidAttempts)({ prompt: "prompt", schemaVersion: schemaRuntime.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION, modelConfigurationId: "test" });
  assert("adapter classifies invalid JSON response schema", !invalid.ok && invalidAttempts[0].safeFailureCategory === "response_schema_invalid");

  const semantic = apiExtraction(schemaRuntime, { version: "wrong-version" });
  const semanticResult = schemaRuntime.validateLinuxAssessmentExtraction(semantic);
  assert("schema-valid but semantically invalid extraction is rejected by runtime parser", !semanticResult.ok && semanticResult.diagnostics.some((issue) => issue.code === "LINUX_GRADING_SCHEMA_INVALID"));
}

async function main() {
  const build = compile();
  installResolver(build);
  const adapter = require(path.join(build, "lib", "lab-assets", "linux", "openAIExtractionAdapter.js"));
  const schemaRuntime = require(path.join(build, "lib", "lab-assets", "linux", "assessmentExtractionSchema.js"));
  const apiSchema = adapter.linuxAssessmentExtractionJsonSchema();

  const issues = validateOpenAISchemaNode(apiSchema);
  assert("production OpenAI schema follows supported structural subset", issues.length === 0, issues.join("\n"));

  const negative = {
    type: "object",
    additionalProperties: false,
    properties: { kind: { const: "identity" } },
    required: ["kind"],
  };
  assert("negative const-without-type fixture is rejected", validateOpenAISchemaNode(negative).some((issue) => issue.includes("const requires explicit type")));

  assert("production OpenAI schema exposes candidate selections", apiSchema.properties.candidateSelections.items.properties.clauseId.type === "string");
  const enumApiSchema = adapter.linuxAssessmentExtractionJsonSchema(["clause_0", "clause_2"]);
  assert("production OpenAI schema can constrain request-local candidate IDs", enumApiSchema.properties.candidateSelections.items.properties.clauseId.enum.join(",") === "clause_0,clause_2");
  assert("production OpenAI schema does not expose span-copy atomic claims", apiSchema.properties.atomicClaims.type === "null");

  const roleEnum = apiSchema.properties.candidateSelections.items.properties.role.enum;
  assert("candidate role vocabulary is present", roleEnum.includes("finding") && roleEnum.includes("uncertainty") && roleEnum.includes("non_assessment"));
  const predicates = apiSchema.properties.candidateSelections.items.properties.predicateLabel.anyOf.find((item) => item.enum)?.enum;
  assert("nullable candidate predicate vocabulary is present", predicates.includes("authenticated") && predicates.includes("executed") && predicates.includes("contradicts"));
  assert("OpenAI schema keeps canonical claims null", apiSchema.properties.claims.type === "null");
  assert("OpenAI schema requires candidate registry hash", apiSchema.required.includes("candidateRegistryHash"));

  const apiResult = {
    version: schemaRuntime.LINUX_ASSESSMENT_EXTRACTION_SCHEMA_VERSION,
    taskId: "task:1:scope_timeline",
    candidateRegistryHash: "registry-hash",
    candidateSelections: [{
      clauseId: "clause_0",
      role: "finding",
      primaryEntityCandidateId: "identity_0",
      secondaryEntityCandidateId: null,
      subjectCandidateId: "identity_0",
      predicateLabel: "authenticated",
      objectCandidateId: null,
      valueCandidateId: "identity_0",
      timestampCandidateId: null,
      stateCandidateId: null,
      evidenceReferenceIds: ["evidence_reference_0"],
      reasoningClauseIds: ["clause_0"],
      uncertaintyCandidateIds: [],
      remediationCandidateIds: [],
      conclusionCandidateIds: [],
      confidence: "supported",
      extractionConfidence: "high",
    }],
    atomicClaims: null,
    claims: null,
    uncertaintyAssertions: null,
    remediationActions: null,
    unparsedStatements: null,
  };
  const parsed = schemaRuntime.validateLinuxAssessmentExtraction(apiResult);
  assert("schema-valid nullable API result passes runtime parser", parsed.ok, JSON.stringify(parsed));
  assert("nullable fields normalize out before runtime submission", parsed.ok && parsed.extraction.claims === undefined && parsed.extraction.atomicClaims === undefined && parsed.extraction.uncertaintyAssertions === undefined);

  const unknown = JSON.parse(JSON.stringify(apiResult));
  unknown.candidateSelections[0].extra = "nope";
  const unknownRejected = schemaRuntime.validateLinuxAssessmentExtraction(unknown);
  assert("unknown fields are rejected by runtime parser", !unknownRejected.ok && unknownRejected.diagnostics.some((issue) => issue.code === "LINUX_GRADING_UNKNOWN_FIELD"));

  const spanLeak = JSON.parse(JSON.stringify(apiResult));
  spanLeak.candidateSelections[0].claimSpan = "j.smith authenticated";
  const spanRejected = schemaRuntime.validateLinuxAssessmentExtraction(spanLeak);
  assert("candidate schema rejects copied span fields", !spanRejected.ok && spanRejected.diagnostics.some((issue) => issue.code === "LINUX_GRADING_UNKNOWN_FIELD"));

  const schemaText = JSON.stringify(apiSchema);
  const hash = crypto.createHash("sha256").update(schemaText).digest("hex");
  assert("canonical API schema hash is stable for this run", /^[a-f0-9]{64}$/.test(hash), hash);

  await runAdapterParsingAssertions(adapter, schemaRuntime);

  console.log(JSON.stringify({ passed: true, assertions, schemaHash: hash }, null, 2));
}

main();
