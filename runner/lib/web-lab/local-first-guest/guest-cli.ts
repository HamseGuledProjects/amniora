import { stdin } from "node:process";
import { DiskGuestIdentityStore } from "./identity";
import { GUEST_VM_ADDRESS, publicKeyFingerprint } from "./protocol";
import { UbuntuGuestStatusProvider } from "./status";
import { pairGuestToDesktop, startGuestChannelServer } from "./transport";
import { createGuestLabRuntimeController } from "./guest-runtime";

const STATE_DIRECTORY = "/var/lib/amniora-guest-agent";

async function readPairingCode(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stdin) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > 1_024) throw new Error("PAIRING_CODE_TOO_LARGE");
    chunks.push(value);
  }
  const code = Buffer.concat(chunks).toString("utf8").trim();
  if (!code) throw new Error("PAIRING_CODE_REQUIRED");
  return code;
}

export async function runGuestAgentCli(arguments_: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (process.platform !== "linux" || arguments_.length !== 1 || !["init", "pair", "serve"].includes(arguments_[0])) {
    throw new Error("USAGE: amniora-guest-agent init|pair|serve");
  }
  const store = new DiskGuestIdentityStore(STATE_DIRECTORY, GUEST_VM_ADDRESS);
  if (arguments_[0] === "init") {
    const identity = await store.loadOrCreate();
    process.stdout.write(`READY guestFingerprint=${publicKeyFingerprint(identity.publicKey)}\n`);
    return;
  }
  if (arguments_[0] === "pair") {
    const result = await pairGuestToDesktop({ identityStore: store, pairingCode: await readPairingCode() });
    process.stdout.write(`PAIRED guestFingerprint=${result.guestFingerprint} desktopFingerprint=${result.desktopFingerprint}\n`);
    return;
  }
  const runtimeController = await createGuestLabRuntimeController();
  await runtimeController.initialize();
  const server = await startGuestChannelServer({ identityStore: store, statusProvider: new UbuntuGuestStatusProvider(), runtimeController });
  process.stdout.write(`READY address=${server.address} port=${server.port}\n`);
  await new Promise<void>((resolve) => {
    const stop = () => void server.close().finally(resolve);
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
}
