import { createHash } from "node:crypto";
import { compileWebLab } from "./compiler";
import { planBeginnerEcommerceReflectedXssLab, planBeginnerEcommerceStoredXssLab } from "./ecommerce-planner";
import { planBeginnerHelpdeskLab, planBeginnerStoredXssLab } from "./planner";
import type { SafeBuildMetadata } from "./postgres-control-repository";
import type { WebLabSpec } from "./schema";

export const EXECUTABLE_WEB_GENERATOR = "deterministic-web-v1";

export type ExecutableGenerationStage =
  | "usage_reserve"
  | "job_reservation_link"
  | "generation_job_lock"
  | "build_replay_lookup"
  | "spec_plan"
  | "saved_lab_insert"
  | "build_insert"
  | "job_link"
  | "usage_finalize"
  | "job_complete"
  | "failure_record";
export type ExecutableGenerationStageReporter = (stage: ExecutableGenerationStage) => void;

/** The ordinary AI-generated Web Security route is deliberately not executable. */
export function usesExecutableWebEngine(category: string, difficulty: string, duration: string, enabled: boolean): boolean {
  return enabled && category === "Web Security" && difficulty === "Beginner" && duration === "30 mins";
}

export type SavedExecutableWebLab = Readonly<{
  user_id: string;
  title: string;
  topic: "Web Security";
  difficulty: "Beginner";
  estimated_time: "30 mins";
  objective: string;
  scenario: string;
  tasks: string[];
  hints: string[];
  outcomes: string[];
  completed: false;
}>;

export type GenerationJobForBuild = Readonly<{
  status: string;
  category: string;
  difficulty: string;
  duration: string;
  resultingLabId: string | null;
}>;

export interface ExecutableWebSaveTransaction {
  lockedJob(jobId: string, ownerId: string): Promise<GenerationJobForBuild | null>;
  ownedBuild(savedLabId: string, ownerId: string): Promise<SafeBuildMetadata | null>;
  insertSavedLab(lab: SavedExecutableWebLab): Promise<string>;
  createBuild(input: { savedLabId: string; ownerId: string; spec: WebLabSpec }): Promise<SafeBuildMetadata>;
  linkJob(jobId: string, ownerId: string, savedLabId: string): Promise<void>;
}

