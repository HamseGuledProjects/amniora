"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Check,
  CheckCircle2,
  Copy,
  FileCheck2,
  FileText,
  Lock,
  MessageCircle,
  Terminal,
  Lightbulb,
  Loader2,
  Sparkles,
  Target,
} from "lucide-react";
import { AiContentSharingConsentDialog } from "@/components/ai/AiContentSharingConsentDialog";
import Button from "@/app/components/ui/Button";

type TaskCardProps = {
  labId: string;
  task: string;
  taskId?: string;
  gradingAttempt?: GradingAttempt;
  index: number;
  isPro: boolean;
  objective?: string;
  scenario?: string;
  difficulty?: string;
  gradingAvailable?: boolean;
  gradingMessage?: string;
  gradingEnabled?: boolean;
  maxAnswerLength?: number;
  onGraded?: () => void;
};

type Mode = "explain" | "hint" | "command" | "quiz";

type StructuredTask = {
  phase: string;
  title: string;
  evidence: string[];
  deliverable: string;
};

type GradingAttempt = {
  status: "graded" | "retryable";
  taskId: string;
  score?: number;
  maximumPoints?: number;
  mastered?: boolean;
  feedback?: {
    summary?: string;
    missingComponents?: string[];
    evidenceIssues?: string[];
    reasoningIssues?: string[];
    uncertaintyIssues?: string[];
    remediationIssues?: string[];
    boundaryIssues?: string[];
    diagnostics?: Array<{ code?: string; message?: string }>;
  };
  diagnostics?: Array<{ code: string; severity: string; message: string }>;
  idempotencyKey: string;
  attemptId?: string;
};

type SubmissionState = "draft" | "submitting" | "graded" | "retryable" | "blocked";

