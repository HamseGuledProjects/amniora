"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Download,
  FileText,
  FolderOpen,
  Lightbulb,
  ListChecks,
  Target,
  Trophy,
} from "lucide-react";
import { createClient } from "../../../../lib/supabase/client";
import { checkAchievements } from "../../../lib/checkAchievements";
import { LabDetailSkeleton } from "@/app/components/ui/Skeleton";
import Button from "@/app/components/ui/Button";
import { EarlyAccessInvestigationBanner } from "@/components/layout/EarlyAccessInvestigationBanner";
import TaskCard from "./TaskCard";
import SectionCard from "./SavedInvestigationSection";
import SavedLabLocalRunner from "./SavedLabLocalRunner";
import SavedLabLocalRunnerPreview from "./SavedLabLocalRunnerPreview";
import SavedLabHints from "./SavedLabHints";
import LabFeedbackCard from "./LabFeedbackCard";
import { PORTFOLIO_DEMO } from "@/lib/portfolio-demo/config";

type Lab = {
  id?: string;
  title: string;
  topic: string;
  difficulty: string;
  estimated_time: string;
  objective: string;
  scenario: string;
  tasks: string[];
  hints: string[];
  outcomes: string[];
  completed: boolean;
};

type LabAsset = {
  id: string;
  file_name: string;
  file_type: string;
  file_path: string;
  content: string;
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

type GradingTaskState = {
  index: number;
  taskId: string;
  latestAttempt?: GradingAttempt;
};

type TaskSummary = {
  phase?: string;
  title: string;
  description?: string;
  evidence: string[];
  deliverable?: string;
};

export default function LabPage() {
  const { id } = useParams();
  const [lab, setLab] = useState<Lab | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isPro, setIsPro] = useState(false);
  const [assets, setAssets] = useState<LabAsset[]>([]);
  const [gradingTasks, setGradingTasks] = useState<GradingTaskState[]>([]);
  const [gradingAvailable, setGradingAvailable] = useState(false);
  const [manualCompletionLocked, setManualCompletionLocked] = useState(false);
  const [gradingStatusLoading, setGradingStatusLoading] = useState(false);
  const [gradingMessage, setGradingMessage] = useState("");
  const [maxAnswerLength, setMaxAnswerLength] = useState(12000);
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
  const [isExecutableWebLab, setIsExecutableWebLab] = useState(false);
  const hasUserSelectedTask = useRef(false);

  const taskSummaries = useMemo(
    () => lab?.tasks.map((task, index) => parseTaskSummary(task, index)) || [],
    [lab?.tasks]
  );

  const safeSelectedTaskIndex = lab?.tasks.length
    ? Math.min(selectedTaskIndex, lab.tasks.length - 1)
    : 0;
  const activeTask = lab?.tasks[safeSelectedTaskIndex];
  const activeGradingTask = gradingTasks[safeSelectedTaskIndex];

  useEffect(() => {
    async function loadLab() {
      setLoading(true);
      setError("");

      try {
        const supabase = createClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          setError("You need to be signed in to view this lab.");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("plan")
          .eq("id", user.id)
          .single();

        setIsPro(profile?.plan === "pro");

        const { data, error: labError } = await supabase
          .from("labs")
          .select("*")
          .eq("id", id)
          .eq("user_id", user.id)
          .single();

        if (labError) {
          setError(
            "Amniora could not load this data right now. Please try again in a moment."
          );
          return;
        }

        if (!data) {
          setError("This lab could not be found.");
          return;
        }

        setLab(data);
        const { data: assetData } = await supabase
          .from("lab_assets")
          .select("id, file_name, file_type, file_path, content")
          .eq("lab_id", id)
          .eq("user_id", user.id)
          .order("file_path", { ascending: true });

        setAssets(assetData || []);

        if (data.topic === "Linux") {
          await refreshGradingStatus(String(data.id || id), Boolean(data.completed));
        }
      } catch {
        setError(
          "Amniora could not load this data right now. Please try again in a moment."
        );
      } finally {
        setLoading(false);
      }
    }

    loadLab();
  // The loader intentionally reruns only when the Saved Lab identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function refreshGradingStatus(labId = String(id || ""), completedFallback = lab?.completed || false) {
    if (!labId) return;
    setGradingStatusLoading(true);
    try {
      const res = await fetch(`/api/ai/linux-grading?labId=${encodeURIComponent(labId)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const data = await res.json();
      setMaxAnswerLength(Number(data.maxAnswerLength) || 12000);
      if (!res.ok || !data.available) {
        setGradingAvailable(false);
        setManualCompletionLocked(PORTFOLIO_DEMO ? false : data.code !== "LINUX_GRADING_PROVENANCE_MISSING");
        setGradingMessage(data.message || data.error || "AI grading is unavailable for this lab.");
        return;
      }
      setGradingAvailable(true);
      setManualCompletionLocked(true);
      setGradingMessage("");
      const gradingTasks: GradingTaskState[] = Array.isArray(data.tasks) ? data.tasks : [];
      setGradingTasks(gradingTasks);
      if (!hasUserSelectedTask.current) {
        const firstIncomplete = gradingTasks.find((task) => !task.latestAttempt?.mastered);
        setSelectedTaskIndex(firstIncomplete?.index ?? 0);
      }
      if (data.allTasksMastered && !completedFallback) {
        setLab((current) => current ? { ...current, completed: true } : current);
      }
    } catch {
      setGradingAvailable(false);
      setManualCompletionLocked(true);
      setGradingMessage("AI grading status could not be loaded. You can still review the evidence manually.");
    } finally {
      setGradingStatusLoading(false);
    }
  }

  async function toggleCompleted() {
    if (!lab) return;

    setSaving(true);
    setMessage("");

    const newCompletedStatus = !lab.completed;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaving(false);
      setMessage("You need to be signed in to update this lab.");
      return;
    }

    const { error } = await supabase
      .from("labs")
      .update({ completed: newCompletedStatus })
      .eq("id", id)
      .eq("user_id", user.id);

    setSaving(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setLab({ ...lab, completed: newCompletedStatus });

    if (newCompletedStatus) {
      await checkAchievements(user.id, ["lab_completed", "xp_gained"]);
    }

    setMessage(
      newCompletedStatus
        ? "Lab marked as completed."
        : "Lab marked as in progress."
    );
    setTimeout(() => setMessage(""), 2500);
  }

  function downloadAsset(asset: LabAsset) {
    const blob = new Blob([asset.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = asset.file_name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadEvidencePack() {
    window.location.href = `/api/labs/${id}/download`;
  }

  function downloadInvestigationPdf() {
    window.location.href = `/api/labs/${id}/download?format=pdf`;
  }

  if (loading) {
    return <LabDetailSkeleton />;
  }

  if (error) {
    return (
      <SavedInvestigationErrorState
        title="Unable to load lab"
        message={error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!lab) {
    return (
      <SavedInvestigationErrorState
        title="Lab not found"
        message="This saved lab could not be found."
        eyebrow="Missing investigation"
        secondaryHref="/dashboard/saved"
        secondaryLabel="Back to saved labs"
      />
    );
  }

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-space-5 bg-[#0c1828] pb-space-6 text-white print:hidden"
      data-saved-investigation-page="dark-continuous"
      data-saved-investigation-screen
    >
      <nav aria-label="Saved investigation navigation" className="px-space-4 sm:px-space-5">
        <Link
          href="/dashboard/saved"
          className="type-button inline-flex min-h-10 items-center gap-space-2 rounded-[4px] text-cyan-100/80 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1828]"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to Saved Investigations
        </Link>
      </nav>

      <EarlyAccessInvestigationBanner />

      <InvestigationIdentityHeader
        lab={lab}
        assetCount={assets.length}
        isExecutableWebLab={isExecutableWebLab}
        onDownload={downloadEvidencePack}
        onDownloadPdf={downloadInvestigationPdf}
      />

      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="status"
            className="flex items-center gap-space-3 rounded-[3px] border border-cyan-300/20 bg-[#071426] p-space-4 text-cyan-100"
          >
            <Circle size={18} aria-hidden="true" className="shrink-0" />
            <p className="type-body">{message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid items-start gap-space-5">
        <main className="min-w-0 space-y-space-5">
          <InvestigationOverview
            objective={lab.objective}
            scenario={lab.scenario}
          />

          {process.env.NODE_ENV === "development" ? (
            <Suspense fallback={null}>
              <SavedLabLocalRunnerPreview key={String(id)} savedLabId={String(id)} topic={lab.topic} onExecutableChange={setIsExecutableWebLab} />
            </Suspense>
          ) : <SavedLabLocalRunner key={String(id)} savedLabId={String(id)} topic={lab.topic} onExecutableChange={setIsExecutableWebLab} />}

          <SectionCard
            step={isExecutableWebLab ? "03" : "02"}
            icon={<ListChecks size={19} />}
            eyebrow="Task focus"
            title={`Investigation Tasks (${lab.tasks.length})`}
          >
            {lab.tasks.length === 0 ? (
              <div className="rounded-[3px] border border-dashed border-cyan-100/15 bg-[#061222] p-space-5 text-center">
                <p className="type-body font-semibold text-slate-100">
                  No investigation tasks were saved for this lab.
                </p>
              </div>
            ) : (
              <div
                data-saved-investigation-task-workspace="selected"
                className="grid min-w-0 gap-space-4 lg:grid-cols-[minmax(12rem,24%)_minmax(0,1fr)] xl:grid-cols-[minmax(14rem,26%)_minmax(0,1fr)]"
              >
                <TaskRail
                  tasks={taskSummaries}
                  gradingTasks={gradingTasks}
                  selectedIndex={safeSelectedTaskIndex}
                  gradingAvailable={gradingAvailable}
                  onSelect={(index) => {
                    hasUserSelectedTask.current = true;
                    setSelectedTaskIndex(index);
                  }}
                />
                <div data-saved-investigation-active-task="true" className="min-w-0">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={safeSelectedTaskIndex}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18 }}
                      className="min-w-0 motion-reduce:transform-none"
                    >
                      {activeTask ? (
                <TaskCard
                  key={safeSelectedTaskIndex}
                  labId={String(id)}
                  task={activeTask}
                  taskId={activeGradingTask?.taskId}
                  gradingAttempt={activeGradingTask?.latestAttempt}
                  index={safeSelectedTaskIndex}
                  isPro={isPro}
                  objective={lab.objective}
                  scenario={lab.scenario}
                  difficulty={lab.difficulty}
                  gradingEnabled={lab.topic === "Linux"}
                  gradingAvailable={gradingAvailable}
                  gradingMessage={gradingMessage}
                  maxAnswerLength={maxAnswerLength}
                  onGraded={() => refreshGradingStatus(String(id), lab.completed)}
                />
                      ) : null}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            )}
          </SectionCard>

          {(!isExecutableWebLab || assets.length > 0) && (
            <EvidenceLibrary assets={assets} onDownload={downloadAsset} step={isExecutableWebLab ? undefined : "03"} />
          )}

          <div className="grid gap-space-6 lg:grid-cols-2">
            {lab.hints.length > 0 && (
            <SectionCard
              step="04"
              icon={<Lightbulb size={19} />}
              eyebrow="Reference"
              title="Hints"
            >
              <SavedLabHints hints={lab.hints} />
            </SectionCard>
            )}

            {lab.outcomes.length > 0 && (
            <SectionCard
              step="05"
              icon={<Trophy size={19} />}
              eyebrow="Development"
              title="Learning Outcomes"
            >
              <ul className="space-y-space-3">
                {lab.outcomes.map((outcome, index) => (
                  <li
                    key={index}
                    className="flex gap-space-3 type-body text-slate-200"
                  >
                    <CheckCircle2
                      size={16}
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-success"
                    />
                    <span className="break-words">{outcome}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
            )}
          </div>

          <InvestigationCompletionPanel
            lab={lab}
            saving={saving}
            manualCompletionLocked={lab.topic === "Linux" && (gradingStatusLoading || manualCompletionLocked)}
            onToggleCompleted={toggleCompleted}
          />
        </main>
      </div>

      <LabFeedbackCard labId={String(id)} />
    </motion.div>
    <SavedInvestigationPrintDocument lab={lab} assets={assets} tasks={taskSummaries} />
    </>
  );
}

function SavedInvestigationErrorState({
  title,
  message,
  onRetry,
  secondaryHref = "/dashboard/saved",
  secondaryLabel = "Back to saved labs",
  eyebrow = "Unable to load",
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  secondaryHref?: string;
  secondaryLabel?: string;
  eyebrow?: string;
}) {
  return (
    <section
      data-saved-investigation-error="dark"
      className="flex min-h-full items-center justify-center bg-[#0c1828] px-4 py-space-8 text-white sm:px-6"
      aria-labelledby="saved-investigation-error-title"
    >
      <div className="w-full max-w-xl rounded-[3px] border border-cyan-100/12 bg-[#071426] p-space-5 text-center shadow-[0_18px_42px_rgba(0,0,0,0.22)] sm:p-space-7">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-[3px] border border-amber-300/25 bg-amber-300/10 text-amber-100">
          <AlertTriangle size={20} aria-hidden="true" />
        </div>
        <p className="type-label mt-space-4 text-cyan-200/75">{eyebrow}</p>
        <h1 id="saved-investigation-error-title" className="mt-space-2 text-2xl font-semibold tracking-normal text-white sm:text-3xl">
          {title}
        </h1>
        <p className="type-body mx-auto mt-space-3 max-w-md leading-6 text-slate-200">
          {message}
        </p>
        <div className="mt-space-5 flex flex-col-reverse justify-center gap-space-2 sm:flex-row">
          {secondaryHref ? (
            <Link
              href={secondaryHref}
              className="type-button inline-flex min-h-10 items-center justify-center rounded-[4px] border border-cyan-100/15 bg-[#081827] px-4 text-slate-200 outline-none transition-colors hover:border-cyan-300/35 hover:bg-[#0b2033] hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200"
            >
              {secondaryLabel}
            </Link>
          ) : null}
          {onRetry ? (
            <Button
              onClick={onRetry}
              className="border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white"
            >
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function InvestigationIdentityHeader({
  lab,
  assetCount,
  isExecutableWebLab,
  onDownload,
  onDownloadPdf,
}: {
  lab: Lab;
  assetCount: number;
  isExecutableWebLab: boolean;
  onDownload: () => void;
  onDownloadPdf: () => void;
}) {
  const status = lab.completed ? "Completed" : "In Progress";
  const statusClass = lab.completed
    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
    : "border-amber-300/25 bg-amber-300/10 text-amber-100";

  return (
    <section
      data-saved-investigation-header="identity"
      className="overflow-hidden rounded-[4px] border border-white/10 bg-[#071426] text-white shadow-[0_18px_42px_rgba(0,0,0,0.22)]"
      aria-labelledby="saved-investigation-title"
    >
      <div className="grid min-w-0 gap-space-5 bg-[#061222] px-space-4 py-space-5 sm:px-space-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="type-metadata text-cyan-200/75">Saved Investigation</p>
          <h1
            id="saved-investigation-title"
            className="mt-space-2 max-w-4xl break-words text-2xl font-semibold leading-tight tracking-normal text-white sm:text-3xl"
          >
            {lab.title}
          </h1>

          <dl
            data-saved-investigation-header-metadata="true"
            className="mt-space-4 grid min-w-0 gap-space-2 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4"
          >
            <HeaderMetadata label="Category" value={lab.topic} />
            <HeaderMetadata label="Difficulty" value={lab.difficulty} />
            <HeaderMetadata label="Duration" value={lab.estimated_time} />
            <div className="min-w-0">
              <dt className="type-caption text-slate-400">Status</dt>
              <dd className="mt-1">
                <span
                  className={`inline-flex min-h-7 items-center gap-space-2 rounded-[3px] border px-2.5 py-1 text-xs font-semibold ${statusClass}`}
                >
                  {lab.completed ? (
                    <CheckCircle2 size={13} aria-hidden="true" />
                  ) : (
                    <Circle size={13} aria-hidden="true" />
                  )}
                  {status}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        <div
          data-saved-investigation-header-actions="exports"
          className="grid min-w-0 gap-space-2 sm:grid-cols-2 lg:min-w-[22rem]"
        >
          {!isExecutableWebLab || assetCount > 0 ? <Button
            variant="secondary"
            className="w-full justify-center border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white focus-visible:ring-cyan-200"
            onClick={onDownload}
            disabled={assetCount === 0}
            leadingIcon={<Download size={16} aria-hidden="true" />}
          >
            Evidence pack
          </Button> : null}
          <Button
            variant="outline"
            className="w-full justify-center border-cyan-100/15 bg-transparent text-slate-100 hover:border-cyan-200/35 hover:bg-[#0a1d2f] hover:text-white focus-visible:ring-cyan-200"
            onClick={onDownloadPdf}
            leadingIcon={<FileText size={16} aria-hidden="true" />}
          >
            Investigation PDF
          </Button>
        </div>
      </div>
    </section>
  );
}

function HeaderMetadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-l border-white/10 pl-space-3">
      <dt className="type-caption text-slate-400">{label}</dt>
      <dd className="mt-1 break-words font-medium text-slate-100">{value}</dd>
    </div>
  );
}

function TaskRail({
  tasks,
  gradingTasks,
  selectedIndex,
  gradingAvailable,
  onSelect,
}: {
  tasks: TaskSummary[];
  gradingTasks: GradingTaskState[];
  selectedIndex: number;
  gradingAvailable: boolean;
  onSelect: (index: number) => void;
}) {
  const selectedTask = tasks[selectedIndex];

  function moveSelection(nextIndex: number) {
    if (!tasks.length) return;
    const bounded = Math.max(0, Math.min(tasks.length - 1, nextIndex));
    onSelect(bounded);
  }

  return (
    <nav
      data-saved-investigation-task-rail="desktop"
      aria-label="Investigation task navigation"
      className="min-w-0"
    >
      <label
        htmlFor="saved-investigation-mobile-task-selector"
        className="type-caption mb-space-2 block font-semibold text-slate-100 lg:hidden"
      >
        Selected Task
      </label>
      <select
        id="saved-investigation-mobile-task-selector"
        data-saved-investigation-mobile-task-selector="true"
        className="mb-space-4 h-11 w-full min-w-0 rounded-[4px] border border-cyan-100/15 bg-[#081827] px-3 text-sm font-semibold text-white outline-none focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-300/20 lg:hidden"
        value={selectedIndex}
        onChange={(event) => onSelect(Number(event.target.value))}
        aria-label="Choose investigation task"
      >
        {tasks.map((task, index) => (
          <option key={`${index}-${task.title}`} value={index}>
            {`Task ${index + 1}: ${task.title}`}
          </option>
        ))}
      </select>

      <div
        data-saved-investigation-desktop-task-rail="true"
        className="hidden min-w-0 overflow-hidden rounded-[4px] border border-white/10 bg-[#061222] lg:block lg:sticky lg:top-24"
      >
        <div className="border-b border-white/10 px-space-3 py-space-3">
          <p className="type-metadata text-cyan-200/80">Tasks</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            {tasks.length} investigation {tasks.length === 1 ? "task" : "tasks"}
          </p>
        </div>
        <ol className="divide-y divide-white/10">
          {tasks.map((task, index) => {
            const status = taskRailStatus(gradingTasks[index], gradingAvailable);
            const selected = index === selectedIndex;
            return (
              <li key={`${index}-${task.title}`}>
                <button
                  type="button"
                  data-saved-investigation-task-rail-row="true"
                  aria-current={selected ? "step" : undefined}
                  onClick={() => onSelect(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveSelection(index + 1);
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveSelection(index - 1);
                    }
                  }}
                  className={`group grid w-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] gap-space-3 px-space-3 py-space-3 text-left outline-none transition-[background-color,border-color,color] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200 ${
                    selected
                      ? "border-l-2 border-cyan-300 bg-[#0b2033] text-white"
                      : "border-l-2 border-transparent text-slate-300 hover:bg-white/[0.035] hover:text-white"
                  }`}
                >
                  <span className="type-caption mt-0.5 tabular-nums text-cyan-200/70">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    {task.phase ? (
                      <span className="type-caption mb-1 block truncate text-slate-400">
                        {task.phase}
                      </span>
                    ) : null}
                    <span className="block break-words text-sm font-semibold leading-5">
                      {task.title}
                    </span>
                    <span className={`type-caption mt-1 inline-flex text-xs ${status.className}`}>
                      {status.label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {selectedTask ? (
        <p className="type-caption mb-space-3 text-slate-300 lg:hidden">
          Showing Task {selectedIndex + 1} of {tasks.length}:{" "}
          <span className="font-semibold text-slate-200">{selectedTask.title}</span>
        </p>
      ) : null}
    </nav>
  );
}

function taskRailStatus(task: GradingTaskState | undefined, gradingAvailable: boolean) {
  if (!gradingAvailable || !task?.taskId) {
    return { label: "Not graded", className: "text-slate-400" };
  }
  if (task.latestAttempt?.mastered) {
    return { label: "Mastered", className: "text-emerald-200" };
  }
  if (task.latestAttempt?.status === "graded") {
    return { label: "Needs revision", className: "text-amber-200" };
  }
  if (task.latestAttempt?.status === "retryable") {
    return { label: "Retry available", className: "text-cyan-200" };
  }
  return { label: "Not graded", className: "text-slate-400" };
}

function parseTaskSummary(task: string, index: number): TaskSummary {
  try {
    const parsed = JSON.parse(task);
    const title = typeof parsed?.title === "string" && parsed.title.trim()
      ? parsed.title.trim()
      : `Task ${index + 1}`;
    return {
      phase: typeof parsed?.phase === "string" ? parsed.phase.trim() : undefined,
      title,
      description: typeof parsed?.description === "string" ? parsed.description.trim() : undefined,
      evidence: Array.isArray(parsed?.evidence)
        ? parsed.evidence.filter((item: unknown) => typeof item === "string")
        : [],
      deliverable: typeof parsed?.deliverable === "string" ? parsed.deliverable.trim() : undefined,
    };
  } catch {
    const firstLine = task.split(/\r?\n/).find((line) => line.trim())?.trim();
    return {
      title: firstLine ? firstLine.slice(0, 96) : `Task ${index + 1}`,
      description: task,
      evidence: [],
    };
  }
}

function SavedInvestigationPrintDocument({
  lab,
  assets,
  tasks,
}: {
  lab: Lab;
  assets: LabAsset[];
  tasks: TaskSummary[];
}) {
  return (
    <article
      data-saved-investigation-print="complete"
      data-saved-investigation-print-task-count={tasks.length}
      className="hidden bg-white px-8 py-6 text-slate-950 print:block"
    >
      <header className="border-b border-slate-300 pb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">Amniora saved investigation</p>
        <h1 data-saved-investigation-print-title className="mt-2 break-words text-3xl font-bold leading-tight [overflow-wrap:anywhere]">{lab.title}</h1>
        <p className="mt-3 text-sm text-slate-700">
          {lab.topic} · {lab.difficulty} · {lab.estimated_time} · {lab.completed ? "Completed" : "In progress"}
        </p>
      </header>

      <section className="mt-6 break-inside-avoid-page">
        <h2 className="text-xl font-bold">Objective</h2>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{lab.objective}</p>
      </section>
      <section className="mt-6 break-inside-avoid-page">
        <h2 className="text-xl font-bold">Scenario</h2>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{lab.scenario}</p>
      </section>

      <section className="mt-7">
        <h2 className="text-xl font-bold">Investigation tasks ({tasks.length})</h2>
        <ol data-saved-investigation-print-task-list className="mt-4 space-y-5">
          {tasks.map((task, index) => (
            <li
              key={`${index}-${task.title}`}
              data-saved-investigation-print-task={index + 1}
              className="border-t border-slate-300 pt-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {task.phase || `Task ${index + 1}`}
              </p>
              <h3 className="mt-1 break-words text-lg font-bold">Task {index + 1}: {task.title}</h3>
              {task.description ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{task.description}</p> : null}
              {task.evidence.length > 0 ? (
                <div className="mt-3">
                  <h4 className="text-sm font-bold">Evidence</h4>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {task.evidence.map((path) => <li key={path} className="break-all">{path}</li>)}
                  </ul>
                </div>
              ) : null}
              {task.deliverable ? (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6"><strong>Deliverable:</strong> {task.deliverable}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-7 break-inside-avoid-page">
        <h2 className="text-xl font-bold">Learning outcomes</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
          {lab.outcomes.map((outcome, index) => <li key={index}>{outcome}</li>)}
        </ul>
      </section>
      <section data-saved-investigation-print-inventory className="mt-7">
        <h2 className="text-xl font-bold">Evidence inventory ({assets.length})</h2>
        <ul className="mt-2 list-disc pl-5 text-xs leading-5">
          {assets.map((asset) => <li key={asset.id} data-saved-investigation-print-inventory-item className="break-all [overflow-wrap:anywhere]">{asset.file_path}</li>)}
        </ul>
      </section>
    </article>
  );
}

function InvestigationOverview({
  objective,
  scenario,
}: {
  objective: string;
  scenario: string;
}) {
  return (
    <section
      data-saved-investigation-brief="dark"
      className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426] text-white"
      aria-labelledby="saved-investigation-brief-title"
    >
      <div className="flex items-center gap-space-3 border-b border-white/10 bg-[#061222] px-space-4 py-space-4 sm:px-space-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] border border-cyan-300/25 bg-cyan-300/10 text-xs font-bold tabular-nums text-cyan-100" aria-hidden="true">01</div>
        <div>
          <p className="type-label text-cyan-200/75">Investigation brief</p>
          <h2 id="saved-investigation-brief-title" className="type-section-title mt-space-1 text-white">Case Overview</h2>
        </div>
      </div>
      <div className="grid divide-y divide-white/10 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <div className="p-space-5">
          <div className="flex items-center gap-space-2 text-slate-300">
            <Target size={17} aria-hidden="true" />
            <h3 className="type-body font-semibold text-slate-100">Objective</h3>
          </div>
          <p className="type-body mt-space-3 whitespace-pre-wrap break-words leading-7 text-slate-200">
            {objective}
          </p>
        </div>
        <div className="p-space-5">
          <div className="flex items-center gap-space-2 text-slate-300">
            <FileText size={17} aria-hidden="true" />
            <h3 className="type-body font-semibold text-slate-100">Scenario</h3>
          </div>
          <p className="type-body mt-space-3 whitespace-pre-wrap break-words leading-7 text-slate-200">
            {scenario}
          </p>
        </div>
      </div>
    </section>
  );
}
function EvidenceLibrary({
  assets,
  onDownload,
  step = "03",
}: {
  assets: LabAsset[];
  onDownload: (asset: LabAsset) => void;
  step?: string;
}) {
  return (
    <SectionCard
      step={step}
      icon={<FolderOpen size={19} />}
      eyebrow="Forensic evidence"
      title={`Evidence Library (${assets.length})`}
    >
      {assets.length === 0 ? (
        <div className="rounded-[3px] border border-dashed border-cyan-100/15 bg-[#061222] p-space-5 text-center">
          <p className="type-body font-semibold text-slate-100">
            No assets found for this lab.
          </p>
        </div>
      ) : (
        <div
          data-saved-investigation-evidence-list="dark"
          className="divide-y divide-white/10 overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#061222]"
        >
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => onDownload(asset)}
              className="group grid w-full min-w-0 gap-space-3 px-space-4 py-space-3 text-left outline-none transition-[background-color,color] hover:bg-[#0b2033] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="flex min-w-0 items-center gap-space-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                  <FileText size={17} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="type-body break-all font-semibold text-slate-100">
                    {asset.file_name}
                  </p>
                  <p className="type-caption mt-1 break-all text-slate-300">
                    {asset.file_path}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-space-3 justify-self-start sm:justify-self-end">
                <span className="type-caption rounded-[3px] border border-cyan-100/15 bg-[#071426] px-2.5 py-1 font-semibold text-slate-300">
                  {asset.file_type}
                </span>
                <Download
                  size={16}
                  aria-hidden="true"
                  className="text-slate-400 group-hover:text-cyan-100"
                />
              </div>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function InvestigationCompletionPanel({
  lab,
  saving,
  manualCompletionLocked,
  onToggleCompleted,
}: {
  lab: Lab;
  saving: boolean;
  manualCompletionLocked: boolean;
  onToggleCompleted: () => void;
}) {
  return (
    <section
      data-investigation-completion-action="true"
      className="grid gap-space-4 rounded-[3px] border border-cyan-100/12 bg-[#071426] p-space-4 text-white sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      aria-labelledby="saved-investigation-completion-title"
    >
      <div className="min-w-0">
        <p className="type-label text-cyan-200/80">Completion</p>
        <h2 id="saved-investigation-completion-title" className="sr-only">
          Investigation completion
        </h2>
        <p className="type-caption mt-space-2 max-w-2xl leading-5 text-slate-300">
          Automatic assessment is unavailable in this local demo. Marking this example complete only changes your local sample progress.
        </p>
      </div>
      <Button
        className="w-full border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white sm:w-auto"
        variant={lab.completed ? "outline" : "primary"}
        onClick={onToggleCompleted}
        loading={saving}
        loadingText="Saving…"
        disabled={manualCompletionLocked}
        leadingIcon={
          lab.completed ? (
            <CheckCircle2 size={16} aria-hidden="true" />
          ) : (
            <Circle size={16} aria-hidden="true" />
          )
        }
      >
        {manualCompletionLocked
          ? "Loading sample progress"
          : lab.completed
          ? "Completed"
          : "Mark as completed"}
      </Button>
    </section>
  );
}
