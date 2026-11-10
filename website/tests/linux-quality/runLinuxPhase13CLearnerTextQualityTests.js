#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

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
  const build = path.join(os.tmpdir(), `amniora-linux-phase13c-${Date.now()}`);
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

function buildCandidate(buildLinuxAssetCandidate, family, difficulty) {
  let lastError;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        seed: `phase13c:${family}:${difficulty}:${attempt}`,
        generationTime: "2026-08-12T10:00:00.000Z",
        category: "Linux",
        difficulty,
        duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
        title: "Amniora Linux Phase 13C",
      }, { incidentFamily: family });
      if (candidate.assetQuality?.passed) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function modelTasks(contract, deliverable = "The model supplied a rough wording draft that should not control required output.") {
  return contract.taskContracts.map((task, index) => ({
    task_id: task.taskId,
    task_intent: task.intent,
    phase: `Task ${index + 1}`,
    title: `Model draft for ${task.intent.replace(/_/g, " ")}`,
    evidence: task.selectedEvidence.map((asset) => asset.path).slice(0, 3),
    deliverable,
    claims: [{
      claim_class: "observed",
      text: task.allowedHistoricalFacts[0] || task.objective,
      supporting_evidence: task.selectedEvidence.map((asset) => asset.path).slice(0, 1),
      subjects: [],
      relationships: [],
      timestamps: [],
    }],
  }));
}

function assemble(modules, candidate, difficulty, deliverable) {
  const contract = modules.buildLinuxNarrativeContract(candidate.simulation, candidate.assets.map((asset) => asset.file_path));
  const assembled = modules.buildLinuxAssembledNarrative({
    contract,
    context: candidate.investigation,
    difficulty,
    duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
    tasks: modelTasks(contract, deliverable),
  });
  return {
    contract,
    assembled,
    lab: modules.finalLinuxNarrativeFromAssembled({ lab: assembled }),
  };
}

function learnerFields(lab) {
  const fields = [
    ["title", lab.title],
    ["objective", lab.objective],
    ["scenario", lab.scenario],
    ...((lab.hints || []).map((value, index) => [`hints[${index}]`, value])),
    ...((lab.outcomes || lab.learningOutcomes || []).map((value, index) => [`outcomes[${index}]`, value])),
  ];
  for (const [index, task] of (lab.tasks || []).entries()) {
    fields.push([`tasks[${index}].title`, task.title]);
    fields.push([`tasks[${index}].description`, task.description]);
    fields.push([`tasks[${index}].deliverable`, task.deliverable]);
  }
  return fields;
}

