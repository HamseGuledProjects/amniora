#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const strict = process.argv.includes("--strict");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-fuzz-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
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

function assertCsv(asset) {
  const rows = asset.content.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (!rows.length) return;
  const width = parseCsvLine(rows[0]).length;
  rows.slice(1).forEach((row, index) => {
    const actual = parseCsvLine(row).length;
    if (actual !== width) throw new Error(`${asset.file_path}:${index + 2} CSV width ${actual} != ${width}`);
  });
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`${filePath} missing`);
  return found;
}

function assertNoBadText(candidate) {
  const joined = candidate.assets
    .filter((item) => item.file_path.startsWith("assets/"))
    .map((item) => `${item.file_path}\n${item.content}`)
    .join("\n");
  if (/\uFFFD/.test(joined)) throw new Error("Unicode replacement character rendered");
  if (/Invalid Date|NaN/.test(joined)) throw new Error("malformed timestamp token rendered");
  if (/\bCyberLab\b/i.test(joined.replace(/assets\/(?:README|DISCLAIMER|manifest)[^\n]*\n[^\n]*/gi, ""))) {
    throw new Error("simulator/product wording leaked into in-world assets");
  }
  candidate.assets.filter((item) => item.file_path.endsWith(".csv")).forEach(assertCsv);
}

function assertIdentity(candidate, username) {
  const users = asset(candidate, "assets/csv/users.csv").content;
  const passwd = asset(candidate, "assets/accounts/passwd.sample").content;
  const auth = asset(candidate, "assets/logs/auth.log").content;
  const sudo = asset(candidate, "assets/logs/sudo.log").content;
  const processSnapshot = asset(candidate, "assets/runtime/process_snapshot.txt").content;
  if (!users.includes(`${username},`)) throw new Error(`${username} missing from users.csv`);
  if (!passwd.includes(`${username}:x:`)) throw new Error(`${username} missing from passwd.sample`);
  if (![auth, sudo, processSnapshot].some((content) => content.includes(username))) {
    throw new Error(`${username} missing from SSH/sudo/process evidence`);
  }
}

function assertInventoryIdentity(candidate, username) {
  const users = asset(candidate, "assets/csv/users.csv").content;
  const passwd = asset(candidate, "assets/accounts/passwd.sample").content;
  const groups = asset(candidate, "assets/csv/groups.csv").content;
  if (!users.includes(`${username},`)) throw new Error(`${username} missing from users.csv`);
  if (!passwd.includes(`${username}:x:`)) throw new Error(`${username} missing from passwd.sample`);
  if (!groups.includes(username)) throw new Error(`${username} missing from group inventory`);
}

function assertSourceIp(candidate, sourceIp) {
  const auth = asset(candidate, "assets/logs/auth.log").content;
  const journal = asset(candidate, "assets/journal/journal_ssh.txt").content;
  const joined = candidate.assets.map((item) => item.content).join("\n");
  const sessionUsesSource = candidate.simulation.sshSessions.some((session) => session.sourceIp === sourceIp);
  if (sessionUsesSource && (!auth.includes(sourceIp) || !journal.includes(sourceIp))) {
    throw new Error(`${sourceIp} not rendered consistently in SSH evidence`);
  }
  if (!candidate.investigation.externalIps.includes(sourceIp) || !joined.includes(sourceIp)) {
    throw new Error(`${sourceIp} not preserved in canonical network evidence`);
  }
}

function assertCommand(candidate, command) {
  const sudo = asset(candidate, "assets/logs/sudo.log").content;
  const timeline = asset(candidate, "assets/evidence/timeline.csv").content;
  const processSnapshot = asset(candidate, "assets/runtime/process_snapshot.txt").content;
  const processHistory = asset(candidate, "assets/runtime/process_execution_history.txt").content;
  if (!sudo.includes(command)) throw new Error("sudo.log missing injected command");
  if (!timeline.includes(command.replace(/"/g, "\"\""))) throw new Error("timeline.csv missing injected command");
  const executable = command.split(/\s+/)[0].split("/").pop();
  if (!processSnapshot.includes(executable) && !processHistory.includes(command)) {
    throw new Error("process evidence missing injected command executable");
  }
}

function assertHostname(candidate, hostname) {
  const metadata = asset(candidate, "assets/inventory/host_metadata.json").content;
  const brief = asset(candidate, "assets/evidence/incident_brief.md").content;
  if (!metadata.includes(`"hostname": "${hostname}"`) || !brief.includes(`Host: ${hostname}`)) {
    throw new Error(`${hostname} not rendered consistently`);
  }
}

function assertCollection(candidate, expected) {
  if (candidate.simulation.collection.collectedAt !== expected.replace("T", " ")) {
    throw new Error(`collection override not applied: ${candidate.simulation.collection.collectedAt}`);
  }
}

