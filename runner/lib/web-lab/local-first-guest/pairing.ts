import { createHash, randomBytes, timingSafeEqual, X509Certificate } from "node:crypto";
import { canonicalPublicKey } from "../byo-runner/protocol";
import type { GuestIdentity, SigningIdentity } from "./identity";
import {
  GUEST_CHANNEL_AUDIENCE,
  GUEST_PAIRING_TTL_MS,
  GUEST_PROTOCOL_VERSION,
  GuestChannelError,
  certificateFingerprint,
  pairingAcceptProofBytes,
  pairingProofBytes,
  publicKeyFingerprint,
  validPairingAccept,
  validPairingRequest,
  validPairingSecret,
  verifyGuestProof,
  type PairingAccept,
  type PairingRequest,
} from "./protocol";

export type PairingOffer = Readonly<{
  pairingId: string;
  secret: string;
  desktopNonce: string;
  expiresAt: number;
}>;

export type DesktopGuestTrust = Readonly<{
  schemaVersion: 1;
  guestId: string;
  guestPublicKey: string;
  guestCertificate: string;
  guestCertificateFingerprint: string;
  desktopId: string;
  pairedAt: number;
}>;

export function encodePairingCode(offer: PairingOffer): string {
  return `amn1.${Buffer.from(JSON.stringify({ p: offer.pairingId, s: offer.secret, n: offer.desktopNonce,
    e: offer.expiresAt }), "utf8").toString("base64url")}`;
}

export function decodePairingCode(value: string): PairingOffer {
  if (!/^amn1\.[A-Za-z0-9_-]{120,480}$/.test(value)) throw new GuestChannelError("PAIRING_INVALID");
  let input: unknown;
  try { input = JSON.parse(Buffer.from(value.slice(5), "base64url").toString("utf8")); }
  catch { throw new GuestChannelError("PAIRING_INVALID"); }
  const item = input as Record<string, unknown>;
  if (!item || Object.keys(item).sort().join(",") !== "e,n,p,s" || typeof item.p !== "string" ||
      !/^pair_[A-Za-z0-9_-]{43}$/.test(item.p) || !validPairingSecret(item.s) || typeof item.n !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(item.n) || !Number.isSafeInteger(item.e)) throw new GuestChannelError("PAIRING_INVALID");
  return Object.freeze({ pairingId: item.p, secret: item.s, desktopNonce: item.n, expiresAt: item.e as number });
}

type PendingPairing = {
  pairingId: string;
  secretDigest: Buffer;
  desktopNonce: string;
  expiresAt: number;
  state: "pending" | "consumed";
};

function opaque(prefix = ""): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function desktopId(identity: SigningIdentity): string {
  return `ins_${Buffer.from(publicKeyFingerprint(identity.publicKey), "hex").toString("base64url")}`;
}

export class DesktopPairingAuthority {
  private readonly pending = new Map<string, PendingPairing>();
  private readonly consumed = new Set<string>();

  constructor(
    private readonly identity: SigningIdentity,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = GUEST_PAIRING_TTL_MS,
  ) {}

  begin(): PairingOffer {
    const secret = opaque();
    const value: PendingPairing = {
      pairingId: opaque("pair_"),
      secretDigest: digest(secret),
      desktopNonce: opaque(),
      expiresAt: this.now() + this.ttlMs,
      state: "pending",
    };
    this.pending.set(value.pairingId, value);
    return Object.freeze({ pairingId: value.pairingId, secret, desktopNonce: value.desktopNonce, expiresAt: value.expiresAt });
  }

  authenticate(pairingId: string, secret: string): void {
    const value = this.pending.get(pairingId);
    if (!value || !validPairingSecret(secret)) throw new GuestChannelError("PAIRING_INVALID");
    if (value.state !== "pending" || this.consumed.has(pairingId)) throw new GuestChannelError("PAIRING_REPLAYED");
    if (this.now() >= value.expiresAt) {
      value.secretDigest.fill(0);
      this.pending.delete(pairingId);
      throw new GuestChannelError("PAIRING_EXPIRED");
    }
    const candidate = digest(secret);
    const valid = timingSafeEqual(value.secretDigest, candidate);
    candidate.fill(0);
    if (!valid) throw new GuestChannelError("PAIRING_INVALID");
  }

