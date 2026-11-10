// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output directory.");

const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
const {
  checkLinuxFinalProductionQuality,
  linuxFinalNarrativeTextHygieneReason,
} = require(`${out}/linux/qualityChecker.js`);
const {
  cleanNarrativeField,
  narrativeFieldDiagnostics,
  narrativeCompletenessIssue,
} = require(`${out}/linux/narrativeResponse.js`);

function assert(name, condition, details = "") {
  if (!condition) {
    console.error(`${name}: FAILED ${details}`);
    process.exitCode = 1;
  } else {
    console.log(`${name}: passed ${details}`);
  }
}

function articleFor(value) {
  return /^[aeiou]/i.test(String(value || "").trim()) ? "an" : "a";
}
function evidence(assets, ...paths) {
  return paths.filter((path) => assets.some((asset) => {
    const normalized = asset.file_path.toLowerCase();
    return normalized.endsWith(path.toLowerCase()) || normalized.includes(path.toLowerCase());
  })).slice(0, 3);
}

function validLab(context, assets, overrides = {}) {
  return {
    title: `Linux service evidence review for ${context.hostname}`,
    objective: `Reconstruct activity on ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}.`,
    scenario: `${context.company} SOC is reviewing case ${context.incidentId} for ${context.hostname}, ${articleFor(context.hostRole)} ${context.hostRole}. The review covers ${context.primaryUser}, ${context.affectedService}, ${context.ticketId}, and ${context.changeId} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}.`,
    tasks: [
      {
        phase: "Authentication",
        title: "Review SSH sign-in records.",
        description: "Review SSH sign-in records.",
        evidence: evidence(assets, "journal_ssh.txt", "auth.log", "users.csv"),
        deliverable: "Create concise evidence notes confirming the sign-in entry point using only the supplied files. In assets/journal/journal_ssh.txt, locate entries relevant to SSH activity and identify the matching account evidence.",
      },
      {
        phase: "Identity",
        title: "Correlate account and authentication evidence.",
        description: "Correlate account and authentication evidence.",
        evidence: evidence(assets, "auth.log", "users.csv", "groups.csv"),
        deliverable: "Create a concise correlation table linking the SSH session and the relevant account using only the listed evidence paths. Include columns: Account, Evidence path, and Supported observation.",
      },
      {
        phase: "Service",
        title: "Compare service state with observed host activity.",
        description: "Compare service state with observed host activity.",
        evidence: evidence(assets, "service_inventory.txt", "syslog", "journal_systemd.txt"),
        deliverable: "Summarize service evidence without asserting root cause.",
      },
      {
        phase: "Change",
        title: "Reconcile change records with reviewed activity.",
        description: "Reconcile change records with reviewed activity.",
        evidence: evidence(assets, "change_request.md", "incident_brief.md"),
        deliverable: "Write a change-control note separating facts from assumptions.",
      },
      {
        phase: "Impact",
        title: "Summarize escalation context.",
        description: "Summarize escalation context from the supplied notes.",
        evidence: evidence(assets, "audit_notes.md", "incident_brief.md", "service_inventory.txt"),
        deliverable: "Provide a short escalation note with supported observations.",
      },
    ],
    hints: [
      "Start by aligning timestamps across independent sources.",
      "Compare service evidence with documented change records.",
      "Separate observed facts from candidate hypotheses.",
    ],
    outcomes: [
      "Correlate Linux evidence across logs and reports.",
      "Document uncertainty without overclaiming root cause.",
      "Prepare evidence-backed escalation notes.",
    ],
    duration: "60 mins",
    category: "Linux",
    difficulty: "Advanced",
    ...overrides,
  };
}

function malformedDeliverableIssues(result) {
  return result.issues.filter((issue) => /Final narrative task deliverable is malformed or truncated/i.test(issue.description));
}

const candidate = buildLinuxAssetCandidate({
  category: "Linux",
  difficulty: "Advanced",
  duration: "60 mins",
  title: "CyberLab Asset Pack",
  seed: "deliverable-diagnostics",
});
const baseLab = validLab(candidate.investigation, candidate.assets);

