#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-final-artifact-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asset(assets, filePath) {
  const found = assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`${filePath} missing`);
  return found;
}

function replaceAsset(assets, filePath, replacer) {
  const target = asset(assets, filePath);
  target.content = replacer(target.content);
}

function checkAssetMutation(checkLinuxInvestigationQuality, candidate, mutate) {
  const assets = clone(candidate.assets);
  mutate(assets, candidate);
  return checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets,
    simulation: candidate.simulation,
  });
}

function checkAssetAndSimulationMutation(checkLinuxInvestigationQuality, candidate, mutate) {
  const assets = clone(candidate.assets);
  const simulation = clone(candidate.simulation);
  mutate(assets, simulation, candidate);
  return checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets,
    simulation,
  });
}

function buildFinalLab(context, assets, overrides = {}) {
  const evidence = (...names) => names.flatMap((name) => assets.filter((item) => item.file_path.endsWith(name)).map((item) => item.file_path)).slice(0, 4);
  return {
    title: "Linux host evidence review",
    subtitle: "Linux investigation using timeline and host evidence",
    topic: "Linux host investigation",
    difficulty: "Advanced",
    estimated_time: "60 mins",
    objective: `Review ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} UTC.`,
    scenario: `${context.company} SOC is reviewing case ${context.incidentId} for ${context.hostname}, a ${context.hostRole}. Evidence includes ${context.affectedService}, ${context.modifiedFiles[0]}, ${context.ticketId}, and ${context.changeId}.`,
    tasks: [
      { title: "Reconstruct the investigation timeline.", description: "Reconstruct the investigation timeline.", evidence: evidence("timeline.csv", "sudo.log", "audit.log"), deliverable: "Timeline with cited evidence." },
      { title: "Correlate account and authentication evidence.", description: "Correlate account and authentication evidence.", evidence: evidence("users.csv", "groups.csv", "auth.log"), deliverable: "Account correlation notes." },
      { title: "Compare sudo policy and observed command evidence.", description: "Compare sudo policy and observed command evidence.", evidence: evidence("sudo.log", "platform", "groups.csv"), deliverable: "Sudo policy comparison." },
    ],
    learning_outcomes: ["Correlate Linux evidence.", "Document uncertainty."],
    ...overrides,
  };
}

function expectIssue(name, result, category, text) {
  const issue = result.issues.find((item) =>
    item.category === category && new RegExp(text, "i").test(`${item.description} ${item.evidence || ""}`)
  );
  if (!issue) {
    throw new Error(`${name}: expected ${category}/${text}; got ${result.issues.map((item) => `${item.category}:${item.description}`).join(" | ")}`);
  }
  console.log(`PASS ${name}`);
}

function buildCandidateWithRetries(buildLinuxAssetCandidate, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return buildLinuxAssetCandidate(
        { category: "Linux", difficulty: "Advanced", duration: "60 mins", title: "CyberLab Asset Pack" },
        options
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("could not build final artifact validation candidate");
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    checkLinuxInvestigationQuality,
    checkLinuxFinalProductionQuality,
  } = require(path.join(out, "linux", "qualityChecker.js"));

  const candidate = buildCandidateWithRetries(buildLinuxAssetCandidate, { incidentFamily: "unauthorized_package_install" });
  const command = candidate.simulation.commands.find((item) => item.kind === "primary_incident");
  if (!command) throw new Error("candidate missing canonical command");
  const file = candidate.simulation.files.find((item) => command.affectedFileIds.includes(item.id));
  if (!command || !file) throw new Error("candidate missing canonical command/file");
  const expectedOwner = candidate.simulation.identities.find((identity) => identity.id === file.ownerIdentityId)?.username;
  const wrongOwner = candidate.simulation.identities.find((identity) => identity.username !== expectedOwner)?.username;
  if (!wrongOwner) throw new Error("candidate missing alternate rendered identity for ownership mutation");

  const late = "2099-01-01 23:59:59";
  expectIssue("final collection cutoff", checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
    replaceAsset(assets, "assets/logs/auth.log", (content) => `${content}${late} ${candidate.investigation.hostname} sshd[9999]: impossible post-collection row\n`);
  }), "timeline", "after collection");

  expectIssue("final journal header order", checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
    replaceAsset(assets, "assets/journal/journal_systemd.txt", (content) => content.replace(/^(-- Journal begins[^\n]*\n)([\s\S]*)$/, "$2\n$1"));
  }), "service_model", "header");

  expectIssue("final service drift", checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
    const drift = candidate.investigation.affectedService === "backup.service" ? "ssh.service" : "backup.service";
    replaceAsset(assets, "assets/docs/change_request.md", (content) => `${content}\nService focus: ${drift}\n`);
  }), "semantic", "service|affected service|non-primary|canonical");

  expectIssue("final command file ownership", checkAssetAndSimulationMutation(checkLinuxInvestigationQuality, candidate, (assets, simulation) => {
    const canonicalCommand = simulation.commands.find((item) => item.id === command.id);
    const canonicalFile = simulation.files.find((item) => item.id === file.id);
    canonicalFile.contentRole = "incident_output";
    if (!canonicalCommand.affectedFileIds.includes(canonicalFile.id)) canonicalCommand.affectedFileIds.push(canonicalFile.id);
    replaceAsset(assets, "assets/reports/permissions_report.txt", (content) =>
      content.replace(new RegExp(`^(${file.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+\\S+\\s+)\\S+(\\s+\\S+)`, "m"), `$1${wrongOwner}$2`)
    );
  }), "permissions", "canonical command-file");

  expectIssue("final weak risk evidence", checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
    replaceAsset(assets, "assets/evidence/risk_register.csv", (content) => `${content.trim()}\nR-901,Interactive shell observed,high,sudo.log,review\n`);
  }), "semantic", "Risk register evidence");

  expectIssue("final maintenance contradiction", checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
    replaceAsset(assets, "assets/docs/change_request.md", (content) => `${content}\nRecurring maintenance policy: Wednesday 06:00-07:00 UTC\n`);
  }), "documentation", "LINUX_TEMPORAL_DOCUMENT_WINDOW_CONTRADICTION|recurring maintenance");

  expectIssue("final duplicate network sources", checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
    replaceAsset(assets, "assets/evidence/incident_brief.md", (content) => {
      const observed = content.match(/Network sources observed in SSH session records:\s*([^,\s]+)/);
      if (!observed) throw new Error("fixture lacks an observed SSH source");
      return content.replace(/Network sources observed in SSH session records:.*/, `Network sources observed in SSH session records: ${observed[1]}, ${observed[1]}`);
    });
  }), "semantic", "duplicate");

  const badLab = buildFinalLab(candidate.investigation, candidate.assets, {
    title: `${candidate.investigation.incidentId} Linux evidence review with duplicated metadata`,
    topic: "sudo command-to-",
  });
  const finalResult = checkLinuxFinalProductionQuality({
    context: candidate.investigation,
    assets: candidate.assets,
    simulation: candidate.simulation,
    lab: badLab,
  });
  expectIssue("final malformed topic", finalResult, "generated_text", "topic");
  expectIssue("final title metadata", finalResult, "generated_text", "title");
  if (finalResult.finalProductionScore === 100 || finalResult.passed) {
    throw new Error("final quality score did not drop for malformed final narrative");
  }
  console.log("PASS final quality score drops below perfect");

  console.log(JSON.stringify({ passed: true, regressions: 10 }, null, 2));
}

main();
