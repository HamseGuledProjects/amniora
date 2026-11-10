#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const compileRoot = path.join(os.tmpdir(), `amniora-linux-new-qa-patch-c-${process.pid}`);
execFileSync(process.execPath, [
  "node_modules/typescript/bin/tsc", "--outDir", compileRoot, "--noEmit", "false",
  "--incremental", "false", "--module", "commonjs", "--moduleResolution", "node",
  "--target", "es2020", "--jsx", "react-jsx",
], { cwd: ROOT, stdio: "inherit" });
const OUT = path.join(compileRoot, "lib", "lab-assets");
const { buildLinuxAssetCandidate } = require(path.join(OUT, "linux", "index.js"));
const { buildLinuxCanonicalNarrativeBrief } = require(path.join(OUT, "linux", "simulation.js"));
const { buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled } = require(path.join(OUT, "linux", "narrativeAssembly.js"));
const { validateLinuxFinalLearnerPackage, linuxApprovalStatusSentence } = require(path.join(OUT, "linux", "claimAuthority.js"));
const { checkLinuxFinalProductionQuality } = require(path.join(OUT, "linux", "qualityChecker.js"));
const { proveLinuxStudentTaskSolvability } = require(path.join(OUT, "linux", "taskSolvability.js"));
const { linuxLoggingQualityClaim } = require(path.join(OUT, "linux", "evidenceAuthority.js"));

const quiet = (run) => {
  const info = console.info;
  console.info = () => {};
  try { return run(); } finally { console.info = info; }
};
const clone = (value) => JSON.parse(JSON.stringify(value));
let assertions = 0;
function pass(name, condition, details = "") {
  assertions += 1;
  assert.ok(condition, `${name}${details ? `: ${details}` : ""}`);
  console.log(`PASS ${name}`);
}
function expectThrow(name, run, pattern) {
  let caught;
  try { run(); } catch (error) { caught = error; }
  pass(name, Boolean(caught) && pattern.test(String(caught?.message || caught)), String(caught?.message || "did not throw"));
}
function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  assert.ok(found, `missing ${filePath}`);
  return found;
}
function build(family, difficulty, duration, seed) {
  let lastError;
  const reasons = [];
  for (let draw = 0; draw < 100; draw += 1) {
    try {
      return quiet(() => buildLinuxAssetCandidate({
        category: "Linux", difficulty, duration: `${duration} mins`,
        title: `Patch C ${difficulty} ${family}`, generationTime: "2026-09-21T09:00:00.000Z",
        seed: draw === 0 ? seed : `${seed}:retry:${draw}`,
      }, { incidentFamily: family, onAttempt: (event) => { if (!event.accepted && event.reason) reasons.push(event.reason); } }));
    } catch (error) { lastError = error; }
  }
  throw new Error(`Patch C fixture exhausted ${family}/${difficulty}/${duration}: ${lastError?.message || lastError}; ${reasons.slice(-5).join(" | ")}`);
}
function finalLab(candidate, difficulty, duration) {
  const contract = JSON.parse(buildLinuxCanonicalNarrativeBrief(candidate.simulation));
  return finalLinuxNarrativeFromAssembled({
    lab: buildLinuxAssembledNarrative({
      contract, context: candidate.investigation, difficulty, duration: `${duration} mins`,
      tasks: contract.taskContracts.map((task) => ({
        task_id: task.taskId, task_intent: task.intent,
        evidence: task.selectedEvidence.map((evidence) => evidence.path),
      })),
    }),
  });
}
function validate(candidate, lab) {
  return validateLinuxFinalLearnerPackage({ simulation: candidate.simulation, assets: candidate.assets, lab });
}

const beginner = build("misconfigured_sudoers", "Beginner", 15, "patch-c:beginner:0");
const intermediate = build("systemd_persistence", "Intermediate", 30, "patch-c:intermediate:0");
const advanced = build("ssh_key_compromise", "Advanced", 60, "patch-c:advanced:0");
const baselineCases = [
  [beginner, finalLab(beginner, "Beginner", 15)],
  [intermediate, finalLab(intermediate, "Intermediate", 30)],
  [advanced, finalLab(advanced, "Advanced", 60)],
];
for (const [candidate, lab] of baselineCases) {
  assert.doesNotThrow(() => validate(candidate, lab));
  const final = checkLinuxFinalProductionQuality({
    context: candidate.investigation, simulation: candidate.simulation, assets: candidate.assets, lab,
  });
  pass(`${lab.difficulty} final production gate accepts bounded package`, final.passed, JSON.stringify(final.issues));
}

