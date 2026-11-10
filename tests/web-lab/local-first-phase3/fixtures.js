/* eslint-disable @typescript-eslint/no-require-imports -- Phase 3 fixture helpers. */
"use strict";
const { generateKeyPairSync } = require("node:crypto");
const phase3 = require("./loadPhase3");

const NOW = Date.now();
const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;

function packageFixture(architecture = "arm64", overrides = {}) {
  const pair = overrides.pair || generateKeyPairSync("ed25519");
  const ownerId = "phase3-test-owner";
  const authority = { keyId: overrides.keyId || "phase3-test-key", privateKey: pair.privateKey };
  const pkg = phase3.createLocalRunnerPackage({ buildId: `phase3-${architecture}-build`, ownerId,
    explicitExecutable: true, spec: phase3.planBeginnerStoredXssLab(`phase3_${architecture}_fixture`) },
  { userId: ownerId }, authority, { now: () => NOW, lifetimeMs: 60_000,
    runtimeAuthority: { supportedPlatforms: [`linux/${architecture}`],
      image: { identity: "amniora-web-lab-runtime", digest: overrides.imageDigest || IMAGE_DIGEST, applicationPort: 8080 } } });
  return { pkg, keys: new Map([[authority.keyId, pair.publicKey]]), pair, authority };
}

module.exports = { NOW, IMAGE_DIGEST, packageFixture, phase3 };
