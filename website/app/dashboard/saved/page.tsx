"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "../../../lib/supabase/client";
import { createNotification } from "../../lib/createNotification";
import Button from "@/app/components/ui/Button";

type SavedInvestigation = {
  id: string;
  title: string;
  difficulty: string;
  completed: boolean;
  created_at: string;
  topic: string | null;
  estimated_time: string | null;
};

export default function SavedInvestigationsPage() {
  const [investigations, setInvestigations] = useState<SavedInvestigation[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SavedInvestigation | null>(
    null
  );
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadInvestigations() {
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
            "Amniora could not load your saved investigations. Please try again in a moment."
          );
          return;
        }

        if (!user) {
          setError("Sign in to view your saved investigations.");
          return;
        }

        const { data, error: investigationError } = await supabase
          .from("labs")
          .select(
            "id, title, difficulty, completed, created_at, topic, estimated_time"
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (investigationError) {
          setError(
            "Amniora could not load your saved investigations. Please try again in a moment."
          );
          return;
        }

        if (data) {
          setInvestigations(data);
        }
      } catch {
        setError(
          "Amniora could not load your saved investigations. Please try again in a moment."
        );
      } finally {
        setLoading(false);
      }
    }

    loadInvestigations();
  }, []);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredInvestigations = useMemo(
    () =>
      investigations.filter((investigation) =>
        investigation.title.toLowerCase().includes(normalizedSearch)
      ),
    [investigations, normalizedSearch]
  );

  if (loading) {
    return <SavedInvestigationsLoading />;
  }

  if (error && investigations.length === 0) {
    return (
      <SavedInvestigationsError
        message={error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  async function deleteInvestigation() {
    if (!deleteTarget) return;

    setDeleting(true);
    setError("");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setDeleting(false);
      setError("Sign in to delete saved investigations.");
      return;
    }

    const { error: deleteError } = await supabase
      .from("labs")
      .delete()
      .eq("id", deleteTarget.id)
      .eq("user_id", user.id);

    setDeleting(false);

    if (deleteError) {
      setError(
        "Amniora could not delete this investigation. Please try again in a moment."
      );
      return;
    }

    setInvestigations((currentInvestigations) =>
      currentInvestigations.filter(
        (investigation) => investigation.id !== deleteTarget.id
      )
    );
    setDeleteTarget(null);
  }

  async function deleteAllInvestigations() {
    setDeletingAll(true);
    setError("");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setDeletingAll(false);
      setError("Sign in to delete saved investigations.");
      return;
    }

    const deletedCount = investigations.length;
    const { error: deleteError } = await supabase
      .from("labs")
      .delete()
      .eq("user_id", user.id);

    setDeletingAll(false);

    if (deleteError) {
      setError(
        "Amniora could not delete your saved investigations. Please try again in a moment."
      );
      return;
    }

    setInvestigations([]);
    setDeleteAllOpen(false);

    await createNotification({
      userId: user.id,
      title: "Saved investigations deleted",
      message: `${deletedCount} saved investigation${
        deletedCount === 1 ? "" : "s"
      } deleted from your account.`,
      type: "system",
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="mx-auto grid w-full max-w-[82rem] gap-space-5 text-white motion-reduce:transform-none"
      data-saved-investigations-index="registry"
    >
      <header className="grid min-w-0 gap-space-4 border-b border-white/10 pb-space-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0">
          <p className="type-metadata text-cyan-200/80">Saved Investigations</p>
          <h1 className="mt-space-2 max-w-3xl text-balance text-2xl font-semibold tracking-[-0.01em] text-white sm:text-3xl">
            Investigation Registry
          </h1>
          <p className="mt-space-2 max-w-2xl text-sm leading-6 text-slate-300">
            Reopen active work, review completed investigations, and remove
            records you no longer need.
          </p>
        </div>
        <Link
          href="/dashboard/labs"
          className="type-button inline-flex h-11 max-w-full items-center justify-center gap-space-2 justify-self-start whitespace-nowrap rounded-[4px] border border-cyan-300/30 bg-[#0b2033] px-space-4 text-cyan-100 shadow-sm shadow-black/15 transition-[background-color,border-color,color] hover:border-cyan-200/55 hover:bg-[#10304a] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071426] sm:h-10 md:justify-self-end"
        >
          <FolderOpen size={17} aria-hidden="true" />
          Generate Investigation
        </Link>
      </header>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="flex items-start gap-space-3 border border-red-300/30 bg-red-950/25 p-space-4 text-red-100"
        >
          <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          <p className="type-body">{error}</p>
        </motion.div>
      )}

      <section
        aria-label="Saved investigation tools"
        className="border border-white/10 bg-[#061222] shadow-sm shadow-black/15"
      >
        <div className="grid gap-space-4 p-space-3.5 sm:p-space-4 xl:grid-cols-[minmax(18rem,32rem)_auto] xl:items-center xl:justify-between">
          <div className="relative min-w-0">
            <Search
              size={17}
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-cyan-100/45"
            />
            <input
              type="search"
              name="saved-investigation-search"
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search saved investigation titles"
              placeholder="Search investigation titles…"
              className="h-10 w-full min-w-0 rounded-[4px] border border-cyan-100/15 bg-[#081827] px-10 text-sm text-white shadow-inner shadow-black/10 outline-none transition-[border-color,box-shadow] placeholder:text-slate-500 focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-300/20"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear saved investigation search"
                className="absolute right-2 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[3px] text-slate-400 transition-[background-color,color] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-space-3 xl:justify-end xl:border-l xl:border-white/10 xl:pl-space-4">
            <p className="type-caption text-slate-400" aria-live="polite">
              {filteredInvestigations.length} of {investigations.length}{" "}
              investigation{investigations.length === 1 ? "" : "s"}
            </p>
            {investigations.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteAllOpen(true)}
                leadingIcon={<Trash2 size={15} aria-hidden="true" />}
                className="whitespace-nowrap border-red-300/30 bg-red-950/15 text-red-100 hover:border-red-200/45 hover:bg-red-950/35 hover:text-white focus-visible:ring-red-300"
              >
                Delete All
              </Button>
            )}
          </div>
        </div>
      </section>

      {filteredInvestigations.length === 0 ? (
        <SavedInvestigationsEmpty
          hasSearch={Boolean(normalizedSearch)}
          onClearSearch={() => setSearch("")}
        />
      ) : (
        <section
          aria-label="Saved investigations"
          className="overflow-hidden border border-white/10 bg-[#071426]"
        >
          <div
            aria-hidden="true"
            data-saved-investigations-desktop-heading="true"
            className="hidden whitespace-nowrap border-b border-white/10 bg-white/[0.025] px-space-5 py-space-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500 xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(7rem,8rem)_minmax(8rem,9rem)_minmax(8.5rem,9.5rem)_minmax(17.5rem,19rem)] xl:gap-space-4"
          >
            <span>Investigation</span>
            <span>Difficulty</span>
            <span>Status</span>
            <span>Created</span>
            <span>Actions</span>
          </div>
          <motion.ul layout className="divide-y divide-white/10">
            <AnimatePresence initial={false}>
              {filteredInvestigations.map((investigation, index) => (
                <SavedInvestigationRecord
                  key={investigation.id}
                  investigation={investigation}
                  index={index}
                  onDelete={() => setDeleteTarget(investigation)}
                />
              ))}
            </AnimatePresence>
          </motion.ul>
        </section>
      )}

      <AnimatePresence>
        {deleteTarget && (
          <DeleteDialog
            title="Delete Investigation?"
            description="This action is permanent and cannot be undone."
            detail={deleteTarget.title}
            confirmText="Delete Investigation"
            loadingText="Deleting…"
            loading={deleting}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={deleteInvestigation}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteAllOpen && (
          <DeleteDialog
            title="Delete All Investigations?"
            description="This will permanently delete every saved investigation in your account."
            detail={`${investigations.length} saved investigation${
              investigations.length === 1 ? "" : "s"
            } will be permanently deleted.`}
            confirmText="Delete All Investigations"
            loadingText="Deleting All…"
            loading={deletingAll}
            onCancel={() => setDeleteAllOpen(false)}
            onConfirm={deleteAllInvestigations}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SavedInvestigationRecord({
  investigation,
  index,
  onDelete,
}: {
  investigation: SavedInvestigation;
  index: number;
  onDelete: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const status = investigation.completed ? "Completed" : "In Progress";
  const topic = investigation.topic?.trim() || "Investigation";
  const duration = investigation.estimated_time?.trim();

  return (
    <motion.li
      layout
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -14 }}
      transition={{ delay: reducedMotion ? 0 : index * 0.025, duration: 0.18 }}
      className="min-w-0"
      data-saved-investigation-record="true"
    >
      <article
        className="grid min-w-0 gap-space-4 px-space-4 py-space-5 transition-[background-color] hover:bg-white/[0.025] sm:px-space-5 md:grid-cols-[minmax(0,1fr)_minmax(8.5rem,10rem)_minmax(15.5rem,auto)] md:items-center md:gap-x-space-4 md:gap-y-space-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(7rem,8rem)_minmax(8rem,9rem)_minmax(8.5rem,9.5rem)_minmax(17.5rem,19rem)] xl:gap-space-4 xl:py-space-4"
        data-saved-investigation-layout="responsive-record"
      >
        <div className="min-w-0 md:row-span-2 xl:row-auto">
          <div className="flex min-w-0 items-start gap-space-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
              <FolderOpen size={16} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="line-clamp-2 text-sm font-semibold leading-5 text-white sm:text-base">
                {investigation.title}
              </h2>
              <p className="mt-space-1 flex min-w-0 flex-wrap gap-x-space-2 gap-y-1 text-xs leading-5 text-slate-400">
                <span className="min-w-0 max-w-full break-words" translate="no">
                  {topic}
                </span>
                <span aria-hidden="true">/</span>
                <span translate="no">{investigation.difficulty}</span>
                {duration && (
                  <>
                    <span aria-hidden="true">/</span>
                    <span translate="no">{duration}</span>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        <span className="type-caption hidden whitespace-nowrap text-slate-400 xl:block">
          <span translate="no">{investigation.difficulty}</span>
        </span>

        <span
          className={`inline-flex w-fit items-center gap-space-2 whitespace-nowrap rounded-[3px] border px-2 py-1 text-xs font-semibold md:col-start-2 md:row-start-1 xl:col-auto xl:row-auto ${
            investigation.completed
              ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
              : "border-amber-300/25 bg-amber-300/10 text-amber-100"
          }`}
        >
          {investigation.completed ? (
            <CheckCircle2 size={13} aria-hidden="true" />
          ) : (
            <Clock3 size={13} aria-hidden="true" />
          )}
          {status}
        </span>

        <time
          className="type-caption whitespace-nowrap text-slate-400 md:col-start-2 md:row-start-2 xl:col-auto xl:row-auto"
          dateTime={investigation.created_at}
        >
          <span className="xl:hidden">Created: </span>
          {formatDate(investigation.created_at)}
        </time>

        <div className="flex min-w-0 flex-col gap-space-2 sm:flex-row sm:flex-wrap md:col-start-3 md:row-span-2 md:flex-col md:items-stretch md:justify-center xl:col-auto xl:row-auto xl:flex-row xl:flex-nowrap xl:justify-end">
          <button
            type="button"
            onClick={onDelete}
            className="type-button order-2 inline-flex h-10 min-w-[5.25rem] items-center justify-center gap-space-2 whitespace-nowrap rounded-[4px] border border-white/10 bg-transparent px-space-3 text-slate-300 transition-[background-color,border-color,color] hover:border-red-300/30 hover:bg-red-950/30 hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 sm:h-9 md:w-full xl:order-1 xl:w-auto"
          >
            <Trash2 size={15} aria-hidden="true" />
            Delete
          </button>
          <Link
            href={`/dashboard/saved/${investigation.id}`}
            className="type-button order-1 inline-flex h-10 min-w-[12rem] items-center justify-center gap-space-2 whitespace-nowrap rounded-[4px] border border-cyan-300/30 bg-[#0b2033] px-space-3 text-cyan-100 transition-[background-color,border-color,color] hover:border-cyan-200/55 hover:bg-[#10304a] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071426] sm:h-9 md:w-full xl:order-2 xl:w-auto"
          >
            Open Investigation
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </article>
    </motion.li>
  );
}

function SavedInvestigationsLoading() {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="mx-auto grid w-full max-w-[82rem] gap-space-5 text-white motion-reduce:transform-none"
      data-saved-investigations-loading="registry"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="grid gap-space-3 border-b border-white/10 pb-space-5">
        <SkeletonLine className="h-3 w-40" reducedMotion={reducedMotion} />
        <SkeletonLine className="h-9 w-80 max-w-full" reducedMotion={reducedMotion} />
        <SkeletonLine className="h-4 w-[34rem] max-w-full" reducedMotion={reducedMotion} />
      </div>

      <div className="border border-white/10 bg-[#071426] p-space-4">
        <SkeletonLine className="h-10 w-full max-w-md" reducedMotion={reducedMotion} />
      </div>

      <div className="overflow-hidden border border-white/10 bg-[#071426]">
        <div className="hidden border-b border-white/10 bg-white/[0.025] px-space-5 py-space-2 xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(7rem,8rem)_minmax(8rem,9rem)_minmax(8.5rem,9.5rem)_minmax(17.5rem,19rem)] xl:gap-space-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonLine key={index} className="h-3 w-20" reducedMotion={reducedMotion} />
          ))}
        </div>
        <div className="divide-y divide-white/10">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="grid gap-space-4 px-space-4 py-space-5 sm:px-space-5 md:grid-cols-[minmax(0,1fr)_minmax(8.5rem,10rem)_minmax(15.5rem,auto)] md:items-center md:gap-x-space-4 md:gap-y-space-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(7rem,8rem)_minmax(8rem,9rem)_minmax(8.5rem,9.5rem)_minmax(17.5rem,19rem)] xl:gap-space-4 xl:py-space-4"
            >
              <div className="flex min-w-0 gap-space-3">
                <SkeletonLine className="h-8 w-8 shrink-0" reducedMotion={reducedMotion} />
                <div className="min-w-0 flex-1 space-y-space-2">
                  <SkeletonLine className="h-4 w-4/5" reducedMotion={reducedMotion} />
                  <SkeletonLine className="h-3 w-2/5" reducedMotion={reducedMotion} />
                </div>
              </div>
              <SkeletonLine className="h-4 w-24" reducedMotion={reducedMotion} />
              <SkeletonLine className="h-7 w-24" reducedMotion={reducedMotion} />
              <SkeletonLine className="h-4 w-28" reducedMotion={reducedMotion} />
              <div className="flex gap-space-2">
                <SkeletonLine className="h-9 flex-1" reducedMotion={reducedMotion} />
                <SkeletonLine className="h-9 flex-1" reducedMotion={reducedMotion} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading saved investigations…</span>
    </motion.div>
  );
}

