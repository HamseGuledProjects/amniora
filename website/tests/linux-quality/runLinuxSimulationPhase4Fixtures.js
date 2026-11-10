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

function replaceAsset(assets, path, mutate) {
  return assets.map((asset) => asset.file_path === path ? { ...asset, content: mutate(asset.content) } : asset);
}

function expectPass(name, run) {
  run();
  console.log(`PASS ${name}`);
}

function expectFail(name, expected, run) {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) throw new Error(`${name}: expected "${expected}", got "${message}"`);
    console.log(`PASS ${name}: ${message}`);
    return;
  }
  throw new Error(`${name}: expected failure containing "${expected}".`);
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

function buildCandidate() {
  for (let index = 0; index < 60; index += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({ os: "Linux", difficulty: "Advanced" });
      if (
        candidate.simulation.evidenceRegistry.length > 0 &&
        candidate.simulation.documentFacts.length > 0 &&
        candidate.simulation.documents.length > 0 &&
        candidate.simulation.canonicalTasks.length >= 5 &&
        candidate.simulation.taskFeasibilityProofs.every((proof) => proof.feasible)
      ) {
        return candidate;
      }
    } catch {
      // Keep looking for a valid deterministic fixture.
    }
  }
  throw new Error("Could not build an Advanced candidate with Phase 4 canonical documentation/task data.");
}

const candidate = buildCandidate();

expectPass("valid generated phase4 documentation and task evidence", () =>
  validateLinuxSimulationEvidence(candidate.simulation, candidate.assets)
);

expectSimulationFail("task references missing asset", "references missing evidence asset", (simulation) => {
  const original = [...simulation.canonicalTasks[0].selectedEvidenceAssetIds];
  simulation.canonicalTasks[0].selectedEvidenceAssetIds = ["evidence:missing"];
  return () => { simulation.canonicalTasks[0].selectedEvidenceAssetIds = original; };
});

expectSimulationFail("task has unsatisfied capability", "lacks capability", (simulation) => {
  const original = [...simulation.canonicalTasks[0].requiredCapabilities];
  simulation.canonicalTasks[0].requiredCapabilities = ["network_source"];
  return () => { simulation.canonicalTasks[0].requiredCapabilities = original; };
});

expectFail("timeline observed row with blank source", "blank source", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/evidence/timeline.csv", (content) => {
    const lines = content.split(/\r?\n/);
    const row = lines[1].split(",");
    row[3] = "";
    lines[1] = row.join(",");
    return lines.join("\n");
  });
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

expectFail("timeline observed row without exact source", "lacks exact source support", () => {
  const assets = replaceAsset(cloneAssets(candidate.assets), "assets/evidence/timeline.csv", (content) => {
    const lines = content.split(/\r?\n/);
    const row = lines[1].split(",");
    row[7] = "";
    lines[1] = row.join(",");
    return lines.join("\n");
  });
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

expectSimulationFail("wrong change ID document fact", "missing fact", (simulation) => {
  simulation.documents[0].factIds.push("fact:missing-change");
  return () => { simulation.documents[0].factIds = simulation.documents[0].factIds.filter((factId) => factId !== "fact:missing-change"); };
});

expectSimulationFail("document timestamp after collection", "timestamp after collection", (simulation) => {
  const original = simulation.documents[0].createdAt;
  simulation.documents[0].createdAt = "2099-01-01 00:00:00";
  return () => { simulation.documents[0].createdAt = original; };
});

expectSimulationFail("spoiler fact in brief", "spoiler fact", (simulation) => {
  const brief = simulation.documents.find((document) => document.documentType === "incident_brief");
  if (!brief) throw new Error("missing brief");
  brief.factIds.push("fact:actor:candidate");
  return () => { brief.factIds = brief.factIds.filter((factId) => factId !== "fact:actor:candidate"); };
});

expectFail("learner asset missing from registry", "missing assets/logs/auth.log", () => {
  const assets = cloneAssets(candidate.assets).filter((asset) => asset.file_path !== "assets/logs/auth.log");
  validateLinuxSimulationEvidence(candidate.simulation, assets);
});

expectSimulationFail("advanced task supported by one asset", "lacks capability", (simulation) => {
  const original = [...simulation.canonicalTasks[0].selectedEvidenceAssetIds];
  simulation.canonicalTasks[0].selectedEvidenceAssetIds = simulation.canonicalTasks[0].selectedEvidenceAssetIds.slice(0, 1);
  return () => { simulation.canonicalTasks[0].selectedEvidenceAssetIds = original; };
});

expectSimulationFail("save-object mapping mutates task evidence", "lacks capability", (simulation) => {
  const originalCapabilities = [...simulation.canonicalTasks[2].requiredCapabilities];
  const originalEvidence = [...simulation.canonicalTasks[2].selectedEvidenceAssetIds];
  simulation.canonicalTasks[2].requiredCapabilities = ["open_file_correlation"];
  simulation.canonicalTasks[2].selectedEvidenceAssetIds = ["evidence:logs-auth-log"];
  return () => {
    simulation.canonicalTasks[2].requiredCapabilities = originalCapabilities;
    simulation.canonicalTasks[2].selectedEvidenceAssetIds = originalEvidence;
  };
});
