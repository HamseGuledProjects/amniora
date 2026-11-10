#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Entry point for compiled engineering VM bundle. */
"use strict";
require("./cli.js").runByoRunnerCli().catch(error => {
  process.stderr.write(`${error?.code || error?.message || "INTERNAL_ERROR"}\n`);
  process.exitCode = 1;
});
