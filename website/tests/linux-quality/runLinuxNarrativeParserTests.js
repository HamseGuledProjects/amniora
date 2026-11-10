// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output directory.");

const {
  getOpenAIResponseDiagnostics,
  parseGeneratedLabResponse,
} = require(`${out}/linux/narrativeResponse.js`);
const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);

function validLab() {
  return {
    title: "Linux service account evidence review",
    topic: "Linux",
    difficulty: "Advanced",
    estimated_time: "30 mins",
    objective: "Review Linux evidence for a scoped SOC investigation.",
    scenario: "The SOC is reviewing a Linux host during a defined incident window.",
    tasks: Array.from({ length: 5 }, (_, index) => ({
      phase: "Analysis",
      title: `Correlate evidence source ${index + 1}`,
      evidence: ["assets/logs/auth.log"],
      deliverable: "Document the evidence-backed finding and any uncertainty.",
    })),
    hints: ["Use timestamps.", "Compare independent sources.", "Avoid unsupported conclusions."],
    outcomes: ["Correlate Linux evidence.", "Document scoped findings.", "Explain evidence gaps."],
  };
}

function responseFromText(text, overrides = {}) {
  return {
    status: "completed",
    output_text: text,
    usage: { input_tokens: 1234, output_tokens: 567, total_tokens: 1801 },
    ...overrides,
  };
}

function assert(name, condition, details = "") {
  if (!condition) {
    console.error(`${name}: FAILED ${details}`);
    process.exitCode = 1;
  } else {
    console.log(`${name}: passed ${details}`);
  }
}

const complete = responseFromText(JSON.stringify(validLab()));
const completeResult = parseGeneratedLabResponse(complete);
assert("01 complete valid structured JSON parses", completeResult.ok === true);

const midString = responseFromText('{"title":"Data Staging via Service Account: SSH key/SS');
const midStringResult = parseGeneratedLabResponse(midString);
assert(
  "02 response truncated mid-string is classified",
  !midStringResult.ok && midStringResult.reason === "invalid_json" && midStringResult.rawLength > 0,
  midStringResult.ok ? "" : midStringResult.reason
);

const afterField = responseFromText(`{"title":"Linux case","topic":"Linux","difficulty":"Advanced"`);
const afterFieldResult = parseGeneratedLabResponse(afterField);
assert(
  "03 response truncated before closing braces is retryable",
  !afterFieldResult.ok && afterFieldResult.reason === "invalid_json",
  afterFieldResult.ok ? "" : afterFieldResult.reason
);

const fenced = responseFromText(`\`\`\`json\n${JSON.stringify(validLab())}\n\`\`\``);
const fencedResult = parseGeneratedLabResponse(fenced);
assert("04 Markdown fenced complete JSON safely unwraps", fencedResult.ok === true);

const empty = responseFromText("");
const emptyResult = parseGeneratedLabResponse(empty);
assert("05 empty output is classified", !emptyResult.ok && emptyResult.reason === "empty_response");

const refusal = {
  status: "completed",
  output: [{ content: [{ type: "refusal", refusal: "I cannot help with that." }] }],
};
const refusalResult = parseGeneratedLabResponse(refusal);
assert("06 refusal is classified", !refusalResult.ok && refusalResult.reason === "refusal");

const schemaMismatch = responseFromText(JSON.stringify({ ...validLab(), tasks: [] }));
const schemaMismatchResult = parseGeneratedLabResponse(schemaMismatch);
assert("07 schema mismatch is classified", !schemaMismatchResult.ok && schemaMismatchResult.reason === "schema_mismatch");

const retryCandidate = buildLinuxAssetCandidate({
  category: "Linux",
  difficulty: "Advanced",
  duration: "60 mins",
  title: "CyberLab Asset Pack",
});
const retryResponses = [midString, complete];
let narrativeCalls = 0;
let saved = false;
for (const response of retryResponses) {
  narrativeCalls += 1;
  const parsed = parseGeneratedLabResponse(response);
  if (parsed.ok) {
    saved = true;
    break;
  }
}
assert(
  "08 first malformed then valid retains asset candidate",
  saved && narrativeCalls === 2 && retryCandidate.investigation.incidentId === retryCandidate.investigation.incidentId,
  `calls=${narrativeCalls}`
);

const threeMalformed = [midString, afterField, empty].map(parseGeneratedLabResponse);
assert(
  "09 three malformed responses do not produce saved candidate",
  threeMalformed.every((result) => !result.ok),
  threeMalformed.map((result) => result.ok ? "ok" : result.reason).join(",")
);

const incomplete = responseFromText('{"title":"partial"', {
  status: "incomplete",
  incomplete_details: { reason: "max_output_tokens" },
  usage: { input_tokens: 3000, output_tokens: 5200, total_tokens: 8200 },
});
const incompleteDiagnostics = getOpenAIResponseDiagnostics(incomplete);
const incompleteResult = parseGeneratedLabResponse(incomplete);
assert(
  "10 output token incomplete status is logged/classified",
  !incompleteResult.ok &&
    incompleteResult.reason === "incomplete_output" &&
    incompleteDiagnostics.status === "incomplete" &&
    incompleteDiagnostics.incompleteReason === "max_output_tokens" &&
    incompleteDiagnostics.outputTokens === 5200,
  `${incompleteDiagnostics.status}/${incompleteDiagnostics.incompleteReason}`
);

if (process.exitCode) process.exit(process.exitCode);
