"use client";

import Link from "next/link";
import {
  BarChart3,
  Cookie,
  Gauge,
  Megaphone,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";
import { useEffect, useRef, useState } from "react";

type CookiePreferences = {
  essential: true;
  analytics: boolean;
  performance: boolean;
  functional: boolean;
  marketing: boolean;
};

const STORAGE_KEY = "cyberlab-cookie-consent";

const defaultPreferences: CookiePreferences = {
  essential: true,
  analytics: false,
  performance: false,
  functional: false,
  marketing: false,
};

export default function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] =
    useState<CookiePreferences>(defaultPreferences);
  const preferencesDialogRef = useRef<HTMLDivElement>(null);
  const preferencesButtonRef = useRef<HTMLButtonElement>(null);
  const closePreferencesRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const duration = reducedMotion ? 0 : 0.25;
  const [publicNavigationOpen, setPublicNavigationOpen] = useState(false);

  useEffect(() => {
    const savedConsent = localStorage.getItem(STORAGE_KEY);

    if (!savedConsent) {
      const timer = window.setTimeout(() => setIsVisible(true), 800);
      return () => window.clearTimeout(timer);
    }

    try {
      JSON.parse(savedConsent);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      const timer = window.setTimeout(() => setIsVisible(true), 800);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    function syncPublicNavigationState(event?: Event) {
      const nextOpen =
        event instanceof CustomEvent
          ? Boolean(event.detail?.open)
          : document.documentElement.dataset.publicNavigationOpen === "true";
      setPublicNavigationOpen(nextOpen);
      if (nextOpen) setPreferencesOpen(false);
    }

    syncPublicNavigationState();
    window.addEventListener(
      "amniora-public-navigation-open-change",
      syncPublicNavigationState,
    );

    return () => {
      window.removeEventListener(
        "amniora-public-navigation-open-change",
        syncPublicNavigationState,
      );
    };
  }, []);

  useEffect(() => {
    if (!preferencesOpen) return;

    requestAnimationFrame(() => closePreferencesRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreferencesOpen(false);
        requestAnimationFrame(() => preferencesButtonRef.current?.focus());
        return;
      }

      if (event.key !== "Tab") return;

      const focusable =
        preferencesDialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );

      if (!focusable?.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [preferencesOpen]);

  function savePreferences(nextPreferences: CookiePreferences) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...nextPreferences,
        essential: true,
        savedAt: new Date().toISOString(),
      }),
    );

    setPreferences({ ...nextPreferences, essential: true });
    setPreferencesOpen(false);
    setIsVisible(false);
  }

  function acceptAll() {
    savePreferences({
      essential: true,
      analytics: true,
      performance: true,
      functional: true,
      marketing: true,
    });
  }

  function rejectNonEssential() {
    savePreferences(defaultPreferences);
  }

  function closePreferences({ restoreFocus = true } = {}) {
    setPreferencesOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => preferencesButtonRef.current?.focus());
    }
  }

  function togglePreference(
    key: Exclude<keyof CookiePreferences, "essential">,
  ) {
    setPreferences((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  if (publicNavigationOpen) return null;

  return (
    <>
      <AnimatePresence>
        {isVisible && !publicNavigationOpen && (
          <motion.aside
            aria-labelledby="cookie-consent-title"
            initial={
              reducedMotion
                ? { opacity: 1 }
                : { opacity: 0, y: 18, scale: 0.985 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 14, scale: 0.985 }
            }
            transition={{ duration, ease: "easeOut" }}
            className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] z-[100] mx-auto max-h-[calc(100dvh-1.5rem)] max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-sidebar/95 p-4 text-white shadow-modal backdrop-blur-xl sm:bottom-5 sm:p-5"
          >
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ui-sm bg-primary/15 text-blue-300">
                <Cookie size={20} aria-hidden="true" />
              </div>

              <div className="min-w-0 flex-1">
                <h2
                  id="cookie-consent-title"
                  className="text-base font-semibold text-white sm:text-lg"
                >
                  Your privacy choices
                </h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-300">
                  Required cookies keep Amniora secure and working. With your
                  permission, optional cookies can help us understand
                  performance and improve the experience.
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  Learn more in our{" "}
                  <Link
                    href="/privacy"
                    className="font-medium text-blue-300 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    Privacy Policy
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/cookies"
                    className="font-medium text-blue-300 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    Cookie Policy
                  </Link>
                  .
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={acceptAll}
                className="order-1 flex min-h-11 items-center justify-center rounded-ui-sm bg-primary px-4 py-2.5 text-sm font-semibold text-white outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar sm:order-3"
              >
                Accept All
              </button>
              <button
                type="button"
                onClick={rejectNonEssential}
                className="order-2 flex min-h-11 items-center justify-center rounded-ui-sm border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white outline-none transition-colors hover:border-white/30 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
              >
                Reject Non-Essential
              </button>
              <button
                ref={preferencesButtonRef}
                type="button"
                onClick={() => setPreferencesOpen(true)}
                className="order-3 flex min-h-11 items-center justify-center gap-2 rounded-ui-sm border border-white/20 bg-transparent px-4 py-2.5 text-sm font-semibold text-slate-200 outline-none transition-colors hover:border-white/30 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar sm:order-1"
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                Manage Preferences
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isVisible && preferencesOpen && !publicNavigationOpen && (
          <motion.div
            className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-[3px] sm:items-center sm:p-6"
            initial={{ opacity: reducedMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: reducedMotion ? 1 : 0 }}
            transition={{ duration }}
          >
            <motion.button
              type="button"
              aria-label="Close cookie preferences"
              onClick={() => closePreferences()}
              className="absolute inset-0 h-full w-full"
            />

            <motion.div
              ref={preferencesDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cookie-preferences-title"
              aria-describedby="cookie-preferences-description"
              initial={
                reducedMotion
                  ? { opacity: 1 }
                  : { opacity: 0, y: 16, scale: 0.985 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                reducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 12, scale: 0.985 }
              }
              transition={{ duration, ease: "easeOut" }}
              className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface text-text shadow-modal"
            >
              <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                    Privacy controls
                  </p>
                  <h2
                    id="cookie-preferences-title"
                    className="mt-1 text-xl font-semibold tracking-tight text-text"
                  >
                    Cookie preferences
                  </h2>
                  <p
                    id="cookie-preferences-description"
                    className="mt-1.5 text-sm leading-6 text-text-secondary"
                  >
                    Choose which optional categories Amniora may use.
                  </p>
                </div>
                <button
                  ref={closePreferencesRef}
                  type="button"
                  onClick={() => closePreferences()}
                  aria-label="Close cookie preferences"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ui-sm text-text-secondary outline-none transition-colors hover:bg-surface-muted hover:text-text focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <X size={19} aria-hidden="true" />
                </button>
              </div>

              <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain bg-app-bg/60 p-3 sm:p-5">
                <CookieToggle
                  title="Required Cookies"
                  description="Enable authentication, security, sessions and core platform operation."
                  checked
                  disabled
                  icon={<ShieldCheck size={18} aria-hidden="true" />}
                />
                <CookieToggle
                  title="Analytics Cookies"
                  description="Help us understand which parts of Amniora are useful and where journeys can improve."
                  checked={preferences.analytics}
                  onChange={() => togglePreference("analytics")}
                  icon={<BarChart3 size={18} aria-hidden="true" />}
                />
                <CookieToggle
                  title="Performance Cookies"
                  description="Help measure reliability, loading behavior and technical performance."
                  checked={preferences.performance}
                  onChange={() => togglePreference("performance")}
                  icon={<Gauge size={18} aria-hidden="true" />}
                />
                <CookieToggle
                  title="Functional Cookies"
                  description="Remember optional interface choices that make the experience more convenient."
                  checked={preferences.functional}
                  onChange={() => togglePreference("functional")}
                  icon={<Settings2 size={18} aria-hidden="true" />}
                />
                <CookieToggle
                  title="Marketing Cookies"
                  description="Allow campaign measurement if Amniora introduces relevant marketing services."
                  checked={preferences.marketing}
                  onChange={() => togglePreference("marketing")}
                  icon={<Megaphone size={18} aria-hidden="true" />}
                />
              </div>

              <div className="grid gap-2 border-t border-border bg-surface p-4 sm:grid-cols-3 sm:px-6">
                <button
                  type="button"
                  onClick={rejectNonEssential}
                  className="flex min-h-11 items-center justify-center rounded-ui-sm border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-text outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-focus"
                >
                  Reject Non-Essential
                </button>
                <button
                  type="button"
                  onClick={() => savePreferences(preferences)}
                  className="flex min-h-11 items-center justify-center rounded-ui-sm border border-primary bg-primary-subtle px-4 py-2.5 text-sm font-semibold text-primary outline-none transition-colors hover:bg-blue-100 focus-visible:ring-2 focus-visible:ring-focus"
                >
                  Save Preferences
                </button>
                <button
                  type="button"
                  onClick={acceptAll}
                  className="flex min-h-11 items-center justify-center rounded-ui-sm bg-primary px-4 py-2.5 text-sm font-semibold text-white outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus"
                >
                  Accept All
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function CookieToggle({
  title,
  description,
  checked,
  disabled = false,
  onChange,
  icon,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: () => void;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-ui-md border border-border bg-surface p-4 shadow-surface">
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-ui-sm bg-primary-subtle text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">{title}</p>
          <p className="mt-1 text-xs leading-5 text-text-secondary">
            {description}
          </p>
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${title}: ${checked ? "enabled" : "disabled"}`}
        disabled={disabled}
        onClick={onChange}
        className={`relative h-7 w-12 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ${
          checked ? "bg-primary" : "bg-border-strong"
        } ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
