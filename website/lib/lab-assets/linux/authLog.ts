import type { LinuxAssetBuilder } from "./types";
import { renderBackgroundAuthLines } from "./backgroundActivity";
import { incidentTimestamp, sortLogLines } from "./investigation";
import { canonicalIdentity, renderCommandInvocation } from "./simulation";

export const buildAuthLog: LinuxAssetBuilder = ({
  input,
  world,
  incident,
  investigation: investigationContext,
  simulation,
  intermediate,
  advanced,
  testOverrides,
}) => {
  const context = { input, world, incident, investigation: investigationContext, simulation, intermediate, advanced, testOverrides };
  const background = renderBackgroundAuthLines(simulation, world.host);

  let investigationLines = "";
  const sessionLines = simulation.sshSessions.filter((session) => session.purpose === "incident").map((session) => `
${session.openedAt} ${world.host} sshd[${session.sessionPid}]: Accepted ${session.authenticationMethod} for ${session.username} from ${session.sourceIp} port ${session.sourcePort} ssh2${session.keyFingerprint ? ` fingerprint ${session.keyFingerprint}` : ""}
${session.openedAt} ${world.host} sshd[${session.sessionPid}]: pam_unix(sshd:session): session opened for user ${session.username}(uid=${session.uid})
${session.closedAt && session.closedAt <= simulation.collection.windowEnd ? `${session.closedAt} ${world.host} sshd[${session.sessionPid}]: pam_unix(sshd:session): session closed for user ${session.username}` : ""}
`).join("\n");
  const sudoAuthLines = simulation.commands
    .filter((command) => command.expectedRenderTargets.includes("auth"))
    .map((command) => {
      const actor = canonicalIdentity(simulation, command.actorIdentityId);
      return `${command.timestamp} ${world.host} sudo: ${actor.username} : TTY=${command.tty || "notty"} ; PWD=${command.cwd} ; USER=root ; COMMAND=${renderCommandInvocation(command)}`;
    })
    .join("\n");

  if (incident.id === "ssh_bruteforce") {
    investigationLines = `
${incidentTimestamp(investigationContext, 11)} ${world.host} sshd[2042]: Failed password for invalid user admin from ${incident.suspiciousIp} port 51222 ssh2
${incidentTimestamp(investigationContext, 17)} ${world.host} sshd[2045]: Failed password for invalid user test from ${incident.suspiciousIp} port 51228 ssh2
${incidentTimestamp(investigationContext, 22)} ${world.host} sshd[2049]: Failed password for invalid user oracle from ${incident.suspiciousIp} port 51233 ssh2
${incidentTimestamp(investigationContext, 29)} ${world.host} sshd[2052]: Failed password for invalid user postgres from ${incident.suspiciousIp} port 51239 ssh2
${incidentTimestamp(investigationContext, 36)} ${world.host} sshd[2055]: Failed password for root from ${incident.suspiciousIp} port 51245 ssh2
${sessionLines}
${sudoAuthLines}
`;
  }

  if (incident.id === "misconfigured_sudoers") {
    investigationLines = `
${sessionLines}
${sudoAuthLines}
`;
  }

  if (incident.id === "service_account_misuse") {
    investigationLines = `
${incidentTimestamp(investigationContext, 1)} ${world.host} sshd[2132]: Failed publickey for ${incident.primaryUser} from ${incident.suspiciousIp} port 51880 ssh2
${incidentTimestamp(investigationContext, 9)} ${world.host} sshd[2132]: Failed publickey for ${incident.primaryUser} from ${incident.suspiciousIp} port 51880 ssh2
${sessionLines}
${sudoAuthLines}
`;
  }

  if (incident.id === "reverse_shell" || incident.id === "docker_compromise") {
    investigationLines = `
${sessionLines}
${sudoAuthLines}
`;
  }

  if (!investigationLines) {
    investigationLines = `
${sessionLines}
${sudoAuthLines}
${incidentTimestamp(investigationContext, 55)} ${world.host} systemd-logind[866]: Session 88 logged out. Waiting for processes to exit.
`;
  }

  return {
    file_name: "auth.log",
    file_type: "log",
    file_path: "assets/logs/auth.log",
    content: `${sortLogLines(`${background}\n${investigationLines.trim()}`)}\n`,
  };
};
