import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { compileWebLab } from "../compiler";
import type { WebLabBuildManifest } from "../manifest";
import type { WebLabSpec } from "../schema";
import { buildLocalRunnerRuntimeBundle, LOCAL_RUNNER_BUNDLE_PATHS, type LocalRunnerBundleFile } from "./runtime-bundle";
import {
  hasExactKeys,
  isPlainObject,
  LocalRunnerError,
  LOCAL_RUNNER_PACKAGE_VERSION,
  LOCAL_RUNNER_PROTOCOL_VERSION,
  LOCAL_RUNNER_RUNTIME_VERSION,
  validFingerprint,
  validOpaqueId,
} from "./protocol";

export type LocalRunnerPackageUnsigned = Readonly<{
  packageVersion: typeof LOCAL_RUNNER_PACKAGE_VERSION;
  protocolVersion: typeof LOCAL_RUNNER_PROTOCOL_VERSION;
  buildId: string;
  buildFingerprint: string;
  schemaVersion: 1;
  templateId: WebLabSpec["templateId"];
  templateVersion: WebLabSpec["templateVersion"];
  vulnerabilityModuleId: WebLabSpec["vulnerability"]["moduleId"];
  vulnerabilityModuleVersion: WebLabSpec["vulnerability"]["moduleVersion"];
  runtimeVersion: typeof LOCAL_RUNNER_RUNTIME_VERSION;
  seed: string;
  issuedAt: number;
  expiresAt: number;
  signatureAlgorithm: "Ed25519";
  keyId: string;
  manifest: WebLabBuildManifest;
  bundle: readonly LocalRunnerBundleFile[];
}>;

export type LocalRunnerPackage = LocalRunnerPackageUnsigned & Readonly<{ signature: string }>;

export type LocalRunnerBuildInput = Readonly<{
  buildId: string;
  ownerId: string;
  explicitExecutable: true;
  spec: WebLabSpec;
}>;

export type LocalRunnerPackageActor = Readonly<{ userId: string }>;
export type LocalRunnerSigningAuthority = Readonly<{ keyId: string; privateKey: KeyObject | string | Buffer }>;
export type LocalRunnerVerificationKeys = ReadonlyMap<string, KeyObject | string | Buffer>;

const PACKAGE_KEYS = [
  "packageVersion", "protocolVersion", "buildId", "buildFingerprint", "schemaVersion", "templateId",
  "templateVersion", "vulnerabilityModuleId", "vulnerabilityModuleVersion", "runtimeVersion", "seed",
  "issuedAt", "expiresAt", "signatureAlgorithm", "keyId", "manifest", "bundle", "signature",
] as const;
const MANIFEST_KEYS = [
  "schemaVersion", "templateId", "templateVersion", "vulnerabilityId", "vulnerabilityVersion", "seed",
  "difficulty", "durationMinutes", "canonicalSpecSha256", "learnerBundleSha256",
] as const;
const BUNDLE_KEYS = ["path", "content", "sha256"] as const;

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function unsignedPackage(value: LocalRunnerPackage): LocalRunnerPackageUnsigned {
  const { signature, ...unsigned } = value;
  void signature;
  return unsigned;
}

function signingBytes(value: LocalRunnerPackageUnsigned): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}

function signingPrivateKey(value: KeyObject | string | Buffer): KeyObject {
  return typeof value === "object" && !Buffer.isBuffer(value) && "type" in value ? value : createPrivateKey(value);
}

function verificationPublicKey(value: KeyObject | string | Buffer): KeyObject {
  return typeof value === "object" && !Buffer.isBuffer(value) && "type" in value
    ? (value.type === "private" ? createPublicKey(value) : value)
    : createPublicKey(value);
}

export function createLocalRunnerPackage(
  build: LocalRunnerBuildInput,
  actor: LocalRunnerPackageActor,
  authority: LocalRunnerSigningAuthority,
  options: Readonly<{ now?: () => number; lifetimeMs?: number }> = {},
): LocalRunnerPackage {
  if (build.explicitExecutable !== true || actor.userId !== build.ownerId || !validOpaqueId(build.buildId) ||
      !validOpaqueId(build.ownerId) || !validOpaqueId(authority.keyId, 64)) {
    throw new LocalRunnerError("PACKAGE_INVALID");
  }
  const now = options.now?.() ?? Date.now();
  const lifetimeMs = options.lifetimeMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1_000 || lifetimeMs > 24 * 60 * 60_000) {
    throw new LocalRunnerError("PACKAGE_INVALID");
  }
  const compiled = compileWebLab(build.spec);
  const bundle = buildLocalRunnerRuntimeBundle(build.spec);
  const unsigned: LocalRunnerPackageUnsigned = {
    packageVersion: LOCAL_RUNNER_PACKAGE_VERSION,
    protocolVersion: LOCAL_RUNNER_PROTOCOL_VERSION,
    buildId: build.buildId,
    buildFingerprint: compiled.manifest.canonicalSpecSha256,
    schemaVersion: build.spec.schemaVersion,
    templateId: build.spec.templateId,
    templateVersion: build.spec.templateVersion,
    vulnerabilityModuleId: build.spec.vulnerability.moduleId,
    vulnerabilityModuleVersion: build.spec.vulnerability.moduleVersion,
    runtimeVersion: LOCAL_RUNNER_RUNTIME_VERSION,
    seed: build.spec.seed,
    issuedAt: now,
    expiresAt: now + lifetimeMs,
    signatureAlgorithm: "Ed25519",
    keyId: authority.keyId,
    manifest: { ...compiled.manifest, learnerBundleSha256: bundle[0].sha256 },
    bundle,
  };
  const signature = sign(null, signingBytes(unsigned), signingPrivateKey(authority.privateKey)).toString("base64url");
  return { ...unsigned, signature };
}

