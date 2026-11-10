import type { LinuxAssetInput } from "./types";
import type { LabAsset } from "../types";
import { buildCsvGroups, buildCsvUsers } from "./noise";
import { csvRow } from "./investigation";

export function buildUserAssets(context: LinuxAssetInput): LabAsset[] {
  const { world, investigation, advanced, intermediate } = context;
  const userCount = advanced ? 180 : intermediate ? 45 : 18;
  const generatedUsers = buildCsvUsers(context, userCount);
  const generatedGroups = buildCsvGroups(context, advanced ? 60 : intermediate ? 18 : 8, userCount);
  const capture = context.simulation.collection.collectedAt;
  const capturedRows = (rows: string, stateType: string) => rows
    .split(/\r?\n/)
    .filter((row) => row.trim())
    .map((row) => `${row},${capture},${stateType},${world.host},${context.simulation.collection.windowStart},${context.simulation.collection.windowEnd}`)
    .join("\n");

  return [
    {
      file_name: "users.csv",
      file_type: "csv",
      file_path: "assets/csv/users.csv",
      content: `username,role,sudo_access,last_login,status,owner,uid,gid,email,manager,home_directory,shell,account_type,captured_at,state_type,host,window_start,window_end
${capturedRows(generatedUsers, "collection_snapshot")}
`,
    },
    {
      file_name: "groups.csv",
      file_type: "csv",
      file_path: "assets/csv/groups.csv",
      content: `group,members,captured_at,state_type,host,window_start,window_end
${capturedRows([
  csvRow(["sudo", [...investigation.adminAccounts, "devops"].join(",")]),
  csvRow(["adm", [world.analystUser, world.adminUser, "auditor"].join(",")]),
  csvRow(["analysts", [world.analystUser, "auditor"].join(",")]),
  csvRow(["docker", [world.adminUser].join(",")]),
  csvRow(["www-data", world.appUser]),
  csvRow(["interns", world.internUser]),
  csvRow(["backup", world.serviceUser]),
  csvRow(["contractors", world.contractorUser]),
  csvRow(["disabled", "former-admin"]),
  generatedGroups,
].join("\n"), "collection_snapshot")}
`,
    },
  ];
}