const completeNotes = baseLab.tasks[0].deliverable;
const completeTable = baseLab.tasks[1].deliverable;

assert("01 complete evidence-notes deliverable has no hygiene reason", !linuxFinalNarrativeTextHygieneReason(completeNotes));
assert("02 complete correlation-table deliverable has no hygiene reason", !linuxFinalNarrativeTextHygieneReason(completeTable));

const completeQuality = checkLinuxFinalProductionQuality({
  context: candidate.investigation,
  assets: candidate.assets,
  simulation: candidate.simulation,
  lab: baseLab,
});
assert("03 complete long deliverables are not flagged", malformedDeliverableIssues(completeQuality).length === 0);

const cutOffIdent =
  "Create concise evidence notes confirming the sign-in entry point using only the supplied files. In assets/journal/journal_ssh.txt, locate entries relevant to SSH activity and ident";
const cutOffEvidenceP =
  "Create a concise correlation table linking the SSH session and the relevant account using only the listed evidence paths. Include columns: Account, Evidence p";
assert("04 cut-off ident suffix has a hygiene reason", /incomplete generated word fragment/.test(linuxFinalNarrativeTextHygieneReason(cutOffIdent)));
assert("05 cut-off Evidence p suffix has a hygiene reason", /incomplete generated word fragment/.test(linuxFinalNarrativeTextHygieneReason(cutOffEvidenceP)));

const cutOffQuality = checkLinuxFinalProductionQuality({
  context: candidate.investigation,
  assets: candidate.assets,
  simulation: candidate.simulation,
  lab: validLab(candidate.investigation, candidate.assets, {
    tasks: baseLab.tasks.map((task, index) => index === 0 ? { ...task, deliverable: cutOffIdent } : task),
  }),
});
const cutOffIssue = malformedDeliverableIssues(cutOffQuality).find((issue) => issue.evidence === cutOffIdent);
assert("06 validator stores full cut-off field as issue evidence", Boolean(cutOffIssue), JSON.stringify(malformedDeliverableIssues(cutOffQuality)));

const nounPhrase = "Create a concise evidence index for selected SSH records";
assert("07 complete noun-phrase deliverable without final period passes rule", !linuxFinalNarrativeTextHygieneReason(nounPhrase));

const maxLengthValue = `${"A".repeat(270)} evidence review complete`;
const paddedMaxLengthValue = `${maxLengthValue}${"x".repeat(320 - maxLengthValue.length)}`;
const maxDiagnostics = narrativeFieldDiagnostics(paddedMaxLengthValue, 320);
assert("08 exactly max-length diagnostic records boundary", paddedMaxLengthValue.length === 320 && maxDiagnostics.reachesMaxLength);
assert("09 exactly max-length complete field is not silently classified as malformed", !linuxFinalNarrativeTextHygieneReason(paddedMaxLengthValue));

const clippedPreview = `${completeNotes.slice(0, 176)}...`;
assert("10 clipped diagnostic preview differs from full field", clippedPreview !== completeNotes && clippedPreview.length < completeNotes.length);
assert("11 full complete field remains validator input", !linuxFinalNarrativeTextHygieneReason(completeNotes));

const unicodeDamaged = "Document the observed evidence gap and propose the next validation,é™å®š";
const unicodeCleaned = cleanNarrativeField(unicodeDamaged);
assert("12 unicode cleanup removes damaged suffix deterministically", unicodeCleaned === "Document the observed evidence gap and propose the next validation");
assert("13 unicode cleanup does not damage prior valid text", unicodeCleaned.includes("observed evidence gap") && !narrativeCompletenessIssue(unicodeCleaned));

const orphanQuote = "Record a concise evidence-backed finding. \"";
const orphanCleaned = cleanNarrativeField(orphanQuote);
assert("14 orphan trailing quote is removed", orphanCleaned === "Record a concise evidence-backed finding.");
