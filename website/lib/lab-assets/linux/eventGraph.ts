import type { LinuxAssetInput } from "./types";
import { incidentClock, incidentEventOffsets } from "./investigation";
import { homeDirectoryFor, identityFor } from "./noise";

export type LinuxIncidentEventGraph = {
  eventIds: {
    auth: string;
    command: string;
    file: string;
    service: string;
  };
  auth: {
    timestamp: string;
    method: "password" | "publickey";
    pid: number;
    user: string;
    uid: number;
    sourceIp: string;
    port: number;
    tty: string;
    sessionId: number;
  };
  command: {
    timestamp: string;
    pid: number;
    ppid: number;
    sudoPid: number;
    shellPid: number;
    user: string;
    uid: number;
    gid: number;
    cwd: string;
    tty: string;
    command: string;
  };
  file: {
    timestamp: string;
    pid: number;
    path: string;
  };
  service: {
    timestamp: string;
    pid: number;
    service: string;
  };
  processes: {
    sshdMonitor: CanonicalProcessNode;
    sshdSession: CanonicalProcessNode;
    shell: CanonicalProcessNode;
    sudo: CanonicalProcessNode;
    command: CanonicalProcessNode;
    serviceEffect?: CanonicalProcessNode;
  };
  close: {
    timestamp: string;
    pid: number;
    user: string;
  };
};

export type CanonicalProcessNode = {
  pid: number;
  ppid: number;
  executable: string;
  argv: string[];
  user: string;
  uid: number;
  gid: number;
  cwd: string;
  tty?: string;
  sessionId?: number;
  startTime: string;
  openFiles: string[];
};

function commandExecutable(command: string) {
  const first = command.trim().split(/\s+/)[0] || "sh";
  if (first.includes("/")) return first;
  const usrBin = new Set(["journalctl", "grep", "stat", "systemctl", "apt", "dpkg", "docker", "cat", "truncate", "logrotate", "rsync", "tar"]);
  return `${usrBin.has(first) ? "/usr/bin" : "/bin"}/${first}`;
}

function commandFiles(command: string, fallbackPath: string) {
  const paths = command.match(/\/(?:etc|var|usr|srv|home|tmp|opt|run|dev)\/[A-Za-z0-9._/@:+-]+/g) || [];
  return Array.from(new Set(paths.length > 0 ? paths : [fallbackPath]));
}