function structurallyValid(input: unknown): input is LocalRunnerPackage {
  if (!isPlainObject(input) || !hasExactKeys(input, PACKAGE_KEYS)) return false;
  if (input.packageVersion !== LOCAL_RUNNER_PACKAGE_VERSION || input.protocolVersion !== LOCAL_RUNNER_PROTOCOL_VERSION ||
      !validOpaqueId(input.buildId) || !validFingerprint(input.buildFingerprint) || input.schemaVersion !== 1 ||
      !["helpdesk", "ecommerce"].includes(String(input.templateId)) || input.templateVersion !== "1.0.0" ||
      !["reflected-xss", "stored-xss"].includes(String(input.vulnerabilityModuleId)) ||
      input.vulnerabilityModuleVersion !== "1.0.0" || input.runtimeVersion !== LOCAL_RUNNER_RUNTIME_VERSION ||
      typeof input.seed !== "string" || input.seed.length < 1 || input.seed.length > 128 ||
      !Number.isSafeInteger(input.issuedAt) || !Number.isSafeInteger(input.expiresAt) ||
      (input.expiresAt as number) <= (input.issuedAt as number) || input.signatureAlgorithm !== "Ed25519" ||
      !validOpaqueId(input.keyId, 64) || typeof input.signature !== "string" ||
      !/^[A-Za-z0-9_-]{86}$/.test(input.signature)) return false;
  if (!isPlainObject(input.manifest) || !hasExactKeys(input.manifest, MANIFEST_KEYS) ||
      input.manifest.schemaVersion !== 1 || input.manifest.templateId !== input.templateId ||
      input.manifest.templateVersion !== input.templateVersion || input.manifest.vulnerabilityId !== input.vulnerabilityModuleId ||
      input.manifest.vulnerabilityVersion !== input.vulnerabilityModuleVersion || input.manifest.seed !== input.seed ||
      input.manifest.difficulty !== "Beginner" || input.manifest.durationMinutes !== 30 ||
      !validFingerprint(input.manifest.canonicalSpecSha256) || !validFingerprint(input.manifest.learnerBundleSha256)) return false;
  if (!Array.isArray(input.bundle) || input.bundle.length !== LOCAL_RUNNER_BUNDLE_PATHS.length) return false;
  return input.bundle.every((file, index) => isPlainObject(file) && hasExactKeys(file, BUNDLE_KEYS) &&
    file.path === LOCAL_RUNNER_BUNDLE_PATHS[index] && typeof file.content === "string" &&
    Buffer.byteLength(file.content, "utf8") <= 384 * 1024 && validFingerprint(file.sha256));
}

export function verifyLocalRunnerPackage(
  input: unknown,
  keys: LocalRunnerVerificationKeys,
  options: Readonly<{ now?: () => number; expectedBuildId?: string; expectedBuildFingerprint?: string; allowExpired?: boolean }> = {},
): LocalRunnerPackage {
  if (!isPlainObject(input)) throw new LocalRunnerError("PACKAGE_INVALID");
  if (input.packageVersion !== LOCAL_RUNNER_PACKAGE_VERSION) throw new LocalRunnerError("PACKAGE_VERSION_UNSUPPORTED");
  if (input.protocolVersion !== LOCAL_RUNNER_PROTOCOL_VERSION) throw new LocalRunnerError("PROTOCOL_VERSION_UNSUPPORTED");
  if (input.runtimeVersion !== LOCAL_RUNNER_RUNTIME_VERSION) throw new LocalRunnerError("RUNTIME_VERSION_UNSUPPORTED");
  if (!structurallyValid(input)) throw new LocalRunnerError("PACKAGE_INVALID");

  const key = keys.get(input.keyId);
  if (!key || !verify(null, signingBytes(unsignedPackage(input)), verificationPublicKey(key), Buffer.from(input.signature, "base64url"))) {
    throw new LocalRunnerError("PACKAGE_SIGNATURE_INVALID");
  }
  const now = options.now?.() ?? Date.now();
  if (!options.allowExpired && now >= input.expiresAt) throw new LocalRunnerError("PACKAGE_EXPIRED");
  if (input.issuedAt > now + 60_000) throw new LocalRunnerError("PACKAGE_INVALID");
  if (input.buildFingerprint !== input.manifest.canonicalSpecSha256 ||
      (options.expectedBuildFingerprint && input.buildFingerprint !== options.expectedBuildFingerprint) ||
      (options.expectedBuildId && input.buildId !== options.expectedBuildId)) {
    throw new LocalRunnerError("BUILD_FINGERPRINT_MISMATCH");
  }
  for (const file of input.bundle) {
    if (sha256(file.content) !== file.sha256) throw new LocalRunnerError("PACKAGE_INVALID");
  }
  const html = input.bundle[0];
  if (sha256(html.content) !== input.manifest.learnerBundleSha256) throw new LocalRunnerError("BUILD_FINGERPRINT_MISMATCH");
  return input;
}

export function serializedPackageBytes(value: LocalRunnerPackage): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
