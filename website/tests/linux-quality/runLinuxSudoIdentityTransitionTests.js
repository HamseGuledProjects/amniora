#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-sudo-identity-transition-${Date.now()}`);
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `${seed}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
        difficulty: diagnostics.difficulty || "Advanced",
        duration: (diagnostics.difficulty || "Advanced") === "Advanced" ? "60 mins" : (diagnostics.difficulty || "Advanced") === "Intermediate" ? "45 mins" : "30 mins",
        title: "CyberLab Asset Pack",
      }, diagnostics);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Could not build ${seed}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function sudoCommands(simulation) {
  return simulation.commands.filter((command) =>
    command.sudoProcessId &&
    command.runAsIdentityId &&
    command.runAsIdentityId !== command.actorIdentityId
  );
}

function primaryFacts(candidate) {
  const simulation = candidate.simulation;
  const command = sudoCommands(simulation)[0];
  const transition = simulation.identityTransitions.find((item) => item.commandId === command.id);
  const execution = simulation.executions.find((item) => item.id === command.executionId);
  const process = simulation.processes.find((item) => item.pid === command.processId);
  const sudoProcess = simulation.processes.find((item) => item.pid === command.sudoProcessId);
  const actor = simulation.identities.find((item) => item.id === transition.actorIdentityId);
  const target = simulation.identities.find((item) => item.id === transition.targetIdentityId);
  return { simulation, command, transition, execution, process, sudoProcess, actor, target };
}

function expectedTransitionId(executionId) {
  return `identity-transition:sudo:${executionId.replace(/^execution:/, "")}`;
}

function addSeconds(timestamp, seconds) {
  const date = new Date(`${timestamp.replace(" ", "T")}Z`);
  date.setUTCSeconds(date.getUTCSeconds() + seconds);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function otherIdentity(simulation, notId) {
  return simulation.identities.find((identity) => identity.id !== notId && identity.id !== "identity:root") ||
    simulation.identities.find((identity) => identity.id !== notId);
}

function addSecondSession(simulation, identity) {
  const session = simulation.sshSessions[0];
  const second = {
    ...session,
    id: "session:ssh:phase3a3-second",
    identityId: identity.id,
    username: identity.username,
    uid: identity.uid,
    gid: identity.gid,
    sourceIp: "10.33.44.55",
    sourcePort: 54123,
    sessionPid: 9911,
    shellPid: 9912,
  };
  const origin = {
    ...simulation.authenticationOrigins[0],
    id: "auth-origin:ssh:phase3a3-second",
    identityId: identity.id,
    sessionId: second.id,
    sourceIp: second.sourceIp,
    sourcePort: second.sourcePort,
  };
  simulation.sshSessions.push(second);
  simulation.authenticationOrigins.push(origin);
  return second;
}

function validateMutated(candidate) {
  validateCanonicalExecutionLifecycle(candidate.simulation);
}

pass("every generated successful sudo invocation has exactly one identity transition", () => {
  const candidate = buildCandidate("sudo-transition-coverage");
  const commands = sudoCommands(candidate.simulation);
  if (commands.length === 0) throw new Error("no successful sudo commands generated");
  if (candidate.simulation.identityTransitions.length !== commands.length) {
    throw new Error(`expected ${commands.length} transitions, got ${candidate.simulation.identityTransitions.length}`);
  }
  for (const command of commands) {
    const transitions = candidate.simulation.identityTransitions.filter((transition) => transition.commandId === command.id);
    if (transitions.length !== 1) throw new Error(`${command.id} has ${transitions.length} transitions`);
  }
  validateMutated(candidate);
});

pass("transition ID is deterministic across repeated generation", () => {
  const left = buildCandidate("sudo-transition-deterministic");
  const right = clone(left);
  const leftIds = left.simulation.identityTransitions.map((transition) => transition.id).sort();
  const rightIds = right.simulation.identityTransitions.map((transition) => transition.id).sort();
  if (JSON.stringify(leftIds) !== JSON.stringify(rightIds)) throw new Error("transition IDs changed across deterministic generation");
  for (const transition of left.simulation.identityTransitions) {
    if (transition.id !== expectedTransitionId(transition.executionId)) throw new Error(`unexpected transition id ${transition.id}`);
  }
});

fail("duplicate transition ID is rejected", "duplicate identity transition id", () => {
  const candidate = buildCandidate("sudo-transition-duplicate-id");
  const { transition } = primaryFacts(candidate);
  candidate.simulation.identityTransitions.push({ ...transition });
  validateMutated(candidate);
});

fail("two transitions binding the same directly privileged execution are rejected", "duplicate identity transition id", () => {
  const candidate = buildCandidate("sudo-transition-duplicate-execution");
  const { transition } = primaryFacts(candidate);
  candidate.simulation.identityTransitions.push({ ...transition });
  validateMutated(candidate);
});

fail("one transition copied to another execution is rejected", "identity transition execution mismatch", () => {
  const candidate = clone(buildCandidate("sudo-transition-copied"));
  const { transition } = primaryFacts(candidate);
  const otherCommand = sudoCommands(candidate.simulation).find((command) => command.executionId !== transition.executionId);
  const other = candidate.simulation.executions.find((execution) => execution.id === otherCommand.executionId);
  candidate.simulation.identityTransitions = [transition];
  other.identityOrigin = "privilege_transition";
  other.identityTransitionId = transition.id;
  validateMutated(candidate);
});

fail("transition actor changed to another known identity is rejected", "execution actor mismatch", () => {
  const candidate = buildCandidate("sudo-transition-actor");
  const { transition } = primaryFacts(candidate);
  transition.actorIdentityId = otherIdentity(candidate.simulation, transition.actorIdentityId).id;
  validateMutated(candidate);
});

fail("transition target changed from root to actor identity is rejected", "actor and target identity are identical", () => {
  const candidate = buildCandidate("sudo-transition-target");
  const { transition } = primaryFacts(candidate);
  transition.targetIdentityId = transition.actorIdentityId;
  validateMutated(candidate);
});

fail("transition actor and target being identical is rejected", "actor and target identity are identical", () => {
  const candidate = buildCandidate("sudo-transition-identical");
  const { transition } = primaryFacts(candidate);
  transition.targetIdentityId = transition.actorIdentityId;
  validateMutated(candidate);
});

fail("transition session changed to another session is rejected", "session mismatch", () => {
  const candidate = buildCandidate("sudo-transition-other-session");
  const { transition } = primaryFacts(candidate);
  const other = otherIdentity(candidate.simulation, transition.actorIdentityId);
  const second = addSecondSession(candidate.simulation, other);
  transition.sessionId = second.id;
  validateMutated(candidate);
});

fail("transition references unknown session", "session missing", () => {
  const candidate = buildCandidate("sudo-transition-unknown-session");
  primaryFacts(candidate).transition.sessionId = "session:ssh:missing";
  validateMutated(candidate);
});

fail("transition references unknown sudo rule", "sudo rule mismatch", () => {
  const candidate = buildCandidate("sudo-transition-unknown-rule");
  primaryFacts(candidate).transition.sudoRuleId = "sudo-rule:missing";
  validateMutated(candidate);
});

fail("transition references unrelated sudo rule", "sudo rule mismatch", () => {
  const candidate = buildCandidate("sudo-transition-unrelated-rule");
  primaryFacts(candidate).transition.sudoRuleId = "sudo-rule:unrelated";
  validateMutated(candidate);
});

fail("transition references unknown sudo process", "sudo process missing", () => {
  const candidate = buildCandidate("sudo-transition-unknown-process");
  primaryFacts(candidate).transition.sudoProcessId = 999999;
  validateMutated(candidate);
});

fail("transition references non-sudo process", "sudo process is not sudo", () => {
  const candidate = buildCandidate("sudo-transition-nonsudo-process");
  const { transition, command, process } = primaryFacts(candidate);
  transition.sudoProcessId = process.pid;
  command.sudoProcessId = process.pid;
  validateMutated(candidate);
});

fail("transition references unknown command", "command missing", () => {
  const candidate = buildCandidate("sudo-transition-unknown-command");
  primaryFacts(candidate).transition.commandId = "command:missing";
  validateMutated(candidate);
});

fail("transition references unrelated command", "command/execution mismatch", () => {
  const candidate = buildCandidate("sudo-transition-unrelated-command");
  const { transition } = primaryFacts(candidate);
  const other = candidate.simulation.commands.find((command) => command.id !== transition.commandId);
  transition.commandId = other.id;
  validateMutated(candidate);
});

fail("transition references unknown execution", "execution missing", () => {
  const candidate = buildCandidate("sudo-transition-unknown-execution");
  primaryFacts(candidate).transition.executionId = "execution:missing";
  validateMutated(candidate);
});

fail("transition execution actor differs from transition actor", "execution actor mismatch", () => {
  const candidate = clone(buildCandidate("sudo-transition-execution-actor"));
  const { execution } = primaryFacts(candidate);
  execution.identityId = otherIdentity(candidate.simulation, execution.identityId).id;
  validateMutated(candidate);
});

fail("transition execution effective identity differs from target", "execution effective identity mismatch", () => {
  const candidate = clone(buildCandidate("sudo-transition-execution-effective"));
  const { execution } = primaryFacts(candidate);
  execution.effectiveIdentityId = execution.identityId;
  validateMutated(candidate);
});

fail("command actor differs from transition actor", "command actor mismatch", () => {
  const candidate = buildCandidate("sudo-transition-command-actor");
  const { command } = primaryFacts(candidate);
  command.actorIdentityId = otherIdentity(candidate.simulation, command.actorIdentityId).id;
  validateMutated(candidate);
});

fail("command run-as differs from transition target", "command run-as mismatch", () => {
  const candidate = buildCandidate("sudo-transition-command-runas");
  const { command } = primaryFacts(candidate);
  command.runAsIdentityId = command.actorIdentityId;
  validateMutated(candidate);
});

fail("process real UID/GID differs from actor identity", "process actor UID/GID mismatch", () => {
  const candidate = buildCandidate("sudo-transition-process-real");
  primaryFacts(candidate).process.realUid += 100;
  validateMutated(candidate);
});

fail("process effective UID/GID differs from target identity", "process effective UID/GID mismatch", () => {
  const candidate = buildCandidate("sudo-transition-process-effective");
  primaryFacts(candidate).process.effectiveUid += 100;
  validateMutated(candidate);
});

fail("privileged sudo execution omits identityTransitionId", "execution provenance mismatch", () => {
  const candidate = clone(buildCandidate("sudo-transition-missing-ref"));
  primaryFacts(candidate).execution.identityTransitionId = undefined;
  validateMutated(candidate);
});

fail("privileged sudo execution claims inherited origin", "execution provenance mismatch", () => {
  const candidate = clone(buildCandidate("sudo-transition-inherited"));
  primaryFacts(candidate).execution.identityOrigin = "inherited";
  validateMutated(candidate);
});

fail("ordinary same-identity command claims privilege-transition origin", "same-identity execution cannot claim sudo transition", () => {
  const candidate = clone(buildCandidate("sudo-transition-same-identity"));
  const { transition } = primaryFacts(candidate);
  const ordinary = candidate.simulation.executions.find((execution) =>
    execution.commandId &&
    execution.identityId === (execution.effectiveIdentityId || execution.identityId)
  );
  ordinary.identityOrigin = "privilege_transition";
  ordinary.identityTransitionId = transition.id;
  validateMutated(candidate);
});

fail("system-origin execution references sudo transition", "system-origin execution", () => {
  const candidate = clone(buildCandidate("sudo-transition-system-origin"));
  const { transition } = primaryFacts(candidate);
  const system = candidate.simulation.executions.find((execution) => execution.constructionOrigin === "system_origin");
  system.identityOrigin = "system_origin";
  system.identityTransitionId = transition.id;
  validateMutated(candidate);
});

fail("transition requestedAt occurs after execution start", "requested after execution start", () => {
  const candidate = buildCandidate("sudo-transition-request-after");
  const { transition, execution } = primaryFacts(candidate);
  transition.requestedAt = addSeconds(execution.startTime, 1);
  transition.completedAt = transition.requestedAt;
  validateMutated(candidate);
});

fail("transition completedAt precedes requestedAt", "completed before it was requested", () => {
  const candidate = buildCandidate("sudo-transition-completed-before");
  const { transition } = primaryFacts(candidate);
  transition.completedAt = "2000-01-01 00:00:00";
  validateMutated(candidate);
});

fail("transition occurs outside session lifetime", "outside SSH session lifetime", () => {
  const candidate = buildCandidate("sudo-transition-outside-session");
  const { transition } = primaryFacts(candidate);
  const session = candidate.simulation.sshSessions.find((item) => item.id === transition.sessionId);
  session.closedAt = "2000-01-01 00:00:00";
  validateMutated(candidate);
});

fail("post-finalization mutation of identityTransitionId is detected before ledger acceptance", "command/execution mismatch", () => {
  const candidate = buildCandidate("sudo-transition-finalized-ref");
  const { transition, execution } = primaryFacts(candidate);
  const renamed = expectedTransitionId(execution.id).replace(/$/, "-renamed");
  transition.id = renamed;
  transition.executionId = `${execution.id}-renamed`;
  execution.id = `${execution.id}-renamed`;
  execution.identityTransitionId = renamed;
  validateMutated(candidate);
});

fail("post-finalization mutation of identityOrigin is detected by lifecycle integrity", "identity authority changed after lifecycle finalization", () => {
  const candidate = buildCandidate("sudo-transition-finalized-origin");
  const { execution } = primaryFacts(candidate);
  execution.identityOrigin = "inherited";
  validateMutated(candidate);
});

pass("apt directly transitioned but dpkg descendant is not given duplicate transition", () => {
  const candidate = buildCandidate("sudo-transition-apt-dpkg", { incidentFamily: "unauthorized_package_install" });
  const apt = sudoCommands(candidate.simulation).find((command) => /\bapt\s+install\b/.test(command.renderedCommand));
  if (!apt) throw new Error("apt sudo command missing");
  const aptTransitions = candidate.simulation.identityTransitions.filter((transition) => transition.commandId === apt.id);
  if (aptTransitions.length !== 1) throw new Error("apt command does not have exactly one transition");
  const dpkg = candidate.simulation.executions.find((execution) => execution.id.includes("execution:package:dpkg"));
  if (!dpkg) throw new Error("dpkg descendant missing");
  if (dpkg.identityTransitionId) throw new Error("dpkg descendant received duplicate transition");
  validateMutated(candidate);
});

fail("dpkg descendant effective identity contradicts inherited root authority and is rejected", "effective UID/GID disagrees with process", () => {
  const candidate = buildCandidate("sudo-transition-dpkg-drift", { incidentFamily: "unauthorized_package_install" });
  const dpkg = candidate.simulation.executions.find((execution) => execution.id.includes("execution:package:dpkg"));
  const process = candidate.simulation.processes.find((item) => item.id === dpkg.processId);
  process.effectiveUid = 1000;
  validateMutated(candidate);
});

pass("existing SSH authentication provenance remains valid", () => {
  const candidate = buildCandidate("sudo-transition-ssh-provenance");
  if (candidate.simulation.authenticationOrigins.length !== candidate.simulation.sshSessions.length) {
    throw new Error("SSH authentication origin cardinality regressed");
  }
  validateMutated(candidate);
});

pass("no failed sudo transition is generated", () => {
  const candidate = buildCandidate("sudo-transition-no-failed");
  if (candidate.simulation.identityTransitions.some((transition) => transition.outcome !== "success")) {
    throw new Error("failed sudo transition was generated");
  }
});

pass("CanonicalExecutionIdentityBinding does not exist", () => {
  const source = fs.readFileSync(path.join(ROOT, "lib", "lab-assets", "linux", "simulation.ts"), "utf8");
  for (const forbidden of ["CanonicalExecutionIdentityBinding", "identityBindingId", "identityBindings"]) {
    if (source.includes(forbidden)) throw new Error(`${forbidden} exists`);
  }
});

pass("representative learner-visible evidence remains valid and does not expose transition internals", () => {
  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const candidate = buildCandidate(`sudo-transition-renderer-${difficulty}`, { difficulty });
    const assetPaths = candidate.assets.map((asset) => asset.file_path);
    if (assetPaths.length === 0) throw new Error(`${difficulty} generated no assets`);
    if (new Set(assetPaths).size !== assetPaths.length) throw new Error(`${difficulty} has duplicate asset paths`);
    if (candidate.assets.some((asset) => /identity-transition:sudo|identityTransitionId|CanonicalIdentityTransition/.test(asset.content))) {
      throw new Error(`${difficulty} leaked canonical transition internals into learner-visible evidence`);
    }
    validateCanonicalExecutionLifecycle(candidate.simulation);
    const quality = checkLinuxInvestigationQuality(candidate);
    if (!Number.isFinite(quality.score)) throw new Error(`${difficulty} quality score missing`);
    if (difficulty === "Advanced") validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
  }
});
