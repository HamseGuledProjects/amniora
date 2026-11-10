// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS Docker prototype. */
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { compileWebLab, canonicalWebLabRuntimeState, webApplicationTemplate, sha256 } = require("./loadWebLab");
const { runtimeHtml } = require("./runtimeHtml");

const execFileAsync = promisify(execFile);
const IMAGE = "amniora-web-lab-phase5:local";
const CONTEXT = path.join(__dirname, "container");
const PHASE8_RUNTIME_VERSION = "phase8-local-1";
const PHASE8_LABEL_PREFIX = "com.amniora.web-lab";
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function docker(...args) {
  const { stdout } = await execFileAsync("docker", args, { maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function dockerResourceExists(...args) {
  try { await docker(...args); return true; } catch { return false; }
}

class LocalWebLabRuntimeManager {
  constructor({ now = () => Date.now(), ttlMs = 15 * 60 * 1000, image = IMAGE, challengeCommand = [], gatewayOnly = false } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.image = image;
    this.challengeCommand = challengeCommand;
    this.gatewayOnly = gatewayOnly;
    this.instances = new Map();
  }

  async buildImage() {
    await docker("build", "-t", this.image, CONTEXT);
    return { image: this.image, architecture: await docker("image", "inspect", this.image, "--format", "{{.Architecture}}") };
  }

  getRecord(instanceId) {
    const record = this.instances.get(instanceId);
    if (!record) throw new Error("Unknown runtime instance");
    return record;
  }

  publicStatus(record) {
    return {
      instanceId: record.instanceId,
      buildFingerprint: record.buildFingerprint,
      templateId: record.templateId,
      templateVersion: record.templateVersion,
      vulnerabilityId: record.vulnerabilityId,
      vulnerabilityVersion: record.vulnerabilityVersion,
      seed: record.seed,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      status: record.status,
      endpoint: record.status === "ready" ? record.endpoint : null,
    };
  }

  resourceLabels(record, role) {
    if (!record.managedContext) return [];
    const values = {
      [`${PHASE8_LABEL_PREFIX}.managed`]: "phase8",
      [`${PHASE8_LABEL_PREFIX}.role`]: role,
      [`${PHASE8_LABEL_PREFIX}.instance`]: record.managedContext.instanceId,
      [`${PHASE8_LABEL_PREFIX}.backend`]: record.instanceId,
      [`${PHASE8_LABEL_PREFIX}.build`]: record.buildFingerprint,
      [`${PHASE8_LABEL_PREFIX}.generation`]: String(record.managedContext.generationVersion),
      [`${PHASE8_LABEL_PREFIX}.runtime-version`]: record.managedContext.runtimeVersion,
    };
    return Object.entries(values).flatMap(([name, value]) => ["--label", `${name}=${value}`]);
  }

  async startContainer(record) {
    await docker(
      "run", "-d", "--name", record.containerName, "--network", record.networkName,
      ...this.resourceLabels(record, "challenge"),
      "--read-only", "--user", "1000:1000", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true", "--pids-limit", "64",
      "--memory", "128m", "--cpus", "0.5", "--env", "WEB_LAB_LOCAL_ONLY=1",
      "--mount", "type=bind,src=" + record.bundleDir + ",dst=/bundle,readonly",
      this.image, ...this.challengeCommand,
    );
    if (!record.endpoint) {
      await docker(
        "run", "-d", "--name", record.proxyName, "--network", "bridge",
        ...this.resourceLabels(record, "proxy"),
        "--read-only", "--user", "1000:1000", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true", "--pids-limit", "64",
        "--memory", "128m", "--cpus", "0.5",
        "--env", "WEB_LAB_UPSTREAM_HOST=" + record.containerName,
        ...(record.proxyAccessKey ? ["--env", "WEB_LAB_PROXY_KEY=" + record.proxyAccessKey] : []),
        "-p", "127.0.0.1::8080", this.image, "node", "/app/proxy.js",
      );
      await docker("network", "connect", record.networkName, record.proxyName);
    }
    let binding;
    try {
      binding = await docker("port", record.proxyName, "8080/tcp");
    } catch {
      const detail = JSON.parse(await docker("inspect", record.proxyName))[0];
      const output = await execFileAsync("docker", ["logs", record.proxyName], { maxBuffer: 1024 * 1024 });
      const logs = output.stdout + output.stderr;
      throw new Error("Challenge port unavailable (container " + detail.State.Status + ", exit " + detail.State.ExitCode + "): " + logs.slice(0, 500));
    }
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    if (!match) throw new Error("Docker did not publish to localhost only");
    record.endpoint = "http://127.0.0.1:" + match[1];
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch(record.endpoint, {
          headers: this.proxyHeaders(record), signal: AbortSignal.timeout(500),
        });
        if (response.ok) return;
      } catch { /* container starting */ }
      await wait(100);
    }
    throw new Error("Challenge container failed to become ready");
  }

  async create(spec, managedContext = null) {
    const compiled = compileWebLab(spec);
    const template = webApplicationTemplate(spec.templateId);
    if (!template) throw new Error("Unknown Web lab template");
    const stored = template.bindings.stored;
    const canonical = canonicalWebLabRuntimeState(spec);
    const bundle = runtimeHtml(compiled.html, stored.input);
    const instanceId = randomUUID().replaceAll("-", "");
    if (managedContext && (managedContext.runtimeVersion !== PHASE8_RUNTIME_VERSION ||
      managedContext.buildFingerprint !== compiled.manifest.canonicalSpecSha256 ||
      !/^[0-9a-f-]{36}$/.test(managedContext.instanceId) ||
      !Number.isSafeInteger(managedContext.generationVersion) || managedContext.generationVersion < 1)) {
      throw new Error("Invalid managed runtime context");
    }
    const record = {
      instanceId,
      buildFingerprint: compiled.manifest.canonicalSpecSha256,
      templateId: compiled.manifest.templateId,
      templateVersion: compiled.manifest.templateVersion,
      vulnerabilityId: compiled.manifest.vulnerabilityId,
      vulnerabilityVersion: compiled.manifest.vulnerabilityVersion,
      seed: compiled.manifest.seed,
      createdAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
      status: "creating",
      endpoint: null,
      proxyAccessKey: this.gatewayOnly ? randomBytes(32).toString("base64url") : null,
      spec,
      compiled,
      initialFingerprint: sha256(JSON.stringify(canonical)),
      containerName: "amniora-web-" + instanceId,
      proxyName: "amniora-web-proxy-" + instanceId,
      networkName: "amniora-web-" + instanceId,
      bundleDir: null,
      managedContext,
    };
    this.instances.set(instanceId, record);
    try {
      record.bundleDir = managedContext
        ? path.join("/private/tmp", `amniora-web-runtime-${instanceId}`)
        : fs.mkdtempSync(path.join("/private/tmp", "amniora-web-runtime-"));
      if (managedContext) fs.mkdirSync(record.bundleDir, { mode: 0o755 });
      fs.chmodSync(record.bundleDir, 0o755);
      fs.writeFileSync(path.join(record.bundleDir, "index.html"), bundle, { mode: 0o644 });
      fs.writeFileSync(path.join(record.bundleDir, "initial-state.json"), JSON.stringify(canonical), { mode: 0o644 });
      const writableObjectIds = spec.templateId === "ecommerce"
        ? spec.products.filter(product => product.reviewEnabled).map(product => product.id)
        : spec.tickets.filter(ticket => ticket.replyEnabled && ticket.ownerId === spec.session.displayUserId).map(ticket => ticket.id);
      fs.writeFileSync(path.join(record.bundleDir, "runtime-config.json"), JSON.stringify({
        storedField: stored.input,
        storedRoute: stored.route,
        writableObjectIds,
        displayUserId: spec.session.displayUserId,
      }), { mode: 0o644 });
      await docker("network", "create", "--internal", "--driver", "bridge",
        ...this.resourceLabels(record, "network"), record.networkName);
      await this.startContainer(record);
      record.status = "ready";
      return this.publicStatus(record);
    } catch (error) {
      await this.cleanup(record);
      record.status = "failed";
      error.instanceId = instanceId;
      throw error;
    }
  }

  async status(instanceId) {
    const record = this.getRecord(instanceId);
    if (record.status === "ready" && this.now() >= record.expiresAt) await this.expire(instanceId);
    return this.publicStatus(record);
  }

  async readyRecord(instanceId) {
    const current = await this.status(instanceId);
    if (current.status !== "ready") throw new Error("Runtime instance is not ready");
    return this.getRecord(instanceId);
  }

  async state(instanceId) {
    const record = await this.readyRecord(instanceId);
    const response = await fetch(record.endpoint + "/__runtime/state", {
      headers: this.proxyHeaders(record), signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error("Runtime state unavailable");
    return response.json();
  }

  proxyHeaders(record) {
    return record.proxyAccessKey ? { "X-Web-Lab-Proxy-Key": record.proxyAccessKey } : {};
  }

  async reset(instanceId, managedContext = null) {
    const record = await this.readyRecord(instanceId);
    record.status = "resetting";
    try {
      if (managedContext) {
        if (!record.managedContext || managedContext.instanceId !== record.managedContext.instanceId ||
          managedContext.buildFingerprint !== record.buildFingerprint ||
          managedContext.runtimeVersion !== PHASE8_RUNTIME_VERSION ||
          !Number.isSafeInteger(managedContext.generationVersion) ||
          managedContext.generationVersion <= record.managedContext.generationVersion) {
          throw new Error("Invalid managed reset context");
        }
        record.managedContext = managedContext;
        record.proxyAccessKey = randomBytes(32).toString("base64url");
        record.endpoint = null;
        try { await docker("rm", "-f", record.proxyName); } catch { /* absent */ }
      }
      await docker("rm", "-f", record.containerName);
      if (managedContext) {
        await docker("network", "rm", record.networkName);
        await docker("network", "create", "--internal", "--driver", "bridge",
          ...this.resourceLabels(record, "network"), record.networkName);
      }
      await this.startContainer(record);
      record.status = "ready";
      return this.publicStatus(record);
    } catch (error) {
      await this.cleanup(record);
      record.status = "failed";
      throw error;
    }
  }

  async cleanup(record) {
    try { await docker("rm", "-f", record.proxyName); } catch { /* absent */ }
    try { await docker("rm", "-f", record.containerName); } catch { /* absent */ }
    try { await docker("network", "rm", record.networkName); } catch { /* absent */ }
    if (record.bundleDir) fs.rmSync(record.bundleDir, { recursive: true, force: true });
    const leaked = [];
    if (await dockerResourceExists("inspect", record.proxyName)) leaked.push("proxy");
    if (await dockerResourceExists("inspect", record.containerName)) leaked.push("challenge");
    if (await dockerResourceExists("network", "inspect", record.networkName)) leaked.push("network");
    if (record.bundleDir && fs.existsSync(record.bundleDir)) leaked.push("bundle");
    if (leaked.length) throw new Error("Runtime cleanup incomplete: " + leaked.join(", "));
    record.lastEndpoint = record.endpoint;
    record.endpoint = null;
  }

  async destroy(instanceId) {
    const record = this.getRecord(instanceId);
    if (record.status !== "destroyed" && record.status !== "expired") await this.cleanup(record);
    record.status = "destroyed";
    return this.publicStatus(record);
  }

  async expire(instanceId) {
    const record = this.getRecord(instanceId);
    if (record.status === "ready" && this.now() >= record.expiresAt) {
      await this.cleanup(record);
      record.status = "expired";
    }
    return this.publicStatus(record);
  }

  async grade(instanceId, options = {}) {
    const record = await this.readyRecord(instanceId);
    const { gradeInstance } = require("./trustedObserver");
    return gradeInstance(record, options);
  }
}

module.exports = { LocalWebLabRuntimeManager, docker, IMAGE, PHASE8_LABEL_PREFIX, PHASE8_RUNTIME_VERSION };
