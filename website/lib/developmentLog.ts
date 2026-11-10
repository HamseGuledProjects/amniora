export type DevelopmentLogCategory =
  | "Linux Labs"
  | "Grading"
  | "Exports"
  | "Reliability"
  | "Interface";

export type DevelopmentLogEntry = {
  date: string;
  label: string;
  title: string;
  categories: DevelopmentLogCategory[];
  improvements: string[];
};

export const DEVELOPMENT_LOG_ENTRIES: DevelopmentLogEntry[] = [
  {
    date: "2026-09-22",
    label: "Linux Early Access update",
    title: "Linux investigations receive an Early Access reliability update",
    categories: ["Linux Labs", "Reliability", "Exports"],
    improvements: [
      "Improved Linux investigation realism and consistency across processes, services, permissions and system activity.",
      "Strengthened investigation evidence so tasks are better supported by the files and system records learners receive.",
      "Improved reliability across timelines, generated investigation packages and exported evidence for a smoother Early Access experience.",
    ],
  },
  {
    date: "2026-09-07",
    label: "Linux labs update",
    title: "Linux investigations are more reliable",
    categories: ["Linux Labs", "Reliability"],
    improvements: [
      "Completed final reliability checks for Linux investigations, including stricter duration handling.",
      "Fifteen-minute investigations are now limited to Beginner difficulty, while Intermediate and Advanced investigations require at least 30 minutes.",
    ],
  },
  {
    date: "2026-09-06",
    label: "Authenticated experience update",
    title: "The signed-in experience is clearer",
    categories: ["Interface", "Reliability"],
    improvements: [
      "Signed-in navigation now feels clearer across desktop and mobile, with steadier access to Amniora tools.",
      "Dashboard, Generate Investigation, Saved Investigations, AI Tutor and Progress now share more consistent responsive states and learner-facing terminology.",
    ],
  },
  {
    date: "2026-09-05",
    label: "Security update",
    title: "Password recovery reliability improvements",
    categories: ["Reliability"],
    improvements: [
      "Password recovery now works more reliably across supported environments.",
      "Invalid or expired reset links now show clearer account-access guidance.",
    ],
  },
  {
    date: "2026-08-28",
    label: "Public stability update",
    title: "Public interface stability fixes",
    categories: ["Interface", "Reliability"],
    improvements: [
      "Fixed an issue that could cause the public navigation to shift during fast scrolling on mobile devices.",
      "Updated the homepage product preview so it continues cycling through its demonstration.",
    ],
  },
  {
    date: "2026-08-28",
    label: "Public experience update",
    title: "Public experience refinement",
    categories: ["Interface"],
    improvements: [
      "Refined Features, Labs, Roadmap, Pricing and About so product information is clearer before private beta access.",
      "Improved responsive behavior across mobile, tablet and desktop public pages.",
      "Continued refining the homepage product preview so investigations, evidence, guidance, saved work and progression are easier to understand.",
    ],
  },
  {
    date: "2026-08-21",
    label: "Feedback update",
    title: "Lab feedback and reporting",
    categories: ["Interface", "Reliability"],
    improvements: [
      "Added lab ratings and optional improvement feedback from saved investigations.",
      "Added problem reports linked securely to the relevant saved lab.",
      "Improved how reported lab issues are reviewed and tracked.",
    ],
  },
  {
    date: "2026-08-13",
    label: "August 2026 update",
    title: "Linux investigations are clearer and more dependable",
    categories: ["Linux Labs", "Reliability", "Grading"],
    improvements: [
      "Improved task wording so learners receive complete, natural instructions.",
      "Strengthened evidence checks so listed tasks stay answerable from the exported files.",
      "Improved grading consistency for evidence-supported answers that clearly explain uncertainty.",
    ],
  },
  {
    date: "2026-07-31",
    label: "Private beta update",
    title: "Saved lab review and exports are more reliable",
    categories: ["Exports", "Interface", "Reliability"],
    improvements: [
      "Improved saved lab pages for reviewing tasks, evidence and completion state.",
      "Refined evidence exports so downloaded packs have stable structure and file identity.",
      "Updated private beta notices to set clearer expectations for active development.",
    ],
  },
  {
    date: "2026-07-29",
    label: "Linux grading update",
    title: "Evidence-backed grading became more structured",
    categories: ["Grading", "Linux Labs"],
    improvements: [
      "Improved how Linux task answers are checked while keeping scoring consistent.",
      "Improved feedback for unsupported certainty, missing evidence and incomplete citations.",
      "Strengthened safeguards so grading does not expose hidden assessment details.",
    ],
  },
  {
    date: "2026-07-25",
    label: "Linux labs update",
    title: "Linux investigation coverage expanded across difficulty levels",
    categories: ["Linux Labs", "Reliability"],
    improvements: [
      "Expanded Linux scenarios across authentication, persistence, services, packages and containers.",
      "Improved difficulty alignment so Beginner, Intermediate and Advanced labs use appropriate evidence depth.",
      "Improved checks for timelines, identities, services and the evidence listed for each task.",
    ],
  },
  {
    date: "2026-07-18",
    label: "Learning experience update",
    title: "Private beta learning pages became easier to navigate",
    categories: ["Interface", "Reliability"],
    improvements: [
      "Refined public pages, dashboard navigation and saved lab review steps.",
      "Improved mobile layout behavior for long lab titles, filenames and task text.",
      "Added clearer consent and private beta messages for AI-supported learning features.",
    ],
  },
];

export function sortedDevelopmentLogEntries(entries = DEVELOPMENT_LOG_ENTRIES) {
  return entries.slice().sort((left, right) => right.date.localeCompare(left.date));
}
