"use client";

import type { ReactNode } from "react";
import { FileSearch, KeyRound, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import BrandLogo from "../BrandLogo";
import PortfolioDemoBanner from "@/components/layout/PortfolioDemoBanner";

const authProofRows = [
  [FileSearch, "Hands-on practice", "Work through investigations using synthetic evidence."],
  [ShieldCheck, "Private beta", "Use synthetic, non-sensitive information only."],
  [KeyRound, "Account access", "Sign in or recover your account securely."],
] as const;

export function AuthHeader({
  title,
  description,
  centered = false,
}: {
  title: string;
  description: string;
  centered?: boolean;
}) {
  return (
    <header className={centered ? "text-center" : "text-left"}>
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-primary">Amniora account</p>
      <h1 className="mt-space-3 text-[1.85rem] font-semibold leading-9 tracking-tight text-heading sm:text-[2.15rem] sm:leading-10">
        {title}
      </h1>
      <p className="mt-space-3 text-sm leading-6 text-text-secondary">
        {description}
      </p>
    </header>
  );
}

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <main className="auth-page-shell relative min-h-screen overflow-hidden px-4 py-8 text-text sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center gap-space-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(24rem,0.72fr)]">
        <motion.aside
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
          className="auth-proof-shell hidden p-space-6 text-white lg:block"
          aria-label="Amniora account context"
        >
          <BrandLogo size="lg" theme="dark" />
          <p className="mt-space-8 font-mono text-xs uppercase tracking-[0.18em] text-blue-100/68">Hands-on cybersecurity learning</p>
          <h2 className="mt-space-3 max-w-lg text-4xl font-semibold leading-tight tracking-[-0.012em] text-white">
            Practise investigating cybersecurity incidents.
          </h2>
          <p className="mt-space-4 max-w-xl text-sm leading-7 text-blue-50/76">
            Sign in, create an account or recover access to continue learning with Amniora.
          </p>
          <div className="mt-space-8 border-y border-white/15">
            {authProofRows.map(([Icon, title, text]) => (
              <div key={title} className="auth-proof-row grid grid-cols-[auto_minmax(0,1fr)] gap-space-3">
                <Icon size={18} className="mt-1 text-blue-100" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-white">{title}</h3>
                  <p className="mt-space-1 text-sm leading-6 text-blue-50/70">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.aside>

        <motion.section
          initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.36, delay: reducedMotion ? 0 : 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full"
        >
          <div className="mb-space-5 lg:hidden">
            <BrandLogo size="md" theme="dark" className="auth-mobile-brand" />
            <p className="mt-space-3 border-l-2 border-blue-100/40 pl-space-3 text-sm leading-6 text-blue-50/78">
              Synthetic practice only. Do not enter sensitive or real-world information.
            </p>
          </div>
          <div className="auth-form-panel p-space-5 sm:p-space-7">
            <AuthHeader title={title} description={description} />
            {children}
          </div>
        </motion.section>
      </div>
    </main>
  );
}

export function AuthStatus({
  variant,
  children,
}: {
  variant: "error" | "success";
  children: ReactNode;
}) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`rounded-ui-sm border px-3 py-2.5 text-sm leading-6 ${
        variant === "error"
          ? "border-error/30 bg-error-subtle text-error"
          : "border-success/30 bg-success-subtle text-success"
      }`}
    >
      {children}
    </div>
  );
}

export function AuthLoadingState() {
  return (
    <>
    <PortfolioDemoBanner />
    <main className="flex min-h-screen min-h-dvh items-center justify-center bg-[#0c1828] px-4 text-white" data-authenticated-loading-shell>
      <div className="w-full max-w-sm border-y border-white/15 bg-[#071426] px-space-5 py-space-6 text-center sm:border-x" role="status" aria-live="polite" aria-busy="true">
        <BrandLogo size="md" theme="dark" className="justify-center" />
        <h1 className="mt-space-5 text-xl font-semibold tracking-normal text-white">
          Loading sample workspace…
        </h1>
        <p className="mt-space-2 text-sm leading-6 text-slate-300">
          Preparing the fictional learner profile and local examples.
        </p>
        <div className="mt-space-4 flex justify-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-2 w-2 animate-pulse rounded-full bg-cyan-200/70 motion-reduce:animate-none"
              style={{ animationDelay: `${dot * 140}ms` }}
            />
          ))}
        </div>
      </div>
    </main>
    </>
  );
}
