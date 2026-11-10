import { request as httpRequest } from "node:http";
import { LocalRunnerCore } from "../local-runner/core";
import type { RunnerPublicStatus } from "../local-runner/protocol";
import {
  BYO_RELAY_MAX_RESPONSE_BODY_BYTES,
  BYO_RELAY_REQUEST_TIMEOUT_MS,
  BYO_RELAY_RESPONSE_HEADERS,
  ByoRunnerOperationError,
  validRelayHttpRequest,
  validRelayHttpResponse,
  type ByoRelayHttpRequest,
  type ByoRelayHttpResponse,
  type ByoRunnerOperationHandler,
  type ByoRunnerRuntimeStatus,
} from "./protocol";

function publicStatus(runnerId: string, status: RunnerPublicStatus): ByoRunnerRuntimeStatus {
  return {
    runnerId,
    runtimeId: status.sessionId,
    state: status.state,
    generation: status.generation,
    buildFingerprint: status.buildFingerprint,
    expiresAt: status.expiresAt,
    trustLevel: "byo_self_hosted",
  };
}

function requestRuntime(endpoint: string, request: ByoRelayHttpRequest): Promise<ByoRelayHttpResponse> {
  if (!validRelayHttpRequest(request)) throw new ByoRunnerOperationError("RELAY_REQUEST_INVALID");
  const target = new URL(endpoint);
  const body = Buffer.from(request.bodyBase64, "base64");
  return new Promise<ByoRelayHttpResponse>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const fail = (error: ByoRunnerOperationError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const outbound = httpRequest({
      hostname: target.hostname,
      port: Number(target.port),
      method: request.method,
      path: request.pathQuery,
      headers: request.headers,
      timeout: BYO_RELAY_REQUEST_TIMEOUT_MS,
      agent: false,
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", chunk => {
        if (settled) return;
        const value = Buffer.from(chunk);
        size += value.length;
        if (size > BYO_RELAY_MAX_RESPONSE_BODY_BYTES) {
          fail(new ByoRunnerOperationError("RELAY_RESPONSE_TOO_LARGE"));
          response.destroy();
          outbound.destroy();
          return;
        }
        chunks.push(value);
      });
      response.on("end", () => {
        if (settled) return;
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (BYO_RELAY_RESPONSE_HEADERS.has(name) && typeof value === "string") headers[name] = value;
        }
        const result: ByoRelayHttpResponse = {
          status: response.statusCode ?? 502,
          headers,
          bodyBase64: Buffer.concat(chunks).toString("base64"),
        };
        if (!validRelayHttpResponse(result)) {
          fail(new ByoRunnerOperationError("RELAY_UPSTREAM_UNAVAILABLE"));
          return;
        }
        settled = true;
        resolve(result);
      });
      response.on("error", () => fail(new ByoRunnerOperationError("RELAY_UPSTREAM_UNAVAILABLE")));
    });
    outbound.on("timeout", () => {
      timedOut = true;
      outbound.destroy();
    });
    outbound.on("error", () => fail(new ByoRunnerOperationError(
      timedOut ? "RELAY_UPSTREAM_TIMEOUT" : "RELAY_UPSTREAM_UNAVAILABLE",
    )));
    outbound.end(body);
  });
}

/** Fixed-purpose BYO adapter over the reviewed Local Runner package and Docker lifecycle. */
export class ByoRunnerRuntimeController implements ByoRunnerOperationHandler {
  constructor(private readonly core: LocalRunnerCore) {}

  async initialize(runnerId: string): Promise<ByoRunnerRuntimeStatus> {
    await this.core.reconcileOrphans();
    return publicStatus(runnerId, await this.core.recover());
  }

  async launch(runnerId: string, packageInput: unknown, idempotencyKey: string): Promise<ByoRunnerRuntimeStatus> {
    const candidate = packageInput as Readonly<{ buildId?: unknown; buildFingerprint?: unknown }>;
    const capability = this.core.authorize({
      operation: "launch",
      buildId: typeof candidate?.buildId === "string" ? candidate.buildId : "",
      buildFingerprint: typeof candidate?.buildFingerprint === "string" ? candidate.buildFingerprint : "",
      idempotencyKey,
    });
    return publicStatus(runnerId, await this.core.launch(capability.capability, packageInput));
  }

  async status(runnerId: string): Promise<ByoRunnerRuntimeStatus> {
    return publicStatus(runnerId, await this.core.status());
  }

  async reset(runnerId: string, input: Readonly<{
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    idempotencyKey: string;
  }>): Promise<ByoRunnerRuntimeStatus> {
    const capability = this.core.authorize({
      operation: "reset",
      sessionId: input.runtimeId,
      buildFingerprint: input.buildFingerprint,
      generation: input.generation,
      idempotencyKey: input.idempotencyKey,
    });
    return publicStatus(runnerId, await this.core.reset(capability.capability));
  }

  async stop(runnerId: string, input: Readonly<{
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    idempotencyKey: string;
  }>): Promise<ByoRunnerRuntimeStatus> {
    const capability = this.core.authorize({
      operation: "stop",
      sessionId: input.runtimeId,
      buildFingerprint: input.buildFingerprint,
      generation: input.generation,
      idempotencyKey: input.idempotencyKey,
    });
    return publicStatus(runnerId, await this.core.stop(capability.capability));
  }

  async relayHttp(_runnerId: string, input: Readonly<{
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    request: ByoRelayHttpRequest;
  }>): Promise<ByoRelayHttpResponse> {
    const current = await this.core.status();
    if (current.state !== "ready" || !current.endpoint) throw new ByoRunnerOperationError("RELAY_RUNTIME_NOT_READY");
    if (current.sessionId !== input.runtimeId || current.buildFingerprint !== input.buildFingerprint ||
        current.generation !== input.generation) throw new ByoRunnerOperationError("RELAY_RUNTIME_MISMATCH");
    return requestRuntime(current.endpoint, input.request);
  }
}
