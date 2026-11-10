import { buildBaseAssets } from "../base";
import { buildInvestigationWorld } from "../world";
import type { AssetPackInput, LabAsset } from "../types";

import { buildAuthLog } from "./authLog";
import { buildSyslog } from "./syslog";
import { buildSudoLog } from "./sudoLog";
import { buildUserAssets } from "./users";
import { buildReportAssets } from "./reports";
import { buildEvidenceAssets } from "./evidence";
import { buildLinuxIncident } from "./incidents";
import { buildConfigs } from "./configs";
import { buildAdvancedLinuxArtifacts } from "./advancedArtifacts";
import {
  buildLinuxInvestigationContext,
  validateLinuxInvestigationAssets,
} from "./investigation";
import {
  assertLinuxTaskEvidenceClosureInvariant,
  buildLinuxSimulationWorld,
  validateLinuxSimulationEvidence,
} from "./simulation";
import {
  buildLinuxGenerationContext,
  computeLinuxDeterministicHashes,
  type LinuxDeterministicHashes,
  type LinuxGenerationProvenance,
} from "./generationContext";
import { validateLinuxTaskPlanAgainstDifficultyProfile } from "./difficultyProfile";
import { checkLinuxInvestigationQuality } from "./qualityChecker";
import { assertLinuxEngineBoundaries } from "./domainOwnership";
import type { LinuxInvestigationContext } from "./investigation";
import type { LinuxSimulationTestOverrides } from "./types";
import { labelLinuxEvidenceTimeAuthority, prepareLinuxPatchAEvidence, validateLinuxLearnerPackBoundaries, validateLinuxPatch1Integrity, validateLinuxPatchAIntegrity } from "./learnerQa";
import { validateLinuxIdentityRealism } from "./identityRealism";

export type LinuxAssetCandidate = {
  assets: LabAsset[];
  investigation: LinuxInvestigationContext;
  simulation: ReturnType<typeof buildLinuxSimulationWorld>;
  assetQuality: ReturnType<typeof checkLinuxInvestigationQuality>;
  provenance: LinuxGenerationProvenance;
  deterministicHashes: LinuxDeterministicHashes;
  generationAttempts?: number;
  rejectionReasons?: string[];
};

export type LinuxAssetCandidateDiagnostics = {
  incidentFamily?: string;
  onAttempt?: (event: {
    attempt: number;
    accepted: boolean;
    reason?: string;
    incidentFamily?: string;
    hostRole?: string;
    score?: number;
    workloadReport?: ReturnType<typeof checkLinuxInvestigationQuality>["workloadReport"];
    workloadEstimateHash?: string;
    workloadReportHash?: string;
    issueCodes?: string[];
  }) => void;
  testOverrides?: LinuxSimulationTestOverrides;
  boundaryAssertionTransform?: (candidate: {
    assets: LabAsset[];
    investigation: LinuxInvestigationContext;
    simulation: ReturnType<typeof buildLinuxSimulationWorld>;
  }) => void;
};

function parseIncidentStart(value: string | undefined) {
  if (!value) return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (!match) throw new Error(`Linux test override rejected: incidentStart ${value} is not YYYY-MM-DD HH:MM[:SS].`);
  return { date: match[1], time: match[2] };
}

function validateUsername(name: string | undefined, label: string) {
  if (name === undefined) return;
  if (!/^[a-z_][a-z0-9._-]{0,31}$/i.test(name)) {
    throw new Error(`Linux test override rejected: ${label} is not a valid Linux username.`);
  }
}

function validateHostname(name: string | undefined) {
  if (name === undefined) return;
  const labels = name.split(".");
  if (
    name.length > 253 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  ) {
    throw new Error(`Linux test override rejected: hostname ${name} is not valid.`);
  }
}

function validateIPv4(address: string | undefined, label: string) {
  if (address === undefined) return;
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) {
    throw new Error(`Linux test override rejected: ${label} ${address} is not a supported IPv4 address.`);
  }
}

