import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, connect, type ConnectionOptions, type Server, type TLSSocket } from "node:tls";
import type { AddressInfo } from "node:net";
import type { DesktopGuestTrustStore, DiskGuestIdentityStore, SigningIdentity } from "./identity";
import { JsonLineChannel } from "./framing";
import {
  DesktopPairingAuthority,
  createGuestPairingRequest,
  decodePairingCode,
  encodePairingCode,
  verifyPairingAccept,
  type DesktopGuestTrust,
} from "./pairing";
import {
  GUEST_CHANNEL_PORT,
  GUEST_HANDSHAKE_TIMEOUT_MS,
  GUEST_HOST_ADDRESS,
  GUEST_PAIRING_CIPHER,
  GUEST_PAIRING_PORT,
  GUEST_PROTOCOL_VERSION,
  GUEST_REQUEST_TIMEOUT_MS,
  GUEST_VM_ADDRESS,
  GuestChannelError,
  certificateFingerprint,
  requireGuestRequest,
  validGuestResponse,
  validHostOnlyAddress,
  type GuestRequest,
  type GuestResponse,
  type GuestOperation,
} from "./protocol";
import { createClientProof, GuestSessionAuthority, verifyServerChallenge, type GuestRuntimeOperationHandler } from "./session";
import type { GuestStatusProvider } from "./status";

export type ListeningPairingServer = Readonly<{
  pairingCode: string;
  pairingId: string;
  expiresAt: number;
  port: number;
  close(): Promise<void>;
  paired: Promise<DesktopGuestTrust>;
}>;

function remoteMatches(socket: TLSSocket, expected: string): boolean {
  return socket.remoteAddress === expected || socket.remoteAddress === `::ffff:${expected}`;
}

function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GuestChannelError("TIMEOUT")), milliseconds);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

async function listen(server: Server, host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => { server.off("listening", ready); reject(error); };
    const ready = () => { server.off("error", failed); resolve(); };
    server.once("error", failed);
    server.once("listening", ready);
    server.listen({ host, port, backlog: 4, exclusive: true });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>(resolve => server.close(() => resolve()));
}

export async function startDesktopPairingServer(input: Readonly<{
  identity: SigningIdentity;
  trustStore: DesktopGuestTrustStore;
  bindAddress?: string;
  port?: number;
  now?: () => number;
  ttlMs?: number;
}>): Promise<ListeningPairingServer> {
  const bindAddress = input.bindAddress ?? GUEST_HOST_ADDRESS;
  if (!validHostOnlyAddress(bindAddress, "host") && bindAddress !== "127.0.0.1") throw new GuestChannelError("TRANSPORT_DENIED");
  const authority = new DesktopPairingAuthority(input.identity, input.now, input.ttlMs);
  const offer = authority.begin();
  let resolvePaired!: (value: DesktopGuestTrust) => void;
  let rejectPaired!: (error: Error) => void;
  const paired = new Promise<DesktopGuestTrust>((resolve, reject) => { resolvePaired = resolve; rejectPaired = reject; });
  const expectedPsk = Buffer.from(offer.secret, "base64url");
  const server = createServer({
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.2",
    ciphers: GUEST_PAIRING_CIPHER,
    dhparam: "auto",
    pskCallback: (_socket, identity) => identity === offer.pairingId ? expectedPsk : null,
  }, socket => {
    if (!remoteMatches(socket, bindAddress === "127.0.0.1" ? "127.0.0.1" : GUEST_VM_ADDRESS)) {
      socket.destroy();
      return;
    }
    const channel = new JsonLineChannel(socket);
    void timeout(channel.next(), GUEST_HANDSHAKE_TIMEOUT_MS).then(async message => {
      authority.authenticate(offer.pairingId, offer.secret);
      const completed = await authority.complete(message);
      channel.send(completed.accept);
      await input.trustStore.save(completed.trust);
      expectedPsk.fill(0);
      resolvePaired(completed.trust);
      await closeServer(server);
    }).catch(error => {
      channel.close();
      rejectPaired(error instanceof Error ? error : new GuestChannelError("PAIRING_INVALID"));
    });
  });
  await listen(server, bindAddress, input.port ?? GUEST_PAIRING_PORT);
  const address = server.address() as AddressInfo;
  return Object.freeze({ pairingCode: encodePairingCode(offer), pairingId: offer.pairingId, expiresAt: offer.expiresAt,
    port: address.port, close: async () => { expectedPsk.fill(0); await closeServer(server); }, paired });
}

