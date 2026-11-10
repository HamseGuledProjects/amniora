import type { LabAsset } from "../types";
import type { LinuxInvestigationContext } from "./investigation";
import type { LinuxDeterministicHashes, LinuxGenerationProvenance } from "./generationContext";
import {
  checkLinuxFinalProductionQuality,
  type FinalLinuxNarrative,
  type LinuxFinalQualityResult,
} from "./qualityChecker";
import type { LinuxSimulationWorld } from "./simulation";

const STALE_WORKLOAD_CODES = [
  "LINUX_WORKLOAD_INPUT_MUTATED_AFTER_VALIDATION",
  "LINUX_WORKLOAD_ESTIMATE_HASH_MISMATCH",
  "LINUX_WORKLOAD_REPORT_HASH_MISMATCH",
  "LINUX_ASSESSMENT_MUTATED_AFTER_VALIDATION",
  "LINUX_ASSESSMENT_HASH_MISMATCH",
];

export function assertLinuxPreSaveWorkloadBoundary(input: {
  context?: LinuxInvestigationContext;
  assets: LabAsset[];
  simulation?: LinuxSimulationWorld;
  lab: FinalLinuxNarrative;
  provenance?: LinuxGenerationProvenance;
  deterministicHashes?: LinuxDeterministicHashes;
}): LinuxFinalQualityResult {
  const result = checkLinuxFinalProductionQuality({
    context: input.context,
    assets: input.assets,
    simulation: input.simulation,
    lab: input.lab,
    workload: {
      requestedDifficulty: input.provenance?.difficulty,
      requestedDurationMinutes: input.provenance?.durationMinutes,
      expectedWorkloadEstimateHash: input.deterministicHashes?.workloadEstimateHash,
      expectedWorkloadReportHash: input.deterministicHashes?.workloadReportHash,
      expectedAssessmentContractHash: input.deterministicHashes?.assessmentContractHash,
      expectedAssessmentQualityHash: input.deterministicHashes?.assessmentQualityHash,
    },
  });
  const staleDescriptions = result.issues
    .map((issue) => issue.description)
    .filter((description) => STALE_WORKLOAD_CODES.some((code) => description.includes(code)));
  if (staleDescriptions.length > 0) {
    throw new Error(
      staleDescriptions.join(" | ")
    );
  }
  const spoilerDescriptions = result.issues
    .map((issue) => issue.description)
    .filter((description) => /unsupported conclusion|gives away the answer|spoiler/i.test(description));
  if (spoilerDescriptions.length > 0) {
    throw new Error(spoilerDescriptions.join(" | "));
  }
  return result;
}

export async function persistAfterLinuxPreSaveWorkloadBoundary<T>(input: {
  context?: LinuxInvestigationContext;
  assets: LabAsset[];
  simulation?: LinuxSimulationWorld;
  lab: FinalLinuxNarrative;
  provenance?: LinuxGenerationProvenance;
  deterministicHashes?: LinuxDeterministicHashes;
  persist: () => Promise<T> | T;
}): Promise<{ quality: LinuxFinalQualityResult; saved: T }> {
  const quality = assertLinuxPreSaveWorkloadBoundary(input);
  const saved = await input.persist();
  return { quality, saved };
}
