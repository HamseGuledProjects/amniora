import type { LabAsset } from "../types";
import { parseLinuxCsvLine } from "./csv";

export function linuxArithmeticRun(values: number[], minimumEqualDeltas = 3) {
  let previousDelta: number | undefined;
  let equalDeltas = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    equalDeltas = delta === previousDelta ? equalDeltas + 1 : 1;
    if (delta !== 0 && equalDeltas >= minimumEqualDeltas) return true;
    previousDelta = delta;
  }
  return false;
}

export function validateLinuxIdentityRealism(assets: readonly LabAsset[]) {
  const users = assets.find((asset) => asset.file_path === "assets/csv/users.csv");
  if (!users) throw new Error("LINUX_IDENTITY_REALISM: missing users inventory");
  const lines = users.content.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  const header = parseLinuxCsvLine(lines.shift() || "").values;
  const rows = lines.map((line) => parseLinuxCsvLine(line).values);
  for (const field of ["uid", "gid"] as const) {
    const column = header.indexOf(field);
    if (column < 0) throw new Error(`LINUX_IDENTITY_REALISM: missing ${field}`);
    // System-reserved IDs can be consecutive on real Linux installations.
    // Enterprise provisioning, not /etc/passwd's distribution, is the target.
    const values = [...new Set(rows.map((row) => Number(row[column])).filter((id) => id >= 1000))];
    if (linuxArithmeticRun(values) || linuxArithmeticRun([...values].sort((a, b) => a - b))) {
      throw new Error(`LINUX_IDENTITY_ARITHMETIC: ${field} contains a provisioning stride`);
    }
  }
  const loginColumn = header.indexOf("last_login");
  const timestamps = rows.map((row) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row[loginColumn] || "")
    ? Date.parse(`${row[loginColumn].replace(" ", "T")}:00Z`) : NaN);
  for (let index = 3; index < timestamps.length; index += 1) {
    const deltas = [0, 1, 2].map((offset) => timestamps[index - offset] - timestamps[index - offset - 1]);
    if (deltas.every((delta) => delta === 60000) || deltas.every((delta) => delta === -60000)) {
      throw new Error("LINUX_IDENTITY_LOGIN_SEQUENCE: minute-by-minute last-login block");
    }
  }
}
