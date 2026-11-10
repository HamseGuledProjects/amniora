import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LINUX_RECENT_CASE_WINDOW,
  LinuxDiversityHistoryError,
  parseLinuxStoredFingerprint,
  type LinuxRecentCase,
} from "./recentDiversity";
import { LINUX_STRUCTURAL_DIVERSITY_VERSION } from "./structuralDiversity";

/** Server-only adapter. No learner identity or raw evidence enters fingerprints. */
export async function loadLinuxRecentAcceptedCases(
  database: Pick<SupabaseClient, "from">,
  userId: string,
  family: string
): Promise<LinuxRecentCase[]> {
  const { data, error } = await database.from("linux_generation_provenance")
    .select("id,created_at,provenance")
    .eq("user_id", userId)
    .eq("provenance->>incidentFamily", family)
    .eq("provenance->>diversityContractVersion", LINUX_STRUCTURAL_DIVERSITY_VERSION)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LINUX_RECENT_CASE_WINDOW);
  if (error || !Array.isArray(data)) throw new LinuxDiversityHistoryError("LINUX_DIVERSITY_HISTORY_READ_FAILED");

  return data.map((row) => ({
    acceptedId: String(row.id),
    family,
    fingerprint: parseLinuxStoredFingerprint(row.provenance?.structuralFingerprint),
  }));
}
