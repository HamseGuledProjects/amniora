import type { AssetPackInput } from "../types";
import type { LinuxStructuralFingerprint } from "./structuralDiversity";
import {
  createDeterministicRandom,
  deriveLinuxSeed,
  normalizeLinuxSeed,
  stableHash,
  type DeterministicRandom,
  LINUX_PRNG_ALGORITHM_VERSION,
  LINUX_SEED_FORMAT_VERSION,
} from "./deterministicRandom";

export const LINUX_GENERATOR_VERSION = "linux-generator-v8.0";
export const LINUX_WORLD_CONTRACT_VERSION = "linux-world-v8.0";
export const LINUX_INCIDENT_CONTRACT_VERSION = "linux-incident-v8.0";
export const LINUX_SIMULATION_CONTRACT_VERSION = "linux-simulation-v7";
export const LINUX_TASK_CONTRACT_VERSION = "linux-task-contract-v4";
export const LINUX_NARRATIVE_CONTRACT_VERSION = "linux-narrative-contract-v6.5";
export const LINUX_VALIDATION_CONTRACT_VERSION = "linux-validation-v7";
export const LINUX_EVIDENCE_CONTRACT_VERSION = "linux-evidence-v7";
export const LINUX_ASSESSMENT_CONTRACT_VERSION = "linux-assessment-contract-v1.2";

export type LinuxGenerationAttemptMetadata = {
  assetAttempt: number;
  narrativeAttempt?: number;
  taskAttempts?: Record<string, number>;
};

export type LinuxGenerationReplayInput = {
  seed: string;
  seedFormatVersion: string;
  generatorVersion: string;
  worldContractVersion: string;
  incidentContractVersion: string;
  simulationContractVersion: string;
  taskContractVersion: string;
  narrativeContractVersion: string;
  validationContractVersion: string;
  evidenceContractVersion: string;
  category: "Linux";
  difficulty: string;
  durationMinutes: number;
  generationTime: string;
  timezone: string;
  featureFlags: Record<string, boolean | string | number>;
  assetAttempt: number;
};

export type LinuxGenerationProvenance = LinuxGenerationReplayInput & {
  prngAlgorithmVersion: string;
  attempt: LinuxGenerationAttemptMetadata;
  incidentFamily?: string;
  diversityContractVersion?: string;
  structuralFingerprint?: LinuxStructuralFingerprint;
  diversityHistory?: Array<{ acceptedId: string; family: string; fingerprint: LinuxStructuralFingerprint }>;
};

export type LinuxDeterministicHashes = {
  worldHash: string;
  incidentHash: string;
  simulationHash: string;
  taskContractHash: string;
  workloadEstimateHash?: string;
  workloadReportHash?: string;
  assessmentContractHash?: string;
  assessmentQualityHash?: string;
  assetManifestHash: string;
  assetContentHash: string;
  validationInputHash: string;
  finalDeterministicHash: string;
};

export type LinuxGenerationContext = {
  provenance: LinuxGenerationProvenance;
  generationTime: Date;
  rootRandom: DeterministicRandom;
  random(namespace: string): DeterministicRandom;
  deriveId(namespace: string, material?: string): string;
};

function durationToMinutes(duration: string) {
  const parsed = Number.parseInt(duration, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function normalizeGenerationTime(value: string | undefined) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("LINUX_GENERATION_AMBIENT_TIME: generationTime must be an ISO-compatible timestamp.");
  }
  return parsed.toISOString();
}

