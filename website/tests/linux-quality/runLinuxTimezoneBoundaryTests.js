#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-timezone-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function timestampValue(line) {
  const iso = line.match(/(20\d{2}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (iso) return Date.parse(`${iso[1]}T${iso[2]}Z`);
  const syslog = line.match(/^[A-Z][a-z]{2}\s+\d{1,2}\s+(\d{2}):(\d{2}):(\d{2})/);
  if (syslog) return Number(syslog[1]) * 3600 + Number(syslog[2]) * 60 + Number(syslog[3]);
  return null;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quoted) throw new Error(`unterminated quoted CSV field: ${line}`);
  values.push(current);
  return values;
}

function assertChronological(asset) {
  const stamps = asset.content.split(/\r?\n/).map(timestampValue).filter((value) => value !== null);
  for (let index = 1; index < stamps.length; index += 1) {
    if (stamps[index] < stamps[index - 1]) throw new Error(`${asset.file_path} timestamp order regressed`);
  }
}

function assertTimeline(candidate) {
  const timeline = candidate.assets.find((asset) => asset.file_path === "assets/evidence/timeline.csv");
  if (!timeline) throw new Error("timeline.csv missing");
  const rows = timeline.content.trim().split(/\r?\n/);
  const header = parseCsvLine(rows[0]);
  const timestampIndex = header.indexOf("timestamp");
  let previous = "";
  rows.slice(1).forEach((rowText, index) => {
    const row = parseCsvLine(rowText);
    const stamp = row[timestampIndex];
    if (!/20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(stamp)) {
      throw new Error(`timeline row ${index + 2} malformed timestamp ${stamp}`);
    }
    if (previous && stamp < previous) throw new Error(`timeline row ${index + 2} not chronological`);
    previous = stamp;
  });
}

const boundaryCases = [
  "235959-next-day",
  "month-end",
  "year-end",
  "leap-day",
  "dst-forward-europe",
  "dst-backward-europe",
  "utc-local-rendering",
  "collection-equals-latest-event",
  "collection-one-second-too-early",
  "maintenance-crossing-midnight",
];

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const results = [];
  for (const name of boundaryCases) {
    const candidate = buildLinuxAssetCandidate({
          seed: `phase5b-timezone:${name}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux", difficulty: "Advanced", duration: "60 mins", title: "CyberLab Asset Pack" });
    candidate.assets
      .filter((asset) => /assets\/(?:logs|journal)\//.test(asset.file_path))
      .forEach(assertChronological);
    assertTimeline(candidate);
    if (!candidate.assetQuality.passed) throw new Error(`${name}: generated candidate did not pass quality`);
    results.push({
      name,
      caseId: candidate.investigation.incidentId,
      family: candidate.investigation.incidentFamily,
      timezone: candidate.investigation.timezone,
      window: `${candidate.investigation.incidentWindowStart}-${candidate.investigation.incidentWindowEnd}`,
    });
  }
  console.log(JSON.stringify({ passed: true, cases: results }, null, 2));
}

main();
