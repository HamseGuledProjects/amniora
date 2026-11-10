#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(ROOT, ".tmp", "linux-phase9-workload-sensitivity");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase9-sensitivity-${Date.now()}`);
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function build(modules, difficulty, family, seed, duration) {
  return modules.linux.buildLinuxAssetCandidate(
    { category: "Linux", difficulty, duration: `${duration} mins`, title: "Phase 9 sensitivity", seed, generationTime: "2026-07-29T10:00:00.000Z" },
    { incidentFamily: family }
  );
}

function estimate(modules, simulation, assets) {
  return modules.workload.estimateLinuxLearnerWorkload({ simulation, assets });
}

function check(modules, candidate, simulation, assets) {
  const difficulty = candidate.simulation.canonicalTasks[0].difficulty;
  return modules.workload.checkLinuxLabWorkload({
    simulation,
    assets,
    requestedDifficulty: difficulty,
    requestedDurationMinutes: difficulty === "Advanced" ? 60 : 30,
  });
}

function addEvidenceSource(simulation, assets) {
  const mutated = clone(simulation);
  const mutatedAssets = clone(assets);
  const task = mutated.canonicalTasks[0];
  const source = mutated.planningEvidenceRegistry.find((asset) => task.selectedEvidenceAssetIds.includes(asset.id));
  const rendered = mutatedAssets.find((asset) => asset.file_path === source.path);
  const id = `${source.id}:sensitivity-extra`;
  const filePath = `${source.path}.sensitivity`;
  mutated.planningEvidenceRegistry.push({ ...clone(source), id, path: filePath });
  mutated.evidenceRegistry.push({ ...clone(source), id, path: filePath });
  task.selectedEvidenceAssetIds.push(id);
  mutatedAssets.push({ ...clone(rendered), file_path: filePath, file_name: path.basename(filePath) });
  return { simulation: mutated, assets: mutatedAssets };
}

function addNoise(assets, count) {
  const mutated = clone(assets);
  mutated[0].content += "\n" + Array.from({ length: count }, (_, index) => `2026-07-06 00:01:${String(index % 60).padStart(2, "0")} routine non-incident line ${index}`).join("\n");
  return mutated;
}

function addCorrelation(simulation) {
  const mutated = clone(simulation);
  const task = mutated.canonicalTasks[0];
  task.requirements.push({
    id: `${task.id}:sensitivity-relation`,
    capability: task.requiredCapabilities[0] || "timeline_context",
    subjectIds: task.primarySubjectIds.slice(0, 1),
    relation: "sensitivity_cross_reference",
    stateType: "historical_reconstruction",
  });
  return mutated;
}

function addTimeline(simulation) {
  const mutated = clone(simulation);
  mutated.events.push({ ...clone(mutated.events[0]), id: "sensitivity:event", timestamp: "2026-07-06T00:10:00.000Z" });
  mutated.canonicalTasks[0].requiredCapabilities = Array.from(new Set([...mutated.canonicalTasks[0].requiredCapabilities, "timeline_exact"]));
  return mutated;
}

function addRemediation(simulation) {
  const mutated = clone(simulation);
  mutated.canonicalTasks[0].intent = "containment_recommendation";
  mutated.canonicalTasks[0].inquiryTypes = Array.from(new Set([...(mutated.canonicalTasks[0].inquiryTypes || []), "remediation_or_containment"]));
  mutated.canonicalTasks[0].expectedDeliverableType = "containment_plan";
  return mutated;
}

function duplicateTask(simulation) {
  const mutated = clone(simulation);
  const copy = clone(mutated.canonicalTasks[0]);
  copy.id = `${copy.id}:copy`;
  copy.order = Math.max(...mutated.canonicalTasks.map((task) => task.order)) + 1;
  mutated.canonicalTasks.push(copy);
  return mutated;
}

function delta(base, changed) {
  const dimensions = {};
  for (const key of Object.keys(base.dimensions)) dimensions[key] = Number((changed.dimensions[key] - base.dimensions[key]).toFixed(2));
  return {
    estimatedDelta: Number((changed.estimatedDurationMinutes - base.estimatedDurationMinutes).toFixed(2)),
    dimensions,
  };
}

