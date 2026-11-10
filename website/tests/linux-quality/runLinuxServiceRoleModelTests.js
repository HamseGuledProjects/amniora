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
  const build = path.join(os.tmpdir(), `cyberlab-linux-service-roles-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function buildCandidate(buildLinuxAssetCandidate, family, difficulty = "Advanced") {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `service-role:${family}:${difficulty}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration: "30 mins",
          title: "CyberLab Asset Pack",
        }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function assertServiceModel(name, candidate) {
  const primary = candidate.simulation.services.filter((service) => service.role === "primary");
  if (primary.length !== 1) throw new Error(`${name}: expected exactly one primary service, got ${primary.length}`);
  for (const service of candidate.simulation.services) {
    if (!["primary", "secondary", "background"].includes(service.role)) {
      throw new Error(`${name}: invalid service role ${service.unitName}:${service.role}`);
    }
  }
  const rendered = candidate.assets.map((asset) => asset.content).join("\n");
  if (!rendered.includes(primary[0].unitName)) {
    throw new Error(`${name}: primary service ${primary[0].unitName} absent from evidence`);
  }
}

function narrativeFor(candidate, serviceSentence) {
  const context = candidate.investigation;
  const primary = candidate.simulation.services.find((service) => service.role === "primary").unitName;
  const assetById = new Map(candidate.simulation.evidenceRegistry.map((asset) => [asset.id, asset]));
  return {
    title: `Linux ${primary} evidence review`,
    objective: `Reconstruct ${primary} evidence on ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}.`,
    scenario: `${context.company} SOC is reviewing ${context.incidentId} on ${context.hostname}, a ${context.hostRole}, for ${context.changeId} during ${context.incidentWindowStart}-${context.incidentWindowEnd} ${context.timezone}. The investigation centres on ${primary}. ${serviceSentence}`,
    tasks: candidate.simulation.canonicalTasks.map((task) => ({
      phase: `Task ${task.order}`,
      title: `Review ${task.intent.replace(/_/g, " ")} evidence for ${context.hostname}.`,
      evidence: task.selectedEvidenceAssetIds
        .map((id) => assetById.get(id)?.path)
        .filter(Boolean),
      deliverable: `Prepare a ${task.expectedDeliverableType.replace(/_/g, " ")} using only the listed evidence.`,
    })),
    hints: ["Keep primary, secondary, and background service roles separate.", "Cite only rendered evidence.", "State uncertainty where evidence is incomplete."],
    outcomes: ["Explain the canonical primary service.", "Distinguish supporting service context.", "Avoid promoting background services."],
  };
}

function serviceIssues(checkLinuxInvestigationQuality, candidate, lab) {
  return checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets: candidate.assets,
    simulation: candidate.simulation,
    lab,
  }).issues.filter((issue) =>
    issue.category === "service_model" ||
    (issue.category !== "generated_text" && /\b(?:background service|primary service|secondary service|non-primary service|canonical service inventory|unsupported service|not rendered)\b/i.test(`${issue.description} ${issue.evidence || ""}`))
  );
}

function expectNoServiceIssue(name, checkLinuxInvestigationQuality, candidate, lab) {
  const issues = serviceIssues(checkLinuxInvestigationQuality, candidate, lab);
  if (issues.length > 0) {
    throw new Error(`${name}: unexpected service issue ${issues.map((issue) => issue.description).join("; ")}`);
  }
  console.log(`PASS ${name}`);
}

function expectServiceIssue(name, checkLinuxInvestigationQuality, candidate, lab, pattern) {
  const issues = serviceIssues(checkLinuxInvestigationQuality, candidate, lab);
  const text = issues.map((issue) => `${issue.category}:${issue.description}:${issue.evidence || ""}`).join("; ");
  if (!new RegExp(pattern, "i").test(text)) {
    throw new Error(`${name}: expected ${pattern}, got ${text || "none"}`);
  }
  console.log(`PASS ${name}`);
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { checkLinuxInvestigationQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const {
    canonicalPrimaryService,
    canonicalSecondaryServices,
    canonicalBackgroundServices,
  } = require(path.join(out, "linux", "simulation.js"));

  const serviceAccount = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse");
  assertServiceModel("single primary service", serviceAccount);
  console.log(`PASS single primary service ${canonicalPrimaryService(serviceAccount.simulation).unitName}`);

  const secondary = canonicalSecondaryServices(serviceAccount.simulation)[0];
  if (!secondary) throw new Error("service account candidate lacks secondary service");
  expectNoServiceIssue(
    "secondary service narrative reference is accepted",
    checkLinuxInvestigationQuality,
    serviceAccount,
    narrativeFor(serviceAccount, `${secondary.unitName} appears as supporting service context in the evidence.`)
  );

  const multiSecondary = FAMILIES.map((family) => buildCandidate(buildLinuxAssetCandidate, family))
    .find((candidate) => canonicalSecondaryServices(candidate.simulation).length >= 2);
  if (!multiSecondary) throw new Error("no generated candidate had multiple secondary services");
  assertServiceModel("primary plus multiple secondary services", multiSecondary);
  console.log("PASS primary plus multiple secondary services");

  const background = canonicalBackgroundServices(serviceAccount.simulation)[0];
  if (!background) throw new Error("service account candidate lacks background service");
  expectServiceIssue(
    "background service cannot be narrative centre",
    checkLinuxInvestigationQuality,
    serviceAccount,
    narrativeFor(serviceAccount, `The investigation centres on ${background.unitName}.`),
    "background service"
  );
  expectServiceIssue(
    "unsupported service promotion is rejected",
    checkLinuxInvestigationQuality,
    serviceAccount,
    narrativeFor(serviceAccount, "The investigation centres on shadow-sync.service."),
    "not rendered|unsupported|canonical service inventory"
  );

  for (const family of FAMILIES) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, family);
    assertServiceModel(`Advanced ${family}`, candidate);
    const quality = checkLinuxInvestigationQuality({
      context: candidate.investigation,
      assets: candidate.assets,
      simulation: candidate.simulation,
      workload: { requestedDifficulty: "Advanced", requestedDurationMinutes: 30 },
    });
    if (!quality.passed) {
      throw new Error(`${family}: quality failed ${quality.issues.map((issue) => `${issue.category}:${issue.description}`).join("; ")}`);
    }
    console.log(`PASS Advanced ${family} service model`);
  }

  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, "service_account_misuse", difficulty);
    assertServiceModel(`${difficulty} service model`, candidate);
    console.log(`PASS ${difficulty} service model compatibility`);
  }
}

main();
