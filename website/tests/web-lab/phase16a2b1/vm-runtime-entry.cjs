#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Entry point for compiled engineering VM runtime bundle. */
"use strict";
require("./byo-runner/runtime-cli.js").runByoRuntimeCli().catch(error => {
  void error;
  process.stderr.write("RUNNER_BOOTSTRAP_FAILED\n");
  process.exitCode = 1;
});
