import { createHash } from "node:crypto";
import { buildVercelRuntimeBundle } from "../vercel-runtime-bundle";
import type { WebLabSpec } from "../schema";

export const LOCAL_RUNNER_BUNDLE_PATHS = ["index.html", "initial-state.json", "runtime-config.json"] as const;
export type LocalRunnerBundlePath = typeof LOCAL_RUNNER_BUNDLE_PATHS[number];
export type LocalRunnerBundleFile = Readonly<{ path: LocalRunnerBundlePath; content: string; sha256: string }>;

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Reuses the reviewed runtime-safe compiler output and deliberately omits provider shims. */
export function buildLocalRunnerRuntimeBundle(spec: WebLabSpec): readonly LocalRunnerBundleFile[] {
  const generic = buildVercelRuntimeBundle(spec);
  return LOCAL_RUNNER_BUNDLE_PATHS.map(bundlePath => {
    const source = generic.find(file => file.path === bundlePath);
    if (!source) throw new Error("local_runner_bundle_incomplete");
    return { path: bundlePath, content: source.content, sha256: digest(source.content) };
  });
}

export function serializedBundleBytes(files: readonly LocalRunnerBundleFile[]): number {
  return files.reduce((total, file) => total + Buffer.byteLength(file.content, "utf8"), 0);
}
