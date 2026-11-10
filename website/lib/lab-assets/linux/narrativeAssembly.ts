import type { LinuxInvestigationContext } from "./investigation";
import { linuxLearnerIncidentCoverageRequirements, type LinuxLearnerIncidentRequirement } from "./incidentCoverage";
import type { LinuxNarrativeContract } from "./simulation";
import type { FinalLinuxNarrative } from "./qualityChecker";
import type { LinuxNarrativeTaskContract } from "./simulation";
import { linuxStableDiversityHash } from "./diversityProfile";
import { linuxIndefiniteArticle } from "./grammar";

export type LinuxAssembledTask = {
  task_id?: string;
  task_intent?: string;
  phase?: string;
  title?: string;
  evidence?: string[];
  deliverable?: string;
  claims?: Array<{
    claim_class?: string;
    text?: string;
    supporting_evidence?: string[];
    subjects?: string[];
    relationships?: Array<{ relation?: string; subject_ids?: string[] }>;
    timestamps?: string[];
  }>;
};

export type LinuxAssembledNarrative = {
  title: string;
  topic: string;
  difficulty: string;
  estimated_time: string;
  objective: string;
  scenario: string;
  tasks: LinuxAssembledTask[];
  hints: string[];
  outcomes: string[];
};

const TASK_TITLES: Record<string, string> = {
  ssh_authentication: "Inspect SSH sign-in records",
  actor_attribution: "Correlate account activity evidence",
  scope_timeline: "Reconstruct timestamped evidence sequence",
  configuration_review: "Compare configuration baseline evidence",
  evidence_integrity: "Document evidence coverage gaps",
  file_permissions: "Compare file ownership and mode evidence",
  sudo_policy: "Map sudo policy and command evidence",
  command_process: "Trace command and process evidence",
  service_state: "Verify service state evidence",
  package_transaction: "Correlate package transaction evidence",
  cron_analysis: "Examine scheduled task definition and run evidence",
  network_source: "Assess network exposure evidence",
  change_control: "Map change records to observed activity",
  impact_assessment: "Document bounded impact evidence",
  risk_assessment: "Evaluate bounded risk evidence",
  containment_recommendation: "Plan evidence-supported containment validation",
  key_provenance: "Trace SSH key provenance evidence",
};

const TASK_TITLE_VARIANTS: Record<string, string[]> = {
  ssh_authentication: ["Inspect SSH sign-in records", "Establish the SSH session entry point", "Assess SSH sign-in and control limits"],
  actor_attribution: ["Correlate account activity evidence", "Map the account and ownership context", "Resolve the actor evidence boundary"],
  scope_timeline: ["Reconstruct timestamped evidence sequence", "Build the incident-window chronology", "Sequence the material events"],
  configuration_review: ["Compare configuration baseline evidence", "Compare observed state with configuration evidence", "Review the control baseline"],
  evidence_integrity: ["Document evidence coverage gaps", "Assess source coverage and confidence", "Map the evidence limitations"],
  file_permissions: ["Compare file ownership and mode evidence", "Evaluate object access boundaries", "Review ownership, group, and mode"],
  sudo_policy: ["Map sudo policy and command evidence", "Compare privilege use with sudo authority", "Evaluate the sudo boundary"],
  command_process: ["Trace command and process evidence", "Reconstruct execution lineage", "Correlate commands, processes, and files"],
  service_state: ["Verify service state evidence", "Reconcile service state and transitions", "Assess the unit lifecycle"],
  package_transaction: ["Correlate package transaction evidence", "Reconstruct the package operation", "Review package authority and provenance"],
  cron_analysis: ["Examine scheduled task definition and run evidence", "Correlate schedule, account, and execution", "Reconstruct the scheduled-job lifecycle"],
  network_source: ["Assess network exposure evidence", "Correlate endpoints with runtime activity", "Map the network boundary"],
  change_control: ["Map change records to observed activity", "Compare runtime activity with approved scope", "Reconcile the occurrence with change authority"],
  impact_assessment: ["Document bounded impact evidence", "Evaluate affected scope and business context", "Bound the operational impact"],
  risk_assessment: ["Evaluate bounded risk evidence", "Weigh competing risk explanations", "Assess risk, limits, and control gaps"],
  containment_recommendation: ["Plan evidence-supported containment validation", "Design conditional containment steps", "Prioritise capture, containment, and validation"],
  key_provenance: ["Review SSH key evidence and its limits", "Assess the available key provenance", "Document key identity and history gaps"],
};

