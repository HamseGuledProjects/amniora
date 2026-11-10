// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
function runtimeHtml(compiledHtml, storedField) {
  if (!compiledHtml.includes("connect-src 'none'") ||
      !compiledHtml.includes('id="web-lab-data"') ||
      !compiledHtml.includes('id="reset"') ||
      !compiledHtml.includes("sessionStorage.getItem(storageKey)") ||
      !compiledHtml.includes("sessionStorage.setItem(storageKey") ||
      !compiledHtml.includes("sessionStorage.removeItem(storageKey)")) {
    throw new Error("Unsupported compiled Web lab runtime bundle");
  }
  const shim = [
    "<script>",
    "const runtimeStorage = {",
    "  getItem() {",
    "    const request = new XMLHttpRequest();",
    "    request.open('GET', '__runtime/state', false);",
    "    request.send();",
    "    if (request.status !== 200) throw new Error('Runtime state unavailable');",
    "    return request.responseText;",
    "  },",
    "  setItem(_key, value) {",
    "    const request = new XMLHttpRequest();",
    "    request.open('PUT', '__runtime/state', false);",
    "    request.setRequestHeader('Content-Type', 'application/json');",
    "    request.setRequestHeader('X-Web-Lab-Field', " + JSON.stringify(storedField) + ");",
    "    request.setRequestHeader('X-Web-Lab-Route', (location.hash.slice(1).split('?')[0] || '/'));",
    "    request.send(value);",
    "    if (request.status !== 204) throw new Error('Runtime submission rejected');",
    "  },",
    "  removeItem() { throw new Error('Use trusted runtime reset'); }",
    "};",
    "</script>",
  ].join("\n");
  return compiledHtml
    .replace("connect-src 'none'", "connect-src 'self'")
    .replace('id="reset"', 'id="reset" disabled title="Use the trusted runtime manager to reset"')
    .replace('<script id="web-lab-data"', shim + '<script id="web-lab-data"')
    .replaceAll("sessionStorage.getItem(storageKey)", "runtimeStorage.getItem(storageKey)")
    .replaceAll("sessionStorage.setItem(storageKey", "runtimeStorage.setItem(storageKey")
    .replaceAll("sessionStorage.removeItem(storageKey)", "runtimeStorage.removeItem(storageKey)");
}

module.exports = { runtimeHtml };
