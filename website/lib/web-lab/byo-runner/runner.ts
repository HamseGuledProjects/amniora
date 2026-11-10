import { EventEmitter } from "node:events";
import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { connect, type ConnectionOptions, type TLSSocket } from "node:tls";
import { ByoRunnerIdentityStore } from "./identity-store";
import {
  BYO_RUNNER_AUDIENCE,
  BYO_RUNNER_MAX_MESSAGE_BYTES,
  BYO_RUNNER_PROTOCOL_VERSION,
  ByoRunnerError,
  canonicalPublicKey,
  encodeJsonLine,
  enrollmentProofBytes,
  enrollmentTokenDigest,
  hasExactKeys,
  isPlainObject,
  parseJsonLine,
  reconnectProofBytes,
  requireEd25519PublicKey,
  validCommandId,
  validFingerprint,
  validIdempotencyKey,
  validNonce,
  validOperationErrorCode,
  validOwnerId,
  validRelayHttpRequest,
  validRelayHttpResponse,
  validRuntimeId,
  validRuntimeStatus,
  validRunnerId,
  type ByoRelayHttpResponse,
  type ByoRunnerErrorCode,
  type ByoRunnerOperationErrorCode,
  type ByoRunnerOperationHandler,
  type ByoRunnerRuntimeOperation,
  type ByoRunnerRuntimeStatus,
  type RunnerIdentity,
} from "./protocol";

export type ByoRunnerClientOptions = Readonly<{
  endpoint: Readonly<{
    host: string;
    port: number;
    serverName: string;
    ca: string | Buffer;
  }>;
  ownerId: string;
  identityStore: ByoRunnerIdentityStore;
  enrollmentToken?: string;
  operations?: ByoRunnerOperationHandler;
  reconnectDelayMs?: number;
  now?: () => number;
}>;

export type ByoRunnerClientStatus = Readonly<{
  active: boolean;
  connected: boolean;
  runnerId: string | null;
  ownerId: string;
  connectionCount: number;
  lastConnectedAt: number | null;
  lastHeartbeatAckAt: number | null;
  lastDisconnectedAt: number | null;
}>;

export class ByoRunnerClient extends EventEmitter {
  private readonly now: () => number;
  private readonly reconnectDelayMs: number;
  private enrollmentToken: string | undefined;
  private identity: RunnerIdentity | null = null;
  private socket: TLSSocket | null = null;
  private connecting: Promise<ByoRunnerClientStatus> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatSequence = 0;
  private active = false;
  private connected = false;
  private connectionCount = 0;
  private lastConnectedAt: number | null = null;
  private lastHeartbeatAckAt: number | null = null;
  private lastDisconnectedAt: number | null = null;

  constructor(private readonly options: ByoRunnerClientOptions) {
    super();
    if (!validOwnerId(options.ownerId) || !options.endpoint.host || !options.endpoint.serverName ||
        !Number.isSafeInteger(options.endpoint.port) || options.endpoint.port < 1 || options.endpoint.port > 65_535) {
      throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
    }
    this.now = options.now ?? (() => Date.now());
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
    if (!Number.isSafeInteger(this.reconnectDelayMs) || this.reconnectDelayMs < 25 || this.reconnectDelayMs > 60_000) {
      throw new Error("invalid_byo_runner_reconnect_delay");
    }
    this.enrollmentToken = options.enrollmentToken;
  }

  status(): ByoRunnerClientStatus {
    return {
      active: this.active,
      connected: this.connected,
      runnerId: this.identity?.runnerId ?? null,
      ownerId: this.options.ownerId,
      connectionCount: this.connectionCount,
      lastConnectedAt: this.lastConnectedAt,
      lastHeartbeatAckAt: this.lastHeartbeatAckAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
    };
  }

  async start(): Promise<ByoRunnerClientStatus> {
    if (this.active && this.connected) return this.status();
    this.active = true;
    try { return await this.connectNow(); }
    catch (error) {
      this.active = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) {
      await new Promise<void>(resolve => {
        socket.once("close", () => resolve());
        socket.end();
        setTimeout(() => { socket.destroy(); resolve(); }, 250).unref();
      });
    }
  }

