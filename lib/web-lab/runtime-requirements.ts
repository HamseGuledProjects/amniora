/** Requirements for a future production runner. These are not supplied by the offline compiler. */
export const webLabRuntimeRequirements = {
  implementationStatus: "required-for-production-not-implemented",
  origin: "unique-opaque-or-dedicated",
  instance: "ephemeral-per-learner",
  stateStorage: "per-instance-mutable-no-cross-user-leakage",
  productionSecrets: "none",
  supabaseServiceRoleCredentials: "none",
  openAiCredentials: "none",
  hostFilesystem: "inaccessible",
  internalNetwork: "deny",
  outboundNetwork: "deny-by-default",
  reset: "recreate-from-canonical-bundle",
  expiration: "bounded-instance-lifetime-required",
  graderChannel: "server-attested-runtime-observations-only",
} as const;

export type WebLabRuntimeRequirements = typeof webLabRuntimeRequirements;
