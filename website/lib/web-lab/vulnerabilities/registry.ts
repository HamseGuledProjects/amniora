import type { WebVulnerabilityModule } from "../schema";
import { reflectedXssV1 } from "./reflected-xss-v1";
import { storedXssV1 } from "./stored-xss-v1";

/** Fixed reviewed modules only. Neither scenario JSON nor AI can provide runtime source. */
export function webVulnerabilityModule(id: unknown): WebVulnerabilityModule | null {
  if (id === reflectedXssV1.id) return reflectedXssV1;
  if (id === storedXssV1.id) return storedXssV1;
  return null;
}
