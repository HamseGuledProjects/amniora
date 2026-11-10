export const LOCAL_FIRST_PRODUCT_PROTOCOL = "1.0" as const;
export const LOCAL_FIRST_PRODUCT_AUDIENCE = "com.amniora.runner.command.v1" as const;
export const LOCAL_FIRST_PRODUCT_SCHEME = "com.amniora.runner" as const;
export const LOCAL_FIRST_PRODUCT_OPERATIONS = ["STATUS", "LAUNCH", "OPEN_LAB", "RESET", "STOP"] as const;

export type ProductOperation = typeof LOCAL_FIRST_PRODUCT_OPERATIONS[number];
export type ProductArchitecture = "arm64" | "amd64";
export type ProductReadiness = "ready" | "unavailable" | "unknown";
export type ProductLabState = "stopped" | "starting" | "running" | "resetting" | "stopping" | "failed";
export type ProductRuntimeState = "idle" | "launching" | "running" | "resetting" | "stopping" | "recovery_required" | "failed";

export type AuthoritativeRunnerResult = Readonly<{
  ok: boolean;
  code: ProductFailureCode | null;
  runner: Readonly<{ version: string; platform: "macOS" | "Windows" }>;
  virtualMachine: Readonly<{
    name: string;
    operatingSystem: "Ubuntu 24.04";
    architecture: ProductArchitecture;
    state: ProductReadiness;
  }> | null;
  guestAgent: Readonly<{ state: ProductReadiness }> | null;
  docker: Readonly<{ version: string | null; state: ProductReadiness }> | null;
  runtime: Readonly<{
    buildId: string;
    runtimeId: string;
    generation: number;
    labName: string;
    state: ProductLabState;
  }> | null;
}>;

export type ProductFailureCode =
  | "RUNNER_NOT_INSTALLED"
  | "RUNNER_UNPAIRED"
  | "RUNNER_DID_NOT_RESPOND"
  | "VM_NOT_CONFIGURED"
  | "VM_POWERED_OFF"
  | "GUEST_AGENT_UNAVAILABLE"
  | "DOCKER_UNAVAILABLE"
  | "PACKAGE_INCOMPATIBLE"
  | "LAB_LAUNCH_FAILED"
  | "LAB_RESET_FAILED"
  | "LAB_STOPPED"
  | "STATUS_STALE"
  | "ANOTHER_LAB_ACTIVE"
  | "OPERATION_IN_PROGRESS"
  | "PAIRING_REVOKED";

export type ProductSnapshot = Readonly<{
  enabled: boolean;
  eligible: boolean;
  paired: boolean;
  runner: null | Readonly<{
    name: string;
    fingerprint: string;
    presence: "online" | "stale" | "offline" | "unknown";
    readiness: "ready" | "unavailable" | "unknown";
    readinessVerifiedAt: string | null;
    version: string | null;
    lastInteractionAt: string | null;
    presenceExpiresAt: string | null;
    readinessExpiresAt: string | null;
  }>;
  virtualMachine: null | Readonly<{
    name: string;
    operatingSystem: string;
    architecture: ProductArchitecture;
    state: ProductReadiness;
  }>;
  guestAgent: null | Readonly<{ state: ProductReadiness }>;
  docker: null | Readonly<{ version: string | null; state: ProductReadiness }>;
  runtime: Readonly<{ state: ProductRuntimeState; generation: number | null; lastVerifiedAt: string | null }>;
  lab: Readonly<{ name: string; state: ProductLabState; generation: number | null }>;
  otherActiveLab: null | Readonly<{ savedLabId: string; name: string }>;
  pendingCommand: null | Readonly<{
    operation: ProductOperation;
    state: "issued" | "redeemed";
    expiresAt: string;
  }>;
  lastCompletedCommand: null | Readonly<{
    requestId: string;
    operation: ProductOperation;
    completedAt: string;
    ok: boolean;
  }>;
  gradingAvailable: false;
  failure: ProductFailureCode | null;
}>;

export type ProductAction = Readonly<{
  requestId: string;
  activationUri: string | null;
  expiresAt: string;
  operation: ProductOperation;
  state: "issued" | "redeemed" | "completed";
}>;

export type ProductCommandStatus = Readonly<{
  state: "issued" | "redeemed" | "completed" | "cancelled";
  operation: ProductOperation;
  expiresAt: string;
  ok: boolean | null;
  code: ProductFailureCode | null;
}>;

export type PairingApproval = Readonly<{
  requestId: string;
  deviceName: string;
  fingerprint: string;
  expiresAt: string;
}>;
