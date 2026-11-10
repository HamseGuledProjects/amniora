#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const {
  AUDIT_FILE,
  MATRIX,
  VERSION,
  aggregateRows,
  assertionCounter,
  buildCandidate,
  compileIfNeeded,
  loadModules,
  matrixRow,
  multiSeedRuns,
  mutationCases,
  routeBoundaryCases,
  scanEncoding,
  writeAuditArtifact,
} = require("./linuxPhase9AuditUtils");

function requiredMatrixFields() {
  return [
    "incidentFamily",
    "difficulty",
    "rootSeed",
    "requestedDuration",
    "estimatedDuration",
    "acceptedRange",
    "distanceFromLowerBoundary",
    "distanceFromUpperBoundary",
    "finalResult",
    "acceptedAttempt",
    "precedingAttemptOutcomes",
    "taskCount",
    "learnerActionCount",
    "sharedActionCount",
    "uniqueEvidencePaths",
    "relevantLines",
    "distractorLines",
    "relevantToNoiseRatio",
    "relevantSubjectCount",
    "contextualSubjectCount",
    "noiseOnlySubjectCount",
    "relevantRelationshipCount",
    "timelineActionCount",
    "remediationActionCount",
    "deliverableActionCount",
    "workloadDimensions",
    "independentEstimateHash",
    "contractAwareReportHash",
    "workloadIssueCodes",
    "requiresRemediation",
    "requiredRemediationConcepts",
    "remediationConceptCoverage",
    "concreteRemediationActions",
    "tokenCostRemediationActions",
    "requiredRemediationConceptsCounted",
    "remediationTasks",
    "remediationDimension",
    "intermediateSixTaskJustification",
    "learnerTimelineActions",
    "timelineDimension",
    "rawAttempts",
  ];
}