const unknownNegative = clone(advanced);
asset(unknownNegative, "assets/evidence/incident_brief.md").content += "\nApproval status: not approved for the observed activity.\n";
expectThrow("004 unknown approval promoted to not approved is rejected", () => validate(unknownNegative, baselineCases[2][1]), /unknown approval was escalated/i);
const boundedAlternative = clone(advanced);
asset(boundedAlternative, "assets/evidence/incident_brief.md").content += "\nDistinguish routine maintenance from unapproved tooling as a possibility, not an established decision.\n";
validate(boundedAlternative, baselineCases[2][1]);
pass("004 unapproved tooling remains a qualified alternative", true);

const finalNarrativeEscalation = clone(baselineCases[2][1]);
finalNarrativeEscalation.scenario += " The observed activity was not approved.";
expectThrow("004 late narrative escalation is rejected", () => validate(advanced, finalNarrativeEscalation), /unknown approval was escalated/i);

const rejected = clone(advanced);
const rejectedActivity = rejected.simulation.maintenanceActivities[0];
rejectedActivity.approvalDecision = "rejected";
rejectedActivity.approvalEvidenceAvailability = "available";
rejectedActivity.approvalSourceCompleteness = "complete";
rejectedActivity.approvalSourcePaths = ["assets/docs/change_request.md"];
asset(rejected, "assets/docs/change_request.md").content += "\nApproval decision: explicitly rejected by the supplied approval record.\n";
assert.doesNotThrow(() => validate(rejected, baselineCases[2][1]));
pass("004 explicit rejection in complete authoritative record is accepted", true);
pass("004 shared model keeps explicit rejection distinct", /explicitly rejected/.test(linuxApprovalStatusSentence(rejected.simulation)));

const capabilityPromotion = clone(advanced);
asset(capabilityPromotion, "assets/evidence/incident_brief.md").content += "\nTechnical sudo permission therefore proves business approval.\n";
expectThrow("technical permission promoted to business approval is rejected", () => validate(capabilityPromotion, baselineCases[2][1]), /technical capability was promoted/i);

const readPromotion = clone(advanced);
readPromotion.simulation.openFileDescriptors.forEach((record) => { record.accessMode = "r"; });
asset(readPromotion, "assets/evidence/incident_brief.md").content += "\nObserved file evidence confirms the target was modified and compromised.\n";
expectThrow("observed read promoted to modification is rejected", () => validate(readPromotion, baselineCases[2][1]), /promoted to modification/i);

const lateCsv = clone(advanced);
asset(lateCsv, "assets/evidence/risk_register.csv").content += "\nR-099,Approval status: not approved for the observed activity,unassessed,change_request.md,unverified,maintenance:unknown\n";
expectThrow("late CSV certainty contradiction is rejected", () => validate(lateCsv, baselineCases[2][1]), /unknown approval was escalated/i);

const partial = clone(advanced);
asset(partial, "assets/logs/auth.log").content += "\n# telemetry_completeness=partial source=assets/logs/auth.log reason=observed_log_loss\n";
asset(partial, "assets/evidence/incident_brief.md").content = asset(partial, "assets/evidence/incident_brief.md").content
  .replace(/^- Logging quality: .*$/m, `- Logging quality: ${linuxLoggingQualityClaim(partial.assets, false)}`);
asset(partial, "assets/evidence/incident_brief.md").content += "\nThe complete sequence of authentication events is established.\n";
expectThrow("partial telemetry cannot support exhaustive certainty", () => validate(partial, baselineCases[2][1]), /partial telemetry was used for an exhaustive claim/i);

const corroborated = clone(partial);
asset(corroborated, "assets/evidence/incident_brief.md").content = asset(corroborated, "assets/evidence/incident_brief.md").content.replace("The complete sequence of authentication events is established.", "The complete sequence of authentication events is established by the independent journal source.");
asset(corroborated, "assets/journal/journal_ssh.txt").content += "\n# telemetry_completeness=complete covers_source=assets/logs/auth.log\n";
asset(corroborated, "assets/evidence/incident_brief.md").content = asset(corroborated, "assets/evidence/incident_brief.md").content
  .replace(/^- Logging quality: .*$/m, `- Logging quality: ${linuxLoggingQualityClaim(corroborated.assets, false)}`);
