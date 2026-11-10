// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const path = require("path");
const { compileIfNeeded, loadModules, buildCandidate, MATRIX } = require("./linuxPhase9AuditUtils");

const out = compileIfNeeded("patch-b-structural-acceptance");
const modules = loadModules(out);
const structural = require(path.join(out, "linux/structuralDiversity.js"));
const recent = require(path.join(out, "linux/recentDiversity.js"));

function buildFirstValidCrossFamilyCandidate(difficulty, family, seed) {
  let lastError;
  const roots = [`patch-b:${family.toLowerCase()}-advanced30`, `phase5-diversity:${family}:${difficulty}`, seed];
  for (const rootSeed of roots) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        return buildCandidate(modules, difficulty, family, `${rootSeed}:${attempt}`, { duration: 30 }).simulation;
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError || new Error(`cross-family candidate pool exhausted for ${family}`);
}

async function main() {
  const results = [];
  // Exercise the production contract: each requested case gets one stable
  // seed and a bounded deterministic sequence of structural attempts. A case
  // is retained only when the real recent-history gate accepts it.
  const families = process.env.PATCH_B_FAMILY
    ? [process.env.PATCH_B_FAMILY]
    : ["misconfigured_sudoers", "ssh_key_compromise", "ssh_bruteforce"];
  for (const family of families) {
    const simulations = [];
    const acceptedSeeds = [];
    const history = [];
    let failedBuilds = 0;
    let diversityRejections = 0;
    let seedCursor = 0;
    for (let caseIndex = 0; caseIndex < 10; caseIndex++) {
      let acceptedSeed = "";
      let selected;
      try { selected = await recent.selectLinuxRecentDistinctCandidate({
        budget: 8,
        loadHistory: async () => history,
        build() {
          while (seedCursor < 1200) {
            const seedText = `patch-b:structural:${family}:${seedCursor++}`;
            try {
              const candidate = buildCandidate(modules, "Advanced", family, seedText, { duration: 30 });
              acceptedSeed = seedText;
              return candidate;
            } catch {
              failedBuilds++;
            }
          }
          throw new Error(`same-family candidate pool exhausted for ${family}`);
        },
      }); } catch (error) {
        throw new Error(`${family} case ${caseIndex} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      diversityRejections += selected.attempts - 1;
      simulations.push(selected.candidate.simulation);
      acceptedSeeds.push(`${acceptedSeed}:diversity-attempt-${selected.attempts - 1}`);
      history.unshift({
        acceptedId: `${family}-${caseIndex}`,
        family,
        fingerprint: selected.review.fingerprint,
      });
    }
    const report = structural.validateLinuxStructuralDiversityBatch(simulations);
    results.push({ family, acceptedSeeds, failedBuilds, diversityRejections, count: simulations.length, minimum: report.minimumDistinctiveness, average: report.averageDistinctiveness,
      sessionCounts: simulations.map((simulation) => simulation.sshSessions.length),
      commandCounts: simulations.map((simulation) => simulation.commands.filter((command) => command.kind.endsWith("incident")).length),
      passed: simulations.length === 10 && report.passed, issues: report.issues });
  }
  const cross = MATRIX
    .filter(([difficulty]) => difficulty === "Advanced")
    .map(([difficulty, family, seed]) => buildFirstValidCrossFamilyCandidate(difficulty, family, seed));
  const crossReport = structural.validateLinuxStructuralDiversityBatch(cross);
  console.log(JSON.stringify({ sameFamily: results, crossFamily: { minimum: crossReport.minimumDistinctiveness, average: crossReport.averageDistinctiveness, passed: crossReport.passed, issues: crossReport.issues } }, null, 2));
  if (results.some((result) => !result.passed) || !crossReport.passed) {
    console.error("PATCH B STRUCTURAL ACCEPTANCE: NO-GO. Keep the 4.0 minimum / 5.5 average thresholds; repair the generator, not the measurements.");
    process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
