import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  LOCAL_FIRST_AUDIENCE,
  LOCAL_FIRST_PAIRING_TTL_MS,
  LOCAL_FIRST_PROTOCOL_VERSION,
  LocalFirstError,
  hasExactKeys,
  installationIdForPublicKey,
  isPlainObject,
  requireCanonicalRunnerPublicKey,
  validAccountId,
  validInstallationId,
  validOpaqueValue,
} from "./protocol";

const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
const CALLBACK_URI = "com.amniora.runner:/pair";

type PairingRequestRecord = {
  authorizationRequestId: string;
  installationId: string;
  publicKey: string;
  codeChallenge: string;
  state: string;
  createdAt: number;
  expiresAt: number;
  accountId: string | null;
  authorizationCodeDigest: Buffer | null;
  approvedAt: number | null;
  consumedAt: number | null;
  denied: boolean;
};

export type PairedInstallation = Readonly<{
  accountId: string;
  installationId: string;
  publicKey: string;
  pairedAt: number;
  revokedAt: number | null;
}>;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function equal(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function pkceChallenge(codeVerifier: string): string {
  if (!PKCE_VALUE.test(codeVerifier)) throw new LocalFirstError("PKCE_INVALID");
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

/** Disposable Phase 1 native-app authorization model. It has no production state or client secret. */
export class InMemoryPairingService {
  private readonly requests = new Map<string, PairingRequestRecord>();
  private readonly installations = new Map<string, PairedInstallation>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = LOCAL_FIRST_PAIRING_TTL_MS,
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > LOCAL_FIRST_PAIRING_TTL_MS) {
      throw new Error("invalid_local_first_pairing_ttl");
    }
  }

  begin(input: unknown): Readonly<{ authorizationRequestId: string; expiresAt: number }> {
    if (!isPlainObject(input) || !hasExactKeys(input, [
      "protocolVersion", "audience", "installationId", "publicKey", "codeChallenge", "state", "redirectUri",
    ])) throw new LocalFirstError("PAIRING_INVALID");
    if (input.protocolVersion !== LOCAL_FIRST_PROTOCOL_VERSION) throw new LocalFirstError("PROTOCOL_VERSION_UNSUPPORTED");
    if (input.audience !== LOCAL_FIRST_AUDIENCE) throw new LocalFirstError("AUDIENCE_MISMATCH");
    if (!validInstallationId(input.installationId) || typeof input.publicKey !== "string" ||
        installationIdForPublicKey(input.publicKey) !== input.installationId || !PKCE_VALUE.test(String(input.codeChallenge)) ||
        !validOpaqueValue(input.state) || input.redirectUri !== CALLBACK_URI) throw new LocalFirstError("PAIRING_INVALID");
    requireCanonicalRunnerPublicKey(input.publicKey);
    const createdAt = this.now();
    const authorizationRequestId = `par_${randomBytes(32).toString("base64url")}`;
    this.requests.set(authorizationRequestId, {
      authorizationRequestId,
      installationId: input.installationId,
      publicKey: input.publicKey,
      codeChallenge: input.codeChallenge as string,
      state: input.state,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      accountId: null,
      authorizationCodeDigest: null,
      approvedAt: null,
      consumedAt: null,
      denied: false,
    });
    return { authorizationRequestId, expiresAt: createdAt + this.ttlMs };
  }

  approve(input: Readonly<{
    authorizationRequestId: string;
    authenticatedAccountId: string;
    approved: boolean;
  }>): Readonly<{ authorizationCode: string; state: string; redirectUri: typeof CALLBACK_URI }> {
    const record = this.requests.get(input.authorizationRequestId);
    if (!record || !validAccountId(input.authenticatedAccountId)) throw new LocalFirstError("PAIRING_INVALID");
    if (this.now() >= record.expiresAt) throw new LocalFirstError("PAIRING_EXPIRED");
    if (record.approvedAt !== null || record.denied) throw new LocalFirstError("PAIRING_REPLAYED");
    if (!input.approved) {
      record.denied = true;
      throw new LocalFirstError("PAIRING_DENIED");
    }
    const authorizationCode = randomBytes(32).toString("base64url");
    record.accountId = input.authenticatedAccountId;
    record.authorizationCodeDigest = digest(authorizationCode);
    record.approvedAt = this.now();
    return { authorizationCode, state: record.state, redirectUri: CALLBACK_URI };
  }

  complete(input: unknown): PairedInstallation {
    if (!isPlainObject(input) || !hasExactKeys(input, [
      "protocolVersion", "audience", "authorizationRequestId", "authorizationCode", "installationId",
      "codeVerifier", "state", "redirectUri",
    ])) throw new LocalFirstError("PAIRING_INVALID");
    if (input.protocolVersion !== LOCAL_FIRST_PROTOCOL_VERSION) throw new LocalFirstError("PROTOCOL_VERSION_UNSUPPORTED");
    if (input.audience !== LOCAL_FIRST_AUDIENCE) throw new LocalFirstError("AUDIENCE_MISMATCH");
    const record = typeof input.authorizationRequestId === "string" ? this.requests.get(input.authorizationRequestId) : null;
    if (!record || !validOpaqueValue(input.authorizationCode) || !validInstallationId(input.installationId) ||
        !PKCE_VALUE.test(String(input.codeVerifier)) || !validOpaqueValue(input.state) || input.redirectUri !== CALLBACK_URI) {
      throw new LocalFirstError("PAIRING_INVALID");
    }
    if (record.denied) throw new LocalFirstError("PAIRING_DENIED");
    if (record.consumedAt !== null) throw new LocalFirstError("PAIRING_REPLAYED");
    if (this.now() >= record.expiresAt) throw new LocalFirstError("PAIRING_EXPIRED");
    if (!record.accountId || !record.authorizationCodeDigest || record.installationId !== input.installationId ||
        record.state !== input.state || !equal(record.authorizationCodeDigest, digest(input.authorizationCode)) ||
        pkceChallenge(input.codeVerifier as string) !== record.codeChallenge) throw new LocalFirstError("PKCE_INVALID");
    record.consumedAt = this.now();
    const paired: PairedInstallation = Object.freeze({
      accountId: record.accountId,
      installationId: record.installationId,
      publicKey: record.publicKey,
      pairedAt: record.consumedAt,
      revokedAt: null,
    });
    this.installations.set(paired.installationId, paired);
    return paired;
  }

  active(accountId: string, installationId: string): PairedInstallation | null {
    const paired = this.installations.get(installationId);
    return paired && paired.accountId === accountId && paired.revokedAt === null ? paired : null;
  }

  activeForAccount(accountId: string): PairedInstallation | null {
    return [...this.installations.values()].find(item => item.accountId === accountId && item.revokedAt === null) ?? null;
  }

  revoke(accountId: string, installationId: string): void {
    const paired = this.active(accountId, installationId);
    if (!paired) throw new LocalFirstError("PAIRING_REVOKED");
    this.installations.set(installationId, Object.freeze({ ...paired, revokedAt: this.now() }));
  }
}
