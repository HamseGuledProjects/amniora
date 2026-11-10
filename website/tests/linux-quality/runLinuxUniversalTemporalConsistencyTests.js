#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-temporal-${Date.now()}`);
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

function sha(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing asset ${filePath}`);
  return found;
}

function timestampMsUtc(value) {
  const ms = Date.parse(`${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(ms)) throw new Error(`invalid UTC timestamp ${value}`);
  return ms;
}

function timestamps(content) {
  return Array.from(content.matchAll(/\b20\d\d-\d\d-\d\d \d\d:\d\d:\d\d\b/g)).map((match) => match[0]);
}

function buildCandidate(buildLinuxAssetCandidate, family, difficulty, overrides, seedSuffix = "base") {
  let lastError;
  for (let attempt = 0; attempt < 220; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        seed: `phase-temporal:${family}:${difficulty}:${seedSuffix}:${attempt}`,
        generationTime: "2026-08-12T10:00:00.000Z",
        category: "Linux",
        difficulty,
        duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
        title: "Amniora Linux Temporal Regression",
      }, { incidentFamily: family, testOverrides: overrides });
      if (candidate.assetQuality?.passed) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function assertAdvancedLondonProductionShape(modules) {
  const candidate = buildCandidate(modules.buildLinuxAssetCandidate, "systemd_persistence", "Advanced", {
    timezone: "Europe/London",
    incidentStart: "2026-07-06 03:08:00",
    hostname: "web-front-04",
  }, "advanced-bst-production");
  assert("production regression family is Advanced systemd", candidate.investigation.incidentFamily === "systemd_persistence" && candidate.investigation.hostname === "web-front-04");
  assert("learner window remains Europe/London", candidate.investigation.incidentWindowStart === "03:08" && candidate.investigation.incidentWindowEnd === "03:19" && candidate.investigation.timezone === "Europe/London");

  const startMs = modules.time.linuxLocalDateTimeToUtcMs("2026-07-06 03:08:00", "Europe/London");
  const endMs = modules.time.linuxLocalDateTimeToUtcMs("2026-07-06 03:19:00", "Europe/London");
  assert("BST converts declared local window to UTC instants", modules.time.formatLinuxUtcTimestamp(startMs) === "2026-07-06 02:08:00" && modules.time.formatLinuxUtcTimestamp(endMs) === "2026-07-06 02:19:00");
  assert("old raw-clock equality is rejected", timestampMsUtc("2026-07-06 03:08:00") !== startMs && timestampMsUtc("2026-07-06 03:08:00") > endMs);

  const journalSsh = asset(candidate, "assets/journal/journal_ssh.txt").content;
  const journalSystemd = asset(candidate, "assets/journal/journal_systemd.txt").content;
  assert("journal SSH header declares UTC source time", /-- Journal begins at 2026-07-06 02:08:00 UTC --/.test(journalSsh), journalSsh.split(/\r?\n/)[0]);
  assert("journal systemd header declares UTC source time", /-- Journal begins at .* UTC --/.test(journalSystemd), journalSystemd.split(/\r?\n/)[0]);

  const central = [
    ...candidate.simulation.sshSessions.map((session) => session.openedAt),
    ...candidate.simulation.serviceTransitions.map((transition) => transition.occurredAt),
    ...candidate.simulation.commands.filter((command) => command.kind === "primary_incident").map((command) => command.timestamp),
  ];
  assert("central event set exists", central.length >= 3, JSON.stringify(central));
  for (const stamp of central) {
    const ms = timestampMsUtc(stamp);
    assert(`central event ${stamp} is inside normalized window`, ms >= startMs && ms <= endMs, `${stamp} outside ${modules.time.formatLinuxUtcTimestamp(startMs)}..${modules.time.formatLinuxUtcTimestamp(endMs)}`);
  }

  const collectionMs = timestampMsUtc(candidate.simulation.collection.collectedAt);
  const latestCentral = Math.max(...central.map(timestampMsUtc));
  assert("collection occurs after central events", collectionMs > latestCentral, `${candidate.simulation.collection.collectedAt} <= latest event`);
  const manifest = JSON.parse(asset(candidate, "manifest.json").content);
  const metadata = JSON.parse(asset(candidate, "assets/inventory/host_metadata.json").content);
  assert("manifest generated_at is no earlier than collection", Date.parse(manifest.generated_at) >= collectionMs, manifest.generated_at);
  assert("host metadata collection matches simulation collection", metadata.collected_at === `${candidate.simulation.collection.collectedAt.replace(" ", "T")}Z`, JSON.stringify(metadata));

  for (const log of [journalSsh, journalSystemd, asset(candidate, "assets/evidence/timeline.csv").content]) {
    for (const stamp of timestamps(log)) {
      assert(`rendered timestamp ${stamp} remains parseable UTC`, Number.isFinite(timestampMsUtc(stamp)));
    }
  }

  const solvability = modules.validateLinuxStudentTaskSolvability(candidate.simulation, candidate.assets);
  assert("Advanced production temporal shape remains task-local solvable", solvability.passed, JSON.stringify(solvability.issues));
  assert("Advanced production shape keeps seven tasks", candidate.simulation.canonicalTasks.length === 7, String(candidate.simulation.canonicalTasks.length));

  return {
    caseId: candidate.investigation.incidentId,
    window: `${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd} ${candidate.investigation.timezone}`,
    utcWindow: `${modules.time.formatLinuxUtcTimestamp(startMs)}-${modules.time.formatLinuxUtcTimestamp(endMs)}`,
    hash: sha({
      journalSsh: asset(candidate, "assets/journal/journal_ssh.txt").content,
      journalSystemd: asset(candidate, "assets/journal/journal_systemd.txt").content,
      timeline: asset(candidate, "assets/evidence/timeline.csv").content,
    }),
  };
}

