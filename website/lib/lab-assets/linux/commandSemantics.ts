export type LinuxCommandKind =
  | "shell"
  | "cat"
  | "cp"
  | "mv"
  | "rm"
  | "chmod"
  | "chown"
  | "grep"
  | "find"
  | "tar"
  | "curl"
  | "wget"
  | "ssh"
  | "scp"
  | "sudo"
  | "su"
  | "systemctl"
  | "journalctl"
  | "docker_run"
  | "docker_exec"
  | "docker_inspect"
  | "docker_cp"
  | "docker_ps"
  | "apt_install"
  | "apt_remove"
  | "useradd"
  | "usermod"
  | "cron_execution"
  | "script_execution"
  | "custom";

export type LinuxContainerMount = {
  id: string;
  kind: "bind" | "volume" | "tmpfs" | "overlay" | "network" | "device";
  sourcePath?: string;
  destinationPath: string;
  readOnly: boolean;
};

export type ParsedLinuxCommand = {
  kind: LinuxCommandKind;
  executable: string;
  argv: string[];
  image?: {
    reference: string;
    registry?: string;
    repository: string;
    tag?: string;
    digest?: string;
  };
  containerName?: string;
  mounts?: LinuxContainerMount[];
  detached?: boolean;
  removeOnExit?: boolean;
  target?: string;
  targets?: string[];
  action?: string;
  unit?: string;
  issues: string[];
};

export type LinuxShellResolutionContext = {
  invokingHomeDirectory: string;
  workingDirectory: string;
};

export type ResolvedLinuxCommand = {
  rawCommand: string;
  shellExpandedArgv: string[];
  canonicalExecutable: string;
  renderedCommand: string;
  canonicalArgumentPaths: string[];
  issues: string[];
};

const ABSOLUTE_EXECUTABLES = new Set([
  "cat",
  "cp",
  "mv",
  "rm",
  "chmod",
  "chown",
  "grep",
  "find",
  "tar",
  "curl",
  "wget",
  "ssh",
  "scp",
  "rsync",
  "sudo",
  "su",
  "systemctl",
  "journalctl",
  "docker",
  "apt",
  "apt-cache",
  "dpkg",
  "useradd",
  "usermod",
  "ls",
  "stat",
  "truncate",
  "logrotate",
]);

