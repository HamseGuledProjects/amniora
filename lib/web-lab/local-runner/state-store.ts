import { mkdir, readFile, rename, rm, writeFile, chmod, lstat } from "node:fs/promises";
import path from "node:path";
import type { LocalRunnerPackage } from "./package";
import type { RunnerErrorCode, RunnerLifecycleState } from "./protocol";

export type PersistedLocalRunnerState = Readonly<{
  stateVersion: 1;
  state: RunnerLifecycleState;
  sessionId: string | null;
  buildId: string | null;
  buildFingerprint: string | null;
  generation: number | null;
  endpoint: string | null;
  createdAt: number | null;
  expiresAt: number | null;
  acceptedPackage: LocalRunnerPackage | null;
  launchIdempotencyKey: string | null;
  lastReset: Readonly<{ idempotencyKey: string; fromGeneration: number; toGeneration: number }> | null;
  lastStopIdempotencyKey: string | null;
  errorCode: RunnerErrorCode | null;
}>;

export const EMPTY_LOCAL_RUNNER_STATE: PersistedLocalRunnerState = {
  stateVersion: 1,
  state: "idle",
  sessionId: null,
  buildId: null,
  buildFingerprint: null,
  generation: null,
  endpoint: null,
  createdAt: null,
  expiresAt: null,
  acceptedPackage: null,
  launchIdempotencyKey: null,
  lastReset: null,
  lastStopIdempotencyKey: null,
  errorCode: null,
};

export class LocalRunnerStateStore {
  readonly statePath: string;

  constructor(readonly directory: string) {
    this.statePath = path.join(directory, "state.json");
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const detail = await lstat(this.directory);
    if (!detail.isDirectory() || detail.isSymbolicLink()) throw new Error("unsafe_local_runner_state_directory");
    await chmod(this.directory, 0o700);
  }

  async read(): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(this.statePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write(state: PersistedLocalRunnerState): Promise<void> {
    await this.ensureDirectory();
    const temporary = path.join(this.directory, `state-${process.pid}-${Date.now()}.tmp`);
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    await rename(temporary, this.statePath);
    await chmod(this.statePath, 0o600);
  }

  async remove(): Promise<void> {
    await rm(this.statePath, { force: true });
  }
}