function validateTestOverrides(overrides: LinuxSimulationTestOverrides | undefined) {
  if (!overrides) return;
  validateUsername(overrides.primaryUsername, "primaryUsername");
  validateUsername(overrides.serviceAccountUsername, "serviceAccountUsername");
  validateHostname(overrides.hostname);
  validateIPv4(overrides.sourceIp, "sourceIp");
  parseIncidentStart(overrides.incidentStart);
  if (overrides.collectionTime && !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(overrides.collectionTime)) {
    throw new Error(`Linux test override rejected: collectionTime ${overrides.collectionTime} is not YYYY-MM-DD HH:MM:SS.`);
  }
  if (overrides.uid !== undefined && (!Number.isInteger(overrides.uid) || overrides.uid < 1 || overrides.uid > 60000)) {
    throw new Error(`Linux test override rejected: uid ${overrides.uid} is outside the supported active-account range.`);
  }
  if (overrides.gid !== undefined && (!Number.isInteger(overrides.gid) || overrides.gid < 1 || overrides.gid > 60000)) {
    throw new Error(`Linux test override rejected: gid ${overrides.gid} is outside the supported active-account range.`);
  }
  if (overrides.primaryUsername && overrides.serviceAccountUsername && overrides.primaryUsername === overrides.serviceAccountUsername) {
    throw new Error("Linux test override rejected: duplicate username across primary and service account.");
  }
  if (overrides.filePath && !/^\/[^\r\n]+$/.test(overrides.filePath)) {
    throw new Error(`Linux test override rejected: filePath ${overrides.filePath} must be an absolute single-line path.`);
  }
  if (overrides.command && /[\r\n]/.test(overrides.command)) {
    throw new Error("Linux test override rejected: command must be a single line.");
  }
}

function applyTestOverrides(
  world: ReturnType<typeof buildInvestigationWorld>,
  incident: ReturnType<typeof buildLinuxIncident>,
  investigation: LinuxInvestigationContext,
  overrides: LinuxSimulationTestOverrides | undefined
) {
  if (!overrides) return;
  if (overrides.companyName) {
    world.company = overrides.companyName;
    investigation.company = overrides.companyName;
  }
  if (overrides.hostname) {
    world.host = overrides.hostname;
    investigation.hostname = overrides.hostname;
  }
  if (overrides.primaryUsername) {
    incident.primaryUser = overrides.primaryUsername;
    investigation.primaryUser = overrides.primaryUsername;
  }
  if (overrides.serviceAccountUsername) {
    world.serviceUser = overrides.serviceAccountUsername;
    investigation.serviceAccounts = [overrides.serviceAccountUsername, world.appUser];
  }
  if (overrides.sourceIp) {
    world.suspiciousIp = overrides.sourceIp;
    incident.suspiciousIp = overrides.sourceIp;
    investigation.externalIps = [overrides.sourceIp, world.adminIp, world.backupIp];
  }
  if (overrides.timezone) {
    world.timezone = overrides.timezone;
    investigation.timezone = overrides.timezone;
  }
  if (overrides.changeId) {
    world.changeId = overrides.changeId;
    investigation.changeId = overrides.changeId;
  }
  if (overrides.command) {
    investigation.suspiciousCommands = [overrides.command, ...investigation.suspiciousCommands.slice(1)];
  }
  if (overrides.filePath) {
    investigation.modifiedFiles = [overrides.filePath, ...investigation.modifiedFiles.slice(1)];
    investigation.modifiedConfigurations = [overrides.filePath, ...investigation.modifiedConfigurations.slice(1)];
  }
}

class LinuxAssetQualityRejectedError extends Error {
  constructor(message: string, public readonly reported = false) {
    super(message);
    this.name = "LinuxAssetQualityRejectedError";
  }
}

