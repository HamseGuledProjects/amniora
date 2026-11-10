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

let assertions = 0;

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-15-minute-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function buildCandidate(buildLinuxAssetCandidate, family, difficulty, duration, seedPrefix, attemptLimit = 96) {
  let lastError;
  const safeDuration = duration.replace(/\s+/g, "");
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate(
        {
          category: "Linux",
          difficulty,
          duration,
          title: "Amniora Linux duration regression",
          seed: `${seedPrefix}:${family}:${difficulty}:${safeDuration}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
        },
        { incidentFamily: family }
      );
      if (candidate.assetQuality?.passed) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty} ${duration}`);
}

function checkCandidate(candidate, expectedDuration) {
  const report = candidate.assetQuality.workloadReport;
  assert(
    `${candidate.simulation.investigation.incidentFamily} ${expectedDuration} has passing quality`,
    candidate.assetQuality.passed && candidate.assetQuality.issues.length === 0,
    candidate.assetQuality.issues.map((issue) => issue.description).join("; ")
  );
  assert(
    `${candidate.simulation.investigation.incidentFamily} ${expectedDuration} records requested duration`,
    report.requestedDurationMinutes === expectedDuration
  );
  assert(
    `${candidate.simulation.investigation.incidentFamily} ${expectedDuration} estimate stays in range`,
    report.estimatedDurationMinutes >= report.acceptableDurationRange.minimumMinutes &&
      report.estimatedDurationMinutes <= report.acceptableDurationRange.maximumMinutes,
    `${report.estimatedDurationMinutes} not in ${JSON.stringify(report.acceptableDurationRange)}`
  );
  assert(
    `${candidate.simulation.investigation.incidentFamily} ${expectedDuration} simulation stores duration`,
    candidate.simulation.requestedDurationMinutes === expectedDuration
  );
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { checkLinuxLabWorkload } = require(path.join(out, "linux", "workloadCalibration.js"));

  const familyResults = FAMILIES.map((family) => {
    const candidate = buildCandidate(buildLinuxAssetCandidate, family, "Beginner", "15 mins", "duration-15");
    const tasks = candidate.simulation.canonicalTasks.length;
    assert(`${family} 15-minute task count is short`, tasks >= 2 && tasks <= 3, `tasks=${tasks}`);
    checkCandidate(candidate, 15);
    return {
      family,
      tasks,
      assets: candidate.assets.length,
      estimate: candidate.assetQuality.workloadReport.estimatedDurationMinutes,
    };
  });

  const legacyShape = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", "Beginner", "30 mins", "duration-legacy");
  const legacyAsShort = checkLinuxLabWorkload({
    simulation: legacyShape.simulation,
    assets: legacyShape.assets,
    requestedDifficulty: "Beginner",
    requestedDurationMinutes: 15,
  });
  assert(
    "old longer Beginner shape remains rejected for 15 minutes",
    !legacyAsShort.passed && legacyAsShort.issues.some((issue) => issue.code === "LINUX_WORKLOAD_DURATION_OVER_TARGET"),
    legacyAsShort.issues.map((issue) => issue.code).join(", ")
  );

  for (const [difficulty, duration, family] of [
    ["Beginner", "30 mins", "systemd_persistence"],
    ["Intermediate", "45 mins", "cron_persistence"],
    ["Advanced", "60 mins", "docker_compromise"],
  ]) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, family, difficulty, duration, "duration-regression");
    checkCandidate(candidate, Number.parseInt(duration, 10));
  }

  console.log(JSON.stringify({ fifteenMinuteFamilies: familyResults }, null, 2));
  console.log(`Linux 15-minute duration tests passed (${assertions} assertions).`);
}

main();
