#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, execSync } = require("child_process");
const { performance } = require("perf_hooks");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT = path.join(ROOT, ".tmp", "linux-production-stress");

function argValue(name, fallback = null) {
  const flag = `--${name}`;
  const exact = process.argv.find((item) => item.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-prod-stress-${Date.now()}`);
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
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
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
  if (quoted) throw new Error("unterminated quoted CSV field");
  values.push(current);
  return values;
}

function timestampValue(line) {
  // Coverage annotations describe a time interval; they are not log events.
  if (line.trimStart().startsWith("#")) return null;
  const iso = line.match(/(20\d{2}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (iso) return Date.parse(`${iso[1]}T${iso[2]}Z`);
  const syslog = line.match(/^[A-Z][a-z]{2}\s+\d{1,2}\s+(\d{2}):(\d{2}):(\d{2})/);
  if (syslog) return Number(syslog[1]) * 3600 + Number(syslog[2]) * 60 + Number(syslog[3]);
  return null;
}

function assetByPath(assets, wanted) {
  return assets.find((asset) => asset.file_path === wanted);
}

function resolveAsset(paths, source) {
  const normalized = source.trim().replace(/^assets\//, "");
  return [...paths].some((candidate) =>
    candidate === source ||
    candidate === `assets/${normalized}` ||
    candidate.endsWith(`/${normalized}`)
  );
}

function assertCandidateProperties(candidate) {
  const assets = candidate.assets;
  const paths = new Set(assets.map((asset) => asset.file_path));
  const context = candidate.investigation;
  const errors = [];

  for (const asset of assets) {
    if (asset.file_path.endsWith(".csv")) {
      const rows = asset.content.trim().split(/\r?\n/).filter(Boolean);
      if (rows.length > 0) {
        const width = parseCsvLine(rows[0]).length;
        rows.slice(1).forEach((row, index) => {
          const actual = parseCsvLine(row).length;
          if (actual !== width) errors.push(`${asset.file_path}:${index + 2} CSV width ${actual} != ${width}`);
        });
      }
    }
    if (/assets\/(?:logs|journal)\//.test(asset.file_path)) {
      const stamps = asset.content.split(/\r?\n/).map(timestampValue).filter((value) => value !== null);
      for (let index = 1; index < stamps.length; index += 1) {
        if (stamps[index] < stamps[index - 1]) errors.push(`${asset.file_path} timestamp order regression`);
      }
    }
  }

  const timeline = assetByPath(assets, "assets/evidence/timeline.csv");
  if (timeline) {
    const rows = timeline.content.trim().split(/\r?\n/);
    const header = parseCsvLine(rows[0]);
    const timeIndex = header.indexOf("timestamp");
    const typeIndex = header.indexOf("evidence_type");
    const eventIndex = header.indexOf("event_id");
    const exactIndex = header.indexOf("exact_sources");
    let previous = "";
    for (const [offset, rowText] of rows.slice(1).entries()) {
      const row = parseCsvLine(rowText);
      const timestamp = row[timeIndex];
      if (previous && timestamp < previous) errors.push(`timeline row ${offset + 2} is not chronological`);
      previous = timestamp;
      if ((row[typeIndex] === "Observed" || row[typeIndex] === "Background") && exactIndex !== -1 && !row[exactIndex]) {
        errors.push(`timeline row ${offset + 2} lacks exact sources`);
      }
      for (const source of String(row[exactIndex] || "").split(/[;|]/).filter(Boolean)) {
        if (!resolveAsset(paths, source)) errors.push(`timeline row ${offset + 2} source ${source} missing`);
      }
      if (eventIndex !== -1 && !row[eventIndex]) errors.push(`timeline row ${offset + 2} lacks event id`);
    }
  }

  const docs = assets
    .filter((asset) => /assets\/(?:docs|evidence|reports)\/.+\.(?:md|csv)$/.test(asset.file_path))
    .map((asset) => asset.content)
    .join("\n")
    .toLowerCase();
  for (const required of [context.hostname, context.company, context.ticketId, context.changeId]) {
    if (required && !docs.includes(String(required).toLowerCase())) {
      errors.push(`documents omit canonical ${required}`);
    }
  }
  if (/root cause is|attacker was|compromised account is|privilege escalation succeeded/.test(docs)) {
    errors.push("direct spoiler wording leaked");
  }

  for (const task of candidate.simulation?.canonicalTasks || []) {
    const evidence = task.selectedEvidenceAssetIds || task.evidenceAssetIds || [];
    if (!evidence.length) errors.push(`canonical task ${task.id} has no evidence`);
  }

  if (errors.length > 0) throw new Error(errors.slice(0, 8).join("; "));
}

function percentile(values, pct) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))];
}

function inc(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function newAttemptAccounting() {
  return {
    builderInvocations: 0,
    internalAttempts: 0,
    internalQualityRejections: 0,
    internalOtherRejections: 0,
    builderAcceptedCandidates: 0,
    postBuilderRejections: 0,
    finalAcceptedCases: 0,
    exhaustedInputs: 0,
    filteredInputs: 0,
    unreportedAttemptInputs: 0,
    maxInternalAttemptsPerInput: 0,
    firstAttemptFinalAcceptedAcrossInputs: 0,
  };
}

function recordAttemptAccounting(totals, { inputId, attemptEvents, builderReturned, finalAccepted, filtered }) {
  totals.builderInvocations += 1;
  const seen = new Set();
  for (const event of attemptEvents) {
    const identity = `${inputId}:${event.attempt}`;
    if (seen.has(identity)) throw new Error(`duplicate internal attempt identity ${identity}`);
    seen.add(identity);
    totals.internalAttempts += 1;
    if (!event.accepted) {
      if (/Linux quality checker failed/i.test(String(event.reason || ""))) totals.internalQualityRejections += 1;
      else totals.internalOtherRejections += 1;
    }
  }
  if (attemptEvents.length === 0) totals.unreportedAttemptInputs += 1;
  totals.maxInternalAttemptsPerInput = Math.max(totals.maxInternalAttemptsPerInput, attemptEvents.length);
  if (builderReturned) totals.builderAcceptedCandidates += 1;
  if (builderReturned && !finalAccepted && !filtered) totals.postBuilderRejections += 1;
  if (!builderReturned) totals.exhaustedInputs += 1;
  if (filtered) totals.filteredInputs += 1;
  if (finalAccepted) {
    totals.finalAcceptedCases += 1;
    if (attemptEvents.length === 1) totals.firstAttemptFinalAcceptedAcrossInputs += 1;
  }
}

function addSet(map, key, value) {
  if (!map[key]) map[key] = new Set();
  map[key].add(value);
}

function sanitizeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 80);
}

function preserveCandidate(root, kind, record, candidate) {
  const dir = path.join(root, kind, sanitizeName(`${record.seed}-${record.caseId}`));
  ensureDir(path.join(dir, "assets"));
  writeJson(path.join(dir, "metadata.json"), record);
  writeJson(path.join(dir, "quality-report.json"), candidate.assetQuality);
  for (const asset of candidate.assets) {
    const target = path.join(dir, "assets", asset.file_path);
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, asset.content);
  }
  try {
    const zip = path.join(dir, "evidence.zip");
    if (process.platform === "win32") {
      execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${path.join(dir, "assets", "*").replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -Force`], { stdio: "ignore" });
    }
  } catch (error) {
    fs.writeFileSync(path.join(dir, "zip-error.txt"), String(error.message || error));
  }
}

