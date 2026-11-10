// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* Scoped, installed-TypeScript-only loader for the isolated browser fixture. */
/* eslint-disable @typescript-eslint/no-require-imports -- Webpack loader uses the CommonJS loader API. */
const ts = require("typescript");
module.exports = function fixtureTsLoader(source) {
  return ts.transpileModule(source, {
    fileName: this.resourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowJs: true,
    },
  }).outputText;
};
