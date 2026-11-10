"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Award,
  AlertCircle,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Circle,
  CircleDot,
  Cloud,
  Crown,
  Flame,
  FolderOpen,
  Gem,
  Globe,
  GraduationCap,
  Lock,
  Network,
  Shield,
  ShieldCheck,
  Skull,
  Terminal,
  TrendingUp,
  Trophy,
  Zap,
  RefreshCw,
} from "lucide-react";
import { ProgressSkeleton } from "@/app/components/ui/Skeleton";
import Badge from "@/app/components/ui/Badge";
import Button from "@/app/components/ui/Button";
import { createClient } from "../../../lib/supabase/client";
import { getNextXpGoal } from "../_lib/xp";

type Achievement = {
  id: number;
  name: string;
  description: string;
  icon: string;
  category: string;
  requirement_type: string;
  requirement_value: number;
  unlocked: boolean;
  unlocked_at: string | null;
};

type ProgressStat = {
  label: string;
  value: string;
  supporting: string;
};

const numberFormatter = new Intl.NumberFormat("en-GB");
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function normaliseAchievementCopy(value: string) {
  return value
    .replace(/\bCyberLab\b/g, "Amniora")
    .replace(/\bcyberlab\b/g, "Amniora")
    .replace(/\btraining labs\b/g, "investigations")
    .replace(/\btraining lab\b/g, "investigation")
    .replace(/\bLabs\b/g, "Investigations")
    .replace(/\blabs\b/g, "investigations")
    .replace(/\bLab\b/g, "Investigation")
    .replace(/\blab\b/g, "investigation");
}

function formatAchievementTitle(value: string) {
  return normaliseAchievementCopy(value);
}

function formatAchievementDescription(value: string) {
  return normaliseAchievementCopy(value);
}

function pluraliseInvestigation(value: number) {
  return value === 1 ? "investigation" : "investigations";
}

function formatAchievementRequirement(achievement: Achievement) {
  const requirementValue = Math.max(achievement.requirement_value || 0, 0);
  const requirementType = achievement.requirement_type.toLowerCase();
  const category = achievement.category.toLowerCase();

  if (
    requirementType.includes("labs_completed") ||
    requirementType.includes("labs_generated") ||
    category === "labs"
  ) {
    return `Complete ${formatNumber(requirementValue)} ${pluraliseInvestigation(requirementValue)}`;
  }

  if (requirementType.includes("xp") || category === "xp") {
    return `Earn ${formatNumber(requirementValue)} XP`;
  }

  if (category.includes("roadmap")) {
    return "Complete a roadmap milestone";
  }

  if (category.includes("ai")) {
    return "Use AI Tutor support";
  }

  if (category.includes("subscription")) {
    return "Reach an account milestone";
  }

  return "Complete the milestone requirement";
}