function markdownSummary(summary) {
  return `# Linux Production Stress Summary

- accepted: ${summary.accepted}
- first-attempt accepted: ${summary.firstAttemptAccepted}/${summary.accepted} (${summary.firstAttemptAcceptance})
- eventual accepted: ${summary.accepted}/${summary.requestedCount} (${summary.eventualAcceptance})
- raw attempts: ${summary.rawAttempts}
- builder invocations/input sets: ${summary.attemptAccounting.builderInvocations}
- internal quality rejections: ${summary.attemptAccounting.internalQualityRejections}
- internal other rejections: ${summary.attemptAccounting.internalOtherRejections}
- builder-accepted candidates: ${summary.attemptAccounting.builderAcceptedCandidates}
- post-builder rejections: ${summary.attemptAccounting.postBuilderRejections}
- exhausted inputs / unfilled slots: ${summary.attemptAccounting.exhaustedInputs}/${summary.attemptAccounting.unfilledSlots}
- rejection rate (non-final attempts / internal attempts): ${summary.rejectionRate}
- first-attempt final acceptance across input sets: ${summary.attemptAccounting.firstAttemptFinalAcceptedAcrossInputs}/${summary.attemptAccounting.builderInvocations} (${summary.attemptAccounting.firstAttemptFinalAcceptanceAcrossInputs})
- average attempts: ${summary.averageAttempts}
- max attempts: ${summary.maxAttempts}
- execution-first commands: ${summary.executionMigration.executionFirstCommands}
- legacy commands: ${summary.executionMigration.legacyCommands}
- execution-first processes: ${summary.executionMigration.executionFirstProcesses}
- background/system processes: ${summary.executionMigration.backgroundSystemProcesses}
- legacy/unclassified processes: ${summary.executionMigration.legacyUnclassifiedProcesses}
- lifecycle validation failures: ${summary.executionMigration.lifecycleValidationFailures}
- quality-checker lifecycle rejections: ${summary.executionMigration.qualityCheckerLifecycleRejections}
- structurally registered executions: ${summary.executionMigration.builderRegisteredExecutions}
- structurally registered commands: ${summary.executionMigration.builderRegisteredCommands}
- structurally registered processes: ${summary.executionMigration.builderRegisteredProcesses}
- pending lifecycles: ${summary.executionMigration.pendingExecutions}
- post-finalization mutation violations: ${summary.executionMigration.postFinalizationMutationViolations}
- shell-hosted executions: ${summary.executionMigration.shellHostedExecutions}
- incident legacy commands: ${summary.executionMigration.incidentRelevantLegacyCommands}
- incident legacy processes: ${summary.executionMigration.incidentRelevantLegacyProcesses}
- package dpkg legacy processes: ${summary.executionMigration.packageDpkgLegacyProcesses}
- forged-label objects: ${summary.executionMigration.forgedLabelObjects}
- duplicate execution registrations: ${summary.executionMigration.duplicateExecutionRegistrations}
- duplicate command registrations: ${summary.executionMigration.duplicateCommandRegistrations}
- duplicate process registrations: ${summary.executionMigration.duplicateProcessRegistrations}
- invalid registration fingerprints: ${summary.executionMigration.invalidRegistrationFingerprints}
- replaced registry records: ${summary.executionMigration.replacedRegistryRecords}
- registry cardinality violations: ${summary.executionMigration.registryCardinalityViolations}
- authoritative ledger records: ${summary.executionMigration.authoritativeLedgerRecords}
- serialized registry records: ${summary.executionMigration.serializedDiagnosticRecords}
- authoritative/serialized registry mismatches: ${summary.executionMigration.authoritativeSerializedRegistryMismatches}
- generation p50/p90/p95/p99 ms: ${summary.performance.generation.p50}/${summary.performance.generation.p90}/${summary.performance.generation.p95}/${summary.performance.generation.p99}
- validation p50/p90/p95/p99 ms: ${summary.performance.validation.p50}/${summary.performance.validation.p90}/${summary.performance.validation.p95}/${summary.performance.validation.p99}
- highest fingerprint count: ${summary.diversity.highestFingerprintCount}
- task object coverage: ${summary.objectGrounding.taskObjectCoverage}
- required relation coverage: ${summary.objectGrounding.requiredRelationCoverage}
- document material-claim coverage: ${summary.objectGrounding.documentMaterialClaimCoverage}
- risk claim coverage: ${summary.objectGrounding.riskClaimCoverage}
- unrelated task evidence: ${summary.objectGrounding.unrelatedTaskEvidence}
- closure duplicate IDs: ${summary.productionClosure.duplicateCanonicalIds}
- closure missing objects: ${summary.productionClosure.missingLearnerObjects}
- closure rendered subject gaps: ${summary.productionClosure.missingRenderedSubjects}
- closure invalid relations: ${summary.productionClosure.invalidRelations}
- closure snapshot contradictions: ${summary.productionClosure.snapshotContradictions}
- closure network contradictions: ${summary.productionClosure.networkContradictions}
- closure invalid risk rows: ${summary.productionClosure.invalidRiskRows}

## Incident Families

${Object.entries(summary.incidentFamilies).map(([family, item]) => `- ${family}: generated=${item.generated} avgScore=${item.averageScore} minScore=${item.minimumScore} roles=${item.hostRoles.join(", ")}`).join("\n")}

## Host Roles

${Object.entries(summary.hostRoles).map(([role, item]) => `- ${role}: generated=${item.generated} incidents=${item.incidentFamilies.join(", ")}`).join("\n")}
`;
}

