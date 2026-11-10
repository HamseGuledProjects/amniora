/** Durable one-use My VM enrollment capabilities. */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type postgres from "postgres";
import type { ByoRunnerEnrollmentRepository } from "./enrollment";
import {
  BYO_RUNNER_AUDIENCE,
  BYO_RUNNER_ENROLLMENT_TTL_MS,
  ByoRunnerError,
  validOwnerId,
  validToken,
  type EnrollmentCapability,
} from "./protocol";

type Sql = ReturnType<typeof postgres>;

function digest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class PostgresByoRunnerEnrollmentStore implements ByoRunnerEnrollmentRepository {
  readonly production = true as const;
  constructor(private readonly db: Sql, private readonly now: () => number = Date.now,
    private readonly ttlMs = BYO_RUNNER_ENROLLMENT_TTL_MS) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > BYO_RUNNER_ENROLLMENT_TTL_MS) {
      throw new Error("invalid_byo_enrollment_ttl");
    }
  }

  async issue(ownerId: string): Promise<EnrollmentCapability> {
    if (!validOwnerId(ownerId)) throw new ByoRunnerError("OWNER_MISMATCH");
    const issuedAt = this.now();
    const expiresAt = issuedAt + this.ttlMs;
    const token = randomBytes(32).toString("base64url");
    try {
      await this.db`
        insert into web_lab_control.runner_enrollment_capabilities (
          token_hash, owner_id, audience, issued_at, expires_at
        ) values (
          ${digest(token)}, ${ownerId}, ${BYO_RUNNER_AUDIENCE},
          ${new Date(issuedAt)}, ${new Date(expiresAt)}
        )
      `;
    } catch { throw new ByoRunnerError("BROKER_NOT_READY"); }
    return { token, ownerId, audience: BYO_RUNNER_AUDIENCE, expiresAt };
  }

  async consume(token: unknown, ownerId: unknown, audience: unknown):
    Promise<Readonly<{ ownerId: string; consumedAt: number }>> {
    if (!validToken(token)) throw new ByoRunnerError("ENROLLMENT_INVALID");
    if (!validOwnerId(ownerId)) throw new ByoRunnerError("OWNER_MISMATCH");
    if (audience !== BYO_RUNNER_AUDIENCE) throw new ByoRunnerError("AUDIENCE_MISMATCH");
    const consumedAt = this.now();
    let updated;
    try {
      updated = await this.db`
        update web_lab_control.runner_enrollment_capabilities
        set consumed_at = ${new Date(consumedAt)}
        where token_hash = ${digest(token)} and owner_id = ${ownerId}
          and audience = ${audience} and consumed_at is null
          and expires_at > ${new Date(consumedAt)}
        returning owner_id
      `;
    } catch { throw new ByoRunnerError("BROKER_NOT_READY"); }
    if (updated.length === 1) return { ownerId: String(updated[0].owner_id), consumedAt };
    let rows;
    try {
      rows = await this.db`
        select owner_id, audience, expires_at, consumed_at
        from web_lab_control.runner_enrollment_capabilities
        where token_hash = ${digest(token)}
      `;
    } catch { throw new ByoRunnerError("BROKER_NOT_READY"); }
    if (!rows.length) throw new ByoRunnerError("ENROLLMENT_INVALID");
    if (rows[0].consumed_at !== null) throw new ByoRunnerError("ENROLLMENT_REPLAYED");
    if (consumedAt >= new Date(rows[0].expires_at).getTime()) throw new ByoRunnerError("ENROLLMENT_EXPIRED");
    if (rows[0].audience !== audience) throw new ByoRunnerError("AUDIENCE_MISMATCH");
    if (rows[0].owner_id !== ownerId) throw new ByoRunnerError("OWNER_MISMATCH");
    throw new ByoRunnerError("ENROLLMENT_INVALID");
  }
}
