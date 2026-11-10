import { canonicalPublicKey } from "../byo-runner/protocol";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { installationIdForPublicKey } from "./protocol";

export type InstallationIdentity = Readonly<{
  installationId: string;
  publicKey: string;
  sign(bytes: Buffer): string;
}>;

export interface InstallationIdentityStore {
  loadOrCreate(): Promise<InstallationIdentity>;
}

/** Test-only process memory adapter. The macOS activation harness uses Keychain instead. */
export class InMemoryInstallationIdentityStore implements InstallationIdentityStore {
  private privateKey: KeyObject | null = null;
  private identity: InstallationIdentity | null = null;

  async loadOrCreate(): Promise<InstallationIdentity> {
    if (this.identity) return this.identity;
    const pair = generateKeyPairSync("ed25519");
    this.privateKey = pair.privateKey;
    const publicKey = canonicalPublicKey(pair.publicKey);
    this.identity = Object.freeze({
      installationId: installationIdForPublicKey(publicKey),
      publicKey,
      sign: (bytes: Buffer) => sign(null, bytes, this.privateKey!).toString("base64url"),
    });
    return this.identity;
  }
}
