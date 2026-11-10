import { loadGuestVerificationKeys } from "./guest-runtime";
import { PrivilegedDockerRuntimeManager } from "./privileged-runtime";
import { startRuntimeHelperServer } from "./runtime-helper-transport";

export async function runRuntimeHelperCli(arguments_: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() !== 0 ||
      arguments_.length !== 1 || arguments_[0] !== "serve") {
    throw new Error("USAGE: amniora-runtime-helper serve (root/systemd only)");
  }
  const manager = new PrivilegedDockerRuntimeManager(await loadGuestVerificationKeys(), undefined, undefined,
    undefined, undefined, undefined, stage => process.stderr.write(`RUNTIME_LAUNCH_FAILED stage=${stage}\n`));
  const server = await startRuntimeHelperServer({ manager, inheritedFd: 3 });
  const initial = await manager.status(null);
  process.stdout.write(`READY state=${initial.state} architecture=${initial.architecture}\n`);
  await new Promise<void>(resolve => {
    const stop = () => void server.close().finally(resolve);
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
}