export default function TaskCard({
  labId,
  task,
  taskId,
  gradingAttempt,
  index,
  isPro,
  objective = "",
  scenario = "",
  difficulty = "",
  gradingAvailable = false,
  gradingMessage = "",
  gradingEnabled = false,
  maxAnswerLength = 12000,
  onGraded,
}: TaskCardProps) {
  const [loading, setLoading] = useState<Mode | null>(null);
  const [activeMode, setActiveMode] = useState<Mode | null>(null);
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [lockedMessage, setLockedMessage] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const draftStorageKey = `amniora:linux-grading:draft:${labId}:${taskId || index}`;
  const idempotencyStorageKey = `amniora:linux-grading:idempotency:${labId}:${taskId || index}`;
  const [answer, setAnswer] = useState("");
  const [submissionState, setSubmissionState] = useState<SubmissionState>(gradingAttempt?.status === "graded" ? "graded" : "draft");
  const [gradingError, setGradingError] = useState("");
  const [localAttempt, setLocalAttempt] = useState<GradingAttempt | undefined>(gradingAttempt);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentSubmitting, setConsentSubmitting] = useState(false);

  const parsedTask = useMemo(() => parseStructuredTask(task), [task]);
  const aiTaskContext = parsedTask
    ? `${parsedTask.phase}: ${parsedTask.title}\nEvidence: ${parsedTask.evidence.join(
        ", "
      )}\nDeliverable: ${parsedTask.deliverable}`
    : task;

  const actions: { label: string; mode: Mode; icon: React.ReactNode }[] = [
    {
      label: "Explain",
      mode: "explain",
      icon: <MessageCircle size={15} aria-hidden="true" />,
    },
    {
      label: "Hint",
      mode: "hint",
      icon: <Lightbulb size={15} aria-hidden="true" />,
    },
    {
      label: "Command",
      mode: "command",
      icon: <Terminal size={15} aria-hidden="true" />,
    },
    {
      label: "Quiz",
      mode: "quiz",
      icon: <Brain size={15} aria-hidden="true" />,
    },
  ];

  async function handleAction(mode: Mode) {
    setError("");
    setLockedMessage(false);
    setSelectedAnswer(null);
    setCopied(false);

    if (!isPro) {
      setLockedMessage(true);
      return;
    }

    setLoading(mode);
    setActiveMode(mode);
    setResponse("");

    try {
      const res = await fetch("/api/ai/task-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          task: aiTaskContext,
          objective,
          scenario,
          difficulty,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Amniora could not help with this task.");
        return;
      }

      setResponse(data.response || "No response generated.");
    } catch {
      setError("Amniora could not help with this task right now.");
    } finally {
      setLoading(null);
    }
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const commandText = useMemo(() => cleanCommandText(response), [response]);
  const quiz = useMemo(() => parseQuiz(response), [response]);
  const visibleAttempt = localAttempt || gradingAttempt;
  const charactersRemaining = Math.max(maxAnswerLength - answer.length, 0);

  useEffect(() => {
    if (!gradingAttempt) return;
    setLocalAttempt(gradingAttempt);
    setSubmissionState(gradingAttempt.status === "graded" ? "graded" : "retryable");
  }, [gradingAttempt]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAnswer(window.localStorage.getItem(draftStorageKey) || "");
  }, [draftStorageKey]);

  function updateAnswer(value: string) {
    const bounded = value.slice(0, maxAnswerLength);
    setAnswer(bounded);
    setGradingError("");
    if (typeof window !== "undefined") {
      window.localStorage.setItem(draftStorageKey, bounded);
      if (visibleAttempt?.status !== "graded") {
        window.localStorage.removeItem(idempotencyStorageKey);
      }
    }
    if (submissionState !== "submitting" && visibleAttempt?.status !== "graded") {
      setSubmissionState("draft");
    }
  }

  function getIdempotencyKey() {
    if (typeof window !== "undefined") {
      const existing = window.localStorage.getItem(idempotencyStorageKey);
      if (existing) return existing;
    }
    const key = `phase13a:${labId}:${taskId || index}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    if (typeof window !== "undefined") window.localStorage.setItem(idempotencyStorageKey, key);
    return key;
  }

  function learnerSafeError(status: number, data: { error?: string; code?: string; retryable?: boolean }) {
    if (status === 401) return "Sign in again before submitting this answer.";
    if (status === 403 && /consent/i.test(data.error || "")) return "AI content sharing consent is required before grading this answer.";
    if (status === 403) return "Your account is not authorized to use AI grading right now.";
    if (status === 404) return "This lab or task could not be found for your account.";
    if (status === 409) return "This lab cannot be graded until its assessment provenance is available.";
    if (status === 413) return "This answer is too long for grading.";
    if (status === 429) return "Too many grading requests. Please wait and try again.";
    if (data.retryable || status >= 500) return "Grading is temporarily unavailable. Your draft has been kept.";
    return "This answer could not be submitted for grading.";
  }

  async function recordLinuxGradingConsent() {
    const consentRes = await fetch("/api/ai/content-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature: "linux_grading" }),
    });
    const consent = await consentRes.json();
    if (!consentRes.ok) throw new Error(consent.error || "Amniora could not record AI consent.");

    const bindRes = await fetch("/api/ai/linux-grading/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labId, aiContentConsentToken: consent.token }),
    });
    const bound = await bindRes.json();
    if (!bindRes.ok) throw new Error(bound.error || "Amniora could not attach consent to this lab.");
  }

  async function submitForGrading() {
    if (!taskId || submissionState === "submitting") return;
    const trimmed = answer.trim();
    if (!trimmed) {
      setSubmissionState("blocked");
      setGradingError("Enter an evidence-backed answer before submitting.");
      return;
    }
    if (trimmed.length > maxAnswerLength) {
      setSubmissionState("blocked");
      setGradingError("This answer is too long for grading.");
      return;
    }

    setSubmissionState("submitting");
    setGradingError("");
    try {
      const res = await fetch("/api/ai/linux-grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labId,
          taskId,
          learnerAnswer: trimmed,
          idempotencyKey: getIdempotencyKey(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 && /consent/i.test(data.error || "")) {
          setConsentOpen(true);
        }
        setSubmissionState(data.retryable || res.status >= 500 ? "retryable" : "blocked");
        setGradingError(learnerSafeError(res.status, data));
        return;
      }
      setLocalAttempt(data);
      setSubmissionState(data.status === "graded" ? "graded" : "retryable");
      if (data.status === "graded" && typeof window !== "undefined") {
        window.localStorage.removeItem(draftStorageKey);
      }
      onGraded?.();
    } catch {
      setSubmissionState("retryable");
      setGradingError("Network failure while grading. Your draft has been kept.");
    }
  }

  async function confirmGradingConsent() {
    if (consentSubmitting) return;
    setConsentSubmitting(true);
    try {
      await recordLinuxGradingConsent();
      setConsentOpen(false);
      await submitForGrading();
    } catch (err) {
      setConsentOpen(false);
      setSubmissionState("blocked");
      setGradingError(err instanceof Error ? err.message : "AI consent could not be recorded.");
    } finally {
      setConsentSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 + index * 0.04 }}
      id={`task-${index + 1}`}
      data-saved-investigation-active-task-card="dark"
      className="scroll-mt-24 overflow-hidden rounded-[4px] border border-white/10 bg-[#071426] text-white shadow-[0_16px_40px_rgba(0,0,0,0.22)]"
    >
      <div className="border-b border-white/10 bg-[#061222] px-space-4 py-space-4 sm:px-space-5">
        <div className="flex min-w-0 gap-space-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-cyan-300/30 bg-cyan-300/10 text-sm font-bold text-cyan-100">
          {index + 1}
        </div>

        <div className="min-w-0 flex-1">
          {parsedTask ? (
            <div>
              <div className="type-label mb-space-2 inline-flex max-w-full break-words text-cyan-200/75">
                {parsedTask.phase}
              </div>

              <h3 className="break-words text-xl font-semibold leading-7 text-white">
                {parsedTask.title}
              </h3>
            </div>
          ) : (
            <p className="type-body whitespace-pre-wrap break-words leading-6 text-slate-200">
              {task}
            </p>
          )}
        </div>
        </div>
      </div>

      <div className="space-y-space-5 p-space-4 sm:p-space-5">
          {parsedTask ? (
              <div className="grid gap-space-3 lg:grid-cols-2">
                <section
                  data-active-task-evidence-requirements="true"
                  className="min-w-0 rounded-[4px] border border-cyan-100/12 bg-[#081827] p-space-4"
                >
                  <div className="type-label mb-space-3 flex items-center gap-space-2 text-slate-300">
                    <FileText size={14} aria-hidden="true" />
                    Evidence Required
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {parsedTask.evidence.map((item) => (
                      <span
                        key={item}
                        title={item}
                        className="type-caption max-w-full rounded-[3px] border border-cyan-100/15 bg-[#0b2033] px-2.5 py-1 font-medium text-cyan-100"
                      >
                        {displayEvidenceName(item)}
                      </span>
                    ))}
                  </div>
                </section>

                <section
                  data-active-task-deliverable="true"
                  className="min-w-0 rounded-[4px] border border-white/10 bg-[#081827] p-space-4"
                >
                  <div className="type-label mb-space-3 flex items-center gap-space-2 text-slate-300">
                    <Target size={14} aria-hidden="true" />
                    Deliverable
                  </div>

                  <p className="type-body break-words leading-6 text-slate-100">
                    {parsedTask.deliverable}
                  </p>
                </section>
              </div>
          ) : null}

          <section
            data-active-task-guidance-strip="true"
            className="rounded-[4px] border border-white/10 bg-[#061222] p-space-3"
          >
            <div className="mb-space-3 flex items-center gap-space-2">
              <Sparkles size={14} aria-hidden="true" className="text-cyan-200" />
              <p className="type-label text-cyan-200/80">Task Guidance</p>
            </div>
          <div className="grid grid-cols-2 gap-space-2 sm:flex sm:flex-wrap">
            {actions.map((action) => (
              <button
                key={action.mode}
                onClick={() => handleAction(action.mode)}
                disabled={loading !== null}
                aria-pressed={activeMode === action.mode}
                className={`type-button flex min-h-10 items-center justify-center gap-space-2 rounded-[4px] border px-3 outline-none transition-[background-color,border-color,color] focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#061222] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-9 ${
                  isPro
                    ? activeMode === action.mode
                      ? "border-cyan-300/45 bg-cyan-300/10 text-cyan-100"
                      : "border-white/10 bg-[#081827] text-slate-300 hover:border-cyan-300/35 hover:bg-[#0b2033] hover:text-white"
                    : "border-white/10 bg-[#081827] text-slate-400 hover:border-white/20"
                }`}
              >
                {loading === action.mode ? (
                  <Loader2
                    size={15}
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  action.icon
                )}
                {action.label}
                {!isPro && <Lock size={13} aria-hidden="true" />}
              </button>
            ))}
          </div>
          </section>

          <AnimatePresence>
            {lockedMessage && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                role="status"
                className="type-caption rounded-[4px] border border-cyan-300/20 bg-cyan-300/10 p-space-3 leading-5 text-cyan-100"
              >
                AI task guidance is a Pro feature. Upgrade to unlock
                explanations, hints, safe commands, and quizzes.
              </motion.div>
            )}

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                role="alert"
                className="type-caption rounded-[4px] border border-red-300/25 bg-red-950/25 p-space-3 leading-5 text-red-100"
              >
                {error}
              </motion.div>
            )}

            {(loading || response) && isPro && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                aria-live="polite"
                className="max-w-full overflow-hidden rounded-[4px] border border-cyan-100/12 bg-[#081827] p-space-4"
              >
                <div className="type-label mb-space-3 flex items-center gap-space-2 text-cyan-200">
                  <Sparkles size={14} aria-hidden="true" />
                  Amniora
                </div>

                {loading && <LoadingShimmer />}

                {!loading && activeMode === "command" && (
                  <div>
                    <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-[4px] border border-slate-700 bg-slate-950 p-space-4 text-xs leading-6 text-slate-100 sm:text-sm sm:leading-7">
                      <code className="block whitespace-pre-wrap break-words">
                        {commandText}
                      </code>
                    </pre>

                    <button
                      onClick={() => copyText(commandText)}
                      className="type-button mt-space-3 inline-flex min-h-9 items-center gap-space-2 rounded-[4px] border border-cyan-100/15 bg-[#0b2033] px-3 text-cyan-100 outline-none hover:border-cyan-200/40 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#081827]"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? "Copied" : "Copy commands"}
                    </button>
                  </div>
                )}

                {!loading && activeMode === "quiz" && quiz && (
                  <div className="space-y-3">
                    <p className="type-body font-semibold leading-6 text-white">
                      {quiz.question}
                    </p>

                    <div className="grid gap-2">
                      {quiz.options.map((option) => {
                        const letter = option.slice(0, 1);
                        const isSelected = selectedAnswer === letter;
                        const isCorrect = quiz.correct === letter;

                        return (
                          <button
                            key={option}
                            onClick={() => {
                              if (!selectedAnswer) setSelectedAnswer(letter);
                            }}
                            disabled={selectedAnswer !== null}
                            className={`type-body break-words rounded-[3px] border p-space-4 text-left leading-6 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-70 ${
                              selectedAnswer
                                ? isCorrect
                                  ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                                  : isSelected
                                  ? "border-red-300/25 bg-red-950/25 text-red-100"
                                  : "border-white/10 bg-[#071426] text-slate-300"
                                : "border-white/10 bg-[#071426] text-slate-300 hover:border-cyan-300/35 hover:bg-[#0b2033]"
                            }`}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>

                    {selectedAnswer && (
                      <div className="rounded-[4px] border border-white/10 bg-[#071426] p-space-3 text-slate-300">
                        <p
                          className={`font-semibold ${
                            selectedAnswer === quiz.correct
                              ? "text-emerald-200"
                              : "text-red-100"
                          }`}
                        >
                          {selectedAnswer === quiz.correct
                            ? "Correct!"
                            : `Incorrect. Correct answer: ${quiz.correct}`}
                        </p>

                        {quiz.explanation && (
                          <p className="type-body mt-space-2 leading-6 text-slate-300">
                            {quiz.explanation}
                          </p>
                        )}

                        <p className="type-caption mt-space-3 text-slate-400">
                          Want another challenge? Press{" "}
                          <span className="font-semibold text-cyan-200">
                            Quiz
                          </span>{" "}
                          again to generate a new question.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {!loading &&
                  activeMode !== "command" &&
                  activeMode !== "quiz" && (
                    <p className="type-body whitespace-pre-wrap break-words leading-7 text-slate-300">
                      {response}
                    </p>
                  )}

                {!loading && activeMode === "quiz" && !quiz && (
                  <p className="type-body whitespace-pre-wrap break-words leading-7 text-slate-300">
                    {response}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {gradingEnabled && <section data-active-task-answer-workbench="true" className="rounded-[4px] border border-white/10 bg-[#061222] p-space-4">
            <div className="flex flex-col gap-space-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="type-label flex items-center gap-space-2 text-cyan-200/80">
                  <FileCheck2 size={14} aria-hidden="true" />
                  Task answer
                </div>
                <p className="type-caption mt-1 text-slate-300">
                  Use task evidence and keep answers under {maxAnswerLength.toLocaleString()} characters.
                </p>
              </div>
              {visibleAttempt?.status === "graded" && visibleAttempt.mastered === true && (
                <span className="type-caption inline-flex min-h-7 items-center rounded-[3px] border border-emerald-300/25 bg-emerald-300/10 px-2.5 py-1 font-semibold text-emerald-100">
                  <CheckCircle2 size={13} aria-hidden="true" className="mr-1" />
                  Mastered
                </span>
              )}
              {visibleAttempt?.status === "graded" && visibleAttempt.mastered !== true && (
                <span className="type-caption inline-flex min-h-7 items-center rounded-[3px] border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 font-semibold text-amber-100">
                  Graded
                </span>
              )}
              {visibleAttempt?.status === "retryable" && (
                <span className="type-caption inline-flex min-h-7 items-center rounded-[3px] border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 font-semibold text-cyan-100">
                  Retry available
                </span>
              )}
            </div>

            {!gradingAvailable && gradingMessage ? (
              <div className="type-caption mt-space-3 rounded-[4px] border border-white/10 bg-[#081827] p-space-3 leading-5 text-slate-300">
                {gradingMessage}
              </div>
            ) : (
              <div className="mt-space-3 space-y-space-3">
                <label className="block" htmlFor={`linux-task-answer-${index}`}>
                  <span className="sr-only">Answer for task {index + 1}</span>
                  <textarea
                    id={`linux-task-answer-${index}`}
                    value={answer}
                    onChange={(event) => updateAnswer(event.target.value)}
                    disabled={!taskId || submissionState === "submitting"}
                    maxLength={maxAnswerLength}
                    rows={5}
                    className="type-body min-h-32 w-full resize-y rounded-[4px] border border-cyan-100/15 bg-[#081827] px-3 py-3 leading-6 text-white outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:bg-[#071426] disabled:text-slate-500"
                    placeholder="Write your evidence-backed findings for this task."
                  />
                </label>

                <div className="flex flex-col gap-space-3 sm:flex-row sm:items-center sm:justify-between">
                  <p
                    className={`type-caption ${
                      charactersRemaining < 500 ? "text-amber-200" : "text-slate-400"
                    }`}
                  >
                    {charactersRemaining.toLocaleString()} characters remaining
                  </p>
                  <Button
                    onClick={submitForGrading}
                    loading={submissionState === "submitting"}
                    loadingText="Submitting…"
                    disabled={!taskId || !answer.trim() || submissionState === "submitting"}
                    className="w-full border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white sm:w-auto"
                    leadingIcon={<FileCheck2 size={16} aria-hidden="true" />}
                  >
                    Submit for grading
                  </Button>
                </div>

                {gradingError && (
                  <div
                    role={submissionState === "retryable" ? "status" : "alert"}
                    className={`type-caption rounded-[3px] border p-space-3 leading-5 ${
                      submissionState === "retryable"
                        ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
                        : "border-red-300/25 bg-red-950/25 text-red-100"
                    }`}
                  >
                    {gradingError}
                  </div>
                )}

                {visibleAttempt && <SafeFeedback attempt={visibleAttempt} />}
              </div>
            )}
          </section>}
      </div>
      <AiContentSharingConsentDialog
        open={consentOpen}
        feature="linux_grading"
        onCancel={() => setConsentOpen(false)}
        onConfirm={confirmGradingConsent}
        isSubmitting={consentSubmitting}
      />
    </motion.div>
  );
}

function SafeFeedback({ attempt }: { attempt: GradingAttempt }) {
  const feedback = attempt.feedback;
  const sections = [
    ["Missing areas", feedback?.missingComponents],
    ["Evidence guidance", feedback?.evidenceIssues],
    ["Reasoning guidance", feedback?.reasoningIssues],
    ["Uncertainty guidance", feedback?.uncertaintyIssues],
    ["Remediation guidance", feedback?.remediationIssues],
    ["Boundary guidance", feedback?.boundaryIssues],
  ].filter(([, items]) => Array.isArray(items) && items.length > 0) as Array<[string, string[]]>;

  return (
    <div className="rounded-[4px] border border-cyan-100/12 bg-[#081827] p-space-4" aria-live="polite">
      <div className="flex flex-col gap-space-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="type-body font-semibold text-white">
            {attempt.status === "graded"
              ? attempt.mastered
                ? "Mastery feedback"
                : "Grading feedback"
              : "Retryable grading issue"}
          </p>
          {feedback?.summary && (
            <p className="type-body mt-space-1 whitespace-pre-wrap break-words leading-6 text-slate-300">
              {feedback.summary}
            </p>
          )}
        </div>
        {typeof attempt.score === "number" && typeof attempt.maximumPoints === "number" && (
          <span className="type-caption inline-flex min-h-7 shrink-0 items-center rounded-[3px] border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-1 font-semibold text-cyan-100">
            {attempt.score}/{attempt.maximumPoints}
          </span>
        )}
      </div>

      {sections.length > 0 && (
        <div className="mt-space-4 grid gap-space-3 md:grid-cols-2">
          {sections.map(([title, items]) => (
            <div key={title} className="rounded-[4px] border border-white/10 bg-[#071426] p-space-3">
              <p className="type-caption font-semibold text-slate-100">{title}</p>
              <ul className="mt-space-2 space-y-2">
                {items.map((item, itemIndex) => (
                  <li key={`${title}-${itemIndex}`} className="type-caption break-words leading-5 text-slate-300">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function displayEvidenceName(value: string) {
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) || value;
}

function parseStructuredTask(task: string): StructuredTask | null {
  try {
    const parsed = JSON.parse(task);

    if (
      typeof parsed?.phase !== "string" ||
      typeof parsed?.title !== "string" ||
      !Array.isArray(parsed?.evidence) ||
      typeof parsed?.deliverable !== "string"
    ) {
      return null;
    }

    return {
      phase: parsed.phase,
      title: parsed.title,
      evidence: parsed.evidence.map(String).filter(Boolean),
      deliverable: parsed.deliverable,
    };
  } catch {
    return null;
  }
}

function LoadingShimmer() {
  return (
    <div className="space-y-space-3" role="status" aria-label="Loading AI guidance">
      <div className="h-3 w-3/4 animate-pulse rounded-[3px] bg-cyan-300/15 motion-reduce:animate-none" />
      <div className="h-3 w-full animate-pulse rounded-[3px] bg-cyan-100/10 motion-reduce:animate-none" />
      <div className="h-3 w-2/3 animate-pulse rounded-[3px] bg-cyan-100/10 motion-reduce:animate-none" />
    </div>
  );
}

function cleanCommandText(text: string) {
  return text
    .replace(/```bash/gi, "")
    .replace(/```sh/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseQuiz(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const options = lines.filter((line) => /^[A-D][).]/i.test(line));

  const questionLine = lines.find((line) =>
    line.toLowerCase().startsWith("question:")
  );

  const correctLine = lines.find((line) =>
    line.toLowerCase().startsWith("correct answer:")
  );

  const explanationLine = lines.find((line) =>
    line.toLowerCase().startsWith("explanation:")
  );

  if (options.length < 4 || !correctLine) return null;

  const correctMatch = correctLine.match(/^correct answer:\s*([A-D])/i);

  return {
    question:
      questionLine?.replace(/^question:\s*/i, "").trim() ||
      "Choose the correct answer.",
    options: options.map((option) =>
      option.replace(/^([A-D])[).]\s*/i, "$1) ")
    ),
    correct: correctMatch?.[1]?.toUpperCase() || "",
    explanation:
      explanationLine?.replace(/^explanation:\s*/i, "").trim() || "",
  };
}
