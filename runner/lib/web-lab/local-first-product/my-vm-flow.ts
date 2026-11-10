import type { ProductAction, ProductOperation } from "./contract";

export type MyVmFlow =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "pairing"; startedAt: number }>
  | Readonly<{ state: "issuing"; operation: ProductOperation; scope: string }>
  | Readonly<{ state: "awaiting_activation"; action: ProductAction; scope: string }>
  | Readonly<{ state: "awaiting_result"; action: ProductAction; scope: string; startedAt: number }>
  | Readonly<{ state: "unpairing" }>;

export type MyVmEvent =
  | Readonly<{ type: "PAIR"; now: number }>
  | Readonly<{ type: "ISSUE"; operation: ProductOperation; scope: string }>
  | Readonly<{ type: "ISSUED"; action: ProductAction; scope: string }>
  | Readonly<{ type: "ACTIVATE"; now: number }>
  | Readonly<{ type: "ACTIVATION_NOT_OBSERVED"; requestId: string }>
  | Readonly<{ type: "UNPAIR" }>
  | Readonly<{ type: "SETTLE" }>;

export const IDLE_MY_VM_FLOW: MyVmFlow = Object.freeze({ state: "idle" });

/** Invalid/stale async transitions are ignored, rather than resurrecting a cancelled spinner. */
export function nextMyVmFlow(flow: MyVmFlow, event: MyVmEvent): MyVmFlow {
  if (event.type === "SETTLE") return IDLE_MY_VM_FLOW;
  if (flow.state === "idle") {
    if (event.type === "PAIR") return { state: "pairing", startedAt: event.now };
    if (event.type === "ISSUE") return { state: "issuing", operation: event.operation, scope: event.scope };
    if (event.type === "UNPAIR") return { state: "unpairing" };
  }
  if (flow.state === "issuing" && event.type === "ISSUED" && event.action.operation === flow.operation &&
      event.scope === flow.scope) return { state: "awaiting_activation", action: event.action, scope: event.scope };
  if (flow.state === "awaiting_activation" && event.type === "ACTIVATE") {
    return { ...flow, state: "awaiting_result", startedAt: event.now };
  }
  if (flow.state === "awaiting_result" && event.type === "ACTIVATION_NOT_OBSERVED" &&
      flow.action.requestId === event.requestId) {
    return { state: "awaiting_activation", action: flow.action, scope: flow.scope };
  }
  return flow;
}
