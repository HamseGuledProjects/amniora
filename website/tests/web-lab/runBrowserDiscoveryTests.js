#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS test. */
const assert = require("node:assert/strict");
const { browserCandidates, resolveBrowserExecutable } = require("./browserDiscovery");

assert.equal(resolveBrowserExecutable({ override: process.execPath }), process.execPath);
assert.throws(
  () => resolveBrowserExecutable({ override: "/definitely/missing/web-lab-browser" }),
  /WEB_LAB_BROWSER_PATH is not an executable file/,
);

const windows = browserCandidates("win32");
assert.deepEqual(windows, [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
]);
assert.equal(resolveBrowserExecutable({
  platform: "win32", override: undefined, executable: candidate => windows.includes(candidate),
}), windows[0]);

const mac = browserCandidates("darwin");
assert.deepEqual(mac, [
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]);
assert.equal(resolveBrowserExecutable({
  platform: "darwin", override: undefined, executable: candidate => mac.includes(candidate),
}), mac[0]);

assert.throws(
  () => resolveBrowserExecutable({ platform: "darwin", override: undefined, executable: () => false }),
  /No supported Chromium-family browser executable found.*WEB_LAB_BROWSER_PATH/,
);
console.log("Web lab browser discovery: 7 assertions passed");
