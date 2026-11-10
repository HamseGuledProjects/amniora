import type { WebLabSpec } from "./schema";
import { webVulnerabilityModule } from "./vulnerabilities/registry";
import { validateWebLabSpec } from "./validation";

export type ObservedWebLabEvent = Readonly<{
  labId: string;
  moduleId: string;
  eventType: string;
  route: string;
  input: string;
  sink: string;
  renderingContext: string;
  storedEvidence?: Readonly<{
    instanceId: string;
    targetObjectType: string;
    targetObjectId: string;
    submissionRoute: string;
    action: string;
    inputField: string;
    storageLocation: string;
    persistence: string;
    retrievalRoute: string;
    storedBeforeRender: true;
  }>;
}>;

const attestations = new WeakSet<object>();

/** Trusted runner only: call after independently observing the browser event. Never wrap client claims. */
export function attestObservedWebLabEvent(event: ObservedWebLabEvent): ObservedWebLabEvent {
  const attested = Object.freeze({ ...event, ...(event.storedEvidence ? { storedEvidence: Object.freeze({ ...event.storedEvidence }) } : {}) });
  attestations.add(attested);
  return attested;
}

export type WebLabGrade = { status: "pass" | "not-complete"; reason: string };

/** Offline grading contract. Production must authenticate the observer before attestation. */
export function evaluateWebLabResult(spec: WebLabSpec, observations: readonly unknown[], instanceId?: string): WebLabGrade {
  const vulnerabilityModule = webVulnerabilityModule(spec.vulnerability.moduleId);
  if (!vulnerabilityModule || validateWebLabSpec(spec, vulnerabilityModule).length) return { status: "not-complete", reason: "invalid-lab-contract" };
  const solution = spec.internalSolution;
  const matched = observations.some(observation => {
    if (!observation || typeof observation !== "object" || !attestations.has(observation)) return false;
    const event = observation as ObservedWebLabEvent;
    const flow = solution.storedFlow;
    const storedMatched = !flow || (!!instanceId && !!event.storedEvidence &&
      event.storedEvidence.instanceId === instanceId &&
      event.storedEvidence.targetObjectType === flow.targetObjectType &&
      event.storedEvidence.targetObjectId === flow.targetObjectId &&
      event.storedEvidence.submissionRoute === flow.submissionRoute &&
      event.storedEvidence.action === flow.action &&
      event.storedEvidence.inputField === flow.inputField &&
      event.storedEvidence.storageLocation === flow.storageLocation &&
      event.storedEvidence.persistence === flow.persistence &&
      event.storedEvidence.retrievalRoute === flow.retrievalRoute &&
      event.storedEvidence.storedBeforeRender === true);
    return storedMatched && event.labId === spec.labId &&
      event.moduleId === solution.moduleId &&
      event.eventType === solution.successCondition &&
      event.route === solution.route &&
      event.input === solution.input &&
      event.sink === solution.sink &&
      event.renderingContext === solution.renderingContext;
  });
  return matched ? { status: "pass", reason: "trusted-observation-matched" } : { status: "not-complete", reason: "no-matching-trusted-observation" };
}
