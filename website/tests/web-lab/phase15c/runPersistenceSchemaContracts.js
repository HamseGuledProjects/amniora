#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped offline TypeScript loader. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { randomUUID } = require("node:crypto");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../..");
const sourceRoot = path.join(root, "lib/web-lab");
const storePath = path.join(sourceRoot, "generated-executable-postgres.ts");
const load = Module._load;
Module._load = function (specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return load.call(this, specifier, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Only scoped Web lab sources may be loaded");
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};

const { PostgresExecutableWebSaveStore } = require(storePath);
let assertions = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }

async function main() {
  const savedLabId = randomUUID();
  const queries = [];
  const jsonParameters = [];
  const textArrayParameters = [];
  const transactionSql = (strings, ...values) => {
    queries.push({ text: strings.join("$parameter"), values });
    return Promise.resolve([{ id: savedLabId }]);
  };
  transactionSql.json = value => {
    const parameter = { databaseType: "jsonb", value };
    jsonParameters.push(parameter);
    return parameter;
  };
  transactionSql.array = value => {
    const parameter = { databaseType: "text[]", value };
    textArrayParameters.push(parameter);
    return parameter;
  };
  const db = { begin: work => work(transactionSql) };
  const store = new PostgresExecutableWebSaveStore(db);
  const lab = {
    user_id: randomUUID(),
    title: "JSONB persistence fixture",
    topic: "Web Security",
    difficulty: "Beginner",
    estimated_time: "30 mins",
    objective: "Preserve the existing Saved Lab representation.",
    scenario: "Offline persistence contract.",
    tasks: [JSON.stringify({ phase: "Explore", title: "Inspect", description: "Observe.", evidence: [], deliverable: "Report." })],
    hints: ["Use the supplied local lab only."],
    outcomes: ["Describe observed behaviour."],
    completed: false,
  };

  const insertedId = await store.transaction(transaction => transaction.insertSavedLab(lab));
  check(insertedId, savedLabId, "insert returns Saved Lab identity");
  check(queries.length, 1, "one public.labs insert issued");
  check(queries[0].text.includes("insert into public.labs"), true, "public.labs is the persistence target");
  check(jsonParameters.length, 3, "tasks, hints and outcomes use typed JSONB parameters");
  check(textArrayParameters.length, 0, "JSONB columns never use PostgreSQL text[] parameters");
  check(jsonParameters.map(parameter => parameter.value), [lab.tasks, lab.hints, lab.outcomes],
    "JSONB parameterization preserves the established learner arrays");
  check(queries[0].values.slice(7, 10), jsonParameters,
    "the three public.labs JSONB columns receive the typed JSON parameters in schema order");
  check(JSON.parse(JSON.stringify(jsonParameters[0].value)), lab.tasks,
    "task strings remain valid JSONB without manual SQL interpolation");

  process.stdout.write(`Phase 15C persistence/schema contracts PASS (${assertions} assertions)\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
