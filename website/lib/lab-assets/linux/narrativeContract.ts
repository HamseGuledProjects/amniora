import { normalizeLinuxEvidencePath } from "./difficultyProfile";
import { buildLinuxSafeRetryFeedback, linuxRetryFeedbackCategoriesFromNarrativeIssueCodes } from "./narrativeRetryFeedback";
import type {
  CanonicalEvidenceCapability,
  CanonicalInvestigationTask,
  LinuxNarrativeClaimClass,
  LinuxNarrativeContract,
  LinuxNarrativeTaskContract,
} from "./simulation";

export type LinuxNarrativeContractIssueCode =
  | "LINUX_NARRATIVE_TASK_COUNT_MISMATCH"
  | "LINUX_NARRATIVE_TASK_MISSING"
  | "LINUX_NARRATIVE_TASK_DUPLICATE"
  | "LINUX_NARRATIVE_TASK_UNKNOWN"
  | "LINUX_NARRATIVE_TASK_ORDER_MISMATCH"
  | "LINUX_NARRATIVE_INTENT_MISMATCH"
  | "LINUX_NARRATIVE_EVIDENCE_OUTSIDE_CONTRACT"
  | "LINUX_NARRATIVE_UNRENDERED_EVIDENCE"
  | "LINUX_NARRATIVE_UNKNOWN_SUBJECT"
  | "LINUX_NARRATIVE_UNSUPPORTED_RELATIONSHIP"
  | "LINUX_NARRATIVE_INVENTED_TIMESTAMP"
  | "LINUX_NARRATIVE_UNSUPPORTED_CURRENT_STATE"
  | "LINUX_NARRATIVE_UNSUPPORTED_HISTORICAL_STATE"
  | "LINUX_NARRATIVE_UNBOUNDED_INFERENCE"
  | "LINUX_NARRATIVE_UNSUPPORTED_RECOMMENDATION"
  | "LINUX_NARRATIVE_PROHIBITED_CAPABILITY"
  | "LINUX_NARRATIVE_ADVANCED_LEAK"
  | "LINUX_NARRATIVE_INTERNAL_DETAIL_LEAK"
  | "LINUX_NARRATIVE_LOCAL_PATH_LEAK";

export type LinuxNarrativeContractIssue = {
  code: LinuxNarrativeContractIssueCode;
  taskId?: string;
  field?: string;
  evidence?: string;
  message: string;
};

export type LinuxNarrativeClaim = {
  claim_class?: LinuxNarrativeClaimClass;
  text?: string;
  supporting_evidence?: string[];
  subjects?: string[];
  relationships?: Array<{
    relation?: string;
    subject_ids?: string[];
  }>;
  timestamps?: string[];
};

export type LinuxGeneratedTaskForContract = {
  task_id?: string;
  task_intent?: CanonicalInvestigationTask["intent"] | string;
  phase?: string;
  title?: string;
  evidence?: string[];
  deliverable?: string;
  claims?: LinuxNarrativeClaim[];
};

export type LinuxGeneratedNarrativeForContract = {
  title?: string;
  objective?: string;
  scenario?: string;
  tasks?: LinuxGeneratedTaskForContract[];
  hints?: string[];
  outcomes?: string[];
};

export type LinuxNarrativeContractValidationResult = {
  passed: boolean;
  issues: LinuxNarrativeContractIssue[];
  metrics: {
    unknownSubjectCount: number;
    unsupportedRelationshipCount: number;
    inventedTimestampCount: number;
    unsupportedCurrentStateCount: number;
    unrenderedEvidenceCount: number;
  };
};

const currentStateCapabilities = new Set<CanonicalEvidenceCapability>([
  "current_service_state",
  "current_process_state",
  "current_listener_state",
  "current_package_state",
  "current_persistence_state",
  "current_identity_state",
  "current_file_state",
  "current_open_file_state",
  "current_policy_state",
  "current_configuration_state",
]);

const internalPattern =
  /\b(?:identity|session|command|process|descriptor|file|service|transition|cron|scheduled|package|maintenance|event):[A-Za-z0-9._:@-]+|\b(?:executed_by|spawned_process|opened_file|covered_by_change|inside_maintenance_window|authenticated_as|service_transition|transitioned_service|defines_schedule|executed_schedule|installed_package)\b/;

const localPathPattern = /\b[A-Za-z]:\\|(?:^|\s)(?:\.{1,2}\/|\/?(?:lib|app|tests)\/lab-assets\/)/;

const unsupportedConclusionPattern =
  /\b(?:root cause is|root cause was|confirmed compromise|confirmed compromised|malware|exfiltrat(?:ed|ion)|attacker is|attacker was|persistence is active|currently active persistence)\b/i;