export default function ProgressPage() {
  const [stats, setStats] = useState({
    labsGenerated: 0,
    labsCompleted: 0,
    xp: 0,
    level: "Beginner",
    plan: "Free Plan",
  });
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadProgress() {
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
        setError("You need to be signed in to view your progress.");
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("xp, level, plan, labs_generated, labs_completed")
        .eq("id", user.id)
        .single();

      if (profileError) {
        setError(
          "Amniora could not load this data right now. Please try again in a moment."
        );
        return;
      }

      if (profileData) {
        setStats({
          labsGenerated: profileData.labs_generated || 0,
          labsCompleted: profileData.labs_completed || 0,
          xp: profileData.xp || 0,
          level: profileData.level || "Beginner",
          plan: profileData.plan || "Free Plan",
        });
      }

      const { data: achievementData, error: achievementError } = await supabase
        .from("achievements")
        .select(
          "id, name, description, icon, category, requirement_type, requirement_value"
        )
        .order("id", { ascending: true });

      if (achievementError) {
        setError(
          "Amniora could not load this data right now. Please try again in a moment."
        );
        return;
      }

      const { data: unlockedData, error: unlockedError } = await supabase
        .from("user_achievements")
        .select("achievement_id, unlocked_at")
        .eq("user_id", user.id);

      if (unlockedError) {
        setError(
          "Amniora could not load this data right now. Please try again in a moment."
        );
        return;
      }

      const unlockedMap = new Map(
        unlockedData?.map((item) => [item.achievement_id, item.unlocked_at]) ||
          []
      );

      if (achievementData) {
        const formatted = achievementData.map((achievement) => ({
          ...achievement,
          unlocked: unlockedMap.has(achievement.id),
          unlocked_at: unlockedMap.get(achievement.id) || null,
        }));

        setAchievements(formatted);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial client-side progress data load.
    loadProgress();
  }, []);

  const safeGenerated = Math.max(stats.labsGenerated, 0);
  const safeCompleted = Math.max(stats.labsCompleted, 0);
  const inProgress = Math.max(safeGenerated - safeCompleted, 0);
  const completionRate =
    safeGenerated > 0 ? Math.min(Math.round((safeCompleted / safeGenerated) * 100), 100) : 0;
  const xpGoal = getNextXpGoal(stats.xp);
  const xpProgress = Math.min(Math.round((stats.xp / xpGoal) * 100), 100);
  const unlockedCount = achievements.filter((item) => item.unlocked).length;
  const orderedAchievements = useMemo(
    () =>
      [...achievements].sort((a, b) => {
        if (a.unlocked && b.unlocked) {
          return Date.parse(b.unlocked_at || "") - Date.parse(a.unlocked_at || "");
        }
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        return a.id - b.id;
      }),
    [achievements]
  );

  if (loading) return <ProgressSkeleton />;

  if (error) {
    return (
      <ProgressErrorState
        message={error}
        onRetry={loadProgress}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mx-auto grid w-full min-w-0 max-w-[82rem] gap-space-7 text-white motion-reduce:transform-none sm:gap-space-8"
      data-progress-phase="dark-learning-record"
    >
      <ProgressHeader />

      <ProgressSummary
        level={stats.level}
        xp={stats.xp}
        completed={safeCompleted}
        unlockedCount={unlockedCount}
        achievementTotal={achievements.length}
      />

      <section className="grid min-w-0 gap-space-6 xl:grid-cols-[minmax(0,0.53fr)_minmax(0,0.47fr)]">
        <LevelProgressCard
          level={stats.level}
          xp={stats.xp}
          xpGoal={xpGoal}
          xpProgress={xpProgress}
        />
        <InvestigationProgressCard
          generated={safeGenerated}
          completed={safeCompleted}
          inProgress={inProgress}
          completionRate={completionRate}
        />
      </section>

      <AchievementCollection
        achievements={orderedAchievements}
        unlockedCount={unlockedCount}
      />

      <HistoricalActivityStatus />
    </motion.div>
  );
}

function ProgressErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="progress-error-title"
      data-progress-error="dark-learning-record"
      className="mx-auto flex min-h-[55vh] w-full max-w-[82rem] items-center justify-center px-0 py-space-8 text-white"
    >
      <div className="w-full max-w-xl rounded-[3px] border border-cyan-100/12 bg-[#071426] p-space-6 text-center shadow-[0_18px_42px_rgba(0,0,0,0.22)] sm:p-space-8">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[3px] border border-amber-300/25 bg-amber-300/[0.08] text-amber-200">
          <AlertCircle size={21} aria-hidden="true" />
        </div>
        <p className="mt-space-5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/80">
          Progress
        </p>
        <h1 id="progress-error-title" className="mt-space-2 text-2xl font-semibold tracking-normal text-white sm:text-3xl">
          Could Not Load Progress
        </h1>
        <p className="mx-auto mt-space-3 max-w-md text-sm leading-6 text-slate-300">
          {message}
        </p>
        <div className="mt-space-6 flex justify-center">
          <Button
            onClick={onRetry}
            className="border-cyan-300/25 bg-[#0b2033] text-cyan-100 hover:border-cyan-200/50 hover:bg-[#10304a] hover:text-white"
            leadingIcon={<RefreshCw size={16} aria-hidden="true" />}
          >
            Try Again
          </Button>
        </div>
      </div>
    </section>
  );
}

