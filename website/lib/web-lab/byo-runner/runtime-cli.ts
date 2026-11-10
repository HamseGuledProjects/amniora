import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LocalRunnerCore } from "../local-runner/core";
import { DockerLocalRunnerBackend } from "../local-runner/docker-backend";
import { validOpaqueId } from "../local-runner/protocol";
import { LocalRunnerStateStore } from "../local-runner/state-store";
import { ByoBootstrapReporter } from "./bootstrap-state";
import { ByoRunnerIdentityStore } from "./identity-store";
import { hasExactKeys, isPlainObject } from "./protocol";
import { ByoRunnerClient } from "./runner";
import { ByoRunnerRuntimeController } from "./runtime-controller";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function safeEvent(event: string, value: unknown): void {
  process.stdout.write(`${JSON.stringify({ event, value })}\n`);
}

async function enrollmentToken(): Promise<string | undefined> {
  const fromEnvironment = process.env.AMNIORA_BYO_ENROLLMENT_TOKEN;
  delete process.env.AMNIORA_BYO_ENROLLMENT_TOKEN;
  if (fromEnvironment) return fromEnvironment;
  if (process.env.AMNIORA_BYO_ENROLLMENT_STDIN !== "1") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 128) throw new Error("invalid_enrollment_token");
    chunks.push(bytes);
  }
  const token = Buffer.concat(chunks).toString("utf8").trim();
  return token || undefined;
}

async function verificationKeys(): Promise<Map<string, ReturnType<typeof createPublicKey>>> {
  const source = await readFile(requiredEnvironment("AMNIORA_BYO_VERIFICATION_KEYS_PATH"), "utf8");
  if (Buffer.byteLength(source, "utf8") > 64 * 1_024) throw new Error("invalid_verification_keys");
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error("invalid_verification_keys"); }
  if (!isPlainObject(parsed) || !hasExactKeys(parsed, ["schemaVersion", "keys"]) || parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.keys) || parsed.keys.length < 1 || parsed.keys.length > 8) {
    throw new Error("invalid_verification_keys");
  }
  const keys = new Map<string, ReturnType<typeof createPublicKey>>();
  for (const candidate of parsed.keys) {
    if (!isPlainObject(candidate) || !hasExactKeys(candidate, ["keyId", "publicKey"]) ||
        !validOpaqueId(candidate.keyId, 64) || typeof candidate.publicKey !== "string" || keys.has(candidate.keyId)) {
      throw new Error("invalid_verification_keys");
    }
    const key = createPublicKey(candidate.publicKey);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid_verification_keys");
    keys.set(candidate.keyId, key);
  }
  return keys;
}

export async function runByoRuntimeCli(): Promise<void> {
  if (process.argv[2] !== "serve" || process.argv.length !== 3) {
    throw new Error("Usage: npm run byo-runner -- serve");
  }
  const port = Number(requiredEnvironment("AMNIORA_BYO_BROKER_PORT"));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("invalid_broker_port");
  const stateDirectory = requiredEnvironment("AMNIORA_BYO_STATE_DIR");
  const bootstrapDiagnostics = process.env.AMNIORA_BYO_BOOTSTRAP_DIAGNOSTICS === "1";
  delete process.env.AMNIORA_BYO_BOOTSTRAP_DIAGNOSTICS;
  const bootstrap = new ByoBootstrapReporter(stateDirectory, bootstrapDiagnostics);
  await bootstrap.report("PROCESS_ALIVE");
  try {
    const runtimeDirectory = path.join(stateDirectory, "runtime");
    const identityStore = new ByoRunnerIdentityStore(stateDirectory);
    const existingIdentity = await identityStore.read();
    const ownerId = existingIdentity?.ownerId ?? requiredEnvironment("AMNIORA_BYO_OWNER_ID");
    const architecture = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
    if (!architecture) throw new Error("unsupported_runner_architecture");
    const backend = new DockerLocalRunnerBackend(
      undefined,
      runtimeDirectory,
      requiredEnvironment("AMNIORA_BYO_RUNTIME_CONTAINER_CONTEXT"),
      stage => safeEvent("runtime_failure", { stage }),
    );
    const operations = new ByoRunnerRuntimeController(new LocalRunnerCore({
      verificationKeys: await verificationKeys(),
      backend,
      stateStore: new LocalRunnerStateStore(runtimeDirectory),
      supportedPlatforms: [{ platform: "linux", architecture }],
      recreateMissingRuntimeOnRecover: true,
    }));
    let token = await enrollmentToken();
    const client = new ByoRunnerClient({
      endpoint: {
        host: requiredEnvironment("AMNIORA_BYO_BROKER_HOST"),
        port,
        serverName: requiredEnvironment("AMNIORA_BYO_BROKER_SERVER_NAME"),
        ca: await readFile(requiredEnvironment("AMNIORA_BYO_BROKER_CA_PATH")),
      },
      ownerId,
      identityStore,
      operations,
      ...(token ? { enrollmentToken: token } : {}),
    });
    token = undefined;
    await bootstrap.report("RUNNER_STARTED");
    client.on("connected", status => safeEvent("connected", status));
    client.on("heartbeat", status => safeEvent("heartbeat", status));
    client.on("disconnected", status => safeEvent("disconnected", status));
    client.on("operation", status => safeEvent("operation", status));
    await bootstrap.report("TRANSPORT_CONNECTING");
    await client.start();
    await bootstrap.report("CONNECTED");
    await new Promise<void>(resolve => {
      const stop = () => { void client.stop().finally(resolve); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  } catch (error) {
    await bootstrap.fail(bootstrap.failureClassification(error)).catch(() => undefined);
    throw error;
  }
}
