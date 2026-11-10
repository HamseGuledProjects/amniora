import type { CanonicalCommand, LinuxSimulationWorld } from "./simulation";
import { parseOpenSshPublicKeyLine } from "./cryptographicEvidence";
import {
  resolveCanonicalCommandSudoPolicy,
  resolveSudoPolicy,
  sudoCommandText,
} from "./sudoPolicy";
import { parseLinuxCsvLine } from "./csv";

export type LinuxSemanticCheck = {
  code: string;
  status: "pass" | "fail";
  message: string;
};

export type LinuxSemanticIssue = {
  code: string;
  severity: "critical" | "high";
  message: string;
  artifactPath?: string;
};

export type LinuxIdentitySshSudoSemanticReport = {
  status: "valid" | "invalid";
  identityChecks: LinuxSemanticCheck[];
  artifactScopeChecks: LinuxSemanticCheck[];
  sshKeyChecks: LinuxSemanticCheck[];
  sshAuthenticationChecks: LinuxSemanticCheck[];
  sshSessionChecks: LinuxSemanticCheck[];
  shellResolutionChecks: LinuxSemanticCheck[];
  sudoPolicyChecks: LinuxSemanticCheck[];
  sudoExecutionChecks: LinuxSemanticCheck[];
  issues: LinuxSemanticIssue[];
};

type RenderedAsset = { file_path: string; content: string };

function addCheck(
  report: LinuxIdentitySshSudoSemanticReport,
  bucket: Exclude<keyof LinuxIdentitySshSudoSemanticReport, "status" | "issues">,
  code: string,
  passed: boolean,
  message: string,
  artifactPath?: string
) {
  report[bucket].push({ code, status: passed ? "pass" : "fail", message });
  if (!passed) report.issues.push({ code, severity: "critical", message, artifactPath });
}

function assetText(assets: RenderedAsset[], path: string) {
  return assets.find((asset) => asset.file_path === path)?.content || "";
}

function allText(assets: RenderedAsset[]) {
  return assets.map((asset) => `${asset.file_path}\n${asset.content}`).join("\n");
}

function rowsByHeader(content: string) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const header = parseLinuxCsvLine(lines[0] || "").values;
  return lines.slice(1).map((line) => {
    const row = parseLinuxCsvLine(line).values;
    return Object.fromEntries(header.map((name, index) => [name, row[index] || ""]));
  });
}

function renderedGroups(assets: RenderedAsset[]) {
  const groups = new Map<string, Set<string>>();
  for (const row of rowsByHeader(assetText(assets, "assets/csv/groups.csv"))) {
    const group = row.group;
    if (!group) continue;
    groups.set(group, new Set((row.members || "").split(",").map((item) => item.trim()).filter(Boolean)));
  }
  const sample = assetText(assets, "assets/accounts/group.sample");
  for (const line of sample.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [group, , , members = ""] = line.split(":");
    if (!group) continue;
    if (!groups.has(group)) groups.set(group, new Set());
    members.split(",").map((item) => item.trim()).filter(Boolean).forEach((member) => groups.get(group)?.add(member));
  }
  return groups;
}

function renderedSudoPolicy(assets: RenderedAsset[]) {
  return assets
    .filter((asset) => /(?:^|\/)sudoers(?:\.d\/|$)|\/sudoers\.d\/|linux_config_pack\.txt$/i.test(asset.file_path))
    .map((asset) => asset.content)
    .join("\n");
}

function renderedUsers(assets: RenderedAsset[]) {
  const users = new Map<string, Record<string, string>>();
  for (const row of rowsByHeader(assetText(assets, "assets/csv/users.csv"))) {
    if (row.username) users.set(row.username, row);
  }
  for (const line of assetText(assets, "assets/accounts/passwd.sample").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [username, , uid, gid, , home, shell] = line.split(":");
    if (!username || !uid) continue;
    users.set(username, { ...(users.get(username) || {}), username, uid, gid, home_directory: home, shell });
  }
  return users;
}

function commandContainsAffectedPath(command: CanonicalCommand, path: string) {
  return command.renderedCommand.includes(path) || command.argv.includes(path);
}

