// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Phase 6 local Docker adapter. */
const { LocalWebLabRuntimeManager } = require("../phase5/runtimeManager");

function dockerBackend(now, ttlMs) {
  const manager = new LocalWebLabRuntimeManager({ now, ttlMs });
  return {
    manager,
    backend: {
      async create(spec) { return (await manager.create(spec)).instanceId; },
      async status(reference) { return (await manager.status(reference)).status; },
      async reset(reference) { await manager.reset(reference); },
      async destroy(reference) { await manager.destroy(reference); },
    },
    grader: {
      async grade(reference) { return manager.grade(reference); },
    },
  };
}

module.exports = { dockerBackend };
