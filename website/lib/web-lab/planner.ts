import type { WebLabSpec, WebVulnerabilityModule } from "./schema";
import { boundWebLabContract } from "./contract";
import { seededRandom, stableLabId } from "./seed";
import { helpdeskV1 } from "./templates/helpdesk-v1";
import { reflectedXssV1 } from "./vulnerabilities/reflected-xss-v1";
import { storedXssV1 } from "./vulnerabilities/stored-xss-v1";

const companies = [
  { company: "Morrow Transit", name: "Morrow Support", tagline: "Help for the teams that keep journeys moving." },
  { company: "Asterfield Works", name: "Asterfield Help", tagline: "Answers for everyday workplace requests." },
  { company: "Northline Studio", name: "Northline Desk", tagline: "Practical support for your working day." },
  { company: "Cedarwell Services", name: "Cedarwell Support", tagline: "Find guidance and follow up on requests." },
] as const;
const names = ["Maya Chen", "Nadia Patel", "Owen Brooks", "Leah Morgan", "Samir Khan", "Ella Hughes"] as const;
const articleFixtures = [
  ["Reset your workspace password", "Use the account portal to request a reset link. If the link expires, start a new request rather than forwarding it."],
  ["Connect to the office network", "Choose the staff network and sign in with your work account. Contact support if your device remains disconnected."],
  ["Request a shared folder", "Tell the service desk which project needs the folder and who should have access. An owner will review the request."],
  ["Update your contact details", "Open your profile and confirm your contact number. Changes may take a few minutes to appear across services."],
  ["Check a ticket update", "Your request history shows the latest status and any follow-up questions from the support team."],
] as const;
const ticketFixtures = [
  "Cannot connect to the meeting-room display",
  "New starter needs access to project folder",
  "Password reset email has not arrived",
  "Laptop dock disconnects after sleep",
  "Shared calendar permissions need review",
] as const;

function planHelpdeskLab(seed: string, module: WebVulnerabilityModule): WebLabSpec {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(seed)) throw new Error("Seed must be 1–64 letters, digits, hyphens or underscores");
  const random = seededRandom(`helpdesk:1.0.0:${module.id}:${module.version}:${seed}`);
  const application = { ...random.pick(companies) };
  const first = random.int(names.length);
  const remainingAfterFirst = names.map((_, index) => index).filter(index => index !== first);
  const second = random.pick(remainingAfterFirst);
  const third = random.pick(remainingAfterFirst.filter(index => index !== second));
  const users: WebLabSpec["users"] = [
    { id: "user-1", name: names[first], role: "requester" },
    { id: "user-2", name: names[second], role: "agent" },
    { id: "user-3", name: names[third], role: "requester" },
  ];
  const articleOffset = random.int(articleFixtures.length);
  const ticketOffset = random.int(ticketFixtures.length);
  const labId = stableLabId(seed, module.id, helpdeskV1.id);
  const spec: WebLabSpec = {
    schemaVersion: 1,
    seed,
    labId,
    templateId: "helpdesk",
    templateVersion: "1.0.0",
    difficulty: "Beginner",
    durationMinutes: 30,
    application,
    users,
    session: { displayUserId: "user-1", mode: "fictional-display-only" },
    articles: Array.from({ length: 3 }, (_, index) => {
      const [title, body] = articleFixtures[(articleOffset + index) % articleFixtures.length];
      return { id: `article-${index + 1}`, title, body };
    }),
    tickets: Array.from({ length: 3 }, (_, index) => ({
      id: `request-${index + 1}`,
      ownerId: index === 1 ? "user-3" : "user-1",
      subject: ticketFixtures[(ticketOffset + index) % ticketFixtures.length],
      status: (["Open", "In progress", "Resolved"] as const)[(index + random.int(3)) % 3],
      replyEnabled: index === 0,
      comments: [{ id: `note-${index + 1}`, authorId: "user-2", body: "Thanks for your request. The support team is reviewing the details." }],
    })),
    routes: [
      { path: "/", page: "home" },
      { path: "/articles", page: "articles" },
      { path: "/requests", page: "requests" },
      { path: "/requests/detail", page: "requests/detail" },
      { path: "/search", page: "search" },
      { path: "/not-found", page: "not-found" },
    ],
    ...boundWebLabContract(helpdeskV1, module, "request-1", labId),
    resetState: { route: "/", query: "", completed: false },
  };
  return spec;
}

export function planBeginnerHelpdeskLab(seed: string): WebLabSpec { return planHelpdeskLab(seed, reflectedXssV1); }
export function planBeginnerStoredXssLab(seed: string): WebLabSpec { return planHelpdeskLab(seed, storedXssV1); }
