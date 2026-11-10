#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, ".tmp", "linux-phase9-workload-behavior");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-phase9b-behavior-${Date.now()}`);
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

function build(modules, difficulty, family, seed) {
  return modules.linux.buildLinuxAssetCandidate(
    {
      category: "Linux",
      difficulty,
      duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
      title: "Phase 9B workload behavior",
      seed,
      generationTime: "2026-07-29T11:00:00.000Z",
    },
    { incidentFamily: family }
  );
}

function main() {
  const out = compileIfNeeded();
  const modules = {
    linux: require(path.join(out, "linux", "index.js")),
    workload: require(path.join(out, "linux", "workloadCalibration.js")),
  };

  const source = fs.readFileSync(path.join(ROOT, "lib", "lab-assets", "linux", "workloadCalibration.ts"), "utf8");
  assert("workload estimator no longer uses rawEffort target scalar", !/rawEffort\s*\*\s*0\.639/.test(source));

  const beginner = build(modules, "Beginner", "ssh_key_compromise", "phase9b:behavior:beginner:ssh_key");
  const beginnerReport = beginner.assetQuality.workloadReport;
  assert("Beginner workload uses 3-4 canonical tasks", beginnerReport.metrics.taskCount >= 3 && beginnerReport.metrics.taskCount <= 4, JSON.stringify(beginnerReport.metrics));
  assert("Beginner learner action count is not task count", beginnerReport.metrics.learnerActionCount > beginnerReport.metrics.taskCount * 2, JSON.stringify(beginnerReport.metrics));
  assert("timeline metric is bounded to actual timeline work", beginnerReport.metrics.timelineEventCount >= 0 && beginnerReport.metrics.timelineEventCount <= beginnerReport.metrics.learnerActionCount, JSON.stringify(beginnerReport.metrics));
  assert("Beginner remediation uses concrete learner actions", beginnerReport.metrics.remediationActionCount > 0 && beginnerReport.taskEstimates.some((task) => (task.remediationActions || []).length > 0), JSON.stringify(beginnerReport.taskEstimates));
  assert("subject metric is task-local", beginnerReport.metrics.uniqueSubjectCount === beginnerReport.metrics.taskLocalSubjectCount, JSON.stringify(beginnerReport.metrics));
  assert("noise-only subjects are separately reported", Number.isFinite(beginnerReport.metrics.noiseOnlySubjectCount) && beginnerReport.metrics.noiseOnlySubjectCount >= 0, JSON.stringify(beginnerReport.metrics));

  const advancedCron = build(modules, "Advanced", "cron_persistence", "phase9b:behavior:advanced:cron");
  const advancedDocker = build(modules, "Advanced", "docker_compromise", "phase8-matrix:Advanced:docker_compromise:1");
  const advancedReports = [advancedCron.assetQuality.workloadReport, advancedDocker.assetQuality.workloadReport];
  assert("Advanced remediation effort is non-zero when remediation/risk follow-through exists", advancedReports.some((report) => report.metrics.remediationActionCount > 0 && report.dimensions.remediationReasoning > 0), JSON.stringify(advancedReports.map((report) => report.metrics)));
  const lowerDistances = advancedReports.map((report) => report.estimatedDurationMinutes - report.acceptableDurationRange.minimumMinutes);
  assert("Advanced estimates do not cluster on lower boundary", lowerDistances.reduce((total, value) => total + value, 0) / lowerDistances.length > 5 && lowerDistances.some((value) => value > 10), JSON.stringify(advancedReports.map((report) => ({ estimated: report.estimatedDurationMinutes, range: report.acceptableDurationRange }))));

  const summary = {
    beginner: beginnerReport.metrics,
    advanced: advancedReports.map((report) => ({
      estimatedDurationMinutes: report.estimatedDurationMinutes,
      range: report.acceptableDurationRange,
      metrics: report.metrics,
      dimensions: report.dimensions,
    })),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ passed: true, summary }, null, 2));
}

main();
