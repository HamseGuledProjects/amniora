import { createHash } from "node:crypto";
import type { WebLabSpec } from "./schema";
import { canonicalJson } from "./canonical-json";

export function canonicalSpecBytes(spec: WebLabSpec): string {
  return canonicalJson(spec);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type WebLabBuildManifest = {
  schemaVersion: WebLabSpec["schemaVersion"];
  templateId: WebLabSpec["templateId"];
  templateVersion: WebLabSpec["templateVersion"];
  vulnerabilityId: WebLabSpec["vulnerability"]["moduleId"];
  vulnerabilityVersion: WebLabSpec["vulnerability"]["moduleVersion"];
  seed: string;
  difficulty: WebLabSpec["difficulty"];
  durationMinutes: WebLabSpec["durationMinutes"];
  canonicalSpecSha256: string;
  learnerBundleSha256: string;
};

export function buildWebLabManifest(spec: WebLabSpec, html: string): WebLabBuildManifest {
  return {
    schemaVersion: spec.schemaVersion,
    templateId: spec.templateId,
    templateVersion: spec.templateVersion,
    vulnerabilityId: spec.vulnerability.moduleId,
    vulnerabilityVersion: spec.vulnerability.moduleVersion,
    seed: spec.seed,
    difficulty: spec.difficulty,
    durationMinutes: spec.durationMinutes,
    canonicalSpecSha256: sha256(canonicalSpecBytes(spec)),
    learnerBundleSha256: sha256(html),
  };
}
