"use client";

import { motion, useReducedMotion } from "framer-motion";

type SkeletonProps = {
  className?: string;
  rounded?: string;
};

export function SkeletonBlock({
  className = "",
  rounded = "rounded-[4px]",
}: SkeletonProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={`border border-white/10 bg-white/[0.065] shadow-inner shadow-white/[0.035] ${rounded} ${className}`}
      animate={reducedMotion ? { opacity: 0.74 } : { opacity: [0.64, 0.9, 0.64] }}
      transition={{
        duration: 1.8,
        repeat: reducedMotion ? 0 : Infinity,
        ease: "easeInOut",
      }}
    />
  );
}

export function PageSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-8"
    >
      <div className="space-y-4">
        <SkeletonBlock className="h-4 w-40" rounded="rounded-full" />
        <SkeletonBlock className="h-12 w-80 max-w-full" />
        <SkeletonBlock className="h-5 w-[34rem] max-w-full" rounded="rounded-full" />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    </motion.div>
  );
}

export function StatSkeleton() {
  return (
    <div className="rounded-[4px] border border-white/10 bg-white/[0.035] p-space-5 shadow-sm shadow-black/10">
      <SkeletonBlock className="h-10 w-10 mb-5" rounded="rounded-[4px]" />
      <SkeletonBlock className="h-4 w-24 mb-3" rounded="rounded-full" />
      <SkeletonBlock className="h-8 w-20" rounded="rounded-[4px]" />
    </div>
  );
}

export function PanelSkeleton() {
  return (
    <div className="rounded-[4px] border border-white/10 bg-white/[0.035] p-space-5 shadow-sm shadow-black/10">
      <SkeletonBlock className="h-6 w-44 mb-5" rounded="rounded-full" />
      <SkeletonBlock className="h-4 w-full mb-3" rounded="rounded-full" />
      <SkeletonBlock className="h-4 w-5/6 mb-6" rounded="rounded-full" />
      <SkeletonBlock className="h-40 w-full" />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-[4px] border border-white/10 bg-white/[0.035] p-space-5 shadow-sm shadow-black/10">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <SkeletonBlock className="h-12 w-12" rounded="rounded-[4px]" />

          <div className="space-y-3">
            <SkeletonBlock className="h-5 w-44" rounded="rounded-full" />
            <SkeletonBlock className="h-4 w-64 max-w-full" rounded="rounded-full" />
          </div>
        </div>

        <SkeletonBlock className="h-6 w-16" rounded="rounded-full" />
      </div>

      <SkeletonBlock className="mt-5 h-4 w-full" rounded="rounded-full" />
      <SkeletonBlock className="mt-3 h-4 w-4/5" rounded="rounded-full" />
      <SkeletonBlock className="mt-6 h-3 w-full" rounded="rounded-full" />
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-5">
      {Array.from({ length: rows }).map((_, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.04 }}
        >
          <CardSkeleton />
        </motion.div>
      ))}
    </div>
  );
}

