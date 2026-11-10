#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const FAMILIES = [
  "ssh_bruteforce",
  "service_account_misuse",
  "docker_compromise",
  "systemd_persistence",
  "cron_persistence",
  "ssh_key_compromise",
  "misconfigured_sudoers",
  "unauthorized_package_install",
  "data_staging",
  "log_tampering",
  "reverse_shell",
];
const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-identity-certification-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

const out = compileIfNeeded();
const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
const { validateCanonicalExecutionLifecycle, validateLinuxSimulationEvidence } = require(`${out}/linux/simulation.js`);
const { checkLinuxInvestigationQuality } = require(`${out}/linux/qualityChecker.js`);


function buildCandidate(seed, diagnostics = {}) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `${seed}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
        difficulty: diagnostics.difficulty || "Advanced",
        duration: (diagnostics.difficulty || "Advanced") === "Advanced" ? "60 mins" : "30 mins",
        title: "CyberLab Asset Pack",
      }, diagnostics);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Could not build ${seed}`);
}

function pass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

function fail(name, expected, fn) {
  try {
    fn();
    throw new Error("__NO_FAILURE__");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message === "__NO_FAILURE__") throw new Error(`${name}: expected failure`);
    if (!message.includes(expected)) throw new Error(`${name}: expected "${expected}", got "${message}"`);
    console.log(`PASS ${name}: ${message}`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function addSeconds(timestamp, seconds) {
  const date = new Date(`${timestamp.replace(" ", "T")}Z`);
  date.setUTCSeconds(date.getUTCSeconds() + seconds);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function sudoCommands(simulation) {
  return simulation.commands.filter((command) =>
    command.sudoProcessId &&
    command.runAsIdentityId &&
    command.runAsIdentityId !== command.actorIdentityId
  );
}

function primarySession(simulation) {
  return simulation.sshSessions[0];
}

function primaryOrigin(simulation) {
  return simulation.authenticationOrigins.find((origin) => origin.sessionId === primarySession(simulation).id);
}

function primarySudoFacts(candidate) {
  const simulation = candidate.simulation;
  const command = sudoCommands(simulation)[0];
  const transition = simulation.identityTransitions.find((item) => item.commandId === command.id);
  const execution = simulation.executions.find((item) => item.id === command.executionId);
  const process = simulation.processes.find((item) => item.pid === command.processId);
  const sudoProcess = simulation.processes.find((item) => item.pid === command.sudoProcessId);
  return { simulation, command, transition, execution, process, sudoProcess };
}

function otherIdentity(simulation, notId) {
  return simulation.identities.find((identity) => identity.id !== notId && identity.id !== "identity:root") ||
    simulation.identities.find((identity) => identity.id !== notId);
}

function addSecondSessionAndOrigin(simulation, identity = otherIdentity(simulation, primarySession(simulation).identityId)) {
  const session = primarySession(simulation);
  const second = {
    ...session,
    id: "session:ssh:cert-second",
    identityId: identity.id,
    username: identity.username,
    uid: identity.uid,
    gid: identity.gid,
    sourceIp: "10.44.55.66",
    sourcePort: 55123,
    sessionPid: 9911,
    shellPid: 9912,
  };
  const origin = {
    ...primaryOrigin(simulation),
    id: "auth-origin:ssh:cert-second",
    identityId: identity.id,
    sessionId: second.id,
    sourceIp: second.sourceIp,
    sourcePort: second.sourcePort,
  };
  simulation.sshSessions.push(second);
  simulation.authenticationOrigins.push(origin);
  return { second, origin };
}

function firstAuthenticatedExecution(simulation) {
  return simulation.executions.find((execution) => execution.identityOrigin === "authenticated_session");
}

function firstInheritedExecution(simulation) {
  return simulation.executions.find((execution) => execution.identityOrigin === "inherited");
}

function firstSystemExecution(simulation) {
  return simulation.executions.find((execution) => execution.constructionOrigin === "system_origin");
}

function dpkgExecution(simulation) {
  return simulation.executions.find((execution) => execution.id.includes("execution:package:dpkg"));
}

function validate(candidate) {
  validateCanonicalExecutionLifecycle(candidate.simulation);
}

function classifyExecution(simulation, execution) {
  const command = simulation.commands.find((item) => item.id === execution.commandId);
  const process = simulation.processes.find((item) => item.id === execution.processId);
  const parent = process ? simulation.processes.find((item) => item.pid === process.ppid) : undefined;
  if (execution.identityOrigin === "authenticated_session") return "authenticated_session";
  if (execution.identityOrigin === "inherited") return "inherited";
  if (execution.identityOrigin === "privilege_transition") return "privilege_transition";
  if (execution.constructionOrigin === "system_origin") return "system_origin";
  if (!execution.sessionId && execution.reason === "package") return "deferred_domain";
  if (!execution.commandId && execution.sessionId && execution.reason === "privilege_escalation") return "deferred_domain";
  if (command?.kind === "background" || execution.scheduledExecutionId || parent?.executable.includes("cron")) return "deferred_domain";
  if (execution.reason === "service_action" && execution.serviceTransitionIds.length > 0) return "privilege_transition";
  return "deferred_domain";
}

function summarizeCandidate(candidate, summary) {
  const simulation = candidate.simulation;
  const transitionExecutions = new Set(simulation.identityTransitions.map((transition) => transition.executionId));
  const sudoCommandExecutions = new Set(sudoCommands(simulation).map((command) => command.executionId));
  summary.labs += 1;
  summary.sshSessions += simulation.sshSessions.length;
  summary.authenticationOrigins += simulation.authenticationOrigins.length;
  summary.sudoInvocations += sudoCommandExecutions.size;
  summary.identityTransitions += simulation.identityTransitions.length;
  summary.learnerAssets += candidate.assets.length;
  for (const execution of simulation.executions) {
    const actorChanged = execution.effectiveIdentityId && execution.effectiveIdentityId !== execution.identityId;
    const category = classifyExecution(simulation, execution);
    summary.totalExecutions += 1;
    summary.categories[category] = (summary.categories[category] || 0) + 1;
    if (!category) summary.missingClassification += 1;
    if (!simulation.identities.some((identity) => identity.id === execution.identityId)) summary.unknownIdentity += 1;
    if (actorChanged) {
      summary.actorEffectiveChanges += 1;
      const explained =
        execution.identityOrigin === "privilege_transition" ||
        execution.identityOrigin === "inherited" ||
        execution.constructionOrigin === "system_origin" ||
        execution.reason === "package" ||
        (!execution.commandId && execution.reason === "privilege_escalation");
      if (explained) summary.explainedIdentityChanges += 1;
      else summary.unexplainedIdentityChanges += 1;
    }
    if ((execution.effectiveIdentityId === "identity:root") || execution.privilegeLevel === "root") {
      summary.rootEffective += 1;
      if (execution.sessionId) summary.sessionRootEffective += 1;
      if (execution.constructionOrigin === "system_origin") summary.systemRootEffective += 1;
    }
    if (execution.reason === "package") summary.packageDescendants += 1;
    if (execution.serviceTransitionIds.length > 0 || execution.reason === "service_action") summary.serviceRelated += 1;
    if (execution.scheduledExecutionId || execution.reason === "cron" || execution.reason === "systemd_timer") summary.schedulerRelated += 1;
  }
  summary.missingSudoTransitions += [...sudoCommandExecutions].filter((id) => !transitionExecutions.has(id)).length;
  summary.orphanTransitions += simulation.identityTransitions.filter((transition) =>
    !simulation.executions.some((execution) => execution.id === transition.executionId)
  ).length;
  const transitionCounts = new Map();
  for (const transition of simulation.identityTransitions) {
    transitionCounts.set(transition.executionId, (transitionCounts.get(transition.executionId) || 0) + 1);
  }
  summary.duplicateTransitionMappings += [...transitionCounts.values()].filter((count) => count > 1).length;
  if (candidate.assets.some((asset) => /CanonicalAuthenticationOrigin|CanonicalIdentityTransition|authenticationOriginId|identityTransitionId|auth-origin:ssh:|identity-transition:sudo:/.test(asset.content))) {
    summary.learnerLeaks += 1;
  }
}

pass("production identity certification matrix covers families difficulties and repeated runs", () => {
  const summary = {
    labs: 0,
    totalExecutions: 0,
    categories: {},
    sshSessions: 0,
    authenticationOrigins: 0,
    sudoInvocations: 0,
    identityTransitions: 0,
    missingClassification: 0,
    unknownIdentity: 0,
    actorEffectiveChanges: 0,
    explainedIdentityChanges: 0,
    unexplainedIdentityChanges: 0,
    rootEffective: 0,
    sessionRootEffective: 0,
    systemRootEffective: 0,
    packageDescendants: 0,
    serviceRelated: 0,
    schedulerRelated: 0,
    missingSudoTransitions: 0,
    orphanTransitions: 0,
    duplicateTransitionMappings: 0,
    learnerAssets: 0,
    learnerLeaks: 0,
  };
  for (const difficulty of DIFFICULTIES) {
    for (const family of FAMILIES) {
      for (let run = 0; run < 3; run += 1) {
        const candidate = buildCandidate(`cert-matrix-${difficulty}-${family}-${run}`, { difficulty, incidentFamily: family });
        validate(candidate);
        const quality = checkLinuxInvestigationQuality(candidate);
        if (!Number.isFinite(quality.score)) throw new Error(`${difficulty}/${family}/${run} quality score missing`);
        summarizeCandidate(candidate, summary);
      }
    }
  }
  if (summary.labs !== 99) throw new Error(`expected 99 labs, got ${summary.labs}`);
  if (summary.sshSessions !== summary.authenticationOrigins) throw new Error("SSH session/authentication origin cardinality mismatch");
  if (summary.sudoInvocations !== summary.identityTransitions) throw new Error("sudo invocation/transition cardinality mismatch");
  if (summary.missingClassification || summary.unknownIdentity || summary.unexplainedIdentityChanges || summary.missingSudoTransitions || summary.orphanTransitions || summary.duplicateTransitionMappings || summary.learnerLeaks) {
    throw new Error(`identity certification failures: ${JSON.stringify(summary)}`);
  }
  console.log(`CERTIFICATION ${JSON.stringify(summary)}`);
});

const authSeed = "identity-cert-auth";

fail("remove authentication origin from valid SSH session", "must have exactly one authentication origin", () => {
  const candidate = buildCandidate(`${authSeed}-remove`);
  candidate.simulation.authenticationOrigins = [];
  validate(candidate);
});

fail("add duplicate authentication origin", "must have exactly one authentication origin", () => {
  const candidate = buildCandidate(`${authSeed}-duplicate`);
  candidate.simulation.authenticationOrigins.push({ ...primaryOrigin(candidate.simulation), id: "auth-origin:ssh:duplicate" });
  validate(candidate);
});

fail("swap authentication origin identity between known identities", "identity disagrees", () => {
  const candidate = buildCandidate(`${authSeed}-identity`);
  primaryOrigin(candidate.simulation).identityId = otherIdentity(candidate.simulation, primaryOrigin(candidate.simulation).identityId).id;
  validate(candidate);
});

fail("swap authentication origin session", "must have exactly one authentication origin", () => {
  const candidate = buildCandidate(`${authSeed}-session`);
  const { origin } = addSecondSessionAndOrigin(candidate.simulation);
  primaryOrigin(candidate.simulation).sessionId = origin.sessionId;
  validate(candidate);
});

fail("change authentication origin source IP", "source IP disagrees", () => {
  const candidate = buildCandidate(`${authSeed}-ip`);
  primaryOrigin(candidate.simulation).sourceIp = "203.0.113.7";
  validate(candidate);
});

fail("change authentication origin source port", "port disagrees", () => {
  const candidate = buildCandidate(`${authSeed}-sport`);
  primaryOrigin(candidate.simulation).sourcePort += 1;
  validate(candidate);
});

fail("change authentication origin destination port", "port disagrees", () => {
  const candidate = buildCandidate(`${authSeed}-dport`);
  primaryOrigin(candidate.simulation).destinationPort += 1;
  validate(candidate);
});

fail("change authentication method", "method disagrees", () => {
  const candidate = buildCandidate(`${authSeed}-method`);
  primaryOrigin(candidate.simulation).authenticationMethod = primaryOrigin(candidate.simulation).authenticationMethod === "password" ? "publickey" : "password";
  if (primaryOrigin(candidate.simulation).authenticationMethod !== "publickey") {
    primaryOrigin(candidate.simulation).keyFingerprint = undefined;
  }
  validate(candidate);
});

fail("remove required public key fingerprint", "key fingerprint disagrees", () => {
  const candidate = buildCandidate(`${authSeed}-fingerprint-remove`, { incidentFamily: "ssh_key_compromise" });
  primaryOrigin(candidate.simulation).keyFingerprint = undefined;
  validate(candidate);
});

fail("add fingerprint to incompatible method", "key fingerprint is invalid", () => {
  const candidate = buildCandidate(`${authSeed}-fingerprint-add`);
  primaryOrigin(candidate.simulation).authenticationMethod = "password";
  primaryOrigin(candidate.simulation).keyFingerprint = "SHA256:BADFINGERPRINT";
  validate(candidate);
});

fail("move authentication timestamp after session open", "outside SSH session opening window", () => {
  const candidate = buildCandidate(`${authSeed}-time-open`);
  primaryOrigin(candidate.simulation).authenticatedAt = addSeconds(primarySession(candidate.simulation).openedAt, 1);
  validate(candidate);
});

fail("move authentication timestamp after first session execution", "occurs after first session execution", () => {
  const candidate = buildCandidate(`${authSeed}-time-exec`);
  candidate.simulation.executions.find((execution) => execution.reason === "ssh_session").startTime = "2000-01-01 00:00:00";
  validate(candidate);
});

fail("change session username", "username disagrees", () => {
  const candidate = buildCandidate(`${authSeed}-username`);
  primarySession(candidate.simulation).username = "wrong.user";
  validate(candidate);
});

fail("change session UID", "UID disagrees", () => {
  const candidate = buildCandidate(`${authSeed}-uid`);
  primarySession(candidate.simulation).uid += 1;
  validate(candidate);
});

fail("change session GID", "GID disagrees", () => {
  const candidate = buildCandidate(`${authSeed}-gid`);
  primarySession(candidate.simulation).gid += 1;
  validate(candidate);
});

fail("authenticated-session execution omits authenticationOriginId", "missing authentication origin", () => {
  const candidate = clone(buildCandidate("identity-cert-exec-auth-missing"));
  firstAuthenticatedExecution(candidate.simulation).authenticationOriginId = undefined;
  validate(candidate);
});

fail("authenticated-session execution references another session origin", "authentication origin session mismatch", () => {
  const candidate = clone(buildCandidate("identity-cert-exec-auth-other"));
  const { origin } = addSecondSessionAndOrigin(candidate.simulation);
  firstAuthenticatedExecution(candidate.simulation).authenticationOriginId = origin.id;
  validate(candidate);
});

fail("inherited execution claims authenticated-session origin", "inherited session identity origin is not inherited", () => {
  const candidate = clone(buildCandidate("identity-cert-inherited-claims-auth"));
  firstInheritedExecution(candidate.simulation).identityOrigin = "authenticated_session";
  validate(candidate);
});

fail("system-origin execution references SSH authentication", "system-origin execution", () => {
  const candidate = clone(buildCandidate("identity-cert-system-auth"));
  const execution = firstSystemExecution(candidate.simulation);
  execution.identityOrigin = "system_origin";
  execution.authenticationOriginId = primaryOrigin(candidate.simulation).id;
  validate(candidate);
});

fail("execution actor differs from authentication identity", "authentication origin identity mismatch", () => {
  const candidate = clone(buildCandidate("identity-cert-auth-actor"));
  firstAuthenticatedExecution(candidate.simulation).identityId = "identity:root";
  validate(candidate);
});

fail("execution session differs from authentication origin session", "authentication origin session mismatch", () => {
  const candidate = clone(buildCandidate("identity-cert-auth-session"));
  firstAuthenticatedExecution(candidate.simulation).sessionId = "session:ssh:missing";
  validate(candidate);
});

fail("remove transition from directly privileged execution", "identity authority changed after lifecycle finalization", () => {
  const candidate = buildCandidate("identity-cert-transition-remove");
  primarySudoFacts(candidate).execution.identityTransitionId = undefined;
  validate(candidate);
});

fail("add duplicate transition", "duplicate identity transition id", () => {
  const candidate = buildCandidate("identity-cert-transition-duplicate");
  candidate.simulation.identityTransitions.push({ ...primarySudoFacts(candidate).transition });
  validate(candidate);
});

fail("copy transition to another execution", "identity transition execution mismatch", () => {
  const candidate = clone(buildCandidate("identity-cert-transition-copy"));
  const { transition } = primarySudoFacts(candidate);
  const otherCommand = sudoCommands(candidate.simulation).find((command) => command.executionId !== transition.executionId);
  const otherExecution = candidate.simulation.executions.find((execution) => execution.id === otherCommand.executionId);
  candidate.simulation.identityTransitions = [transition];
  otherExecution.identityOrigin = "privilege_transition";
  otherExecution.identityTransitionId = transition.id;
  validate(candidate);
});

fail("change transition actor", "execution actor mismatch", () => {
  const candidate = buildCandidate("identity-cert-transition-actor");
  const { transition } = primarySudoFacts(candidate);
  transition.actorIdentityId = otherIdentity(candidate.simulation, transition.actorIdentityId).id;
  validate(candidate);
});

fail("change transition target", "execution effective identity mismatch", () => {
  const candidate = buildCandidate("identity-cert-transition-target");
  const { transition } = primarySudoFacts(candidate);
  const replacement = candidate.simulation.identities.find((identity) =>
    identity.id !== transition.actorIdentityId && identity.id !== transition.targetIdentityId
  );
  if (!replacement) throw new Error("no third identity for target mutation");
  transition.targetIdentityId = replacement.id;
  validate(candidate);
});

fail("make transition actor and target identical", "actor and target identity are identical", () => {
  const candidate = buildCandidate("identity-cert-transition-identical");
  const { transition } = primarySudoFacts(candidate);
  transition.targetIdentityId = transition.actorIdentityId;
  validate(candidate);
});

fail("change transition session", "session mismatch", () => {
  const candidate = buildCandidate("identity-cert-transition-session");
  const { transition } = primarySudoFacts(candidate);
  transition.sessionId = addSecondSessionAndOrigin(candidate.simulation).second.id;
  validate(candidate);
});

fail("change sudo process", "sudo process missing", () => {
  const candidate = buildCandidate("identity-cert-transition-sudo-process");
  primarySudoFacts(candidate).transition.sudoProcessId = 999999;
  validate(candidate);
});

fail("point transition to non-sudo process", "sudo process is not sudo", () => {
  const candidate = buildCandidate("identity-cert-transition-nonsudo");
  const { transition, command, process } = primarySudoFacts(candidate);
  transition.sudoProcessId = process.pid;
  command.sudoProcessId = process.pid;
  validate(candidate);
});

fail("change transition command", "command missing", () => {
  const candidate = buildCandidate("identity-cert-transition-command");
  primarySudoFacts(candidate).transition.commandId = "command:missing";
  validate(candidate);
});

fail("change transition execution", "execution missing", () => {
  const candidate = buildCandidate("identity-cert-transition-execution");
  primarySudoFacts(candidate).transition.executionId = "execution:missing";
  validate(candidate);
});

fail("change requestedAt ordering", "requested after execution start", () => {
  const candidate = buildCandidate("identity-cert-transition-requested");
  const { transition, execution } = primarySudoFacts(candidate);
  transition.requestedAt = addSeconds(execution.startTime, 1);
  transition.completedAt = transition.requestedAt;
  validate(candidate);
});

fail("change completedAt ordering", "completed before it was requested", () => {
  const candidate = buildCandidate("identity-cert-transition-completed");
  primarySudoFacts(candidate).transition.completedAt = "2000-01-01 00:00:00";
  validate(candidate);
});

fail("change execution identityOrigin from privilege_transition", "identity authority changed after lifecycle finalization", () => {
  const candidate = buildCandidate("identity-cert-transition-origin");
  primarySudoFacts(candidate).execution.identityOrigin = "inherited";
  validate(candidate);
});

fail("change execution identityTransitionId", "identity authority changed after lifecycle finalization", () => {
  const candidate = buildCandidate("identity-cert-transition-id");
  primarySudoFacts(candidate).execution.identityTransitionId = undefined;
  validate(candidate);
});

fail("change command actor projection", "command actor mismatch", () => {
  const candidate = buildCandidate("identity-cert-command-actor");
  const { command } = primarySudoFacts(candidate);
  command.actorIdentityId = otherIdentity(candidate.simulation, command.actorIdentityId).id;
  validate(candidate);
});

fail("change command run-as projection", "command run-as mismatch", () => {
  const candidate = buildCandidate("identity-cert-command-runas");
  const { command } = primarySudoFacts(candidate);
  command.runAsIdentityId = command.actorIdentityId;
  validate(candidate);
});

fail("change process real UID/GID", "process actor UID/GID mismatch", () => {
  const candidate = buildCandidate("identity-cert-process-real");
  primarySudoFacts(candidate).process.realUid += 10;
  validate(candidate);
});

fail("change process effective UID/GID", "process effective UID/GID mismatch", () => {
  const candidate = buildCandidate("identity-cert-process-effective");
  primarySudoFacts(candidate).process.effectiveUid += 10;
  validate(candidate);
});

fail("give dpkg package descendant duplicate direct transition", "is inherited but directly references sudo identity transition", () => {
  const candidate = clone(buildCandidate("identity-cert-dpkg-transition", { incidentFamily: "unauthorized_package_install" }));
  const dpkg = dpkgExecution(candidate.simulation);
  dpkg.identityTransitionId = candidate.simulation.identityTransitions[0].id;
  validate(candidate);
});

fail("remove root-effective inheritance consistency from privileged descendant", "claims inherited identity authority without matching process lineage", () => {
  const candidate = clone(buildCandidate("identity-cert-dpkg-lineage", { incidentFamily: "unauthorized_package_install" }));
  const dpkg = dpkgExecution(candidate.simulation);
  dpkg.processId = undefined;
  dpkg.hostProcessId = undefined;
  validate(candidate);
});

fail("mark ordinary same-identity execution as privilege_transition", "same-identity execution cannot claim sudo transition", () => {
  const candidate = clone(buildCandidate("identity-cert-same-transition"));
  const ordinary = candidate.simulation.executions.find((execution) =>
    execution.commandId &&
    execution.identityId === (execution.effectiveIdentityId || execution.identityId)
  );
  ordinary.identityOrigin = "privilege_transition";
  ordinary.identityTransitionId = candidate.simulation.identityTransitions[0].id;
  validate(candidate);
});

fail("mark system-origin root execution as authenticated_session", "missing authentication origin", () => {
  const candidate = clone(buildCandidate("identity-cert-system-authenticated"));
  firstSystemExecution(candidate.simulation).identityOrigin = "authenticated_session";
  validate(candidate);
});

fail("post-finalization identityOrigin mutation caught by lifecycle ledger", "identity authority changed after lifecycle finalization", () => {
  const candidate = buildCandidate("identity-cert-lifecycle-origin");
  firstAuthenticatedExecution(candidate.simulation).identityOrigin = "inherited";
  validate(candidate);
});

fail("fresh contradictory identityOrigin fixture caught semantically", "execution provenance mismatch", () => {
  const candidate = clone(buildCandidate("identity-cert-semantic-origin"));
  primarySudoFacts(candidate).execution.identityOrigin = "inherited";
  validate(candidate);
});

fail("post-finalization authenticationOriginId mutation caught by lifecycle ledger", "identity authority changed after lifecycle finalization", () => {
  const candidate = buildCandidate("identity-cert-lifecycle-auth");
  const wrapper = candidate.simulation.executions.find((execution) => execution.sessionId && !execution.commandId && execution.reason === "privilege_escalation");
  wrapper.authenticationOriginId = primaryOrigin(candidate.simulation).id;
  validate(candidate);
});

fail("fresh cross-session authenticationOriginId fixture caught semantically", "authentication origin session mismatch", () => {
  const candidate = clone(buildCandidate("identity-cert-semantic-auth"));
  const { origin } = addSecondSessionAndOrigin(candidate.simulation);
  firstAuthenticatedExecution(candidate.simulation).authenticationOriginId = origin.id;
  validate(candidate);
});

fail("post-finalization identityTransitionId mutation caught by lifecycle ledger", "identity authority changed after lifecycle finalization", () => {
  const candidate = buildCandidate("identity-cert-lifecycle-transition");
  primarySudoFacts(candidate).execution.identityTransitionId = undefined;
  validate(candidate);
});

fail("fresh unrelated transition binding caught semantically", "identity transition execution mismatch", () => {
  const candidate = clone(buildCandidate("identity-cert-semantic-transition"));
  const { transition } = primarySudoFacts(candidate);
  const otherCommand = sudoCommands(candidate.simulation).find((command) => command.executionId !== transition.executionId);
  const otherExecution = candidate.simulation.executions.find((execution) => execution.id === otherCommand.executionId);
  candidate.simulation.identityTransitions = [transition];
  otherExecution.identityOrigin = "privilege_transition";
  otherExecution.identityTransitionId = transition.id;
  validate(candidate);
});

pass("architecture guard: no obsolete binding or generic authorization model exists", () => {
  const source = fs.readFileSync(path.join(ROOT, "lib", "lab-assets", "linux", "simulation.ts"), "utf8");
  for (const forbidden of [
    "CanonicalExecutionIdentityBinding",
    "identityBindingId",
    "identityBindings",
    "CanonicalAuthorization",
  ]) {
    if (source.includes(forbidden)) throw new Error(`${forbidden} exists`);
  }
});

pass("no failed SSH-auth or failed sudo canonical variants are generated", () => {
  const candidate = buildCandidate("identity-cert-no-failed");
  if (candidate.simulation.authenticationOrigins.some((origin) => origin.outcome && origin.outcome !== "success")) {
    throw new Error("failed SSH authentication origin generated");
  }
  if (candidate.simulation.identityTransitions.some((transition) => transition.outcome !== "success")) {
    throw new Error("failed sudo transition generated");
  }
});

pass("learner-visible evidence does not leak identity authority internals", () => {
  for (const difficulty of DIFFICULTIES) {
    const candidate = buildCandidate(`identity-cert-evidence-${difficulty}`, { difficulty });
    validate(candidate);
    if (difficulty === "Advanced") validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
    const leaked = candidate.assets.find((asset) =>
      /CanonicalAuthenticationOrigin|CanonicalIdentityTransition|authenticationOriginId|identityTransitionId|auth-origin:ssh:|identity-transition:sudo:/.test(asset.content)
    );
    if (leaked) throw new Error(`${difficulty} leaked identity authority internals in ${leaked.file_path}`);
  }
});
