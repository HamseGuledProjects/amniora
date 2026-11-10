import type { AssetPackInput, LabAsset } from "../types";
import { buildLinuxAssetCandidate } from ".";
import {
  assertLinuxReplayVersionsSupported,
  type LinuxDeterministicHashes,
  type LinuxGenerationProvenance,
} from "./generationContext";

export type LinuxReplayVerificationReport = {
  status:
    | "exact_match"
    | "mismatch"
    | "unsupported_version"
    | "historical_without_provenance"
    | "legacy_without_workload_hash"
    | "legacy_without_assessment_hash";
  labId?: string;
  seed: string;
  generatorVersion: string;
  expectedHashes: LinuxDeterministicHashes | null;
  actualHashes: LinuxDeterministicHashes | null;
  mismatchedLayers: string[];
  firstMismatch?: {
    layer: string;
    path?: string;
    expectedHash: string;
    actualHash: string;
  };
  validationPassed: boolean;
  validationIssues: string[];
};

const HASH_LAYERS: Array<keyof LinuxDeterministicHashes> = [
  "worldHash",
  "incidentHash",
  "simulationHash",
  "taskContractHash",
  "workloadEstimateHash",
  "workloadReportHash",
  "assessmentContractHash",
  "assessmentQualityHash",
  "assetManifestHash",
  "assetContentHash",
  "validationInputHash",
  "finalDeterministicHash",
];

export function replayLinuxGeneration(input: {
  labId?: string;
  provenance?: LinuxGenerationProvenance | null;
  expectedHashes?: LinuxDeterministicHashes | null;
  mode?: "verify" | "diagnostic";
  title?: string;
}): LinuxReplayVerificationReport {
  if (!input.provenance) {
    return {
      status: "historical_without_provenance",
      labId: input.labId,
      seed: "",
      generatorVersion: "",
      expectedHashes: null,
      actualHashes: null,
      mismatchedLayers: [],
      validationPassed: false,
      validationIssues: ["LINUX_GENERATION_PROVENANCE_MISSING"],
    };
  }

  try {
    assertLinuxReplayVersionsSupported(input.provenance);
  } catch (error) {
    return {
      status: "unsupported_version",
      labId: input.labId,
      seed: input.provenance.seed,
      generatorVersion: input.provenance.generatorVersion,
      expectedHashes: input.expectedHashes || null,
      actualHashes: null,
      mismatchedLayers: [],
      validationPassed: false,
      validationIssues: [error instanceof Error ? error.message : "LINUX_GENERATION_VERSION_UNSUPPORTED"],
    };
  }

  try {
    const assetInput: AssetPackInput = {
      category: "Linux",
      difficulty: input.provenance.difficulty,
      duration: `${input.provenance.durationMinutes} mins`,
      title: input.title || "CyberLab Asset Pack",
      seed: input.provenance.seed,
      generationTime: input.provenance.generationTime,
      timezone: input.provenance.timezone,
      assetAttempt: input.provenance.assetAttempt,
      featureFlags: input.provenance.featureFlags,
    };
    const candidate = buildLinuxAssetCandidate(assetInput);
    const expectedHashes = input.expectedHashes || candidate.deterministicHashes;
    const expectedHasWorkloadHash = Boolean(expectedHashes.workloadReportHash);
    const expectedHasEstimateHash = Boolean(expectedHashes.workloadEstimateHash);
    const expectedHasAssessmentHash = Boolean(expectedHashes.assessmentContractHash && expectedHashes.assessmentQualityHash);
    const compareLayers = expectedHasWorkloadHash
      ? expectedHasAssessmentHash
        ? HASH_LAYERS
        : HASH_LAYERS.filter((layer) =>
            layer !== "assessmentContractHash" &&
            layer !== "assessmentQualityHash" &&
            layer !== "validationInputHash" &&
            layer !== "finalDeterministicHash"
          )
      : HASH_LAYERS.filter((layer) =>
          layer !== "workloadReportHash" &&
          layer !== "assessmentContractHash" &&
          layer !== "assessmentQualityHash" &&
          layer !== "validationInputHash" &&
          layer !== "finalDeterministicHash" &&
          (!expectedHasEstimateHash ? layer !== "workloadEstimateHash" : true)
        );
    const mismatchedLayers = compareLayers.filter((layer) => expectedHashes[layer] !== candidate.deterministicHashes[layer]);
    const firstLayer = mismatchedLayers[0];
    return {
      status: mismatchedLayers.length === 0
        ? expectedHasWorkloadHash
          ? expectedHasAssessmentHash ? "exact_match" : "legacy_without_assessment_hash"
          : "legacy_without_workload_hash"
        : "mismatch",
      labId: input.labId,
      seed: input.provenance.seed,
      generatorVersion: input.provenance.generatorVersion,
      expectedHashes,
      actualHashes: candidate.deterministicHashes,
      mismatchedLayers,
      firstMismatch: firstLayer
        ? {
            layer: firstLayer,
            expectedHash: String(expectedHashes[firstLayer] || ""),
            actualHash: String(candidate.deterministicHashes[firstLayer] || ""),
          }
        : undefined,
      validationPassed: candidate.assetQuality.passed,
      validationIssues: candidate.assetQuality.issues.map((issue) => `${issue.category}:${issue.description}`),
    };
  } catch (error) {
    return {
      status: "mismatch",
      labId: input.labId,
      seed: input.provenance.seed,
      generatorVersion: input.provenance.generatorVersion,
      expectedHashes: input.expectedHashes || null,
      actualHashes: null,
      mismatchedLayers: ["validationInputHash"],
      validationPassed: false,
      validationIssues: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function deterministicAssetSnapshot(assets: readonly LabAsset[]) {
  return assets.map((asset) => ({
    file_path: asset.file_path,
    file_name: asset.file_name,
    file_type: asset.file_type,
    content: asset.content,
  }));
}
