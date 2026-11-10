import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  BYO_RUNNER_AUDIENCE,
  BYO_RUNNER_ENROLLMENT_TTL_MS,
  ByoRunnerError,
  validOwnerId,
  validToken,
  type EnrollmentCapability,
} from "./protocol";

type EnrollmentRecord = Readonly<{
  digest: Buffer;
  ownerId: string;
  audience: typeof BYO_RUNNER_AUDIENCE;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
}>;

export interface ByoRunnerEnrollmentRepository {
  issue(ownerId: string): EnrollmentCapability | Promise<EnrollmentCapability>;
  consume(token: unknown, ownerId: unknown, audience: unknown):
    Readonly<{ ownerId: string; consumedAt: number }> |
    Promise<Readonly<{ ownerId: string; consumedAt: number }>>;
}

function digest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Process-local test/development adapter. Production composition must register a durable store. */
export class ByoRunnerEnrollmentStore implements ByoRunnerEnrollmentRepository {
  private readonly records: EnrollmentRecord[] = [];

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = BYO_RUNNER_ENROLLMENT_TTL_MS,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > BYO_RUNNER_ENROLLMENT_TTL_MS) {
      throw new Error("invalid_byo_enrollment_ttl");
    }
  }

  issue(ownerId: string): EnrollmentCapability {
    if (!validOwnerId(ownerId)) throw new ByoRunnerError("OWNER_MISMATCH");
    this.sweep();
    const issuedAt = this.now();
    const token = randomBytes(32).toString("base64url");
    this.records.push({
      digest: digest(token),
      ownerId,
      audience: BYO_RUNNER_AUDIENCE,
      issuedAt,
      expiresAt: issuedAt + this.ttlMs,
      consumedAt: null,
    });
    return { token, ownerId, audience: BYO_RUNNER_AUDIENCE, expiresAt: issuedAt + this.ttlMs };
  }

  consume(token: unknown, ownerId: unknown, audience: unknown): Readonly<{ ownerId: string; consumedAt: number }> {
    if (!validToken(token)) throw new ByoRunnerError("ENROLLMENT_INVALID");
    const candidate = digest(token);
    const index = this.records.findIndex(record => sameDigest(record.digest, candidate));
    if (index === -1) throw new ByoRunnerError("ENROLLMENT_INVALID");
    const record = this.records[index];
    if (record.consumedAt !== null) throw new ByoRunnerError("ENROLLMENT_REPLAYED");
    if (this.now() >= record.expiresAt) throw new ByoRunnerError("ENROLLMENT_EXPIRED");
    if (audience !== record.audience) throw new ByoRunnerError("AUDIENCE_MISMATCH");
    if (ownerId !== record.ownerId) throw new ByoRunnerError("OWNER_MISMATCH");
    const consumedAt = this.now();
    this.records[index] = { ...record, consumedAt };
    return { ownerId: record.ownerId, consumedAt };
  }

  private sweep(): void {
    const retentionBoundary = this.now() - Math.max(this.ttlMs * 2, 60_000);
    for (let index = this.records.length - 1; index >= 0; index--) {
      if (this.records[index].expiresAt < retentionBoundary) this.records.splice(index, 1);
    }
  }
}
