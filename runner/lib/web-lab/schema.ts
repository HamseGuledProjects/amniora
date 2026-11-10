/** The canonical, data-only input to the Web lab compiler. No executable source belongs here. */
export type WebTemplateId = "helpdesk" | "ecommerce";
export type WebModuleId = "reflected-xss" | "stored-xss";
export type WebStoredFlow = {
  submissionRoute: string;
  action: string;
  inputField: string;
  targetObjectType: "ticket" | "product";
  targetObjectId: string;
  storageLocation: string;
  persistence: "instance-session";
  retrievalRoute: string;
};
export type WebStoredEntry = { id: string; authorId: string; body: string };
export type WebLabSpec = {
  schemaVersion: 1;
  seed: string;
  labId: string;
  templateId: WebTemplateId;
  templateVersion: "1.0.0";
  difficulty: "Beginner";
  durationMinutes: 30;
  application: { name: string; company: string; tagline: string };
  users: { id: string; name: string; role: "agent" | "requester" | "staff" | "customer" }[];
  session: { displayUserId: string; mode: "fictional-display-only" };
  articles?: { id: string; title: string; body: string }[];
  tickets?: { id: string; ownerId: string; subject: string; status: "Open" | "In progress" | "Resolved"; replyEnabled: boolean; comments: WebStoredEntry[] }[];
  categories?: { id: string; name: string }[];
  products?: { id: string; name: string; description: string; categoryId: string; priceDisplay: string; reviewEnabled: boolean; reviews: WebStoredEntry[] }[];
  routes: { path: string; page: string }[];
  vulnerability: {
    moduleId: WebModuleId;
    moduleVersion: "1.0.0";
    variant: "reflected-html" | "stored-html";
    route: string;
    input: string;
    sink: string;
    storedFlow?: WebStoredFlow;
  };
  learner: {
    objective: string;
    targetRoute: string;
    targetInput: string;
    targetSink: string;
    expectedClass: WebModuleId;
    claimedBehavior: "reflected" | "stored";
    renderingContext: string;
    storedFlow?: WebStoredFlow;
    expectedObservations: string[];
    successCondition: { kind: "trusted-runtime-event"; eventType: "script-executed-from-reflected-input" | "script-executed-from-stored-content" };
  };
  /** Server-side ground truth. The compiler never includes this in its HTML output. */
  internalSolution: {
    moduleId: WebModuleId;
    route: string;
    input: string;
    sink: string;
    renderingContext: string;
    class: WebModuleId;
    behavior: "reflected" | "stored";
    successCondition: "script-executed-from-reflected-input" | "script-executed-from-stored-content";
    storedFlow?: WebStoredFlow;
    groundTruthTag: string;
  };
  resetState: { route: "/"; query: ""; completed: false };
};

export type WebLabPublicData = Pick<WebLabSpec, "labId" | "application" | "users" | "session" | "articles" | "tickets" | "categories" | "products" | "routes">;
export type TemplateCapability = "reflectable-input-html-v1" | "persistent-content-html-v1";
export type WebTemplateBinding = {
  capability: TemplateCapability;
  route: string;
  input: string;
  sink: string;
  renderingContext: string;
  extensionPoint: "reflected-output" | "stored-output";
  action?: string;
  targetObjectType?: "ticket" | "product";
  storageLocation?: string;
  retrievalRoute?: string;
};
export type WebTemplate = {
  id: WebTemplateId;
  version: "1.0.0";
  routes: readonly string[];
  capabilities: readonly TemplateCapability[];
  bindings: { reflected: WebTemplateBinding; stored: WebTemplateBinding };
  taskCopy: {
    reflected: { objective: string; expectedObservations: readonly string[] };
    stored: { objective: string; expectedObservations: readonly string[] };
  };
  render: (data: WebLabPublicData, module?: WebVulnerabilityModule) => string;
};
export type WebVulnerabilityModule = {
  id: WebModuleId;
  version: "1.0.0";
  family: "xss";
  variant: WebLabSpec["vulnerability"]["variant"];
  requiredCapability: TemplateCapability;
  behavior: "reflected" | "stored";
  successEvent: WebLabSpec["internalSolution"]["successCondition"];
  extensionPoint: WebTemplateBinding["extensionPoint"];
  supportedDifficulties: readonly WebLabSpec["difficulty"][];
  /** Static reviewed code. Templates supply route, field, object and presentation binding. */
  runtimeBinding: string;
};
