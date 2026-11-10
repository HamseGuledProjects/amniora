import { AI_CONFIG, AIModel, UserPlan } from "./config";
import { AIFeature } from "./usageService";

type ModelRouterArgs = {
  feature: AIFeature;
  plan: UserPlan;
  complexity?: "simple" | "normal" | "complex";
};

export function chooseAIModel({
  feature,
  plan,
  complexity = "normal",
}: ModelRouterArgs): AIModel {
  if (plan === "free") {
    return AI_CONFIG.DEFAULT_MODEL;
  }

  if (feature === "lab_generation") {
    return AI_CONFIG.ADVANCED_MODEL;
  }

  if (complexity === "complex") {
    return AI_CONFIG.ADVANCED_MODEL;
  }

  return AI_CONFIG.DEFAULT_MODEL;
}