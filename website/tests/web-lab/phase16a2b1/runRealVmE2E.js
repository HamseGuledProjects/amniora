#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Real Ubuntu/Docker BYO runtime harness. */
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const byo = require("../phase16a2a/loadByoRunner");
const { issueRealProductPackage } = require("./productPackageFixture");

const ROOT = path.resolve(__dirname, "../../..");
const VM = "Amniora-BYO-Test";
const SSH_KEY = process.env.AMNIORA_VM_SSH_KEY;
const SSH_USER = process.env.AMNIORA_VM_SSH_USER || "amniora";
const SSH_TARGET = `${SSH_USER}@127.0.0.1`;
const SSH_ARGS = [
  "-i", SSH_KEY || "",
  "-o", "IdentitiesOnly=yes",
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=8",
  "-o", "StrictHostKeyChecking=yes",
  "-p", "2222",
];
const GUEST_STAGE = "/home/amniora/.cache/amniora-phase16a2b1";
const INSTALL_ROOT = "/opt/amniora-runner-phase16a2b1";
const STATE_ROOT = "/var/lib/amniora-runner/phase16a2b1";
const SERVICE = "amniora-runner-phase16a2b1.service";
const SERVICE_USER = "amniora-runner";
const BROKER_PORT = 43128;
const BROKER_SERVER_NAME = "amniora-byo-broker.test";
const SSH_MARKER = "amniora-phase16a2b1-temporary";

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

function sshCommand(command, options = {}) {
  return run("ssh", [...SSH_ARGS, SSH_TARGET, command], options);
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
  ], { timeoutMs: 120_000 });
}

function waitFor(emitter, event, predicate = () => true, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, receive);
      reject(new Error(`timeout_waiting_for_${event}`));
    }, timeoutMs);
    const receive = value => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      emitter.off(event, receive);
      resolve(value);
    };
    emitter.on(event, receive);
  });
}

async function expectCode(operation, code) {
  await assert.rejects(operation, error => error?.code === code, code);
}