export function splitShellCommand(command: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if ((char === "'" || char === "\"") && (!quote || quote === char)) {
      quote = quote ? undefined : char;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return { tokens, closed: !quote };
}

function normalizeExecutable(token: string) {
  const base = token.split("/").pop() || token;
  if (token.includes("/")) return token;
  if (ABSOLUTE_EXECUTABLES.has(base)) return `${base === "sudo" || base === "su" ? "/usr/bin" : base === "docker" ? "/usr/bin" : "/usr/bin"}/${base}`;
  return `/bin/${base}`;
}

function normalizePath(path: string) {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}` || (absolute ? "/" : ".");
}

function looksPathLike(token: string) {
  return token.startsWith("/") || token.startsWith("./") || token.startsWith("../") || token === "." || token === ".." || token.startsWith("~");
}

function resolvePathToken(token: string, context: LinuxShellResolutionContext) {
  if (token === "~") return context.invokingHomeDirectory;
  if (token.startsWith("~/")) return normalizePath(`${context.invokingHomeDirectory}/${token.slice(2)}`);
  if (token.startsWith("/")) return normalizePath(token);
  if (token === "." || token === ".." || token.startsWith("./") || token.startsWith("../")) {
    return normalizePath(`${context.workingDirectory}/${token}`);
  }
  return token;
}

export function resolveLinuxShellCommand(command: string, context: LinuxShellResolutionContext): ResolvedLinuxCommand {
  const { tokens, closed } = splitShellCommand(command.trim());
  const issues: string[] = [];
  if (!closed) issues.push("command has unterminated quote");
  const shellExpandedArgv = tokens.map((token, index) => {
    if (index === 0) return token;
    return looksPathLike(token) ? resolvePathToken(token, context) : token;
  });
  const canonicalExecutable = normalizeExecutable(shellExpandedArgv[0] || "sh");
  const renderedCommand = [canonicalExecutable, ...shellExpandedArgv.slice(1)].join(" ");
  const canonicalArgumentPaths = shellExpandedArgv.slice(1).filter(looksPathLike).map((token) => resolvePathToken(token, context));
  return {
    rawCommand: command,
    shellExpandedArgv,
    canonicalExecutable,
    renderedCommand,
    canonicalArgumentPaths: Array.from(new Set(canonicalArgumentPaths)),
    issues,
  };
}

function parseImage(reference: string) {
  const [withoutDigest, digest] = reference.split("@");
  const lastSlash = withoutDigest.lastIndexOf("/");
  const imageName = lastSlash === -1 ? withoutDigest : withoutDigest.slice(lastSlash + 1);
  const registry = lastSlash === -1 ? undefined : withoutDigest.slice(0, lastSlash).split("/")[0];
  const tagSeparator = imageName.lastIndexOf(":");
  const repository = tagSeparator === -1 ? imageName : imageName.slice(0, tagSeparator);
  const tag = tagSeparator === -1 ? undefined : imageName.slice(tagSeparator + 1);
  return { reference, registry, repository, tag, digest };
}

export function parseDockerMount(value: string): LinuxContainerMount | undefined {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const [sourcePath, destinationPath, mode] = parts;
  if (!sourcePath || !destinationPath || !destinationPath.startsWith("/")) return undefined;
  return {
    id: `mount:${sourcePath}->${destinationPath}`.replace(/[^a-z0-9:/._>-]+/gi, "-"),
    kind: sourcePath.startsWith("/") ? "bind" : "volume",
    sourcePath: sourcePath.startsWith("/") ? sourcePath : undefined,
    destinationPath,
    readOnly: mode === "ro",
  };
}

export function parseLinuxCommand(command: string): ParsedLinuxCommand {
  const { tokens, closed } = splitShellCommand(command.trim());
  const issues: string[] = [];
  if (!closed) issues.push("command has unterminated quote");
  const executable = normalizeExecutable(tokens[0] || "sh");
  const base = executable.split("/").pop() || executable;
  const parsed: ParsedLinuxCommand = { kind: "custom", executable, argv: tokens, issues };

  if (base === "docker") {
    const subcommand = tokens[1];
    if (subcommand === "run") {
      parsed.kind = "docker_run";
      parsed.mounts = [];
      parsed.detached = false;
      parsed.removeOnExit = false;
      for (let index = 2; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === "-d" || token === "--detach") {
          parsed.detached = true;
          continue;
        }
        if (token === "--rm") {
          parsed.removeOnExit = true;
          continue;
        }
        if ((token === "--name" || token === "--hostname") && tokens[index + 1]) {
          if (token === "--name") parsed.containerName = tokens[index + 1];
          index += 1;
          continue;
        }
        if ((token === "-v" || token === "--volume") && tokens[index + 1]) {
          const mount = parseDockerMount(tokens[index + 1]);
          if (!mount) issues.push(`malformed docker mount ${tokens[index + 1]}`);
          else parsed.mounts.push(mount);
          index += 1;
          continue;
        }
        if (token.startsWith("-")) {
          if (["-p", "--publish", "-e", "--env", "--network", "--user"].includes(token) && tokens[index + 1]) index += 1;
          continue;
        }
        parsed.image = parseImage(token);
        break;
      }
      if (!parsed.image) issues.push("docker run missing image reference");
    } else if (subcommand === "inspect") {
      parsed.kind = "docker_inspect";
      parsed.target = tokens[2];
      if (!parsed.target) issues.push("docker inspect missing target");
    } else if (subcommand === "ps") {
      parsed.kind = "docker_ps";
    } else if (subcommand === "exec") {
      parsed.kind = "docker_exec";
      parsed.target = tokens.find((token, index) => index > 1 && !token.startsWith("-"));
      if (!parsed.target) issues.push("docker exec missing container target");
    } else if (subcommand === "cp") {
      parsed.kind = "docker_cp";
      parsed.targets = tokens.slice(2);
      if (parsed.targets.length < 2) issues.push("docker cp requires source and destination");
    }
    return parsed;
  }

  if (base === "cat") {
    parsed.kind = "cat";
    parsed.targets = tokens.slice(1).filter((token) => !token.startsWith("-"));
    if (parsed.targets.length === 0) issues.push("cat requires at least one target");
  } else if (base === "systemctl") {
    parsed.kind = "systemctl";
    parsed.action = tokens[1];
    parsed.unit = tokens.slice(2).find((token) => !token.startsWith("-"));
    if (!parsed.action) issues.push("systemctl missing action");
    if (parsed.action && !["daemon-reload", "status", "start", "stop", "restart", "reload", "enable", "disable"].includes(parsed.action)) {
      issues.push(`unsupported systemctl action ${parsed.action}`);
    }
    if (parsed.action && parsed.action !== "daemon-reload" && !parsed.unit) issues.push("systemctl action requires unit");
  } else if (base === "journalctl") {
    parsed.kind = "journalctl";
    const unitIndex = tokens.findIndex((token) => token === "-u" || token === "--unit");
    parsed.unit = unitIndex !== -1 ? tokens[unitIndex + 1] : undefined;
  } else if (base === "cp" || base === "mv") {
    parsed.kind = base;
    parsed.targets = tokens.slice(1).filter((token) => !token.startsWith("-"));
    if (parsed.targets.length < 2) issues.push(`${base} requires source and destination`);
  } else if (base === "chmod" || base === "chown") {
    parsed.kind = base;
    parsed.targets = tokens.slice(1).filter((token) => !token.startsWith("-"));
    if (parsed.targets.length < 2) issues.push(`${base} requires mode/owner and target`);
  } else if (base === "apt" && tokens[1] === "install") {
    parsed.kind = "apt_install";
    parsed.targets = tokens.slice(2).filter((token) => !token.startsWith("-"));
    if (parsed.targets.length === 0) issues.push("apt install requires package");
  } else if (base === "apt" && tokens[1] === "remove") {
    parsed.kind = "apt_remove";
    parsed.targets = tokens.slice(2).filter((token) => !token.startsWith("-"));
    if (parsed.targets.length === 0) issues.push("apt remove requires package");
  } else if (["grep", "find", "tar", "curl", "wget", "ssh", "scp", "sudo", "su", "rm", "useradd", "usermod"].includes(base)) {
    parsed.kind = base as LinuxCommandKind;
  } else if (base === "bash" || base === "sh") {
    parsed.kind = "shell";
  }
  return parsed;
}

export function serializeLinuxCommand(command: ParsedLinuxCommand) {
  return command.argv.join(" ");
}

export function semanticCommandEquivalent(left: ParsedLinuxCommand, right: ParsedLinuxCommand) {
  return left.kind === right.kind &&
    left.executable === right.executable &&
    serializeLinuxCommand(left) === serializeLinuxCommand(right) &&
    (left.image?.reference || "") === (right.image?.reference || "") &&
    (left.containerName || "") === (right.containerName || "");
}
