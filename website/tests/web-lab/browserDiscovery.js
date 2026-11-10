// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS test utility. */
const fs = require("node:fs");

// Keep the original Windows preference; use installed macOS apps in this order.
function browserCandidates(platform) {
  switch (platform) {
    case "win32":
      return [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ];
    case "darwin":
      return [
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      ];
    case "linux":
      return ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge"];
    default:
      return [];
  }
}

function isExecutableFile(candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveBrowserExecutable({
  platform = process.platform,
  override = process.env.WEB_LAB_BROWSER_PATH,
  executable = isExecutableFile,
} = {}) {
  if (override !== undefined) {
    if (override && executable(override)) return override;
    throw new Error(`WEB_LAB_BROWSER_PATH is not an executable file: ${override || "(empty)"}`);
  }
  const found = browserCandidates(platform).find(executable);
  if (found) return found;
  throw new Error(`No supported Chromium-family browser executable found for ${platform}; install a supported browser or set WEB_LAB_BROWSER_PATH to its executable`);
}

module.exports = { browserCandidates, resolveBrowserExecutable };
