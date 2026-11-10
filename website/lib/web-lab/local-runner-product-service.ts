/** Trusted product boundary. Browser identity never supplies a spec, build, or signing key. */
import "server-only";
import { createPublicKey } from "node:crypto";
import { compileWebLab } from "./compiler";
import type { PostgresWebLabControlRepository, SafeBuildMetadata } from "./postgres-control-repository";
import { ExactWebLabCompatibilityPolicy, type AuthenticatedWebLabActor } from "./production-control-service";
import {
  createLocalRunnerPackage, verifyLocalRunnerPackage,
  type LocalRunnerPackage, type LocalRunnerSigningAuthority,
} from "./local-runner/package";
import { LOCAL_RUNNER_RUNTIME_VERSION } from "./local-runner/protocol";
import {
  EarlyAccessSecurityError,
  safeRequestFingerprint,
  type DistributedAbusePolicy,
  type WebLabAlertSink,
} from "./production-security-controls";

export type LocalRunnerProductErrorCode =
  | "UNAUTHENTICATED" | "LAB_NOT_FOUND" | "LAB_INCOMPATIBLE" | "LOCAL_RUNNER_UNAVAILABLE"
  | "RATE_LIMITED" | "INVALID_REQUEST" | "CSRF_REJECTED" | "REQUEST_TOO_LARGE" | "INTERNAL_ERROR";

export class LocalRunnerProductError extends Error {
  constructor(readonly code: LocalRunnerProductErrorCode) { super(code); }
}

export type LocalRunnerEligibility = Readonly<{
  enabled: boolean;
  eligible: boolean;
  build: Readonly<{ buildId: string; buildFingerprint: string; runtimeVersion: string }> | null;
}>;

export const LOCAL_RUNNER_PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_KEY = /^[A-Za-z0-9_-]{1,160}$/;
type Repository = Pick<PostgresWebLabControlRepository, "getBuildMetadata" | "getTrustedBuild">;

/** No entitlement/provider/grading dependency: both Free and Pro can run a compatible owned build. */
export class LocalRunnerProductService {
  private readonly compatibility = new ExactWebLabCompatibilityPolicy();
  constructor(private readonly dependencies: {
    repository: Repository;
    signingAuthority: () => LocalRunnerSigningAuthority;
    abusePolicy?: DistributedAbusePolicy;
    alerts?: WebLabAlertSink;
    now?: () => number;
  }) {}

  private async ownedBuild(actor: AuthenticatedWebLabActor, savedLabId: string) {
    if (!actor || !LOCAL_RUNNER_PRODUCT_ID.test(actor.userId) ||
        typeof actor.sessionId !== "string" || !actor.sessionId || actor.sessionId.length > 160) {
      throw new LocalRunnerProductError("UNAUTHENTICATED");
    }
    if (!LOCAL_RUNNER_PRODUCT_ID.test(savedLabId)) throw new LocalRunnerProductError("LAB_NOT_FOUND");
    // This private immutable table has a composite FK to labs(id,user_id). Category is never eligibility.
    const metadata = await this.dependencies.repository.getBuildMetadata(savedLabId, actor.userId);
    if (!metadata) return null;
    if (metadata.savedLabId !== savedLabId || !LOCAL_RUNNER_PRODUCT_ID.test(metadata.id) ||
        this.compatibility.verdict(metadata, "local_runner", LOCAL_RUNNER_RUNTIME_VERSION) !== "SUPPORTED") {
      throw new LocalRunnerProductError("LAB_INCOMPATIBLE");
    }
    try {
      const trusted = await this.dependencies.repository.getTrustedBuild(metadata.id, actor.userId);
      if (!trusted) throw new LocalRunnerProductError("LAB_NOT_FOUND");
      const identity: readonly (keyof SafeBuildMetadata)[] = ["id", "savedLabId", "canonicalLabId",
        "templateId", "templateVersion", "vulnerabilityModuleId", "vulnerabilityModuleVersion",
        "schemaVersion", "compilerVersion", "runtimeVersion", "buildFingerprint"];
      if (identity.some(key => metadata[key] !== trusted.metadata[key])) {
        throw new LocalRunnerProductError("LAB_INCOMPATIBLE");
      }
      const manifest = compileWebLab(trusted.spec).manifest;
      if (manifest.canonicalSpecSha256 !== metadata.buildFingerprint ||
          trusted.spec.labId !== metadata.canonicalLabId || manifest.schemaVersion !== metadata.schemaVersion ||
          manifest.templateId !== metadata.templateId || manifest.templateVersion !== metadata.templateVersion ||
          manifest.vulnerabilityId !== metadata.vulnerabilityModuleId ||
          manifest.vulnerabilityVersion !== metadata.vulnerabilityModuleVersion) {
        throw new LocalRunnerProductError("LAB_INCOMPATIBLE");
      }
      return trusted;
    } catch (error) {
      if (error instanceof LocalRunnerProductError) throw error;
      // Neither compiler exceptions nor canonical-spec details belong in an HTTP response.
      throw new LocalRunnerProductError("LAB_INCOMPATIBLE");
    }
  }

