#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Real-VM engineering harness. */
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const byo = require("./loadByoRunner");

const ROOT = path.resolve(__dirname, "../../..");
const VM = "Amniora-BYO-Test";
const SSH_KEY = process.env.AMNIORA_VM_SSH_KEY;
const SSH_ARGS = [
  "-i", SSH_KEY || "",
  "-o", "IdentitiesOnly=yes",
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=8",
  "-o", "StrictHostKeyChecking=yes",
  "-p", "2222",
];
const SSH_TARGET = "amniora@127.0.0.1";
const GUEST_BASE = "/home/amniora/.cache/amniora-phase16a2a";
const BROKER_PORT = 43128;
const BROKER_SERVER_NAME = "amniora-byo-broker.test";

function run(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: options.cwd || ROOT, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = options.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs) : null;
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", code => {
      if (timer) clearTimeout(timer);
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(Object.assign(new Error(`${program}_failed_${code}: ${result.stderr.trim()}`), result));
    });
    child.stdin.end(options.input);
  });
}

function ssh(script, options = {}) {
  return run("ssh", [...SSH_ARGS, SSH_TARGET, "bash -s"], { ...options, input: script });
}

function scp(localPath, remotePath) {
  return run("scp", [
    "-i", SSH_KEY,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=yes",
    "-P", "2222",
    localPath,
    `${SSH_TARGET}:${remotePath}`,
  ], { timeoutMs: 60_000 });
}

function waitFor(emitter, event, predicate = () => true, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, receive);
      reject(new Error(`timeout_waiting_for_${event}`));
    }, timeoutMs);
    timer.unref();
    const receive = value => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      emitter.off(event, receive);
      resolve(value);
    };
    emitter.on(event, receive);
  });
}

function generateCertificate(directory) {
  const keyPath = path.join(directory, "broker-key.pem");
  const certPath = path.join(directory, "broker-cert.pem");
  return run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
    "-subj", `/CN=${BROKER_SERVER_NAME}`,
    "-addext", `subjectAltName=DNS:${BROKER_SERVER_NAME},IP:127.0.0.1,IP:10.0.2.2`,
    "-keyout", keyPath,
    "-out", certPath,
  ]).then(() => ({ keyPath, certPath, key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }));
}

async function buildRunner(directory) {
  const output = path.join(directory, "runner");
  fs.mkdirSync(output, { recursive: true });
  const sources = ["protocol.ts", "enrollment.ts", "identity-store.ts", "broker.ts", "runner.ts", "cli.ts"]
    .map(file => path.join(ROOT, "lib/web-lab/byo-runner", file));
  await run(path.join(ROOT, "node_modules/.bin/tsc"), [
    ...sources,
    "--outDir", output,
    "--rootDir", path.join(ROOT, "lib/web-lab/byo-runner"),
    "--module", "commonjs",
    "--target", "ES2022",
    "--moduleResolution", "node",
    "--esModuleInterop",
    "--skipLibCheck",
  ]);
  fs.copyFileSync(path.join(__dirname, "vm-runner-entry.cjs"), path.join(output, "vm-runner-entry.cjs"));
  const archive = path.join(directory, "runner.tar.gz");
  await run("tar", ["-czf", archive, "-C", output, "."]);
  return archive;
}

async function downloadNode(directory) {
  const sumsPath = path.join(directory, "SHASUMS256.txt");
  await run("curl", ["-fsSL", "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt", "-o", sumsPath], { timeoutMs: 60_000 });
  const match = fs.readFileSync(sumsPath, "utf8").match(/^([0-9a-f]{64})  (node-v[0-9.]+-linux-arm64\.tar\.xz)$/m);
  if (!match) throw new Error("node_linux_arm64_release_not_found");
  const [, expected, filename] = match;
  const archive = path.join(directory, filename);
  await run("curl", ["-fsSL", `https://nodejs.org/dist/latest-v22.x/${filename}`, "-o", archive], { timeoutMs: 120_000 });
  const actual = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  assert.equal(actual, expected, "temporary Node archive checksum");
  return { archive, filename, directoryName: filename.replace(/\.tar\.xz$/, "") };
}

