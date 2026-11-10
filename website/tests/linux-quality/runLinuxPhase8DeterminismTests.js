#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const GENERATION_TIME = "2026-07-29T08:00:00.000Z";
const MATRIX = [
  ["Beginner", "misconfigured_sudoers", "phase8-matrix:Beginner:misconfigured_sudoers:0"],
  ["Beginner", "ssh_bruteforce", "phase8-matrix:Beginner:ssh_bruteforce:0"],
  ["Beginner", "service_account_misuse", "phase8-matrix:Beginner:service_account_misuse:2"],
  ["Beginner", "ssh_key_compromise", "phase8-matrix:Beginner:ssh_key_compromise:0"],
  ["Beginner", "cron_persistence", "phase8-matrix:Beginner:cron_persistence:0"],
  ["Beginner", "systemd_persistence", "phase8-matrix:Beginner:systemd_persistence:0"],
  ["Beginner", "unauthorized_package_install", "phase8-matrix:Beginner:unauthorized_package_install:0"],
  ["Beginner", "data_staging", "phase8-matrix:Beginner:data_staging:16"],
  ["Beginner", "log_tampering", "phase8-matrix:Beginner:log_tampering:2"],
  ["Beginner", "reverse_shell", "phase8-matrix:Beginner:reverse_shell:3"],
  ["Beginner", "docker_compromise", "phase8-matrix:Beginner:docker_compromise:12"],
  ["Intermediate", "misconfigured_sudoers", "phase8-matrix:Intermediate:misconfigured_sudoers:3"],
  ["Intermediate", "ssh_bruteforce", "phase8-matrix:Intermediate:ssh_bruteforce:0"],
  ["Intermediate", "service_account_misuse", "phase8-matrix:Intermediate:service_account_misuse:1"],
  ["Intermediate", "ssh_key_compromise", "phase8-matrix:Intermediate:ssh_key_compromise:0"],
  ["Intermediate", "cron_persistence", "phase8-matrix:Intermediate:cron_persistence:0"],
  ["Intermediate", "systemd_persistence", "phase8-matrix:Intermediate:systemd_persistence:3"],
  ["Intermediate", "unauthorized_package_install", "phase8-matrix:Intermediate:unauthorized_package_install:0"],
  ["Intermediate", "data_staging", "phase8-matrix:Intermediate:data_staging:1"],
  ["Intermediate", "log_tampering", "phase8-matrix:Intermediate:log_tampering:5"],
  ["Intermediate", "reverse_shell", "phase8-matrix:Intermediate:reverse_shell:0"],
  ["Intermediate", "docker_compromise", "phase8-matrix:Intermediate:docker_compromise:8"],
  ["Advanced", "misconfigured_sudoers", "phase8-matrix:Advanced:misconfigured_sudoers:0"],
  ["Advanced", "ssh_bruteforce", "phase8-matrix:Advanced:ssh_bruteforce:0"],
  ["Advanced", "service_account_misuse", "phase8-matrix:Advanced:service_account_misuse:0"],
  ["Advanced", "ssh_key_compromise", "phase8-matrix:Advanced:ssh_key_compromise:2"],
  ["Advanced", "cron_persistence", "phase8-matrix:Advanced:cron_persistence:0"],
  ["Advanced", "systemd_persistence", "phase8-matrix:Advanced:systemd_persistence:2"],
  ["Advanced", "unauthorized_package_install", "phase8-matrix:Advanced:unauthorized_package_install:1"],
  ["Advanced", "data_staging", "phase8-matrix:Advanced:data_staging:23"],
  ["Advanced", "log_tampering", "phase8-matrix:Advanced:log_tampering:1"],
  ["Advanced", "reverse_shell", "phase8-matrix:Advanced:reverse_shell:10"],
  ["Advanced", "docker_compromise", "phase8-matrix:Advanced:docker_compromise:13"],
];

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase8-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}${details ? `: ${details}` : ""}`);
  console.log(`PASS ${name}`);
}

function canonicalCandidate(candidate) {
  return JSON.stringify({
    investigation: candidate.investigation,
    tasks: candidate.simulation.canonicalTasks,
    registry: candidate.simulation.planningEvidenceRegistry,
    assets: candidate.assets.map((asset) => ({
      path: asset.file_path,
      type: asset.file_type,
      content: asset.content.replace(/\r\n/g, "\n"),
    })),
    hashes: candidate.deterministicHashes,
  });
}

function assetContents(candidate) {
  return candidate.assets.map((asset) => `${asset.file_path}\n${asset.content}`).join("\n---\n");
}

function build(modules, seed, difficulty = "Advanced", assetAttempt = 1, family) {
  return modules.buildLinuxAssetCandidate(
    {
      category: "Linux",
      difficulty,
      duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
      title: "Phase 8 deterministic replay",
      seed,
      generationTime: GENERATION_TIME,
      assetAttempt,
    },
    family ? { incidentFamily: family } : {}
  );
}

function scanSourceForAmbientRandomness() {
  const files = [
    "lib/lab-assets/world.ts",
    "lib/lab-assets/linux/incidents.ts",
    "lib/lab-assets/linux/index.ts",
    "app/api/ai/generate-lab/route.ts",
  ];
  const offenders = [];
  for (const relative of files) {
    const content = fs.readFileSync(path.join(ROOT, relative), "utf8");
    if (/Math\.random/.test(content)) offenders.push(`${relative}:Math.random`);
  }
  return offenders;
}

function scanLinuxTestsForRandomMonkeypatches() {
  const offenders = [];
  const testDir = path.join(ROOT, "tests", "linux-quality");
  for (const file of fs.readdirSync(testDir)) {
    if (!file.endsWith(".js")) continue;
    if (file === "runLinuxPhase8DeterminismTests.js") continue;
    const relative = path.join("tests", "linux-quality", file).replace(/\\/g, "/");
    const content = fs.readFileSync(path.join(testDir, file), "utf8");
    if (/Math\.random\s*=|original\s*=\s*Math\.random|seededRandom/.test(content)) offenders.push(relative);
  }
  return offenders;
}

function scanFamilySearchFlakes() {
  const offenders = [];
  const testDir = path.join(ROOT, "tests", "linux-quality");
  for (const file of fs.readdirSync(testDir)) {
    if (!file.endsWith(".js")) continue;
    const relative = path.join("tests", "linux-quality", file).replace(/\\/g, "/");
    const content = fs.readFileSync(path.join(testDir, file), "utf8");
    if (/for\s*\([^)]*;\s*[^;]*(families\.size|incidentFamily\s*!==|context\.incidentFamily\s*!==)/s.test(content) && /buildLinuxAssetCandidate/.test(content)) {
      if (!/MATRIX|FAMILY_SEEDS|incidentFamily: family/.test(content)) offenders.push(relative);
    }
  }
  return offenders;
}

function mutateHash(hashes, layer) {
  return { ...hashes, [layer]: `${hashes[layer].slice(0, -1)}${hashes[layer].endsWith("0") ? "1" : "0"}` };
}

function main() {
  const out = compileIfNeeded();
  const linux = require(path.join(out, "linux"));
  const random = require(path.join(out, "linux", "deterministicRandom"));
  const context = require(path.join(out, "linux", "generationContext"));
  const replay = require(path.join(out, "linux", "replay"));
  const persistence = require(path.join(out, "linux", "provenancePersistence"));

  assert("ambient Linux factual randomness is absent", scanSourceForAmbientRandomness().length === 0, scanSourceForAmbientRandomness().join(", "));
  assert("LINUX_GENERATION_AMBIENT_RANDOMNESS guard rejects Linux test monkeypatches", scanLinuxTestsForRandomMonkeypatches().length === 0, scanLinuxTestsForRandomMonkeypatches().join(", "));
  assert("family-search flakes are absent or use deterministic fixtures", scanFamilySearchFlakes().length === 0, scanFamilySearchFlakes().join(", "));

  const seed = "phase8-same-seed-equality";
  const first = build(linux, seed, "Advanced", 1);
  const second = build(linux, seed, "Advanced", 1);
  assert("same seed produces identical deterministic candidate", canonicalCandidate(first) === canonicalCandidate(second), first.provenance.seed);
  assert("same seed persists stable deterministic hash", first.deterministicHashes.finalDeterministicHash === second.deterministicHashes.finalDeterministicHash);

  const beginnerA = build(linux, "phase8-beginner", "Beginner", 1);
  const beginnerB = build(linux, "phase8-beginner", "Beginner", 1);
  const intermediateA = build(linux, "phase8-intermediate", "Intermediate", 1);
  const intermediateB = build(linux, "phase8-intermediate", "Intermediate", 1);
  assert("Beginner same-seed equality holds", canonicalCandidate(beginnerA) === canonicalCandidate(beginnerB));
  assert("Intermediate same-seed equality holds", canonicalCandidate(intermediateA) === canonicalCandidate(intermediateB));

  const different = build(linux, "phase8-different-seed", "Advanced", 1);
  assert(
    "different seeds produce meaningful variation",
    first.deterministicHashes.finalDeterministicHash !== different.deterministicHashes.finalDeterministicHash &&
      (first.investigation.hostname !== different.investigation.hostname ||
        first.investigation.caseId !== different.investigation.caseId ||
        assetContents(first) !== assetContents(different))
  );

  const attempt1a = build(linux, "phase8-attempt", "Advanced", 1);
  const attempt1b = build(linux, "phase8-attempt", "Advanced", 1);
  const attempt2a = build(linux, "phase8-attempt", "Advanced", 2);
  const attempt2b = build(linux, "phase8-attempt", "Advanced", 2);
  assert("asset attempt 1 replays exactly", canonicalCandidate(attempt1a) === canonicalCandidate(attempt1b));
  assert("asset attempt 2 replays exactly", canonicalCandidate(attempt2a) === canonicalCandidate(attempt2b));
  assert("asset attempts are independently derivable", attempt1a.provenance.assetAttempt !== attempt2a.provenance.assetAttempt);

  const replayReport = replay.replayLinuxGeneration({
    provenance: first.provenance,
    expectedHashes: first.deterministicHashes,
    title: "Phase 8 deterministic replay",
  });
  assert("replay reports exact hash match", replayReport.status === "exact_match", JSON.stringify(replayReport, null, 2));
  assert("historical missing provenance is explicit", replay.replayLinuxGeneration({ provenance: null }).status === "historical_without_provenance");

  const generationContext = context.buildLinuxGenerationContext({
    category: "Linux",
    difficulty: "Advanced",
    duration: "30 mins",
    title: "Phase 8 namespace isolation",
    seed: "phase8-namespace",
    generationTime: GENERATION_TIME,
  });
  const incidentBefore = generationContext.random("incident.family").nextInt(0, 1000000);
  generationContext.random("background.network").pick(["dns", "ntp", "proxy"]);
  generationContext.random("background.network").pick(["443", "123", "53"]);
  const incidentAfter = generationContext.random("incident.family").nextInt(0, 1000000);
  assert("namespace isolation prevents background draws changing incident stream", incidentBefore === incidentAfter);

  const rootSeed = random.normalizeLinuxSeed("phase8-seed-format");
  assert("seed format is versioned and bounded", /^linux-seed-v1:/.test(rootSeed) && rootSeed.length <= 160, rootSeed);

  const wallClockA = build(linux, "phase8-wall-clock", "Advanced", 1);
  const wallClockB = linux.buildLinuxAssetCandidate({
    category: "Linux",
    difficulty: "Advanced",
    duration: "60 mins",
    title: "Phase 8 deterministic replay",
    seed: "phase8-wall-clock",
    generationTime: "2031-01-01T00:00:00.000Z",
    assetAttempt: 1,
  });
  assert("factual generation changes only when injected generation time changes", wallClockA.provenance.generationTime !== wallClockB.provenance.generationTime);
  assert("seed is excluded from task JSON", !assetContents(wallClockA).includes(wallClockA.provenance.seed));

  const hashLayers = Object.keys(first.deterministicHashes);
  for (const layer of hashLayers) {
    const mismatch = replay.replayLinuxGeneration({
      provenance: first.provenance,
      expectedHashes: mutateHash(first.deterministicHashes, layer),
      title: "Phase 8 deterministic replay",
    });
    assert(`replay mismatch is layer-specific for ${layer}`, mismatch.status === "mismatch" && mismatch.mismatchedLayers.includes(layer), JSON.stringify(mismatch, null, 2));
  }
  const unsupportedGenerator = replay.replayLinuxGeneration({
    provenance: { ...first.provenance, generatorVersion: "linux-generator-v0" },
    expectedHashes: first.deterministicHashes,
    title: "Phase 8 deterministic replay",
  });
  assert("unsupported generator version is explicit", unsupportedGenerator.status === "unsupported_version");
  const unsupportedPrng = replay.replayLinuxGeneration({
    provenance: { ...first.provenance, prngAlgorithmVersion: "unknown-prng" },
    expectedHashes: first.deterministicHashes,
    title: "Phase 8 deterministic replay",
  });
  assert("unsupported PRNG version is explicit", unsupportedPrng.status === "unsupported_version");

  const changedAttempt = replay.replayLinuxGeneration({
    provenance: { ...first.provenance, assetAttempt: first.provenance.assetAttempt + 1, attempt: { ...first.provenance.attempt, assetAttempt: first.provenance.assetAttempt + 1 } },
    expectedHashes: first.deterministicHashes,
    title: "Phase 8 deterministic replay",
  });
  assert("changed attempt number produces mismatch", changedAttempt.status === "mismatch");
  const changedDifficulty = replay.replayLinuxGeneration({
    provenance: { ...first.provenance, difficulty: "Beginner" },
    expectedHashes: first.deterministicHashes,
    title: "Phase 8 deterministic replay",
  });
  assert("changed difficulty produces mismatch", changedDifficulty.status === "mismatch");
  const changedDuration = replay.replayLinuxGeneration({
    provenance: { ...first.provenance, durationMinutes: 45 },
    expectedHashes: first.deterministicHashes,
    title: "Phase 8 deterministic replay",
  });
  assert("changed duration produces mismatch", changedDuration.status === "mismatch");
  const changedGenerationTime = replay.replayLinuxGeneration({
    provenance: { ...first.provenance, generationTime: "2031-01-01T00:00:00.000Z" },
    expectedHashes: first.deterministicHashes,
    title: "Phase 8 deterministic replay",
  });
  assert("changed generation time produces mismatch", changedGenerationTime.status === "mismatch");
  const changedFlag = replay.replayLinuxGeneration({
    provenance: { ...first.provenance, featureFlags: { phase8Probe: true } },
    expectedHashes: first.deterministicHashes,
    title: "Phase 8 deterministic replay",
  });
  assert("changed feature flag produces mismatch", changedFlag.status === "mismatch");
  const invalidSeed = replay.replayLinuxGeneration({
    provenance: { ...first.provenance, seed: "not a valid seed with spaces" },
    expectedHashes: first.deterministicHashes,
    title: "Phase 8 deterministic replay",
  });
  assert("invalid seed is rejected as mismatch", invalidSeed.status === "mismatch" && invalidSeed.validationIssues.some((issue) => issue.includes("LINUX_GENERATION_SEED_INVALID")));

  const row = persistence.buildLinuxGenerationProvenanceRow({
    labId: "00000000-0000-4000-8000-000000000001",
    generatedLabId: "00000000-0000-4000-8000-000000000002",
    userId: "00000000-0000-4000-8000-000000000003",
    provenance: first.provenance,
    deterministicHashes: first.deterministicHashes,
  });
  assert("provenance row includes seed/version/time/hashes", row.seed && row.generator_version && row.provenance.generationTime && row.final_deterministic_hash === first.deterministicHashes.finalDeterministicHash);
  assert("accepted asset attempt is persisted correctly", row.accepted_asset_attempt === first.provenance.assetAttempt);
  assert("provenance ownership is bound to saved lab user", row.user_id === "00000000-0000-4000-8000-000000000003" && row.lab_id.endsWith("0001"));
  assert("provenance row excludes prompts and secrets", !/openai|api_key|consent|prompt|bearer/i.test(JSON.stringify(row)));

  const matrixFamilies = new Set();
  const matrixDifficulties = new Set();
  let exactMatches = 0;
  for (const [difficulty, family, matrixSeed] of MATRIX) {
    const candidate = build(linux, matrixSeed, difficulty, 1, family);
    const report = replay.replayLinuxGeneration({
      provenance: candidate.provenance,
      expectedHashes: candidate.deterministicHashes,
      title: "Phase 8 deterministic replay",
    });
    assert(`${difficulty} ${family} expected family`, candidate.investigation.incidentFamily === family);
    assert(`${difficulty} ${family} expected difficulty`, candidate.provenance.difficulty === difficulty);
    assert(`${difficulty} ${family} replay exact`, report.status === "exact_match", JSON.stringify(report, null, 2));
    matrixFamilies.add(family);
    matrixDifficulties.add(difficulty);
    exactMatches += 1;
  }
  assert("full replay matrix is 33/33 exact_match", exactMatches === 33);
  assert("full replay matrix covers 11/11 families", matrixFamilies.size === 11, [...matrixFamilies].join(","));
  assert("full replay matrix covers 3/3 difficulties", matrixDifficulties.size === 3, [...matrixDifficulties].join(","));

  let multiSeedExact = 0;
  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    for (let index = 0; index < 3; index += 1) {
      const candidate = build(linux, `phase8-multi:${difficulty}:${index}`, difficulty, 1);
      const report = replay.replayLinuxGeneration({ provenance: candidate.provenance, expectedHashes: candidate.deterministicHashes, title: "Phase 8 deterministic replay" });
      if (report.status === "exact_match") multiSeedExact += 1;
    }
  }
  assert("multiple-seed replay exact-match rate is 9/9", multiSeedExact === 9);

  console.log("PASS Linux Phase 8 deterministic replay tests complete");
}

main();
