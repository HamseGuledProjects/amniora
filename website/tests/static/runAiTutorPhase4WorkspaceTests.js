#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
let assertions = 0;

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assert(name, condition, details = "") {
  assertions += 1;
  if (!condition) throw new Error(`${name}: ${details || "failed"}`);
  console.log(`PASS ${name}`);
}

const tutorPage = readText("app/dashboard/tutor/page.tsx");
const tutorRoute = readText("app/api/ai/tutor/route.ts");
const conversationsRoute = readText("app/api/ai/conversations/route.ts");
const conversationRoute = readText("app/api/ai/conversations/[id]/route.ts");
const deleteRoute = readText("app/api/ai/conversations/[id]/delete/route.ts");
const deleteAllRoute = readText("app/api/ai/conversations/delete-all/route.ts");
const dashboardLayout = readText("app/dashboard/layout.tsx");
const appShell = readText("app/components/shell/AppShell.tsx");

assert("Tutor remains a client workspace", tutorPage.startsWith('"use client"'));
assert("Tutor uses existing conversation endpoints", ["/api/ai/conversations", "/api/ai/conversations/delete-all", "/api/ai/tutor", "/api/ai/content-consent"].every((endpoint) => tutorPage.includes(endpoint)));
assert("Tutor preserves new-chat consent gating", tutorPage.includes("setConsentOpen(true)") && tutorPage.includes("pendingTutorMessage") && tutorPage.includes("recordTutorConsent") && tutorPage.includes("createTutorConversation"));
assert("Tutor preserves message send payload", tutorPage.includes("message: trimmed") && tutorPage.includes("conversationId: activeConversationId"));
assert("Tutor preserves Enter to send and Shift+Enter behavior", tutorPage.includes('e.key === "Enter" && !e.shiftKey') && tutorPage.includes("e.preventDefault()"));
assert("Tutor preserves existing quick prompts", ["Explain Linux permissions", "Teach me Active Directory", "Quiz me on networking concepts", "Help me understand a log file"].every((prompt) => tutorPage.includes(prompt)));
assert("Tutor preserves existing quick modes", ["Explain", "Hint", "Quiz", "Study plan", "Lab help"].every((mode) => tutorPage.includes(mode)));
assert("Tutor preserves conversation loading", tutorPage.includes("loadConversation(id: string)") && tutorPage.includes("setMessages(") && tutorPage.includes("data.messages"));
assert("Tutor has saved-chat list loading state separate from transcript loading", tutorPage.includes("conversationListLoading") && tutorPage.includes("setConversationListLoading") && tutorPage.includes("loadConversations({ showLoading = false } = {})") && tutorPage.includes("loadConversations({ showLoading: true })") && tutorPage.includes("ConversationListLoadingSkeleton") && tutorPage.indexOf("conversationListLoading ?") > tutorPage.indexOf("data-ai-tutor-history-scroll"));
assert("Saved-chat list loading uses compact dark row skeletons", tutorPage.includes("data-ai-tutor-conversation-list-loading") && tutorPage.includes('aria-label="Loading saved conversations"') && tutorPage.includes("grid grid-cols-[minmax(0,1fr)_auto]") && tutorPage.includes("border border-white/5 bg-white/[0.018]") && tutorPage.includes("min-h-11") && tutorPage.includes("Loading saved conversations…"));
assert("Saved-chat skeleton appears in both desktop rail and mobile drawer content", tutorPage.includes('presentation="desktop"') && tutorPage.includes('presentation="mobile"') && tutorPage.includes("data-ai-tutor-history-content={presentation}") && tutorPage.includes("conversationListLoading={conversationListLoading}"));
assert("Saved-chat list loading keeps New chat outside the loading list", tutorPage.indexOf("New chat") < tutorPage.indexOf("data-ai-tutor-history-scroll") && tutorPage.indexOf("data-ai-tutor-conversation-list-loading") > tutorPage.indexOf("data-ai-tutor-history-scroll"));
assert("Saved-chat list loading does not replace the whole Tutor workspace", tutorPage.indexOf("data-ai-tutor-conversation-list-loading") > tutorPage.indexOf("data-ai-tutor-history-scroll") && tutorPage.indexOf("data-ai-tutor-conversation-list-loading") < tutorPage.indexOf("function EmptyTutorState"));
assert("Saved-chat list loading respects reduced motion", tutorPage.includes("const pulseAnimation = reducedMotion") && tutorPage.includes("repeat: reducedMotion ? 0 : Infinity") && tutorPage.includes("motion-reduce:animate-none"));
assert("Tutor preserves archive-style single delete", tutorPage.includes("deleteConversation(id: string)") && tutorPage.includes('method: "DELETE"') && deleteRoute.includes("is_archived: true"));
assert("Tutor preserves archive-style delete all", tutorPage.includes("deleteAllConversations") && deleteAllRoute.includes("is_archived: true"));

