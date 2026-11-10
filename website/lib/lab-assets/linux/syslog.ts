import type { LinuxAssetBuilder } from "./types";
import { renderBackgroundSyslogLines } from "./backgroundActivity";
import { sortLogLines } from "./investigation";
import { buildIncidentEventGraph } from "./eventGraph";
import { canonicalFile, canonicalIdentity, renderCommandInvocation, simulationBackgroundSyslogLines, simulationServiceSyslogLines } from "./simulation";

export const buildSyslog: LinuxAssetBuilder = ({
  input,
  world,
  incident,
  investigation,
  simulation,
  intermediate,
  advanced,
}) => {
  const graph = buildIncidentEventGraph({ input, world, incident, investigation, simulation, intermediate, advanced });
  const firstCommand = simulation.commands.find((command) => command.kind === "primary_incident") || simulation.commands.find((command) => command.id.startsWith("command:incident:")) || simulation.commands[0];
  const incidentServiceLine = simulationServiceSyslogLines(simulation, world.host);
  const backgroundLines = simulationBackgroundSyslogLines(simulation, world.host);
  const noise = renderBackgroundSyslogLines(simulation, world.host);
  const operationalTails = [
    `rsyslogd: imuxsock lost ${2 + (simulation.diversityProfile.noiseRotation % 5)} messages from pid ${firstCommand.processId} due to rate-limiting`,
    "systemd-journald: runtime journal vacuum completed within configured retention limit",
    "auditd: backlog returned to normal after a short processing delay",
    "logrotate: routine rotation check completed; no forced rotation required",
  ];
  const operationalTail = operationalTails[simulation.diversityProfile.noiseRotation % operationalTails.length];

  const canonicalIncidentLines = simulation.commands
    .filter((command) => command.kind !== "background")
    .flatMap((command) => {
      const actor = canonicalIdentity(simulation, command.actorIdentityId);
      const rendered = renderCommandInvocation(command);
      const execution = simulation.executions.find((item) => item.id === command.executionId);
      if (execution?.processPolicy === "no_child_process" && execution.exitCode === 127) {
        return [`${command.timestamp} ${world.host} audit[${command.shellProcessId || command.processId}]: ${rendered}: command not found (exit 127); attempted by ${actor.username}; no child process was created`];
      }
      const file = command.affectedFileIds[0] ? canonicalFile(simulation, command.affectedFileIds[0]) : undefined;
      return [
        `${command.timestamp} ${world.host} audit[${command.processId}]: ${rendered}`,
        file
          ? `${file.modifiedAt} ${world.host} kernel: audit: path="${file.path}" user="${actor.username}"`
          : "",
      ].filter(Boolean);
    })
    .join("\n");

const investigationLines = `
${canonicalIncidentLines}
${incidentServiceLine}
${backgroundLines}
${simulation.collection.windowEnd} ${world.host} ${operationalTail}
`;

  return {
    file_name: "syslog",
    file_type: "log",
    file_path: "assets/logs/syslog",
    content: `${sortLogLines(`${noise}\n${investigationLines}`)}\n`,
  };
};
