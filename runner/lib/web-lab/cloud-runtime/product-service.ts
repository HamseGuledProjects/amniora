import "server-only";
import {
  WebLabControlError, type AuthenticatedWebLabActor, type HostedProductState,
  type LearnerRuntimeDto, type WebLabControlPlaneService,
} from "../production-control-service";
import {
  CLOUD_GATEWAY_LAUNCH_PATH, type CloudOpen, type CloudRuntime,
  type CloudRuntimeState, type CloudSnapshot,
} from "./product-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{1,160}$/;
const HANDOFF = /^[A-Za-z0-9_-]{20,2048}\.[A-Za-z0-9_-]{20,128}$/;

function productState(status: LearnerRuntimeDto["status"]): CloudRuntimeState | null {
  switch (status) {
    case "requested": return "launching";
    case "provisioning": return "starting";
    case "ready": return "ready";
    case "resetting": return "resetting";
    case "destroying": return "stopping";
    case "expiring": return "expiring";
    case "expired": return "expired";
    case "failed": return "failed";
    case "destroyed": return null;
  }
}

function safeRuntime(value: LearnerRuntimeDto | null): CloudRuntime | null {
  if (!value) return null;
  const state = productState(value.status);
  if (!state) return null;
  return {
    state,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    openAvailable: value.availableActions.includes("open"),
    resetAvailable: value.availableActions.includes("reset"),
    stopAvailable: value.availableActions.includes("destroy"),
  };
}

export class CloudProductService {
  private readonly gatewayOrigin: string;

  constructor(private readonly control: WebLabControlPlaneService, gatewayOrigin: string) {
    let gateway: URL;
    try { gateway = new URL(gatewayOrigin); } catch { throw new Error("invalid_cloud_gateway_origin"); }
    const local = gateway.protocol === "http:" && ["localhost", "127.0.0.1"].includes(gateway.hostname);
    if ((!local && gateway.protocol !== "https:") || gateway.username || gateway.password ||
        gateway.origin !== gatewayOrigin || gateway.pathname !== "/" || gateway.search || gateway.hash) {
      throw new Error("invalid_cloud_gateway_origin");
    }
    this.gatewayOrigin = gateway.origin;
  }

  private id(value: string): void {
    if (!UUID.test(value)) throw new WebLabControlError("LAB_NOT_FOUND");
  }

  private key(value: string): void {
    if (!KEY.test(value)) throw new WebLabControlError("INVALID_REQUEST");
  }

  private async state(actor: AuthenticatedWebLabActor, savedLabId: string): Promise<HostedProductState> {
    this.id(savedLabId);
    return this.control.getHostedProductState(actor, savedLabId);
  }

  private snapshotValue(state: HostedProductState): CloudSnapshot {
    return {
      enabled: true,
      eligible: state.eligible,
      plan: state.plan,
      availability: state.availability,
      runtime: safeRuntime(state.runtime),
    };
  }

  async snapshot(actor: AuthenticatedWebLabActor, savedLabId: string): Promise<CloudSnapshot> {
    return this.snapshotValue(await this.state(actor, savedLabId));
  }

  private async current(actor: AuthenticatedWebLabActor, savedLabId: string): Promise<LearnerRuntimeDto> {
    const state = await this.state(actor, savedLabId);
    if (!state.runtime) throw new WebLabControlError("RUNTIME_NOT_FOUND");
    return state.runtime;
  }

  async launch(actor: AuthenticatedWebLabActor, savedLabId: string, idempotencyKey: string): Promise<CloudSnapshot> {
    this.id(savedLabId); this.key(idempotencyKey);
    try {
      await this.control.launch(actor, { savedLabId, mode: "amniora_hosted", idempotencyKey });
    } catch (error) {
      // A concurrent tab may win admission. Reconcile the same Saved Lab to the authoritative runtime.
      if (!(error instanceof WebLabControlError) || error.code !== "RUNTIME_ALREADY_ACTIVE") throw error;
      const recovered = await this.state(actor, savedLabId);
      if (!recovered.runtime) throw error;
      return this.snapshotValue(recovered);
    }
    return this.snapshot(actor, savedLabId);
  }

  async reset(actor: AuthenticatedWebLabActor, savedLabId: string, idempotencyKey: string): Promise<CloudSnapshot> {
    this.key(idempotencyKey);
    const runtime = await this.current(actor, savedLabId);
    await this.control.reset(actor, { instanceId: runtime.instanceId, idempotencyKey });
    return this.snapshot(actor, savedLabId);
  }

  async stop(actor: AuthenticatedWebLabActor, savedLabId: string, idempotencyKey: string): Promise<CloudSnapshot> {
    this.key(idempotencyKey);
    const runtime = await this.current(actor, savedLabId);
    await this.control.destroy(actor, { instanceId: runtime.instanceId, idempotencyKey });
    return this.snapshot(actor, savedLabId);
  }

  async open(actor: AuthenticatedWebLabActor, savedLabId: string): Promise<CloudOpen> {
    const runtime = await this.current(actor, savedLabId);
    if (!runtime.availableActions.includes("open")) throw new WebLabControlError("RUNTIME_NOT_READY");
    const launch = await this.control.issueLaunchGrant(actor, runtime.instanceId);
    const gateway = await this.control.exchangeLaunchGrant(actor, launch.token);
    if (!HANDOFF.test(gateway.token) || gateway.instanceId !== runtime.instanceId ||
        !Number.isFinite(new Date(gateway.expiresAt).getTime()) || new Date(gateway.expiresAt).getTime() <= Date.now()) {
      throw new WebLabControlError("INTERNAL_ERROR");
    }
    return { action: `${this.gatewayOrigin}${CLOUD_GATEWAY_LAUNCH_PATH}`,
      handoff: gateway.token, expiresAt: gateway.expiresAt };
  }
}
