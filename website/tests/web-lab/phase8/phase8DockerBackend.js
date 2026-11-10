// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS Phase 8 Docker adapter. */
"use strict";
const fs = require("node:fs");
const {
  LocalWebLabRuntimeManager, docker, PHASE8_LABEL_PREFIX, PHASE8_RUNTIME_VERSION,
} = require("../phase5/runtimeManager");
const { gradeInstance } = require("../phase5/trustedObserver");

const labelName = suffix => `${PHASE8_LABEL_PREFIX}.${suffix}`;
const managedFilter = `${labelName("managed")}=phase8`;
const bundlePattern = /^\/private\/tmp\/amniora-web-runtime-[A-Za-z0-9]+$/;

function labelsOf(detail) {
  return detail?.Config?.Labels || detail?.Labels || {};
}

function identity(detail) {
  const labels = labelsOf(detail);
  const generationVersion = Number(labels[labelName("generation")]);
  const reference = labels[labelName("backend")];
  const instanceId = labels[labelName("instance")];
  const buildFingerprint = labels[labelName("build")];
  const runtimeVersion = labels[labelName("runtime-version")];
  if (labels[labelName("managed")] !== "phase8" || !/^[0-9a-f]{32}$/.test(reference || "") ||
    !/^[0-9a-f-]{36}$/.test(instanceId || "") || !/^[0-9a-f]{64}$/.test(buildFingerprint || "") ||
    runtimeVersion !== PHASE8_RUNTIME_VERSION || !Number.isSafeInteger(generationVersion) || generationVersion < 1) return null;
  return { reference, instanceId, buildFingerprint, generationVersion, runtimeVersion };
}

function sameIdentity(left, right) {
  return left.reference === right.reference && left.instanceId === right.instanceId &&
    left.buildFingerprint === right.buildFingerprint && left.generationVersion === right.generationVersion &&
    left.runtimeVersion === right.runtimeVersion;
}

function expectedIdentity(reference, expected) {
  return {
    reference, instanceId: expected.instanceId, buildFingerprint: expected.buildFingerprint,
    generationVersion: expected.generationVersion, runtimeVersion: expected.runtimeVersion,
  };
}

async function inspectMany(kind, ids) {
  if (!ids.length) return [];
  const raw = kind === "container" ? await docker("inspect", ...ids) : await docker("network", "inspect", ...ids);
  return JSON.parse(raw);
}

async function managedResources() {
  const containerIds = (await docker("container", "ls", "-aq", "--filter", `label=${managedFilter}`)).split("\n").filter(Boolean);
  const networkIds = (await docker("network", "ls", "-q", "--filter", `label=${managedFilter}`)).split("\n").filter(Boolean);
  const [containers, networks] = await Promise.all([
    inspectMany("container", containerIds), inspectMany("network", networkIds),
  ]);
  return [
    ...containers.map(detail => ({ kind: "container", id: detail.Id, detail })),
    ...networks.map(detail => ({ kind: "network", id: detail.Id, detail })),
  ];
}

function roleOf(resource) {
  return labelsOf(resource.detail)[labelName("role")];
}

function bundleSources(resources) {
  const sources = new Set();
  for (const resource of resources) {
    if (resource.kind !== "container" || roleOf(resource) !== "challenge") continue;
    const mount = resource.detail.Mounts?.find(item => item.Destination === "/bundle" && item.Type === "bind");
    if (mount?.Source && bundlePattern.test(mount.Source)) sources.add(mount.Source);
  }
  return [...sources];
}

async function observations() {
  const groups = new Map();
  for (const resource of await managedResources()) {
    const observedIdentity = identity(resource.detail);
    if (!observedIdentity) continue;
    const key = [observedIdentity.instanceId, observedIdentity.reference, observedIdentity.buildFingerprint,
      observedIdentity.generationVersion, observedIdentity.runtimeVersion].join("|");
    const group = groups.get(key) || { ...observedIdentity, resources: [] };
    group.resources.push(resource);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const roles = new Set(group.resources.map(roleOf));
    const challenge = group.resources.find(item => roleOf(item) === "challenge");
    const proxy = group.resources.find(item => roleOf(item) === "proxy");
    const network = group.resources.find(item => roleOf(item) === "network");
    const running = challenge?.detail.State?.Running === true && proxy?.detail.State?.Running === true;
    return {
      reference: group.reference, instanceId: group.instanceId, buildFingerprint: group.buildFingerprint,
      generationVersion: group.generationVersion, runtimeVersion: group.runtimeVersion,
      state: roles.size === 3 && challenge && proxy && network && running ? "ready" : "partial",
      resources: group.resources,
    };
  });
}

async function revalidate(resource, expected) {
  try {
    const raw = resource.kind === "container"
      ? await docker("inspect", resource.id)
      : await docker("network", "inspect", resource.id);
    const current = JSON.parse(raw)[0];
    return identity(current) && sameIdentity(identity(current), expected) && roleOf({ detail: current }) === roleOf(resource);
  } catch {
    return false;
  }
}