function taskTitleLeadingVerb(value: string) {
  return value.trim().split(/\s+/)[0]?.toLowerCase() || "";
}

function deterministicTaskTitle(
  task: LinuxAssembledTask,
  index: number,
  contractTask?: LinuxNarrativeTaskContract,
  styleKey = "",
  usedLeadingVerbs?: Set<string>
) {
  const intent = String(contractTask?.intent || task.task_intent || "evidence_review");
  const variants = intent === "service_state" && contractTask && !contractTask.requiredCapabilities.includes("service_transition")
    ? ["Verify service state evidence", "Assess the captured unit state", "Review the service-state snapshot"]
    : intent === "configuration_review" && contractTask && !contractTask.selectedEvidence.some(asset =>
        asset.capabilities.includes("current_service_state") || asset.capabilities.includes("service_transition"))
      ? ["Review the control baseline", "Compare configuration baseline evidence", "Assess configuration evidence"]
      : TASK_TITLE_VARIANTS[intent];
  if (variants && styleKey) {
    const start = linuxStableDiversityHash(`${styleKey}:${intent}:${index}`) % variants.length;
    const ordered = variants.map((_, offset) => variants[(start + offset) % variants.length]);
    const title = ordered.find((item) => !usedLeadingVerbs?.has(taskTitleLeadingVerb(item))) || ordered[0];
    usedLeadingVerbs?.add(taskTitleLeadingVerb(title));
    return title;
  }
  const deterministic = TASK_TITLES[intent];
  if (deterministic) {
    usedLeadingVerbs?.add(taskTitleLeadingVerb(deterministic));
    return deterministic;
  }
  const title = String(task.title || "").trim();
  if (title && !/^untitled task$/i.test(title)) {
    usedLeadingVerbs?.add(taskTitleLeadingVerb(title));
    return title;
  }
  const fallback = `Review ${intent.replace(/_/g, " ")} evidence for task ${index + 1}`;
  usedLeadingVerbs?.add(taskTitleLeadingVerb(fallback));
  return fallback;
}

function naturalList(values: string[]) {
  const uniqueValues = Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
  if (uniqueValues.length <= 1) return uniqueValues[0] || "";
  if (uniqueValues.length === 2) return `${uniqueValues[0]} and ${uniqueValues[1]}`;
  return `${uniqueValues.slice(0, -1).join(", ")}, and ${uniqueValues[uniqueValues.length - 1]}`;
}

const DELIVERABLE_STARTERS: Record<string, string[]> = {
  Beginner: [
    "Write a short evidence note",
    "Record a concise finding",
    "Prepare a brief analyst note",
  ],
  Intermediate: [
    "Prepare a focused correlation note",
    "Write an evidence-gap summary",
    "Draft a concise analyst finding",
  ],
  Advanced: [
    "Build an evidence-supported analysis note",
    "Prepare a bounded analytical summary",
    "Draft a defensible investigation finding",
  ],
};

const DELIVERABLE_OUTPUTS: Record<string, string> = {
  timeline: "with timestamps, sources, and confidence limits.",
  correlation_table: "linking the subject, relationship, and evidence.",
  gap_assessment: "separating facts, gaps, and validation needs.",
  policy_mapping: "comparing observed activity with policy or approval evidence.",
  evidence_notes: "using only listed evidence and uncertainty notes.",
  risk_summary: "stating evidence-supported risk without unsupported conclusions.",
  escalation_summary: "with observations and next validation ownership.",
  containment_plan: "with evidence-supported containment, remediation, and validation steps.",
};

function deterministicDeliverableOutput(contractTask?: LinuxNarrativeTaskContract) {
  if (contractTask?.intent === "configuration_review") {
    const hasRuntimeState = contractTask.selectedEvidence.some((asset) => {
      const runtimeSource = /^(?:assets\/(?:logs|journal|reports)\/)/i.test(asset.path);
      return runtimeSource && (
        asset.capabilities.includes("current_service_state") ||
        asset.capabilities.includes("service_transition") ||
        asset.capabilities.includes("service_state")
      );
    });
    return hasRuntimeState
      ? "comparing the configuration baseline with task-local runtime state evidence."
      : "documenting the configuration baseline and any missing task-local runtime-state evidence.";
  }
  return DELIVERABLE_OUTPUTS[contractTask?.deliverableType || "evidence_notes"] || DELIVERABLE_OUTPUTS.evidence_notes;
}

