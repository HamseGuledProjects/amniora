// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const path = require("path");
const {
  MATRIX,
  compileIfNeeded,
  loadModules,
  buildCandidate,
  assertionCounter,
} = require("./linuxPhase9AuditUtils");

function cosmeticRename(simulation) {
  const clone = JSON.parse(JSON.stringify(simulation));
  const usernameMap = new Map(
    clone.identities.map((identity, index) => [identity.username, `account-${index + 1}`])
  );
  const renameUser = (username) => usernameMap.get(username) || username;
  clone.identities.forEach((identity, index) => {
    identity.username = renameUser(identity.username);
    identity.id = `renamed-identity-${index + 1}`;
  });
  clone.investigation.primaryUser = renameUser(clone.investigation.primaryUser);
  clone.investigation.adminAccounts = clone.investigation.adminAccounts.map(renameUser);
  clone.investigation.serviceAccounts = clone.investigation.serviceAccounts.map(renameUser);
  clone.investigation.secondaryUsers = clone.investigation.secondaryUsers.map(renameUser);
  clone.investigation.incidentId = "renamed-incident";
  clone.investigation.hostname = "renamed-host";
  clone.investigation.ticketId = "RENAMED-TICKET";
  clone.investigation.changeId = "RENAMED-CHANGE";
  return clone;
}

function buildFirstValidCandidate(modules, difficulty, family, seed, duration = 30) {
  let lastError;
  const roots = [`patch-b:${family.toLowerCase()}-${difficulty.toLowerCase()}${duration}`, seed];
  for (const rootSeed of roots) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        return buildCandidate(modules, difficulty, family, `${rootSeed}:${attempt}`, { duration });
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError || new Error(`structural candidate pool exhausted for ${family}`);
}

