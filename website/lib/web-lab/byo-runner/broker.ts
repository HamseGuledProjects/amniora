import { EventEmitter } from "node:events";
import { randomBytes, verify } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer, type Server, type TlsOptions, type TLSSocket } from "node:tls";
import { ByoRunnerEnrollmentStore, type ByoRunnerEnrollmentRepository } from "./enrollment";
import { ByoBrokerIdentityStore } from "./identity-store";
import {
  BYO_RUNNER_AUDIENCE,
  BYO_RUNNER_COMMAND_TIMEOUT_MS,
  BYO_RUNNER_HANDSHAKE_TIMEOUT_MS,
  BYO_RUNNER_HEARTBEAT_INTERVAL_MS,
  BYO_RUNNER_LIVENESS_TIMEOUT_MS,
  BYO_RUNNER_MAX_MESSAGE_BYTES,
  BYO_RUNNER_PROTOCOL_VERSION,
  BYO_RELAY_REQUEST_TIMEOUT_MS,
  ByoRunnerError,
  ByoRunnerOperationError,
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
  validRuntimeOperation,
  validRuntimeStatus,
  validProof,
  validRunnerId,
  validToken,
  type BrokerRunnerIdentity,
  type ByoRelayHttpRequest,
  type ByoRelayHttpResponse,
  type ByoRunnerErrorCode,
  type ByoRunnerPublicStatus,
  type ByoRunnerRuntimeOperation,
  type ByoRunnerRuntimeStatus,
  type EnrollmentCapability,
  type ServerErrorMessage,
} from "./protocol";

type ConnectionPhase = "initial" | "proof" | "authenticated" | "closing";

type Connection = {
  readonly socket: TLSSocket;
  buffer: Buffer;
  phase: ConnectionPhase;
  identity: BrokerRunnerIdentity | null;
  challenge: Readonly<{ nonce: string; expiresAt: number }> | null;
  lastHeartbeatAt: number | null;
  handshakeTimer: NodeJS.Timeout | null;
  messageQueue: Promise<void>;
};

type PendingOperation = Readonly<{
  runnerId: string;
  operation: ByoRunnerRuntimeOperation;
  resolve: (status: ByoRunnerRuntimeStatus) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}>;

