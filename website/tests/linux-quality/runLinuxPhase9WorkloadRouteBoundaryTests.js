#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");
const {
  ROOT,
  assertionCounter,
  compileIfNeeded,
  loadModules,
  routeBoundaryCases,
} = require("./linuxPhase9AuditUtils");

async function main() {
  const counter = assertionCounter();
  counter.summary.suitesExecuted.push("runLinuxPhase9WorkloadRouteBoundaryTests");
  const out = compileIfNeeded("route-boundary");
  counter.summary.outPath = out;
  const modules = loadModules(out);
  const cases = await routeBoundaryCases(modules);
  counter.assert("route boundary case count", cases.length === 14);
  for (const row of cases) {
    counter.assert(`${row.case} persistence call count`, row.persistenceCallCount === row.expectedInsertCalls, JSON.stringify(row));
    if (row.expectedInsertCalls === 1) {
      counter.assert(`${row.case} saved hash equality`, row.savedHashEquality === true, JSON.stringify(row));
    } else {
      counter.assert(`${row.case} blocked persistence`, row.storedHashes === null, JSON.stringify(row));
    }
  }
  const missingRemediation = cases.find((row) => row.case === "missing_remediation_workload");
  counter.assert("missing remediation route case emits stable code", Boolean(missingRemediation?.workloadValidationCodes.includes("LINUX_WORKLOAD_REMEDIATION_UNCOUNTED") || missingRemediation?.otherValidationCodes.includes("LINUX_WORKLOAD_REMEDIATION_UNCOUNTED")), JSON.stringify(missingRemediation));
  const tokenRemediation = cases.find((row) => row.case === "token_remediation_cost_route_attempt");
  counter.assert("token remediation route case does not persist", tokenRemediation?.persistenceCallCount === 0, JSON.stringify(tokenRemediation));
  const summary = {
    passed: true,
    routeBoundaryCases: cases,
    assertionSummary: counter.summary,
  };
  const output = path.join(ROOT, ".tmp", "linux-phase9-audit", "phase9-route-boundary.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
