"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import { AuthStatus } from "../components/auth/AuthShell";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

type RedemptionResponse = {
  success?: boolean;
  status?: string;
  beta_access_version?: string;
  retry_after_seconds?: number;
};

type ViewState = "idle" | "submitting" | "error" | "rate_limited" | "success";
type ExitState = "idle" | "pending" | "error";

const REQUEST_TIMEOUT_MS = 15_000;
const REDIRECT_DELAY_MS = 1_600;
const MAX_KEY_LENGTH = 128;

export default function BetaAccessForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stayButtonRef = useRef<HTMLButtonElement>(null);
  const devLogTriggerRef = useRef<HTMLButtonElement>(null);
  const devLogConfirmRef = useRef<HTMLButtonElement>(null);
  const [invitationCode, setInvitationCode] = useState("");
  const [viewState, setViewState] = useState<ViewState>("idle");
  const [message, setMessage] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [feedbackKey, setFeedbackKey] = useState(0);
  const [exitState, setExitState] = useState<ExitState>("idle");
  const [exitError, setExitError] = useState("");
  const [confirmDevelopmentLog, setConfirmDevelopmentLog] = useState(false);

  const isSubmitting = viewState === "submitting";
  const isRateLimited = viewState === "rate_limited" && retryAfter > 0;
  const exitPending = exitState === "pending";
  const formDisabled = isSubmitting || isRateLimited || viewState === "success" || exitPending;

  useEffect(() => {
    if (!isRateLimited) return;

    const countdown = window.setTimeout(() => {
      if (retryAfter <= 1) {
        setRetryAfter(0);
        setViewState("idle");
        setMessage("");
        return;
      }

      setRetryAfter(retryAfter - 1);
    }, 1_000);

    return () => window.clearTimeout(countdown);
  }, [isRateLimited, retryAfter]);

  useEffect(() => {
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!confirmDevelopmentLog) return;

    requestAnimationFrame(() => stayButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !exitPending) {
        setConfirmDevelopmentLog(false);
        requestAnimationFrame(() => devLogTriggerRef.current?.focus());
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = [stayButtonRef.current, devLogConfirmRef.current].filter(Boolean) as HTMLButtonElement[];
      if (!focusable.length) return;
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
  }, [confirmDevelopmentLog, exitPending]);

  function showError(nextMessage: string) {
    setViewState("error");
    setMessage(nextMessage);
    setFeedbackKey((current) => current + 1);
  }

  function completeRedemption() {
    setViewState("success");
    setMessage("");

    redirectTimer.current = setTimeout(
      () => {
        router.replace(returnTo);
        router.refresh();
      },
      reducedMotion ? 800 : REDIRECT_DELAY_MS,
    );
  }

  async function signOutAndNavigate(destination: "/" | "/development-log") {
    if (exitPending) return;
    setExitState("pending");
    setExitError("");
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace(destination);
      router.refresh();
    } catch {
      setExitState("error");
      setExitError("We couldn’t complete sign-out. Please try again.");
    }
  }

  function cancelDevelopmentLogExit() {
    if (exitPending) return;
    setConfirmDevelopmentLog(false);
    requestAnimationFrame(() => devLogTriggerRef.current?.focus());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formDisabled) return;

    setViewState("submitting");
    setMessage("");

    if (invitationCode.trim().length === 0) {
      showError("Enter your private beta key.");
      return;
    }

    if (invitationCode.length > MAX_KEY_LENGTH) {
      showError("The private beta key is too long.");
      return;
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showError("You appear to be offline. Check your connection and try again.");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .rpc("redeem_beta_access", {
          p_invitation_code: invitationCode,
        })
        .abortSignal(controller.signal);

      if (error) {
        if (controller.signal.aborted) {
          showError("The request timed out. Check your connection and try again.");
        } else {
          showError(
            "Beta access is temporarily unavailable. Please try again.",
          );
        }
        return;
      }

      const response = data as RedemptionResponse | null;

      if (
        response?.success === true &&
        ["redeemed", "already_redeemed", "admin_bypass"].includes(
          response.status ?? "",
        )
      ) {
        completeRedemption();
        return;
      }

      if (response?.status === "rate_limited") {
        const waitTime = Number.isFinite(response.retry_after_seconds)
          ? Math.max(1, Math.floor(response.retry_after_seconds ?? 1))
          : 1;

        setRetryAfter(waitTime);
        setViewState("rate_limited");
        setMessage("");
        setFeedbackKey((current) => current + 1);
        return;
      }

      if (response?.status === "invalid_code") {
        showError("The private beta key is invalid.");
        return;
      }

      if (response?.status === "beta_disabled") {
        showError("The private beta is temporarily disabled.");
        return;
      }

      showError("We couldn’t verify your private beta key. Please try again.");
    } catch {
      if (controller.signal.aborted) {
        showError("The request timed out. Check your connection and try again.");
      } else {
        showError(
          "We couldn’t connect to Amniora. Check your connection and try again.",
        );
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return (
    <div className="grid gap-space-5">
      <section
        id="private-beta-key-card"
        aria-labelledby="private-beta-key-title"
        className="border-y border-border bg-white px-space-4 py-space-5 sm:px-space-5"
      >
        <div>
          <h2 id="private-beta-key-title" className="text-lg font-semibold text-text">
            Enter your private beta key.
          </h2>
          <p className="mt-space-1 text-sm leading-6 text-text-secondary">
            If you already have a key, enter it below to activate access.
          </p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {viewState === "success" ? (
            <motion.div
              key="success"
              initial={reducedMotion ? { opacity: 1 } : { opacity: 0.98 }}
              animate={{ opacity: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0.98 }}
              transition={{ duration: reducedMotion ? 0 : 0.18 }}
              className="mt-space-5 border border-success/30 bg-success-subtle px-space-5 py-space-5 text-center"
              role="status"
              aria-live="polite"
            >
              <CheckCircle2
                aria-hidden="true"
                className="mx-auto h-8 w-8 text-success"
              />
              <p className="mt-space-3 font-semibold text-success">
                Beta access granted.
              </p>
              <p className="mt-space-1 text-sm text-text-secondary">
                Welcome to Amniora. Taking you to your dashboard…
              </p>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              initial={{ opacity: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0.98 }}
              transition={{ duration: reducedMotion ? 0 : 0.16 }}
              onSubmit={handleSubmit}
              className="mt-space-5 grid gap-space-4"
              noValidate
            >
              <div>
                <label
                  htmlFor="private-beta-key"
                  className="text-sm font-medium text-text"
                >
                  Private beta key
                </label>
                <Input
                  id="private-beta-key"
                  name="private-beta-key"
                  value={invitationCode}
                  onChange={(event) => setInvitationCode(event.target.value)}
                  placeholder="Enter your access key"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="go"
                  maxLength={MAX_KEY_LENGTH}
                  disabled={formDisabled}
                  fieldState={
                    viewState === "error" || isRateLimited
                      ? "error"
                      : "default"
                  }
                  aria-describedby="beta-access-feedback beta-auth-state"
                  className="mt-space-2 h-12 text-base sm:h-11 sm:text-base"
                />
                <p id="beta-auth-state" className="sr-only">
                  You are signed in and can redeem a private beta key.
                </p>
              </div>

              <div
                id="beta-access-feedback"
                aria-live="polite"
                aria-atomic="true"
              >
                <AnimatePresence mode="wait">
                  {viewState === "error" && message ? (
                    <motion.div
                      key={`error-${feedbackKey}`}
                      initial={{ opacity: 0.98 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0.98 }}
                      transition={{ duration: reducedMotion ? 0 : 0.16 }}
                    >
                      <AuthStatus variant="error">{message}</AuthStatus>
                    </motion.div>
                  ) : isRateLimited ? (
                    <motion.div
                      key={`rate-${feedbackKey}`}
                      initial={{ opacity: 0.98 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0.98 }}
                      className="rounded-ui-sm border border-warning/30 bg-warning-subtle px-3 py-2.5 text-sm leading-6 text-warning"
                      role="status"
                    >
                      Too many attempts. Try again in {formatWaitTime(retryAfter)}.
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              <Button
                type="submit"
                size="lg"
                loading={isSubmitting}
                loadingText="Verifying key…"
                disabled={formDisabled}
                className="w-full sm:w-auto"
              >
                Continue
              </Button>
            </motion.form>
          )}
        </AnimatePresence>
      </section>

      <aside className="grid gap-space-3 border-y border-border bg-paper-muted px-space-4 py-space-4 sm:px-space-5">
        <h2 className="text-base font-semibold text-text">Leave private beta access</h2>
        <p className="text-sm leading-6 text-text-secondary">
          Going back to the public site will sign you out of this browser session.
        </p>
        <div className="grid gap-space-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="secondary"
            loading={exitPending && !confirmDevelopmentLog}
            loadingText="Signing out…"
            leadingIcon={<LogOut size={16} aria-hidden="true" />}
            onClick={() => signOutAndNavigate("/")}
          >
            Log out and go back
          </Button>
          <Button
            ref={devLogTriggerRef}
            type="button"
            variant="secondary"
            disabled={exitPending}
            onClick={() => {
              setExitError("");
              setConfirmDevelopmentLog(true);
            }}
          >
            View Development Log
          </Button>
        </div>
        {exitState === "error" && exitError ? (
          <AuthStatus variant="error">{exitError}</AuthStatus>
        ) : null}
      </aside>

      <AnimatePresence>
        {confirmDevelopmentLog ? (
          <motion.div
            className="fixed inset-0 z-[100] grid place-items-center bg-ink/55 px-4"
            role="presentation"
            initial={{ opacity: reducedMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: reducedMotion ? 1 : 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.16 }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="beta-exit-dialog-title"
              aria-describedby="beta-exit-dialog-description"
              className="w-full max-w-md border border-border-strong bg-paper p-space-5 text-text shadow-modal"
              initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
              transition={{ duration: reducedMotion ? 0 : 0.16 }}
            >
              <h2 id="beta-exit-dialog-title" className="text-xl font-semibold text-heading">
                Leaving Beta Access will sign you out.
              </h2>
              <p id="beta-exit-dialog-description" className="mt-space-3 text-sm leading-6 text-text-secondary">
                You can stay here to keep redeeming your key, or sign out and open the public Development Log.
              </p>
              <div className="mt-space-5 grid gap-space-2 sm:grid-cols-2">
                <Button
                  ref={stayButtonRef}
                  type="button"
                  variant="secondary"
                  disabled={exitPending}
                  onClick={cancelDevelopmentLogExit}
                >
                  Stay here
                </Button>
                <Button
                  ref={devLogConfirmRef}
                  type="button"
                  loading={exitPending}
                  loadingText="Signing out…"
                  onClick={() => signOutAndNavigate("/development-log")}
                >
                  Log out and view Development Log
                </Button>
              </div>
              {exitState === "error" && exitError ? (
                <div className="mt-space-4">
                  <AuthStatus variant="error">{exitError}</AuthStatus>
                </div>
              ) : null}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function formatWaitTime(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.ceil(totalSeconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}