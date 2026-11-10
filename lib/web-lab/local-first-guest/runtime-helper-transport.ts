import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import net, { type Server } from "node:net";
import path from "node:path";
import type { LocalRunnerPackage } from "../local-runner/package";
import { JsonLineChannel } from "./framing";
import type { PrivilegedDockerRuntimeManager } from "./privileged-runtime";
import {
  RUNTIME_HELPER_MAX_FRAME_BYTES,
  RUNTIME_HELPER_PROTOCOL_VERSION,
  RuntimeHelperError,
  requireRuntimeHelperRequest,
  validRuntimeHelperResponse,
  type HelperRuntimeStatus,
  type RuntimeHelperOperation,
  type RuntimeHelperRequest,
  type RuntimeHelperResponse,
} from "./runtime-helper-protocol";

export const DEFAULT_RUNTIME_HELPER_SOCKET = "/run/amniora-runtime-helper/control.sock";

function response(
  request: RuntimeHelperRequest,
  ok: boolean,
  result: unknown,
  errorCode: RuntimeHelperResponse["errorCode"],
): RuntimeHelperResponse {
  return Object.freeze({
    type: "HELPER_RESPONSE",
    protocolVersion: RUNTIME_HELPER_PROTOCOL_VERSION,
    requestId: request.requestId,
    operation: request.operation,
    ok,
    result,
    errorCode,
  });
}

export async function dispatchRuntimeHelperRequest(
  manager: PrivilegedDockerRuntimeManager,
  input: unknown,
  authorizedPeer: boolean,
): Promise<RuntimeHelperResponse> {
  let request: RuntimeHelperRequest;
  try { request = requireRuntimeHelperRequest(input); }
  catch (error) {
    if (error instanceof RuntimeHelperError) throw error;
    throw new RuntimeHelperError("HELPER_MESSAGE_INVALID");
  }
  if (!authorizedPeer) return response(request, false, null, "HELPER_UNAUTHORIZED");
  try {
    const body = request.input as Record<string, unknown>;
    let result: HelperRuntimeStatus;
    if (request.operation === "PREPARE_RUNTIME") {
      result = await manager.prepare(body.package, body.runtime as never);
    } else if (request.operation === "LAUNCH_RUNTIME") {
      result = await manager.launch(body.package, body.runtime as never);
    } else if (request.operation === "RUNTIME_STATUS") {
      result = await manager.status(body.runtime as never);
    } else if (request.operation === "RESET_RUNTIME") {
      result = await manager.reset(body.package, body.previous as never, body.next as never);
    } else if (request.operation === "STOP_RUNTIME") {
      result = await manager.stop(body.runtime as never);
    } else if (request.operation === "CLEAN_RUNTIME") {
      result = await manager.clean(body.authoritativeRuntime as never);
    } else {
      throw new RuntimeHelperError("HELPER_OPERATION_UNSUPPORTED");
    }
    return response(request, true, result, null);
  } catch (error) {
    const code = error instanceof RuntimeHelperError ? error.code : "HELPER_INTERNAL_ERROR";
    return response(request, false, null, code);
  }
}

async function listen(server: Server, target: string | number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => { server.off("listening", ready); reject(error); };
    const ready = () => { server.off("error", failed); resolve(); };
    server.once("error", failed);
    server.once("listening", ready);
    if (typeof target === "number") server.listen({ fd: target });
    else server.listen(target);
  });
}

export async function startRuntimeHelperServer(input: Readonly<{
  manager: PrivilegedDockerRuntimeManager;
  socketPath?: string;
  inheritedFd?: number;
}>): Promise<Readonly<{ close(): Promise<void>; socketPath: string | null }>> {
  if ((input.socketPath === undefined) === (input.inheritedFd === undefined)) throw new RuntimeHelperError("HELPER_MESSAGE_INVALID");
  const server = net.createServer(socket => {
    const channel = new JsonLineChannel(socket, RUNTIME_HELPER_MAX_FRAME_BYTES);
    void channel.next().then(message => dispatchRuntimeHelperRequest(input.manager, message, true))
      .then(value => channel.send(value)).catch(() => channel.close()).finally(() => channel.close());
  });
  let socketPath: string | null = null;
  if (input.socketPath) {
    const windowsPipe = process.platform === "win32" && input.socketPath.startsWith("\\\\.\\pipe\\");
    socketPath = windowsPipe ? input.socketPath : path.resolve(input.socketPath);
    if (!windowsPipe) {
      const directory = path.dirname(socketPath);
      await mkdir(directory, { recursive: true, mode: 0o750 });
      const details = await lstat(directory);
      if (!details.isDirectory() || details.isSymbolicLink()) throw new RuntimeHelperError("HELPER_INTERNAL_ERROR");
      try {
        const socket = await lstat(socketPath);
        if (!socket.isSocket()) throw new RuntimeHelperError("HELPER_INTERNAL_ERROR");
        await rm(socketPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await listen(server, socketPath);
    if (!windowsPipe) await chmod(socketPath, 0o660);
  } else {
    await listen(server, input.inheritedFd!);
  }
  return Object.freeze({ socketPath, close: async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (socketPath && !(process.platform === "win32" && socketPath.startsWith("\\\\.\\pipe\\"))) {
      await rm(socketPath, { force: true });
    }
  } });
}

export class RuntimeHelperClient {
  constructor(private readonly socketPath = DEFAULT_RUNTIME_HELPER_SOCKET) {}

  async request(operation: RuntimeHelperOperation, input: unknown): Promise<HelperRuntimeStatus> {
    const request: RuntimeHelperRequest = Object.freeze({
      type: "HELPER_REQUEST",
      protocolVersion: RUNTIME_HELPER_PROTOCOL_VERSION,
      requestId: `hrq_${randomBytes(32).toString("base64url")}`,
      operation,
      input,
    });
    requireRuntimeHelperRequest(request);
    const socket = net.createConnection(this.socketPath);
    const channel = new JsonLineChannel(socket, RUNTIME_HELPER_MAX_FRAME_BYTES);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      channel.send(request);
      const value = await channel.next();
      if (!validRuntimeHelperResponse(value) || value.requestId !== request.requestId || value.operation !== operation) {
        throw new RuntimeHelperError("HELPER_MESSAGE_INVALID");
      }
      if (!value.ok) throw new RuntimeHelperError(value.errorCode ?? "HELPER_INTERNAL_ERROR");
      return value.result as HelperRuntimeStatus;
    } finally {
      channel.close();
    }
  }

  prepare(pkg: LocalRunnerPackage, runtime: unknown): Promise<HelperRuntimeStatus> {
    return this.request("PREPARE_RUNTIME", { runtime, package: pkg });
  }
}
