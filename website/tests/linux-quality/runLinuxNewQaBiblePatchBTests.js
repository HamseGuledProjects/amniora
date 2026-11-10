// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const path = require("path");
const assert = require("node:assert/strict");
const { compileIfNeeded, loadModules, buildCandidate } = require("./linuxPhase9AuditUtils");

async function main() {
  const out = compileIfNeeded("new-qa-bible-patch-b");
  const modules = loadModules(out);
  const structural = require(path.join(out, "linux/structuralDiversity.js"));
  const recent = require(path.join(out, "linux/recentDiversity.js"));
  const identity = require(path.join(out, "linux/identityRealism.js"));
  const commandEvidence = require(path.join(out, "linux/commandFileEvidence.js"));
  const persistence = require(path.join(out, "linux/recentDiversityPersistence.js"));
  const clone = (value) => JSON.parse(JSON.stringify(value));
  let passed = 0;
  const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
  const original = buildCandidate(modules, "Advanced", "ssh_key_compromise", "phase8-matrix:Advanced:ssh_key_compromise:1", { duration: 30 });
  const intermediate = buildCandidate(modules, "Intermediate", "data_staging", "phase8-matrix:Intermediate:data_staging:1", { duration: 30 });
  const advancedDocker = buildCandidate(modules, "Advanced", "docker_compromise", "patch-b:docker-advanced30:2", { duration: 30 });
  const sameFamilyVariantA = buildCandidate(modules, "Advanced", "ssh_key_compromise", "patch-b:structural:ssh_key_compromise:0", { duration: 30 });
  const sameFamilyVariantB = buildCandidate(modules, "Advanced", "ssh_key_compromise", "patch-b:structural:ssh_key_compromise:8", { duration: 30 });
  const fingerprint = structural.buildLinuxStructuralFingerprint(original.simulation);
  test("deterministic fingerprint", () => assert.deepEqual(fingerprint, structural.buildLinuxStructuralFingerprint(original.simulation)));
  const renamed = clone(original.simulation);
  renamed.investigation.hostname = "renamed-host";
  renamed.investigation.company = "renamed-company";
  renamed.investigation.incidentId = "renamed-incident";
  renamed.investigation.changeId = "renamed-change";
  renamed.investigation.ticketId = "renamed-ticket";
  renamed.diversityProfile.narrativeStyle = "evidence_memo";
  renamed.diversityProfile.identityLayout = "contractor_edge";
  renamed.diversityProfile.taskPath = "runtime_led";
  renamed.commands.forEach((command) => { if (command.tty) command.tty = `different-${command.tty}`; });
  renamed.identities.forEach((item) => { if (item.uid >= 1000) { item.uid += 10000; item.gid += 10000; } });
  test("cosmetic fields, UID base and terminal numbers score zero", () => assert.equal(structural.compareLinuxStructuralFingerprints(fingerprint, structural.buildLinuxStructuralFingerprint(renamed)).overallDistinctiveness, 0));
  const reordered = clone(original.simulation);
  reordered.canonicalTasks.reverse().forEach((task, index) => { task.order = index + 1; });
  reordered.commands.reverse();
  test("task and array reordering cannot pass as a distinct case", () => assert.ok(structural.compareLinuxStructuralFingerprints(fingerprint, structural.buildLinuxStructuralFingerprint(reordered)).overallDistinctiveness < 4));
  const history = Array.from({ length: 10 }, (_, index) => ({ acceptedId: `accepted-${index}`, family: original.simulation.investigation.incidentFamily, fingerprint }));
  test("same-family topology clone rejected", () => assert.equal(recent.checkLinuxRecentDiversity(original.simulation, history).passed, false));
  const genuineSameFamilyHistory = [{
    acceptedId: "genuine-a",
    family: sameFamilyVariantA.simulation.investigation.incidentFamily,
    fingerprint: structural.buildLinuxStructuralFingerprint(sameFamilyVariantA.simulation),
  }];
  test("same-family genuinely different topology passes", () => {
    const comparison = structural.compareLinuxStructuralFingerprints(
      genuineSameFamilyHistory[0].fingerprint,
      structural.buildLinuxStructuralFingerprint(sameFamilyVariantB.simulation)
    );
    assert.ok(comparison.overallDistinctiveness >= 4, JSON.stringify(comparison));
  });
  test("candidate distinct from recent same-family history passes", () => {
    assert.equal(recent.checkLinuxRecentDiversity(sameFamilyVariantB.simulation, genuineSameFamilyHistory).passed, true);
  });
  const alternateAttempts = [];
  const alternate = await recent.selectLinuxRecentDistinctCandidate({
    build: (attempt) => {
      alternateAttempts.push(attempt);
      return attempt === 0 ? sameFamilyVariantA : sameFamilyVariantB;
    },
    loadHistory: async () => genuineSameFamilyHistory,
    budget: 3,
  });
  test("bounded deterministic retry selects an alternate structural profile", () => {
    assert.deepEqual(alternateAttempts, [0, 1]);
    assert.equal(alternate.attempts, 2);
    assert.equal(alternate.candidate, sameFamilyVariantB);
  });
  test("tenth recent case participates in comparison", () => assert.equal(recent.checkLinuxRecentDiversity(original.simulation, history).comparisons[9].acceptedId, "accepted-9"));
  test("history bounded to ten", () => assert.equal(recent.checkLinuxRecentDiversity(original.simulation, [...history, ...history]).comparisons.length, 10));
  test("partial history enforces the pair floor without inventing a ten-case average", () => {
    const comparison = recent.checkLinuxRecentDiversity(original.simulation, [{ acceptedId: "one", family: original.simulation.investigation.incidentFamily, fingerprint }]);
    assert.equal(comparison.passed, false);
    assert.equal(comparison.minimum, 0);
  });
  test("incompatible historical fingerprint fails closed", () => assert.throws(() => recent.parseLinuxStoredFingerprint({ ...fingerprint, version: "old" }), /INCOMPATIBLE/));
  test("missing historical fingerprint fails closed", () => assert.throws(() => recent.parseLinuxStoredFingerprint(null), /MISSING/));
  const attemptOrder = [];
  await assert.rejects(recent.selectLinuxRecentDistinctCandidate({
    build: (attempt) => { attemptOrder.push(attempt); return original; },
    loadHistory: async () => history, budget: 3,
  }), /LINUX_DIVERSITY_EXHAUSTED/);
  test("retry exhaustion is bounded, with no persistence callback", () => assert.deepEqual(attemptOrder, [0, 1, 2]));
  const replayOrder = [];
  await assert.rejects(recent.selectLinuxRecentDistinctCandidate({
    build: (attempt) => { replayOrder.push(attempt); return original; },
    loadHistory: async () => history, budget: 3,
  }), /LINUX_DIVERSITY_EXHAUSTED/);
  test("same history replays the same retry sequence", () => assert.deepEqual(attemptOrder, replayOrder));
  let reads = 0;
  await assert.rejects(recent.selectLinuxRecentDistinctCandidate({
    build: () => original,
    loadHistory: async () => { reads++; return history; }, budget: 3,
  }), /EXHAUSTED/);
  test("history snapshot remains stable within retries", () => assert.equal(reads, 1));
  const empty = await recent.selectLinuxRecentDistinctCandidate({ build: () => original, loadHistory: async () => [] });
  test("empty history needs one attempt", () => assert.equal(empty.attempts, 1));
  test("generated identity inventory is non-arithmetic", () => identity.validateLinuxIdentityRealism(original.assets));
  const csv = (rows) => [{ file_path: "assets/csv/users.csv", content: `username,uid,gid,last_login\n${rows.join("\n")}\n` }];
  test("arithmetic UID mutation fails", () => assert.throws(() => identity.validateLinuxIdentityRealism(csv(["a,2000,2000,never", "b,2003,2007,never", "c,2006,2019,never", "d,2009,2043,never"])), /ARITHMETIC/));
  test("arithmetic GID mutation fails", () => assert.throws(() => identity.validateLinuxIdentityRealism(csv(["a,2000,3000,never", "b,2011,3007,never", "c,2037,3014,never", "d,2093,3021,never"])), /ARITHMETIC/));
  test("monotonic one-minute login block fails", () => assert.throws(() => identity.validateLinuxIdentityRealism(csv(["a,2000,2000,2026-09-01 12:00", "b,2011,2011,2026-09-01 12:01", "c,2037,2037,2026-09-01 12:02", "d,2093,2093,2026-09-01 12:03"])), /LOGIN_SEQUENCE/));
  test("plausible sparse identity population passes", () => identity.validateLinuxIdentityRealism(csv(["a,1204,1204,2026-08-01 07:19", "b,2097,2097,never", "c,3021,3021,2026-07-25 16:31", "d,4038,4038,2026-09-01 11:42"])));
  const failed = original.simulation.commands.find((item) => item.id === "command:shell-hosted:command-not-found");
  test("failed shell command explains provenance and exit status", () => {
    const label = modules.simulation.linuxLearnerSubjectLabel(original.simulation, failed.id);
    for (const token of [failed.renderedCommand, failed.timestamp, "exit 127", "shell PID", "no child process"]) assert.ok(label.includes(token), token);
  });
  const renamedFiller = clone(original.simulation);
  const filler = renamedFiller.commands.find((item) => item.id === failed.id);
  filler.renderedCommand = filler.executable = "another-opaque-token";
  filler.argv = [filler.renderedCommand];
  test("renamed failed probe earns no diversity credit", () => assert.equal(structural.compareLinuxStructuralFingerprints(fingerprint, structural.buildLinuxStructuralFingerprint(renamedFiller)).overallDistinctiveness, 0));
  test("Intermediate production plan has two genuine joins and bounded uncertainty", () => {
    const metrics = intermediate.assetQuality.workloadReport.metrics;
    assert.ok(metrics.genuineCrossSourceJoinCount >= 2, JSON.stringify(metrics));
    assert.ok(metrics.nonIdentityCrossSourceJoinCount >= 1, JSON.stringify(metrics));
    assert.ok(metrics.uncertaintyDecisionCount >= 1, JSON.stringify(metrics));
  });
  test("Intermediate plan lacking genuine joins fails", () => {
    const report = clone(intermediate.assetQuality.workloadReport);
    report.metrics.genuineCrossSourceJoinCount = 1;
    report.metrics.nonIdentityCrossSourceJoinCount = 0;
    const issues = modules.workload.validateLinuxLabWorkloadReport(report, { simulation: intermediate.simulation, assets: intermediate.assets });
    assert.ok(issues.some((issue) => issue.code === "LINUX_WORKLOAD_INSUFFICIENT_DEPTH"), JSON.stringify(issues));
  });
  test("Advanced plan without three synthesis tasks fails", () => {
    const report = clone(original.assetQuality.workloadReport);
    report.metrics.synthesisTaskCount = 2;
    const issues = modules.workload.validateLinuxLabWorkloadReport(report, { simulation: original.simulation, assets: original.assets });
    assert.ok(issues.some((issue) => issue.code === "LINUX_WORKLOAD_SYNTHESIS_MISSING"), JSON.stringify(issues));
  });
  test("Advanced file volume cannot substitute for weak reasoning", () => {
    const report = clone(original.assetQuality.workloadReport);
    report.metrics.totalPackFileCount = 60;
    report.metrics.renderedEvidenceAssetCount = 56;
    report.metrics.synthesisTaskCount = 1;
    const issues = modules.workload.validateLinuxLabWorkloadReport(report, { simulation: original.simulation, assets: original.assets });
    assert.ok(issues.some((issue) => issue.code === "LINUX_WORKLOAD_FILE_COUNT_INFLATION"), JSON.stringify(issues));
    assert.ok(issues.some((issue) => issue.code === "LINUX_WORKLOAD_SYNTHESIS_MISSING"), JSON.stringify(issues));
  });
  test("Advanced production plan has synthesis, hypotheses and uncertainty", () => {
    const metrics = original.assetQuality.workloadReport.metrics;
    assert.ok(metrics.synthesisTaskCount >= 3, JSON.stringify(metrics));
    assert.ok(metrics.competingHypothesisDecisionCount >= 1, JSON.stringify(metrics));
    assert.ok(metrics.uncertaintyDecisionCount >= 1, JSON.stringify(metrics));
  });
  test("Advanced 30-minute Docker preserves all protected questions and embeds synthesis", () => {
    const intents = new Set(advancedDocker.simulation.canonicalTasks.map((task) => task.intent));
    for (const intent of ["actor_attribution", "command_process", "file_permissions", "configuration_review"]) {
      assert.ok(intents.has(intent), intent);
    }
    assert.equal(advancedDocker.simulation.canonicalTasks.length, 4);
    assert.ok(advancedDocker.simulation.canonicalTasks.some((task) => task.requirements.some((requirement) => requirement.capability === "risk_context")));
    assert.ok(advancedDocker.assetQuality.workloadReport.metrics.competingHypothesisDecisionCount >= 1);
  });
  test("Patch B leaves deferred Patch C review documents untouched", () => {
    const paths = new Set(original.assets.map((asset) => asset.file_path));
    for (const reviewPath of ["assets/evidence/audit_notes.md", "assets/evidence/analyst_questions.md"]) {
      assert.equal(paths.has(reviewPath), true, reviewPath);
    }
  });
  test("shared evidence navigation is charged once per investigation", () => {
    const report = original.assetQuality.workloadReport;
    assert.equal(report.dimensions.evidenceNavigation, Number((report.metrics.uniqueEvidencePathCount * 0.4).toFixed(2)));
  });

  const vpnHost = buildCandidate(modules, "Advanced", "ssh_key_compromise", "patch-b:host-role:5", { duration: 30 });
  const dnsHost = buildCandidate(modules, "Advanced", "ssh_key_compromise", "patch-b:host-role:6", { duration: 30 });
  const vpnFingerprint = structural.buildLinuxStructuralFingerprint(vpnHost.simulation);
  const dnsFingerprint = structural.buildLinuxStructuralFingerprint(dnsHost.simulation);
  const relabelledHostClone = clone(vpnHost.simulation);
  relabelledHostClone.investigation.hostRole = "renamed edge appliance";
  relabelledHostClone.backgroundProfile.hostRole = "renamed edge appliance";
  test("fixed role-order clone on a relabelled host is still detected as a reskin", () => {
    assert.equal(
      structural.compareLinuxStructuralFingerprints(vpnFingerprint, structural.buildLinuxStructuralFingerprint(relabelledHostClone)).overallDistinctiveness,
      0
    );
  });
  test("host-role-specific identity and service evidence is materially different", () => {
    assert.notEqual(vpnHost.simulation.investigation.hostRole, dnsHost.simulation.investigation.hostRole);
    const vpnUsers = vpnHost.assets.find((asset) => asset.file_path === "assets/csv/users.csv")?.content || "";
    assert.match(vpnUsers, /(network administrator|identity support engineer)/, "VPN identity cohort missing");
    assert.ok(dnsHost.simulation.identities.some((entry) => entry.username === "bind"), "DNS identity missing");
    assert.ok(dnsHost.simulation.processes.some((process) => /\/named\b/.test(process.executable)), "DNS process missing");
    assert.ok(dnsHost.simulation.services.some((service) => service.unitName === "systemd-resolved.service"), "DNS service missing");
  });
  const renamedNoiseClone = clone(vpnHost.simulation);
  renamedNoiseClone.backgroundProfile.industry = "renamed industry";
  renamedNoiseClone.backgroundProfile.hostRole = "renamed host";
  renamedNoiseClone.services
    .filter((service) => service.role === "background")
    .forEach((service, index) => { service.unitName = `routine-${index}.service`; });
  test("renamed generic background bundle earns no noise-diversity credit", () => {
    const comparison = structural.compareLinuxStructuralFingerprints(vpnFingerprint, structural.buildLinuxStructuralFingerprint(renamedNoiseClone));
    assert.equal(comparison.dimensionScores.noise, 0);
  });
  test("host-relevant DNS and VPN background variation earns structural credit", () => {
    const comparison = structural.compareLinuxStructuralFingerprints(vpnFingerprint, dnsFingerprint);
    assert.ok(comparison.dimensionScores.noise > 0, JSON.stringify(comparison));
    assert.ok(comparison.overallDistinctiveness > 0, JSON.stringify(comparison));
  });

  const fileHistory = [
    "timestamp,pid,command,path",
    "2026-07-29 09:01:00,123,cat /etc/ssh/sshd_config,/etc/ssh/sshd_config",
    "2026-07-29 09:01:01,124,cat /etc/ssh/sshd_config,/etc/shadow",
  ].join("\n");
  test("native read operand accepts the exact historical path and PID", () => assert.equal(commandEvidence.linuxReadOperandsHaveEvidence({
    command: "cat /etc/ssh/sshd_config", pid: "123", openRows: [], history: fileHistory,
  }), true));
  test("a path mentioned only in the command column is not file evidence", () => assert.equal(commandEvidence.linuxReadOperandsHaveEvidence({
    command: "cat /etc/ssh/sshd_config", pid: "124", openRows: [], history: fileHistory,
  }), false));
  test("the right path under a different PID is not file evidence", () => assert.equal(commandEvidence.linuxReadOperandsHaveEvidence({
    command: "cat /etc/ssh/sshd_config", pid: "125", openRows: [], history: fileHistory,
  }), false));

  const database = (responses) => {
    const calls = [];
    return {
      calls,
      from(table) {
        const response = responses.shift();
        const query = {};
        for (const method of ["select", "eq", "is", "gte", "order"]) {
          query[method] = (...args) => { calls.push([method, ...args]); return query; };
        }
        query.limit = (value) => { calls.push(["limit", value]); return Promise.resolve(response); };
        calls.push(["from", table]);
        return query;
      },
    };
  };
  const storedRows = Array.from({ length: 10 }, (_, index) => ({
    id: `history-${index}`,
    created_at: `2026-09-${String(20 - index).padStart(2, "0")}T08:00:00.000Z`,
    provenance: { diversityContractVersion: structural.LINUX_STRUCTURAL_DIVERSITY_VERSION, structuralFingerprint: fingerprint },
  }));
  const scopedDatabase = database([{ data: storedRows, error: null }]);
  const loadedHistory = await persistence.loadLinuxRecentAcceptedCases(scopedDatabase, "learner-1", "ssh_key_compromise");
  test("production history loads ten same-family records", () => assert.equal(loadedHistory.length, 10));
  test("production history query is learner- and family-scoped", () => {
    assert.ok(scopedDatabase.calls.some(call => call[0] === "eq" && call[1] === "user_id" && call[2] === "learner-1"));
    assert.ok(scopedDatabase.calls.some(call => call[0] === "eq" && call[1] === "provenance->>incidentFamily" && call[2] === "ssh_key_compromise"));
    assert.ok(scopedDatabase.calls.some(call => call[0] === "eq" && call[1] === "provenance->>diversityContractVersion" && call[2] === structural.LINUX_STRUCTURAL_DIVERSITY_VERSION));
    assert.ok(scopedDatabase.calls.some(call => call[0] === "limit" && call[1] === 10));
  });
  test("pre-contract history is separated by an explicit version boundary", () => {
    assert.equal(scopedDatabase.calls.filter(call => call[0] === "from").length, 1);
    assert.equal(scopedDatabase.calls.filter(call => call[0] === "limit").length, 1);
  });
  const malformedCurrentDatabase = database([{ data: [{ id: "broken-current", provenance: { diversityContractVersion: structural.LINUX_STRUCTURAL_DIVERSITY_VERSION } }], error: null }]);
  await assert.rejects(persistence.loadLinuxRecentAcceptedCases(malformedCurrentDatabase, "learner-1", "ssh_key_compromise"), /HISTORY_MISSING/);
  test("current-contract history with a missing fingerprint fails closed", () => assert.equal(malformedCurrentDatabase.calls.filter(call => call[0] === "from").length, 1));
  const failedDatabase = database([{ data: null, error: { message: "unavailable" } }]);
  await assert.rejects(persistence.loadLinuxRecentAcceptedCases(failedDatabase, "learner-1", "ssh_key_compromise"), /HISTORY_READ_FAILED/);
  test("history read failures cannot be treated as empty history", () => assert.equal(failedDatabase.calls.filter(call => call[0] === "from").length, 1));
  console.log(`Patch B foundation checks passed (${passed} assertions). Full Patch B acceptance additionally requires the ten-seed and production-path matrices.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
