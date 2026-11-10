// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output root.");

const { buildLinuxAssetCandidate } = require(`${out}/lib/lab-assets/linux/index.js`);
const { validateLinuxSimulationEvidence } = require(`${out}/lib/lab-assets/linux/simulation.js`);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneAssets(assets) {
  return assets.map((asset) => ({ ...asset }));
}

function replaceAsset(assets, filePath, transform) {
  const asset = assets.find((item) => item.file_path === filePath);
  if (!asset) throw new Error(`Missing fixture asset ${filePath}`);
  asset.content = transform(asset.content);
  return assets;
}

function expectPass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

function expectFail(name, expected, fn) {
  try {
    fn();
    throw new Error("__NO_FAILURE__");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (message === "__NO_FAILURE__") {
      throw new Error(`${name}: expected failure`);
    }
    const matched = expected instanceof RegExp ? expected.test(message) : message.includes(expected);
    if (!matched) {
      throw new Error(`${name}: expected "${expected}", got "${message}"`);
    }
    console.log(`PASS ${name}: ${message}`);
  }
}

function expectSimulationFail(name, expected, mutate) {
  let restore = () => {};
  expectFail(name, expected, () => {
    restore = mutate(candidate.simulation) || (() => {});
    try {
      validateLinuxSimulationEvidence(candidate.simulation, candidate.assets);
    } finally {
      restore();
    }
  });
}

function buildWithTransition() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        category: "Linux",
        difficulty: "Advanced",
        duration: "30 mins",
        title: "CyberLab Asset Pack",
      });
      if (candidate.simulation.serviceTransitions.length > 0) return candidate;
    } catch (error) {
      // Keep searching for a generated fixture with canonical service transitions.
    }
  }
  throw new Error("Could not build an Advanced candidate with service transitions.");
}

const candidate = buildWithTransition();
const transition = candidate.simulation.serviceTransitions[0];
const commandCause = transition.cause.type === "command"
  ? candidate.simulation.commands.find((command) => command.id === transition.cause.commandId)
  : undefined;
const service = candidate.simulation.services.find((item) => item.id === transition.serviceId);
const timer = candidate.simulation.services.find((item) => item.unitType === "timer");
const oneshot = candidate.simulation.services.find((item) => item.unitType === "oneshot");
const serviceWithMain = candidate.simulation.services.find((item) => item.mainProcessId);

expectPass("valid generated phase2 service evidence", () =>
  validateLinuxSimulationEvidence(candidate.simulation, candidate.assets)
);

expectSimulationFail("transition with missing command cause", "execution disagreement", (simulation) => {
  const original = simulation.serviceTransitions[0].cause;
  simulation.serviceTransitions[0].cause = { type: "command", commandId: "command:missing" };
  return () => { simulation.serviceTransitions[0].cause = original; };
});

if (commandCause) {
  expectSimulationFail("transition before command", "occurs before command", (simulation) => {
    const original = simulation.serviceTransitions[0].occurredAt;
    simulation.serviceTransitions[0].occurredAt = "2000-01-01 00:00:00";
    return () => { simulation.serviceTransitions[0].occurredAt = original; };
  });

  expectSimulationFail("plain enable cannot start", "changed after lifecycle finalization", (simulation) => {
    const command = simulation.commands.find((item) => item.id === commandCause.id);
    const originalCommand = { ...command, argv: [...command.argv], expectedRenderTargets: [...command.expectedRenderTargets] };
    const originalOperation = simulation.serviceTransitions[0].operation;
    command.renderedCommand = "systemctl enable metrics-cache.service";
    command.argv = ["systemctl", "enable", "metrics-cache.service"];
    command.expectedRenderTargets = [];
    simulation.serviceTransitions[0].operation = "start";
    return () => {
      Object.assign(command, originalCommand);
      simulation.serviceTransitions[0].operation = originalOperation;
    };
  });
}