function ProgressHeader() {
  return (
    <header className="min-w-0 border-b border-white/[0.08] pb-space-6">
      <div className="min-w-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
          Progress
        </p>
        <h1 className="mt-space-2 max-w-3xl text-balance text-2xl font-semibold leading-tight tracking-normal text-white sm:text-3xl lg:text-[2.2rem]">
          Your learning record.
        </h1>
        <p className="mt-space-2 max-w-2xl text-sm leading-6 text-slate-300">
          Track investigation completion, XP, and milestones from one place.
        </p>
      </div>
    </header>
  );
}

function ProgressSummary({
  level,
  xp,
  completed,
  unlockedCount,
  achievementTotal,
}: {
  level: string;
  xp: number;
  completed: number;
  unlockedCount: number;
  achievementTotal: number;
}) {
  const metrics: ProgressStat[] = [
    {
      label: "Current Level",
      value: level,
      supporting: "Stored profile level",
    },
    {
      label: "Current XP",
      value: formatNumber(xp),
      supporting: "Aggregate experience",
    },
    {
      label: "Completed Investigations",
      value: formatNumber(completed),
      supporting: "Finished records",
    },
    {
      label: "Achievements",
      value: `${formatNumber(unlockedCount)} / ${formatNumber(achievementTotal)}`,
      supporting: "Unlocked milestones",
    },
  ];

  return (
    <section
      aria-labelledby="progress-summary-title"
      className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426] text-white"
    >
      <SectionHeading
        number="01 / Summary"
        label="Learning Record"
        title="Progress Summary"
        titleId="progress-summary-title"
      />
      <div className="grid min-w-0 grid-cols-2 border-t border-white/[0.08] sm:grid-cols-4">
        {metrics.map((metric) => (
          <SummaryMetric key={metric.label} metric={metric} />
        ))}
      </div>
    </section>
  );
}

function SummaryMetric({ metric }: { metric: ProgressStat }) {
  return (
    <div className="min-w-0 border-b border-r border-white/[0.08] p-space-4 last:border-r-0 even:border-r-0 sm:even:border-r sm:last:border-r-0 sm:[&:nth-child(n+3)]:border-b-0">
      <p className="type-caption uppercase tracking-[0.12em] text-slate-400">
        {metric.label}
      </p>
      <p className="mt-space-2 break-words text-xl font-semibold leading-tight text-white sm:text-2xl">
        {metric.value}
      </p>
      <p className="mt-space-1 text-xs leading-5 text-slate-400">
        {metric.supporting}
      </p>
    </div>
  );
}

function LevelProgressCard({
  level,
  xp,
  xpGoal,
  xpProgress,
}: {
  level: string;
  xp: number;
  xpGoal: number;
  xpProgress: number;
}) {
  return (
    <section
      aria-labelledby="progress-development-title"
      className="min-w-0 rounded-[3px] border border-cyan-100/12 bg-[#071426] p-space-5 text-white"
    >
      <SectionHeading
        number="02 / Development"
        label="Experience"
        title="Level And XP"
        titleId="progress-development-title"
        compact
      />

      <dl className="mt-space-5 grid min-w-0 gap-space-4 sm:grid-cols-3">
        <MetricDatum label="Level" value={level} />
        <MetricDatum label="Current XP" value={formatNumber(xp)} />
        <MetricDatum label="Next Milestone" value={`${formatNumber(xpGoal)} XP`} />
      </dl>

      <ProgressMeter
        label="XP progress toward next milestone"
        value={Math.min(xp, xpGoal)}
        max={xpGoal}
        percent={xpProgress}
        tone="cyan"
        valueText={`${formatNumber(xp)} of ${formatNumber(xpGoal)} XP`}
      />

      <div className="mt-space-3 flex flex-wrap justify-between gap-space-3 text-sm leading-5">
        <span className="text-slate-300">
          {xpProgress}% toward next milestone
        </span>
        <span className="text-slate-400">
          {formatNumber(Math.max(xpGoal - xp, 0))} XP remaining
        </span>
      </div>
    </section>
  );
}