function main() {
  const output = path.resolve(argValue("output", DEFAULT_OUTPUT));
  const difficulty = argValue("difficulty", "Advanced");
  const duration = argValue("duration", difficulty === "Advanced" ? "60 mins" : "30 mins");
  const count = Number(argValue("count", "25"));
  const seed = argValue("seed", "phase5");
  const incidentFilter = argValue("incident-family");
  const roleFilter = argValue("host-role");
  const failFast = hasFlag("fail-fast");
  const preservePassed = hasFlag("preserve-passed");
  const preserveFailed = hasFlag("preserve-failed") || true;
  const samplePassedEvery = Number(argValue("sample-passed-every", "50"));
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildCanonicalEvidenceRegistry } = require(path.join(out, "linux", "simulation.js"));
  const { validateLinuxLearnerPackGrounding, validateLinuxProductionClosure } = require(path.join(out, "linux", "grounding.js"));
  const { validateLinuxSemanticClosure } = require(path.join(out, "linux", "semanticClosure.js"));
  console.info = () => {};

  fs.rmSync(output, { recursive: true, force: true });
  ensureDir(output);

  const records = [];
  const failures = [];
  const generationTimes = [];
  const validationTimes = [];
  const attempts = [];
  const scoreCounts = {};
  const assetCounts = {};
  const rejectionReasons = {};
  const objectCoverageTotals = {
    taskRequiredSubjects: 0,
    taskCoveredSubjects: 0,
    uncoveredIncidentSubjects: 0,
    unrelatedTaskEvidence: 0,
    relationshipProofCoverage: [],
    documentGroundingCoverage: [],
    riskGroundingCoverage: [],
  };
  const closureTotals = {
    duplicateCanonicalIds: 0,
    missingCanonicalReferences: 0,
    missingLearnerObjects: 0,
    missingRenderedSubjects: 0,
    invalidRelations: 0,
    snapshotContradictions: 0,
    timezoneContradictions: 0,
    networkContradictions: 0,
    invalidRiskRows: 0,
    impossibleTasks: 0,
  };
  const semanticTotals = {
    command: 0,
    identity: 0,
    process: 0,
    filesystem: 0,
    container: 0,
    scheduler: 0,
    network: 0,
    sudo: 0,
    provenance: 0,
    risk: 0,
    crypto: 0,
    task: 0,
  };
  const commandKindDistribution = {};
  const executionMigrationTotals = {
    totalCommands: 0,
    executionFirstCommands: 0,
    legacyCommands: 0,
    totalProcesses: 0,
    executionFirstProcesses: 0,
    backgroundSystemProcesses: 0,
    legacyUnclassifiedProcesses: 0,
    executionIntentsCreated: 0,
    completedExecutions: 0,
    failedNoChildExecutions: 0,
    lifecycleValidationFailures: 0,
    qualityCheckerLifecycleRejections: 0,
    builderRegisteredExecutions: 0,
    pendingExecutions: 0,
    constructionFailedExecutions: 0,
    builderRegisteredCommands: 0,
    builderRegisteredProcesses: 0,
    shellHostedExecutions: 0,
    backgroundStaticLegacyCommands: 0,
    backgroundStaticLegacyProcesses: 0,
    incidentRelevantLegacyCommands: 0,
    incidentRelevantLegacyProcesses: 0,
    forgedLabelObjects: 0,
    postFinalizationMutationViolations: 0,
    packageDpkgLegacyProcesses: 0,
    duplicateExecutionRegistrations: 0,
    duplicateCommandRegistrations: 0,
    duplicateProcessRegistrations: 0,
    invalidRegistrationFingerprints: 0,
    replacedRegistryRecords: 0,
    registryCardinalityViolations: 0,
    frozenRecordMutationAttempts: 0,
    authoritativeLedgerRecords: 0,
    serializedDiagnosticRecords: 0,
    authoritativeSerializedRegistryMismatches: 0,
  };
  const family = {};
  const role = {};
  const fingerprints = {};
  const attemptAccounting = newAttemptAccounting();
  let skippedByFilter = 0;
  const started = performance.now();

  for (let accepted = 0, guard = 0; accepted < count && guard < count * 80; guard += 1) {
    const candidateSeed = `${seed}:${difficulty}:${guard}`;
    const attemptEvents = [];
    let builderReturned = false;
    let finalAccepted = false;
    let filtered = false;
    const t0 = performance.now();
    try {
      const candidate = buildLinuxAssetCandidate(
        {
          category: "Linux",
          difficulty,
          duration,
          title: "CyberLab Asset Pack",
          seed: candidateSeed,
          generationTime: "2026-07-29T08:00:00.000Z",
        },
        { onAttempt: (event) => attemptEvents.push(event) }
      );
      builderReturned = true;
      const context = candidate.investigation;
      if (incidentFilter && context.incidentFamily !== incidentFilter) {
        skippedByFilter += 1;
        filtered = true;
        continue;
      }
      if (roleFilter && context.hostRole !== roleFilter) {
        skippedByFilter += 1;
        filtered = true;
        continue;
      }
      const validationStart = performance.now();
      assertCandidateProperties(candidate);
      const hasAdvancedEvidenceSurface = candidate.assets.some((asset) => asset.file_path === "assets/runtime/process_snapshot.txt");
      const evidenceRegistry = hasAdvancedEvidenceSurface ? buildCanonicalEvidenceRegistry(candidate.simulation, candidate.assets) : [];
      const grounding = hasAdvancedEvidenceSurface
        ? validateLinuxLearnerPackGrounding({
            simulation: candidate.simulation,
            evidenceRegistry,
            finalAssets: candidate.assets,
          })
        : {
            passed: true,
            issues: [],
            coverage: {
              taskRequiredSubjects: 0,
              taskCoveredSubjects: 0,
              uncoveredIncidentSubjects: [],
              unrelatedTaskEvidence: 0,
              relationshipProofCoverage: 1,
              documentGroundingCoverage: 1,
              riskGroundingCoverage: 1,
            },
          };
      if (!grounding.passed) throw new Error(`object grounding failed: ${grounding.issues.slice(0, 3).join("; ")}`);
      const closure = hasAdvancedEvidenceSurface
        ? validateLinuxProductionClosure({
            simulation: candidate.simulation,
            evidenceRegistry,
            finalAssets: candidate.assets,
          })
        : {
            passed: true,
            issues: [],
            metrics: Object.fromEntries(Object.keys(closureTotals).map((key) => [key, 0])),
          };
      if (!closure.passed) throw new Error(`production closure failed: ${closure.issues.slice(0, 3).join("; ")}`);
      const semanticClosure = hasAdvancedEvidenceSurface
        ? validateLinuxSemanticClosure({
            simulation: candidate.simulation,
            finalAssets: candidate.assets,
          })
        : { passed: true, issues: [], metrics: { commandKinds: {} } };
      if (!semanticClosure.passed) throw new Error(`semantic closure failed: ${semanticClosure.issues.slice(0, 3).map((item) => item.message).join("; ")}`);
      validationTimes.push(performance.now() - validationStart);
      generationTimes.push(performance.now() - t0);
      attempts.push(candidate.generationAttempts || 1);
      inc(scoreCounts, String(candidate.assetQuality.score));
      inc(assetCounts, String(candidate.assets.length));
      objectCoverageTotals.taskRequiredSubjects += grounding.coverage.taskRequiredSubjects;
      objectCoverageTotals.taskCoveredSubjects += grounding.coverage.taskCoveredSubjects;
      objectCoverageTotals.uncoveredIncidentSubjects += grounding.coverage.uncoveredIncidentSubjects.length;
      objectCoverageTotals.unrelatedTaskEvidence += grounding.coverage.unrelatedTaskEvidence;
      objectCoverageTotals.relationshipProofCoverage.push(grounding.coverage.relationshipProofCoverage);
      objectCoverageTotals.documentGroundingCoverage.push(grounding.coverage.documentGroundingCoverage);
      objectCoverageTotals.riskGroundingCoverage.push(grounding.coverage.riskGroundingCoverage);
      Object.keys(closureTotals).forEach((key) => {
        closureTotals[key] += closure.metrics[key] || 0;
      });
      Object.keys(semanticTotals).forEach((key) => {
        semanticTotals[key] += semanticClosure.metrics[key] || 0;
      });
      Object.entries(semanticClosure.metrics.commandKinds || {}).forEach(([key, value]) => {
        inc(commandKindDistribution, key, value);
      });
      const executionDiagnostics = candidate.simulation.executionMigrationDiagnostics || {};
      Object.keys(executionMigrationTotals).forEach((key) => {
        if (typeof executionDiagnostics[key] === "number") executionMigrationTotals[key] += executionDiagnostics[key];
      });

      const taskSeq = (candidate.simulation.canonicalTasks || []).map((task) => task.intent).join(">");
      const timeline = assetByPath(candidate.assets, "assets/evidence/timeline.csv");
      const timelineSeq = timeline ? timeline.content.trim().split(/\r?\n/).slice(1).map((row) => parseCsvLine(row)[6]).join(">") : "";
      const fingerprint = `${context.incidentFamily}|${context.hostRole}|${taskSeq}|${timelineSeq}`;
      inc(fingerprints, fingerprint);

      if (!family[context.incidentFamily]) {
        family[context.incidentFamily] = { generated: 0, scores: [], hostRoles: new Set(), companies: new Set(), industries: new Set(), taskIntents: new Set(), commands: new Set(), services: new Set(), optionalArtifacts: new Set() };
      }
      const fam = family[context.incidentFamily];
      fam.generated += 1;
      fam.scores.push(candidate.assetQuality.score);
      fam.hostRoles.add(context.hostRole);
      fam.companies.add(context.company);
      fam.industries.add(context.industry);
      for (const task of candidate.simulation.canonicalTasks || []) fam.taskIntents.add(task.intent);
      for (const command of candidate.simulation.commands || []) fam.commands.add(command.renderedCommand);
      for (const service of candidate.simulation.services || []) fam.services.add(service.unitName);
      for (const asset of candidate.assets.filter((item) => /assets\/(?:scheduled|runtime|docs|configs|reports)/.test(item.file_path))) fam.optionalArtifacts.add(asset.file_path);

      if (!role[context.hostRole]) {
        role[context.hostRole] = { generated: 0, incidentFamilies: new Set(), services: new Set(), packages: new Set(), users: new Set(), cronTimers: new Set(), backgroundDensity: [] };
      }
      const roleItem = role[context.hostRole];
      roleItem.generated += 1;
      roleItem.incidentFamilies.add(context.incidentFamily);
      for (const service of candidate.simulation.services || []) roleItem.services.add(service.unitName);
      for (const tx of candidate.simulation.packageTransactions || []) for (const pkg of tx.packages || []) roleItem.packages.add(pkg.name);
      for (const identity of candidate.simulation.identities || []) roleItem.users.add(identity.username);
      for (const cron of candidate.simulation.cronDefinitions || []) roleItem.cronTimers.add(cron.schedule);
      roleItem.backgroundDensity.push((candidate.simulation.scheduledExecutions || []).length);

      const record = {
        seed: candidateSeed,
        caseId: context.incidentId,
        difficulty,
        incidentFamily: context.incidentFamily,
        company: context.company,
        industry: context.industry,
        host: context.hostname,
        hostRole: context.hostRole,
        actor: context.primaryUser,
        sourceIp: context.suspiciousIp,
        incidentWindow: `${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}`,
        collectionTime: candidate.simulation.collection.collectedAt,
        assetCount: candidate.assets.length,
        generationAttempts: candidate.generationAttempts || 1,
        attemptTrace: attemptEvents.map((event) => ({
          attempt: event.attempt,
          accepted: event.accepted,
          reason: event.reason,
          incidentFamily: event.incidentFamily,
          hostRole: event.hostRole,
          issueCodes: event.issueCodes,
        })),
        qualityScore: candidate.assetQuality.score,
        categoryScores: candidate.assetQuality.categoryScores,
        coverage: candidate.assetQuality.coverage,
        objectGroundingCoverage: grounding.coverage,
        productionClosure: closure.metrics,
        semanticClosure: semanticClosure.metrics,
        executionMigrationDiagnostics: candidate.simulation.executionMigrationDiagnostics,
        issues: candidate.assetQuality.issues,
        validationDurationMs: validationTimes[validationTimes.length - 1],
        totalGenerationDurationMs: generationTimes[generationTimes.length - 1],
        regenerationReasons: candidate.rejectionReasons || [],
        batchFingerprint: fingerprint,
      };
      records.push(record);
      accepted += 1;
      finalAccepted = true;
      if (preservePassed && (samplePassedEvery <= 1 || accepted % samplePassedEvery === 0)) {
        preserveCandidate(output, "sampled-passed", record, candidate);
      }
    } catch (error) {
      const failed = {
        seed: candidateSeed,
        difficulty,
        error: String(error.message || error),
        attempts: attemptEvents,
      };
      failures.push(failed);
      inc(rejectionReasons, failed.error.split("\n")[0].slice(0, 180));
      if (/canonical execution lifecycle validation failed|canonical execution|execution-first|canonical executions/i.test(failed.error)) {
        executionMigrationTotals.lifecycleValidationFailures += 1;
      }
      if (/Advanced Linux simulation is missing canonical executions|lacks execution-first provenance/i.test(failed.error)) {
        executionMigrationTotals.qualityCheckerLifecycleRejections += 1;
      }
      if (preserveFailed) writeJson(path.join(output, "failed", sanitizeName(candidateSeed), "metadata.json"), failed);
      if (failFast) throw error;
    } finally {
      recordAttemptAccounting(attemptAccounting, {
        inputId: candidateSeed,
        attemptEvents,
        builderReturned,
        finalAccepted,
        filtered,
      });
    }
  }

  const summarizeFamily = Object.fromEntries(Object.entries(family).map(([key, item]) => [key, {
    generated: item.generated,
    accepted: item.generated,
    rejectionCount: 0,
    averageScore: Number((item.scores.reduce((a, b) => a + b, 0) / item.scores.length).toFixed(2)),
    minimumScore: Math.min(...item.scores),
    hostRoles: [...item.hostRoles].sort(),
    companies: [...item.companies].sort(),
    industries: [...item.industries].sort(),
    primaryTaskIntents: [...item.taskIntents].sort(),
    canonicalCommands: [...item.commands].slice(0, 25),
    servicesInvolved: [...item.services].sort(),
    optionalArtifacts: [...item.optionalArtifacts].sort(),
  }]));

  const summarizeRole = Object.fromEntries(Object.entries(role).map(([key, item]) => [key, {
    generated: item.generated,
    incidentFamilies: [...item.incidentFamilies].sort(),
    services: [...item.services].sort(),
    packages: [...item.packages].sort(),
    users: [...item.users].sort(),
    cronTimers: [...item.cronTimers].sort(),
    backgroundDensityRange: [Math.min(...item.backgroundDensity), Math.max(...item.backgroundDensity)],
  }]));

  const summary = {
    seed,
    difficulty,
    requestedCount: count,
    accepted: records.length,
    firstAttemptAccepted: attempts.filter((value) => value === 1).length,
    firstAttemptAcceptance: records.length
      ? Number((attempts.filter((value) => value === 1).length / records.length).toFixed(4))
      : 0,
    eventualAcceptance: count > 0 ? Number((records.length / count).toFixed(4)) : 0,
    rawAttempts: attemptAccounting.internalAttempts,
    skippedByFilter,
    failures: failures.length,
    rejectionRate: attemptAccounting.internalAttempts > 0
      ? Number(((attemptAccounting.internalAttempts - records.length) / attemptAccounting.internalAttempts).toFixed(4))
      : 0,
    rejectionRateDenominator: "internalAttempts",
    attemptAccounting: {
      ...attemptAccounting,
      unfilledSlots: Math.max(0, count - records.length),
      firstAttemptFinalAcceptanceAcrossInputs: attemptAccounting.builderInvocations > 0
        ? Number((attemptAccounting.firstAttemptFinalAcceptedAcrossInputs / attemptAccounting.builderInvocations).toFixed(4))
        : 0,
      firstAttemptFinalAcceptanceAcrossInputsDenominator: "builderInvocations",
      firstAttemptAcceptanceWithinAcceptedSampleDenominator: "finalAcceptedCases",
    },
    averageAttempts: attempts.length ? Number((attempts.reduce((a, b) => a + b, 0) / attempts.length).toFixed(3)) : 0,
    maxAttempts: attempts.length ? Math.max(...attempts) : 0,
    scoreDistribution: scoreCounts,
    assetCountDistribution: assetCounts,
    attemptDistribution: attempts.reduce((map, value) => (inc(map, String(value)), map), {}),
    incidentFamilies: summarizeFamily,
    hostRoles: summarizeRole,
    rejectionReasons,
    objectGrounding: {
      taskObjectCoverage: objectCoverageTotals.taskRequiredSubjects > 0
        ? Number((objectCoverageTotals.taskCoveredSubjects / objectCoverageTotals.taskRequiredSubjects).toFixed(4))
        : 1,
      requiredRelationCoverage: objectCoverageTotals.relationshipProofCoverage.length
        ? Number((objectCoverageTotals.relationshipProofCoverage.reduce((total, value) => total + value, 0) / objectCoverageTotals.relationshipProofCoverage.length).toFixed(4))
        : 1,
      documentMaterialClaimCoverage: objectCoverageTotals.documentGroundingCoverage.length
        ? Number((objectCoverageTotals.documentGroundingCoverage.reduce((total, value) => total + value, 0) / objectCoverageTotals.documentGroundingCoverage.length).toFixed(4))
        : 1,
      riskClaimCoverage: objectCoverageTotals.riskGroundingCoverage.length
        ? Number((objectCoverageTotals.riskGroundingCoverage.reduce((total, value) => total + value, 0) / objectCoverageTotals.riskGroundingCoverage.length).toFixed(4))
        : 1,
      uncoveredIncidentSubjects: objectCoverageTotals.uncoveredIncidentSubjects,
      unrelatedTaskEvidence: objectCoverageTotals.unrelatedTaskEvidence,
    },
    productionClosure: closureTotals,
    semanticClosure: {
      issueCounts: semanticTotals,
      commandKindDistribution,
    },
    executionMigration: executionMigrationTotals,
    diversity: {
      highestFingerprintCount: Math.max(0, ...Object.values(fingerprints)),
      repeatedFingerprints: Object.entries(fingerprints).filter(([, value]) => value > 1).slice(0, 20),
    },
    performance: {
      generation: {
        p50: Number(percentile(generationTimes, 50).toFixed(2)),
        p90: Number(percentile(generationTimes, 90).toFixed(2)),
        p95: Number(percentile(generationTimes, 95).toFixed(2)),
        p99: Number(percentile(generationTimes, 99).toFixed(2)),
      },
      validation: {
        p50: Number(percentile(validationTimes, 50).toFixed(2)),
        p90: Number(percentile(validationTimes, 90).toFixed(2)),
        p95: Number(percentile(validationTimes, 95).toFixed(2)),
        p99: Number(percentile(validationTimes, 99).toFixed(2)),
      },
      totalWallMs: Number((performance.now() - started).toFixed(2)),
      memoryRssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
    },
    records,
    failuresList: failures,
  };

  writeJson(path.join(output, "summary.json"), summary);
  fs.writeFileSync(path.join(output, "summary.md"), markdownSummary(summary));
  console.log(JSON.stringify({
    output,
    accepted: summary.accepted,
    rawAttempts: summary.rawAttempts,
    attemptAccounting: summary.attemptAccounting,
    rejectionRate: summary.rejectionRate,
    averageAttempts: summary.averageAttempts,
    maxAttempts: summary.maxAttempts,
    firstAttemptAccepted: summary.firstAttemptAccepted,
    firstAttemptAcceptance: summary.firstAttemptAcceptance,
    eventualAcceptance: summary.eventualAcceptance,
    executionMigration: summary.executionMigration,
    families: Object.keys(summary.incidentFamilies).length,
    roles: Object.keys(summary.hostRoles).length,
    performance: summary.performance,
  }, null, 2));
  if (summary.accepted !== count) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { timestampValue, assertCandidateProperties, newAttemptAccounting, recordAttemptAccounting };
