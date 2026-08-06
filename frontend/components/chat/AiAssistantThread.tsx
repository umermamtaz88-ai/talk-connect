"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import {
  MorphSendButton,
  type ComposerState,
} from "@/components/chat/MorphSendButton";
import { TypingDots } from "@/components/ui/primitives";
import { streamAiChat, getAccessToken } from "@/lib/api";
import { cn } from "@/lib/utils";

const AI_STORAGE_KEY = "tc_ai_conversation_id";

type Bubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

export const AI_CHAT_ID = "__talk_connect_ai__";

export function AiAssistantThread({ onBack }: { onBack?: () => void }) {
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [sendState, setSendState] = useState<ComposerState>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streaming = sendState === "sending";

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? localStorage.getItem(AI_STORAGE_KEY)
        : null;
    if (saved) setConversationId(saved);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || streaming) return;
    if (!getAccessToken()) {
      setError("You need to be signed in to use TALK-CONNECT AI.");
      return;
    }

    setText("");
    setError(null);
    setSendState("sending");
    const userId = `u-${crypto.randomUUID()}`;
    const assistantId = `a-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: body },
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);

    try {
      await streamAiChat(
        { message: body, conversationId: conversationId ?? undefined },
        {
          onMeta: (id) => {
            setConversationId(id);
            localStorage.setItem(AI_STORAGE_KEY, id);
          },
          onToken: (token) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + token }
                  : m,
              ),
            );
          },
          onDone: (id) => {
            if (id) {
              setConversationId(id);
              localStorage.setItem(AI_STORAGE_KEY, id);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false } : m,
              ),
            );
          },
          onError: (msg) => {
            setError(msg);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: m.content || "Sorry — something went wrong.",
                      streaming: false,
                    }
                  : m,
              ),
            );
          },
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Could not reach the AI assistant.", streaming: false }
            : m,
        ),
      );
    } finally {
      setSendState("idle");
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-canvas">
      <header className="flex items-center gap-3 border-b border-border px-3 py-3">
        {onBack && (
          <button
            type="button"
            className="rounded-full p-2 text-text-secondary hover:bg-surface-hover md:hidden"
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,#0ea5e9_0%,#6366f1_55%,#f43f5e_100%)] text-white">
          <Sparkles size={18} />
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-[family-name:var(--font-display)] text-base font-semibold">
            TALK-CONNECT AI
          </h2>
          <p className="text-xs text-text-muted">Powered by Gemini · private to you</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <Sparkles className="mx-auto mb-3 text-brand-secondary" size={28} />
            <p className="font-[family-name:var(--font-display)] text-lg font-medium">
              Ask anything
            </p>
            <p className="mt-1 text-sm text-text-muted">
              Draft messages, translate ideas, or brainstorm — replies stream live.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                m.role === "user"
                  ? "rounded-br-md bg-brand-primary text-white"
                  : "rounded-bl-md border border-border bg-surface-elevated text-text-primary",
              )}
            >
              {m.content || (m.streaming ? <TypingDots /> : null)}
              {m.streaming && m.content ? (
                <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-brand-secondary align-middle" />
              ) : null}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="mx-4 mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="border-t border-border px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSendState(e.target.value.trim() ? "typing" : "idle");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Message TALK-CONNECT AI…"
            disabled={streaming}
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-brand-primary"
          />
          <MorphSendButton
            state={streaming ? "sending" : text.trim() ? "typing" : "idle"}
            onSend={() => void send()}
          />
        </div>
      </div>
    </div>
  );
}
