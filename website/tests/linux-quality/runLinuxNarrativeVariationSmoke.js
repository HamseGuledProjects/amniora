// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output directory.");

const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
const { checkLinuxFinalProductionQuality } = require(`${out}/linux/qualityChecker.js`);
const { linuxIndefiniteArticle } = require(`${out}/linux/grammar.js`);

const taskPhrases = [
  "Analyse the timeline evidence for the scoped review window.",
  "Assess account activity against the available identity inventory.",
  "Attribute observed access to the account evidence without assuming intent.",
  "Compare service state with the supplied log evidence.",
  "Confirm which files support the observed activity.",
  "Correlate SSH activity with account and configuration evidence.",
  "Cross-check group membership against administrative expectations.",
  "Determine which evidence sources agree on the investigation window.",
  "Document account context and evidence gaps.",
  "Enumerate relevant files referenced by the investigation notes.",
  "Evaluate permission evidence for the primary file.",
  "Examine SSH authorized_keys and related account context.",
  "Identify gaps between the change record and observed evidence.",
  "Inspect service inventory for relevant daemon context.",
  "Map evidence sources to each timeline entry.",
  "Reconcile maintenance records with observed activity.",
  "Reconstruct the sequence of relevant log entries.",
  "Review configuration evidence for access-control context.",
  "Trace the command path across available logs.",
  "Validate the incident window using primary evidence.",
  "Verify account status using inventory evidence.",
  "Align service state and process activity with the review window.",
  "Establish which evidence is observed rather than inferred.",
  "Distinguish policy context from observed host activity.",
  "Classify evidence gaps that need escalation.",
  "Summarise the key evidence supporting the escalation note.",
  "Explain how the supplied logs constrain the investigation.",
  "Prioritise containment actions based on supplied evidence.",
  "Recommend defensible follow-up actions for the host role.",
  "Propose evidence-preserving hardening steps.",
  "Justify the final analyst note with exact evidence references.",
  "Report unresolved assumptions separately from observed facts.",
  "Compare sshd configuration with policy expectations.",
  "Reconcile change-control records with the available host evidence.",
  "Cross-check the service account against group membership.",
  "Examine file ownership and permission metadata.",
  "Document defensible containment and hardening steps.",
  "Align process evidence with service inventory.",
  "Evaluate package-management evidence for unexpected utilities.",
  "Inspect scheduled activity for persistence indicators.",
  "Map source network context to authentication evidence.",
  "Analyse journal evidence for service lifecycle context.",
  "Assess whether documentation explains the observed activity.",
  "Validate sudo policy only where sudo evidence is referenced.",
  "Review key provenance using account and file evidence.",
  "Trace command activity using supplied log evidence.",
  "Summarise impact using service and file evidence.",
  "Determine whether evidence supports escalation.",
  "Compare maintenance context with observed timestamps.",
  "Explain evidence limitations for the final handoff.",
];

function pickEvidence(assets, index) {
  const groups = [
    ["assets/evidence/timeline.csv", "assets/logs/sudo.log", "assets/logs/syslog"],
    ["assets/logs/auth.log", "assets/csv/users.csv", "assets/configs/linux_config_pack.txt"],
    ["assets/docs/change_request.md", "assets/evidence/incident_brief.md", "assets/reports/service_inventory.txt"],
    ["assets/reports/permissions_report.txt", "assets/logs/audit.log", "assets/runtime/open_files.txt"],
    ["assets/reports/service_inventory.txt", "assets/journal/journal_systemd.txt", "assets/runtime/process_snapshot.txt"],
  ];
  const wanted = groups[index % groups.length];
  return wanted.filter((path) => assets.some((asset) => asset.file_path === path)).slice(0, 3);
}

function pickAvailable(assets, ...paths) {
  const selected = paths.filter((path) => assets.some((asset) => asset.file_path === path)).slice(0, 3);
  return selected.length > 0 ? selected : pickEvidence(assets, 0);
}

