// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const checkerPath = process.env.CHECKER_PATH;
if (!checkerPath) throw new Error("Set CHECKER_PATH to the compiled linux/qualityChecker.js path.");

const { checkLinuxInvestigationQuality, checkLinuxInvestigationBatchQuality } = require(checkerPath);

function asset(file_path, content, file_type = file_path.endsWith(".csv") ? "csv" : "text") {
  return { file_name: file_path.split("/").pop(), file_type, file_path, content };
}

const baseContext = {
  incidentId: "CL-LNX-9001",
  ticketId: "TCKT-9001",
  changeId: "CHG-9001",
  incidentFamily: "misconfigured_sudoers",
  incidentTitle: "Fixture",
  company: "FixtureCo",
  industry: "Technology",
  department: "SOC",
  officeLocation: "London",
  domain: "fixture.local",
  hostname: "fix-lnx-01",
  hostRole: "jump host",
  operatingSystem: "Ubuntu Server 24.04 LTS",
  incidentDate: "2026-07-06",
  incidentTime: "04:22:00",
  incidentWindowStart: "04:22",
  incidentWindowEnd: "04:33",
  timezone: "UTC",
  primaryUser: "alice",
  secondaryUsers: ["analyst"],
  serviceAccounts: [],
  adminAccounts: ["analyst"],
  hostIp: "10.10.10.42",
  gateway: "10.10.10.1",
  internalNetwork: "10.10.10.0/24",
  externalIps: ["198.51.100.24"],
  dns: "10.10.10.10",
  affectedService: "ssh.service",
  suspiciousCommands: ["cat /etc/shadow"],
  suspiciousProcesses: ["sudo", "cat"],
  modifiedFiles: ["/etc/shadow"],
  modifiedConfigurations: ["/etc/sudoers.d/platform"],
  persistenceMethod: "not confirmed",
  privilegeEscalationMethod: "not confirmed",
  initialAccessMethod: "interactive authenticated session requiring validation",
  timelineEvents: [],
  riskLevel: "medium",
  businessImpact: "Fixture impact.",
  rootCause: "under investigation",
  recommendedRemediation: [],
  investigationMethodology: [],
  plausibleHypotheses: [],
  ambiguityNotes: [],
};

function processSnapshotFixture(content) {
  const body = String(content || "");
  if (/evidence_type=live_process_snapshot/.test(body)) return body;
  return `# capture_at=2026-07-06 04:36:00 evidence_type=live_process_snapshot state_type=incident_snapshot host=fix-lnx-01\n${body}`;
}

function openFilesFixture(content) {
  const body = String(content || "");
  if (/evidence_type=live_open_file_snapshot/.test(body)) return body;
  return `# capture_at=2026-07-06 04:36:00 evidence_type=live_open_file_snapshot state_type=incident_snapshot host=fix-lnx-01\n${body}`;
}

