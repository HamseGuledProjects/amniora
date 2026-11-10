import "server-only";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import postgres from "postgres";
import { PostgresWebLabControlRepository } from "../postgres-control-repository";
import { LocalRunnerProductService as PackageProductService } from "../local-runner-product-service";
import type { LocalRunnerRuntimeAuthority } from "../local-runner/package";
import { validOpaqueId } from "../local-runner/protocol";
import { DurableLocalFirstAuthority } from "./authority";
import { createOwnerProductApi, createPairingApprovalApi, createRunnerProtocolApi } from "./api";
import { authorizeLocalFirstOwner } from "./owner-authorization";
import { PostgresLocalFirstProductRepository } from "./postgres-repository";
import { LocalFirstProductService } from "./product-service";

let resources: Readonly<{
  authority: DurableLocalFirstAuthority;
  service: LocalFirstProductService;
  repository: PostgresLocalFirstProductRepository;
  packageServices: ReadonlyMap<"arm64" | "amd64", PackageProductService>;
  packageAuthorities: ReadonlyMap<"arm64" | "amd64", Readonly<{ keyId: string; privateKey: KeyObject; publicKey: string }>>;
  runtimeAuthorities: ReadonlyMap<"arm64" | "amd64", LocalRunnerRuntimeAuthority>;
}> | null = null;
function enabled(): boolean { return process.env.WEB_LAB_LOCAL_FIRST_OWNER_TEST_ENABLED === "true"; }
function origin(): string | undefined { return process.env.WEB_LAB_APP_ORIGIN; }
function configuredRuntimeAuthorities(): ReadonlyMap<"arm64" | "amd64", LocalRunnerRuntimeAuthority> {
  const values = [
    ["arm64", process.env.WEB_LAB_LOCAL_FIRST_RUNTIME_IMAGE_DIGEST_ARM64],
    ["amd64", process.env.WEB_LAB_LOCAL_FIRST_RUNTIME_IMAGE_DIGEST_AMD64],
  ] as const;
  const configured = new Map<"arm64" | "amd64", LocalRunnerRuntimeAuthority>();
  for (const [architecture, digest] of values) {
    if (!digest) continue;
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error("local_first_runtime_authority_invalid");
    configured.set(architecture, Object.freeze({ supportedPlatforms: [`linux/${architecture}`],
      image: Object.freeze({ identity: "amniora-web-lab-runtime",
        digest: digest as `sha256:${string}`, applicationPort: 8080 }) }));
  }
  if (configured.size === 0) throw new Error("local_first_runtime_authority_unavailable");
  return configured;
}
function signingAuthority(keyId: string | undefined, value: string | undefined) {
  if (!validOpaqueId(keyId, 64) || !value) throw new Error("local_first_signing_unavailable");
  const privateKey = createPrivateKey(value);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("local_first_signing_unavailable");
  return Object.freeze({ keyId, privateKey,
    publicKey: createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString() });
}
function getResources() {
  if (resources) return resources;
  const connection = process.env.WEB_LAB_CONTROL_DATABASE_URL;
  if (!connection) throw new Error("local_first_product_unavailable");
  const sql = postgres(connection, { max: 3, prepare: false, connect_timeout: 5, idle_timeout: 20,
    connection: { statement_timeout: 5_000 } });
  const runtimeAuthorities = configuredRuntimeAuthorities();
  const repository = new PostgresLocalFirstProductRepository(sql, [...runtimeAuthorities.keys()]);
  const authority = new DurableLocalFirstAuthority(repository);
  const packageRepository = new PostgresWebLabControlRepository(sql);
  const defaultAuthority = signingAuthority(process.env.WEB_LAB_LOCAL_RUNNER_SIGNING_KEY_ID,
    process.env.WEB_LAB_LOCAL_RUNNER_SIGNING_PRIVATE_KEY);
  const amd64KeyId = process.env.WEB_LAB_LOCAL_RUNNER_SIGNING_KEY_ID_AMD64;
  const amd64PrivateKey = process.env.WEB_LAB_LOCAL_RUNNER_SIGNING_PRIVATE_KEY_AMD64;
  if (!!amd64KeyId !== !!amd64PrivateKey) throw new Error("local_first_signing_unavailable");
  const amd64Authority = amd64KeyId && amd64PrivateKey
    ? signingAuthority(amd64KeyId, amd64PrivateKey) : defaultAuthority;
  const packageAuthorities = new Map<"arm64" | "amd64", typeof defaultAuthority>([
    ["arm64", defaultAuthority], ["amd64", amd64Authority],
  ]);
  const packageServices = new Map<"arm64" | "amd64", PackageProductService>(
    [...packageAuthorities].map(([architecture, packageAuthority]) => [architecture,
      new PackageProductService({ repository: packageRepository, signingAuthority: () => packageAuthority })]),
  );
  resources = { authority, service: new LocalFirstProductService(authority, repository), repository, packageServices,
    packageAuthorities, runtimeAuthorities };
  return resources;
}

export async function dispatchOwnerProductRoute(request: Request, savedLabId: string): Promise<Response> {
  return createOwnerProductApi({ enabled: enabled(), trustedOrigin: origin(), authorize: authorizeLocalFirstOwner,
    service: () => getResources().service })(request, savedLabId);
}
export async function dispatchPairingApprovalRoute(request: Request): Promise<Response> {
  return createPairingApprovalApi({ enabled: enabled(), trustedOrigin: origin(), authorize: authorizeLocalFirstOwner,
    authority: () => getResources().authority })(request);
}
export async function dispatchRunnerProtocolRoute(
  operation: "pairing-begin" | "pairing-complete" | "redeem" | "result" | "unpair" | "presence", request: Request,
): Promise<Response> {
  return createRunnerProtocolApi({ enabled: enabled(), trustedOrigin: origin(), authority: () => getResources().authority,
    async redeem(input) {
      const current = getResources();
      const command = await current.authority.redeem(input);
      if (command.operation !== "LAUNCH" || !command.buildId) return command;
      try {
        const build = await current.repository.ownedExecutableBuildById(command.buildId,
          (await current.repository.installation(command.installationId))?.accountId ?? "");
        if (!build) throw new Error("local_first_build_unavailable");
        const installation = await current.repository.installation(command.installationId);
        if (!installation) throw new Error("local_first_runner_unavailable");
        const packages = await Promise.all(build.supportedArchitectures.map(async architecture => {
          const runtimeAuthority = current.runtimeAuthorities.get(architecture);
          const packageService = current.packageServices.get(architecture);
          const packageAuthority = current.packageAuthorities.get(architecture);
          if (!runtimeAuthority || !packageService || !packageAuthority) {
            throw new Error("local_first_runtime_authority_unavailable");
          }
          const packageValue = await packageService.issuePackage({ userId: installation.accountId,
            sessionId: "local-first-ticket" }, build.savedLabId, undefined, { runtimeAuthority });
          return { architecture, package: packageValue, packageVerificationKey: {
            keyId: packageAuthority.keyId, publicKey: packageAuthority.publicKey,
          } };
        }));
        return { ...command, packages };
      } catch (error) {
        await current.authority.cancelRedeemedDispatchFailure(command.requestId, command.commandId).catch(() => false);
        throw error;
      }
    } })(operation, request);
}
