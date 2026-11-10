// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output directory.");

const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
const { checkLinuxFinalProductionQuality } = require(`${out}/linux/qualityChecker.js`);

function articleFor(value) {
  return /^[aeiou]/i.test(String(value || "").trim()) ? "an" : "a";
}
function evidence(assets, ...paths) {
  return paths.filter((path) => {
    const normalized = path.toLowerCase();
    return assets.some((asset) => {
      const assetPath = asset.file_path.toLowerCase();
      return assetPath === normalized || assetPath.endsWith(`/${normalized}`) || assetPath.endsWith(`/${normalized}.txt`);
    });
  }).slice(0, 3);
}

function validLab(context, assets, overrides = {}) {
  const tasks = overrides.tasks || [
    {
      phase: "Scope",
      title: "Reconstruct the investigation timeline",
      description: `Reconstruct the ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} timeline for ${context.hostname}.`,
      evidence: evidence(assets, "timeline.csv", "sudo.log", "syslog"),
      deliverable: "Prepare a timeline table with timestamp, evidence source, and confidence notes.",
    },
    {
      phase: "Attribution",
      title: "Correlate account and authentication evidence",
      description: `Correlate ${context.primaryUser} evidence with account records for ${context.hostname}.`,
      evidence: evidence(assets, "auth.log", "users.csv", "linux_config_pack.txt"),
      deliverable: "Document the account context and any evidence gaps for follow-up.",
    },
    {
      phase: "Policy",
      title: "Compare sudo policy and observed command evidence",
      description: "Compare observed command evidence with sudo policy and group inventory.",
      evidence: evidence(assets, "platform", "linux_config_pack.txt", "groups.csv"),
      deliverable: "Summarize whether available policy evidence explains the observed command path.",
    },
    {
      phase: "Change",
      title: "Map change documentation to service evidence",
      description: `Map ${context.changeId} and ${context.ticketId} to ${context.affectedService} evidence.`,
      evidence: evidence(assets, "change_request.md", "service_inventory.txt", "syslog"),
      deliverable: "Write a change-control note separating supported facts from assumptions.",
    },
    {
      phase: "Impact",
      title: "Evaluate file and permission evidence",
      description: `Evaluate ${context.modifiedFiles[0]} evidence for the scoped window.`,
      evidence: evidence(assets, "permissions_report.txt", "audit.log", "syslog"),
      deliverable: "Provide an evidence-backed risk note with exact files and sources reviewed.",
    },
  ];

  return {
    title: `Linux ${context.affectedService} evidence review for ${context.hostname}`,
    subtitle: "Linux investigation using timeline and service evidence",
    objective: `Reconstruct activity on ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} and compare account, service, file, and change evidence.`,
    scenario: `${context.company} SOC is reviewing case ${context.incidentId} for ${context.hostname}, ${articleFor(context.hostRole)} ${context.hostRole} in ${context.officeLocation}. The ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone} window includes ${context.primaryUser} activity, ${context.affectedService} context, ${context.modifiedFiles[0]} evidence, ${context.ticketId}, ${context.changeId}, and maintenance-window context.`,
    tasks,
    outcomes: [
      "Correlate Linux timeline, sudo, auth, and service evidence.",
      "Compare change-control records without overclaiming root cause.",
      "Document permission and account evidence for a scoped SOC escalation.",
    ],
    category: "Linux",
    difficulty: "Advanced",
    duration: "60 mins",
    ...overrides,
  };
}

function classify(result) {
  if (!result.coverage.finalNarrativeEvaluated) return "programming_error";
  if (result.issues.some((issue) => issue.category !== "generated_text" && issue.category !== "asset_consistency")) {
    return "asset_regeneration_required";
  }
  return "narrative_retryable";
}

