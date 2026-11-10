export type LinuxCsvLine = {
  values: string[];
  quoted: boolean;
};

// Permissive parser for CyberLab-generated Linux CSV assets. It preserves the
// existing renderer/validator behavior and is not a strict malformed-CSV gate.
export function parseLinuxCsvLine(line: string): LinuxCsvLine {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return { values, quoted };
}
