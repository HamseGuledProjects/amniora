import { buildEvidenceZip, buildLabPdf } from "../lab-export";
import { DEMO_LAB_ID } from "./config";
import { demoAssets, demoLab, DEMO_TIME } from "./fixtures";

type Message = { id: string; role: "user" | "assistant"; content: string };
type Conversation = { id: string; title: string; mode: string; created_at: string; updated_at: string; messages: Message[] };
type DemoState = { conversations: Conversation[]; feedback: Record<string, unknown>; job: Record<string, unknown> | null };
const scope = globalThis as typeof globalThis & { amnioraPortfolioState?: DemoState };
function state() { return scope.amnioraPortfolioState ??= { conversations: [], feedback: {}, job: null }; }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Amniora-Mode": "synthetic-local-demo" } }); }
function text(value: unknown, maximum = 3000) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
function newConversation() {
  const value: Conversation = { id: `demo-chat-${crypto.randomUUID()}`, title: "Sample investigation discussion", mode: "tutor", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: [] };
  state().conversations.unshift(value); state().conversations = state().conversations.slice(0, 30); return value;
}
function demoReply(message: string) {
  const lower = message.toLowerCase();
  if (/permission|chmod|linux/.test(lower)) return "Example response from the local demo\n\nLinux file permissions separate owner, group and other access. Read, write and execute have different effects for files and directories. In this sample, first identify the account in logs/auth.log, then correlate its recorded actions in evidence/activity.csv. The records do not establish the person's intent.\n\nTry asking: what does the accepted sign-in prove, and what remains unknown?";
  if (/quiz|network/.test(lower)) return "Example response from the local demo\n\nQuick check: a log records a successful SSH sign-in from 192.0.2.10. Does that prove a compromise?\n\nNo. It establishes that the system accepted the sign-in. You would still need the account's authorisation context, key ownership and related activity. The address here is reserved for documentation and is not a target.";
  return "Example response from the local demo\n\nStart with the evidence, then state a narrow finding. The sample auth.log records an accepted public-key sign-in for the fictional student account at 21:14:02. The activity file records a later identity check. Correlate those timestamps and cite both files.\n\nA successful login does not identify the person at the keyboard or prove malicious intent. This reply is a written example, not a live AI answer.";
}

