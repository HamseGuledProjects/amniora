#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

const labsPage = readText("app/dashboard/labs/page.tsx");
const jobRoute = readText("app/api/ai/lab-generation-jobs/route.ts");
const generateRoute = readText("app/api/ai/generate-lab/route.ts");
const migration = readText("supabase/migrations/20260901090000_lab_generation_jobs.sql");
const jobPostHandler = jobRoute.slice(jobRoute.indexOf("export async function POST"));
const generatePostHandler = generateRoute.slice(generateRoute.indexOf("export async function POST"));

assert("Generate page uses the persistent job endpoint", labsPage.includes("/api/ai/lab-generation-jobs"));
assert("Generate page restores current job on mount", labsPage.includes("loadGenerationJob()") && labsPage.includes("setPageRestoring(false)"));
assert("Generate page polls active jobs only", labsPage.includes("isActiveJob(job)") && labsPage.includes("setTimeout(poll") && labsPage.includes("visibilitychange"));
assert("Generate page stops polling on terminal states", labsPage.includes("if (!isActiveJob(job)) return") && labsPage.includes("status === \"completed\"") && labsPage.includes("status === \"failed\""));
assert("Generate page does not reschedule polling after terminal failure", labsPage.includes("let latestJob: GenerationJob | null = null") && labsPage.includes("latestJob = next") && labsPage.includes("if (isActiveJob(latestJob || job))"));
assert("Generate page prevents duplicate submit while active", labsPage.includes("activeJob") && labsPage.includes("Generation active") && labsPage.includes("if (operationSubmitting || consentSubmitting || activeJob) return"));
assert("Generate page keeps a local terminal-job dismissal preference", labsPage.includes("DISMISSED_GENERATION_JOBS_KEY") && labsPage.includes("readDismissedGenerationJobs") && labsPage.includes("rememberDismissedGenerationJob"));
assert("Generate page never dismisses active queued or generating jobs", labsPage.includes("if (!job || explicitLookup || isActiveJob(job)) return false") && labsPage.includes("if (!isActiveJob(job)) return"));
assert("Generate page does not resurrect dismissed terminal jobs on latest-status restore", labsPage.includes("isDismissedTerminalGenerationJob(restoredJob, Boolean(id))") && labsPage.includes("setJob(null)") && labsPage.includes("return null"));
assert("Generate page still restores explicit active job polling by id", labsPage.includes("const suffix = id ? `?id=${encodeURIComponent(id)}` : \"\"") && labsPage.includes("Boolean(id)") && labsPage.includes("loadGenerationJob(job.id)"));
assert("Generate page can reset terminal state without deleting or retrying", labsPage.includes("function resetTerminalGenerationJob()") && labsPage.includes("setJob(null)") && labsPage.includes("setMessage(\"\")") && labsPage.includes("setError(\"\")") && !/deleteGenerationJob|DELETE/.test(labsPage));
assert("Generate page reset does not call consent, reservation, or generation endpoints", labsPage.indexOf("function resetTerminalGenerationJob()") < labsPage.indexOf("async function createGenerationJob") && !/recordLabConsent|createGenerationJob|\/api\/ai\/lab-generation-jobs|\/api\/ai\/content-consent/.test(labsPage.slice(labsPage.indexOf("function resetTerminalGenerationJob()"), labsPage.indexOf("async function createGenerationJob"))));
assert("Generate page exposes truthful lifecycle states", ["CONFIGURE", "GENERATING", "COMPLETE", "FAILED"].every((state) => !labsPage.includes(state)) && ["Configure", "Generating", "Complete", "Failed"].every((state) => labsPage.includes(state)));
assert("Generate page uses real existing configuration fields", ["category", "difficulty", "duration"].every((field) => labsPage.includes(field)) && !labsPage.includes("customScenario"));
assert("Generate page centralizes Linux duration compatibility", labsPage.includes("function linuxDurationIsSupported") && labsPage.includes("minimumSupportedDurationForLinuxDifficulty"));
assert("Generate page keeps Beginner 15-minute Linux available", /category !== "Linux"[\s\S]{0,120}difficulty === "Beginner"/.test(labsPage) && labsPage.includes('"15 mins"'));
assert("Generate page disables 15-minute Linux for Intermediate and Advanced", labsPage.includes("!linuxDurationIsSupported(category, difficulty, item)") && labsPage.includes("Unavailable for this Linux difficulty"));
assert("Generate page auto-corrects unsupported 15-minute difficulty switches to 30", labsPage.includes("function handleDifficultyChange") && labsPage.includes('setDuration(minimumSupportedDurationForLinuxDifficulty(nextDifficulty))') && labsPage.includes('return difficulty === "Intermediate" || difficulty === "Advanced" ? "30 mins" : "15 mins"'));
assert("Generate page restores 15-minute availability without switching Beginner back to 15", labsPage.includes("if (activeJob || linuxDurationIsSupported(category, difficulty, duration)) return") && !/setDuration\("15 mins"\)/.test(labsPage));
assert("Generate page blocks unsupported duration submit before opening consent", labsPage.indexOf("if (durationCompatibilityBlocked)") < labsPage.indexOf("setConsentOpen(true)") && labsPage.includes("LINUX_DURATION_COMPATIBILITY_MESSAGE"));
assert("Generate page does not use fake progress", !/\\b(?:percent|percentage|progressValue|Almost done|0%|100%)\\b/i.test(labsPage));
assert("Generate page says leave-page only from active persisted job state", labsPage.includes("Generation will continue if you leave this page") && labsPage.includes("return here to check its status") && labsPage.indexOf("Generation will continue if you leave this page") > labsPage.indexOf("active &&"));
assert("Generate page keeps AI consent before job creation", labsPage.includes("recordLabConsent") && labsPage.indexOf("recordLabConsent") < labsPage.indexOf("createGenerationJob(token)"));
assert("Generate page keeps completed open action only in operation state", (labsPage.match(/Open investigation/g) || []).length === 1 && labsPage.includes("Investigation ready") && labsPage.includes("Generate new investigation"));
assert("Generate page offers new generation from completed brief without duplicate open link", labsPage.includes("job?.status === \"completed\" ?") && labsPage.includes("onClick={onReset}") && !labsPage.includes("Configure another attempt"));
assert("Generate page failed terminal action returns to configuration", labsPage.includes("job?.status === \"failed\" ?") && labsPage.includes("Configure new investigation") && !labsPage.includes("Configure another attempt"));
const failedBranch = labsPage.slice(labsPage.indexOf('job?.status === "failed" ?'), labsPage.indexOf(": (", labsPage.indexOf('job?.status === "failed" ?')));
assert("Generate page failure is terminal rather than interaction-locked", failedBranch.includes("Configure new investigation") && failedBranch.includes("onClick={onReset}") && !failedBranch.includes("disabled="));
assert("Generate page wires brief reset separately from generation request", labsPage.includes("onGenerate={requestGenerateLab}") && labsPage.includes("onReset={resetTerminalGenerationJob}") && labsPage.includes("onReset: () => void"));
assert("Generate page uses reduced-motion aware Motion", labsPage.includes("useReducedMotion") && labsPage.includes("layout={!reducedMotion}"));
assert("Generate page exposes accessible live status", labsPage.includes('aria-live="polite"') && labsPage.includes("Generation failed") && labsPage.includes("Investigation ready"));
assert("Generate page keys transient status alerts for AnimatePresence", labsPage.includes('key="generation-success-alert"') && labsPage.includes('key="generation-error-alert"'));
assert("Generate page uses boxy authenticated geometry", labsPage.includes("bg-[#071624]") && labsPage.includes("border border-white/10") && !labsPage.includes("rounded-ui-lg"));
assert("Generate page removes light authenticated workspace surfaces", !/bg-(?:surface|background|red-50|emerald-50)|text-text|border-border/.test(labsPage) && labsPage.includes("bg-[#0b2033]") && labsPage.includes("bg-[#081d2f]"));
assert("Generate page renders permanent safety notice before page heading", labsPage.includes('data-generate-safety-notice="permanent"') && labsPage.indexOf("<SafetyNotice />") < labsPage.indexOf("Generate Investigation"));
assert("Generate safety notice uses required authorised-training wording", labsPage.includes("IMPORTANT SAFETY NOTICE") && labsPage.includes("Generated investigations are for authorised training environments only."));
assert("Generate safety notice warns against production public targets and unowned networks", labsPage.includes("production systems, public targets, or networks you do not own"));
assert("Generate safety notice includes AI inaccuracy verification wording", labsPage.includes("AI-generated investigation content may contain inaccuracies. Verify findings against the supplied evidence."));
assert("Generate safety notice is not dismissible or locally hidden", !/data-generate-safety-notice[\s\S]{0,900}(onClose|onDismiss|localStorage|sessionStorage|setTimeout|<X\b)/.test(labsPage));
assert("Generate safety notice uses compact dark warning treatment", labsPage.includes("rounded-[3px]") && labsPage.includes("border-amber-300/30") && labsPage.includes("bg-amber-400/10") && labsPage.includes("text-amber-100"));
assert("Generate safety notice remains page-specific and not a global banner", labsPage.includes("function SafetyNotice") && !/GlobalStatusRegion|ServiceStatusBanner|DevelopmentBanner/.test(labsPage));
assert("Generate safety notice appears before the page title copy", labsPage.indexOf("<SafetyNotice />") < labsPage.indexOf("Prepare a scoped investigation workspace."));
assert("Generate safety notice has compact mobile-safe spacing", labsPage.includes("gap-space-3") && labsPage.includes("p-space-3") && labsPage.includes("sm:p-space-4"));
assert("Generate safety notice does not use light warning surfaces", !/data-generate-safety-notice[\s\S]{0,900}(bg-yellow|bg-amber-50|bg-white|rounded-xl|rounded-2xl|shadow-surface)/.test(labsPage));

