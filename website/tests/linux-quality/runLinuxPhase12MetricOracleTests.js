#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.

let assertions = 0;
function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

function key(claim) {
  return JSON.stringify(claim);
}

function oracle(expected, actual) {
  const expectedSet = new Set(expected.map(key));
  const seenActual = new Set();
  let matched = 0;
  let duplicates = 0;
  for (const claim of actual) {
    const k = key(claim);
    if (seenActual.has(k)) {
      duplicates += 1;
      continue;
    }
    seenActual.add(k);
    if (expectedSet.has(k)) matched += 1;
  }
  return {
    precision: seenActual.size ? matched / seenActual.size : null,
    recall: expectedSet.size ? matched / expectedSet.size : 1,
    duplicates,
  };
}

const id = { subject: "identity:j.smith", predicate: "authenticated", object: null };
const cmd = { subject: "command:/usr/bin/ssh", predicate: "executed", object: null };

assert("exact match precision recall", oracle([id], [id]).precision === 1 && oracle([id], [id]).recall === 1);
assert("empty extraction precision null and recall zero for positive case", oracle([id], []).precision === null && oracle([id], []).recall === 0);
assert("missing claim reduces recall", oracle([id, cmd], [id]).recall === 0.5);
assert("extra claim reduces precision", oracle([id], [id, cmd]).precision === 0.5);
assert("duplicate claim is counted separately from precision denominator", oracle([id], [id, id]).duplicates === 1 && oracle([id], [id, id]).precision === 1);
assert("wrong subject does not match", oracle([id], [{ ...id, subject: "identity:nobody" }]).precision === 0);
assert("wrong predicate does not match", oracle([id], [{ ...id, predicate: "executed" }]).recall === 0);
assert("wrong object does not match", oracle([{ ...id, object: "host:ssh-gw" }], [{ ...id, object: "host:web" }]).precision === 0);

const learnerSurfaceWrong = [{ subject: "identity:nobody", predicate: "authenticated", object: null }];
const canonicalExpected = [id];
assert("surface fidelity treats learner-stated wrong value as expected extraction", oracle(learnerSurfaceWrong, learnerSurfaceWrong).precision === 1 && oracle(learnerSurfaceWrong, learnerSurfaceWrong).recall === 1);
assert("canonical correctness remains separate for learner-stated wrong value", oracle(canonicalExpected, learnerSurfaceWrong).precision === 0 && oracle(canonicalExpected, learnerSurfaceWrong).recall === 0);
assert("zero extracted evidence is not perfect when learner stated evidence", oracle([{ evidence: "assets/logs/not-real.log" }], []).precision === null && oracle([{ evidence: "assets/logs/not-real.log" }], []).recall === 0);

console.log(JSON.stringify({ passed: true, assertions }, null, 2));
