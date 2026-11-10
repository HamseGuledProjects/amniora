#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-ssh-auth-provenance-${Date.now()}`);
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function primarySession(simulation) {
  return simulation.sshSessions[0];
}

function primaryOrigin(simulation) {
  return simulation.authenticationOrigins.find((origin) => origin.sessionId === primarySession(simulation).id);
}

function firstSshExecution(simulation) {
  return simulation.executions.find((execution) => execution.reason === "ssh_session");
}

function shellExecution(simulation) {
  return simulation.executions.find((execution) => execution.reason === "interactive_shell");
}

function addSecondSessionAndOrigin(simulation) {
  const root = simulation.identities.find((identity) => identity.id === "identity:root");
  const session = primarySession(simulation);
  const second = {
    ...session,
    id: "session:ssh:second",
    identityId: root.id,
    username: root.username,
    uid: root.uid,
    gid: root.gid,
    sourceIp: "10.10.10.10",
    sourcePort: 53000,
    sessionPid: 9991,
    shellPid: 9992,
  };
  const origin = {
    ...primaryOrigin(simulation),
    id: "auth-origin:ssh:second",
    identityId: root.id,
    sessionId: second.id,
    sourceIp: second.sourceIp,
    sourcePort: second.sourcePort,
  };
  simulation.sshSessions.push(second);
  simulation.authenticationOrigins.push(origin);
  return { second, origin };
}

