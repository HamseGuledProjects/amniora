import type { WebLabSpec, WebStoredFlow, WebTemplate, WebVulnerabilityModule } from "./schema";

/** Module-level semantics plus a concrete, reviewed application binding. */
export function boundWebLabContract(template: WebTemplate, vulnerabilityModule: WebVulnerabilityModule, targetObjectId: string, labId: string): Pick<WebLabSpec, "vulnerability" | "learner" | "internalSolution"> {
  const binding = template.bindings[vulnerabilityModule.behavior];
  if (binding.capability !== vulnerabilityModule.requiredCapability || binding.extensionPoint !== vulnerabilityModule.extensionPoint || !template.capabilities.includes(binding.capability)) {
    throw new Error("Template/module capability mismatch");
  }
  const storedFlow: WebStoredFlow | undefined = vulnerabilityModule.behavior === "stored" ? {
    submissionRoute: binding.route,
    action: binding.action!,
    inputField: binding.input,
    targetObjectType: binding.targetObjectType!,
    targetObjectId,
    storageLocation: binding.storageLocation!,
    persistence: "instance-session",
    retrievalRoute: binding.retrievalRoute!,
  } : undefined;
  const copy = template.taskCopy[vulnerabilityModule.behavior];
  return {
    vulnerability: {
      moduleId: vulnerabilityModule.id, moduleVersion: vulnerabilityModule.version, variant: vulnerabilityModule.variant,
      route: binding.route, input: binding.input, sink: binding.sink,
      ...(storedFlow ? { storedFlow: { ...storedFlow } } : {}),
    },
    learner: {
      objective: copy.objective,
      targetRoute: binding.route, targetInput: binding.input, targetSink: binding.sink,
      expectedClass: vulnerabilityModule.id, claimedBehavior: vulnerabilityModule.behavior,
      renderingContext: binding.renderingContext,
      ...(storedFlow ? { storedFlow: { ...storedFlow } } : {}),
      expectedObservations: [...copy.expectedObservations],
      successCondition: { kind: "trusted-runtime-event", eventType: vulnerabilityModule.successEvent },
    },
    internalSolution: {
      moduleId: vulnerabilityModule.id, route: binding.route, input: binding.input, sink: binding.sink,
      renderingContext: binding.renderingContext, class: vulnerabilityModule.id, behavior: vulnerabilityModule.behavior,
      successCondition: vulnerabilityModule.successEvent,
      ...(storedFlow ? { storedFlow: { ...storedFlow } } : {}),
      groundTruthTag: `internal-${labId}`,
    },
  };
}
