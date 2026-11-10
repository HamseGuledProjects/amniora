// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Test-only adapter around the Phase 8 Docker implementation. */
"use strict";
const { createHash } = require("node:crypto");
const { phase8DockerBackend } = require("../phase8/phase8DockerBackend");

function createPhase14LocalDockerAdapter() {
  const local = phase8DockerBackend({ ttlMs: 60_000 });
  const counts = { create: 0, reset: 0, destroy: 0 };
  const failures = { create: false, reset: false, grade: false };
  const backend = {
    async create(spec, context) {
      counts.create++;
      if (failures.create) { failures.create = false; throw new Error("local-private-create-failure"); }
      return local.backend.create(spec, context);
    },
    status: (...args) => local.backend.status(...args),
    async reset(reference, context, spec) {
      counts.reset++;
      if (failures.reset) { failures.reset = false; throw new Error("local-private-reset-failure"); }
      return local.backend.reset(reference, context, spec);
    },
    async destroy(reference, context) {
      counts.destroy++;
      return local.backend.destroy(reference, context);
    },
    async inspect(reference, expected) {
      const all = await local.backend.listManaged();
      const found = all.filter(item => item.reference === reference ||
        (reference === expected.instanceId && item.instanceId === expected.instanceId));
      if (!found.length) return { state: "missing", observation: null };
      const exact = found.find(item => item.instanceId === expected.instanceId &&
        item.buildFingerprint === expected.buildFingerprint &&
        item.generationVersion === expected.generationVersion &&
        item.runtimeVersion === expected.runtimeVersion);
      if (!exact) return { state: "mismatch", observation: found[0] };
      return { state: exact.state === "ready" ? "ready" : "failed", observation: exact };
    },
    listManaged: () => local.backend.listManaged(),
    destroyManaged: observation => local.backend.destroyManaged(observation),
  };
  const grader = {
    async grade({ spec, runtime, context }) {
      if (failures.grade) { failures.grade = false; throw new Error("local-private-grader-failure"); }
      const result = await local.grader.grade(runtime.backendReference, spec);
      return { outcome: result.status === "pass" ? "pass" : "not_complete",
        observationFingerprint: result.status === "pass"
          ? createHash("sha256").update(JSON.stringify({ instanceId: runtime.instanceId,
            generation: context.generationVersion, result: result.status, grader: "phase14-local-observer-1" })).digest("hex")
          : undefined,
        graderVersion: "phase14-local-observer-1" };
    },
  };
  return { ...local, backend, grader, counts, failures };
}

module.exports = { createPhase14LocalDockerAdapter };
