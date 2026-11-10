import { DEMO_LAB_ID, DEMO_USER_ID } from "./config";

export type DemoRow = Record<string, unknown>;
export const DEMO_TIME = "2026-01-12T10:00:00.000Z";
export const demoUser = {
  id: DEMO_USER_ID, email: "student@example.test", aud: "authenticated", role: "authenticated",
  created_at: DEMO_TIME, app_metadata: {}, user_metadata: { full_name: "Demo learner" },
};

export const demoLab = {
  id: DEMO_LAB_ID, user_id: DEMO_USER_ID, title: "After-hours access review", topic: "Linux",
  difficulty: "Beginner", estimated_time: "30 mins", duration: "30 mins", created_at: DEMO_TIME,
  completed: false, generation_engine: "portfolio-fixture",
  objective: "Use synthetic authentication and system records to explain an unusual sign-in and distinguish observations from assumptions.",
  scenario: "A fictional training server recorded an after-hours sign-in by the student account. Review the supplied evidence, reconstruct the sequence and state what it can and cannot establish. All names, hosts and records in this investigation are synthetic.",
  tasks: [
    JSON.stringify({ phase: "Observe", title: "Identify the sign-in", description: "Find the accepted sign-in in auth.log. Record the account, time and source address. Explain why a successful login alone does not establish who was at the keyboard.", evidence: ["logs/auth.log"], deliverable: "A short finding with the supporting log line and one limitation." }),
    JSON.stringify({ phase: "Correlate", title: "Build the sequence", description: "Compare auth.log with activity.csv. Identify the first recorded command after the sign-in and its recorded outcome. Keep your conclusion within the supplied evidence.", evidence: ["logs/auth.log", "evidence/activity.csv"], deliverable: "A two-event timeline with citations." }),
    JSON.stringify({ phase: "Explain", title: "Choose a proportionate next step", description: "Read the training brief. Suggest one useful follow-up check and identify evidence that would be needed before describing this as a confirmed compromise.", evidence: ["reports/training-brief.txt"], deliverable: "One follow-up check and an explicit uncertainty." }),
  ],
  hints: ["Start with the Accepted publickey line and its timestamp.", "The source address is a documentation-only address. It is not a real target.", "A command record shows an action, not its author's intent."],
  outcomes: ["Read a Linux authentication record", "Correlate evidence without inventing events", "Explain the limits of a finding"],
};

export const demoAssets = [
  { id: "demo-asset-auth", lab_id: DEMO_LAB_ID, user_id: DEMO_USER_ID, file_name: "auth.log", file_path: "logs/auth.log", file_type: "text/plain", content: "# Synthetic training evidence\nJan 12 21:14:02 training-host sshd[410]: Accepted publickey for student from 192.0.2.10 port 50214 ssh2\nJan 12 21:14:02 training-host sshd[410]: pam_unix(sshd:session): session opened for user student\nJan 12 21:18:10 training-host sshd[410]: pam_unix(sshd:session): session closed for user student\n" },
  { id: "demo-asset-activity", lab_id: DEMO_LAB_ID, user_id: DEMO_USER_ID, file_name: "activity.csv", file_path: "evidence/activity.csv", file_type: "text/csv", content: "timestamp,account,command,outcome\n2026-01-12T21:14:20Z,student,id,uid=1000(student)\n2026-01-12T21:15:05Z,student,cat /etc/os-release,Ubuntu training system\n" },
  { id: "demo-asset-brief", lab_id: DEMO_LAB_ID, user_id: DEMO_USER_ID, file_name: "training-brief.txt", file_path: "reports/training-brief.txt", file_type: "text/plain", content: "SYNTHETIC PORTFOLIO EXAMPLE\nThe student account is authorised for this fictional training host. No maintenance schedule or evidence identifying the person at the keyboard is supplied. A successful login is not, by itself, proof of compromise. Do not contact the documentation address or run commands against another system.\n" },
];

export function initialDemoTables(): Record<string, DemoRow[]> {
  return {
    profiles: [{ id: DEMO_USER_ID, full_name: "Demo learner", email: "student@example.test", role: "user", plan: "pro", level: "Beginner", xp: 120, labs_generated: 2, labs_completed: 1, created_at: DEMO_TIME }],
    labs: [demoLab, { ...demoLab, id: "demo-linux-permissions", title: "Permissions and evidence boundaries", completed: true, created_at: "2026-01-10T10:00:00.000Z" }],
    lab_assets: [...demoAssets, ...demoAssets.map(asset => ({ ...asset, id: `${asset.id}-permissions`, lab_id: "demo-linux-permissions" }))],
    achievements: [{ id: 1, name: "First evidence review", description: "Sample progress from a synthetic investigation.", icon: "Search", category: "Investigation" }],
    user_achievements: [{ id: 1, user_id: DEMO_USER_ID, achievement_id: 1, unlocked_at: DEMO_TIME }],
    roadmap_progress: [{ id: 1, user_id: DEMO_USER_ID, module_id: 1, completed: true, roadmap_modules: { id: 1, title: "Linux evidence foundations", display_order: 1 } }, { id: 2, user_id: DEMO_USER_ID, module_id: 2, completed: false, roadmap_modules: { id: 2, title: "Explain a defensible finding", display_order: 2 } }],
    roadmap_modules: [{ id: 1, title: "Linux evidence foundations", description: "Read a synthetic authentication record.", display_order: 1, difficulty: "Beginner" }, { id: 2, title: "Explain a defensible finding", description: "Separate observation from inference.", display_order: 2, difficulty: "Beginner" }],
    notifications: [], app_settings: [{ id: true, private_beta_enabled: true }], user_access: [{ user_id: DEMO_USER_ID, beta_access_granted: true }],
  };
}
