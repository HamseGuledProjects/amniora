import type { LinuxAssetInput } from "./types";
import {
  canonicalIdentity,
  type CanonicalCommand,
  type LinuxSimulationWorld,
} from "./simulation";

export type CanonicalSudoPolicyStatus =
  | "permitted_nopasswd"
  | "permitted_password_required"
  | "denied";

export type CanonicalSudoPolicyDecision = {
  status: CanonicalSudoPolicyStatus;
  rule?: string;
  commandText: string;
  authorized: boolean;
  requiresPassword: boolean;
  authenticationAttempted: boolean;
  authenticationResult: "not_required" | "required_not_modelled" | "not_authorized";
  commandWouldExecute: boolean;
};

export function sudoCommandText(command: CanonicalCommand) {
  return command.renderedCommand.startsWith("/")
    ? command.renderedCommand
    : [command.executable, ...command.argv.slice(1)].join(" ");
}

function normalizeCommandText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function splitSudoCommandSpecs(specList: string) {
  const specs: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;

  for (const char of specList) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === "'" || char === "\"") && !quote) {
      quote = char;
      current += char;
      continue;
    }
    if (quote === char) {
      quote = null;
      current += char;
      continue;
    }
    if (char === "," && !quote) {
      const trimmed = current.trim();
      if (trimmed) specs.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) specs.push(trimmed);
  return specs;
}

function commandSpecMatches(spec: string, commandText: string) {
  const normalizedSpec = normalizeCommandText(spec);
  const normalizedCommand = normalizeCommandText(commandText);
  if (!normalizedSpec || normalizedSpec === "ALL") return normalizedSpec === "ALL";
  if (!normalizedSpec.startsWith("/")) return false;
  if (normalizedSpec.endsWith(" *")) {
    const prefix = normalizeCommandText(normalizedSpec.slice(0, -2));
    return normalizedCommand === prefix || normalizedCommand.startsWith(`${prefix} `);
  }
  if (normalizedSpec.endsWith("*")) {
    return normalizedCommand.startsWith(normalizeCommandText(normalizedSpec.slice(0, -1)));
  }
  return normalizedCommand === normalizedSpec;
}

function sudoRuleSubjectMatches(ruleSubject: string, username: string, groups: Set<string>) {
  return ruleSubject === username || (ruleSubject.startsWith("%") && groups.has(ruleSubject.slice(1)));
}

function sudoRuleTargetMatches(rule: string, targetUser: string) {
  const target = rule.match(/\(([^)]+)\)/)?.[1] || "root";
  return target === "ALL" || target.split(":")[0] === "ALL" || target.split(":")[0] === targetUser;
}

function ruleCommandSection(rule: string) {
  const nopasswdIndex = rule.indexOf("NOPASSWD:");
  if (nopasswdIndex >= 0) return { mode: "nopasswd" as const, specs: rule.slice(nopasswdIndex + "NOPASSWD:".length) };
  const passwdIndex = rule.indexOf("PASSWD:");
  if (passwdIndex >= 0) return { mode: "password" as const, specs: rule.slice(passwdIndex + "PASSWD:".length) };
  const match = rule.match(/\)\s+(.+)$/);
  return match ? { mode: "password" as const, specs: match[1] } : undefined;
}

export function sudoRuleMatchesInvocation(input: {
  rule: string;
  username: string;
  targetUser: string;
  commandText: string;
  groups?: Set<string>;
}) {
  const trimmed = input.rule.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  const subject = trimmed.split(/\s+/)[0];
  if (!sudoRuleSubjectMatches(subject, input.username, input.groups || new Set())) return false;
  if (!sudoRuleTargetMatches(trimmed, input.targetUser)) return false;
  const commandSection = ruleCommandSection(trimmed);
  if (!commandSection) return false;
  return splitSudoCommandSpecs(commandSection.specs).some((spec) =>
    commandSpecMatches(spec, input.commandText)
  );
}

export function sudoRuleRequiresPassword(rule: string) {
  return !rule.includes("NOPASSWD:");
}