/** Handles every API path in the portfolio. Unknown paths never fall through to a service-backed route. */
export async function handleDemoApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const route = url.pathname;
  let body: Record<string, unknown> = {};
  if (!["GET", "HEAD"].includes(request.method)) {
    if (Number(request.headers.get("content-length") || 0) > 20_000) return json({ error: "The local demo accepts short sample inputs only." }, 413);
    try {
      const raw = await request.text(); if (raw.length > 20_000) return json({ error: "Sample input is too long." }, 413);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "A sample request must be an object." }, 400);
      body = parsed as Record<string, unknown>;
    } catch { return json({ error: "Invalid sample request." }, 400); }
  }
  const allowedMethods: Record<string, string[]> = {
    "/api/service-status": ["GET"], "/api/portfolio/reset": ["POST"],
    "/api/ai/content-consent": ["POST"], "/api/ai/linux-grading/consent": ["POST"],
    "/api/auth/check-account": ["POST"], "/api/ai/conversations/delete-all": ["DELETE"],
    "/api/ai/conversations": ["GET", "POST"], "/api/ai/tutor": ["POST"],
    "/api/ai/task-assist": ["POST"], "/api/ai/lab-generation-jobs": ["GET", "POST"],
    "/api/ai/generate-lab": ["POST"], "/api/ai/linux-grading": ["GET"],
  };
  if (allowedMethods[route] && !allowedMethods[route].includes(request.method)) return json({ error: "Method unavailable for this local example." }, 405);
  if (route === "/api/service-status") return json({ status: "healthy", message: null, detail: null, source: "none", checkedAt: DEMO_TIME, cacheTtlSeconds: 300 });
  if (route === "/api/portfolio/reset") { scope.amnioraPortfolioState = { conversations: [], feedback: {}, job: null }; return json({ ok: true }); }
  if (route === "/api/ai/content-consent" || route === "/api/ai/linux-grading/consent") return json({ token: "synthetic-local-demo", consented: true, demo: true });
  if (route === "/api/auth/check-account") return json({ exists: true, demo: true });
  if (route === "/api/ai/conversations/delete-all") { state().conversations = []; return json({ success: true }); }
  if (route === "/api/ai/conversations") {
    if (request.method === "POST") return json({ conversation: newConversation() });
    return json({ conversations: state().conversations.map(({ messages, ...conversation }) => { void messages; return conversation; }) });
  }
  const conversationMatch = route.match(/^\/api\/ai\/conversations\/([^/]+)(\/delete)?$/);
  if (conversationMatch) {
    if (!["GET", "DELETE"].includes(request.method) || (conversationMatch[2] && request.method !== "DELETE")) return json({ error: "Method unavailable for this sample chat." }, 405);
    const conversation = state().conversations.find(item => item.id === conversationMatch[1]);
    if (request.method === "DELETE") { state().conversations = state().conversations.filter(item => item.id !== conversationMatch[1]); return json({ success: true }); }
    return conversation ? json({ conversation, messages: conversation.messages }) : json({ error: "This sample chat has been reset." }, 404);
  }
  if (route === "/api/ai/tutor") {
    const message = text(body.message);
    if (!message) return json({ error: "Enter a sample question." }, 400);
    const conversation = state().conversations.find(item => item.id === body.conversationId) ?? newConversation();
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: message };
    const assistantMessage: Message = { id: crypto.randomUUID(), role: "assistant", content: demoReply(message) };
    conversation.messages.push(userMessage, assistantMessage); conversation.messages = conversation.messages.slice(-40); conversation.updated_at = new Date().toISOString();
    return json({ conversationId: conversation.id, assistantMessage, userMessage, message: assistantMessage.content, demo: true });
  }
  if (route === "/api/ai/task-assist") {
    const mode = text(body.mode, 20);
    const response = mode === "quiz" ? JSON.stringify({ question: "What does the accepted sign-in establish?", options: ["The system accepted this sign-in", "A compromise is proven", "The human operator is identified", "The source is safe"], answer: "The system accepted this sign-in", correctAnswer: "The system accepted this sign-in", explanation: "This local sample records an event, not intent or identity." }) : mode === "command" ? "# Local sample only: inspect the downloaded evidence file\ngrep 'Accepted' logs/auth.log\n\nThis is a written example. Nothing is executed by the website." : mode === "hint" ? "Sample hint: find the Accepted publickey line, then compare its time with activity.csv. State what the evidence does not show." : demoReply(text(body.task));
    return json({ response, demo: true });
  }
  if (route === "/api/ai/lab-generation-jobs" || route === "/api/ai/generate-lab") {
    if (request.method === "POST") { state().job = { id: `demo-job-${crypto.randomUUID()}`, category: "Linux", difficulty: "Beginner", duration: "30 mins", status: "completed", resultingLabId: DEMO_LAB_ID, safeErrorCode: null, safeErrorMessage: null, retryable: false, createdAt: DEMO_TIME, updatedAt: DEMO_TIME, startedAt: DEMO_TIME, completedAt: DEMO_TIME, failedAt: null, expiresAt: "2099-01-01T00:00:00.000Z" }; }
    return json({ job: state().job, executableWebAvailable: false, demo: true, message: "The fixed synthetic investigation is ready. No AI request was made." });
  }
  if (route === "/api/ai/linux-grading") return json({ gradingAvailable: false, manualCompletionLocked: false, tasks: [], completed: false, maxAnswerLength: 3000, message: "Automatic assessment is unavailable in the local demo. Compare your reasoning with the supplied hints." });
  const labAction = route.match(/^\/api\/labs\/([^/]+)\/(download|feedback|complaints)$/);
  if (labAction) {
    const methods = labAction[2] === "download" ? ["GET"] : labAction[2] === "feedback" ? ["GET", "PUT"] : ["GET", "POST"];
    if (!methods.includes(request.method)) return json({ error: "Method unavailable for this sample investigation." }, 405);
    if (labAction[2] === "download") {
      const pdf = url.searchParams.get("format") === "pdf";
      const bytes = pdf ? buildLabPdf(demoLab, demoAssets) : buildEvidenceZip(demoLab, demoAssets).zip;
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": pdf ? "application/pdf" : "application/zip", "Content-Disposition": `attachment; filename="amniora-synthetic-investigation.${pdf ? "pdf" : "zip"}"`, "Cache-Control": "no-store" } });
    }
    if (labAction[2] === "feedback") {
      if (request.method !== "GET") state().feedback[labAction[1]] = { reference: "DEMO-FEEDBACK", rating: text(body.rating, 20), improvementNote: text(body.improvementNote, 1500), updatedAt: DEMO_TIME };
      return json({ feedback: state().feedback[labAction[1]] ?? null, message: "Sample feedback kept in this local session. Nothing was sent." });
    }
    return json({ complaints: [], reference: "DEMO-REPORT", message: "This local demonstration does not send reports." });
  }
  if (route.startsWith("/api/web-labs/") && request.method === "GET") return json({ enabled: false, eligible: false, build: null, plan: "pro", runtime: null, demo: true });
  return json({ error: "This operation is unavailable in the local portfolio demo. No external service was contacted.", demo: true }, 409);
}
