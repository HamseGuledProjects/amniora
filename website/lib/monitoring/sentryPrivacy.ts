import type {
  Breadcrumb,
  ErrorEvent,
  Event,
  EventHint,
  TransactionEvent,
} from "@sentry/core";

type SentryRuntime = "client" | "server" | "edge";

const SAFE_TAGS = new Set([
  "subsystem",
  "error_category",
  "route_family",
  "deployment_environment",
  "runtime",
  "release",
]);

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|passcode|passwd|token|secret|api[-_]?key|service[-_]?role|refresh|access[-_]?token|recovery|pkce|private[-_]?beta|email|username|full[-_]?name|name|ip[-_]?address|prompt|model[-_]?response|hidden[-_]?contract|answer[-_]?key|learner[-_]?answer|grading[-_]?submission|evidence|lab[-_]?content|feedback|complaint|signed[-_]?url|database[-_]?url|connection[-_]?string)/i;

const SENSITIVE_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9]{16,}/g,
  /sbp_[A-Za-z0-9_-]{16,}/g,
  /postgres(?:ql)?:\/\/[^\s"'<>]+/gi,
  /https?:\/\/[^\s"'<>]+:[^\s"'<>]+@[^\s"'<>]+/gi,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /C:\\Users\\[^\\\s"'<>]+/gi,
  /\/Users\/[^/\s"'<>]+/gi,
  /\/home\/[^/\s"'<>]+/gi,
];

const UNSAFE_DOMAIN_PATTERN =
  /(prompt|model response|hidden contract|answer key|learner answer|grading submission|evidence content|generated lab|feedback message|complaint body|private beta key|supabase access token|refresh token|authorization header|signed download url)/i;

const SENSITIVE_BREADCRUMB_PATTERN =
  /(form|input|auth|supabase|password|token|cookie|private[-_\s]?beta|lab|evidence|grading|learner|prompt|model|response|contract|answer|feedback|complaint|email|download)/i;

const SAFE_STRING_PATTERN = /^[a-z0-9_.:/@ -]{1,160}$/i;

function isProductionEnvironment() {
  return process.env.NODE_ENV === "production";
}

function deploymentEnvironment() {
  return (
    process.env.NEXT_PUBLIC_VERCEL_ENV ||
    process.env.VERCEL_ENV ||
    process.env.NODE_ENV ||
    "unknown"
  );
}

function releaseIdentifier() {
  return (
    process.env.SENTRY_RELEASE ||
    process.env.NEXT_PUBLIC_SENTRY_RELEASE ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    undefined
  );
}

export function getSentryTracesSampleRate() {
  return isProductionEnvironment() ? 0.05 : 0;
}

export function sanitizeUrl(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  try {
    const parsed = new URL(value, "https://amniora.invalid");
    parsed.search = "";
    parsed.hash = "";

    if (parsed.origin === "https://amniora.invalid") {
      return parsed.pathname;
    }

    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return redactSensitiveString(value.split("?")[0]?.split("#")[0] || "");
  }
}

function redactSensitiveString(value: string) {
  let safe = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    safe = safe.replace(pattern, "[redacted]");
  }
  return safe;
}

function sanitizedKey(key: string) {
  return SENSITIVE_KEY_PATTERN.test(key) ? "[redacted-key]" : key;
}

function sanitizeUnknown(value: unknown, key = "", depth = 0): unknown {
  if (depth > 8) {
    return "[redacted-depth]";
  }

  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return SENSITIVE_KEY_PATTERN.test(key)
      ? "[redacted]"
      : redactSensitiveString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item, key, depth + 1));
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(source)) {
      if (SENSITIVE_KEY_PATTERN.test(entryKey)) {
        output[sanitizedKey(entryKey)] = "[redacted]";
      } else {
        output[entryKey] = sanitizeUnknown(entryValue, entryKey, depth + 1);
      }
    }
    return output;
  }

  return undefined;
}

function hasUnsafeResidual(value: unknown) {
  const serialized = JSON.stringify(value);
  if (!serialized) {
    return false;
  }

  return (
    SENSITIVE_VALUE_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(serialized);
    }) || UNSAFE_DOMAIN_PATTERN.test(serialized)
  );
}

function sanitizeHeaders(headers: unknown) {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }

  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }

    if (/^(accept|content-type|user-agent|x-vercel-id)$/i.test(key)) {
      const cleaned = sanitizeUnknown(value, key);
      if (typeof cleaned === "string" && SAFE_STRING_PATTERN.test(cleaned)) {
        safe[key.toLowerCase()] = cleaned.slice(0, 160);
      }
    }
  }

  return Object.keys(safe).length > 0 ? safe : undefined;
}

function sanitizeRequest(request: Event["request"]) {
  if (!request) {
    return undefined;
  }

  const safeRequest: NonNullable<Event["request"]> = {};
  const method = sanitizeUnknown(request.method, "method");

  if (typeof method === "string" && /^[A-Z]{2,10}$/.test(method)) {
    safeRequest.method = method;
  }

  if (request.url) {
    safeRequest.url = sanitizeUrl(request.url) as string;
  }

  const headers = sanitizeHeaders(request.headers);
  if (headers) {
    safeRequest.headers = headers;
  }

  return safeRequest;
}

