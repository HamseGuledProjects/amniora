"use strict";
require("../../register-ts.cjs");
module.exports = {
  ...require("../../../lib/web-lab/local-first-guest/protocol.ts"),
  ...require("../../../lib/web-lab/local-first-guest/privileged-runtime.ts"),
  ...require("../../../lib/web-lab/local-first-guest/runtime-helper-protocol.ts"),
  ...require("../../../lib/web-lab/local-first-guest/runtime-helper-transport.ts"),
  ...require("../../../lib/web-lab/local-first-guest/helper-backend.ts"),
  ...require("../../../lib/web-lab/local-first-guest/guest-runtime.ts"),
  ...require("../../../lib/web-lab/local-runner/package.ts"),
  ...require("../../../lib/web-lab/planner.ts"),
  ...require("../../../lib/web-lab/canonical-json.ts"),
};