export function canonicalSudoExceptionRules(context: LinuxAssetInput) {
  const { world, incident, investigation, simulation } = context;
  const rules: string[] = [];
  const commandsByActor = new Map<string, string[]>();

  for (const command of simulation.commands.filter((item) => item.expectedRenderTargets.includes("sudo"))) {
    const actor = canonicalIdentity(simulation, command.actorIdentityId).username;
    commandsByActor.set(actor, [...(commandsByActor.get(actor) || []), sudoCommandText(command)]);
  }

  for (const [actor, commands] of commandsByActor) {
    rules.push(`${actor} ALL=(root) NOPASSWD: ${Array.from(new Set(commands)).join(", ")}`);
  }

  if (incident.id === "misconfigured_sudoers") {
    rules.push(`${incident.primaryUser} ALL=(ALL) NOPASSWD: /usr/bin/systemctl *, /usr/bin/cat /etc/shadow`);
  }
  if (incident.id === "service_account_misuse" || incident.id === "data_staging") {
    rules.push(`${incident.primaryUser} ALL=(root) NOPASSWD: /usr/bin/tar *, /usr/bin/rsync *, /usr/bin/stat *`);
  }
  if (incident.id === "cron_persistence") {
    rules.push(`${incident.primaryUser} ALL=(root) NOPASSWD: /usr/bin/cat /etc/cron.d/platform-sync, /usr/bin/stat /etc/cron.d/platform-sync, /usr/bin/grep *`);
  }
  if (incident.id === "systemd_persistence") {
    rules.push(`${incident.primaryUser} ALL=(root) NOPASSWD: /usr/bin/systemctl enable --now metrics-cache.service, /usr/bin/systemctl status metrics-cache.service, /usr/bin/cat /etc/systemd/system/metrics-cache.service`);
  }
  if (incident.id === "reverse_shell" || incident.id === "docker_compromise") {
    const primary = simulation.commands.find((item) => item.expectedRenderTargets.includes("sudo"));
    const actor = primary ? canonicalIdentity(simulation, primary.actorIdentityId).username : incident.primaryUser;
    rules.push(`${actor} ALL=(root) NOPASSWD: ${primary ? sudoCommandText(primary) : investigation.suspiciousCommands[0]}, /usr/bin/stat *`);
  }
  if (incident.id === "ssh_key_compromise") {
    rules.push(`${world.analystUser} ALL=(root) NOPASSWD: /usr/bin/cat /home/${incident.primaryUser}/.ssh/authorized_keys, /usr/bin/stat /home/${incident.primaryUser}/.ssh/authorized_keys`);
  }

  const deduped = Array.from(new Set(rules));
  return deduped.length > 0 ? deduped : ["# No unusual sudo exceptions observed"];
}

export function renderedSudoPolicyText(context: LinuxAssetInput) {
  return canonicalSudoExceptionRules(context).join("\n");
}

export function resolveSudoPolicy(input: {
  sudoPolicyText: string;
  username: string;
  targetUser?: string;
  commandText: string;
  groups?: Set<string>;
}): CanonicalSudoPolicyDecision {
  const targetUser = input.targetUser || "root";
  let decision: CanonicalSudoPolicyDecision | undefined;
  for (const rule of input.sudoPolicyText.split(/\r?\n/)) {
    if (!sudoRuleMatchesInvocation({
      rule,
      username: input.username,
      targetUser,
      commandText: input.commandText,
      groups: input.groups,
    })) continue;

    const requiresPassword = sudoRuleRequiresPassword(rule);
    decision = {
      status: requiresPassword
        ? "permitted_password_required"
        : "permitted_nopasswd",
      rule,
      commandText: normalizeCommandText(input.commandText),
      authorized: true,
      requiresPassword,
      authenticationAttempted: requiresPassword,
      authenticationResult: requiresPassword ? "required_not_modelled" : "not_required",
      commandWouldExecute: !requiresPassword,
    };
  }

  return decision || {
    status: "denied",
    commandText: normalizeCommandText(input.commandText),
    authorized: false,
    requiresPassword: false,
    authenticationAttempted: false,
    authenticationResult: "not_authorized",
    commandWouldExecute: false,
  };
}

export function resolveCanonicalCommandSudoPolicy(input: {
  simulation: LinuxSimulationWorld;
  sudoPolicyText: string;
  command: CanonicalCommand;
  groups?: Set<string>;
}) {
  const actor = canonicalIdentity(input.simulation, input.command.actorIdentityId);
  const target = canonicalIdentity(input.simulation, input.command.runAsIdentityId || "identity:root");

  return resolveSudoPolicy({
    sudoPolicyText: input.sudoPolicyText,
    username: actor.username,
    targetUser: target.username,
    commandText: sudoCommandText(input.command),
    groups: input.groups,
  });
}

export function canonicalSudoLogSuccessLine(input: {
  timestamp: string;
  username: string;
  tty?: string;
  cwd: string;
  targetUser?: string;
  commandText: string;
}) {
  return `${input.timestamp} ${input.username} : TTY=${input.tty || "notty"} ; PWD=${input.cwd} ; USER=${input.targetUser || "root"} ; COMMAND=${input.commandText}`;
}
