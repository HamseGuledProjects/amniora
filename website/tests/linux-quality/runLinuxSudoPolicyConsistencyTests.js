#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const FAMILIES = [
  "misconfigured_sudoers",
  "ssh_bruteforce",
  "service_account_misuse",
  "ssh_key_compromise",
  "cron_persistence",
  "systemd_persistence",
  "unauthorized_package_install",
  "data_staging",
  "log_tampering",
  "reverse_shell",
  "docker_compromise",
];

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-sudo-policy-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (quoted && char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing asset ${filePath}`);
  return found;
}

function buildCandidate(buildLinuxAssetCandidate, family, difficulty = "Advanced") {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `sudo-policy:${family}:${difficulty}:${attempt}`,
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
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function renderedSudoPolicy(candidate) {
  return candidate.assets
    .filter((item) => /(?:^|\/)sudoers(?:\.d\/|$)|\/sudoers\.d\/|linux_config_pack\.txt$/i.test(item.file_path))
    .map((item) => item.content)
    .join("\n");
}

function groupsForUser(candidate, username) {
  const groups = new Set();
  const groupsCsv = asset(candidate, "assets/csv/groups.csv").content;
  for (const line of groupsCsv.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [group, members = ""] = parseCsvLine(line);
    if (members.split(",").map((item) => item.trim()).includes(username)) groups.add(group);
  }
  return groups;
}

function sudoFacts(candidate, sudoCommandText, resolveCanonicalCommandSudoPolicy) {
  const command = candidate.simulation.commands.find((item) => item.expectedRenderTargets.includes("sudo"));
  if (!command) throw new Error(`${candidate.investigation.incidentFamily} has no canonical sudo command`);
  const actor = candidate.simulation.identities.find((item) => item.id === command.actorIdentityId);
  const target = candidate.simulation.identities.find((item) => item.id === (command.runAsIdentityId || "identity:root"));
  if (!actor || !target) throw new Error("sudo command identity missing");
  const commandText = sudoCommandText(command);
  const decision = resolveCanonicalCommandSudoPolicy({
    simulation: candidate.simulation,
    sudoPolicyText: renderedSudoPolicy(candidate),
    command,
    groups: groupsForUser(candidate, actor.username),
  });
  return { command, actor, target, commandText, decision };
}

function expectQualityPass(name, checkLinuxInvestigationQuality, candidate) {
  const result = checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets: candidate.assets,
    simulation: candidate.simulation,
  });
  if (!result.passed) {
    throw new Error(`${name}: expected pass, got ${result.issues.map((item) => `${item.category}:${item.description}`).join("; ")}`);
  }
  console.log(`PASS ${name}`);
}

function expectQualityFail(name, checkLinuxInvestigationQuality, candidate, pattern) {
  const result = checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets: candidate.assets,
    simulation: candidate.simulation,
  });
  const text = result.issues.map((item) => `${item.category}:${item.description}`).join("; ");
  if (result.passed || !new RegExp(pattern, "i").test(text)) {
    throw new Error(`${name}: expected ${pattern}, got ${text || "pass"}`);
  }
  console.log(`PASS ${name}`);
}

function expectSemanticFail(name, validateLinuxSemanticClosure, candidate, pattern) {
  const result = validateLinuxSemanticClosure({
    simulation: candidate.simulation,
    finalAssets: candidate.assets,
  });
  const text = result.issues.map((item) => `${item.category}:${item.message}`).join("; ");
  if (result.passed || !new RegExp(pattern, "i").test(text)) {
    throw new Error(`${name}: expected ${pattern}, got ${text || "pass"}`);
  }
  console.log(`PASS ${name}`);
}

function expectDecision(name, resolveSudoPolicy, input, expected) {
  const decision = resolveSudoPolicy(input);
  if (decision.status !== expected) {
    throw new Error(`${name}: expected ${expected}, got ${decision.status} via ${decision.rule || "no rule"}`);
  }
  console.log(`PASS ${name}`);
}

function mutate(candidate, fn) {
  const copy = {
    ...candidate,
    assets: clone(candidate.assets),
  };
  fn(copy);
  return copy;
}

function injectSudoAuthFailure(candidate, facts) {
  const sudo = asset(candidate, "assets/logs/sudo.log");
  const failure = `${facts.command.timestamp} ${facts.actor.username} : authentication failure ; TTY=${facts.command.tty || "notty"} ; PWD=${facts.command.cwd} ; USER=${facts.target.username} ; COMMAND=${facts.commandText}`;
  sudo.content = `${failure}\n${sudo.content}`;
}

function injectAuthLogSudoFailure(candidate, facts) {
  const auth = asset(candidate, "assets/logs/auth.log");
  const failure = `${facts.command.timestamp} ${candidate.investigation.hostname} sudo: ${facts.actor.username} : authentication failure ; TTY=${facts.command.tty || "notty"} ; PWD=${facts.command.cwd} ; USER=${facts.target.username} ; COMMAND=${facts.commandText}`;
  auth.content = `${failure}\n${auth.content}`;
}

function injectTimelineSudoFailure(candidate, facts) {
  const timeline = asset(candidate, "assets/evidence/timeline.csv");
  const line = `${facts.command.timestamp},sudo authentication failure for ${facts.commandText},Observed,sudo.log;auth.log,high,mutated sudo auth failure,sudo_authentication,sudo.log;auth.log,,`;
  timeline.content = `${timeline.content.trim()}\n${line}\n`;
}

function removeActorFromRenderedSudoPolicy(candidate, username) {
  for (const item of candidate.assets.filter((assetItem) => /(?:^|\/)sudoers(?:\.d\/|$)|\/sudoers\.d\/|linux_config_pack\.txt$/i.test(assetItem.file_path))) {
    item.content = item.content
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith(`${username} `))
      .join("\n");
  }
}

function assertNoNopasswdFailure(candidate, facts) {
  if (facts.decision.status !== "permitted_nopasswd") {
    throw new Error(`${candidate.investigation.incidentFamily}: expected canonical sudo policy to be NOPASSWD, got ${facts.decision.status}`);
  }
  const joined = candidate.assets
    .filter((item) => item.file_path === "assets/logs/sudo.log" || item.file_path === "assets/logs/auth.log")
    .map((item) => item.content)
    .join("\n");
  if (joined.includes("authentication failure") && joined.includes(facts.commandText) && joined.includes(facts.actor.username)) {
    throw new Error(`${candidate.investigation.incidentFamily}: NOPASSWD sudo command has rendered authentication failure`);
  }
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { checkLinuxInvestigationQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const { validateLinuxSemanticClosure } = require(path.join(out, "linux", "semanticClosure.js"));
  const { sudoCommandText, resolveCanonicalCommandSudoPolicy, resolveSudoPolicy } = require(path.join(out, "linux", "sudoPolicy.js"));

  const exactPolicy = "backup ALL=(root) NOPASSWD: /usr/bin/systemctl restart ssh";
  const passwdPolicy = "backup ALL=(root) PASSWD: /usr/bin/systemctl restart ssh";
  const orderedPolicy = [
    "backup ALL=(root) PASSWD: /usr/bin/systemctl restart ssh",
    "backup ALL=(root) NOPASSWD: /usr/bin/systemctl restart ssh",
  ].join("\n");
  const basePolicyInput = {
    username: "backup",
    targetUser: "root",
    groups: new Set(),
  };
  expectDecision("exact NOPASSWD command matches", resolveSudoPolicy, {
    ...basePolicyInput,
    sudoPolicyText: exactPolicy,
    commandText: "/usr/bin/systemctl restart ssh",
  }, "permitted_nopasswd");
  expectDecision("NOPASSWD does not match different unit", resolveSudoPolicy, {
    ...basePolicyInput,
    sudoPolicyText: exactPolicy,
    commandText: "/usr/bin/systemctl restart nginx",
  }, "denied");
  expectDecision("NOPASSWD does not match different action", resolveSudoPolicy, {
    ...basePolicyInput,
    sudoPolicyText: exactPolicy,
    commandText: "/usr/bin/systemctl stop ssh",
  }, "denied");
  expectDecision("NOPASSWD does not match extra argument", resolveSudoPolicy, {
    ...basePolicyInput,
    sudoPolicyText: exactPolicy,
    commandText: "/usr/bin/systemctl restart ssh --no-block",
  }, "denied");
  expectDecision("NOPASSWD does not match different executable path", resolveSudoPolicy, {
    ...basePolicyInput,
    sudoPolicyText: exactPolicy,
    commandText: "/bin/systemctl restart ssh",
  }, "denied");
  expectDecision("PASSWD rule remains password-required", resolveSudoPolicy, {
    ...basePolicyInput,
    sudoPolicyText: passwdPolicy,
    commandText: "/usr/bin/systemctl restart ssh",
  }, "permitted_password_required");
  expectDecision("last matching sudoers rule wins", resolveSudoPolicy, {
    ...basePolicyInput,
    sudoPolicyText: orderedPolicy,
    commandText: "/usr/bin/systemctl restart ssh",
  }, "permitted_nopasswd");
  expectDecision("wildcard rule covers supported command prefix", resolveSudoPolicy, {
    ...basePolicyInput,
    sudoPolicyText: "backup ALL=(root) NOPASSWD: /usr/bin/systemctl *",
    commandText: "/usr/bin/systemctl restart nginx",
  }, "permitted_nopasswd");

  const service = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse");
  const serviceFacts = sudoFacts(service, sudoCommandText, resolveCanonicalCommandSudoPolicy);
  assertNoNopasswdFailure(service, serviceFacts);
  expectQualityPass("service-account NOPASSWD sudo evidence is internally consistent", checkLinuxInvestigationQuality, service);

  const authFailure = mutate(service, (copy) => injectSudoAuthFailure(copy, serviceFacts));
  expectQualityFail("quality rejects NOPASSWD sudo authentication failure", checkLinuxInvestigationQuality, authFailure, "NOPASSWD.*authentication failure");
  expectSemanticFail("semantic closure rejects NOPASSWD sudo authentication failure", validateLinuxSemanticClosure, authFailure, "authentication failure.*NOPASSWD");

  const authLogFailure = mutate(service, (copy) => injectAuthLogSudoFailure(copy, serviceFacts));
  expectQualityFail("quality rejects auth.log NOPASSWD sudo authentication failure", checkLinuxInvestigationQuality, authLogFailure, "auth.log authentication failure|NOPASSWD");

  const timelineFailure = mutate(service, (copy) => injectTimelineSudoFailure(copy, serviceFacts));
  expectQualityFail("quality rejects timeline NOPASSWD sudo authentication failure", checkLinuxInvestigationQuality, timelineFailure, "Timeline.*NOPASSWD");

  const missingPolicy = mutate(service, (copy) => removeActorFromRenderedSudoPolicy(copy, serviceFacts.actor.username));
  expectQualityFail("quality rejects canonical sudo success without rendered policy", checkLinuxInvestigationQuality, missingPolicy, "no matching rendered sudoers|not authorized");

  for (const family of FAMILIES) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, family);
    const facts = sudoFacts(candidate, sudoCommandText, resolveCanonicalCommandSudoPolicy);
    assertNoNopasswdFailure(candidate, facts);
    expectQualityPass(`Advanced ${family} sudo policy consistency`, checkLinuxInvestigationQuality, candidate);
  }

  for (const difficulty of ["Beginner", "Intermediate"]) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse", difficulty);
    expectQualityPass(`${difficulty} service-account sudo compatibility`, checkLinuxInvestigationQuality, candidate);
  }
}

main();
