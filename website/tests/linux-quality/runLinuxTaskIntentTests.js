// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output directory.");

const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
const { checkLinuxFinalProductionQuality } = require(`${out}/linux/qualityChecker.js`);

function evidence(assets, ...patterns) {
  return patterns.filter((pattern) => assets.some((asset) => {
    const path = asset.file_path.toLowerCase();
    return path.endsWith(pattern.toLowerCase()) || path.includes(pattern.toLowerCase());
  })).slice(0, 3);
}

function baseLab(context, assets, taskOverride = null) {
  const tasks = [
    {
      phase: "Timeline",
      title: "Reconstruct the investigation timeline.",
      description: "Reconstruct the investigation timeline.",
      evidence: evidence(assets, "timeline.csv", "sudo.log", "syslog"),
      deliverable: "Prepare a concise timeline table with source confidence notes.",
    },
    {
      phase: "Identity",
      title: "Correlate account and authentication evidence.",
      description: "Correlate account and authentication evidence.",
      evidence: evidence(assets, "auth.log", "users.csv", "linux_config_pack.txt"),
      deliverable: "Document account context and evidence gaps.",
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
      title: "Evaluate evidence gaps and escalation needs.",
      description: "Evaluate evidence gaps and escalation needs.",
      evidence: evidence(assets, "audit_notes.md", "incident_brief.md", "service_inventory.txt"),
      deliverable: "Provide a short escalation note with open questions.",
    },
  ];
  if (taskOverride) tasks[4] = taskOverride;
  return {
    title: `Linux service evidence review for ${context.hostname}`,
    objective: `Reconstruct activity on ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}.`,
    scenario: `${context.company} SOC is reviewing case ${context.incidentId} for ${context.hostname}, a ${context.hostRole}. The review covers ${context.primaryUser}, ${context.affectedService}, ${context.ticketId}, and ${context.changeId} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}.`,
    tasks,
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
const context = candidate.investigation;
const assets = candidate.assets;

function resultFor(task) {
  return checkLinuxFinalProductionQuality({
    context,
    assets,
    lab: baseLab(context, assets, task),
  });
}

const packageCrossReference = resultFor({
  phase: "Exposure",
  title: "Cross-reference package installation with service state and potential exposure on a database host.",
  description: "Cross-reference package installation with service state and potential exposure on a database host.",
  evidence: evidence(assets, "apt_history.log", "package_inventory", "service_inventory.txt"),
  deliverable: "Document package timing, service state, and exposure assumptions with cited evidence.",
});
assert("01 cross-reference package installation passes", packageCrossReference.passed, packageCrossReference.issues.map((issue) => issue.description).join(" | "));

const sshCrossReference = resultFor({
  phase: "Access",
  title: "Cross-reference SSH key use with account and change records.",
  description: "Cross-reference SSH key use with account and change records.",
  evidence: evidence(assets, "authorized_keys", "users.csv", "change_request.md"),
  deliverable: "Summarize key, account, and change-record alignment without naming root cause.",
});
assert("02 cross-reference SSH key use passes", sshCrossReference.passed, sshCrossReference.issues.map((issue) => issue.description).join(" | "));

const auditCrossCorrelate = resultFor({
  phase: "Runtime",
  title: "Cross-correlate audit events with the process snapshot.",
  description: "Cross-correlate audit events with the process snapshot.",
  evidence: evidence(assets, "audit.log", "process_snapshot.txt", "open_files.txt"),
  deliverable: "Prepare a process correlation note with PID and timestamp evidence.",
});
assert("03 cross-correlate audit events passes", auditCrossCorrelate.passed, auditCrossCorrelate.issues.map((issue) => issue.description).join(" | "));

const ownershipGaps = resultFor({
  phase: "Confidence",
  title: "Identify logging or ownership gaps affecting confidence in conclusions.",
  description: "Identify logging or ownership gaps affecting confidence in conclusions.",
  evidence: evidence(assets, "audit_notes.md", "incident_brief.md", "service_inventory.txt"),
  deliverable: "List confidence limits, logging gaps, and responsible follow-up owners.",
});
assert("04 ownership gaps is not file permissions", ownershipGaps.passed, ownershipGaps.issues.map((issue) => issue.description).join(" | "));

const filePermissionsPass = resultFor({
  phase: "Metadata",
  title: "Validate owner, group and mode for /etc/sudoers.d/temp.",
  description: "Validate owner, group and mode for /etc/sudoers.d/temp.",
  evidence: evidence(assets, "permissions_report.txt", "audit.log"),
  deliverable: "Record owner, group, mode, and source evidence for the reviewed path.",
});
assert("05 explicit file permissions task passes with metadata", filePermissionsPass.passed, filePermissionsPass.issues.map((issue) => issue.description).join(" | "));

const controlOwnership = resultFor({
  phase: "Handoff",
  title: "Document control ownership and accountable follow-up for the reviewed service.",
  description: "Document control ownership and accountable follow-up for the reviewed service.",
  evidence: evidence(assets, "incident_brief.md", "audit_notes.md", "service_inventory.txt"),
  deliverable: "Identify the accountable team and evidence gaps for handoff.",
});
assert("06 control ownership task with docs passes", controlOwnership.passed, controlOwnership.issues.map((issue) => issue.description).join(" | "));

const filePermissionsFail = resultFor({
  phase: "Metadata",
  title: "Validate owner, group and mode for /etc/sudoers.d/temp.",
  description: "Validate owner, group and mode for /etc/sudoers.d/temp.",
  evidence: evidence(assets, "incident_brief.md", "service_inventory.txt"),
  deliverable: "Record owner, group, and mode evidence for the reviewed path.",
});
assert(
  "07 file permissions task without metadata fails",
  !filePermissionsFail.passed && filePermissionsFail.issues.some((issue) => /file permissions contract/i.test(issue.description)),
  filePermissionsFail.issues.map((issue) => issue.description).join(" | ")
);

const mediumWording = resultFor({
  phase: "Review",
  title: "Look at the files.",
  description: "Look at the files.",
  evidence: evidence(assets, "incident_brief.md", "service_inventory.txt"),
  deliverable: "Document the reviewed evidence sources and uncertainty.",
});
const narrativeScore = mediumWording.categoryScores.narrative;
const documentationScore = mediumWording.categoryScores.documentation;
assert(
  "08 one medium wording issue does not zero unrelated categories",
  mediumWording.issues.some((issue) => issue.severity === "medium") &&
    narrativeScore.earned > 0 &&
    documentationScore.earned > 0,
  `narrative=${narrativeScore.earned}/${narrativeScore.possible} documentation=${documentationScore.earned}/${documentationScore.possible}`
);

if (process.exitCode) process.exit(process.exitCode);
