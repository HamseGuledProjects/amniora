"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FlaskConical,
  Loader2,
  Lock,
  RefreshCcw,
  X,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AiContentSharingConsentDialog } from "@/components/ai/AiContentSharingConsentDialog";
import { EarlyAccessInvestigationBanner } from "@/components/layout/EarlyAccessInvestigationBanner";
import Badge from "@/app/components/ui/Badge";
import Button from "@/app/components/ui/Button";
import { PORTFOLIO_DEMO } from "@/lib/portfolio-demo/config";
import { ensureDemoInvestigation } from "@/lib/portfolio-demo/client";

const activeCategories = [
  {
    name: "Linux",
    description: "Host, account, service, process and evidence-chain investigations.",
    state: "Available",
  },
  {
    name: "Networking",
    description: "Packet, flow and network-control investigations. Archived category, unavailable in this demo.",
    state: "Preview",
  },
  {
    name: "Web Security",
    description: "Application logs, request traces and web abuse analysis. Archived category, unavailable in this demo.",
    state: "Preview",
  },
  {
    name: "OSINT",
    description: "Source review, attribution boundaries and public-record analysis. Archived category, unavailable in this demo.",
    state: "Preview",
  },
];

const comingSoonCategories = ["Forensics", "Cloud Security", "Cryptography", "Wireshark", "Nmap"];
const freeDifficulties = ["Beginner", "Intermediate"];
const proDifficulties = ["Beginner", "Intermediate", "Advanced"];
const durations = PORTFOLIO_DEMO ? ["30 mins"] : ["15 mins", "30 mins", "60 mins"];
const SAFE_LINUX_GENERATION_FAILURE_MESSAGE =
  "We couldn’t generate this investigation safely. Please try again.";
const LINUX_DURATION_COMPATIBILITY_MESSAGE =
  "15-minute Linux investigations are available for Beginner difficulty. Intermediate and Advanced investigations require at least 30 minutes.";
const DISMISSED_GENERATION_JOBS_KEY = "amniora.dismissedGenerationJobs";

type GenerationJobStatus = "queued" | "generating" | "completed" | "failed";

type GenerationJob = {
  id: string;
  category: string;
  difficulty: string;
  duration: string;
  status: GenerationJobStatus;
  resultingLabId: string | null;
  safeErrorCode: string | null;
  safeErrorMessage: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  expiresAt: string;
};

function durationToMinutes(duration: string) {
  return Number.parseInt(duration) || 30;
}

function linuxDurationIsSupported(category: string, difficulty: string, duration: string) {
  return category !== "Linux" || durationToMinutes(duration) !== 15 || difficulty === "Beginner";
}

function minimumSupportedDurationForLinuxDifficulty(difficulty: string) {
  return difficulty === "Intermediate" || difficulty === "Advanced" ? "30 mins" : "15 mins";
}

function learnerSafeLabGenerationError(data: { error?: unknown; message?: unknown }) {
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.error !== "string" || !data.error.trim()) return SAFE_LINUX_GENERATION_FAILURE_MESSAGE;
  if (/(?:capability_key|subject_indexes|canonical|validator|LINUX_|OPENAI|stack|trace|assessment|contract|rubric|hash|Authorization|Bearer|sk-)/i.test(data.error)) {
    return SAFE_LINUX_GENERATION_FAILURE_MESSAGE;
  }
  if (/^[a-z0-9_:-]+$/.test(data.error)) return SAFE_LINUX_GENERATION_FAILURE_MESSAGE;
  return data.error;
}

function formatJobTime(value: string | null) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(date);
}

function isActiveJob(job: GenerationJob | null) {
  return job?.status === "queued" || job?.status === "generating";
}

function readDismissedGenerationJobs() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_GENERATION_JOBS_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function rememberDismissedGenerationJob(jobId: string) {
  if (typeof window === "undefined") return;
  const dismissed = readDismissedGenerationJobs();
  dismissed.add(jobId);
  window.localStorage.setItem(DISMISSED_GENERATION_JOBS_KEY, JSON.stringify(Array.from(dismissed).slice(-20)));
}

function isDismissedTerminalGenerationJob(job: GenerationJob | null, explicitLookup: boolean) {
  if (!job || explicitLookup || isActiveJob(job)) return false;
  return readDismissedGenerationJobs().has(job.id);
}

