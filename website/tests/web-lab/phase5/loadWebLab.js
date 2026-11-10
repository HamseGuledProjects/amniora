// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Existing Web lab QA uses a scoped TypeScript transpile hook. */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourceRoot = path.resolve(__dirname, "../../../lib/web-lab");
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Only Web lab sources may be transpiled");
  const source = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  module._compile(result.outputText, filename);
};
module.exports = {
  ...require(path.join(sourceRoot, "index.ts")),
  ...require(path.join(sourceRoot, "runtime-state.ts")),
  ...require(path.join(sourceRoot, "manifest.ts")),
  ...require(path.join(sourceRoot, "grading.ts")),
  webApplicationTemplate: require(path.join(sourceRoot, "templates/registry.ts")).webApplicationTemplate,
};