function runNarrativeHarness(candidate, narratives, options = {}) {
  let narrativeCalls = 0;
  const assetId = candidate.investigation.incidentId;
  let lastResult = null;
  for (const lab of narratives) {
    narrativeCalls += 1;
    const result = checkLinuxFinalProductionQuality({
      context: candidate.investigation,
      assets: candidate.assets,
      lab,
    });
    lastResult = result;
    if (options.mappingMismatch && result.passed) {
      return { saved: false, programmingError: true, narrativeCalls, assetId };
    }
    if (result.passed) return { saved: true, result, narrativeCalls, assetId };
    const failureClass = classify(result);
    if (failureClass === "programming_error") return { saved: false, programmingError: true, result, narrativeCalls, assetId };
    if (failureClass === "asset_regeneration_required") return { saved: false, assetRegenerationRequired: true, result, narrativeCalls, assetId };
  }
  return { saved: false, result: lastResult, narrativeCalls, assetId };
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
  duration: "60 mins",
  title: "CyberLab Asset Pack",
});

const valid = validLab(candidate.investigation, candidate.assets);

const malformedSubtitle = validLab(candidate.investigation, candidate.assets, {
  subtitle: "Linux privilege boundary reconciliation on a SSH-",
});
const firstThenSecond = runNarrativeHarness(candidate, [malformedSubtitle, valid]);
assert(
  "01 malformed subtitle then valid narrative retries only narrative",
  firstThenSecond.saved && firstThenSecond.narrativeCalls === 2 && firstThenSecond.assetId === candidate.investigation.incidentId,
  `calls=${firstThenSecond.narrativeCalls}`
);

const aliasLab = validLab(candidate.investigation, candidate.assets, {
  tasks: valid.tasks.map((task, index) => index === 2 ? { ...task, evidence: ["platform", "auth.log"] } : task),
});
const aliasResult = runNarrativeHarness(candidate, [aliasLab]);
assert("02 resolvable evidence aliases pass locally", aliasResult.saved && aliasResult.narrativeCalls === 1);

const wrongHost = validLab(candidate.investigation, candidate.assets, {
  objective: `Reconstruct activity on wrong-host-01 during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone}.`,
});
const wrongHostResult = runNarrativeHarness(candidate, [wrongHost, valid]);
assert("03 wrong host triggers narrative retry", wrongHostResult.saved && wrongHostResult.narrativeCalls === 2);

const threeInvalid = runNarrativeHarness(candidate, [malformedSubtitle, wrongHost, malformedSubtitle]);
assert("04 three invalid narratives fail safely", !threeInvalid.saved && threeInvalid.narrativeCalls === 3);

let narrativeGeneratedForFailedAsset = false;
const failedAssetThenPass = (() => {
  const assetAttempts = [{ passed: false }, { passed: true, candidate }];
  let assetCalls = 0;
  for (const attempt of assetAttempts) {
    assetCalls += 1;
    if (!attempt.passed) continue;
    const result = runNarrativeHarness(attempt.candidate, [valid]);
    narrativeGeneratedForFailedAsset = narrativeGeneratedForFailedAsset || assetCalls === 1;
    return { assetCalls, result };
  }
})();
assert("05 asset semantic failure regenerates before narrative", failedAssetThenPass.assetCalls === 2 && !narrativeGeneratedForFailedAsset && failedAssetThenPass.result.saved);

let costSafetyNarrativeCallsBeforePass = 0;
const sevenFailuresThenPass = (() => {
  const assetAttempts = [
    { passed: false }, { passed: false }, { passed: false }, { passed: false },
    { passed: false }, { passed: false }, { passed: false }, { passed: true, candidate },
  ];
  let assetCalls = 0;
  for (const attempt of assetAttempts) {
    assetCalls += 1;
    if (!attempt.passed) continue;
    const result = runNarrativeHarness(attempt.candidate, [valid]);
    costSafetyNarrativeCallsBeforePass = result.narrativeCalls;
    return { assetCalls, result };
  }
})();
assert(
  "05b seven asset failures plus one pass cause one narrative generation",
  sevenFailuresThenPass.assetCalls === 8 &&
    sevenFailuresThenPass.result.saved &&
    costSafetyNarrativeCallsBeforePass === 1,
  `assetCalls=${sevenFailuresThenPass.assetCalls} narrativeCalls=${costSafetyNarrativeCallsBeforePass}`
);

const mappingMismatch = runNarrativeHarness(candidate, [valid], { mappingMismatch: true });
assert("06 save-object mapping mismatch fails fast", mappingMismatch.programmingError === true && !mappingMismatch.saved);

