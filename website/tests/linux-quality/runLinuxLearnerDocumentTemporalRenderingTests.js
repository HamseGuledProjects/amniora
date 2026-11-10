#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function compileIfNeeded() {
  if (process.env.OUT) return path.resolve(process.env.OUT);
  const build = path.join(os.tmpdir(), `amniora-linux-learner-doc-time-${Date.now()}`);
  execSync(`npx tsc --outDir "${build}" --noEmit false --module commonjs --moduleResolution node --target es2020 --jsx react-jsx`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  return path.join(build, "lib", "lab-assets");
}

function assert(name, condition, details = "") {
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function asset(candidate, filePath) {
  const found = candidate.assets.find((item) => item.file_path === filePath);
  if (!found) throw new Error(`missing asset ${filePath}`);
  return found;
}

function buildProductionShape(buildLinuxAssetCandidate) {
  let lastError;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const candidate = buildLinuxAssetCandidate({
        seed: `phase-temporal-docs:ssh-key-provenance:${attempt}`,
        generationTime: "2026-08-12T10:00:00.000Z",
        category: "Linux",
        difficulty: "Advanced",
        duration: "60 mins",
        title: "Amniora Linux Learner Document Temporal Regression",
      }, {
        incidentFamily: "ssh_key_compromise",
        testOverrides: {
          timezone: "Europe/London",
          incidentStart: "2026-07-06 00:41:00",
          hostname: "git-lnx-02",
          serverRole: "git server",
        },
      });
      if (candidate.assetQuality?.passed) return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("could not build production-shaped temporal document candidate");
}

function learnerDocs(candidate) {
  return [
    "assets/docs/change_request.md",
    "assets/docs/maintenance_ticket.md",
    "assets/docs/security_policy.md",
    "assets/evidence/analyst_working_notes.md",
    "assets/evidence/incident_brief.md",
  ].map((filePath) => [filePath, asset(candidate, filePath).content]);
}

function assertNoLondonUtcMislabel(filePath, content) {
  const forbidden = [
    "2026-07-05 23:41 Europe/London",
    "2026-07-05 23:52 Europe/London",
    "2026-07-05 23:55 Europe/London",
    "2026-07-05 23:41-23:52 Europe/London",
    "2026-07-05 23:41:00 Europe/London",
    "2026-07-05 23:52:00 Europe/London",
    "2026-07-05 23:55:00 Europe/London",
  ];
  for (const token of forbidden) {
    assert(`${filePath} does not mislabel UTC wall-clock as London time`, !content.includes(token), token);
  }
}

function assertProductionTemporalDocuments(modules) {
  const candidate = buildProductionShape(modules.buildLinuxAssetCandidate);
  assert("direct regression uses Advanced ssh_key_compromise", candidate.investigation.incidentFamily === "ssh_key_compromise", candidate.investigation.incidentFamily);
  assert("direct regression uses git-lnx-02", candidate.investigation.hostname === "git-lnx-02", candidate.investigation.hostname);
  assert("direct regression uses Europe/London", candidate.investigation.timezone === "Europe/London", candidate.investigation.timezone);

  const startMs = modules.time.linuxLocalDateTimeToUtcMs("2026-07-06 00:41:00", "Europe/London");
  const endMs = modules.time.linuxLocalDateTimeToUtcMs("2026-07-06 00:52:00", "Europe/London");
  assert("local incident start converts to July 5 UTC", modules.time.formatLinuxUtcTimestamp(startMs) === "2026-07-05 23:41:00", modules.time.formatLinuxUtcTimestamp(startMs));
  assert("local incident end converts to July 5 UTC", modules.time.formatLinuxUtcTimestamp(endMs) === "2026-07-05 23:52:00", modules.time.formatLinuxUtcTimestamp(endMs));
  assert("canonical collection is July 5 UTC", candidate.simulation.collection.collectedAt === "2026-07-05 23:55:00", candidate.simulation.collection.collectedAt);

  for (const [filePath, content] of learnerDocs(candidate)) {
    assert(`${filePath} renders local incident window with local date`, content.includes("2026-07-06 00:41-00:52 Europe/London"), content);
    if (filePath !== "assets/docs/security_policy.md") {
      assert(`${filePath} renders collection as learner-local after window`, content.includes("2026-07-06 00:55 Europe/London"), content);
    }
    assertNoLondonUtcMislabel(filePath, content);
    assert(`${filePath} keeps timezone label consistent`, !/2026-07-05 23:\d\d(?::\d\d)? Europe\/London/.test(content), content);
  }

  const manifest = JSON.parse(asset(candidate, "manifest.json").content);
  const hostMetadata = JSON.parse(asset(candidate, "assets/inventory/host_metadata.json").content);
  assert("manifest remains UTC/ISO native", /Z$/.test(manifest.generated_at), manifest.generated_at);
  assert("host metadata remains UTC/ISO native", hostMetadata.collected_at === "2026-07-05T23:55:00Z", hostMetadata.collected_at);

  const collectionMs = Date.parse(`${candidate.simulation.collection.collectedAt.replace(" ", "T")}Z`);
  assert("collection instant is after incident end", collectionMs > endMs, `${collectionMs} <= ${endMs}`);
  return {
    caseId: candidate.investigation.incidentId,
    timezone: candidate.investigation.timezone,
    learnerWindow: "2026-07-06 00:41-00:52 Europe/London",
    sourceWindowUtc: `${modules.time.formatLinuxUtcTimestamp(startMs)}-${modules.time.formatLinuxUtcTimestamp(endMs)}`,
    collectionUtc: candidate.simulation.collection.collectedAt,
    collectionLocal: modules.time.formatLinuxLearnerDocumentDateTime(candidate.simulation.collection.collectedAt, "Europe/London"),
    documentHash: sha(learnerDocs(candidate).map(([filePath, content]) => `${filePath}\n${content}`).join("\n---\n")),
  };
}

function assertMatrix(modules) {
  const rows = [
    ["UTC", "2026-07-06 03:08:00", "2026-07-06 03:08 UTC"],
    ["Europe/London", "2026-07-06 03:08:00", "2026-07-06 04:08 Europe/London"],
    ["Europe/London", "2026-01-06 03:08:00", "2026-01-06 03:08 Europe/London"],
  ];
  for (const [zone, utc, expected] of rows) {
    assert(`${zone} learner date-time formats deterministically`, modules.time.formatLinuxLearnerDocumentDateTime(utc, zone) === expected, modules.time.formatLinuxLearnerDocumentDateTime(utc, zone));
  }
  assert("London BST midnight rollover renders local date", modules.time.formatLinuxLearnerDocumentDateTime("2026-07-05 23:55:00", "Europe/London") === "2026-07-06 00:55 Europe/London");
  assert("UTC remains explicitly UTC", modules.time.formatLinuxLearnerDocumentDateTime("2026-07-05 23:55:00", "UTC") === "2026-07-05 23:55 UTC");
  assert("cross-midnight learner window renders both dates", modules.time.formatLinuxLearnerDocumentWindow("2026-07-06 22:55:00", "2026-07-07 00:10:00", "Europe/London") === "2026-07-06 23:55 to 2026-07-07 01:10 Europe/London");
  assert("invalid timezone fails closed", (() => { try { modules.time.formatLinuxLearnerDocumentDateTime("2026-07-05 23:55:00", "Mars/Base"); return false; } catch { return true; } })());
  assert("invalid window fails closed", (() => { try { modules.time.formatLinuxLearnerDocumentWindow("2026-07-05 23:55:00", "2026-07-05 23:41:00", "UTC"); return false; } catch { return true; } })());
}

function main() {
  const out = compileIfNeeded();
  const linuxOut = path.join(out, "linux");
  const modules = {
    buildLinuxAssetCandidate: require(path.join(linuxOut, "index.js")).buildLinuxAssetCandidate,
    time: require(path.join(linuxOut, "time.js")),
  };
  const direct = assertProductionTemporalDocuments(modules);
  assertMatrix(modules);
  console.log(JSON.stringify({ passed: true, direct }, null, 2));
}

main();