import type { LinuxDeterministicHashes, LinuxGenerationProvenance } from "./generationContext";

const SECRET_KEYS = [
  "openai",
  "api_key",
  "apikey",
  "authorization",
  "bearer",
  "consenttoken",
  "consent_token",
  "prompt",
  "systemprompt",
];

export type LinuxGenerationProvenanceRow = {
  lab_id: string;
  generated_lab_id: string | null;
  user_id: string;
  seed: string;
  generator_version: string;
  provenance: LinuxGenerationProvenance;
  deterministic_hashes: LinuxDeterministicHashes;
  workload_estimate_hash: string | null;
  workload_report_hash: string | null;
  assessment_contract_hash: string | null;
  assessment_quality_hash: string | null;
  accepted_asset_attempt: number;
  final_deterministic_hash: string;
};

export function assertLinuxProvenanceIsSafeForPersistence(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const key of SECRET_KEYS) {
    if (serialized.includes(key)) {
      throw new Error(`LINUX_GENERATION_PROVENANCE_UNSAFE: provenance includes prohibited material ${key}.`);
    }
  }
}

export function buildLinuxGenerationProvenanceRow(input: {
  labId: string;
  generatedLabId?: string | null;
  userId: string;
  provenance: LinuxGenerationProvenance;
  deterministicHashes: LinuxDeterministicHashes;
}): LinuxGenerationProvenanceRow {
  const row: LinuxGenerationProvenanceRow = {
    lab_id: input.labId,
    generated_lab_id: input.generatedLabId || null,
    user_id: input.userId,
    seed: input.provenance.seed,
    generator_version: input.provenance.generatorVersion,
    provenance: input.provenance,
    deterministic_hashes: input.deterministicHashes,
    workload_estimate_hash: input.deterministicHashes.workloadEstimateHash || null,
    workload_report_hash: input.deterministicHashes.workloadReportHash || null,
    assessment_contract_hash: input.deterministicHashes.assessmentContractHash || null,
    assessment_quality_hash: input.deterministicHashes.assessmentQualityHash || null,
    accepted_asset_attempt: input.provenance.assetAttempt,
    final_deterministic_hash: input.deterministicHashes.finalDeterministicHash,
  };
  assertLinuxProvenanceIsSafeForPersistence(row);
  return row;
}
