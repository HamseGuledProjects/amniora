// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const config = read("lib/ai/contentSharingConsent.ts");
const server = read("lib/ai/contentSharingConsentServer.ts");
const modal = read("components/ai/AiContentSharingConsentDialog.tsx");
const endpoint = read("app/api/ai/content-consent/route.ts");
const labsPage = read("app/dashboard/labs/page.tsx");
const tutorPage = read("app/dashboard/tutor/page.tsx");
const generateRoute = read("app/api/ai/generate-lab/route.ts");
const tutorRoute = read("app/api/ai/tutor/route.ts");
const linuxGradingRoute = read("app/api/ai/linux-grading/route.ts");
const migration = read("supabase/migrations/20260725020800_ai_content_consents.sql");
const linuxGradingUsageMigration = read("supabase/migrations/20260731100000_linux_grading_usage_and_consent.sql");

assert(
  config.includes('AI_CONTENT_SHARING_NOTICE_VERSION = "2026-07-01"'),
  "central notice version constant is missing"
);
assert(
  config.includes("Confirm AI Content Sharing Notice") &&
    config.includes("I understand and agree"),
  "central modal copy is missing required notice text"
);
assert(
  config.includes('"linux_grading"') &&
    config.includes("Agree and Grade"),
  "central consent config is missing Linux grading feature copy"
);
assert(
  modal.includes('role="dialog"') &&
    modal.includes('aria-modal="true"') &&
    modal.includes("aria-labelledby") &&
    modal.includes("aria-describedby"),
  "modal is missing required dialog accessibility attributes"
);
assert(
  modal.includes("focusableSelector") &&
    modal.includes('event.key !== "Tab"') &&
    modal.includes('event.key === "Escape"'),
  "modal focus trap or Escape handling is missing"
);
assert(
  endpoint.includes("createAiContentConsentRecord") &&
    endpoint.includes("isAiContentConsentFeature"),
  "consent endpoint does not validate feature and create a server record"
);
assert(
  server.includes("createHmac") &&
    server.includes("token_hash") &&
    server.includes("consumed_at") &&
    server.includes("AI_CONTENT_CONSENT_TOKEN_TTL_SECONDS"),
  "server consent helper is missing signed, hashed, single-use token controls"
);
assert(
  labsPage.includes("AiContentSharingConsentDialog") &&
    labsPage.includes("/api/ai/content-consent") &&
    labsPage.includes("aiContentConsentToken"),
  "Generate Lab page is not gated by the consent modal and token"
);
assert(
  generateRoute.includes("consumeAiContentConsentToken") &&
    generateRoute.indexOf("consumeAiContentConsentToken") <
      generateRoute.indexOf('reserveAIUsage(user.id, "lab_generation")'),
  "Generate Lab route does not consume consent before usage/generation flow"
);
assert(
    linuxGradingRoute.includes("assertGeneratedLabHasAiContentConsent") &&
    linuxGradingRoute.indexOf("assertGeneratedLabHasAiContentConsent") <
      linuxGradingRoute.indexOf('reserveAIUsage(user.id, "linux_grading")') &&
    linuxGradingRoute.indexOf('reserveAIUsage(user.id, "linux_grading")') <
      linuxGradingRoute.indexOf("const extractor = createOpenAIResponsesLinuxAssessmentExtractor"),
  "Linux grading route does not enforce consent before usage reservation and OpenAI extraction"
);
assert(
  linuxGradingRoute.includes('recordAIUsage({') &&
    linuxGradingRoute.includes('feature: "linux_grading"'),
  "Linux grading route does not record dedicated linux_grading usage"
);
assert(
  tutorPage.includes("AiContentSharingConsentDialog") &&
    tutorPage.includes("/api/ai/content-consent") &&
    tutorPage.includes("pendingTutorMessage"),
  "AI Tutor page is not gating new chat creation with consent"
);
assert(
  tutorRoute.includes("consumeAiContentConsentToken") &&
    tutorRoute.includes("assertTutorConversationHasAiContentConsent") &&
    tutorRoute.includes("bindAiContentConsent"),
  "AI Tutor route is missing new-chat token consumption or chat consent binding"
);
assert(
  migration.includes("create table if not exists public.ai_content_consents") &&
    migration.includes("create table if not exists public.ai_content_consent_tokens") &&
    migration.includes("enable row level security") &&
    migration.includes("with check (false)") &&
    !migration.includes(" ip text"),
  "migration is missing consent audit/token tables, RLS, or raw-IP avoidance"
);
assert(
  linuxGradingUsageMigration.includes("linux_gradings_used") &&
    linuxGradingUsageMigration.includes("'linux_grading'") &&
    linuxGradingUsageMigration.includes("ai_content_consents_feature_type_check") &&
    linuxGradingUsageMigration.includes("ai_content_consent_tokens_feature_type_check"),
  "Linux grading migration is missing dedicated usage or consent feature constraints"
);

console.log("AI content consent static tests passed.");
