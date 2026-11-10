import Link from "next/link";
import {
  ArrowRight,
  Award,
  BookOpen,
  Circle,
  Cloud,
  Crown,
  Flame,
  FolderOpen,
  Gem,
  Globe,
  GraduationCap,
  Network,
  Shield,
  ShieldCheck,
  Terminal,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import Badge from "@/app/components/ui/Badge";

export type DashboardAchievement = {
  id: number;
  name: string;
  description: string;
  icon: string;
  category: string;
  unlockedAt: string;
};

export type DashboardLab = {
  id: string;
  title: string;
  difficulty: string;
  completed: boolean;
  createdAt: string;
};

export type DashboardRoadmapItem = {
  id: number;
  title: string;
  completed: boolean;
  displayOrder: number;
};

export type DashboardProfileSummary = {
  level: string;
  xp: number;
  labsGenerated: number;
  labsCompleted: number;
};

const sectionNumberClass =
  "whitespace-nowrap font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-cyan-200/80 min-[360px]:text-[0.66rem] min-[360px]:tracking-[0.15em] sm:text-[0.68rem]";
const sectionRuleClass = "h-px w-10 bg-white/[0.075] sm:w-16";

function SectionHeader({
  number,
  label,
  title,
  action,
  titleId,
}: {
  number: string;
  label: string;
  title: string;
  action?: React.ReactNode;
  titleId?: string;
}) {
  return (
    <div className="grid min-w-0 gap-space-2 min-[380px]:grid-cols-[minmax(0,1fr)_auto] min-[380px]:items-end min-[380px]:gap-space-4">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-space-2 sm:gap-space-3">
          <span className={sectionNumberClass}>{number}</span>
          <span className={sectionRuleClass} aria-hidden="true" />
        </div>
        <h2 id={titleId} className="mt-space-1.5 text-balance text-base font-semibold tracking-normal text-white sm:mt-space-2 sm:text-xl">
          {title}
        </h2>
        <p className="type-caption mt-0.5 uppercase tracking-[0.12em] text-slate-400 sm:mt-1 sm:tracking-[0.14em]">
          {label}
        </p>
      </div>
      {action ? <div className="shrink-0 self-start min-[380px]:self-auto">{action}</div> : null}
    </div>
  );
}

function StatusBadge({ completed }: { completed: boolean }) {
  return (
    <Badge variant={completed ? "success" : "warning"}>
      {completed ? "Completed" : "In progress"}
    </Badge>
  );
}

export function CurrentInvestigationPanel({
  lab,
}: {
  lab: DashboardLab | null;
}) {
  return (
    <section
      aria-labelledby="current-investigation-heading"
      data-dashboard-region="current-investigation"
      className="overflow-hidden rounded-[3px] border-y border-cyan-300/25 bg-[#071426] text-white shadow-[0_16px_42px_rgba(0,0,0,0.16)] sm:border-x"
    >
      <div className="grid min-w-0 gap-space-4 p-space-4 sm:p-space-5 lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-end lg:p-space-6">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-space-2 sm:gap-space-3">
            <span className={sectionNumberClass}>01 / Current investigation</span>
            <span className={sectionRuleClass} aria-hidden="true" />
          </div>
          <h1
            id="current-investigation-heading"
            className="mt-space-3 max-w-3xl break-words text-balance text-xl font-semibold leading-tight tracking-normal text-white min-[390px]:text-2xl sm:text-3xl lg:text-[2.2rem]"
          >
            {lab ? lab.title : "No investigation in progress."}
          </h1>
          <p className="mt-space-2 max-w-2xl pb-space-1 text-sm leading-5 text-slate-300 sm:mt-space-3 sm:pb-space-1.5 sm:leading-6">
            {lab
              ? "Continue the latest saved investigation from the same evidence workspace."
              : "Generate an investigation to begin working with scoped evidence and guided tasks."}
          </p>
        </div>

        <Link
          href={lab ? `/dashboard/saved/${lab.id}` : "/dashboard/labs"}
          className="type-button inline-flex h-10 w-full items-center justify-center gap-space-2 whitespace-nowrap rounded-[5px] border border-cyan-300/30 bg-cyan-300 px-space-4 text-slate-950 outline-none transition-[background-color,border-color,color] duration-100 hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071426] sm:w-auto"
        >
          {lab ? "Continue investigation" : "Generate investigation"}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>

      <div className="grid min-w-0 grid-cols-2 border-t border-white/10 bg-white/[0.035] sm:grid-cols-3">
        <div className="min-w-0 border-b border-r border-white/10 px-space-3 py-space-3.5 sm:border-b-0 sm:px-space-5 sm:py-space-4">
          <p className="type-caption uppercase tracking-[0.12em] text-slate-400">Difficulty</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">
            {lab ? lab.difficulty : "Not selected"}
          </p>
        </div>
        <div className="min-w-0 border-b border-white/10 px-space-3 py-space-3.5 sm:border-b-0 sm:border-r sm:px-space-5 sm:py-space-4">
          <p className="type-caption uppercase tracking-[0.12em] text-slate-400">State</p>
          <div className="mt-1">{lab ? <StatusBadge completed={lab.completed} /> : <Badge variant="neutral">Empty</Badge>}</div>
        </div>
        <div className="col-span-2 min-w-0 px-space-3 py-space-3.5 sm:col-span-1 sm:px-space-5 sm:py-space-4">
          <p className="type-caption uppercase tracking-[0.12em] text-slate-400">Saved</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">
            {lab ? formatDate(lab.createdAt) : "No saved investigation"}
          </p>
        </div>
      </div>
    </section>
  );
}

export function InvestigationQueue({ labs }: { labs: DashboardLab[] }) {
  const previewLabs = labs.slice(0, 2);
  const hasMoreInvestigations = labs.length > previewLabs.length;

  return (
    <section
      aria-labelledby="investigation-queue-heading"
      data-dashboard-region="investigation-queue"
      className="border-t border-white/[0.08] bg-[#0b1829]/55 text-white"
    >
      <div className="px-space-1 pb-space-4 pt-space-5 sm:px-space-3 sm:pb-space-5 sm:pt-space-6">
        <SectionHeader
          number="02 / Investigation queue"
          label="Saved work"
          title="Recent investigations"
          titleId="investigation-queue-heading"

        />
      </div>

      {labs.length === 0 ? (
        <div className="px-space-2 py-space-4 sm:px-space-3 sm:py-space-5">
          <p className="font-semibold text-white">No saved investigations yet.</p>
          <p className="mt-space-1 max-w-xl text-sm leading-6 text-slate-300">
            Generated investigations will appear here as a compact working queue.
          </p>
        </div>
      ) : (
        <div className="min-w-0">
          <div className="hidden grid-cols-[minmax(0,1.5fr)_7.5rem_7.5rem_8.5rem] gap-space-4 border-b border-white/[0.08] px-space-2 pb-space-3.5 pt-space-2 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-slate-400 sm:px-space-3 md:grid">
            <span>Investigation</span>
            <span>Difficulty</span>
            <span>State</span>
            <span>Created</span>
          </div>
          <div className="divide-y divide-white/10">
            {previewLabs.map((lab) => (
              <InvestigationRecord key={lab.id} lab={lab} />
            ))}
            {hasMoreInvestigations ? <SeeMoreInvestigationsRow /> : null}
          </div>
        </div>
      )}
    </section>
  );
}

function InvestigationRecord({ lab }: { lab: DashboardLab }) {
  return (
    <Link
      href={`/dashboard/saved/${lab.id}`}
      className="group grid min-w-0 gap-space-2 px-space-2 py-space-4 outline-none transition-[background-color,border-color] duration-150 hover:bg-cyan-300/[0.045] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200 sm:px-space-3 md:min-h-12 md:grid-cols-[minmax(0,1.5fr)_7.5rem_7.5rem_8.5rem] md:items-center md:gap-space-4"
      data-dashboard-record="investigation"
    >
      <div className="flex min-w-0 items-start gap-space-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-[3px] border border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-200">
          <FolderOpen size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="line-clamp-2 break-words text-sm font-semibold leading-5 text-white">
            {lab.title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400 md:hidden">
            {lab.difficulty} · Saved {formatDate(lab.createdAt)}
          </p>
        </div>
      </div>
      <p className="hidden truncate text-sm text-slate-300 md:block">{lab.difficulty}</p>
      <div className="flex items-center justify-between gap-space-3 md:block">
        <StatusBadge completed={lab.completed} />
        <span className="inline-flex items-center gap-space-1 text-xs font-semibold text-cyan-200 md:hidden">
          Continue <ArrowRight size={14} aria-hidden="true" />
        </span>
      </div>
      <p className="hidden truncate text-sm text-slate-300 md:block">{formatDate(lab.createdAt)}</p>
    </Link>
  );
}
function SeeMoreInvestigationsRow() {
  return (
    <Link
      href="/dashboard/saved"
      className="group grid min-w-0 gap-space-2 px-space-2 py-space-4 text-cyan-200 outline-none transition-[background-color,color] duration-150 hover:bg-cyan-300/[0.045] hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200 sm:px-space-3 md:min-h-12 md:grid-cols-[minmax(0,1.5fr)_7.5rem_7.5rem_8.5rem] md:items-center md:gap-space-4"
      data-dashboard-record="see-more-investigations"
    >
      <span className="flex min-w-0 items-center gap-space-3 md:col-span-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-[3px] border border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-200">
          <FolderOpen size={16} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 items-center justify-between gap-space-3">
          <span className="text-sm font-semibold leading-5">See more investigations</span>
          <ArrowRight size={15} aria-hidden="true" className="shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
        </span>
      </span>
    </Link>
  );
}

export function CapabilityDevelopment({
  profile,
  roadmapItems,
  unlockedAchievementCount,
  xpGoal,
  xpProgress,
}: {
  profile: DashboardProfileSummary;
  roadmapItems: DashboardRoadmapItem[];
  unlockedAchievementCount: number;
  xpGoal: number;
  xpProgress: number;
}) {
  const completedRoadmapItems = roadmapItems.filter((item) => item.completed).length;
  const roadmapProgress =
    roadmapItems.length > 0
      ? Math.round((completedRoadmapItems / roadmapItems.length) * 100)
      : 0;
  const nextRoadmapItem = roadmapItems.find((item) => !item.completed);

  return (
    <section
      aria-labelledby="capability-development-heading"
      data-dashboard-region="capability-development"
      className="bg-transparent py-space-6 text-white sm:py-space-7 xl:pr-space-7"
    >
      <SectionHeader
        number="03 / Capability"
        label="Progress signal"
        title="Capability development"
        titleId="capability-development-heading"
        action={
          <div className="flex flex-wrap gap-space-2">
            <Link
              href="/dashboard/progress"
              className="type-button rounded-[5px] text-cyan-200 outline-none transition-colors duration-150 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1b2f]"
            >
              Open progress
            </Link>
            <Link
              href="/dashboard/roadmap"
              className="type-button rounded-[5px] text-slate-300 outline-none transition-colors duration-150 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1b2f]"
            >
              Roadmap
            </Link>
          </div>
        }
      />

      <div className="mt-space-5 border-t border-white/[0.08] pt-space-5 sm:mt-space-6 sm:pt-space-6">
        <div className="grid min-w-0 grid-cols-2 gap-x-space-5 gap-y-space-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <p className="type-caption uppercase tracking-[0.12em] text-slate-400">Level</p>
            <p className="mt-1 truncate text-xl font-semibold text-white">{profile.level}</p>
          </div>
          <div className="min-w-0">
            <p className="type-caption uppercase tracking-[0.12em] text-slate-400">XP</p>
            <p className="mt-1 text-xl font-semibold text-white">{profile.xp.toLocaleString()}</p>
          </div>
          <p className="col-span-2 text-sm leading-5 text-slate-300 sm:col-span-1 sm:max-w-[13rem] sm:text-right">
            {Math.max(xpGoal - profile.xp, 0).toLocaleString()} XP to the next milestone.
          </p>
        </div>
        <ProgressRail
          label="XP progress toward next milestone"
          value={Math.min(profile.xp, xpGoal)}
          max={xpGoal}
          percent={xpProgress}
        />
      </div>

      <div className="grid min-w-0 grid-cols-3 py-space-4 text-center sm:py-space-5 sm:text-left">
        <CapabilityMetric label="Completed" value={profile.labsCompleted} detail="investigations" />
        <CapabilityMetric label="Generated" value={profile.labsGenerated} detail="investigations" />
        <CapabilityMetric label="Milestones" value={unlockedAchievementCount} detail="unlocked" />
      </div>

      <div className="mt-space-6 min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-space-3">
          <div className="min-w-0">
            <p className="type-caption uppercase tracking-[0.12em] text-slate-400">Roadmap</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {roadmapItems.length > 0
                ? `${completedRoadmapItems} of ${roadmapItems.length} modules complete`
                : "No roadmap progress yet"}
            </p>
          </div>
          {nextRoadmapItem ? (
            <p className="max-w-full truncate text-sm text-slate-300 sm:max-w-xs">
              Next: {nextRoadmapItem.title}
            </p>
          ) : null}
        </div>
        <ProgressRail
          label="Roadmap completion"
          value={completedRoadmapItems}
          max={Math.max(roadmapItems.length, 1)}
          percent={roadmapProgress}
        />
        {roadmapItems.length === 0 ? (
          <p className="mt-space-2 text-xs text-slate-400">Open the roadmap to begin.</p>
        ) : null}
      </div>
    </section>
  );
}

function CapabilityMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="relative min-w-0 px-space-3 first:pl-0 last:pr-0 after:absolute after:bottom-2 after:right-0 after:top-2 after:w-px after:bg-white/[0.08] last:after:hidden">
      <p className="type-caption uppercase tracking-[0.11em] text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white sm:text-2xl">{value.toLocaleString()}</p>
      <p className="mt-0.5 truncate text-xs text-slate-400">{detail}</p>
    </div>
  );
}

