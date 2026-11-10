export const CLOUD_PRODUCT_API_PATH = "/api/web-labs/cloud";
export const CLOUD_GATEWAY_LAUNCH_PATH = "/__amniora/cloud/launch";

export type CloudAvailability = "available" | "plan_required" | "capacity_full" |
  "active_elsewhere" | "budget_unavailable" | "service_disabled" | "unavailable";

export type CloudRuntimeState = "launching" | "starting" | "ready" | "resetting" |
  "stopping" | "expiring" | "expired" | "failed";

export type CloudRuntime = Readonly<{
  state: CloudRuntimeState;
  createdAt: string;
  expiresAt: string;
  openAvailable: boolean;
  resetAvailable: boolean;
  stopAvailable: boolean;
}>;

/** Browser-safe product snapshot: no logical/provider identifiers, targets, grants or credentials. */
export type CloudSnapshot = Readonly<{
  enabled: boolean;
  eligible: boolean;
  plan: "free" | "pro";
  availability: CloudAvailability;
  runtime: CloudRuntime | null;
}>;

/** Short-lived gateway handoff. It is submitted by POST and never rendered or placed in a URL. */
export type CloudOpen = Readonly<{
  action: string;
  handoff: string;
  expiresAt: string;
}>;