export const LINUX_LEARNER_REQUIREMENT_SENTENCE_REGISTRY = {
  incident_question: {
    sudo_actor: "Identify the sudo account.",
    sudo_command: "Compare the command with sudo policy.",
    sudo_policy_rule: "Map sudo policy evidence.",
    sudo_business_need: "Check business need.",
    sudo_next_step: "Include narrow sudo-rule validation steps.",
    ssh_account: "Identify the SSH account from authentication evidence.",
    ssh_source: "Cite SSH source evidence for the sign-in activity.",
    ssh_sequence: "Order the supported SSH attempts, accepted method, and session opening; distinguish a source address and account from a human operator or proven compromise.",
    ssh_control_gap: "Check whether SSH evidence leaves a control gap.",
    ssh_next_step: "Describe follow-up steps to validate the account purpose and access scope.",
    service_account_identity: "Identify the service account from identity evidence.",
    service_account_activity: "Describe the observed account activity using listed evidence.",
    service_account_role_boundary: "Explain what the file owner, group, and mode establish about access under the service account.",
    service_account_next_step: "Describe follow-up steps to validate the account purpose and owner.",
    key_account: "Identify the account associated with SSH key evidence.",
    key_source: "Cite the key-source evidence in the task.",
    key_identifier_or_gap: "Document the SSH key identifier or evidence gap.",
    key_lifecycle: "Document the unavailable key lifecycle history and key-to-file mapping without inferring a trust change.",
    key_next_step: "Include validation steps to restrict SSH key trust and confirm source scope.",
    cron_definition: "Identify the cron definition from scheduled-task evidence.",
    cron_owner: "Identify the run-as account for the scheduled task.",
    cron_execution: "Correlate cron execution with the scheduled definition.",
    cron_approval: "Check approval evidence against scheduled activity.",
    cron_next_step: "Include steps to capture cron evidence before disabling the task.",
    systemd_unit: "Identify the systemd unit.",
    systemd_transition: "Correlate service event timestamps.",
    systemd_baseline: "Compare expected baseline with observed service state at the inventory capture time.",
    systemd_next_step: "Validate before disabling or masking the systemd unit.",
    package_transaction: "Identify the package transaction from package evidence.",
    package_actor: "Identify the package authority or account.",
    package_maintenance_gap: "Identify which dated maintenance authority and package transaction records are missing from the selected evidence, and state what must be collected before comparing activity to scope.",
    package_maintenance: "Check maintenance evidence against the package transaction.",
    package_next_step: "Include steps to verify package provenance before rollback.",
    staging_actor: "Identify the account tied to staged data activity.",
    staging_paths: "Document staged paths using listed file evidence.",
    staging_sequence: "Sequence the staging events with task-local timestamps.",
    staging_scope_boundary: "State the boundary between local staging evidence and unsupported transfer claims.",
    staging_next_step: "Include steps to quarantine staged data and validate transfer scope.",
    log_gap: "Identify the log gap using the listed evidence.",
    log_secondary_source: "Use the secondary source to bound the finding where primary logs are incomplete.",
    log_confidence: "State what the supplied evidence can and cannot prove.",
    log_next_step: "Include steps to restore logging and preserve secondary evidence sources.",
    reverse_process: "Identify the outbound process from runtime evidence.",
    reverse_network: "Correlate outbound network evidence with process activity.",
    reverse_actor_service: "Relate account or service context to outbound activity.",
    reverse_next_step: "Include containment and egress-review steps for the outbound process.",
    docker_runtime: "Identify container runtime activity from process evidence.",
    docker_mount_or_file: "Document the mount or file boundary from file evidence.",
    docker_actor: "Identify the container-related account from identity evidence.",
    docker_boundary: "State the boundary between container evidence and unsupported host-compromise claims.",
    docker_next_step: "Include steps to harden container runtime boundaries and validate mount exposure.",
  },
  uncertainty_boundary: {
    account_use_not_human_operator: "Account use does not prove a human operator or intent; separate facts and owner gaps.",
    excessive_sudo_not_malicious_intent: "The listed evidence does not prove malicious intent; separate facts and validation gaps.",
    exact_ssh_key_may_be_unavailable: "SSH key evidence may contain a gap; separate facts and key-validation gaps.",
    local_staging_not_exfiltration: "Local staging evidence does not prove transfer; separate facts and transfer gaps.",
    current_state_not_historical_transition: "Current state does not prove a historical transition; separate facts and transition gaps.",
    scheduled_execution_not_malicious_intent: "Cron evidence does not prove malicious intent or persistence; separate facts and approval gaps.",
    package_install_not_repository_compromise: "Package install evidence does not prove repository compromise or provenance; separate facts and gaps.",
    log_gap_limits_confidence: "A log gap limits confidence; separate facts and secondary-source gaps.",
    outbound_session_not_attacker_identity: "Outbound connection evidence cannot identify an operator; separate facts and identity gaps.",
    container_mount_not_full_host_compromise: "Container mount evidence does not prove full host compromise; separate facts and scope gaps.",
  },
  remediation_concept: {
    narrow_sudo_rule: "Propose steps to narrow the sudo rule and validate least privilege.",
    rotate_or_restrict_ssh_key: "Propose evidence-supported steps to rotate or restrict SSH key trust.",
    validate_account_purpose: "Propose evidence-supported steps to validate account purpose and restrict access.",
    disable_scheduled_task_after_capture: "Propose evidence-supported steps to capture cron evidence, then disable the task.",
    preserve_and_disable_unit: "Preserve systemd evidence and verify ownership, approval and operational need. Explain when disabling or masking is justified, and validate it.",
    verify_package_provenance_or_rollback: "Propose evidence-supported steps to verify package provenance and approve rollback.",
    quarantine_staged_data_and_validate_transfer: "Propose evidence-supported steps to quarantine staged data and validate transfer scope.",
    restore_logging_and_preserve_secondary_sources: "Propose evidence-supported steps to restore logging and preserve secondary sources.",
    contain_process_and_review_egress: "Propose evidence-supported steps to contain the process and review egress controls.",
    harden_container_runtime_boundary: "Propose evidence-supported steps to harden container runtime boundaries and validate mount exposure.",
  },
};