export function RoadmapSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-space-6"
      data-roadmap-loading="ordered-learning-path"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading roadmap</span>
      <div className="space-y-space-3">
        <SkeletonBlock className="h-4 w-44" rounded="rounded-full" />
        <SkeletonBlock className="h-10 w-96 max-w-full" rounded="rounded-[4px]" />
        <SkeletonBlock className="h-5 w-[34rem] max-w-full" rounded="rounded-full" />
      </div>

      <div className="grid grid-cols-2 gap-space-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="rounded-[4px] border border-white/10 bg-[#071426] p-space-4 shadow-sm shadow-black/10"
          >
            <SkeletonBlock className="h-4 w-24" rounded="rounded-full" />
            <SkeletonBlock className="mt-space-3 h-7 w-2/3" rounded="rounded-[4px]" />
          </div>
        ))}
      </div>

      <div className="rounded-[4px] border border-white/10 bg-[#071426] p-space-4 shadow-sm shadow-black/10">
        <SkeletonBlock className="h-4 w-64 max-w-full" rounded="rounded-full" />
        <SkeletonBlock className="mt-space-3 h-2 w-full" rounded="rounded-full" />
      </div>

      <div className="grid items-start gap-space-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-[4px] border border-white/10 bg-[#071426] shadow-sm shadow-black/10">
          <div className="border-b border-white/10 bg-[#061222] p-space-5">
            <SkeletonBlock className="h-6 w-44" rounded="rounded-[4px]" />
          </div>
          <div className="space-y-space-5 p-space-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex gap-space-4">
                <SkeletonBlock className="h-9 w-9 shrink-0" rounded="rounded-full" />
                <div className="flex-1 rounded-[4px] border border-white/10 bg-white/[0.025] p-space-4">
                  <SkeletonBlock className="h-5 w-1/2" rounded="rounded-full" />
                  <SkeletonBlock className="mt-space-3 h-4 w-full" rounded="rounded-full" />
                  <SkeletonBlock className="mt-space-2 h-4 w-4/5" rounded="rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-space-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-[4px] border border-white/10 bg-[#071426] p-space-5 shadow-sm shadow-black/10"
            >
              <SkeletonBlock className="h-4 w-32" rounded="rounded-full" />
              <SkeletonBlock className="mt-space-3 h-5 w-44 max-w-full" rounded="rounded-[4px]" />
              <SkeletonBlock className="mt-space-4 h-3 w-full" rounded="rounded-full" />
              <SkeletonBlock className="mt-space-2 h-3 w-4/5" rounded="rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