function sanitizeTags(tags: Event["tags"], runtime: SentryRuntime) {
  const safeTags: Record<string, string> = {
    runtime,
    deployment_environment: String(deploymentEnvironment()).slice(0, 64),
  };

  const release = releaseIdentifier();
  if (release) {
    safeTags.release = String(release).slice(0, 80);
  }

  for (const [key, value] of Object.entries(tags || {})) {
    if (!SAFE_TAGS.has(key)) {
      continue;
    }

    const cleaned = sanitizeUnknown(value, key);
    if (typeof cleaned === "string" && SAFE_STRING_PATTERN.test(cleaned)) {
      safeTags[key] = cleaned.slice(0, 160);
    }
  }

  return safeTags;
}

function sanitizeBreadcrumb(breadcrumb: Breadcrumb) {
  const combined = JSON.stringify({
    category: breadcrumb.category,
    message: breadcrumb.message,
    data: breadcrumb.data,
  });

  if (SENSITIVE_BREADCRUMB_PATTERN.test(combined)) {
    return null;
  }

  const safe = sanitizeUnknown(breadcrumb) as Breadcrumb;
  delete safe.data;
  if (typeof safe.message === "string") {
    safe.message = redactSensitiveString(safe.message).slice(0, 160);
  }

  return hasUnsafeResidual(safe) ? null : safe;
}

function sanitizeException(event: Event) {
  const exception = event.exception;
  if (!exception?.values) {
    return;
  }

  for (const value of exception.values) {
    if (typeof value.value === "string") {
      value.value = redactSensitiveString(value.value).slice(0, 500);
    }

    if (value.stacktrace?.frames) {
      for (const frame of value.stacktrace.frames) {
        if (frame.filename) {
          frame.filename = sanitizeUrl(redactSensitiveString(frame.filename)) as string;
        }
        if (frame.abs_path) {
          frame.abs_path = "[redacted-path]";
        }
        if (frame.context_line) {
          frame.context_line = undefined;
        }
        frame.pre_context = undefined;
        frame.post_context = undefined;
        frame.vars = undefined;
      }
    }
  }
}

function sanitizeContexts(contexts: Event["contexts"]) {
  if (!contexts) {
    return undefined;
  }

  const allowed = ["trace", "runtime", "browser", "os", "device"];
  const output: NonNullable<Event["contexts"]> = {};

  for (const key of allowed) {
    const value = contexts[key];
    if (value) {
      output[key] = sanitizeUnknown(value, key) as Record<string, unknown>;
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

export function sanitizeSentryEvent(
  event: Event,
  _hint?: EventHint,
  runtime: SentryRuntime = "server",
) {
  const sanitized: Event = {
    ...event,
    request: sanitizeRequest(event.request),
    tags: sanitizeTags(event.tags, runtime),
    user: undefined,
    extra: undefined,
    breadcrumbs: event.breadcrumbs
      ?.map((breadcrumb) => sanitizeBreadcrumb(breadcrumb))
      .filter((breadcrumb): breadcrumb is Breadcrumb => Boolean(breadcrumb)),
    contexts: sanitizeContexts(event.contexts),
  };

  delete (sanitized as Event & { response?: unknown }).response;
  delete (sanitized as Event & { modules?: unknown }).modules;
  delete (sanitized as Event & { sdkProcessingMetadata?: unknown }).sdkProcessingMetadata;

  if (typeof sanitized.message === "string") {
    sanitized.message = redactSensitiveString(sanitized.message).slice(0, 500);
  }

  sanitizeException(sanitized);

  const scrubbed = sanitizeUnknown(sanitized) as Event;
  return hasUnsafeResidual(scrubbed) ? null : scrubbed;
}

export function sanitizeSentryErrorEvent(
  event: ErrorEvent,
  hint: EventHint,
  runtime: SentryRuntime,
): ErrorEvent | null {
  const sanitized = sanitizeSentryEvent(event, hint, runtime);
  return sanitized ? { ...sanitized, type: undefined } : null;
}

export function sanitizeSentryTransactionEvent(
  event: TransactionEvent,
  hint: EventHint,
  runtime: SentryRuntime,
): TransactionEvent | null {
  const sanitized = sanitizeSentryEvent(event, hint, runtime);
  return sanitized ? { ...sanitized, type: "transaction" } : null;
}

export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb) {
  return sanitizeBreadcrumb(breadcrumb);
}

export function buildSentryInitOptions(runtime: SentryRuntime) {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: deploymentEnvironment(),
    release: releaseIdentifier(),
    enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) && isProductionEnvironment(),
    sendDefaultPii: false,
    tracesSampleRate: getSentryTracesSampleRate(),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    profilesSampleRate: 0,
    beforeSend(event: ErrorEvent, hint: EventHint) {
      return sanitizeSentryErrorEvent(event, hint, runtime);
    },
    beforeSendTransaction(event: TransactionEvent, hint: EventHint) {
      return sanitizeSentryTransactionEvent(event, hint, runtime);
    },
    beforeBreadcrumb(breadcrumb: Breadcrumb) {
      return sanitizeSentryBreadcrumb(breadcrumb);
    },
  };
}