function issue(
  issues: LinuxNarrativeContractIssue[],
  code: LinuxNarrativeContractIssueCode,
  message: string,
  details: Omit<LinuxNarrativeContractIssue, "code" | "message"> = {}
) {
  issues.push({ code, message, ...details });
}

function taskText(task: LinuxGeneratedTaskForContract) {
  return `${task.phase || ""}\n${task.title || ""}\n${task.deliverable || ""}\n${(task.evidence || []).join("\n")}\n${(task.claims || []).map((claim) => claim.text || "").join("\n")}`;
}

function narrativeText(narrative: LinuxGeneratedNarrativeForContract) {
  return [
    narrative.title,
    narrative.objective,
    narrative.scenario,
    ...(narrative.hints || []),
    ...(narrative.outcomes || []),
    ...(narrative.tasks || []).map(taskText),
  ].filter(Boolean).join("\n");
}

function extractEvidencePaths(text: string) {
  return Array.from(new Set((text.match(/assets\/[A-Za-z0-9_./@-]+/g) || []).map(normalizeLinuxEvidencePath)));
}

function exactPathSet(values: string[]) {
  return new Set(values.map(normalizeLinuxEvidencePath));
}

function timestampTokens(text: string) {
  const values = new Set<string>();
  for (const match of text.matchAll(/\b20\d\d-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?Z?\b/g)) values.add(match[0].replace("T", " ").replace(/Z$/, ""));
  for (const match of text.matchAll(/\b\d\d:\d\d(?::\d\d)?\b/g)) values.add(match[0]);
  return Array.from(values);
}

function allowedTimestampFragments(contract: LinuxNarrativeContract, task?: LinuxNarrativeTaskContract) {
  const values = new Set([...(task?.allowedTimestamps || []), ...contract.globalAllowedTimestamps]);
  values.add(contract.scenarioFraming.incidentWindow);
  for (const value of Array.from(values)) {
    const match = value.match(/\b\d\d:\d\d(?::\d\d)?\b/g);
    for (const item of match || []) values.add(item);
    values.add(value.replace("T", " ").replace(/Z$/, ""));
  }
  return values;
}

function claimClass(value: unknown): LinuxNarrativeClaimClass | "" {
  return ["observed", "historical_state", "current_state", "bounded_inference", "recommendation"].includes(String(value))
    ? String(value) as LinuxNarrativeClaimClass
    : "";
}

function taskAllowsCurrentState(task: LinuxNarrativeTaskContract) {
  return task.requiredCapabilities.some((capability) => currentStateCapabilities.has(capability));
}

function taskRelationshipKeys(task: LinuxNarrativeTaskContract) {
  return new Set(task.groundedRelationships.map((relation) => `${relation.relation}:${relation.subjectIds.join("|")}`));
}

function normalizedRelationshipKey(relation: { relation?: string; subject_ids?: string[] }) {
  return `${relation.relation || ""}:${(relation.subject_ids || []).join("|")}`;
}

function validateTaskStructure(
  contract: LinuxNarrativeContract,
  tasks: LinuxGeneratedTaskForContract[],
  issues: LinuxNarrativeContractIssue[]
) {
  if (tasks.length !== contract.canonicalTaskCount) {
    issue(issues, "LINUX_NARRATIVE_TASK_COUNT_MISMATCH", `Narrative returned ${tasks.length} tasks; contract requires ${contract.canonicalTaskCount}.`);
  }
  const contractById = new Map(contract.taskContracts.map((task) => [task.taskId, task]));
  const seen = new Set<string>();
  for (const [index, task] of tasks.entries()) {
    const expected = contract.taskContracts[index];
    const taskId = task.task_id || "";
    if (!taskId) {
      issue(issues, "LINUX_NARRATIVE_TASK_MISSING", `Task ${index + 1} is missing canonical task_id.`, { field: "task_id" });
      continue;
    }
    if (seen.has(taskId)) {
      issue(issues, "LINUX_NARRATIVE_TASK_DUPLICATE", `Task ${taskId} appears more than once.`, { taskId });
    }
    seen.add(taskId);
    const actualContract = contractById.get(taskId);
    if (!actualContract) {
      issue(issues, "LINUX_NARRATIVE_TASK_UNKNOWN", `Task ${taskId} is not in the narrative contract.`, { taskId });
      continue;
    }
    if (expected && expected.taskId !== taskId) {
      issue(issues, "LINUX_NARRATIVE_TASK_ORDER_MISMATCH", `Task ${taskId} appears at order ${index + 1}; expected ${expected.taskId}.`, { taskId });
    }
    if (task.task_intent !== actualContract.intent) {
      issue(issues, "LINUX_NARRATIVE_INTENT_MISMATCH", `Task ${taskId} changed intent from ${actualContract.intent} to ${task.task_intent || "missing"}.`, { taskId });
    }
  }
  for (const expected of contract.taskContracts) {
    if (!seen.has(expected.taskId)) {
      issue(issues, "LINUX_NARRATIVE_TASK_MISSING", `Task ${expected.taskId} is missing from generated narrative.`, { taskId: expected.taskId });
    }
  }
}

