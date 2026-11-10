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
  const build = path.join(os.tmpdir(), `cyberlab-linux-systemd-state-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}


function buildCandidate(buildLinuxAssetCandidate, family, difficulty = "Advanced") {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return buildLinuxAssetCandidate({
          seed: `systemd-state:${family}:${difficulty}:${attempt}`,
          generationTime: "2026-07-29T08:00:00.000Z",
          category: "Linux",
          difficulty,
          duration: difficulty === "Advanced" ? "60 mins" : "30 mins",
          title: "CyberLab Asset Pack",
        }, { incidentFamily: family });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`could not build ${family} ${difficulty}`);
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing ${filePath}`);
  return found;
}

function replaceAsset(assets, filePath, content) {
  return assets.map((item) => item.file_path === filePath ? { ...item, content } : item);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function serviceRows(content) {
  const lines = content.trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]).map((item) => item.toLowerCase());
  const index = (name, fallback) => {
    const found = header.indexOf(name);
    return found >= 0 ? found : fallback;
  };
  return lines.slice(1).map((line) => {
    const row = parseCsvLine(line);
    return {
      service: row[index("service", 0)] || "",
      status: row[index("status", 1)] || "",
      startup: row[index("startup", 2)] || "",
      loadState: row[index("load_state", 4)] || "",
      activeState: row[index("active_state", 5)] || "",
      subState: row[index("sub_state", 6)] || "",
      result: row[index("result", 7)] || "",
      mainPid: row[index("main_pid", 8)] || "",
      unitPath: row[index("unit_path", 9)] || "",
      raw: line,
    };
  });
}

function expectedStatus(service) {
  if (service.unitType === "timer") return service.activeState === "active" ? "active" : service.activeState;
  if (service.unitType === "oneshot" && service.activeState === "inactive") return "inactive";
  return service.activeState === "active" ? "running" : service.activeState;
}

function assertInventoryMatches(candidate) {
  const rows = new Map(serviceRows(asset(candidate, "assets/reports/service_inventory.txt").content).map((row) => [row.service, row]));
  for (const service of candidate.simulation.services) {
    const row = rows.get(service.unitName);
    if (!row) throw new Error(`service_inventory missing ${service.unitName}`);
    const process = service.mainProcessId
      ? candidate.simulation.processes.find((item) => item.id === service.mainProcessId)
      : undefined;
    const checks = [
      ["status", expectedStatus(service), row.status],
      ["startup", service.unitFileState, row.startup],
      ["load_state", service.loadState, row.loadState],
      ["active_state", service.activeState, row.activeState],
      ["sub_state", service.subState, row.subState],
      ["result", service.result, row.result],
      ["main_pid", process ? String(process.pid) : "", row.mainPid],
      ["unit_path", service.unitPath, row.unitPath],
    ];
    for (const [field, expected, actual] of checks) {
      if (expected !== actual) throw new Error(`${service.unitName} ${field} expected ${expected} got ${actual}`);
    }
  }
}

function assertJournalTimelineMatch(candidate) {
  const journal = asset(candidate, "assets/journal/journal_systemd.txt").content;
  const timeline = asset(candidate, "assets/evidence/timeline.csv").content;
  for (const transition of candidate.simulation.serviceTransitions) {
    const service = candidate.simulation.services.find((item) => item.id === transition.serviceId);
    const ref = `${service.unitName} ${transition.operation} at ${transition.occurredAt}`;
    const state = `state=${transition.resultingState.loadState}/${transition.resultingState.activeState}/${transition.resultingState.subState}`;
    if (!journal.includes(ref) || !journal.includes(state)) throw new Error(`journal mismatch for ${ref}`);
    if (!timeline.includes(ref)) throw new Error(`timeline missing ${ref}`);
  }
}

function expectPass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

function expectFail(name, fn, pattern) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (new RegExp(pattern, "i").test(message)) {
      console.log(`PASS ${name}`);
      return;
    }
    throw new Error(`${name}: expected ${pattern}, got ${message}`);
  }
  throw new Error(`${name}: expected failure matching ${pattern}`);
}