const validCases = [
  { name: "dotted username", overrides: { primaryUsername: "vendor.linux" }, check: (candidate) => assertIdentity(candidate, "vendor.linux") },
  { name: "hyphenated service account", overrides: { primaryUsername: "svc-backup-prod" }, check: (candidate) => assertIdentity(candidate, "svc-backup-prod") },
  { name: "technical ssh-admin account", overrides: { primaryUsername: "ssh-admin" }, check: (candidate) => assertIdentity(candidate, "ssh-admin") },
  { name: "technical soc-agent account", overrides: { primaryUsername: "soc-agent" }, check: (candidate) => assertIdentity(candidate, "soc-agent") },
  { name: "long valid service account", overrides: { serviceAccountUsername: "svc-customer-backup-prod01" }, check: (candidate) => assertInventoryIdentity(candidate, "svc-customer-backup-prod01") },
  { name: "username with digits", overrides: { primaryUsername: "ops2026" }, check: (candidate) => assertIdentity(candidate, "ops2026") },
  { name: "uid gid boundary", overrides: { primaryUsername: "uidbound", uid: 60000, gid: 59999 }, check: (candidate) => assertIdentity(candidate, "uidbound") },
  { name: "different primary and supplementary groups", overrides: { primaryUsername: "ops-diffgrp", uid: 2500, gid: 2600 }, check: (candidate) => assertIdentity(candidate, "ops-diffgrp") },
  { name: "apostrophe company", overrides: { companyName: "O'Brien Systems" }, check: (candidate) => asset(candidate, "assets/evidence/incident_brief.md").content.includes("O'Brien Systems") || fail("company missing") },
  { name: "hyphen company", overrides: { companyName: "Al-Noor Health" }, check: (candidate) => asset(candidate, "assets/evidence/incident_brief.md").content.includes("Al-Noor Health") || fail("company missing") },
  { name: "ampersand company", overrides: { companyName: "Smith & Co" }, check: (candidate) => asset(candidate, "assets/evidence/incident_brief.md").content.includes("Smith & Co") || fail("company missing") },
  { name: "unicode company", overrides: { companyName: "Café Nord Technologies" }, check: (candidate) => asset(candidate, "assets/evidence/incident_brief.md").content.includes("Café Nord Technologies") || fail("company missing") },
  { name: "possessive company", overrides: { companyName: "St. Anne's Clinical Services" }, check: (candidate) => asset(candidate, "assets/evidence/incident_brief.md").content.includes("St. Anne's Clinical Services") || fail("company missing") },
  { name: "long hostname", overrides: { hostname: "prod-edge-ssh-gateway-blue-001" }, check: (candidate) => assertHostname(candidate, "prod-edge-ssh-gateway-blue-001") },
  { name: "nested role hostname", overrides: { hostname: "eu-west-prod-jump-02" }, check: (candidate) => assertHostname(candidate, "eu-west-prod-jump-02") },
  { name: "rfc1918 source", overrides: { sourceIp: "10.77.44.23" }, check: (candidate) => assertSourceIp(candidate, "10.77.44.23") },
  { name: "public source", overrides: { sourceIp: "203.0.113.45" }, check: (candidate) => assertSourceIp(candidate, "203.0.113.45") },
  { name: "loopback source allowed", overrides: { sourceIp: "127.0.0.1" }, check: (candidate) => assertSourceIp(candidate, "127.0.0.1") },
  { name: "link-local source allowed", overrides: { sourceIp: "169.254.10.20" }, check: (candidate) => assertSourceIp(candidate, "169.254.10.20") },
  { name: "quoted comma command", overrides: { command: "grep 'error,critical' /var/log/app.log" }, check: (candidate) => assertCommand(candidate, "grep 'error,critical' /var/log/app.log") },
  { name: "pipe command", overrides: { command: "sh -c 'cat /etc/group | grep sudo'" }, check: (candidate) => assertCommand(candidate, "sh -c 'cat /etc/group | grep sudo'") },
  { name: "long option command", overrides: { command: "tar --warning=no-file-changed -czf /tmp/customer-export.tar.gz /srv/shared" }, check: (candidate) => assertCommand(candidate, "tar --warning=no-file-changed -czf /tmp/customer-export.tar.gz /srv/shared") },
  { name: "escaped space path", overrides: { command: "stat /srv/customer\\ data/report.txt" }, check: (candidate) => assertCommand(candidate, "stat /srv/customer\\ data/report.txt") },
  { name: "midnight crossing", overrides: { incidentStart: "2026-07-06 23:59:59" } },
  { name: "month rollover", overrides: { incidentStart: "2026-01-31 23:59:59" } },
  { name: "year rollover", overrides: { incidentStart: "2026-12-31 23:59:59" } },
  { name: "leap day", overrides: { incidentStart: "2024-02-29 23:50:00" } },
  { name: "utc timezone", overrides: { timezone: "UTC" } },
  { name: "london dst spring", overrides: { timezone: "Europe/London", incidentStart: "2026-03-29 00:59:59" } },
  { name: "london dst fall", overrides: { timezone: "Europe/London", incidentStart: "2026-10-25 00:59:59" } },
  { name: "collection after latest event", overrides: { incidentStart: "2026-07-06 03:08:00", collectionTime: "2026-07-06 03:22:00" }, check: (candidate) => assertCollection(candidate, "2026-07-06 03:22:00") },
  { name: "markdown and shell metachar company", overrides: { companyName: "Ops *Review* & Co" } },
];

