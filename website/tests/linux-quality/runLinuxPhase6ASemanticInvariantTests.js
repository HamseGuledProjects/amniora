#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-phase6a-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function buildCandidate(buildLinuxAssetCandidate, family, difficulty = "Advanced") {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `phase6a:${family}:${difficulty}:${attempt}`,
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
  throw lastError || new Error(`could not build ${family}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asset(candidate, pathName) {
  const found = candidate.assets.find((item) => item.file_path === pathName);
  if (!found) throw new Error(`missing asset ${pathName}`);
  return found;
}

function expectPass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

function expectFail(name, pattern, fn) {
  try {
    fn();
    throw new Error("__NO_FAILURE__");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message === "__NO_FAILURE__") throw new Error(`${name}: expected failure`);
    if (!new RegExp(pattern, "i").test(message)) throw new Error(`${name}: expected ${pattern}, got ${message}`);
    console.log(`PASS ${name}: ${message}`);
  }
}

function reportOrThrow(report) {
  if (report.status !== "valid") {
    throw new Error(report.issues.map((issue) => `${issue.code}:${issue.message}`).join("; "));
  }
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { parseOpenSshPublicKeyLine, validatePublicKeyLine } = require(path.join(out, "linux", "cryptographicEvidence.js"));
  const { resolveLinuxShellCommand } = require(path.join(out, "linux", "commandSemantics.js"));
  const { buildLinuxIdentitySshSudoSemanticReport } = require(path.join(out, "linux", "identitySshSudoSemantics.js"));
  const { checkLinuxInvestigationQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const { resolveSudoPolicy } = require(path.join(out, "linux", "sudoPolicy.js"));

  expectPass("deterministic exported authorized_keys lines are valid OpenSSH public keys", () => {
    const candidate = buildCandidate(buildLinuxAssetCandidate, "ssh_key_compromise");
    for (const line of asset(candidate, `assets/ssh/${candidate.investigation.primaryUser}/authorized_keys`).content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = parseOpenSshPublicKeyLine(line);
      if (!parsed) throw new Error(`unparseable key line ${line}`);
      if (!line.includes(parsed.fingerprintSha256)) throw new Error(`key line omits matching fingerprint ${parsed.fingerprintSha256}`);
    }
  });

  expectPass("invalid OpenSSH public-key structures are rejected", () => {
    if (validatePublicKeyLine("ssh-ed25519 AAAAC3NzaShort broken@example")) {
      throw new Error("short placeholder key parsed as valid");
    }
  });

  expectPass("canonical SSH key attribution renders the same fingerprint in auth and key evidence", () => {
    const candidate = buildCandidate(buildLinuxAssetCandidate, "ssh_key_compromise");
    const session = candidate.simulation.sshSessions.find((item) => item.keyFingerprint);
    if (!session) throw new Error("no key-attributed SSH session");
    const rendered = candidate.assets.map((item) => item.content).join("\n");
    if (!rendered.includes(session.keyFingerprint)) throw new Error(`rendered evidence missing ${session.keyFingerprint}`);
    reportOrThrow(buildLinuxIdentitySshSudoSemanticReport({ simulation: candidate.simulation, finalAssets: candidate.assets }));
  });

  expectPass("tilde expands to invoking user home before sudo", () => {
    const resolved = resolveLinuxShellCommand("cat ~/.ssh/authorized_keys", {
      invokingHomeDirectory: "/home/ir-analyst",
      workingDirectory: "/home/ir-analyst",
    });
    if (resolved.renderedCommand !== "/usr/bin/cat /home/ir-analyst/.ssh/authorized_keys") {
      throw new Error(`unexpected expansion ${resolved.renderedCommand}`);
    }
  });

  expectPass("ssh_key_compromise canonical commands use explicit authorized_keys path", () => {
    const candidate = buildCandidate(buildLinuxAssetCandidate, "ssh_key_compromise");
    const bad = candidate.simulation.commands.find((command) => /~\/\.ssh\/authorized_keys/.test(command.renderedCommand));
    if (bad) throw new Error(`${bad.id} preserved tilde in canonical telemetry`);
    const expected = `/home/${candidate.investigation.primaryUser}/.ssh/authorized_keys`;
    if (!candidate.simulation.commands.some((command) => command.renderedCommand.includes(expected))) {
      throw new Error(`no command references ${expected}`);
    }
  });

  expectFail("semantic report rejects historical cross-user tilde/home mismatch", "LINUX_SHELL_HOME_EXPANSION_MISMATCH", () => {
    const candidate = buildCandidate(buildLinuxAssetCandidate, "ssh_key_compromise");
    const mutated = clone(candidate);
    const command = mutated.simulation.commands.find((item) => item.renderedCommand.includes("authorized_keys"));
    if (!command) throw new Error("missing authorized_keys command");
    command.renderedCommand = "cat ~/.ssh/authorized_keys";
    command.argv = ["cat", "~/.ssh/authorized_keys"];
    reportOrThrow(buildLinuxIdentitySshSudoSemanticReport({ simulation: mutated.simulation, finalAssets: mutated.assets }));
  });

  expectPass("sudo policy exact command and NOPASSWD result are evaluated semantically", () => {
    const decision = resolveSudoPolicy({
      sudoPolicyText: "backup ALL=(root) NOPASSWD: /usr/bin/systemctl restart ssh",
      username: "backup",
      targetUser: "root",
      commandText: "/usr/bin/systemctl restart ssh",
      groups: new Set(),
    });
    if (decision.status !== "permitted_nopasswd" || !decision.authorized || decision.requiresPassword) {
      throw new Error(`unexpected sudo decision ${JSON.stringify(decision)}`);
    }
  });

  expectFail("quality rejects rendered NOPASSWD sudo authentication failure", "NOPASSWD|authentication failure", () => {
    const candidate = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse");
    const command = candidate.simulation.commands.find((item) => item.expectedRenderTargets.includes("sudo"));
    const actor = candidate.simulation.identities.find((item) => item.id === command.actorIdentityId);
    const target = candidate.simulation.identities.find((item) => item.id === (command.runAsIdentityId || "identity:root"));
    const sudoLog = asset(candidate, "assets/logs/sudo.log");
    sudoLog.content = `${command.timestamp} ${actor.username} : authentication failure ; TTY=${command.tty || "notty"} ; PWD=${command.cwd} ; USER=${target.username} ; COMMAND=${command.renderedCommand}\n${sudoLog.content}`;
    const result = checkLinuxInvestigationQuality({ context: candidate.investigation, assets: candidate.assets, simulation: candidate.simulation });
    if (result.passed) throw new Error("quality passed mutated NOPASSWD failure");
    throw new Error(result.issues.map((issue) => issue.description).join("; "));
  });
}

main();
