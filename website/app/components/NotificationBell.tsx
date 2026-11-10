"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Inbox, Trash2, Trophy, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "../../lib/supabase/client";

type Notification = {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
};

function formatNotificationTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function normalizeNotificationCopy(value: string) {
  return value
    .replace(/\bCyberLab\b/g, "Amniora")
    .replace(/\bLab Builder\b/g, "Investigation Builder")
    .replace(/\bcybersecurity labs\b/g, "cybersecurity investigations")
    .replace(/\bLabs\b/g, "Investigations")
    .replace(/\blabs\b/g, "investigations")
    .trim();
}

function NotificationSkeletonRows() {
  return (
    <div
      className="space-y-2"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-notification-loading="dark-skeleton"
    >
      <span className="sr-only">Loading notifications</span>
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="grid grid-cols-[0.65rem_minmax(0,1fr)] gap-3 rounded-[4px] border border-white/10 bg-white/[0.035] p-3"
        >
          <span className="mt-1 h-2 w-2 rounded-full bg-white/15" />
          <span className="min-w-0 space-y-2">
            <span className="block h-3 w-28 rounded-[3px] bg-white/10" />
            <span className="block h-3 w-full rounded-[3px] bg-white/[0.075]" />
            <span className="block h-3 w-2/3 rounded-[3px] bg-white/[0.06]" />
          </span>
        </div>
      ))}
    </div>
  );
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);
  const [clearing, setClearing] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;

    panelRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => buttonRef.current?.focus());
      }
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsidePointer);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

 async function loadNotifications() {
  setError("");
  setLoading(true);

  try {
    const supabase = createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setError(
        "Notifications could not be loaded right now."
      );
      return;
    }

    const { data, error: notificationsError } = await supabase
      .from("notifications")
      .select("id, title, message, type, read, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (notificationsError) {
      setError(
        "Notifications could not be loaded right now."
      );
      return;
    }

    if (data) {
      setNotifications(data);
    }
  } catch {
    setError(
      "Notifications could not be loaded right now."
    );
  } finally {
    setLoading(false);
  }
}

  useEffect(() => {
    const supabase = createClient();

    async function setupRealtime() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      await loadNotifications();

      const channel = supabase
        .channel(`notifications-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const newNotification = payload.new as Notification;

            setNotifications((current) => [
              newNotification,
              ...current.filter((n) => n.id !== newNotification.id),
            ]);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const updatedNotification = payload.new as Notification;

            setNotifications((current) =>
              current.map((n) =>
                n.id === updatedNotification.id ? updatedNotification : n
              )
            );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const deletedNotification = payload.old as Notification;

            setNotifications((current) =>
              current.filter((n) => n.id !== deletedNotification.id)
            );
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
    };
  }, []);

  async function markAllAsRead() {
    if (markingRead) return;
    const supabase = createClient();

    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);

    if (unreadIds.length === 0) return;

    setMarkingRead(true);
    const { error: readError } = await supabase
      .from("notifications")
      .update({ read: true })
      .in("id", unreadIds);

    setMarkingRead(false);

    if (readError) {
      setError("Notifications could not be updated right now.");
      return;
    }

    setNotifications((current) =>
      current.map((n) => ({
        ...n,
        read: true,
      }))
    );
  }

  async function clearAllNotifications() {
    if (clearing) return;
    const supabase = createClient();

    const ids = notifications.map((n) => n.id);

    if (ids.length === 0) return;

    setClearing(true);
    const { error: clearError } = await supabase
      .from("notifications")
      .delete()
      .in("id", ids);
    setClearing(false);

    if (clearError) {
      setError("Notifications could not be cleared right now.");
      return;
    }

    setNotifications([]);
    setOpen(false);
  }

  return (
    <div className="relative z-40" data-notification-root>
      <button
        ref={buttonRef}
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-10 w-10 items-center justify-center rounded-[5px] border border-white/15 bg-white/[0.035] text-slate-300 shadow-sm shadow-black/10 outline-none transition-[background-color,border-color,color] duration-150 hover:border-cyan-300/35 hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1828]"
        aria-label="Open notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="notification-panel"
      >
        <Bell size={20} />

        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-ui-pill bg-cyan-300 px-1 text-[11px] font-semibold text-slate-950 ring-2 ring-[#0c1828]">
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            id="notification-panel"
            role="dialog"
            aria-labelledby="notification-panel-title"
            tabIndex={-1}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            className="notification-panel absolute right-0 top-12 z-[70] max-h-[min(26rem,calc(100dvh-7rem))] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[4px] border border-white/15 bg-[#071426] p-0 text-slate-300 shadow-[0_22px_70px_rgba(0,0,0,0.46)] outline-none sm:max-h-none"
            data-notification-panel
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#061222] px-4 py-3">
              <h3 id="notification-panel-title" className="type-card-title text-white">Notifications</h3>

              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    disabled={markingRead}
                    className="rounded-[3px] text-xs font-semibold text-cyan-200 outline-none hover:text-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    {markingRead ? "Updating..." : "Mark All Read"}
                  </button>
                )}

                {notifications.length > 0 && (
                  <button
                    onClick={clearAllNotifications}
                    disabled={clearing}
                    className="flex items-center gap-1 rounded-[3px] text-xs font-semibold text-red-200 outline-none hover:text-red-100 focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    <Trash2 size={13} />
                    {clearing ? "Clearing..." : "Clear"}
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[min(21rem,calc(100dvh-11rem))] space-y-3 overflow-y-auto p-3 sm:max-h-[420px] sm:p-4">
  {loading ? (
    <NotificationSkeletonRows />
  ) : error ? (
    <div className="rounded-[4px] border border-red-300/25 bg-red-400/10 p-4 text-sm text-red-100">
      <p className="font-semibold">Unable to load notifications</p>
      <p className="mt-1 text-xs leading-5 text-red-100/80">{error}</p>

      <button
        onClick={loadNotifications}
        className="mt-3 rounded-[4px] border border-red-300/25 px-3 py-2 text-xs font-semibold text-red-100 outline-none transition-colors hover:bg-red-400/10 focus-visible:ring-2 focus-visible:ring-cyan-200"
      >
        Try again
      </button>
    </div>
  ) : notifications.length === 0 ? (
    <div className="rounded-[4px] border border-white/10 bg-white/[0.035] px-4 py-8 text-center">
      <Inbox size={24} className="mx-auto text-slate-400" />
      <p className="mt-3 text-sm font-semibold text-white">
        No notifications yet
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-300">
        Achievements, roadmap updates, and account activity will appear here.
      </p>
    </div>

              ) : (
                notifications.map((notification) => {
                  const isAchievement = notification.type === "achievement";

                  return (
                    <motion.div
                      key={notification.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`relative overflow-hidden rounded-[4px] border p-4 ${
                        isAchievement
                          ? "border-cyan-200/25 bg-cyan-300/10"
                          : notification.read
                          ? "border-white/10 bg-white/[0.035]"
                          : "border-cyan-200/25 bg-white/[0.065]"
                      }`}
                      data-notification-row={notification.read ? "read" : "unread"}
                    >
                      <div className="relative z-10 flex gap-3">
                        {isAchievement && (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-cyan-100/15 bg-[#061222] text-cyan-200">
                            <Trophy size={20} />
                          </div>
                        )}

                        {!isAchievement && (
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              notification.read ? "bg-slate-600" : "bg-cyan-300"
                            }`}
                            aria-hidden="true"
                          />
                        )}

                        <div className="min-w-0 flex-1">
                          {isAchievement && (
                            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
                              <Sparkles size={11} />
                              Achievement
                            </div>
                          )}

                          <p className={`break-words text-sm font-semibold ${notification.read ? "text-slate-200" : "text-white"}`}>
                            {normalizeNotificationCopy(notification.title)}
                          </p>

                          <p className="mt-1 break-words text-xs leading-5 text-slate-300">
                            {normalizeNotificationCopy(notification.message)}
                          </p>
                          <time
                            dateTime={notification.created_at}
                            className="mt-2 block text-[11px] font-medium text-slate-400"
                          >
                            {formatNotificationTime(notification.created_at)}
                          </time>
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