assert.doesNotThrow(() => validate(corroborated, baselineCases[2][1]));
pass("complete independent corroboration preserves a supported conclusion", true);

const caseAnswer = clone(advanced);
asset(caseAnswer, "assets/evidence/incident_brief.md").content += `\n${caseAnswer.simulation.investigation.plausibleHypotheses[0]}\n`;
expectThrow("005 case-specific answer inserted into brief is detected", () => validate(caseAnswer, baselineCases[2][1]), /preselects a case-specific hypothesis/i);

const repeatedAnswer = clone(advanced);
const repeatedLine = "Unverified hypothesis: final finding: rotate the affected SSH key and disable the account.";
asset(repeatedAnswer, "assets/evidence/incident_brief.md").content += `\n${repeatedLine}\n`;
asset(repeatedAnswer, "assets/docs/maintenance_ticket.md").content += `\n${repeatedLine}\n`;
expectThrow("005 repeated unverified answer chain is detected", () => validate(repeatedAnswer, baselineCases[2][1]), /unverified answer chain is repeated/i);

const methodOnly = clone(advanced);
asset(methodOnly, "assets/evidence/incident_brief.md").content += "\nMethod: compare task-local actor, action, time and source before assigning intent.\n";
assert.doesNotThrow(() => validate(methodOnly, baselineCases[2][1]));
pass("005 method-only guidance remains acceptable", true);
pass("authoritative primary evidence remains present", asset(advanced, "assets/docs/change_request.md").content.includes(advanced.investigation.changeId));

for (const [candidate, lab] of baselineCases) {
  for (const task of candidate.simulation.canonicalTasks) {
    const studentTask = lab.tasks[candidate.simulation.canonicalTasks.indexOf(task)];
    const proof = proveLinuxStudentTaskSolvability({
      simulation: candidate.simulation, task,
      taskIndex: candidate.simulation.canonicalTasks.indexOf(task),
      studentTask, finalAssets: candidate.assets,
    });
    pass(`${lab.difficulty} ${task.id} stays task-locally solvable`, ["solvable", "solvable_with_required_uncertainty"].includes(proof.status), JSON.stringify(proof.issues));
  }
}

const routeSource = fs.readFileSync(path.join(ROOT, "app", "api", "ai", "generate-lab", "route.ts"), "utf8");
const qualityIndex = routeSource.indexOf("const linuxFinalQuality = checkLinuxFinalProductionQuality");
const selectionIndex = routeSource.indexOf("selectedCandidate = candidate", qualityIndex);
const persistenceIndex = routeSource.indexOf('.from("labs")', selectionIndex);
pass("final learner-package validation runs before candidate selection and persistence", qualityIndex >= 0 && selectionIndex > qualityIndex && persistenceIndex > selectionIndex);
pass("failed final validation cannot select a persistable candidate", /if \(!linuxFinalQuality\.passed\)[\s\S]*continue;[\s\S]*selectedCandidate = candidate/.test(routeSource.slice(qualityIndex, persistenceIndex)));

const savedSource = fs.readFileSync(path.join(ROOT, "app", "dashboard", "saved", "[id]", "page.tsx"), "utf8");
const printStart = savedSource.indexOf("function SavedInvestigationPrintDocument");
const printEnd = savedSource.indexOf("function InvestigationOverview", printStart);
const printSource = savedSource.slice(printStart, printEnd);
pass("saved print uses persisted tasks and assets without grading mutation", /tasks\.map/.test(printSource) && /assets\.map/.test(printSource) && !/(fetch\(|submit|grade|generate)/i.test(printSource));
pass("saved print does not auto-reveal optional hints", !/lab\.hints\.map/.test(printSource));

console.log(JSON.stringify({
  passed: true, assertions,
  baselineCoverage: {
    families: ["misconfigured_sudoers", "systemd_persistence", "ssh_key_compromise"],
    difficulties: ["Beginner", "Intermediate", "Advanced"], durations: [15, 30, 60],
  },
  adversarialCoverage: ["unknown_to_negative", "explicit_rejection", "permission_to_business_approval", "read_to_modification", "late_csv_contradiction", "partial_telemetry", "complete_corroboration", "brief_answer", "repeated_unverified_answer", "method_only"],
}, null, 2));