function runnerEnvironment(ownerId, stateDirectory) {
  return [
    `AMNIORA_BYO_BROKER_HOST=10.0.2.2`,
    `AMNIORA_BYO_BROKER_PORT=${BROKER_PORT}`,
    `AMNIORA_BYO_BROKER_SERVER_NAME=${BROKER_SERVER_NAME}`,
    `AMNIORA_BYO_BROKER_CA_PATH=${GUEST_BASE}/broker-cert.pem`,
    `AMNIORA_BYO_OWNER_ID=${ownerId}`,
    `AMNIORA_BYO_STATE_DIR=${GUEST_BASE}/${stateDirectory}`,
  ].join(" ");
}

async function runRejected(token, ownerId, stateDirectory) {
  const script = `set -u
enrollment='${token}'
set +e
output=$(printf '%s' "$enrollment" | env ${runnerEnvironment(ownerId, stateDirectory)} AMNIORA_BYO_ENROLLMENT_STDIN=1 "${GUEST_BASE}/node/bin/node" "${GUEST_BASE}/runner/vm-runner-entry.cjs" serve 2>&1)
code=$?
unset enrollment
printf '%s\\n' "$output"
exit $code
`;
  return ssh(script, { allowFailure: true, timeoutMs: 15_000 });
}

async function startWithToken(token, ownerId, stateDirectory, logName, pidName) {
  const script = `set -eu
enrollment='${token}'
rm -rf -- "${GUEST_BASE}/${stateDirectory}"
mkdir -p "${GUEST_BASE}/${stateDirectory}"
printf '%s' "$enrollment" | nohup env ${runnerEnvironment(ownerId, stateDirectory)} AMNIORA_BYO_ENROLLMENT_STDIN=1 "${GUEST_BASE}/node/bin/node" "${GUEST_BASE}/runner/vm-runner-entry.cjs" serve >"${GUEST_BASE}/${logName}" 2>&1 &
printf '%s\\n' "$!" >"${GUEST_BASE}/${pidName}"
unset enrollment
`;
  await ssh(script, { timeoutMs: 15_000 });
}

async function startFromIdentity(ownerId, stateDirectory, logName, pidName) {
  const script = `set -eu
nohup env ${runnerEnvironment(ownerId, stateDirectory)} "${GUEST_BASE}/node/bin/node" "${GUEST_BASE}/runner/vm-runner-entry.cjs" serve >"${GUEST_BASE}/${logName}" 2>&1 &
printf '%s\\n' "$!" >"${GUEST_BASE}/${pidName}"
`;
  await ssh(script, { timeoutMs: 15_000 });
}

async function waitForSsh(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await run("ssh", [...SSH_ARGS, SSH_TARGET, "true"], { allowFailure: true, timeoutMs: 10_000 });
    if (result.code === 0) return;
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error("vm_ssh_did_not_return_after_reboot");
}

async function cleanVmReboot() {
  await run("VBoxManage", ["controlvm", VM, "acpipowerbutton"]);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const state = await run("VBoxManage", ["showvminfo", VM, "--machinereadable"], { allowFailure: true });
    if (state.code !== 0) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      continue;
    }
    if (/^VMState="poweroff"$/m.test(state.stdout)) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const started = await run("VBoxManage", ["startvm", VM, "--type", "headless"], {
          allowFailure: true,
          timeoutMs: 30_000,
        });
        if (started.code === 0) return;
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
      throw new Error("virtualbox_did_not_release_poweroff_lock");
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error("vm_did_not_power_off_for_clean_reboot");
}