  private async connectNow(): Promise<ByoRunnerClientStatus> {
    if (this.connecting) return this.connecting;
    this.connecting = this.establish().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async establish(): Promise<ByoRunnerClientStatus> {
    const stored = await this.options.identityStore.read();
    if (stored && stored.ownerId !== this.options.ownerId) throw new ByoRunnerError("OWNER_MISMATCH");
    this.identity = stored;
    if (!stored && !this.enrollmentToken) throw new ByoRunnerError("ENROLLMENT_INVALID");

    const pending = stored ? null : this.pendingIdentity();
    const tlsOptions: ConnectionOptions = {
      host: this.options.endpoint.host,
      port: this.options.endpoint.port,
      servername: this.options.endpoint.serverName,
      ca: this.options.endpoint.ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
    };

    return new Promise<ByoRunnerClientStatus>((resolve, reject) => {
      const socket = connect(tlsOptions);
      this.socket = socket;
      socket.setNoDelay(true);
      let buffer = Buffer.alloc(0);
      let ready = false;
      let settled = false;
      let brokerError: ByoRunnerError | null = null;
      let messageQueue = Promise.resolve();

      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof ByoRunnerError ? error : new ByoRunnerError("CONNECTION_FAILED"));
      };

      socket.once("secureConnect", () => {
        try {
          if (stored) {
            socket.write(encodeJsonLine({
              type: "reconnect",
              protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
              audience: BYO_RUNNER_AUDIENCE,
              ownerId: stored.ownerId,
              runnerId: stored.runnerId,
            }));
          } else if (pending && this.enrollmentToken) {
            const proofNonce = randomBytes(24).toString("base64url");
            const proof = sign(null, enrollmentProofBytes({
              audience: BYO_RUNNER_AUDIENCE,
              ownerId: this.options.ownerId,
              protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
              publicKey: pending.publicKey,
              proofNonce,
              enrollmentDigest: enrollmentTokenDigest(this.enrollmentToken),
            }), pending.privateKey).toString("base64url");
            socket.write(encodeJsonLine({
              type: "enroll",
              protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
              audience: BYO_RUNNER_AUDIENCE,
              ownerId: this.options.ownerId,
              enrollmentToken: this.enrollmentToken,
              publicKey: pending.publicKey,
              proofNonce,
              proof,
            }));
          } else throw new ByoRunnerError("ENROLLMENT_INVALID");
        } catch (error) {
          rejectOnce(error);
          socket.destroy();
        }
      });

      const handle = async (input: unknown): Promise<void> => {
        if (!isPlainObject(input) || typeof input.type !== "string" || input.protocolVersion !== BYO_RUNNER_PROTOCOL_VERSION) {
          throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
        }
        if (input.type === "error") {
          if (!hasExactKeys(input, ["type", "protocolVersion", "code"]) || typeof input.code !== "string") {
            throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
          }
          brokerError = new ByoRunnerError(input.code as ByoRunnerErrorCode);
          throw brokerError;
        }
        if (input.type === "challenge") {
          if (!stored || !hasExactKeys(input, ["type", "protocolVersion", "runnerId", "nonce", "expiresAt"]) ||
              input.runnerId !== stored.runnerId || !validNonce(input.nonce) || !Number.isSafeInteger(input.expiresAt)) {
            throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
          }
          const privateKey = createPrivateKey(stored.privateKey);
          if (privateKey.asymmetricKeyType !== "ed25519") throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
          const proof = sign(null, reconnectProofBytes({
            audience: stored.audience,
            ownerId: stored.ownerId,
            protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
            runnerId: stored.runnerId,
            nonce: input.nonce,
          }), privateKey).toString("base64url");
          socket.write(encodeJsonLine({
            type: "proof",
            protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
            runnerId: stored.runnerId,
            nonce: input.nonce,
            proof,
          }));
          return;
        }
        if (input.type === "ready") {
          if (ready || !hasExactKeys(input, ["type", "protocolVersion", "runnerId", "ownerId", "heartbeatIntervalMs"]) ||
              !validRunnerId(input.runnerId) || input.ownerId !== this.options.ownerId ||
              !Number.isSafeInteger(input.heartbeatIntervalMs) || Number(input.heartbeatIntervalMs) < 25) {
            throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
          }
          if (stored && input.runnerId !== stored.runnerId) throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
          if (!stored) {
            if (!pending) throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
            const enrolledAt = this.now();
            const identity: RunnerIdentity = {
              stateVersion: 1,
              runnerId: input.runnerId,
              ownerId: this.options.ownerId,
              audience: BYO_RUNNER_AUDIENCE,
              protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
              publicKey: pending.publicKey,
              privateKey: pending.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
              enrolledAt,
            };
            await this.options.identityStore.write(identity);
            this.identity = identity;
            this.enrollmentToken = undefined;
          }
          ready = true;
          this.connected = true;
          this.connectionCount += 1;
          this.lastConnectedAt = this.now();
          this.heartbeatSequence = 0;
          this.beginHeartbeats(socket, input.runnerId, Number(input.heartbeatIntervalMs));
          if (this.options.operations) await this.options.operations.initialize(input.runnerId);
          settled = true;
          const status = this.status();
          this.emit("connected", status);
          resolve(status);
          return;
        }
        if (input.type === "heartbeat_ack") {
          if (!ready || !this.identity || !hasExactKeys(input, [
            "type", "protocolVersion", "runnerId", "sequence", "receivedAt",
          ]) || input.runnerId !== this.identity.runnerId || !Number.isSafeInteger(input.sequence) ||
              !Number.isSafeInteger(input.receivedAt)) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
          this.lastHeartbeatAckAt = this.now();
          this.emit("heartbeat", this.status());
          return;
        }
        if (input.type === "command") {
          if (!ready || !this.identity || !this.options.operations ||
              input.runnerId !== this.identity.runnerId || input.ownerId !== this.options.ownerId ||
              !validCommandId(input.commandId)) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
          const operation = input.operation;
          if (operation === "relay_http") {
            const relayRequest = input.request;
            if (!hasExactKeys(input, [
              "type", "protocolVersion", "runnerId", "ownerId", "commandId", "operation", "runtimeId",
              "buildFingerprint", "generation", "request",
            ]) || !validRuntimeId(input.runtimeId) || !validFingerprint(input.buildFingerprint) ||
                !Number.isSafeInteger(input.generation) || Number(input.generation) < 1 ||
                !validRelayHttpRequest(relayRequest)) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
            const response = await this.runRelayOperation(socket, input.commandId, () => this.options.operations!.relayHttp(
              input.runnerId as string,
              {
                runtimeId: input.runtimeId as string,
                buildFingerprint: input.buildFingerprint as string,
                generation: Number(input.generation),
                request: relayRequest,
              },
            ));
            this.emit("operation", { operation, responseStatus: response?.status ?? null });
            return;
          }
          let status: ByoRunnerRuntimeStatus | null;
          if (operation === "launch") {
            if (!hasExactKeys(input, [
              "type", "protocolVersion", "runnerId", "ownerId", "commandId", "operation", "idempotencyKey", "package",
            ]) || !validIdempotencyKey(input.idempotencyKey)) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
            status = await this.runOperation(socket, input.commandId, operation,
              () => this.options.operations!.launch(input.runnerId as string, input.package, input.idempotencyKey as string));
          } else if (operation === "status") {
            if (!hasExactKeys(input, [
              "type", "protocolVersion", "runnerId", "ownerId", "commandId", "operation",
            ])) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
            status = await this.runOperation(socket, input.commandId, operation,
              () => this.options.operations!.status(input.runnerId as string));
          } else if (operation === "reset" || operation === "stop") {
            if (!hasExactKeys(input, [
              "type", "protocolVersion", "runnerId", "ownerId", "commandId", "operation", "runtimeId",
              "buildFingerprint", "generation", "idempotencyKey",
            ]) || !validRuntimeId(input.runtimeId) || !validFingerprint(input.buildFingerprint) ||
                !Number.isSafeInteger(input.generation) || Number(input.generation) < 1 ||
                !validIdempotencyKey(input.idempotencyKey)) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
            const lifecycle = {
              runtimeId: input.runtimeId,
              buildFingerprint: input.buildFingerprint,
              generation: Number(input.generation),
              idempotencyKey: input.idempotencyKey,
            };
            status = await this.runOperation(socket, input.commandId, operation, () => operation === "reset"
              ? this.options.operations!.reset(input.runnerId as string, lifecycle)
              : this.options.operations!.stop(input.runnerId as string, lifecycle));
          } else throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
          this.emit("operation", { operation, status });
          return;
        }
        throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
      };

      socket.on("data", chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > BYO_RUNNER_MAX_MESSAGE_BYTES && buffer.indexOf(0x0a) === -1) {
          brokerError = new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
          socket.destroy();
          return;
        }
        for (;;) {
          const newline = buffer.indexOf(0x0a);
          if (newline === -1) break;
          const line = buffer.subarray(0, newline);
          buffer = buffer.subarray(newline + 1);
          messageQueue = messageQueue.then(() => handle(parseJsonLine(line))).catch(error => {
            brokerError = error instanceof ByoRunnerError ? error : new ByoRunnerError("CONNECTION_FAILED");
            rejectOnce(brokerError);
            socket.destroy();
          });
        }
      });
      socket.on("error", error => { if (!ready) rejectOnce(brokerError ?? error); });
      socket.on("close", () => {
        if (this.socket === socket) this.socket = null;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        if (!ready) rejectOnce(brokerError ?? new ByoRunnerError("CONNECTION_FAILED"));
        if (ready && this.connected) {
          this.connected = false;
          this.lastDisconnectedAt = this.now();
          this.emit("disconnected", this.status());
          if (this.active) this.scheduleReconnect();
        }
      });
    });
  }

  private async runOperation(
    socket: TLSSocket,
    commandId: string,
    operation: ByoRunnerRuntimeOperation,
    work: () => Promise<ByoRunnerRuntimeStatus>,
  ): Promise<ByoRunnerRuntimeStatus | null> {
    try {
      const status = await work();
      if (!this.identity || status.runnerId !== this.identity.runnerId || !validRuntimeStatus(status)) {
        throw new Error("invalid_byo_runtime_status");
      }
      socket.write(encodeJsonLine({
        type: "operation_result",
        protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
        runnerId: this.identity.runnerId,
        commandId,
        operation,
        ok: true,
        status,
        errorCode: null,
      }));
      return status;
    } catch (error) {
      const candidate = (error as Readonly<{ code?: unknown }>)?.code;
      const errorCode: ByoRunnerOperationErrorCode = validOperationErrorCode(candidate) ? candidate : "INTERNAL_ERROR";
      socket.write(encodeJsonLine({
        type: "operation_result",
        protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
        runnerId: this.identity!.runnerId,
        commandId,
        operation,
        ok: false,
        status: null,
        errorCode,
      }));
      return null;
    }
  }

  private async runRelayOperation(
    socket: TLSSocket,
    commandId: string,
    work: () => Promise<ByoRelayHttpResponse>,
  ): Promise<ByoRelayHttpResponse | null> {
    try {
      const response = await work();
      if (!this.identity || !validRelayHttpResponse(response)) throw new Error("invalid_byo_relay_response");
      socket.write(encodeJsonLine({
        type: "relay_result",
        protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
        runnerId: this.identity.runnerId,
        commandId,
        operation: "relay_http",
        ok: true,
        response,
        errorCode: null,
      }));
      return response;
    } catch (error) {
      const candidate = (error as Readonly<{ code?: unknown }>)?.code;
      const errorCode: ByoRunnerOperationErrorCode = validOperationErrorCode(candidate) ? candidate : "INTERNAL_ERROR";
      socket.write(encodeJsonLine({
        type: "relay_result",
        protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
        runnerId: this.identity!.runnerId,
        commandId,
        operation: "relay_http",
        ok: false,
        response: null,
        errorCode,
      }));
      return null;
    }
  }

  private pendingIdentity(): Readonly<{ publicKey: string; privateKey: ReturnType<typeof createPrivateKey> }> {
    const pair = generateKeyPairSync("ed25519");
    const publicKey = canonicalPublicKey(requireEd25519PublicKey(pair.publicKey.export({ type: "spki", format: "pem" }).toString()));
    return { publicKey, privateKey: pair.privateKey };
  }

  private beginHeartbeats(socket: TLSSocket, runnerId: string, intervalMs: number): void {
    const sendHeartbeat = () => {
      if (socket.destroyed || this.socket !== socket || !this.connected) return;
      socket.write(encodeJsonLine({
        type: "heartbeat",
        protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
        runnerId,
        sequence: this.heartbeatSequence++,
        sentAt: this.now(),
      }));
    };
    sendHeartbeat();
    this.heartbeatTimer = setInterval(sendHeartbeat, intervalMs);
    this.heartbeatTimer.unref();
  }

  private scheduleReconnect(): void {
    if (!this.active || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectNow().catch(() => this.scheduleReconnect());
    }, this.reconnectDelayMs);
  }
}
