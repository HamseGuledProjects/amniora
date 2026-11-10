import { parseLinuxCsvLine } from "./csv";
import type { LinuxSimulationWorld } from "./simulation";

type LearnerAsset = { file_path: string; content: string };
type LearnerTask = string | { title?: string; deliverable?: string; evidence?: string[] };
type ProcessRow = { pid: number; ppid: number; user: string; startedAt: string; command: string };

const TASK_PATHS: Record<string, string[]> = {
  change_control: ["assets/docs/change_request.md", "assets/logs/audit.log"],
  key_provenance: ["assets/journal/journal_ssh.txt", "assets/reports/permissions_report.txt", "assets/configs/ssh/sshd_config"],
  ssh_authentication: ["assets/journal/journal_ssh.txt", "assets/accounts/passwd.sample", "assets/runtime/process_execution_history.txt"],
  impact_assessment: ["assets/runtime/process_execution_history.txt", "assets/evidence/advanced_risk_register.csv"],
};

function fail(reason: string): never {
  throw new Error(`Linux Advanced SSH key task closure: ${reason}`);
}

function processRows(content: string): ProcessRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const header = parseLinuxCsvLine(lines[0] || "").values;
  for (const field of ["state_type", "started_at", "pid", "ppid", "user", "command"]) {
    if (!header.includes(field)) fail(`process history lacks ${field}.`);
  }
  return lines.slice(1).map((line) => {
    const values = parseLinuxCsvLine(line);
    if (values.quoted) fail("process history contains malformed CSV quoting.");
    const item = Object.fromEntries(header.map((key, index) => [key, values.values[index] || ""]));
    if (item.state_type !== "historical_reconstruction") fail("process history was promoted to current state.");
    const pid = Number(item.pid);
    const ppid = Number(item.ppid);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid)) fail("process history has a malformed PID or PPID.");
    return { pid, ppid, user: item.user, startedAt: item.started_at, command: item.command };
  });
}

function samePaths(actual: string[], expected: string[]) {
  return actual.length === expected.length && new Set(actual).size === expected.length &&
    expected.every((path) => actual.includes(path));
}

