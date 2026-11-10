#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const compileRoot = path.join(os.tmpdir(), `cyberlab-linux-patch3-${process.pid}`);
execFileSync(process.execPath, [
  "node_modules/typescript/bin/tsc",
  "--outDir", compileRoot,
  "--noEmit", "false",
  "--module", "commonjs",
  "--moduleResolution", "node",
  "--target", "es2020",
  "--jsx", "react-jsx",
], { cwd: ROOT, stdio: "inherit" });

const OUT = path.join(compileRoot, "lib", "lab-assets");
const { buildLinuxAssetCandidate } = require(path.join(OUT, "linux", "index.js"));
const qa = require(path.join(OUT, "linux", "learnerQa.js"));
const sim = require(path.join(OUT, "linux", "simulation.js"));
const { parseLinuxCsvLine } = require(path.join(OUT, "linux", "csv.js"));
const { MATRIX } = require("./linuxPhase9AuditUtils");

const ALL_FAMILIES = [
  "ssh_bruteforce",
  "misconfigured_sudoers",
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
const ALL_DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];
const familyFilter = process.argv.find((arg) => arg.startsWith("--family="))?.split("=")[1];
const difficultyFilter = process.argv.find((arg) => arg.startsWith("--difficulty="))?.split("=")[1];
const maxDraws = Number(process.argv.find((arg) => arg.startsWith("--max-draws="))?.split("=")[1] || 80);
const FAMILIES = familyFilter ? [familyFilter] : ALL_FAMILIES;
const DIFFICULTIES = difficultyFilter ? [difficultyFilter] : ALL_DIFFICULTIES;
const report = { cases: 0, csvRows: 0, services: 0, sudoRows: 0, advancedReviewSets: 0 };
const quiet = (fn) => {
  const info = console.info;
  console.info = () => {};
  try { return fn(); } finally { console.info = info; }
};