pass("every generated SSH session has exactly one authentication origin", () => {
  const candidate = buildCandidate("ssh-provenance-coverage");
  for (const session of candidate.simulation.sshSessions) {
    const origins = candidate.simulation.authenticationOrigins.filter((origin) => origin.sessionId === session.id);
    if (origins.length !== 1) throw new Error(`${session.id} has ${origins.length} origins`);
  }
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

pass("authentication origin ID is deterministically derived from the session ID", () => {
  const candidate = buildCandidate("ssh-provenance-deterministic");
  const session = primarySession(candidate.simulation);
  const origin = primaryOrigin(candidate.simulation);
  if (origin.id !== `auth-origin:ssh:${session.id.replace(/^session:ssh:/, "")}`) {
    throw new Error(`unexpected authentication origin ID ${origin.id}`);
  }
});

fail("duplicate origin for one session is rejected", "must have exactly one authentication origin", () => {
  const candidate = buildCandidate("ssh-provenance-duplicate-session");
  candidate.simulation.authenticationOrigins.push({
    ...primaryOrigin(candidate.simulation),
    id: "auth-origin:ssh:duplicate",
  });
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("origin referencing another session identity is rejected", "identity disagrees with SSH session", () => {
  const candidate = buildCandidate("ssh-provenance-other-session-identity");
  const { origin } = addSecondSessionAndOrigin(candidate.simulation);
  primaryOrigin(candidate.simulation).identityId = origin.identityId;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("origin source IP drift is rejected", "source IP disagrees", () => {
  const candidate = buildCandidate("ssh-provenance-source-ip");
  primaryOrigin(candidate.simulation).sourceIp = "203.0.113.200";
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("origin authentication method drift is rejected", "method disagrees", () => {
  const candidate = buildCandidate("ssh-provenance-method");
  primaryOrigin(candidate.simulation).authenticationMethod =
    primaryOrigin(candidate.simulation).authenticationMethod === "password" ? "publickey" : "password";
  if (primaryOrigin(candidate.simulation).authenticationMethod !== "publickey") {
    primaryOrigin(candidate.simulation).keyFingerprint = undefined;
  }
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("public-key fingerprint mismatch is rejected", "key fingerprint disagrees", () => {
  const candidate = buildCandidate("ssh-provenance-fingerprint", { incidentFamily: "ssh_key_compromise" });
  primaryOrigin(candidate.simulation).keyFingerprint = "SHA256:DIFFERENT";
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("session username drift from identity is rejected", "username disagrees", () => {
  const candidate = buildCandidate("ssh-provenance-session-username");
  primarySession(candidate.simulation).username = "wrong.user";
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("session UID drift from identity is rejected", "UID disagrees", () => {
  const candidate = buildCandidate("ssh-provenance-session-uid");
  primarySession(candidate.simulation).uid += 1000;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("session GID drift from identity is rejected", "GID disagrees", () => {
  const candidate = buildCandidate("ssh-provenance-session-gid");
  primarySession(candidate.simulation).gid += 1000;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("authentication timestamp after session open is rejected", "outside SSH session opening window", () => {
  const candidate = buildCandidate("ssh-provenance-auth-after-open");
  primaryOrigin(candidate.simulation).authenticatedAt = candidate.simulation.collection.collectedAt;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("authentication timestamp after first session execution is rejected", "occurs after first session execution", () => {
  const candidate = buildCandidate("ssh-provenance-auth-after-first-exec");
  firstSshExecution(candidate.simulation).startTime = "2000-01-01 00:00:00";
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("authenticated-session execution without authenticationOriginId is rejected", "missing authentication origin", () => {
  const candidate = clone(buildCandidate("ssh-provenance-missing-exec-origin"));
  firstSshExecution(candidate.simulation).authenticationOriginId = undefined;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("execution authenticationOriginId from another session is rejected", "authentication origin session mismatch", () => {
  const candidate = clone(buildCandidate("ssh-provenance-wrong-exec-session"));
  const { origin } = addSecondSessionAndOrigin(candidate.simulation);
  shellExecution(candidate.simulation).authenticationOriginId = origin.id;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("execution actor identity differing from authentication origin is rejected", "authentication origin identity mismatch", () => {
  const candidate = clone(buildCandidate("ssh-provenance-wrong-exec-identity"));
  firstSshExecution(candidate.simulation).identityId = "identity:root";
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("system-origin execution falsely referencing SSH authentication origin is rejected", "system-origin execution", () => {
  const candidate = clone(buildCandidate("ssh-provenance-system-auth"));
  const systemExecution = candidate.simulation.executions.find((execution) => execution.constructionOrigin === "system_origin");
  systemExecution.identityOrigin = "system_origin";
  systemExecution.authenticationOriginId = primaryOrigin(candidate.simulation).id;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("post-finalization authenticationOriginId mutation is detected by lifecycle integrity", "changed after lifecycle finalization", () => {
  const candidate = buildCandidate("ssh-provenance-finalized-auth-origin");
  firstSshExecution(candidate.simulation).authenticationOriginId = undefined;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

fail("post-finalization identityOrigin mutation is detected by lifecycle integrity", "changed after lifecycle finalization", () => {
  const candidate = buildCandidate("ssh-provenance-finalized-identity-origin");
  const execution = candidate.simulation.executions.find((item) =>
    item.sessionId &&
    item.effectiveIdentityId &&
    item.effectiveIdentityId !== item.identityId
  );
  execution.identityOrigin = "inherited";
  execution.authenticationOriginId = primaryOrigin(candidate.simulation).id;
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

pass("SSH authentication provenance remains valid with sudo identity transitions present", () => {
  const candidate = buildCandidate("ssh-provenance-with-sudo-transitions");
  if (candidate.simulation.identityTransitions.length === 0) throw new Error("sudo identity transition records were not generated");
  if (candidate.simulation.identityTransitions.some((transition) => transition.kind !== "sudo")) {
    throw new Error("non-sudo transition record was generated");
  }
  validateCanonicalExecutionLifecycle(candidate.simulation);
});

pass("CanonicalExecutionIdentityBinding does not exist in Linux source", () => {
  const source = require("fs").readFileSync(path.join(ROOT, "lib", "lab-assets", "linux", "simulation.ts"), "utf8");
  if (source.includes("CanonicalExecutionIdentityBinding")) throw new Error("CanonicalExecutionIdentityBinding exists");
});

pass("representative evidence validation remains unchanged", () => {
  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const candidate = buildCandidate(`ssh-provenance-evidence-${difficulty}`, { difficulty });
    validateCanonicalExecutionLifecycle(candidate.simulation);
    if (difficulty === "Advanced") {
      validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
    }
    if (candidate.assets.length === 0) throw new Error(`${difficulty} generated no learner assets`);
  }
});
