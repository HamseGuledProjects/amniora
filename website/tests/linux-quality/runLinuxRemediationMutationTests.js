#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { removeSemanticRemediation } = require("./linuxRemediationMutationUtils.js");

const ROOT = path.resolve(__dirname, "../..");
const BUILD = path.join(os.tmpdir(), `amniora-linux-remediation-mutation-${process.pid}`);
if (!process.env.OUT) {
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--outDir", BUILD,
    "--noEmit", "false", "--incremental", "false", "--module", "commonjs",
    "--moduleResolution", "node", "--target", "es2020", "--jsx", "react-jsx"],
  { cwd: ROOT, stdio: "inherit" });
}
const OUT = process.env.OUT || path.join(BUILD, "lib", "lab-assets");
const { buildLinuxAssetCandidate } = require(path.join(OUT, "linux", "index.js"));
const { buildLinuxNarrativeContract } = require(path.join(OUT, "linux", "simulation.js"));
const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(OUT, "linux", "narrativeAssembly.js"));
const { linuxTaskTextHasRemediationConcept, validateLinuxIncidentCoverage } = require(path.join(OUT, "linux", "incidentCoverage.js"));

const concept = "verify_package_provenance_or_rollback";
const has = (text) => linuxTaskTextHasRemediationConcept(concept, text);
assert.equal(has("Propose evidence-supported steps to verify package provenance and approve rollback."), true);
assert.equal(has("If provenance validation fails, plan rollback of the package after preserving evidence."), true);
assert.equal(has("Review package provenance and validate the evidence."), false);
assert.equal(has("Review package authority and provenance. Review package authority and provenance."), false);
assert.equal(has("Review package authority and provenance\nReview package authority and provenance"), false);

let candidate;
let lastError;
for (let attempt = 0; attempt < 80; attempt += 1) {
  try {
    candidate = buildLinuxAssetCandidate({
      seed: `phase13a-coverage-rendering:unauthorized_package_install:Advanced:stable:${attempt}`,
      generationTime: "2026-08-09T21:30:00.000Z", category: "Linux",
      difficulty: "Advanced", duration: "60 mins", title: "Amniora Linux Asset Pack",
    }, { incidentFamily: "unauthorized_package_install" });
    break;
  } catch (error) { lastError = error; }
}
if (!candidate) throw lastError || new Error("No bounded Advanced package fixture accepted");
const contract = buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
const assembled = buildLinuxAssembledNarrative({
  contract, context: candidate.investigation, difficulty: "Advanced", duration: "60 mins",
  tasks: contract.taskContracts.map((task, index) => ({
    task_id: task.taskId, task_intent: task.intent, phase: `Task ${index + 1}`,
    title: "Review the task-local evidence", evidence: task.selectedEvidence.map((asset) => asset.path),
    deliverable: "Record an evidence-backed finding.",
  })),
});
const baseline = finalLinuxNarrativeFromAssembled({ lab: assembled });
const report = (lab) => validateLinuxIncidentCoverage({ simulation: candidate.simulation,
  finalAssets: candidate.assets, lab });
const remediationMissing = (lab) => report(lab).issues.some((issue) => issue.code === "LINUX_INCIDENT_REMEDIATION_MISSING");
assert.equal(remediationMissing(baseline), false);
const carriers = baseline.tasks.map((task, index) => ({ index,
  text: `${task.title || ""}\n${task.description || ""}\n${task.deliverable || ""}` }))
  .filter((task) => has(task.text));
assert.ok(carriers.length >= 2, "Fixture must exercise duplicate genuine remediation carriers");

const oneRemoved = structuredClone(baseline);
const first = carriers[0].index;
oneRemoved.tasks[first] = removeSemanticRemediation({ tasks: [oneRemoved.tasks[first]] }, concept,
  linuxTaskTextHasRemediationConcept).tasks[0];
assert.equal(remediationMissing(oneRemoved), false, "Another genuine response clause still satisfies the contract");

const allRemoved = removeSemanticRemediation(baseline, concept, linuxTaskTextHasRemediationConcept);
assert.ok(allRemoved.tasks.every((task) => !has(`${task.title || ""}\n${task.description || ""}\n${task.deliverable || ""}`)));
assert.equal(remediationMissing(allRemoved), true);
for (const field of ["title", "description", "deliverable"]) {
  const reintroduced = structuredClone(allRemoved);
  reintroduced.tasks[first][field] += " Recommend steps to verify package provenance before rollback.";
  assert.equal(remediationMissing(reintroduced), false, `Late ${field} response clause must be detected`);
}
console.log(`PASS semantic remediation mutation: ${candidate.investigation.incidentId}; ${carriers.length} baseline task carriers; generic wording rejected; all-field deletion detected; late response detected`);
