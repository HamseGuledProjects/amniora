import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  AI_CONTENT_CONSENT_TOKEN_TTL_SECONDS,
  AI_CONTENT_SHARING_CONSENT_VERSION,
  AI_CONTENT_SHARING_NOTICE_VERSION,
  type AiContentConsentFeature,
} from "@/lib/ai/contentSharingConsent";

type ConsentTokenPayload = {
  consentId: string;
  tokenId: string;
  userId: string;
  feature: AiContentConsentFeature;
  issuedAt: number;
  expiresAt: number;
  environment: string;
};

type CreateConsentArgs = {
  userId: string;
  feature: AiContentConsentFeature;
  request: Request;
};

type ConsumeConsentArgs = {
  userId: string;
  feature: AiContentConsentFeature;
  token: unknown;
};

type BindConsentArgs = {
  consentId: string;
  userId: string;
  chatId?: string;
  labRequestId?: string;
};

export class AiContentConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiContentConsentError";
  }
}

function base64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function decodeBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function getConsentSecret() {
  return (
    process.env.AI_CONTENT_CONSENT_TOKEN_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXTAUTH_SECRET ||
    "development-ai-content-consent-secret"
  );
}

function getEnvironmentBinding() {
  return [
    process.env.VERCEL_ENV,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NODE_ENV,
  ]
    .filter(Boolean)
    .join("|");
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", getConsentSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashAiContentConsentToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSignedAiContentConsentToken(
  payload: ConsentTokenPayload
) {
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifySignedAiContentConsentToken(token: string) {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    throw new AiContentConsentError(
      "AI content sharing consent token is malformed."
    );
  }

  const expectedSignature = signPayload(encodedPayload);

  if (!safeCompare(signature, expectedSignature)) {
    throw new AiContentConsentError(
      "AI content sharing consent token is invalid."
    );
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload)) as ConsentTokenPayload;

  if (payload.environment !== getEnvironmentBinding()) {
    throw new AiContentConsentError(
      "AI content sharing consent token is not valid here."
    );
  }

  if (Date.now() > payload.expiresAt) {
    throw new AiContentConsentError(
      "AI content sharing consent token has expired."
    );
  }

  return payload;
}

function hashIpAddress(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "";

  if (!ip) return null;

  const salt =
    process.env.AI_CONTENT_CONSENT_IP_HASH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "development-ai-content-ip-hash-secret";

  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export async function createAiContentConsentRecord({
  userId,
  feature,
  request,
}: CreateConsentArgs) {
  const consentId = randomUUID();
  const tokenId = randomUUID();
  const now = Date.now();
  const expiresAt = now + AI_CONTENT_CONSENT_TOKEN_TTL_SECONDS * 1000;
  const token = createSignedAiContentConsentToken({
    consentId,
    tokenId,
    userId,
    feature,
    issuedAt: now,
    expiresAt,
    environment: getEnvironmentBinding(),
  });

  const { error: consentError } = await supabaseAdmin
    .from("ai_content_consents")
    .insert({
      id: consentId,
      user_id: userId,
      feature_type: feature,
      consent_version: AI_CONTENT_SHARING_CONSENT_VERSION,
      notice_version: AI_CONTENT_SHARING_NOTICE_VERSION,
      ip_hash: hashIpAddress(request),
      user_agent: request.headers.get("user-agent"),
      metadata: {
        token_ttl_seconds: AI_CONTENT_CONSENT_TOKEN_TTL_SECONDS,
        environment: getEnvironmentBinding(),
      },
    });

  if (consentError) {
    throw new Error(consentError.message);
  }

  const { error: tokenError } = await supabaseAdmin
    .from("ai_content_consent_tokens")
    .insert({
      id: tokenId,
      consent_id: consentId,
      user_id: userId,
      feature_type: feature,
      token_hash: hashAiContentConsentToken(token),
      expires_at: new Date(expiresAt).toISOString(),
      environment: getEnvironmentBinding(),
    });

  if (tokenError) {
    throw new Error(tokenError.message);
  }

  return {
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    noticeVersion: AI_CONTENT_SHARING_NOTICE_VERSION,
    consentVersion: AI_CONTENT_SHARING_CONSENT_VERSION,
  };
}

export async function consumeAiContentConsentToken({
  userId,
  feature,
  token,
}: ConsumeConsentArgs) {
  if (typeof token !== "string" || !token.trim()) {
    throw new AiContentConsentError("AI content sharing consent is required.");
  }

  const normalizedToken = token.trim();
  const payload = verifySignedAiContentConsentToken(normalizedToken);

  if (payload.userId !== userId || payload.feature !== feature) {
    throw new AiContentConsentError(
      "AI content sharing consent token does not match this request."
    );
  }

  const { data: tokenRecord, error: tokenError } = await supabaseAdmin
    .from("ai_content_consent_tokens")
    .select("id, consent_id, user_id, feature_type, token_hash, expires_at, consumed_at")
    .eq("id", payload.tokenId)
    .eq("consent_id", payload.consentId)
    .eq("user_id", userId)
    .eq("feature_type", feature)
    .eq("token_hash", hashAiContentConsentToken(normalizedToken))
    .single();

  if (tokenError || !tokenRecord) {
    throw new AiContentConsentError(
      "AI content sharing consent token was not found."
    );
  }

  if (tokenRecord.consumed_at) {
    throw new AiContentConsentError(
      "AI content sharing consent token has already been used."
    );
  }

  if (new Date(tokenRecord.expires_at).getTime() <= Date.now()) {
    throw new AiContentConsentError(
      "AI content sharing consent token has expired."
    );
  }

  const consumedAt = new Date().toISOString();
  const { data: consumed, error: consumeError } = await supabaseAdmin
    .from("ai_content_consent_tokens")
    .update({ consumed_at: consumedAt })
    .eq("id", payload.tokenId)
    .is("consumed_at", null)
    .select("id")
    .single();

  if (consumeError || !consumed) {
    throw new AiContentConsentError(
      "AI content sharing consent token has already been used."
    );
  }

  return payload.consentId;
}

export async function bindAiContentConsent({
  consentId,
  userId,
  chatId,
  labRequestId,
}: BindConsentArgs) {
  const patch: Record<string, string> = {};
  if (chatId) patch.chat_id = chatId;
  if (labRequestId) patch.lab_request_id = labRequestId;

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabaseAdmin
    .from("ai_content_consents")
    .update(patch)
    .eq("id", consentId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function assertTutorConversationHasAiContentConsent({
  userId,
  chatId,
}: {
  userId: string;
  chatId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("ai_content_consents")
    .select("id")
    .eq("user_id", userId)
    .eq("feature_type", "tutor_chat")
    .eq("chat_id", chatId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new AiContentConsentError(
      "AI content sharing consent is required for this chat."
    );
  }
}

export async function assertGeneratedLabHasAiContentConsent({
  userId,
  generatedLabId,
}: {
  userId: string;
  generatedLabId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("ai_content_consents")
    .select("id")
    .eq("user_id", userId)
    .in("feature_type", ["lab_generation", "linux_grading"])
    .eq("lab_request_id", generatedLabId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new AiContentConsentError(
      "AI content sharing consent is required for this Linux grading request."
    );
  }
}
