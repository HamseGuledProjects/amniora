// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output directory.");

const {
  cleanNarrativeField,
  narrativeCompletenessIssue,
  truncateAtSentenceBoundary,
} = require(`${out}/linux/narrativeResponse.js`);
const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
const { checkLinuxFinalProductionQuality } = require(`${out}/linux/qualityChecker.js`);

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
    scenario: `${context.company} SOC is reviewing case ${context.incidentId} for ${context.hostname}, a ${context.hostRole}. The review covers ${context.primaryUser}, ${context.affectedService}, ${context.ticketId}, and ${context.changeId} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}.`,
    tasks: [
      {
        phase: "Timeline",
        title: "Reconstruct the investigation timeline.",
        description: "Reconstruct the investigation timeline.",
        evidence: evidence(assets, "timeline.csv", "sudo.log", "syslog"),
        deliverable: "Prepare a concise timeline table with sources and confidence notes.",
      },
      {
        phase: "Identity",
        title: "Correlate account and authentication evidence.",
        description: "Correlate account and authentication evidence.",
        evidence: evidence(assets, "auth.log", "users.csv", "linux_config_pack.txt"),
        deliverable: "Document account context and any evidence gaps.",
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
        title: "Reconcile change records with the reviewed activity.",
        description: "Reconcile change records with the reviewed activity.",
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
    duration: "30 mins",
    category: "Linux",
    difficulty: "Advanced",
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

const candidate = buildLinuxAssetCandidate({
  category: "Linux",
  difficulty: "Advanced",
  duration: "30 mins",
  title: "CyberLab Asset Pack",
});
const baseLab = validLab(candidate.investigation, candidate.assets);

const completeHint =
  "APT provenance requires both apt_history.log timing and repository context from linux_config_pack.txt. Reconcile it with package_inventory.txt before drawing conclusions.";
const cleaned = cleanNarrativeField(completeHint);
assert("01 complete hint remains complete after cleanup", cleaned === completeHint && !narrativeCompletenessIssue(cleaned));

const longHint =
  "APT provenance requires both apt_history.log timing and repository context from linux_config_pack.txt. Reconcile it with package_inventory.txt before drawing conclusions. Keep the analyst note concise and avoid unsupported attribution.";
const shortened = truncateAtSentenceBoundary(longHint, 150);
assert(
  "02 long hint safely shortens at sentence boundary",
  shortened.ok && shortened.truncated && shortened.value.endsWith(".") && !narrativeCompletenessIssue(shortened.value),
  shortened.ok ? shortened.value : shortened.reason
);

const hintEndingTo = checkLinuxFinalProductionQuality({
  context: candidate.investigation,
  assets: candidate.assets,
  lab: validLab(candidate.investigation, candidate.assets, {
    hints: [completeHint.replace(/\.$/, " to"), baseLab.hints[1], baseLab.hints[2]],
  }),
});
assert("03 hint ending in to fails", !hintEndingTo.passed && hintEndingTo.issues.some((issue) => /hint 1/i.test(issue.description)));

const hintEndingWith = checkLinuxFinalProductionQuality({
  context: candidate.investigation,
  assets: candidate.assets,
  lab: validLab(candidate.investigation, candidate.assets, {
    hints: [baseLab.hints[0], `${completeHint} with`, baseLab.hints[2]],
  }),
});
assert("04 hint ending in with fails", !hintEndingWith.passed && hintEndingWith.issues.some((issue) => /hint 2/i.test(issue.description)));

const rawComplete = completeHint;
const mappedHint = cleanNarrativeField(rawComplete);
const identityLab = validLab(candidate.investigation, candidate.assets, {
  hints: [mappedHint, baseLab.hints[1], baseLab.hints[2]],
});
const identityResult = checkLinuxFinalProductionQuality({
  context: candidate.investigation,
  assets: candidate.assets,
  lab: identityLab,
});
assert(
  "05 raw complete hint stays identical through mapping",
  mappedHint === rawComplete && identityResult.passed,
  identityResult.issues.map((issue) => issue.description).join(" | ")
);

if (process.exitCode) process.exit(process.exitCode);
