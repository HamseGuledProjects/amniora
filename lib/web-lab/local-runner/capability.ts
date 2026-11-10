import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  LOCAL_RUNNER_CAPABILITY_TTL_MS,
  LocalRunnerError,
  type RunnerCapabilityResponse,
  type RunnerCapabilityScope,
} from "./protocol";

type CapabilityRecord = Readonly<{
  digest: Buffer;
  scope: RunnerCapabilityScope;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
}>;

function digest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export class LocalRunnerCapabilityStore {
  private readonly records: CapabilityRecord[] = [];

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = LOCAL_RUNNER_CAPABILITY_TTL_MS,
  ) {}

  issue(scope: RunnerCapabilityScope): RunnerCapabilityResponse {
    this.sweep();
    const issuedAt = this.now();
    const token = randomBytes(32).toString("base64url");
    this.records.push({ digest: digest(token), scope: structuredClone(scope), issuedAt, expiresAt: issuedAt + this.ttlMs, consumedAt: null });
    return { capability: token, operation: scope.operation, expiresAt: issuedAt + this.ttlMs };
  }

  consume(token: unknown, operation: RunnerCapabilityScope["operation"]): RunnerCapabilityScope {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new LocalRunnerError("CAPABILITY_INVALID");
    const candidate = digest(token);
    const index = this.records.findIndex(record => sameDigest(record.digest, candidate));
    if (index === -1) throw new LocalRunnerError("CAPABILITY_INVALID");
    const record = this.records[index];
    if (record.consumedAt !== null) throw new LocalRunnerError("CAPABILITY_REPLAYED");
    if (this.now() >= record.expiresAt) throw new LocalRunnerError("CAPABILITY_EXPIRED");
    if (record.scope.operation !== operation) throw new LocalRunnerError("CAPABILITY_INVALID");
    this.records[index] = { ...record, consumedAt: this.now() };
    return structuredClone(record.scope);
  }

  private sweep(): void {
    const retentionBoundary = this.now() - Math.max(this.ttlMs * 2, 60_000);
    for (let index = this.records.length - 1; index >= 0; index--) {
      if (this.records[index].expiresAt < retentionBoundary) this.records.splice(index, 1);
    }
  }
}
