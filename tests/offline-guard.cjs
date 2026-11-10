"use strict";
// Tests use synthetic keys, fake Docker and local named pipes only.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const child = require("node:child_process");
const net = require("node:net");
const testRoot = path.resolve(__dirname, "../.tmp");
fs.mkdirSync(testRoot, { recursive: true });
os.tmpdir = () => testRoot;
const fail = () => { throw new Error("External network/process access is disabled in offline tests"); };
for (const name of ["exec", "execFile", "execSync", "execFileSync", "spawn", "spawnSync", "fork"]) child[name] = fail;
for (const module of [require("node:http"), require("node:https")]) { module.request = fail; module.get = fail; }
globalThis.fetch = fail;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const input = Array.isArray(args[0]) ? args[0][0] : args[0];
  const pipe = typeof input === "string" ? input : input?.path;
  if (typeof pipe !== "string" || !(pipe.startsWith("\\\\.\\pipe\\amniora-phase3-") || path.resolve(pipe).startsWith(testRoot + path.sep))) return fail();
  return connect.apply(this, args);
};
const remove = fs.rmSync;
fs.rmSync = (target, options) => {
  if (!path.resolve(target).startsWith(testRoot + path.sep)) throw new Error("Test cleanup escaped its temporary directory");
  return remove(target, options);
};