export async function pairGuestToDesktop(input: Readonly<{
  identityStore: DiskGuestIdentityStore;
  pairingCode: string;
  desktopAddress?: string;
  port?: number;
  now?: () => number;
}>): Promise<Readonly<{ desktopId: string; desktopFingerprint: string; guestFingerprint: string }>> {
  const desktopAddress = input.desktopAddress ?? GUEST_HOST_ADDRESS;
  if (!validHostOnlyAddress(desktopAddress, "host") && desktopAddress !== "127.0.0.1") throw new GuestChannelError("TRANSPORT_DENIED");
  const offer = decodePairingCode(input.pairingCode);
  const identity = await input.identityStore.loadOrCreate();
  const request = await createGuestPairingRequest(identity, offer);
  const psk = Buffer.from(offer.secret, "base64url");
  const socket = connect({
    host: desktopAddress,
    localAddress: desktopAddress === "127.0.0.1" ? "127.0.0.1" : GUEST_VM_ADDRESS,
    port: input.port ?? GUEST_PAIRING_PORT,
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.2",
    ciphers: GUEST_PAIRING_CIPHER,
    rejectUnauthorized: false,
    pskCallback: () => ({ identity: offer.pairingId, psk }),
  } as ConnectionOptions & Readonly<{ localAddress: string }>);
  const channel = new JsonLineChannel(socket);
  try {
    await timeout(new Promise<void>((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    }), GUEST_HANDSHAKE_TIMEOUT_MS);
    channel.send(request);
    const accept = verifyPairingAccept(request, await timeout(channel.next(), GUEST_HANDSHAKE_TIMEOUT_MS), input.now?.());
    const record = await input.identityStore.savePairing(accept, identity.publicKey);
    return Object.freeze({ desktopId: record.desktopId, desktopFingerprint: publicKeyFingerprintSafe(record.desktopPublicKey),
      guestFingerprint: publicKeyFingerprintSafe(identity.publicKey) });
  } finally {
    psk.fill(0);
    channel.close();
  }
}

function publicKeyFingerprintSafe(publicKey: string): string {
  return createHash("sha256").update(publicKeyDer(publicKey)).digest("hex");
}

function publicKeyDer(publicKey: string): Buffer {
  return createPublicKey(publicKey).export({ type: "spki", format: "der" });
}

export async function startGuestChannelServer(input: Readonly<{
  identityStore: DiskGuestIdentityStore;
  statusProvider: GuestStatusProvider;
  runtimeController?: GuestRuntimeOperationHandler;
  bindAddress?: string;
  port?: number;
}>): Promise<Readonly<{ address: string; port: number; close(): Promise<void> }>> {
  const bindAddress = input.bindAddress ?? GUEST_VM_ADDRESS;
  if (!validHostOnlyAddress(bindAddress, "guest") && bindAddress !== "127.0.0.1") throw new GuestChannelError("TRANSPORT_DENIED");
  const [identity, pairing] = await Promise.all([input.identityStore.loadOrCreate(), input.identityStore.loadPairing()]);
  const authority = new GuestSessionAuthority(identity, pairing, input.statusProvider, Date.now, input.runtimeController);
  const server = createServer({
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    key: await readFile(identity.privateKeyPath),
    cert: identity.certificate,
    requestCert: false,
  }, socket => {
    if (!remoteMatches(socket, bindAddress === "127.0.0.1" ? "127.0.0.1" : GUEST_HOST_ADDRESS)) {
      socket.destroy();
      return;
    }
    const channel = new JsonLineChannel(socket);
    let session: ReturnType<GuestSessionAuthority["authenticate"]> | null = null;
    void (async () => {
      channel.send(await authority.challenge());
      session = authority.authenticate(await timeout(channel.next(), GUEST_HANDSHAKE_TIMEOUT_MS));
      for (;;) channel.send(await authority.execute(session, await timeout(channel.next(), GUEST_REQUEST_TIMEOUT_MS)));
    })().catch(() => channel.close()).finally(() => { if (session) authority.close(session); });
  });
  await listen(server, bindAddress, input.port ?? GUEST_CHANNEL_PORT);
  const address = server.address() as AddressInfo;
  return Object.freeze({ address: bindAddress, port: address.port, close: () => closeServer(server) });
}