function csvRecords(content) {
  const records = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '"') {
      if (quoted && content[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (content[index] === "\n" && !quoted) {
      records.push(content.slice(start, index).replace(/\r$/, ""));
      start = index + 1;
    }
  }
  if (start < content.length) records.push(content.slice(start).replace(/\r$/, ""));
  return records.filter((record) => record.trim());
}

function build(family, difficulty) {
  const matrixSeed = MATRIX.find(([level, incident]) => level === difficulty && incident === family)?.[2];
  let lastError;
  let lastReason = "";
  const firstSeedReasons = [];
  for (let draw = -1; draw < maxDraws; draw += 1) {
    const seed = draw < 0 && matrixSeed ? matrixSeed : `patch3:${family}:${difficulty}:${draw}`;
    try {
      return quiet(() => buildLinuxAssetCandidate({
        category: "Linux",
        difficulty,
        duration: difficulty === "Beginner" ? "15 mins" : "30 mins",
        title: `${difficulty} ${family} learner pack`,
        seed,
        generationTime: "2026-07-06T08:00:00.000Z",
      }, {
        incidentFamily: family,
        onAttempt: (event) => {
          if (!event.accepted && event.reason) {
            lastReason = event.reason;
            if (draw === -1) firstSeedReasons.push(event.reason);
          }
        },
      }));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Cannot build ${family}/${difficulty}: ${lastError?.message || lastError}; fixture rejections: ${firstSeedReasons.join(" | ")}; last rejection: ${lastReason}`);
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  assert.ok(found, `missing ${filePath}`);
  return found;
}

function assertReadme(candidate, difficulty) {
  const readme = candidate.assets.find((item) => item.file_name === "README.md" || item.file_path === "README.md");
  assert.ok(readme, `${difficulty} README exists`);
  assert.match(readme.content, new RegExp(`Difficulty: ${difficulty}`));
  if (difficulty === "Beginner") assert.match(readme.content, /Recommended beginner setup:/);
  else {
    assert.doesNotMatch(readme.content, /Recommended beginner setup:/);
    assert.match(readme.content, new RegExp(`Recommended ${difficulty.toLowerCase()} investigation setup:`));
  }
}

function assertRowLevelTimeAuthority(candidate) {
  for (const csvAsset of candidate.assets.filter((item) => item.file_type === "csv" || /time_authority/.test(item.content.split(/\r?\n/, 1)[0]))) {
    const records = csvRecords(csvAsset.content);
    if (!records.length) continue;
    const header = parseLinuxCsvLine(records[0]).values;
    const authorityIndex = header.indexOf("time_authority");
    assert(authorityIndex >= 0, `${csvAsset.file_path} declares time_authority`);
    for (const record of records.slice(1)) {
      const row = parseLinuxCsvLine(record).values;
      assert.equal(row.length, header.length, `${csvAsset.file_path} row width matches header`);
      assert.ok(row[authorityIndex]?.trim(), `${csvAsset.file_path} row has time authority`);
      report.csvRows += 1;
    }
  }
}

function assertServiceProcessRealism(candidate) {
  const inventory = asset(candidate, "assets/reports/service_inventory.txt").content;
  const processSnapshot = candidate.assets.find((item) => item.file_path === "assets/runtime/process_snapshot.txt")?.content;
  for (const service of candidate.simulation.services) {
    const requiresPid = ["simple", "forking", "notify", "idle"].includes(service.unitType) &&
      service.serviceType === "long-running" && service.activeState === "active" && service.subState === "running";
    if (requiresPid) {
      assert.ok(service.mainProcessId, `${service.unitName} has a canonical MainPID`);
      const process = candidate.simulation.processes.find((item) => item.id === service.mainProcessId);
      assert.ok(process && !process.endedAt, `${service.unitName} MainPID resolves to a live process`);
      assert.match(inventory, new RegExp(`${service.unitName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n]*,${process.pid},`));
      if (processSnapshot) assert.ok(processSnapshot.includes(String(process.pid)), `${service.unitName} MainPID appears in process snapshot`);
    }
    if (["timer", "socket", "target", "path", "oneshot"].includes(service.unitType)) {
      assert.notEqual(service.subState, "running", `${service.unitName} non-daemon unit is not reported running`);
      assert.equal(service.mainProcessId, undefined, `${service.unitName} non-daemon unit has no fabricated MainPID`);
    }
    report.services += 1;
  }
}

function assertSessionProvenance(candidate) {
  const sudo = candidate.assets.find((item) => item.file_path === "assets/logs/sudo.log")?.content;
  if (!sudo) return;
  for (const line of sudo.split(/\r?\n/).filter((value) => value.trim() && !value.startsWith("#"))) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*?TTY=([^ ;]+)/);
    assert.ok(match, `sudo row is parseable: ${line}`);
    const session = candidate.simulation.sshSessions.find((item) => item.tty === match[2] && item.openedAt <= match[1] && (!item.closedAt || item.closedAt >= match[1]));
    assert.ok(session, `sudo row ${match[1]} ${match[2]} has session provenance`);
    assert.ok(candidate.simulation.commands.some((command) => command.tty === match[2] && command.timestamp === match[1] && command.expectedRenderTargets.includes("sudo")), "sudo row has canonical command provenance");
    report.sudoRows += 1;
  }
}

function assertMetadataAndGrammar(candidate) {
  const passwd = candidate.simulation.files.find((file) => file.path === "/etc/passwd");
  if (passwd) {
    assert.equal(passwd.mode, 0o644, "/etc/passwd uses conventional 0644 mode");
    assert.ok(asset(candidate, "assets/reports/permissions_report.txt").content.includes("/etc/passwd -rw-r--r-- root root"));
  }
  for (const item of candidate.assets) {
    assert.doesNotMatch(item.content, /\ba SSH\b/i, `${item.file_path} uses correct SSH article`);
  }
}

function assertAdvancedNotes(candidate) {
  const reviewNames = ["incident_brief.md", "advanced_risk_register.csv", "risk_register.csv", "analyst_questions.md", "analyst_working_notes.md", "audit_notes.md"];
  const reviewAssets = candidate.assets.filter((item) => reviewNames.includes(item.file_name));
  const baseRisk = asset(candidate, "assets/evidence/risk_register.csv").content;
  for (const hypothesis of qa.linuxReviewHypotheses) {
    assert.ok(baseRisk.includes(hypothesis), `risk register preserves ${hypothesis}`);
    const count = reviewAssets.reduce((total, item) => total + item.content.split(hypothesis).length - 1, 0);
    assert.equal(count, 1, `canonical hypothesis appears once across Advanced review documents`);
  }
  for (const item of reviewAssets) {
    assert.doesNotMatch(item.content, /,(?:high|critical),/i, `${item.file_path} does not pre-grade an unverified hypothesis`);
    for (const command of candidate.simulation.commands.filter((entry) => entry.kind !== "background")) {
      assert.ok(!item.content.includes(command.renderedCommand), `${item.file_path} does not leak answer command`);
    }
  }
  report.advancedReviewSets += 1;
}

const caseMatrix = familyFilter || difficultyFilter
  ? FAMILIES.flatMap((family) => DIFFICULTIES.map((difficulty) => [family, difficulty]))
  : [
      ["ssh_bruteforce", "Beginner"],
      ["ssh_bruteforce", "Intermediate"],
      ["ssh_bruteforce", "Advanced"],
      ["misconfigured_sudoers", "Beginner"],
      ["service_account_misuse", "Intermediate"],
      ["ssh_key_compromise", "Advanced"],
      ["cron_persistence", "Advanced"],
      ["systemd_persistence", "Intermediate"],
      ["unauthorized_package_install", "Advanced"],
      ["data_staging", "Beginner"],
      ["log_tampering", "Intermediate"],
      ["reverse_shell", "Intermediate"],
      ["docker_compromise", "Advanced"],
    ];

for (const [family, difficulty] of caseMatrix) {
  console.log(`CHECK ${family}/${difficulty}`);
  const candidate = build(family, difficulty);
  assertReadme(candidate, difficulty);
  qa.validateLinuxPatch1Integrity(candidate.simulation, candidate.assets);
  qa.validateLinuxLearnerPackBoundaries(candidate.assets);
  sim.validateCanonicalExecutionLifecycle(candidate.simulation);
  assertRowLevelTimeAuthority(candidate);
  assertServiceProcessRealism(candidate);
  assertSessionProvenance(candidate);
  assertMetadataAndGrammar(candidate);
  if (difficulty === "Advanced") assertAdvancedNotes(candidate);
  report.cases += 1;
}

const savedPageSource = fs.readFileSync(path.join(ROOT, "app", "dashboard", "saved", "[id]", "page.tsx"), "utf8");
assert.match(savedPageSource, /data-saved-investigation-print="complete"/);
assert.match(savedPageSource, /data-saved-investigation-print-task-count=\{tasks\.length\}/);
assert.match(savedPageSource, /tasks\.map\(\(task, index\) =>/);
assert.match(savedPageSource, /data-saved-investigation-print-task=\{index \+ 1\}/);
assert.match(savedPageSource, /className="[^"]*print:hidden[^"]*"/);
assert.match(savedPageSource, /className="[^"]*hidden[^"]*print:block[^"]*"/);

console.log(JSON.stringify({ passed: true, ...report, savedPagePrint: "complete all-task print document" }, null, 2));