  async eligibility(actor: AuthenticatedWebLabActor, savedLabId: string): Promise<LocalRunnerEligibility> {
    const build = await this.ownedBuild(actor, savedLabId);
    return {
      enabled: true,
      eligible: build !== null,
      build: build ? { buildId: build.metadata.id, buildFingerprint: build.metadata.buildFingerprint,
        runtimeVersion: LOCAL_RUNNER_RUNTIME_VERSION } : null,
    };
  }

  async issuePackage(actor: AuthenticatedWebLabActor, savedLabId: string,
    idempotencyKey?: string): Promise<LocalRunnerPackage> {
    if (this.dependencies.abusePolicy) {
      if (!idempotencyKey || !REQUEST_KEY.test(idempotencyKey)) throw new LocalRunnerProductError("INVALID_REQUEST");
      try {
        await this.dependencies.abusePolicy.assertAllowed({ ownerId: actor.userId,
          surface: "runner_package", idempotencyKey,
          requestFingerprint: safeRequestFingerprint({ savedLabId }) });
      } catch (error) {
        if (error instanceof EarlyAccessSecurityError && error.code === "RATE_LIMITED") {
          try { await this.dependencies.alerts?.notify({ code: "PACKAGE_ISSUANCE_DENIED",
            stage: "runner", surface: "runner_package", runtimeMode: "local_runner" }); }
          catch { /* Denial remains authoritative. */ }
          throw new LocalRunnerProductError("RATE_LIMITED");
        }
        try { await this.dependencies.alerts?.notify({ code: "SECURITY_CONTROL_UNAVAILABLE",
          stage: "security_control", surface: "runner_package", runtimeMode: "local_runner" }); }
        catch { /* The request still fails closed. */ }
        throw new LocalRunnerProductError("LOCAL_RUNNER_UNAVAILABLE");
      }
    }
    const build = await this.ownedBuild(actor, savedLabId);
    if (!build) throw new LocalRunnerProductError("LAB_NOT_FOUND");
    const authority = this.dependencies.signingAuthority();
    const now = this.dependencies.now?.() ?? Date.now();
    const issued = createLocalRunnerPackage({ buildId: build.metadata.id, ownerId: actor.userId,
      explicitExecutable: true, spec: build.spec }, actor, authority, { now: () => now });
    // Verify the exact browser-facing contract before releasing the existing signer's output.
    return verifyLocalRunnerPackage(issued, new Map([[authority.keyId, createPublicKey(authority.privateKey)]]), {
      now: () => now, expectedBuildId: build.metadata.id,
      expectedBuildFingerprint: build.metadata.buildFingerprint,
    });
  }
}
