#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated trusted browser startup reliability probe. */
"use strict";

const { browserSession } = require("../phase5/trustedObserver");

const ATTEMPTS = 10;

function failureProcessState(error) {
  const signal = /\(signal ([^)]+)\)$/.exec(error.message);
  const exitCode = /\(exit code ([^)]+)\)$/.exec(error.message);
  return {
    exitCode: exitCode ? Number(exitCode[1]) : null,
    exitSignal: signal?.[1] || null,
  };
}

async function main() {
  const results = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const attemptStarted = process.hrtime.bigint();
    try {
      let startup;
      await browserSession(async browser => { startup = browser.startup; });
      results.push({ attempt, outcome: "ready", startupMilliseconds: startup.milliseconds });
    } catch (error) {
      results.push({
        attempt,
        outcome: "failed",
        elapsedMilliseconds: Number(process.hrtime.bigint() - attemptStarted) / 1_000_000,
        error: error.message,
        ...failureProcessState(error),
      });
      console.log(JSON.stringify({ results }, null, 2));
      process.exitCode = 1;
      return;
    }
  }
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