function InvestigationProgressCard({
  generated,
  completed,
  inProgress,
  completionRate,
}: {
  generated: number;
  completed: number;
  inProgress: number;
  completionRate: number;
}) {
  return (
    <section
      aria-labelledby="progress-investigation-title"
      className="min-w-0 rounded-[3px] border border-cyan-100/12 bg-[#071426] p-space-5 text-white"
    >
      <SectionHeading
        number="03 / Record"
        label="Investigations"
        title="Investigation Completion"
        titleId="progress-investigation-title"
        compact
      />

      <dl className="mt-space-5 grid min-w-0 grid-cols-3 divide-x divide-white/[0.08] border-y border-white/[0.08] py-space-4">
        <MetricDatum label="Generated" value={formatNumber(generated)} centered />
        <MetricDatum label="Completed" value={formatNumber(completed)} centered />
        <MetricDatum label="In Progress" value={formatNumber(inProgress)} centered />
      </dl>

      <ProgressMeter
        label="Investigation completion"
        value={Math.min(completed, generated || 1)}
        max={generated || 1}
        percent={completionRate}
        tone="green"
        valueText={`${formatNumber(completed)} of ${formatNumber(generated)} investigations completed`}
      />

      <p className="mt-space-3 text-sm leading-6 text-slate-300">
        {generated === 0
          ? "No generated investigations are saved yet."
          : `${completionRate}% of generated investigations are completed.`}
      </p>
    </section>
  );
}

function AchievementCollection({
  achievements,
  unlockedCount,
}: {
  achievements: Achievement[];
  unlockedCount: number;
}) {
  return (
    <section
      aria-labelledby="progress-achievements-title"
      className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426] text-white"
    >
      <div className="grid gap-space-3 p-space-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <SectionHeading
          number="04 / Achievements"
          label="Milestones"
          title="Achievement Registry"
          titleId="progress-achievements-title"
          compact
        />
        <Badge
          variant="primary"
          className="w-fit rounded-[3px] border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100 ring-cyan-300/20"
        >
          {formatNumber(unlockedCount)} of {formatNumber(achievements.length)} unlocked
        </Badge>
      </div>

      {achievements.length === 0 ? (
        <div className="border-t border-white/[0.08] p-space-5">
          <div className="rounded-[3px] border border-dashed border-white/15 bg-white/[0.03] p-space-5">
            <p className="font-semibold text-white">No achievements available</p>
            <p className="mt-space-2 max-w-2xl text-sm leading-6 text-slate-300">
              Achievement definitions will appear here when they are available.
            </p>
          </div>
        </div>
      ) : (
        <div className="border-t border-white/[0.08]">
          {achievements.map((achievement) => (
            <AchievementRecord key={achievement.id} achievement={achievement} />
          ))}
        </div>
      )}
    </section>
  );
}