function SkeletonLine({
  className,
  reducedMotion,
}: {
  className: string;
  reducedMotion: boolean | null;
}) {
  return (
    <motion.div
      className={`rounded-[3px] border border-white/10 bg-white/[0.065] shadow-inner shadow-white/[0.035] ${className}`}
      animate={reducedMotion ? { opacity: 0.74 } : { opacity: [0.58, 0.9, 0.58] }}
      transition={{
        duration: 1.8,
        repeat: reducedMotion ? 0 : Infinity,
        ease: "easeInOut",
      }}
    />
  );
}

function SavedInvestigationsError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <section
      role="alert"
      className="mx-auto grid w-full max-w-[82rem] gap-space-4 border border-red-300/25 bg-[#071426] p-space-5 text-white"
    >
      <div className="flex items-start gap-space-3">
        <AlertTriangle
          size={20}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-red-200"
        />
        <div className="min-w-0">
          <p className="type-metadata text-red-200">Saved Investigations</p>
          <h1 className="mt-space-2 text-2xl font-semibold text-white">
            Unable to Load Investigations
          </h1>
          <p className="mt-space-2 max-w-2xl text-sm leading-6 text-slate-300">
            {message}
          </p>
        </div>
      </div>
      <div>
        <Button
          variant="secondary"
          onClick={onRetry}
          className="border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]"
        >
          Try Again
        </Button>
      </div>
    </section>
  );
}