function requirementKey(requirement: LinuxLearnerIncidentRequirement) {
  return `${requirement.kind}:${requirement.id}`;
}

export function allLinuxLearnerRequirementKinds() {
  return Object.entries(LINUX_LEARNER_REQUIREMENT_SENTENCE_REGISTRY).flatMap(([kind, values]) =>
    Object.keys(values).map((id) => ({ kind, id }))
  ) as LinuxLearnerIncidentRequirement[];
}

export function renderLinuxLearnerRequirementSentence(requirement: LinuxLearnerIncidentRequirement) {
  const sentence = (LINUX_LEARNER_REQUIREMENT_SENTENCE_REGISTRY[requirement.kind] as Record<string, string> | undefined)?.[requirement.id];
  if (!sentence) throw new Error(`LINUX_LEARNER_REQUIREMENT_RENDERER_MISSING: ${requirement.kind}:${requirement.id}`);
  return sentence;
}

const LINUX_LEARNER_REQUIREMENT_SEMANTIC_KEYS: Record<string, string> = {
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

function requirementSemanticKey(requirement: LinuxLearnerIncidentRequirement) {
  return LINUX_LEARNER_REQUIREMENT_SEMANTIC_KEYS[requirementKey(requirement)] || requirementKey(requirement);
}

function requirementPriority(value: LinuxLearnerIncidentRequirement) {
  if (value.kind === "uncertainty_boundary") return 0;
  if (value.kind === "remediation_concept" || /_next_step$/.test(value.id)) return 1;
  return 2;
}

function deterministicDeliverable(
  task: LinuxAssembledTask,
  index: number,
  difficulty: string,
  contractTask?: LinuxNarrativeTaskContract,
  requirements: LinuxLearnerIncidentRequirement[] = [],
  styleKey = "",
  advancedSshKeyThirty = false
) {
  if (advancedSshKeyThirty && contractTask?.intent === "ssh_authentication") {
    return "Map each observed SSH session to subsequent commands through its session PID and process PPID chain; check host, account, and time. Identify the account associated with SSH key evidence. Cite the key-source evidence in the task. Treat the later partial passwd snapshot as context, not historical identity proof.";
  }
  if (advancedSshKeyThirty && contractTask?.intent === "key_provenance") {
    return "Assess the SSH fingerprint, captured file metadata, and undated sshd configuration. SSH key evidence may contain a gap. Document unavailable key lifecycle history and fingerprint-to-file mapping without inferring a trust change. Propose conditional steps to rotate or restrict SSH key trust after source validation.";
  }
  if (advancedSshKeyThirty && contractTask?.intent === "impact_assessment") {
    return "Bound the scope and risk of recorded activity against unverified risk-register items. Distinguish observations from hypotheses and state what evidence is needed before escalation; do not infer business impact, malicious intent, compromise, key change, or approval.";
  }
  const starters = DELIVERABLE_STARTERS[difficulty] || DELIVERABLE_STARTERS.Advanced;
  const starter = starters[linuxStableDiversityHash(`${styleKey}:${difficulty}:${index}`) % starters.length];
  const output = deterministicDeliverableOutput(contractTask);
  const base = `${starter} ${output}`;
  const uniqueRequirements = Array.from(new Map(requirements.map((item) => [requirementSemanticKey(item), item])).values());
  const requirementSentences = uniqueRequirements
    .slice()
    .sort((left, right) => {
      const priority = requirementPriority(left) - requirementPriority(right);
      if (priority !== 0) return priority;
      return requirementKey(left).localeCompare(requirementKey(right));
    })
    .map(requirement => requirement.kind === "incident_question" && requirement.id === "ssh_sequence" &&
      difficulty === "Advanced" && contractTask?.intent === "scope_timeline"
      ? "Order the failed SSH attempts, accepted method, and session opening; relate later audit activity while distinguishing source/account from operator and chronology from proven session linkage or compromise."
      : requirement.kind === "incident_question" && requirement.id === "systemd_baseline" &&
      contractTask?.intent === "configuration_review" && !contractTask.selectedEvidence.some(asset =>
        asset.capabilities.includes("current_service_state") || asset.capabilities.includes("service_transition"))
      ? "Document the expected baseline and what observed service state remains unverified."
      : renderLinuxLearnerRequirementSentence(requirement))
    .filter(Boolean);
  const sentences = [base, ...requirementSentences].filter(Boolean);
  const accepted: string[] = [];
  for (const sentence of sentences) {
    const candidate = [...accepted, sentence].join(" ");
    if (candidate.length <= 320) accepted.push(sentence);
  }
  if (accepted.length < sentences.length && requirementSentences.length > 0) {
    const compact = ["Write a concise evidence-backed note."];
    for (const sentence of requirementSentences) {
      const candidate = [...compact, sentence].join(" ");
      if (candidate.length <= 320) compact.push(sentence);
    }
    if (compact.length > requirementSentences.length) return compact.join(" ");
    return requirementSentences.join(" ");
  }
  return accepted.join(" ") || "Record a concise evidence-backed finding using only the listed evidence.";
}

export function buildLinuxAssembledNarrative(input: {
  contract: LinuxNarrativeContract;
  context: LinuxInvestigationContext;
  difficulty: string;
  duration: string;
  tasks: LinuxAssembledTask[];
}): LinuxAssembledNarrative {
  const { contract, context, difficulty, duration } = input;
  const advancedSshKeyThirty = contract.incidentFamily === "ssh_key_compromise" &&
    difficulty === "Advanced" && duration === "30 mins";
  const window = `${context.incidentWindowStart}-${context.incidentWindowEnd}`;
  const contractTasksById = new Map(contract.taskContracts.map((task) => [task.taskId, task]));
  const deterministicRequirements = linuxLearnerIncidentCoverageRequirements({
    family: contract.incidentFamily,
    difficulty,
    tasks: contract.taskContracts.map((task) => ({
      taskId: task.taskId,
      intent: task.intent,
      requiredCapabilities: task.requiredCapabilities,
    })),
  });
  const usedTaskTitleVerbs = new Set<string>();
  const tasks = input.tasks.map((task, index) => {
    const contractTask = task.task_id ? contractTasksById.get(task.task_id) : contract.taskContracts[index];
    const title = advancedSshKeyThirty && contractTask?.intent === "change_control"
      ? "Map change records to observed activity"
      : advancedSshKeyThirty && contractTask?.intent === "ssh_authentication"
      ? "Correlate SSH sessions with subsequent activity"
      : advancedSshKeyThirty && contractTask?.intent === "impact_assessment"
      ? "Assess observed activity and bounded risk"
      : deterministicTaskTitle(task, index, contractTask, contract.caseId, usedTaskTitleVerbs);
    return {
      ...task,
      phase: `Task ${index + 1}`,
      title,
      evidence: Array.isArray(task.evidence) ? task.evidence : [],
      deliverable: deterministicDeliverable(
        task,
        index,
        difficulty,
        contractTask,
        deterministicRequirements.get(task.task_id || contract.taskContracts[index]?.taskId || "") || [],
        contract.caseId,
        advancedSshKeyThirty
      ),
    };
  });
  const taskObjects = tasks.map((task) => task.title).filter(Boolean).slice(0, 3);
  const taskSummary = naturalList(taskObjects) || "the supplied task contracts";
  const evidenceNames = Array.from(new Set(tasks.flatMap((task) => task.evidence || [])
    .map((item) => item.split("/").pop() || item)
    .filter(Boolean)))
    .slice(0, 4)
    .join(", ");
  const scenarioVariants = [
    `${context.company} analysts are reviewing ${context.hostname}, ${linuxIndefiniteArticle(context.hostRole)} ${context.hostRole}, for ticket ${context.ticketId} and change ${context.changeId}. The evidence pack focuses on ${contract.scenarioFraming.primaryService} during ${window} ${context.timezone}.`,
    `Ticket ${context.ticketId} brings ${context.company}'s ${context.hostname} into review. The host is ${linuxIndefiniteArticle(context.hostRole)} ${context.hostRole}, and ${context.changeId} is the available change reference for activity involving ${contract.scenarioFraming.primaryService} during ${window} ${context.timezone}.`,
    `${context.company} has handed over evidence from ${context.hostname} for a bounded ${context.hostRole} review. Analysts must reconcile ${context.ticketId}, ${context.changeId}, and ${contract.scenarioFraming.primaryService} activity within ${window} ${context.timezone}.`,
    `This evidence memo covers ${context.hostname}, ${linuxIndefiniteArticle(context.hostRole)} ${context.hostRole} at ${context.company}. The question is how ${contract.scenarioFraming.primaryService} activity in the ${window} ${context.timezone} window relates to ticket ${context.ticketId} and change ${context.changeId}.`,
  ];
  const scenario = scenarioVariants[linuxStableDiversityHash(`${contract.caseId}:scenario`) % scenarioVariants.length];
  const hintVariants = [
    [
      `Keep each note tied to the evidence listed for that task on ${context.hostname}.`,
      `Use the ${window} ${context.timezone} window as the boundary for timestamped activity.`,
      `Separate observed evidence from any uncertainty the task asks you to document.`,
    ],
    [
      `Start from the task-local sources and cite the rows that carry each relationship.`,
      `Treat events outside ${window} ${context.timezone} as context unless the task explicitly asks for them.`,
      `Record alternative explanations where the supplied sources leave ownership, intent, or scope unresolved.`,
    ],
    [
      `Build the finding from subjects, actions, and timestamps before considering remediation.`,
      `Reconcile current-state snapshots with historical records; they do not prove the same thing.`,
      `Keep conclusions proportional to the evidence paths assigned to the task.`,
    ],
  ];
  return {
    title: `${context.hostRole} evidence review on ${context.hostname}`,
    topic: "Linux",
    difficulty,
    estimated_time: duration,
    objective: `Use the supplied Linux evidence for ${context.incidentId} to document ${context.hostname} activity during ${window} ${context.timezone}.`,
    scenario: `${scenario} Each task is limited to its listed evidence paths.`,
    tasks,
    hints: hintVariants[linuxStableDiversityHash(`${contract.caseId}:hints`) % hintVariants.length],
    outcomes: [
      `Build Linux findings for ${taskSummary} using only selected task evidence.`,
      `Trace task claims to ${evidenceNames || "selected Linux evidence paths"} with subjects, relationships, and timestamps preserved.`,
      `Summarize Linux ${difficulty.toLowerCase()} evidence without adding unsupported conclusions.`,
    ],
  };
}

export function finalLinuxNarrativeFromAssembled(input: {
  lab: LinuxAssembledNarrative;
}): FinalLinuxNarrative {
  const { lab } = input;
  return {
    title: lab.title,
    objective: lab.objective,
    scenario: lab.scenario,
    tasks: lab.tasks.map((task, index) => {
      const title = String(task.title || "").trim() || deterministicTaskTitle(task, index);
      return {
        phase: task.phase || `Task ${index + 1}`,
        title,
        description: title,
        evidence: Array.isArray(task.evidence) ? task.evidence : [],
        deliverable: task.deliverable || "Record a concise evidence-backed finding.",
      };
    }),
    hints: lab.hints,
    outcomes: lab.outcomes,
    learningOutcomes: lab.outcomes,
    duration: lab.estimated_time,
    category: lab.topic,
    difficulty: lab.difficulty,
  };
}
