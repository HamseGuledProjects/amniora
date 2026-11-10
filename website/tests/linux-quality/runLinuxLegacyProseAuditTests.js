#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const REPORT = path.join(__dirname, "linuxLegacyProseAudit.json");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-prose-audit-${Date.now()}`);
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

function assertAuditReport() {
  const entries = JSON.parse(fs.readFileSync(REPORT, "utf8"));
  const required = [
    "incident_brief",
    "change_request",
    "maintenance_ticket",
    "security_policy",
    "audit_notes",
    "analyst_working_notes",
    "analyst_questions",
    "risk_register",
    "advanced_risk_register",
    "hardening_checklist",
    "README",
    "DISCLAIMER",
    "setup_script",
    "script_sample",
  ];
  const byType = new Set(entries.map((entry) => entry.documentType));
  for (const documentType of required) {
    if (!byType.has(documentType)) throw new Error(`legacy prose audit missing ${documentType}`);
  }
  for (const [index, entry] of entries.entries()) {
    for (const field of [
      "documentType",
      "file",
      "renderer",
      "section",
      "factSource",
      "canInventFacts",
      "canContradictFacts",
      "canLeakSpoiler",
      "containsSimulatorLanguageRisk",
      "status",
      "notes",
    ]) {
      if (entry[field] === undefined || entry[field] === "") {
        throw new Error(`legacy prose audit entry ${index} missing ${field}`);
      }
    }
    if (!["canonical", "legacy", "mixed"].includes(entry.factSource)) {
      throw new Error(`legacy prose audit entry ${entry.documentType} has invalid factSource`);
    }
    if (!["migrated", "safe_style_only", "requires_fix"].includes(entry.status)) {
      throw new Error(`legacy prose audit entry ${entry.documentType} has invalid status`);
    }
    if (entry.status === "requires_fix") {
      throw new Error(`legacy prose audit entry ${entry.documentType} still requires fix`);
    }
    if ((entry.canInventFacts || entry.canContradictFacts || entry.canLeakSpoiler) && entry.status !== "migrated") {
      throw new Error(`legacy prose audit entry ${entry.documentType} is risky but not migrated`);
    }
  }
  return entries;
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`${filePath} missing`);
  return found;
}

function assertCsvAssets(candidate) {
  for (const csv of candidate.assets.filter((item) => item.file_path.endsWith(".csv"))) {
    const rows = csv.content.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
    if (!rows.length) continue;
    const width = parseCsvLine(rows[0]).length;
    rows.slice(1).forEach((row, index) => {
      const actual = parseCsvLine(row).length;
      if (actual !== width) throw new Error(`${csv.file_path}:${index + 2} CSV width ${actual} != ${width}`);
    });
  }
}

function assertGeneratedProse(candidate) {
  const inWorld = candidate.assets.filter((item) => item.file_path.startsWith("assets/"));
  const joined = inWorld.map((item) => `${item.file_path}\n${item.content}`).join("\n");
  const banned = [
    /\bCyberLab\b/i,
    /generated training key/i,
    /operational task completed/i,
    /Running operational task/i,
    /affected service for\s+CL-LNX/i,
    /\ba application\b/i,
    /\uFFFD/,
  ];
  for (const pattern of banned) {
    const match = joined.match(pattern);
    if (match) throw new Error(`in-world prose leakage: ${match[0]}`);
  }
  assertCsvAssets(candidate);

  const docs = [
    asset(candidate, "assets/evidence/incident_brief.md").content,
    asset(candidate, "assets/docs/change_request.md").content,
    asset(candidate, "assets/docs/maintenance_ticket.md").content,
    asset(candidate, "assets/docs/security_policy.md").content,
    asset(candidate, "assets/evidence/audit_notes.md").content,
    asset(candidate, "assets/evidence/analyst_working_notes.md").content,
  ].join("\n");
  for (const expected of [
    candidate.investigation.incidentId,
    candidate.investigation.ticketId,
    candidate.investigation.changeId,
    candidate.investigation.hostname,
  ]) {
    if (!docs.includes(expected)) throw new Error(`canonical document fact missing: ${expected}`);
  }
  const collection = candidate.simulation.collection.collectedAt;
  for (const document of candidate.simulation.documents) {
    if (document.createdAt > collection) {
      throw new Error(`document ${document.id} timestamp after collection`);
    }
  }
}

function main() {
  const entries = assertAuditReport();
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const candidate = buildLinuxAssetCandidate({ category: "Linux", difficulty: "Advanced", duration: "30 mins", title: "CyberLab Asset Pack" });
  assertGeneratedProse(candidate);
  console.log(JSON.stringify({
    passed: true,
    auditedEntries: entries.length,
    migrated: entries.filter((entry) => entry.status === "migrated").length,
    safeStyleOnly: entries.filter((entry) => entry.status === "safe_style_only").length,
    caseId: candidate.investigation.incidentId,
    score: candidate.assetQuality.score,
  }, null, 2));
}

main();