assert("Job route uses Next after for server-owned generation continuation", jobRoute.includes("after(() => runGenerationJob") && jobRoute.includes("export const maxDuration = 300"));
assert("Job route reuses existing generation route", jobRoute.includes('POST as generateLab') && jobRoute.includes("generateLab("));
assert("Job route is protected by beta authorization", jobRoute.includes("authorizeBetaAccess") && jobRoute.includes("betaAccessErrorResponse"));
assert("Job route writes with service role only on the server", jobRoute.includes("supabaseAdmin") && !jobRoute.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
assert("Job route enforces one active job per user", jobRoute.includes("loadActiveJob") && jobRoute.includes("duplicate: true"));
assert("Job route exposes only safe job fields", jobRoute.includes("safeJob") && !jobRoute.includes("rawText") && !jobRoute.includes("prompt") && !jobRoute.includes("contract"));
assert("Job route marks completed jobs with only resulting lab id", jobRoute.includes("resulting_lab_id: payload.lab.id") && !jobRoute.includes("assets:"));
assert("Job route marks failed jobs without persisting partial lab content", jobRoute.includes("markJobFailed") && jobRoute.includes("SAFE_LINUX_GENERATION_FAILURE_MESSAGE"));
assert("Job route exposes missing migration as safe schema availability diagnostic", jobRoute.includes("lab_generation_job_schema_unavailable") && /42P01/.test(jobRoute) && jobRoute.includes("safe store failure") && jobRoute.includes("jobStoreFailureStatus"));
assert("Job route rejects unsupported Linux duration difficulty before job creation", jobRoute.includes("function linuxDurationIsSupported") && jobPostHandler.includes("unsupported_duration_difficulty") && jobPostHandler.indexOf("!linuxDurationIsSupported(category, difficulty, duration)") < jobPostHandler.indexOf('.from("lab_generation_jobs")'));
assert("Job route reconciles stale jobs and releases usage reservation", jobRoute.includes("reconcileStaleJob") && jobRoute.includes("releaseAIUsageReservation(job.usage_reservation_id"));
assert("Job route scopes lookup by owner", (jobRoute.match(/\.eq\("user_id",/g) || []).length >= 4);

assert("Generate route associates reservation with owned job", generateRoute.includes("generationJobId") && generateRoute.includes("usage_reservation_id: reservationId") && generateRoute.includes('.eq("user_id", user.id)'));
assert("Generate route still consumes consent before reserving usage", generateRoute.indexOf("consumeAiContentConsentToken") < generateRoute.indexOf('reserveAIUsage(user.id, "lab_generation")'));
assert("Generate route rejects unsupported Linux duration difficulty before engine execution", generateRoute.includes("function linuxDurationIsSupported") && generatePostHandler.includes("unsupported_duration_difficulty") && generatePostHandler.indexOf("!linuxDurationIsSupported(category, difficulty, duration)") < generatePostHandler.indexOf("buildLinuxAssetCandidate"));
assert("Generate route still saves lab only after final validation", generateRoute.indexOf("assertLinuxPreSaveWorkloadBoundary") < generateRoute.indexOf('.from("labs")'));
assert("Generate route still releases usage reservation on failure", generateRoute.includes("await releaseAIUsageReservation(reservationId)"));

assert("Migration creates minimal job state table", migration.includes("create table if not exists public.lab_generation_jobs") && migration.includes("status in ('queued', 'generating', 'completed', 'failed')"));
assert("Migration links jobs to owner and result only", migration.includes("user_id uuid not null references auth.users(id)") && migration.includes("resulting_lab_id uuid null references public.labs(id)"));
assert("Migration links reservations for stale release", migration.includes("usage_reservation_id uuid null references public.ai_usage_reservations(id)"));
assert("Migration enforces one active job per user", migration.includes("lab_generation_jobs_one_active_per_user_idx") && migration.includes("where status in ('queued', 'generating')"));
assert("Migration enables strict RLS", migration.includes("enable row level security") && migration.includes("Users can read their own lab generation jobs") && migration.includes("auth.uid() = user_id"));
assert("Migration denies browser writes", migration.includes("revoke all on table public.lab_generation_jobs from public, anon, authenticated") && migration.includes("grant select on table public.lab_generation_jobs to authenticated"));
assert("Migration stores no prompts, responses, contracts, evidence or learner answers", !/prompt|response|contract|evidence|answer|asset_content/i.test(migration));

console.log(`Generate Investigation Phase 3 tests passed (${assertions} assertions).`);
