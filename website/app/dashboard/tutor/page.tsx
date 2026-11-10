"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { AiContentSharingConsentDialog } from "@/components/ai/AiContentSharingConsentDialog";
import Badge from "@/app/components/ui/Badge";
import Button from "@/app/components/ui/Button";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Conversation = {
  id: string;
  title: string;
  mode: string;
  created_at: string;
  updated_at: string;
};

const promptSuggestions = [
  "Explain Linux permissions",
  "Teach me Active Directory",
  "Quiz me on networking concepts",
  "Help me understand a log file",
];

const quickActions = ["Explain", "Hint", "Quiz", "Study plan", "Lab help"];

function formatConversationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

export default function TutorPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [conversationListLoading, setConversationListLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const [pendingTutorMessage, setPendingTutorMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyDrawerRef = useRef<HTMLDivElement | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === conversationId) || null,
    [conversationId, conversations]
  );

  const conversationCountLabel = conversationListLoading
    ? "Loading saved chats"
    : conversations.length === 1
      ? "1 saved chat"
      : `${conversations.length} saved chats`;

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 2500);
  }

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  }, [messages, loading, historyLoading, reducedMotion]);

  const closeHistoryDrawer = useCallback(() => {
    setHistoryOpen(false);
    window.requestAnimationFrame(() => historyButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!historyOpen) return;

    historyDrawerRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeHistoryDrawer();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeHistoryDrawer, historyOpen]);

  async function loadConversations({ showLoading = false } = {}) {
    if (showLoading) setConversationListLoading(true);

    try {
      const res = await fetch("/api/ai/conversations");
      const data = await res.json();

      if (res.ok) {
        setConversations(data.conversations || []);
      }
    } finally {
      if (showLoading) setConversationListLoading(false);
    }
  }

  useEffect(() => {
    // Conversation history is loaded once when the existing client workspace mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations({ showLoading: true });
  }, []);

  async function loadConversation(id: string) {
    if (loading) {
      showNotice("Wait for Amniora Tutor to finish before switching chats.");
      return;
    }

    setHistoryLoading(true);
    setError("");

    const res = await fetch(`/api/ai/conversations/${id}`);
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Failed to load conversation.");
      setHistoryLoading(false);
      return;
    }

    setConversationId(id);
    setPendingTutorMessage(null);
    setMessages(
      (data.messages || []).map((msg: ChatMessage) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
      }))
    );
    setHistoryOpen(false);

    setHistoryLoading(false);
  }

  async function deleteConversation(id: string) {
    if (loading) {
      showNotice("Wait for Amniora Tutor to finish before deleting chats.");
      return;
    }

    const res = await fetch(`/api/ai/conversations/${id}/delete`, {
      method: "DELETE",
    });

    if (!res.ok) return;

    if (conversationId === id) {
      setConversationId(null);
      setMessages([]);
    }

    await loadConversations();
  }

  async function deleteAllConversations() {
    if (loading) {
      showNotice("Wait for Amniora Tutor to finish before deleting chats.");
      return;
    }

    const res = await fetch("/api/ai/conversations/delete-all", {
      method: "DELETE",
    });

    if (!res.ok) return;

    setConversationId(null);
    setMessages([]);
    setConversations([]);
    setHistoryOpen(false);
  }

  function startNewChat() {
    if (loading) {
      showNotice("You cannot create a new chat while Amniora Tutor is generating.");
      return;
    }

    if (consentSubmitting) return;

    setPendingTutorMessage(null);
    setHistoryOpen(false);
    setConsentOpen(true);
  }

  async function recordTutorConsent() {
    const res = await fetch("/api/ai/content-consent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ feature: "tutor_chat" }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Amniora could not record AI consent.");
    }

    return String(data.token || "");
  }

  async function createTutorConversation(aiContentConsentToken: string) {
    const res = await fetch("/api/ai/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ aiContentConsentToken }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to create conversation.");
    }

    const conversation = data.conversation as Conversation;
    setConversationId(conversation.id);
    setMessages([]);
    await loadConversations();
    return conversation.id;
  }

  async function confirmTutorConsent() {
    if (loading || consentSubmitting) return;

    setConsentSubmitting(true);
    setError("");

    try {
      const token = await recordTutorConsent();
      const newConversationId = await createTutorConversation(token);
      const queuedMessage = pendingTutorMessage;

      setConsentOpen(false);
      setPendingTutorMessage(null);

      if (queuedMessage) {
        setInput("");
        await sendTutorMessage(queuedMessage, newConversationId);
      }
    } catch (err) {
      setConsentOpen(false);
      setPendingTutorMessage(null);
      setError(
        err instanceof Error
          ? err.message
          : "Amniora could not start a consented AI Tutor chat."
      );
    } finally {
      setConsentSubmitting(false);
    }
  }

  async function sendTutorMessage(trimmed: string, activeConversationId: string) {
    if (!trimmed || loading) return;

    setError("");

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/tutor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          conversationId: activeConversationId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "AI Tutor failed to respond.");
        return;
      }

      setConversationId(data.conversationId);

      const assistantMessage: ChatMessage = {
        id: data.assistantMessage?.id || crypto.randomUUID(),
        role: "assistant",
        content: data.message,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      await loadConversations();
      showNotice("Response saved to this conversation.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    if (!conversationId) {
      setPendingTutorMessage(trimmed);
      setConsentOpen(true);
      return;
    }

    setInput("");
    await sendTutorMessage(trimmed, conversationId);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const transition = reducedMotion ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const };

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-white"
      data-ai-tutor-workspace
    >
      <div className="grid h-full min-h-0 flex-1 overflow-hidden border border-white/10 bg-[#071624] shadow-[0_24px_80px_rgba(0,0,0,0.24)] lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)]" data-ai-tutor-bounded-layout>
        <ConversationRail
          conversations={conversations}
          conversationId={conversationId}
          loading={loading}
          historyLoading={historyLoading}
          conversationListLoading={conversationListLoading}
          onNewChat={startNewChat}
          onLoadConversation={loadConversation}
          onDeleteConversation={deleteConversation}
          onDeleteAllConversations={deleteAllConversations}
        />

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#091a2b]" data-ai-tutor-active-chat>
          <header className="shrink-0 border-b border-white/10 bg-[#0a1c2d] px-space-3 py-space-3 sm:px-space-5 sm:py-space-4" data-ai-tutor-header>
            <div className="flex flex-col gap-space-3 sm:flex-row sm:items-center sm:justify-between sm:gap-space-4">
              <div className="flex min-w-0 items-start gap-space-2 sm:gap-space-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-cyan-300/30 bg-cyan-400/10 text-cyan-100 sm:h-10 sm:w-10">
                  <Bot size={21} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="type-label text-cyan-200">AI Tutor</p>
                  <h1 className="mt-0.5 truncate text-lg font-semibold tracking-normal text-white sm:mt-1 sm:text-xl">Amniora AI Tutor</h1>
                  <p className="type-caption mt-0.5 text-slate-400 sm:mt-1">
                    {activeConversation?.title || "Safe cybersecurity learning"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-space-2">
                <Button
                  ref={historyButtonRef}
                  variant="secondary"
                  size="sm"
                  className="min-h-10 border-white/15 bg-[#071624] px-space-3 text-slate-100 hover:border-cyan-300/45 hover:bg-cyan-400/10 lg:hidden"
                  onClick={() => setHistoryOpen(true)}
                  leadingIcon={<Menu size={16} aria-hidden="true" />}
                  aria-expanded={historyOpen}
                  aria-controls="ai-tutor-mobile-history-drawer"
                  data-ai-tutor-mobile-history-trigger
                >
                  Chats
                </Button>
                <Badge variant={loading ? "primary" : "success"} className="rounded-ui-sm">
                  {loading ? "Preparing example" : "Local example"}
                </Badge>
              </div>
            </div>

            <div className="mt-space-2 flex items-start gap-space-1.5 border-t border-white/10 pt-space-2 text-slate-400 sm:mt-space-4 sm:gap-space-2 sm:pt-space-3">
              <ShieldCheck size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-cyan-200" />
              <p className="type-caption">Amniora can make mistakes. Verify important information.</p>
            </div>

            <AnimatePresence>
              {notice && (
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={transition}
                  role="status"
                  className="mt-space-2 border border-cyan-300/30 bg-cyan-400/10 px-space-3 py-space-1.5 text-sm text-cyan-100 sm:mt-space-3 sm:py-space-2"
                >
                  {notice}
                </motion.div>
              )}
            </AnimatePresence>
          </header>

          <div className="tutor-scroll min-h-0 flex-1 overscroll-contain overflow-y-auto overflow-x-hidden px-space-3 py-space-3 sm:px-space-6 sm:py-space-5" data-ai-tutor-transcript>
            <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col">
              {historyLoading && <TranscriptLoading />}

              {!historyLoading && messages.length === 0 && (
                <EmptyTutorState onSuggestion={(suggestion) => setInput(suggestion)} />
              )}

              {!historyLoading && messages.length > 0 && (
                <div className="space-y-space-5" data-ai-tutor-message-list>
                  {messages.map((message) => (
                    <TutorMessage key={message.id} message={message} reducedMotion={Boolean(reducedMotion)} />
                  ))}
                </div>
              )}

              {loading && !historyLoading && <TutorLoadingIndicator reducedMotion={Boolean(reducedMotion)} />}

              {error && <TutorError error={error} />}

              <div ref={chatEndRef} />
            </div>
          </div>

          <footer className="shrink-0 border-t border-white/10 bg-[#0a1c2d] px-space-3 py-space-2 sm:px-space-5 sm:py-space-3" data-ai-tutor-composer>
            <div className="mx-auto w-full max-w-4xl">
              <div className="mb-1.5 flex gap-space-2 overflow-x-auto pb-1.5 [scrollbar-width:none] sm:mb-space-3 [&::-webkit-scrollbar]:hidden" role="group" aria-label="Tutor quick modes" data-ai-tutor-quick-modes>
                {quickActions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => setInput(`${action}: `)}
                    className="type-caption min-h-9 min-w-[3.5rem] shrink-0 whitespace-nowrap border border-white/15 bg-[#0d2134] px-3 text-center font-medium text-slate-200 outline-none transition-[border-color,background-color,color] hover:border-cyan-300/50 hover:bg-cyan-400/10 hover:text-white focus-visible:ring-2 focus-visible:ring-focus sm:min-h-10"
                  >
                    {action}
                  </button>
                ))}
              </div>

              <div className="flex items-end gap-space-2 border border-white/15 bg-[#071624] px-space-2.5 py-space-1.5 focus-within:border-cyan-300/70 focus-within:ring-2 focus-within:ring-cyan-300/15 sm:gap-space-3 sm:px-space-3 sm:py-space-2" data-ai-tutor-input-shell>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Message Amniora Tutor..."
                  aria-label="Message Amniora Tutor"
                  className="max-h-28 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-base leading-6 text-white outline-none placeholder:text-slate-500 [field-sizing:content] sm:max-h-32 sm:min-h-11 sm:text-sm"
                />

                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={loading || historyLoading || !input.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center border border-cyan-300/50 bg-cyan-500 text-white transition-[border-color,background-color,opacity] hover:bg-cyan-400 focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-45 sm:h-10 sm:w-10"
                  aria-label="Send message"
                >
                  <Send size={18} aria-hidden="true" />
                </button>
              </div>

              <p className="type-caption mt-1 text-center text-slate-500">
                Be specific. Ask about labs, tools, Linux, networking, web security and safe practice.
              </p>
            </div>
          </footer>
        </section>
      </div>

      <AnimatePresence>
        {historyOpen && (
          <motion.div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Tutor conversations">
            <motion.button
              type="button"
              aria-label="Close conversations"
              className="absolute inset-0 bg-[#020812]/80 backdrop-blur-sm"
              onClick={closeHistoryDrawer}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
              data-ai-tutor-mobile-history-backdrop
            />
            <motion.div
              id="ai-tutor-mobile-history-drawer"
              ref={historyDrawerRef}
              tabIndex={-1}
              initial={reducedMotion ? false : { x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { x: -24, opacity: 0 }}
              transition={transition}
              className="absolute inset-y-3 left-3 flex w-[min(24rem,calc(100vw-1.5rem))] min-w-0 flex-col border border-white/10 bg-[#061320] shadow-[24px_0_80px_rgba(0,0,0,0.45)] outline-none"
              data-ai-tutor-mobile-history
              data-ai-tutor-mobile-drawer
            >
              <div className="flex items-center justify-between border-b border-white/10 px-space-4 py-space-3">
                <p className="type-label text-cyan-200">Chats</p>
                <button
                  type="button"
                  onClick={closeHistoryDrawer}
                  className="flex h-10 w-10 items-center justify-center text-slate-300 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-focus"
                  aria-label="Close conversations"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <ConversationRailContent
                conversations={conversations}
                conversationId={conversationId}
                loading={loading}
                historyLoading={historyLoading}
                conversationListLoading={conversationListLoading}
                countLabel={conversationCountLabel}
                onNewChat={startNewChat}
                onLoadConversation={loadConversation}
                onDeleteConversation={deleteConversation}
                onDeleteAllConversations={deleteAllConversations}
                presentation="mobile"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AiContentSharingConsentDialog
        open={consentOpen}
        feature="tutor_chat"
        onCancel={() => {
          setConsentOpen(false);
          setPendingTutorMessage(null);
        }}
        onConfirm={confirmTutorConsent}
        isSubmitting={consentSubmitting}
      />
    </motion.div>
  );
}

function ConversationRail({
  conversations,
  conversationId,
  loading,
  historyLoading,
  conversationListLoading,
  onNewChat,
  onLoadConversation,
  onDeleteConversation,
  onDeleteAllConversations,
}: {
  conversations: Conversation[];
  conversationId: string | null;
  loading: boolean;
  historyLoading: boolean;
  conversationListLoading: boolean;
  onNewChat: () => void;
  onLoadConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onDeleteAllConversations: () => void;
}) {
  const countLabel = conversations.length === 1 ? "1 saved chat" : `${conversations.length} saved chats`;

  return (
    <aside className="hidden min-h-0 min-w-0 border-r border-white/10 bg-[#061320] lg:flex lg:flex-col" data-ai-tutor-history-rail>
      <ConversationRailContent
        conversations={conversations}
        conversationId={conversationId}
        loading={loading}
        historyLoading={historyLoading}
        conversationListLoading={conversationListLoading}
        countLabel={countLabel}
        onNewChat={onNewChat}
        onLoadConversation={onLoadConversation}
        onDeleteConversation={onDeleteConversation}
        onDeleteAllConversations={onDeleteAllConversations}
        presentation="desktop"
      />
    </aside>
  );
}

function ConversationRailContent({
  conversations,
  conversationId,
  loading,
  historyLoading,
  conversationListLoading,
  countLabel,
  onNewChat,
  onLoadConversation,
  onDeleteConversation,
  onDeleteAllConversations,
  presentation,
}: {
  conversations: Conversation[];
  conversationId: string | null;
  loading: boolean;
  historyLoading: boolean;
  conversationListLoading: boolean;
  countLabel: string;
  onNewChat: () => void;
  onLoadConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onDeleteAllConversations: () => void;
  presentation: "desktop" | "mobile";
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ai-tutor-history-content={presentation}>
      <div className="shrink-0 border-b border-white/10 p-space-4">
        <Button
          onClick={onNewChat}
          disabled={loading}
          className="w-full justify-center"
          leadingIcon={<MessageSquarePlus size={16} aria-hidden="true" />}
        >
          New chat
        </Button>
        <div className="mt-space-4 flex items-end justify-between gap-space-3">
          <div>
            <p className="type-label text-slate-400">Tutor conversations</p>
            <p className="type-caption mt-1 text-slate-500">{countLabel}</p>
          </div>
          {conversations.length > 0 && (
            <button
              type="button"
              onClick={onDeleteAllConversations}
              disabled={loading || historyLoading || conversationListLoading}
              className="type-caption min-h-9 border border-red-300/30 bg-red-500/10 px-space-2 text-red-200 outline-none transition-[border-color,background-color] hover:bg-red-500/20 focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-45"
            >
              Delete all
            </button>
          )}
        </div>
      </div>

      <div className="tutor-scroll min-h-0 flex-1 overscroll-contain overflow-y-auto p-space-3" data-ai-tutor-history-scroll>
        {conversationListLoading ? (
          <ConversationListLoadingSkeleton />
        ) : conversations.length === 0 ? (
          <div className="border border-dashed border-white/15 bg-[#071624] p-space-4 text-center">
            <MessageSquare size={18} aria-hidden="true" className="mx-auto text-slate-500" />
            <p className="type-caption mt-space-2 text-slate-400">No saved conversations yet.</p>
          </div>
        ) : (
          <div className="space-y-space-2">
            {conversations.map((conversation) => {
              const active = conversation.id === conversationId;
              return (
                <div
                  key={conversation.id}
                  className={`group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-space-2 border px-space-3 py-space-2 transition-[border-color,background-color] ${
                    active
                      ? "border-cyan-300/50 bg-cyan-400/10"
                      : "border-white/5 bg-transparent hover:border-white/15 hover:bg-white/[0.03]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onLoadConversation(conversation.id)}
                    disabled={loading || historyLoading}
                    className="min-h-11 min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
                    aria-current={active ? "page" : undefined}
                  >
                    <p className="truncate text-sm font-medium text-white">{conversation.title || "Untitled chat"}</p>
                    <p className="type-caption mt-0.5 text-slate-500">{formatConversationDate(conversation.updated_at)}</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteConversation(conversation.id)}
                    disabled={loading || historyLoading}
                    className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-500 outline-none transition-[background-color,color] hover:bg-red-500/10 hover:text-red-200 focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-45"
                    aria-label="Delete conversation"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationListLoadingSkeleton() {
  const reducedMotion = useReducedMotion();
  const pulseAnimation = reducedMotion
    ? { opacity: 0.72 }
    : { opacity: [0.52, 0.84, 0.52] };
  const pulseTransition = {
    duration: 1.6,
    repeat: reducedMotion ? 0 : Infinity,
    ease: "easeInOut" as const,
  };

  return (
    <div
      className="space-y-space-2"
      role="status"
      aria-live="polite"
      aria-label="Loading saved conversations"
      data-ai-tutor-conversation-list-loading
    >
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-space-2 border border-white/5 bg-white/[0.018] px-space-3 py-space-2"
        >
          <div className="min-h-11 min-w-0 space-y-2 py-1">
            <motion.div
              className="h-3.5 w-4/5 rounded-[3px] border border-white/10 bg-white/[0.075]"
              animate={pulseAnimation}
              transition={pulseTransition}
            />
            <motion.div
              className="h-3 w-16 rounded-[3px] border border-white/10 bg-white/[0.055]"
              animate={pulseAnimation}
              transition={{ ...pulseTransition, delay: reducedMotion ? 0 : 0.08 }}
            />
          </div>
          <motion.div
            className="h-10 w-10 border border-white/10 bg-white/[0.045]"
            animate={pulseAnimation}
            transition={{ ...pulseTransition, delay: reducedMotion ? 0 : 0.12 }}
          />
        </div>
      ))}
      <span className="sr-only">Loading saved conversations…</span>
    </div>
  );
}

function EmptyTutorState({ onSuggestion }: { onSuggestion: (suggestion: string) => void }) {
  return (
    <div className="flex flex-1 items-center py-space-6" data-ai-tutor-empty-state>
      <div className="w-full border border-white/10 bg-[#071624] p-space-5 sm:p-space-6">
        <div className="flex flex-col gap-space-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <p className="type-label text-cyan-200">Start point</p>
            <h2 className="mt-space-2 text-2xl font-semibold tracking-normal text-white">Ask for focused cybersecurity help.</h2>
            <p className="type-body mt-space-3 text-slate-300">
              Use the Tutor for Linux, networking, web security, cryptography, investigations, exam preparation and cybersecurity fundamentals.
            </p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-cyan-300/25 bg-cyan-400/10 text-cyan-100">
            <Bot size={25} aria-hidden="true" />
          </div>
        </div>

        <div className="mt-space-6 grid gap-space-2 sm:grid-cols-2" data-ai-tutor-suggestions>
          {promptSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSuggestion(suggestion)}
              className="min-h-12 border border-white/10 bg-[#0a1c2d] px-space-4 py-space-3 text-left text-sm font-medium text-slate-100 outline-none transition-[border-color,background-color] hover:border-cyan-300/50 hover:bg-cyan-400/10 focus-visible:ring-2 focus-visible:ring-focus"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TutorMessage({ message, reducedMotion }: { message: ChatMessage; reducedMotion: boolean }) {
  const isUser = message.role === "user";
  return (
    <motion.article
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className={`grid gap-space-2 ${isUser ? "justify-items-end" : "justify-items-start"}`}
      data-ai-tutor-message-role={message.role}
    >
      <div className={`flex items-center gap-space-2 ${isUser ? "flex-row-reverse" : ""}`}>
        <span className={`flex h-7 w-7 items-center justify-center border ${isUser ? "border-cyan-300/40 bg-cyan-500 text-white" : "border-white/10 bg-[#071624] text-cyan-100"}`}>
          {isUser ? "You".slice(0, 1) : <Bot size={15} aria-hidden="true" />}
        </span>
        <p className="type-caption text-slate-500">{isUser ? "You" : "Amniora Tutor"}</p>
      </div>
      <div
        className={`max-w-[min(44rem,92%)] whitespace-pre-wrap break-words border px-space-4 py-space-3 text-sm leading-7 sm:max-w-[min(48rem,82%)] ${
          isUser
            ? "border-cyan-300/35 bg-cyan-500/16 text-white"
            : "border-white/10 bg-transparent text-slate-200"
        }`}
      >
        {message.content}
      </div>
    </motion.article>
  );
}

function TranscriptLoading() {
  return (
    <div className="space-y-space-5" data-ai-tutor-history-loading>
      <div className="h-4 w-32 animate-pulse bg-white/10 motion-reduce:animate-none" />
      <div className="h-16 w-[78%] animate-pulse bg-white/10 motion-reduce:animate-none" />
      <div className="ml-auto h-14 w-[58%] animate-pulse bg-cyan-400/10 motion-reduce:animate-none" />
      <div className="h-24 w-[82%] animate-pulse bg-white/10 motion-reduce:animate-none" />
    </div>
  );
}

function TutorLoadingIndicator({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-space-5 flex justify-start"
      role="status"
      aria-label="Amniora Tutor is responding"
      data-ai-tutor-loading-state
    >
      <div className="border border-white/10 bg-[#071624] px-space-4 py-space-3 text-slate-300">
        <div className="flex items-center gap-space-3">
          <LoaderDots />
          <span className="type-caption">Amniora Tutor is responding.</span>
        </div>
      </div>
    </motion.div>
  );
}

function LoaderDots() {
  return (
    <span className="flex gap-1.5" aria-hidden="true">
      <span className="h-2 w-2 animate-bounce bg-cyan-300 motion-reduce:animate-none [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce bg-cyan-300 motion-reduce:animate-none [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce bg-cyan-300 motion-reduce:animate-none" />
    </span>
  );
}

function TutorError({ error }: { error: string }) {
  const quotaError = error.toLowerCase().includes("limit") || error.toLowerCase().includes("free users");
  return (
    <div className="mt-space-5 space-y-space-3" data-ai-tutor-error-state>
      <div className="flex items-start gap-space-3 border border-red-300/35 bg-red-500/10 px-space-4 py-space-3 text-sm text-red-100" role="alert">
        <AlertTriangle size={17} aria-hidden="true" className="mt-0.5 shrink-0" />
        <p>{error}</p>
      </div>

      {quotaError && (
        <div className="border border-white/10 bg-[#071624] px-space-4 py-space-4">
          <p className="text-sm font-semibold text-white">Need more AI Tutor access?</p>
          <p className="type-caption mt-0.5 text-slate-400 sm:mt-1">
            Upgrade to Pro later for higher AI limits, more saved conversations, conversation history, AI lab generation and personalised study support.
          </p>
          <button
            type="button"
            disabled
            className="type-caption mt-space-3 min-h-10 border border-cyan-300/25 bg-cyan-400/10 px-space-3 font-semibold text-cyan-200 opacity-70"
          >
            Archived plan example
          </button>
        </div>
      )}
    </div>
  );
}
