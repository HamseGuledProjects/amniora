export const BYO_VM_API_PATH = "/api/web-labs/my-vm";

export type MyVmRunnerState = "connected" | "offline" | "reconnecting" | "incompatible";
export type MyVmLabState = "idle" | "starting" | "ready" | "resetting" | "stopping" | "failed" | "expired";

export type MyVmRunner = Readonly<{
  runnerKey: string;
  displayName: string;
  platform: "Linux";
  architecture: string;
  version: string;
  state: MyVmRunnerState;
  lastSeenAt: string | null;
  dockerAvailable: boolean;
  labState: MyVmLabState;
  generation: number | null;
}>;

export type MyVmSnapshot = Readonly<{
  enabled: boolean;
  eligible: boolean;
  runners: readonly MyVmRunner[];
  distribution: Readonly<{
    currentVersion: string;
    minimumCompatibleVersion: string;
    protocolVersion: string;
    updateCommand: string;
    uninstallCommand: string;
  }>;
}>;

export type MyVmEnrollment = Readonly<{
  command: string;
  expiresAt: string;
}>;

export type MyVmOpen = Readonly<{
  action: string;
  grant: string;
  expiresAt: string;
}>;
