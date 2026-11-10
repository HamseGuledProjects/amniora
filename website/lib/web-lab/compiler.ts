import type { WebLabSpec, WebLabPublicData } from "./schema";
import { webApplicationTemplate } from "./templates/registry";
import { webVulnerabilityModule } from "./vulnerabilities/registry";
import { validateWebLabSpec } from "./validation";
import { buildWebLabManifest, type WebLabBuildManifest } from "./manifest";
import { webLabRuntimeRequirements, type WebLabRuntimeRequirements } from "./runtime-requirements";

export type CompiledWebLab = {
  labId: string;
  html: string;
  learner: WebLabSpec["learner"];
  /** Internal QA metadata; never serialize this whole object into the target app. */
  manifest: WebLabBuildManifest;
  /** Future runner obligations, not guarantees provided by this offline compiler. */
  runtimeRequirements: WebLabRuntimeRequirements;
  isolation: { iframeSandbox: "allow-scripts"; opaqueOriginRequired: true; networkAccess: "subresources-blocked-by-CSP" };
};

export function compileWebLab(input: unknown): CompiledWebLab {
  const moduleId = input && typeof input === "object" && "vulnerability" in input && input.vulnerability && typeof input.vulnerability === "object" && "moduleId" in input.vulnerability ? input.vulnerability.moduleId : null;
  const vulnerabilityModule = webVulnerabilityModule(moduleId);
  if (!vulnerabilityModule) throw new Error("Web lab validation failed: Unknown vulnerability module");
  const templateId = input && typeof input === "object" && "templateId" in input ? input.templateId : null;
  const template = webApplicationTemplate(templateId);
  if (!template) throw new Error("Web lab validation failed: Unknown application template");
  const issues = validateWebLabSpec(input, vulnerabilityModule);
  if (issues.length) throw new Error(`Web lab validation failed: ${issues.join("; ")}`);
  const spec = input as WebLabSpec;
  const publicData: WebLabPublicData = {
    labId: spec.labId,
    application: spec.application,
    users: spec.users,
    session: spec.session,
    articles: spec.articles,
    tickets: spec.tickets,
    categories: spec.categories,
    products: spec.products,
    routes: spec.routes,
  };
  const html = template.render(publicData, vulnerabilityModule);
  if (!html.includes(vulnerabilityModule.runtimeBinding) || !html.includes("node.innerHTML =") || (html.match(/\.innerHTML\s*=/g) || []).length !== 1) {
    throw new Error("Compiled lab failed the vulnerability/success contract");
  }
  return {
    labId: spec.labId,
    html,
    learner: spec.learner,
    manifest: buildWebLabManifest(spec, html),
    runtimeRequirements: webLabRuntimeRequirements,
    isolation: { iframeSandbox: "allow-scripts", opaqueOriginRequired: true, networkAccess: "subresources-blocked-by-CSP" },
  };
}
