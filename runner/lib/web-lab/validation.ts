import type { WebLabSpec, WebVulnerabilityModule } from "./schema";
import { stableLabId } from "./seed";
import { webApplicationTemplate } from "./templates/registry";
import { canonicalJson } from "./canonical-json";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function text(value: unknown, max = 300): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
function unique(values: string[]) { return new Set(values).size === values.length; }
function dataOnly(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return true;
  if (Array.isArray(value)) return value.length <= 100 && value.every(item => dataOnly(item, depth + 1));
  return record(value) && Object.keys(value).length <= 30 && Object.values(value).every(item => dataOnly(item, depth + 1));
}
function validEntry(value: unknown, users: Record<string, unknown>[]) {
  return exact(value, ["id", "authorId", "body"]) && text(value.id, 40) && text(value.body, 1000) && users.some(user => user.id === value.authorId);
}

export function validateWebLabSpec(value: unknown, vulnerabilityModule: WebVulnerabilityModule): string[] {
  const issues: string[] = [];
  const fail = (message: string) => { issues.push(message); };
  if (!record(value) || !dataOnly(value)) return ["Schema must be a data-only WebLabSpec object"];
  const template = webApplicationTemplate(value.templateId);
  if (!template) return ["Unsupported template/version"];
  const templateDataKeys = template.id === "helpdesk" ? ["articles", "tickets"] : ["categories", "products"];
  if (!exact(value, ["schemaVersion", "seed", "labId", "templateId", "templateVersion", "difficulty", "durationMinutes", "application", "users", "session", ...templateDataKeys, "routes", "vulnerability", "learner", "internalSolution", "resetState"])) return ["Schema must be a data-only, exact WebLabSpec object"];
  const vulnerability = record(value.vulnerability) ? value.vulnerability : {};
  const learner = record(value.learner) ? value.learner : {};
  const solution = record(value.internalSolution) ? value.internalSolution : {};
  const session = record(value.session) ? value.session : {};
  const success = record(learner.successCondition) ? learner.successCondition : {};
  const users = Array.isArray(value.users) ? value.users.filter(record) : [];
  const routes = Array.isArray(value.routes) ? value.routes : [];
  if (value.schemaVersion !== 1) fail("Unsupported schema version");
  if (typeof value.seed !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value.seed)) fail("Invalid seed");
  else if (value.labId !== stableLabId(value.seed, vulnerabilityModule.id, template.id)) fail("Lab ID does not match canonical seed/template/module");
  if (value.templateVersion !== template.version) fail("Unsupported template/version");
  if (value.difficulty !== "Beginner" || value.durationMinutes !== 30) fail("Unsupported Web lab difficulty/duration");
  if (!exact(value.application, ["name", "company", "tagline"]) || !text(value.application.name) || !text(value.application.company) || !text(value.application.tagline)) fail("Invalid application identity");
  const roles = template.id === "helpdesk" ? ["agent", "requester"] : ["staff", "customer"];
  if (!Array.isArray(value.users) || users.length !== value.users.length || users.length < 2 || users.length > 8 || !users.every(user => exact(user, ["id", "name", "role"]) && text(user.id, 40) && text(user.name, 80) && roles.includes(String(user.role))) || !unique(users.map(user => String(user.id)))) fail("Invalid user inventory");
  if (!exact(value.session, ["displayUserId", "mode"]) || session.mode !== "fictional-display-only" || !users.some(user => user.id === session.displayUserId)) fail("Session display user does not resolve");
  const expectedRoutes = template.routes;
  if (routes.length !== expectedRoutes.length || !routes.every(route => exact(route, ["path", "page"]) && expectedRoutes.includes(String(route.path)) && route.page === (route.path === "/" ? "home" : String(route.path).slice(1))) || !unique(routes.map(route => String(route?.path)))) fail("Template routes/pages are incomplete or broken");

  const articles = Array.isArray(value.articles) ? value.articles : [];
  const tickets = Array.isArray(value.tickets) ? value.tickets : [];
  const categories = Array.isArray(value.categories) ? value.categories : [];
  const products = Array.isArray(value.products) ? value.products : [];
  if (template.id === "helpdesk") {
    if (articles.length < 2 || articles.length > 10 || !articles.every(article => exact(article, ["id", "title", "body"]) && text(article.id, 40) && text(article.title, 160) && text(article.body, 1000)) || !unique(articles.map(article => String(article?.id)))) fail("Invalid article inventory");
    if (tickets.length < 2 || tickets.length > 10 || !tickets.every(ticket => exact(ticket, ["id", "ownerId", "subject", "status", "replyEnabled", "comments"]) && text(ticket.id, 40) && text(ticket.subject, 160) && ["Open", "In progress", "Resolved"].includes(String(ticket.status)) && typeof ticket.replyEnabled === "boolean" && users.some(user => user.id === ticket.ownerId) && Array.isArray(ticket.comments) && ticket.comments.length <= 10 && ticket.comments.every((comment: unknown) => validEntry(comment, users)) && unique(ticket.comments.map((comment: { id: string }) => comment.id))) || !unique(tickets.map(ticket => String(ticket?.id)))) fail("Invalid ticket/comment inventory or ownership");
  } else {
    if (categories.length < 2 || categories.length > 8 || !categories.every(category => exact(category, ["id", "name"]) && text(category.id, 40) && text(category.name, 80)) || !unique(categories.map(category => String(category?.id)))) fail("Invalid category inventory");
    if (products.length < 2 || products.length > 10 || !products.every(product => exact(product, ["id", "name", "description", "categoryId", "priceDisplay", "reviewEnabled", "reviews"]) && text(product.id, 40) && text(product.name, 160) && text(product.description, 1000) && /^£\d{1,4}\.\d{2}$/.test(String(product.priceDisplay)) && typeof product.reviewEnabled === "boolean" && categories.some(category => record(category) && category.id === product.categoryId) && Array.isArray(product.reviews) && product.reviews.length <= 10 && product.reviews.every((review: unknown) => validEntry(review, users)) && unique(product.reviews.map((review: { id: string }) => review.id))) || !unique(products.map(product => String(product?.id)))) fail("Invalid product/review inventory or category reference");
  }

  const binding = template.bindings[vulnerabilityModule.behavior];
  if (!binding || !template.capabilities.includes(vulnerabilityModule.requiredCapability) || binding.capability !== vulnerabilityModule.requiredCapability || binding.extensionPoint !== vulnerabilityModule.extensionPoint || !vulnerabilityModule.supportedDifficulties.includes(value.difficulty as WebLabSpec["difficulty"])) fail("Template/module compatibility mismatch");
  if (!binding || !routes.some(route => record(route) && route.path === binding.route) || !text(binding.input, 40) || !text(binding.sink, 80) || !text(binding.renderingContext, 120)) fail("Template binding has nonexistent route, field, sink or context");
  const stored = vulnerabilityModule.behavior === "stored";
  const vulnerabilityKeys = ["moduleId", "moduleVersion", "variant", "route", "input", "sink", ...(stored ? ["storedFlow"] : [])];
  if (!exact(value.vulnerability, vulnerabilityKeys) || vulnerability.moduleId !== vulnerabilityModule.id || vulnerability.moduleVersion !== vulnerabilityModule.version || vulnerability.variant !== vulnerabilityModule.variant || vulnerability.route !== binding?.route || vulnerability.input !== binding?.input || vulnerability.sink !== binding?.sink) fail("Vulnerability module/binding contract mismatch");
  const taskCopy = template.taskCopy[vulnerabilityModule.behavior];
  const taskKeys = ["objective", "targetRoute", "targetInput", "targetSink", "expectedClass", "claimedBehavior", "renderingContext", "expectedObservations", "successCondition", ...(stored ? ["storedFlow"] : [])];
  if (!exact(value.learner, taskKeys) || learner.objective !== taskCopy.objective || learner.targetRoute !== binding?.route || learner.targetInput !== binding?.input || learner.targetSink !== binding?.sink || learner.expectedClass !== vulnerabilityModule.id || learner.claimedBehavior !== vulnerabilityModule.behavior || learner.renderingContext !== binding?.renderingContext || !Array.isArray(learner.expectedObservations) || canonicalJson(learner.expectedObservations) !== canonicalJson(taskCopy.expectedObservations) || !exact(learner.successCondition, ["kind", "eventType"]) || success.kind !== "trusted-runtime-event" || success.eventType !== vulnerabilityModule.successEvent) fail("Learner task/success contract mismatch");
  const solutionKeys = ["moduleId", "route", "input", "sink", "renderingContext", "class", "behavior", "successCondition", "groundTruthTag", ...(stored ? ["storedFlow"] : [])];
  if (!exact(value.internalSolution, solutionKeys) || solution.moduleId !== vulnerabilityModule.id || solution.route !== binding?.route || solution.input !== binding?.input || solution.sink !== binding?.sink || solution.renderingContext !== binding?.renderingContext || solution.class !== vulnerabilityModule.id || solution.behavior !== vulnerabilityModule.behavior || solution.successCondition !== vulnerabilityModule.successEvent || solution.groundTruthTag !== `internal-${value.labId}`) fail("Internal solution disagrees with module/binding");
  if (stored) {
    const flow = vulnerability.storedFlow;
    const flowKeys = ["submissionRoute", "action", "inputField", "targetObjectType", "targetObjectId", "storageLocation", "persistence", "retrievalRoute"];
    const objects = template.id === "helpdesk" ? tickets : products;
    const target = objects.find(object => record(object) && object.id === (record(flow) ? flow.targetObjectId : undefined));
    const enabledKey = template.id === "helpdesk" ? "replyEnabled" : "reviewEnabled";
    const validOwner = template.id !== "helpdesk" || (record(target) && target.ownerId === session.displayUserId);
    if (!exact(flow, flowKeys) || flow.submissionRoute !== binding?.route || flow.action !== binding?.action || flow.inputField !== binding?.input || flow.targetObjectType !== binding?.targetObjectType || !text(flow.targetObjectId, 40) || flow.storageLocation !== binding?.storageLocation || flow.persistence !== "instance-session" || flow.retrievalRoute !== binding?.retrievalRoute || !routes.some(route => record(route) && route.path === flow.submissionRoute) || !routes.some(route => record(route) && route.path === flow.retrievalRoute) || !target || !record(target) || target[enabledKey] !== true || !validOwner || objects.filter(object => record(object) && object[enabledKey] === true).length !== 1) fail("Stored transition has disconnected route, field, persistence, object type or target");
    if (!exact(learner.storedFlow, flowKeys) || canonicalJson(learner.storedFlow) !== canonicalJson(flow)) fail("Learner stored-flow task disagrees with runtime");
    if (!exact(solution.storedFlow, flowKeys) || canonicalJson(solution.storedFlow) !== canonicalJson(flow)) fail("Internal stored-flow solution disagrees with runtime");
  }
  if (!exact(value.resetState, ["route", "query", "completed"]) || value.resetState.route !== "/" || value.resetState.query !== "" || value.resetState.completed !== false) fail("Invalid canonical reset state");
  return issues;
}