export function SavedLabsSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-space-6"
    >
      <div className="space-y-space-3">
        <SkeletonBlock className="h-4 w-36" rounded="rounded-full" />
        <SkeletonBlock className="h-10 w-96 max-w-full" rounded="rounded-ui-sm" />
        <SkeletonBlock className="h-5 w-[36rem] max-w-full" rounded="rounded-full" />
      </div>

      <div className="rounded-ui-md border border-border bg-surface p-space-4 shadow-surface">
        <SkeletonBlock className="h-10 w-full max-w-md" rounded="rounded-ui-sm" />
      </div>

      <div className="grid gap-space-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-ui-md border border-border bg-surface shadow-surface"
          >
            <div className="flex gap-space-4 p-space-5">
              <SkeletonBlock className="h-10 w-10 shrink-0" rounded="rounded-ui-sm" />
              <div className="flex-1 space-y-space-3">
                <SkeletonBlock className="h-5 w-4/5" rounded="rounded-full" />
                <SkeletonBlock className="h-4 w-2/5" rounded="rounded-full" />
              </div>
            </div>
            <div className="flex justify-between border-t border-border bg-surface-muted px-space-5 py-space-3">
              <SkeletonBlock className="h-8 w-20" rounded="rounded-ui-sm" />
              <SkeletonBlock className="h-8 w-24" rounded="rounded-ui-sm" />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function LabDetailSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-space-5 bg-[#0c1828] pb-space-6 text-white"
      data-saved-investigation-loading="dark-workspace"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <section className="overflow-hidden rounded-[4px] border border-white/10 bg-[#071426] shadow-[0_18px_42px_rgba(0,0,0,0.22)]" aria-label="Loading investigation identity">
        <div className="border-b border-white/10 bg-[#061222] px-space-4 py-space-3 sm:px-space-5">
          <SkeletonBlock className="h-4 w-48 max-w-full" rounded="rounded-[3px]" />
        </div>
        <div className="grid min-w-0 gap-space-5 px-space-4 py-space-5 sm:px-space-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0 space-y-space-3">
            <SkeletonBlock className="h-3 w-40" rounded="rounded-full" />
            <SkeletonBlock className="h-9 w-[36rem] max-w-full" rounded="rounded-[4px]" />
            <div className="grid gap-space-2 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="border-l border-white/10 pl-space-3">
                  <SkeletonBlock className="h-3 w-16" rounded="rounded-full" />
                  <SkeletonBlock className="mt-space-2 h-5 w-28 max-w-full" rounded="rounded-[3px]" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid min-w-0 gap-space-2 sm:grid-cols-2 lg:min-w-[22rem]">
            <SkeletonBlock className="h-10 w-full" rounded="rounded-[4px]" />
            <SkeletonBlock className="h-10 w-full" rounded="rounded-[4px]" />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426]" aria-label="Loading case overview">
        <div className="flex items-center gap-space-3 border-b border-white/10 bg-[#061222] px-space-4 py-space-4 sm:px-space-5">
          <SkeletonBlock className="h-8 w-8 shrink-0" rounded="rounded-[2px]" />
          <div className="space-y-space-2">
            <SkeletonBlock className="h-3 w-36" rounded="rounded-full" />
            <SkeletonBlock className="h-6 w-40" rounded="rounded-[4px]" />
          </div>
        </div>
        <div className="grid divide-y divide-white/10 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="space-y-space-3 p-space-5">
            <SkeletonBlock className="h-4 w-28" rounded="rounded-full" />
            <SkeletonBlock className="h-4 w-full" rounded="rounded-full" />
            <SkeletonBlock className="h-4 w-5/6" rounded="rounded-full" />
          </div>
          <div className="space-y-space-3 p-space-5">
            <SkeletonBlock className="h-4 w-28" rounded="rounded-full" />
            <SkeletonBlock className="h-4 w-full" rounded="rounded-full" />
            <SkeletonBlock className="h-4 w-4/5" rounded="rounded-full" />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426]" aria-label="Loading task focus">
        <div className="flex items-center gap-space-3 border-b border-white/10 bg-[#061222] px-space-4 py-space-4 sm:px-space-5">
          <SkeletonBlock className="h-8 w-8 shrink-0" rounded="rounded-[2px]" />
          <SkeletonBlock className="h-8 w-8 shrink-0" rounded="rounded-[3px]" />
          <div className="space-y-space-2">
            <SkeletonBlock className="h-3 w-24" rounded="rounded-full" />
            <SkeletonBlock className="h-6 w-52 max-w-full" rounded="rounded-[4px]" />
          </div>
        </div>
        <div className="grid min-w-0 gap-space-4 p-space-5 lg:grid-cols-[minmax(12rem,24%)_minmax(0,1fr)] xl:grid-cols-[minmax(14rem,26%)_minmax(0,1fr)]">
          <div className="hidden overflow-hidden rounded-[4px] border border-white/10 bg-[#061222] lg:block">
            <div className="border-b border-white/10 p-space-3">
              <SkeletonBlock className="h-3 w-20" rounded="rounded-full" />
              <SkeletonBlock className="mt-space-2 h-3 w-32" rounded="rounded-full" />
            </div>
            <div className="divide-y divide-white/10">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-space-3 p-space-3">
                  <SkeletonBlock className="h-3 w-5" rounded="rounded-full" />
                  <div className="space-y-space-2">
                    <SkeletonBlock className="h-3 w-24" rounded="rounded-full" />
                    <SkeletonBlock className="h-4 w-full" rounded="rounded-[3px]" />
                    <SkeletonBlock className="h-3 w-20" rounded="rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-space-4 overflow-hidden rounded-[4px] border border-white/10 bg-[#071426]">
            <div className="border-b border-white/10 bg-[#061222] p-space-4 sm:p-space-5">
              <SkeletonBlock className="h-9 w-9" rounded="rounded-[3px]" />
              <SkeletonBlock className="mt-space-3 h-5 w-64 max-w-full" rounded="rounded-[4px]" />
            </div>
            <div className="space-y-space-4 p-space-4 sm:p-space-5">
              <div className="grid gap-space-3 lg:grid-cols-2">
                <SkeletonBlock className="h-28 w-full" rounded="rounded-[4px]" />
                <SkeletonBlock className="h-28 w-full" rounded="rounded-[4px]" />
              </div>
              <SkeletonBlock className="h-14 w-full" rounded="rounded-[4px]" />
              <SkeletonBlock className="h-32 w-full" rounded="rounded-[4px]" />
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426]" aria-label="Loading evidence library">
        <div className="flex items-center gap-space-3 border-b border-white/10 bg-[#061222] px-space-4 py-space-4 sm:px-space-5">
          <SkeletonBlock className="h-8 w-8 shrink-0" rounded="rounded-[2px]" />
          <SkeletonBlock className="h-6 w-48 max-w-full" rounded="rounded-[4px]" />
        </div>
        <div className="divide-y divide-white/10 p-space-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="grid gap-space-3 py-space-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="flex min-w-0 items-center gap-space-3">
                <SkeletonBlock className="h-9 w-9 shrink-0" rounded="rounded-[3px]" />
                <div className="min-w-0 flex-1 space-y-space-2">
                  <SkeletonBlock className="h-4 w-48 max-w-full" rounded="rounded-full" />
                  <SkeletonBlock className="h-3 w-full max-w-sm" rounded="rounded-full" />
                </div>
              </div>
              <SkeletonBlock className="h-7 w-20" rounded="rounded-[3px]" />
            </div>
          ))}
        </div>
      </section>
    </motion.div>
  );
}
export function DashboardSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mx-auto grid w-full min-w-0 max-w-[82rem] gap-space-7 text-white motion-reduce:transform-none sm:gap-space-8"
      data-dashboard-loading="authenticated"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <section className="grid min-w-0 gap-space-3 sm:gap-space-4" aria-label="Loading current investigation">
        <div className="grid min-w-0 gap-space-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-space-5">
          <div className="space-y-space-2">
            <SkeletonBlock className="h-3 w-28" rounded="rounded-full" />
            <SkeletonBlock className="h-7 w-80 max-w-full" rounded="rounded-[4px]" />
            <SkeletonBlock className="h-4 w-[34rem] max-w-full" rounded="rounded-full" />
          </div>
          <SkeletonBlock className="h-10 w-full sm:w-52" rounded="rounded-[5px]" />
        </div>

        <div className="overflow-hidden rounded-[3px] border-y border-cyan-300/20 bg-[#071426] sm:border-x">
          <div className="grid min-w-0 gap-space-4 p-space-4 sm:p-space-5 lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-end lg:p-space-6">
            <div className="space-y-space-3">
              <SkeletonBlock className="h-3 w-56 max-w-full" rounded="rounded-full" />
              <SkeletonBlock className="h-10 w-[36rem] max-w-full" rounded="rounded-[4px]" />
              <SkeletonBlock className="h-4 w-[28rem] max-w-full" rounded="rounded-full" />
            </div>
            <SkeletonBlock className="h-10 w-full sm:w-52" rounded="rounded-[5px]" />
          </div>
          <div className="grid min-w-0 grid-cols-2 border-t border-white/10 bg-white/[0.025] sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="min-w-0 border-b border-white/10 px-space-3 py-space-3 sm:border-b-0 sm:border-r sm:px-space-5 last:sm:border-r-0">
                <SkeletonBlock className="h-3 w-20" rounded="rounded-full" />
                <SkeletonBlock className="mt-space-2 h-5 w-28 max-w-full" rounded="rounded-[4px]" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#0b1829]/55" aria-label="Loading investigation queue">
        <div className="border-b border-white/10 px-space-1 py-space-4 sm:px-space-3 sm:py-space-5">
          <SkeletonBlock className="h-3 w-64 max-w-full" rounded="rounded-full" />
          <SkeletonBlock className="mt-space-3 h-6 w-56 max-w-full" rounded="rounded-[4px]" />
        </div>
        <div className="divide-y divide-white/10">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="grid gap-space-2 px-space-2 py-space-3.5 sm:px-space-3 md:grid-cols-[minmax(0,1.5fr)_7.5rem_7.5rem_8.5rem] md:items-center md:gap-space-4">
              <div className="flex min-w-0 items-start gap-space-3">
                <SkeletonBlock className="h-8 w-8 shrink-0" rounded="rounded-[3px]" />
                <div className="min-w-0 flex-1 space-y-space-2">
                  <SkeletonBlock className="h-4 w-4/5" rounded="rounded-full" />
                  <SkeletonBlock className="h-3 w-2/5 md:hidden" rounded="rounded-full" />
                </div>
              </div>
              <SkeletonBlock className="hidden h-4 w-24 md:block" rounded="rounded-full" />
              <SkeletonBlock className="h-5 w-24" rounded="rounded-full" />
              <SkeletonBlock className="hidden h-4 w-28 md:block" rounded="rounded-full" />
            </div>
          ))}
        </div>
      </section>

      <section className="grid min-w-0 gap-space-5 xl:grid-cols-[minmax(0,0.64fr)_minmax(19rem,0.36fr)] xl:gap-space-7" aria-label="Loading development context">
        <div className="border-y border-white/15 py-space-5 sm:py-space-6 xl:pr-space-7">
          <SkeletonBlock className="h-3 w-56 max-w-full" rounded="rounded-full" />
          <SkeletonBlock className="mt-space-3 h-6 w-52 max-w-full" rounded="rounded-[4px]" />
          <SkeletonBlock className="mt-space-5 h-24 w-full" rounded="rounded-[4px]" />
          <SkeletonBlock className="mt-space-4 h-14 w-full" rounded="rounded-[4px]" />
        </div>
        <div className="grid min-w-0 gap-space-4 xl:border-l xl:border-white/10 xl:pl-space-6">
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      </section>
    </motion.div>
  );
}