export class RunnerGuestClient {
  private channel: JsonLineChannel | null = null;
  private socket: TLSSocket | null = null;
  private session: Readonly<{ sessionId: string; generation: number }> | null = null;
  private sequence = 1;

  constructor(
    private readonly identity: SigningIdentity,
    private readonly trust: DesktopGuestTrust,
    private readonly guestAddress: string = GUEST_VM_ADDRESS,
    private readonly port: number = GUEST_CHANNEL_PORT,
  ) {}

  async connect(): Promise<void> {
    if (!validHostOnlyAddress(this.guestAddress, "guest") && this.guestAddress !== "127.0.0.1") {
      throw new GuestChannelError("TRANSPORT_DENIED");
    }
    const socket = connect({ host: this.guestAddress,
      localAddress: this.guestAddress === "127.0.0.1" ? "127.0.0.1" : GUEST_HOST_ADDRESS,
      port: this.port, minVersion: "TLSv1.3", maxVersion: "TLSv1.3",
      ca: this.trust.guestCertificate, rejectUnauthorized: true } as ConnectionOptions & Readonly<{ localAddress: string }>);
    try {
      await timeout(new Promise<void>((resolve, reject) => {
        socket.once("secureConnect", resolve);
        socket.once("error", reject);
      }), GUEST_HANDSHAKE_TIMEOUT_MS);
      const peer = socket.getPeerCertificate();
      if (!peer.raw || certificateFingerprint(peer.raw) !== this.trust.guestCertificateFingerprint) {
        throw new GuestChannelError("PEER_NOT_PAIRED");
      }
      const channel = new JsonLineChannel(socket);
      const challenge = verifyServerChallenge(await timeout(channel.next(), GUEST_HANDSHAKE_TIMEOUT_MS), this.trust.guestPublicKey);
      channel.send(await createClientProof(this.identity, challenge));
      this.socket = socket;
      this.channel = channel;
      this.session = { sessionId: challenge.sessionId, generation: challenge.generation };
      this.sequence = 1;
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }

  async request(operation: GuestOperation, input?: unknown, requestId = `greq_${randomOpaque()}`): Promise<GuestResponse> {
    if (!this.channel || !this.session) throw new GuestChannelError("SESSION_STALE");
    const request: GuestRequest = Object.freeze({ type: "REQUEST", protocolVersion: GUEST_PROTOCOL_VERSION,
      sessionId: this.session.sessionId, generation: this.session.generation, sequence: this.sequence,
      requestId, operation, sentAt: Date.now(), ...(["LAUNCH", "RESET", "STOP", "DIAGNOSTIC_PROBE", "RELAY_HTTP"].includes(operation)
        ? { input } : {}) });
    requireGuestRequest(request, true);
    this.channel.send(request);
    const response = await timeout(this.channel.next(), GUEST_REQUEST_TIMEOUT_MS);
    if (!validGuestResponse(response) || response.sessionId !== request.sessionId || response.generation !== request.generation ||
        response.sequence !== request.sequence || response.requestId !== request.requestId || response.operation !== operation) {
      throw new GuestChannelError("MESSAGE_INVALID");
    }
    this.sequence += 1;
    return response;
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.socket = null;
    this.session = null;
  }
}

function randomOpaque(): string {
  return randomBytes(32).toString("base64url");
}
