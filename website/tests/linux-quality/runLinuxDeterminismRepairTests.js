#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stable(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}


function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const outDir = path.join(os.tmpdir(), `cyberlab-linux-determinism-repair-${Date.now()}`);
  execFileSync("npx", ["tsc", "--outDir", outDir, "--noEmit", "false", "--module", "commonjs", "--moduleResolution", "node", "--target", "es2020", "--jsx", "react-jsx"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return path.join(outDir, "lib", "lab-assets");
}

function loadModules() {
  const out = compileIfNeeded();
  return require(path.join(out, "linux"));
}

function fingerprint(candidate) {
  return hash({
    investigation: {
      incidentId: candidate.investigation.incidentId,
      incidentFamily: candidate.investigation.incidentFamily,
      hostname: candidate.investigation.hostname,
      hostRole: candidate.investigation.hostRole,
      incidentWindowStart: candidate.investigation.incidentWindowStart,
      incidentWindowEnd: candidate.investigation.incidentWindowEnd,
      suspiciousCommands: candidate.investigation.suspiciousCommands,
      modifiedFiles: candidate.investigation.modifiedFiles,
    },
    tasks: candidate.simulation.canonicalTasks.map((task) => ({
      id: task.id,
      order: task.order,
      intent: task.intent,
      selectedEvidenceAssetIds: task.selectedEvidenceAssetIds,
    })),
    registry: candidate.simulation.evidenceRegistry.map((asset) => ({
      id: asset.id,
      path: asset.path,
      capabilities: asset.capabilities,
      canonicalObjectIds: asset.canonicalObjectIds,
    })),
    assets: candidate.assets.map((asset) => ({
      path: asset.file_path,
      contentHash: hash(asset.content),
    })),
  });
}

function suppressConsole(fn) {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }
}

function build(modules, target) {
  return suppressConsole(() => {
    const attempts = target.seed.includes(":draw:")
      ? [target.seed]
      : Array.from({ length: 60 }, (_, index) => `${target.seed}:draw:${index}`);
    let lastError;
    for (const generationSeed of attempts) {
      try {
        const candidate = modules.buildLinuxAssetCandidate({
            seed: generationSeed,
            generationTime: "2026-07-29T08:00:00.000Z",
            category: "Linux",
            difficulty: target.difficulty,
            duration: target.duration,
          },
          { incidentFamily: target.family }
        );
        if (candidate.investigation.incidentFamily === target.family) return candidate;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`No candidate generated for ${target.difficulty}/${target.family}`);
  });
}

const targets = [
  {
    difficulty: "Beginner",
    duration: "15 mins",
    family: "misconfigured_sudoers",
    seed: "phase5-linux-deterministic-production-qa:Beginner:2:misconfigured_sudoers:15-mins",
  },
  {
    difficulty: "Intermediate",
    duration: "30 mins",
    family: "ssh_key_compromise",
    seed: "phase5-linux-deterministic-production-qa:Intermediate:1:ssh_key_compromise:30-mins",
  },
  {
    difficulty: "Advanced",
    duration: "60 mins",
    family: "ssh_key_compromise",
    seed: "phase5-linux-deterministic-production-qa:Advanced:1:ssh_key_compromise:60-mins",
  },
];

if (process.env.LINUX_DETERMINISM_CHILD === "1") {
  const modules = loadModules();
  const target = JSON.parse(process.env.LINUX_DETERMINISM_TARGET || "{}");
  process.stdout.write(fingerprint(build(modules, target)));
  process.exit(0);
}

function main() {
  const modules = loadModules();
  const failures = [];
  const pollutionSeeds = [
    { difficulty: "Advanced", duration: "60 mins", family: "misconfigured_sudoers", seed: "phase5-linux-deterministic-production-qa:Advanced:2:misconfigured_sudoers:60-mins" },
    { difficulty: "Beginner", duration: "15 mins", family: "ssh_bruteforce", seed: "phase5-linux-deterministic-production-qa:Beginner:0:ssh_bruteforce:15-mins" },
    { difficulty: "Intermediate", duration: "30 mins", family: "ssh_key_compromise", seed: "phase5-linux-deterministic-production-qa:Intermediate:1:ssh_key_compromise:30-mins" },
  ];

  for (const target of targets) {
    const baseline = fingerprint(build(modules, target));
    const repeat = fingerprint(build(modules, target));
    if (baseline !== repeat) failures.push(`${target.difficulty}/${target.family} changed on immediate same-process replay`);

    pollutionSeeds.forEach((seed) => build(modules, seed));
    const afterPollution = fingerprint(build(modules, target));
    if (baseline !== afterPollution) failures.push(`${target.difficulty}/${target.family} changed after unrelated generations`);
  }

  const reversed = targets.slice().reverse().map((target) => fingerprint(build(modules, target))).reverse();
  targets.forEach((target, index) => {
    const baseline = fingerprint(build(modules, target));
    if (baseline !== reversed[index]) failures.push(`${target.difficulty}/${target.family} changed when generation order reversed`);
  });

  for (const target of targets) {
    const baseline = fingerprint(build(modules, target));
    const child = execFileSync(process.execPath, [__filename], {
      cwd: ROOT,
      env: {
        ...process.env,
        LINUX_DETERMINISM_CHILD: "1",
        LINUX_DETERMINISM_TARGET: JSON.stringify(target),
      },
      encoding: "utf8",
    }).trim();
    if (baseline !== child) failures.push(`${target.difficulty}/${target.family} changed across fresh process replay`);
  }

  if (failures.length > 0) {
    console.error(JSON.stringify({ passed: false, failures }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ passed: true, checked: targets.length, assertions: targets.length * 4 }, null, 2));
}

main();
