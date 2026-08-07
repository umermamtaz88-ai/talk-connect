"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Phone,
  Video,
  MoreVertical,
  Paperclip,
  Code2,
  HardDrive,
  MapPin,
  X,
} from "lucide-react";
import { MessageList } from "./MessageList";
import {
  MorphSendButton,
  type ComposerState,
} from "./MorphSendButton";
import { ThreadSkeleton } from "./ThreadSkeleton";
import { LiveShareBanner } from "./LocationMessage";
import { ShareLocationSheet } from "./ShareLocationSheet";
import { TypingDots } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";
import { VaultSheet } from "@/components/vault/VaultSheet";
import { BlockReportSheet } from "@/components/friends/BlockReportSheet";
import { callsApi, chatsApi, locationApi, mediaApi, messagesApi } from "@/lib/api";
import { useAppStore } from "@/lib/stores/app";
import { useAuthStore } from "@/lib/stores/auth";
import { useThrottledTyping } from "@/hooks/useThrottledTyping";
import { useLiveLocationWatcher } from "@/hooks/useLiveLocationWatcher";
import { useMotionSafe } from "@/hooks/useMotionSafe";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import type { LocationShare, Message } from "@/lib/types";
import { cn } from "@/lib/utils";

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TYPING: string[] = [];

export default function MessageThread({
  chatId,
  onBack,
  onStartCall,
}: {
  chatId: string;
  onBack?: () => void;
  onStartCall?: (callId: string, type: "audio" | "video") => void;
}) {
  const me = useAuthStore((s) => s.user);
  const chats = useAppStore((s) => s.chats);
  const messages = useAppStore((s) => s.messages[chatId] ?? EMPTY_MESSAGES);
  const loading = useAppStore((s) => s.messagesLoading[chatId]);
  const typing = useAppStore((s) => s.typing[chatId] ?? EMPTY_TYPING);
  const loadMessages = useAppStore((s) => s.loadMessages);
  const upsertMessage = useAppStore((s) => s.upsertMessage);
  const replaceOptimistic = useAppStore((s) => s.replaceOptimistic);
  const markMessageFailed = useAppStore((s) => s.markMessageFailed);
  const clearUnread = useAppStore((s) => s.clearUnread);
  const patchMessage = useAppStore((s) => s.patchMessage);
  const { typingOn, typingOff } = useThrottledTyping(chatId);
  const sendLock = useRef(false);
  const motionSafe = useMotionSafe();
  const voice = useVoiceRecorder();
  const [voiceHint, setVoiceHint] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [sendState, setSendState] = useState<ComposerState>("idle");
  const [codeMode, setCodeMode] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [activeLiveShare, setActiveLiveShare] = useState<LocationShare | null>(
    null,
  );
  const [autoLang, setAutoLang] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  const chat = chats.find((c) => c.id === chatId);
  const title =
    chat?.name ??
    chat?.peer?.display_name ??
    (chat?.is_notes_to_self ? "Notes to Self" : "Chat");

  useEffect(() => {
    setAutoLang(chat?.auto_translate_language ?? null);
  }, [chat?.auto_translate_language, chatId]);

  useEffect(() => {
    void loadMessages(chatId);
    clearUnread(chatId);
    setActiveLiveShare(null);
  }, [chatId, loadMessages, clearUnread]);

  useEffect(() => {
    const mine = messages.find(
      (m) =>
        m.type === "location" &&
        m.sender_id === me?.id &&
        m.location_share?.mode === "live" &&
        m.location_share.status === "active",
    );
    if (mine?.location_share) setActiveLiveShare(mine.location_share);
  }, [messages, me?.id]);

  useLiveLocationWatcher(activeLiveShare, Boolean(activeLiveShare));

  useEffect(() => {
    setSendState(
      voice.state === "recording"
        ? "recording"
        : voice.state === "processing"
          ? "sending"
          : text.trim()
            ? "typing"
            : "idle",
    );
  }, [text, voice.state]);

  async function sendVoice() {
    if (!me || sendLock.current) return;
    const file = await voice.stop();
    if (!file) {
      setVoiceHint(voice.error ?? "Hold longer to record");
      window.setTimeout(() => setVoiceHint(null), 2000);
      return;
    }
    sendLock.current = true;
    const clientId = `opt-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: clientId,
      clientId,
      chat_id: chatId,
      sender_id: me.id,
      type: "voice",
      body: null,
      created_at: new Date().toISOString(),
      localStatus: "pending",
      reactions: [],
      attachments: [],
    };
    upsertMessage(optimistic);
    setSendState("sending");
    try {
      const uploaded = await mediaApi.upload(file, "voice");
      const msg = await messagesApi.send(chatId, {
        type: "voice",
        attachments: [
          {
            storageKey: uploaded.storage_key,
            mimeType: uploaded.mime_type,
            sizeBytes: uploaded.size_bytes,
            filename: uploaded.filename ?? file.name,
          },
        ],
      });
      replaceOptimistic(clientId, { ...msg, clientId, localStatus: "sent" });
    } catch {
      markMessageFailed(chatId, clientId);
      setVoiceHint("Voice send failed — check mic & try again");
      window.setTimeout(() => setVoiceHint(null), 2500);
    } finally {
      sendLock.current = false;
      setSendState(text.trim() ? "typing" : "idle");
    }
  }

  function onChange(value: string) {
    setText(value);
    if (value.trim()) typingOn();
    else typingOff();
  }

  async function sendOptimistic(body: string, opts?: { code?: boolean; clientId?: string }) {
    if (!me || !body.trim() || sendLock.current) return;
    sendLock.current = true;
    const clientId = opts?.clientId ?? `opt-${crypto.randomUUID()}`;
    const replyId = replyTo?.id;
    const optimistic: Message = {
      id: clientId,
      clientId,
      chat_id: chatId,
      sender_id: me.id,
      type: opts?.code ? "code" : "text",
      body: body.trim(),
      code_language: opts?.code ? "typescript" : null,
      reply_to_id: replyId && !replyId.startsWith("opt-") ? replyId : null,
      created_at: new Date().toISOString(),
      localStatus: "pending",
      reactions: [],
    };
    upsertMessage(optimistic);
    setSendState("sending");
    setReplyTo(null);
    typingOff();
    try {
      const msg = await messagesApi.send(chatId, {
        body: body.trim(),
        type: opts?.code ? "code" : "text",
        codeLanguage: opts?.code ? "typescript" : undefined,
        replyToId:
          replyId && !replyId.startsWith("opt-") ? replyId : undefined,
      });
      replaceOptimistic(clientId, { ...msg, clientId, localStatus: "sent" });
    } catch {
      markMessageFailed(chatId, clientId);
    } finally {
      sendLock.current = false;
      setSendState("idle");
    }
  }

  async function send() {
    if (!text.trim() || sendLock.current) return;
    const body = text;
    const code = codeMode;
    setText("");
    setCodeMode(false);
    await sendOptimistic(body, { code });
  }

  async function retry(message: Message) {
    if (!message.body) return;
    markMessageFailed(chatId, message.clientId ?? message.id);
    // remove failed then resend
    useAppStore.setState((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] ?? []).filter(
          (m) => m.id !== message.id && m.clientId !== message.clientId,
        ),
      },
    }));
    await sendOptimistic(message.body, {
      code: message.type === "code",
    });
  }

  async function startCall(type: "audio" | "video") {
    try {
      const call = await callsApi.start(chatId, type);
      onStartCall?.(call.id, type);
    } catch {
      // Call start failures shouldn't take down the thread UI.
    }
  }

  async function setAutoTranslate(lang: string | null) {
    setAutoLang(lang);
    try {
      const updated = await chatsApi.update(chatId, {
        autoTranslateLanguage: lang,
      });
      useAppStore.getState().upsertChat(updated);
    } catch {
      setAutoLang(chat?.auto_translate_language ?? null);
    }
  }

  const showSkeleton = loading && messages.length === 0;

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex items-center gap-3 border-b border-border px-3 py-3 md:px-5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full p-2 text-text-secondary hover:bg-surface-hover md:hidden"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <motion.div layoutId={motionSafe.reduce ? undefined : `chat-avatar-${chatId}`}>
          <Avatar
            name={title}
            url={chat?.avatar_url ?? chat?.peer?.avatar_url}
            size={40}
          />
        </motion.div>
        <div className="min-w-0 flex-1">
          <motion.p
            layoutId={motionSafe.reduce ? undefined : `chat-title-${chatId}`}
            className="truncate font-medium"
          >
            {title}
          </motion.p>
          {typing.length > 0 ? (
            <div className="flex items-center gap-1 text-xs text-success">
              typing <TypingDots />
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              {chat?.peer?.presence_state === "online" ? "Online" : "Chat"}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void startCall("audio")}
          className="rounded-full p-2 text-text-secondary hover:bg-surface-hover hover:text-success"
          aria-label="Voice call"
        >
          <Phone size={18} />
        </button>
        <button
          type="button"
          onClick={() => void startCall("video")}
          className="rounded-full p-2 text-text-secondary hover:bg-surface-hover hover:text-brand-secondary"
          aria-label="Video call"
        >
          <Video size={18} />
        </button>
        <button
          type="button"
          className="relative rounded-full p-2 text-text-secondary hover:bg-surface-hover"
          aria-label="More"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreVertical size={18} />
          {menuOpen && (
            <div className="absolute right-0 top-11 z-30 w-56 rounded-xl border border-border bg-surface-elevated p-2 text-left shadow-xl">
              {chat?.peer?.id && (
                <button
                  type="button"
                  className="mb-1 block w-full rounded-lg px-2 py-1.5 text-sm text-danger hover:bg-surface-hover"
                  onClick={() => {
                    setMenuOpen(false);
                    setReportOpen(true);
                  }}
                >
                  Block / Report…
                </button>
              )}
              <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-text-muted">
                Auto-translate incoming
              </p>
              <button
                type="button"
                className="block w-full rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
                onClick={() => {
                  void setAutoTranslate(null);
                  setMenuOpen(false);
                }}
              >
                Off {!autoLang ? "✓" : ""}
              </button>
              {[
                ["en", "English"],
                ["es", "Spanish"],
                ["fr", "French"],
                ["de", "German"],
                ["ar", "Arabic"],
                ["hi", "Hindi"],
                ["zh", "Chinese"],
              ].map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  className="block w-full rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
                  onClick={() => {
                    void setAutoTranslate(code);
                    setMenuOpen(false);
                  }}
                >
                  {label} {autoLang === code ? "✓" : ""}
                </button>
              ))}
            </div>
          )}
        </button>
      </header>

      {activeLiveShare && (
        <LiveShareBanner
          share={activeLiveShare}
          onStop={() => {
            void locationApi.stop(activeLiveShare.id).then((next) => {
              setActiveLiveShare(null);
              if (next.message_id) {
                patchMessage(chatId, next.message_id, {
                  location_share: next,
                });
              }
            });
          }}
        />
      )}

      <div className="relative min-h-0 flex-1 px-2 md:px-4">
        {showSkeleton ? (
          <ThreadSkeleton />
        ) : (
          <MessageList
            messages={messages}
            myId={me?.id}
            onRetry={(m) => void retry(m)}
            onReply={(m) => setReplyTo(m)}
            onReload={() => void loadMessages(chatId)}
            autoTranslateLanguage={autoLang}
          />
        )}
      </div>

      <div className="border-t border-border px-3 py-3 md:px-5">
        {codeMode && (
          <p className="mb-2 text-[11px] text-brand-secondary">
            Code Room mode — message will send as type: code
          </p>
        )}
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <p className="text-brand-secondary">Replying</p>
              <p className="truncate text-text-secondary">
                {replyTo.body ?? replyTo.type}
              </p>
            </div>
            <button
              type="button"
              aria-label="Cancel reply"
              className="rounded-full p-1 text-text-muted hover:bg-surface-hover"
              onClick={() => setReplyTo(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {(voiceHint || voice.error) && (
          <p className="mb-2 text-[11px] text-danger">
            {voiceHint || voice.error}
          </p>
        )}
        {voice.state === "recording" && (
          <p className="mb-2 text-[11px] text-accent">
            Recording… release to send
          </p>
        )}
        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl transition-shadow",
            typing.length > 0 && "typing-aura p-1",
          )}
        >
          <div className="relative">
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-elevated text-text-secondary hover:text-brand-secondary"
              aria-label="Attach"
            >
              <Paperclip size={18} />
            </button>
            {attachOpen && (
              <div className="absolute bottom-12 left-0 z-20 w-44 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-xl">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-hover"
                  onClick={() => {
                    setCodeMode((v) => !v);
                    setAttachOpen(false);
                  }}
                >
                  <Code2 size={16} /> Code message
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-hover"
                  onClick={() => {
                    setVaultOpen(true);
                    setAttachOpen(false);
                  }}
                >
                  <HardDrive size={16} /> Large file (Vault)
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-hover"
                  onClick={() => {
                    setLocationOpen(true);
                    setAttachOpen(false);
                  }}
                >
                  <MapPin size={16} /> Location
                </button>
              </div>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Message…"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-brand-primary"
          />
          <MorphSendButton
            state={sendState}
            onSend={() => void send()}
            onHoldToRecord={() => void voice.start()}
            onReleaseRecord={() => void sendVoice()}
          />
        </div>
      </div>

      <VaultSheet
        open={vaultOpen}
        onClose={() => setVaultOpen(false)}
        chatId={chatId}
      />

      <ShareLocationSheet
        open={locationOpen}
        chatId={chatId}
        onClose={() => setLocationOpen(false)}
        onSent={(msg, share) => {
          upsertMessage(msg);
          if (share.mode === "live" && share.status === "active") {
            setActiveLiveShare(share);
          }
        }}
      />

      {chat?.peer?.id && (
        <BlockReportSheet
          open={reportOpen}
          userId={chat.peer.id}
          displayName={chat.peer.display_name}
          onClose={() => setReportOpen(false)}
          onDone={({ blocked }) => {
            if (blocked) {
              useAppStore.setState((s) => ({
                chats: s.chats.filter((c) => c.id !== chatId),
                activeChatId:
                  s.activeChatId === chatId ? null : s.activeChatId,
              }));
              onBack?.();
            }
          }}
        />
      )}
    </div>
  );
}
