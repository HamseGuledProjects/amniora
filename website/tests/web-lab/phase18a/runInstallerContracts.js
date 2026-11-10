#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node contract harness. */
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../../..");

async function main() {
  const installerSource = fs.readFileSync(path.join(ROOT, "runner-distribution/linux/install.sh"), "utf8");
  const launcher = fs.readFileSync(path.join(ROOT, "runner-distribution/linux/amniora-runner-launch"), "utf8");
  const uninstaller = fs.readFileSync(path.join(ROOT, "runner-distribution/linux/amniora-runner-uninstall"), "utf8");
  const service = fs.readFileSync(path.join(ROOT, "runner-distribution/linux/amniora-runner.service"), "utf8");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase18a-installer-"));
  try {
    const { publicKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPath = path.join(temporary, "manifest-public.pem");
    fs.writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }));
    const outputPath = path.join(temporary, "install.sh");
    const { renderInstaller } = await import(path.join(ROOT, "scripts/runner-distribution/render-installer.mjs"));
    const rendered = await renderInstaller({ outputPath, manifestPublicKeyPath: publicKeyPath });
    const renderedSource = fs.readFileSync(outputPath, "utf8");
    execFileSync("bash", ["-n", outputPath]);
    assert.match(rendered.sha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(renderedSource, /@@[A-Z0-9_]+@@/);
    assert.doesNotMatch(renderedSource, /PRIVATE KEY/);
    assert.match(renderedSource, /DISTRIBUTION_ORIGIN="https:\/\/runner\.amniora\.com"/);
    assert.match(renderedSource, /artifact_manifest_signature_invalid/);
    assert.match(renderedSource, /runner_artifact_checksum_mismatch/);
    assert.match(renderedSource, /runner_artifact_file_tampered/);
    const localOutput = path.join(temporary, "local-install.sh");
    await renderInstaller({ outputPath: localOutput, manifestPublicKeyPath: publicKeyPath,
      distributionOrigin: "https://runner.portfolio.example.test:43129",
      brokerEndpoint: "https://broker.runner.portfolio.example.test:43130/connect" });
    const localSource = fs.readFileSync(localOutput, "utf8");
    assert.match(localSource, /DISTRIBUTION_ORIGIN="https:\/\/runner\.amniora\.com:43129"/);
    assert.match(localSource, /BROKER_PORT="43130"/);
    await assert.rejects(renderInstaller({ outputPath: localOutput, manifestPublicKeyPath: publicKeyPath,
      distributionOrigin: "https://evil.invalid:43129" }), /invalid_runner_distribution_origin/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }

  assert.match(installerSource, /ubuntu.*24\.04|24\.04.*ubuntu/s);
  assert.match(installerSource, /x86_64\).*amd64/);
  assert.match(installerSource, /aarch64\|arm64\).*arm64/);
  assert.match(installerSource, /unsupported_architecture/);
  assert.match(installerSource, /unsupported_operating_system/);
  assert.match(installerSource, /os_release=\/etc\/os-release/);
  assert.match(installerSource, /\/usr\/lib\/os-release/);
  assert.match(installerSource, /unsupported_docker_version/);
  assert.match(installerSource, /docker_permission_issue/);
  assert.doesNotMatch(installerSource, /--(?:base-url|download-url|install-root|state-root)/);
  assert.doesNotMatch(installerSource, /curl[^\n]+\$1/);
  assert.doesNotMatch(installerSource, /\bcurl\b[^\n]+--location/);
  assert.match(installerSource, /artifact_manifest_signature_invalid/);
  assert.match(installerSource, /--replace-identity/);
  assert.match(installerSource, /existing_runner_identity_required/);
  assert.match(installerSource, /runner_connectivity_verification_failed/);
  assert.match(installerSource, /runner_identity_permissions_invalid/);
  assert.match(installerSource, /usermod -a -G docker "\$SERVICE_USER"/);
  assert.doesNotMatch(installerSource, /SUDO_USER|learner.*docker|usermod[^\n]+owner_id/);
  assert.deepEqual(installerSource.split("\n").filter(line => line.includes("usermod -")), [
    "  /usr/sbin/usermod -a -G docker \"$SERVICE_USER\"",
  ]);

  assert.match(service, /User=amniora-runner/);
  assert.match(service, /SupplementaryGroups=docker/);
  assert.match(service, /Restart=on-failure/);
  assert.match(service, /RuntimeDirectory=amniora-runner/);
  assert.match(service, /RuntimeDirectoryMode=0750/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.match(service, /ReadWritePaths=\/var\/lib\/amniora-runner \/run\/amniora-runner/);
  assert.doesNotMatch(service, /Environment=.*(?:TOKEN|SECRET|PASSWORD|PRIVATE)/i);
  assert.match(launcher, /exec "\$NODE" "\$ENTRY" serve <"\$ENROLLMENT_FILE"/);
  assert.doesNotMatch(launcher, /(?:echo|printf).*ENROLLMENT/);

  assert.match(uninstaller, /--purge-identity/);
  assert.match(uninstaller, /durable local identity preserved/);
  assert.match(uninstaller, /docker-membership-created/);
  assert.doesNotMatch(uninstaller, /docker\s+(?:rm|rmi|system prune|container prune|image prune|network prune)/);
  assert.doesNotMatch(uninstaller, /\$[1-9].*(?:rm|INSTALL_ROOT|STATE_ROOT)/);
  assert.doesNotMatch(uninstaller, /\/home\//);
  process.stdout.write("Phase 18A installer contracts PASS (Ubuntu/arch, signed verification, fixed paths, service account, Docker prerequisite, systemd, identity, reinstall and bounded uninstall)\n");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