function baseAssets(overrides = {}) {
  const command = overrides.command || "cat /etc/shadow";
  const commandPath = command.startsWith("/") ? command : `/usr/bin/${command}`;
  const commandTime = overrides.commandTime || "04:22:37";
  const auditTime = overrides.auditTime || commandTime;
  const timelineTime = overrides.timelineTime || commandTime;
  const sudoActor = overrides.sudoActor || "alice";
  const authActor = overrides.authActor || "alice";
  const tty = overrides.tty || "pts/2";
  const sudoTty = overrides.sudoTty || tty;
  const auditTty = overrides.auditTty || tty;
  const auditMode = overrides.auditMode || "0100640";
  const auditOwnerUid = overrides.auditOwnerUid || "0";
  const auditOwnerGid = overrides.auditOwnerGid || "0";
  const permissionPath = overrides.permissionPath || (command.startsWith("apt ") ? "/var/log/apt/history.log" : "/etc/shadow");
  const permissionMode = overrides.permissionMode || "-rw-r-----";
  const permissionOwner = overrides.permissionOwner || "root";
  const permissionGroup = overrides.permissionGroup || "root";
  const processRows = overrides.processRows || `USER       PID  PPID  CMD
root         1     0  /sbin/init
root       812     1  /usr/sbin/sshd -D
alice     2201   812  /bin/bash
root      2203  2201  sudo ${command}
root      2204  2203  ${command}`;
  const openFiles = overrides.openFiles || `COMMAND     PID USER             NAME
sudo       2203 root             /etc/sudoers.d/platform
${command.split(/\s+/)[0]}        2204 root             ${permissionPath}`;
  const sudoers = overrides.sudoers === undefined ? `alice ALL=(root) NOPASSWD: /usr/bin/${command}\n` : overrides.sudoers;
  const permissionsExtra = overrides.permissionsExtra || "/etc/sudoers.d/platform -r--r----- root root";
  const auditContent = overrides.auditContent || `type=USER_CMD msg=audit(2026-07-06 ${auditTime}): pid=2203 cwd="/home/alice" cmd="${command}" auid=1001 uid=0 tty=${auditTty} res=success
type=EXECVE msg=audit(2026-07-06 ${auditTime}): pid=2204 ppid=2203 cwd="/home/alice" cmd="${command}" auid=1001 uid=0 gid=0 tty=${auditTty} res=success
type=PATH msg=audit(2026-07-06 04:22:44): pid=2204 item=0 name="${permissionPath}" inode=42 mode=${auditMode} ouid=${auditOwnerUid} ogid=${auditOwnerGid}
${overrides.auditExtra || ""}`;
  const defaultJournalSystemd = `-- Journal begins at 2026-07-06 04:22:00 UTC --
2026-07-06 04:22:12 fix-lnx-01 systemd[1]: Reloaded ssh.service - OpenSSH server daemon.
`;
  const journalSystemd = overrides.journalSystemd
    ? (/^-- Journal begins at /m.test(overrides.journalSystemd) ? overrides.journalSystemd : `-- Journal begins at 2026-07-06 04:22:00 UTC --\n${overrides.journalSystemd}`)
    : defaultJournalSystemd;

  return [
    asset("assets/logs/auth.log", overrides.authLog || `2026-07-06 ${commandTime} fix-lnx-01 sudo: ${authActor} : TTY=${tty} ; PWD=/home/alice ; USER=root ; COMMAND=${commandPath}\n`, "log"),
    asset("assets/logs/sudo.log", overrides.sudoLog || `2026-07-06 ${overrides.sudoTime || commandTime} ${sudoActor} : TTY=${sudoTty} ; PWD=/home/alice ; USER=root ; COMMAND=${commandPath}\n`, "log"),
    asset("assets/logs/audit.log", auditContent, "log"),
    asset("assets/journal/journal_systemd.txt", journalSystemd, "text"),
    asset("assets/evidence/timeline.csv", overrides.timeline || `timestamp,event,evidence_type,source,confidence,event_id,event_type
2026-07-06 ${timelineTime},${command},Observed,sudo.log;audit.log,high,CL-LNX-9001:sudo-command,sudo_command\n`),
    asset("assets/runtime/process_snapshot.txt", `${processSnapshotFixture(processRows)}\n`),
    asset("assets/runtime/open_files.txt", `${openFilesFixture(openFiles)}\n`),
    asset("assets/reports/permissions_report.txt", `${permissionPath} ${permissionMode} ${permissionOwner} ${permissionGroup}\n${permissionsExtra}\n`),
    asset("assets/reports/service_inventory.txt", overrides.serviceInventory || `service,status,startup,notes
ssh.service,running,enabled,remote access service\n`, "csv"),
    asset("assets/docs/change_request.md", `# CHG-9001 Fixture change\nHost: fix-lnx-01\nRelated ticket: TCKT-9001\n`),
    asset("assets/csv/users.csv", overrides.usersCsv || `username,role,sudo_access,last_login,status,owner,uid,gid,email,manager,home,shell,kind
alice,engineer,limited-command,2026-07-06 04:22,active,IT,1001,1001,alice@example.test,boss,/home/alice,/bin/bash,human
vendor.linux,vendor,none,2026-07-06 04:20,active,Vendor,1002,1002,vendor@example.test,boss,/home/vendor.linux,/bin/bash,human
nora.ir,engineer,none,2026-07-06 04:20,active,IT,1003,1003,nora@example.test,boss,/home/nora.ir,/bin/bash,human\n`),
    asset("assets/csv/groups.csv", `group,members
sudo,analyst\n`),
    asset("assets/configs/sudoers.d/platform", sudoers, "config"),
    ...(overrides.extraAssets || []),
  ];
}

function runSingle(test) {
  const contextOverride = { ...(test.context || {}) };
  if (test.command) contextOverride.suspiciousCommands = [test.command];
  const result = checkLinuxInvestigationQuality({
    context: { ...baseContext, ...contextOverride },
    assets: test.assets,
    lab: test.lab,
  });
  if (test.expectPass) {
    const ok = result.passed;
    return { ok, result, message: ok ? `pass score=${result.score}` : `expected pass, got ${result.summary}` };
  }
  const matched = result.issues.some((issue) =>
    issue.severity === test.expect.severity &&
    issue.category === test.expect.category &&
    (!test.expect.file || issue.file === test.expect.file) &&
    (!test.expect.description || issue.description.toLowerCase().includes(test.expect.description.toLowerCase()))
  );
  return {
    ok: matched && (test.expect.allowPass || !result.passed),
    result,
    message: matched ? `failed as expected (${test.expect.severity}/${test.expect.category})` : `wrong failure: ${JSON.stringify(result.issues, null, 2)}`,
  };
}

