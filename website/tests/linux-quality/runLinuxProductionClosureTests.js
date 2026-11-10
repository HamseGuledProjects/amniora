#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
process.env.NODE_ENV = "production";
process.env.CYBERLAB_LINUX_NARRATIVE_TRACE = "false";

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-closure-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}


function expectPass(name, result) {
  if (!result.passed) throw new Error(`${name}: expected pass, got ${result.issues.slice(0, 5).join(" | ")}`);
  console.log(`PASS ${name}`);
}

function expectFail(name, result, pattern) {
  const text = result.issues.join(" | ");
  if (result.passed || !new RegExp(pattern, "i").test(text)) {
    throw new Error(`${name}: expected /${pattern}/, got passed=${result.passed} ${text}`);
  }
  console.log(`PASS ${name}`);
}

function validate(candidate, validateLinuxProductionClosure, buildCanonicalEvidenceRegistry, simulation = candidate.simulation, assets = candidate.assets) {
  const registry = candidate.registryOverride || buildCanonicalEvidenceRegistry(simulation, assets);
  return validateLinuxProductionClosure({ simulation, evidenceRegistry: registry, finalAssets: assets });
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { buildCanonicalEvidenceRegistry, buildLinuxCanonicalNarrativeBrief } = require(path.join(out, "linux", "simulation.js"));
  const { validateLinuxProductionClosure } = require(path.join(out, "linux", "grounding.js"));
  console.info = () => {};

  const candidate = buildLinuxAssetCandidate({
          seed: "phase6e:closure",
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux", difficulty: "Advanced", duration: "60 mins", title: "CyberLab Asset Pack" });
  expectPass("corrected production closure", validate(candidate, validateLinuxProductionClosure, buildCanonicalEvidenceRegistry));

  const cases = [
    ["duplicate canonical id", (c) => { c.simulation.commands[1].id = c.simulation.commands[0].id; }, "duplicate canonical id"],
    ["missing canonical reference", (c) => { c.simulation.commands[0].actorIdentityId = "identity:not-real"; }, "missing canonical object"],
    ["missing learner object", (c) => { c.assets = c.assets.filter((asset) => asset.file_path !== "assets/logs/auth.log"); }, "missing from learner pack|cites missing evidence"],
    ["rendered subject gap", (c) => {
      const asset = c.assets.find((item) => item.file_path === "assets/logs/auth.log");
      const session = c.simulation.sshSessions[0];
      asset.content = asset.content.split(session.username).join("wronguser");
      asset.content = asset.content.split(session.sourceIp).join("203.0.113.250");
      asset.content = asset.content.split(String(session.sessionPid)).join("99998");
      asset.content = asset.content.split(String(session.monitorPid)).join("99997");
      asset.content = asset.content.split(session.openedAt).join("2026-01-01 00:00:00");
    }, "does not contain"],
    ["invalid relation", (c) => {
      c.registryOverride = buildCanonicalEvidenceRegistry(c.simulation, c.assets);
      c.registryOverride[0].relations.push({ relation: "executed_by", subjectIds: ["command:missing", "identity:missing"] });
    }, "missing subject|canonical relationship"],
    ["collection snapshot contradiction", (c) => {
      const process = c.simulation.processes.find((item) => item.endedAt && item.endedAt < c.simulation.collection.collectedAt);
      const asset = c.assets.find((item) => item.file_path === "assets/runtime/process_snapshot.txt");
      if (process && asset) {
        process.endedAt = c.simulation.collection.windowStart;
        asset.content += `\n${"root".padEnd(9)} ${String(process.pid).padStart(5)}     1  ${process.argv.join(" ")}`;
        c.registryOverride = buildCanonicalEvidenceRegistry(c.simulation, c.assets);
        const registry = c.registryOverride.find((item) => item.path === "assets/runtime/process_snapshot.txt");
        if (registry) registry.stateType = "collection_snapshot";
      }
    }, "terminated process"],
    ["network contradiction", (c) => { const asset = c.assets.find((item) => item.file_path === "assets/network/ufw_status.txt"); asset.content = asset.content.replace(/^22\/tcp\s+ALLOW[^\n]+\n/gim, ""); }, "firewall"],
    ["invalid risk enum", (c) => { const asset = c.assets.find((item) => item.file_path.endsWith("risk_register.csv")); asset.content = asset.content.replace(/,(?:open|review|monitoring|accepted|mitigated|closed|unverified),/, ",monitor,"); }, "invalid risk status"],
    ["task impossible", (c) => { c.simulation.canonicalTasks[0].selectedEvidenceAssetIds = []; }, "not fully answerable|missing object-grounded"],
  ];

  for (const [name, mutate, pattern] of cases) {
    const broken = clone(candidate);
    mutate(broken);
    expectFail(name, validate(broken, validateLinuxProductionClosure, buildCanonicalEvidenceRegistry), pattern);
  }

  const brief = buildLinuxCanonicalNarrativeBrief(candidate.simulation);
  const registryDump = JSON.stringify(candidate.simulation.evidenceRegistry, null, 2);
  if (brief.length >= registryDump.length * 0.55) {
    throw new Error(`prompt compactness failed: brief=${brief.length} registry=${registryDump.length}`);
  }
  console.log(`PASS compact narrative brief ${brief.length}/${registryDump.length}`);
  console.log(JSON.stringify({ passed: true, broken: cases.length, briefLength: brief.length, registryDumpLength: registryDump.length }, null, 2));
}

main();
