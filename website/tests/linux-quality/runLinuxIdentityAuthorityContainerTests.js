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
  const build = path.join(os.tmpdir(), `cyberlab-linux-identity-authority-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

const out = compileIfNeeded();
const { buildLinuxAssetCandidate } = require(`${out}/linux/index.js`);
const { validateCanonicalExecutionLifecycle, validateLinuxSimulationEvidence } = require(`${out}/linux/simulation.js`);


function buildCandidate(seed, diagnostics = {}) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
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

function baseFacts(simulation) {
  const identity = simulation.identities.find((item) => item.id !== "identity:root") || simulation.identities[0];
  const root = simulation.identities.find((item) => item.id === "identity:root") || simulation.identities[0];
  const session = simulation.sshSessions[0];
  const command = simulation.commands.find((item) => item.kind === "primary_incident") || simulation.commands[0];
  const execution = simulation.executions.find((item) => item.id === command.executionId) || simulation.executions[0];
  const sudoProcess = simulation.processes.find((item) => item.pid === command.sudoProcessId) || simulation.processes[0];
  return { identity, root, session, command, execution, sudoProcess };
}

function authOrigin(simulation, overrides = {}) {
  const { identity, session } = baseFacts(simulation);
  return {
    id: "auth-origin:ssh:test",
    kind: "ssh",
    identityId: identity.id,
    sessionId: session.id,
    sourceIp: session.sourceIp,
    sourcePort: session.sourcePort,
    destinationPort: session.destinationPort,
    authenticationMethod: session.authenticationMethod,
    keyFingerprint: session.keyFingerprint,
    authenticatedAt: session.openedAt,
    ...overrides,
  };
}

function identityTransition(simulation, overrides = {}) {
  const { identity, root, session, command, execution, sudoProcess } = baseFacts(simulation);
  return {
    id: "identity-transition:sudo:test",
    kind: "sudo",
    actorIdentityId: identity.id,
    targetIdentityId: root.id,
    sessionId: session.id,
    sudoRuleId: command.sudoRuleId,
    sudoProcessId: sudoProcess.pid,
    commandId: command.id,
    executionId: execution.id,
    requestedAt: command.timestamp,
    completedAt: command.timestamp,
    outcome: "success",
    ...overrides,
  };
}

pass("identity authority containers preserve generated simulation and evidence", () => {
  const candidate = buildCandidate("identity-authority-empty");
  const assetCount = candidate.assets.length;
  if (!Array.isArray(candidate.simulation.authenticationOrigins) || candidate.simulation.authenticationOrigins.length !== candidate.simulation.sshSessions.length) {
    throw new Error("authentication origins are not a populated canonical container");
  }
  if (!Array.isArray(candidate.simulation.identityTransitions) || candidate.simulation.identityTransitions.length === 0) {
    throw new Error("identity transitions are not a populated canonical container");
  }
  validateCanonicalExecutionLifecycle(candidate.simulation);
  validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
  if (candidate.assets.length !== assetCount) throw new Error("asset count changed during validation");
});

pass("successful sudo transitions are populated while sudo wrapper executions remain unbound", () => {
  const candidate = buildCandidate("identity-authority-existing");
  const sudoCommands = candidate.simulation.commands.filter((command) => command.sudoProcessId && command.runAsIdentityId !== command.actorIdentityId);
  if (candidate.simulation.identityTransitions.length !== sudoCommands.length) {
    throw new Error("sudo transition count does not match sudo-backed commands");
  }
  const sudoWrapperExecutions = candidate.simulation.executions.filter((execution) =>
    execution.sessionId &&
    execution.effectiveIdentityId &&
    execution.effectiveIdentityId !== execution.identityId &&
    !execution.commandId &&
    execution.reason === "privilege_escalation"
  );
  if (sudoWrapperExecutions.some((execution) => execution.identityTransitionId)) {
    throw new Error("sudo wrapper execution was incorrectly directly transitioned");
  }
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("duplicate authentication-origin id is rejected", "duplicate authentication origin id", () => {
  const candidate = buildCandidate("identity-authority-dup-auth");
  candidate.simulation.authenticationOrigins.push(authOrigin(candidate.simulation), authOrigin(candidate.simulation));
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("authentication origin unknown identity is rejected", "authentication origin auth-origin:ssh:test identity missing", () => {
  const candidate = buildCandidate("identity-authority-auth-identity");
  candidate.simulation.authenticationOrigins.push(authOrigin(candidate.simulation, { identityId: "identity:missing" }));
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("authentication origin unknown session is rejected", "authentication origin auth-origin:ssh:test session missing", () => {
  const candidate = buildCandidate("identity-authority-auth-session");
  candidate.simulation.authenticationOrigins.push(authOrigin(candidate.simulation, { sessionId: "session:ssh:missing" }));
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("duplicate identity-transition id is rejected", "duplicate identity transition id", () => {
  const candidate = buildCandidate("identity-authority-dup-transition");
  candidate.simulation.identityTransitions.push(identityTransition(candidate.simulation), identityTransition(candidate.simulation));
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("identity transition unknown actor is rejected", "identity transition identity-transition:sudo:test actor identity missing", () => {
  const candidate = buildCandidate("identity-authority-transition-actor");
  candidate.simulation.identityTransitions.push(identityTransition(candidate.simulation, { actorIdentityId: "identity:missing" }));
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("identity transition unknown target is rejected", "identity transition identity-transition:sudo:test target identity missing", () => {
  const candidate = buildCandidate("identity-authority-transition-target");
  candidate.simulation.identityTransitions.push(identityTransition(candidate.simulation, { targetIdentityId: "identity:missing" }));
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("identity transition invalid process reference is rejected", "identity transition identity-transition:sudo:test sudo process missing", () => {
  const candidate = buildCandidate("identity-authority-transition-process");
  candidate.simulation.identityTransitions.push(identityTransition(candidate.simulation, { sudoProcessId: 999999 }));
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("identity transition invalid command reference is rejected", "identity transition identity-transition:sudo:test command missing", () => {
  const candidate = buildCandidate("identity-authority-transition-command");
  candidate.simulation.identityTransitions.push(identityTransition(candidate.simulation, { commandId: "command:missing" }));
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("identity transition invalid execution reference is rejected", "identity transition identity-transition:sudo:test execution missing", () => {
  const candidate = buildCandidate("identity-authority-transition-execution");
  candidate.simulation.identityTransitions.push(identityTransition(candidate.simulation, { executionId: "execution:missing" }));
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

pass("CanonicalExecutionIdentityBinding was not introduced", () => {
  const source = fs.readFileSync(path.join(ROOT, "lib", "lab-assets", "linux", "simulation.ts"), "utf8");
  for (const forbidden of [
    "CanonicalExecutionIdentityBinding",
    "identityBindingId",
    "identityBindings",
  ]) {
    if (source.includes(forbidden)) throw new Error(`${forbidden} exists`);
  }
});
