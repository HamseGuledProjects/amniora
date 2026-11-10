import type { ByoRelayHttpRequest, ByoRelayHttpResponse } from "../byo-runner/protocol";
import type { GuestRuntimeStatus } from "../local-first-guest/protocol";
import { validLocalViewerRelayHttpResponse } from "./http-protocol";
import {
  LabViewerError,
  bindingFromStatus,
  requireViewerRequestFrame,
  sameBinding,
  viewerResponse,
  type LabViewerBinding,
  type LabViewerResponseFrame,
} from "./protocol";

export interface LocalFirstViewerTransport {
  runtimeStatus(): Promise<GuestRuntimeStatus>;
  relayHttp(input: Readonly<{
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    request: ByoRelayHttpRequest;
  }>): Promise<ByoRelayHttpResponse>;
}

export class LocalFirstViewerSession {
  private constructor(
    readonly binding: LabViewerBinding,
    private readonly transport: LocalFirstViewerTransport,
  ) {}

  static async create(transport: LocalFirstViewerTransport): Promise<LocalFirstViewerSession> {
    return new LocalFirstViewerSession(bindingFromStatus(await transport.runtimeStatus()), transport);
  }

  async current(): Promise<boolean> {
    try { return sameBinding(await this.transport.runtimeStatus(), this.binding); }
    catch { return false; }
  }

  async relay(value: unknown): Promise<LabViewerResponseFrame> {
    const frame = requireViewerRequestFrame(value, this.binding.authority);
    const status = await this.transport.runtimeStatus();
    if (!sameBinding(status, this.binding)) {
      throw new LabViewerError("VIEWER_GENERATION_STALE", 410, true);
    }
    const response = await this.transport.relayHttp({
      runtimeId: this.binding.runtimeId,
      buildFingerprint: this.binding.buildFingerprint,
      generation: this.binding.generation,
      request: frame.request,
    });
    if (!validLocalViewerRelayHttpResponse(response)) throw new LabViewerError("VIEWER_RESPONSE_INVALID", 502, true);
    return viewerResponse(frame.requestId, response);
  }
}
