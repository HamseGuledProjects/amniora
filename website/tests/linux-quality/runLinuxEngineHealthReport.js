#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT = path.join(ROOT, ".tmp", "linux-engine-health-report");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-engine-health-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function argValue(name, fallback = null) {
  const flag = `--${name}`;
  const exact = process.argv.find((item) => item.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) return process.argv[index + 1];
  return fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}


function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function expectPass(name, fn) {
  try {
    const result = fn();
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    throw new Error(`${name}: expected pass, got ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expectFail(name, fn, pattern) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (new RegExp(pattern, "i").test(message)) {
      console.log(`PASS ${name}`);
      return message;
    }
    throw new Error(`${name}: expected ${pattern}, got ${message}`);
  }
  throw new Error(`${name}: expected failure`);
}

function mutate(fixture, fn) {
  const copy = clone(fixture);
  fn(copy);
  return copy;
}

function assertBoundary(assertLinuxEngineBoundaries, fixture) {
  assertLinuxEngineBoundaries({ simulation: fixture.simulation, assets: fixture.assets });
}

const realIds = {
  identity: "identity:analyst",
  group: "group:analysts",
  session: "session:ssh:incident",
  command: "command:incident:primary",
  process: "process:command",
  file: "file:owned",
  service: "service:ssh.service",
  event: "event:command:primary",
  transition: "transition:ssh.service:reload",
  timer: "timer:apt-daily",
  cron: "cron:root",
  scheduled: "scheduled:root:1",
  package: "package:openssl:manual",
  maintenance: "maintenance:approved",
  document: "document:incident_brief",
  fact: "fact:host_identity",
  task: "task:1:scope_timeline",
};

const badIds = {
  identity: "identity:not-real",
  group: "group:not-real",
  session: "session:ssh:not-real",
  command: "command:not-real:rendered",
  process: "process:not-real",
  file: "file:not-real",
  service: "service:not-real.service",
  event: "event:not-real:rendered",
  transition: "transition:not-real:rendered",
  timer: "timer:not-real",
  cron: "cron:not-real",
  scheduled: "scheduled:not-real:1",
  package: "package:not-real:rendered",
  maintenance: "maintenance:not-real",
  document: "document:not-real",
  fact: "fact:not-real",
  task: "task:not-real:rendered",
};

function nearMiss(prefix) {
  if (prefix === "service") return "service:foo";
  if (prefix === "session" || prefix === "command" || prefix === "event" || prefix === "transition" || prefix === "scheduled" || prefix === "package" || prefix === "task") return `${prefix}:foo`;
  return `${prefix}-foo`;
}

function boundaryFixture() {
  const simulation = {
    version: 1,
    seed: "phase1b-boundary-fixture",
    investigation: { incidentId: "CL-LNX-0001", incidentFamily: "cron_persistence", hostRole: "test host" },
    collection: {
      collectedAt: "2026-07-17 03:30:00",
      windowStart: "2026-07-17 03:08:00",
      windowEnd: "2026-07-17 03:19:00",
      earliestAllowedEvent: "2026-07-17 02:30:00",
      latestAllowedEvent: "2026-07-17 03:30:00",
    },
    identities: [
      { id: "identity:root", username: "root", uid: 0, gid: 0, primaryGroupId: "group:root" },
      { id: realIds.identity, username: "analyst", uid: 1000, gid: 1000, primaryGroupId: realIds.group },
    ],
    groups: [
      { id: "group:root", name: "root", gid: 0 },
      { id: realIds.group, name: "analysts", gid: 1000 },
    ],
    sshSessions: [
      {
        id: realIds.session,
        identityId: realIds.identity,
        username: "analyst",
        uid: 1000,
        gid: 1000,
        sourceIp: "203.0.113.10",
        sourcePort: 51515,
        destinationPort: 22,
        authenticationMethod: "publickey",
        tty: "pts/0",
        monitorPid: 199,
        sessionPid: 200,
        shellPid: 201,
        openedAt: "2026-07-17 03:08:00",
        closedAt: "2026-07-17 03:19:00",
        purpose: "incident",
      },
    ],
    commands: [
      {
        id: realIds.command,
        kind: "primary_incident",
        actorIdentityId: realIds.identity,
        sessionId: realIds.session,
        timestamp: "2026-07-17 03:10:00",
        tty: "pts/0",
        cwd: "/home/analyst",
        executable: "/usr/bin/cat",
        argv: ["/usr/bin/cat", "/etc/passwd"],
        renderedCommand: "cat /etc/passwd",
        processId: 202,
        shellProcessId: 201,
        affectedFileIds: [realIds.file],
        affectedServiceIds: [realIds.service],
        expectedRenderTargets: ["audit", "timeline", "process", "open_files"],
      },
      {
        id: "command:background:cron",
        kind: "background",
        actorIdentityId: "identity:root",
        timestamp: "2026-07-17 03:00:00",
        cwd: "/",
        executable: "/usr/local/sbin/job.sh",
        argv: ["/usr/local/sbin/job.sh"],
        renderedCommand: "/usr/local/sbin/job.sh",
        processId: 301,
        affectedFileIds: [realIds.file],
        affectedServiceIds: [realIds.service],
        expectedRenderTargets: ["audit", "timeline"],
      },
    ],
    processes: [
      { id: "process:init", pid: 1, ppid: 0, executable: "/sbin/init", argv: ["/sbin/init"], identityId: "identity:root", realUid: 0, effectiveUid: 0, realGid: 0, effectiveGid: 0, cwd: "/", startedAt: "2026-07-17 02:00:00", childProcessIds: ["process:shell"], openFileIds: [] },
      { id: "process:shell", pid: 201, ppid: 1, executable: "/bin/bash", argv: ["/bin/bash"], identityId: realIds.identity, realUid: 1000, effectiveUid: 1000, realGid: 1000, effectiveGid: 1000, cwd: "/home/analyst", sessionId: realIds.session, startedAt: "2026-07-17 03:08:01", childProcessIds: [realIds.process], openFileIds: [realIds.file] },
      { id: realIds.process, pid: 202, ppid: 201, executable: "/usr/bin/cat", argv: ["/usr/bin/cat", "/etc/passwd"], identityId: realIds.identity, realUid: 1000, effectiveUid: 1000, realGid: 1000, effectiveGid: 1000, cwd: "/home/analyst", sessionId: realIds.session, commandId: realIds.command, startedAt: "2026-07-17 03:10:00", endedAt: "2026-07-17 03:10:01", childProcessIds: [], openFileIds: [realIds.file] },
      { id: "process:cron", pid: 301, ppid: 1, executable: "/usr/local/sbin/job.sh", argv: ["/usr/local/sbin/job.sh"], identityId: "identity:root", realUid: 0, effectiveUid: 0, realGid: 0, effectiveGid: 0, cwd: "/", commandId: "command:background:cron", startedAt: "2026-07-17 03:00:00", endedAt: "2026-07-17 03:00:05", childProcessIds: [], openFileIds: [realIds.file] },
    ],
    files: [
      { id: realIds.file, path: "/etc/passwd", fileType: "regular", ownerIdentityId: "identity:root", ownerUid: 0, groupId: "group:root", groupGid: 0, mode: 0o644, inode: 12345, size: 2048, modifiedAt: "2026-07-17 03:00:00", contentRole: "configuration", relatedCommandIds: [realIds.command] },
    ],
    events: [{ id: realIds.event, timestamp: "2026-07-17 03:10:00", kind: "command_exec", summary: "command", commandId: realIds.command, sessionId: realIds.session }],
    services: [{ id: realIds.service, unitName: "ssh.service", description: "OpenSSH", unitType: "simple", unitPath: "/lib/systemd/system/ssh.service", unitFileState: "enabled", activeState: "active", subState: "running", mainProcessId: "process:init", ownerTeam: "platform" }],
    serviceTransitions: [{ id: realIds.transition, serviceId: realIds.service, operation: "reload", cause: { type: "command", commandId: realIds.command }, occurredAt: "2026-07-17 03:11:00", previousState: { unitFileState: "enabled", activeState: "active", subState: "running" }, resultingState: { unitFileState: "enabled", activeState: "active", subState: "running" }, expectedRenderTargets: ["audit", "journal_systemd", "syslog", "timeline", "service_inventory"] }],
    timers: [{ id: realIds.timer, timerUnitName: "apt-daily.timer", serviceId: realIds.service, activeState: "active", subState: "waiting", lastTriggerAt: "2026-07-17 02:00:00", nextTriggerAt: "2026-07-18 02:00:00" }],
    cronDefinitions: [{ id: realIds.cron, source: "root_crontab", sourcePath: "/var/spool/cron/crontabs/root", ownerIdentityId: "identity:root", runAsIdentityId: "identity:root", schedule: "0 * * * *", commandId: "command:background:cron", enabled: true, createdAt: "2026-07-16 00:00:00", modifiedAt: "2026-07-16 00:00:00", purpose: "monitoring" }],
    scheduledExecutions: [{ id: realIds.scheduled, definitionId: realIds.cron, commandId: "command:background:cron", processId: "process:cron", occurredAt: "2026-07-17 03:00:00", outcome: "success", exitCode: 0, affectedFileIds: [realIds.file], affectedServiceIds: [realIds.service], expectedRenderTargets: ["cron_log", "audit", "timeline"] }],
    packageTransactions: [{ id: realIds.package, source: "manual", actorIdentityId: realIds.identity, commandId: realIds.command, processIds: [realIds.process], requestedAt: "2026-07-17 03:10:00", startedAt: "2026-07-17 03:10:00", completedAt: "2026-07-17 03:10:10", action: "install", packages: [{ name: "openssl", resultingVersion: "3.0.0" }], outcome: "success", affectedFileIds: [realIds.file], affectedServiceIds: [realIds.service] }],
    maintenanceActivities: [{ id: realIds.maintenance, title: "approved work", owningTeam: "platform", actorIdentityId: realIds.identity, approved: true, changeId: "CHG-1", ticketId: "INC-1", windowStart: "2026-07-17 03:00:00", windowEnd: "2026-07-17 04:00:00", commandIds: [realIds.command], serviceTransitionIds: [realIds.transition], packageTransactionIds: [realIds.package], cronDefinitionIds: [realIds.cron], purpose: "maintenance" }],
    backgroundProfile: { hostRole: "test host", industry: "test", organisationMaturity: "mature", businessHours: "24x7", timezone: "UTC", permittedJobFamilies: ["monitoring"], permittedServiceFamilies: ["access"], permittedPackageActivities: ["manual"], activityDensity: "low" },
    evidenceRegistry: [{ id: "evidence:test", path: "assets/test/boundary.txt", displayName: "Boundary", assetType: "other", canonicalObjectIds: [realIds.command], subjectRefs: [], relations: [], eventIds: [realIds.event], capabilities: ["timeline_exact"], support: "direct", exactTimestampSupport: true, aliases: [] }],
    documentFacts: [{ id: realIds.fact, factType: "host_identity", canonicalObjectIds: [realIds.service], certainty: "observed", allowedDocumentTypes: ["incident_brief"], spoilerRisk: "none" }],
    documents: [{ id: realIds.document, documentType: "incident_brief", styleArchetype: "formal_itil", factIds: [realIds.fact], requiredFactTypes: ["host_identity"], forbiddenFactIds: [], createdAt: "2026-07-17 03:20:00", authorRole: "analyst", owningTeam: "soc" }],
    canonicalTasks: [{ id: realIds.task, intent: "scope_timeline", requiredCapabilities: ["timeline_exact"], selectedEvidenceAssetIds: ["evidence:test"], canonicalObjectIds: [realIds.file], primarySubjectIds: [realIds.command], supportingSubjectIds: [realIds.service], requirements: [], expectedDeliverableType: "timeline", difficulty: "Advanced", order: 1 }],
    taskFeasibilityProofs: [],
    legacy: { phase: 1, remainingLocalFactOrigins: [] },
  };
  const assets = [{ file_name: "boundary.txt", file_type: "text", file_path: "assets/test/boundary.txt", content: "boundary fixture\n" }];
  return { simulation, assets };
}

function assertFixtureComplete(fixture, supportedRules) {
  const missing = [];
  for (const rule of supportedRules) {
    if (!realIds[rule.prefix]) missing.push(`real id for ${rule.prefix}`);
    if (!badIds[rule.prefix]) missing.push(`bad id for ${rule.prefix}`);
  }
  if (!fixture.simulation.sshSessions.length) missing.push("ssh session");
  if (!fixture.simulation.scheduledExecutions.length) missing.push("scheduled execution");
  if (!fixture.simulation.serviceTransitions.length) missing.push("service transition");
  if (!fixture.simulation.processes.some((process) => process.ppid > 1)) missing.push("process with parent");
  if (!fixture.simulation.processes.some((process) => process.openFileIds.length > 0)) missing.push("process with open file");
  if (!fixture.simulation.canonicalTasks.some((task) => task.canonicalObjectIds.length > 0 || task.primarySubjectIds.length > 0)) missing.push("task canonical subject");
  if (missing.length > 0) throw new Error(`Boundary fixture incomplete: ${missing.join(", ")}`);
}

function withFixtureAssetContent(fixture, content) {
  const copy = clone(fixture);
  copy.assets[0].content += `\n${content}\n`;
  return copy;
}

function buildIntegratedCandidate(buildLinuxAssetCandidate, env, transform) {
  return withEnv(env, () => buildLinuxAssetCandidate({
          seed: "phase1b-integrated-generation",
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
    difficulty: "Advanced",
    duration: "30 mins",
    title: "CyberLab Asset Pack",
  }, {
    boundaryAssertionTransform: transform,
  }));
}

function runOnce(iteration, modules, output) {
  const {
    buildLinuxAssetCandidate,
    LINUX_DOMAIN_OWNERSHIP,
    RENDERED_CANONICAL_ID_RULES,
    assertLinuxEngineBoundaries,
    buildLinuxEngineHealthReport,
  } = modules;
  const supportedRules = RENDERED_CANONICAL_ID_RULES.filter((rule) => rule.renderedScanningSupported);
  const fixture = boundaryFixture();
  assertFixtureComplete(fixture, supportedRules);

  const assertOn = (item) => withEnv({ NODE_ENV: "test", CYBERLAB_LINUX_ENGINE_ASSERTIONS: undefined }, () => assertBoundary(assertLinuxEngineBoundaries, item));

  expectPass(`valid deterministic fixture ${iteration}`, () => assertOn(fixture));
  expectFail(`unknown SSH identity reference ${iteration}`, () => assertOn(mutate(fixture, (item) => {
    item.simulation.sshSessions[0].identityId = "identity:not-real";
  })), "identityId");
  expectFail(`unknown process identity ${iteration}`, () => assertOn(mutate(fixture, (item) => {
    item.simulation.processes[0].identityId = "identity:not-real";
  })), "identityId");
  expectFail(`unknown parent process ${iteration}`, () => assertOn(mutate(fixture, (item) => {
    item.simulation.processes.find((process) => process.ppid > 1).ppid = 999999;
  })), "parent PID");
  expectFail(`unknown open-file reference ${iteration}`, () => assertOn(mutate(fixture, (item) => {
    item.simulation.processes.find((process) => process.openFileIds.length > 0).openFileIds.push("file:not-real");
  })), "openFileIds");
  expectFail(`unknown file owner ${iteration}`, () => assertOn(mutate(fixture, (item) => {
    item.simulation.files[0].ownerIdentityId = "identity:not-real";
  })), "ownerIdentityId");
  expectFail(`unknown file group ${iteration}`, () => assertOn(mutate(fixture, (item) => {
    item.simulation.files[0].groupId = "group:not-real";
  })), "groupId");
  expectFail(`unknown scheduled definition reference ${iteration}`, () => assertOn(mutate(fixture, (item) => {
    item.simulation.scheduledExecutions[0].definitionId = "cron:not-real";
  })), "definitionId");
  expectFail(`unknown command process id ${iteration}`, () => assertOn(mutate(fixture, (item) => {
    item.simulation.commands[0].processId = 999999;
  })), "processId");
  expectFail(`unknown service transition service ${iteration}`, () => assertOn(mutate(fixture, (item) => {
    item.simulation.serviceTransitions[0].serviceId = "service:not-real.service";
  })), "serviceId");
  expectFail(`unknown task canonical subject ${iteration}`, () => assertOn(mutate(fixture, (item) => {
    item.simulation.canonicalTasks[0].canonicalObjectIds.push("file:not-real");
  })), "canonicalSubjectIds");

  const validMultiRefContent = ["identity", "command", "process", "file", "scheduled", "service"]
    .map((prefix) => `valid-ref ${realIds[prefix]}`)
    .join("\n");
  expectPass(`valid references across object types ${iteration}`, () => assertOn(withFixtureAssetContent(fixture, validMultiRefContent)));

  const longIdFixture = mutate(fixture, (item) => {
    item.simulation.events.push({
      id: "event:ssh:incident-primary:open",
      timestamp: "2026-07-17 03:08:01",
      kind: "ssh_session_open",
      summary: "SSH session opened",
      sessionId: realIds.session,
    });
    item.simulation.documentFacts.push({
      id: "fact:actor:candidate",
      factType: "actor",
      canonicalObjectIds: [realIds.identity],
      certainty: "candidate",
      allowedDocumentTypes: ["audit_notes"],
      spoilerRisk: "high",
    });
  });
  expectPass(`long canonical ids are scanned as complete ids ${iteration}`, () => assertOn(withFixtureAssetContent(
    longIdFixture,
    "full refs event:ssh:incident-primary:open fact:actor:candidate scheduled:root:1 session:ssh:incident"
  )));
  expectPass(`semantic scheduled and session labels are not canonical ids ${iteration}`, () => assertOn(withFixtureAssetContent(
    fixture,
    "lanes scheduled:access scheduled:dns scheduled:general session:ssh"
  )));
  expectFail(`unresolved event alias remains blocking ${iteration}`, () => assertOn(withFixtureAssetContent(
    fixture,
    "unresolved event:ssh:incident-primary"
  )), "event:ssh:incident-primary");
  expectFail(`unknown full scheduled canonical id remains blocking ${iteration}`, () => assertOn(withFixtureAssetContent(
    fixture,
    "unknown scheduled:access:404"
  )), "scheduled:access:404");

  for (const rule of supportedRules) {
    expectPass(`valid rendered ${rule.prefix} reference ${iteration}`, () => assertOn(withFixtureAssetContent(fixture, `valid ${realIds[rule.prefix]}`)));
    const message = expectFail(`bad rendered ${rule.prefix} reference ${iteration}`, () => assertOn(withFixtureAssetContent(fixture, `bad ${badIds[rule.prefix]}`)), badIds[rule.prefix].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!message.includes(badIds[rule.prefix])) throw new Error(`failure for ${rule.prefix} did not name ${badIds[rule.prefix]}`);
    expectPass(`near-miss ${rule.prefix} prose ${iteration}`, () => assertOn(withFixtureAssetContent(fixture, `near miss ${nearMiss(rule.prefix)}`)));
  }

  expectFail(`Invalid Date marker ${iteration}`, () => assertOn(withFixtureAssetContent(fixture, "collected_at=Invalid Date")), "Invalid Date serialization marker");
  expectFail(`[object Object] marker ${iteration}`, () => assertOn(withFixtureAssetContent(fixture, "value=[object Object]")), "\\[object Object\\] serialization marker");
  expectFail(`NaN marker ${iteration}`, () => assertOn(withFixtureAssetContent(fixture, "timestamp=NaN")), "contains NaN");
  expectFail(`undefined marker ${iteration}`, () => assertOn(withFixtureAssetContent(fixture, "user=undefined")), "contains undefined");
  expectPass(`undefined prose is allowed ${iteration}`, () => assertOn(withFixtureAssetContent(fixture, "The term undefined may appear in ordinary prose.")));

  const injectUnknownRenderedRef = ({ assets }) => {
    const target = assets.find((asset) => asset.file_path.startsWith("assets/")) || assets[0];
    target.content += "\n# internal-ref command:not-real:rendered\n";
  };
  expectPass(`integrated production gating skips assertions ${iteration}`, () => buildIntegratedCandidate(buildLinuxAssetCandidate, { NODE_ENV: "production", CYBERLAB_LINUX_ENGINE_ASSERTIONS: undefined }, injectUnknownRenderedRef));
  expectFail(`integrated production override runs assertions ${iteration}`, () => buildIntegratedCandidate(buildLinuxAssetCandidate, { NODE_ENV: "production", CYBERLAB_LINUX_ENGINE_ASSERTIONS: "1" }, injectUnknownRenderedRef), "command:not-real:rendered");
  expectFail(`integrated development gating runs assertions ${iteration}`, () => buildIntegratedCandidate(buildLinuxAssetCandidate, { NODE_ENV: "development", CYBERLAB_LINUX_ENGINE_ASSERTIONS: undefined }, injectUnknownRenderedRef), "command:not-real:rendered");

  const report = {
    ...buildLinuxEngineHealthReport(fixture.simulation),
    candidate: {
      caseId: fixture.simulation.investigation.incidentId,
      incidentFamily: fixture.simulation.investigation.incidentFamily,
      hostRole: fixture.simulation.investigation.hostRole,
      assetCount: fixture.assets.length,
      assertions: "passed",
    },
  };
  if (report.metadataMode !== "declared") throw new Error("report metadataMode must be declared");
  if (report.scannerGrammarVersion !== 2) throw new Error("report scannerGrammarVersion must be 2");
  if (!report.assertionIntegrationMode || !report.supportedRenderedCanonicalPrefixes) throw new Error("report missing scanner/integration details");
  const supported = supportedRules.map((rule) => rule.prefix).sort().join(",");
  const reported = [...report.supportedRenderedCanonicalPrefixes].sort().join(",");
  if (supported !== reported) throw new Error(`supported prefix report mismatch: ${supported} !== ${reported}`);
  if (Object.values(LINUX_DOMAIN_OWNERSHIP).some((item) => !item.ownershipStatus || !item.declaredCanonicalOwner)) {
    throw new Error("ownership declarations missing status or declared owner");
  }

  if (iteration === 1) {
    ensureDir(output);
    fs.writeFileSync(path.join(output, "engine-health-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  return {
    metadataMode: report.metadataMode,
    supportedPrefixes: report.supportedRenderedCanonicalPrefixes,
    unsupportedPrefixes: report.unsupportedRenderedCanonicalPrefixes,
    ownershipStatusCounts: report.totals.ownershipStatusCounts,
  };
}

function main() {
  const out = compileIfNeeded();
  const output = argValue("output", DEFAULT_OUTPUT);
  const repeat = Number(argValue("repeat", "1"));
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");

  const modules = {
    buildLinuxAssetCandidate: require(path.join(out, "linux", "index.js")).buildLinuxAssetCandidate,
    ...require(path.join(out, "linux", "domainOwnership.js")),
  };

  const fingerprints = [];
  let lastReportSummary;
  for (let index = 1; index <= repeat; index += 1) {
    lastReportSummary = runOnce(index, modules, output);
    fingerprints.push(JSON.stringify(lastReportSummary));
  }
  const uniqueFingerprints = new Set(fingerprints);
  if (uniqueFingerprints.size !== 1) throw new Error(`Phase 1B outputs were not deterministic across repeats: ${uniqueFingerprints.size} variants`);

  console.log(JSON.stringify({
    passed: true,
    repeatRuns: repeat,
    failures: 0,
    deterministicOutputs: true,
    reportPath: path.join(output, "engine-health-report.json"),
    ...lastReportSummary,
  }, null, 2));
}

main();
