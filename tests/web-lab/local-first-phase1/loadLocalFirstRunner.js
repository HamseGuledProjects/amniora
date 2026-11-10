"use strict";
require("../../register-ts.cjs");
module.exports = {
  ...require("../../../lib/web-lab/local-first-runner/protocol.ts"),
  ...require("../../../lib/web-lab/local-first-runner/pairing-service.ts"),
  ...require("../../../lib/web-lab/local-first-runner/ticket-service.ts"),
};
