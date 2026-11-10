// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled lib/lab-assets output directory.");

const {
  LINUX_INCIDENT_INVESTIGATION_CONTRACTS,
  validateLinuxIncidentCoverage,
} = require(`${out}/linux/incidentCoverage.js`);

function assert(name, condition, detail = "") {
  if (!condition) {
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${name}`);
}

const uncertaintyText = {
  account_use_not_human_operator: "Account use does not identify the human operator and requires owner validation.",
  excessive_sudo_not_malicious_intent: "Sudo authorization does not prove malicious intent or attacker identity.",
  exact_ssh_key_may_be_unavailable: "Key fingerprint evidence may be unavailable; document the key provenance gap.",
  local_staging_not_exfiltration: "Local staging does not prove exfiltration or that data left the host.",
  current_state_not_historical_transition: "Current state does not prove a historical transition or restart.",
  scheduled_execution_not_malicious_intent: "Cron scheduled execution does not prove malicious intent.",
  package_install_not_repository_compromise: "Package install does not prove repository compromise without provenance.",
  log_gap_limits_confidence: "Log gap limits confidence and requires secondary source validation.",
  outbound_session_not_attacker_identity: "Outbound connection does not identify an attacker or human operator.",
  container_mount_not_full_host_compromise: "Docker container mount does not prove full host compromise or scope.",
};

const remediationText = {
  narrow_sudo_rule: "Recommend least-privilege action to narrow the sudo rule after evidence review.",
  rotate_or_restrict_ssh_key: "Recommend rotate or restrict the SSH key and source restrictions.",
  validate_account_purpose: "Recommend validating account purpose, shell, credential owner, and access need.",
  disable_scheduled_task_after_capture: "Preserve evidence, then disable the scheduled cron task if unsupported.",
  preserve_and_disable_unit: "Preserve the systemd unit and disable the service after capture if unsupported.",
  verify_package_provenance_or_rollback: "Verify package provenance and prepare package rollback if not approved.",
  quarantine_staged_data_and_validate_transfer: "Quarantine staged archive data and validate transfer telemetry.",
  restore_logging_and_preserve_secondary_sources: "Restore logging and preserve journal or audit secondary sources.",
  contain_process_and_review_egress: "Contain the process and review egress network exposure.",
  harden_container_runtime_boundary: "Harden the Docker container runtime boundary, mounts, and group access.",
};

function difficultyKey(difficulty) {
  return difficulty.toLowerCase();
}

function coverageFor(contract, difficulty) {
  return contract.difficultyRequirements[difficultyKey(difficulty)];
}

function requirementIntents(contract, coverage) {
  const intents = new Set(coverage.mandatoryTaskIntents);
  for (const id of coverage.mandatoryQuestionIds) {
    for (const intent of contract.questionRequirements[id]?.taskIntents || []) intents.add(intent);
  }
  return Array.from(intents);
}

function makeFixture(family, difficulty, options = {}) {
  const contract = LINUX_INCIDENT_INVESTIGATION_CONTRACTS[family];
  const coverage = coverageFor(contract, difficulty);
  const capabilities = Array.from(new Set([
    ...coverage.mandatoryCapabilities,
    ...coverage.mandatoryQuestionIds.flatMap((id) => contract.questionRequirements[id]?.capabilities || []),
  ]));
  const registry = capabilities.map((capability) => ({
    id: `asset:${capability}`,
    path: `assets/phase4/${capability}.txt`,
    aliases: [],
    displayName: capability,
    assetType: "timestamped_log",
    capabilities: [capability],
    canonicalObjectIds: [],
    relations: [],
    support: "exact",
    stateType: "historical_reconstruction",
  }));
  const selectedEvidenceAssetIds = registry.map((asset) => asset.id);
  const intents = options.intents || requirementIntents(contract, coverage);
  const tasks = intents.map((intent, index) => ({
    id: `task:${index + 1}:${intent}`,
    intent,
    requiredCapabilities: capabilities,
    inquiryTypes: ["historical_reconstruction"],
    currentStateRequirements: [],
    selectedEvidenceAssetIds: options.emptyEvidence ? [] : selectedEvidenceAssetIds,
    canonicalObjectIds: [],
    primarySubjectIds: [],
    supportingSubjectIds: [],
    requirements: [],
    expectedDeliverableType: "evidence_notes",
    difficulty,
    order: index + 1,
  }));
  const text = [
    ...coverage.requiredUncertaintyBoundaries.map((item) => uncertaintyText[item]),
    ...coverage.requiredRemediationConcepts.map((item) => remediationText[item]),
  ].join(" ");
  const lab = {
    tasks: tasks.map((task) => ({
      phase: "Investigation",
      title: options.titleOverride || `${task.intent.replace(/_/g, " ")} coverage`,
      description: options.descriptionOverride || text,
      evidence: selectedEvidenceAssetIds.map((id) => registry.find((asset) => asset.id === id).path),
      deliverable: options.deliverableOverride || "Write an evidence-bounded note with uncertainty and next validation action.",
    })),
  };
  return {
    simulation: {
      investigation: {
        incidentFamily: family,
      },
      canonicalTasks: tasks,
      planningEvidenceRegistry: registry,
      evidenceRegistry: registry,
    },
    finalAssets: registry.map((asset) => ({
      file_name: asset.path.split("/").pop(),
      file_type: "text",
      file_path: asset.path,
      content: `${asset.capabilities.join(",")} evidence`,
    })),
    lab,
  };
}

for (const family of Object.keys(LINUX_INCIDENT_INVESTIGATION_CONTRACTS)) {
  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const fixture = makeFixture(family, difficulty);
    const report = validateLinuxIncidentCoverage(fixture);
    assert(`${family} ${difficulty} valid fixture is covered`, report.status === "covered", JSON.stringify(report.issues));
    assert(`${family} ${difficulty} maps requirements to task ids`, Object.values(report.coveredByTaskIds).some((ids) => ids.length > 0), JSON.stringify(report.coveredByTaskIds));
  }
}

const sudoGeneric = makeFixture("misconfigured_sudoers", "Beginner", {
  intents: ["ssh_authentication", "actor_attribution", "scope_timeline", "service_state", "file_permissions"],
});
const sudoGenericReport = validateLinuxIncidentCoverage(sudoGeneric);
assert("misconfigured sudoers generic task set fails without sudo policy", sudoGenericReport.status !== "covered", JSON.stringify(sudoGenericReport.issues));
assert("misconfigured sudoers generic failure uses stable coverage code", sudoGenericReport.issues.some((issue) => issue.code === "LINUX_INCIDENT_QUESTION_MISSING" || issue.code === "LINUX_INCIDENT_INTENT_MISSING"), JSON.stringify(sudoGenericReport.issues));

const sudoCovered = makeFixture("misconfigured_sudoers", "Beginner");
const sudoCoveredReport = validateLinuxIncidentCoverage(sudoCovered);
assert("misconfigured sudoers passes with sudo policy coverage", sudoCoveredReport.status === "covered", JSON.stringify(sudoCoveredReport.issues));

const sudoTitleBypass = makeFixture("misconfigured_sudoers", "Beginner", {
  intents: ["ssh_authentication", "actor_attribution", "scope_timeline", "service_state", "file_permissions"],
  titleOverride: "Compare sudo policy and privileged authorization",
});
const sudoTitleBypassReport = validateLinuxIncidentCoverage(sudoTitleBypass);
assert("sudo-looking title cannot bypass missing canonical intent", sudoTitleBypassReport.status !== "covered", JSON.stringify(sudoTitleBypassReport.issues));

const sudoNoEvidence = makeFixture("misconfigured_sudoers", "Beginner", { emptyEvidence: true });
const sudoNoEvidenceReport = validateLinuxIncidentCoverage(sudoNoEvidence);
assert("correct sudo intent with insufficient evidence fails", sudoNoEvidenceReport.status !== "covered", JSON.stringify(sudoNoEvidenceReport.issues));
assert("insufficient sudo evidence reports missing capability or role", sudoNoEvidenceReport.issues.some((issue) => issue.code === "LINUX_INCIDENT_CAPABILITY_MISSING" || issue.code === "LINUX_INCIDENT_EVIDENCE_ROLE_MISSING"), JSON.stringify(sudoNoEvidenceReport.issues));

const dataNoBoundary = makeFixture("data_staging", "Advanced", {
  descriptionOverride: remediationText.quarantine_staged_data_and_validate_transfer,
});
const dataNoBoundaryReport = validateLinuxIncidentCoverage(dataNoBoundary);
assert("data staging fails without staging-versus-transfer uncertainty", dataNoBoundaryReport.issues.some((issue) => issue.code === "LINUX_INCIDENT_UNCERTAINTY_BOUNDARY_MISSING"), JSON.stringify(dataNoBoundaryReport.issues));

const keyOverclaim = makeFixture("ssh_key_compromise", "Advanced", {
  descriptionOverride: `${uncertaintyText.exact_ssh_key_may_be_unavailable} ${remediationText.rotate_or_restrict_ssh_key}`,
  deliverableOverride: "Identify the exact SSH key fingerprint used for the login.",
});
const keyOverclaimReport = validateLinuxIncidentCoverage(keyOverclaim);
assert("SSH key exact attribution overclaim is blocked", keyOverclaimReport.issues.some((issue) => issue.code === "LINUX_INCIDENT_PROHIBITED_CONCLUSION"), JSON.stringify(keyOverclaimReport.issues));

const systemdGeneric = makeFixture("systemd_persistence", "Advanced", {
  intents: ["actor_attribution", "scope_timeline", "file_permissions", "risk_assessment", "change_control"],
});
const systemdGenericReport = validateLinuxIncidentCoverage(systemdGeneric);
assert("systemd persistence fails without service state or unit coverage", systemdGenericReport.status !== "covered", JSON.stringify(systemdGenericReport.issues));

if (process.exitCode) process.exit(process.exitCode);