  async complete(request: unknown): Promise<Readonly<{ accept: PairingAccept; trust: DesktopGuestTrust }>> {
    if (!validPairingRequest(request)) throw new GuestChannelError("PAIRING_INVALID");
    const pending = this.pending.get(request.pairingId);
    if (!pending) {
      if (this.consumed.has(request.pairingId)) throw new GuestChannelError("PAIRING_REPLAYED");
      throw new GuestChannelError("PAIRING_INVALID");
    }
    if (pending.state !== "pending") throw new GuestChannelError("PAIRING_REPLAYED");
    if (this.now() >= pending.expiresAt || request.expiresAt !== pending.expiresAt) throw new GuestChannelError("PAIRING_EXPIRED");
    if (request.desktopNonce !== pending.desktopNonce) throw new GuestChannelError("PAIRING_INVALID");
    let certificate: X509Certificate;
    try { certificate = new X509Certificate(request.guestCertificate); } catch { throw new GuestChannelError("PAIRING_INVALID"); }
    if (canonicalPublicKey(certificate.publicKey) !== request.guestPublicKey) throw new GuestChannelError("PAIRING_INVALID");
    const requestBytes = pairingProofBytes({
      protocolVersion: request.protocolVersion,
      audience: request.audience,
      pairingId: request.pairingId,
      expiresAt: request.expiresAt,
      desktopNonce: request.desktopNonce,
      guestNonce: request.guestNonce,
      guestPublicKey: request.guestPublicKey,
      guestCertificateFingerprint: certificateFingerprint(request.guestCertificate),
    });
    if (!verifyGuestProof(request.guestPublicKey, requestBytes, request.proof)) throw new GuestChannelError("PROOF_INVALID");

    const pairedAt = this.now();
    const acceptWithoutProof = {
      protocolVersion: GUEST_PROTOCOL_VERSION,
      audience: GUEST_CHANNEL_AUDIENCE,
      pairingId: request.pairingId,
      desktopNonce: request.desktopNonce,
      guestNonce: request.guestNonce,
      desktopPublicKey: this.identity.publicKey,
      pairedAt,
    } as const;
    const proof = await this.identity.sign(pairingAcceptProofBytes({
      ...acceptWithoutProof,
      guestPublicKeyFingerprint: publicKeyFingerprint(request.guestPublicKey),
    }));
    const accept: PairingAccept = Object.freeze({ type: "PAIR_ACCEPT", ...acceptWithoutProof, proof });
    const trust: DesktopGuestTrust = Object.freeze({
      schemaVersion: 1,
      guestId: `gst_${Buffer.from(publicKeyFingerprint(request.guestPublicKey), "hex").toString("base64url")}`,
      guestPublicKey: request.guestPublicKey,
      guestCertificate: request.guestCertificate,
      guestCertificateFingerprint: certificateFingerprint(request.guestCertificate),
      desktopId: desktopId(this.identity),
      pairedAt,
    });
    pending.state = "consumed";
    pending.secretDigest.fill(0);
    this.pending.delete(request.pairingId);
    this.consumed.add(request.pairingId);
    return Object.freeze({ accept, trust });
  }
}

export async function createGuestPairingRequest(identity: GuestIdentity, offer: Omit<PairingOffer, "secret">): Promise<PairingRequest> {
  const base = {
    protocolVersion: GUEST_PROTOCOL_VERSION,
    audience: GUEST_CHANNEL_AUDIENCE,
    pairingId: offer.pairingId,
    expiresAt: offer.expiresAt,
    desktopNonce: offer.desktopNonce,
    guestNonce: opaque(),
    guestPublicKey: identity.publicKey,
    guestCertificate: identity.certificate,
  } as const;
  const proof = await identity.sign(pairingProofBytes({
    protocolVersion: base.protocolVersion,
    audience: base.audience,
    pairingId: base.pairingId,
    expiresAt: base.expiresAt,
    desktopNonce: base.desktopNonce,
    guestNonce: base.guestNonce,
    guestPublicKey: base.guestPublicKey,
    guestCertificateFingerprint: certificateFingerprint(base.guestCertificate),
  }));
  return Object.freeze({ type: "PAIR_REQUEST", ...base, proof });
}

export function verifyPairingAccept(request: PairingRequest, value: unknown, now = Date.now()): PairingAccept {
  if (!validPairingAccept(value) || value.pairingId !== request.pairingId || value.desktopNonce !== request.desktopNonce ||
      value.guestNonce !== request.guestNonce || value.pairedAt > now + 5_000 || value.pairedAt < now - GUEST_PAIRING_TTL_MS) {
    throw new GuestChannelError("PAIRING_INVALID");
  }
  const bytes = pairingAcceptProofBytes({
    protocolVersion: value.protocolVersion,
    audience: value.audience,
    pairingId: value.pairingId,
    desktopNonce: value.desktopNonce,
    guestNonce: value.guestNonce,
    desktopPublicKey: value.desktopPublicKey,
    pairedAt: value.pairedAt,
    guestPublicKeyFingerprint: publicKeyFingerprint(request.guestPublicKey),
  });
  if (!verifyGuestProof(value.desktopPublicKey, bytes, value.proof)) throw new GuestChannelError("PROOF_INVALID");
  return value;
}
