import type { WebVulnerabilityModule } from "../schema";

/** The same reviewed reflected renderer is bound by either template. */
export const reflectedXssV1: WebVulnerabilityModule = {
  id: "reflected-xss",
  version: "1.0.0",
  family: "xss",
  variant: "reflected-html",
  requiredCapability: "reflectable-input-html-v1",
  behavior: "reflected",
  successEvent: "script-executed-from-reflected-input",
  extensionPoint: "reflected-output",
  supportedDifficulties: ["Beginner"],
  runtimeBinding: `
    function renderReflectedContent(node, value) {
      node.innerHTML = '<span>Results for <strong>' + value + '</strong></span>';
    }
  `,
};