expectPass("enable --now can produce enable and start when generated", () => {
  const enableNow = candidate.simulation.commands.find((command) => /systemctl enable --now/.test(command.renderedCommand));
  if (!enableNow) return;
  const related = candidate.simulation.serviceTransitions.filter((item) =>
    item.cause.type === "command" && item.cause.commandId === enableNow.id
  );
  if (!related.some((item) => item.operation === "enable") || !related.some((item) => item.operation === "start")) {
    throw new Error("enable --now did not produce enable and start transitions.");
  }
});

expectFail("audit start vs journal reload mismatch", "journal_systemd operation", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/journal/journal_systemd.txt", (content) =>
    content
      .split(/\r?\n/)
      .map((line) => line.includes(service?.unitName || "") ? line.replace(/\bStarted\b|\bReloaded\b|\bRestarted\b|\bEnabled\b/, "Mismatched") : line)
      .join("\n")
  );
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

if (oneshot) {
  expectSimulationFail("oneshot cannot be persistently running", "oneshot", (simulation) => {
    const target = simulation.services.find((item) => item.id === oneshot.id);
    const original = { activeState: target.activeState, subState: target.subState };
    target.activeState = "active";
    target.subState = "running";
    return () => Object.assign(target, original);
  });
}

if (timer) {
  expectSimulationFail("timer cannot be modeled as daemon", "timer", (simulation) => {
    const target = simulation.services.find((item) => item.id === timer.id);
    const original = target.subState;
    target.subState = "running";
    return () => { target.subState = original; };
  });
}

if (service) {
  expectFail("service inventory must reflect canonical state", `service_inventory ${service.unitName}`, () => {
    const assets = replaceAsset(cloneAssets(candidate.assets), "assets/reports/service_inventory.txt", (content) =>
      content.split(service.unitName).join("missing-unit.service")
    );
    validateLinuxSimulationEvidence(candidate.simulation, assets);
  });

  expectSimulationFail("packaged unit cannot live under etc systemd", "incorrectly uses", (simulation) => {
    const target = simulation.services.find((item) => item.id === service.id);
    const original = { packageName: target.packageName, unitPath: target.unitPath };
    target.packageName = target.packageName || "fixture-package";
    target.unitPath = `/etc/systemd/system/${target.unitName}`;
    return () => Object.assign(target, original);
  });
}

if (serviceWithMain) {
  expectSimulationFail("main process id must exist", /main process|ownership mismatch/, (simulation) => {
    const target = simulation.services.find((item) => item.id === serviceWithMain.id);
    const original = target.mainProcessId;
    target.mainProcessId = "process:missing";
    return () => { target.mainProcessId = original; };
  });

  expectSimulationFail("main process executable must match service", /main process executable mismatch|ownership mismatch/, (simulation) => {
    const target = simulation.services.find((item) => item.id === serviceWithMain.id);
    const stem = target.unitName.split(".")[0].replace("ssh", "sshd");
    const original = target.mainProcessId;
    target.mainProcessId = simulation.processes.find((process) =>
      process.id !== serviceWithMain.mainProcessId && !process.executable.toLowerCase().includes(stem)
    ).id;
    return () => { target.mainProcessId = original; };
  });
}

expectSimulationFail("transition after collection", "after collection", (simulation) => {
  const original = simulation.serviceTransitions[0].occurredAt;
  simulation.serviceTransitions[0].occurredAt = "2099-01-01 00:00:00";
  return () => { simulation.serviceTransitions[0].occurredAt = original; };
});

expectFail("users csv login after collection", "users.csv login after collection", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/csv/users.csv", (content) =>
    content.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/, "2099-01-01 00:00")
  );
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

expectFail("journal header later than first entry", "header is later", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/journal/journal_systemd.txt", (content) =>
    content.replace(/-- Journal begins at .*? UTC --/, "-- Journal begins at 2099-01-01 00:00:00 UTC --")
  );
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

expectFail("journal header must be first", "header is missing or not first", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/journal/journal_systemd.txt", (content) => {
    const lines = content.split(/\r?\n/);
    return `${lines.slice(1).join("\n")}\n${lines[0]}\n`;
  });
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});
