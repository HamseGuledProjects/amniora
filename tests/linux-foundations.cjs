"use strict";
require("./register-ts.cjs");
const assert = require("node:assert/strict");
const random = require("../lib/lab-assets/linux/deterministicRandom.ts");
const command = require("../lib/lab-assets/linux/commandSemantics.ts");
const csv = require("../lib/lab-assets/linux/csv.ts");
const time = require("../lib/lab-assets/linux/time.ts");
const narrative = require("../lib/lab-assets/linux/narrativeResponse.ts");

const seed = random.normalizeLinuxSeed("portfolio-example");
const stream = () => {
  const rng = random.createDeterministicRandom(seed);
  return [rng.bytes(64), rng.shuffle([1, 2, 3, 4]), rng.nextInt(10, 30), rng.id("case")];
};
assert.deepEqual(stream(), stream(), "the same seed must reproduce the same sequence");
const rng = random.createDeterministicRandom(seed);
const before = rng.fork("evidence").bytes(32);
rng.bytes(128);
assert.deepEqual(before, rng.fork("evidence").bytes(32), "named streams must not depend on unrelated draws");
assert.notDeepEqual(before, rng.fork("tasks").bytes(32));
assert.equal(random.stableHash({ b: 2, a: 1 }), random.stableHash({ a: 1, b: 2 }));
assert.throws(() => random.normalizeLinuxSeed("contains a newline\n"));
assert.throws(() => rng.nextInt(5, 5));
assert.throws(() => rng.bytes(4097));
assert.deepEqual(csv.parseLinuxCsvLine('"comma,inside","doubled ""quote""",last').values,
  ["comma,inside", 'doubled "quote"', "last"]);
assert.equal(csv.parseLinuxCsvLine('"unclosed').quoted, true, "CSV parser reports an unfinished quote");
assert.deepEqual(command.splitShellCommand('cat "/var/log/example file.log"'), { tokens: ["cat", "/var/log/example file.log"], closed: true });
const docker = command.parseLinuxCommand("docker run --name training -v /srv/example:/data:ro example.test/training:1");
assert.equal(docker.kind, "docker_run");
assert.equal(docker.containerName, "training");
assert.equal(docker.mounts[0].readOnly, true);
assert.equal(time.formatLinuxInstantInTimeZone(Date.UTC(2026, 6, 1, 12), "Europe/London"), "2026-07-01 13:00:00");
assert.equal(time.formatLinuxInstantInTimeZone(Date.UTC(2026, 0, 1, 12), "Europe/London"), "2026-01-01 12:00:00");
assert.equal(time.isValidLinuxTimeZone("invalid/example"), false);

const payload = {
  title: "Synthetic evidence review", topic: "Linux", difficulty: "Beginner", estimated_time: "30 mins",
  objective: "Review the supplied synthetic evidence.", scenario: "A fictional training host requires review.",
  tasks: Array.from({ length: 5 }, (_, index) => ({ phase: `Step ${index + 1}`, title: "Review evidence",
    evidence: ["/var/log/example.log"], deliverable: "Record a supported observation." })),
  hints: ["Read the evidence.", "Check time zones.", "Separate inference from observation."],
  outcomes: ["Evidence review", "Time correlation", "Bounded conclusions"],
};
assert.equal(narrative.parseGeneratedLabResponse({ status: "completed", output_text: JSON.stringify(payload) }).ok, true);
assert.equal(narrative.parseGeneratedLabResponse({ status: "incomplete", output_text: JSON.stringify(payload) }).reason, "incomplete_output");
assert.equal(narrative.parseGeneratedLabResponse({ status: "refused" }).reason, "refusal");
assert.equal(narrative.parseGeneratedLabResponse({ output_text: "{" }).reason, "invalid_json");
assert.equal(narrative.parseGeneratedLabResponse({ output_text: JSON.stringify(payload) }, { expectedTaskCount: 6 }).reason, "schema_mismatch");
assert.equal(narrative.parseGeneratedLabResponse({ output_text: JSON.stringify({ ...payload, tasks: payload.tasks.slice(0, 4) }) }).reason, "schema_mismatch");
console.log("Linux foundations: PASS (seed replay, namespace isolation, command/CSV parsing, time zones, AI response rejection)");
