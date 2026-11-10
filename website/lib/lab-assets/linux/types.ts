import type { AssetPackInput, LabAsset } from "../types";
import type { InvestigationWorld } from "../world";
import type { LinuxIncident } from "./incidents";
import type { LinuxInvestigationContext } from "./investigation";
import type { LinuxSimulationWorld } from "./simulation";

export type LinuxSimulationTestOverrides = {
  companyName?: string;
  hostname?: string;
  primaryUsername?: string;
  serviceAccountUsername?: string;
  uid?: number;
  gid?: number;
  sourceIp?: string;
  timezone?: string;
  incidentStart?: string;
  collectionTime?: string;
  changeId?: string;
  command?: string;
  filePath?: string;
};

export type LinuxAssetInput = {
  input: AssetPackInput;
  world: InvestigationWorld;
  incident: LinuxIncident;
  investigation: LinuxInvestigationContext;
  simulation: LinuxSimulationWorld;
  intermediate: boolean;
  advanced: boolean;
  testOverrides?: LinuxSimulationTestOverrides;
};

export type LinuxAssetBuilder = (data: LinuxAssetInput) => LabAsset;
