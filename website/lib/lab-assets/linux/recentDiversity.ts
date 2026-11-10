import {
  buildLinuxStructuralFingerprint,
  compareLinuxStructuralFingerprints,
  LINUX_STRUCTURAL_DIVERSITY_VERSION,
  type LinuxStructuralFingerprint,
} from "./structuralDiversity";
import type { LinuxSimulationWorld } from "./simulation";

export const LINUX_RECENT_CASE_WINDOW = 10;
export const LINUX_DIVERSITY_RETRY_BUDGET = 8;

export type LinuxRecentCase = {
  acceptedId: string;
  family: string;
  fingerprint: LinuxStructuralFingerprint;
};

export class LinuxDiversityHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinuxDiversityHistoryError";
  }
}

export function parseLinuxStoredFingerprint(value: unknown): LinuxStructuralFingerprint {
  if (!value || typeof value !== "object") throw new LinuxDiversityHistoryError("LINUX_DIVERSITY_HISTORY_MISSING");
  const fingerprint = value as LinuxStructuralFingerprint;
  const keys = ["incidentConcept", "taskSequence", "evidenceTopology", "chronology", "commandsProcesses", "identityHost", "noise", "reasoningPath", "narrativeLanguage"] as const;
  if (fingerprint.version !== LINUX_STRUCTURAL_DIVERSITY_VERSION ||
      !fingerprint.dimensions || keys.some((key) => !Array.isArray(fingerprint.dimensions[key]) ||
        fingerprint.dimensions[key].length > 2048 || fingerprint.dimensions[key].some((token) => typeof token !== "string" || token.length > 16384)) ||
      !fingerprint.dimensions.commandsProcesses.length || !fingerprint.dimensions.reasoningPath.length) {
    throw new LinuxDiversityHistoryError("LINUX_DIVERSITY_HISTORY_INCOMPATIBLE");
  }
  // Never trust a separately supplied canonical hash over the actual dimensions.
  return { ...fingerprint, canonical: keys.map((key) => `${key}=${fingerprint.dimensions[key].join("|")}`).join("||") };
}

/** History must be newest first, already scoped to accepted cases in this family. */
export function checkLinuxRecentDiversity(simulation: LinuxSimulationWorld, history: readonly LinuxRecentCase[]) {
  const family = simulation.investigation.incidentFamily;
  const fingerprint = buildLinuxStructuralFingerprint(simulation);
  const recent = history.filter((entry) => entry.family === family).slice(0, LINUX_RECENT_CASE_WINDOW);
  const comparisons = recent.map((entry) => ({
    acceptedId: entry.acceptedId,
    ...compareLinuxStructuralFingerprints(fingerprint, parseLinuxStoredFingerprint(entry.fingerprint)),
  }));
  const minimum = comparisons.length ? Math.min(...comparisons.map((item) => item.overallDistinctiveness)) : 10;
  const average = comparisons.length ? comparisons.reduce((sum, item) => sum + item.overallDistinctiveness, 0) / comparisons.length : 10;
  // The 5.5 average is a ten-case batch property. Before a complete window
  // exists, enforce the 4.0 pair floor; once ten comparable cases exist both
  // acceptance thresholds apply.
  return { passed: minimum >= 4 && (comparisons.length < LINUX_RECENT_CASE_WINDOW || average >= 5.5), family, fingerprint, comparisons, minimum, average, history: recent };
}

/** Build/review only: persistence is deliberately not a callback in this loop. */
export async function selectLinuxRecentDistinctCandidate<T extends { simulation: LinuxSimulationWorld }>(input: {
  build: (attempt: number) => T;
  loadHistory: (family: string) => Promise<readonly LinuxRecentCase[]>;
  budget?: number;
}) {
  const budget = input.budget ?? LINUX_DIVERSITY_RETRY_BUDGET;
  if (!Number.isInteger(budget) || budget < 1 || budget > LINUX_DIVERSITY_RETRY_BUDGET) throw new Error("LINUX_DIVERSITY_INVALID_BUDGET");
  const snapshots = new Map<string, readonly LinuxRecentCase[]>();
  const rejections: string[] = [];
  for (let attempt = 0; attempt < budget; attempt += 1) {
    let candidate: T;
    try { candidate = input.build(attempt); }
    catch (error) { rejections.push(error instanceof Error ? error.message : "candidate rejected"); continue; }
    const family = candidate.simulation.investigation.incidentFamily;
    if (!snapshots.has(family)) snapshots.set(family, await input.loadHistory(family));
    const review = checkLinuxRecentDiversity(candidate.simulation, snapshots.get(family)!);
    if (review.passed) return { candidate, review, attempts: attempt + 1, rejections };
    rejections.push(`LINUX_STRUCTURAL_RESKIN: minimum=${review.minimum}; average=${review.average.toFixed(2)}`);
  }
  throw new LinuxDiversityHistoryError(`LINUX_DIVERSITY_EXHAUSTED: ${budget} attempts rejected; ${rejections.join(" | ")}`);
}