export function buildLinuxAssetCandidate(
  input: AssetPackInput,
  diagnostics: LinuxAssetCandidateDiagnostics = {}
): LinuxAssetCandidate {
  let lastError: unknown;
  const rejectionReasons: string[] = [];
  validateTestOverrides(diagnostics.testOverrides);

  const startingAssetAttempt = input.assetAttempt ?? 1;
  const rootInput = {
    ...input,
    seed: input.seed,
    generationTime: input.generationTime,
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const generationContext = buildLinuxGenerationContext(rootInput, {
      assetAttempt: startingAssetAttempt + attempt,
    });
    const world = buildInvestigationWorld(generationContext);
    const incidentStart = parseIncidentStart(diagnostics.testOverrides?.incidentStart);
    if (diagnostics.testOverrides?.companyName) world.company = diagnostics.testOverrides.companyName;
    if (diagnostics.testOverrides?.hostname) world.host = diagnostics.testOverrides.hostname;
    if (diagnostics.testOverrides?.serviceAccountUsername) world.serviceUser = diagnostics.testOverrides.serviceAccountUsername;
    if (diagnostics.testOverrides?.sourceIp) world.suspiciousIp = diagnostics.testOverrides.sourceIp;
    if (diagnostics.testOverrides?.timezone) world.timezone = diagnostics.testOverrides.timezone;
    if (diagnostics.testOverrides?.changeId) world.changeId = diagnostics.testOverrides.changeId;
    if (incidentStart) world.incidentDate = incidentStart.date;
    const incident = buildLinuxIncident(world, generationContext);
    if (diagnostics.incidentFamily && incident.id !== diagnostics.incidentFamily) {
      diagnostics.onAttempt?.({
        attempt: attempt + 1,
        accepted: false,
        reason: `skipped incident family ${incident.id}`,
        incidentFamily: incident.id,
        hostRole: world.serverRole,
      });
      continue;
    }
    if (diagnostics.testOverrides?.primaryUsername) incident.primaryUser = diagnostics.testOverrides.primaryUsername;
    if (diagnostics.testOverrides?.sourceIp) incident.suspiciousIp = diagnostics.testOverrides.sourceIp;
    if (incidentStart) incident.triggerTime = incidentStart.time;
    const investigation = buildLinuxInvestigationContext(world, incident, input.difficulty);
    applyTestOverrides(world, incident, investigation, diagnostics.testOverrides);
    const simulation = buildLinuxSimulationWorld({
      world,
      incident,
        investigation,
        difficulty: input.difficulty,
        seed: generationContext.random("simulation").seed,
        requestedDurationMinutes: generationContext.provenance.durationMinutes,
        testOverrides: diagnostics.testOverrides,
      });
    const context = {
      input,
      world,
      incident,
      investigation,
      simulation,
      intermediate: input.difficulty === "Intermediate",
      advanced: input.difficulty === "Advanced",
      testOverrides: diagnostics.testOverrides,
    };

    let assets = [
      ...buildBaseAssets({
        ...input,
        generatedAt: `${simulation.collection.collectedAt.replace(" ", "T")}Z`,
      }),
      buildAuthLog(context),
      buildSyslog(context),
      buildSudoLog(context),
      buildConfigs(context),
      ...buildUserAssets(context),
      ...buildReportAssets(context),
      ...buildEvidenceAssets(context),
      ...buildAdvancedLinuxArtifacts(context),
    ];
    prepareLinuxPatchAEvidence(simulation, assets);
    labelLinuxEvidenceTimeAuthority(assets, simulation);
    simulation.difficultyDiagnostics = validateLinuxTaskPlanAgainstDifficultyProfile({
      difficulty: input.difficulty,
      requestedDurationMinutes: generationContext.provenance.durationMinutes,
      tasks: simulation.canonicalTasks,
      fullEvidenceRegistry: simulation.evidenceRegistry,
      planningEvidenceRegistry: simulation.planningEvidenceRegistry,
      renderedAssetPaths: assets.map((asset) => asset.file_path),
    });

    try {
      diagnostics.boundaryAssertionTransform?.({ assets, investigation, simulation });
      validateLinuxLearnerPackBoundaries(assets);
      validateLinuxPatch1Integrity(simulation, assets);
      validateLinuxPatchAIntegrity(simulation, assets);
      assertLinuxTaskEvidenceClosureInvariant(simulation, assets.map((asset) => asset.file_path));
      assertLinuxEngineBoundaries({ simulation, assets });
      validateLinuxInvestigationAssets(investigation, assets);
      if (input.difficulty === "Advanced") {
        validateLinuxSimulationEvidence(simulation, assets);
      }
      validateLinuxIdentityRealism(assets);
      const quality = checkLinuxInvestigationQuality({
        context: investigation,
        assets,
        simulation,
        workload: {
          requestedDifficulty: input.difficulty,
          requestedDurationMinutes: generationContext.provenance.durationMinutes,
        },
      });
      console.info(
        `[CyberLab Linux Quality] ${quality.passed ? "PASS" : "FAIL"} score=${quality.score} role="${investigation.hostRole}" incident="${investigation.incidentFamily}" issues=${quality.issues.length}`
      );
      if (!quality.passed) {
        const topIssues = quality.issues
          .slice(0, 5)
          .map((issue) => `${issue.category}:${issue.description}`)
          .join(" | ");
        const topDeductions = (quality.deductions || [])
          .slice(0, 5)
          .map((deduction) => `${deduction.category}:${deduction.pointsLost}:${deduction.reason}`)
          .join(" | ");
        const reason = `${quality.summary}${topIssues ? ` Top issues: ${topIssues}.` : ""}${topDeductions ? ` Deductions: ${topDeductions}.` : ""}`;
        diagnostics.onAttempt?.({
          attempt: attempt + 1,
          accepted: false,
          reason,
          incidentFamily: investigation.incidentFamily,
          hostRole: investigation.hostRole,
          score: quality.score,
          workloadReport: quality.workloadReport,
          workloadEstimateHash: quality.workloadEstimateHash,
          workloadReportHash: quality.workloadReportHash,
          issueCodes: quality.issues.map((issue) => issue.description.match(/LINUX_WORKLOAD_[A-Z_]+/)?.[0]).filter((code): code is string => Boolean(code)),
        });
        throw new LinuxAssetQualityRejectedError(reason, true);
      }
      diagnostics.onAttempt?.({
        attempt: attempt + 1,
        accepted: true,
        incidentFamily: investigation.incidentFamily,
        hostRole: investigation.hostRole,
        score: quality.score,
        workloadReport: quality.workloadReport,
        workloadEstimateHash: quality.workloadEstimateHash,
        workloadReportHash: quality.workloadReportHash,
      });
      const deterministicHashes = computeLinuxDeterministicHashes({
        world,
        incident,
        simulation,
        assets,
        validation: {
          provenance: generationContext.provenance,
          difficultyDiagnostics: simulation.difficultyDiagnostics,
          assetQuality: quality,
          workloadEstimateHash: quality.workloadEstimateHash,
          workloadReportHash: quality.workloadReportHash,
          assessmentContractHash: quality.assessmentContractHash,
          assessmentQualityHash: quality.assessmentQualityHash,
        },
      });
      return {
        assets,
        investigation,
        simulation,
        assetQuality: quality,
        provenance: {
          ...generationContext.provenance,
          attempt: {
            ...generationContext.provenance.attempt,
            assetAttempt: startingAssetAttempt + attempt,
          },
          assetAttempt: startingAssetAttempt + attempt,
        },
        deterministicHashes,
        generationAttempts: attempt + 1,
        rejectionReasons,
      };
    } catch (error) {
      lastError = error;
      const reason = error instanceof Error ? error.message : String(error);
      rejectionReasons.push(reason);
      if (!(error instanceof LinuxAssetQualityRejectedError && error.reported)) {
        diagnostics.onAttempt?.({
          attempt: attempt + 1,
          accepted: false,
          reason,
          incidentFamily: investigation.incidentFamily,
          hostRole: investigation.hostRole,
        });
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Linux asset validation failed after regeneration attempts.");
}

export function buildLinuxAssets(input: AssetPackInput): LabAsset[] {
  return buildLinuxAssetCandidate(input).assets;
}

export * from "./assessmentExtractionSchema";
export * from "./assessmentFeedback";
export * from "./assessmentGradingProvenance";
export * from "./freeFormAssessment";
export * from "./diversityProfile";
export * from "./structuralDiversity";