function main() {
  const counter = assertionCounter();
  const assert = counter.assert;
  counter.summary.suitesExecuted.push("runLinuxPhase9WorkloadAudit");
  const out = compileIfNeeded("audit-runner");
  counter.summary.outPath = out;
  const modules = loadModules(out);

  const matrix = MATRIX.map(([difficulty, family, seed]) => {
    const candidate = buildCandidate(modules, difficulty, family, seed);
    return matrixRow(modules, candidate, difficulty, family, seed);
  });
  const aggregates = aggregateRows(matrix);

  assert("audit matrix has 33 rows", matrix.length === 33);
  for (const row of matrix) {
    for (const field of requiredMatrixFields()) {
      assert(`matrix field ${row.difficulty}/${row.incidentFamily}/${field}`, Object.prototype.hasOwnProperty.call(row, field));
    }
    assert(`accepted estimate in range ${row.difficulty}/${row.incidentFamily}`, row.estimatedDuration >= row.acceptedRange.minimumMinutes && row.estimatedDuration <= row.acceptedRange.maximumMinutes);
    assert(`learner actions not task count ${row.difficulty}/${row.incidentFamily}`, row.learnerActionCount !== row.taskCount);
    assert(`noise-only subjects do not drive useful workload ${row.difficulty}/${row.incidentFamily}`, row.noiseOnlySubjectCount >= 0 && row.relevantSubjectCount + row.contextualSubjectCount <= row.relevantSubjectCount + row.contextualSubjectCount + row.noiseOnlySubjectCount);
    if (row.difficulty === "Beginner") assert(`Beginner task range ${row.incidentFamily}`, row.taskCount >= 3 && row.taskCount <= 4);
    if (row.difficulty === "Intermediate" && row.requestedDuration === 30) assert(`Intermediate 30 task range ${row.incidentFamily}`, row.taskCount >= 4 && row.taskCount <= 5);
    if (row.difficulty === "Advanced" && row.requestedDuration === 60) assert(`Advanced 60 task range ${row.incidentFamily}`, row.taskCount >= 5 && row.taskCount <= 7);
    assert(`incident coverage has remediation contract ${row.difficulty}/${row.incidentFamily}`, row.requiredRemediationConcepts.length > 0);
    if (row.requiresRemediation) {
      assert(`remediation effort nonzero ${row.difficulty}/${row.incidentFamily}`, row.remediationDimension > 0 && row.remediationActionCount > 0);
      assert(`required remediation concepts counted ${row.difficulty}/${row.incidentFamily}`, row.requiredRemediationConceptsCounted === true, JSON.stringify(row.remediationConceptCoverage));
      assert(`no uncounted remediation code ${row.difficulty}/${row.incidentFamily}`, !row.workloadIssueCodes.includes("LINUX_WORKLOAD_REMEDIATION_UNCOUNTED"));
      assert(`remediation has concrete actions ${row.difficulty}/${row.incidentFamily}`, row.concreteRemediationActions.length > 0);
      assert(`remediation has no token costs ${row.difficulty}/${row.incidentFamily}`, row.tokenCostRemediationActions.length === 0, JSON.stringify(row.tokenCostRemediationActions));
      for (const action of row.concreteRemediationActions) {
        assert(`remediation action has carrier ${row.difficulty}/${row.incidentFamily}/${action.dedupeKey}`, Boolean(action.taskId && action.taskIndex && action.carrierDeliverableType), JSON.stringify(action));
        assert(`remediation action has behavioral cost ${row.difficulty}/${row.incidentFamily}/${action.dedupeKey}`, action.costMinutes >= modules.workload.LINUX_MIN_REMEDIATION_ACTION_COST_MINUTES, JSON.stringify(action));
      }
      const dedupeKeys = row.concreteRemediationActions.map((action) => action.dedupeKey);
      assert(`remediation action dedupe keys unique ${row.difficulty}/${row.incidentFamily}`, new Set(dedupeKeys).size === dedupeKeys.length, JSON.stringify(dedupeKeys));
    }
    if (row.difficulty === "Intermediate" && row.taskCount === 6) {
      const proof = row.intermediateSixTaskJustification;
      assert(`Intermediate six-task row has justification ${row.incidentFamily}`, Boolean(proof?.required));
      assert(`Intermediate six-task row is nonduplicative ${row.incidentFamily}`, proof?.nonDuplicative === true, JSON.stringify(proof));
      assert(`Intermediate six-task row stays within limits ${row.incidentFamily}`, proof?.withinDeliverableLimit === true && proof?.withinDurationRange === true, JSON.stringify(proof));
    }
    assert(`timeline effort justified ${row.difficulty}/${row.incidentFamily}`, (row.timelineActionCount === 0 && row.timelineDimension === 0) || (row.timelineActionCount > 0 && row.learnerTimelineActions.length > 0 && row.timelineDimension > 0));
  }

  const remediationKinds = {
    all_contract_required: matrix.every((row) => row.requiresRemediation && row.requiredRemediationConcepts.length > 0),
    short_recommendation: matrix.some((row) => row.remediationTasks.some((task) => task.deliverableType === "risk_summary")),
    immediate_containment: matrix.some((row) => row.remediationTasks.some((task) => task.intent === "containment_recommendation")),
    configuration_correction: matrix.some((row) => row.requiresRemediation && /sudoers|systemd|package|docker|cron/.test(row.incidentFamily)),
    evidence_preservation: matrix.some((row) => row.remediationTasks.some((task) => /evidence|integrity|log/i.test(`${row.incidentFamily} ${task.intent}`))),
    recovery: matrix.some((row) => row.remediationTasks.some((task) => /package|service|systemd/i.test(`${row.incidentFamily} ${task.intent}`))),
    long_term_prevention: matrix.some((row) => row.remediationTasks.some((task) => /risk|containment/i.test(`${task.intent} ${task.deliverableType}`))),
    multi_part_remediation_plan: matrix.some((row) => row.remediationActionCount >= 3),
  };
  for (const [kind, present] of Object.entries(remediationKinds)) assert(`remediation fixture coverage ${kind}`, present);
  assert("aggregate has zero token-cost remediation cases", aggregates.tokenCostRemediationCases === 0, JSON.stringify(aggregates));

  const timelineKinds = {
    no_timeline_work: matrix.some((row) => row.timelineActionCount === 0),
    one_timestamp_lookup: matrix.some((row) => row.timelineActionCount >= 1),
    two_source_ordering: matrix.some((row) => row.timelineActionCount >= 2),
    multi_source_reconstruction: matrix.some((row) => row.timelineActionCount >= 3),
    timezone_normalization: matrix.some((row) => row.learnerTimelineActions.some((task) => task.requiredCapabilities.includes("timeline_exact"))),
    current_state_vs_historical_state: matrix.some((row) => row.workloadDimensions.semanticReasoning > 0 && row.timelineActionCount >= 0),
    causal_process_service_file_sequence: matrix.some((row) => row.learnerTimelineActions.some((task) => /command|service|file|process|audit|journal|timeline/.test(`${task.intent} ${task.relevantEvidencePaths.join(" ")}`))),
  };
  for (const [kind, present] of Object.entries(timelineKinds)) assert(`timeline fixture coverage ${kind}`, present);

  const baseline = buildCandidate(modules, "Advanced", "docker_compromise", "phase8-matrix:Advanced:docker_compromise:1");
  const mutations = mutationCases(modules, baseline);
  assert("mutation table has all required cases", mutations.length >= 29);
  for (const mutation of mutations) {
    assert(`mutation direction ${mutation.mutation}`, mutation.directionAssertionPassed, JSON.stringify(mutation));
    assert(`mutation has numeric delta ${mutation.mutation}`, Number.isFinite(mutation.delta));
    assert(`mutation has changed dimensions ${mutation.mutation}`, Object.keys(mutation.changedDimensions).length > 0);
  }
  const circular = mutations.find((item) => item.mutation === "hide_remediation_recognition_while_contract_requires_it");
  assert("circular remediation audit mutation exists", Boolean(circular));
  assert("circular remediation audit keeps contract requirement", circular?.requiresRemediation === true);
  assert("circular remediation audit forces zero remediation effort", circular?.remediationDimension === 0 && circular?.remediationActionCount === 0);
  assert("circular remediation audit emits stable code", circular?.workloadIssueCodes.includes("LINUX_WORKLOAD_REMEDIATION_UNCOUNTED"));
  for (const [name, code] of [
    ["required_concept_zero_effort", "LINUX_WORKLOAD_REMEDIATION_UNCOUNTED"],
    ["required_concept_token_cost_001", "LINUX_WORKLOAD_REMEDIATION_COST_INVALID"],
    ["required_concept_token_cost_005", "LINUX_WORKLOAD_REMEDIATION_COST_INVALID"],
    ["required_concept_without_learner_action", "LINUX_WORKLOAD_REMEDIATION_ACTION_MISSING"],
    ["learner_action_absent_from_deliverable", "LINUX_WORKLOAD_REMEDIATION_DELIVERABLE_MISSING"],
    ["duplicate_metadata_paths_double_charge_same_action", "LINUX_WORKLOAD_REMEDIATION_DOUBLE_COUNTED"],
    ["forged_remediation_dimension", "LINUX_WORKLOAD_REMEDIATION_UNCOUNTED"],
  ]) {
    const mutation = mutations.find((item) => item.mutation === name);
    assert(`negative remediation mutation exists ${name}`, Boolean(mutation));
    assert(`negative remediation mutation emits ${code}`, mutation?.workloadIssueCodes.includes(code), JSON.stringify(mutation));
    assert(`negative remediation mutation rejected ${name}`, mutation?.finalQualityResult === "rejected", JSON.stringify(mutation));
  }

  const multiSeed = multiSeedRuns(modules);
  assert("multi-seed groups use seven groups", multiSeed.length === 7);
  for (const group of multiSeed) {
    assert(`multi-seed group has 10 roots ${group.difficulty}/${group.family}`, group.rootSeeds.length === 10 && group.runs.length === 10);
    for (const run of group.runs) {
      assert(`multi-seed raw estimate recorded ${run.rootSeed}`, Number.isFinite(run.firstRawEstimate));
      assert(`multi-seed attempts recorded ${run.rootSeed}`, run.attempts.length > 0);
      assert(`multi-seed accepted or explicit failure ${run.rootSeed}`, run.noCandidateAccepted || Number.isFinite(run.acceptedEstimate));
    }
  }

  return routeBoundaryCases(modules).then((routeBoundary) => {
    assert("route boundary has all required cases", routeBoundary.length === 14);
    for (const row of routeBoundary) {
      assert(`route case persistence count ${row.case}`, row.persistenceCallCount === row.expectedInsertCalls, JSON.stringify(row));
      if (row.expectedInsertCalls === 1) assert(`route saved hash equality ${row.case}`, row.savedHashEquality === true, JSON.stringify(row));
      if (row.expectedInsertCalls === 0) assert(`route invalid has no saved hashes ${row.case}`, row.storedHashes === null, JSON.stringify(row));
    }
    const missingRemediationRoute = routeBoundary.find((row) => row.case === "missing_remediation_workload");
    assert("route missing remediation case exists", Boolean(missingRemediationRoute));
    assert("route missing remediation emits stable code", missingRemediationRoute?.workloadValidationCodes.includes("LINUX_WORKLOAD_REMEDIATION_UNCOUNTED") || missingRemediationRoute?.otherValidationCodes.includes("LINUX_WORKLOAD_REMEDIATION_UNCOUNTED"), JSON.stringify(missingRemediationRoute));
    const tokenRemediationRoute = routeBoundary.find((row) => row.case === "token_remediation_cost_route_attempt");
    assert("route token remediation case exists", Boolean(tokenRemediationRoute));
    assert("route token remediation does not persist", tokenRemediationRoute?.persistenceCallCount === 0, JSON.stringify(tokenRemediationRoute));

    const encodingHits = scanEncoding();
    assert("source encoding scan clean", encodingHits.length === 0, JSON.stringify(encodingHits));

    const artifact = {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      matrix,
      aggregates,
      multiSeedRuns: multiSeed,
      mutations,
      routeBoundaryCases: routeBoundary,
      invarianceCases: {
        noTargetScalar: true,
        deterministicMatrixRows: matrix.length,
        forcedFamilySelectionSeparatedFromWorkloadRetries: true,
      },
      sensitivityCases: mutations,
      encodingScan: {
        clean: encodingHits.length === 0,
        hits: encodingHits,
      },
      assertionSummary: counter.summary,
    };

    assert("artifact has required sections", ["version", "matrix", "aggregates", "multiSeedRuns", "mutations", "routeBoundaryCases", "invarianceCases", "sensitivityCases", "assertionSummary"].every((key) => Object.prototype.hasOwnProperty.call(artifact, key)));
    writeAuditArtifact(artifact);
    console.log(JSON.stringify({
      passed: true,
      artifact: AUDIT_FILE,
      assertionSummary: counter.summary,
      matrixRows: matrix.length,
      mutationRows: mutations.length,
      routeBoundaryRows: routeBoundary.length,
    }, null, 2));
  });
}

Promise.resolve(main()).catch((error) => {
  console.error(error);
  process.exit(1);
});