function labWithBadField(candidate, fieldValue) {
  return {
    title: `Linux service evidence review for ${candidate.investigation.hostname}`,
    objective: `Review supplied evidence for ${candidate.investigation.hostname} during ${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone}.`,
    scenario: `${candidate.investigation.company} analysts are reviewing ${candidate.investigation.hostname}, a ${candidate.investigation.hostRole}, for ticket ${candidate.investigation.ticketId}.`,
    tasks: candidate.simulation.canonicalTasks.slice(0, 3).map((task, index) => ({
      phase: `Task ${index + 1}`,
      title: `Review ${task.intent.replace(/_/g, " ")} evidence.`,
      description: `Review ${task.intent.replace(/_/g, " ")} evidence.`,
      evidence: task.selectedEvidenceAssetIds
        .map((id) => candidate.simulation.evidenceRegistry.find((asset) => asset.id === id)?.path)
        .filter(Boolean)
        .slice(0, 3),
      deliverable: index === 0 ? fieldValue : "Write a concise evidence note using only the listed evidence.",
    })),
    hints: ["Use only the listed task evidence.", "Keep timestamps inside the review window.", "Separate facts from uncertainty."],
    outcomes: ["Write evidence-backed Linux findings.", "Document uncertainty clearly.", "Avoid unsupported conclusions."],
    duration: "30 mins",
    category: "Linux",
    difficulty: "Beginner",
  };
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxNarrativeContract } = require(path.join(out, "linux", "simulation.js"));
  const {
    buildLinuxAssembledNarrative,
    finalLinuxNarrativeFromAssembled,
    allLinuxLearnerRequirementKinds,
    renderLinuxLearnerRequirementSentence,
  } = require(path.join(out, "linux", "narrativeAssembly.js"));
  const { validateLinuxStudentNarrativeIntegrity, linuxNarrativeTextHygieneReason } = require(path.join(out, "linux", "narrativeIntegrity.js"));
  const { checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const { validateLinuxIncidentCoverage } = require(path.join(out, "linux", "incidentCoverage.js"));
  const { validateLinuxTaskDiversity } = require(path.join(out, "linux", "taskDiversity.js"));
  const { checkLinuxLabWorkload } = require(path.join(out, "linux", "workloadCalibration.js"));
  const { assertLinuxStudentContent } = require(path.join(out, "linux", "studentContentValidation.js"));

  const modules = { buildLinuxNarrativeContract, buildLinuxAssembledNarrative, finalLinuxNarrativeFromAssembled };
  const invalid = [
    ["truncated path", "Compare command output for /usr"],
    ["bare Include template", "Include: compare service baseline."],
    ["malformed that clause", "Include a sentence that narrow sudo rule validation steps."],
    ["that plus bare verb", "Include a note that compare privileged command evidence."],
    ["mechanical Also identify", "Also identify account."],
    ["mechanical It should check", "It should check business need."],
    ["mechanical Also compare", "Also compare privileged command."],
    ["mechanical where relevant describe", "Where relevant, include describe account activity."],
    ["mechanical where relevant compare", "Where relevant, include compare privileged command."],
    ["mechanical where relevant identify", "Where relevant, include identify account."],
    ["mechanical include check", "Include check business need."],
    ["mechanical include map", "Include map sudo policy."],
    ["mechanical Also describe", "Also describe account activity."],
    ["double punctuation", "Write the validation.."],
    ["missing final punctuation", "Write a concise evidence note"],
    ["dangling and", "Write a concise evidence note and"],
    ["dangling or", "Write a concise evidence note or"],
    ["dangling for", "Write a concise evidence note for"],
    ["dangling from", "Write a concise evidence note from"],
    ["dangling with", "Write a concise evidence note with"],
    ["dangling to", "Write a concise evidence note to"],
    ["truncated command suffix", "Compare the observed command systemctl restart"],
    ["duplicated clause", "Write an evidence note for selected logs. Write an evidence note for selected logs."],
    ["semicolon checklist", "Compare service baseline; identify cron definition; define next validation."],
    ["invalid article", "Review evidence on a administrative jump host."],
    ["incomplete numbered item", "Write the finding in order:\n1."],
    ["corrupted code fence", "Write the finding.\n```"],
    ["internal checklist wording", "Mention the mandatory requirement and evidence atoms."],
  ];
  for (const [name, value] of invalid) {
    const reason = linuxNarrativeTextHygieneReason(value);
    const validation = validateLinuxStudentNarrativeIntegrity({
      title: "Linux evidence review",
      topic: "Linux",
      difficulty: "Beginner",
      estimated_time: "30 mins",
      objective: "Review supplied Linux evidence for the scoped host.",
      scenario: "A SOC analyst is reviewing supplied Linux evidence for a private-beta exercise.",
      tasks: [{ phase: "Task 1", title: "Review selected evidence.", deliverable: value }],
      hints: ["Use only listed evidence."],
      outcomes: ["Write evidence-backed findings."],
    });
    assert(`rejects ${name}`, Boolean(reason) || !validation.passed, JSON.stringify({ reason, issues: validation.issues }));
  }

  const validShell = 'Compare "/usr/bin/journalctl -u ssh" with /var/log/auth.log and document uncertainty.';
  assert("valid shell syntax and complete path pass", !linuxNarrativeTextHygieneReason(validShell), linuxNarrativeTextHygieneReason(validShell));
  const validPath = "Use /usr/local/sbin/platform-sync.sh as a cited path only when that file is listed for the task.";
  assert("valid complete filesystem path passes", !linuxNarrativeTextHygieneReason(validPath), linuxNarrativeTextHygieneReason(validPath));
  const validColumns = "Write a correlation table using the listed evidence. Include columns: Account, Evidence path, and Supported observation.";
  assert("valid Include columns wording passes", !linuxNarrativeTextHygieneReason(validColumns), linuxNarrativeTextHygieneReason(validColumns));
  const validThat = "Include narrow sudo-rule validation steps that verify business need and least-privilege scope.";
  assert("valid relative that clause passes", !linuxNarrativeTextHygieneReason(validThat), linuxNarrativeTextHygieneReason(validThat));
  const validDescription = "Include a description of the observed account activity.";
  assert("valid account activity noun phrase passes", !linuxNarrativeTextHygieneReason(validDescription), linuxNarrativeTextHygieneReason(validDescription));
  const validDescribe = "Describe the observed account activity using the listed evidence.";
  assert("valid account activity imperative passes", !linuxNarrativeTextHygieneReason(validDescribe), linuxNarrativeTextHygieneReason(validDescribe));

  const registeredRequirements = allLinuxLearnerRequirementKinds();
  const seenRequirementKeys = new Set();
  for (const requirement of registeredRequirements) {
    const key = `${requirement.kind}:${requirement.id}`;
    assert(`requirement ${key} is unique`, !seenRequirementKeys.has(key));
    seenRequirementKeys.add(key);
    const first = renderLinuxLearnerRequirementSentence(requirement);
    const second = renderLinuxLearnerRequirementSentence(requirement);
    assert(`requirement ${key} has one deterministic rendering`, first === second && first.length > 0, first);
    assert(`requirement ${key} is a complete sentence`, /[.!?]$/.test(first) && !linuxNarrativeTextHygieneReason(first), `${first} :: ${linuxNarrativeTextHygieneReason(first)}`);
    assert(`requirement ${key} contains no internal id`, !new RegExp(requirement.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(first), first);
    assert(`requirement ${key} contains no mechanical marker`, !/\b(?:Where relevant,\s+include|Include a sentence that|Also\s+\w+|It should\s+\w+)\b/i.test(first), first);
  }
  assert("requirement renderer fails closed for unknown IDs", (() => {
    try {
      renderLinuxLearnerRequirementSentence({ kind: "incident_question", id: "unknown_requirement" });
      return false;
    } catch (error) {
      return /LINUX_LEARNER_REQUIREMENT_RENDERER_MISSING/.test(String(error?.message || error));
    }
  })());

  function buildPassingNarrativeCandidate(family, difficulty) {
    let lastQuality = null;
    let lastError = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      let candidate;
      try {
        candidate = buildLinuxAssetCandidate({
          seed: `phase13c:passing:${family}:${difficulty}:${attempt}`,
          generationTime: "2026-08-12T10:00:00.000Z",
          category: "Linux",
          difficulty,
          duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
          title: "Amniora Linux Phase 13C",
        }, { incidentFamily: family });
      } catch (error) {
        lastError = error;
        continue;
      }
      if (!candidate.assetQuality?.passed) continue;
      const lab = assemble(modules, candidate, difficulty, "The model supplied a rough wording draft that should not control required output.").lab;
      const quality = checkLinuxFinalProductionQuality({
        context: candidate.investigation,
        assets: candidate.assets,
        simulation: candidate.simulation,
        lab,
      });
      if (quality.passed) return { candidate, lab, quality };
      lastQuality = quality;
    }
    throw new Error(`could not build passing ${family}/${difficulty}: ${JSON.stringify(lastQuality?.issues || []) || lastError?.message || "no candidate"}`);
  }

  const beginnerSystemd = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", "Beginner");
  const intermediateCron = buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Intermediate");
  const advancedCron = buildCandidate(buildLinuxAssetCandidate, "cron_persistence", "Advanced");
  for (const [name, candidate, difficulty, badDraft] of [
    ["Beginner systemd baseline shape", beginnerSystemd, "Beginner", "Include: compare service baseline."],
    ["Intermediate platform-sync task shape", intermediateCron, "Intermediate", "Compare command output for /usr"],
    ["Advanced cron uncertainty shape", advancedCron, "Advanced", "Compare service baseline; identify cron definition; define next validation."],
  ]) {
    const { lab } = assemble(modules, candidate, difficulty, badDraft);
    for (const [field, value] of learnerFields(lab)) {
      assert(`${name} ${field} passes text hygiene`, !linuxNarrativeTextHygieneReason(String(value || "")), `${field}: ${value}`);
    }
    const quality = checkLinuxFinalProductionQuality({
      context: candidate.investigation,
      assets: candidate.assets,
      simulation: candidate.simulation,
      lab,
    });
    assert(`${name} final quality passes`, quality.passed, JSON.stringify(quality.issues));
  }

  const { candidate: intermediateSudo, lab: intermediateSudoNarrative, quality: sudoQuality } = buildPassingNarrativeCandidate("misconfigured_sudoers", "Intermediate");
  const sudoTask = intermediateSudoNarrative.tasks.find((task) => /(?:narrow sudo-rule validation steps|narrow the sudo rule)/i.test(task.deliverable || ""));
  assert("production-shape Intermediate sudo remediation task exists", Boolean(sudoTask), JSON.stringify(intermediateSudoNarrative.tasks));
  assert(
    "Intermediate sudo-policy deliverable renders complete narrow-rule instruction",
    /(?:Include narrow sudo-rule validation steps|Propose steps to narrow the sudo rule and validate least privilege)\./.test(sudoTask.deliverable),
    sudoTask.deliverable
  );
  assert(
    "Intermediate sudo-policy deliverable omits malformed production sentence",
    !/Include a sentence that narrow sudo rule validation steps/i.test(sudoTask.deliverable),
    sudoTask.deliverable
  );
  const sudoIntegrity = validateLinuxStudentNarrativeIntegrity(intermediateSudoNarrative);
  assert("production-shape Intermediate sudo-policy lab passes learner-text boundary before persistence", sudoIntegrity.passed, JSON.stringify(sudoIntegrity.issues));
  assert("production-shape Intermediate sudo-policy final quality passes", sudoQuality.passed, JSON.stringify(sudoQuality.issues));
  const malformedSudoLab = {
    ...intermediateSudoNarrative,
    tasks: intermediateSudoNarrative.tasks.map((task) =>
      task === sudoTask
        ? { ...task, deliverable: "Prepare a focused correlation note comparing observed activity with policy or approval evidence. Also map sudo policy. It should check business need. Also compare privileged command. Include a sentence that narrow sudo rule validation steps." }
        : task
    ),
  };
  const malformedSudoIntegrity = validateLinuxStudentNarrativeIntegrity(malformedSudoLab);
  assert(
    "persisted Intermediate sudo-policy regression is rejected by learner-text boundary",
    !malformedSudoIntegrity.passed && malformedSudoIntegrity.issues.some((issue) => issue.message.includes("malformed that-clause") || issue.message.includes("mechanical fragment")),
    JSON.stringify(malformedSudoIntegrity.issues)
  );

  const { candidate: intermediateServiceAccount, lab: intermediateServiceAccountNarrative, quality: serviceAccountQuality } = buildPassingNarrativeCandidate("service_account_misuse", "Intermediate");
  const serviceAccountTaskText = intermediateServiceAccountNarrative.tasks.map((task) => task.deliverable || "").join(" ");
  const serviceAccountTask = intermediateServiceAccountNarrative.tasks.find((task) => /service account|observed account activity|account purpose|owner gaps/i.test(task.deliverable || ""));
  assert("production-shape Intermediate service-account task exists", Boolean(serviceAccountTask), JSON.stringify(intermediateServiceAccountNarrative.tasks));
  assert(
    "Intermediate service-account deliverables render complete activity or role instruction",
    /Describe the observed account activity using listed evidence|Check expected service-account use against observed activity/.test(serviceAccountTaskText),
    serviceAccountTaskText
  );
  assert(
    "Intermediate service-account deliverables omit malformed production sentence",
    !/Where relevant,\s+include describe account activity/i.test(serviceAccountTaskText),
    serviceAccountTaskText
  );
  const serviceAccountIntegrity = validateLinuxStudentNarrativeIntegrity(intermediateServiceAccountNarrative);
  assert("production-shape Intermediate service-account lab passes learner-text boundary before persistence", serviceAccountIntegrity.passed, JSON.stringify(serviceAccountIntegrity.issues));
  assert("production-shape Intermediate service-account final quality passes", serviceAccountQuality.passed, JSON.stringify(serviceAccountQuality.issues));
  const malformedServiceAccountLab = {
    ...intermediateServiceAccountNarrative,
    tasks: intermediateServiceAccountNarrative.tasks.map((task) =>
      task === serviceAccountTask
        ? { ...task, deliverable: "Draft a concise analyst finding using only listed evidence and uncertainty notes. Check role boundary using only the listed task evidence. Where relevant, include describe account activity." }
        : task
    ),
  };
  const malformedServiceAccountIntegrity = validateLinuxStudentNarrativeIntegrity(malformedServiceAccountLab);
  assert(
    "persisted Intermediate service-account regression is rejected by learner-text boundary",
    !malformedServiceAccountIntegrity.passed && malformedServiceAccountIntegrity.issues.some((issue) => issue.message.includes("mechanical fragment")),
    JSON.stringify(malformedServiceAccountIntegrity.issues)
  );

  const { candidate: advancedDocker, lab: advancedDockerNarrative, quality: dockerQuality } = buildPassingNarrativeCandidate("docker_compromise", "Advanced");
  const dockerDeliverables = advancedDockerNarrative.tasks.map((task) => task.deliverable || "");
  const dockerText = dockerDeliverables.join(" ");
  const dockerHardenMatches = dockerText.match(/harden container runtime boundaries and validate mount exposure/gi) || [];
  assert("production-shape Advanced docker hardening instruction renders once", dockerHardenMatches.length === 1, dockerText);
  assert("production-shape Advanced docker uncertainty boundary remains distinct", /container evidence and unsupported host-compromise claims|Container mount evidence does not prove full host compromise/i.test(dockerText), dockerText);
  const dockerIntegrity = validateLinuxStudentNarrativeIntegrity(advancedDockerNarrative);
  assert("production-shape Advanced docker lab passes learner-text boundary", dockerIntegrity.passed, JSON.stringify(dockerIntegrity.issues));
  assert("production-shape Advanced docker final quality passes", dockerQuality.passed, JSON.stringify(dockerQuality.issues));

  const directBadCandidate = beginnerSystemd;
  for (const [name, value] of invalid.slice(0, 12)) {
    const quality = checkLinuxFinalProductionQuality({
      context: directBadCandidate.investigation,
      assets: directBadCandidate.assets,
      simulation: directBadCandidate.simulation,
      lab: labWithBadField(directBadCandidate, value),
    });
    assert(`final quality rejects direct ${name}`, !quality.passed && quality.issues.some((issue) => /malformed or truncated/i.test(issue.description)), JSON.stringify(quality.issues));
  }

  let matrix = 0;
  for (const family of FAMILIES) {
    for (const difficulty of DIFFICULTIES) {
      const { candidate, lab } = buildPassingNarrativeCandidate(family, difficulty);
      const integrity = validateLinuxStudentNarrativeIntegrity({
        title: lab.title,
        topic: lab.category,
        difficulty: lab.difficulty,
        estimated_time: lab.duration,
        objective: lab.objective,
        scenario: lab.scenario,
        tasks: lab.tasks,
        hints: lab.hints,
        outcomes: lab.outcomes,
        learningOutcomes: lab.learningOutcomes,
      });
      assert(`${family}/${difficulty} learner narrative integrity passes`, integrity.passed, JSON.stringify(integrity.issues));
      for (const [field, value] of learnerFields(lab)) {
        assert(`${family}/${difficulty} ${field} passes Phase 13C text boundary`, !linuxNarrativeTextHygieneReason(String(value || "")), `${field}: ${value}`);
      }
      assertLinuxStudentContent({
        title: lab.title,
        topic: lab.category,
        objective: lab.objective,
        scenario: lab.scenario,
        tasks: lab.tasks,
        hints: lab.hints,
        outcomes: lab.outcomes,
        learningOutcomes: lab.learningOutcomes,
      });
      const coverage = validateLinuxIncidentCoverage({ simulation: candidate.simulation, finalAssets: candidate.assets, lab });
      assert(`${family}/${difficulty} coverage remains satisfied`, coverage.status === "covered", JSON.stringify(coverage.issues));
      const diversity = validateLinuxTaskDiversity({ simulation: candidate.simulation, finalAssets: candidate.assets });
      assert(`${family}/${difficulty} task diversity remains satisfied`, diversity.status === "diverse", JSON.stringify(diversity.issues));
      const workload = checkLinuxLabWorkload({
        simulation: candidate.simulation,
        assets: candidate.assets,
        requestedDifficulty: difficulty,
        requestedDurationMinutes: difficulty === "Advanced" ? 60 : 30,
      });
      assert(`${family}/${difficulty} workload remains in range`, workload.passed, JSON.stringify(workload.issues));
      matrix += 1;
    }
  }
  console.log(JSON.stringify({ passed: true, matrixCases: matrix, directInvalidCases: invalid.length }, null, 2));
}

main();