function qualityOrThrow(checkLinuxInvestigationQuality, candidate, assets = candidate.assets) {
  const result = checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets,
    simulation: candidate.simulation,
  });
  if (!result.passed) {
    throw new Error(result.issues.map((issue) => issue.description).join(" | "));
  }
}

function qualityFail(checkLinuxInvestigationQuality, candidate, assets, pattern) {
  const result = checkLinuxInvestigationQuality({
    context: candidate.investigation,
    assets,
    simulation: candidate.simulation,
  });
  const text = result.issues.map((issue) => `${issue.category}:${issue.description}:${issue.evidence || ""}`).join(" | ");
  if (result.passed || !new RegExp(pattern, "i").test(text)) {
    throw new Error(`expected ${pattern}, got ${text || "pass"}`);
  }
}

function withTemporaryObjectPatch(target, patch, fn) {
  const previous = {};
  for (const key of Object.keys(patch)) previous[key] = target[key];
  Object.assign(target, patch);
  try {
    return fn();
  } finally {
    Object.assign(target, previous);
  }
}

function main() {
  const out = compileIfNeeded();
  const { buildLinuxAssetCandidate } = require(path.join(out, "linux", "index.js"));
  const {
    validateLinuxSimulationEvidence,
    simulationServiceInventoryCsv,
  } = require(path.join(out, "linux", "simulation.js"));
  const { checkLinuxInvestigationQuality } = require(path.join(out, "linux", "qualityChecker.js"));
  const { validateLinuxSemanticClosure } = require(path.join(out, "linux", "semanticClosure.js"));

  const candidates = FAMILIES.map((family) => buildCandidate(buildLinuxAssetCandidate, family));
  const systemd = candidates.find((candidate) => candidate.investigation.incidentFamily === "systemd_persistence");

  for (const candidate of candidates) {
    expectPass(`${candidate.investigation.incidentFamily} simulation systemd closure`, () => validateLinuxSimulationEvidence(candidate.simulation, candidate.assets));
    expectPass(`${candidate.investigation.incidentFamily} service inventory state columns`, () => assertInventoryMatches(candidate));
    expectPass(`${candidate.investigation.incidentFamily} journal/timeline transition agreement`, () => assertJournalTimelineMatch(candidate));
  }

  const activeRunning = candidates.flatMap((candidate) =>
    candidate.simulation.services.map((service) => ({ candidate, service }))
  ).find(({ service }) => service.unitFileState === "enabled" && service.activeState === "active" && service.subState === "running" && service.mainProcessId);
  if (!activeRunning) throw new Error("no enabled active/running unit with main PID generated");
  const activePid = activeRunning.candidate.simulation.processes.find((process) => process.id === activeRunning.service.mainProcessId).pid;
  if (!asset(activeRunning.candidate, "assets/runtime/process_snapshot.txt").content.includes(String(activePid))) {
    throw new Error("active/running main PID missing from snapshot");
  }
  console.log(`PASS enabled active/running main PID alignment ${activeRunning.service.unitName}:${activePid}`);

  const enabledInactive = candidates.flatMap((candidate) => candidate.simulation.services)
    .find((service) => service.unitFileState === "enabled" && service.activeState === "inactive" && service.subState === "dead" && !service.mainProcessId);
  if (!enabledInactive) throw new Error("no enabled inactive/dead unit generated");
  console.log(`PASS enabled inactive/dead accepted ${enabledInactive.unitName}`);

  const noTransitionRunning = systemd.simulation.services.find((service) =>
    service.activeState === "active" &&
    service.subState === "running" &&
    service.mainProcessId &&
    !systemd.simulation.serviceTransitions.some((transition) => transition.serviceId === service.id)
  );
  if (!noTransitionRunning) throw new Error("no no-transition running service available for disabled-active assertion");
  expectPass("disabled but active/running is accepted", () => withTemporaryObjectPatch(noTransitionRunning, { unitFileState: "disabled" }, () => {
    const assets = replaceAsset(systemd.assets, "assets/reports/service_inventory.txt", simulationServiceInventoryCsv(systemd.simulation));
    validateLinuxSimulationEvidence(systemd.simulation, assets);
  }));

  const oneshotService = systemd.simulation.services.find((service) =>
    service.serviceType === "oneshot" &&
    !systemd.simulation.serviceTransitions.some((transition) => transition.serviceId === service.id)
  );
  if (!oneshotService) throw new Error("no no-transition oneshot service available");
  expectPass("active/exited oneshot accepted without current PID", () => withTemporaryObjectPatch(oneshotService, {
    activeState: "active",
    subState: "exited",
    result: "success",
    mainProcessId: undefined,
  }, () => {
    const assets = replaceAsset(systemd.assets, "assets/reports/service_inventory.txt", simulationServiceInventoryCsv(systemd.simulation));
    validateLinuxSimulationEvidence(systemd.simulation, assets);
  }));

  const failedService = systemd.simulation.services.find((service) =>
    !systemd.simulation.serviceTransitions.some((transition) => transition.serviceId === service.id)
  );
  if (!failedService) throw new Error("no no-transition service available for failed-state assertion");
  expectPass("failed/failed with failure result accepted by canonical validator", () => withTemporaryObjectPatch(failedService, {
    activeState: "failed",
    subState: "failed",
    result: "exit-code",
    mainProcessId: undefined,
  }, () => {
    const assets = replaceAsset(systemd.assets, "assets/reports/service_inventory.txt", simulationServiceInventoryCsv(systemd.simulation));
    validateLinuxSimulationEvidence(systemd.simulation, assets);
  }));

  const transitionCandidate = candidates.find((candidate) => candidate.simulation.serviceTransitions.length > 0);
  const startTransition = transitionCandidate.simulation.serviceTransitions.find((transition) => ["start", "restart"].includes(transition.operation)) || transitionCandidate.simulation.serviceTransitions[0];
  const stopTransition = transitionCandidate.simulation.serviceTransitions.find((transition) => transition.operation === "stop");
  const service = transitionCandidate.simulation.services.find((item) => item.id === startTransition.serviceId);
  const ref = `${service.unitName} ${startTransition.operation} at ${startTransition.occurredAt}`;

  expectFail("masked start/restart rejected", () => {
    const transition = transitionCandidate.simulation.serviceTransitions.find((item) => item.id === startTransition.id);
    withTemporaryObjectPatch(transition.previousState, { unitFileState: "masked" }, () =>
      withTemporaryObjectPatch(transition, { operation: "start", outcome: "success" }, () => validateLinuxSimulationEvidence(transitionCandidate.simulation, transitionCandidate.assets))
    );
  }, "masked service");

  expectFail("absent unit start/restart rejected", () => {
    const transition = transitionCandidate.simulation.serviceTransitions.find((item) => item.id === startTransition.id);
    withTemporaryObjectPatch(transition.previousState, { loadState: "not-found" }, () =>
      withTemporaryObjectPatch(transition, { operation: "start", outcome: "success" }, () => validateLinuxSimulationEvidence(transitionCandidate.simulation, transitionCandidate.assets))
    );
  }, "absent service");

  if (stopTransition) {
    expectFail("successful stop must finish inactive/dead", () => {
      const transition = transitionCandidate.simulation.serviceTransitions.find((item) => item.id === stopTransition.id);
      withTemporaryObjectPatch(transition.resultingState, { activeState: "active", subState: "running" }, () =>
        validateLinuxSimulationEvidence(transitionCandidate.simulation, transitionCandidate.assets)
      );
    }, "successful stop");
  }

  expectFail("transition final-state mutation rejected", () => {
    const target = transitionCandidate.simulation.services.find((item) => item.id === startTransition.serviceId);
    const patch = target.activeState === "active"
      ? { activeState: "inactive", subState: "dead", result: "none", mainProcessId: undefined }
      : { activeState: "failed", subState: "failed", result: "exit-code", mainProcessId: undefined };
    withTemporaryObjectPatch(target, patch, () => {
      const assets = replaceAsset(transitionCandidate.assets, "assets/reports/service_inventory.txt", simulationServiceInventoryCsv(transitionCandidate.simulation));
      validateLinuxSimulationEvidence(transitionCandidate.simulation, assets);
    });
  }, "final state disagrees|descriptor .* service .* is not running|service .* is not running");

  expectFail("process snapshot main PID mutation rejected", () => {
    const mutatedAssets = replaceAsset(
      activeRunning.candidate.assets,
      "assets/runtime/process_snapshot.txt",
      asset(activeRunning.candidate, "assets/runtime/process_snapshot.txt").content
        .split(/\r?\n/)
        .filter((line) => !new RegExp(`\\s${activePid}\\s+`).test(line))
        .join("\n")
    );
    validateLinuxSimulationEvidence(activeRunning.candidate.simulation, mutatedAssets);
  }, "main PID|process_snapshot");

  expectPass("service inventory mutation rejected by quality checker", () => {
    const mutatedAssets = replaceAsset(
      activeRunning.candidate.assets,
      "assets/reports/service_inventory.txt",
      asset(activeRunning.candidate, "assets/reports/service_inventory.txt").content.replace(
        new RegExp(`(${activeRunning.service.unitName},[^,]+,[^,]+,[^\\n]+,${activeRunning.service.loadState},)${activeRunning.service.activeState}`),
        `$1inactive`
      )
    );
    qualityFail(checkLinuxInvestigationQuality, activeRunning.candidate, mutatedAssets, "service_inventory.*active_state|disagrees");
  });

  expectFail("journal transition mutation rejected", () => {
    const mutatedAssets = replaceAsset(
      transitionCandidate.assets,
      "assets/journal/journal_systemd.txt",
      asset(transitionCandidate, "assets/journal/journal_systemd.txt").content
        .split(/\r?\n/)
        .filter((line) => !line.includes(ref))
        .join("\n")
    );
    validateLinuxSimulationEvidence(transitionCandidate.simulation, mutatedAssets);
  }, "journal_systemd");

  expectFail("timeline transition mutation rejected", () => {
    const mutatedAssets = replaceAsset(
      transitionCandidate.assets,
      "assets/evidence/timeline.csv",
      asset(transitionCandidate, "assets/evidence/timeline.csv").content
        .split(/\r?\n/)
        .filter((line) => !line.includes(ref))
        .join("\n")
    );
    validateLinuxSimulationEvidence(transitionCandidate.simulation, mutatedAssets);
  }, "timeline");

  expectPass("semantic closure accepts canonical systemd state", () => {
    const result = validateLinuxSemanticClosure({ simulation: systemd.simulation, finalAssets: systemd.assets });
    if (!result.passed) throw new Error(result.issues.map((issue) => issue.message).join(" | "));
  });

  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const candidate = buildCandidate(buildLinuxAssetCandidate, "systemd_persistence", difficulty);
    expectPass(`${difficulty} systemd generation compatibility`, () => {
      assertInventoryMatches(candidate);
      qualityOrThrow(checkLinuxInvestigationQuality, candidate);
      if (difficulty === "Advanced") validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
    });
  }

  const counts = {
    units: 0,
    unitFileStates: {},
    activeStates: {},
    subStates: {},
    results: {},
    transitions: {},
    longRunningWithProcesses: 0,
    oneshot: 0,
  };
  for (const candidate of candidates) {
    for (const service of candidate.simulation.services) {
      counts.units += 1;
      counts.unitFileStates[service.unitFileState] = (counts.unitFileStates[service.unitFileState] || 0) + 1;
      counts.activeStates[service.activeState] = (counts.activeStates[service.activeState] || 0) + 1;
      counts.subStates[service.subState] = (counts.subStates[service.subState] || 0) + 1;
      counts.results[service.result] = (counts.results[service.result] || 0) + 1;
      if (service.serviceType === "long-running" && service.mainProcessId) counts.longRunningWithProcesses += 1;
      if (service.serviceType === "oneshot") counts.oneshot += 1;
    }
    for (const transition of candidate.simulation.serviceTransitions) {
      counts.transitions[transition.operation] = (counts.transitions[transition.operation] || 0) + 1;
    }
  }
  console.log(`SYSTEMD_MATRIX ${JSON.stringify(counts)}`);
  expectPass("quality checker accepts systemd candidate", () => qualityOrThrow(checkLinuxInvestigationQuality, systemd));
}

main();