function validateEvidence(contract: LinuxNarrativeContract, task: LinuxGeneratedTaskForContract, taskContract: LinuxNarrativeTaskContract, issues: LinuxNarrativeContractIssue[]) {
  const selected = exactPathSet(taskContract.selectedEvidence.map((asset) => asset.path));
  const rendered = exactPathSet(contract.globalRenderedEvidencePaths);
  const references = new Set([
    ...(task.evidence || []).map(normalizeLinuxEvidencePath),
    ...extractEvidencePaths(taskText(task)),
    ...(task.claims || []).flatMap((claim) => claim.supporting_evidence || []).map(normalizeLinuxEvidencePath),
  ]);
  for (const ref of references) {
    if (!rendered.has(ref)) {
      issue(issues, "LINUX_NARRATIVE_UNRENDERED_EVIDENCE", `Evidence ${ref} is not rendered in the contract.`, { taskId: taskContract.taskId, evidence: ref });
      continue;
    }
    if (!selected.has(ref)) {
      issue(issues, "LINUX_NARRATIVE_EVIDENCE_OUTSIDE_CONTRACT", `Evidence ${ref} is not selected for ${taskContract.taskId}.`, { taskId: taskContract.taskId, evidence: ref });
    }
  }
}

function validateClaims(contract: LinuxNarrativeContract, task: LinuxGeneratedTaskForContract, taskContract: LinuxNarrativeTaskContract, issues: LinuxNarrativeContractIssue[]) {
  const allowedSubjects = new Set(taskContract.groundedSubjects.map((subject) => subject.id));
  const relationshipKeys = taskRelationshipKeys(taskContract);
  const allowedTimes = allowedTimestampFragments(contract, taskContract);
  const selectedEvidence = exactPathSet(taskContract.selectedEvidence.map((asset) => asset.path));
  const claims = task.claims || [];
  if (claims.length === 0) {
    issue(issues, "LINUX_NARRATIVE_UNBOUNDED_INFERENCE", `Task ${taskContract.taskId} has no classified claims for contract validation.`, { taskId: taskContract.taskId, field: "claims" });
  }
  for (const claim of claims) {
    const klass = claimClass(claim.claim_class);
    const text = String(claim.text || "");
    if (!klass) {
      issue(issues, "LINUX_NARRATIVE_UNBOUNDED_INFERENCE", "Claim is missing a supported claim_class.", { taskId: taskContract.taskId, field: "claim_class" });
      continue;
    }
    const supporting = (claim.supporting_evidence || []).map(normalizeLinuxEvidencePath);
    if ((klass === "observed" || klass === "historical_state" || klass === "current_state") && supporting.length === 0) {
      issue(issues, klass === "current_state" ? "LINUX_NARRATIVE_UNSUPPORTED_CURRENT_STATE" : "LINUX_NARRATIVE_UNSUPPORTED_HISTORICAL_STATE", `${klass} claim has no supporting evidence.`, { taskId: taskContract.taskId });
    }
    for (const evidencePath of supporting) {
      if (!selectedEvidence.has(evidencePath)) {
        issue(issues, "LINUX_NARRATIVE_EVIDENCE_OUTSIDE_CONTRACT", `Claim supports itself with ${evidencePath}, which is outside ${taskContract.taskId}.`, { taskId: taskContract.taskId, evidence: evidencePath });
      }
    }
    for (const subject of claim.subjects || []) {
      if (!allowedSubjects.has(subject)) {
        issue(issues, "LINUX_NARRATIVE_UNKNOWN_SUBJECT", `Claim references subject ${subject}, which is outside ${taskContract.taskId}.`, { taskId: taskContract.taskId, evidence: subject });
      }
    }
    for (const relation of claim.relationships || []) {
      const key = normalizedRelationshipKey(relation);
      if (!relationshipKeys.has(key)) {
        issue(issues, "LINUX_NARRATIVE_UNSUPPORTED_RELATIONSHIP", `Claim references unsupported relationship ${key}.`, { taskId: taskContract.taskId, evidence: key });
      }
    }
    for (const value of [...timestampTokens(text), ...(claim.timestamps || [])]) {
      const normalized = value.replace("T", " ").replace(/Z$/, "");
      if (!allowedTimes.has(normalized)) {
        issue(issues, "LINUX_NARRATIVE_INVENTED_TIMESTAMP", `Claim references timestamp ${value}, which is outside the contract.`, { taskId: taskContract.taskId, evidence: value });
      }
    }
    if (klass === "current_state" && !taskAllowsCurrentState(taskContract)) {
      issue(issues, "LINUX_NARRATIVE_UNSUPPORTED_CURRENT_STATE", `Task ${taskContract.taskId} does not permit current-state claims.`, { taskId: taskContract.taskId });
    }
    if (klass === "bounded_inference" && unsupportedConclusionPattern.test(text)) {
      issue(issues, "LINUX_NARRATIVE_UNBOUNDED_INFERENCE", "Inference exceeds bounded inference rules.", { taskId: taskContract.taskId, evidence: text.slice(0, 160) });
    }
    if (klass === "recommendation" && unsupportedConclusionPattern.test(text)) {
      issue(issues, "LINUX_NARRATIVE_UNSUPPORTED_RECOMMENDATION", "Recommendation exceeds task scope.", { taskId: taskContract.taskId, evidence: text.slice(0, 160) });
    }
  }
}

