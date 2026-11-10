#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped repository-only TypeScript bootstrap. */
/* No global installation or package publication. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const sourceRoot = path.resolve(__dirname, "../lib/web-lab");
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Only Web lab sources may be transpiled");
  const source = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};

require(path.join(sourceRoot, "local-runner/cli.ts")).runLocalRunnerCli().catch(error => {
  process.stderr.write(`${error?.code || error?.message || "INTERNAL_ERROR"}\n`);
  process.exitCode = 1;
});