export interface ExecutableWebSaveStore {
  transaction<T>(work: (transaction: ExecutableWebSaveTransaction) => Promise<T>): Promise<T>;
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** The job ID is the durable idempotency key; its seed never comes from the browser. */
export function planExecutableWebSpec(jobId: string, ownerId: string): WebLabSpec {
  if (!validUuid(jobId) || !validUuid(ownerId)) throw new Error("INVALID_GENERATION_IDENTITY");
  const seed = createHash("sha256").update(`${EXECUTABLE_WEB_GENERATOR}:${ownerId}:${jobId}`).digest("hex").slice(0, 32);
  const planners = [planBeginnerHelpdeskLab, planBeginnerStoredXssLab,
    planBeginnerEcommerceReflectedXssLab, planBeginnerEcommerceStoredXssLab] as const;
  const spec = planners[Number.parseInt(seed.slice(0, 2), 16) % planners.length](seed);
  compileWebLab(spec);
  return spec;
}

/** Explicit learner-safe projection. Never spread the full WebLabSpec into public.labs. */
export function learnerSavedLab(ownerId: string, spec: WebLabSpec): SavedExecutableWebLab {
  const task = (phase: string, title: string, description: string, deliverable: string) =>
    JSON.stringify({ phase, title, description, evidence: [], deliverable });
  const isStored = spec.learner.claimedBehavior === "stored";
  const isHelpdesk = spec.templateId === "helpdesk";
  const feature = isHelpdesk
    ? isStored ? "support request comments" : "helpdesk search"
    : isStored ? "product reviews" : "product catalogue search";
  const submittedValue = isHelpdesk
    ? isStored ? "comment" : "search term"
    : isStored ? "review" : "search query";
  const renderedArea = isHelpdesk
    ? isStored ? "support request" : "search results summary"
    : isStored ? "product page" : "catalogue results summary";
  return {
    user_id: ownerId,
    title: `${spec.application.name} web investigation`,
    topic: "Web Security",
    difficulty: "Beginner",
    estimated_time: "30 mins",
    objective: spec.learner.objective,
    scenario: `Investigate a fictional ${spec.application.name} application in an authorised local lab. Use the Run this lab section to examine the live behaviour; no production system is involved.`,
    tasks: [
      task("Explore", `Understand the ${feature} workflow`, `Open the local lab and use the ${feature} normally. Identify where your input appears before trying a security test.`, "Describe the workflow and where the submitted value is displayed."),
      task("Investigate", `Test how the ${submittedValue} is rendered`, `Use only this isolated lab to investigate how the application handles a harmless test value in the ${submittedValue}. Observe whether the value appears immediately or remains after you leave and return.`, "Record the behaviour you directly observed without including a working exploit payload."),
      task("Explain", "Report the finding and safer handling", `Explain why the observed rendering behaviour matters, how ${isStored ? "stored" : "reflected"} behaviour affects the risk, and how the application should handle untrusted content safely.`, "Provide a concise evidence-based finding, one limitation, and a mitigation principle."),
    ],
    hints: [
      `Start with a normal ${submittedValue}. Follow where it appears in the ${renderedArea} and note whether the application displays it as plain text or page content.`,
      isStored
        ? `After submitting a harmless marker, leave the page and return to the same item. Persistence helps distinguish stored behaviour from a one-time response.`
        : `Compare the value you submit with the page that returns immediately. Consider how the browser interprets that value in the results area.`,
      `If you need to confirm script execution, use a harmless visible browser indicator only inside this lab. Do not target external sites, access data, or perform destructive actions.`,
    ],
    outcomes: [
      `Recognise unsafe rendering of user-controlled ${submittedValue} in a browser.`,
      `Distinguish ${isStored ? "stored content that reappears later" : "reflected input returned in the current response"} from other input behaviour.`,
      "Explain why output encoding must match the HTML rendering context.",
      "Identify safe handling principles for untrusted content, including contextual output encoding and avoiding unsafe HTML insertion.",
    ],
    completed: false,
  };
}

/** The transaction must include the Saved Lab, immutable build, and job link. */
export async function saveExecutableWebGeneration(
  store: ExecutableWebSaveStore, jobId: string, ownerId: string,
  advanceStage: ExecutableGenerationStageReporter = () => {},
): Promise<{ savedLabId: string; build: SafeBuildMetadata; replayed: boolean }> {
  if (!validUuid(jobId) || !validUuid(ownerId)) throw new Error("INVALID_GENERATION_IDENTITY");
  advanceStage("generation_job_lock");
  return store.transaction(async (transaction) => {
    const job = await transaction.lockedJob(jobId, ownerId);
    if (!job || job.status !== "generating" ||
        !usesExecutableWebEngine(job.category, job.difficulty, job.duration, true)) {
      throw new Error("GENERATION_JOB_INVALID");
    }
    if (job.resultingLabId) {
      advanceStage("build_replay_lookup");
      const build = await transaction.ownedBuild(job.resultingLabId, ownerId);
      if (!build || build.savedLabId !== job.resultingLabId) throw new Error("GENERATION_BUILD_LINK_MISSING");
      return { savedLabId: job.resultingLabId, build, replayed: true };
    }
    advanceStage("spec_plan");
    const spec = planExecutableWebSpec(jobId, ownerId);
    advanceStage("saved_lab_insert");
    const savedLabId = await transaction.insertSavedLab(learnerSavedLab(ownerId, spec));
    advanceStage("build_insert");
    const build = await transaction.createBuild({ savedLabId, ownerId, spec });
    if (build.savedLabId !== savedLabId) throw new Error("GENERATION_BUILD_LINK_MISMATCH");
    advanceStage("job_link");
    await transaction.linkJob(jobId, ownerId, savedLabId);
    return { savedLabId, build, replayed: false };
  });
}
