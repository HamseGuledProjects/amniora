import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BYO_RUNNER_AUDIENCE,
  BYO_RUNNER_PROTOCOL_VERSION,
  ByoRunnerError,
  canonicalPublicKey,
  hasExactKeys,
  isPlainObject,
  requireEd25519PublicKey,
  validOwnerId,
  validRunnerId,
  type BrokerRunnerIdentity,
  type RunnerIdentity,
} from "./protocol";

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const detail = await lstat(directory);
  if (!detail.isDirectory() || detail.isSymbolicLink()) throw new Error("unsafe_byo_runner_state_directory");
  await chmod(directory, 0o700);
}

async function atomicWrite(directory: string, target: string, value: unknown): Promise<void> {
  await ensurePrivateDirectory(directory);
  const temporary = path.join(directory, `state-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
  await chmod(target, 0o600);
}

function validBrokerIdentity(value: unknown): value is BrokerRunnerIdentity {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    "runnerId", "ownerId", "audience", "protocolVersion", "publicKey", "createdAt", "lastSeenAt",
  ])) return false;
  if (!validRunnerId(value.runnerId) || !validOwnerId(value.ownerId) || value.audience !== BYO_RUNNER_AUDIENCE ||
      value.protocolVersion !== BYO_RUNNER_PROTOCOL_VERSION || !Number.isSafeInteger(value.createdAt) ||
      !Number.isSafeInteger(value.lastSeenAt)) return false;
  try { return canonicalPublicKey(requireEd25519PublicKey(value.publicKey)) === value.publicKey; }
  catch { return false; }
}

function validRunnerIdentity(value: unknown): value is RunnerIdentity {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    "stateVersion", "runnerId", "ownerId", "audience", "protocolVersion", "publicKey", "privateKey", "enrolledAt",
  ])) return false;
  if (value.stateVersion !== 1 || !validRunnerId(value.runnerId) || !validOwnerId(value.ownerId) ||
      value.audience !== BYO_RUNNER_AUDIENCE || value.protocolVersion !== BYO_RUNNER_PROTOCOL_VERSION ||
      typeof value.privateKey !== "string" || value.privateKey.length < 100 || value.privateKey.length > 512 ||
      !Number.isSafeInteger(value.enrolledAt)) return false;
  try { return canonicalPublicKey(requireEd25519PublicKey(value.publicKey)) === value.publicKey; }
  catch { return false; }
}

type BrokerState = Readonly<{ stateVersion: 1; runners: readonly BrokerRunnerIdentity[] }>;

export class ByoBrokerIdentityStore {
  readonly statePath: string;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(readonly directory: string) {
    this.statePath = path.join(directory, "broker-identities.json");
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try { return await operation(); } finally { release(); }
  }

  private async readState(): Promise<BrokerState> {
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(this.statePath, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { stateVersion: 1, runners: [] };
      throw error;
    }
    if (!isPlainObject(parsed) || !hasExactKeys(parsed, ["stateVersion", "runners"]) || parsed.stateVersion !== 1 ||
        !Array.isArray(parsed.runners) || parsed.runners.some(identity => !validBrokerIdentity(identity))) {
      throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
    }
    return parsed as unknown as BrokerState;
  }

  async get(runnerId: string): Promise<BrokerRunnerIdentity | null> {
    return (await this.readState()).runners.find(identity => identity.runnerId === runnerId) ?? null;
  }

  async create(identity: BrokerRunnerIdentity): Promise<void> {
    if (!validBrokerIdentity(identity)) throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
    await this.exclusive(async () => {
      const state = await this.readState();
      if (state.runners.some(candidate => candidate.runnerId === identity.runnerId)) {
        throw new ByoRunnerError("RUNNER_IDENTITY_CONFLICT");
      }
      await atomicWrite(this.directory, this.statePath, { stateVersion: 1, runners: [...state.runners, identity] });
    });
  }

  async touch(runnerId: string, lastSeenAt: number): Promise<void> {
    await this.exclusive(async () => {
      const state = await this.readState();
      const index = state.runners.findIndex(identity => identity.runnerId === runnerId);
      if (index === -1) throw new ByoRunnerError("RUNNER_IDENTITY_NOT_FOUND");
      const runners = [...state.runners];
      runners[index] = { ...runners[index], lastSeenAt };
      await atomicWrite(this.directory, this.statePath, { stateVersion: 1, runners });
    });
  }
}

export class ByoRunnerIdentityStore {
  readonly statePath: string;

  constructor(readonly directory: string) {
    this.statePath = path.join(directory, "runner-identity.json");
  }

  async read(): Promise<RunnerIdentity | null> {
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(this.statePath, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!validRunnerIdentity(parsed)) throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
    return parsed;
  }

  async write(identity: RunnerIdentity): Promise<void> {
    if (!validRunnerIdentity(identity)) throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
    await atomicWrite(this.directory, this.statePath, identity);
  }

  async remove(): Promise<void> {
    await rm(this.statePath, { force: true });
  }
}
