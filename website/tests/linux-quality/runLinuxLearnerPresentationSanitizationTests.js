#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-presentation-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

const forbiddenLearnerSyntax =
  /\b(?:identity|session|command|process|file):[A-Za-z0-9._:-]+|\b(?:executed_by|spawned_process|opened_file|covered_by_change|inside_maintenance_window|authenticated_as|service_state|service_transition|primary-window|incident-primary)\b/;
const forbiddenRegistryPrefix =
  /\b(?:identity|session|command|process|file|cron|scheduled|package|transition|event|fact|document|evidence|service|maintenance|change|group|auth-origin|execution):[A-Za-z0-9._:-]+/;
const forbiddenRegistryPrefixWithEvidenceCronRefs =
  /\b(?:identity|session|command|process|file|package|transition|event|fact|document|evidence|service|maintenance|change|group|auth-origin|execution):[A-Za-z0-9._:-]+/;

function assertNoLeak(label, text, options = {}) {
  const match = String(text || "").match(forbiddenLearnerSyntax);
  if (match) {
    throw new Error(`${label} leaks internal canonical syntax: ${match[0]}`);
  }
  const registryPattern = options.allowEvidenceCronRefs ? forbiddenRegistryPrefixWithEvidenceCronRefs : forbiddenRegistryPrefix;
  const registryMatch = String(text || "").match(registryPattern);
  if (registryMatch) {
    throw new Error(`${label} leaks internal registry identifier: ${registryMatch[0]}`);
  }
}

function buildAdvanced(buildLinuxAssetCandidate, family) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        category: "Linux",
        difficulty: "Advanced",
        duration: "60 mins",
        title: "CyberLab Asset Pack",
      }, family ? { incidentFamily: family } : {});
      if (!family || candidate.investigation.incidentFamily === family) return candidate;
    } catch {
      // Keep searching for deterministic coverage across incident families.
    }
  }
  throw new Error(`could not generate Advanced Linux candidate${family ? ` for ${family}` : ""}`);
}

function learnerNarrativeText(candidate) {
  const parts = [];
  parts.push(`title=${candidate.investigation.title}`);
  parts.push(`objective=${candidate.investigation.objective}`);
  parts.push(`scenario=${candidate.investigation.scenario}`);
  return parts.join("\n\n---\n\n");
}

function learnerAssetTexts(candidate) {
  const parts = [];
  for (const asset of candidate.assets) {
    if (!asset.file_path.startsWith("assets/")) continue;
    parts.push({ label: asset.file_path, text: `asset=${asset.file_path}\n${asset.content}` });
  }
  return parts;
}

function assertLearnerOutputSanitized(label, candidate) {
  assertNoLeak(`${label} narrative`, learnerNarrativeText(candidate));
  for (const asset of learnerAssetTexts(candidate)) {
    assertNoLeak(`${label} ${asset.label}`, asset.text, { allowEvidenceCronRefs: true });
  }
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildLinuxCanonicalNarrativeBrief } = require(path.join(out, "linux", "simulation.js"));

  const families = [
    "ssh_bruteforce",
    "misconfigured_sudoers",
    "service_account_misuse",
    "cron_persistence",
    "systemd_persistence",
    "unauthorized_package_install",
    "data_staging",
    "docker_compromise",
    "reverse_shell",
    "log_tampering",
  ];

  for (const family of families) {
    const candidate = buildAdvanced(buildLinuxAssetCandidate, family);
    assertLearnerOutputSanitized(family, candidate);
    console.log(`PASS ${family}`);
  }

  const sample = buildAdvanced(buildLinuxAssetCandidate);
  const internalId = sample.simulation.commands.find((command) => command.id.startsWith("command:"))?.id || "";
  if (!internalId) throw new Error("internal canonical command id missing from simulation");
  const internalBrief = buildLinuxCanonicalNarrativeBrief(sample.simulation);
  if (!internalBrief.includes(internalId)) throw new Error("internal canonical brief no longer retains canonical command IDs");
  assertLearnerOutputSanitized("sample learner-visible output", sample);
  console.log("PASS internal canonical IDs remain available while learner output is sanitized");
}

main();