type PendingRelay = Readonly<{
  runnerId: string;
  resolve: (response: ByoRelayHttpResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}>;

export type ByoBrokerOptions = Readonly<{
  tls: Readonly<{ key: string | Buffer; cert: string | Buffer }>;
  identityStore: ByoBrokerIdentityStore;
  enrollmentStore?: ByoRunnerEnrollmentRepository;
  host?: string;
  port?: number;
  now?: () => number;
  heartbeatIntervalMs?: number;
  livenessTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  commandTimeoutMs?: number;
}>;

export class ByoRunnerBroker extends EventEmitter {
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly now: () => number;
  private readonly heartbeatIntervalMs: number;
  private readonly livenessTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly relayCommandTimeoutMs: number;
  private readonly enrollmentStore: ByoRunnerEnrollmentRepository;
  private readonly server: Server;
  private readonly connections = new Set<Connection>();
  private readonly activeSockets = new Map<string, TLSSocket>();
  private readonly statuses = new Map<string, ByoRunnerPublicStatus>();
  private readonly runtimeStatuses = new Map<string, ByoRunnerRuntimeStatus>();
  private readonly pendingOperations = new Map<string, PendingOperation>();
  private readonly pendingRelays = new Map<string, PendingRelay>();
  private boundPort: number | null = null;
  private livenessTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: ByoBrokerOptions) {
    super();
    this.host = options.host ?? "127.0.0.1";
    this.requestedPort = options.port ?? 0;
    this.now = options.now ?? (() => Date.now());
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? BYO_RUNNER_HEARTBEAT_INTERVAL_MS;
    this.livenessTimeoutMs = options.livenessTimeoutMs ?? BYO_RUNNER_LIVENESS_TIMEOUT_MS;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? BYO_RUNNER_HANDSHAKE_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? BYO_RUNNER_COMMAND_TIMEOUT_MS;
    this.relayCommandTimeoutMs = Math.min(this.commandTimeoutMs, BYO_RELAY_REQUEST_TIMEOUT_MS + 5_000);
    this.enrollmentStore = options.enrollmentStore ?? new ByoRunnerEnrollmentStore(this.now);
    if (!Number.isSafeInteger(this.heartbeatIntervalMs) || this.heartbeatIntervalMs < 25 ||
        !Number.isSafeInteger(this.livenessTimeoutMs) || this.livenessTimeoutMs < this.heartbeatIntervalMs * 2 ||
        !Number.isSafeInteger(this.handshakeTimeoutMs) || this.handshakeTimeoutMs < 100 ||
        !Number.isSafeInteger(this.commandTimeoutMs) || this.commandTimeoutMs < 100 || this.commandTimeoutMs > 10 * 60_000) {
      throw new Error("invalid_byo_broker_timing");
    }
    const tlsOptions: TlsOptions = {
      key: options.tls.key,
      cert: options.tls.cert,
      minVersion: "TLSv1.3",
      requestCert: false,
      rejectUnauthorized: false,
    };
    this.server = createServer(tlsOptions, socket => this.accept(socket));
    this.server.on("tlsClientError", () => undefined);
  }

  get address(): Readonly<{ host: string; port: number }> {
    if (this.boundPort === null) throw new ByoRunnerError("BROKER_NOT_READY");
    return { host: this.host, port: this.boundPort };
  }

  issueEnrollment(ownerId: string): EnrollmentCapability {
    const capability = this.enrollmentStore.issue(ownerId);
    if (capability instanceof Promise) throw new ByoRunnerError("BROKER_NOT_READY");
    return capability;
  }

  async issueEnrollmentDurable(ownerId: string): Promise<EnrollmentCapability> {
    return this.enrollmentStore.issue(ownerId);
  }

  status(runnerId: string): ByoRunnerPublicStatus | null {
    const status = this.statuses.get(runnerId);
    return status ? structuredClone(status) : null;
  }

  lastRuntimeStatus(runnerId: string): ByoRunnerRuntimeStatus | null {
    const status = this.runtimeStatuses.get(runnerId);
    return status ? structuredClone(status) : null;
  }

  async launch(input: Readonly<{
    runnerId: string;
    ownerId: string;
    package: unknown;
    idempotencyKey: string;
  }>): Promise<ByoRunnerRuntimeStatus> {
    if (!validIdempotencyKey(input.idempotencyKey)) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    return this.command(input.runnerId, input.ownerId, "launch", {
      idempotencyKey: input.idempotencyKey,
      package: input.package,
    });
  }

  async runtimeStatus(input: Readonly<{ runnerId: string; ownerId: string }>): Promise<ByoRunnerRuntimeStatus> {
    return this.command(input.runnerId, input.ownerId, "status", {});
  }

  async reset(input: Readonly<{
    runnerId: string;
    ownerId: string;
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    idempotencyKey: string;
  }>): Promise<ByoRunnerRuntimeStatus> {
    this.validateLifecycleInput(input);
    return this.command(input.runnerId, input.ownerId, "reset", {
      runtimeId: input.runtimeId,
      buildFingerprint: input.buildFingerprint,
      generation: input.generation,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async stop(input: Readonly<{
    runnerId: string;
    ownerId: string;
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    idempotencyKey: string;
  }>): Promise<ByoRunnerRuntimeStatus> {
    this.validateLifecycleInput(input);
    return this.command(input.runnerId, input.ownerId, "stop", {
      runtimeId: input.runtimeId,
      buildFingerprint: input.buildFingerprint,
      generation: input.generation,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async relayHttp(input: Readonly<{
    runnerId: string;
    ownerId: string;
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    request: ByoRelayHttpRequest;
  }>): Promise<ByoRelayHttpResponse> {
    if (!validRuntimeId(input.runtimeId) || !validFingerprint(input.buildFingerprint) ||
        !Number.isSafeInteger(input.generation) || input.generation < 1 || !validRelayHttpRequest(input.request)) {
      throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    }
    const socket = this.authorizedSocket(input.runnerId, input.ownerId);
    const commandId = `cmd_${randomBytes(32).toString("base64url")}`;
    const encoded = encodeJsonLine({
      type: "command",
      protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
      runnerId: input.runnerId,
      ownerId: input.ownerId,
      commandId,
      operation: "relay_http",
      runtimeId: input.runtimeId,
      buildFingerprint: input.buildFingerprint,
      generation: input.generation,
      request: input.request,
    });
    return new Promise<ByoRelayHttpResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRelays.delete(commandId);
        socket.destroy();
        reject(new ByoRunnerError("RUNNER_COMMAND_TIMEOUT"));
      }, this.relayCommandTimeoutMs);
      this.pendingRelays.set(commandId, { runnerId: input.runnerId, resolve, reject, timer });
      socket.write(encoded, error => {
        if (!error) return;
        const pending = this.pendingRelays.get(commandId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingRelays.delete(commandId);
        pending.reject(new ByoRunnerError("RUNNER_NOT_CONNECTED"));
      });
    });
  }

  async listen(): Promise<Readonly<{ host: string; port: number }>> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.requestedPort, this.host);
    });
    const address = this.server.address() as AddressInfo | null;
    if (!address || address.address !== this.host) {
      await this.close();
      throw new ByoRunnerError("BROKER_NOT_READY");
    }
    this.boundPort = address.port;
    this.livenessTimer = setInterval(() => this.checkLiveness(), Math.max(25, Math.floor(this.heartbeatIntervalMs / 2)));
    this.livenessTimer.unref();
    return this.address;
  }

  async close(): Promise<void> {
    if (this.livenessTimer) clearInterval(this.livenessTimer);
    this.livenessTimer = null;
    for (const connection of this.connections) connection.socket.destroy();
    this.connections.clear();
    this.activeSockets.clear();
    for (const pending of this.pendingOperations.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ByoRunnerError("RUNNER_NOT_CONNECTED"));
    }
    this.pendingOperations.clear();
    for (const pending of this.pendingRelays.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ByoRunnerError("RUNNER_NOT_CONNECTED"));
    }
    this.pendingRelays.clear();
    this.boundPort = null;
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
  }

  private accept(socket: TLSSocket): void {
    socket.setNoDelay(true);
    const connection: Connection = {
      socket,
      buffer: Buffer.alloc(0),
      phase: "initial",
      identity: null,
      challenge: null,
      lastHeartbeatAt: null,
      handshakeTimer: null,
      messageQueue: Promise.resolve(),
    };
    this.connections.add(connection);
    connection.handshakeTimer = setTimeout(() => this.fail(connection, new ByoRunnerError("CONNECTION_FAILED")), this.handshakeTimeoutMs);
    connection.handshakeTimer.unref();
    socket.on("data", chunk => this.receive(connection, chunk));
    socket.on("error", () => undefined);
    socket.on("close", () => this.closed(connection));
  }

  private receive(connection: Connection, chunk: Buffer): void {
    if (connection.phase === "closing") return;
    connection.buffer = Buffer.concat([connection.buffer, chunk]);
    if (connection.buffer.length > BYO_RUNNER_MAX_MESSAGE_BYTES && connection.buffer.indexOf(0x0a) === -1) {
      this.fail(connection, new ByoRunnerError("PROTOCOL_MESSAGE_INVALID"));
      return;
    }
    for (;;) {
      const newline = connection.buffer.indexOf(0x0a);
      if (newline === -1) break;
      const line = connection.buffer.subarray(0, newline);
      connection.buffer = connection.buffer.subarray(newline + 1);
      connection.messageQueue = connection.messageQueue
        .then(() => this.handle(connection, parseJsonLine(line)))
        .catch(error => this.fail(connection, error));
    }
  }

  private async handle(connection: Connection, input: unknown): Promise<void> {
    if (connection.phase === "closing") return;
    if (!isPlainObject(input) || typeof input.type !== "string") throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    if (input.protocolVersion !== BYO_RUNNER_PROTOCOL_VERSION) throw new ByoRunnerError("PROTOCOL_VERSION_UNSUPPORTED");
    if (connection.phase === "initial" && input.type === "enroll") return this.enroll(connection, input);
    if (connection.phase === "initial" && input.type === "reconnect") return this.reconnect(connection, input);
    if (connection.phase === "proof" && input.type === "proof") return this.prove(connection, input);
    if (connection.phase === "authenticated" && input.type === "heartbeat") return this.heartbeat(connection, input);
    if (connection.phase === "authenticated" && input.type === "operation_result") return this.operationResult(connection, input);
    if (connection.phase === "authenticated" && input.type === "relay_result") return this.relayResult(connection, input);
    throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
  }

  private async enroll(connection: Connection, input: Record<string, unknown>): Promise<void> {
    if (!hasExactKeys(input, [
      "type", "protocolVersion", "audience", "ownerId", "enrollmentToken", "publicKey", "proofNonce", "proof",
    ]) || input.audience !== BYO_RUNNER_AUDIENCE || !validOwnerId(input.ownerId) || !validToken(input.enrollmentToken) ||
        !validNonce(input.proofNonce) || !validProof(input.proof)) {
      if (input.audience !== BYO_RUNNER_AUDIENCE) throw new ByoRunnerError("AUDIENCE_MISMATCH");
      throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    }
    const publicKey = requireEd25519PublicKey(input.publicKey);
    const canonical = canonicalPublicKey(publicKey);
    if (canonical !== input.publicKey || !verify(null, enrollmentProofBytes({
      audience: BYO_RUNNER_AUDIENCE,
      ownerId: input.ownerId,
      protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
      publicKey: canonical,
      proofNonce: input.proofNonce,
      enrollmentDigest: enrollmentTokenDigest(input.enrollmentToken),
    }), publicKey, Buffer.from(input.proof, "base64url"))) throw new ByoRunnerError("PROOF_INVALID");

    await this.enrollmentStore.consume(input.enrollmentToken, input.ownerId, input.audience);
    const now = this.now();
    const identity: BrokerRunnerIdentity = {
      runnerId: `rnr_${randomBytes(32).toString("base64url")}`,
      ownerId: input.ownerId,
      audience: BYO_RUNNER_AUDIENCE,
      protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
      publicKey: canonical,
      createdAt: now,
      lastSeenAt: now,
    };
    await this.options.identityStore.create(identity);
    this.authenticate(connection, identity);
  }

  private async reconnect(connection: Connection, input: Record<string, unknown>): Promise<void> {
    if (!hasExactKeys(input, ["type", "protocolVersion", "audience", "ownerId", "runnerId"]) ||
        input.audience !== BYO_RUNNER_AUDIENCE || !validOwnerId(input.ownerId) || !validRunnerId(input.runnerId)) {
      if (input.audience !== BYO_RUNNER_AUDIENCE) throw new ByoRunnerError("AUDIENCE_MISMATCH");
      throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    }
    const identity = await this.options.identityStore.get(input.runnerId);
    if (!identity) throw new ByoRunnerError("RUNNER_IDENTITY_NOT_FOUND");
    if (identity.ownerId !== input.ownerId) throw new ByoRunnerError("OWNER_MISMATCH");
    if (identity.audience !== input.audience) throw new ByoRunnerError("AUDIENCE_MISMATCH");
    const nonce = randomBytes(24).toString("base64url");
    const expiresAt = this.now() + this.handshakeTimeoutMs;
    connection.identity = identity;
    connection.challenge = { nonce, expiresAt };
    connection.phase = "proof";
    connection.socket.write(encodeJsonLine({
      type: "challenge",
      protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
      runnerId: identity.runnerId,
      nonce,
      expiresAt,
    }));
  }

  private async prove(connection: Connection, input: Record<string, unknown>): Promise<void> {
    const identity = connection.identity;
    const challenge = connection.challenge;
    if (!identity || !challenge || !hasExactKeys(input, ["type", "protocolVersion", "runnerId", "nonce", "proof"]) ||
        input.runnerId !== identity.runnerId || input.nonce !== challenge.nonce || !validProof(input.proof) ||
        this.now() >= challenge.expiresAt || !verify(null, reconnectProofBytes({
          audience: identity.audience,
          ownerId: identity.ownerId,
          protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
          runnerId: identity.runnerId,
          nonce: challenge.nonce,
        }), requireEd25519PublicKey(identity.publicKey), Buffer.from(input.proof, "base64url"))) {
      throw new ByoRunnerError("PROOF_INVALID");
    }
    await this.options.identityStore.touch(identity.runnerId, this.now());
    this.authenticate(connection, { ...identity, lastSeenAt: this.now() });
  }

  private authenticate(connection: Connection, identity: BrokerRunnerIdentity): void {
    if (connection.handshakeTimer) clearTimeout(connection.handshakeTimer);
    connection.handshakeTimer = null;
    connection.phase = "authenticated";
    connection.identity = identity;
    connection.challenge = null;
    connection.lastHeartbeatAt = this.now();
    const previous = this.activeSockets.get(identity.runnerId);
    this.activeSockets.set(identity.runnerId, connection.socket);
    if (previous && previous !== connection.socket) previous.destroy();
    const current = this.statuses.get(identity.runnerId);
    const status: ByoRunnerPublicStatus = {
      runnerId: identity.runnerId,
      ownerId: identity.ownerId,
      connected: true,
      connectionCount: (current?.connectionCount ?? 0) + 1,
      lastConnectedAt: this.now(),
      lastHeartbeatAt: current?.lastHeartbeatAt ?? null,
      lastDisconnectedAt: current?.lastDisconnectedAt ?? null,
    };
    this.statuses.set(identity.runnerId, status);
    connection.socket.write(encodeJsonLine({
      type: "ready",
      protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
      runnerId: identity.runnerId,
      ownerId: identity.ownerId,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
    }));
    this.emit("connected", structuredClone(status));
  }

  private async heartbeat(connection: Connection, input: Record<string, unknown>): Promise<void> {
    const identity = connection.identity;
    if (!identity || !hasExactKeys(input, ["type", "protocolVersion", "runnerId", "sequence", "sentAt"]) ||
        input.runnerId !== identity.runnerId || !Number.isSafeInteger(input.sequence) || Number(input.sequence) < 0 ||
        !Number.isSafeInteger(input.sentAt)) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    const receivedAt = this.now();
    connection.lastHeartbeatAt = receivedAt;
    const current = this.statuses.get(identity.runnerId);
    if (current) this.statuses.set(identity.runnerId, { ...current, lastHeartbeatAt: receivedAt });
    await this.options.identityStore.touch(identity.runnerId, receivedAt);
    connection.socket.write(encodeJsonLine({
      type: "heartbeat_ack",
      protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
      runnerId: identity.runnerId,
      sequence: Number(input.sequence),
      receivedAt,
    }));
    this.emit("heartbeat", this.status(identity.runnerId));
  }

  private operationResult(connection: Connection, input: Record<string, unknown>): void {
    const identity = connection.identity;
    if (!identity || !hasExactKeys(input, [
      "type", "protocolVersion", "runnerId", "commandId", "operation", "ok", "status", "errorCode",
    ]) || input.runnerId !== identity.runnerId || !validCommandId(input.commandId) || !validRuntimeOperation(input.operation) ||
        typeof input.ok !== "boolean") throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    const pending = this.pendingOperations.get(input.commandId);
    if (!pending || pending.runnerId !== identity.runnerId || pending.operation !== input.operation) {
      throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    }
    if (input.ok) {
      if (input.errorCode !== null || !validRuntimeStatus(input.status) || input.status.runnerId !== identity.runnerId) {
        throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
      }
    } else if (input.status !== null || !validOperationErrorCode(input.errorCode)) {
      throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    }
    clearTimeout(pending.timer);
    this.pendingOperations.delete(input.commandId);
    if (input.ok) {
      this.runtimeStatuses.set(identity.runnerId, input.status as ByoRunnerRuntimeStatus);
      this.emit("runtime_status", structuredClone(input.status));
      pending.resolve(structuredClone(input.status) as ByoRunnerRuntimeStatus);
    } else {
      pending.reject(new ByoRunnerOperationError(input.errorCode as ByoRunnerOperationError["code"]));
    }
  }

  private relayResult(connection: Connection, input: Record<string, unknown>): void {
    const identity = connection.identity;
    if (!identity || !hasExactKeys(input, [
      "type", "protocolVersion", "runnerId", "commandId", "operation", "ok", "response", "errorCode",
    ]) || input.runnerId !== identity.runnerId || !validCommandId(input.commandId) || input.operation !== "relay_http" ||
        typeof input.ok !== "boolean") throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    const pending = this.pendingRelays.get(input.commandId);
    if (!pending || pending.runnerId !== identity.runnerId) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    if (input.ok) {
      if (input.errorCode !== null || !validRelayHttpResponse(input.response)) {
        throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
      }
    } else if (input.response !== null || !validOperationErrorCode(input.errorCode)) {
      throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    }
    clearTimeout(pending.timer);
    this.pendingRelays.delete(input.commandId);
    if (input.ok) pending.resolve(structuredClone(input.response) as ByoRelayHttpResponse);
    else pending.reject(new ByoRunnerOperationError(input.errorCode as ByoRunnerOperationError["code"]));
  }

  private validateLifecycleInput(input: Readonly<{
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    idempotencyKey: string;
  }>): void {
    if (!validRuntimeId(input.runtimeId) || !validFingerprint(input.buildFingerprint) ||
        !Number.isSafeInteger(input.generation) || input.generation < 1 || !validIdempotencyKey(input.idempotencyKey)) {
      throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    }
  }

  private command(
    runnerId: string,
    ownerId: string,
    operation: ByoRunnerRuntimeOperation,
    detail: Record<string, unknown>,
  ): Promise<ByoRunnerRuntimeStatus> {
    const socket = this.authorizedSocket(runnerId, ownerId);
    const commandId = `cmd_${randomBytes(32).toString("base64url")}`;
    const encoded = encodeJsonLine({
      type: "command",
      protocolVersion: BYO_RUNNER_PROTOCOL_VERSION,
      runnerId,
      ownerId,
      commandId,
      operation,
      ...detail,
    });
    return new Promise<ByoRunnerRuntimeStatus>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOperations.delete(commandId);
        socket.destroy();
        reject(new ByoRunnerError("RUNNER_COMMAND_TIMEOUT"));
      }, this.commandTimeoutMs);
      this.pendingOperations.set(commandId, { runnerId, operation, resolve, reject, timer });
      socket.write(encoded, error => {
        if (!error) return;
        const pending = this.pendingOperations.get(commandId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingOperations.delete(commandId);
        pending.reject(new ByoRunnerError("RUNNER_NOT_CONNECTED"));
      });
    });
  }

  private authorizedSocket(runnerId: string, ownerId: string): TLSSocket {
    if (!validRunnerId(runnerId) || !validOwnerId(ownerId)) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
    const publicStatus = this.statuses.get(runnerId);
    if (!publicStatus) throw new ByoRunnerError("RUNNER_IDENTITY_NOT_FOUND");
    if (publicStatus.ownerId !== ownerId) throw new ByoRunnerError("OWNER_MISMATCH");
    const socket = this.activeSockets.get(runnerId);
    if (!socket || socket.destroyed || !publicStatus.connected) throw new ByoRunnerError("RUNNER_NOT_CONNECTED");
    return socket;
  }

  private checkLiveness(): void {
    const now = this.now();
    for (const connection of this.connections) {
      if (connection.phase === "authenticated" && connection.lastHeartbeatAt !== null &&
          now - connection.lastHeartbeatAt > this.livenessTimeoutMs) connection.socket.destroy();
    }
  }

  private fail(connection: Connection, error: unknown): void {
    if (connection.phase === "closing") return;
    connection.phase = "closing";
    const code: ByoRunnerErrorCode = error instanceof ByoRunnerError ? error.code : "INTERNAL_ERROR";
    this.emit("rejected", { code });
    const message: ServerErrorMessage = { type: "error", protocolVersion: BYO_RUNNER_PROTOCOL_VERSION, code };
    connection.socket.end(encodeJsonLine(message));
  }

  private closed(connection: Connection): void {
    if (connection.handshakeTimer) clearTimeout(connection.handshakeTimer);
    this.connections.delete(connection);
    const runnerId = connection.identity?.runnerId;
    if (!runnerId || this.activeSockets.get(runnerId) !== connection.socket) return;
    this.activeSockets.delete(runnerId);
    for (const [commandId, pending] of this.pendingOperations) {
      if (pending.runnerId !== runnerId) continue;
      clearTimeout(pending.timer);
      this.pendingOperations.delete(commandId);
      pending.reject(new ByoRunnerError("RUNNER_NOT_CONNECTED"));
    }
    for (const [commandId, pending] of this.pendingRelays) {
      if (pending.runnerId !== runnerId) continue;
      clearTimeout(pending.timer);
      this.pendingRelays.delete(commandId);
      pending.reject(new ByoRunnerError("RUNNER_NOT_CONNECTED"));
    }
    const current = this.statuses.get(runnerId);
    if (!current) return;
    const status = { ...current, connected: false, lastDisconnectedAt: this.now() };
    this.statuses.set(runnerId, status);
    this.emit("disconnected", structuredClone(status));
  }
}
