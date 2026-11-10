"use client";

import { useEffect, useRef, useState } from "react";
import { Trophy, Sparkles, X } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { createClient } from "../../lib/supabase/client";

type AchievementNotification = {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
};

function normalizeAchievementCopy(value: string) {
  return value
    .replace(/\bCyberLab\b/g, "Amniora")
    .replace(/\bLab Builder\b/g, "Investigation Builder")
    .replace(/\bcybersecurity labs\b/g, "cybersecurity investigations")
    .replace(/\bLabs\b/g, "Investigations")
    .replace(/\blabs\b/g, "investigations")
    .trim();
}

export default function AchievementToast() {
  const [queue, setQueue] = useState<AchievementNotification[]>([]);
  const [activeAchievement, setActiveAchievement] =
    useState<AchievementNotification | null>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const displayedIdsRef = useRef<Set<string>>(new Set());
  const reducedMotion = useReducedMotion();

  function enqueueAchievements(notifications: AchievementNotification[]) {
    const nextItems = notifications.filter((notification) => {
      if (notification.type !== "achievement") return false;
      if (displayedIdsRef.current.has(notification.id)) return false;
      displayedIdsRef.current.add(notification.id);
      return true;
    });

    if (nextItems.length === 0) return;
    setQueue((current) => [...current, ...nextItems]);
  }

  useEffect(() => {
    const supabase = createClient();

    async function fetchRecentAchievementBatch(userId: string) {
      const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();

      const { data } = await supabase
        .from("notifications")
        .select("id, title, message, type, read, created_at")
        .eq("user_id", userId)
        .eq("type", "achievement")
        .gte("created_at", fiveSecondsAgo)
        .order("created_at", { ascending: false });

      if (data && data.length > 0) enqueueAchievements(data);
    }

    async function setupRealtime() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const channel = supabase
        .channel(`achievement-toasts-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const notification = payload.new as AchievementNotification;

            if (batchTimeoutRef.current) {
              clearTimeout(batchTimeoutRef.current);
            }

            batchTimeoutRef.current = setTimeout(() => {
              fetchRecentAchievementBatch(user.id);
            }, 350);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }

    const cleanupPromise = setupRealtime();

    return () => {
      cleanupPromise.then((cleanup) => {
        if (cleanup) cleanup();
      });

      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      if (batchTimeoutRef.current) clearTimeout(batchTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (activeAchievement || queue.length === 0) return;

    const [nextAchievement, ...remaining] = queue;
    setActiveAchievement(nextAchievement);
    setQueue(remaining);

    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => {
      setActiveAchievement(null);
    }, 5600);
  }, [activeAchievement, queue]);

  function closeToast() {
    setActiveAchievement(null);

    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-3 top-20 z-[9999] sm:left-auto sm:right-6 sm:top-24 sm:w-[390px]"
      data-achievement-toast-queue
      aria-live="polite"
    >
      <AnimatePresence>
        {activeAchievement && (
          <motion.div
            key={activeAchievement.id}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
            transition={{ duration: reducedMotion ? 0.12 : 0.24 }}
            className="pointer-events-auto relative overflow-hidden rounded-[4px] border border-cyan-200/25 bg-[#071426] p-4 text-white shadow-modal sm:p-5"
            data-achievement-toast="earned"
          >
            <div className="relative z-10 flex items-start gap-3 sm:gap-4">
              <motion.div
                animate={
                  reducedMotion
                    ? { opacity: 1 }
                    : { boxShadow: ["0 0 0 rgba(103,232,249,0)", "0 0 22px rgba(103,232,249,0.18)", "0 0 0 rgba(103,232,249,0)"] }
                }
                transition={{ duration: 1.2 }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] border border-cyan-100/20 bg-cyan-300/10 text-cyan-200 sm:h-12 sm:w-12"
              >
                <Trophy size={24} />
              </motion.div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-primary" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200 sm:text-xs">
                    Achievement Unlocked
                  </p>
                </div>

                <h3 className="mt-1 line-clamp-2 font-semibold text-white">
                  {normalizeAchievementCopy(activeAchievement.title)}
                </h3>

                <p className="mt-1 line-clamp-2 text-sm text-slate-300">
                  {normalizeAchievementCopy(activeAchievement.message)}
                </p>

                {queue.length > 0 && (
                  <p className="mt-3 rounded-[3px] border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-slate-300">
                    {queue.length} more achievement
                    {queue.length === 1 ? "" : "s"} queued
                  </p>
                )}
              </div>

              <button
                onClick={closeToast}
                className="shrink-0 rounded-[3px] p-1 text-slate-400 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200"
                aria-label="Close achievement notification"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