assert("Authenticated shell provides a bounded app frame", appShell.includes("data-authenticated-shell") && appShell.includes("fixed inset-0") && appShell.includes("h-dvh") && appShell.includes("overflow-hidden"));
assert("Authenticated workspace propagates available height", appShell.includes("data-authenticated-workspace") && appShell.includes("flex-1") && appShell.includes("min-h-0") && appShell.includes("overflow-hidden"));
assert("Authenticated content frame can host full-height routes without leaking document scroll", appShell.includes("data-authenticated-content-frame") && appShell.includes("min-h-full") && !appShell.includes("flex h-full min-h-0 w-full max-w-[90rem]") && !appShell.includes("min-h-full w-full max-w-[90rem] flex-1"));
assert("Tutor root fills authenticated height without viewport subtraction", tutorPage.includes("data-ai-tutor-workspace") && tutorPage.includes("h-full") && tutorPage.includes("flex-1") && tutorPage.includes("overflow-hidden") && !/h-\[calc\(100d?vh-|height:\s*(?:700px|80vh|calc\(100vh)/.test(tutorPage));
assert("Tutor bounded layout consumes remaining app height", tutorPage.includes("data-ai-tutor-bounded-layout") && tutorPage.includes("h-full") && tutorPage.includes("min-h-0") && tutorPage.includes("overflow-hidden"));
assert("Tutor has desktop two-column workspace", tutorPage.includes("data-ai-tutor-bounded-layout") && tutorPage.includes("lg:grid-cols-[18rem_minmax(0,1fr)]"));
assert("Tutor active chat column is bounded", tutorPage.includes("data-ai-tutor-active-chat") && tutorPage.includes("flex-1") && tutorPage.includes("overflow-hidden"));
assert("Tutor history rail is internal and independently scrollable", tutorPage.includes("data-ai-tutor-history-rail") && tutorPage.includes("data-ai-tutor-history-scroll") && tutorPage.includes("overscroll-contain overflow-y-auto"));
assert("Tutor transcript owns primary scroll", tutorPage.includes("data-ai-tutor-transcript") && tutorPage.includes("overscroll-contain overflow-y-auto"));
assert("Tutor header is stable outside transcript scroll", tutorPage.includes("data-ai-tutor-header") && tutorPage.indexOf("data-ai-tutor-header") < tutorPage.indexOf("data-ai-tutor-transcript"));
assert("Tutor composer is stable below transcript", tutorPage.includes("data-ai-tutor-composer") && tutorPage.indexOf("data-ai-tutor-transcript") < tutorPage.indexOf("data-ai-tutor-composer"));
assert("Tutor uses min-h-0 containment", (tutorPage.match(/min-h-0/g) || []).length >= 7 && appShell.includes("data-authenticated-workspace") && appShell.includes("data-authenticated-main-region") && (appShell.match(/min-h-0/g) || []).length >= 2);
assert("Tutor avoids outer normal page-scroll architecture", !tutorPage.includes("lg:ml-[260px]") && !tutorPage.includes("lg:absolute lg:-left") && !tutorPage.includes("max-h-[220px]") && !tutorPage.includes("overflow-y-visible"));
assert("Mobile Tutor header uses compact phone spacing with desktop spacing restored", tutorPage.includes("px-space-3 py-space-3 sm:px-space-5 sm:py-space-4") && tutorPage.includes("gap-space-3 sm:flex-row") && tutorPage.includes("h-9 w-9") && tutorPage.includes("sm:h-10 sm:w-10") && tutorPage.includes("text-lg") && tutorPage.includes("sm:text-xl"));
assert("Mobile safety disclaimer keeps required warning in a denser row", tutorPage.includes("mt-space-2 flex items-start gap-space-1.5") && tutorPage.includes("sm:mt-space-4 sm:gap-space-2 sm:pt-space-3") && tutorPage.includes("Amniora can make mistakes. Verify important information."));
assert("Mobile transcript receives denser inner padding without losing scroll ownership", tutorPage.includes("px-space-3 py-space-3 sm:px-space-6 sm:py-space-5") && tutorPage.includes("data-ai-tutor-transcript"));
assert("Mobile quick modes remain single-row touch controls with reduced vertical footprint", tutorPage.includes("mb-1.5 flex gap-space-2 overflow-x-auto") && tutorPage.includes("[scrollbar-width:none]") && tutorPage.includes("whitespace-nowrap") && tutorPage.includes("min-w-[3.5rem]") && tutorPage.includes("min-h-9") && tutorPage.includes("sm:min-h-10"));
assert("Mobile composer keeps usable input and send controls with tighter padding", tutorPage.includes("px-space-3 py-space-2 sm:px-space-5 sm:py-space-3") && tutorPage.includes("gap-space-2") && tutorPage.includes("sm:gap-space-3") && tutorPage.includes("max-h-28 min-h-10") && tutorPage.includes("sm:max-h-32 sm:min-h-11") && tutorPage.includes("className=\"type-caption mt-1 text-center text-slate-500\""));

assert("Tutor uses dark Amniora workspace surfaces", tutorPage.includes("bg-[#071624]") && tutorPage.includes("bg-[#061320]") && tutorPage.includes("border-white/10"));
assert("Tutor avoids giant light authenticated surfaces", !/bg-(?:surface|background|slate-50)|bg-white(?:[\s\"])|text-heading|text-text-secondary|border-border/.test(tutorPage));
assert("Tutor avoids generic chat bubble visual clone", !tutorPage.includes("rounded-full") && !tutorPage.includes("rounded-xl") && !tutorPage.includes("shadow-xl"));
assert("Tutor message layout is technical and readable", tutorPage.includes("data-ai-tutor-message-role") && tutorPage.includes("whitespace-pre-wrap") && tutorPage.includes("break-words") && tutorPage.includes("max-w-[min(48rem,82%)]"));
assert("Tutor loading state is truthful", tutorPage.includes("Amniora Tutor is responding.") && !/\b(?:0%|100%|Almost done|progressValue|fake stage)\b/i.test(tutorPage));
assert("Tutor errors keep quota upgrade disabled", tutorPage.includes("quotaError") && tutorPage.includes("Upgrade to Pro \u2014 Coming Soon") && tutorPage.includes("disabled"));

assert("Mobile exposes history through drawer not stacked desktop rail", tutorPage.includes("historyOpen") && tutorPage.includes("data-ai-tutor-mobile-history") && tutorPage.includes("data-ai-tutor-mobile-drawer") && tutorPage.includes('role="dialog"') && tutorPage.includes("lg:hidden"));
assert("Mobile drawer has viewport-safe width and opaque separation", tutorPage.includes("w-[min(24rem,calc(100vw-1.5rem))]") && tutorPage.includes("inset-y-3 left-3") && tutorPage.includes("bg-[#061320]") && tutorPage.includes("data-ai-tutor-mobile-history-backdrop"));
assert("Mobile history drawer can close with button backdrop and Escape", tutorPage.includes('aria-label="Close conversations"') && tutorPage.includes("closeHistoryDrawer") && tutorPage.includes('event.key === "Escape"') && tutorPage.includes("requestAnimationFrame"));
assert("Mobile Chats action is compact and in the active header", tutorPage.includes("data-ai-tutor-mobile-history-trigger") && tutorPage.includes('aria-controls="ai-tutor-mobile-history-drawer"') && tutorPage.includes("setHistoryOpen(true)"));
assert("Desktop and mobile rail content are explicitly separated", tutorPage.includes('presentation="desktop"') && tutorPage.includes('presentation="mobile"') && tutorPage.includes("data-ai-tutor-history-content={presentation}"));
assert("Desktop New chat remains prominent in rail", tutorPage.includes("ConversationRailContent") && tutorPage.includes("New chat") && tutorPage.includes("MessageSquarePlus"));
assert("Active conversation state is accessible", tutorPage.includes("aria-current={active ? \"page\" : undefined}"));
assert("History controls remain keyboard-accessible buttons", (tutorPage.match(/type="button"/g) || []).length >= 9 && tutorPage.includes('aria-label="Delete conversation"'));

assert("Tutor uses reduced-motion aware transitions", tutorPage.includes("useReducedMotion") && tutorPage.includes("reducedMotion ? { duration: 0 }") && tutorPage.includes('behavior: reducedMotion ? "auto" : "smooth"'));
assert("Tutor uses functional Framer Motion only", tutorPage.includes("motion.div") && tutorPage.includes("AnimatePresence") && !/gsap|particle|matrix|glow|float/i.test(tutorPage));
assert("Tutor keeps notice timer cleanup", tutorPage.includes("noticeTimerRef") && tutorPage.includes("clearTimeout(noticeTimerRef.current)"));
assert("Tutor does not add fake conversation features", !/pin|favorite|favourite|folder|archive\s+button|rename|search/.test(tutorPage));
assert("Tutor does not hard-code Free/Pro plan display in the header", !tutorPage.includes("Free Plan") && !tutorPage.includes("Pro Plan"));
assert("Tutor keeps safety disclaimer", tutorPage.includes("Amniora can make mistakes. Verify important information."));

assert("Tutor backend still authorizes beta access", tutorRoute.includes("authorizeBetaAccess") && conversationsRoute.includes("authorizeBetaAccess") && conversationRoute.includes("authorizeBetaAccess"));
assert("Tutor backend still reserves and records usage", tutorRoute.includes('reserveAIUsage(user.id, "tutor_prompt")') && tutorRoute.includes("recordAIUsage") && tutorRoute.includes("releaseAIUsageReservation"));
assert("Tutor backend still enforces safety and cybersecurity scope", tutorRoute.includes("checkSafety(message)") && tutorRoute.includes("checkCybersecurityScope(message)"));
assert("Tutor backend still uses existing conversation service", ["createAIConversation", "getAIConversation", "getConversationMessages", "saveAIMessage"].every((name) => tutorRoute.includes(name)));
assert("Dashboard shell architecture remains split", dashboardLayout.includes("mobileHeader=") && dashboardLayout.includes('sidebar={<Sidebar mode="desktop" />}') && dashboardLayout.includes("topBar={<TopBar />}"));

console.log(`AI Tutor Phase 4 workspace tests passed (${assertions} assertions).`);
