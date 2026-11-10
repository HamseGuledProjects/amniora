import { buildLinuxAssets } from "./linux";
import { buildNetworkingAssets } from "./networking";
import { buildWebSecurityAssets } from "./webSecurity";
import { buildOsintAssets } from "./osint";
import type { AssetPackInput, LabAsset } from "./types";

export function buildAssetPack(input: AssetPackInput): LabAsset[] {
  switch (input.category) {
    case "Linux":
      return buildLinuxAssets(input);

    case "Networking":
      return buildNetworkingAssets(input);

    case "Web Security":
      return buildWebSecurityAssets(input);

    case "OSINT":
      return buildOsintAssets(input);

    default:
      return [
        {
          file_name: "incident_notes.txt",
          file_type: "text",
          file_path: "assets/notes/incident_notes.txt",
          content:
            "Review the provided CyberLab assets and complete the tasks in the saved lab.",
        },
      ];
  }
}

export type { LabAsset, AssetPackInput };