export default function LabsPage() {
  const [category, setCategory] = useState("Linux");
  const [difficulty, setDifficulty] = useState("Beginner");
  const [duration, setDuration] = useState("30 mins");
  const [isPro, setIsPro] = useState(false);
  const [executableWebAvailable, setExecutableWebAvailable] = useState(false);
  const [pageRestoring, setPageRestoring] = useState(true);
  const [operationSubmitting, setOperationSubmitting] = useState(false);
  const [statusChecking, setStatusChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const announcedStatusRef = useRef<GenerationJobStatus | null>(null);

  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const freeBlocked = !isPro && durationToMinutes(duration) > 30;
  const difficulties = PORTFOLIO_DEMO ? ["Beginner"] : isPro ? proDifficulties : freeDifficulties;
  const selectedCategory = useMemo(
    () => activeCategories.find((item) => item.name === category),
    [category]
  );
  const activeJob = isActiveJob(job);
  const selectedConfig = activeJob && job ? job : { category, difficulty, duration };
  const durationCompatibilityBlocked = !linuxDurationIsSupported(category, difficulty, duration);
  const executableWebSelected = executableWebAvailable && category === "Web Security" &&
    difficulty === "Beginner" && duration === "30 mins";

  const loadGenerationJob = useCallback(async (id?: string) => {
    const suffix = id ? `?id=${encodeURIComponent(id)}` : "";
    const res = await fetch(`/api/ai/lab-generation-jobs${suffix}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(learnerSafeLabGenerationError(data));
    }
    setExecutableWebAvailable(data.executableWebAvailable === true);
    const restoredJob = (data.job || null) as GenerationJob | null;
    if (isDismissedTerminalGenerationJob(restoredJob, Boolean(id))) {
      setJob(null);
      return null;
    }
    setJob(restoredJob);
    return restoredJob;
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadInitialState() {
      try {
        const supabase = createClient();
        const [{ data: profile }, restoredJob] = await Promise.all([
          supabase.from("profiles").select("plan").single(),
          loadGenerationJob(),
        ]);
        if (!alive) return;
        setIsPro(profile?.plan === "pro");
        if (restoredJob) {
          setCategory(restoredJob.category);
          setDifficulty(restoredJob.difficulty);
          setDuration(restoredJob.duration);
        }
      } catch {
        if (alive) setError("Generation status could not be checked right now.");
      } finally {
        if (alive) setPageRestoring(false);
      }
    }
    loadInitialState();
    return () => {
      alive = false;
    };
  }, [loadGenerationJob]);

  useEffect(() => {
    if (!isActiveJob(job)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped || !job?.id) return;
      let latestJob: GenerationJob | null = null;
      try {
        setStatusChecking(true);
        const next = await loadGenerationJob(job.id);
        latestJob = next;
        if (next?.status === "completed" && next.resultingLabId) {
          setMessage("Investigation ready. You can open the saved lab now.");
        }
        if (next?.status === "failed") {
          setError(next.safeErrorMessage || SAFE_LINUX_GENERATION_FAILURE_MESSAGE);
        }
      } catch {
        if (!stopped) setError("Generation status could not be checked right now.");
      } finally {
        if (!stopped) {
          setStatusChecking(false);
          if (isActiveJob(latestJob || job)) {
            const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
            timer = setTimeout(poll, hidden ? 10000 : 3500);
          }
        }
      }
    };

    timer = setTimeout(poll, 2500);
    const onVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [job?.id, job?.status, loadGenerationJob]);

  useEffect(() => {
    if (!job || announcedStatusRef.current === job.status) return;
    announcedStatusRef.current = job.status;
  }, [job]);

  useEffect(() => {
    if (activeJob || linuxDurationIsSupported(category, difficulty, duration)) return;
    setDuration(minimumSupportedDurationForLinuxDifficulty(difficulty));
  }, [activeJob, category, difficulty, duration]);

  async function recordLabConsent() {
    const res = await fetch("/api/ai/content-consent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ feature: "lab_generation" }),
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      throw new Error(data.error || "AI consent could not be recorded.");
    }
    return data.token as string;
  }

  function requestGenerateLab() {
    if (freeBlocked) {
      setError("Free users can generate labs up to 30 minutes. Upgrade to Pro for longer asset-based labs.");
      return;
    }
    if (durationCompatibilityBlocked) {
      setError(LINUX_DURATION_COMPATIBILITY_MESSAGE);
      return;
    }
    if (operationSubmitting || consentSubmitting || activeJob) return;
    if (executableWebSelected) {
      void createGenerationJob();
      return;
    }
    setConsentOpen(true);
  }

  function handleDifficultyChange(nextDifficulty: string) {
    setDifficulty(nextDifficulty);
    if (!linuxDurationIsSupported(category, nextDifficulty, duration)) {
      setDuration(minimumSupportedDurationForLinuxDifficulty(nextDifficulty));
    }
  }

  function resetTerminalGenerationJob() {
    if (job && !isActiveJob(job)) {
      rememberDismissedGenerationJob(job.id);
    }
    setJob(null);
    setMessage("");
    setError("");
    announcedStatusRef.current = null;
  }

  async function createGenerationJob(aiContentConsentToken?: string) {
    setOperationSubmitting(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch("/api/ai/lab-generation-jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category,
          difficulty,
          duration,
          generationEngine: executableWebSelected ? "deterministic-web-v1" : "ai",
          ...(aiContentConsentToken ? { aiContentConsentToken } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.job) {
        throw new Error(learnerSafeLabGenerationError(data));
      }
      if (PORTFOLIO_DEMO) ensureDemoInvestigation();
      setJob(data.job);
      setMessage(PORTFOLIO_DEMO ? "The fixed synthetic investigation is ready. No AI request was made." : data.duplicate ? "Reconnected to the active generation." : "Generation started. You can leave this page and return to check its status.");
    } catch (err) {
      setError(err instanceof Error ? err.message : SAFE_LINUX_GENERATION_FAILURE_MESSAGE);
    } finally {
      setOperationSubmitting(false);
    }
  }

  async function confirmGenerateLabConsent() {
    if (operationSubmitting || consentSubmitting || activeJob) return;

    setConsentSubmitting(true);
    setError("");

    try {
      const token = await recordLabConsent();
      setConsentOpen(false);
      await createGenerationJob(token);
    } catch (err) {
      setConsentOpen(false);
      setError(
        err instanceof Error
          ? err.message
          : "AI content sharing consent could not be recorded. Please try again."
      );
    } finally {
      setConsentSubmitting(false);
    }
  }

  const transition = reducedMotion ? { duration: 0 } : { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] as const };

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
      className="space-y-space-6 pb-space-10 text-white"
    >
      <EarlyAccessInvestigationBanner />
      <SafetyNotice deterministicWeb={executableWebSelected} />

      <section className="overflow-hidden border border-white/10 bg-[#071624] text-white shadow-[0_24px_80px_rgba(0,0,0,0.26)]">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.38fr)]">
          <div className="border-b border-white/10 p-space-5 sm:p-space-6 lg:border-b-0 lg:border-r lg:p-space-7">
            <p className="type-label text-cyan-200">Generate Investigation</p>
            <h1 className="mt-space-3 max-w-3xl text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              Prepare a scoped investigation workspace.
            </h1>
            <p className="type-body mt-space-3 max-w-2xl text-slate-300">
              Open a fixed synthetic Linux investigation with tasks and evidence. These controls demonstrate the original generation flow; no AI request is made.
            </p>
          </div>
          <OperationPanel
            job={job}
            restoring={pageRestoring}
            checking={statusChecking}
            selectedConfig={selectedConfig}
            onOpen={() => job?.resultingLabId && router.push(`/dashboard/saved/${job.resultingLabId}`)}
          />
        </div>
      </section>

      <div aria-live="polite" className="sr-only">
        {job?.status === "queued" && "Generation queued"}
        {job?.status === "generating" && "Generating investigation"}
        {job?.status === "completed" && "Investigation ready"}
        {job?.status === "failed" && "Generation failed"}
      </div>

      <AnimatePresence>
        {message && (
          <StatusAlert key="generation-success-alert" type="success" message={message} onClose={() => setMessage("")} savedLabId={job?.resultingLabId || null} />
        )}
        {error && <StatusAlert key="generation-error-alert" type="error" message={error} onClose={() => setError("")} />}
      </AnimatePresence>

      <div className="grid gap-space-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="border border-white/10 bg-[#071624] text-white shadow-[0_24px_80px_rgba(0,0,0,0.24)]" aria-busy={activeJob || undefined}>
          <div className="grid border-b border-white/10 bg-[#081d2f] px-space-5 py-space-4 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-space-4">
            <div className="type-label flex h-9 w-11 items-center justify-center border border-white/15 bg-[#0b2033] text-slate-300">
              01
            </div>
            <div>
              <h2 className="type-section-title text-white">Configuration</h2>
              <p className="type-caption mt-1 text-slate-400">The local example uses Linux, Beginner difficulty and a 30-minute estimate.</p>
            </div>
          </div>

          <div className="grid gap-space-6 p-space-5 sm:p-space-6">
            <fieldset disabled={activeJob || operationSubmitting} className="min-w-0">
              <legend className="type-label text-slate-400">01 / Environment</legend>
              <div className="mt-space-3 grid gap-space-3 md:grid-cols-2">
                {activeCategories.map((item) => {
                  const active = category === item.name;
                  return (
                    <motion.button
                      layout={!reducedMotion}
                      key={item.name}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setCategory(item.name)}
                      className={`group min-w-0 border p-space-4 text-left outline-none transition-[border-color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-focus ${
                        active
                          ? "border-cyan-300/70 bg-cyan-400/10 shadow-[inset_3px_0_0_rgb(34,211,238)]"
                          : "border-white/10 bg-[#0b2033] hover:border-cyan-300/40 hover:bg-[#10283e]"
                      }`}
                    >
                      <span className="flex min-w-0 items-start justify-between gap-space-3">
                        <span className="min-w-0">
                          <span className="type-body block font-semibold text-white">{item.name}</span>
                          <span className="type-caption mt-space-2 block text-slate-400">{item.name === "Web Security" && executableWebAvailable
                            ? "Beginner 30-minute investigations are executable; other Web Security options remain static."
                            : item.description}</span>
                        </span>
                        <span className={`type-label shrink-0 ${active ? "text-cyan-200" : "text-slate-500"}`}>{item.name === "Web Security" && executableWebAvailable ? "Available" : item.state}</span>
                      </span>
                    </motion.button>
                  );
                })}
              </div>
              <div className="mt-space-4 border border-white/10 bg-[#081d2f] p-space-4">
                <p className="type-label text-slate-400">Archived environments</p>
                <div className="mt-space-3 flex flex-wrap gap-space-2">
                  {comingSoonCategories.map((item) => (
                    <Badge key={item} variant="neutral" className="gap-1.5">
                      <Lock size={12} aria-hidden="true" />
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            </fieldset>

            <div className="grid gap-space-5 lg:grid-cols-2">
              <OptionGroup
                number="02"
                title="Difficulty"
                description={PORTFOLIO_DEMO ? "This fixed sample uses Beginner difficulty." : !isPro ? "Advanced investigations are available on Pro." : "Choose the depth of analysis."}
                value={difficulty}
                options={difficulties}
                disabled={activeJob || operationSubmitting}
                onChange={handleDifficultyChange}
              />
              <OptionGroup
                number="03"
                title="Duration"
                description={PORTFOLIO_DEMO ? "A fixed 30-minute estimate for exploring the sample evidence." : LINUX_DURATION_COMPATIBILITY_MESSAGE}
                value={duration}
                options={durations}
                disabled={activeJob || operationSubmitting}
                optionDisabled={(item) => (!isPro && durationToMinutes(item) > 30) || !linuxDurationIsSupported(category, difficulty, item)}
                optionUnavailableReason={(item) => !linuxDurationIsSupported(category, difficulty, item) ? "Unavailable for this Linux difficulty" : "Unavailable on this plan"}
                onChange={setDuration}
              />
            </div>
          </div>
        </section>

        <aside className="space-y-space-5 xl:sticky xl:top-24 xl:self-start">
          <InvestigationBrief
            category={selectedConfig.category}
            difficulty={selectedConfig.difficulty}
            duration={selectedConfig.duration}
            isPro={isPro}
            selectedDescription={selectedCategory?.description}
            job={job}
            restoring={pageRestoring}
            active={activeJob}
            freeBlocked={freeBlocked}
            durationCompatibilityBlocked={durationCompatibilityBlocked}
            submitting={operationSubmitting || consentSubmitting}
            onGenerate={requestGenerateLab}
            onReset={resetTerminalGenerationJob}
          />
          <StatusModel job={job} />
        </aside>
      </div>

      <AiContentSharingConsentDialog
        open={consentOpen}
        feature="lab_generation"
        onCancel={() => setConsentOpen(false)}
        onConfirm={confirmGenerateLabConsent}
        isSubmitting={consentSubmitting}
      />
    </motion.div>
  );
}

function OptionGroup({
  number,
  title,
  description,
  value,
  options,
  disabled,
  onChange,
  optionDisabled,
  optionUnavailableReason,
}: {
  number: string;
  title: string;
  description: string;
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (value: string) => void;
  optionDisabled?: (value: string) => boolean;
  optionUnavailableReason?: (value: string) => string;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="type-label text-slate-400">{number} / {title}</legend>
      <p className="type-caption mt-1 text-slate-400">{description}</p>
      <div className="mt-space-3 grid gap-space-2">
        {options.map((item) => {
          const active = value === item;
          const blocked = optionDisabled?.(item) ?? false;
          const unavailableReason = blocked ? optionUnavailableReason?.(item) : undefined;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={active}
              aria-label={unavailableReason ? `${item}. ${unavailableReason}.` : item}
              title={unavailableReason}
              disabled={blocked}
              onClick={() => onChange(item)}
              className={`flex min-h-12 items-center justify-between border px-space-3 text-left outline-none transition-[border-color,background-color] focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-45 ${
                active ? "border-cyan-300/70 bg-cyan-400/10 text-white" : "border-white/10 bg-[#0b2033] text-white hover:border-cyan-300/40"
              }`}
            >
              <span className="type-body font-medium text-white">{item}</span>
              {blocked ? <Lock size={15} aria-hidden="true" className="text-slate-500" /> : active ? <CheckCircle2 size={17} aria-hidden="true" className="text-cyan-200" /> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function OperationPanel({
  job,
  restoring,
  checking,
  selectedConfig,
  onOpen,
}: {
  job: GenerationJob | null;
  restoring: boolean;
  checking: boolean;
  selectedConfig: { category: string; difficulty: string; duration: string };
  onOpen: () => void;
}) {
  const status = restoring ? "Restoring" : job?.status || "Ready";
  const active = isActiveJob(job);
  return (
    <div className="bg-[#0a1c2d] p-space-5 sm:p-space-6 lg:p-space-7">
      <div className="flex items-start justify-between gap-space-4">
        <div>
          <p className="type-label text-cyan-200">Operation State</p>
          <h2 className="mt-space-2 text-xl font-semibold text-white">{statusLabel(status)}</h2>
        </div>
        <StatusGlyph status={job?.status || (restoring ? "queued" : null)} checking={checking || restoring} />
      </div>

      <dl className="mt-space-6 grid grid-cols-3 gap-px border border-white/10 bg-white/10">
        {[
          ["Environment", selectedConfig.category],
          ["Difficulty", selectedConfig.difficulty],
          ["Duration", selectedConfig.duration],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 bg-[#0a1c2d] p-space-3">
            <dt className="type-caption text-slate-400">{label}</dt>
            <dd className="type-body mt-1 truncate font-semibold text-white">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-space-6 border-t border-white/10 pt-space-5">
        {restoring && <p className="type-caption text-slate-300">Checking the local example state.</p>}
        {!restoring && !job && <p className="type-caption text-slate-300">Ready to open the fixed synthetic investigation.</p>}
        {active && (
          <p className="type-caption text-slate-300">
            The sample is prepared locally. Return here to open it again.
          </p>
        )}
        {job?.status === "completed" && (
          <div className="space-y-space-4">
            <p className="type-caption text-slate-300">Completed {formatJobTime(job.completedAt)}.</p>
            <Button onClick={onOpen} className="w-full" leadingIcon={<ArrowRight size={17} aria-hidden="true" />}>
              Open investigation
            </Button>
          </div>
        )}
        {job?.status === "failed" && (
          <p className="type-caption text-slate-300">Generation stopped safely. No partial investigation was saved.</p>
        )}
      </div>
    </div>
  );
}

function statusLabel(status: string) {
  if (status === "Restoring") return "Restoring workspace";
  if (status === "queued") return "Queued";
  if (status === "generating") return "Generating investigation";
  if (status === "completed") return "Investigation ready";
  if (status === "failed") return "Generation failed";
  return "Ready";
}

function StatusGlyph({ status, checking }: { status: GenerationJobStatus | null; checking: boolean }) {
  if (checking || status === "queued" || status === "generating") {
    return <Loader2 size={22} aria-hidden="true" className="animate-spin text-cyan-200 motion-reduce:animate-none" />;
  }
  if (status === "completed") return <CheckCircle2 size={22} aria-hidden="true" className="text-emerald-300" />;
  if (status === "failed") return <AlertTriangle size={22} aria-hidden="true" className="text-amber-300" />;
  return <Clock3 size={22} aria-hidden="true" className="text-slate-300" />;
}

function StatusAlert({
  type,
  message,
  onClose,
  savedLabId,
}: {
  type: "success" | "error";
  message: string;
  onClose: () => void;
  savedLabId?: string | null;
}) {
  const success = type === "success";
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className={`flex items-start justify-between gap-space-4 border p-space-4 ${
        success ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-100" : "border-red-300/35 bg-red-400/10 text-red-100"
      }`}
      role={success ? "status" : "alert"}
    >
      <div className="flex items-start gap-space-3">
        {success ? <CheckCircle2 size={18} aria-hidden="true" className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />}
        <div>
          <p className="type-body">{message}</p>
          {savedLabId ? (
            <Link href={`/dashboard/saved/${savedLabId}`} className="type-button mt-space-3 inline-flex text-emerald-100 underline-offset-4 hover:underline">
              Open sample investigation
            </Link>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Dismiss ${type} message`}
        className="p-1 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-focus"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </motion.div>
  );
}

function InvestigationBrief({
  category,
  difficulty,
  duration,
  isPro,
  selectedDescription,
  job,
  restoring,
  active,
  freeBlocked,
  durationCompatibilityBlocked,
  submitting,
  onGenerate,
  onReset,
}: {
  category: string;
  difficulty: string;
  duration: string;
  isPro: boolean;
  selectedDescription?: string;
  job: GenerationJob | null;
  restoring: boolean;
  active: boolean;
  freeBlocked: boolean;
  durationCompatibilityBlocked: boolean;
  submitting: boolean;
  onGenerate: () => void;
  onReset: () => void;
}) {
  return (
    <section className="border border-white/10 bg-[#071624] text-white shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
      <div className="border-b border-white/10 bg-[#081d2f] p-space-5">
        <p className="type-label text-slate-400">Investigation Brief</p>
        <h2 className="type-section-title mt-space-2 text-white">Pre-flight summary</h2>
      </div>
      <div className="p-space-5">
        <dl className="grid grid-cols-3 gap-px border border-white/10 bg-white/10">
          {[
            ["Environment", category],
            ["Difficulty", difficulty],
            ["Duration", duration],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 bg-[#071624] p-space-3">
              <dt className="type-caption text-slate-400">{label}</dt>
              <dd className="type-body mt-1 truncate font-semibold text-white">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="type-caption mt-space-4 text-slate-400">{selectedDescription}</p>

        <div className="mt-space-5 border-t border-white/10 pt-space-5">
          <div className="flex items-center justify-between gap-space-3">
            <span className="type-label text-slate-400">Status</span>
            <Badge variant={job?.status === "completed" ? "success" : job?.status === "failed" ? "warning" : active ? "primary" : "neutral"}>
              {restoring ? "Restoring" : statusLabel(job?.status || "Ready")}
            </Badge>
          </div>
          {job && (
            <dl className="mt-space-4 space-y-space-2 border-l border-white/10 pl-space-4">
              <div>
                <dt className="type-caption text-slate-400">Created</dt>
                <dd className="type-caption text-slate-400">{formatJobTime(job.createdAt)}</dd>
              </div>
              {job.startedAt && (
                <div>
                  <dt className="type-caption text-slate-400">Started</dt>
                  <dd className="type-caption text-slate-400">{formatJobTime(job.startedAt)}</dd>
                </div>
              )}
            </dl>
          )}
        </div>

        {!isPro && (
          <div className="mt-space-5 border border-white/10 bg-[#081d2f] p-space-4">
            <div className="flex flex-wrap items-center gap-space-2">
              <p className="type-body font-semibold text-white">Free Plan</p>
              <Badge variant="neutral">Current plan</Badge>
            </div>
            <p className="type-caption mt-space-1 text-slate-400">Generate Beginner and Intermediate investigations up to 30 minutes.</p>
          </div>
        )}

        {freeBlocked && (
          <div className="mt-space-5 border border-amber-300/30 bg-amber-400/10 p-space-4 text-amber-100">
            <p className="type-body font-medium">Upgrade to Pro to generate investigations longer than 30 minutes.</p>
          </div>
        )}

        {durationCompatibilityBlocked && (
          <div className="mt-space-5 border border-amber-300/30 bg-amber-400/10 p-space-4 text-amber-100">
            <p className="type-body font-medium">{LINUX_DURATION_COMPATIBILITY_MESSAGE}</p>
          </div>
        )}

        <div className="mt-space-5 grid gap-space-3">
          {job?.status === "completed" ? (
            <Button variant="secondary" size="lg" className="w-full" onClick={onReset} leadingIcon={<RefreshCcw size={17} aria-hidden="true" />}>
              Try sample flow again
            </Button>
          ) : job?.status === "failed" ? (
            <Button variant="secondary" size="lg" className="w-full" onClick={onReset} leadingIcon={<RefreshCcw size={17} aria-hidden="true" />}>
              Configure sample investigation
            </Button>
          ) : (
            <Button
              size="lg"
              className="w-full"
              onClick={onGenerate}
              disabled={restoring || active || freeBlocked || durationCompatibilityBlocked || submitting}
              loading={submitting}
              loadingText="Starting operation..."
              leadingIcon={<FlaskConical size={18} aria-hidden="true" />}
            >
              {active ? "Preparing sample" : "Open sample investigation"}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusModel({ job }: { job: GenerationJob | null }) {
  const items = [
    ["Configure", "Select the investigation inputs."],
    ["Generating", "Generation is running as a saved operation."],
    ["Complete", "The saved investigation is ready."],
    ["Failed", "No partial lab is saved."],
  ];
  return (
    <section className="border border-white/10 bg-[#071624] p-space-5 text-white">
      <p className="type-label text-slate-400">Lifecycle</p>
      <div className="mt-space-4 grid gap-space-3">
        {items.map(([label, description]) => {
          const active = statusLabel(job?.status || "Ready").toLowerCase().includes(label.toLowerCase());
          return (
            <div key={label} className={`border-l-2 pl-space-3 ${active ? "border-cyan-300" : "border-white/10"}`}>
              <p className="type-caption font-semibold text-white">{label}</p>
              <p className="type-caption text-slate-400">{description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SafetyNotice({ deterministicWeb }: { deterministicWeb: boolean }) {
  return (
    <section
      data-generate-safety-notice="permanent"
      className="flex items-start gap-space-3 rounded-[3px] border border-amber-300/30 bg-amber-400/10 p-space-3 text-amber-100 sm:p-space-4"
      aria-labelledby="generate-safety-notice-title"
    >
      <AlertTriangle size={17} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p id="generate-safety-notice-title" className="type-caption font-semibold uppercase tracking-[0.08em] text-amber-100">
          IMPORTANT SAFETY NOTICE
        </p>
        <p className="type-caption mt-space-1 max-w-5xl leading-5 text-amber-50">
          Generated investigations are for authorised training environments only. Do not run generated commands or use generated evidence against production systems, public targets, or networks you do not own.
        </p>
        <p className="type-caption mt-space-1 max-w-5xl leading-5 text-amber-100/85">
          {deterministicWeb
            ? "This deterministic Web lab runs only in the authorised isolated environment. Record what you observe; do not test public or production systems."
            : "This synthetic example is fixed. Compare your reasoning with the supplied evidence; automatic assessment is unavailable."}
        </p>
      </div>
    </section>
  );
}