export function buildIncidentEventGraph(context: LinuxAssetInput): LinuxIncidentEventGraph {
  const { incident, investigation } = context;
  const account = identityFor(context, incident.primaryUser);
  const uid = account?.uid || 1000;
  const gid = account?.gid || uid;
  const interactiveSsh = !["reverse_shell", "docker_compromise"].includes(incident.id);
  const diversityOffsets = context.simulation?.diversityProfile?.timelineOffsets;
  const legacyOffsets = incidentEventOffsets(
    `${context.world.caseId}:${incident.id}:${context.world.host}`
  );
  const offsets = diversityOffsets || {
    ...legacyOffsets,
    commands: [legacyOffsets.command],
  };
  const authOffset = offsets.auth;
  const sshdPid = interactiveSsh ? 2136 : 2058;
  const shellPid = interactiveSsh ? 2201 : incident.id === "reverse_shell" ? 1217 : 2221;
  const sudoPid = interactiveSsh ? 2203 : incident.id === "reverse_shell" ? 1218 : 2222;
  const pid = interactiveSsh ? 2204 : incident.id === "reverse_shell" ? 2204 : 2223;
  const ppid = sudoPid;
  const commandUser = ["ssh_bruteforce", "ssh_key_compromise"].includes(incident.id)
    ? context.world.analystUser
    : incident.primaryUser;
  const commandAccount = identityFor(context, commandUser);
  const commandUid = commandAccount?.uid || uid;
  const commandGid = commandAccount?.gid || commandUid;

  const command = investigation.suspiciousCommands[0];
  const executable = commandExecutable(command);
  const commandOffset = offsets.commands[0];
  const commandTimestamp = incidentClock(investigation, commandOffset);
  const cwd = homeDirectoryFor(context, commandUser);
  const tty = context.simulation?.diversityProfile?.tty || (interactiveSsh ? "pts/2" : "notty");
  const filePath = investigation.modifiedFiles[0];

  return {
    eventIds: {
      auth: `${context.world.caseId}:ssh-auth`,
      command: `${context.world.caseId}:sudo-command`,
      file: `${context.world.caseId}:file-touch`,
      service: `${context.world.caseId}:service-state`,
    },
    auth: {
      timestamp: incidentClock(investigation, authOffset),
      method: incident.id === "ssh_bruteforce" ? "password" : "publickey",
      pid: sshdPid,
      user: interactiveSsh ? incident.primaryUser : context.world.analystUser,
      uid: interactiveSsh ? uid : identityFor(context, context.world.analystUser)?.uid || 1000,
      sourceIp: interactiveSsh ? incident.suspiciousIp : context.world.adminIp,
      port: interactiveSsh ? 51891 : 51400,
      tty,
      sessionId: interactiveSsh ? 88 : 14,
    },
    command: {
      timestamp: commandTimestamp,
      pid,
      ppid,
      sudoPid,
      shellPid,
      user: commandUser,
      uid: commandUid,
      gid: commandGid,
      cwd,
      tty,
      command,
    },
    file: {
      timestamp: incidentClock(investigation, offsets.file),
      pid,
      path: filePath,
    },
    service: {
      timestamp: incidentClock(investigation, offsets.service),
      pid: pid + 9,
      service:
        incident.id === "unauthorized_package_install"
          ? "manual-package-transaction"
          : incident.affectedService,
    },
    processes: {
      sshdMonitor: {
        pid: 812,
        ppid: 1,
        executable: "/usr/sbin/sshd",
        argv: ["/usr/sbin/sshd", "-D"],
        user: "root",
        uid: 0,
        gid: 0,
        cwd: "/",
        startTime: "boot",
        openFiles: ["/var/log/auth.log"],
      },
      sshdSession: {
        pid: sshdPid,
        ppid: 812,
        executable: "/usr/sbin/sshd",
        argv: ["sshd:", commandUser],
        user: commandUser,
        uid: commandUid,
        gid: commandGid,
        cwd,
        tty,
        sessionId: interactiveSsh ? 88 : 14,
        startTime: incidentClock(investigation, authOffset),
        openFiles: ["/var/log/auth.log"],
      },
      shell: {
        pid: shellPid,
        ppid: incident.id === "reverse_shell" ? 1216 : sshdPid,
        executable: "/bin/bash",
        argv: ["/bin/bash"],
        user: commandUser,
        uid: commandUid,
        gid: commandGid,
        cwd,
        tty,
        sessionId: interactiveSsh ? 88 : 14,
        startTime: incidentClock(investigation, authOffset + 1),
        openFiles: [cwd],
      },
      sudo: {
        pid: sudoPid,
        ppid: shellPid,
        executable: "/usr/bin/sudo",
        argv: ["sudo", ...command.split(/\s+/)],
        user: commandUser,
        uid: commandUid,
        gid: commandGid,
        cwd,
        tty,
        sessionId: interactiveSsh ? 88 : 14,
        startTime: commandTimestamp,
        openFiles: ["/etc/sudoers", "/etc/sudoers.d/platform"],
      },
      command: {
        pid,
        ppid,
        executable,
        argv: command.split(/\s+/),
        user: commandUser,
        uid: commandUid,
        gid: commandGid,
        cwd,
        tty,
        sessionId: interactiveSsh ? 88 : 14,
        startTime: commandTimestamp,
        openFiles: commandFiles(command, filePath),
      },
      serviceEffect: {
        pid: pid + 9,
        ppid: 1,
        executable: "/sbin/init",
        argv: ["systemd", incident.affectedService],
        user: "root",
        uid: 0,
        gid: 0,
        cwd: "/",
        startTime: incidentClock(investigation, offsets.service),
        openFiles: [incident.affectedService],
      },
    },
    close: {
      timestamp: incidentClock(investigation, offsets.close),
      pid: sshdPid,
      user: interactiveSsh ? incident.primaryUser : context.world.analystUser,
    },
  };
}
