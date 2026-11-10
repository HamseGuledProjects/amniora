"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import NotificationBell from "../components/NotificationBell";
import { createClient } from "../../lib/supabase/client";
import { DashboardSkeleton } from "@/app/components/ui/Skeleton";
import ErrorState from "@/app/components/ui/ErrorState";
import {
  CapabilityDevelopment,
  CurrentInvestigationPanel,
  InvestigationQueue,
  MilestoneActivity,
  TutorAction,
  type DashboardAchievement,
  type DashboardLab,
  type DashboardRoadmapItem,
} from "./_components/DashboardPanels";
import { getNextXpGoal, getXpProgress } from "./_lib/xp";

type DashboardProfile = {
  fullName: string;
  level: string;
  xp: number;
  labsGenerated: number;
  labsCompleted: number;
};

type AchievementDefinition = {
  id: number;
  name: string;
  description: string;
  icon: string;
  category: string;
};

type AchievementUnlock = {
  achievement_id: number;
  unlocked_at: string | null;
};

type RoadmapRow = {
  id: number;
  completed: boolean;
  roadmap_modules:
    | {
        title: string;
        display_order: number;
      }
    | {
        title: string;
        display_order: number;
      }[]
    | null;
};

export default function DashboardPage() {
  const [profile, setProfile] = useState<DashboardProfile>({
    fullName: "User",
    level: "Beginner",
    xp: 0,
    labsGenerated: 0,
    labsCompleted: 0,
  });
  const [recentLabs, setRecentLabs] = useState<DashboardLab[]>([]);
  const [achievements, setAchievements] = useState<DashboardAchievement[]>([]);
  const [unlockedAchievementCount, setUnlockedAchievementCount] = useState(0);
  const [roadmapItems, setRoadmapItems] = useState<DashboardRoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [desktopUtilities, setDesktopUtilities] = useState(false);

  async function loadDashboard() {
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
        setError("You need to be signed in to view your dashboard.");
        return;
      }

      const [
        profileResult,
        labsResult,
        achievementResult,
        unlockResult,
        roadmapResult,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, level, xp, labs_generated, labs_completed")
          .eq("id", user.id)
          .single(),
        supabase
          .from("labs")
          .select("id, title, difficulty, completed, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("achievements")
          .select("id, name, description, icon, category"),
        supabase
          .from("user_achievements")
          .select("achievement_id, unlocked_at")
          .eq("user_id", user.id)
          .order("unlocked_at", { ascending: false }),
        supabase
          .from("roadmap_progress")
          .select(
            `
              id,
              completed,
              roadmap_modules (
                title,
                display_order
              )
            `
          )
          .eq("user_id", user.id),
      ]);

      const requestError =
        profileResult.error ||
        labsResult.error ||
        achievementResult.error ||
        unlockResult.error ||
        roadmapResult.error;

      if (requestError) {
        setError(
          "Amniora could not load this data right now. Please try again in a moment."
        );
        return;
      }

      if (profileResult.data) {
        setProfile({
          fullName: profileResult.data.full_name || "User",
          level: profileResult.data.level || "Beginner",
          xp: profileResult.data.xp || 0,
          labsGenerated: profileResult.data.labs_generated || 0,
          labsCompleted: profileResult.data.labs_completed || 0,
        });
      }

      setRecentLabs(
        (labsResult.data || []).map((lab) => ({
          id: lab.id,
          title: lab.title,
          difficulty: lab.difficulty,
          completed: lab.completed,
          createdAt: lab.created_at,
        }))
      );

      const definitions = (achievementResult.data ||
        []) as AchievementDefinition[];
      const unlocks = (unlockResult.data || []) as AchievementUnlock[];
      setUnlockedAchievementCount(unlocks.length);
      const definitionsById = new Map(
        definitions.map((achievement) => [achievement.id, achievement])
      );

      setAchievements(
        unlocks
          .filter(
            (
              unlock
            ): unlock is AchievementUnlock & { unlocked_at: string } =>
              Boolean(
                unlock.unlocked_at &&
                  definitionsById.has(unlock.achievement_id)
              )
          )
          .slice(0, 3)
          .map((unlock) => {
            const definition = definitionsById.get(unlock.achievement_id)!;
            return {
              id: definition.id,
              name: definition.name,
              description: definition.description,
              icon: definition.icon,
              category: definition.category,
              unlockedAt: unlock.unlocked_at,
            };
          })
      );

      const roadmapRows = (roadmapResult.data || []) as RoadmapRow[];
      setRoadmapItems(
        roadmapRows
          .map((row) => {
            const roadmapModule = Array.isArray(row.roadmap_modules)
              ? row.roadmap_modules[0]
              : row.roadmap_modules;

            if (!roadmapModule) return null;

            return {
              id: row.id,
              title: roadmapModule.title,
              completed: row.completed,
              displayOrder: roadmapModule.display_order,
            };
          })
          .filter((item): item is DashboardRoadmapItem => item !== null)
          .sort((a, b) => a.displayOrder - b.displayOrder)
      );
    } catch {
      setError(
        "Amniora could not load this data right now. Please try again in a moment."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial client-side dashboard data load.
    loadDashboard();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const syncUtilities = () => setDesktopUtilities(query.matches);

    syncUtilities();
    query.addEventListener("change", syncUtilities);

    return () => query.removeEventListener("change", syncUtilities);
  }, []);

  const currentInvestigation = useMemo(
    () => recentLabs.find((lab) => !lab.completed) ?? null,
    [recentLabs]
  );

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load dashboard"
        message={error}
        onRetry={loadDashboard}
      />
    );
  }

  const xpGoal = getNextXpGoal(profile.xp);
  const xpProgress = getXpProgress(profile.xp);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mx-auto grid w-full min-w-0 max-w-[82rem] gap-space-7 text-white motion-reduce:transform-none sm:gap-space-8"
      data-dashboard-phase="investigation-first"
      data-dashboard-grid="unified"
    >
      <section className="grid min-w-0 gap-space-3 sm:gap-space-4" data-dashboard-zone="active-work">
        <header className="grid min-w-0 gap-space-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-space-5">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
            Dashboard
          </p>
          <p className="mt-space-1.5 text-balance text-lg font-semibold tracking-normal text-white sm:text-2xl">
            Welcome back, {profile.fullName}.
          </p>
          <p className="mt-space-1.5 max-w-2xl text-sm leading-5 text-slate-300 sm:leading-6">
            Continue investigation work, review saved records, and track progress from one workspace.
          </p>
        </div>
        <div className="flex w-full items-center justify-start gap-space-2 sm:w-auto sm:justify-end" data-dashboard-header-actions>
          {desktopUtilities ? (
            <div data-dashboard-desktop-notifications>
              <NotificationBell />
            </div>
          ) : null}
          <Link
            href="/dashboard/labs"
            className="type-button inline-flex h-10 flex-1 items-center justify-center gap-space-2 whitespace-nowrap rounded-[5px] border border-white/15 px-space-3 text-slate-100 outline-none transition-colors duration-150 hover:border-cyan-300/40 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071426] sm:flex-none"
          >
            <FlaskConical size={16} aria-hidden="true" />
            Generate investigation
          </Link>
        </div>
      </header>

        <CurrentInvestigationPanel lab={currentInvestigation} />
      </section>

      <section className="grid min-w-0" data-dashboard-zone="work-index">
        <InvestigationQueue labs={recentLabs} />
      </section>

      <section className="mt-space-3 grid min-w-0 gap-space-5 sm:mt-space-4 xl:grid-cols-[minmax(0,0.64fr)_minmax(19rem,0.36fr)] xl:gap-space-7" data-dashboard-zone="development-context">
        <CapabilityDevelopment
          profile={profile}
          roadmapItems={roadmapItems}
          unlockedAchievementCount={unlockedAchievementCount}
          xpGoal={xpGoal}
          xpProgress={xpProgress}
        />
        <div className="grid min-w-0 gap-space-4 xl:relative xl:pl-space-6 xl:before:absolute xl:before:bottom-2 xl:before:left-0 xl:before:top-2 xl:before:w-px xl:before:bg-white/[0.08]">
          <MilestoneActivity achievements={achievements} />
          <TutorAction />
        </div>
      </section>
    </motion.div>
  );
}
