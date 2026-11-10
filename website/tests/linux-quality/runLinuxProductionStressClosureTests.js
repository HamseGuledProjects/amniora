#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const assert = require("assert").strict;
const path = require("path");
const {
  timestampValue,
  assertCandidateProperties,
  newAttemptAccounting,
  recordAttemptAccounting,
} = require("./runLinuxProductionStress");

let assertions = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function candidate(syslog) {
  return {
    assets: [{ file_path: "assets/logs/syslog", content: syslog }],
    investigation: {},
    simulation: { canonicalTasks: [] },
  };
}

function checkPass(syslog) {
  assert.doesNotThrow(() => assertCandidateProperties(candidate(syslog)));
  assertions += 1;
}

function checkOrderFailure(syslog) {
  assert.throws(
    () => assertCandidateProperties(candidate(syslog)),
    /assets\/logs\/syslog timestamp order regression/
  );
  assertions += 1;
}

// Exact ordering pattern retained in the accepted CL-LNX-8432 learner syslog:
// a real 22:10 loss event followed by a non-event coverage comment whose
// interval starts at 21:46. The historical Group 2 failures did not retain
// their syslog contents, so this is a separate retained reproduction.
const retainedLoss = "2026-07-06 22:10:00 proxy-lnx-01 rsyslogd: imuxsock lost 3 messages from pid 2204 due to rate-limiting";
const retainedCoverage = "# telemetry_completeness=partial source=assets/logs/syslog host=proxy-lnx-01 interval_start=2026-07-06 21:46:00 interval_end=2026-07-06 22:10:00 reason=observed_log_loss";
check(timestampValue(retainedCoverage), null, "coverage interval is not an event");
checkPass(`${retainedLoss}\n\n${retainedCoverage}\n`);

const invoked = "2026-07-05 23:59:59 proxy-lnx-01 cron[6300]: invoked scheduled job";
const completed = "2026-07-06 00:00:00 proxy-lnx-01 cron[6300]: completed scheduled job";
checkPass(`# Time authority: UTC (+00:00); explicit offsets override.\n${invoked}\n${completed}\n`);
check(timestampValue(invoked) < timestampValue(completed), true, "date rollover retains invocation-before-completion order");
checkOrderFailure(`${completed}\n${invoked}\n`);

const sameTimeA = "2026-07-06 03:52:55 proxy-lnx-01 log-retention-cleanup.sh[6300]: completed scheduled execution";
const sameTimeB = "2026-07-06 03:52:55 proxy-lnx-01 cron[6300]: log retention cleanup completed";
checkPass(`${sameTimeA}\n${sameTimeB}\n`);
check(timestampValue(sameTimeA), timestampValue(sameTimeB), "same-timestamp records are supported");
checkOrderFailure(`${retainedLoss}\n2026-07-06 21:49:22 proxy-lnx-01 audit[2204]: /usr/bin/stat /home/morgan.admin/.ssh/authorized_keys\n`);

// The normal builder invokes the production validator before accepting a
// candidate. This direct check verifies that a genuinely reversed rendered
// syslog is still rejected by that validator, not merely by this runner.
if (process.env.OUT) {
  const { validateLinuxInvestigationAssets } = require(path.join(process.env.OUT, "linux", "investigation.js"));
  const context = {
    incidentId: "CL-LNX-CHECK",
    hostname: "proxy-lnx-01",
    primaryUser: "analyst",
    affectedService: "ssh.service",
    incidentDate: "2026-07-06",
    hostIp: "192.0.2.10",
    gateway: "192.0.2.1",
    dns: "192.0.2.53",
    ticketId: "TICKET-CHECK",
    changeId: "CHANGE-CHECK",
    timelineEvents: [],
  };
  const assets = [
    { file_path: "README.md", content: Object.values(context).filter((value) => typeof value === "string").join(" ") },
    { file_path: "assets/logs/syslog", content: `${completed}\n${invoked}\n` },
  ];
  assert.throws(
    () => validateLinuxInvestigationAssets(context, assets),
    /assets\/logs\/syslog is not chronological/
  );
  assertions += 1;
}

const totals = newAttemptAccounting();
recordAttemptAccounting(totals, {
  inputId: "first",
  attemptEvents: [{ attempt: 1, accepted: true }],
  builderReturned: true,
  finalAccepted: true,
  filtered: false,
});
recordAttemptAccounting(totals, {
  inputId: "retry",
  attemptEvents: [
    { attempt: 1, accepted: false, reason: "Linux quality checker failed" },
    { attempt: 2, accepted: true },
  ],
  builderReturned: true,
  finalAccepted: true,
  filtered: false,
});
recordAttemptAccounting(totals, {
  inputId: "post-builder",
  attemptEvents: [{ attempt: 1, accepted: true }],
  builderReturned: true,
  finalAccepted: false,
  filtered: false,
});
recordAttemptAccounting(totals, {
  inputId: "exhausted",
  attemptEvents: [{ attempt: 1, accepted: false, reason: "Linux quality checker failed" }],
  builderReturned: false,
  finalAccepted: false,
  filtered: false,
});
recordAttemptAccounting(totals, {
  inputId: "after-failure",
  attemptEvents: [{ attempt: 1, accepted: true }],
  builderReturned: true,
  finalAccepted: true,
  filtered: false,
});
check(totals.builderInvocations, 5);
check(totals.internalAttempts, 6);
check(totals.internalQualityRejections, 2);
check(totals.internalOtherRejections, 0);
check(totals.builderAcceptedCandidates, 4);
check(totals.postBuilderRejections, 1);
check(totals.finalAcceptedCases, 3);
check(totals.exhaustedInputs, 1);
check(totals.firstAttemptFinalAcceptedAcrossInputs, 2);
check(totals.maxInternalAttemptsPerInput, 2);

assert.throws(() => recordAttemptAccounting(newAttemptAccounting(), {
  inputId: "duplicate",
  attemptEvents: [{ attempt: 1, accepted: false }, { attempt: 1, accepted: true }],
  builderReturned: true,
  finalAccepted: true,
  filtered: false,
}), /duplicate internal attempt identity/);
assertions += 1;

console.log(`Linux production stress closure tests passed (${assertions} assertions).`);