export function buildLinuxGenerationContext(
  input: AssetPackInput,
  options: {
    seed?: string;
    generationTime?: string;
    assetAttempt?: number;
    narrativeAttempt?: number;
    taskAttempts?: Record<string, number>;
    featureFlags?: Record<string, boolean | string | number>;
  } = {}
): LinuxGenerationContext {
  const rootSeed = normalizeLinuxSeed(options.seed || input.seed);
  const assetAttempt = options.assetAttempt ?? input.assetAttempt ?? 1;
  const generationTime = normalizeGenerationTime(options.generationTime || input.generationTime);
  const replaySeed = deriveLinuxSeed(rootSeed, LINUX_GENERATOR_VERSION, `attempt.asset.${assetAttempt}`);
  const rootRandom = createDeterministicRandom(replaySeed);
  const timezone = input.timezone || "UTC";
  const provenance: LinuxGenerationProvenance = {
    seed: rootSeed,
    seedFormatVersion: LINUX_SEED_FORMAT_VERSION,
    prngAlgorithmVersion: LINUX_PRNG_ALGORITHM_VERSION,
    generatorVersion: LINUX_GENERATOR_VERSION,
    worldContractVersion: LINUX_WORLD_CONTRACT_VERSION,
    incidentContractVersion: LINUX_INCIDENT_CONTRACT_VERSION,
    simulationContractVersion: LINUX_SIMULATION_CONTRACT_VERSION,
    taskContractVersion: LINUX_TASK_CONTRACT_VERSION,
    narrativeContractVersion: LINUX_NARRATIVE_CONTRACT_VERSION,
    validationContractVersion: LINUX_VALIDATION_CONTRACT_VERSION,
    evidenceContractVersion: LINUX_EVIDENCE_CONTRACT_VERSION,
    category: "Linux",
    difficulty: input.difficulty,
    durationMinutes: durationToMinutes(input.duration),
    generationTime,
    timezone,
    featureFlags: options.featureFlags || input.featureFlags || {},
    assetAttempt,
    attempt: {
      assetAttempt,
      narrativeAttempt: options.narrativeAttempt ?? input.narrativeAttempt,
      taskAttempts: options.taskAttempts || input.taskAttempts,
    },
  };

  return {
    provenance,
    generationTime: new Date(generationTime),
    rootRandom,
    random(namespace: string) {
      return createDeterministicRandom(deriveLinuxSeed(replaySeed, LINUX_GENERATOR_VERSION, namespace));
    },
    deriveId(namespace: string, material = "") {
      return createDeterministicRandom(deriveLinuxSeed(replaySeed, LINUX_GENERATOR_VERSION, `${namespace}:${material}`)).id(namespace);
    },
  };
}

export function assertLinuxReplayVersionsSupported(provenance: Pick<LinuxGenerationProvenance, "seedFormatVersion" | "prngAlgorithmVersion" | "generatorVersion">) {
  if (
    provenance.seedFormatVersion !== LINUX_SEED_FORMAT_VERSION ||
    provenance.prngAlgorithmVersion !== LINUX_PRNG_ALGORITHM_VERSION ||
    provenance.generatorVersion !== LINUX_GENERATOR_VERSION
  ) {
    throw new Error("LINUX_GENERATION_VERSION_UNSUPPORTED: deterministic replay version is not supported by this build.");
  }
}

export function computeLinuxDeterministicHashes(input: {
  world: unknown;
  incident: unknown;
  simulation: { canonicalTasks?: unknown; evidenceRegistry?: unknown; planningEvidenceRegistry?: unknown };
  assets: Array<{ file_path: string; content: string; file_name?: string; file_type?: string }>;
  validation: unknown;
}) {
  const assetManifest = input.assets.map((asset) => ({
    file_path: asset.file_path,
    file_name: asset.file_name,
    file_type: asset.file_type,
  }));
  const assetContent = input.assets.map((asset) => ({
    file_path: asset.file_path,
    content: asset.content.replace(/\r\n/g, "\n"),
  }));
  const hashes = {
    worldHash: stableHash(input.world),
    incidentHash: stableHash(input.incident),
    simulationHash: stableHash(input.simulation),
    taskContractHash: stableHash(input.simulation.canonicalTasks || []),
    workloadEstimateHash: (input.validation as { workloadEstimateHash?: string } | undefined)?.workloadEstimateHash,
    workloadReportHash: (input.validation as { workloadReportHash?: string } | undefined)?.workloadReportHash,
    assessmentContractHash: (input.validation as { assessmentContractHash?: string } | undefined)?.assessmentContractHash,
    assessmentQualityHash: (input.validation as { assessmentQualityHash?: string } | undefined)?.assessmentQualityHash,
    assetManifestHash: stableHash(assetManifest),
    assetContentHash: stableHash(assetContent),
    validationInputHash: stableHash(input.validation),
    finalDeterministicHash: "",
  };
  hashes.finalDeterministicHash = stableHash(hashes);
  return hashes;
}
