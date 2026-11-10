import { randomBytes } from "node:crypto";
import { DockerLocalRunnerBackend, defaultLocalRunnerStateDirectory } from "./docker-backend";
import { LocalRunnerCore } from "./core";
import { LocalRunnerStateStore } from "./state-store";
import {
  LOCAL_RUNNER_CONTROL_HOST,
  LOCAL_RUNNER_CONTROL_PORT,
  LocalRunnerError,
  type RunnerPublicStatus,
} from "./protocol";
import { LocalRunnerControlServer, LOCAL_RUNNER_PRODUCT_ORIGINS } from "./server";

function environmentOrigins(): string[] {
  const configured = process.env.AMNIORA_LOCAL_RUNNER_ALLOWED_ORIGINS;
  return configured ? configured.split(",").map(value => value.trim()).filter(Boolean) : [];
}

function verificationKeys(): ReadonlyMap<string, string> {
  const keyId = process.env.AMNIORA_LOCAL_RUNNER_KEY_ID;
  const publicKey = process.env.AMNIORA_LOCAL_RUNNER_PUBLIC_KEY;
  return keyId && publicKey ? new Map([[keyId, publicKey.replaceAll("\\n", "\n")]]) : new Map();
}

function core(): LocalRunnerCore {
  const directory = defaultLocalRunnerStateDirectory();
  return new LocalRunnerCore({
    verificationKeys: verificationKeys(),
    backend: new DockerLocalRunnerBackend(undefined, directory),
    stateStore: new LocalRunnerStateStore(directory),
  });
}

async function request(pathname: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`http://${LOCAL_RUNNER_CONTROL_HOST}:${LOCAL_RUNNER_CONTROL_PORT}${pathname}`, {
    ...init,
    headers: { Origin: LOCAL_RUNNER_PRODUCT_ORIGINS[0], ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json() as { data: unknown; error: { code: string } | null };
  if (!response.ok || body.error) throw new Error(body.error?.code ?? "RUNNER_NOT_READY");
  return body.data;
}

async function serve(): Promise<void> {
  const runner = core();
  const server = new LocalRunnerControlServer({
    core: runner,
    allowedOrigins: [...LOCAL_RUNNER_PRODUCT_ORIGINS, ...environmentOrigins()],
  });
  await runner.recover();
  await runner.reconcileOrphans();
  const origin = await server.listen();
  process.stdout.write(`Amniora Local Runner ${origin}\n`);
  const shutdown = async () => {
    await server.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
}

async function doctor(): Promise<void> {
  process.stdout.write(JSON.stringify(await core().capabilities(), null, 2) + "\n");
}

async function status(): Promise<void> {
  process.stdout.write(JSON.stringify(await request("/v1/status"), null, 2) + "\n");
}

async function stop(): Promise<void> {
  const current = await request("/v1/status") as RunnerPublicStatus;
  if (!current.sessionId || !current.buildFingerprint || !current.generation || current.state === "idle") {
    process.stdout.write(JSON.stringify(current, null, 2) + "\n");
    return;
  }
  const authorization = await request("/v1/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: "stop",
      sessionId: current.sessionId,
      buildFingerprint: current.buildFingerprint,
      generation: current.generation,
      idempotencyKey: randomBytes(18).toString("base64url"),
    }),
  }) as { capability: string };
  const result = await request("/v1/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability: authorization.capability }),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

export async function runLocalRunnerCli(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0] ?? "doctor";
  if (command === "doctor") return doctor();
  if (command === "serve") return serve();
  if (command === "status") return status();
  if (command === "stop") return stop();
  throw new Error("Usage: npm run runner -- doctor|serve|status|stop");
}

if (process.argv[1]?.endsWith("cli.ts")) {
  runLocalRunnerCli().catch(error => {
    const code = error instanceof LocalRunnerError ? error.code : error instanceof Error ? error.message : "INTERNAL_ERROR";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
