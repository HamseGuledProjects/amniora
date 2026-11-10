// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript runner requires the explicit extension.
import { validateTaskAssistInput } from "../../lib/ai/taskAssistValidation.ts";

const validRequest = {
  mode: "hint",
  task: "Review the authentication evidence.",
  objective: "Identify the suspicious login.",
  scenario: "A Linux host recorded unusual authentication activity.",
  difficulty: "Intermediate",
};

test("accepts the existing valid Task Guidance request shape", () => {
  const result = validateTaskAssistInput(validRequest);

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data, validRequest);
  }
});

test("rejects missing required context", () => {
  const result = validateTaskAssistInput({
    ...validRequest,
    objective: undefined,
  });

  assert.equal(result.success, false);
});

test("rejects unsupported modes and difficulties", () => {
  assert.equal(
    validateTaskAssistInput({ ...validRequest, mode: "solve" }).success,
    false
  );
  assert.equal(
    validateTaskAssistInput({ ...validRequest, difficulty: "Expert" }).success,
    false
  );
});

test("rejects oversized prompt fields", () => {
  assert.equal(
    validateTaskAssistInput({
      ...validRequest,
      task: "x".repeat(2_001),
    }).success,
    false
  );
  assert.equal(
    validateTaskAssistInput({
      ...validRequest,
      objective: "x".repeat(1_001),
    }).success,
    false
  );
  assert.equal(
    validateTaskAssistInput({
      ...validRequest,
      scenario: "x".repeat(4_001),
    }).success,
    false
  );
});
