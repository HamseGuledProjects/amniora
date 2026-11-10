"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const cases = [
  "linux-foundations.cjs",
  "web-lab/local-first-phase1/runContracts.js",
  "web-lab/local-first-phase3/runPackageContracts.js",
  "web-lab/local-first-phase3/runHelperContracts.js",
  "web-lab/local-first-phase3/runLifecycleContracts.js",
  "web-lab/local-first-phase4/runViewerContracts.js",
];
const environment = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
for (const file of cases) {
  const result = spawnSync(process.execPath, ["--require", path.join(__dirname, "offline-guard.cjs"), path.join(__dirname, file)],
    { cwd: path.resolve(__dirname, ".."), env: environment, stdio: "inherit", timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`PASS ${cases.length} offline suites (synthetic identities, fake Docker; no external services)`);
