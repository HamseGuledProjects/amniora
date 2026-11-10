// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

let assertions = 0;

function assert(name, condition, detail = "") {
  assertions += 1;
  if (!condition) {
    throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
  }
  console.log(`PASS ${name}`);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function serialized(value) {
  return JSON.stringify(value);
}

function hasAny(value, patterns) {
  const text = serialized(value);
  return patterns.some((pattern) => pattern.test(text));
}

async function main() {
  const privacy = await import(
    pathToFileURL(path.join(process.cwd(), "lib/monitoring/sentryPrivacy.ts")).href
  );

  const nextConfig = readText("next.config.ts");
  const instrumentation = readText("instrumentation.ts");
  const instrumentationClient = readText("instrumentation-client.ts");
  const packageJson = JSON.parse(readText("package.json"));

  assert("official Sentry Next.js SDK dependency is installed", Boolean(packageJson.dependencies["@sentry/nextjs"]));
  assert("Next config is wrapped with Sentry config", nextConfig.includes("withSentryConfig(nextConfig"));
  assert("source map upload uses environment variables", nextConfig.includes("process.env.SENTRY_AUTH_TOKEN") && nextConfig.includes("process.env.SENTRY_ORG") && nextConfig.includes("process.env.SENTRY_PROJECT"));
  assert("Sentry telemetry is disabled", nextConfig.includes("telemetry: false"));
  assert("Sentry logger statements are disabled", nextConfig.includes("removeDebugLogging: true"));
  assert("source maps are deleted after upload", nextConfig.includes("deleteSourcemapsAfterUpload: true"));
  assert("source paths are rewritten away from local workspace", nextConfig.includes("app://amniora"));
  assert("server instrumentation uses runtime register hook", instrumentation.includes("export async function register()") && instrumentation.includes("process.env.NEXT_RUNTIME"));
  assert("server instrumentation captures Next request errors", instrumentation.includes("Sentry.captureRequestError"));
  assert("client instrumentation uses shared privacy config", instrumentationClient.includes("buildSentryInitOptions(\"client\")"));
  assert("no sample Sentry crash route is present", !fs.existsSync(path.join(process.cwd(), "app", "sentry-example-page")));

  process.env.NODE_ENV = "test";
  assert("test trace sampling is disabled", privacy.getSentryTracesSampleRate() === 0);
  const testOptions = privacy.buildSentryInitOptions("server");
  assert("test environment does not transmit events", testOptions.enabled === false);
  assert("replay sampling is explicitly disabled", testOptions.replaysSessionSampleRate === 0 && testOptions.replaysOnErrorSampleRate === 0);
  assert("profiling is explicitly disabled", testOptions.profilesSampleRate === 0);
  assert("default PII is disabled", testOptions.sendDefaultPii === false);

  process.env.NODE_ENV = "production";
  assert("production trace sampling is at most five percent", privacy.getSentryTracesSampleRate() <= 0.05);
  process.env.NODE_ENV = "test";

  const unsafeEvent = {
    message: "Route failed with safe category",
    user: {
      id: "user-123",
      email: "alice@example.com",
      username: "alice",
      ip_address: "203.0.113.2",
      name: "Alice Learner",
    },
    request: {
      method: "POST",
      url: "https://portfolio.example.test/api/ai/generate-lab?email=alice@example.com#token",
      headers: {
        Authorization: "Bearer secret-token-value",
        Cookie: "sb-access-token=secret",
        "X-Api-Key": "key-value",
        "Content-Type": "application/json",
      },
      cookies: { session: "secret-cookie" },
      data: {
        password: "CorrectHorseBatteryStaple1",
        learnerAnswer: "student grading answer",
        prompt: "hidden prompt",
      },
      query_string: "email=alice@example.com",
    },
    extra: {
      modelResponse: "raw model response",
      feedbackMessageBody: "complaint body",
      evidencePath: "assets/logs/auth.log",
    },
    tags: {
      subsystem: "auth",
      route_family: "auth",
      unsafe_user: "alice@example.com",
    },
    contexts: {
      trace: { trace_id: "abc", span_id: "def" },
      auth: { access_token: "secret" },
    },
    breadcrumbs: [
      { category: "ui.click", message: "Open public page" },
      { category: "form", message: "password field changed", data: { password: "secret" } },
      { category: "lab", message: "generated lab narrative", data: { evidence: "assets/logs/auth.log" } },
    ],
    exception: {
      values: [
        {
          type: "Error",
          value: "Provider operation failed",
          stacktrace: {
            frames: [
              {
                filename: "C:\\Users\\example\\Desktop\\cyberlab\\app\\api\\route.ts?secret=value",
                abs_path: "C:\\Users\\example\\Desktop\\cyberlab\\app\\api\\route.ts",
                context_line: "const token = request.headers.authorization",
                pre_context: ["secret"],
                post_context: ["secret"],
                vars: { token: "secret" },
              },
            ],
          },
        },
      ],
    },
  };

  const sanitized = privacy.sanitizeSentryEvent(unsafeEvent, {}, "server");
  assert("event remains reportable after sanitization", sanitized !== null);
  assert("request query string and fragment are removed", sanitized.request.url === "https://portfolio.example.test/api/ai/generate-lab");
  assert("authorization, cookie and API-key headers are removed", !sanitized.request.headers.authorization && !sanitized.request.headers.cookie && !sanitized.request.headers["x-api-key"]);
  assert("safe request content type header may remain", sanitized.request.headers["content-type"] === "application/json");
  assert("request body is absent", !("data" in sanitized.request));
  assert("request cookies are absent", !("cookies" in sanitized.request));
  assert("request query string is absent", !("query_string" in sanitized.request));
  assert("user identity is removed", !sanitized.user);
  assert("extra context is removed", !sanitized.extra);
  assert("unsafe tag is removed", !sanitized.tags.unsafe_user);
  assert("safe tags remain", sanitized.tags.subsystem === "auth" && sanitized.tags.route_family === "auth");
  assert("sensitive breadcrumbs are removed", sanitized.breadcrumbs.length === 1 && sanitized.breadcrumbs[0].category === "ui.click");
  assert("local absolute stack paths are redacted", sanitized.exception.values[0].stacktrace.frames[0].abs_path === "[redacted-path]");
  assert("stack context lines are removed", !sanitized.exception.values[0].stacktrace.frames[0].context_line);
  assert("auth contexts are removed", !sanitized.contexts.auth);
  assert(
    "sanitized event contains no direct identifiers or secrets",
    !hasAny(sanitized, [
      /alice@example\.com/i,
      /CorrectHorseBatteryStaple/i,
      /secret-token-value/i,
      /student grading answer/i,
      /hidden prompt/i,
      /raw model response/i,
      /complaint body/i,
      /assets\/logs\/auth\.log/i,
      /C:\\Users\\example/i,
      /Bearer\s+/i,
    ]),
    serialized(sanitized),
  );

  const unsafeResidual = privacy.sanitizeSentryEvent(
    {
      message: "raw prompt and model response cannot be safely anonymized",
      request: { url: "https://portfolio.example.test/api/ai/generate-lab" },
    },
    {},
    "server",
  );
  assert("unsafe event fails closed", unsafeResidual === null);

  const safeEvent = privacy.sanitizeSentryEvent(
    {
      message: "Route failed with safe category",
      request: {
        method: "GET",
        url: "https://portfolio.example.test/development-log?utm=test#section",
        headers: { accept: "text/html" },
      },
      tags: { subsystem: "public", error_category: "render" },
      breadcrumbs: [{ category: "navigation", message: "Public navigation" }],
    },
    {},
    "client",
  );
  assert("ordinary sanitized exceptions remain reportable", safeEvent !== null);
  assert("ordinary sanitized event has query stripped", safeEvent.request.url === "https://portfolio.example.test/development-log");
  assert("ordinary safe breadcrumb remains", safeEvent.breadcrumbs.length === 1);

  const sensitiveBreadcrumb = privacy.sanitizeSentryBreadcrumb({
    category: "feedback",
    message: "feedback body typed",
    data: { body: "learner complaint" },
  });
  assert("feedback and complaint breadcrumbs are dropped", sensitiveBreadcrumb === null);

  const safeUrl = privacy.sanitizeUrl("https://portfolio.example.test/reset-password?code=abc#recovery");
  assert("URL sanitizer removes recovery query and fragment", safeUrl === "https://portfolio.example.test/reset-password");

  console.log(JSON.stringify({ passed: true, assertions }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