async function main() {
  if (!SSH_KEY || !path.isAbsolute(SSH_KEY) || !fs.existsSync(SSH_KEY)) throw new Error("AMNIORA_VM_SSH_KEY is required");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase16a2a-vm-"));
  const tlsFixture = await generateCertificate(temporary);
  const [runnerArchive, nodeRelease] = await Promise.all([buildRunner(temporary), downloadNode(temporary)]);
  const enrollmentStore = new byo.ByoRunnerEnrollmentStore(() => Date.now(), 5_000);
  const broker = new byo.ByoRunnerBroker({
    tls: tlsFixture,
    identityStore: new byo.ByoBrokerIdentityStore(path.join(temporary, "broker-state")),
    enrollmentStore,
    host: "127.0.0.1",
    port: BROKER_PORT,
    heartbeatIntervalMs: 250,
    livenessTimeoutMs: 1_000,
    handshakeTimeoutMs: 3_000,
  });
  const results = {
    os: null,
    architecture: null,
    dockerService: null,
    dockerClient: null,
    dockerDaemonAccess: null,
    ssh: false,
    natPath: null,
    enrollmentAcceptedOnce: false,
    wrongOwnerRejected: false,
    expiredRejected: false,
    replayRejected: false,
    runnerId: null,
    heartbeat: false,
    disconnectDetected: false,
    reconnectSameIdentity: false,
    processRestartSameIdentity: false,
    rebootRestartSameIdentity: false,
    rawTokenPersisted: null,
    publicRunnerListener: null,
    temporarySshKeyRemoved: false,
  };
  const mainOwner = "owner_vm_phase16a2a_0001";
  let runnerId = null;
  const brokerRejections = [];
  broker.on("rejected", value => brokerRejections.push(value));
  try {
    await broker.listen();
    const inventory = await ssh(`set -eu
. /etc/os-release
printf 'os=%s\\n' "$PRETTY_NAME"
printf 'architecture=%s\\n' "$(uname -m)"
printf 'docker_service=%s\\n' "$(systemctl is-active docker 2>/dev/null || true)"
printf 'docker_client=%s\\n' "$(docker version --format '{{.Client.Version}}' 2>/dev/null || docker --version)"
if docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then printf 'docker_daemon_access=yes\\n'; else printf 'docker_daemon_access=no\\n'; fi
printf 'gateway=%s\\n' "$(ip route show default | awk '{print $3}')"
`);
    const values = Object.fromEntries(inventory.stdout.trim().split("\n").map(line => line.split(/=(.*)/s).slice(0, 2)));
    results.os = values.os;
    results.architecture = values.architecture;
    results.dockerService = values.docker_service;
    results.dockerClient = values.docker_client;
    results.dockerDaemonAccess = values.docker_daemon_access;
    results.ssh = true;
    results.natPath = `${values.gateway}:${BROKER_PORT} -> Mac 127.0.0.1:${BROKER_PORT}`;

    await ssh(`set -eu
rm -rf -- "${GUEST_BASE}"
mkdir -p "${GUEST_BASE}/runner"
`);
    await Promise.all([
      scp(runnerArchive, `${GUEST_BASE}/runner.tar.gz`),
      scp(nodeRelease.archive, `${GUEST_BASE}/${nodeRelease.filename}`),
      scp(tlsFixture.certPath, `${GUEST_BASE}/broker-cert.pem`),
    ]);
    await ssh(`set -eu
tar -xzf "${GUEST_BASE}/runner.tar.gz" -C "${GUEST_BASE}/runner"
tar -xJf "${GUEST_BASE}/${nodeRelease.filename}" -C "${GUEST_BASE}"
mv "${GUEST_BASE}/${nodeRelease.directoryName}" "${GUEST_BASE}/node"
chmod 700 "${GUEST_BASE}/node/bin/node"
"${GUEST_BASE}/node/bin/node" --version
`);

    const wrong = broker.issueEnrollment("owner_vm_bound_0001");
    const wrongResult = await runRejected(wrong.token, "owner_vm_wrong_0001", "wrong-state");
    results.wrongOwnerRejected = wrongResult.stderr.includes("OWNER_MISMATCH") || wrongResult.stdout.includes("OWNER_MISMATCH");
    assert.equal(results.wrongOwnerRejected, true, JSON.stringify({ stdout: wrongResult.stdout, stderr: wrongResult.stderr }));

    const expired = broker.issueEnrollment("owner_vm_expired_0001");
    await new Promise(resolve => setTimeout(resolve, 5_100));
    const expiredResult = await runRejected(expired.token, expired.ownerId, "expired-state");
    results.expiredRejected = expiredResult.stderr.includes("ENROLLMENT_EXPIRED") || expiredResult.stdout.includes("ENROLLMENT_EXPIRED");
    assert.equal(results.expiredRejected, true, JSON.stringify({ stdout: expiredResult.stdout, stderr: expiredResult.stderr }));

    const capability = broker.issueEnrollment(mainOwner);
    const connected = waitFor(broker, "connected", status => status.ownerId === mainOwner);
    const heartbeat = waitFor(broker, "heartbeat", status => status?.ownerId === mainOwner);
    await startWithToken(capability.token, mainOwner, "main-state", "main.log", "main.pid");
    let enrolled;
    try { enrolled = await connected; }
    catch (error) {
      const diagnostic = await ssh(`set +e
printf 'pid='; cat "${GUEST_BASE}/main.pid" 2>/dev/null
printf 'process='; if [ -f "${GUEST_BASE}/main.pid" ] && kill -0 "$(cat "${GUEST_BASE}/main.pid")" 2>/dev/null; then printf 'running\\n'; else printf 'stopped\\n'; fi
printf 'log='; tail -20 "${GUEST_BASE}/main.log" 2>/dev/null
`, { allowFailure: true });
      throw new Error(`${error.message}; broker=${JSON.stringify(brokerRejections)}; guest=${JSON.stringify(diagnostic.stdout)}`);
    }
    runnerId = enrolled.runnerId;
    results.runnerId = runnerId;
    results.enrollmentAcceptedOnce = true;
    await heartbeat;
    results.heartbeat = true;

    const tokenCheck = await ssh(`set -eu
enrollment='${capability.token}'
if grep -Fq "$enrollment" "${GUEST_BASE}/main-state/runner-identity.json" "${GUEST_BASE}/main.log"; then printf 'present\\n'; else printf 'absent\\n'; fi
unset enrollment
`);
    const brokerState = fs.readFileSync(path.join(temporary, "broker-state", "broker-identities.json"), "utf8");
    results.rawTokenPersisted = tokenCheck.stdout.trim() !== "absent" || brokerState.includes(capability.token);
    assert.equal(results.rawTokenPersisted, false);

    const replayResult = await runRejected(capability.token, mainOwner, "replay-state");
    results.replayRejected = replayResult.stderr.includes("ENROLLMENT_REPLAYED") || replayResult.stdout.includes("ENROLLMENT_REPLAYED");
    assert.equal(results.replayRejected, true);

    const disconnected = waitFor(broker, "disconnected", status => status.runnerId === runnerId);
    const reconnected = waitFor(broker, "connected", status => status.runnerId === runnerId && status.connectionCount >= 2);
    broker.activeSockets.get(runnerId).destroy();
    await disconnected;
    results.disconnectDetected = true;
    const reconnectStatus = await reconnected;
    results.reconnectSameIdentity = reconnectStatus.runnerId === runnerId;

    const processDisconnected = waitFor(broker, "disconnected", status => status.runnerId === runnerId);
    await ssh(`set -eu
kill "$(cat "${GUEST_BASE}/main.pid")"
`);
    await processDisconnected;
    const processConnected = waitFor(broker, "connected", status => status.runnerId === runnerId && status.connectionCount >= 3);
    await startFromIdentity(mainOwner, "main-state", "main-restart.log", "main.pid");
    const processStatus = await processConnected;
    results.processRestartSameIdentity = processStatus.runnerId === runnerId;

    await ssh(`set -eu
cat >"${GUEST_BASE}/reboot-start.sh" <<'SCRIPT'
#!/bin/sh
nohup env ${runnerEnvironment(mainOwner, "main-state")} "${GUEST_BASE}/node/bin/node" "${GUEST_BASE}/runner/vm-runner-entry.cjs" serve >"${GUEST_BASE}/main-reboot.log" 2>&1 &
printf '%s\\n' "$!" >"${GUEST_BASE}/main.pid"
SCRIPT
chmod 700 "${GUEST_BASE}/reboot-start.sh"
( crontab -l 2>/dev/null | grep -v 'amniora-phase16a2a-reboot' || true; printf '@reboot %s # amniora-phase16a2a-reboot\\n' "${GUEST_BASE}/reboot-start.sh" ) | crontab -
`);
    const rebootDisconnected = waitFor(broker, "disconnected", status => status.runnerId === runnerId, 30_000);
    const rebootConnected = waitFor(broker, "connected", status => status.runnerId === runnerId && status.connectionCount >= 4, 120_000);
    await cleanVmReboot();
    await rebootDisconnected;
    await rebootConnected;
    results.rebootRestartSameIdentity = true;
    await waitForSsh();

    const listeners = await ssh("ss -lntH || true\n");
    results.publicRunnerListener = listeners.stdout.split("\n").some(line => line.includes(`:${BROKER_PORT}`));
    assert.equal(results.publicRunnerListener, false);

    await ssh(`set -eu
if [ -f "${GUEST_BASE}/main.pid" ]; then kill "$(cat "${GUEST_BASE}/main.pid")" 2>/dev/null || true; fi
( crontab -l 2>/dev/null | grep -v 'amniora-phase16a2a-reboot' || true ) | crontab -
rm -rf -- "${GUEST_BASE}"
if [ -f "$HOME/.ssh/authorized_keys" ]; then
  temporary="$HOME/.ssh/authorized_keys.phase16a2a"
  grep -v 'amniora-phase16a2a-temporary$' "$HOME/.ssh/authorized_keys" >"$temporary" || true
  chmod 600 "$temporary"
  mv "$temporary" "$HOME/.ssh/authorized_keys"
fi
`);
    results.temporarySshKeyRemoved = true;

    assert.equal(results.reconnectSameIdentity, true);
    assert.equal(results.processRestartSameIdentity, true);
    assert.equal(results.rebootRestartSameIdentity, true);
    process.stdout.write(`${JSON.stringify({ phase: "16A.2A real VM", result: "PASS", ...results }, null, 2)}\n`);
  } finally {
    await broker.close().catch(() => undefined);
    if (!results.temporarySshKeyRemoved) {
      const cleanup = await ssh(`set +e
if [ -f "${GUEST_BASE}/main.pid" ]; then kill "$(cat "${GUEST_BASE}/main.pid")" 2>/dev/null; fi
( crontab -l 2>/dev/null | grep -v 'amniora-phase16a2a-reboot' || true ) | crontab -
rm -rf -- "${GUEST_BASE}"
if [ -f "$HOME/.ssh/authorized_keys" ]; then
  temporary="$HOME/.ssh/authorized_keys.phase16a2a"
  grep -v 'amniora-phase16a2a-temporary$' "$HOME/.ssh/authorized_keys" >"$temporary" || true
  chmod 600 "$temporary"
  mv "$temporary" "$HOME/.ssh/authorized_keys"
fi
`, { allowFailure: true, timeoutMs: 20_000 }).catch(() => undefined);
      if (cleanup?.code === 0) results.temporarySshKeyRemoved = true;
    }
    fs.rmSync(temporary, { recursive: true, force: true });
    if (results.temporarySshKeyRemoved) fs.rmSync(path.dirname(SSH_KEY), { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
