import type { LinuxAssetBuilder } from "./types";
import { sortLogLines } from "./investigation";
import { canonicalIdentity } from "./simulation";
import {
  canonicalSudoLogSuccessLine,
  renderedSudoPolicyText,
  resolveCanonicalCommandSudoPolicy,
  sudoCommandText,
} from "./sudoPolicy";

export const buildSudoLog: LinuxAssetBuilder = ({
  input,
  world,
  incident,
  investigation,
  simulation,
  intermediate,
  advanced,
  testOverrides,
}) => {
  const context = { input, world, incident, investigation, simulation, intermediate, advanced, testOverrides };
  const sudoPolicyText = renderedSudoPolicyText(context);
  const canonicalSudoLines = simulation.commands
    .filter((command) => command.expectedRenderTargets.includes("sudo"))
    .map((command) => {
      const actor = canonicalIdentity(simulation, command.actorIdentityId);
      const target = canonicalIdentity(simulation, command.runAsIdentityId || "identity:root");
      const policy = resolveCanonicalCommandSudoPolicy({
        simulation,
        sudoPolicyText,
        command,
      });
      if (policy.status !== "permitted_nopasswd") {
        throw new Error(
          `Linux sudo evidence generation failed: ${command.id} policy is ${policy.status}, expected permitted_nopasswd.`
        );
      }
      return canonicalSudoLogSuccessLine({
        timestamp: command.timestamp,
        username: actor.username,
        tty: command.tty,
        cwd: command.cwd,
        targetUser: target.username,
        commandText: sudoCommandText(command),
      });
    });
  // Only canonical sudo commands are rendered. Previous filler diagnostics
  // introduced terminal activity with no matching authentication session or
  // process history, making provenance impossible for learners to establish.
  const content = canonicalSudoLines.length > 0
    ? `${canonicalSudoLines.join("\n")}\n`
    : "# No sudo command activity was captured in the investigation window.\n";

  return {
    file_name: "sudo.log",
    file_type: "log",
    file_path: "assets/logs/sudo.log",
    content: sortLogLines(content),
  };
};