function SavedInvestigationsEmpty({
  hasSearch,
  onClearSearch,
}: {
  hasSearch: boolean;
  onClearSearch: () => void;
}) {
  return (
    <section className="grid min-h-64 place-items-center border border-dashed border-white/15 bg-[#071426] px-space-5 py-space-10 text-center text-white">
      <div className="max-w-md">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[4px] border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
          <FolderOpen size={20} aria-hidden="true" />
        </div>
        <h2 className="mt-space-4 text-xl font-semibold text-white">
          {hasSearch ? "No Matching Investigations" : "No Saved Investigations"}
        </h2>
        <p className="mt-space-2 text-sm leading-6 text-slate-300">
          {hasSearch
            ? "No saved investigation title matches your search. Clear the search or try a different title."
            : "Generated investigations appear here after you save them for later review."}
        </p>
        <div className="mt-space-5 flex flex-col justify-center gap-space-3 sm:flex-row">
          {hasSearch ? (
            <Button
              variant="secondary"
              onClick={onClearSearch}
              className="border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]"
            >
              Clear Search
            </Button>
          ) : (
            <Link
              href="/dashboard/labs"
              className="type-button inline-flex h-11 items-center justify-center gap-space-2 whitespace-nowrap rounded-[4px] border border-cyan-300/30 bg-[#0b2033] px-space-4 text-cyan-100 transition-[background-color,border-color,color] hover:border-cyan-200/55 hover:bg-[#10304a] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071426] sm:h-10"
            >
              Generate Investigation
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function DeleteDialog({
  title,
  description,
  detail,
  confirmText,
  loadingText,
  loading,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  detail: string;
  confirmText: string;
  loadingText: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.98 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[4px] border border-white/12 bg-[#071426] p-space-5 text-white shadow-2xl shadow-black/30"
      >
        <div className="flex items-start justify-between gap-space-4">
          <div className="flex min-w-0 items-start gap-space-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] border border-red-300/25 bg-red-950/35 text-red-100">
              <AlertTriangle size={19} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="delete-dialog-title" className="text-lg font-semibold text-white">
                {title}
              </h2>
              <p
                id="delete-dialog-description"
                className="mt-space-1 text-sm leading-6 text-slate-300"
              >
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] text-slate-400 transition-[background-color,color] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-space-5 border border-red-300/25 bg-red-950/25 p-space-4">
          <p className="type-body break-words font-medium text-red-100">{detail}</p>
        </div>

        <div className="mt-space-5 flex flex-col-reverse gap-space-3 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={onCancel}
            className="border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            loading={loading}
            loadingText={loadingText}
            leadingIcon={<Trash2 size={16} aria-hidden="true" />}
          >
            {confirmText}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
