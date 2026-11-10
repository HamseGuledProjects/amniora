import type { WebVulnerabilityModule } from "../schema";

/** The same reviewed stored-content renderer is bound by either template. */
export const storedXssV1: WebVulnerabilityModule = {
  id: "stored-xss",
  version: "1.0.0",
  family: "xss",
  variant: "stored-html",
  requiredCapability: "persistent-content-html-v1",
  behavior: "stored",
  successEvent: "script-executed-from-stored-content",
  extensionPoint: "stored-output",
  supportedDifficulties: ["Beginner"],
  runtimeBinding: `
    function renderStoredContent(node, entry, acceptsContent) {
      if (acceptsContent && entry.submittedByLearner === true) node.innerHTML = entry.body;
      else node.textContent = entry.body;
    }
  `,
};
