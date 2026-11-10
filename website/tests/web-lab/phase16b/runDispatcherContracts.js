#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Static and executable dispatcher security contracts. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../../..");
const DISPATCHER = path.join(__dirname, "amniora-phase16b-product-e2e");
const POLICY = path.join(__dirname, "amniora-phase16b-product-e2e.sudoers");
const ADAPTER = path.join(__dirname, "vmEngineeringDispatcher.js");
const HARNESS = path.join(__dirname, "runRealVmProductE2E.js");
const BOOTSTRAP_PROBE = path.join(__dirname, "runBootstrapProbe.js");
const BOOTSTRAP_DIAGNOSTICS = path.join(__dirname, "bootstrapProbeDiagnostics.js");
const VERBS = [
  "preflight", "install", "initial-runner", "bootstrap-status", "replay-enrollment", "service-start", "service-stop",
  "managed-counts", "inspect-runtime", "check-outbound", "cleanup", "revoke",
];

function run(program, args) {
  return spawnSync(program, args, { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH } });
}

function assertRejected(result, marker) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(marker));
}

function main() {
  const dispatcher = fs.readFileSync(DISPATCHER, "utf8");
  const policy = fs.readFileSync(POLICY, "utf8");
  const adapter = fs.readFileSync(ADAPTER, "utf8");
  const harness = fs.readFileSync(HARNESS, "utf8");
  const bootstrapProbe = fs.readFileSync(BOOTSTRAP_PROBE, "utf8");
  const bootstrapDiagnostics = fs.readFileSync(BOOTSTRAP_DIAGNOSTICS, "utf8");

  const dispatcherMode = fs.statSync(DISPATCHER).mode & 0o777;
  assert.notEqual(dispatcherMode & 0o100, 0, "dispatcher must be executable by root");
  assert.equal(dispatcherMode & 0o022, 0, "dispatcher must not be group/world writable");
  assert.equal(run("/bin/bash", ["-n", DISPATCHER]).status, 0, "dispatcher shell syntax");
  assertRejected(run("/bin/bash", [DISPATCHER, "unknown-operation"]), "unknown_verb");
  assertRejected(run("/bin/bash", [DISPATCHER, "preflight", "extra"]), "unexpected_arguments");
  assertRejected(run("/bin/bash", [DISPATCHER, "exec"]), "unknown_verb");

  for (const verb of VERBS) {
    assert.match(policy, new RegExp(`/usr/local/sbin/amniora-phase16b-product-e2e ${verb}(?:,|\\n)`));
    assert.match(adapter, new RegExp(`(?:\"| )${verb}(?:\"|,| )`));
  }
  assert.doesNotMatch(policy, /NOPASSWD:\s*ALL/);
  assert.doesNotMatch(policy, /\/(?:ba|z|c)?sh\b|\bdocker\b|\bsystemctl\b|\b(?:apt|apt-get|dpkg)\b|\b(?:vi|vim|nano)\b/);
  assert.equal((policy.match(/NOPASSWD:/g) || []).length, 1);
  assert.equal((policy.match(/\/usr\/local\/sbin\/amniora-phase16b-product-e2e/g) || []).length, VERBS.length);

  assert.match(dispatcher, /\[\[ \$# -eq 1 \]\] \|\| die "unexpected_arguments"/);
  assert.doesNotMatch(dispatcher, /\beval\b|\bexec\s+"?\$@|docker\s+"?\$@/);
  assert.match(dispatcher, /readonly SERVICE="amniora-runner-phase16a2b1\.service"/);
  assert.match(dispatcher, /readonly INSTALL_ROOT="\/opt\/amniora-runner-phase16a2b1"/);
  assert.match(dispatcher, /readonly STATE_ROOT="\/var\/lib\/amniora-runner\/phase16a2b1"/);
  assert.match(dispatcher, /com\.amniora\.local-runner\.managed=true/);
  assert.match(dispatcher, /refusing_unmanaged_container_cleanup/);
  assert.match(dispatcher, /refusing_unmanaged_network_cleanup/);
  assert.match(dispatcher, /MEMBERSHIP_MARKER/);
  assert.match(dispatcher, /install -o root -g root -m 0600 \/dev\/null "\$MEMBERSHIP_MARKER"/);
  assert.match(dispatcher, /gpasswd -d "\$RUNNER_USER" "\$DOCKER_GROUP"/);
  assert.doesNotMatch(dispatcher, /usermod[^\n]*ENGINEERING_USER|usermod[^\n]*\bamniora(?:\s|$)/);
  assert.match(dispatcher, /engineering_user_has_docker_access/);
  assert.doesNotMatch(dispatcher, /sshd_config|authorized_keys|PermitRootLogin/);
  assert.match(dispatcher, /INSPECT_SCRIPT/);
  assert.match(dispatcher, /chmod -R u=rwX,g=rX,o= "\$\{INSTALL_ROOT\}\/runner" "\$\{INSTALL_ROOT\}\/node"/);
  assert.match(dispatcher, /runner_node_execution_failed/);
  assert.match(dispatcher, /runner_module_load_failed/);
  assert.match(dispatcher, /launcher=\$!/);
  assert.match(dispatcher, /AMNIORA_BYO_BOOTSTRAP_DIAGNOSTICS=1/);
  assert.match(dispatcher, /read_bootstrap_state "\$BOOTSTRAP_STATE"/);
  assert.match(dispatcher, /runner_process_snapshot "\$BOOTSTRAP_PID"/);
  assert.match(dispatcher, /\/proc\/\$\{launcher\}\/task\/\$\{launcher\}\/children/);
  assert.match(dispatcher, /observe_runner_child "\$launcher"/);
  assert.match(dispatcher, /runner_process_snapshot "\$launcher"/);
  assert.match(dispatcher, /emit_launch_observation/);
  assert.match(dispatcher, /for _ in \{1\.\.1000\}/);
  assert.match(dispatcher, /\/usr\/bin\/sleep 0\.01/);
  assert.match(dispatcher, /\/proc\/\$\{pid\}\/exe/);
  assert.match(dispatcher, /PROCESS_START_TICKS/);
  assert.match(dispatcher, /IFS=' ' read -r -a stat_fields/);
  assert.match(dispatcher, /PROCESS_SNAPSHOT_FAILURE="EXITED"/);
  assert.match(dispatcher, /initial_runner_identity_invalid_\$\{PROCESS_SNAPSHOT_FAILURE\}/);
  assert.match(dispatcher, /initial_runner_reported_uid_mismatch/);
  assert.match(dispatcher, /initial_runner_reported_ppid_changed/);
  assert.match(dispatcher, /initial_runner_ack_timeout/);
  assert.match(dispatcher, /initial_runner_exited_after_\$\{last_stage\}/);
  assert.match(dispatcher, /initial_runner_process_tree_mismatch/);
  assert.doesNotMatch(dispatcher, /\/proc\/\$\{launcher\}\/cmdline|\/proc\/\$\{pid\}\/cmdline/);
  assert.doesNotMatch(dispatcher, /pgrep[^\n]*vm-runtime-entry/);
  assert.doesNotMatch(dispatcher, /grep -q 'ENROLLMENT_|cat[^\n]*(?:initial-runner|replay)\.log/);
  assert.match(dispatcher, /docker image inspect "\$IMAGE"[^\n]*&& die "test_image_cleanup_failed"/);
  assert.match(dispatcher, /"testImage":"absent"/);
  assert.doesNotMatch(harness, /sudo -n|sudo\s+-u|<<['"]?NODE/);
  assert.match(harness, /function eventWait\(/);
  assert.match(harness, /function operateThenWait\(/);
  assert.match(harness, /await foundation\.waitFor\(broker, "heartbeat"/);
  assert.equal((harness.match(/foundation\.waitFor\(broker/g) || []).length, 1);
  assert.match(harness, /phase: "16B failure cleanup"/);
  assert.match(harness, /dispatcherRevokedAndPhaseKeyDenied: accessRemoved/);
  assert.doesNotMatch(harness, /foundation\.(?:installRunnerArtifacts|startInitialRunner|managedCounts|inspectRuntime|assertOutboundBlocked|assertNoLanExposure|cleanupVm)\(/);
  assert.doesNotMatch(adapter, /sudo -n -u|<<['"]?NODE|\bnode\s*<<|foundation\.ssh\([^)]*sudo/);
  assert.match(adapter, /sudo -n \$\{DISPATCHER\} \$\{verb\}/);
  assert.match(bootstrapProbe, /const ALLOWED_CYCLE_COUNTS = new Set\(\[1, 3, 10\]\)/);
  assert.match(bootstrapProbe, /if \(argv\.length === 0\) return 1/);
  assert.match(bootstrapProbe, /cycle <= requested/);
  assert.match(bootstrapProbe, /engineering\.preflight/);
  assert.match(bootstrapProbe, /engineering\.installPreparedRunnerArtifacts/);
  assert.match(bootstrapProbe, /engineering\.initialRunner/);
  assert.match(bootstrapProbe, /engineering\.bootstrapStatus/);
  assert.match(bootstrapProbe, /engineering\.serviceStop/);
  assert.match(bootstrapProbe, /createEventWait\(/);
  assert.match(bootstrapProbe, /primaryFailure = tracker\.capture\(error\)/);
  assert.match(bootstrapProbe, /primaryFailure \|\|=/);
  assert.match(bootstrapProbe, /failureReport\(primaryFailure, cleanup\)/);
  assert.match(bootstrapProbe, /PHASE16B_BOOTSTRAP_PROBE_FAILED/);
  assert.doesNotMatch(bootstrapProbe, /error\?\.(?:stack|message)|error\.(?:stack|message)|stderr\.write\([^)]*error/);
  assert.doesNotMatch(bootstrapProbe, /issueRealProductPackage|compileProductUi|browserDiscovery|broker\.(?:launch|reset|stop|relayHttp)|gradeInstance/);
  for (const stage of [
    "preflight", "artifact_install", "runner_launch", "bootstrap_ack_wait", "process_identity", "runner_started",
    "transport_connecting", "broker_connected", "heartbeat", "runner_stop", "cycle_cleanup", "final_revoke",
  ]) assert.match(bootstrapDiagnostics, new RegExp(`"${stage}"`));
  assert.match(bootstrapDiagnostics, /function createEventWait\(/);
  assert.match(bootstrapDiagnostics, /cancel\(\)/);
  assert.doesNotMatch(bootstrapDiagnostics, /error\?\.(?:stack|message)|error\.(?:stack|message)/);

  const visudo = ["/usr/sbin/visudo", "/usr/bin/visudo"].find(candidate => fs.existsSync(candidate));
  if (visudo) {
    const validation = run(visudo, ["-cf", POLICY]);
    assert.equal(validation.status, 0, validation.stderr || "sudoers syntax");
  }
  console.log("Phase 16B dispatcher contracts: PASS (fixed verbs, no generic exec, managed Docker scope, membership cleanup, dispatcher-only sudo)");
}

main();
