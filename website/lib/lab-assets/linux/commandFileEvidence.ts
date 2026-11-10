import { resolveLinuxShellCommand } from "./commandSemantics";
import { parseLinuxCsvLine } from "./csv";

/** Validate native operand paths rather than a whitelist of sample filenames. */
export function linuxReadOperandsHaveEvidence(input: {
  command: string; pid: string; openRows: string[]; history?: string;
}): boolean | undefined {
  const resolved = resolveLinuxShellCommand(input.command, { workingDirectory: "/", invokingHomeDirectory: "/" });
  const executable = resolved.canonicalExecutable.split("/").pop();
  if (executable !== "cat" && executable !== "stat") return undefined;
  const paths = resolved.shellExpandedArgv.slice(1).filter((argument) => argument.startsWith("/"));
  if (!paths.length) return undefined;
  const table = (input.history || "").split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#")).map((line) => parseLinuxCsvLine(line).values);
  const header = table[0] || [];
  const pidColumn = header.indexOf("pid");
  const pathColumn = header.indexOf("path");
  const recordedPaths = pidColumn >= 0 && pathColumn >= 0
    ? table.slice(1).filter((row) => row[pidColumn] === input.pid).map((row) => row[pathColumn]) : [];
  return paths.every((path) => recordedPaths.includes(path) || input.openRows.some((line) => line.trim().endsWith(` ${path}`)));
}