function validateGlobalText(contract: LinuxNarrativeContract, narrative: LinuxGeneratedNarrativeForContract, issues: LinuxNarrativeContractIssue[]) {
  const text = narrativeText(narrative);
  if (internalPattern.test(text)) {
    issue(issues, "LINUX_NARRATIVE_INTERNAL_DETAIL_LEAK", "Narrative exposes internal canonical identifiers or relation keys.");
  }
  if (localPathPattern.test(text)) {
    issue(issues, "LINUX_NARRATIVE_LOCAL_PATH_LEAK", "Narrative exposes a local filesystem or source-code path.");
  }
  const allowedTimes = allowedTimestampFragments(contract);
  for (const value of timestampTokens(text)) {
    const normalized = value.replace("T", " ").replace(/Z$/, "");
    if (!allowedTimes.has(normalized)) {
      issue(issues, "LINUX_NARRATIVE_INVENTED_TIMESTAMP", `Narrative references timestamp ${value}, which is outside the contract.`, { evidence: value });
    }
  }
  for (const path of extractEvidencePaths(text)) {
    if (contract.difficulty !== "Advanced" && !contract.globalRenderedEvidencePaths.includes(path)) {
      issue(issues, "LINUX_NARRATIVE_ADVANCED_LEAK", `Narrative references evidence ${path}, which is prohibited by this contract.`, { evidence: path });
    }
  }
  const lowerText = text.toLowerCase();
  for (const capability of contract.prohibitedCapabilityClaims) {
    const label = capability.replace(/_/g, " ");
    if (lowerText.includes(label)) {
      issue(issues, "LINUX_NARRATIVE_PROHIBITED_CAPABILITY", `Narrative references prohibited capability ${capability}.`, { evidence: capability });
    }
  }
}

export function validateLinuxGeneratedNarrativeAgainstContract(
  contract: LinuxNarrativeContract,
  narrative: LinuxGeneratedNarrativeForContract
): LinuxNarrativeContractValidationResult {
  const issues: LinuxNarrativeContractIssue[] = [];
  const tasks = Array.isArray(narrative.tasks) ? narrative.tasks : [];
  validateTaskStructure(contract, tasks, issues);
  const contractById = new Map(contract.taskContracts.map((task) => [task.taskId, task]));
  for (const task of tasks) {
    const taskContract = task.task_id ? contractById.get(task.task_id) : undefined;
    if (!taskContract) continue;
    validateEvidence(contract, task, taskContract, issues);
    validateClaims(contract, task, taskContract, issues);
  }
  validateGlobalText(contract, narrative, issues);
  return {
    passed: issues.length === 0,
    issues,
    metrics: {
      unknownSubjectCount: issues.filter((item) => item.code === "LINUX_NARRATIVE_UNKNOWN_SUBJECT").length,
      unsupportedRelationshipCount: issues.filter((item) => item.code === "LINUX_NARRATIVE_UNSUPPORTED_RELATIONSHIP").length,
      inventedTimestampCount: issues.filter((item) => item.code === "LINUX_NARRATIVE_INVENTED_TIMESTAMP").length,
      unsupportedCurrentStateCount: issues.filter((item) => item.code === "LINUX_NARRATIVE_UNSUPPORTED_CURRENT_STATE").length,
      unrenderedEvidenceCount: issues.filter((item) => item.code === "LINUX_NARRATIVE_UNRENDERED_EVIDENCE").length,
    },
  };
}

export function linuxNarrativeContractRetryFeedback(result: LinuxNarrativeContractValidationResult) {
  return buildLinuxSafeRetryFeedback({
    categories: linuxRetryFeedbackCategoriesFromNarrativeIssueCodes(result.issues.map((item) => item.code)),
    scope: "narrative",
  });
}
