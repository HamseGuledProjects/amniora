"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import BrandLogo from "../BrandLogo";
import Button from "../ui/Button";

export default function PublicErrorPage({
  label,
  title,
  description,
  onRetry,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  label: string;
  title: string;
  description: string;
  onRetry?: () => void;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app-bg px-4 py-10 sm:px-6">
      <div aria-hidden="true" className="absolute inset-0 opacity-35 [background-image:radial-gradient(#bcc8d6_1px,transparent_1px)] [background-size:24px_24px]" />
      <motion.section
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.32, ease: "easeOut" }}
        className="relative z-10 w-full max-w-xl text-center"
        aria-labelledby="public-error-title"
      >
        <Link href="/" aria-label="Amniora home" className="inline-flex outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <BrandLogo size="lg" theme="light" />
        </Link>
        <div className="mt-7 rounded-ui-md border border-border-strong bg-surface p-6 shadow-modal sm:p-8">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-ui-sm bg-primary-subtle text-primary">
            <AlertCircle size={21} aria-hidden="true" />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-primary">{label}</p>
          <h1 id="public-error-title" className="mt-2 text-3xl font-semibold tracking-tight text-text sm:text-4xl">{title}</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-text-secondary">{description}</p>
          <div className="mt-7 flex flex-col-reverse justify-center gap-2 sm:flex-row">
            {secondaryHref && secondaryLabel && (
              <Link href={secondaryHref} className="inline-flex h-10 items-center justify-center gap-2 rounded-ui-sm border border-border bg-surface px-4 text-sm font-semibold text-text shadow-surface outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-focus">
                <ArrowLeft size={15} aria-hidden="true" />{secondaryLabel}
              </Link>
            )}
            {onRetry ? (
              <Button onClick={onRetry} leadingIcon={<RefreshCw size={16} aria-hidden="true" />}>Try again</Button>
            ) : primaryHref && primaryLabel ? (
              <Link href={primaryHref} className="inline-flex h-10 items-center justify-center rounded-ui-sm bg-primary px-4 text-sm font-semibold text-white outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2">{primaryLabel}</Link>
            ) : null}
          </div>
        </div>
      </motion.section>
    </main>
  );
}
