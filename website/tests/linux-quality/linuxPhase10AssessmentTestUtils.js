// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const ALL_REASONING_ASSERTIONS = [
  "relationship_supported_by_evidence",
  "sources_corroborate_conclusion",
  "current_state_differs_from_historical",
  "attribution_limited",
  "intent_not_proven",
  "transfer_not_confirmed",
  "timestamp_order_supports_sequence",
  "configuration_state_supports_remediation",
];

const ALL_UNCERTAINTY_ASSERTIONS = [
  "limit_attribution",
  "intent_not_proven",
  "transfer_not_confirmed",
  "historical_not_current",
  "execution_not_confirmed",
  "scope_incomplete",
];

function reasoning() {
  return {
    assertions: ALL_REASONING_ASSERTIONS.map((kind) => ({ kind })),
  };
}

function uncertaintyAssertions(contract) {
  if (!contract.uncertaintyRequirements.length) return [];
  return ALL_UNCERTAINTY_ASSERTIONS.map((kind) => ({ kind, confidence: "candidate" }));
}

function claimFor(contract, finding, override = {}) {
  const requirement = contract.evidenceRequirements.find((item) => item.findingId === finding.id);
  return {
    value: finding.expectedValue,
    relationship: finding.expectedValue.kind === "relationship"
      ? { relation: finding.expectedValue.relation, sourceId: finding.expectedValue.sourceId, targetId: finding.expectedValue.targetId }
      : finding.relationship ? { relation: finding.relationship } : undefined,
    timeScope: finding.timeScope,
    evidence: (requirement?.evidencePaths || finding.evidencePaths).map((path) => ({
      path,
      anchors: requirement?.requiredAnchors || [],
    })),
    confidence: finding.allowedUncertainty ? "supported" : "observed",
    reasoning: reasoning(),
    ...override,
  };
}

function fullSubmission(contract) {
  return {
    taskId: contract.taskId,
    claims: contract.requiredFindings.map((finding) => claimFor(contract, finding)),
    uncertaintyAssertions: uncertaintyAssertions(contract),
    remediationActions: contract.remediationRequirements.map((item) => item.action),
  };
}

function prohibitedConclusionFor(id) {
  const map = {
    malicious_intent_without_support: "malicious_intent",
    exact_key_without_identifier: "exact_ssh_key",
    exfiltration_from_local_staging: "data_exfiltration",
    human_operator_from_account_use: "human_operator",
    historical_transition_from_current_state: "historical_transition_from_current",
    repository_compromise_from_package_install: "repository_compromise",
    full_host_compromise_from_container_mount: "full_host_compromise",
  };
  return map[id] || "malicious_intent";
}

module.exports = {
  ALL_REASONING_ASSERTIONS,
  ALL_UNCERTAINTY_ASSERTIONS,
  claimFor,
  fullSubmission,
  prohibitedConclusionFor,
  reasoning,
  uncertaintyAssertions,
};
