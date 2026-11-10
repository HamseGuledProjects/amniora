#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { fullSubmission, prohibitedConclusionFor } = require("./linuxPhase10AssessmentTestUtils");
const { extractionFromSubmission } = require("./linuxPhase11GradingTestUtils");

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
const SEEDS = ["a", "b", "c", "d", "e"];

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-universal-solvability-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildCandidate(buildLinuxAssetCandidate, family, difficulty, seedSuffix = "base") {
  let lastError;
  for (let attempt = 0; attempt < 420; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        seed: `universal-solvability:${family}:${difficulty}:${seedSuffix}:${attempt}`,
        generationTime: "2026-07-29T08:00:00.000Z",
        category: "Linux",
        difficulty,
        duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
        title: "Amniora Linux universal solvability",
      }, { incidentFamily: family });
      if (candidate.assetQuality?.passed) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing asset ${filePath}`);
  return found;
}

function replaceAsset(assets, filePath, content) {
  return assets.map((item) => item.file_path === filePath ? { ...item, content } : item);
}

function registryAsset(candidate, filePath) {
  const found = candidate.simulation.evidenceRegistry.find((item) => item.path === filePath);
  if (!found) throw new Error(`missing registry asset ${filePath}`);
  return found;
}

function taskByIntent(candidate, intent) {
  const found = candidate.simulation.canonicalTasks.find((item) => item.intent === intent);
  if (!found) throw new Error(`missing task ${intent}`);
  return found;
}

function selectedPaths(candidate, task) {
  return task.selectedEvidenceAssetIds
    .map((id) => candidate.simulation.evidenceRegistry.find((item) => item.id === id)?.path)
    .filter(Boolean);
}

function studentTask(candidate, task, evidence = selectedPaths(candidate, task), deliverable = "Prepare an evidence-backed answer using only the listed evidence and state any evidence gap.") {
  return {
    phase: task.stepLabel || task.intent.replace(/_/g, " "),
    title: `${task.suggestedVerb || "Review"} ${task.stepLabel || task.intent.replace(/_/g, " ")}.`,
    evidence,
    deliverable,
  };
}

function labFromCanonical(candidate) {
  return {
    title: `Linux investigation for ${candidate.investigation.hostname}`,
    objective: `Review task-local evidence for ${candidate.investigation.hostname} during the stated incident window.`,
    scenario: `${candidate.investigation.company} SOC is reviewing a ${candidate.investigation.hostRole} with task-specific evidence restrictions.`,
    tasks: candidate.simulation.canonicalTasks
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((task) => studentTask(candidate, task)),
    outcomes: ["Produce bounded conclusions from task-local evidence."],
    category: "Linux",
    difficulty: candidate.investigation.difficulty,
    duration: candidate.investigation.duration,
  };
}

function validateLab(validateLinuxStudentTaskSolvability, candidate, assets = candidate.assets, lab = labFromCanonical(candidate)) {
  return validateLinuxStudentTaskSolvability({
    simulation: candidate.simulation,
    finalAssets: assets,
    lab,
  });
}

function withTaskEvidence(candidate, task, evidencePaths) {
  const copy = clone(candidate);
  const index = copy.simulation.canonicalTasks.findIndex((item) => item.id === task.id);
  if (index < 0) throw new Error(`missing task ${task.id}`);
  copy.simulation.canonicalTasks[index].selectedEvidenceAssetIds = evidencePaths.map((evidencePath) => registryAsset(copy, evidencePath).id);
  return {
    candidate: copy,
    task: copy.simulation.canonicalTasks[index],
  };
}

function rewriteUserRow(usersCsv, username, replacementCells) {
  return usersCsv.split(/\r?\n/).map((line, index) => {
    if (index === 0 || !line.startsWith(`${username},`)) return line;
    const cells = line.split(",");
    Object.entries(replacementCells).forEach(([columnIndex, value]) => {
      cells[Number(columnIndex)] = value;
    });
    return cells.join(",");
  }).join("\n");
}

function proveTask(proveLinuxStudentTaskSolvability, candidate, task, evidence, deliverable, assets = candidate.assets) {
  return proveLinuxStudentTaskSolvability({
    simulation: candidate.simulation,
    task,
    taskIndex: task.order - 1,
    studentTask: studentTask(candidate, task, evidence, deliverable),
    finalAssets: assets,
  });
}

function issueText(result) {
  return JSON.stringify(result.issues || []);
}

function subjectSurfaceTokens(simulation, subjectId) {
  const tokens = [];
  const identity = simulation.identities.find((item) => item.id === subjectId);
  if (identity) tokens.push(identity.username, String(identity.uid));
  const session = simulation.sshSessions.find((item) => item.id === subjectId);
  if (session) tokens.push(session.username, session.sourceIp, String(session.sourcePort), String(session.monitorPid), String(session.sessionPid));
  const command = simulation.commands.find((item) => item.id === subjectId);
  if (command) tokens.push(command.renderedCommand, command.executable, ...(command.argv || []), String(command.processId));
  const process = simulation.processes.find((item) => item.id === subjectId);
  if (process) tokens.push(String(process.pid), String(process.ppid), process.executable, ...(process.argv || []));
  const file = simulation.files.find((item) => item.id === subjectId);
  if (file) tokens.push(file.path);
  const service = simulation.services.find((item) => item.id === subjectId);
  if (service) tokens.push(service.unitName, service.unitName.replace(/\.service$/, ""));
  const cron = simulation.cronDefinitions.find((item) => item.id === subjectId);
  if (cron) tokens.push(cron.sourcePath, cron.schedule);
  const scheduled = simulation.scheduledExecutions.find((item) => item.id === subjectId);
  if (scheduled) tokens.push(scheduled.occurredAt);
  const transaction = simulation.packageTransactions.find((item) => item.id === subjectId);
  if (transaction) tokens.push(...transaction.packages.map((pkg) => pkg.name), transaction.startedAt);
  const maintenance = simulation.maintenanceActivities.find((item) => item.id === subjectId);
  if (maintenance) tokens.push(maintenance.changeId || "", maintenance.ticketId || "", maintenance.title);
  if (subjectId.startsWith("package-subject:")) tokens.push(subjectId.replace(/^package-subject:/, ""));
  return Array.from(new Set(tokens.filter((token) => token && token.length >= 2)));
}

function valueSurfaceTokens(simulation, value) {
  if (!value || typeof value !== "object") return [];
  if (value.kind === "relationship") {
    return [
      ...subjectSurfaceTokens(simulation, value.sourceId || ""),
      ...subjectSurfaceTokens(simulation, value.targetId || ""),
      value.relation,
    ].filter(Boolean);
  }
  const tokens = [];
  for (const [key, raw] of Object.entries(value)) {
    if (key === "kind") continue;
    if (Array.isArray(raw)) tokens.push(...raw.map(String));
    else if (typeof raw === "string" || typeof raw === "number") tokens.push(String(raw));
  }
  return Array.from(new Set(tokens.filter((token) =>
    token &&
    token.length >= 2 &&
    !/^[-_a-z]+:\S+/i.test(token) &&
    !/^requires_/i.test(token) &&
    !/^(?:historical_reconstruction|collection_snapshot|static_policy|incident_window)$/i.test(token)
  )));
}

function selectedEvidenceText(candidate, contract) {
  const allowed = new Set(contract.evidenceRequirements.flatMap((requirement) => requirement.evidencePaths));
  return candidate.assets
    .filter((item) => allowed.has(item.file_path))
    .map((item) => `${item.file_path}\n${item.content}`)
    .join("\n");
}

function constructedLearnerAnswer(contract) {
  const paths = Array.from(new Set(contract.evidenceRequirements.flatMap((requirement) => requirement.evidencePaths))).join(", ");
  const findingCount = contract.requiredFindings.length;
  const uncertainty = contract.uncertaintyRequirements.length ? " It states supported uncertainty boundaries without overclaiming." : "";
  const remediation = contract.remediationRequirements.length ? " It proposes evidence-supported containment, remediation and validation steps." : "";
  return `The answer uses only task-local evidence: ${paths}. It reports ${findingCount} supported finding${findingCount === 1 ? "" : "s"} with cited task evidence and bounded confidence.${uncertainty}${remediation}`;
}

async function gradeConstructedAnswer(freeForm, schema, contract) {
  const submission = fullSubmission(contract);
  const extraction = extractionFromSubmission(schema, submission);
  return freeForm.gradeLinuxFreeFormAssessment({
    contract,
    learnerAnswer: constructedLearnerAnswer(contract),
    rawExtractionObject: extraction,
    renderedEvidencePaths: Array.from(new Set(contract.evidenceRequirements.flatMap((requirement) => requirement.evidencePaths))),
    modelConfigurationId: "offline-universal-solvability",
    attempt: 1,
    createdAt: "2026-07-29T08:00:00.000Z",
  });
}

function mutateFirstValue(submission) {
  const mutated = clone(submission);
  for (const claim of mutated.claims || []) mutateClaimValue(claim);
  return mutated;
}

function mutateClaimValue(claim) {
  if (!claim) return;
  claim.value = { kind: "identity", username: "not-the-evidence-subject", uid: 99999 };
}

function mutateEvidenceReference(submission) {
  const mutated = clone(submission);
  for (const claim of mutated.claims || []) {
    for (const citation of claim.evidence || []) citation.path = "assets/logs/not-task-local.log";
  }
  return mutated;
}

function mutateProhibitedConclusion(contract, submission) {
  const mutated = clone(submission);
  const prohibited = contract.prohibitedClaims[0];
  if (mutated.claims?.[0] && prohibited) {
    mutated.claims[0].confidence = "certain";
    mutated.claims[0].conclusions = [
      {
        kind: prohibitedConclusionFor(prohibited.id),
        confidence: "certain",
      },
    ];
  }
  return mutated;
}

function mutateRelationship(submission) {
  const mutated = clone(submission);
  for (const claim of mutated.claims || []) {
    if (claim.relationship) claim.relationship = { ...claim.relationship, relation: "wrong_relation" };
    if (claim.value?.kind === "relationship") claim.value = { ...claim.value, sourceId: claim.value.targetId, targetId: claim.value.sourceId };
  }
  return mutated;
}

function mutationScore(assessment, contract, submission) {
  return assessment.scoreLinuxStructuredAssessmentSubmission(contract, submission);
}

function hiddenTokensAbsent(answer) {
  return !/\b(?:canonical|contract|findingId|subjectId|capability_key|assessmentContractHash|prompt|model response)\b/i.test(answer);
}

function assertValueEvidenceGrounding(candidate, contract, label) {
  const evidence = selectedEvidenceText(candidate, contract);
  for (const finding of contract.requiredFindings) {
    const tokens = valueSurfaceTokens(candidate.simulation, finding.expectedValue);
    const grounded = tokens.filter((token) => tokenGroundedInEvidence(token, evidence));
    assert(`${label} finding ${finding.id} exposes at least one expected value in task evidence`, grounded.length > 0 || tokens.length === 0, JSON.stringify({ value: finding.expectedValue, tokens }));
  }
}

function tokenGroundedInEvidence(token, evidence) {
  if (evidence.includes(token) || token.length < 4) return true;
  if (/^unapproved$/i.test(token)) return /\b(?:not approved|unapproved|requires validation|approval gap)\b/i.test(evidence);
  if (/^approved$/i.test(token)) return /\bapproved\b/i.test(evidence);
  return false;
}

async function run() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    validateLinuxStudentTaskSolvability,
    proveLinuxStudentTaskSolvability,
  } = require(path.join(out, "linux", "taskSolvability.js"));
  const { buildLinuxAssessmentPackage, scoreLinuxStructuredAssessmentSubmission } = require(path.join(out, "linux", "assessmentContract.js"));
  const schema = require(path.join(out, "linux", "assessmentExtractionSchema.js"));
  const freeForm = require(path.join(out, "linux", "freeFormAssessment.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));

  const totals = {
    labs: 0,
    tasks: 0,
    constructedLearnerAnswers: 0,
    correctlyGradedAnswers: 0,
    negativeMutations: 0,
    rejectedContradictions: 0,
    ambiguityChecks: 0,
  };
  const diversity = {
    taskIntentOrders: new Set(),
    evidenceCombinations: new Set(),
    deliverableFormats: new Set(),
  };

  for (const family of FAMILIES) {
    for (const difficulty of DIFFICULTIES) {
      for (const seedSuffix of SEEDS) {
        const label = `${family}/${difficulty}/${seedSuffix}`;
        const candidate = buildCandidate(buildLinuxAssetCandidate, family, difficulty, seedSuffix);
        const result = validateLab(validateLinuxStudentTaskSolvability, candidate);
        assert(`${label} every task is learner-solvable from task-local evidence`, result.passed, issueText(result));
        const assessmentPackage = buildLinuxAssessmentPackage({ simulation: candidate.simulation, assets: candidate.assets });
        assert(`${label} has one grading contract per task`, assessmentPackage.contracts.length === candidate.simulation.canonicalTasks.length);
        totals.labs += 1;
        totals.tasks += candidate.simulation.canonicalTasks.length;
        diversity.taskIntentOrders.add(candidate.simulation.canonicalTasks.map((task) => task.intent).join(">"));
        for (const contract of assessmentPackage.contracts) {
          const task = candidate.simulation.canonicalTasks.find((item) => item.id === contract.taskId);
          assert(`${label}/${contract.taskId} task exists for contract`, Boolean(task));
          assertValueEvidenceGrounding(candidate, contract, `${label}/${contract.taskId}`);
          const answer = constructedLearnerAnswer(contract);
          assert(`${label}/${contract.taskId} constructed answer contains no hidden contract language`, hiddenTokensAbsent(answer), answer);
          const grade = await gradeConstructedAnswer(freeForm, schema, contract);
          totals.constructedLearnerAnswers += 1;
          assert(`${label}/${contract.taskId} constructed answer grades successfully`, grade.status === "graded", JSON.stringify(grade.diagnostics || []));
          assert(`${label}/${contract.taskId} constructed answer receives full expected credit`, grade.scoreReport.score === contract.scoring.maximumPoints, JSON.stringify(grade.scoreReport));
          totals.correctlyGradedAnswers += 1;

          const full = fullSubmission(contract);
          const fullScore = scoreLinuxStructuredAssessmentSubmission(contract, full);
          const relationshipIsScored = (fullScore.componentScores || []).some((component) => component.relationshipPoints > 0);
          const mutations = [
            ["wrong value", mutateFirstValue(full)],
            ["wrong evidence", mutateEvidenceReference(full)],
          ];
          if (relationshipIsScored) mutations.push(["wrong relationship", mutateRelationship(full)]);
          if (contract.prohibitedClaims.length > 0) {
            mutations.push(["prohibited conclusion", mutateProhibitedConclusion(contract, full)]);
          }
          for (const [mutationLabel, mutated] of mutations) {
            const score = mutationScore({ scoreLinuxStructuredAssessmentSubmission }, contract, mutated);
            totals.negativeMutations += 1;
            assert(`${label}/${contract.taskId} mutation loses credit: ${mutationLabel}`, score.score < fullScore.score || score.penalties > fullScore.penalties, JSON.stringify({ mutationLabel, score, fullScore }));
            if (/wrong value|wrong relationship|unsupported certainty/.test(mutationLabel)) totals.rejectedContradictions += 1;
          }
          if (contract.uncertaintyRequirements.length > 0 && fullScore.uncertaintyPoints > 0) {
            const noUncertainty = clone(full);
            noUncertainty.uncertaintyAssertions = [];
            const score = scoreLinuxStructuredAssessmentSubmission(contract, noUncertainty);
            totals.ambiguityChecks += 1;
            assert(`${label}/${contract.taskId} missing required uncertainty loses credit`, score.score < fullScore.score, JSON.stringify({ score, fullScore }));
          }
          if (task) {
            diversity.evidenceCombinations.add(selectedPaths(candidate, task).sort().join("|"));
            diversity.deliverableFormats.add(`${task.expectedDeliverableType}:${task.intent}`);
          }
        }
      }
    }
  }

  assert("expanded matrix covers 11 families x 3 difficulties x 5 seeds", totals.labs === 165, JSON.stringify(totals));
  assert("task intent ordering diversity is non-cosmetic", diversity.taskIntentOrders.size >= 25, String(diversity.taskIntentOrders.size));
  assert("task-local evidence combinations vary across matrix", diversity.evidenceCombinations.size >= 35, String(diversity.evidenceCombinations.size));
  assert("deliverable formats vary across matrix", diversity.deliverableFormats.size >= 18, String(diversity.deliverableFormats.size));

  const serviceCandidate = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse", "Beginner", "production-shape");
  assert("service-account misuse primary actor is one of the canonical service accounts", serviceCandidate.investigation.serviceAccounts.includes(serviceCandidate.investigation.primaryUser), JSON.stringify(serviceCandidate.investigation));
  const actorTask = taskByIntent(serviceCandidate, "actor_attribution");
  const serviceUser = serviceCandidate.investigation.primaryUser;
  const serviceUserCsv = asset(serviceCandidate, "assets/csv/users.csv").content;
  const mislabeledHumanUsers = rewriteUserRow(serviceUserCsv, serviceUser, {
    1: "business user",
    4: "active",
    12: "human",
  });
  const humanLabelProof = proveTask(
    proveLinuxStudentTaskSolvability,
    serviceCandidate,
    actorTask,
    selectedPaths(serviceCandidate, actorTask),
    "Identify the service account and compare expected service-account use with the observed login.",
    replaceAsset(serviceCandidate.assets, "assets/csv/users.csv", mislabeledHumanUsers)
  );
  assert("service account mislabeled as human is rejected", /LINUX_TASK_IDENTITY_CLASSIFICATION_MISMATCH/.test(issueText(humanLabelProof)), issueText(humanLabelProof));

  const noIdentityAuthorityProof = proveTask(
    proveLinuxStudentTaskSolvability,
    serviceCandidate,
    actorTask,
    ["assets/logs/auth.log"],
    "Identify the service account and compare expected service-account use with observed SSH activity."
  );
  assert("expected service-account comparison without account baseline is rejected", /LINUX_TASK_EXPECTED_STATE_BASELINE_MISSING|LINUX_TASK_GLOBAL_ONLY_EVIDENCE/.test(issueText(noIdentityAuthorityProof)), issueText(noIdentityAuthorityProof));

  const riskOnly = withTaskEvidence(serviceCandidate, actorTask, ["assets/logs/auth.log", "assets/evidence/risk_register.csv"]);
  const riskOnlyProof = proveTask(
    proveLinuxStudentTaskSolvability,
    riskOnly.candidate,
    riskOnly.task,
    ["assets/logs/auth.log", "assets/evidence/risk_register.csv"],
    "Identify the service account and compare expected service-account use with observed SSH activity."
  );
  assert("risk register alone cannot prove service-account expected use", /LINUX_TASK_EXPECTED_STATE_BASELINE_MISSING/.test(issueText(riskOnlyProof)), issueText(riskOnlyProof));

  const advancedService = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse", "Advanced", "risk-contradiction");
  const advancedActorTask = taskByIntent(advancedService, "actor_attribution");
  const advancedUser = advancedService.investigation.primaryUser;
  const advancedUsers = rewriteUserRow(asset(advancedService, "assets/csv/users.csv").content, advancedUser, {
    1: "business user",
    4: "active",
    12: "human",
  });
  const riskPath = advancedService.assets.some((item) => item.file_path === "assets/evidence/advanced_risk_register.csv")
    ? "assets/evidence/advanced_risk_register.csv"
    : "assets/evidence/risk_register.csv";
  const riskContent = `risk_id,subject,classification,concern\nRISK-TEST,${advancedUser},service-account login,service-account login from unusual source requires validation\n`;
  const riskFixture = withTaskEvidence(advancedService, advancedActorTask, ["assets/csv/users.csv", riskPath]);
  const riskContradictionProof = proveTask(
    proveLinuxStudentTaskSolvability,
    riskFixture.candidate,
    riskFixture.task,
    ["assets/csv/users.csv", riskPath],
    "Identify whether the risk register proves service-account use or conflicts with authoritative identity evidence.",
    replaceAsset(replaceAsset(advancedService.assets, "assets/csv/users.csv", advancedUsers), riskPath, riskContent)
  );
  assert("risk register cannot override contradictory primary identity evidence", /LINUX_TASK_RISK_PRIMARY_EVIDENCE_CONTRADICTION|LINUX_TASK_IDENTITY_CLASSIFICATION_MISMATCH/.test(issueText(riskContradictionProof)), issueText(riskContradictionProof));

  const qualityLab = labFromCanonical(serviceCandidate);
  qualityLab.tasks[actorTask.order - 1] = {
    ...qualityLab.tasks[actorTask.order - 1],
    deliverable: "Identify the service account and compare expected service-account use with the observed login.",
  };
  const qualityResult = checkLinuxFinalProductionQuality({
    context: serviceCandidate.investigation,
    assets: replaceAsset(serviceCandidate.assets, "assets/csv/users.csv", mislabeledHumanUsers),
    simulation: serviceCandidate.simulation,
    lab: qualityLab,
  });
  assert("final quality blocks service-account identity contradiction", !qualityResult.passed && /LINUX_TASK_IDENTITY_CLASSIFICATION_MISMATCH/.test(JSON.stringify(qualityResult.issues)), JSON.stringify(qualityResult.issues));

  console.log(JSON.stringify({
    passed: true,
    totals,
    diversity: {
      taskIntentOrders: diversity.taskIntentOrders.size,
      evidenceCombinations: diversity.evidenceCombinations.size,
      deliverableFormats: diversity.deliverableFormats.size,
      thresholds: {
        taskIntentOrders: 25,
        evidenceCombinations: 35,
        deliverableFormats: 18,
      },
    },
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
