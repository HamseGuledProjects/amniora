/**
 * ==========================================================
 * CyberLab AI Configuration
 * ==========================================================
 * Central configuration used by every AI service.
 *
 * Future AI Features:
 * - AI Tutor
 * - AI Lab Generator
 * - AI Learning Coach
 * - AI Roadmap Coach
 * - AI Progress Insights
 * - AI Saved Labs
 * - AI Recommendations
 * ==========================================================
 */

export const AI_CONFIG = {
  // --------------------------------------------------------
  // OpenAI Models
  // --------------------------------------------------------

  DEFAULT_MODEL: "gpt-5-mini",
  ADVANCED_MODEL: "gpt-5",

  // --------------------------------------------------------
  // Conversation Limits
  // --------------------------------------------------------

  MAX_MESSAGES_PER_CONVERSATION: 100,

  MAX_INPUT_CHARACTERS: 8000,

  MAX_OUTPUT_TOKENS: 2000,

  // --------------------------------------------------------
  // Usage Limits
  // --------------------------------------------------------

 FREE: {
  WEEKLY_TUTOR_PROMPTS: 15,
  WEEKLY_LAB_GENERATIONS: 2,
  WEEKLY_LINUX_GRADINGS: 20,
},

PRO: {
  WEEKLY_TUTOR_PROMPTS: 500,
  WEEKLY_LAB_GENERATIONS: 100,
  WEEKLY_LINUX_GRADINGS: 500,
},

  // --------------------------------------------------------
  // Cost Tracking
  // (estimated - update if model pricing changes)
  // --------------------------------------------------------

  COST: {
    INPUT_PER_1K: 0,
    OUTPUT_PER_1K: 0,
  },

  // --------------------------------------------------------
  // Conversation Settings
  // --------------------------------------------------------

  TEMPERATURE: 0.4,

  TOP_P: 1,

  FREQUENCY_PENALTY: 0,

  PRESENCE_PENALTY: 0,
} as const;

export type UserPlan = "free" | "pro";

export type AIModel =
  | typeof AI_CONFIG.DEFAULT_MODEL
  | typeof AI_CONFIG.ADVANCED_MODEL;