const highSeverity = runNarrativeHarness(candidate, [malformedSubtitle]);
assert(
  "07 high-severity narrative issue fails despite high score",
  !highSeverity.saved && highSeverity.result.issues.some((issue) => issue.severity === "high" && issue.category === "generated_text"),
  `score=${highSeverity.result.finalProductionScore}`
);

const finalCoverage = checkLinuxFinalProductionQuality({
  context: candidate.investigation,
  assets: candidate.assets,
  lab: valid,
});
assert("08 finalNarrativeEvaluated true only after final checks", finalCoverage.coverage.finalNarrativeEvaluated === true && finalCoverage.passed);

const rejectedPatternLab = validLab(candidate.investigation, candidate.assets, {
  scenario: `${candidate.investigation.company} SOC is reviewing case ${candidate.investigation.incidentId} for ${candidate.investigation.hostname}, ${articleFor(candidate.investigation.hostRole)} ${candidate.investigation.hostRole} in ${candidate.investigation.officeLocation}. SSH key activity was detected for ${candidate.investigation.primaryUser} during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone} with ${candidate.investigation.affectedService}, ${candidate.investigation.modifiedFiles[0]}, ${candidate.investigation.ticketId}, and ${candidate.investigation.changeId} evidence.`,
  tasks: [
    {
      phase: "Scope",
      title: "Align ssh.service state and process activity with the key-based session window.",
      description: "Align ssh.service state and process activity with the key-based session window.",
      evidence: ["service_inventory.txt", "syslog", "process_snapshot.txt"],
      deliverable: "Prepare a short correlation note with service, process, and timestamp evidence.",
    },
    {
      phase: "Change",
      title: `Reconcile ${candidate.investigation.changeId} and maintenance records against observed key trust and use.`,
      description: `Reconcile ${candidate.investigation.changeId} and maintenance records against observed key trust and use.`,
      evidence: ["change_request.md", "incident_brief.md"],
      deliverable: "Summarize what the change record does and does not explain.",
    },
    {
      phase: "Identity",
      title: `Cross-check the ${candidate.investigation.primaryUser} account and group membership against administrator-tier expectations.`,
      description: `Cross-check the ${candidate.investigation.primaryUser} account and group membership against administrator-tier expectations.`,
      evidence: ["users.csv", "groups.csv", "authorized_keys"],
      deliverable: "Document account status, group membership, and any identity gaps.",
    },
    {
      phase: "Configuration",
      title: "Compare sshd configuration and policy against observed access behavior.",
      description: "Compare sshd configuration and policy against observed access behavior.",
      evidence: ["sshd", "pam_sshd", "audit_notes.md"],
      deliverable: "Write a configuration and policy comparison without asserting intent.",
    },
    {
      phase: "Closure",
      title: "Document defensible containment and hardening steps.",
      description: "Document defensible containment and hardening steps consistent with policy and host role.",
      evidence: ["incident_brief.md", "service_inventory.txt"],
      deliverable: "Recommend containment and hardening steps tied to supplied evidence.",
    },
  ],
});
const rejectedPattern = runNarrativeHarness(candidate, [rejectedPatternLab]);
assert("09 rejected SSH-key wording pattern now passes", rejectedPattern.saved, rejectedPattern.result?.issues.map((issue) => issue.description).join(" | "));

const serviceAccountPatternLab = validLab(candidate.investigation, candidate.assets, {
  tasks: valid.tasks.map((task, index) => index === 4
    ? {
        ...task,
        title: "Prioritize defensible containment and hardening actions consistent with policy and host role.",
        description: "Prioritize defensible containment and hardening actions consistent with policy and host role.",
        evidence: ["incident_brief.md", "service_inventory.txt"],
      }
    : task),
});
const serviceAccountPattern = runNarrativeHarness(candidate, [serviceAccountPatternLab]);
assert("10 service-account-style containment wording does not require sudo evidence", serviceAccountPattern.saved, serviceAccountPattern.result?.issues.map((issue) => issue.description).join(" | "));

if (process.exitCode) process.exit(process.exitCode);
