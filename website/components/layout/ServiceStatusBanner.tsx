"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

type ServiceStatusResponse = {
  status?: "healthy" | "degraded" | "unknown";
  message?: string | null;
  detail?: string | null;
  cacheTtlSeconds?: number;
};

const DEFAULT_POLL_MS = 180_000;
const MIN_POLL_MS = 120_000;
const MAX_POLL_MS = 300_000;
const DISMISSAL_STORAGE_KEY = "amniora-service-status-dismissal";
const DISMISSAL_TTL_MS = 60 * 60 * 1000;

function pollMs(cacheTtlSeconds: number | undefined) {
  if (!cacheTtlSeconds || !Number.isFinite(cacheTtlSeconds)) {
    return DEFAULT_POLL_MS;
  }
  return Math.min(
    MAX_POLL_MS,
    Math.max(MIN_POLL_MS, cacheTtlSeconds * 1000),
  );
}

function statusFingerprint(status: ServiceStatusResponse) {
  return [status.status || "unknown", status.message || "", status.detail || ""].join("|");
}

function readDismissal(fingerprint: string, now = Date.now()) {
  try {
    const raw = window.localStorage.getItem(DISMISSAL_STORAGE_KEY);
    if (!raw) return false;

    const parsed = JSON.parse(raw) as { fingerprint?: string; expiresAt?: number };
    if (parsed.fingerprint !== fingerprint || typeof parsed.expiresAt !== "number") {
      return false;
    }

    if (parsed.expiresAt <= now) {
      window.localStorage.removeItem(DISMISSAL_STORAGE_KEY);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function writeDismissal(fingerprint: string, now = Date.now()) {
  try {
    window.localStorage.setItem(
      DISMISSAL_STORAGE_KEY,
      JSON.stringify({ fingerprint, expiresAt: now + DISMISSAL_TTL_MS }),
    );
  } catch {}
}

function clearDismissal() {
  try {
    window.localStorage.removeItem(DISMISSAL_STORAGE_KEY);
  } catch {}
}

export default function ServiceStatusBanner() {
  const [status, setStatus] = useState<ServiceStatusResponse | null>(null);
  const [dismissedFingerprint, setDismissedFingerprint] = useState<string | null>(null);
  const latestStatusRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    async function loadStatus() {
      try {
        const response = await fetch("/api/service-status", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("service_status_unavailable");
        const payload = (await response.json()) as ServiceStatusResponse;
        if (cancelled) return;

        const nextStatus =
          payload.status === "degraded" ||
          payload.status === "healthy" ||
          payload.status === "unknown"
            ? payload.status
            : "unknown";
        const nextPayload = {
          status: nextStatus,
          message:
            nextStatus === "degraded" && typeof payload.message === "string"
              ? payload.message
              : null,
          detail:
            nextStatus === "degraded" && typeof payload.detail === "string"
              ? payload.detail
              : null,
          cacheTtlSeconds: payload.cacheTtlSeconds,
        } satisfies ServiceStatusResponse;

        latestStatusRef.current = nextStatus;
        if (nextStatus === "healthy") {
          clearDismissal();
          setDismissedFingerprint(null);
        } else if (nextStatus === "degraded") {
          const fingerprint = statusFingerprint(nextPayload);
          setDismissedFingerprint(readDismissal(fingerprint) ? fingerprint : null);
        }

        setStatus(nextPayload);
        timeoutId = window.setTimeout(
          loadStatus,
          pollMs(payload.cacheTtlSeconds),
        );
      } catch {
        if (cancelled) return;
        latestStatusRef.current = "unknown";
        setStatus({ status: "unknown" });
        timeoutId = window.setTimeout(loadStatus, DEFAULT_POLL_MS);
      }
    }

    loadStatus();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!status || status.status !== "degraded" || !dismissedFingerprint) return;

    const fingerprint = statusFingerprint(status);
    if (dismissedFingerprint !== fingerprint) return;

    const timeoutId = window.setTimeout(() => {
      if (!readDismissal(fingerprint)) setDismissedFingerprint(null);
    }, DISMISSAL_TTL_MS);

    return () => window.clearTimeout(timeoutId);
  }, [dismissedFingerprint, status]);

  if (status?.status !== "degraded" || !status.message) return null;

  const fingerprint = statusFingerprint(status);
  if (dismissedFingerprint === fingerprint && readDismissal(fingerprint)) return null;

  function dismissWarning() {
    writeDismissal(fingerprint);
    setDismissedFingerprint(fingerprint);
  }

  return (
    <aside
      className="service-status-banner px-3 py-1.5 sm:px-6 sm:py-2"
      role="status"
      aria-live={latestStatusRef.current === "degraded" ? "polite" : "off"}
      aria-label="Account service status"
      data-service-status-banner
    >
      <div className="service-status-banner__inner mx-auto flex w-full items-start justify-between gap-2 text-left sm:items-center sm:gap-space-3">
        <div className="min-w-0 text-center sm:flex sm:flex-1 sm:items-center sm:justify-center sm:gap-space-3">
          <p className="text-xs font-medium leading-4 text-ink sm:text-sm sm:leading-5">
            {status.message}
          </p>
          {status.detail && (
            <p className="mt-0.5 text-xs leading-4 text-text-secondary sm:mt-0 sm:text-sm sm:leading-5">
              {status.detail}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismissWarning}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ui-sm text-warning outline-none transition-colors hover:bg-amber-100/60 hover:text-amber-700 focus-visible:ring-2 focus-visible:ring-focus"
          aria-label="Dismiss service status warning"
        >
          <X size={13} aria-hidden="true" strokeWidth={2.1} />
        </button>
      </div>
    </aside>
  );
}