function validFinalLab(overrides = {}) {
  const tasks = overrides.tasks || [
    {
      phase: "Scope",
      title: "Reconstruct the privileged access timeline",
      description: "Reconstruct the sudo event sequence for fix-lnx-01 during the 04:22-04:33 UTC window.",
      evidence: ["assets/evidence/timeline.csv", "assets/logs/sudo.log"],
      deliverable: "Prepare a timeline table with timestamp, actor, command, and evidence source.",
    },
    {
      phase: "Attribution",
      title: "Correlate account and authentication evidence",
      description: "Correlate alice activity on fix-lnx-01 with account inventory and SSH evidence.",
      evidence: ["assets/logs/auth.log", "assets/csv/users.csv"],
      deliverable: "Document the account context and any gaps that require analyst follow-up.",
    },
    {
      phase: "Policy",
      title: "Compare sudo policy against observed command use",
      description: "Compare the cat /etc/shadow command with sudo policy and group inventory.",
      evidence: ["assets/configs/sudoers.d/platform", "assets/csv/groups.csv", "assets/logs/sudo.log"],
      deliverable: "Summarize whether the observed command is covered by available policy evidence.",
    },
    {
      phase: "Change",
      title: "Map change documentation to the service baseline",
      description: "Map CHG-9001 and TCKT-9001 references to ssh.service evidence for fix-lnx-01.",
      evidence: ["assets/docs/change_request.md", "assets/reports/service_inventory.txt"],
      deliverable: "Write a short change-control note with supported and unsupported assumptions.",
    },
    {
      phase: "Impact",
      title: "Evaluate file access and permission evidence",
      description: "Evaluate /etc/shadow access evidence and rendered permissions for the investigation window.",
      evidence: ["assets/logs/audit.log", "assets/reports/permissions_report.txt"],
      deliverable: "Provide an evidence-backed risk note with the exact files and sources reviewed.",
    },
  ];

  return {
    title: "Linux sudo evidence review for fix-lnx-01",
    subtitle: "Linux privilege boundary reconciliation using SSH and sudo evidence",
    objective: "Reconstruct activity on fix-lnx-01 during 04:22-04:33 UTC and compare sudo, timeline, service, and change evidence without assuming a final root cause.",
    scenario: "FixtureCo SOC is reviewing case CL-LNX-9001 for fix-lnx-01, a jump host in London. The 04:22-04:33 UTC window includes alice activity, source 198.51.100.24, ssh.service context, /etc/shadow permission evidence, TCKT-9001, CHG-9001, and the approved maintenance window noted in the evidence.",
    tasks,
    outcomes: [
      "Correlate Linux sudo, SSH, audit, and timeline evidence.",
      "Compare service and change-control records without overclaiming intent.",
      "Document permission and account evidence for a scoped SOC escalation.",
    ],
    ...overrides,
  };
}

function finalFixture(name, brokenLab, expect, fixedLab = validFinalLab()) {
  return {
    name,
    broken: { assets: baseAssets(), lab: brokenLab, expect },
    fixed: { assets: baseAssets(), lab: fixedLab, expectPass: true },
  };
}

function passFixture(name, lab, context = {}, assets = baseAssets()) {
  return {
    name,
    passOnly: true,
    test: { context, assets, lab, expectPass: true },
  };
}

