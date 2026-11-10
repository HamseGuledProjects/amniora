"use strict";
// Compilation only. The emitted CLI modules are not started by this command.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const temporaryRoot = path.join(root, ".tmp");
fs.mkdirSync(temporaryRoot, { recursive: true });
const output = fs.mkdtempSync(path.join(temporaryRoot, "compiled-shared-"));
execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
  "--project", path.join(root, "tsconfig.json"), "--noEmit", "false", "--outDir", output],
  { cwd: root, stdio: "inherit" });
console.log(`Compiled shared source to ${path.relative(root, output)}. No Runner or guest process was launched.`);
