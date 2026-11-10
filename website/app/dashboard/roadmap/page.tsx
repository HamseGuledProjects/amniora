"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  Globe,
  Lock,
  Map,
  Network,
  RotateCcw,
  Server,
  Shield,
  Target,
  Terminal,
  Trophy,
  X,
} from "lucide-react";
import { createClient } from "../../../lib/supabase/client";
import { createNotification } from "../../lib/createNotification";
import { RoadmapSkeleton } from "@/app/components/ui/Skeleton";
import ErrorState from "@/app/components/ui/ErrorState";
import Badge from "@/app/components/ui/Badge";
import Button from "@/app/components/ui/Button";
import PageHeader from "@/app/components/ui/PageHeader";

type RoadmapItem = {
  progress_id: number;
  module_id: number;
  title: string;
  description: string;
  difficulty: string;
  xp_reward: number;
  display_order: number;
  completed: boolean;
};

type RoadmapQueryRow = {
  id: number;
  completed: boolean;
  module_id: number;
  roadmap_modules:
    | {
        title: string;
        description: string;
        difficulty: string;
        display_order: number;
        xp_reward: number;
      }
    | {
        title: string;
        description: string;
        difficulty: string;
        display_order: number;
        xp_reward: number;
      }[]
    | null;
};

function getIcon(title: string) {
  const lower = title.toLowerCase();

  if (lower.includes("linux")) return <Terminal size={19} />;
  if (lower.includes("network")) return <Network size={19} />;
  if (lower.includes("web")) return <Globe size={19} />;
  if (lower.includes("cloud")) return <Server size={19} />;
  if (lower.includes("active") || lower.includes("security"))
    return <Shield size={19} />;

  return <Lock size={19} />;
}