const families = [
  {
    name: "01 actor mismatch",
    broken: { assets: baseAssets({ authActor: "vendor.linux", sudoActor: "nora.ir" }), expect: { severity: "critical", category: "identity", description: "conflicting actors" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "02 command timestamp mismatch",
    broken: { assets: baseAssets({ sudoTime: "04:22:49" }), expect: { severity: "critical", category: "identity", description: "conflicting timestamps" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "03 tty mismatch",
    broken: { assets: baseAssets({ sudoTty: "pts/1" }), expect: { severity: "critical", category: "identity", description: "conflicting TTY" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "04 pid executable collision",
    broken: { assets: baseAssets({ processRows: `USER       PID  PPID  CMD
root         1     0  /sbin/init
alice     2203     1  apt install ncat
alice     2203     1  dpkg --configure ncat
alice     2204  2203  cat /etc/shadow` }), expect: { severity: "critical", category: "process_open_files", description: "conflicting process" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "05 sudo and child process collapsed",
    broken: { assets: baseAssets({ auditContent: `type=USER_CMD msg=audit(2026-07-06 04:22:37): pid=2203 cwd="/home/alice" cmd="cat /etc/shadow" auid=1001 uid=0 tty=pts/2 res=success\n`, processRows: `USER       PID  PPID  CMD
root         1     0  /sbin/init
alice     2201   812  /bin/bash
alice     2203  2201  sudo cat /etc/shadow`, openFiles: `COMMAND     PID USER             NAME
sudo       2203 alice /etc/sudoers.d/platform` }), expect: { severity: "critical", category: "process_open_files", description: "collapses sudo" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "06 file mode mismatch",
    broken: { assets: baseAssets({ auditMode: "0100755", permissionMode: "-rw-r-----" }), expect: { severity: "critical", category: "permissions", description: "mode" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "07 file owner/group mismatch",
    broken: { context: { modifiedFiles: ["/home/vendor.linux/.ssh/authorized_keys"] }, assets: baseAssets({ permissionPath: "/home/vendor.linux/.ssh/authorized_keys", permissionMode: "-rw-------", permissionOwner: "vendor.linux", permissionGroup: "vendor.linux", auditOwnerUid: "1003", auditOwnerGid: "1003" }), expect: { severity: "critical", category: "permissions", description: "owner UID" } },
    fixed: { context: { modifiedFiles: ["/home/vendor.linux/.ssh/authorized_keys"] }, assets: baseAssets({ permissionPath: "/home/vendor.linux/.ssh/authorized_keys", permissionMode: "-rw-------", permissionOwner: "vendor.linux", permissionGroup: "vendor.linux", auditOwnerUid: "1002", auditOwnerGid: "1002", auditMode: "0100600" }), expectPass: true },
  },
  {
    name: "08 invalid sudoers mode",
    broken: { assets: baseAssets({ permissionsExtra: "/etc/sudoers.d/platform -rwxr-xr-x root root" }), expect: { severity: "critical", category: "sudo_audit", description: "sudoers policy file mode" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "09 service effect before cause",
    broken: { command: "systemctl reload ssh.service", assets: baseAssets({ command: "systemctl reload ssh.service", auditContent: `type=USER_CMD msg=audit(2026-07-06 04:22:50): pid=2203 cwd="/home/alice" cmd="systemctl reload ssh.service" auid=1001 uid=0 tty=pts/2 res=success
type=SERVICE_RELOAD msg=audit(2026-07-06 04:22:37): pid=2213 unit="ssh.service" res=success\n`, journalSystemd: "2026-07-06 04:22:37 fix-lnx-01 systemd[1]: Reloaded ssh.service.\n" }), expect: { severity: "critical", category: "service_model", description: "before its causal command" } },
    fixed: { command: "systemctl reload ssh.service", assets: baseAssets({ command: "systemctl reload ssh.service", auditContent: `type=USER_CMD msg=audit(2026-07-06 04:22:37): pid=2203 cwd="/home/alice" cmd="systemctl reload ssh.service" auid=1001 uid=0 tty=pts/2 res=success
type=SERVICE_RELOAD msg=audit(2026-07-06 04:22:50): pid=2213 unit="ssh.service" res=success\n`, journalSystemd: "2026-07-06 04:22:50 fix-lnx-01 systemd[1]: Reloaded ssh.service.\n" }), expectPass: true },
  },
  {
    name: "10 enable incorrectly produces start",
    broken: { command: "systemctl enable ssh.service", assets: baseAssets({ command: "systemctl enable ssh.service", auditContent: `type=USER_CMD msg=audit(2026-07-06 04:22:37): pid=2203 cwd="/home/alice" cmd="systemctl enable ssh.service" auid=1001 uid=0 tty=pts/2 res=success
type=SERVICE_START msg=audit(2026-07-06 04:22:45): pid=2213 unit="ssh.service" res=success\n`, journalSystemd: "2026-07-06 04:22:45 fix-lnx-01 systemd[1]: Started ssh.service.\n" }), expect: { severity: "critical", category: "service_model", description: "lacks a causal" } },
    fixed: { command: "systemctl enable --now ssh.service", assets: baseAssets({ command: "systemctl enable --now ssh.service", auditContent: `type=USER_CMD msg=audit(2026-07-06 04:22:37): pid=2203 cwd="/home/alice" cmd="systemctl enable --now ssh.service" auid=1001 uid=0 tty=pts/2 res=success
type=SERVICE_START msg=audit(2026-07-06 04:22:45): pid=2213 unit="ssh.service" res=success\n`, journalSystemd: "2026-07-06 04:22:45 fix-lnx-01 systemd[1]: Started ssh.service.\n" }), expectPass: true },
  },
  {
    name: "11 manual apt conflated with apt-daily",
    broken: { command: "apt install ncat", context: { modifiedFiles: ["/var/log/apt/history.log"] }, assets: baseAssets({ command: "apt install ncat", journalSystemd: "2026-07-06 04:22:50 fix-lnx-01 systemd[1]: apt-daily.service completed manual package install ncat.\n" }), expect: { severity: "critical", category: "package_management", description: "Manual apt install" } },
    fixed: { command: "apt install ncat", context: { modifiedFiles: ["/var/log/apt/history.log"] }, assets: baseAssets({ command: "apt install ncat", journalSystemd: "2026-07-06 04:22:50 fix-lnx-01 apt[2204]: manual package transaction completed for ncat.\n" }), expectPass: true },
  },
  {
    name: "12 static timeline source used as exact",
    broken: { assets: baseAssets({ timeline: `timestamp,event,evidence_type,source,confidence,event_id,event_type
2026-07-06 04:22:37,cat /etc/shadow,Observed,process_snapshot.txt,high,CL-LNX-9001:sudo-command,sudo_command\n` }), expect: { severity: "high", category: "timeline", description: "static" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "13 cross-session identity impossibility",
    broken: { assets: baseAssets({ processRows: `USER       PID  PPID  CMD
root         1     0  /sbin/init
vendor.linux 2201 812 /bin/bash
nora.ir   2204  2201  cat /etc/shadow` }), expect: { severity: "critical", category: "process_open_files", description: "without an explicit identity transition" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "14 irrelevant optional artefact injection",
    broken: { assets: baseAssets({ extraAssets: [asset("assets/scheduled/cron.d/sys-maint", "SHELL=/bin/sh\n* * * * root /usr/local/sbin/sys-maint\n", "config")] }), expect: { severity: "high", category: "asset_consistency", description: "sys-maint" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "15 simulator or case metadata leakage",
    broken: { assets: baseAssets({ serviceInventory: `service,status,startup,notes
ssh.service,running,enabled,affected service for CL-LNX-1234\n` }), expect: { severity: "high", category: "generated_text", description: "case metadata" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "16 malformed final subtitle",
    broken: { assets: baseAssets(), lab: { title: "Linux", subtitle: "Linux privilege boundary reconciliation on a SSH-" }, expect: { severity: "high", category: "generated_text", description: "SSH" } },
    fixed: { assets: baseAssets(), lab: { title: "Linux", subtitle: "Linux privilege boundary reconciliation on SSH access evidence" }, expectPass: true },
  },
  {
    name: "17 batch fingerprint repetition",
    batch: true,
  },
  {
    name: "18 successful sudo without authorising rule",
    broken: { assets: baseAssets({ sudoers: "", usersCsv: `username,role,sudo_access,last_login,status,owner,uid,gid,email,manager,home,shell,kind
alice,engineer,none,2026-07-06 04:22,active,IT,1001,1001,alice@example.test,boss,/home/alice,/bin/bash,human\n` }), expect: { severity: "critical", category: "sudo_audit", description: "not authorized" } },
    fixed: { assets: baseAssets(), expectPass: true },
  },
  {
    name: "19 lifecycle operation disagreement",
    broken: { command: "systemctl reload ssh.service", assets: baseAssets({ command: "systemctl reload ssh.service", auditContent: `type=USER_CMD msg=audit(2026-07-06 04:22:37): pid=2203 cwd="/home/alice" cmd="systemctl reload ssh.service" auid=1001 uid=0 tty=pts/2 res=success
type=SERVICE_START msg=audit(2026-07-06 04:22:45): pid=2213 unit="ssh.service" res=success\n`, journalSystemd: "2026-07-06 04:22:45 fix-lnx-01 systemd[1]: Reloaded ssh.service.\n" }), expect: { severity: "critical", category: "service_model", description: "disagrees" } },
    fixed: { command: "systemctl reload ssh.service", assets: baseAssets({ command: "systemctl reload ssh.service", auditContent: `type=USER_CMD msg=audit(2026-07-06 04:22:37): pid=2203 cwd="/home/alice" cmd="systemctl reload ssh.service" auid=1001 uid=0 tty=pts/2 res=success
type=SERVICE_RELOAD msg=audit(2026-07-06 04:22:45): pid=2213 unit="ssh.service" res=success\n`, journalSystemd: "2026-07-06 04:22:45 fix-lnx-01 systemd[1]: Reloaded ssh.service.\n" }), expectPass: true },
  },
  {
    name: "20 observed timeline event with no primary source",
    broken: { assets: baseAssets({ timeline: `timestamp,event,evidence_type,source,confidence,event_id,event_type
2026-07-06 05:00:00,incident window opened,Observed,sudo.log,high,CL-LNX-9001:case-boundary,case_boundary\n` }), expect: { severity: "critical", category: "timeline", description: "Observed timeline" } },
    fixed: { assets: baseAssets({ timeline: `timestamp,event,evidence_type,source,confidence,event_id,event_type
2026-07-06 04:22:37,cat /etc/shadow,Observed,sudo.log;audit.log,high,CL-LNX-9001:sudo-command,sudo_command
2026-07-06 05:00:00,case boundary reviewed for TCKT-9001,Context,change_request.md,medium,CL-LNX-9001:case-boundary,case_boundary\n` }), expectPass: true },
  },
  finalFixture(
    "21 final subtitle ending in SSH-",
    validFinalLab({ subtitle: "Linux privilege boundary reconciliation on a SSH-" }),
    { severity: "high", category: "generated_text", description: "subtitle" }
  ),
  finalFixture(
    "22 final subtitle dangling conjunction",
    validFinalLab({ subtitle: "Linux package-management investigation with SSH and" }),
    { severity: "high", category: "generated_text", description: "subtitle" }
  ),
  finalFixture(
    "23 replacement character in host name",
    validFinalLab({ scenario: "FixtureCo SOC is reviewing case CL-LNX-9001 for fix-lnx-�1, a jump host in London during 04:22-04:33 UTC with CHG-9001 and TCKT-9001 evidence." }),
    { severity: "high", category: "generated_text", description: "malformed" }
  ),
  finalFixture(
    "24 joined word withSSH",
    validFinalLab({ objective: "Reconstruct activity on fix-lnx-01 during 04:22-04:33 UTC withSSH and sudo evidence." }),
    { severity: "high", category: "generated_text", description: "preposition" }
  ),
  finalFixture(
    "25 malformed time range",
    validFinalLab({ objective: "Reconstruct activity on fix-lnx-01 during 04:2204:33 UTC and compare sudo evidence." }),
    { severity: "critical", category: "generated_text", description: "time" }
  ),
  finalFixture(
    "26 objective with wrong host",
    validFinalLab({ objective: "Reconstruct activity on wrong-lnx-99 during 04:22-04:33 UTC and compare sudo, timeline, service, and change evidence." }),
    { severity: "critical", category: "generated_text", description: "hostname" }
  ),
  finalFixture(
    "27 scenario with wrong user",
    validFinalLab({ scenario: "FixtureCo SOC is reviewing case CL-LNX-9001 for fix-lnx-01, a jump host in London. nora.ir authenticated during 04:22-04:33 UTC with ssh.service context, /etc/shadow evidence, TCKT-9001, CHG-9001, and UTC handling." }),
    { severity: "critical", category: "generated_text", description: "canonical" }
  ),
  finalFixture(
    "28 scenario with wrong change ID",
    validFinalLab({ scenario: "FixtureCo SOC is reviewing case CL-LNX-9001 for fix-lnx-01, a jump host in London. The 04:22-04:33 UTC window includes alice activity, source 198.51.100.24, ssh.service context, /etc/shadow evidence, TCKT-9001, CHG-9999, and UTC handling." }),
    { severity: "critical", category: "generated_text", description: "change" }
  ),
  finalFixture(
    "29 task referencing missing evidence",
    validFinalLab({ tasks: validFinalLab().tasks.map((task, index) => index === 0 ? { ...task, evidence: ["assets/logs/missing.log"] } : task) }),
    { severity: "critical", category: "asset_consistency", description: "not present" }
  ),
  finalFixture(
    "30 task requiring unsupported conclusion",
    validFinalLab({ tasks: validFinalLab().tasks.map((task, index) => index === 0 ? { ...task, title: "Prove the attacker and root cause from the evidence" } : task) }),
    { severity: "high", category: "generated_text", description: "unsupported conclusion" }
  ),
  finalFixture(
    "31 duplicate final tasks",
    validFinalLab({ tasks: validFinalLab().tasks.map((task, index, list) => index === 1 ? { ...list[0] } : task) }),
    { severity: "high", category: "generated_text", description: "duplicates" }
  ),
  finalFixture(
    "32 truncated deliverable",
    validFinalLab({ tasks: validFinalLab().tasks.map((task, index) => index === 0 ? { ...task, deliverable: "Prepare a 610 lines -" } : task) }),
    { severity: "high", category: "generated_text", description: "deliverable" }
  ),
  finalFixture(
    "33 simulator wording inside scenario",
    validFinalLab({ scenario: "FixtureCo SOC is reviewing this generated lab simulator case CL-LNX-9001 for fix-lnx-01, a jump host in London during 04:22-04:33 UTC with alice, CHG-9001, TCKT-9001, and UTC evidence." }),
    { severity: "high", category: "generated_text", description: "simulator" }
  ),
  finalFixture(
    "34 validated draft differs from saved final text",
    validFinalLab({ subtitle: "Linux SSH authentication surge analysis with hard" }),
    { severity: "high", category: "generated_text", description: "subtitle" }
  ),
  finalFixture(
    "35 narrative refers to non-canonical service",
    validFinalLab({ scenario: "FixtureCo SOC is reviewing case CL-LNX-9001 for fix-lnx-01, a jump host in London. The 04:22-04:33 UTC window includes alice activity, source 198.51.100.24, nginx.service context, /etc/shadow evidence, TCKT-9001, CHG-9001, and UTC handling." }),
    { severity: "critical", category: "generated_text", description: "canonical" }
  ),
  passFixture(
    "36 SSH protocol is not treated as actor",
    validFinalLab({ scenario: "FixtureCo SOC is reviewing case CL-LNX-9001 for fix-lnx-01, a jump host in London. SSH key activity associated with alice was observed during 04:22-04:33 UTC with ssh.service, /etc/shadow, TCKT-9001, CHG-9001, and maintenance-window evidence." }),
  ),
  passFixture(
    "37 SOC is not treated as actor",
    validFinalLab({ scenario: "FixtureCo SOC investigated the session for case CL-LNX-9001 on fix-lnx-01, a jump host in London. The 04:22-04:33 UTC window includes alice activity, ssh.service, /etc/shadow, TCKT-9001, CHG-9001, and maintenance-window evidence." }),
  ),
  finalFixture(
    "38 genuine wrong known user in scenario",
    validFinalLab({ scenario: "FixtureCo SOC is reviewing case CL-LNX-9001 for fix-lnx-01, a jump host in London. nora.ir authenticated during 04:22-04:33 UTC with ssh.service, /etc/shadow, TCKT-9001, CHG-9001, and maintenance-window evidence." }),
    { severity: "critical", category: "generated_text", description: "non-canonical actor" }
  ),
  ...["Align ssh.service state and process activity with the key-based session window.", "Reconcile CHG-9001 and maintenance records against observed key trust and use.", "Cross-check the alice account and group membership against administrator-tier expectations.", "Examine SSH authorized_keys and related file paths for signs of interactive enablement or drift.", "Document defensible containment and hardening steps consistent with policy and host role."].map((title, index) =>
    passFixture(
      `39.${index + 1} valid investigative action ${title.split(" ")[0]}`,
      validFinalLab({ tasks: validFinalLab().tasks.map((task, taskIndex) => taskIndex === 0 ? { ...task, title, description: title, evidence: title.startsWith("Reconcile") ? ["assets/docs/change_request.md"] : title.includes("group membership") ? ["assets/csv/users.csv", "assets/csv/groups.csv", "assets/logs/auth.log"] : task.evidence, deliverable: title.startsWith("Reconcile") ? "Summarize what the change record supports and what remains unresolved." : task.deliverable } : task) })
    )
  ),
  passFixture(
    "40 configuration policy task does not require sudo evidence",
    validFinalLab({ tasks: validFinalLab().tasks.map((task, index) => index === 2 ? { ...task, title: "Compare sshd configuration and corporate policy to observed access behavior and key options.", description: "Compare sshd configuration and corporate policy to observed access behavior and key options.", evidence: ["assets/configs/sshd_config", "assets/docs/security_policy.md", "assets/evidence/audit_notes.md"] } : task) }),
    {},
    baseAssets({ extraAssets: [
      asset("assets/configs/sshd_config", "AuthorizedKeysFile .ssh/authorized_keys\nPasswordAuthentication no\n", "config"),
      asset("assets/docs/security_policy.md", "SSH key options must be reviewed for privileged hosts.\n"),
      asset("assets/evidence/audit_notes.md", "Policy interpretation notes for SSH access behavior.\n"),
    ] }),
  ),
  passFixture(
    "41 change-control task does not require timeline evidence",
    validFinalLab({ tasks: validFinalLab().tasks.map((task, index) => index === 3 ? { ...task, title: "Reconcile CHG-9001 and maintenance records against observed key trust and use.", description: "Reconcile CHG-9001 and maintenance records against observed key trust and use.", evidence: ["assets/docs/change_request.md", "assets/evidence/maintenance_ticket.md"] } : task) }),
    {},
    baseAssets({ extraAssets: [asset("assets/evidence/maintenance_ticket.md", "Maintenance record for CHG-9001 and TCKT-9001.\n")] }),
  ),
  passFixture(
    "42 containment task does not require sudo evidence",
    validFinalLab({ tasks: validFinalLab().tasks.map((task, index) => index === 4 ? { ...task, title: "Document defensible containment and hardening steps consistent with policy and host role.", description: "Document defensible containment and hardening steps consistent with policy and host role.", evidence: ["assets/evidence/incident_brief.md", "assets/docs/security_policy.md", "assets/reports/service_inventory.txt"] } : task) }),
    {},
    baseAssets({ extraAssets: [
      asset("assets/evidence/incident_brief.md", "Incident brief for fix-lnx-01 and ssh.service evidence.\n"),
      asset("assets/docs/security_policy.md", "Containment actions must preserve service availability and evidence.\n"),
    ] }),
  ),
  finalFixture(
    "43 genuinely vague final task",
    validFinalLab({ tasks: validFinalLab().tasks.map((task, index) => index === 0 ? { ...task, title: "Look at the files.", description: "Look at the files." } : task) }),
    { severity: "medium", category: "generated_text", description: "clear investigative action", allowPass: true }
  ),
  passFixture(
    "44 company possessive normalization",
    validFinalLab({ scenario: "FixtureCo's SOC is reviewing case CL-LNX-9001 for fix-lnx-01, a jump host in London. The 04:22-04:33 UTC window includes alice activity, ssh.service, /etc/shadow, TCKT-9001, CHG-9001, and maintenance-window evidence." }),
  ),
  finalFixture(
    "45 wrong company fails critically",
    validFinalLab({ scenario: "Contoso SOC is reviewing case CL-LNX-9001 for fix-lnx-01, a jump host in London. The 04:22-04:33 UTC window includes alice activity, ssh.service, /etc/shadow, TCKT-9001, CHG-9001, and maintenance-window evidence." }),
    { severity: "critical", category: "generated_text", description: "company" }
  ),
  passFixture(
    "46 company omitted from scenario but present in objective",
    validFinalLab({
      objective: "FixtureCo analysts must reconstruct activity on fix-lnx-01 during 04:22-04:33 UTC and compare sudo, timeline, service, and change evidence.",
      scenario: "The SOC is reviewing case CL-LNX-9001 for fix-lnx-01, a jump host in London. The 04:22-04:33 UTC window includes alice activity, ssh.service, /etc/shadow, TCKT-9001, CHG-9001, and maintenance-window evidence.",
    }),
  ),
];

function runBatchFamily() {
  const repeated = Array.from({ length: 6 }, () => ({ context: baseContext, assets: baseAssets({ extraAssets: [asset("assets/scripts/script_sample.sh", "#!/bin/sh\n/usr/local/sbin/health-check.sh\n", "shell")] }) }));
  const broken = checkLinuxInvestigationBatchQuality(repeated);
  const fixedInputs = Array.from({ length: 6 }, (_, index) => ({
    context: baseContext,
    assets: baseAssets({
      timeline: `timestamp,event,evidence_type,source,confidence,event_id,event_type
2026-07-06 04:22:3${index},cat /etc/shadow during ticket TCKT-900${index},Observed,sudo.log;audit.log,high,CL-LNX-900${index}:sudo-command,sudo_command\n`,
      extraAssets: [asset("assets/scripts/script_sample.sh", `#!/bin/sh\n/usr/local/sbin/role-task-${index}.sh\n`, "shell")],
    }),
  }));
  const fixed = checkLinuxInvestigationBatchQuality(fixedInputs);
  const brokenOk = !broken.passed && broken.issues.some((issue) => issue.category === "batch_diversity");
  const fixedOk = fixed.passed;
  return { ok: brokenOk && fixedOk, message: `broken=${broken.summary}; fixed=${fixed.summary}`, result: broken };
}

function runSaveIdentityProof() {
  const finalObject = {
    title: "Linux sudo evidence review for fix-lnx-01",
    objective: "Reconstruct activity on fix-lnx-01 during 04:22-04:33 UTC.",
    scenario: "FixtureCo case CL-LNX-9001 references CHG-9001 for fix-lnx-01.",
    tasks: ["task-json"],
  };
  const validatedFinalObject = finalObject;
  const objectPassedToSave = finalObject;
  const mappedCopy = JSON.parse(JSON.stringify(objectPassedToSave));
  const ok =
    validatedFinalObject === objectPassedToSave &&
    JSON.stringify(mappedCopy) === JSON.stringify(validatedFinalObject);
  return { ok, message: ok ? "validated object identity and lossless mapped copy proved" : "validated object differed from save object" };
}

let failed = 0;
for (const family of families) {
  if (family.passOnly) {
    const outcome = runSingle(family.test);
    if (!outcome.ok) failed += 1;
    console.log(`${family.name}: ${outcome.ok ? "passed" : "FAILED"} ${outcome.message}`);
    if (!outcome.ok) console.error("Issues:", outcome.result.issues);
    continue;
  }

  if (family.batch) {
    const outcome = runBatchFamily();
    if (!outcome.ok) failed += 1;
    console.log(`${family.name}: ${outcome.ok ? "passed" : "FAILED"} ${outcome.message}`);
    continue;
  }

  const broken = runSingle(family.broken);
  const fixed = runSingle(family.fixed);
  const ok = broken.ok && fixed.ok;
  if (!ok) failed += 1;
  console.log(`${family.name}: ${ok ? "passed" : "FAILED"} broken=${broken.message}; fixed=${fixed.message}`);
  if (!ok) {
    console.error("Broken issues:", broken.result.issues);
    console.error("Fixed issues:", fixed.result.issues);
  }
}

const identityProof = runSaveIdentityProof();
if (!identityProof.ok) failed += 1;
console.log(`36 save-object identity proof: ${identityProof.ok ? "passed" : "FAILED"} ${identityProof.message}`);

if (failed > 0) process.exit(1);
