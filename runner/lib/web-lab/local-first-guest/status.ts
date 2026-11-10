import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import {
  GUEST_AGENT_VERSION,
  GUEST_PROTOCOL_VERSION,
  GuestChannelError,
  normalizeLinuxArchitecture,
  type DockerStatus,
  type GuestInfo,
  type GuestStatus,
  type SupportedGuestArchitecture,
} from "./protocol";

const execFileAsync = promisify(execFile);
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:[-+][A-Za-z0-9.-]{1,32})?$/;

export interface GuestStatusProvider {
  guestInfo(): Promise<GuestInfo>;
  dockerStatus(): Promise<DockerStatus>;
  status(): Promise<GuestStatus>;
}

function releaseValue(source: string, name: string): string | null {
  const line = source.split("\n").find(value => value.startsWith(`${name}=`));
  if (!line) return null;
  const raw = line.slice(name.length + 1);
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

async function fixedProbe(command: string, args: readonly string[], timeout = 2_000): Promise<string | null> {
  try {
    const result = await execFileAsync(command, [...args], {
      timeout, maxBuffer: 16_384, env: { PATH: "/usr/bin:/bin", NODE_ENV: "production" },
    });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

export class UbuntuGuestStatusProvider implements GuestStatusProvider {
  constructor(
    private readonly releasePath = "/etc/os-release",
    private readonly runtimeArchitecture = os.arch(),
  ) {}

  async guestInfo(): Promise<GuestInfo> {
    let release: string;
    try { release = await readFile(this.releasePath, { encoding: "utf8" }); }
    catch { throw new GuestChannelError("INTERNAL_ERROR"); }
    if (releaseValue(release, "ID") !== "ubuntu" || releaseValue(release, "VERSION_ID") !== "24.04") {
      throw new GuestChannelError("INTERNAL_ERROR");
    }
    return Object.freeze({
      os: "Ubuntu",
      osVersion: "24.04",
      architecture: normalizeLinuxArchitecture(this.runtimeArchitecture),
      agentVersion: GUEST_AGENT_VERSION,
      protocolVersion: GUEST_PROTOCOL_VERSION,
    });
  }

  async dockerStatus(): Promise<DockerStatus> {
    // These are fixed, read-only probes. The service is intentionally not in the docker group in Phase 2.
    const rawVersion = await fixedProbe("/usr/bin/docker", ["--version"]);
    if (rawVersion === null) return Object.freeze({ installed: false, version: null, architecture: null, serviceState: "unavailable" });
    const match = /^Docker version ([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]{1,32})?),/.exec(rawVersion);
    const version = match?.[1] && VERSION.test(match[1]) ? match[1] : null;
    const service = await fixedProbe("/usr/bin/systemctl", ["is-active", "docker.service"]);
    let architecture: SupportedGuestArchitecture | null = null;
    try { architecture = normalizeLinuxArchitecture(this.runtimeArchitecture); } catch { /* Report unsupported separately. */ }
    return Object.freeze({
      installed: true,
      version,
      architecture,
      serviceState: service === "active" ? "ready" : "unavailable",
    });
  }

  async status(): Promise<GuestStatus> {
    const [guest, docker] = await Promise.all([this.guestInfo(), this.dockerStatus()]);
    return Object.freeze({ state: "READY", protocolCompatible: true, guest, docker });
  }
}

export class FixtureGuestStatusProvider implements GuestStatusProvider {
  constructor(
    private readonly info: GuestInfo,
    private readonly docker: DockerStatus,
  ) {}
  async guestInfo(): Promise<GuestInfo> { return this.info; }
  async dockerStatus(): Promise<DockerStatus> { return this.docker; }
  async status(): Promise<GuestStatus> {
    return { state: "READY", protocolCompatible: true, guest: this.info, docker: this.docker };
  }
}