/** Final serialized-package gate for the scoped Advanced / 30-minute SSH-key task plan. */
export function assertAdvancedSshKeyTaskCorrelation(input: {
  simulation: LinuxSimulationWorld;
  assets: LearnerAsset[];
  tasks?: LearnerTask[];
}) {
  const { simulation, assets } = input;
  if (simulation.investigation.incidentFamily !== "ssh_key_compromise" ||
    simulation.requestedDurationMinutes !== 30 ||
    simulation.canonicalTasks[0]?.difficulty !== "Advanced") return;

  const tasks = input.tasks || [];
  if (tasks.length !== 4 || simulation.canonicalTasks.length !== 4) fail("the four-task Advanced 30-minute plan was not preserved.");
  const expectedIntents = Object.keys(TASK_PATHS);
  if (new Set(simulation.canonicalTasks.map((task) => task.intent)).size !== 4 ||
      !expectedIntents.every((intent) => simulation.canonicalTasks.some((task) => task.intent === intent))) {
    fail("the scoped change, key, session, and risk objectives are not all present.");
  }
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const intent = simulation.canonicalTasks[index].intent;
    if (typeof task === "string" || !samePaths(task.evidence || [], TASK_PATHS[intent])) {
      fail(`${intent} lost its bounded task-local evidence assignment.`);
    }
    const wording = `${task.title || ""} ${task.deliverable || ""}`;
    if (intent === "ssh_authentication" &&
        (!/session/i.test(wording) || !/process|PPID|parent/i.test(wording) || !/subsequent commands|activity/i.test(wording) ||
         !/account/i.test(wording) || !/key.source|key source/i.test(wording) ||
         !/later partial passwd snapshot|later partial account snapshot/i.test(wording))) {
      fail("the final sign-in task does not require supported session-to-activity reasoning and bounded identity context.");
    }
    if (intent === "ssh_authentication" &&
        (/\b(?:all|every)\b[^.]{0,60}\b(?:same|one|single) session\b/i.test(wording) ||
         /passwd(?:\.sample)?\b[^.!?]{0,80}\b(?:proves?|confirms?|establishes?)\b[^.!?]{0,60}\b(?:historical|incident.time)\b/i.test(wording))) {
      fail("the final session task promotes association or a later identity snapshot into historical certainty.");
    }
    if (intent === "key_provenance" &&
        (!/key identifier|fingerprint/i.test(wording) || !/lifecycle/i.test(wording) || !/(?:key|fingerprint).to.file mapping/i.test(wording))) {
      fail("the final provenance task lost its identifier, mapping, or lifecycle boundary.");
    }
    if (intent === "impact_assessment" &&
        (!/scope/i.test(wording) || !/risk/i.test(wording) || !/unverified|hypothes/i.test(wording) ||
         !/before escalation/i.test(wording) || /reconstruct.*(?:PID|ancestry)/i.test(wording))) {
      fail("the final risk task is not a distinct bounded synthesis.");
    }
    if (intent === "impact_assessment" &&
        /risk.register[^.]{0,100}\b(?:proves?|confirms?|observed|establishes?)\b[^.]{0,80}\b(?:impact|compromise|key change|approval)\b/i.test(wording)) {
      fail("risk-register hypotheses were promoted to independent observations.");
    }
  }

  const find = (path: string) => assets.find((asset) => asset.file_path === path)?.content || fail(`missing ${path}.`);
  const journal = find("assets/journal/journal_ssh.txt");
  const passwd = find("assets/accounts/passwd.sample");
  const history = processRows(find("assets/runtime/process_execution_history.txt"));
  const passwdHeader = passwd.split(/\r?\n/)[0] || "";
  const capturedAt = passwdHeader.match(/\bcapture_at=(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\b/)?.[1];
  if (!capturedAt || capturedAt <= simulation.collection.windowEnd ||
      !passwdHeader.includes(`host=${simulation.investigation.hostname}`) ||
      !/scope:\s*partial incident-focused local passwd snapshot/i.test(passwd)) {
    fail("passwd sample lacks later, same-host, partial-snapshot authority.");
  }
  const byPid = new Map<number, ProcessRow>();
  for (const row of history) {
    if (byPid.has(row.pid)) fail(`process history repeats PID ${row.pid}.`);
    byPid.set(row.pid, row);
  }
  const journalRows = journal.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (\S+) sshd\[(\d+)\]: Session opened for ([\w.-]+) from (\S+) fingerprint (\S+)$/);
    return match ? { time: match[1], host: match[2], pid: Number(match[3]), user: match[4], source: match[5], fingerprint: match[6] } : null;
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const sessions = simulation.sshSessions.filter((session) => session.purpose === "incident");
  if (sessions.length === 0) fail("there is no incident SSH session to correlate.");
  const usedJournalPids = new Set<number>();
  for (const session of sessions) {
    const matches = journalRows.filter((row) => row.pid === session.sessionPid &&
      row.host === simulation.investigation.hostname && row.time === session.openedAt &&
      row.user === session.username && row.source === session.sourceIp && row.fingerprint === session.keyFingerprint);
    if (matches.length !== 1 || usedJournalPids.has(session.sessionPid)) fail(`session ${session.id} lacks one distinct same-host journal opening.`);
    usedJournalPids.add(session.sessionPid);
    if (!passwd.split(/\r?\n/).some((line) => line.startsWith(`${session.username}:x:${session.uid}:${session.gid}:`))) {
      fail(`later account snapshot lacks ${session.username} context.`);
    }
    const ssh = byPid.get(session.sessionPid);
    const shell = byPid.get(session.shellPid || -1);
    if (!ssh || ssh.ppid !== session.monitorPid || ssh.user !== session.username ||
        ssh.startedAt !== session.openedAt || !ssh.command.startsWith("sshd:")) {
      fail(`session ${session.id} has no matching historical SSH process.`);
    }
    if (!shell || shell.ppid !== session.sessionPid || shell.user !== session.username ||
        shell.startedAt < session.openedAt || !/\b(?:bash|sh|zsh|fish)\b/.test(shell.command)) {
      fail(`session ${session.id} has no supported child shell.`);
    }
    const commands = simulation.commands.filter((command) => command.sessionId === session.id && command.id.startsWith("command:incident:"));
    if (commands.length === 0) fail(`session ${session.id} has no subsequent command branch.`);
    for (const command of commands) {
      const process = byPid.get(command.processId);
      const canonicalProcess = simulation.processes.find((item) => item.pid === command.processId);
      const expectedUser = canonicalProcess?.effectiveUid === 0
        ? "root"
        : simulation.identities.find((item) => item.id === canonicalProcess?.identityId)?.username;
      if (!process || !canonicalProcess || canonicalProcess.sessionId !== session.id ||
          process.startedAt !== command.timestamp || process.startedAt < session.openedAt ||
          process.user !== expectedUser) {
        fail(`${command.id} has no time-matched historical process.`);
      }
      let cursor = process;
      const visited = new Set<number>();
      while (cursor.pid !== session.shellPid) {
        if (visited.has(cursor.pid) || cursor.pid === session.sessionPid) fail(`${command.id} has broken or wrong-session ancestry.`);
        visited.add(cursor.pid);
        const parent = byPid.get(cursor.ppid);
        if (!parent || parent.startedAt > cursor.startedAt) fail(`${command.id} has a missing or later parent process.`);
        cursor = parent;
      }
    }
  }
  if (journalRows.filter((row) => usedJournalPids.has(row.pid)).length !== sessions.length) {
    fail("a corroborating or duplicate journal row was counted as a separate session.");
  }
}