function main() {
  const out = compileIfNeeded("structural-diversity");
  const modules = loadModules(out);
  const structural = require(path.join(out, "linux", "structuralDiversity.js"));
  const t = assertionCounter();

  const advancedCandidates = MATRIX
    .filter(([difficulty]) => difficulty === "Advanced")
    .map(([difficulty, family, seed]) => buildFirstValidCandidate(modules, difficulty, family, seed, 30));
  const crossFamily = structural.validateLinuxStructuralDiversityBatch(
    advancedCandidates.map((candidate) => candidate.simulation)
  );
  t.assert("Advanced cross-family structural batch passes", crossFamily.passed, JSON.stringify(crossFamily.issues));
  t.assert("Advanced cross-family minimum improves on the 2.0/10 reskin baseline", crossFamily.minimumDistinctiveness >= 4);
  t.assert("Advanced cross-family average exceeds the Bible fresh-pair floor", crossFamily.averageDistinctiveness >= 5.7);

  const sameFamilySeeds = [0, 5, 10, 18, 23, 26, 27, 29, 31, 32];
  const sameFamilyCandidates = sameFamilySeeds.map((index) =>
    buildCandidate(modules, "Advanced", "ssh_bruteforce", `patch-b:structural:ssh_bruteforce:${index}`, { duration: 30 })
  );
  const sameFamily = structural.validateLinuxStructuralDiversityBatch(
    sameFamilyCandidates.map((candidate) => candidate.simulation)
  );
  t.assert("Same-family batch is structurally distinct", sameFamily.passed, JSON.stringify(sameFamily.issues));
  t.assert("Same-family minimum is not a renamed reskin", sameFamily.minimumDistinctiveness >= 4);
  t.assert("Same-family average meets the structural diversity gate", sameFamily.averageDistinctiveness >= 5.5);

  const reference = sameFamilyCandidates[0].simulation;
  const repeated = structural.buildLinuxStructuralFingerprint(reference);
  t.assert(
    "Structural fingerprint is deterministic",
    repeated.canonical === structural.buildLinuxStructuralFingerprint(reference).canonical
  );
  const renamed = cosmeticRename(reference);
  const renamedFingerprint = structural.buildLinuxStructuralFingerprint(renamed);
  t.assert("Cosmetic names and IDs do not count as diversity", repeated.canonical === renamedFingerprint.canonical);
  const renamedComparison = structural.compareLinuxStructuralFingerprints(repeated, renamedFingerprint);
  t.assert("Cosmetic-only clone scores zero distinctiveness", renamedComparison.overallDistinctiveness === 0);
  const rejectedReskin = structural.validateLinuxStructuralDiversityBatch([reference, renamed]);
  t.assert(
    "Cosmetic-only clone is rejected as a structural reskin",
    !rejectedReskin.passed && rejectedReskin.issues.some((issue) => issue.code === "LINUX_STRUCTURAL_RESKIN")
  );

  const profiles = advancedCandidates.map((candidate) => candidate.simulation.diversityProfile);
  t.assert("Advanced cases vary investigation windows", new Set(profiles.map((profile) => profile.windowMinutes)).size >= 3);
  t.assert("Advanced cases vary chronology shapes", new Set(profiles.map((profile) => profile.chronologyShape)).size >= 3);
  t.assert("Advanced cases vary reasoning paths", new Set(profiles.map((profile) => profile.taskPath)).size >= 3);
  t.assert("Advanced cases vary identity layouts", new Set(profiles.map((profile) => profile.identityLayout)).size >= 3);
  t.assert("Advanced cases vary terminal allocation", new Set(profiles.map((profile) => profile.tty)).size >= 3);
  t.assert("Advanced cases vary enterprise background activity", new Set(profiles.map((profile) => profile.noiseRotation)).size >= 4);

  for (const candidate of advancedCandidates) {
    const report = candidate.assetQuality.workloadReport;
    t.assert(
      `${candidate.simulation.investigation.incidentFamily} avoids 30-minute file-count inflation`,
      report.metrics.totalPackFileCount <= 44 && report.metrics.renderedEvidenceAssetCount <= 40,
      JSON.stringify(report.metrics)
    );
    t.assert(
      `${candidate.simulation.investigation.incidentFamily} derives Advanced depth from synthesis`,
      report.metrics.synthesisTaskCount >= report.metrics.taskCount - 1,
      JSON.stringify(report.metrics)
    );
  }

  const difficultyCandidates = MATRIX
    .filter(([, family]) => family === "ssh_bruteforce")
    .map(([difficulty, family, seed]) => buildFirstValidCandidate(modules, difficulty, family, seed, 30));
  const byDifficulty = new Map(difficultyCandidates.map((candidate) => [
    candidate.simulation.canonicalTasks[0].difficulty,
    candidate.assetQuality.workloadReport,
  ]));
  const beginner = byDifficulty.get("Beginner");
  const intermediate = byDifficulty.get("Intermediate");
  const advanced = byDifficulty.get("Advanced");
  t.assert("Difficulty calibration candidates exist", Boolean(beginner && intermediate && advanced));
  t.assert(
    "Advanced requires more cross-file synthesis than Beginner",
    advanced.metrics.crossFileCorrelationCount > beginner.metrics.crossFileCorrelationCount
  );
  t.assert(
    "Advanced has greater cross-file synthesis density than Intermediate",
    advanced.metrics.crossFileCorrelationCount / advanced.metrics.taskCount >
      intermediate.metrics.crossFileCorrelationCount / intermediate.metrics.taskCount
  );
  t.assert(
    "Advanced synthesis covers nearly every task",
    advanced.metrics.synthesisTaskCount >= advanced.metrics.taskCount - 1
  );

  console.log(JSON.stringify({
    before: {
      severeReskinPair: 2.0,
      freshPairRange: [5.7, 6.7],
      advancedFileRange: [51, 54],
    },
    after: {
      crossFamilyMinimum: crossFamily.minimumDistinctiveness,
      crossFamilyAverage: crossFamily.averageDistinctiveness,
      sameFamilyMinimum: sameFamily.minimumDistinctiveness,
      sameFamilyAverage: sameFamily.averageDistinctiveness,
      advancedFileRange: [
        Math.min(...advancedCandidates.map((candidate) => candidate.assets.length)),
        Math.max(...advancedCandidates.map((candidate) => candidate.assets.length)),
      ],
    },
  }, null, 2));
  console.log(`Linux structural diversity tests passed (${t.summary.assertionsExecuted} assertions).`);
}

main();