export function ProgressSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto grid w-full min-w-0 max-w-[82rem] gap-space-7 text-white motion-reduce:transform-none sm:gap-space-8"
      data-progress-loading="dark-learning-record"
    >
      <div className="grid min-w-0 gap-space-3 border-b border-white/[0.08] pb-space-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0 space-y-space-3">
          <SkeletonBlock className="h-3 w-28 bg-[#0b1829]/70" rounded="rounded-[3px]" />
          <SkeletonBlock className="h-9 w-72 max-w-full bg-[#0b1829]/70" rounded="rounded-[3px]" />
          <SkeletonBlock className="h-4 w-[32rem] max-w-full bg-[#0b1829]/70" rounded="rounded-[3px]" />
        </div>
        <SkeletonBlock className="h-6 w-24 bg-[#0b1829]/70" rounded="rounded-[3px]" />
      </div>

      <section className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426]">
        <div className="p-space-5">
          <SkeletonBlock className="h-3 w-36 bg-[#0b1829]/70" rounded="rounded-[3px]" />
          <SkeletonBlock className="mt-space-3 h-6 w-44 bg-[#0b1829]/70" rounded="rounded-[3px]" />
        </div>
        <div className="grid grid-cols-2 border-t border-white/[0.08] sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="border-b border-r border-white/[0.08] p-space-4 last:border-r-0 even:border-r-0 sm:even:border-r sm:last:border-r-0 sm:[&:nth-child(n+3)]:border-b-0">
              <SkeletonBlock className="h-3 w-24 bg-[#0b1829]/70" rounded="rounded-[3px]" />
              <SkeletonBlock className="mt-space-3 h-7 w-20 bg-[#0b1829]/70" rounded="rounded-[3px]" />
              <SkeletonBlock className="mt-space-2 h-3 w-28 bg-[#0b1829]/70" rounded="rounded-[3px]" />
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-space-6 xl:grid-cols-[minmax(0,0.53fr)_minmax(0,0.47fr)]">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="rounded-[3px] border border-cyan-100/12 bg-[#071426] p-space-5"
          >
            <SkeletonBlock className="h-3 w-32 bg-[#0b1829]/70" rounded="rounded-[3px]" />
            <SkeletonBlock className="mt-space-3 h-6 w-44 bg-[#0b1829]/70" rounded="rounded-[3px]" />
            <div className="mt-space-5 grid gap-space-4 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, itemIndex) => (
                <div key={itemIndex}>
                  <SkeletonBlock className="h-3 w-20 bg-[#0b1829]/70" rounded="rounded-[3px]" />
                  <SkeletonBlock className="mt-2 h-6 w-16 bg-[#0b1829]/70" rounded="rounded-[3px]" />
                </div>
              ))}
            </div>
            <SkeletonBlock className="mt-space-5 h-1.5 w-full bg-slate-950/70" rounded="rounded-full" />
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-[3px] border border-cyan-100/12 bg-[#071426]">
        <div className="flex items-start justify-between gap-space-6 p-space-5">
          <div className="space-y-space-3">
            <SkeletonBlock className="h-3 w-32 bg-[#0b1829]/70" rounded="rounded-[3px]" />
            <SkeletonBlock className="h-6 w-48 bg-[#0b1829]/70" rounded="rounded-[3px]" />
          </div>
          <SkeletonBlock className="hidden h-6 w-32 bg-[#0b1829]/70 sm:block" rounded="rounded-[3px]" />
        </div>
        <div className="border-t border-white/[0.08]">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="grid gap-space-3 border-b border-white/[0.08] p-space-4 last:border-b-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(9rem,0.55fr)_minmax(8rem,0.45fr)] sm:items-center sm:p-space-5">
              <div className="flex gap-space-3">
                <SkeletonBlock className="h-9 w-9 shrink-0 bg-[#0b1829]/70" rounded="rounded-[3px]" />
                <div className="min-w-0 flex-1">
                  <SkeletonBlock className="h-4 w-44 max-w-full bg-[#0b1829]/70" rounded="rounded-[3px]" />
                  <SkeletonBlock className="mt-space-2 h-4 w-full bg-[#0b1829]/70" rounded="rounded-[3px]" />
                </div>
              </div>
              <SkeletonBlock className="h-4 w-28 bg-[#0b1829]/70" rounded="rounded-[3px]" />
              <SkeletonBlock className="h-5 w-20 bg-[#0b1829]/70" rounded="rounded-[3px]" />
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-start gap-space-4 rounded-[3px] border border-white/[0.08] bg-white/[0.03] p-space-4">
        <SkeletonBlock className="h-9 w-9 shrink-0 bg-[#0b1829]/70" rounded="rounded-[3px]" />
        <div className="min-w-0 flex-1">
          <SkeletonBlock className="h-3 w-36 bg-[#0b1829]/70" rounded="rounded-[3px]" />
          <SkeletonBlock className="mt-space-2 h-4 w-72 max-w-full bg-[#0b1829]/70" rounded="rounded-[3px]" />
          <SkeletonBlock className="mt-space-2 h-4 w-[34rem] max-w-full bg-[#0b1829]/70" rounded="rounded-[3px]" />
        </div>
      </div>
    </motion.div>
  );
}
export function SettingsSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      data-settings-loading="account-preferences"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading settings</span>
      <div className="space-y-4">
        <SkeletonBlock className="h-4 w-32" rounded="rounded-full" />
        <SkeletonBlock className="h-12 w-80 max-w-full" rounded="rounded-[4px]" />
        <SkeletonBlock className="h-5 w-[38rem] max-w-full" rounded="rounded-full" />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex gap-1 overflow-hidden pb-1 lg:flex-col">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonBlock
              key={index}
              className="h-9 w-28 shrink-0 lg:w-full"
              rounded="rounded-[4px]"
            />
          ))}
        </div>

        <div className="overflow-hidden rounded-[4px] border border-white/10 bg-[#071426]">
          <div className="flex items-start gap-3 border-b border-white/10 bg-[#061222] px-4 py-4 sm:px-5">
            <SkeletonBlock className="h-9 w-9 shrink-0" rounded="rounded-[3px]" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-32" rounded="rounded-full" />
              <SkeletonBlock className="h-3 w-80 max-w-full" rounded="rounded-full" />
            </div>
          </div>
          <div className="grid max-w-2xl gap-5 p-4 sm:p-5">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index}>
                <SkeletonBlock className="h-3 w-24" rounded="rounded-full" />
                <SkeletonBlock className="mt-2 h-10 w-full" rounded="rounded-[4px]" />
              </div>
            ))}
            <div className="grid divide-y divide-white/10 rounded-[3px] border border-white/10 bg-white/[0.025] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="px-4 py-3">
                  <SkeletonBlock className="h-3 w-16" rounded="rounded-full" />
                  <SkeletonBlock className="mt-2 h-4 w-24" rounded="rounded-[3px]" />
                </div>
              ))}
            </div>
            <SkeletonBlock className="h-10 w-32" rounded="rounded-[4px]" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
