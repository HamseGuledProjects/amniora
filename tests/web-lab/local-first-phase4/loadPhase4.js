"use strict";
require("../../register-ts.cjs");
module.exports = {
  ...require("../../../lib/web-lab/local-first-viewer/protocol.ts"),
  ...require("../../../lib/web-lab/local-first-viewer/session.ts"),
  ...require("../../../lib/web-lab/local-first-guest/protocol.ts"),
  ...require("../../../lib/web-lab/byo-runner/protocol.ts"),
};
