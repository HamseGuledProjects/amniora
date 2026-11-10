#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Node wrapper for the existing browser harness. */
"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const harness = path.resolve(__dirname, "../phase15b/runBrowserUi.js");
for (const args of [["--cloud"], ["--cloud", "--preview"]]) {
  const result = spawnSync(process.execPath, [harness, ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("Phase 17B Cloud browser UI: PASS (desktop lifecycle, mobile, accessibility and development previews; synthetic API only)");
