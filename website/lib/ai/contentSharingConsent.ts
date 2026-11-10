export const AI_CONTENT_SHARING_NOTICE_VERSION = "2026-07-01";
export const AI_CONTENT_SHARING_CONSENT_VERSION = "1.0";

export const AI_CONTENT_CONSENT_TOKEN_TTL_SECONDS = 10 * 60;

export const AI_CONTENT_CONSENT_FEATURES = [
  "lab_generation",
  "linux_grading",
  "tutor_chat",
] as const;

export type AiContentConsentFeature =
  (typeof AI_CONTENT_CONSENT_FEATURES)[number];

export type AiContentConsentDialogCopy = {
  title: string;
  body: string[];
  checkbox: string;
  privacyPolicyLabel: string;
  actions: Record<
    AiContentConsentFeature,
    {
      cancel: string;
      confirm: string;
      submitting: string;
    }
  >;
};

export const ARCHIVED_AI_CONTENT_SHARING_CONSENT_COPY: AiContentConsentDialogCopy = {
  title: "Confirm AI Content Sharing Notice",
  body: [
    "Amniora uses OpenAI's API to provide AI-powered features such as generated investigation labs and the AI Tutor.",
    "Amniora has enabled optional API data sharing with OpenAI. This means the information you submit to this AI feature and the responses it generates may be shared with OpenAI and used for research, evaluation, testing, and the development and improvement of OpenAI's services and models.",
    "Do not submit sensitive, confidential, proprietary, legally privileged, or private information. Do not submit protected health information or personal information relating to children under 13 or the applicable age of digital consent.",
    "You confirm that you have the rights and permissions necessary to provide any information you submit and understand that it may be processed for the purposes described above.",
  ],
  checkbox:
    "I understand and agree that my input and the resulting AI output may be shared with OpenAI for research, evaluation, testing, and service-development purposes.",
  privacyPolicyLabel: "Privacy Policy",
  actions: {
    lab_generation: {
      cancel: "Cancel",
      confirm: "Agree and Generate",
      submitting: "Recording consent...",
    },
    linux_grading: {
      cancel: "Cancel",
      confirm: "Agree and Grade",
      submitting: "Recording consent...",
    },
    tutor_chat: {
      cancel: "Cancel",
      confirm: "Agree and Start Chat",
      submitting: "Recording consent...",
    },
  },
};

export const AI_CONTENT_SHARING_CONSENT_COPY: AiContentConsentDialogCopy = {
  title: "Explore the local example",
  body: ["This portfolio uses synthetic investigation data and written Tutor replies. Nothing you enter is sent to an AI provider or account service.", "Use sample questions only. This is a demonstration of the interface, not a live AI or assessment service."],
  checkbox: "I understand this uses sample data and example replies.",
  privacyPolicyLabel: "Privacy information",
  actions: {
    lab_generation: { cancel: "Cancel", confirm: "Open sample investigation", submitting: "Preparing sample..." },
    linux_grading: { cancel: "Cancel", confirm: "View example", submitting: "Preparing example..." },
    tutor_chat: { cancel: "Cancel", confirm: "Start sample chat", submitting: "Opening sample chat..." },
  },
};

export function isAiContentConsentFeature(
  value: unknown
): value is AiContentConsentFeature {
  return (
    typeof value === "string" &&
    AI_CONTENT_CONSENT_FEATURES.includes(value as AiContentConsentFeature)
  );
}
