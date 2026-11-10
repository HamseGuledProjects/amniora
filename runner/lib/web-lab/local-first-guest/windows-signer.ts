import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GuestChannelError, publicKeyFingerprint } from "./protocol";
import type { SigningIdentity } from "./identity";

const execFileAsync = promisify(execFile);

type HelperOutput = Readonly<{ installationId: string; publicKey: string; signature?: string | null }>;

/** Uses the existing Windows Runner DPAPI CurrentUser identity without exporting its private key. */
export class WindowsDpapiSigningIdentity implements SigningIdentity {
  private loaded: HelperOutput | null = null;

  constructor(private readonly helperPath: string) {}

  get id(): string {
    if (!this.loaded) throw new GuestChannelError("INTERNAL_ERROR");
    return this.loaded.installationId;
  }

  get publicKey(): string {
    if (!this.loaded) throw new GuestChannelError("INTERNAL_ERROR");
    return this.loaded.publicKey;
  }

  async load(): Promise<this> {
    this.loaded = await this.invoke(["identity"]);
    const expected = `ins_${Buffer.from(publicKeyFingerprint(this.loaded.publicKey), "hex").toString("base64url")}`;
    if (this.loaded.installationId !== expected) throw new GuestChannelError("INTERNAL_ERROR");
    return this;
  }

  async sign(bytes: Buffer): Promise<string> {
    if (!this.loaded) await this.load();
    const output = await this.invoke(["sign", bytes.toString("base64url")]);
    if (output.installationId !== this.id || output.publicKey !== this.publicKey ||
        typeof output.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(output.signature)) {
      throw new GuestChannelError("PROOF_INVALID");
    }
    return output.signature;
  }

  private async invoke(args: readonly string[]): Promise<HelperOutput> {
    try {
      const result = await execFileAsync(this.helperPath, [...args], { timeout: 5_000, maxBuffer: 16_384,
        windowsHide: true, env: { PATH: process.env.SystemRoot ? `${process.env.SystemRoot}\\System32` : "", NODE_ENV: "production" } });
      const value = JSON.parse(result.stdout) as Partial<HelperOutput>;
      if (typeof value.installationId !== "string" || typeof value.publicKey !== "string") throw new Error("invalid");
      return value as HelperOutput;
    } catch { throw new GuestChannelError("INTERNAL_ERROR"); }
  }
}
