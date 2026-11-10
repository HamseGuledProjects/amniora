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
  const build = path.join(os.tmpdir(), `cyberlab-linux-file-chronology-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withClonedAssets(candidate) {
  return {
    ...candidate,
    assets: clone(candidate.assets),
  };
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing asset ${filePath}`);
  return found;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (quoted && char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function csvRows(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] || "");
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function timestampMs(value) {
  return Date.parse(`${value.replace(" ", "T")}Z`);
}

function timestampPlusSeconds(value, seconds) {
  return new Date(timestampMs(value) + seconds * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function inWindow(timestamp, start, end) {
  return timestamp >= start && timestamp <= end;
}

function rowForRecord(candidate, record) {
  const rows = csvRows(asset(candidate, "assets/runtime/file_access_history.csv").content);
  return rows.find((row) =>
    row.pid === String(record.pid) &&
    row.command === record.renderedCommand &&
    row.path === record.filePath
  );
}

function validateCandidate(candidate, validateLinuxSimulationEvidence) {
  validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
}

function expectThrow(name, fn, pattern) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!new RegExp(pattern, "i").test(message)) {
      throw new Error(`${name}: expected /${pattern}/, got ${message}`);
    }
    console.log(`PASS ${name}`);
    return;
  }
  throw new Error(`${name}: expected failure`);
}

function pass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

function buildFamily(buildLinuxAssetCandidate, family, seedSuffix = "base") {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `file-access-chronology:${family}:${seedSuffix}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty: "Advanced",
          duration: "60 mins",
          title: "CyberLab Asset Pack",
        }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family}`);
}

