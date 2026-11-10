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

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase7-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing ${filePath}`);
  return found;
}

function buildCandidate(buildLinuxAssetCandidate, difficulty = "Advanced", family = "cron_persistence", salt = "base") {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `phase7:${difficulty}:${family}:${salt}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
          title: "Amniora Linux Investigation",
        }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${difficulty} ${family}`);
}

function expectValid(name, report) {
  if (report.status !== "valid") {
    throw new Error(`${name}: expected valid, got ${report.issues.map((issue) => `${issue.code}:${issue.detail || issue.message}`).join("; ")}`);
  }
  console.log(`PASS ${name}`);
}

function expectCode(name, report, code) {
  const codes = report.issues.map((issue) => issue.code);
  if (report.status === "valid" || !codes.includes(code)) {
    throw new Error(`${name}: expected ${code}, got ${codes.join(",") || "valid"}`);
  }
  console.log(`PASS ${name}`);
}

function appendLines(candidate, filePath, lines) {
  const target = asset(candidate, filePath);
  target.content = `${target.content.trim()}\n${lines.join("\n")}\n`;
}

function authBurstLines(candidate, count) {
  const start = candidate.investigation.incidentDate;
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    const minute = String(8 + Math.floor(i / 40)).padStart(2, "0");
    const second = String(i % 40).padStart(2, "0");
    lines.push(`${start} 03:${minute}:${second} ${candidate.investigation.hostname} sshd[${6000 + i}]: Accepted publickey for bluelead from 10.20.30.40 port 51022 ssh2`);
  }
  return lines;
}

function repeatedBundleLines(candidate, count) {
  const host = candidate.investigation.hostname;
  const date = candidate.investigation.incidentDate;
  const bundle = [];
  for (let i = 0; i < count; i += 1) {
    bundle.push(`${date} 02:${String(i % 50).padStart(2, "0")}:00 ${host} CRON[7000]: (root) CMD (logger cache)`);
    bundle.push(`${date} 02:${String(i % 50).padStart(2, "0")}:01 ${host} systemd[7000]: Started user runtime directory for cache.`);
    bundle.push(`${date} 02:${String(i % 50).padStart(2, "0")}:02 ${host} dbus-daemon[7000]: apparmor="DENIED" operation="dbus_signal" label="cache"`);
    bundle.push(`${date} 02:${String(i % 50).padStart(2, "0")}:03 ${host} NetworkManager[7000]: state change: connected -> connected reason=cache`);
    bundle.push(`${date} 02:${String(i % 50).padStart(2, "0")}:04 ${host} kernel: audit: apparmor="STATUS" operation="profile_replace" profile="cache"`);
  }
  return bundle;
}

function run() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { checkLinuxInvestigationQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const {
    buildLinuxNoiseQualityReport,
    buildLinuxBackgroundActivities,
  } = require(path.join(out, "linux", "backgroundActivity.js"));

  const beginner = buildCandidate(buildLinuxAssetCandidate, "Beginner", "misconfigured_sudoers", "clean");
  const intermediate = buildCandidate(buildLinuxAssetCandidate, "Intermediate", "cron_persistence", "clean");
  const advanced = buildCandidate(buildLinuxAssetCandidate, "Advanced", "docker_compromise", "clean");

  expectValid("Beginner generated noise quality", buildLinuxNoiseQualityReport({ simulation: beginner.simulation, assets: beginner.assets, difficulty: "Beginner" }));
  expectValid("Intermediate generated noise quality", buildLinuxNoiseQualityReport({ simulation: intermediate.simulation, assets: intermediate.assets, difficulty: "Intermediate" }));
  expectValid("Advanced generated noise quality", buildLinuxNoiseQualityReport({ simulation: advanced.simulation, assets: advanced.assets, difficulty: "Advanced" }));

  const integrated = checkLinuxInvestigationQuality({
    context: intermediate.investigation,
    assets: intermediate.assets,
    simulation: intermediate.simulation,
  });
  if (!integrated.passed) {
    throw new Error(`integrated quality unexpectedly failed: ${integrated.issues.map((issue) => issue.description).join("; ")}`);
  }
  console.log("PASS integrated quality accepts bounded generated noise");

  const authBurst = clone(intermediate);
  appendLines(authBurst, "assets/logs/auth.log", authBurstLines(authBurst, 240));
  expectCode("reviewed eleven-minute auth burst fails", buildLinuxNoiseQualityReport({ simulation: authBurst.simulation, assets: authBurst.assets, difficulty: "Intermediate" }), "LINUX_NOISE_AUTH_DENSITY_INVALID");

  const repeated = clone(intermediate);
  appendLines(repeated, "assets/logs/syslog", repeatedBundleLines(repeated, 24));
  expectCode("mechanically repeated bundle fails", buildLinuxNoiseQualityReport({ simulation: repeated.simulation, assets: repeated.assets, difficulty: "Intermediate" }), "LINUX_NOISE_TEMPLATE_REPETITION_EXCEEDED");

  const pidCollision = clone(advanced);
  pidCollision.simulation.processes.push({ ...pidCollision.simulation.processes[0], id: "process:phase7:duplicate" });
  expectCode("duplicate PID fails", buildLinuxNoiseQualityReport({ simulation: pidCollision.simulation, assets: pidCollision.assets, difficulty: "Advanced" }), "LINUX_NOISE_PROCESS_COLLISION");

  const portCollision = clone(advanced);
  portCollision.simulation.sshSessions.push({ ...portCollision.simulation.sshSessions[0], id: "ssh:phase7:duplicate-tuple" });
  expectCode("duplicate SSH connection tuple fails", buildLinuxNoiseQualityReport({ simulation: portCollision.simulation, assets: portCollision.assets, difficulty: "Advanced" }), "LINUX_NOISE_CONNECTION_COLLISION");

  const badActivities = buildLinuxBackgroundActivities(beginner.simulation);
  badActivities.push({
    activityId: "background:phase7:bad-db",
    activityType: "scheduled_execution",
    roleContext: beginner.investigation.hostRole,
    cause: "database_operation",
    startedAt: beginner.simulation.collection.windowStart,
    processIds: [beginner.simulation.processes[0].id],
    executionIds: [],
    sessionIds: [],
    fileAccessIds: [],
    serviceTransitionIds: [],
    networkConnectionIds: [],
    packageTransactionIds: [],
    expectedArtifacts: ["assets/logs/syslog"],
    relevance: "operational_baseline",
    sourceActivityId: "phase7:bad-db",
  });
  expectCode("role-mismatched database activity fails", buildLinuxNoiseQualityReport({ simulation: beginner.simulation, assets: beginner.assets, difficulty: "Beginner", activities: badActivities }), "LINUX_NOISE_ROLE_MISMATCH");

  const buried = clone(beginner);
  const firstTask = buried.simulation.canonicalTasks[0];
  firstTask.primarySubjectIds = ["subject:phase7:missing"];
  firstTask.supportingSubjectIds = [];
  firstTask.canonicalObjectIds = [];
  appendLines(buried, "assets/logs/syslog", Array.from({ length: 1000 }, (_, i) => `${buried.investigation.incidentDate} 01:${String(i % 60).padStart(2, "0")}:00 ${buried.investigation.hostname} rsyslogd[9000]: unrelated bounded volume ${i}`));
  expectCode("Beginner signal burial fails", buildLinuxNoiseQualityReport({ simulation: buried.simulation, assets: buried.assets, difficulty: "Beginner" }), "LINUX_NOISE_SIGNAL_RATIO_INVALID");

  for (const target of [
    "assets/logs/auth.log",
    "assets/logs/syslog",
    "assets/logs/audit.log",
    "assets/journal/journal_ssh.txt",
  ].filter((filePath) => intermediate.assets.some((item) => item.file_path === filePath))) {
    const sentinel = clone(intermediate);
    appendLines(sentinel, target, [`${sentinel.investigation.incidentDate} 01:00:00 ${sentinel.investigation.hostname} definitely-not-a-command fixture-only`]);
    expectCode(`sentinel leak fails in ${target}`, buildLinuxNoiseQualityReport({ simulation: sentinel.simulation, assets: sentinel.assets, difficulty: "Intermediate" }), "LINUX_NOISE_TEST_SENTINEL_LEAK");
  }

  const matrix = [];
  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    for (const family of FAMILIES) {
      const candidate = buildCandidate(buildLinuxAssetCandidate, difficulty, family, "matrix");
      const report = buildLinuxNoiseQualityReport({ simulation: candidate.simulation, assets: candidate.assets, difficulty });
      if (report.status !== "valid") {
        throw new Error(`matrix ${difficulty}/${family} failed: ${report.issues.map((issue) => issue.code).join(",")}`);
      }
      matrix.push({
        difficulty,
        family,
        role: candidate.investigation.hostRole,
        activities: report.activityCounts,
        eventsPerMinute: report.eventsPerMinute,
        uniqueTemplateRatio: report.templateDiversity.uniqueTemplateRatio,
      });
    }
  }
  const coveredFamilies = new Set(matrix.map((item) => item.family));
  if (coveredFamilies.size !== FAMILIES.length) {
    throw new Error(`matrix did not cover all families: ${[...coveredFamilies].join(",")}`);
  }
  console.log(`PASS role/difficulty/family matrix ${matrix.length} generated candidates`);
}

run();
