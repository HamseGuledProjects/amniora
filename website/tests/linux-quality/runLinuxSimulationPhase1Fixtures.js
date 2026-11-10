// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const out = process.env.OUT;
if (!out) throw new Error("Set OUT to the compiled output directory.");

const {
  buildLinuxAssetCandidate,
} = require(`${out}/lib/lab-assets/linux/index.js`);
const {
  validateLinuxSimulationEvidence,
} = require(`${out}/lib/lab-assets/linux/simulation.js`);

function cloneAssets(assets) {
  return assets.map((asset) => ({ ...asset }));
}

function replaceAsset(assets, filePath, transform) {
  const target = assets.find((asset) => asset.file_path === filePath);
  if (!target) throw new Error(`Fixture missing ${filePath}`);
  target.content = transform(target.content);
  return assets;
}

function expectFail(name, fn, expected) {
  try {
    fn();
    throw new Error(`${name}: expected failure`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (!message.includes(expected)) {
      throw new Error(`${name}: expected "${expected}", got "${message}"`);
    }
    console.log(`PASS ${name}: ${message}`);
  }
}

function expectPass(name, fn) {
  fn();
  console.log(`PASS ${name}`);
}

const candidate = buildLinuxAssetCandidate({
  category: "Linux",
  difficulty: "Advanced",
  duration: "30 mins",
  title: "CyberLab Asset Pack",
});

const { simulation } = candidate;
const timelineAsset = candidate.assets.find((asset) => asset.file_path === "assets/evidence/timeline.csv")?.content || "";
const processSnapshotAsset = candidate.assets.find((asset) => asset.file_path === "assets/runtime/process_snapshot.txt")?.content || "";
const openFilesAsset = candidate.assets.find((asset) => asset.file_path === "assets/runtime/open_files.txt")?.content || "";
const fileAccessHistoryAsset = candidate.assets.find((asset) => asset.file_path === "assets/runtime/file_access_history.csv")?.content || "";
const primaryCommand = simulation.commands.find((command) => command.kind === "primary_incident" && timelineAsset.includes(command.renderedCommand)) ||
  simulation.commands.find((command) => timelineAsset.includes(command.renderedCommand)) ||
  simulation.commands[0];
const liveProcess = simulation.processes.find((process) =>
  process.commandId &&
  new RegExp(`\\s${process.pid}\\s`).test(processSnapshotAsset)
);
const snapshotCommand = liveProcess ? simulation.commands.find((command) => command.id === liveProcess.commandId) : undefined;
const historyProcess = simulation.processes.find((process) => process.pid === primaryCommand.processId) || liveProcess;
const primaryProcess = liveProcess || simulation.processes.find((process) => process.pid === primaryCommand.processId);
const primaryFile = simulation.files.find((file) =>
  primaryCommand.affectedFileIds.includes(file.id) &&
  fileAccessHistoryAsset.includes(file.path)
);
const session = simulation.sshSessions[0];

expectPass("valid generated advanced simulation evidence", () =>
  validateLinuxSimulationEvidence(simulation, candidate.assets)
);

expectFail(
  "timeline must reference canonical command id",
  () =>
    validateLinuxSimulationEvidence(
      simulation,
      replaceAsset(cloneAssets(candidate.assets), "assets/evidence/timeline.csv", (content) =>
        content.split(primaryCommand.renderedCommand).join("missing-command-reference")
      )
    ),
  `timeline ${primaryCommand.id}`
);

expectFail(
  "process snapshot must contain SSH session process",
  () =>
    validateLinuxSimulationEvidence(
      simulation,
      replaceAsset(cloneAssets(candidate.assets), "assets/runtime/process_snapshot.txt", (content) =>
        content.split(/\r?\n/).filter((line) => !new RegExp(`(^|\\s)${session.sessionPid}\\s`).test(line)).join("\n")
      )
    ),
  "process_snapshot SSH session"
);

if (primaryFile) {
  expectFail(
    "file access history must contain canonical affected file",
    () =>
      validateLinuxSimulationEvidence(
        simulation,
        replaceAsset(cloneAssets(candidate.assets), "assets/runtime/file_access_history.csv", (content) =>
          content.split(primaryFile.path).join("__missing_canonical_path__")
        )
      ),
    "file_access_history.csv missing"
  );
}

expectFail(
  "command timestamp must stay inside SSH session",
  () => {
    const mutated = {
      ...simulation,
      commands: simulation.commands.map((command, index) =>
        command.id === primaryCommand.id ? { ...command, timestamp: "2099-01-01 00:00:00" } : command
      ),
    };
    validateLinuxSimulationEvidence(mutated, candidate.assets);
  },
  "execution context disagreement"
);
