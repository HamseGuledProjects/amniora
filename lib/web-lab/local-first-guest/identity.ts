import { execFile } from "node:child_process";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalPublicKey } from "../byo-runner/protocol";
import { GuestChannelError, publicKeyFingerprint, type PairingAccept } from "./protocol";
import type { DesktopGuestTrust } from "./pairing";

const execFileAsync = promisify(execFile);

export type SigningIdentity = Readonly<{
  id: string;
  publicKey: string;
  sign(bytes: Buffer): Promise<string>;
}>;

export type GuestIdentity = SigningIdentity & Readonly<{
  certificate: string;
  certificatePath: string;
  privateKeyPath: string;
}>;

export type GuestPairingRecord = Readonly<{
  schemaVersion: 1;
  desktopId: string;
  desktopPublicKey: string;
  guestPublicKeyFingerprint: string;
  pairedAt: number;
}>;

export class InMemorySigningIdentity implements SigningIdentity {
  readonly publicKey: string;
  readonly id: string;
  private readonly privateKey: KeyObject;

  constructor(prefix: "ins" | "gst" = "ins") {
    const pair = generateKeyPairSync("ed25519");
    this.privateKey = pair.privateKey;
    this.publicKey = canonicalPublicKey(pair.publicKey);
    this.id = `${prefix}_${Buffer.from(publicKeyFingerprint(this.publicKey), "hex").toString("base64url")}`;
  }

  async sign(bytes: Buffer): Promise<string> {
    return sign(null, bytes, this.privateKey).toString("base64url");
  }
}

async function requirePrivateFile(file: string): Promise<void> {
  const details = await stat(file);
  if (!details.isFile() || details.isSymbolicLink() || (process.platform !== "win32" && (details.mode & 0o077) !== 0)) {
    throw new GuestChannelError("INTERNAL_ERROR");
  }
}

/** The runtime uses the key internally. Diagnostics and APIs expose only its public fingerprint. */
export class DiskGuestIdentityStore {
  private readonly privateKeyPath: string;
  private readonly publicKeyPath: string;
  private readonly certificatePath: string;
  private readonly pairingPath: string;

  constructor(
    private readonly stateDirectory: string,
    private readonly bindAddress: string,
    private readonly opensslPath = "/usr/bin/openssl",
  ) {
    this.privateKeyPath = path.join(stateDirectory, "guest-ed25519-private.pem");
    this.publicKeyPath = path.join(stateDirectory, "guest-ed25519-public.pem");
    this.certificatePath = path.join(stateDirectory, "guest-tls-certificate.pem");
    this.pairingPath = path.join(stateDirectory, "desktop-pairing.json");
  }

  async loadOrCreate(): Promise<GuestIdentity> {
    await mkdir(this.stateDirectory, { recursive: true, mode: 0o700 });
    try {
      await requirePrivateFile(this.privateKeyPath);
      const [publicKey, certificate] = await Promise.all([
        readFile(this.publicKeyPath, "utf8"), readFile(this.certificatePath, "utf8"),
      ]);
      return this.identity(publicKey, certificate);
    } catch (error) {
      if (error instanceof GuestChannelError) throw error;
    }

    const pair = generateKeyPairSync("ed25519");
    const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicPem = canonicalPublicKey(pair.publicKey);
    const privateTemporary = `${this.privateKeyPath}.${process.pid}.tmp`;
    const publicTemporary = `${this.publicKeyPath}.${process.pid}.tmp`;
    const certificateTemporary = `${this.certificatePath}.${process.pid}.tmp`;
    await writeFile(privateTemporary, privatePem, { mode: 0o600, flag: "wx" });
    await writeFile(publicTemporary, publicPem, { mode: 0o600, flag: "wx" });
    try {
      await execFileAsync(this.opensslPath, ["req", "-x509", "-new", "-key", privateTemporary,
        "-out", certificateTemporary, "-days", "3650", "-subj", "/CN=amniora-guest",
        "-addext", `subjectAltName=IP:${this.bindAddress}`], { timeout: 10_000, maxBuffer: 16_384 });
      await chmod(certificateTemporary, 0o600);
      await rename(privateTemporary, this.privateKeyPath);
      await rename(publicTemporary, this.publicKeyPath);
      await rename(certificateTemporary, this.certificatePath);
    } catch {
      throw new GuestChannelError("INTERNAL_ERROR");
    }
    return this.identity(publicPem, await readFile(this.certificatePath, "utf8"));
  }

  private async identity(publicKey: string, certificate: string): Promise<GuestIdentity> {
    const privateKeyPath = this.privateKeyPath;
    return Object.freeze({
      id: `gst_${Buffer.from(publicKeyFingerprint(publicKey), "hex").toString("base64url")}`,
      publicKey,
      certificate,
      certificatePath: this.certificatePath,
      privateKeyPath,
      sign: async (bytes: Buffer) => {
        await requirePrivateFile(privateKeyPath);
        const key = await readFile(privateKeyPath);
        return sign(null, bytes, key).toString("base64url");
      },
    });
  }

  async savePairing(accept: PairingAccept, guestPublicKey: string): Promise<GuestPairingRecord> {
    const record: GuestPairingRecord = Object.freeze({ schemaVersion: 1, desktopId: accept.desktopPublicKey
      ? `ins_${Buffer.from(publicKeyFingerprint(accept.desktopPublicKey), "hex").toString("base64url")}` : "",
    desktopPublicKey: accept.desktopPublicKey, guestPublicKeyFingerprint: publicKeyFingerprint(guestPublicKey), pairedAt: accept.pairedAt });
    const temporary = `${this.pairingPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, this.pairingPath);
    return record;
  }

  async loadPairing(): Promise<GuestPairingRecord> {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.pairingPath, "utf8")); } catch { throw new GuestChannelError("PEER_NOT_PAIRED"); }
    const input = value as Partial<GuestPairingRecord>;
    if (input.schemaVersion !== 1 || typeof input.desktopId !== "string" || typeof input.desktopPublicKey !== "string" ||
        typeof input.guestPublicKeyFingerprint !== "string" || typeof input.pairedAt !== "number") {
      throw new GuestChannelError("PEER_NOT_PAIRED");
    }
    return input as GuestPairingRecord;
  }
}

export class DesktopGuestTrustStore {
  constructor(private readonly file: string) {}

  async save(value: DesktopGuestTrust): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, this.file);
  }

  async load(): Promise<DesktopGuestTrust> {
    let value: unknown;
    try { value = JSON.parse(await readFile(this.file, "utf8")); } catch { throw new GuestChannelError("PEER_NOT_PAIRED"); }
    const item = value as Partial<DesktopGuestTrust>;
    if (item.schemaVersion !== 1 || typeof item.guestId !== "string" || typeof item.guestPublicKey !== "string" ||
        typeof item.guestCertificate !== "string" || typeof item.guestCertificateFingerprint !== "string" ||
        typeof item.desktopId !== "string" || typeof item.pairedAt !== "number") throw new GuestChannelError("PEER_NOT_PAIRED");
    return item as DesktopGuestTrust;
  }
}