function ProgressRail({
  label,
  value,
  max,
  percent,
}: {
  label: string;
  value: number;
  max: number;
  percent: number;
}) {
  return (
    <div className="mt-space-4">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${percent}%`}
        className="h-1.5 overflow-hidden rounded-ui-pill bg-slate-950/70"
      >
        <div
          className="h-full rounded-ui-pill bg-cyan-300 transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function MilestoneActivity({
  achievements,
}: {
  achievements: DashboardAchievement[];
}) {
  return (
    <section
      aria-labelledby="activity-milestones-heading"
      data-dashboard-region="activity-milestones"
      className="bg-transparent py-space-6 text-white sm:py-space-7"
    >
      <SectionHeader
        number="04 / Activity"
        label="Milestones"
        title="Recent achievements"
        titleId="activity-milestones-heading"
        action={
          <Link
            href="/dashboard/progress"
            className="type-button rounded-[5px] text-cyan-200 outline-none transition-colors duration-150 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1829]"
          >
            View progress
          </Link>
        }
      />

      {achievements.length === 0 ? (
        <div className="mt-space-6">
          <p className="font-semibold text-white">No milestones unlocked yet.</p>
          <p className="mt-space-1 max-w-xl text-sm leading-6 text-slate-300">
            Completed investigations and roadmap activity will appear here when milestones are earned.
          </p>
        </div>
      ) : (
        <div className="mt-space-5 divide-y divide-white/[0.08]">
          {achievements.map((achievement) => (
            <article key={achievement.id} className="flex min-w-0 gap-space-3 py-space-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-200">
                {getAchievementIcon(achievement.icon)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-space-2">
                  <h3 className="text-sm font-semibold leading-5 text-white">{achievement.name}</h3>
                  <Badge variant="neutral">{achievement.category}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-300">
                  {achievement.description}
                </p>
                <p className="mt-space-1.5 text-xs text-slate-400">
                  Unlocked {formatDate(achievement.unlockedAt)}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function TutorAction() {
  return (
    <section
      aria-labelledby="dashboard-tutor-heading"
      data-dashboard-region="learning-support"
      className="mt-space-1 border-t border-white/[0.08] bg-transparent pt-space-6 text-white sm:mt-space-2 sm:pt-space-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-space-3">
        <div className="min-w-0">
          <p className="type-caption uppercase tracking-[0.12em] text-slate-400">Support</p>
          <h2 id="dashboard-tutor-heading" className="mt-1 text-base font-semibold text-white">
            Guided learning support
          </h2>
          <p className="mt-space-1.5 max-w-2xl text-sm leading-6 text-slate-300">
            Open the tutor area when you want help reviewing concepts or planning the next investigation step.
          </p>
        </div>
        <Link
          href="/dashboard/tutor"
          className="type-button inline-flex h-10 items-center gap-space-2 whitespace-nowrap rounded-[5px] border border-white/15 px-space-3 text-slate-200 outline-none transition-colors duration-150 hover:border-cyan-300/40 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1829]"
        >
          Open tutor
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getAchievementIcon(icon: string) {
  const props = { size: 17, "aria-hidden": true as const };
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
    ShieldCheck: <ShieldCheck {...props} />,
  };

  return icons[icon] || <Award {...props} />;
}
