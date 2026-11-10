import { readFile } from "node:fs/promises";
import { ByoRunnerIdentityStore } from "./identity-store";
import { ByoRunnerClient } from "./runner";

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

export async function runByoRunnerCli(): Promise<void> {
  if (process.argv[2] !== "serve" || process.argv.length !== 3) {
    throw new Error("Usage: npm run byo-runner -- serve");
  }
  const port = Number(requiredEnvironment("AMNIORA_BYO_BROKER_PORT"));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("invalid_broker_port");
  const stateDirectory = requiredEnvironment("AMNIORA_BYO_STATE_DIR");
  let token = await enrollmentToken();
  const client = new ByoRunnerClient({
    endpoint: {
      host: requiredEnvironment("AMNIORA_BYO_BROKER_HOST"),
      port,
      serverName: requiredEnvironment("AMNIORA_BYO_BROKER_SERVER_NAME"),
      ca: await readFile(requiredEnvironment("AMNIORA_BYO_BROKER_CA_PATH")),
    },
    ownerId: requiredEnvironment("AMNIORA_BYO_OWNER_ID"),
    identityStore: new ByoRunnerIdentityStore(stateDirectory),
    ...(token ? { enrollmentToken: token } : {}),
  });
  token = undefined;
  client.on("connected", status => safeEvent("connected", status));
  client.on("heartbeat", status => safeEvent("heartbeat", status));
  client.on("disconnected", status => safeEvent("disconnected", status));
  await client.start();
  await new Promise<void>(resolve => {
    const stop = () => { void client.stop().finally(resolve); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