function assertTemporalMatrix(modules) {
  const rows = [
    ["UTC local equals UTC", "2026-07-06 03:08:00", "UTC", "2026-07-06 03:08:00"],
    ["London summer uses BST", "2026-07-06 03:08:00", "Europe/London", "2026-07-06 02:08:00"],
    ["London winter uses GMT", "2026-01-06 03:08:00", "Europe/London", "2026-01-06 03:08:00"],
    ["local midnight changes UTC date", "2026-07-06 00:30:00", "Europe/London", "2026-07-05 23:30:00"],
    ["weekday changes after conversion", "2026-07-06 00:05:00", "Europe/London", "2026-07-05 23:05:00"],
    ["autumn repeated hour is deterministic earliest instant", "2026-10-25 01:30:00", "Europe/London", "2026-10-25 00:30:00"],
  ];
  for (const [name, local, zone, expectedUtc] of rows) {
    const ms = modules.time.linuxLocalDateTimeToUtcMs(local, zone);
    assert(name, modules.time.formatLinuxUtcTimestamp(ms) === expectedUtc, `${local} ${zone} -> ${modules.time.formatLinuxUtcTimestamp(ms)}`);
  }
  assert("spring-forward nonexistent local time fails closed", !Number.isFinite(modules.time.linuxLocalDateTimeToUtcMs("2026-03-29 01:30:00", "Europe/London")));
  assert("invalid IANA timezone fails closed", !Number.isFinite(modules.time.linuxLocalDateTimeToUtcMs("2026-07-06 03:08:00", "Mars/Base")));

  const builds = [
    ["Beginner", "ssh_bruteforce", "UTC", "2026-07-06 03:08:00"],
    ["Intermediate", "cron_persistence", "Europe/London", "2026-01-06 03:08:00"],
    ["Advanced", "systemd_persistence", "Europe/London", "2026-07-06 03:08:00"],
  ];
  const productionRows = [];
  for (const [difficulty, family, timezone, incidentStart] of builds) {
    const first = buildCandidate(modules.buildLinuxAssetCandidate, family, difficulty, { timezone, incidentStart }, `matrix-${difficulty}`);
    const second = buildCandidate(modules.buildLinuxAssetCandidate, family, difficulty, { timezone, incidentStart }, `matrix-${difficulty}`);
    assert(`${difficulty}/${family} asset quality passes`, first.assetQuality.passed, JSON.stringify(first.assetQuality.issues));
    assert(`${difficulty}/${family} task-local solvability passes`, modules.validateLinuxStudentTaskSolvability(first.simulation, first.assets).passed);
    const firstHash = sha(first.assets.map((item) => [item.file_path, item.content]));
    const secondHash = sha(second.assets.map((item) => [item.file_path, item.content]));
    assert(`${difficulty}/${family} same seed temporal output deterministic`, firstHash === secondHash, `${firstHash} !== ${secondHash}`);
    productionRows.push({ difficulty, family, timezone, hash: firstHash });
  }
  return productionRows;
}

function main() {
  const out = compileIfNeeded();
  const linuxOut = path.join(out, "linux");
  const modules = {
    buildLinuxAssetCandidate: require(path.join(linuxOut, "index.js")).buildLinuxAssetCandidate,
    validateLinuxStudentTaskSolvability: require(path.join(linuxOut, "taskSolvability.js")).validateLinuxStudentTaskSolvability,
    time: require(path.join(linuxOut, "time.js")),
  };
  const advanced = assertAdvancedLondonProductionShape(modules);
  const matrix = assertTemporalMatrix(modules);
  console.log(JSON.stringify({ passed: true, advanced, matrix }, null, 2));
}

main();