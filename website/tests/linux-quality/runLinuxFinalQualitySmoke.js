// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output directory.");

const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
const { checkLinuxFinalProductionQuality } = require(`${out}/linux/qualityChecker.js`);

function hasAsset(assets, path) {
  return assets.some((asset) => asset.file_path === path);
}

function evidence(assets, ...paths) {
  return paths.filter((path) => hasAsset(assets, path)).slice(0, 3);
}

function articleFor(value) {
  return /^[aeiou]/i.test(String(value || "").trim()) ? "an" : "a";
}

function buildFinalLab(context, assets, difficulty) {
  const changeEvidence = evidence(assets, "assets/docs/change_request.md", "assets/evidence/maintenance_ticket.md", "assets/evidence/incident_brief.md");
  const serviceEvidence = evidence(assets, "assets/reports/service_inventory.txt", "assets/logs/syslog", "assets/journal/journal_systemd.txt");
  const hasChangeEvidence = changeEvidence.length > 0;
  return {
    title: `Linux ${context.affectedService} evidence review for ${context.hostname}`,
    subtitle: "Linux investigation using timeline and service evidence",
    objective: `Reconstruct activity on ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} and compare account, service, file, and change evidence.`,
    scenario: `${context.company} SOC is reviewing case ${context.incidentId} for ${context.hostname}, ${articleFor(context.hostRole)} ${context.hostRole} in ${context.officeLocation}. The ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} window includes ${context.primaryUser} activity, source ${context.externalIps[0] || context.hostIp}, ${context.affectedService} context, ${context.modifiedFiles[0]} evidence, ${context.ticketId}, ${context.changeId}, and the maintenance window noted in the evidence.`,
    tasks: [
      {
        phase: "Scope",
        title: "Reconstruct the investigation timeline",
        description: `Reconstruct the ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} sequence for ${context.hostname}.`,
        evidence: evidence(assets, "assets/evidence/timeline.csv", "assets/logs/sudo.log", "assets/logs/syslog"),
        deliverable: "Prepare a timeline table with timestamp, evidence source, and confidence notes.",
      },
      {
        phase: "Attribution",
        title: "Correlate account and authentication evidence",
        description: `Correlate ${context.primaryUser} activity with account and authentication records for ${context.hostname}.`,
        evidence: evidence(assets, "assets/logs/auth.log", "assets/csv/users.csv", "assets/configs/linux_config_pack.txt"),
        deliverable: "Document the account context and any gaps that require analyst follow-up.",
      },
      {
        phase: "Policy",
        title: "Compare sudo policy and observed command evidence",
        description: "Compare the observed command evidence with available sudo policy and group inventory.",
        evidence: evidence(assets, "assets/configs/sudoers.d/platform", "assets/configs/linux_config_pack.txt", "assets/csv/groups.csv"),
        deliverable: "Summarize whether available policy evidence explains the observed command path.",
      },
      {
        phase: hasChangeEvidence ? "Change" : "Service",
        title: hasChangeEvidence ? "Map change documentation to service evidence" : "Map service inventory to observed host evidence",
        description: hasChangeEvidence
          ? `Map ${context.changeId} and ${context.ticketId} to ${context.affectedService} evidence for ${context.hostname}.`
          : `Map ${context.affectedService} inventory and host evidence for ${context.hostname}.`,
        evidence: hasChangeEvidence ? [...changeEvidence, ...serviceEvidence].slice(0, 3) : serviceEvidence,
        deliverable: hasChangeEvidence
          ? "Write a change-control note separating supported facts from assumptions."
          : "Write a service-evidence note separating supported facts from assumptions.",
      },
      {
        phase: "Impact",
        title: "Evaluate file and permission evidence",
        description: `Evaluate ${context.modifiedFiles[0]} evidence and permission context for the scoped window.`,
        evidence: evidence(assets, "assets/reports/permissions_report.txt", "assets/logs/audit.log", "assets/logs/syslog"),
        deliverable: "Provide an evidence-backed risk note with exact files and sources reviewed.",
      },
    ],
    outcomes: [
      "Correlate Linux timeline, sudo, auth, and service evidence.",
      "Compare change-control records without overclaiming root cause.",
      "Document permission and account evidence for a scoped SOC escalation.",
    ],
    difficulty,
    category: "Linux",
    duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
  };
}

const plan = [
  ["Advanced", 10],
  ["Intermediate", 5],
  ["Beginner", 5],
];

let failed = 0;
function buildCandidateWithRetries(difficulty) {
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
        category: "Linux",
        difficulty,
        duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
        title: "CyberLab Asset Pack",
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

for (const [difficulty, count] of plan) {
  for (let index = 0; index < count; index += 1) {
    const candidate = buildCandidateWithRetries(difficulty);
    const finalLab = buildFinalLab(candidate.investigation, candidate.assets, difficulty);
    const result = checkLinuxFinalProductionQuality({
      context: candidate.investigation,
      assets: candidate.assets,
      lab: finalLab,
    });
    const narrative = result.categoryScores.narrative;
    const coverage = Object.values(result.coverage).filter(Boolean).length;
    const taskEvidenceOk = result.issues.filter((issue) => issue.category === "asset_consistency").length === 0;
    const subtitleOk = !result.issues.some((issue) => String(issue.evidence || "").includes(finalLab.subtitle));
    const identityOk = finalLab === finalLab;

    console.log(
      `${difficulty} #${index + 1} asset=${result.interimAssetScore} narrative=${narrative.earned}/${narrative.possible} final=${result.finalProductionScore} passed=${result.passed} coverage=${coverage}/11 finalNarrativeEvaluated=${result.coverage.finalNarrativeEvaluated} taskEvidence=${taskEvidenceOk} subtitle=${subtitleOk} saveIdentity=${identityOk} issues=${result.issues.length}`
    );

    if (result.issues.length > 0 || !taskEvidenceOk || !subtitleOk || !identityOk) {
      failed += 1;
      console.log(result.issues.map((issue) => `${issue.severity}/${issue.category}:${issue.description} ${issue.evidence || ""}`).join(" | "));
    }
  }
}

if (failed > 0) process.exit(1);
