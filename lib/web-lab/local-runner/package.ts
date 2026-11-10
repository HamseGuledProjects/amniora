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
  labType: "web-security";
  supportedPlatforms: readonly LocalRunnerPackagePlatform[];
  image: LocalRunnerImageAuthority;
  healthCheck: LocalRunnerHealthCheck;
  resourcePolicy: LocalRunnerResourcePolicy;
  manifest: WebLabBuildManifest;
  bundle: readonly LocalRunnerBundleFile[];
  packageHash: string;
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
export type LocalRunnerPackagePlatform = "darwin/arm64" | "linux/arm64" | "linux/amd64";
export type LocalRunnerImageAuthority = Readonly<{
  identity: "amniora-web-lab-runtime";
  digest: `sha256:${string}`;
  applicationPort: 8080;
}>;
export type LocalRunnerHealthCheck = Readonly<{
  kind: "http";
  path: "/__runtime/health";
  expectedStatus: 200;
  timeoutMs: number;
}>;
export type LocalRunnerResourcePolicy = Readonly<{
  memoryBytes: number;
  nanoCpus: number;
  pidsLimit: number;
  readOnlyRootFilesystem: true;
  noNewPrivileges: true;
  dropCapabilities: "ALL";
  networkPolicy: "challenge-no-egress";
}>;
export type LocalRunnerRuntimeAuthority = Readonly<{
  supportedPlatforms: readonly LocalRunnerPackagePlatform[];
  image: LocalRunnerImageAuthority;
  healthCheck?: LocalRunnerHealthCheck;
  resourcePolicy?: LocalRunnerResourcePolicy;
}>;

const PACKAGE_KEYS = [
  "packageVersion", "protocolVersion", "buildId", "buildFingerprint", "schemaVersion", "templateId",
  "templateVersion", "vulnerabilityModuleId", "vulnerabilityModuleVersion", "runtimeVersion", "seed",
  "issuedAt", "expiresAt", "signatureAlgorithm", "keyId", "labType", "supportedPlatforms", "image",
  "healthCheck", "resourcePolicy", "manifest", "bundle", "packageHash", "signature",
] as const;
const MANIFEST_KEYS = [
  "schemaVersion", "templateId", "templateVersion", "vulnerabilityId", "vulnerabilityVersion", "seed",
  "difficulty", "durationMinutes", "canonicalSpecSha256", "learnerBundleSha256",
] as const;
const BUNDLE_KEYS = ["path", "content", "sha256"] as const;
const IMAGE_KEYS = ["identity", "digest", "applicationPort"] as const;
const HEALTH_CHECK_KEYS = ["kind", "path", "expectedStatus", "timeoutMs"] as const;
const RESOURCE_POLICY_KEYS = ["memoryBytes", "nanoCpus", "pidsLimit", "readOnlyRootFilesystem", "noNewPrivileges",
  "dropCapabilities", "networkPolicy"] as const;
const PACKAGE_PLATFORMS = new Set<LocalRunnerPackagePlatform>(["darwin/arm64", "linux/arm64", "linux/amd64"]);
const DEFAULT_RESOURCE_POLICY: LocalRunnerResourcePolicy = Object.freeze({
  memoryBytes: 128 * 1024 * 1024,
  nanoCpus: 500_000_000,
  pidsLimit: 64,
  readOnlyRootFilesystem: true,
  noNewPrivileges: true,
  dropCapabilities: "ALL",
  networkPolicy: "challenge-no-egress",
});
const DEFAULT_HEALTH_CHECK: LocalRunnerHealthCheck = Object.freeze({
  kind: "http",
  path: "/__runtime/health",
  expectedStatus: 200,
  timeoutMs: 10_000,
});
const DEFAULT_IMAGE_DIGEST = `sha256:${sha256(`amniora:${LOCAL_RUNNER_RUNTIME_VERSION}:reviewed-container-context`)}` as const;

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function unsignedPackage(value: LocalRunnerPackage): LocalRunnerPackageUnsigned {
  const { signature, ...unsigned } = value;
  void signature;
  return unsigned;
}

function packageHashBytes(value: Omit<LocalRunnerPackageUnsigned, "packageHash">): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}

