import { randomBytes } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DesktopGuestTrustStore, type SigningIdentity } from "./identity";
import { MacKeychainSigningIdentity } from "./keychain-signer";
import { WindowsDpapiSigningIdentity } from "./windows-signer";
import { GUEST_HOST_ADDRESS, publicKeyFingerprint, validGuestRuntimeStatus, validGuestStatus } from "./protocol";
import { startDesktopPairingServer, RunnerGuestClient } from "./transport";
import { runMacLabViewer } from "../local-first-viewer/desktop-process";

function paths() {
  const root = process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "Amniora/Runner")
    : path.join(os.homedir(), "Library/Application Support/Amniora Runner");
  return {
    trust: path.join(root, "phase2-guest-trust.json"),
    helper: process.platform === "win32"
      ? process.env.AMNIORA_WINDOWS_IDENTITY_HELPER ?? path.resolve(__dirname, "../../bin/Amniora.Runner.IdentityHelper.exe")
      : path.resolve(__dirname, "../../bin/amniora-keychain-signer"),
  };
}

async function desktopIdentity(helper: string): Promise<SigningIdentity> {
  if (process.platform === "darwin") return new MacKeychainSigningIdentity(helper).load();
  if (process.platform === "win32") return new WindowsDpapiSigningIdentity(helper).load();
  throw new Error("RUNNER_PLATFORM_UNSUPPORTED");
}

export async function runDesktopGuestCli(arguments_: readonly string[] = process.argv.slice(2)): Promise<void> {
  const command = arguments_[0];
  if (!["darwin", "win32"].includes(process.platform) || !command || !["pair", "ping", "status", "launch", "runtime-status", "reset", "stop", "probe", "viewer"].includes(command) ||
      (command === "viewer" && process.platform !== "darwin") ||
      (command === "launch" ? arguments_.length !== 2 : arguments_.length !== 1)) {
    throw new Error("USAGE: amniora-phase4-desktop pair|ping|status|launch <signed-package.json>|runtime-status|reset|stop|probe|viewer");
  }
  const configured = paths();
  const identity = await desktopIdentity(configured.helper);
  const trustStore = new DesktopGuestTrustStore(configured.trust);
  if (command === "pair") {
    const configuredTtl = Number(process.env.AMNIORA_PAIRING_TTL_MS ?? "120000");
    if (!Number.isSafeInteger(configuredTtl) || configuredTtl < 30_000 || configuredTtl > 300_000) {
      throw new Error("PAIRING_TTL_INVALID");
    }
    const server = await startDesktopPairingServer({ identity, trustStore, bindAddress: GUEST_HOST_ADDRESS,
      ttlMs: configuredTtl });
    process.stdout.write(`PAIRING_CODE=${server.pairingCode}\nEXPIRES_AT=${new Date(server.expiresAt).toISOString()}\n`);
    const trust = await server.paired;
    process.stdout.write(`PAIRED guestFingerprint=${trust.guestCertificateFingerprint} desktopFingerprint=${publicKeyFingerprint(identity.publicKey)}\n`);
    return;
  }
  const trust = await trustStore.load();
  const client = new RunnerGuestClient(identity, trust);
  try {
    await client.connect();
    if (command === "viewer") {
      await runMacLabViewer(client);
      return;
    }
    if (command === "launch") {
      const packagePath = path.resolve(arguments_[1]);
      const detail = await lstat(packagePath);
      if (!detail.isFile() || detail.isSymbolicLink() || detail.size > 512 * 1024) throw new Error("PACKAGE_INVALID");
      let packageInput: unknown;
      try { packageInput = JSON.parse(await readFile(packagePath, "utf8")); }
      catch { throw new Error("PACKAGE_INVALID"); }
      const response = await client.request("LAUNCH", { package: packageInput, idempotencyKey: idempotencyKey("launch") });
      if (!response.ok || !validGuestRuntimeStatus(response.result)) throw new Error(response.errorCode ?? "RUNTIME_OPERATION_FAILED");
      process.stdout.write(`${JSON.stringify(response.result, null, 2)}\n`);
      return;
    }
    if (["runtime-status", "reset", "stop", "probe"].includes(command)) {
      const current = await client.request("RUNTIME_STATUS");
      if (!current.ok || !validGuestRuntimeStatus(current.result)) throw new Error(current.errorCode ?? "RUNTIME_OPERATION_FAILED");
      if (command === "runtime-status") {
        process.stdout.write(`${JSON.stringify(current.result, null, 2)}\n`);
        return;
      }
      const status = current.result;
      if (!status.runtimeId || !status.buildFingerprint || !status.generation) throw new Error("RUNTIME_NOT_FOUND");
      const input = { runtimeId: status.runtimeId, buildFingerprint: status.buildFingerprint, generation: status.generation };
      const response = command === "probe"
        ? await client.request("DIAGNOSTIC_PROBE", input)
        : await client.request(command === "reset" ? "RESET" : "STOP", { ...input, idempotencyKey: idempotencyKey(command) });
      if (!response.ok) throw new Error(response.errorCode ?? "RUNTIME_OPERATION_FAILED");
      process.stdout.write(`${JSON.stringify(response.result, null, 2)}\n`);
      return;
    }
    const response = await client.request(command === "ping" ? "PING" : "STATUS");
    if (!response.ok) throw new Error(response.errorCode ?? "GUEST_OPERATION_FAILED");
    if (command === "ping") {
      if (JSON.stringify(response.result) !== '{"pong":true}') throw new Error("INVALID_GUEST_PING");
    } else if (!validGuestStatus(response.result)) throw new Error("INVALID_GUEST_STATUS");
    process.stdout.write(`${JSON.stringify(response.result, null, 2)}\n`);
  } finally { client.close(); }
}

function idempotencyKey(operation: string): string {
  return `${operation}_${randomBytes(24).toString("base64url")}`;
}