const invalidCases = [
  { name: "empty username", overrides: { primaryUsername: "" } },
  { name: "username newline", overrides: { primaryUsername: "bad\nuser" } },
  { name: "username comma", overrides: { primaryUsername: "bad,user" } },
  { name: "username slash", overrides: { primaryUsername: "bad/user" } },
  { name: "impossible uid", overrides: { primaryUsername: "baduid", uid: 70000 } },
  { name: "impossible gid", overrides: { primaryUsername: "badgid", gid: -1 } },
  { name: "duplicate active uid", overrides: { primaryUsername: "dupeuid", uid: 1000, gid: 2501 } },
  { name: "duplicate username", overrides: { primaryUsername: "sameuser", serviceAccountUsername: "sameuser" } },
  { name: "invalid hostname underscore", overrides: { hostname: "bad_host" } },
  { name: "invalid hostname label", overrides: { hostname: "-badhost" } },
  { name: "invalid ipv4", overrides: { sourceIp: "999.10.10.10" } },
  { name: "ipv6 unsupported limitation", overrides: { sourceIp: "2001:db8::10" }, limitation: "IPv6 source override is explicitly rejected until Linux renderers support IPv6 consistently." },
  { name: "command newline", overrides: { command: "id\nwhoami" } },
  { name: "relative file path", overrides: { filePath: "tmp/file" } },
  { name: "bad collection cutoff", overrides: { incidentStart: "2026-07-06 03:08:00", collectionTime: "2026-07-06 03:08:01" } },
];

function fail(message) {
  throw new Error(message);
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const summary = {
    validInjectedCases: validCases.length,
    validPasses: 0,
    invalidInjectedCases: invalidCases.length,
    invalidRejections: 0,
    crashes: 0,
    parserFailures: 0,
    unicodeFailures: 0,
    csvFailures: 0,
    identityFalsePositives: 0,
    unsupportedFeatureLimitations: [],
    failures: [],
    validResults: [],
    invalidResults: [],
  };

  for (const fuzzCase of validCases) {
    try {
      const candidate = buildLinuxAssetCandidate(
        { category: "Linux", difficulty: "Advanced", duration: "30 mins", title: "CyberLab Asset Pack" },
        { testOverrides: fuzzCase.overrides }
      );
      assertNoBadText(candidate);
      if (!candidate.assetQuality.passed) throw new Error("quality check failed");
      if (fuzzCase.check) fuzzCase.check(candidate);
      summary.validPasses += 1;
      summary.validResults.push({ name: fuzzCase.name, caseId: candidate.investigation.incidentId, score: candidate.assetQuality.score });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CSV|quote|parser/i.test(message)) summary.parserFailures += 1;
      if (/CSV|width|quoted/i.test(message)) summary.csvFailures += 1;
      if (/Unicode|replacement/i.test(message)) summary.unicodeFailures += 1;
      if (/actor|identity|user/i.test(message)) summary.identityFalsePositives += 1;
      summary.failures.push({ kind: "valid", name: fuzzCase.name, message });
    }
  }

  for (const fuzzCase of invalidCases) {
    try {
      buildLinuxAssetCandidate(
        { category: "Linux", difficulty: "Advanced", duration: "30 mins", title: "CyberLab Asset Pack" },
        { testOverrides: fuzzCase.overrides }
      );
      summary.failures.push({ kind: "invalid", name: fuzzCase.name, message: "invalid override was accepted" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (fuzzCase.limitation) summary.unsupportedFeatureLimitations.push(fuzzCase.limitation);
      if (!/rejected|failed|duplicate|after collection|outside|not valid|not supported|validation/i.test(message)) {
        summary.crashes += 1;
        summary.failures.push({ kind: "invalid", name: fuzzCase.name, message });
      } else {
        summary.invalidRejections += 1;
        summary.invalidResults.push({ name: fuzzCase.name, reason: message.slice(0, 180) });
      }
    }
  }

  summary.passed =
    summary.validPasses === summary.validInjectedCases &&
    summary.invalidRejections === summary.invalidInjectedCases &&
    summary.crashes === 0 &&
    summary.parserFailures === 0 &&
    summary.unicodeFailures === 0 &&
    summary.csvFailures === 0 &&
    summary.identityFalsePositives === 0;

  console.log(JSON.stringify(summary, null, 2));
  if (strict && !summary.passed) process.exit(1);
}

main();