export function buildLinuxIdentitySshSudoSemanticReport(args: {
  simulation: LinuxSimulationWorld;
  finalAssets?: RenderedAsset[];
}): LinuxIdentitySshSudoSemanticReport {
  const { simulation } = args;
  const finalAssets = args.finalAssets || [];
  const report: LinuxIdentitySshSudoSemanticReport = {
    status: "valid",
    identityChecks: [],
    artifactScopeChecks: [],
    sshKeyChecks: [],
    sshAuthenticationChecks: [],
    sshSessionChecks: [],
    shellResolutionChecks: [],
    sudoPolicyChecks: [],
    sudoExecutionChecks: [],
    issues: [],
  };
  const rendered = allText(finalAssets);
  const identitiesById = new Map(simulation.identities.map((identity) => [identity.id, identity]));
  const groupsById = new Map(simulation.groups.map((group) => [group.id, group]));
  const usernames = new Set<string>();
  const uids = new Set<number>();
  const groupNames = new Set<string>();
  const gids = new Set<number>();

  for (const identity of simulation.identities) {
    addCheck(report, "identityChecks", "LINUX_IDENTITY_DUPLICATE_USERNAME", !usernames.has(identity.username), `username ${identity.username} is unique`);
    usernames.add(identity.username);
    addCheck(report, "identityChecks", "LINUX_IDENTITY_DUPLICATE_UID", !uids.has(identity.uid), `uid ${identity.uid} is unique`);
    uids.add(identity.uid);
    addCheck(report, "identityChecks", "LINUX_IDENTITY_GROUP_INCONSISTENT", groupsById.has(identity.primaryGroupId), `${identity.username} primary group exists`);
  }
  for (const group of simulation.groups) {
    addCheck(report, "identityChecks", "LINUX_IDENTITY_GROUP_INCONSISTENT", !groupNames.has(group.name), `group ${group.name} is unique`);
    groupNames.add(group.name);
    addCheck(report, "identityChecks", "LINUX_IDENTITY_GROUP_INCONSISTENT", !gids.has(group.gid), `gid ${group.gid} is unique`);
    gids.add(group.gid);
  }

  const renderedUserRows = renderedUsers(finalAssets);
  for (const identity of simulation.identities) {
    const renderedUser = renderedUserRows.get(identity.username);
    if (!renderedUser) continue;
    addCheck(report, "identityChecks", "LINUX_IDENTITY_ARTIFACT_CONTRADICTION", String(identity.uid) === renderedUser.uid, `${identity.username} UID agrees with rendered inventory`);
    addCheck(report, "identityChecks", "LINUX_IDENTITY_ARTIFACT_CONTRADICTION", String(identity.gid) === renderedUser.gid, `${identity.username} GID agrees with rendered inventory`);
  }

  for (const asset of finalAssets.filter((item) => /passwd\.sample|group\.sample|users\.csv|groups\.csv/i.test(item.file_path))) {
    const scoped =
      /users\.csv|groups\.csv/i.test(asset.file_path) ||
      asset.content.split(/\r?\n/).filter(line => line.trimStart().startsWith("#"))
        .some(line => /\b(?:scope|partial|complete|snapshot|inventory)\b/i.test(line));
    addCheck(report, "artifactScopeChecks", "LINUX_IDENTITY_PARTIAL_SCOPE_UNDECLARED", scoped, `${asset.file_path} declares or structurally implies inventory scope`, asset.file_path);
  }

  const renderedFingerprints = new Set<string>();
  for (const asset of finalAssets.filter((item) => /authorized_keys|known_hosts|host_.*key/i.test(item.file_path))) {
    for (const line of asset.content.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const keyPart = asset.file_path.includes("known_hosts") ? line.replace(/^\S+\s+/, "") : line;
      const parsed = parseOpenSshPublicKeyLine(keyPart);
      addCheck(report, "sshKeyChecks", "LINUX_SSH_KEY_INVALID", Boolean(parsed), `${asset.file_path} contains valid OpenSSH public key material`, asset.file_path);
      if (parsed) {
        renderedFingerprints.add(parsed.fingerprintSha256);
        const recordedFingerprint = keyPart.match(/SHA256:[A-Za-z0-9+/=:-]+/)?.[0];
        addCheck(
          report,
          "sshKeyChecks",
          "LINUX_SSH_KEY_FINGERPRINT_MISMATCH",
          !recordedFingerprint || recordedFingerprint === parsed.fingerprintSha256,
          `${asset.file_path} recorded fingerprint matches public key blob`,
          asset.file_path
        );
      }
    }
  }

  const sessionsById = new Map(simulation.sshSessions.map((session) => [session.id, session]));
  const connectionTuples = new Set<string>();
  for (const origin of simulation.authenticationOrigins) {
    const session = sessionsById.get(origin.sessionId);
    addCheck(report, "sshAuthenticationChecks", "LINUX_SSH_AUTH_SESSION_MISMATCH", Boolean(session), `${origin.id} references an SSH session`);
    if (!session) continue;
    addCheck(report, "sshAuthenticationChecks", "LINUX_SSH_AUTH_SESSION_MISMATCH", origin.identityId === session.identityId, `${origin.id} identity agrees with session`);
    addCheck(report, "sshAuthenticationChecks", "LINUX_SSH_CONNECTION_INCONSISTENT", origin.sourceIp === session.sourceIp && origin.sourcePort === session.sourcePort && origin.destinationPort === session.destinationPort, `${origin.id} connection tuple agrees with session`);
    addCheck(report, "sshAuthenticationChecks", "LINUX_SSH_AUTH_CHRONOLOGY_INVALID", origin.authenticatedAt <= session.openedAt && (!session.closedAt || session.openedAt < session.closedAt), `${origin.id} authentication precedes session lifecycle`);
    if (origin.keyFingerprint) {
      addCheck(report, "sshAuthenticationChecks", "LINUX_SSH_KEY_ATTRIBUTION_MISSING", rendered.includes(origin.keyFingerprint) || renderedFingerprints.has(origin.keyFingerprint), `${origin.id} key fingerprint is rendered`);
    }
  }
  for (const session of simulation.sshSessions) {
    const identity = identitiesById.get(session.identityId);
    const tuple = `${session.sourceIp}:${session.sourcePort}->${session.destinationPort}`;
    addCheck(report, "sshSessionChecks", "LINUX_SSH_SESSION_IDENTITY_MISMATCH", Boolean(identity) && session.username === identity?.username && session.uid === identity?.uid && session.gid === identity?.gid, `${session.id} identity projection agrees`);
    addCheck(report, "sshSessionChecks", "LINUX_SSH_CONNECTION_INCONSISTENT", !connectionTuples.has(tuple), `${session.id} has unique SSH connection tuple`);
    connectionTuples.add(tuple);
  }

  for (const command of simulation.commands) {
    addCheck(report, "shellResolutionChecks", "LINUX_SHELL_PATH_RESOLUTION_INVALID", !/~(?:\/|$)/.test(command.renderedCommand) && !command.argv.some((arg) => /~(?:\/|$)/.test(arg)), `${command.id} has shell-expanded command telemetry`);
    for (const fileId of command.affectedFileIds || []) {
      const file = simulation.files.find((item) => item.id === fileId);
      if (file?.path.includes("/.ssh/authorized_keys") && /authorized_keys/.test(command.renderedCommand)) {
        addCheck(report, "shellResolutionChecks", "LINUX_SHELL_HOME_EXPANSION_MISMATCH", commandContainsAffectedPath(command, file.path), `${command.id} references the canonical authorized_keys path ${file.path}`);
      }
    }
  }

  const groups = renderedGroups(finalAssets);
  const sudoText = renderedSudoPolicy(finalAssets);
  for (const command of simulation.commands.filter((item) => item.expectedRenderTargets.includes("sudo"))) {
    const actor = identitiesById.get(command.actorIdentityId);
    const target = identitiesById.get(command.runAsIdentityId || "identity:root");
    addCheck(report, "sudoExecutionChecks", "LINUX_SUDO_IDENTITY_MISMATCH", Boolean(actor && target), `${command.id} sudo identities exist`);
    if (!actor || !target) continue;
    const decision = resolveCanonicalCommandSudoPolicy({
      simulation,
      sudoPolicyText: sudoText,
      command,
      groups: groups.get(actor.username) || new Set(),
    });
    addCheck(report, "sudoPolicyChecks", "LINUX_SUDO_RULE_NOT_APPLICABLE", decision.authorized, `${command.id} has an applicable sudo rule`);
    addCheck(report, "sudoExecutionChecks", "LINUX_SUDO_AUTHORIZATION_MISMATCH", decision.status === "permitted_nopasswd", `${command.id} successful sudo matches NOPASSWD policy`);
    const telemetryCommand = sudoCommandText(command);
    addCheck(report, "sudoExecutionChecks", "LINUX_SUDO_TELEMETRY_INCONSISTENT", !/~(?:\/|$)/.test(telemetryCommand), `${command.id} sudo telemetry is shell-expanded`);
    for (const asset of finalAssets.filter((item) => item.file_path === "assets/logs/sudo.log" || item.file_path === "assets/logs/auth.log")) {
      for (const line of asset.content.split(/\r?\n/)) {
        if (!/authentication failure/i.test(line) || !line.includes(telemetryCommand)) continue;
        const failureDecision = resolveSudoPolicy({
          sudoPolicyText: sudoText,
          username: actor.username,
          targetUser: target.username,
          commandText: telemetryCommand,
          groups: groups.get(actor.username) || new Set(),
        });
        addCheck(report, "sudoExecutionChecks", "LINUX_SUDO_AUTHORIZATION_MISMATCH", failureDecision.status !== "permitted_nopasswd", `${asset.file_path} does not render auth failure for NOPASSWD ${telemetryCommand}`, asset.file_path);
      }
    }
  }

  report.status = report.issues.length === 0 ? "valid" : "invalid";
  return report;
}