function AchievementRecord({ achievement }: { achievement: Achievement }) {
  return (
    <article className="grid min-w-0 gap-space-3 border-b border-white/[0.08] p-space-4 last:border-b-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(9rem,0.55fr)_minmax(8rem,0.45fr)] sm:items-center sm:p-space-5">
      <div className="flex min-w-0 gap-space-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border ${
            achievement.unlocked
              ? "border-amber-300/25 bg-amber-300/[0.08] text-amber-200"
              : "border-white/10 bg-white/[0.04] text-slate-400"
          }`}
        >
          {achievement.unlocked ? (
            getAchievementIcon(achievement.icon)
          ) : (
            <Lock size={18} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold leading-5 text-white">
            {formatAchievementTitle(achievement.name)}
          </h3>
          <p className="mt-space-1 break-words text-sm leading-6 text-slate-300">
            {formatAchievementDescription(achievement.description)}
          </p>
        </div>
      </div>

      <div className="min-w-0 sm:border-l sm:border-white/[0.08] sm:pl-space-4">
        <p className="type-caption uppercase tracking-[0.12em] text-slate-400">
          Requirement
        </p>
        <p className="mt-1 break-words text-sm leading-5 text-slate-300">
          {formatAchievementRequirement(achievement)}
        </p>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-space-2 sm:justify-end">
        <Badge
          variant={achievement.unlocked ? "success" : "neutral"}
          className={
            achievement.unlocked
              ? "rounded-[3px] border border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100 ring-emerald-300/20"
              : "rounded-[3px] border border-white/10 bg-white/[0.04] text-slate-300 ring-white/10"
          }
        >
          {achievement.unlocked ? "Unlocked" : "Locked"}
        </Badge>
        {achievement.unlocked_at && (
          <time
            dateTime={achievement.unlocked_at}
            className="text-xs leading-5 text-slate-400"
          >
            {formatDate(achievement.unlocked_at)}
          </time>
        )}
      </div>
    </article>
  );
}

function HistoricalActivityStatus() {
  return (
    <section
      aria-labelledby="progress-history-title"
      className="flex min-w-0 items-start gap-space-4 rounded-[3px] border border-white/[0.08] bg-white/[0.03] p-space-4 text-white"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-white/10 bg-white/[0.04] text-slate-300">
        <TrendingUp size={18} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Historical Activity
        </p>
        <h2 id="progress-history-title" className="mt-1 text-sm font-semibold text-white">
          Detailed progress history is not available yet.
        </h2>
        <p className="mt-space-1 max-w-3xl text-sm leading-6 text-slate-300">
          Amniora currently stores aggregate XP and completion totals rather than
          timestamped progress events.
        </p>
      </div>
    </section>
  );
}

function SectionHeading({
  number,
  label,
  title,
  titleId,
  compact = false,
}: {
  number: string;
  label: string;
  title: string;
  titleId: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "min-w-0" : "p-space-5"}>
      <div className="flex min-w-0 items-center gap-space-3">
        <span className="shrink-0 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
          {number}
        </span>
        <span className="h-px min-w-6 flex-1 bg-cyan-100/15" aria-hidden="true" />
        <span className="hidden shrink-0 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500 sm:inline">
          {label}
        </span>
      </div>
      <h2 id={titleId} className="mt-space-3 text-lg font-semibold leading-tight text-white sm:text-xl">
        {title}
      </h2>
    </div>
  );
}

function MetricDatum({
  label,
  value,
  centered = false,
}: {
  label: string;
  value: string;
  centered?: boolean;
}) {
  return (
    <div className={`min-w-0 ${centered ? "px-space-3 text-center" : ""}`}>
      <dt className="type-caption uppercase tracking-[0.12em] text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 break-words text-lg font-semibold leading-tight text-white">
        {value}
      </dd>
    </div>
  );
}

function ProgressMeter({
  label,
  value,
  max,
  percent,
  tone,
  valueText,
}: {
  label: string;
  value: number;
  max: number;
  percent: number;
  tone: "cyan" | "green";
  valueText: string;
}) {
  const clampedPercent = Math.max(0, Math.min(percent, 100));
  return (
    <div className="mt-space-5">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        aria-valuetext={valueText}
        className="h-1.5 overflow-hidden rounded-ui-pill bg-slate-950/70"
      >
        <div
          style={{ width: `${clampedPercent}%` }}
          className={`h-full rounded-ui-pill transition-[width] duration-150 motion-reduce:transition-none ${
            tone === "green" ? "bg-emerald-300" : "bg-cyan-300"
          }`}
        />
      </div>
    </div>
  );
}

function getAchievementIcon(icon: string) {
  const props = { size: 18, "aria-hidden": true as const };
  const icons: Record<string, React.ReactNode> = {
    Award: <Award {...props} />,
    BookOpen: <BookOpen {...props} />,
    GraduationCap: <GraduationCap {...props} />,
    Shield: <Shield {...props} />,
    Crown: <Crown {...props} />,
    Zap: <Zap {...props} />,
    TrendingUp: <TrendingUp {...props} />,
    Gem: <Gem {...props} />,
    Flame: <Flame {...props} />,
    Terminal: <Terminal {...props} />,
    Network: <Network {...props} />,
    Globe: <Globe {...props} />,
    Cloud: <Cloud {...props} />,
    Trophy: <Trophy {...props} />,
    Circle: <Circle {...props} />,
    CircleDot: <CircleDot {...props} />,
    ShieldCheck: <ShieldCheck {...props} />,
    Skull: <Skull {...props} />,
    FolderOpen: <FolderOpen {...props} />,
    BadgeCheck: <BadgeCheck {...props} />,
  };

  return icons[icon] || <Award {...props} />;
}

function formatNumber(value: number) {
  return numberFormatter.format(Math.max(value, 0));
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}
