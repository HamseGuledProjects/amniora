"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const sourceRoot = path.resolve(__dirname, "../lib");
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Only included source may be loaded");
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};
