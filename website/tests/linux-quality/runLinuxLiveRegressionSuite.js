#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `cyberlab-linux-live-regression-${Date.now()}`);
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

function firstLine(content, pattern) {
  return content.split(/\r?\n/).find((line) => pattern.test(line));
}

function buildCandidateWithOpenFiles(buildLinuxAssetCandidate) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({ category: "Linux", difficulty: "Advanced", duration: "30 mins", title: "CyberLab Asset Pack" });
      const open = asset(candidate.assets, "assets/runtime/open_files.txt").content;
      if (firstLine(open, /^\S+\s+\d+\s+\S+\s+\S+/m)) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("could not build candidate with open_files data row");
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

function checkSimulationMutation(checkLinuxInvestigationQuality, candidate, mutate) {
  const simulation = clone(candidate.simulation);
  mutate(simulation, candidate);
  return checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets: candidate.assets,
    simulation,
  });
}

function buildFinalLab(context, assets, overrides = {}) {
  const evidence = (...names) => names.flatMap((name) => assets.filter((asset) => asset.file_path.endsWith(name)).map((asset) => asset.file_path)).slice(0, 4);
  return {
    title: `Linux evidence review for ${context.hostname}`,
    subtitle: "Linux investigation using timeline and host evidence",
    topic: "Linux",
    difficulty: "Advanced",
    estimated_time: "30 mins",
    objective: `Review ${context.hostname} during ${context.incidentWindowStart}-${context.incidentWindowEnd} UTC.`,
    scenario: `${context.company} is reviewing case ${context.incidentId} on ${context.hostname}, a ${context.hostRole}, in ${context.timezone} with ${context.ticketId}, ${context.changeId}, and ${context.affectedService} evidence.`,
    tasks: [
      { title: "Reconstruct the investigation timeline.", description: "Reconstruct the investigation timeline.", evidence: evidence("timeline.csv", "sudo.log", "audit.log"), deliverable: "Timeline with cited evidence." },
      { title: "Correlate account and authentication evidence.", description: "Correlate account and authentication evidence.", evidence: evidence("users.csv", "groups.csv", "auth.log"), deliverable: "Account correlation notes." },
      { title: "Compare sudo policy and observed command evidence.", description: "Compare sudo policy and observed command evidence.", evidence: evidence("sudo.log", "platform", "groups.csv"), deliverable: "Sudo policy comparison." },
      { title: "Map change documentation to service evidence.", description: "Map change documentation to service evidence.", evidence: evidence("change_request.md", "maintenance_ticket.md", "service_inventory.txt"), deliverable: "Change mapping summary." },
      { title: "Evaluate file and permission evidence.", description: "Evaluate file and permission evidence.", evidence: evidence("permissions_report.txt", "audit.log", "open_files.txt"), deliverable: "Permission evidence notes." },
    ],
    learning_outcomes: ["Correlate Linux evidence.", "Assess host activity.", "Document uncertainty."],
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

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const { checkLinuxInvestigationQuality, checkLinuxFinalProductionQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const candidate = buildCandidateWithOpenFiles(buildLinuxAssetCandidate);
  const command = candidate.simulation.commands.find((item) => item.kind === "primary_incident");
  const process = candidate.simulation.processes.find((item) => item.pid === command.processId);
  const file = candidate.simulation.files.find((item) => command.affectedFileIds.includes(item.id));
  if (!command || !process || !file) throw new Error("candidate missing canonical command/process/file");
  const rootSnapshotLine = firstLine(asset(candidate.assets, "assets/runtime/process_snapshot.txt").content, /^root\s+\d+\s+/m);
  const rootSnapshotPid = rootSnapshotLine.match(/^root\s+(\d+)\s+/)?.[1];
  if (!rootSnapshotPid) throw new Error("candidate missing root process in runtime snapshot");
  const historicalProcess = candidate.simulation.processes.find((item) =>
    item.endedAt &&
    item.endedAt <= candidate.simulation.collection.windowEnd &&
    !asset(candidate.assets, "assets/runtime/process_snapshot.txt").content.match(new RegExp(`\\s${item.pid}\\s`))
  );
  if (!historicalProcess) throw new Error("candidate missing historical process outside runtime snapshot");

  const regressions = [
    ["file event before process execution", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      replaceAsset(assets, "assets/logs/audit.log", (content) => content.replace(new RegExp(`type=PATH msg=audit\\([^)]*\\): pid=${command.processId} item=0 name="${file.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `type=PATH msg=audit(${candidate.investigation.incidentDate} 00:00:01): pid=${command.processId} item=0 name="${file.path}"`));
    }), "semantic", "before process"],
    ["effective root process owner", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      replaceAsset(assets, "assets/runtime/process_snapshot.txt", (content) => content.replace(new RegExp(`^root(\\s+${rootSnapshotPid}\\s+)`, "m"), `${candidate.investigation.primaryUser}$1`));
      replaceAsset(assets, "assets/logs/audit.log", (content) => `${content}type=USER_CMD msg=audit(${candidate.investigation.incidentDate} ${candidate.investigation.incidentWindowStart}:55): pid=${rootSnapshotPid} uid=0 auid=0 ses=1 msg='cwd=\"/\" cmd=\"/usr/bin/id\"'\n`);
    }), "semantic", "Root-effective"],
    ["root output ownership", () => checkSimulationMutation(checkLinuxInvestigationQuality, candidate, (simulation) => {
      const cmd = simulation.commands.find((item) => item.id === command.id);
      const touched = simulation.files.find((item) => cmd.affectedFileIds.includes(item.id));
      cmd.renderedCommand = `tar -czf ${touched.path} /srv/shared`;
      touched.ownerUid = 1001;
    }), "semantic", "Output file ownership"],
    ["directory without execute bit", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      replaceAsset(assets, "assets/reports/permissions_report.txt", (content) => `${content}\n/tmp/bad-dir drw-r----- root root\n`);
    }), "semantic", "Directory permissions"],
    ["packaged unit wrong owner", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      replaceAsset(assets, "assets/reports/permissions_report.txt", (content) => `${content}\n/lib/systemd/system/ssh.service -rw-r----- ${candidate.investigation.primaryUser} ${candidate.investigation.primaryUser}\n`);
    }), "semantic", "Packaged systemd"],
    ["historical process in snapshot", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      replaceAsset(assets, "assets/runtime/process_snapshot.txt", (content) =>
        `${content}${candidate.investigation.primaryUser} ${historicalProcess.pid} ${historicalProcess.ppid} ${historicalProcess.executable}\n`
      );
    }), "semantic", "Historical completed process"],
    ["journal header after entries", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      replaceAsset(assets, "assets/journal/journal_systemd.txt", (content) => content.replace(/^(-- Journal begins[^\n]*\n)([\s\S]*)$/, "$2\n$1"));
    }), "service_model", "header"],
    ["sudo authorization ignores config summary", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      for (const item of assets.filter((entry) => /sudoers(?:\.d\/|$)|\/sudoers\.d\//i.test(entry.file_path))) {
        item.content = item.content
          .split(/\r?\n/)
          .filter((line) => {
            const trimmed = line.trim();
            return !trimmed || trimmed.startsWith("#") || /^Defaults\b/i.test(trimmed);
          })
          .join("\n");
      }
    }), "sudo_audit", "not authorized"],
    ["document affected service drift", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      const driftService = candidate.investigation.affectedService === "cron.service" ? "ssh.service" : "cron.service";
      replaceAsset(assets, "assets/evidence/incident_brief.md", (content) => content.replace(candidate.investigation.affectedService, driftService));
    }), "semantic", "service|affected service|non-primary|canonical"],
    ["risk register unrelated evidence", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      replaceAsset(assets, "assets/evidence/risk_register.csv", (content) => `${content.trim()}\nR-999,Static config cited as behavior evidence,high,/etc/passwd,review\n`);
    }), "semantic", "Risk register"],
    ["placeholder key material", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      replaceAsset(assets, "assets/ssh/" + candidate.investigation.primaryUser + "/authorized_keys", () => "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleHostKey user@example\n");
    }), "semantic", "placeholder key"],
    ["event id command mismatch", () => checkSimulationMutation(checkLinuxInvestigationQuality, candidate, (simulation) => {
      const cmd = simulation.commands.find((item) => item.id === command.id);
      cmd.id = "command:incident:archive";
      cmd.renderedCommand = "systemctl restart ssh.service";
    }), "semantic", "event ID"],
    ["duplicate open files", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      const open = asset(assets, "assets/runtime/open_files.txt");
      const row = firstLine(open.content, /^\S+\s+\d+\s+\S+\s+\S+/m);
      if (!row) throw new Error("candidate missing open_files data row");
      open.content += `${row}\n`;
    }), "process_open_files", "Duplicate open_files"],
    ["private IP labeled external", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      replaceAsset(assets, "assets/evidence/incident_brief.md", (content) => content.replace("Network sources observed:", "External sources observed:"));
    }), "semantic", "external"],
    ["docker port without daemon support", () => checkAssetMutation(checkLinuxInvestigationQuality, candidate, (assets) => {
      replaceAsset(assets, "assets/network/listening_ports.txt", (content) => `${content}\ntcp   LISTEN 127.0.0.1:2375      dockerd\n`);
      replaceAsset(assets, "assets/runtime/process_snapshot.txt", (content) => content.replace(/-H tcp:\/\/127\.0\.0\.1:2375\s*/g, ""));
    }), "semantic", "Docker TCP"],
  ];

  for (const [name, run, category, text] of regressions) {
    expectIssue(name, run(), category, text);
  }

  const badTasks = buildFinalLab(candidate.investigation, candidate.assets, {
    tasks: buildFinalLab(candidate.investigation, candidate.assets).tasks.map((task, index) =>
      index === 1 ? { ...task, title: "Validate supplementary groups for the reviewed account.", description: "Validate supplementary groups for the reviewed account.", evidence: ["assets/csv/users.csv"] } : task
    ),
  });
  expectIssue("task feasibility requires groups evidence", checkLinuxFinalProductionQuality({ context: candidate.investigation, assets: candidate.assets, lab: badTasks }), "asset_consistency", "evidence");

  const weakTimeline = buildFinalLab(candidate.investigation, candidate.assets, {
    tasks: buildFinalLab(candidate.investigation, candidate.assets).tasks.map((task, index) =>
      index === 0 ? { ...task, evidence: ["assets/reports/service_inventory.txt", "assets/docs/change_request.md"] } : task
    ),
  });
  expectIssue("timeline task evidence quality", checkLinuxFinalProductionQuality({ context: candidate.investigation, assets: candidate.assets, lab: weakTimeline }), "asset_consistency", "timeline reconstruction");

  const badNarrative = buildFinalLab(candidate.investigation, candidate.assets, {
    title: `Very long ${candidate.investigation.incidentId} Linux investigation title that drags case metadata into the learner-facing title and reads like an internal ticket dump rather than a concise professional exercise`,
    subtitle: "Linux investigation: SSH session, sudo-driven",
    tasks: buildFinalLab(candidate.investigation, candidate.assets).tasks.map((task, index) =>
      index === 0 ? { ...task, title: "Reconstruct timeline for" } : task
    ),
  });
  const narrativeResult = checkLinuxFinalProductionQuality({ context: candidate.investigation, assets: candidate.assets, lab: badNarrative });
  expectIssue("title metadata quality", narrativeResult, "generated_text", "title");
  expectIssue("subtitle completion quality", narrativeResult, "generated_text", "subtitle");

  console.log(JSON.stringify({ passed: true, regressions: regressions.length + 4 }, null, 2));
}

main();
