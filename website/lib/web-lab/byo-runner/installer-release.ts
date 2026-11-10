import "server-only";
import { BYO_RUNNER_PROTOCOL_VERSION, validOwnerId, validToken } from "./protocol";

export type MyVmInstallerRelease = Readonly<{
  runnerVersion: string;
  minimumCompatibleVersion: string;
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  installerUrl: string;
  installerSha256: string;
  brokerEndpoint: string;
}>;

const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const SHA256 = /^[0-9a-f]{64}$/;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function validateMyVmInstallerRelease(value: MyVmInstallerRelease): MyVmInstallerRelease {
  if (!VERSION.test(value.runnerVersion) || !VERSION.test(value.minimumCompatibleVersion) ||
      value.protocolVersion !== BYO_RUNNER_PROTOCOL_VERSION || !SHA256.test(value.installerSha256)) {
    throw new Error("invalid_runner_installer_release");
  }
  let installer: URL; let broker: URL;
  try { installer = new URL(value.installerUrl); broker = new URL(value.brokerEndpoint); }
  catch { throw new Error("invalid_runner_installer_release"); }
  const installerPort = installer.port ? Number(installer.port) : 443;
  if (installer.protocol !== "https:" || installer.hostname !== "runner.portfolio.example.test" ||
      !Number.isSafeInteger(installerPort) || (installerPort !== 443 && installerPort < 1_024) || installerPort > 65_535 ||
      installer.username || installer.password || installer.search || installer.hash ||
      installer.pathname !== `/runner/installers/${value.runnerVersion}/install.sh`) {
    throw new Error("invalid_runner_installer_release");
  }
  if (broker.protocol !== "https:" || broker.username || broker.password || broker.pathname !== "/connect" ||
      broker.search || broker.hash) throw new Error("invalid_runner_installer_release");
  return Object.freeze({ ...value });
}

function verifiedBootstrap(release: MyVmInstallerRelease): string {
  const trusted = validateMyVmInstallerRelease(release);
  return [
    "umask 077",
    'amniora_install_dir="$(mktemp -d)"',
    'amniora_install="$amniora_install_dir/install.sh"',
    `curl --proto '=https' --tlsv1.2 --fail --silent --show-error --output "$amniora_install" ${shellQuote(trusted.installerUrl)}`,
    `printf '%s  %s\\n' ${shellQuote(trusted.installerSha256)} "$amniora_install" | sha256sum --check --status`,
  ].join(" && ");
}

export function createMyVmInstallCommand(release: MyVmInstallerRelease, ownerId: string, token: string): string {
  if (!validOwnerId(ownerId) || !validToken(token)) throw new Error("invalid_runner_enrollment_command");
  return `( ${verifiedBootstrap(release)} && printf '%s\\n' ${shellQuote(token)} | sudo /bin/bash "$amniora_install" --enrollment-stdin --replace-identity --owner ${shellQuote(ownerId)}; amniora_status=$?; /bin/rm -rf -- "$amniora_install_dir"; exit $amniora_status )`;
}

export function createMyVmUpdateCommand(release: MyVmInstallerRelease): string {
  return `( ${verifiedBootstrap(release)} && sudo /bin/bash "$amniora_install" --update; amniora_status=$?; /bin/rm -rf -- "$amniora_install_dir"; exit $amniora_status )`;
}

export const MY_VM_UNINSTALL_COMMAND = "sudo /usr/local/sbin/amniora-runner-uninstall";