async function destroyObservation(observation) {
  const expected = {
    reference: observation.reference, instanceId: observation.instanceId,
    buildFingerprint: observation.buildFingerprint, generationVersion: observation.generationVersion,
    runtimeVersion: observation.runtimeVersion,
  };
  const resources = observation.resources || [];
  const bundles = new Set([
    ...bundleSources(resources),
    `/private/tmp/amniora-web-runtime-${observation.reference}`,
  ]);
  for (const resource of resources.filter(item => item.kind === "container")) {
    if (await revalidate(resource, expected)) await docker("rm", "-f", resource.id);
  }
  for (const resource of resources.filter(item => item.kind === "network")) {
    if (await revalidate(resource, expected)) await docker("network", "rm", resource.id);
  }
  for (const source of bundles) {
    if (bundlePattern.test(source)) fs.rmSync(source, { recursive: true, force: true });
  }
}

function phase8DockerBackend({ now = () => Date.now(), ttlMs = 15 * 60_000 } = {}) {
  const manager = new LocalWebLabRuntimeManager({ now, ttlMs, gatewayOnly: true });

  async function listManaged() {
    return observations();
  }

  async function inspect(reference, expected) {
    const found = (await observations()).filter(item => item.reference === reference);
    if (!found.length) return { state: "missing", observation: null };
    const wanted = expectedIdentity(reference, expected);
    const exact = found.find(item => sameIdentity(item, wanted));
    if (!exact) return { state: "mismatch", observation: found[0] };
    return { state: exact.state === "ready" ? "ready" : "failed", observation: exact };
  }

  async function resolveBackend(reference, expected = null) {
    const found = (await observations()).find(item => item.reference === reference && item.state === "ready" &&
      (!expected || (item.instanceId === expected.instanceId && item.generationVersion === expected.generationVersion)));
    if (!found) return null;
    const proxy = found.resources.find(item => item.kind === "container" && roleOf(item) === "proxy");
    if (!proxy) return null;
    const binding = await docker("port", proxy.id, "8080/tcp");
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    const keyEntry = proxy.detail.Config?.Env?.find(value => value.startsWith("WEB_LAB_PROXY_KEY="));
    const proxyKey = keyEntry?.slice("WEB_LAB_PROXY_KEY=".length);
    if (!match || !/^[A-Za-z0-9_-]{43}$/.test(proxyKey || "")) return null;
    return { origin: `http://127.0.0.1:${match[1]}`, proxyKey };
  }

  async function reset(reference, context) {
    const found = (await observations()).filter(item => item.reference === reference);
    const prior = found.find(item => item.instanceId === context.instanceId &&
      item.buildFingerprint === context.buildFingerprint && item.runtimeVersion === context.runtimeVersion &&
      (item.generationVersion === context.generationVersion - 1 || item.generationVersion === context.generationVersion));
    if (!prior) throw new Error("managed_runtime_identity_mismatch");
    if (prior.generationVersion === context.generationVersion && prior.state === "ready") return;
    const challenge = prior.resources.find(item => item.kind === "container" && roleOf(item) === "challenge");
    const bundleDir = bundleSources(challenge ? [challenge] : [])[0];
    if (!bundleDir || !fs.existsSync(bundleDir)) throw new Error("managed_runtime_bundle_missing");
    const currentBackend = await resolveBackend(reference);
    const record = {
      instanceId: reference, buildFingerprint: context.buildFingerprint,
      templateId: "ecommerce", templateVersion: "recovered", vulnerabilityId: "stored-xss",
      vulnerabilityVersion: "recovered", seed: "recovered", createdAt: now(), expiresAt: now() + ttlMs,
      status: "ready", endpoint: currentBackend?.origin || null, proxyAccessKey: currentBackend?.proxyKey || null,
      spec: null, compiled: null, initialFingerprint: "", containerName: `amniora-web-${reference}`,
      proxyName: `amniora-web-proxy-${reference}`, networkName: `amniora-web-${reference}`,
      bundleDir, managedContext: { ...context, generationVersion: prior.generationVersion },
    };
    manager.instances.set(reference, record);
    await manager.reset(reference, context);
  }

  const backend = {
    async create(spec, context) {
      if (!context) throw new Error("managed_runtime_context_required");
      return (await manager.create(spec, context)).instanceId;
    },
    async status(reference, context) {
      if (!context) return "failed";
      return (await inspect(reference, context)).state === "ready" ? "ready" : "failed";
    },
    reset,
    async destroy(reference, context) {
      const found = (await observations()).filter(item => item.reference === reference);
      for (const item of found) {
        if (context && (item.instanceId !== context.instanceId || item.buildFingerprint !== context.buildFingerprint ||
          item.runtimeVersion !== context.runtimeVersion)) continue;
        await destroyObservation(item);
      }
    },
    inspect,
    listManaged,
    destroyManaged: destroyObservation,
  };

  const grader = {
    async grade(reference, spec) {
      const target = await resolveBackend(reference);
      if (!target || !spec) throw new Error("managed_runtime_unavailable");
      return gradeInstance({
        instanceId: reference, spec, endpoint: target.origin, proxyAccessKey: target.proxyKey,
      });
    },
  };

  async function state(reference) {
    const target = await resolveBackend(reference);
    if (!target) throw new Error("managed_runtime_unavailable");
    const response = await fetch(`${target.origin}/__runtime/state`, {
      headers: { "X-Web-Lab-Proxy-Key": target.proxyKey }, signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error("managed_runtime_state_unavailable");
    return response.json();
  }

  return { manager, backend, grader, resolveBackend, state };
}

module.exports = { phase8DockerBackend, managedResources, managedFilter };