export default function RoadmapPage() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadRoadmap() {
    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        setError(
          "Amniora could not load this data right now. Please try again in a moment."
        );
        return;
      }

      if (!user) {
        setError("You need to be signed in to view your roadmap.");
        return;
      }

      const { data, error: roadmapError } = await supabase
        .from("roadmap_progress")
        .select(
          `
          id,
          completed,
          module_id,
          roadmap_modules (
            id,
            title,
            description,
            difficulty,
            display_order,
            xp_reward
          )
        `
        )
        .eq("user_id", user.id);

      if (roadmapError) {
        setError(
          "Amniora could not load this data right now. Please try again in a moment."
        );
        return;
      }

      if (data) {
        const formatted = (data as RoadmapQueryRow[])
          .map((row) => {
            const roadmapModule = Array.isArray(row.roadmap_modules)
              ? row.roadmap_modules[0]
              : row.roadmap_modules;

            if (!roadmapModule) return null;

            return {
              progress_id: row.id,
              module_id: row.module_id,
              title: roadmapModule.title,
              description: roadmapModule.description,
              difficulty: roadmapModule.difficulty,
              display_order: roadmapModule.display_order,
              xp_reward: roadmapModule.xp_reward,
              completed: row.completed,
            } as RoadmapItem;
          })
          .filter((item): item is RoadmapItem => item !== null)
          .sort((a, b) => a.display_order - b.display_order);

        setItems(formatted);
      }
    } catch {
      setError(
        "Amniora could not load this data right now. Please try again in a moment."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial client-side roadmap data load.
    loadRoadmap();
  }, []);

  async function resetRoadmap() {
    setResetting(true);
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.rpc("reset_my_roadmap");

    setResetting(false);

    if (error) {
      setMessage(
        "Amniora could not reset your roadmap right now. Please try again in a moment."
      );
      return;
    }

    setItems((current) =>
      current.map((item) => ({
        ...item,
        completed: false,
      }))
    );
    setResetOpen(false);
    setMessage("Roadmap, XP, level, and achievements reset successfully.");
    setTimeout(() => setMessage(""), 3000);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await createNotification({
        userId: user.id,
        title: "Roadmap reset",
        message: "Your roadmap progress, XP, level, and achievements were reset.",
        type: "roadmap",
      });
    }
  }

  const completedCount = items.filter((item) => item.completed).length;
  const progress =
    items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;
  const currentItem = items.find((item) => !item.completed) || null;

  if (loading) {
    return <RoadmapSkeleton />;
  }

  if (error) {
    return (
      <ErrorState
        title="Unable to load roadmap"
        message={error}
        onRetry={loadRoadmap}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-space-6"
      data-roadmap-phase="ordered-learning-path"
    >
      <PageHeader
        eyebrow="Learning Roadmap"
        title="Your cybersecurity learning plan"
        description="Follow an ordered path from core fundamentals to practical, job-ready cybersecurity skills."
        className="[&_.type-label]:!text-cyan-200 [&_h1]:!text-white [&_p:not(.type-label)]:!text-slate-200"
      />

      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="status"
            aria-live="polite"
            className="rounded-[4px] border border-cyan-100/20 bg-cyan-300/10 p-space-4 text-cyan-100"
          >
            <p className="type-body">{message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {items.length === 0 ? (
        <RoadmapEmpty />
      ) : (
        <>
          <RoadmapOverview
            progress={progress}
            completedCount={completedCount}
            totalCount={items.length}
            currentItem={currentItem}
          />

          <div className="grid items-start gap-space-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <RoadmapTimeline items={items} currentItem={currentItem} />
            <RoadmapSidebar
              items={items}
              currentItem={currentItem}
              completedCount={completedCount}
              onReset={() => setResetOpen(true)}
            />
          </div>
        </>
      )}

      <AnimatePresence>
        {resetOpen && (
          <ResetDialog
            resetting={resetting}
            onCancel={() => setResetOpen(false)}
            onConfirm={resetRoadmap}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function RoadmapOverview({
  progress,
  completedCount,
  totalCount,
  currentItem,
}: {
  progress: number;
  completedCount: number;
  totalCount: number;
  currentItem: RoadmapItem | null;
}) {
  const metrics = [
    { label: "Overall progress", value: `${progress}%`, icon: <Trophy size={18} /> },
    {
      label: "Current stage",
      value: currentItem?.title || "Roadmap complete",
      icon: <Target size={18} />,
    },
    { label: "Total modules", value: totalCount, icon: <Map size={18} /> },
    {
      label: "Completed modules",
      value: completedCount,
      icon: <CheckCircle2 size={18} />,
    },
  ];

  return (
    <section aria-labelledby="roadmap-overview-title">
      <h2 id="roadmap-overview-title" className="sr-only">
        Roadmap overview
      </h2>
      <div className="overflow-hidden rounded-[4px] border border-white/10 bg-[#071426] shadow-sm shadow-black/10">
        <div className="grid min-w-0 divide-y divide-white/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0 px-space-4 py-space-4">
              <div className="flex items-center gap-space-2 text-cyan-200">
                <span aria-hidden="true" className="shrink-0">
                  {metric.icon}
                </span>
                <p className="type-label min-w-0 text-slate-200">{metric.label}</p>
              </div>
              <p className="mt-space-2 min-w-0 break-words font-mono text-xl font-semibold tracking-normal text-white sm:text-2xl">
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        <div className="border-t border-white/10 bg-[#061222] px-space-4 py-space-4">
          <div className="flex flex-col gap-space-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
            <p className="type-body font-semibold text-white">
              Amniora learning path
            </p>
            <p className="type-caption mt-space-1 text-slate-200">
              Follow the current sequence of assigned modules.
            </p>
          </div>
          <span className="type-caption shrink-0 text-slate-200">
            {completedCount} of {totalCount} completed
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Overall roadmap progress"
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuenow={completedCount}
          aria-valuetext={`${completedCount} of ${totalCount} modules completed`}
          className="mt-space-3 h-2 overflow-hidden rounded-ui-pill bg-white/10"
        >
          <div
            style={{ width: `${progress}%` }}
            className="h-full rounded-ui-pill bg-primary transition-[width] duration-500 motion-reduce:transition-none"
          />
        </div>
        </div>
      </div>
    </section>
  );
}

function RoadmapTimeline({
  items,
  currentItem,
}: {
  items: RoadmapItem[];
  currentItem: RoadmapItem | null;
}) {
  return (
    <section className="overflow-hidden rounded-[4px] border border-white/10 bg-[#071426] shadow-sm shadow-black/10">
      <div className="border-b border-white/10 bg-[#061222] p-space-5">
        <p className="type-label text-cyan-200">Structured progression</p>
        <h2 className="type-section-title mt-space-1 text-white">
          Roadmap Timeline
        </h2>
      </div>

      <ol className="p-space-5">
        {items.map((item, index) => {
          const isCurrent = currentItem?.progress_id === item.progress_id;
          return (
            <motion.li
              key={item.progress_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="relative flex gap-space-4 pb-space-5 last:pb-0"
            >
              {index < items.length - 1 && (
                <div
                  aria-hidden="true"
                  className={`absolute left-[17px] top-9 h-[calc(100%-1rem)] w-px ${
                    item.completed ? "bg-success" : "bg-border-strong"
                  }`}
                />
              )}
              <div
                className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-ui-pill border ${
                  item.completed
                    ? "border-success bg-success-subtle text-success"
                    : isCurrent
                      ? "border-cyan-200 bg-cyan-300 text-slate-950"
                      : "border-white/15 bg-white/[0.035] text-slate-300"
                }`}
              >
                {item.completed ? (
                  <CheckCircle2 size={17} aria-hidden="true" />
                ) : isCurrent ? (
                  <Flag size={16} aria-hidden="true" />
                ) : (
                  <span className="type-caption font-semibold">{index + 1}</span>
                )}
              </div>

              <div
                className={`min-w-0 flex-1 rounded-[4px] border p-space-4 ${
                  isCurrent
                    ? "border-cyan-200/35 bg-cyan-300/10"
                    : "border-white/10 bg-white/[0.035]"
                }`}
              >
                <div className="flex flex-col gap-space-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-space-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-white/10 bg-[#061222] text-slate-200">
                      <span aria-hidden="true">{getIcon(item.title)}</span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="type-body break-words font-semibold text-white">
                        {item.title}
                      </h3>
                      <div className="mt-space-2 flex flex-wrap gap-space-2">
                        <Badge variant="neutral">{item.difficulty}</Badge>
                        <Badge variant="primary">{item.xp_reward} XP</Badge>
                      </div>
                    </div>
                  </div>
                  <Badge
                    variant={
                      item.completed
                        ? "success"
                        : isCurrent
                          ? "primary"
                          : "neutral"
                    }
                    className="w-fit shrink-0"
                  >
                    {item.completed
                      ? "Completed"
                      : isCurrent
                        ? "Current"
                        : "Not Started"}
                  </Badge>
                </div>
                <p className="type-body mt-space-3 break-words leading-7 text-slate-200">
                  {item.description}
                </p>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}

function RoadmapSidebar({
  items,
  currentItem,
  completedCount,
  onReset,
}: {
  items: RoadmapItem[];
  currentItem: RoadmapItem | null;
  completedCount: number;
  onReset: () => void;
}) {
  const availableXp = items.reduce((total, item) => total + item.xp_reward, 0);

  return (
    <aside className="space-y-space-4 lg:sticky lg:top-24">
      <section className="rounded-[4px] border border-white/10 bg-[#071426] p-space-5 shadow-sm shadow-black/10">
        <p className="type-label text-cyan-200">Current focus</p>
        {currentItem ? (
          <>
            <h2 className="type-body mt-space-2 break-words font-semibold text-white">
              {currentItem.title}
            </h2>
            <p className="type-caption mt-space-2 line-clamp-3 text-slate-200">
              {currentItem.description}
            </p>
            <div className="mt-space-3 flex flex-wrap gap-space-2">
              <Badge variant="neutral">{currentItem.difficulty}</Badge>
              <Badge variant="primary">{currentItem.xp_reward} XP</Badge>
            </div>
          </>
        ) : (
          <div className="mt-space-3 flex items-center gap-space-2 text-success">
            <CheckCircle2 size={17} aria-hidden="true" />
            <p className="type-body font-semibold">All modules completed</p>
          </div>
        )}
      </section>

      <section className="rounded-[4px] border border-white/10 bg-[#071426] p-space-5 shadow-sm shadow-black/10">
        <h2 className="type-body font-semibold text-white">Roadmap Statistics</h2>
        <dl className="mt-space-4 divide-y divide-white/10">
          <SidebarRow label="Completed" value={`${completedCount}/${items.length}`} />
          <SidebarRow label="Remaining" value={String(items.length - completedCount)} />
          <SidebarRow label="Available XP" value={`${availableXp} XP`} />
        </dl>
      </section>

      <section className="rounded-[4px] border border-white/10 bg-[#071426] p-space-5 shadow-sm shadow-black/10">
        <h2 className="type-body font-semibold text-white">
          Reset learning progress
        </h2>
        <p className="type-caption mt-space-2 text-slate-200">
          Reset your roadmap progress, XP, level, and achievements. Your saved
          investigations will remain in your account.
        </p>
        <Button
          variant="outline"
          className="mt-space-4 w-full border-red-300/30 text-red-100 hover:border-red-300/45 hover:bg-red-400/10 hover:text-red-50"
          onClick={onReset}
          leadingIcon={<RotateCcw size={16} aria-hidden="true" />}
        >
          Reset Roadmap
        </Button>
      </section>
    </aside>
  );
}

function SidebarRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-space-3 py-space-3 first:pt-0 last:pb-0">
      <dt className="type-caption text-slate-300">{label}</dt>
      <dd className="type-caption font-semibold text-white">{value}</dd>
    </div>
  );
}

function RoadmapEmpty() {
  return (
    <section className="flex min-h-72 flex-col items-center justify-center rounded-[4px] border border-dashed border-white/15 bg-[#071426] p-space-5 text-center shadow-sm shadow-black/10">
      <div className="flex h-12 w-12 items-center justify-center rounded-[3px] border border-cyan-100/15 bg-cyan-300/10 text-cyan-200">
        <Map size={22} aria-hidden="true" />
      </div>
      <h2 className="type-section-title mt-space-4 text-white">
        No roadmap modules available
      </h2>
      <p className="type-body mt-space-2 max-w-md text-slate-200">
        Your learning roadmap will appear here when modules have been assigned
        to your account.
      </p>
    </section>
  );
}

function ResetDialog({
  resetting,
  onCancel,
  onConfirm,
}: {
  resetting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 16 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-roadmap-title"
        aria-describedby="reset-roadmap-description"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[4px] border border-white/10 bg-[#071426] p-space-5 text-white shadow-modal"
      >
        <div className="flex items-start justify-between gap-space-3">
          <div className="flex min-w-0 items-start gap-space-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] border border-red-300/25 bg-red-400/10 text-red-100">
              <AlertTriangle size={19} aria-hidden="true" />
            </div>
            <div>
              <h2 id="reset-roadmap-title" className="type-section-title text-white">
                Reset roadmap?
              </h2>
              <p
                id="reset-roadmap-description"
                className="type-body mt-space-1 text-slate-200"
              >
                This will reset your roadmap progress, XP, level, and
                achievements. Your saved investigations will not be deleted.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close reset confirmation"
            className="rounded-[3px] p-1.5 text-slate-400 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-space-5 rounded-[3px] border border-red-300/25 bg-red-400/10 p-space-4">
          <p className="type-caption text-red-100">
            Completed modules will return to:
          </p>
          <p className="type-body mt-space-1 font-semibold text-red-50">
            Not Started
          </p>
        </div>

        <div className="mt-space-5 flex flex-col-reverse gap-space-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            loading={resetting}
            loadingText="Resetting..."
            leadingIcon={<RotateCcw size={16} aria-hidden="true" />}
          >
            Reset roadmap
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
