"use client";

import { motion } from "framer-motion";
import {
  Copy,
  Check,
  Clock,
  RotateCcw,
  CheckCheck,
  Languages,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ReactionOrbTrigger } from "./ReactionOrbTrigger";
import { LocationMessage } from "./LocationMessage";
import { messagesApi } from "@/lib/api";
import { useAppStore } from "@/lib/stores/app";
import { useAuthStore } from "@/lib/stores/auth";
import { useMotionSafe } from "@/hooks/useMotionSafe";
import { cn, formatMessageTime } from "@/lib/utils";
import type { Message } from "@/lib/types";

const LANGS = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

function CodeMessageCard({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="soft-depth relative max-w-[min(100%,420px)] overflow-hidden rounded-2xl border border-border bg-[#0d1020]">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="rounded-full bg-brand-primary/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-secondary">
          {message.code_language ?? "code"}
        </span>
        <button
          type="button"
          className="rounded-md p-1 text-text-muted hover:text-text-primary"
          onClick={async () => {
            await navigator.clipboard.writeText(message.body ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-text-primary">
        <code>{message.body}</code>
      </pre>
    </div>
  );
}

function VoiceMessage({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-[200px]">
      <div className="mb-1 flex h-8 items-end gap-0.5 px-1">
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="w-1 rounded-full bg-brand-secondary/70"
            style={{ height: `${20 + ((i * 17) % 60)}%` }}
          />
        ))}
      </div>
      {message.transcript && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-left text-[11px] text-text-muted"
        >
          {open ? message.transcript : "Show transcript"}
        </button>
      )}
    </div>
  );
}

