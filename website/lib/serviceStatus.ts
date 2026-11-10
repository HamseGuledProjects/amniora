export type SupabaseStatusLevel = "healthy" | "degraded" | "unknown";

export type ServiceStatusSummary = {
  status: SupabaseStatusLevel;
  message: string | null;
  detail: string | null;
  source: "official_status" | "project_health" | "none";
  checkedAt: string;
  cacheTtlSeconds: number;
};

type StatuspageComponent = {
  name?: string;
  status?: string;
};

type StatuspageIncident = {
  name?: string;
  impact?: string;
  status?: string;
  components?: StatuspageComponent[];
};

type StatuspageSummary = {
  components?: StatuspageComponent[];
  incidents?: StatuspageIncident[];
  status?: {
    indicator?: string;
  };
};

type ProjectProbeResult = "healthy" | "infrastructure_failure" | "unknown";

const STATUSPAGE_SUMMARY_URL =
  "https://status.supabase.com/api/v2/summary.json";
const CACHE_TTL_MS = 180_000;
const STATUS_TIMEOUT_MS = 3_500;
const PROJECT_HEALTH_TIMEOUT_MS = 2_500;
const PROJECT_FAILURE_STREAK_THRESHOLD = 2;
const HEALTH_MESSAGE =
  "Some account features are temporarily unavailable due to an upstream service disruption. We’re monitoring the issue.";
const HEALTH_DETAIL = "Login and account access may be affected.";

let cachedSummary:
  | {
      expiresAt: number;
      value: ServiceStatusSummary;
    }
  | null = null;
let projectHealthFailureStreak = 0;

function nowIso() {
  return new Date().toISOString();
}

function isRelevantSupabaseName(value: string | undefined) {
  const normalized = (value || "").toLowerCase();
  return (
    /\bauth\b/.test(normalized) ||
    normalized.includes("authentication")
  );
}

function isDegradedStatus(value: string | undefined) {
  return [
    "degraded_performance",
    "partial_outage",
    "major_outage",
  ].includes(value || "");
}

function incidentIsOpen(value: string | undefined) {
  return !["resolved", "postmortem", "completed"].includes(value || "");
}

export function classifySupabaseStatus(
  summary: StatuspageSummary | null,
  projectProbe: ProjectProbeResult,
  checkedAt = nowIso(),
): ServiceStatusSummary {
  const relevantComponentDegraded =
    summary?.components?.some(
      (component) =>
        isRelevantSupabaseName(component.name) &&
        isDegradedStatus(component.status),
    ) || false;

  const relevantIncidentOpen =
    summary?.incidents?.some((incident) => {
      if (!incidentIsOpen(incident.status)) return false;
      const componentRelevant =
        incident.components?.some((component) =>
          isRelevantSupabaseName(component.name),
        ) || false;
      const textRelevant =
        isRelevantSupabaseName(incident.name) ||
        isRelevantSupabaseName(incident.impact);
      return componentRelevant || textRelevant;
    }) || false;

  if (relevantComponentDegraded || relevantIncidentOpen) {
    return {
      status: "degraded",
      message: HEALTH_MESSAGE,
      detail: HEALTH_DETAIL,
      source: "official_status",
      checkedAt,
      cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
    };
  }

  if (projectProbe === "infrastructure_failure") {
    return {
      status: "degraded",
      message: HEALTH_MESSAGE,
      detail: HEALTH_DETAIL,
      source: "project_health",
      checkedAt,
      cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
    };
  }

  return {
    status: summary ? "healthy" : "unknown",
    message: null,
    detail: null,
    source: "none",
    checkedAt,
    cacheTtlSeconds: Math.round(CACHE_TTL_MS / 1000),
  };
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchStatuspageSummary(): Promise<StatuspageSummary | null> {
  const timeout = timeoutSignal(STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(STATUSPAGE_SUMMARY_URL, {
      headers: { Accept: "application/json" },
      signal: timeout.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload || typeof payload !== "object") return null;
    return payload as StatuspageSummary;
  } catch {
    return null;
  } finally {
    timeout.clear();
  }
}

async function probeProjectHealth(): Promise<ProjectProbeResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return "unknown";

  let baseUrl: URL;
  try {
    baseUrl = new URL(supabaseUrl);
  } catch {
    return "unknown";
  }

  const timeout = timeoutSignal(PROJECT_HEALTH_TIMEOUT_MS);
  try {
    const healthUrl = new URL("/auth/v1/settings", baseUrl);
    const response = await fetch(healthUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: supabaseAnonKey,
      },
      signal: timeout.signal,
      cache: "no-store",
    });

    if (response.status >= 500) return "infrastructure_failure";
    return "healthy";
  } catch {
    return "infrastructure_failure";
  } finally {
    timeout.clear();
  }
}

export async function getServiceStatus({
  forceRefresh = false,
}: { forceRefresh?: boolean } = {}): Promise<ServiceStatusSummary> {
  const now = Date.now();
  if (!forceRefresh && cachedSummary && cachedSummary.expiresAt > now) {
    return cachedSummary.value;
  }

  const [statusSummary, projectProbe] = await Promise.all([
    fetchStatuspageSummary(),
    probeProjectHealth(),
  ]);

  if (projectProbe === "infrastructure_failure") {
    projectHealthFailureStreak += 1;
  } else if (projectProbe === "healthy") {
    projectHealthFailureStreak = 0;
  }

  const conservativeProjectProbe =
    projectHealthFailureStreak >= PROJECT_FAILURE_STREAK_THRESHOLD
      ? "infrastructure_failure"
      : projectProbe === "healthy"
        ? "healthy"
        : "unknown";

  const value = classifySupabaseStatus(statusSummary, conservativeProjectProbe);
  cachedSummary = {
    expiresAt: now + CACHE_TTL_MS,
    value,
  };
  return value;
}

export function __resetServiceStatusCacheForTests() {
  cachedSummary = null;
  projectHealthFailureStreak = 0;
}