function evidenceForPhrase(assets, phrase, index) {
  const text = phrase.toLowerCase();
  if (/timeline|sequence|timestamp|window|logs|journal/.test(text)) {
    return pickAvailable(assets, "assets/evidence/timeline.csv", "assets/logs/sudo.log", "assets/logs/syslog", "assets/journal/journal_systemd.txt");
  }
  if (/account/.test(text) && /configuration|ssh activity/.test(text)) {
    return pickAvailable(assets, "assets/csv/users.csv", "assets/configs/linux_config_pack.txt", "assets/logs/auth.log");
  }
  if (/recommend|containment|hardening|follow-up|remediation/.test(text)) {
    return pickAvailable(assets, "assets/evidence/incident_brief.md", "assets/reports/service_inventory.txt", "assets/logs/syslog", "assets/configs/linux_config_pack.txt");
  }
  if (/account/.test(text) && /evidence gaps?|confidence|escalation/.test(text)) {
    return pickAvailable(assets, "assets/csv/users.csv", "assets/logs/auth.log", "assets/evidence/audit_notes.md", "assets/configs/linux_config_pack.txt");
  }
  if (/evidence gaps?|logging gaps?|ownership gaps?|confidence|escalation/.test(text)) {
    return pickAvailable(assets, "assets/evidence/audit_notes.md", "assets/evidence/incident_brief.md", "assets/reports/service_inventory.txt", "assets/configs/linux_config_pack.txt", "assets/evidence/timeline.csv");
  }
  if (/account|identity|group|membership|service account|administrator/.test(text)) {
    return pickAvailable(assets, "assets/csv/users.csv", "assets/csv/groups.csv", "assets/logs/auth.log", "assets/configs/linux_config_pack.txt");
  }
  if (/change|maintenance|record/.test(text)) {
    return pickAvailable(assets, "assets/docs/change_request.md", "assets/evidence/incident_brief.md", "assets/reports/service_inventory.txt", "assets/logs/syslog");
  }
  if (/configuration|sshd|policy|hardening|key provenance|authorized_keys|key/.test(text)) {
    return pickAvailable(assets, "assets/configs/linux_config_pack.txt", "assets/evidence/audit_notes.md", "assets/reports/permissions_report.txt", "assets/logs/auth.log");
  }
  if (/permission|ownership|file/.test(text)) {
    return pickAvailable(assets, "assets/reports/permissions_report.txt", "assets/logs/audit.log", "assets/logs/syslog");
  }
  if (/service|daemon|process|runtime|open-file/.test(text)) {
    return pickAvailable(assets, "assets/reports/service_inventory.txt", "assets/runtime/process_snapshot.txt", "assets/logs/syslog", "assets/journal/journal_systemd.txt");
  }
  if (/package|apt|dpkg|utilities/.test(text)) {
    return pickAvailable(assets, "assets/logs/apt_history.log", "assets/logs/syslog", "assets/logs/sudo.log", "assets/configs/linux_config_pack.txt");
  }
  if (/cron|scheduled/.test(text)) {
    return pickAvailable(assets, "assets/logs/cron.log", "assets/evidence/timeline.csv", "assets/reports/permissions_report.txt");
  }
  return pickEvidence(assets, index);
}

function scenarioVariants(context) {
  return [
    `${context.company} SOC is reviewing case ${context.incidentId} for ${context.hostname}, ${linuxIndefiniteArticle(context.hostRole)} ${context.hostRole} in ${context.officeLocation}. The ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} window includes ${context.primaryUser} activity, ${context.affectedService}, ${context.modifiedFiles[0]}, ${context.ticketId}, and ${context.changeId}.`,
    `${context.company}'s analysts are handling ${context.incidentId} on ${context.hostname}. The ${context.hostRole} evidence spans ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} and references ${context.changeId}, ${context.ticketId}, and ${context.affectedService}.`,
    `The ${context.company} environment has a scoped Linux review for ${context.hostname}. Evidence for ${context.incidentId} covers ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}, ${context.primaryUser}, ${context.modifiedFiles[0]}, and ${context.changeId}.`,
    `${context.company} Security is reviewing ${context.hostname} after evidence from ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}. The host role is ${context.hostRole}, with ${context.affectedService}, ${context.ticketId}, and ${context.changeId} in scope.`,
  ];
}

let failed = 0;
function buildCandidateWithRetries(difficulty) {
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({ category: "Linux", difficulty, duration: "30 mins", title: "CyberLab Asset Pack" });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

for (let caseIndex = 0; caseIndex < 10; caseIndex += 1) {
  const difficulty = caseIndex % 3 === 0 ? "Advanced" : caseIndex % 3 === 1 ? "Intermediate" : "Beginner";
  const candidate = buildCandidateWithRetries(difficulty);
  const context = candidate.investigation;
  for (let scenarioIndex = 0; scenarioIndex < 2; scenarioIndex += 1) {
    const offset = (caseIndex * 5 + scenarioIndex * 3) % taskPhrases.length;
    const tasks = Array.from({ length: 5 }, (_, taskIndex) => {
      const title = taskPhrases[(offset + taskIndex) % taskPhrases.length];
      const description = title;
      return {
        phase: ["Scope", "Identity", "Technical", "Change", "Closure"][taskIndex],
        title,
        description,
        evidence: evidenceForPhrase(candidate.assets, `${title} ${description}`, taskIndex),
        deliverable: "Provide a concise evidence-backed note with exact sources and unresolved assumptions.",
      };
    });
    const lab = {
      title: `Linux evidence review for ${context.hostname}`,
      subtitle: "Linux investigation using timeline and host evidence",
      objective: `Reconstruct activity on ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} for ${context.company}.`,
      scenario: scenarioVariants(context)[scenarioIndex % 4],
      tasks,
      outcomes: [
        "Correlate Linux evidence across logs, inventory, and documentation.",
        "Separate observed facts from assumptions in analyst handoff notes.",
        "Recommend defensible follow-up actions based on supplied evidence.",
      ],
      category: "Linux",
      difficulty,
      duration: "30 mins",
    };
    const result = checkLinuxFinalProductionQuality({ context, assets: candidate.assets, lab });
    console.log(`variation case=${caseIndex + 1}.${scenarioIndex + 1} family=${context.incidentFamily} difficulty=${difficulty} score=${result.finalProductionScore} passed=${result.passed} issues=${result.issues.length}`);
    if (result.issues.length > 0) {
      failed += 1;
      console.log(result.issues.map((issue) => `${issue.severity}/${issue.category}:${issue.description} ${issue.evidence || ""}`).join(" | "));
    }
  }
}

if (taskPhrases.length < 50) {
  console.error(`Expected at least 50 task phrasings, got ${taskPhrases.length}`);
  failed += 1;
}

if (failed > 0) process.exit(1);