async function freePortAvailable(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", resolve).once("error", reject));
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function generateCertificate(directory) {
  const keyPath = path.join(directory, "broker-key.pem");
  const certPath = path.join(directory, "broker-cert.pem");
  await run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
    "-subj", `/CN=${BROKER_SERVER_NAME}`,
    "-addext", `subjectAltName=DNS:${BROKER_SERVER_NAME},IP:127.0.0.1,IP:10.0.2.2`,
    "-keyout", keyPath,
    "-out", certPath,
  ]);
  return { keyPath, certPath, key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

async function buildRunner(directory) {
  const output = path.join(directory, "runner");
  fs.mkdirSync(output, { recursive: true });
  await run(path.join(ROOT, "node_modules/.bin/tsc"), [
    path.join(ROOT, "lib/web-lab/byo-runner/runtime-cli.ts"),
    "--outDir", output,
    "--rootDir", path.join(ROOT, "lib/web-lab"),
    "--module", "commonjs",
    "--target", "ES2022",
    "--moduleResolution", "node",
    "--esModuleInterop",
    "--skipLibCheck",
  ]);
  fs.copyFileSync(path.join(__dirname, "vm-runtime-entry.cjs"), path.join(output, "vm-runtime-entry.cjs"));
  const containerOutput = path.join(output, "container");
  fs.mkdirSync(containerOutput, { recursive: true });
  for (const file of ["Dockerfile", "challenge-server.cjs", "ingress-proxy.cjs"]) {
    fs.copyFileSync(path.join(ROOT, "lib/web-lab/local-runner/container", file), path.join(containerOutput, file));
  }
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
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex"), expected);
  return { archive, filename, directoryName: filename.replace(/\.tar\.xz$/, "") };
}

function runnerEnvironment() {
  return [
    "AMNIORA_BYO_BROKER_HOST=10.0.2.2",
    `AMNIORA_BYO_BROKER_PORT=${BROKER_PORT}`,
    `AMNIORA_BYO_BROKER_SERVER_NAME=${BROKER_SERVER_NAME}`,
    `AMNIORA_BYO_BROKER_CA_PATH=${INSTALL_ROOT}/broker-cert.pem`,
    "AMNIORA_BYO_OWNER_ID=11111111-1111-4111-8111-111111111111",
    `AMNIORA_BYO_STATE_DIR=${STATE_ROOT}`,
    `AMNIORA_BYO_VERIFICATION_KEYS_PATH=${INSTALL_ROOT}/verification-keys.json`,
    `AMNIORA_BYO_RUNTIME_CONTAINER_CONTEXT=${INSTALL_ROOT}/runner/container`,
  ].join(" ");
}

function serviceUnit() {
  return `[Unit]
Description=Amniora BYO Runner Phase 16A.2B-1 engineering service
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
SupplementaryGroups=docker
WorkingDirectory=${INSTALL_ROOT}/runner
Environment=HOME=/var/lib/amniora-runner
${runnerEnvironment().split(" ").map(value => `Environment=${value}`).join("\n")}
ExecStart=${INSTALL_ROOT}/node/bin/node ${INSTALL_ROOT}/runner/vm-runtime-entry.cjs serve
Restart=on-failure
RestartSec=1
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/amniora-runner
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
`;
}

async function installRunnerArtifacts(temporary, runnerArchive, nodeRelease, tlsFixture, verificationConfig) {
  const keysPath = path.join(temporary, "verification-keys.json");
  const unitPath = path.join(temporary, SERVICE);
  fs.writeFileSync(keysPath, JSON.stringify(verificationConfig), { mode: 0o600 });
  fs.writeFileSync(unitPath, serviceUnit(), { mode: 0o600 });
  const inventory = await ssh(`set -eu
if ! sudo -n true; then printf 'PASSWORDLESS_SUDO_REQUIRED\n' >&2; exit 32; fi
. /etc/os-release
printf 'os=%s\n' "$PRETTY_NAME"
printf 'architecture=%s\n' "$(uname -m)"
printf 'docker_service=%s\n' "$(systemctl is-active docker)"
printf 'docker_client=%s\n' "$(docker --version)"
if sudo -n -u amniora docker info >/dev/null 2>&1; then printf 'normal_user_docker=yes\n'; else printf 'normal_user_docker=no\n'; fi
managed_containers=$(sudo -n docker container ls -aq --filter label=com.amniora.local-runner.managed=true | wc -l)
managed_networks=$(sudo -n docker network ls -q --filter label=com.amniora.local-runner.managed=true | wc -l)
printf 'managed_containers=%s\n' "$managed_containers"
printf 'managed_networks=%s\n' "$managed_networks"
`, { timeoutMs: 20_000 });
  const values = Object.fromEntries(inventory.stdout.trim().split("\n").map(line => line.split(/=(.*)/s).slice(0, 2)));
  assert.equal(values.managed_containers, "0", "pre-existing Amniora container requires manual review");
  assert.equal(values.managed_networks, "0", "pre-existing Amniora network requires manual review");
  await ssh(`set -eu
mkdir -p "${GUEST_STAGE}"
`, { timeoutMs: 10_000 });
  await Promise.all([
    scp(runnerArchive, `${GUEST_STAGE}/runner.tar.gz`),
    scp(nodeRelease.archive, `${GUEST_STAGE}/${nodeRelease.filename}`),
    scp(tlsFixture.certPath, `${GUEST_STAGE}/broker-cert.pem`),
    scp(keysPath, `${GUEST_STAGE}/verification-keys.json`),
    scp(unitPath, `${GUEST_STAGE}/${SERVICE}`),
  ]);
  await ssh(`set -eu
sudo -n systemctl disable --now "${SERVICE}" >/dev/null 2>&1 || true
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  sudo -n useradd --system --create-home --home-dir /var/lib/amniora-runner --shell /usr/sbin/nologin "${SERVICE_USER}"
fi
sudo -n usermod -aG docker "${SERVICE_USER}"
sudo -n install -d -o root -g "${SERVICE_USER}" -m 0755 "${INSTALL_ROOT}"
sudo -n install -d -o root -g "${SERVICE_USER}" -m 0755 "${INSTALL_ROOT}/runner"
sudo -n install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0700 "${STATE_ROOT}"
sudo -n tar -xzf "${GUEST_STAGE}/runner.tar.gz" -C "${INSTALL_ROOT}/runner"
sudo -n tar -xJf "${GUEST_STAGE}/${nodeRelease.filename}" -C "${INSTALL_ROOT}"
sudo -n mv "${INSTALL_ROOT}/${nodeRelease.directoryName}" "${INSTALL_ROOT}/node"
sudo -n install -o root -g "${SERVICE_USER}" -m 0644 "${GUEST_STAGE}/broker-cert.pem" "${INSTALL_ROOT}/broker-cert.pem"
sudo -n install -o root -g "${SERVICE_USER}" -m 0644 "${GUEST_STAGE}/verification-keys.json" "${INSTALL_ROOT}/verification-keys.json"
sudo -n install -o root -g root -m 0644 "${GUEST_STAGE}/${SERVICE}" "/etc/systemd/system/${SERVICE}"
sudo -n chown -R root:"${SERVICE_USER}" "${INSTALL_ROOT}/runner" "${INSTALL_ROOT}/node"
sudo -n chmod -R go-w "${INSTALL_ROOT}"
sudo -n systemctl daemon-reload
sudo -n systemctl enable "${SERVICE}" >/dev/null
sudo -n -u "${SERVICE_USER}" docker version --format '{{.Server.Version}}'
`, { timeoutMs: 60_000 });
  return values;
}

async function startInitialRunner(token) {
  await ssh(`set -eu
enrollment='${token}'
printf '%s' "$enrollment" | sudo -n -u "${SERVICE_USER}" nohup env ${runnerEnvironment()} AMNIORA_BYO_ENROLLMENT_STDIN=1 \
  "${INSTALL_ROOT}/node/bin/node" "${INSTALL_ROOT}/runner/vm-runtime-entry.cjs" serve \
  >"${GUEST_STAGE}/initial-runner.log" 2>&1 &
printf '%s\n' "$!" >"${GUEST_STAGE}/initial-runner.pid"
unset enrollment
`, { timeoutMs: 15_000 });
}

async function managedCounts() {
  const result = await ssh(`set -eu
containers=$(sudo -n -u "${SERVICE_USER}" docker container ls -aq --filter label=com.amniora.local-runner.managed=true | wc -l)
networks=$(sudo -n -u "${SERVICE_USER}" docker network ls -q --filter label=com.amniora.local-runner.managed=true | wc -l)
printf '{"containers":%s,"networks":%s}\n' "$containers" "$networks"
`);
  return JSON.parse(result.stdout);
}

async function readChallengeState() {
  const result = await ssh(`set -eu
sudo -n -u "${SERVICE_USER}" "${INSTALL_ROOT}/node/bin/node" <<'NODE'
const fs = require("node:fs");
(async () => {
const status = JSON.parse(fs.readFileSync("${STATE_ROOT}/runtime/state.json", "utf8"));
const response = await fetch(status.endpoint + "/__runtime/state");
if (!response.ok) throw new Error("runtime_state_unavailable");
process.stdout.write(JSON.stringify(await response.json()));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
NODE
`);
  return JSON.parse(result.stdout);
}

async function exerciseStoredXss(config) {
  const result = await ssh(`set -eu
sudo -n -u "${SERVICE_USER}" "${INSTALL_ROOT}/node/bin/node" <<'NODE'
const fs = require("node:fs");
(async () => {
const status = JSON.parse(fs.readFileSync("${STATE_ROOT}/runtime/state.json", "utf8"));
const beforeResponse = await fetch(status.endpoint + "/__runtime/state");
const before = await beforeResponse.json();
const writableId = ${JSON.stringify(config.writableObjectIds[0])};
const next = structuredClone(before);
next.contentByObject[writableId].push({
  id: "learner-" + before.nextContentNumber,
  authorId: ${JSON.stringify(config.displayUserId)},
  body: "<img src=x onerror=console.info('phase16a2b1-stored-xss')>",
  submittedByLearner: true,
});
next.nextContentNumber++;
const put = await fetch(status.endpoint + "/__runtime/state", {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    "X-Web-Lab-Field": ${JSON.stringify(config.storedField)},
    "X-Web-Lab-Route": ${JSON.stringify(config.storedRoute)},
  },
  body: JSON.stringify(next),
});
if (put.status !== 204) throw new Error("stored_state_write_failed_" + put.status);
const after = await (await fetch(status.endpoint + "/__runtime/state")).json();
process.stdout.write(JSON.stringify({ before, after }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
NODE
`);
  return JSON.parse(result.stdout);
}

async function inspectRuntime(runtimeId) {
  const result = await ssh(`set -eu
sudo -n -u "${SERVICE_USER}" "${INSTALL_ROOT}/node/bin/node" <<'NODE'
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const run = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const session = ${JSON.stringify(runtimeId)};
const containerIds = run("container", "ls", "-aq", "--filter", "label=com.amniora.local-runner.session=" + session).split("\\n").filter(Boolean);
const networkIds = run("network", "ls", "-q", "--filter", "label=com.amniora.local-runner.session=" + session).split("\\n").filter(Boolean);
const containers = containerIds.length ? JSON.parse(run("inspect", ...containerIds)) : [];
const networks = networkIds.length ? JSON.parse(run("network", "inspect", ...networkIds)) : [];
const status = JSON.parse(fs.readFileSync("${STATE_ROOT}/runtime/state.json", "utf8"));
process.stdout.write(JSON.stringify({ containers, networks, endpoint: status.endpoint }));
NODE
`);
  return JSON.parse(result.stdout);
}

function assertDockerSecurity(inspection, runtimeId, generation) {
  assert.equal(inspection.containers.length, 2);
  assert.equal(inspection.networks.length, 1);
  const role = value => value.Config.Labels["com.amniora.local-runner.role"];
  const challenge = inspection.containers.find(value => role(value) === "challenge");
  const proxy = inspection.containers.find(value => role(value) === "proxy");
  assert.ok(challenge && proxy);
  for (const container of [challenge, proxy]) {
    assert.equal(container.HostConfig.Privileged, false);
    assert.equal(container.HostConfig.ReadonlyRootfs, true);
    assert.equal(container.HostConfig.NetworkMode === "host", false);
    assert.equal(container.Config.Labels["com.amniora.local-runner.session"], runtimeId);
    assert.equal(container.Config.Labels["com.amniora.local-runner.generation"], String(generation));
    assert.equal(container.Mounts.some(mount => mount.Source === "/var/run/docker.sock" || mount.Destination === "/var/run/docker.sock"), false);
  }
  assert.deepEqual(challenge.HostConfig.CapDrop, ["ALL"]);
  assert.equal(challenge.HostConfig.SecurityOpt.includes("no-new-privileges:true"), true);
  assert.equal(challenge.Config.User, "1000:1000");
  assert.equal(challenge.Mounts.length, 1);
  assert.equal(challenge.Mounts[0].Destination, "/bundle");
  assert.equal(challenge.Mounts[0].RW, false);
  assert.equal(challenge.Mounts[0].Source.startsWith(`${STATE_ROOT}/runtime/bundles/`), true);
  assert.deepEqual(challenge.HostConfig.PortBindings, {});
  assert.equal(inspection.networks[0].Internal, true);
  const binding = proxy.HostConfig.PortBindings["8080/tcp"];
  assert.equal(binding.length, 1);
  assert.equal(binding[0].HostIp, "127.0.0.1");
  assert.match(inspection.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
  return { challenge, proxy };
}

async function assertOutboundBlocked(challengeName) {
  const script = `const net=require("node:net");let done=false;const finish=(value,code)=>{if(done)return;done=true;console.log(value);process.exit(code)};const socket=net.createConnection({host:"1.1.1.1",port:80});socket.on("connect",()=>finish("reachable",2));socket.on("error",()=>finish("blocked",0));setTimeout(()=>{socket.destroy();finish("blocked",0)},2000);`;
  const result = await ssh(`set -eu
sudo -n -u "${SERVICE_USER}" docker exec ${challengeName} node -e '${script}'
`, { timeoutMs: 10_000 });
  assert.equal(result.stdout.trim(), "blocked");
}

async function assertNoLanExposure(endpoint) {
  const port = Number(new URL(endpoint).port);
  const result = await ssh(`set -eu
sudo -n -u "${SERVICE_USER}" "${INSTALL_ROOT}/node/bin/node" <<'NODE'
const fs = require("node:fs");
const os = require("node:os");
(async () => {
const endpoint = ${JSON.stringify(endpoint)};
const listeners = fs.readFileSync("/proc/net/tcp", "utf8") + fs.readFileSync("/proc/net/tcp6", "utf8");
let lanReachable = false;
try {
  const response = await fetch(endpoint.replace("127.0.0.1", "10.0.2.15"), { signal: AbortSignal.timeout(1000) });
  lanReachable = response.ok;
} catch {}
process.stdout.write(JSON.stringify({ lanReachable, listeners: listeners.length > 0 }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
NODE
`);
  assert.equal(JSON.parse(result.stdout).lanReachable, false);
  const vmInfo = await run("VBoxManage", ["showvminfo", VM, "--machinereadable"]);
  const forwardingRules = vmInfo.stdout.split("\n").filter(line => /^Forwarding\(/.test(line));
  assert.equal(forwardingRules.some(line => new RegExp(`[,\"]${port}(?:,|\")`).test(line)), false);
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
    if (/^VMState="poweroff"$/m.test(state.stdout)) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const started = await run("VBoxManage", ["startvm", VM, "--type", "headless"], { allowFailure: true, timeoutMs: 30_000 });
        if (started.code === 0) return;
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
      throw new Error("virtualbox_did_not_release_poweroff_lock");
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error("vm_did_not_power_off_for_clean_reboot");
}

async function cleanupVm(removeSshAuthorization = false) {
  const authorizationCleanup = removeSshAuthorization ? `
if [ -f "$HOME/.ssh/authorized_keys" ]; then
  temporary="$HOME/.ssh/authorized_keys.phase16a2b1"
  grep -v '${SSH_MARKER}$' "$HOME/.ssh/authorized_keys" >"$temporary" || true
  chmod 600 "$temporary"
  mv "$temporary" "$HOME/.ssh/authorized_keys"
fi` : "";
  return ssh(`set +e
sudo -n systemctl disable --now "${SERVICE}" >/dev/null 2>&1
if [ -f "${GUEST_STAGE}/initial-runner.pid" ]; then sudo -n kill "$(cat "${GUEST_STAGE}/initial-runner.pid")" >/dev/null 2>&1; fi
containers=$(sudo -n docker container ls -aq --filter label=com.amniora.local-runner.managed=true)
if [ -n "$containers" ]; then sudo -n docker container rm -f $containers >/dev/null 2>&1; fi
networks=$(sudo -n docker network ls -q --filter label=com.amniora.local-runner.managed=true)
if [ -n "$networks" ]; then sudo -n docker network rm $networks >/dev/null 2>&1; fi
sudo -n -u "${SERVICE_USER}" docker image rm amniora-local-runner:15a-1 >/dev/null 2>&1
sudo -n rm -f -- "/etc/systemd/system/${SERVICE}"
sudo -n systemctl daemon-reload
sudo -n rm -rf -- "${INSTALL_ROOT}" "${STATE_ROOT}" "${GUEST_STAGE}"
${authorizationCleanup}
`, { allowFailure: true, timeoutMs: 60_000 }).catch(() => undefined);
}

async function main() {
  if (!SSH_KEY || !path.isAbsolute(SSH_KEY) || !fs.existsSync(SSH_KEY)) throw new Error("AMNIORA_VM_SSH_KEY is required");
  await freePortAvailable(BROKER_PORT);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase16a2b1-vm-"));
  const product = await issueRealProductPackage();
  const tlsFixture = await generateCertificate(temporary);
  const [runnerArchive, nodeRelease] = await Promise.all([buildRunner(temporary), downloadNode(temporary)]);
  const broker = new byo.ByoRunnerBroker({
    tls: tlsFixture,
    identityStore: new byo.ByoBrokerIdentityStore(path.join(temporary, "broker-state")),
    host: "127.0.0.1",
    port: BROKER_PORT,
    heartbeatIntervalMs: 250,
    livenessTimeoutMs: 2_000,
    handshakeTimeoutMs: 5_000,
    commandTimeoutMs: 180_000,
  });
  const results = {
    os: null,
    architecture: null,
    docker: null,
    normalUserDocker: null,
    runnerServiceUser: SERVICE_USER,
    fingerprint: product.package.buildFingerprint,
    packageBytes: Buffer.byteLength(JSON.stringify(product.package)),
    tamperDeniedBeforeDocker: false,
    wrongRunnerDenied: false,
    unsupportedRuntimeDenied: false,
    arbitraryImageDenied: false,
    arbitraryCommandDenied: false,
    arbitraryMountDenied: false,
    launchReplayIdempotent: false,
    resetExactlyOnce: false,
    stopConverged: false,
    processRestartRecovered: false,
    vmRebootRecovered: false,
    outboundBlocked: false,
    cleanup: false,
  };
  let runnerId = null;
  let runtimeStatus = null;
  let vmInstalled = false;
  try {
    await broker.listen();
    vmInstalled = true;
    const inventory = await installRunnerArtifacts(temporary, runnerArchive, nodeRelease, tlsFixture, product.verificationConfig);
    results.os = inventory.os;
    results.architecture = inventory.architecture;
    results.docker = `${inventory.docker_service}; ${inventory.docker_client}`;
    results.normalUserDocker = inventory.normal_user_docker;
    assert.equal(inventory.normal_user_docker, "no");

    const capability = broker.issueEnrollment(product.ownerId);
    const connected = waitFor(broker, "connected", value => value.ownerId === product.ownerId);
    await startInitialRunner(capability.token);
    runnerId = (await connected).runnerId;
    await waitFor(broker, "heartbeat", value => value?.runnerId === runnerId);

    const disconnected = waitFor(broker, "disconnected", value => value.runnerId === runnerId);
    await ssh(`set -eu
sudo -n kill "$(cat "${GUEST_STAGE}/initial-runner.pid")"
`);
    await disconnected;
    const serviceConnected = waitFor(broker, "connected", value => value.runnerId === runnerId);
    await ssh(`set -eu
sudo -n systemctl start "${SERVICE}"
`);
    await serviceConnected;

    await expectCode(broker.runtimeStatus({ runnerId, ownerId: "22222222-2222-4222-8222-222222222222" }), "OWNER_MISMATCH");
    await expectCode(broker.runtimeStatus({ runnerId: `rnr_${"A".repeat(43)}`, ownerId: product.ownerId }),
      "RUNNER_IDENTITY_NOT_FOUND");
    results.wrongRunnerDenied = true;

    const tampered = structuredClone(product.package);
    tampered.bundle[0].content += "<!-- tampered -->";
    await expectCode(broker.launch({ runnerId, ownerId: product.ownerId, package: tampered,
      idempotencyKey: "tampered-package-0001" }), "PACKAGE_SIGNATURE_INVALID");
    assert.deepEqual(await managedCounts(), { containers: 0, networks: 0 });
    results.tamperDeniedBeforeDocker = true;

    await expectCode(broker.launch({ runnerId, ownerId: product.ownerId,
      package: { ...product.package, runtimeVersion: "unsupported-runtime" },
      idempotencyKey: "unsupported-runtime-001" }), "RUNTIME_VERSION_UNSUPPORTED");
    results.unsupportedRuntimeDenied = true;
    for (const [field, value, resultKey] of [
      ["image", "evil:latest", "arbitraryImageDenied"],
      ["command", ["sh", "-c", "id"], "arbitraryCommandDenied"],
      ["hostMount", "/", "arbitraryMountDenied"],
    ]) {
      await expectCode(broker.launch({ runnerId, ownerId: product.ownerId,
        package: { ...product.package, [field]: value }, idempotencyKey: `negative-${field}-0000001` }), "PACKAGE_INVALID");
      results[resultKey] = true;
    }
    assert.deepEqual(await managedCounts(), { containers: 0, networks: 0 });

    const launchInput = { runnerId, ownerId: product.ownerId, package: product.package,
      idempotencyKey: "real-launch-idempotency-0001" };
    try {
      runtimeStatus = await broker.launch(launchInput);
    } catch (error) {
      const diagnostic = await ssh(`set +e
printf '%s\n' 'service_log:'
sudo -n journalctl -u "${SERVICE}" -n 40 --no-pager
printf '%s\n' 'runtime_state:'
sudo -n -u "${SERVICE_USER}" "${INSTALL_ROOT}/node/bin/node" -e 'const fs=require("node:fs");const p="${STATE_ROOT}/runtime/state.json";if(fs.existsSync(p)){const s=JSON.parse(fs.readFileSync(p));console.log(JSON.stringify({state:s.state,errorCode:s.errorCode,sessionId:s.sessionId,generation:s.generation}))}'
printf '%s\n' 'managed_resources:'
sudo -n -u "${SERVICE_USER}" docker container ls -a --filter label=com.amniora.local-runner.managed=true
sudo -n -u "${SERVICE_USER}" docker network ls --filter label=com.amniora.local-runner.managed=true
`, { allowFailure: true, timeoutMs: 30_000 });
      throw new Error(`${error?.code || error}; VM diagnostic:\n${diagnostic.stdout}\n${diagnostic.stderr}`);
    }
    assert.equal(runtimeStatus.state, "ready");
    assert.equal(runtimeStatus.buildFingerprint, product.package.buildFingerprint);
    assert.equal(runtimeStatus.trustLevel, "byo_self_hosted");
    assert.notEqual(runtimeStatus.trustLevel, "hosted_verified");
    const firstRuntimeId = runtimeStatus.runtimeId;
    const launchReplay = await broker.launch(launchInput);
    assert.equal(launchReplay.runtimeId, firstRuntimeId);
    assert.equal(launchReplay.generation, 1);
    assert.deepEqual(await managedCounts(), { containers: 2, networks: 1 });
    results.launchReplayIdempotent = true;

    const runtimeConfig = JSON.parse(product.package.bundle.find(file => file.path === "runtime-config.json").content);
    const storedFlow = await exerciseStoredXss(runtimeConfig);
    assert.notDeepEqual(storedFlow.after, storedFlow.before);
    const resetInput = {
      runnerId,
      ownerId: product.ownerId,
      runtimeId: runtimeStatus.runtimeId,
      buildFingerprint: runtimeStatus.buildFingerprint,
      generation: runtimeStatus.generation,
      idempotencyKey: "real-reset-idempotency-0001",
    };
    runtimeStatus = await broker.reset(resetInput);
    assert.equal(runtimeStatus.generation, 2);
    assert.deepEqual(await readChallengeState(), storedFlow.before);
    const resetReplay = await broker.reset(resetInput);
    assert.equal(resetReplay.generation, 2);
    results.resetExactlyOnce = true;

    let inspection = await inspectRuntime(runtimeStatus.runtimeId);
    let resources = assertDockerSecurity(inspection, runtimeStatus.runtimeId, runtimeStatus.generation);
    await assertOutboundBlocked(resources.challenge.Name.replace(/^\//, ""));
    results.outboundBlocked = true;
    await assertNoLanExposure(inspection.endpoint);

    const restartDisconnected = waitFor(broker, "disconnected", value => value.runnerId === runnerId);
    const restartConnected = waitFor(broker, "connected", value => value.runnerId === runnerId && value.connectionCount >= 3);
    await ssh(`set -eu
sudo -n systemctl restart "${SERVICE}"
`);
    await restartDisconnected;
    await restartConnected;
    const restarted = await broker.runtimeStatus({ runnerId, ownerId: product.ownerId });
    assert.equal(restarted.runtimeId, runtimeStatus.runtimeId);
    assert.equal(restarted.generation, runtimeStatus.generation);
    assert.deepEqual(await managedCounts(), { containers: 2, networks: 1 });
    results.processRestartRecovered = true;

    const rebootDisconnected = waitFor(broker, "disconnected", value => value.runnerId === runnerId, 30_000);
    const rebootConnected = waitFor(broker, "connected", value => value.runnerId === runnerId && value.connectionCount >= 4, 150_000);
    await cleanVmReboot();
    await rebootDisconnected;
    await waitForSsh();
    await rebootConnected;
    runtimeStatus = await broker.runtimeStatus({ runnerId, ownerId: product.ownerId });
    assert.equal(runtimeStatus.runtimeId, restarted.runtimeId);
    assert.equal(runtimeStatus.generation, restarted.generation);
    assert.equal(runtimeStatus.state, "ready");
    inspection = await inspectRuntime(runtimeStatus.runtimeId);
    resources = assertDockerSecurity(inspection, runtimeStatus.runtimeId, runtimeStatus.generation);
    assert.deepEqual(await managedCounts(), { containers: 2, networks: 1 });
    results.vmRebootRecovered = true;

    const stopInput = {
      runnerId,
      ownerId: product.ownerId,
      runtimeId: runtimeStatus.runtimeId,
      buildFingerprint: runtimeStatus.buildFingerprint,
      generation: runtimeStatus.generation,
      idempotencyKey: "real-stop-idempotency-00001",
    };
    const stopped = await broker.stop(stopInput);
    assert.equal(stopped.state, "idle");
    assert.equal((await broker.stop(stopInput)).state, "idle");
    assert.deepEqual(await managedCounts(), { containers: 0, networks: 0 });
    const bundles = await ssh(`set -eu
if [ -d "${STATE_ROOT}/runtime/bundles" ] && find "${STATE_ROOT}/runtime/bundles" -mindepth 1 -print -quit | grep -q .; then printf 'present\n'; else printf 'absent\n'; fi
`);
    assert.equal(bundles.stdout.trim(), "absent");
    results.stopConverged = true;

    await cleanupVm(true);
    vmInstalled = false;
    results.cleanup = true;
    process.stdout.write(`${JSON.stringify({ phase: "16A.2B-1 real VM", result: "PASS", runnerId, ...results }, null, 2)}\n`);
  } catch (error) {
    if (vmInstalled) {
      const diagnostic = await ssh(`set +e
printf '%s\n' 'initial_runner_log:'
tail -80 "${GUEST_STAGE}/initial-runner.log"
printf '%s\n' 'service_status:'
sudo -n systemctl status "${SERVICE}" --no-pager
printf '%s\n' 'service_log:'
sudo -n journalctl -u "${SERVICE}" -n 80 --no-pager
printf '%s\n' 'identity_state:'
sudo -n find "${STATE_ROOT}" -maxdepth 3 -type f -printf '%p %m %u:%g\n'
printf '%s\n' 'runner_processes:'
ps -eo pid,user,args | grep '[v]m-runtime-entry.cjs'
printf '%s\n' 'runner_docker_access:'
sudo -n -u "${SERVICE_USER}" docker version --format '{{.Server.Version}}'
`, { allowFailure: true, timeoutMs: 30_000 }).catch(() => null);
      if (diagnostic) {
        throw new Error(`${error?.stack || error}\nVM pre-cleanup diagnostic:\n${diagnostic.stdout}\n${diagnostic.stderr}`);
      }
    }
    throw error;
  } finally {
    await broker.close().catch(() => undefined);
    if (vmInstalled) await cleanupVm();
    await product.cleanup();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ROOT,
  VM,
  GUEST_STAGE,
  INSTALL_ROOT,
  STATE_ROOT,
  SERVICE,
  SERVICE_USER,
  BROKER_PORT,
  run,
  ssh,
  sshCommand,
  scp,
  waitFor,
  freePortAvailable,
  generateCertificate,
  buildRunner,
  downloadNode,
  installRunnerArtifacts,
  startInitialRunner,
  managedCounts,
  inspectRuntime,
  assertDockerSecurity,
  assertOutboundBlocked,
  assertNoLanExposure,
  waitForSsh,
  cleanVmReboot,
  cleanupVm,
};