function buildFamilyDifficulty(buildLinuxAssetCandidate, family, difficulty) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `file-access-chronology:${family}:${difficulty}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
          title: "CyberLab Asset Pack",
        }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    canonicalHistoricalFileAccessRecords,
    validateLinuxSimulationEvidence,
  } = require(path.join(out, "linux", "simulation.js"));

  const matrix = new Map(FAMILIES.map((family) => [
    family,
    buildFamily(buildLinuxAssetCandidate, family),
  ]));

  pass("all 11 incident families validate file-access chronology", () => {
    for (const candidate of matrix.values()) {
      validateCandidate(candidate, validateLinuxSimulationEvidence);
      const records = canonicalHistoricalFileAccessRecords(candidate.simulation);
      for (const record of records) {
        const row = rowForRecord(candidate, record);
        if (!row) throw new Error(`missing row for ${record.sourceCommandId} ${record.filePath}`);
        if (row.timestamp !== record.timestamp) throw new Error(`timestamp drift for ${record.sourceCommandId}`);
        if (row.timestamp < record.allowedStart || row.timestamp > record.allowedEnd) {
          throw new Error(`row outside lifetime for ${record.sourceCommandId}: ${row.timestamp}`);
        }
      }
    }
  });

  pass("background package activity remains at package time", () => {
    const candidate = matrix.get("ssh_bruteforce");
    const records = canonicalHistoricalFileAccessRecords(candidate.simulation)
      .filter((record) => /apt\.systemd\.daily|\/usr\/bin\/apt|apt\s+install/i.test(record.renderedCommand));
    if (records.length === 0) throw new Error("missing package file-access records");
    for (const record of records) {
      const row = rowForRecord(candidate, record);
      if (!row) throw new Error(`missing package row ${record.filePath}`);
      if (row.timestamp !== record.timestamp) throw new Error(`package timestamp drift ${row.timestamp} != ${record.timestamp}`);
      if (inWindow(row.timestamp, candidate.simulation.collection.windowStart, candidate.simulation.collection.windowEnd)) {
        throw new Error(`background package file access moved into incident window: ${row.timestamp}`);
      }
    }
  });

  pass("cron-related file access aligns with cron process lifetime", () => {
    const candidate = matrix.get("cron_persistence");
    const scheduled = candidate.simulation.scheduledExecutions[0];
    if (!scheduled) throw new Error("missing scheduled execution");
    const records = canonicalHistoricalFileAccessRecords(candidate.simulation)
      .filter((record) => record.sourceExecutionId === scheduled.executionId);
    if (records.length === 0) throw new Error("missing scheduled file-access records");
    for (const record of records) {
      const row = rowForRecord(candidate, record);
      if (!row) throw new Error(`missing cron row ${record.filePath}`);
      if (row.timestamp < record.allowedStart || row.timestamp > record.allowedEnd) {
        throw new Error(`cron row outside lifetime ${row.timestamp}`);
      }
    }
  });

  pass("systemd or certbot background activity aligns with source execution", () => {
    const candidates = Array.from(matrix.values());
    const match = candidates
      .flatMap((candidate) => canonicalHistoricalFileAccessRecords(candidate.simulation).map((record) => ({ candidate, record })))
      .find(({ record }) => /certbot|systemctl|apt\.systemd\.daily/i.test(record.renderedCommand));
    if (!match) throw new Error("missing certbot/systemd/package background file access");
    const row = rowForRecord(match.candidate, match.record);
    if (!row) throw new Error("missing background service row");
    if (row.timestamp !== match.record.timestamp) throw new Error("background service timestamp drift");
  });

  pass("multiple accesses from one process are deterministic and ordered", () => {
    const candidate = matrix.get("service_account_misuse");
    const records = canonicalHistoricalFileAccessRecords(candidate.simulation)
      .filter((record) => {
        const command = candidate.simulation.commands.find((item) => item.id === record.sourceCommandId);
        return command && command.affectedFileIds.length >= 3;
      });
    if (records.length < 3) throw new Error("missing multi-access command");
    for (let index = 1; index < records.length; index += 1) {
      if (records[index].sourceCommandId !== records[0].sourceCommandId) break;
      if (records[index].timestamp < records[index - 1].timestamp) throw new Error("multi-access ordering regressed");
    }
  });

  pass("date rollover retains the same source date across package history", () => {
    const candidate = matrix.get("ssh_bruteforce");
    const record = canonicalHistoricalFileAccessRecords(candidate.simulation)
      .find((item) => /apt\.systemd\.daily/i.test(item.renderedCommand));
    if (!record) throw new Error("missing apt daily rollover record");
    const processHistory = asset(candidate, "assets/runtime/process_execution_history.txt").content;
    const fileHistoryRow = rowForRecord(candidate, record);
    if (!fileHistoryRow) throw new Error("missing apt daily file row");
    if (!processHistory.includes(record.allowedStart)) throw new Error("process history missing source timestamp");
    if (fileHistoryRow.timestamp.slice(0, 10) !== record.allowedStart.slice(0, 10)) {
      throw new Error(`date rollover mismatch ${fileHistoryRow.timestamp} vs ${record.allowedStart}`);
    }
  });

  expectThrow("invalid chronology outside source process lifetime is rejected", () => {
    const candidate = withClonedAssets(matrix.get("log_tampering"));
    const record = canonicalHistoricalFileAccessRecords(candidate.simulation)[0];
    const history = asset(candidate, "assets/runtime/file_access_history.csv");
    history.content = history.content.replace(record.timestamp, timestampPlusSeconds(record.allowedEnd, 90));
    validateCandidate(candidate, validateLinuxSimulationEvidence);
  }, "after process lifetime|materially inconsistent");

  expectThrow("unresolved source reference is rejected", () => {
    const candidate = withClonedAssets(matrix.get("data_staging"));
    const history = asset(candidate, "assets/runtime/file_access_history.csv");
    history.content = history.content.replace(/,(\d+),/, ",9999,");
    validateCandidate(candidate, validateLinuxSimulationEvidence);
  }, "unresolved source reference|missing source execution");

  pass("deterministic generation preserves file-access chronology", () => {
    const first = buildFamily(buildLinuxAssetCandidate, "docker_compromise", "determinism");
    const second = buildFamily(buildLinuxAssetCandidate, "docker_compromise", "determinism");
    const firstHistory = asset(first, "assets/runtime/file_access_history.csv").content;
    const secondHistory = asset(second, "assets/runtime/file_access_history.csv").content;
    if (firstHistory !== secondHistory) throw new Error("file-access history changed across identical seed");
  });

  pass("beginner intermediate and advanced Linux generation keep valid chronology", () => {
    for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
      const candidate = buildFamilyDifficulty(buildLinuxAssetCandidate, "ssh_bruteforce", difficulty);
      if (!candidate.assets.length) throw new Error(`${difficulty} generated no assets`);
      const hasHistoricalFileAccess = candidate.assets.some((item) => item.file_path === "assets/runtime/file_access_history.csv");
      if (hasHistoricalFileAccess) validateCandidate(candidate, validateLinuxSimulationEvidence);
    }
  });

  console.log(JSON.stringify({
    passed: true,
    families: FAMILIES,
    matrixSize: matrix.size,
  }, null, 2));
}

main();
