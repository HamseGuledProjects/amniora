"use client";

import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import Button from "./Button";

type ErrorStateProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
  secondaryHref?: string;
  secondaryLabel?: string;
  eyebrow?: string;
};

export default function ErrorState({
  title = "We couldn't load this content",
  message = "This may be temporary. Try again in a moment.",
  onRetry,
  secondaryHref = "/dashboard",
  secondaryLabel = "Go to dashboard",
  eyebrow = "Unable to load",
}: ErrorStateProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.section
      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.32, ease: "easeOut" }}
      className="flex min-h-[55vh] items-center justify-center px-4 py-10 sm:px-6"
      aria-labelledby="app-error-title"
    >
      <div className="w-full max-w-xl rounded-ui-md border border-border-strong bg-surface p-6 text-center shadow-surface sm:p-8">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-ui-sm bg-primary-subtle text-primary">
          <AlertCircle size={21} aria-hidden="true" />
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          {eyebrow}
        </p>
        <h1 id="app-error-title" className="mt-2 text-2xl font-semibold tracking-tight text-text sm:text-3xl">
          {title}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-text-secondary">
          {message}
        </p>
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          {secondaryHref && (
            <Link
              href={secondaryHref}
              className="inline-flex h-10 items-center justify-center rounded-ui-sm border border-border bg-surface px-4 text-sm font-semibold text-text shadow-surface outline-none transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
            >
              {secondaryLabel}
            </Link>
          )}
          {onRetry && (
            <Button onClick={onRetry} leadingIcon={<RefreshCw size={16} aria-hidden="true" />}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </motion.section>
  );
}
