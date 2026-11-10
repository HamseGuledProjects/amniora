#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const nodeAssert = require("node:assert/strict");
const { removeSemanticRemediation } = require("./linuxRemediationMutationUtils.js");

const ROOT = path.resolve(__dirname, "..", "..");
const FAMILIES = [
  "misconfigured_sudoers",
  "ssh_bruteforce",
  "service_account_misuse",
  "ssh_key_compromise",
  "cron_persistence",
  "systemd_persistence",
  "unauthorized_package_install",
  "data_staging",
  "log_tampering",
  "reverse_shell",
  "docker_compromise",
];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-incident-coverage-rendering-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function assert(name, condition, detail = "") {
  if (!condition) throw new Error(`${name}: ${detail || "failed"}`);
  console.log(`PASS ${name}`);
}

function buildCandidate(buildLinuxAssetCandidate, family, difficulty) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
        seed: `phase13a-coverage-rendering:${family}:${difficulty}:stable:${attempt}`,
        generationTime: "2026-08-09T21:30:00.000Z",
        category: "Linux",
        difficulty,
        duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
        title: "Amniora Linux Asset Pack",
      }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to build candidate for ${family}/${difficulty}`);
}

function assembledLab(modules, candidate, difficulty) {
  const renderedPaths = candidate.assets.map((asset) => asset.file_path);
  const contract = modules.buildLinuxNarrativeContract(candidate.simulation, renderedPaths);
  const deliverableByIntent = {
    actor_attribution: "Summarize account activity using the supplied identity and log evidence.",
    ssh_authentication: "Review the authentication events and document the supported access pattern.",
    scope_timeline: "Reconstruct the relevant event sequence from the timestamped evidence.",
    sudo_policy: "Compare the privileged command activity with the supplied policy evidence.",
    configuration_review: "Document configuration observations that are supported by the provided files.",
    file_permissions: "Review ownership and mode details for the relevant filesystem evidence.",
    service_state: "Correlate service state observations with the supplied inventory evidence.",
    package_transaction: "Summarize package activity using the available package and timing evidence.",
    cron_analysis: "Correlate scheduled definition and execution evidence within the supplied records.",
    command_process: "Explain command or process observations that are directly supported by evidence.",
    network_source: "Summarize network exposure or source observations from the available records.",
    change_control: "Compare the observed activity with the supplied change-control context.",
    impact_assessment: "Describe evidence-supported operational impact without exceeding the records.",
    risk_assessment: "State evidence-supported risk considerations and relevant evidence gaps.",
    containment_recommendation: "List evidence-supported containment considerations for analyst review.",
    evidence_integrity: "Identify evidence gaps and confidence limits using the supplied artifacts.",
  };
  const modelTasks = contract.taskContracts.map((task, index) => ({
    task_id: task.taskId,
    task_intent: task.intent,
    phase: `Task ${index + 1}`,
    title: "AI readable task text that may omit mandatory coverage",
    evidence: task.selectedEvidence.map((asset) => asset.path).slice(0, 3),
    deliverable: deliverableByIntent[task.intent] || "Record a concise evidence-backed finding.",
  }));
  const assembled = modules.buildLinuxAssembledNarrative({
    contract,
    context: candidate.investigation,
    difficulty,
    duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
    tasks: modelTasks,
  });
  return {
    contract,
    lab: modules.finalLinuxNarrativeFromAssembled({ lab: assembled }),
  };
}

function qualityFor(modules, candidate, lab, difficulty) {
  return modules.checkLinuxInvestigationQuality({
    assets: candidate.assets,
    context: candidate.investigation,
    simulation: candidate.simulation,
    lab,
    workload: {
      requestedDifficulty: difficulty,
      requestedDurationMinutes: difficulty === "Advanced" ? 60 : 30,
      expectedWorkloadEstimateHash: candidate.deterministicHashes.workloadEstimateHash,
      expectedWorkloadReportHash: candidate.deterministicHashes.workloadReportHash,
      expectedAssessmentContractHash: candidate.deterministicHashes.assessmentContractHash,
      expectedAssessmentQualityHash: candidate.deterministicHashes.assessmentQualityHash,
    },
  });
}

function allTaskText(lab) {
  return (lab.tasks || []).map((task) => `${task.title || ""} ${task.description || ""} ${task.deliverable || ""}`).join("\n");
}

function requirementKey(requirement) {
  return `${requirement.kind}:${requirement.id}`;
}

const semanticRequirementKeys = {
  "incident_question:sudo_next_step": "remediation:narrow_sudo_rule",
  "remediation_concept:narrow_sudo_rule": "remediation:narrow_sudo_rule",
  "incident_question:ssh_next_step": "remediation:validate_account_purpose",
  "incident_question:service_account_next_step": "remediation:validate_account_purpose",
  "remediation_concept:validate_account_purpose": "remediation:validate_account_purpose",
  "incident_question:key_next_step": "remediation:rotate_or_restrict_ssh_key",
  "remediation_concept:rotate_or_restrict_ssh_key": "remediation:rotate_or_restrict_ssh_key",
  "incident_question:cron_next_step": "remediation:disable_scheduled_task_after_capture",
  "remediation_concept:disable_scheduled_task_after_capture": "remediation:disable_scheduled_task_after_capture",
  "incident_question:systemd_next_step": "remediation:preserve_and_disable_unit",
  "remediation_concept:preserve_and_disable_unit": "remediation:preserve_and_disable_unit",
  "incident_question:package_next_step": "remediation:verify_package_provenance_or_rollback",
  "remediation_concept:verify_package_provenance_or_rollback": "remediation:verify_package_provenance_or_rollback",
  "incident_question:staging_next_step": "remediation:quarantine_staged_data_and_validate_transfer",
  "remediation_concept:quarantine_staged_data_and_validate_transfer": "remediation:quarantine_staged_data_and_validate_transfer",
  "incident_question:log_next_step": "remediation:restore_logging_and_preserve_secondary_sources",
  "remediation_concept:restore_logging_and_preserve_secondary_sources": "remediation:restore_logging_and_preserve_secondary_sources",
  "incident_question:reverse_next_step": "remediation:contain_process_and_review_egress",
  "remediation_concept:contain_process_and_review_egress": "remediation:contain_process_and_review_egress",
  "incident_question:docker_next_step": "remediation:harden_container_runtime_boundary",
  "remediation_concept:harden_container_runtime_boundary": "remediation:harden_container_runtime_boundary",
};

function semanticRequirementKey(requirement) {
  return semanticRequirementKeys[requirementKey(requirement)] || requirementKey(requirement);
}

function visibleRequirementPhraseGroups(requirements, render, allowSystemdBaselineGap = false, allowAdvancedSshSequence = false) {
  const bySemanticKey = new Map();
  for (const requirement of Array.from(requirements.values()).flat()) {
    const semantic = semanticRequirementKey(requirement);
    if (!bySemanticKey.has(semantic)) bySemanticKey.set(semantic, []);
    bySemanticKey.get(semantic).push(render(requirement));
    if (allowSystemdBaselineGap && requirement.kind === "incident_question" && requirement.id === "systemd_baseline") {
      bySemanticKey.get(semantic).push("Document the expected baseline and what observed service state remains unverified.");
    }
    if (allowAdvancedSshSequence && requirement.kind === "incident_question" && requirement.id === "ssh_sequence") {
      bySemanticKey.get(semantic).push("Order the failed SSH attempts, accepted method, and session opening; relate later audit activity while distinguishing source/account from operator and chronology from proven session linkage or compromise.");
    }
  }
  return Array.from(bySemanticKey.values());
}

function removePhraseFromLab(lab, phrase) {
  const remove = (value) => String(value || "")
    .replaceAll(phrase, "")
    .replace(/\s+;\s+/g, "; ")
    .replace(/Include:\s*\./g, "Include evidence-supported notes.");
  return {
    ...lab,
    title: remove(lab.title),
    objective: remove(lab.objective),
    scenario: remove(lab.scenario),
    tasks: lab.tasks.map((task) => ({
      ...task,
      title: remove(task.title),
      description: remove(task.description),
      deliverable: remove(task.deliverable),
    })),
    hints: (lab.hints || []).map(remove),
    outcomes: (lab.outcomes || []).map(remove),
    learningOutcomes: (lab.learningOutcomes || []).map(remove),
  };
}

function removePhrasesFromLab(lab, phrases) {
  return phrases.reduce((current, phrase) => removePhraseFromLab(current, phrase), lab);
}

function replacePatternInLab(lab, pattern, replacement) {
  const replace = (value) => String(value || "").replace(pattern, replacement);
  return {
    ...lab,
    tasks: lab.tasks.map((task) => ({
      ...task,
      title: replace(task.title),
      description: replace(task.description),
      deliverable: replace(task.deliverable),
    })),
    hints: (lab.hints || []).map(replace),
    outcomes: (lab.outcomes || []).map(replace),
    learningOutcomes: (lab.learningOutcomes || []).map(replace),
  };
}

const uncertaintyPhraseMatchers = {
  account_use_not_human_operator: /\b(?:account use|account activity|human operator|owner gap|intent)\b/i,
  excessive_sudo_not_malicious_intent: /\b(?:sudo|malicious intent|validation gap)\b/i,
  exact_ssh_key_may_be_unavailable: /\b(?:key|fingerprint|authorized_keys)\b/i,
  local_staging_not_exfiltration: /\b(?:local staging|transfer|staging|staged data)\b/i,
  current_state_not_historical_transition: /\b(?:current state|historical transition|service event)\b/i,
  scheduled_execution_not_malicious_intent: /\b(?:cron|scheduled|malicious intent|persistence|approval gap)\b/i,
  package_install_not_repository_compromise: /\b(?:package|repository compromise|provenance)\b/i,
  log_gap_limits_confidence: /\b(?:log gap|secondary source|secondary evidence|confidence|cannot prove|supplied evidence|secondary-source)\b/i,
  outbound_session_not_attacker_identity: /\b(?:outbound|connection|operator|identity)\b/i,
  container_mount_not_full_host_compromise: /\b(?:container|mount|host compromise|scope gap)\b/i,
};

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxNarrativeContract } = require(path.join(out, "linux", "simulation.js"));
  const {
    buildLinuxAssembledNarrative,
    finalLinuxNarrativeFromAssembled,
    renderLinuxLearnerRequirementSentence,
  } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const {
    LINUX_INCIDENT_INVESTIGATION_CONTRACTS,
    linuxLearnerIncidentCoverageRequirements,
    validateLinuxIncidentCoverage,
  } = require(path.join(out, "linux", "incidentCoverage.js"));
  const { validateLinuxTaskDiversity } = require(path.join(out, "linux", "taskDiversity.js"));
  const { checkLinuxLabWorkload } = require(path.join(out, "linux", "workloadCalibration.js"));
  const { checkLinuxInvestigationQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const { assertLinuxStudentContent } = require(path.join(out, "linux", "studentContentValidation.js"));
  const { assertLinuxPackageMaintenanceTaskEvidence } = require(path.join(out, "linux", "claimAuthority.js"));
  const { linuxTaskTextHasRemediationConcept } = require(path.join(out, "linux", "incidentCoverage.js"));

  const modules = {
    buildLinuxNarrativeContract,
    buildLinuxAssembledNarrative,
    finalLinuxNarrativeFromAssembled,
    checkLinuxInvestigationQuality,
  };

  let assertions = 0;
  for (const family of FAMILIES) {
    for (const difficulty of DIFFICULTIES) {
      const candidate = buildCandidate(buildLinuxAssetCandidate, family, difficulty);
      const first = assembledLab(modules, candidate, difficulty);
      const second = assembledLab(modules, candidate, difficulty);
      const requirements = linuxLearnerIncidentCoverageRequirements({
        family,
        difficulty,
        tasks: first.contract.taskContracts.map((task) => ({
          taskId: task.taskId,
          intent: task.intent,
          requiredCapabilities: task.requiredCapabilities,
        })),
      });
      const configurationTask = first.contract.taskContracts.find(task => task.intent === "configuration_review");
      const allowSystemdBaselineGap = family === "systemd_persistence" && configurationTask &&
        !configurationTask.selectedEvidence.some(asset => asset.capabilities.includes("current_service_state") || asset.capabilities.includes("service_transition"));
      const requirementPhraseGroups = visibleRequirementPhraseGroups(requirements, renderLinuxLearnerRequirementSentence,
        allowSystemdBaselineGap, family === "ssh_bruteforce" && difficulty === "Advanced");
      const requirementPhrases = requirementPhraseGroups.flat();
      const text = allTaskText(first.lab);

      assert(`${family}/${difficulty} renders mandatory learner requirements`, requirementPhraseGroups.length > 0 && requirementPhraseGroups.every((phrases) => phrases.some((phrase) => text.includes(phrase))), JSON.stringify({ requirementPhraseGroups, text }));
      assertions += 1;

      if (family === "unauthorized_package_install") {
        const index = first.contract.taskContracts.findIndex((task) => task.intent === (difficulty === "Beginner" ? "configuration_review" : "change_control"));
        assert(`${family}/${difficulty} has the tier-appropriate maintenance task`, index >= 0);
        const task = first.lab.tasks[index];
        const taskText = `${task.title || ""} ${task.description || ""} ${task.deliverable || ""}`;
        const selected = (task.evidence || []).map((filePath) => candidate.assets.find((asset) => asset.file_path === filePath)).filter(Boolean);
        const transaction = selected.find((asset) => /\bStart-Date:\s*\d{4}-\d\d-\d\d\s+\d\d:\d\d/.test(asset.content) &&
          /\bCommandline:\s*\S+/.test(asset.content) && /\b(?:Install|Remove|Upgrade):\s*\S+/.test(asset.content));
        const date = transaction?.content.match(/\bStart-Date:\s*(\d{4}-\d\d-\d\d)/)?.[1];
        const authority = selected.find((asset) => /\b(?:maintenance policy|maintenance window|maintenance scope):\s*[^\n]*\d\d:\d\d/i.test(asset.content) &&
          Boolean(date && asset.content.includes(date)) && /\b(?:requested or expected work|activity scope):/i.test(asset.content));
        const comparison = /\b(?:check|compare|reconcile|map|assess)\b[^.!?\n]{0,120}\bmaintenance\b[^.!?\n]{0,120}\bpackage transaction\b/i.test(taskText) ||
          /\b(?:check|compare|reconcile|map|assess)\b[^.!?\n]{0,120}\bpackage transaction\b[^.!?\n]{0,120}\bmaintenance\b/i.test(taskText);
        const validateTask = (lab) => assertLinuxPackageMaintenanceTaskEvidence({ incidentFamily: family, assets: candidate.assets, lab });
        if (difficulty === "Beginner") {
          assert(`${family}/Beginner asks for the missing sources before comparison`,
            !transaction && !authority && !comparison &&
            /\b(?:missing|unavailable|needed|required|collect)\b/i.test(taskText) &&
            /\b(?:maintenance|change)\b/i.test(taskText) && /\bpackage transaction\b/i.test(taskText), taskText);
          const prematureComparison = structuredClone(first.lab);
          prematureComparison.tasks[index].deliverable += " Check maintenance evidence against the package transaction.";
          nodeAssert.throws(() => validateTask(prematureComparison), /lacks task-local package transaction evidence/);
          assert(`${family}/Beginner rejects a late unsupported comparison`, true);
        } else {
          assert(`${family}/${difficulty} comparison has task-local transaction and dated authority without configuration inflation`,
            comparison && transaction && authority && !(task.evidence || []).includes("assets/configs/linux_config_pack.txt"),
            JSON.stringify({ taskText, evidence: task.evidence }));
          nodeAssert.doesNotThrow(() => validateTask(first.lab));
          const withoutTransaction = structuredClone(first.lab);
          withoutTransaction.tasks[index].evidence = withoutTransaction.tasks[index].evidence.filter((filePath) => filePath !== transaction.file_path);
          nodeAssert.throws(() => validateTask(withoutTransaction), /lacks task-local package transaction evidence/);
          const withoutAuthority = structuredClone(first.lab);
          withoutAuthority.tasks[index].evidence = withoutAuthority.tasks[index].evidence.filter((filePath) => filePath !== authority.file_path);
          nodeAssert.throws(() => validateTask(withoutAuthority), /lacks task-local dated change or maintenance authority/);
          assert(`${family}/${difficulty} final package rejects either missing comparison source`, true);
          if (difficulty === "Advanced") {
            const configuration = first.contract.taskContracts.findIndex((item) => item.intent === "configuration_review");
            assert(`${family}/Advanced has independent control-state analysis`, configuration >= 0 &&
              first.lab.tasks[configuration].evidence.includes("assets/configs/linux_config_pack.txt") &&
              first.lab.tasks[configuration].evidence.includes("assets/reports/service_inventory.txt") &&
              /\bcompar(?:e|ing)\b[^.!?\n]{0,120}\bconfiguration baseline\b[^.!?\n]{0,120}\b(?:runtime|observed|captured)\s+(?:service\s+)?state\b/i.test(first.lab.tasks[configuration].deliverable));
          }
        }
        assertions += 3;
      }

      assertLinuxStudentContent({
        title: first.lab.title,
        topic: first.lab.category,
        objective: first.lab.objective,
        scenario: first.lab.scenario,
        tasks: first.lab.tasks,
        hints: first.lab.hints,
        outcomes: first.lab.outcomes,
        learningOutcomes: first.lab.learningOutcomes,
      });
      assert(`${family}/${difficulty} deterministic coverage exposes no internal IDs`, !/capability_key|subject_indexes|relationship_statement_indexes|canonical subject|identity:[a-z0-9._:-]+|task:\d+:/i.test(JSON.stringify(first.lab)));
      assertions += 1;

      const coverage = validateLinuxIncidentCoverage({
        simulation: candidate.simulation,
        finalAssets: candidate.assets,
        lab: first.lab,
      });
      assert(`${family}/${difficulty} incident coverage passes`, coverage.status === "covered", JSON.stringify(coverage.issues));
      assertions += 1;

      const diversity = validateLinuxTaskDiversity({
        simulation: candidate.simulation,
        finalAssets: candidate.assets,
      });
      assert(`${family}/${difficulty} tasks remain diverse`, diversity.status === "diverse", JSON.stringify(diversity.issues));
      assertions += 1;

      const workload = checkLinuxLabWorkload({
        simulation: candidate.simulation,
        assets: candidate.assets,
        requestedDifficulty: difficulty,
        requestedDurationMinutes: difficulty === "Advanced" ? 60 : 30,
      });
      assert(`${family}/${difficulty} workload remains in range`, workload.passed, JSON.stringify(workload.issues));
      assertions += 1;

      const quality = qualityFor(modules, candidate, first.lab, difficulty);
      assert(`${family}/${difficulty} final quality passes`, quality.passed, JSON.stringify(quality.issues.slice(0, 5)));
      assertions += 1;

      assert(`${family}/${difficulty} same seed produces identical coverage`, JSON.stringify(first.lab.tasks.map((task) => task.deliverable)) === JSON.stringify(second.lab.tasks.map((task) => task.deliverable)));
      assertions += 1;

      if (family === "docker_compromise") {
        const hardeningMatches = text.match(/harden container runtime boundaries and validate mount exposure/gi) || [];
        assert(`${family}/${difficulty} renders equivalent hardening instruction once`, hardeningMatches.length === 1, text);
        assertions += 1;
        assert(`${family}/${difficulty} keeps container uncertainty requirement distinct`, /container evidence and unsupported host-compromise claims|container mount evidence does not prove full host compromise/i.test(text), text);
        assertions += 1;
      }

      const contract = LINUX_INCIDENT_INVESTIGATION_CONTRACTS[family];
      const difficultyCoverage = contract.difficultyRequirements[difficulty.toLowerCase()];
      for (const concept of difficultyCoverage.requiredRemediationConcepts) {
        const mutated = removeSemanticRemediation(first.lab, concept, linuxTaskTextHasRemediationConcept);
        assert(`${family}/${difficulty} mutation removes all ${concept} response clauses`,
          mutated.tasks.every((task) => !linuxTaskTextHasRemediationConcept(concept,
            `${task.title || ""}\n${task.description || ""}\n${task.deliverable || ""}`)));
        const report = validateLinuxIncidentCoverage({ simulation: candidate.simulation, finalAssets: candidate.assets, lab: mutated });
        assert(`${family}/${difficulty} deleting remediation concept is detected`, report.issues.some((issue) => issue.code === "LINUX_INCIDENT_REMEDIATION_MISSING" || issue.code === "LINUX_INCIDENT_QUESTION_MISSING"), JSON.stringify({ concept, issues: report.issues }));
        assertions += 1;
      }
      for (const boundary of difficultyCoverage.requiredUncertaintyBoundaries) {
        const matcher = uncertaintyPhraseMatchers[boundary] || /\bseparate (?:observed )?facts\b/i;
        const phrases = requirementPhrases.filter((item) =>
          (/\bseparate (?:observed )?facts\b/i.test(item) || matcher.test(item)) &&
          /\b(?:does not|cannot|not enough|not prove|may contain|unavailable|gap|limits confidence|unsupported|without inferring)\b/i.test(item)
        );
        let mutated = removePhrasesFromLab(first.lab, phrases);
        if (boundary === "log_gap_limits_confidence") mutated = replacePatternInLab(mutated, /\b(?:log gap|logging gap|confidence|secondary[- ]source)\b/gi, "evidence note");
        const report = validateLinuxIncidentCoverage({ simulation: candidate.simulation, finalAssets: candidate.assets, lab: mutated });
        assert(`${family}/${difficulty} deleting uncertainty boundary is detected`, report.issues.some((issue) => issue.code === "LINUX_INCIDENT_UNCERTAINTY_BOUNDARY_MISSING"), JSON.stringify({ boundary, issues: report.issues }));
        assertions += 1;
      }
    }
  }

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main();