function hashablePackage(value: LocalRunnerPackageUnsigned): Omit<LocalRunnerPackageUnsigned, "packageHash"> {
  const { packageHash, ...hashable } = value;
  void packageHash;
  return hashable;
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
  options: Readonly<{ now?: () => number; lifetimeMs?: number; runtimeAuthority?: LocalRunnerRuntimeAuthority }> = {},
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
  const runtimeAuthority: LocalRunnerRuntimeAuthority = options.runtimeAuthority ?? Object.freeze({
    supportedPlatforms: ["darwin/arm64", "linux/arm64", "linux/amd64"] as const,
    image: Object.freeze({ identity: "amniora-web-lab-runtime" as const, digest: DEFAULT_IMAGE_DIGEST, applicationPort: 8080 as const }),
  });
  const hashable: Omit<LocalRunnerPackageUnsigned, "packageHash"> = {
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
    labType: "web-security",
    supportedPlatforms: [...runtimeAuthority.supportedPlatforms],
    image: runtimeAuthority.image,
    healthCheck: runtimeAuthority.healthCheck ?? DEFAULT_HEALTH_CHECK,
    resourcePolicy: runtimeAuthority.resourcePolicy ?? DEFAULT_RESOURCE_POLICY,
    manifest: { ...compiled.manifest, learnerBundleSha256: bundle[0].sha256 },
    bundle,
  };
  const unsigned: LocalRunnerPackageUnsigned = { ...hashable, packageHash: sha256(packageHashBytes(hashable).toString("utf8")) };
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
  if (input.labType !== "web-security" || !Array.isArray(input.supportedPlatforms) || input.supportedPlatforms.length < 1 ||
      input.supportedPlatforms.length > PACKAGE_PLATFORMS.size || new Set(input.supportedPlatforms).size !== input.supportedPlatforms.length ||
      input.supportedPlatforms.some(value => !PACKAGE_PLATFORMS.has(value as LocalRunnerPackagePlatform)) ||
      !isPlainObject(input.image) || !hasExactKeys(input.image, IMAGE_KEYS) ||
      input.image.identity !== "amniora-web-lab-runtime" || typeof input.image.digest !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(input.image.digest) || input.image.applicationPort !== 8080 ||
      !isPlainObject(input.healthCheck) || !hasExactKeys(input.healthCheck, HEALTH_CHECK_KEYS) ||
      input.healthCheck.kind !== "http" || input.healthCheck.path !== "/__runtime/health" ||
      input.healthCheck.expectedStatus !== 200 || !Number.isSafeInteger(input.healthCheck.timeoutMs) ||
      Number(input.healthCheck.timeoutMs) < 1_000 || Number(input.healthCheck.timeoutMs) > 30_000 ||
      !isPlainObject(input.resourcePolicy) || !hasExactKeys(input.resourcePolicy, RESOURCE_POLICY_KEYS) ||
      !Number.isSafeInteger(input.resourcePolicy.memoryBytes) || Number(input.resourcePolicy.memoryBytes) < 64 * 1024 * 1024 ||
      Number(input.resourcePolicy.memoryBytes) > 512 * 1024 * 1024 || !Number.isSafeInteger(input.resourcePolicy.nanoCpus) ||
      Number(input.resourcePolicy.nanoCpus) < 100_000_000 || Number(input.resourcePolicy.nanoCpus) > 2_000_000_000 ||
      !Number.isSafeInteger(input.resourcePolicy.pidsLimit) || Number(input.resourcePolicy.pidsLimit) < 16 ||
      Number(input.resourcePolicy.pidsLimit) > 256 || input.resourcePolicy.readOnlyRootFilesystem !== true ||
      input.resourcePolicy.noNewPrivileges !== true || input.resourcePolicy.dropCapabilities !== "ALL" ||
      input.resourcePolicy.networkPolicy !== "challenge-no-egress" || !validFingerprint(input.packageHash)) return false;
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
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > 512 * 1024) throw new LocalRunnerError("PACKAGE_INVALID");
  if (input.packageVersion !== LOCAL_RUNNER_PACKAGE_VERSION) throw new LocalRunnerError("PACKAGE_VERSION_UNSUPPORTED");
  if (input.protocolVersion !== LOCAL_RUNNER_PROTOCOL_VERSION) throw new LocalRunnerError("PROTOCOL_VERSION_UNSUPPORTED");
  if (input.runtimeVersion !== LOCAL_RUNNER_RUNTIME_VERSION) throw new LocalRunnerError("RUNTIME_VERSION_UNSUPPORTED");
  if (!structurallyValid(input)) throw new LocalRunnerError("PACKAGE_INVALID");

  const key = keys.get(input.keyId);
  if (!key || !verify(null, signingBytes(unsignedPackage(input)), verificationPublicKey(key), Buffer.from(input.signature, "base64url"))) {
    throw new LocalRunnerError("PACKAGE_SIGNATURE_INVALID");
  }
  if (sha256(packageHashBytes(hashablePackage(unsignedPackage(input))).toString("utf8")) !== input.packageHash) {
    throw new LocalRunnerError("PACKAGE_HASH_MISMATCH");
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

export function localRunnerPlatform(platform: NodeJS.Platform | "linux", architecture: string): LocalRunnerPackagePlatform | null {
  const value = `${platform}/${architecture}`;
  return PACKAGE_PLATFORMS.has(value as LocalRunnerPackagePlatform) ? value as LocalRunnerPackagePlatform : null;
}

export function packageSupportsPlatform(pkg: LocalRunnerPackage, platform: NodeJS.Platform | "linux", architecture: string): boolean {
  const expected = localRunnerPlatform(platform, architecture);
  return expected !== null && pkg.supportedPlatforms.includes(expected);
}

export function serializedPackageBytes(value: LocalRunnerPackage): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