export function MessageBubble({
  message,
  mine,
  showTail,
  grouped,
  onRetry,
  autoTranslateLanguage,
}: {
  message: Message;
  mine: boolean;
  showTail: boolean;
  grouped: boolean;
  onRetry?: (message: Message) => void;
  autoTranslateLanguage?: string | null;
}) {
  const motionSafe = useMotionSafe();
  const me = useAuthStore((s) => s.user);
  const patchMessage = useAppStore((s) => s.patchMessage);
  const deleted = !!message.deleted_at;
  const pending = message.localStatus === "pending";
  const failed = message.localStatus === "failed";

  const [pickerOpen, setPickerOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState<{
    text: string;
    source?: string | null;
    lang: string;
  } | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const autoTried = useRef(false);

  async function react(emoji: string) {
    if (pending || failed || message.id.startsWith("opt-")) return;
    const prev = message.reactions ?? [];
    const withoutMe = prev.filter((r) => r.user_id !== me?.id);
    patchMessage(message.chat_id, message.id, {
      reactions: [...withoutMe, { user_id: me?.id ?? "", emoji }],
    });
    try {
      await messagesApi.react(message.id, emoji);
    } catch {
      patchMessage(message.chat_id, message.id, { reactions: prev });
    }
  }

  async function translateTo(lang: string) {
    if (!message.body || message.id.startsWith("opt-")) return;
    setPickerOpen(false);
    setTranslating(true);
    try {
      const res = await messagesApi.translate(message.id, lang);
      setTranslation({
        text: res.translatedText,
        source: res.sourceLanguage,
        lang: res.targetLanguage,
      });
      setShowOriginal(false);
    } catch {
      /* silent — user can retry */
    } finally {
      setTranslating(false);
    }
  }

  // Auto-translate incoming messages when chat preference is set
  useEffect(() => {
    if (
      mine ||
      deleted ||
      !autoTranslateLanguage ||
      !message.body ||
      message.id.startsWith("opt-") ||
      translation ||
      autoTried.current
    ) {
      return;
    }
    autoTried.current = true;
    void translateTo(autoTranslateLanguage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslateLanguage, message.id]);

  const reactionCounts = (message.reactions ?? []).reduce<
    Record<string, number>
  >((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
    return acc;
  }, {});

  const langLabel =
    LANGS.find((l) => l.code === translation?.lang)?.label ??
    translation?.lang ??
    "";

  return (
    <motion.div
      initial={motionSafe.entrance}
      animate={motionSafe.entranceAnimate}
      transition={motionSafe.transition}
      className={cn(
        "group/bubble flex",
        mine ? "justify-end" : "justify-start",
        grouped ? "mt-1" : "mt-3",
        pending && "opacity-60",
      )}
    >
      <ReactionOrbTrigger onReact={react}>
        <div className="relative max-w-[75%]">
          {message.context && (
            <div className="mb-1 rounded-lg border border-border bg-surface-elevated/60 px-2 py-1 text-[10px] text-text-muted">
              {message.context}
            </div>
          )}

          {message.type === "code" && !deleted ? (
            <CodeMessageCard message={message} />
          ) : message.type === "location" && message.location_share && !deleted ? (
            <LocationMessage
              share={message.location_share}
              onStopped={(next) => {
                patchMessage(message.chat_id, message.id, {
                  location_share: next,
                });
              }}
            />
          ) : (
            <div
              className={cn(
                "relative px-3.5 py-2 text-sm leading-relaxed",
                mine
                  ? "bg-brand-primary text-white"
                  : "bg-surface-elevated text-text-primary",
                showTail
                  ? mine
                    ? "rounded-2xl rounded-br-md"
                    : "rounded-2xl rounded-bl-md"
                  : "rounded-2xl",
                failed && "ring-1 ring-danger/60",
              )}
            >
              {!deleted && message.type === "text" && message.body && (
                <button
                  type="button"
                  title="Translate"
                  className={cn(
                    "absolute -top-2 rounded-full border border-border bg-surface p-1 opacity-0 shadow transition group-hover/bubble:opacity-100",
                    mine ? "-left-2" : "-right-2",
                    pickerOpen && "opacity-100",
                  )}
                  onClick={() => setPickerOpen((v) => !v)}
                >
                  <Languages
                    size={12}
                    className="text-text-secondary"
                  />
                </button>
              )}

              {pickerOpen && (
                <div
                  className={cn(
                    "absolute z-20 mt-1 max-h-48 w-40 overflow-y-auto rounded-xl border border-border bg-surface-elevated p-1 shadow-lg",
                    mine ? "right-0 top-full" : "left-0 top-full",
                  )}
                >
                  {LANGS.map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-hover"
                      onClick={() => void translateTo(l.code)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}

              {deleted ? (
                <span className="italic opacity-70">Message deleted</span>
              ) : message.type === "voice" ? (
                <VoiceMessage message={message} />
              ) : (
                <>
                  {message.body}
                  {translation && !showOriginal && (
                    <div
                      className={cn(
                        "mt-2 border-t pt-1.5 text-sm",
                        mine
                          ? "border-white/20 text-white/90"
                          : "border-border text-text-primary",
                      )}
                    >
                      <p>{translation.text}</p>
                      <p
                        className={cn(
                          "mt-1 text-[11px]",
                          mine ? "text-white/65" : "text-text-muted",
                        )}
                      >
                        Translated
                        {translation.source
                          ? ` from ${translation.source}`
                          : ""}{" "}
                        → {langLabel}
                        {" · "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => setShowOriginal(true)}
                        >
                          Hide translation
                        </button>
                      </p>
                    </div>
                  )}
                  {translation && showOriginal && (
                    <button
                      type="button"
                      className={cn(
                        "mt-1 text-[11px] underline",
                        mine ? "text-white/70" : "text-text-muted",
                      )}
                      onClick={() => setShowOriginal(false)}
                    >
                      Show translation
                    </button>
                  )}
                  {translating && !translation && (
                    <p
                      className={cn(
                        "mt-1 text-[11px]",
                        mine ? "text-white/70" : "text-text-muted",
                      )}
                    >
                      Translating…
                    </p>
                  )}
                </>
              )}
              <div
                className={cn(
                  "mt-1 flex items-center justify-end gap-1 font-mono text-[10px] tabular-nums",
                  mine ? "text-white/70" : "text-text-muted",
                )}
              >
                {message.edited_at ? "edited · " : ""}
                {formatMessageTime(message.created_at)}
                {mine && pending && <Clock size={10} className="ml-0.5" />}
                {mine && !pending && !failed && (
                  <CheckCheck size={11} className="ml-0.5 opacity-80" />
                )}
                {mine && failed && (
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center gap-0.5 text-danger"
                    onClick={() => onRetry?.(message)}
                  >
                    <RotateCcw size={10} /> Retry
                  </button>
                )}
              </div>
            </div>
          )}

          {Object.keys(reactionCounts).length > 0 && (
            <div
              className={cn(
                "absolute -bottom-2 flex gap-0.5 rounded-full border border-border bg-surface-elevated px-1.5 py-0.5 text-xs shadow",
                mine ? "right-2" : "left-2",
              )}
            >
              {Object.entries(reactionCounts).map(([emoji, count]) => (
                <span key={emoji}>
                  {emoji}
                  {count > 1 ? (
                    <span className="ml-0.5 text-[10px] text-text-muted">
                      {count}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          )}
        </div>
      </ReactionOrbTrigger>
    </motion.div>
  );
}