function sensitivityRow(modules, candidate, label, base, simulation, assets) {
  const changed = estimate(modules, simulation, assets);
  const validation = check(modules, candidate, simulation, assets);
  return {
    ...delta(base, changed),
    label,
    before: base.estimatedDurationMinutes,
    after: changed.estimatedDurationMinutes,
    codes: validation.issues.map((issue) => issue.code),
    finalQualityOutcome: validation.passed ? "accepted" : "rejected",
  };
}

function main() {
  const out = compileIfNeeded();
  const modules = {
    linux: require(path.join(out, "linux")),
    workload: require(path.join(out, "linux", "workloadCalibration")),
  };
  const labs = [
    build(modules, "Beginner", "ssh_bruteforce", "phase8-matrix:Beginner:ssh_bruteforce:0", 30),
    build(modules, "Intermediate", "data_staging", "phase8-matrix:Intermediate:data_staging:1", 30),
    build(modules, "Advanced", "docker_compromise", "phase8-matrix:Advanced:docker_compromise:1", 60),
  ];
  const report = [];
  for (const candidate of labs) {
    const base = estimate(modules, candidate.simulation, candidate.assets);
    const evidence = addEvidenceSource(candidate.simulation, candidate.assets);
    const boundedNoiseAssets = addNoise(candidate.assets, 120);
    const largeNoiseAssets = addNoise(candidate.assets, 3000);
    const correlationSimulation = addCorrelation(candidate.simulation);
    const timelineSimulation = addTimeline(candidate.simulation);
    const remediationSimulation = addRemediation(candidate.simulation);
    const duplicateSimulation = duplicateTask(candidate.simulation);
    const rows = {
      label: `${candidate.simulation.canonicalTasks[0].difficulty}:${candidate.investigation.incidentFamily}`,
      baseMinutes: base.estimatedDurationMinutes,
      evidenceNavigation: sensitivityRow(modules, candidate, "evidence_navigation", base, evidence.simulation, evidence.assets),
      boundedNoise: sensitivityRow(modules, candidate, "bounded_noise", base, candidate.simulation, boundedNoiseAssets),
      largeNoise: sensitivityRow(modules, candidate, "large_noise", base, candidate.simulation, largeNoiseAssets),
      correlation: sensitivityRow(modules, candidate, "correlation", base, correlationSimulation, candidate.assets),
      timeline: sensitivityRow(modules, candidate, "timeline", base, timelineSimulation, candidate.assets),
      remediation: sensitivityRow(modules, candidate, "remediation", base, remediationSimulation, candidate.assets),
      duplicateTask: sensitivityRow(modules, candidate, "duplicate_task", base, duplicateSimulation, candidate.assets),
    };
    assert(`${rows.label} navigation sensitivity`, rows.evidenceNavigation.dimensions.evidenceNavigation > 0);
    assert(`${rows.label} noise is capped`, rows.largeNoise.dimensions.evidenceReading <= 8);
    assert(`${rows.label} correlation sensitivity`, rows.correlation.dimensions.crossSourceCorrelation > 0);
    assert(`${rows.label} timeline sensitivity`, rows.timeline.dimensions.timelineReasoning > 0);
    assert(`${rows.label} remediation sensitivity`, base.dimensions.remediationReasoning > 0 && rows.remediation.dimensions.remediationReasoning >= 0);
    assert(`${rows.label} remediation dedupe prevents duplicate charge`, rows.remediation.dimensions.remediationReasoning <= base.dimensions.remediationReasoning);
    assert(`${rows.label} duplicate work penalty appears`, rows.duplicateTask.dimensions.duplicatedWork > 0);
    const maxDimensionDelta = Math.max(...Object.entries(rows.largeNoise.dimensions).filter(([key]) => key !== "evidenceReading").map(([, value]) => Math.abs(value)));
    assert(`${rows.label} requested duration absent from sensitivity`, base.estimatedDurationMinutes === estimate(modules, candidate.simulation, candidate.assets).estimatedDurationMinutes);
    assert(`${rows.label} large noise does not affect non-reading dimensions`, maxDimensionDelta === 0);
    report.push(rows);
  }
  writeJson(path.join(OUTPUT_DIR, "summary.json"), { passed: true, report });
  console.log(JSON.stringify({ passed: true, report }, null, 2));
}

main();
